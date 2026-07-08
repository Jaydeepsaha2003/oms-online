import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import type {
  LedgerReceiptLine,
  PartyLedgerKpis,
  PartyLedgerLookups,
  PartyLedgerQuery,
  PartyLedgerResult,
  PartyLedgerRow,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';

const r0 = (x: number) => Math.round(x);
const EPS = 0.5;
const DAY = 86_400_000;
/** Debit Notes live in Challan (prefix DN) but reach the ledger via AcctLedger, so
 *  they're excluded from the sale-invoice leg to avoid double counting. */
const isDebitNoteChallan = (prefix: string | null, transaction: string) =>
  (prefix ?? '').trim().toUpperCase() === 'DN' || transaction.trim().toUpperCase() === 'DEBIT NOTE';

function parseDay(s: string, label: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} is not valid.`);
  d.setHours(0, 0, 0, 0);
  return d;
}

interface RawRow {
  txnDate: Date;
  particulars: string;
  customerName: string;
  voucherType: string;
  voucherNo: string;
  bankDr: number;
  bankCr: number;
  cashDr: number;
  cashCr: number;
  dueDate: Date | null;
  sortRank: number; // invoices before ledger on the same date
}

@Injectable()
export class PartyLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

  async lookups(): Promise<PartyLedgerLookups> {
    const customers = await this.prisma.customer.findMany({
      where: { partyName: { not: null }, active: true },
      select: { id: true, partyName: true },
      orderBy: { partyName: 'asc' },
    });
    const agentRows = await this.prisma.customer.findMany({
      where: { agentName: { not: null }, active: true },
      select: { agentName: true },
      distinct: ['agentName'],
      orderBy: { agentName: 'asc' },
    });
    return {
      customers: customers.map((c) => ({ id: c.id, name: c.partyName! })),
      agents: agentRows.map((a) => a.agentName!).filter((a) => a && a.trim() !== ''),
    };
  }

  /** Receipts / clearances against one invoice (row-click detail). */
  async receipts(invNo: string): Promise<LedgerReceiptLine[]> {
    if (!invNo?.trim()) return [];
    const rows = await this.prisma.acctPaymentReceipt.findMany({
      where: { invNo: invNo.trim() },
      orderBy: [{ recDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      recDate: r.recDate.toISOString(),
      refRecId: r.refRecId ?? '',
      recType: (r.recType ?? '').toUpperCase(),
      recAmt: r.recAmt ?? 0,
    }));
  }

  async ledger(q: PartyLedgerQuery): Promise<PartyLedgerResult> {
    const from = parseDay(q.from, 'From date');
    const to = parseDay(q.to, 'To date');
    if (to < from) throw new BadRequestException('To date is before From date.');
    const toExclusive = new Date(to.getTime() + DAY);
    const mode = (q.mode ?? 'BOTH').toUpperCase();

    // Resolve scope: a customer wins over an agent.
    let scope: 'CUSTOMER' | 'AGENT' | 'ALL' = 'ALL';
    let customerName: string | null = null;
    let custIds: number[] | null = null;
    const agentName = q.agentName?.trim() && q.agentName.trim().toUpperCase() !== 'ALL' ? q.agentName.trim() : null;

    if (q.customerId) {
      const c = await this.prisma.customer.findUnique({ where: { id: q.customerId }, select: { id: true, partyName: true } });
      if (!c) throw new BadRequestException('Customer not found.');
      scope = 'CUSTOMER';
      customerName = c.partyName;
      custIds = [c.id];
    } else if (agentName) {
      scope = 'AGENT';
      const list = await this.prisma.customer.findMany({ where: { agentName }, select: { id: true } });
      custIds = list.map((x) => x.id);
      if (!custIds.length) custIds = [-1];
    }

    // ── 1) Ledger rows in [from, to] ──────────────────────────────────────────
    const raw = await this.collectRows(from, toExclusive, custIds);

    // ── 2) Per-invoice pending (bank/cash bal + amount) + last receipt date ───
    const pending = await this.invoicePending();
    const lastRec = await this.latestReceiptDates();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rows: PartyLedgerRow[] = raw
      .map((rr) => this.decorate(rr, pending, lastRec, mode, today))
      // Transaction-mode filter (B = bank cols only, C = cash only).
      .filter((row) => (mode === 'B' ? row.bankDr !== 0 || row.bankCr !== 0 : mode === 'C' ? row.cashDr !== 0 || row.cashCr !== 0 : true))
      // Voucher-type filter.
      .filter((row) => !q.voucherType || row.voucherType.toUpperCase() === q.voucherType.toUpperCase());

    // ── 3) Opening as-of `from` ───────────────────────────────────────────────
    const { bankNet: openingBankNet, cashNet: openingCashNet } = await this.openingAsOf(from, custIds);

    // ── 4) Footer (opening / current / closing) ───────────────────────────────
    const cur = rows.reduce(
      (a, r) => ({ bankDr: a.bankDr + r.bankDr, bankCr: a.bankCr + r.bankCr, cashDr: a.cashDr + r.cashDr, cashCr: a.cashCr + r.cashCr }),
      { bankDr: 0, bankCr: 0, cashDr: 0, cashCr: 0 },
    );
    const closingBankNet = openingBankNet + (cur.bankDr - cur.bankCr);
    const closingCashNet = openingCashNet + (cur.cashDr - cur.cashCr);
    const split = (net: number): [number, number] => (net >= 0 ? [r0(net), 0] : [0, r0(Math.abs(net))]);
    const [obDr, obCr] = split(openingBankNet);
    const [ocDr, ocCr] = split(openingCashNet);
    const [cbDr, cbCr] = split(closingBankNet);
    const [ccDr, ccCr] = split(closingCashNet);

    // ── 5) KPIs ───────────────────────────────────────────────────────────────
    const kpis = await this.computeKpis(rows, pending, custIds, scope, q.customerId ?? null);

    const voucherTypes = [...new Set(rows.map((r) => r.voucherType).filter(Boolean))].sort();

    return {
      rows,
      footer: {
        opening: { bankDr: obDr, bankCr: obCr, cashDr: ocDr, cashCr: ocCr },
        current: { bankDr: r0(cur.bankDr), bankCr: r0(cur.bankCr), cashDr: r0(cur.cashDr), cashCr: r0(cur.cashCr) },
        closing: { bankDr: cbDr, bankCr: cbCr, cashDr: ccDr, cashCr: ccCr },
        openingBankNet: r0(openingBankNet),
        openingCashNet: r0(openingCashNet),
        closingBankNet: r0(closingBankNet),
        closingCashNet: r0(closingCashNet),
      },
      kpis,
      voucherTypes,
      scope,
      customerName,
      agentName,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  /* ── row collection ─────────────────────────────────────────────────────── */

  private async collectRows(from: Date, toExclusive: Date, custIds: number[] | null): Promise<RawRow[]> {
    // Sale invoices (Challan, excluding Debit Notes) — B = bank Dr, C = cash Dr.
    const challanWhere: Prisma.ChallanWhereInput = { invDate: { gte: from, lt: toExclusive } };
    if (custIds) challanWhere.customerId = { in: custIds };
    const challans = await this.prisma.challan.findMany({
      where: challanWhere,
      select: { code: true, invDate: true, dueDate: true, prefix: true, transaction: true, customerName: true, b: true, c: true },
    });

    // Ledger vouchers (RECEIPT / DEBIT NOTE / CREDIT NOTE / SALES DISCOUNT).
    const ledgerWhere: Prisma.AcctLedgerWhereInput = { transDate: { gte: from, lt: toExclusive } };
    if (custIds) ledgerWhere.custId = { in: custIds };
    const ledger = await this.prisma.acctLedger.findMany({
      where: ledgerWhere,
      select: { voucherNo: true, transDate: true, customerName: true, particulars: true, voucherType: true, bankDebit: true, cashDebit: true, bankCredit: true, cashCredit: true },
    });

    const raw: RawRow[] = [];
    for (const c of challans) {
      if (isDebitNoteChallan(c.prefix, c.transaction)) continue;
      const bank = r0(c.b ?? 0);
      const cash = r0(c.c ?? 0);
      if (bank === 0 && cash === 0) continue;
      raw.push({
        txnDate: c.invDate,
        particulars: c.customerName,
        customerName: c.customerName,
        voucherType: c.transaction || 'SALES INVOICE',
        voucherNo: c.code,
        bankDr: bank,
        bankCr: 0,
        cashDr: cash,
        cashCr: 0,
        dueDate: c.dueDate ?? null,
        sortRank: 1,
      });
    }
    for (const l of ledger) {
      let particulars = l.particulars ?? '';
      // DEBIT NOTE particulars → "PARTY NAME (AGST SSS/XX)".
      if ((l.voucherType ?? '').trim().toUpperCase() === 'DEBIT NOTE' && l.customerName) {
        const up = particulars.toUpperCase();
        if (up.startsWith('DEBIT NOTE')) {
          const after = particulars.slice('DEBIT NOTE'.length).trim();
          particulars = after ? `${l.customerName} (${after})` : l.customerName;
        }
      }
      raw.push({
        txnDate: l.transDate,
        particulars,
        customerName: l.customerName,
        voucherType: l.voucherType || 'RECEIPT',
        voucherNo: l.voucherNo,
        bankDr: r0(l.bankDebit ?? 0),
        bankCr: r0(l.bankCredit ?? 0),
        cashDr: r0(l.cashDebit ?? 0),
        cashCr: r0(l.cashCredit ?? 0),
        dueDate: null,
        sortRank: 5,
      });
    }
    raw.sort((a, b) => a.txnDate.getTime() - b.txnDate.getTime() || a.sortRank - b.sortRank || a.voucherNo.localeCompare(b.voucherNo));
    return raw;
  }

  /** Attach Status (D/P/F) + Due From text to each row. */
  private decorate(
    rr: RawRow,
    pending: Map<string, { bankBal: number; cashBal: number; bankAmt: number; cashAmt: number; dueDate: Date | null }>,
    lastRec: Map<string, Date>,
    mode: string,
    today: Date,
  ): PartyLedgerRow {
    const vt = rr.voucherType.toUpperCase();
    const isInvoice = vt === 'SALES INVOICE' || vt === 'DEBIT NOTE';
    const base: PartyLedgerRow = {
      txnDate: rr.txnDate.toISOString(),
      particulars: rr.particulars,
      customerName: rr.customerName,
      voucherType: rr.voucherType,
      voucherNo: rr.voucherNo,
      dueFrom: '',
      status: '',
      bankDr: rr.bankDr,
      bankCr: rr.bankCr,
      cashDr: rr.cashDr,
      cashCr: rr.cashCr,
      dueDate: rr.dueDate?.toISOString() ?? null,
    };
    if (!isInvoice) return base;

    const info = pending.get(rr.voucherNo);
    const dueDate = rr.dueDate ?? info?.dueDate ?? rr.txnDate;
    const invoiceAmt = rr.bankDr + rr.cashDr;

    if (!info) {
      // Not in pending view (older / cleared outside the system): just show due-from.
      base.dueFrom = this.dueFromText(dueDate, today);
      return base;
    }
    const pend = mode === 'B' ? info.bankBal : mode === 'C' ? info.cashBal : info.bankBal + info.cashBal;
    if (pend <= EPS) {
      base.status = 'F';
      const paid = lastRec.get(rr.voucherNo);
      base.dueFrom = paid ? this.earlyLateText(dueDate, paid) : '';
    } else if (pend < invoiceAmt - EPS) {
      base.status = 'P';
      base.dueFrom = this.dueFromText(dueDate, today);
    } else {
      base.status = 'D';
      base.dueFrom = this.dueFromText(dueDate, today);
    }
    return base;
  }

  private dueFromText(dueDate: Date, today: Date): string {
    const daysLeft = Math.round((dueDate.getTime() - today.getTime()) / DAY);
    if (daysLeft < 0) return `${Math.abs(daysLeft)} Over`;
    if (daysLeft === 0) return 'Due Today';
    return `${daysLeft} Left`;
  }

  private earlyLateText(dueDate: Date, lastPay: Date): string {
    const diff = Math.round((dueDate.getTime() - lastPay.getTime()) / DAY);
    if (diff > 0) return `${diff} Early`;
    if (diff === 0) return 'On Time';
    return `${Math.abs(diff)} Late`;
  }

  /* ── pending + receipt derivations ──────────────────────────────────────── */

  /** InvPendingSummary equivalent: per CONFIRMED challan, bank/cash amount & balance. */
  private async invoicePending(): Promise<Map<string, { bankBal: number; cashBal: number; bankAmt: number; cashAmt: number; dueDate: Date | null }>> {
    const challans = await this.prisma.challan.findMany({
      where: { challanStatus: 'CONFIRMED' },
      select: { code: true, b: true, c: true, dueDate: true },
    });
    const map = new Map<string, { bankBal: number; cashBal: number; bankAmt: number; cashAmt: number; dueDate: Date | null }>();
    if (!challans.length) return map;
    const codes = challans.map((c) => c.code);
    const [recs, discs] = await Promise.all([
      this.prisma.acctPaymentReceipt.groupBy({ by: ['invNo', 'payMode'], where: { invNo: { in: codes } }, _sum: { recAmt: true } }),
      this.prisma.acctPartyDiscount.groupBy({ by: ['invNo', 'billType'], where: { invNo: { in: codes } }, _sum: { disAmt: true } }),
    ]);
    const bankRec = new Map<string, number>();
    const cashRec = new Map<string, number>();
    for (const r of recs) {
      const m = r.payMode === 'BANK' || r.payMode === 'CHEQUE' ? bankRec : cashRec;
      m.set(r.invNo, (m.get(r.invNo) ?? 0) + (r._sum.recAmt ?? 0));
    }
    const bankDisc = new Map<string, number>();
    const cashDisc = new Map<string, number>();
    for (const d of discs) {
      const m = d.billType === 'BANK' ? bankDisc : cashDisc;
      m.set(d.invNo, (m.get(d.invNo) ?? 0) + (d._sum.disAmt ?? 0));
    }
    for (const c of challans) {
      const bankAmt = c.b ?? 0;
      const cashAmt = c.c ?? 0;
      map.set(c.code, {
        bankAmt,
        cashAmt,
        bankBal: bankAmt - (bankRec.get(c.code) ?? 0) - (bankDisc.get(c.code) ?? 0),
        cashBal: cashAmt - (cashRec.get(c.code) ?? 0) - (cashDisc.get(c.code) ?? 0),
        dueDate: c.dueDate ?? null,
      });
    }
    return map;
  }

  private async latestReceiptDates(): Promise<Map<string, Date>> {
    const rows = await this.prisma.acctPaymentReceipt.groupBy({ by: ['invNo'], _max: { recDate: true } });
    const map = new Map<string, Date>();
    for (const r of rows) if (r._max.recDate) map.set(r.invNo, r._max.recDate);
    return map;
  }

  /* ── opening balance as-of ──────────────────────────────────────────────── */

  /** Opening net (+Dr/−Cr) as-of `from`: base opening (≤ from) + movement (base→from). */
  private async openingAsOf(from: Date, custIds: number[] | null): Promise<{ bankNet: number; cashNet: number }> {
    // Base opening: OPENING rows (imported from ACCT OPENING BALANCE) dated ≤ from.
    const openWhere: Prisma.AcctOpeningTransWhereInput = { kind: 'OPENING', transDate: { lte: from } };
    if (custIds) openWhere.custId = { in: custIds };
    const openings = await this.prisma.acctOpeningTrans.findMany({ where: openWhere, select: { bankAmt: true, cashAmt: true, transDate: true, drCr: true } });
    let baseBank = 0;
    let baseCash = 0;
    let baseDate = new Date(1900, 0, 1);
    for (const o of openings) {
      const sign = (o.drCr ?? 'DEBIT').toUpperCase() === 'CREDIT' ? -1 : 1;
      baseBank += sign * (o.bankAmt ?? 0);
      baseCash += sign * (o.cashAmt ?? 0);
      if (o.transDate > baseDate) baseDate = o.transDate;
    }

    // Movement from baseDate up to (but excluding) `from` — same rows the grid shows.
    const move = await this.movement(baseDate, from, custIds);
    return { bankNet: baseBank + move.bank, cashNet: baseCash + move.cash };
  }

  /** Σ(Dr − Cr) of sale invoices (non-DN) + ledger vouchers in [start, end). */
  private async movement(start: Date, end: Date, custIds: number[] | null): Promise<{ bank: number; cash: number }> {
    if (end <= start) return { bank: 0, cash: 0 };
    const chWhere: Prisma.ChallanWhereInput = { invDate: { gte: start, lt: end } };
    const ldWhere: Prisma.AcctLedgerWhereInput = { transDate: { gte: start, lt: end } };
    if (custIds) {
      chWhere.customerId = { in: custIds };
      ldWhere.custId = { in: custIds };
    }
    const [challans, ledger] = await Promise.all([
      this.prisma.challan.findMany({ where: chWhere, select: { prefix: true, transaction: true, b: true, c: true } }),
      this.prisma.acctLedger.findMany({ where: ldWhere, select: { bankDebit: true, cashDebit: true, bankCredit: true, cashCredit: true } }),
    ]);
    let bank = 0;
    let cash = 0;
    for (const c of challans) {
      if (isDebitNoteChallan(c.prefix, c.transaction)) continue;
      bank += c.b ?? 0;
      cash += c.c ?? 0;
    }
    for (const l of ledger) {
      bank += (l.bankDebit ?? 0) - (l.bankCredit ?? 0);
      cash += (l.cashDebit ?? 0) - (l.cashCredit ?? 0);
    }
    return { bank, cash };
  }

  /* ── KPIs ────────────────────────────────────────────────────────────────── */

  private async computeKpis(
    rows: PartyLedgerRow[],
    pending: Map<string, { bankBal: number; cashBal: number; bankAmt: number; cashAmt: number; dueDate: Date | null }>,
    custIds: number[] | null,
    scope: 'CUSTOMER' | 'AGENT' | 'ALL',
    customerId: number | null,
  ): Promise<PartyLedgerKpis> {
    // Aging buckets over unpaid invoice rows (Status ≠ F), amount = bankDr + cashDr.
    const over = { amount: 0, count: 0 };
    const past = { amount: 0, count: 0 };
    const normal = { amount: 0, count: 0 };
    let invDueFrom = '';
    for (const r of rows) {
      const vt = r.voucherType.toUpperCase();
      if (vt !== 'SALES INVOICE' && vt !== 'DEBIT NOTE') continue;
      if (r.status === 'F') continue;
      const amt = r.bankDr + r.cashDr;
      const due = r.dueFrom.trim();
      if (/Over/i.test(due)) {
        over.amount += amt;
        over.count += 1;
      } else if (/^Due Today$/i.test(due)) {
        past.amount += amt;
        past.count += 1;
      } else {
        const days = parseInt(due, 10) || 0;
        if (days <= 15) {
          past.amount += amt;
          past.count += 1;
        } else {
          normal.amount += amt;
          normal.count += 1;
        }
      }
      // Oldest unpaid (D/P) → Inv Due From ("dd-MMM-yy (INV NO)").
      if (!invDueFrom && (r.status === 'D' || r.status === 'P')) {
        const info = pending.get(r.voucherNo);
        const dd = info?.dueDate ?? (r.dueDate ? new Date(r.dueDate) : null);
        if (dd) invDueFrom = `${dd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })} (${r.voucherNo})`;
      }
    }
    if (!invDueFrom) invDueFrom = 'No Due Invoice';

    const paymentDNA = scope === 'CUSTOMER' && customerId ? await this.paymentDNA(customerId) : 'N/A';
    return { invDueFrom, paymentDNA, overDue: { amount: r0(over.amount), count: over.count }, pastDue: { amount: r0(past.amount), count: past.count }, normal: { amount: r0(normal.amount), count: normal.count } };
  }

  /** Payment behaviour grade = avg(recDate − invDate) / creditDays. */
  private async paymentDNA(customerId: number): Promise<string> {
    const cust = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { creditPeriod: true, partyName: true } });
    let creditDays = cust?.creditPeriod ?? 30;
    if (!creditDays || creditDays <= 0) creditDays = 30;

    // Average days-to-pay from receipts joined to their invoice date.
    const receipts = await this.prisma.acctPaymentReceipt.findMany({ where: { custId: customerId }, select: { invNo: true, recDate: true } });
    if (!receipts.length) return 'N/A';
    const invCodes = [...new Set(receipts.map((r) => r.invNo))];
    const challans = await this.prisma.challan.findMany({ where: { code: { in: invCodes } }, select: { code: true, invDate: true } });
    const invDate = new Map(challans.map((c) => [c.code, c.invDate]));
    let totalDays = 0;
    let n = 0;
    for (const rc of receipts) {
      const inv = invDate.get(rc.invNo);
      if (!inv) continue;
      totalDays += Math.max(0, Math.round((rc.recDate.getTime() - inv.getTime()) / DAY));
      n += 1;
    }
    const avg = n ? totalDays / n : 30;
    const ratio = avg / creditDays;
    if (ratio <= 0.8) return 'Excellent';
    if (ratio <= 1.0) return 'Good';
    if (ratio <= 1.25) return 'Normal';
    if (ratio <= 1.5) return 'Slow';
    return 'Bad';
  }

  /* ── Export ──────────────────────────────────────────────────────────────── */

  private baseName(res: PartyLedgerResult): string {
    const who = res.scope === 'CUSTOMER' ? res.customerName : res.scope === 'AGENT' ? `Agent-${res.agentName}` : 'All-Parties';
    return `Ledger-${(who ?? 'party').replace(/[\\/:*?"<>|]/g, '-')}`;
  }

  async exportExcel(q: PartyLedgerQuery): Promise<{ buffer: Buffer; filename: string }> {
    const res = await this.ledger(q);
    const rows = res.rows.map((r) => ({
      Date: new Date(r.txnDate).toLocaleDateString('en-GB'),
      'Due From': r.dueFrom,
      Particulars: r.particulars,
      'Voucher Type': r.voucherType,
      'Voucher No': r.voucherNo,
      'Bank Dr': r.bankDr || '',
      'Bank Cr': r.bankCr || '',
      'Cash Dr': r.cashDr || '',
      'Cash Cr': r.cashCr || '',
    }));
    const f = res.footer;
    const foot = (label: string, b: { bankDr: number; bankCr: number; cashDr: number; cashCr: number }) => ({
      Date: '',
      'Due From': '',
      Particulars: '',
      'Voucher Type': '',
      'Voucher No': label,
      'Bank Dr': b.bankDr || '',
      'Bank Cr': b.bankCr || '',
      'Cash Dr': b.cashDr || '',
      'Cash Cr': b.cashCr || '',
    });
    rows.push(foot('OPENING BALANCE', f.opening), foot('CURRENT TOTAL', f.current), foot('CLOSING BALANCE', f.closing));
    const buffer = this.excel.jsonToBuffer(rows);
    return { buffer, filename: `${this.baseName(res)}.xlsx` };
  }

  async exportPdf(q: PartyLedgerQuery): Promise<{ buffer: Buffer; filename: string }> {
    const res = await this.ledger(q);
    const buffer = await this.pdf.render(buildLedgerDoc(res));
    return { buffer, filename: `${this.baseName(res)}.pdf` };
  }
}

/* ── PDF document ─────────────────────────────────────────────────────────── */

function buildLedgerDoc(res: PartyLedgerResult): TDocumentDefinitions {
  const NAVY = '#0E1E36';
  const AMBER = '#F59E0B';
  const q0 = (v: number) => (v ? v.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '');
  const d = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '');
  const who = res.scope === 'CUSTOMER' ? res.customerName : res.scope === 'AGENT' ? `Agent: ${res.agentName}` : 'All Parties';

  const head = ['Date', 'Due From', 'Particulars', 'Voucher Type', 'Voucher No', 'Bank Dr', 'Bank Cr', 'Cash Dr', 'Cash Cr'].map((text, i) => ({
    text,
    bold: true,
    color: '#ffffff',
    fontSize: 8,
    alignment: i >= 5 ? 'right' : 'left',
  }));
  const body = res.rows.map((r) => [
    { text: d(r.txnDate), fontSize: 8 },
    { text: r.dueFrom, fontSize: 7, color: /Over/i.test(r.dueFrom) ? '#B91C1C' : /Early|On Time|Late/i.test(r.dueFrom) ? '#15803D' : '#334155' },
    { text: r.particulars, fontSize: 8 },
    { text: r.voucherType, fontSize: 8 },
    { text: r.voucherNo, fontSize: 8 },
    { text: q0(r.bankDr), alignment: 'right', fontSize: 8 },
    { text: q0(r.bankCr), alignment: 'right', fontSize: 8, color: '#15803D' },
    { text: q0(r.cashDr), alignment: 'right', fontSize: 8 },
    { text: q0(r.cashCr), alignment: 'right', fontSize: 8, color: '#15803D' },
  ]);

  const f = res.footer;
  const footRow = (label: string, b: { bankDr: number; bankCr: number; cashDr: number; cashCr: number }, strong: boolean) => [
    { text: '', border: [false, false, false, false] },
    { text: '', border: [false, false, false, false] },
    { text: '', border: [false, false, false, false] },
    { text: '', border: [false, false, false, false] },
    { text: label, bold: true, alignment: 'right', fontSize: 8, color: strong ? NAVY : '#334155' },
    { text: q0(b.bankDr), alignment: 'right', bold: true, fontSize: 8 },
    { text: q0(b.bankCr), alignment: 'right', bold: true, fontSize: 8, color: '#15803D' },
    { text: q0(b.cashDr), alignment: 'right', bold: true, fontSize: 8 },
    { text: q0(b.cashCr), alignment: 'right', bold: true, fontSize: 8, color: '#15803D' },
  ];

  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [24, 24, 24, 30],
    defaultStyle: { font: 'Helvetica', fontSize: 8, color: '#111111' },
    content: [
      {
        table: { widths: ['*', 'auto'], body: [[
          { text: 'PARTY LEDGER', color: '#ffffff', bold: true, fontSize: 15 },
          { text: `${d(res.from)}  to  ${d(res.to)}`, color: '#ffffff', bold: true, fontSize: 10, alignment: 'right', margin: [0, 3, 0, 0] },
        ]] },
        layout: { fillColor: () => NAVY, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 6, paddingBottom: () => 6 },
      },
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 793, h: 3, color: AMBER }], margin: [0, 0, 0, 8] },
      { text: who ?? '', bold: true, fontSize: 12, margin: [0, 0, 0, 8] },
      {
        table: { headerRows: 1, widths: [42, 44, '*', 70, 60, 58, 58, 58, 58], body: [head, ...body, footRow('OPENING BALANCE', f.opening, false), footRow('CURRENT TOTAL', f.current, false), footRow('CLOSING BALANCE', f.closing, true)] },
        layout: {
          fillColor: (rowIndex: number, node: { table: { body: unknown[] } }) =>
            rowIndex === 0 ? NAVY : rowIndex >= node.table.body.length - 3 ? '#ECFDF5' : rowIndex % 2 === 0 ? '#F5F7FA' : null,
          hLineColor: () => '#D6DEE8',
          vLineColor: () => '#D6DEE8',
          hLineWidth: () => 0.4,
          vLineWidth: () => 0.4,
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
      },
    ],
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: new Date().toLocaleString('en-GB'), fontSize: 7, color: '#888888', margin: [24, 0, 0, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 7, color: '#888888', alignment: 'right', margin: [0, 0, 24, 0] },
      ],
    }),
  } as unknown as TDocumentDefinitions;
}
