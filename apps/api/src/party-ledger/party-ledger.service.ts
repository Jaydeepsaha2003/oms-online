import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import type {
  LedgerBalanceRow,
  LedgerReceiptLine,
  PartyLedgerKpis,
  PartyLedgerLookups,
  PartyLedgerQuery,
  PartyLedgerResult,
  PartyLedgerRow,
  PartyListDef,
  PartyListStanding,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { formatDate } from '../common/date.util';
import { PdfService } from '../pdf/pdf.service';
import { PartyListsService } from '../party-lists/party-lists.service';

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

/** One confirmed invoice with what's still owed on it, keyed by voucher code. */
interface PendingInvoice {
  bankBal: number;
  cashBal: number;
  bankAmt: number;
  cashAmt: number;
  dueDate: Date | null;
  invDate: Date;
  customerId: number | null;
  customerName: string;
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
  /** Resolved after the initial pass — see collectRows(). */
  challanId?: number | null;
}

@Injectable()
export class PartyLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly partyLists: PartyListsService,
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

    const inMode: PartyLedgerRow[] = raw
      .map((rr) => this.decorate(rr, pending, lastRec, mode, today))
      // Transaction-mode filter (B = bank cols only, C = cash only).
      .filter((row) => (mode === 'B' ? row.bankDr !== 0 || row.bankCr !== 0 : mode === 'C' ? row.cashDr !== 0 || row.cashCr !== 0 : true));
    // Voucher-type filter.
    const rows = inMode.filter((row) => !q.voucherType || row.voucherType.toUpperCase() === q.voucherType.toUpperCase());

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

    // Derived BEFORE the voucher-type filter, so picking one type doesn't collapse
    // the dropdown to that single option and strand the user on it.
    const voucherTypes = [...new Set(inMode.map((r) => r.voucherType).filter(Boolean))].sort();

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
    // Only CONFIRMED challans are ledger debits; a CANCELLED challan is void and must
    // not appear as a receivable (matches the Payment receivables view).
    const challanWhere: Prisma.ChallanWhereInput = { challanStatus: 'CONFIRMED', invDate: { gte: from, lt: toExclusive } };
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

    // SALES INVOICE / DEBIT NOTE rows are both backed by a real Challan record (Debit
    // Notes arrive here via AcctLedger, so their challan id isn't already in hand) —
    // resolve voucherNo (= Challan.code) → id in one batched lookup so the UI can link
    // to the actual document.
    const invoiceCodes = [...new Set(raw.filter((r) => ['SALES INVOICE', 'DEBIT NOTE'].includes(r.voucherType.toUpperCase())).map((r) => r.voucherNo))];
    if (invoiceCodes.length) {
      const matches = await this.prisma.challan.findMany({ where: { code: { in: invoiceCodes } }, select: { id: true, code: true } });
      const idByCode = new Map(matches.map((m) => [m.code, m.id]));
      for (const r of raw) r.challanId = idByCode.get(r.voucherNo) ?? null;
    }
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
      challanId: rr.challanId ?? null,
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
  private async invoicePending(): Promise<Map<string, PendingInvoice>> {
    const challans = await this.prisma.challan.findMany({
      where: { challanStatus: 'CONFIRMED' },
      // customerId / customerName / invDate let the ageing KPIs find a party's
      // oldest unpaid bill across its whole history, not just the shown period.
      select: { code: true, b: true, c: true, dueDate: true, invDate: true, customerId: true, customerName: true },
    });
    const map = new Map<string, PendingInvoice>();
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
        invDate: c.invDate,
        customerId: c.customerId ?? null,
        customerName: c.customerName,
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
    // CONFIRMED only — a cancelled challan is void, so it must not move the opening
    // balance either (keeps opening/closing consistent with the grid and Payments).
    const chWhere: Prisma.ChallanWhereInput = { challanStatus: 'CONFIRMED', invDate: { gte: start, lt: end } };
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
    pending: Map<string, PendingInvoice>,
    custIds: number[] | null,
    scope: 'CUSTOMER' | 'AGENT' | 'ALL',
    customerId: number | null,
  ): Promise<PartyLedgerKpis> {
    // Aging buckets over unpaid invoice rows (Status ≠ F), amount = bankDr + cashDr.
    const over = { amount: 0, count: 0 };
    const past = { amount: 0, count: 0 };
    const normal = { amount: 0, count: 0 };
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
    }

    const invDueFrom = this.oldestUnpaid(pending, custIds, scope);
    const dna = await this.listStanding(scope, customerId, custIds);
    return {
      invDueFrom,
      paymentDNA: dna.label,
      paymentDNAKind: dna.kind,
      overDue: { amount: r0(over.amount), count: over.count },
      pastDue: { amount: r0(past.amount), count: past.count },
      normal: { amount: r0(normal.amount), count: normal.count },
    };
  }

  /**
   * The oldest invoice still carrying a balance, as "dd-mm-yyyy (CODE)".
   *
   * Deliberately computed from the full open-invoice position rather than the
   * vouchers on screen: the ledger defaults to the current financial year, and an
   * unpaid bill raised before it would otherwise be invisible here — so the KPI
   * used to name a *newer* invoice and understate how long money had been owed.
   * "Oldest" means earliest due date (falling back to the invoice date when a bill
   * carries no due date), which is what "due from" asks.
   */
  private oldestUnpaid(pending: Map<string, PendingInvoice>, custIds: number[] | null, scope: 'CUSTOMER' | 'AGENT' | 'ALL'): string {
    const inScope = custIds ? new Set(custIds) : null;
    let best: { code: string; at: Date; party: string } | null = null;
    for (const [code, inv] of pending) {
      if (inScope && (inv.customerId == null || !inScope.has(inv.customerId))) continue;
      // Still owed on either leg (EPS absorbs rounding crumbs).
      if (inv.bankBal <= EPS && inv.cashBal <= EPS) continue;
      const at = inv.dueDate ?? inv.invDate;
      if (!best || at < best.at) best = { code, at, party: inv.customerName };
    }
    if (!best) return 'No Due Invoice';
    // A multi-party ledger needs to say WHOSE invoice it is.
    const who = scope === 'CUSTOMER' ? '' : ` · ${best.party}`;
    return `${formatDate(best.at)} (${best.code}${who})`;
  }

  /**
   * Payment DNA — the party's standing on the CRM Party Lists: Green-listed
   * (trusted payer) or Black-listed (payment risk), evaluated from live metrics by
   * the same rules engine the Party Lists screen uses. This replaced an
   * avg-days-to-pay grade that read "N/A" on every multi-party ledger and ignored
   * the business's own definition of a good or risky party.
   */
  private async listStanding(
    scope: 'CUSTOMER' | 'AGENT' | 'ALL',
    customerId: number | null,
    custIds: number[] | null,
  ): Promise<{ label: string; kind: PartyListStanding }> {
    const { lists, parties } = await this.partyLists.evaluate();
    const kindById = new Map(lists.map((l) => [l.id, l]));
    const inScope = custIds ? new Set(custIds) : null;
    const relevant = parties.filter((p) => !inScope || (p.customerId != null && inScope.has(p.customerId)));

    /** The list that best describes one party — risk outranks trust. */
    const standingOf = (matched: string[]): { kind: PartyListStanding; name: string } => {
      const defs = matched.map((id) => kindById.get(id)).filter((l): l is PartyListDef => !!l);
      const black = defs.find((l) => l.kind === 'BLACK');
      if (black) return { kind: 'BLACK', name: black.name };
      const green = defs.find((l) => l.kind === 'GREEN');
      if (green) return { kind: 'GREEN', name: green.name };
      if (defs.length) return { kind: 'CUSTOM', name: defs[0].name };
      return { kind: 'NONE', name: 'Unlisted' };
    };

    if (scope === 'CUSTOMER' && customerId != null) {
      const me = relevant.find((p) => p.customerId === customerId);
      if (!me) return { label: 'Unlisted', kind: 'NONE' };
      const s = standingOf(me.matched);
      return { label: s.kind === 'NONE' ? 'Unlisted' : s.name, kind: s.kind };
    }

    // Agent / all-parties: a tally is more use than a single grade.
    let green = 0;
    let black = 0;
    for (const p of relevant) {
      const k = standingOf(p.matched).kind;
      if (k === 'BLACK') black += 1;
      else if (k === 'GREEN') green += 1;
    }
    if (!green && !black) return { label: 'Unlisted', kind: 'NONE' };
    const parts: string[] = [];
    if (green) parts.push(`${green} Green`);
    if (black) parts.push(`${black} Black`);
    // Risk dominates the colour even when greens outnumber blacks.
    return { label: parts.join(' · '), kind: black ? 'BLACK' : 'GREEN' };
  }

  /* ── Export ──────────────────────────────────────────────────────────────── */

  private baseName(res: PartyLedgerResult): string {
    const who = res.scope === 'CUSTOMER' ? res.customerName : res.scope === 'AGENT' ? `Agent-${res.agentName}` : 'All-Parties';
    return `Ledger-${(who ?? 'party').replace(/[\\/:*?"<>|]/g, '-')}`;
  }

  /** The company masthead printed on the statement; blank when never configured. */
  private async companyName(): Promise<string | null> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: 'COMPANY_NAME' } });
    return row?.value?.trim() || null;
  }

  async exportExcel(q: PartyLedgerQuery): Promise<{ buffer: Buffer; filename: string }> {
    const res = await this.ledger(q);
    const buffer = await buildLedgerXlsx(res, (q.mode ?? 'BOTH').toUpperCase(), await this.companyName());
    return { buffer, filename: `${this.baseName(res)}.xlsx` };
  }

  async exportPdf(q: PartyLedgerQuery): Promise<{ buffer: Buffer; filename: string }> {
    const res = await this.ledger(q);
    const buffer = await this.pdf.render(buildLedgerDoc(res, (q.mode ?? 'BOTH').toUpperCase(), await this.companyName()));
    return { buffer, filename: `${this.baseName(res)}.pdf` };
  }
}

