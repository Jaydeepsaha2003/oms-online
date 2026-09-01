import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { payBucketOf } from '@oms/shared';
import type {
  LedgerBalanceRow,
  LedgerClearedLine,
  LedgerClearedResult,
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
/** Money rounding, same as the payments waterfall so totals reconcile exactly. */
const r2 = (x: number) => Math.round(x * 100) / 100;
const EPS = 0.5;
const DAY = 86_400_000;
/** Debit Notes live in Challan (prefix DN) but reach the ledger via AcctLedger, so
 *  they're excluded from the sale-invoice leg to avoid double counting. */
const isDebitNoteChallan = (prefix: string | null, transaction: string) =>
  (prefix ?? '').trim().toUpperCase() === 'DN' || transaction.trim().toUpperCase() === 'DEBIT NOTE';

/**
 * Start of the April–March financial year a date falls in.
 *
 * An opening balance belongs to a *year*, not to the day it happened to be keyed
 * in — that is how Tally treats it, and it is what makes one year's closing equal
 * the next year's opening. Every opening in this database was keyed mid-year
 * (Jun-2025 … Jan-2026), so without this the figure was invisible in the year it
 * belonged to and then appeared out of nowhere at the next year's boundary.
 */
const FY_START_MONTH = 3; // April, 0-based
function fyStart(d: Date): Date {
  const y = d.getMonth() >= FY_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(y, FY_START_MONTH, 1);
}

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

  /**
   * Receipts / clearances against one invoice (row-click detail).
   *
   * `mode` follows the ledger's own Bank/Cash toggle. An invoice has a bank side
   * and a cash side settled by different vouchers on different days, so listing
   * both while the grid is filtered to one shows payments that do not belong to
   * the column being read — which is exactly how a settled invoice comes to look
   * like it was paid twice. Every line also carries its own bucket, so a BOTH
   * view can still say which side each one settled.
   */
  async receipts(invNo: string, mode?: string): Promise<LedgerReceiptLine[]> {
    if (!invNo?.trim()) return [];
    const rows = await this.prisma.acctPaymentReceipt.findMany({
      where: { invNo: invNo.trim() },
      orderBy: [{ recDate: 'asc' }, { id: 'asc' }],
    });
    const want = (mode ?? 'BOTH').toUpperCase();
    return rows
      .map((r) => ({
        recDate: r.recDate.toISOString(),
        refRecId: r.refRecId ?? '',
        recType: (r.recType ?? '').toUpperCase(),
        recAmt: r.recAmt ?? 0,
        bucket: (payBucketOf(r.payMode) === 'bank' ? 'B' : 'C') as 'B' | 'C',
      }))
      .filter((l) => want === 'BOTH' || l.bucket === want);
  }

  /**
   * What one receipt voucher settled — which parties' invoices, and what was
   * left on account.
   *
   * The reverse of `receipts()`, and the only place the ledger can answer "an
   * agent handed over cash, whose bills did it clear?": an agent voucher is
   * booked against the AGENT (custId 0) while every line it creates is credited
   * to the party that owed the money, so the voucher row alone never names them.
   *
   * Lines are matched three ways because the back-link has changed over time:
   *   refId = the ledger's receiptRefId  — every line this voucher wrote, and
   *                                        the ONLY way to find the ones funded
   *                                        from an old advance (their refRecId
   *                                        names the advance, not the voucher).
   *   refRecId = voucherNo               — the receipt-funded lines.
   *   sourceVoucherNo = voucherNo        — newer rows carry it outright.
   * Older vouchers predate `sourceVoucherNo` on 2,600+ rows, so dropping any of
   * the three would silently under-report what a voucher did.
   */
  async cleared(voucherNo: string): Promise<LedgerClearedResult> {
    const v = voucherNo?.trim();
    if (!v) throw new BadRequestException('Voucher number is required.');
    const ledger = await this.prisma.acctLedger.findFirst({
      where: { voucherNo: v, voucherType: 'RECEIPT' },
    });
    if (!ledger) throw new NotFoundException('Receipt voucher not found.');

    const rows = await this.prisma.acctPaymentReceipt.findMany({
      where: {
        OR: [
          ...(ledger.receiptRefId ? [{ refId: ledger.receiptRefId }] : []),
          { refRecId: v },
          { sourceVoucherNo: v },
        ],
      },
      orderBy: [{ customerName: 'asc' }, { invNo: 'asc' }, { id: 'asc' }],
    });

    const lines: LedgerClearedLine[] = rows.map((r) => ({
      invNo: r.invNo,
      customerName: r.customerName,
      amount: r.recAmt ?? 0,
      kind: (r.refRecId ?? '').startsWith('ADV-') ? 'ADVANCE' : 'RECEIPT',
      fundedBy: r.refRecId ?? v,
    }));
    const cleared = r2(lines.reduce((sum, l) => sum + l.amount, 0));
    // Split by funding source: only this voucher's own money reconciles against
    // its total. Clearing paid for from an older advance is real, but it is not
    // money this voucher carried.
    const fromAdvance = r2(lines.filter((l) => l.kind === 'ADVANCE').reduce((sum, l) => sum + l.amount, 0));
    const fromReceipt = r2(cleared - fromAdvance);

    // Whatever this voucher did not put on a bill went on account.
    const advance = await this.prisma.acctPartyAdvance.findFirst({ where: { refRecId: v } });
    const parked = advance ? { refId: advance.refId, amount: r2(advance.bankAmt + advance.cashAmt) } : null;

    return {
      voucherNo: v,
      bookedTo: ledger.customerName,
      voucherTotal: r2(ledger.bankCredit + ledger.cashCredit),
      lines,
      cleared,
      fromReceipt,
      fromAdvance,
      parked,
    };
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
    let customerAddress: string | null = null;
    let custIds: number[] | null = null;
    const agentName = q.agentName?.trim() && q.agentName.trim().toUpperCase() !== 'ALL' ? q.agentName.trim() : null;

    if (q.customerId) {
      const c = await this.prisma.customer.findUnique({
        where: { id: q.customerId },
        select: { id: true, partyName: true, city: true, state: true, region: true },
      });
      if (!c) throw new BadRequestException('Customer not found.');
      scope = 'CUSTOMER';
      customerName = c.partyName;
      customerAddress = [c.city, c.state, c.region].map((part) => part?.trim()).filter(Boolean).join(', ') || null;
      custIds = [c.id];
    } else if (agentName) {
      scope = 'AGENT';
      const list = await this.prisma.customer.findMany({ where: { agentName }, select: { id: true } });
      custIds = list.map((x) => x.id);
      if (!custIds.length) custIds = [-1];
    }

    // ── 1) Ledger rows in [from, to] ──────────────────────────────────────────
    const raw = await this.collectRows(from, toExclusive, custIds, agentName);

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
    // Only meaningful when the grid holds every voucher type. The opening spans
    // them all, so `opening + one-type Current Total` would report a closing
    // balance the party never owed — withhold both rather than publish a figure
    // that reads authoritative and isn't. The Bank/Cash mode filter is fine here:
    // the two legs carry their own opening, and dropping cash-only rows removes
    // no bank movement.
    const balancesApply = !q.voucherType;
    const { bankNet: openingBankNet, cashNet: openingCashNet } = balancesApply
      ? await this.openingAsOf(from, custIds, agentName)
      : { bankNet: 0, cashNet: 0 };

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
    const kpis = await this.computeKpis(rows, pending, custIds, scope, q.customerId ?? null, mode, from, toExclusive);

    // Derived BEFORE the voucher-type filter, so picking one type doesn't collapse
    // the dropdown to that single option and strand the user on it.
    const voucherTypes = [...new Set(inMode.map((r) => r.voucherType).filter(Boolean))].sort();

    return {
      rows,
      footer: {
        opening: balancesApply ? { bankDr: obDr, bankCr: obCr, cashDr: ocDr, cashCr: ocCr } : null,
        current: { bankDr: r0(cur.bankDr), bankCr: r0(cur.bankCr), cashDr: r0(cur.cashDr), cashCr: r0(cur.cashCr) },
        closing: balancesApply ? { bankDr: cbDr, bankCr: cbCr, cashDr: ccDr, cashCr: ccCr } : null,
        openingBankNet: balancesApply ? r0(openingBankNet) : null,
        openingCashNet: balancesApply ? r0(openingCashNet) : null,
        closingBankNet: balancesApply ? r0(closingBankNet) : null,
        closingCashNet: balancesApply ? r0(closingCashNet) : null,
      },
      kpis,
      voucherTypes,
      scope,
      customerName,
      customerAddress,
      agentName,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  /* ── row collection ─────────────────────────────────────────────────────── */

  /**
   * How to match AcctLedger rows for a scoped (party / agent) ledger.
   *
   * A receipt taken against an AGENT is written with `custId = 0` and only the
   * `agentName` set — it isn't tied to any one of the agent's customers. Matching
   * on `custId` alone therefore showed the agent's invoices as debits but hid every
   * payment they made, so an agent ledger's closing balance never came down.
   */
  private ledgerScopeOr(custIds: number[], agentName: string | null): Prisma.AcctLedgerWhereInput[] {
    const or: Prisma.AcctLedgerWhereInput[] = [{ custId: { in: custIds } }];
    if (agentName) or.push({ agentName });
    return or;
  }

  private async collectRows(from: Date, toExclusive: Date, custIds: number[] | null, agentName: string | null): Promise<RawRow[]> {
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
    if (custIds) ledgerWhere.OR = this.ledgerScopeOr(custIds, agentName);
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
    // An opening balance normally lands in the brought-forward figure. But when the
    // window *starts before* the year that balance belongs to, its effective date
    // (that year's 1-April) falls inside the window instead — so it has to appear
    // as a line here, or a range like 31-Mar-2025 → 15-May-2025 would close at nil
    // and the next range would open with the balance out of nowhere.
    const openRows = await this.prisma.acctOpeningTrans.findMany({
      where: {
        kind: 'OPENING',
        ...(custIds ? { custId: { in: custIds } } : {}),
      },
      select: { custId: true, customerName: true, transDate: true, bankAmt: true, cashAmt: true, drCr: true },
    });
    for (const o of openRows) {
      const effective = fyStart(o.transDate);
      // `<= from` is already counted in openingAsOf — emitting it again would double it.
      if (effective <= from || effective >= toExclusive) continue;
      const credit = (o.drCr ?? 'DEBIT').toUpperCase() === 'CREDIT';
      const bank = r0(o.bankAmt ?? 0);
      const cash = r0(o.cashAmt ?? 0);
      if (bank === 0 && cash === 0) continue;
      raw.push({
        txnDate: effective,
        particulars: 'Opening Balance',
        customerName: o.customerName,
        voucherType: 'OPENING BALANCE',
        voucherNo: 'Opening Balance',
        bankDr: credit ? 0 : bank,
        bankCr: credit ? bank : 0,
        cashDr: credit ? 0 : cash,
        cashCr: credit ? cash : 0,
        dueDate: null,
        sortRank: 0, // the year's very first line
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
      pendingAmount: 0,
      pendingSide: null,
      bankDr: rr.bankDr,
      bankCr: rr.bankCr,
      cashDr: rr.cashDr,
      cashCr: rr.cashCr,
      dueDate: rr.dueDate?.toISOString() ?? null,
    };
    if (!isInvoice) return base;

    const info = pending.get(rr.voucherNo);
    const dueDate = rr.dueDate ?? info?.dueDate ?? rr.txnDate;
    const invoiceAmt = mode === 'B' ? rr.bankDr : mode === 'C' ? rr.cashDr : rr.bankDr + rr.cashDr;

    if (!info) {
      // A confirmed invoice without a pending snapshot is treated as wholly due.
      base.status = invoiceAmt > EPS ? 'D' : '';
      base.pendingAmount = r0(Math.max(0, invoiceAmt));
      base.pendingSide = this.pendingSideOf(rr.bankDr, rr.cashDr);
      base.dueFrom = this.dueFromText(dueDate, today);
      return base;
    }
    const pend = Math.max(0, mode === 'B' ? info.bankBal : mode === 'C' ? info.cashBal : info.bankBal + info.cashBal);
    base.pendingAmount = r0(pend);
    base.pendingSide = this.pendingSideOf(info.bankBal, info.cashBal);
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

  /** 'B' / 'C' when the money still owed sits on exactly one leg, else null. */
  private pendingSideOf(bank: number, cash: number): 'B' | 'C' | null {
    const onBank = bank > EPS;
    const onCash = cash > EPS;
    if (onBank && !onCash) return 'B';
    if (onCash && !onBank) return 'C';
    return null;
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
      const m = payBucketOf(r.payMode) === 'bank' ? bankRec : cashRec;
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

  /**
   * Opening net (+Dr / −Cr) as-of `from`.
   *
   * An OPENING row states a party's balance **as at its own date**, so only that
   * party's movement AFTER that date may be added on top. Each customer therefore
   * gets their own anchor date; a customer with no OPENING row anchors at the
   * epoch, so their entire history counts.
   *
   * This used to collapse every customer onto ONE global anchor — the latest
   * OPENING date in the whole set. On a single-party ledger that's harmless (there
   * is only one anchor), but on an ALL-parties or AGENT ledger it silently dropped
   * every invoice raised before that global date for all the other parties, while
   * their receipts inside the report window still counted as credits. The opening
   * came out massively understated and the closing balance could flip to Cr.
   */
  private async openingAsOf(from: Date, custIds: number[] | null, agentName: string | null): Promise<{ bankNet: number; cashNet: number }> {
    // Fetched without a date filter: an opening keyed in Jul-2025 counts from
    // 01-Apr-2025, so `transDate <= from` would wrongly exclude it from its own
    // year. The FY test below is what decides. (One row per party per year — a
    // few dozen rows, so there is nothing to gain from narrowing this in SQL.)
    const openWhere: Prisma.AcctOpeningTransWhereInput = { kind: 'OPENING' };
    if (custIds) openWhere.custId = { in: custIds };
    const openings = await this.prisma.acctOpeningTrans.findMany({
      where: openWhere,
      select: { custId: true, bankAmt: true, cashAmt: true, transDate: true, drCr: true },
    });

    const EPOCH = new Date(1900, 0, 1);
    /** custId → the start of the year that customer's opening figure belongs to. */
    const anchor = new Map<number, Date>();
    let bankNet = 0;
    let cashNet = 0;
    for (const o of openings) {
      const effective = fyStart(o.transDate);
      // A later year's opening is not yet in force for this period.
      if (effective > from) continue;
      const sign = (o.drCr ?? 'DEBIT').toUpperCase() === 'CREDIT' ? -1 : 1;
      bankNet += sign * (o.bankAmt ?? 0);
      cashNet += sign * (o.cashAmt ?? 0);
      const prev = anchor.get(o.custId);
      if (!prev || effective > prev) anchor.set(o.custId, effective);
    }

    // Everything before `from`, kept only when it falls on/after its own party's
    // anchor. CONFIRMED challans only — a cancelled one is void, so it must not
    // move the opening either (keeps opening/closing consistent with the grid).
    const chWhere: Prisma.ChallanWhereInput = { challanStatus: 'CONFIRMED', invDate: { lt: from } };
    const ldWhere: Prisma.AcctLedgerWhereInput = { transDate: { lt: from } };
    if (custIds) {
      chWhere.customerId = { in: custIds };
      ldWhere.OR = this.ledgerScopeOr(custIds, agentName);
    }
    const [challans, ledger] = await Promise.all([
      this.prisma.challan.findMany({
        where: chWhere,
        select: { customerId: true, invDate: true, prefix: true, transaction: true, b: true, c: true },
      }),
      this.prisma.acctLedger.findMany({
        where: ldWhere,
        select: { custId: true, transDate: true, bankDebit: true, cashDebit: true, bankCredit: true, cashCredit: true },
      }),
    ]);
    for (const c of challans) {
      if (isDebitNoteChallan(c.prefix, c.transaction)) continue;
      if (c.invDate < (anchor.get(c.customerId ?? -1) ?? EPOCH)) continue;
      bankNet += c.b ?? 0;
      cashNet += c.c ?? 0;
    }
    for (const l of ledger) {
      if (l.transDate < (anchor.get(l.custId ?? -1) ?? EPOCH)) continue;
      bankNet += (l.bankDebit ?? 0) - (l.bankCredit ?? 0);
      cashNet += (l.cashDebit ?? 0) - (l.cashCredit ?? 0);
    }
    return { bankNet, cashNet };
  }

  /* ── KPIs ────────────────────────────────────────────────────────────────── */

  private async computeKpis(
    rows: PartyLedgerRow[],
    pending: Map<string, PendingInvoice>,
    custIds: number[] | null,
    scope: 'CUSTOMER' | 'AGENT' | 'ALL',
    customerId: number | null,
    mode: string,
    /** The window currently on screen — used only to say whether the invoice the
     *  "Inv due from" KPI names is visible in the table below it. */
    from: Date,
    toExclusive: Date,
  ): Promise<PartyLedgerKpis> {
    // Ageing buckets use the remaining balance for the selected Bank/Cash mode,
    // not the invoice's original value (which overstates partially-paid bills).
    const over = { amount: 0, count: 0 };
    const past = { amount: 0, count: 0 };
    const normal = { amount: 0, count: 0 };
    for (const r of rows) {
      const vt = r.voucherType.toUpperCase();
      if (vt !== 'SALES INVOICE' && vt !== 'DEBIT NOTE') continue;
      if (r.status === 'F') continue;
      const info = pending.get(r.voucherNo);
      const amt = info
        ? Math.max(0, mode === 'B' ? info.bankBal : mode === 'C' ? info.cashBal : info.bankBal + info.cashBal)
        : r.pendingAmount;
      if (amt <= EPS) continue;
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

    const oldest = this.oldestUnpaid(pending, custIds, scope);
    /*
     * Is the invoice the KPI names actually on screen?
     *
     * It often is not, and that is deliberate — the KPI looks past the date
     * filter so an old unpaid bill cannot hide behind it. But a headline naming
     * a document that is nowhere in the table reads as an error, which is
     * exactly how it was reported. Telling the UI lets it say so.
     */
    if (oldest.detail) {
      const raised = new Date(oldest.detail.invDate);
      oldest.detail.inRange = raised >= from && raised < toExclusive;
    }
    const invDueFrom = oldest.text;
    const dna = await this.listStanding(scope, customerId, custIds);
    return {
      invDueFrom,
      invDueFromDetail: oldest.detail,
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
  private oldestUnpaid(
    pending: Map<string, PendingInvoice>,
    custIds: number[] | null,
    scope: 'CUSTOMER' | 'AGENT' | 'ALL',
  ): { text: string; detail: PartyLedgerKpis['invDueFromDetail'] } {
    const inScope = custIds ? new Set(custIds) : null;
    let best: { code: string; at: Date; party: string; invDate: Date } | null = null;
    for (const [code, inv] of pending) {
      if (inScope && (inv.customerId == null || !inScope.has(inv.customerId))) continue;
      // Still owed on either leg (EPS absorbs rounding crumbs).
      if (inv.bankBal <= EPS && inv.cashBal <= EPS) continue;
      const at = inv.dueDate ?? inv.invDate;
      if (!best || at < best.at) best = { code, at, party: inv.customerName, invDate: inv.invDate };
    }
    if (!best) return { text: 'No Due Invoice', detail: null };
    // A multi-party ledger needs to say WHOSE invoice it is.
    const who = scope === 'CUSTOMER' ? '' : ` · ${best.party}`;
    return {
      text: `${formatDate(best.at)} (${best.code}${who})`,
      detail: {
        code: best.code,
        dueDate: best.at.toISOString(),
        invDate: best.invDate.toISOString(),
        party: best.party,
        // Filled in by the caller, which is the only place that knows the range.
        inRange: true,
      },
    };
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

  /** PartyName_dd_mm_yy_hhmmss, kept filesystem-safe for Content-Disposition. */
  private pdfName(res: PartyLedgerResult): string {
    const who = res.scope === 'CUSTOMER' ? res.customerName : res.scope === 'AGENT' ? `Agent-${res.agentName}` : 'All-Parties';
    const safeParty = (who ?? 'party').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
    const now = new Date();
    const two = (value: number) => String(value).padStart(2, '0');
    const stamp = `${two(now.getDate())}_${two(now.getMonth() + 1)}_${two(now.getFullYear() % 100)}_${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
    return `${safeParty}_${stamp}.pdf`;
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
    const buffer = await this.pdf.render(buildLedgerDoc(res, (q.mode ?? 'BOTH').toUpperCase()));
    return { buffer, filename: this.pdfName(res) };
  }
}

/* ── Shared export helpers ────────────────────────────────────────────────── */

const modeLabel = (m: string) => (m === 'B' ? 'Bank only' : m === 'C' ? 'Cash only' : 'Bank & Cash');
const partyOf = (res: PartyLedgerResult) =>
  res.scope === 'CUSTOMER' ? (res.customerName ?? 'Party') : res.scope === 'AGENT' ? `Agent: ${res.agentName}` : 'All Parties';
const PDF_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** Compact d-MMM-yy date used by both Date columns in the portrait PDF. */
const pdfDate = (value: string | Date | null): string => {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()}-${PDF_MONTHS[date.getMonth()]}-${String(date.getFullYear()).slice(-2)}`;
};
const shortDate = (value: string | null) => formatDate(value, '');

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
 * black on white with no fills or accent colour, a centred ledger masthead, and
 * a boxed grid whose column rules run the full height while horizontal rules
 * appear only under the headings and around the totals. Amounts carry two
 * decimals and a zero cell is left blank, both Tally conventions.
 *
 * The statement is kept on an A4 portrait sheet for consistent printing. When
 * both money legs are shown, the table uses compact type and column widths so
 * all four amount columns still fit without clipping.
 */
function buildLedgerDoc(res: PartyLedgerResult, mode: string): TDocumentDefinitions {
  const BLACK = '#000000';
  const d = pdfDate;
  const k = res.kpis;
  const f = res.footer;
  const legs = legsFor(mode);
  /** Both legs shown → the Dr/Cr pairs sit under "Bank" / "Cash" group headings. */
  const grouped = legs.length === 2;
  /** Printable width inside the narrow portrait margins. */
  const pageWidth = 595 - 36;

  /** Single-leg reports have room for larger type; grouped reports use compact
   *  type to keep Bank and Cash visible together on the portrait sheet. */
  const BODY = grouped ? 7.5 : 9;
  const txt = (text: string, extra: Record<string, unknown> = {}) => ({ text, fontSize: BODY, lineHeight: 1.12, ...extra });
  const num = (v: number, extra: Record<string, unknown> = {}) => ({
    text: amt2(v),
    fontSize: BODY,
    alignment: 'right',
    noWrap: true,
    ...extra,
  });
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
  /** Date, Particulars, Vch Type, Vch No, Payment Status, Due Date. */
  const LEAD = 6;
  const groupRow = [
    ...Array.from({ length: LEAD }, () => txt('')),
    ...legs.flatMap((l) => [head(l.group.toUpperCase(), { alignment: 'center', colSpan: 2, characterSpacing: 1 }), txt('')]),
  ];
  const colRow = [
    head('Date', { alignment: 'right' }),
    head('Particulars'),
    head('Vch Type'),
    head('Vch No'),
    head('Payment Status'),
    head('Due Date', { alignment: 'right' }),
    ...legs.flatMap(() => [head('Debit', { alignment: 'right' }), head('Credit', { alignment: 'right' })]),
  ];
  const heads = grouped ? [groupRow, colRow] : [colRow];

  /* ── one voucher line, single row ── */
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dataRow = (r: PartyLedgerRow) => {
    const voucherType = r.voucherType.trim().toUpperCase();
    const particulars = ['SALE', 'SALES', 'SALES INVOICE'].includes(voucherType) ? 'SALES' : r.particulars;
    const voucherLabel = voucherType === 'SALES INVOICE' ? 'Sales' : r.voucherType;
    const dueDate = r.dueDate ? new Date(r.dueDate) : null;
    const overdue = !!dueDate && !Number.isNaN(dueDate.getTime()) && dueDate < today && r.status !== 'F';
    const balance = r.status === 'P' ? ` ${amt2z(r.pendingAmount)}` : '';
    const paymentStatus = r.status === 'F' ? 'Paid' : overdue ? `Over Due${balance}` : r.status === 'P' ? `Due${balance}` : r.status === 'D' ? 'Due' : '';
    return [
      txt(d(r.txnDate), { alignment: 'right', noWrap: true }),
      txt(particulars),
      txt(voucherLabel, { fontSize: BODY - 1, noWrap: true }),
      txt(r.voucherNo, { noWrap: true }),
      txt(paymentStatus, { bold: !!paymentStatus, fontSize: BODY - 0.5, noWrap: true }),
      txt(d(r.dueDate), { alignment: 'right', noWrap: true }),
      ...legs.flatMap((l) => [num(r[l.dr]), num(r[l.cr])]),
    ];
  };

  /* ── opening / current / closing, laid out on the same grid ── */
  const balRow = (label: string, b: LedgerBalanceRow, strong: boolean) => [
    txt(''),
    txt(label, { bold: true, characterSpacing: strong ? 0.4 : 0, fontSize: BODY - 0.5, noWrap: true }),
    ...Array.from({ length: LEAD - 2 }, () => txt('')),
    ...legs.flatMap((l) => [num(b[l.dr], { bold: true }), num(b[l.cr], { bold: true })]),
  ].map((c, index) => (strong ? { ...c, fontSize: index === 1 ? BODY - 0.5 : BODY + 0.5 } : c));

  // Opening/Closing are withheld under a voucher-type filter (see PartyLedgerFooter),
  // so the grid drops those two lines and Current Total becomes the bottom line.
  const body = [
    ...heads,
    ...(f.opening ? [balRow('Opening Balance', f.opening, false)] : []),
    ...res.rows.map(dataRow),
    balRow('Current Total', f.current, !f.closing),
    ...(f.closing ? [balRow('Closing Balance', f.closing, true)] : []),
  ];
  const headerRows = heads.length;
  /** Row index of the first totals line — the grid rules key off these. */
  const totalsAt = body.length - (f.closing ? 2 : 1);
  /* Column widths are CONTENT widths — pdfmake adds the 10pt cell padding on top
     of whatever is declared here. Each is the measured Helvetica width of that
     column's widest real value at this size ("SALES DISCOUNT", "SSS/26-27/140",
     a crore-scale amount in bold), so nothing wraps and nothing over-claims
     space: every extra point taken here comes straight out of Particulars. */
  // The compact grouped widths retain enough room for crore-scale figures while
  // single-leg reports use wider amount cells and larger type.
  const numW = grouped ? 52 : 58;
  const leadW = grouped ? [34, '*', 42, 48, 64, 38] : [39, '*', 50, 60, 78, 44];

  const kpiCell = (label: string, bucket: { amount: number; count: number }) => ({
    stack: [
      { text: label, fontSize: 9, bold: true, characterSpacing: 0.5 },
      { text: amt2z(bucket.amount), fontSize: 13.5, bold: true, margin: [0, 2, 0, 0] },
      { text: `${bucket.count} invoice(s)`, fontSize: 9, margin: [0, 1, 0, 0] },
    ],
    margin: [8, 5, 8, 5],
  });

  /** A labelled fact under the grid ("Oldest unpaid: …"), label lighter than value. */
  const factLine = (pairs: [string, string][]) => ({
    text: pairs.flatMap(([label, value], i) => [
      { text: `${i ? '        ' : ''}${label}: `, fontSize: 9.5 },
      { text: value, fontSize: 9.5, bold: true },
    ]),
    margin: [0, 4, 0, 0],
  });

  return {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [18, 22, 18, 32],
    defaultStyle: { font: 'Calibri', fontSize: BODY, color: BLACK },
    content: [
      /* Party-first Tally masthead: account, report type, address and period. */
      {
        stack: [
          { text: partyOf(res).toUpperCase(), bold: true, fontSize: 15, alignment: 'center' },
          { text: 'Ledger Account', fontSize: 11.5, alignment: 'center', margin: [0, 1, 0, 0] },
          ...(res.customerAddress
            ? [{ text: res.customerAddress.toUpperCase(), fontSize: 10, alignment: 'center', margin: [0, 3, 0, 0] }]
            : []),
          { text: `${d(res.from)}  to  ${d(res.to)}`, fontSize: 10.5, bold: true, alignment: 'center', margin: [0, res.customerAddress ? 6 : 4, 0, 0] },
          { text: `${modeLabel(mode)}   ·   Amounts in INR`, fontSize: 9, alignment: 'center', margin: [0, 2, 0, 0] },
          // Says why the statement stops at Current Total, so a filtered print is
          // never mistaken for the party's full position.
          ...(f.opening
            ? []
            : [{ text: 'Filtered to a single voucher type — opening and closing balances not applicable', fontSize: 8.5, italics: true, alignment: 'center', margin: [0, 2, 0, 0] }]),
        ],
        margin: [0, 0, 0, 5],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: pageWidth, y2: 0, lineWidth: 1, lineColor: BLACK }], margin: [0, 0, 0, 6] },

      /* The ledger grid. */
      {
        table: { headerRows, dontBreakRows: true, widths: [...leadW, ...legs.flatMap(() => [numW, numW])], body },
        layout: {
          // Column rules run the full height; horizontal rules only frame the
          // headings, the opening line and the totals — Tally's exact skeleton.
          hLineWidth: (i: number) =>
            i === totalsAt || i === body.length
              ? 1.5
              : i === body.length - 1
                ? 0.8
                : i === 0 || i === headerRows
                  ? 1
                  : (!!f.opening && i === headerRows + 1) || (grouped && i === 1)
                    ? 0.5
                    : 0,
          vLineWidth: () => 0.5,
          hLineColor: () => BLACK,
          vLineColor: () => BLACK,
          paddingLeft: () => (grouped ? 2 : 3),
          paddingRight: () => (grouped ? 2 : 3),
          // Roomier rows: the larger type needs the leading, and it stops the
          // figure columns reading as a solid block. Headings get a touch more.
          paddingTop: () => 4,
          paddingBottom: () => 4,
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
          factLine([['Oldest unpaid', k.invDueFrom]]),
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
    { header: 'St', width: 6, align: 'center', get: (r) => (r.status === 'P' && r.pendingSide ? `P(${r.pendingSide})` : r.status || '') },
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

  // Opening/Closing are withheld under a voucher-type filter (see PartyLedgerFooter).
  if (res.footer.opening) balanceRow('Opening Balance', res.footer.opening, false);
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
  balanceRow('Current Total', res.footer.current, !res.footer.closing);
  if (res.footer.closing) balanceRow('Closing Balance', res.footer.closing, true);

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