/* ── Shared export helpers ────────────────────────────────────────────────── */

const modeLabel = (m: string) => (m === 'B' ? 'Bank only' : m === 'C' ? 'Cash only' : 'Bank & Cash');
const partyOf = (res: PartyLedgerResult) =>
  res.scope === 'CUSTOMER' ? (res.customerName ?? 'Party') : res.scope === 'AGENT' ? `Agent: ${res.agentName}` : 'All Parties';
const shortDate = (s: string | null) =>
  formatDate(s, '');

/** Tally prints every figure to two decimals and leaves a zero cell empty. */
const amt2 = (v: number) => (v ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
/** Same, but a zero prints as 0.00 (used for the ageing summary, never blank). */
const amt2z = (v: number) => (v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The Dr/Cr key pair for one money leg, so Bank and Cash render identically. */
interface Leg {
  group: 'Bank' | 'Cash';
  dr: 'bankDr' | 'cashDr';
  cr: 'bankCr' | 'cashCr';
}
/** Which legs a mode shows: BOTH → Bank then Cash, B → Bank only, C → Cash only. */
function legsFor(mode: string): Leg[] {
  const legs: Leg[] = [];
  if (mode !== 'C') legs.push({ group: 'Bank', dr: 'bankDr', cr: 'bankCr' });
  if (mode !== 'B') legs.push({ group: 'Cash', dr: 'cashDr', cr: 'cashCr' });
  return legs;
}

/** The house settlement shorthand, printed verbatim: F = fully paid, P = partially
 *  paid, D = due. It gets its own narrow column so the statement matches the screen. */
const STATUS_LEGEND = 'St:  F = fully paid   P = partially paid   D = due';

/* ── PDF document ─────────────────────────────────────────────────────────── */

/**
 * A Tally "Ledger Account" statement, printed the way Tally prints one: plain
 * black on white with no fills or accent colour, a centred company masthead, and
 * a boxed grid whose column rules run the full height while horizontal rules
 * appear only under the headings and around the totals. Amounts carry two
 * decimals and a zero cell is left blank, both Tally conventions.
 *
 * The page turns landscape only when both money legs are shown (four figure
 * columns); a Bank-only or Cash-only ledger is a plain Debit/Credit statement and
 * fits portrait, exactly like Tally's own.
 */
function buildLedgerDoc(res: PartyLedgerResult, mode: string, company: string | null): TDocumentDefinitions {
  const BLACK = '#000000';
  const d = shortDate;
  const k = res.kpis;
  const f = res.footer;
  const legs = legsFor(mode);
  /** Both legs shown → the Dr/Cr pairs sit under "Bank" / "Cash" group headings. */
  const grouped = legs.length === 2;
  /** Always landscape. At 9pt the six text columns plus the figure pairs simply
   *  don't breathe on portrait A4 — Particulars ends up wrapping every second
   *  party name, which reads far worse than a wider sheet. */
  const pageWidth = 842 - 48;

  /** Body type. Bumped from 8pt so the statement stays legible in print and on a
   *  phone; every other size below is set relative to it. */
  const BODY = 9;
  const txt = (text: string, extra: Record<string, unknown> = {}) => ({ text, fontSize: BODY, ...extra });
  const num = (v: number, extra: Record<string, unknown> = {}) => ({ text: amt2(v), fontSize: BODY, alignment: 'right', ...extra });
  /** Column captions: slightly larger than the body, letter-spaced so a run of
   *  short words ("Vch No", "Debit") reads as a heading rather than as data. */
  const head = (text: string, extra: Record<string, unknown> = {}) => ({
    text,
    fontSize: BODY + 0.5,
    bold: true,
    characterSpacing: 0.3,
    ...extra,
  });

  /* ── headings ── */
  /** Date, Particulars, Vch Type, Vch No, Due Date. */
  const LEAD = 5;
  const groupRow = [
    ...Array.from({ length: LEAD }, () => txt('')),
    ...legs.flatMap((l) => [head(l.group.toUpperCase(), { alignment: 'center', colSpan: 2, characterSpacing: 1 }), txt('')]),
  ];
  const colRow = [
    head('Date'),
    head('Particulars'),
    head('Vch Type'),
    head('Vch No'),
    head('Due Date'),
    ...legs.flatMap(() => [head('Debit', { alignment: 'right' }), head('Credit', { alignment: 'right' })]),
  ];
  const heads = grouped ? [groupRow, colRow] : [colRow];

  /* ── one voucher line, single row ── */
  const dataRow = (r: PartyLedgerRow) => [
    txt(d(r.txnDate), { noWrap: true }),
    // The party/narration carries the line, so it's the only cell in medium weight.
    txt(r.particulars),
    txt(r.voucherType, { fontSize: BODY - 0.5 }),
    txt(r.voucherNo, { noWrap: true }),
    txt(d(r.dueDate), { noWrap: true }),
    ...legs.flatMap((l) => [num(r[l.dr]), num(r[l.cr])]),
  ];

  /* ── opening / current / closing, laid out on the same grid ── */
  const balRow = (label: string, b: LedgerBalanceRow, strong: boolean) => [
    txt(''),
    txt(label, { bold: true, characterSpacing: strong ? 0.4 : 0 }),
    ...Array.from({ length: LEAD - 2 }, () => txt('')),
    ...legs.flatMap((l) => [num(b[l.dr], { bold: true }), num(b[l.cr], { bold: true })]),
  ].map((c) => (strong ? { ...c, fontSize: BODY + 1 } : c));

  const body = [
    ...heads,
    balRow('Opening Balance', f.opening, false),
    ...res.rows.map(dataRow),
    balRow('Current Total', f.current, false),
    balRow('Closing Balance', f.closing, true),
  ];
  const headerRows = heads.length;
  /** Row index of the first totals line — the grid rules key off these. */
  const totalsAt = body.length - 2;
  /* Column widths are CONTENT widths — pdfmake adds the 10pt cell padding on top
     of whatever is declared here. Each is the measured Helvetica width of that
     column's widest real value at this size ("SALES DISCOUNT", "SSS/26-27/140",
     a crore-scale amount in bold), so nothing wraps and nothing over-claims
     space: every extra point taken here comes straight out of Particulars. */
  const numW = 62;
  const leadW = [48, '*', 76, 63, 58];

  const kpiCell = (label: string, bucket: { amount: number; count: number }) => ({
    stack: [
      { text: label, fontSize: 8, bold: true, characterSpacing: 0.5 },
      { text: amt2z(bucket.amount), fontSize: 12.5, bold: true, margin: [0, 2, 0, 0] },
      { text: `${bucket.count} invoice(s)`, fontSize: 8, margin: [0, 1, 0, 0] },
    ],
    margin: [8, 5, 8, 5],
  });

  /** A labelled fact under the grid ("Oldest unpaid: …"), label lighter than value. */
  const factLine = (pairs: [string, string][]) => ({
    text: pairs.flatMap(([label, value], i) => [
      { text: `${i ? '        ' : ''}${label}: `, fontSize: 8.5 },
      { text: value, fontSize: 8.5, bold: true },
    ]),
    margin: [0, 4, 0, 0],
  });

  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [24, 22, 24, 32],
    defaultStyle: { font: 'Helvetica', fontSize: BODY, color: BLACK },
    content: [
      /* Masthead — company, document type, party, period. Centred, like Tally.
         The company sits large and letter-spaced; a hairline under it separates
         the letterhead from the statement caption. */
      ...(company
        ? [
            { text: company.toUpperCase(), bold: true, fontSize: 16, characterSpacing: 1.2, alignment: 'center' },
            { canvas: [{ type: 'line', x1: pageWidth * 0.3, y1: 0, x2: pageWidth * 0.7, y2: 0, lineWidth: 0.5, lineColor: BLACK }], margin: [0, 3, 0, 3] },
          ]
        : []),
      { text: 'LEDGER ACCOUNT', fontSize: 10.5, characterSpacing: 2, alignment: 'center', margin: [0, company ? 0 : 2, 0, 6] },
      {
        columns: [
          { width: '*', text: partyOf(res), bold: true, fontSize: 13.5 },
          {
            width: 'auto',
            stack: [
              { text: `${d(res.from)}  to  ${d(res.to)}`, fontSize: 10, bold: true, alignment: 'right' },
              { text: `${modeLabel(mode)}   ·   Amounts in INR`, fontSize: 8, alignment: 'right', margin: [0, 2, 0, 0] },
            ],
          },
        ],
        margin: [0, 0, 0, 4],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: pageWidth, y2: 0, lineWidth: 1, lineColor: BLACK }], margin: [0, 0, 0, 6] },

      /* The ledger grid. */
      {
        table: { headerRows, widths: [...leadW, ...legs.flatMap(() => [numW, numW])], body },
        layout: {
          // Column rules run the full height; horizontal rules only frame the
          // headings, the opening line and the totals — Tally's exact skeleton.
          hLineWidth: (i: number) =>
            i === 0 || i === headerRows || i === body.length || i === totalsAt ? 1 : i === headerRows + 1 || i === body.length - 1 || (grouped && i === 1) ? 0.5 : 0,
          vLineWidth: () => 0.5,
          hLineColor: () => BLACK,
          vLineColor: () => BLACK,
          paddingLeft: () => 5,
          paddingRight: () => 5,
          // Roomier rows: the larger type needs the leading, and it stops the
          // figure columns reading as a solid block. Headings get a touch more.
          paddingTop: (i: number) => (i < headerRows ? 4 : 3),
          paddingBottom: (i: number) => (i < headerRows ? 4 : 3),
        },
      },

      /* Ageing summary — the one thing Tally doesn't print, kept because the
         screen shows it; rendered in the same black-and-white grammar. Held
         together as one unbreakable block so the three buckets and the two fact
         lines can never be split across a page turn. */
      {
        unbreakable: true,
        stack: [
          {
            table: {
              widths: ['*', '*', '*'],
              body: [[kpiCell('OVER DUE', k.overDue), kpiCell('DUE SOON / PARTIAL', k.pastDue), kpiCell('WITHIN TERMS', k.normal)]],
            },
            layout: {
              hLineWidth: () => 0.5,
              vLineWidth: () => 0.5,
              hLineColor: () => BLACK,
              vLineColor: () => BLACK,
              paddingLeft: () => 0,
              paddingRight: () => 0,
              paddingTop: () => 0,
              paddingBottom: () => 0,
            },
          },
          factLine([
            ['Oldest unpaid', k.invDueFrom],
            ['Party list', k.paymentDNA],
          ]),
        ],
        margin: [0, 10, 0, 0],
      },
    ],
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `Generated ${new Date().toLocaleString('en-GB')}`, fontSize: 8, color: BLACK, margin: [24, 0, 0, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, bold: true, color: BLACK, alignment: 'right', margin: [0, 0, 24, 0] },
      ],
      margin: [0, 6, 0, 0],
    }),
  } as unknown as TDocumentDefinitions;
}

/* ── Excel document — the same Tally statement, as a working sheet ─────────── */

/**
 * The spreadsheet mirrors the PDF's black-and-white Tally grammar (no fills, no
 * accent colour, thin black rules, two-decimal figures) but keeps Due From and
 * Status as real columns rather than folding them into a narration line — a sheet
 * is something you filter and pivot, so the data stays tabular.
 */
async function buildLedgerXlsx(res: PartyLedgerResult, mode: string, company: string | null): Promise<Buffer> {
  const BLACK = 'FF000000';
  const legs = legsFor(mode);
  const grouped = legs.length === 2;
  const q = (v: number) => (v ? v : null); // 0 → blank cell, as Tally prints it

  interface Col {
    header: string;
    /** The Bank / Cash banner this column sits under, when both legs are shown. */
    group?: string;
    width: number;
    align: 'left' | 'right' | 'center';
    num?: boolean;
    get: (r: PartyLedgerRow) => string | number | null;
    /** Pulls this column's figure out of a totals row. */
    bal?: (b: LedgerBalanceRow) => number;
  }
  // Column order mirrors the screen and the PDF: St and Due From follow Vch No.
  const cols: Col[] = [
    { header: 'Date', width: 12, align: 'left', get: (r) => shortDate(r.txnDate) },
    { header: 'Particulars', width: 38, align: 'left', get: (r) => r.particulars },
    { header: 'Vch Type', width: 16, align: 'left', get: (r) => r.voucherType },
    { header: 'Vch No', width: 16, align: 'left', get: (r) => r.voucherNo },
    { header: 'St', width: 5, align: 'center', get: (r) => r.status || '' },
    { header: 'Due From', width: 12, align: 'left', get: (r) => r.dueFrom || '' },
    ...legs.flatMap((l): Col[] => [
      { header: 'Debit', group: l.group, width: 15, align: 'right', num: true, get: (r) => q(r[l.dr]), bal: (b) => b[l.dr] },
      { header: 'Credit', group: l.group, width: 15, align: 'right', num: true, get: (r) => q(r[l.cr]), bal: (b) => b[l.cr] },
    ]),
  ];
  const nCols = cols.length;
  const labelCol = 4; // "Vch No" column — where the totals labels sit (1-based)
  /** The summary block below the grid uses wide text columns, not the narrow St. */
  const sumLabelCol = 2; // Particulars
  const sumValueCol = 4; // Vch No
  const sumNoteCol = 6; // Due From

  const wb = new ExcelJS.Workbook();
  wb.creator = 'OMS';
  wb.created = new Date();
  /** Headings occupy rows 1–4 (masthead) plus the group banner when shown. */
  const groupRowNo = grouped ? 5 : 0;
  const headRowNo = grouped ? 6 : 5;
  const ws = wb.addWorksheet('Ledger Account', {
    views: [{ state: 'frozen', ySplit: headRowNo }], // masthead + headings stay put
    pageSetup: {
      orientation: grouped ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));

  const thin = { style: 'thin' as const, color: { argb: BLACK } };
  const medium = { style: 'medium' as const, color: { argb: BLACK } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const centred = (text: string, row: number, size: number, bold: boolean) => {
    ws.mergeCells(row, 1, row, nCols);
    const cell = ws.getCell(row, 1);
    cell.value = text;
    cell.font = { name: 'Calibri', size, bold, color: { argb: BLACK } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(row).height = size + 8;
  };

  // Rows 1–4 — the Tally masthead: company, document type, party, period.
  centred(company ? company.toUpperCase() : 'LEDGER ACCOUNT', 1, 15, true);
  centred('Ledger Account', 2, 11, false);
  centred(partyOf(res), 3, 12, true);
  centred(`${shortDate(res.from)}  to  ${shortDate(res.to)}      ·      ${modeLabel(mode)}`, 4, 9, false);
  for (let c = 1; c <= nCols; c++) ws.getCell(4, c).border = { bottom: medium };

  // Group banner (Bank / Cash) — only when both legs are shown.
  if (grouped) {
    const row = ws.getRow(groupRowNo);
    const firstLeg = cols.findIndex((c) => c.group);
    legs.forEach((l, i) => {
      const from = firstLeg + i * 2 + 1;
      ws.mergeCells(groupRowNo, from, groupRowNo, from + 1);
      const cell = row.getCell(from);
      cell.value = l.group;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: BLACK } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = box;
      row.getCell(from + 1).border = box;
    });
    row.height = 16;
  }

  // Column headings.
  const headRow = ws.getRow(headRowNo);
  cols.forEach((c, i) => {
    const cell = headRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: BLACK } };
    cell.alignment = { vertical: 'middle', horizontal: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' };
    cell.border = { ...box, top: medium, bottom: medium };
  });
  headRow.height = 18;

  // Opening / voucher lines / totals all sit on the same grid.
  let rIdx = headRowNo + 1;
  const balanceRow = (label: string, b: LedgerBalanceRow, strong: boolean) => {
    const row = ws.getRow(rIdx);
    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      cell.border = { ...box, top: strong ? medium : thin };
      cell.alignment = { vertical: 'middle', horizontal: c.align };
      cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: BLACK } };
      if (ci + 1 === labelCol) {
        cell.value = label;
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (c.bal) {
        cell.value = c.bal(b) || null;
        cell.numFmt = '#,##0.00';
      }
    });
    row.height = strong ? 18 : 16;
    rIdx++;
  };

  balanceRow('Opening Balance', res.footer.opening, false);
  res.rows.forEach((r) => {
    const row = ws.getRow(rIdx);
    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = c.get(r);
      cell.alignment = { vertical: 'middle', horizontal: c.align };
      cell.font = { name: 'Calibri', size: 9, color: { argb: BLACK } };
      if (c.num) cell.numFmt = '#,##0.00';
      cell.border = box;
    });
    rIdx++;
  });
  balanceRow('Current Total', res.footer.current, false);
  balanceRow('Closing Balance', res.footer.closing, true);

  // Ageing summary, two rows below the grid.
  rIdx += 1;
  const k = res.kpis;
  ([
    ['Over Due', k.overDue],
    ['Due Soon / Partial', k.pastDue],
    ['Within Terms', k.normal],
  ] as const).forEach(([label, bucket]) => {
    const row = ws.getRow(rIdx);
    const l = row.getCell(sumLabelCol);
    l.value = label;
    l.font = { name: 'Calibri', size: 9, bold: true, color: { argb: BLACK } };
    l.alignment = { vertical: 'middle', horizontal: 'right' };
    const v = row.getCell(sumValueCol);
    v.value = bucket.amount || 0;
    v.numFmt = '#,##0.00';
    v.font = { name: 'Calibri', size: 9, bold: true, color: { argb: BLACK } };
    v.alignment = { vertical: 'middle', horizontal: 'right' };
    const n = row.getCell(sumNoteCol);
    n.value = `${bucket.count} invoice(s)`;
    n.font = { name: 'Calibri', size: 9, color: { argb: BLACK } };
    rIdx++;
  });
  const tail = ws.getRow(rIdx);
  tail.getCell(sumLabelCol).value = 'Oldest unpaid';
  tail.getCell(sumLabelCol).alignment = { horizontal: 'right' };
  tail.getCell(sumValueCol).value = k.invDueFrom;
  rIdx++;
  const dna = ws.getRow(rIdx);
  dna.getCell(sumLabelCol).value = 'Party list';
  dna.getCell(sumLabelCol).alignment = { horizontal: 'right' };
  dna.getCell(sumValueCol).value = k.paymentDNA;
  rIdx += 2;
  ws.getRow(rIdx).getCell(sumLabelCol).value = STATUS_LEGEND;

  ws.autoFilter = { from: { row: headRowNo, column: 1 }, to: { row: headRowNo, column: nCols } };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
