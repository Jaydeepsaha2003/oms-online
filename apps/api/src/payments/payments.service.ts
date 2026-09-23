import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type ChequeOptionRow,
  type BulkDeletePaymentResult,
  type DeletePaymentResult,
  type DueType,
  type EditPaymentResult,
  type LedgerEntryDto,
  type Paginated,
  type PartyAdvanceSummary,
  type PaymentAllocation,
  type PaymentContext,
  type PendingAdvanceRow,
  type PendingInvoiceRow,
  type SameDayReceiptDto,
  type OpeningPendingRow,
  type SavePaymentResult,
  type PayBucket,
  classifyDueType,
  payBucketOf,
  payByFor,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EditPaymentDto, LedgerQueryDto, PaymentContextQueryDto, SavePaymentDto } from './dto/payment.dto';

const r2 = (x: number) => Math.round(x * 100) / 100;
const EPS = 0.005;
/** `settings` key holding the last receipt number ever issued. */
const RECEIPT_SEQ_KEY = 'payments.lastReceiptNo';
/** BANK and CHEQUE receipts settle the bank bucket; CASH settles the cash bucket.
 *  Defers to the shared rule so the bucket a receipt lands in and the bucket a
 *  party's routing is judged on can never disagree. */
const isBankMode = (m: string) => payBucketOf(m) === 'bank';
const BANK_MODES = ['BANK', 'CHEQUE'];
const referenceTokens = (value: string | null | undefined) => (value?.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean) ?? []);

/** Calendar day on this server's clock. Imported rows sit at UTC midnight and
 *  typed ones at local midnight; both fall on the same day here. */
const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const nextDay = (d: Date) => {
  const n = new Date(dayOf(d));
  n.setDate(n.getDate() + 1);
  return n;
};
/**
 * The order receipts settle bills in: the money that arrived first pays the
 * oldest bill first, whatever order the receipts were typed in. The same day
 * goes in entry order.
 */
const byArrival = (a: { transDate: Date; id: number }, b: { transDate: Date; id: number }) =>
  dayOf(a.transDate) - dayOf(b.transDate) || a.id - b.id;

/** Per invoice, the bank/cash amount set aside for named (AGST REF) receipts. */
type Reserved = Map<string, { bank: number; cash: number }>;
/** The same, kept per named voucher so each one's hold can be released as it replays. */
type Claims = Map<string, Reserved>;

/** Far enough ahead to mean "every open bill". */
const FAR = new Date(2999, 11, 31);

/** One receipt as the exact-amount search sees it. */
interface Entry {
  voucherNo: string;
  transDate: Date;
  adjMode: string;
  payMode: string;
  amount: number;
}
const entryOf = (r: LedgerRow): Entry => ({
  voucherNo: r.voucherNo,
  transDate: r.transDate,
  adjMode: r.adjMode ?? '',
  payMode: r.transMode,
  amount: r.bankCredit || r.cashCredit,
});

/**
 * The bills a payment's amount names: one bill, a run of consecutive bills, or
 * any two bills whose open amounts add up to it (within ₹1). Searched oldest
 * first; null when nothing fits, and the payment then settles oldest-first as
 * usual. Wider combinations are deliberately not tried: among many small bills
 * some mix matches almost any amount by chance, which would scatter payments.
 */
function findExact<T extends { bal: number }>(open: T[], amount: number): T[] | null {
  // A round figure (₹19,000, ₹50,000) is money on account, not a payment for
  // particular bills — bills carry odd amounts, so a round sum of them is chance.
  // METRO METALS' ₹19,000 matched 7,790 + 11,210 and skipped six older bills.
  // ponytail: a bill that is itself exactly round now settles oldest-first; use AGST REF for it.
  if (amount % 1000 === 0) return null;
  const TOL = 1;
  for (let i = 0; i < open.length; i++) {
    let sum = 0;
    for (let j = i; j < open.length; j++) {
      sum = r2(sum + open[j].bal);
      if (Math.abs(sum - amount) <= TOL) return open.slice(i, j + 1);
      if (sum > amount + TOL) break;
    }
  }
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 2; j < open.length; j++) if (Math.abs(open[i].bal + open[j].bal - amount) <= TOL) return [open[i], open[j]];
  }
  return null;
}

function reservedFrom(claims: Claims): Reserved {
  const out: Reserved = new Map();
  for (const held of claims.values()) {
    for (const [inv, h] of held) {
      const cur = out.get(inv) ?? { bank: 0, cash: 0 };
      out.set(inv, { bank: r2(cur.bank + h.bank), cash: r2(cur.cash + h.cash) });
    }
  }
  return out;
}

function parseDay(s: string | undefined, label: string): Date {
  const d = s ? new Date(s) : new Date();
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} is not valid.`);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** DUE TYPE (shared canonical rule) + the legacy DUE DAYS text. The bucket now
 *  comes from `classifyDueType` so this screen and the Party Ledger can never
 *  drift apart on what counts as overdue / past due / normal. */
function dueTypeOf(invDate: Date, dueDate: Date | null, today: Date): { dueType: DueType; dueDays: string } {
  if (!dueDate) return { dueType: 'NORMAL', dueDays: '—' };
  const daysLeft = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);
  const dueDays = daysLeft > 0 ? `${daysLeft} LEFT` : daysLeft === 0 ? 'TODAY' : `${Math.abs(daysLeft)} OVER`;
  return { dueType: classifyDueType(invDate, dueDate, today), dueDays };
}

/** The prisma delegate set usable both from the service root and inside $transaction. */
type Db = Prisma.TransactionClient;

/** One saved voucher, as stored — the unit an edit/delete reverses and replays. */
type LedgerRow = Prisma.AcctLedgerGetPayload<object>;

/** The corrected figures an edit applies to its own target voucher. Every other
 *  voucher in the replay chain (and every voucher during a delete) replays with
 *  no override, i.e. exactly as it was originally recorded. */
interface ReplayOverride {
  recDate: Date;
  payMode: string;
  bankName: string | null;
  chequeNo: string | null;
  cashLoc: string | null;
  cashBy: string | null;
  remarks: string | null;
  receiptAmt: number;
  editedAt: Date;
  editedByName: string | null;
}

/** Everything {@link PaymentsService.runWaterfall} needs to create one voucher.
 *  `receiptRefId`/`advanceRefId` are REUSED when non-null (an edit's replay),
 *  else generated on first actual need (a fresh save). `createdAt` is likewise
 *  only set on a replay, to preserve the voucher's original entry time. */
interface WaterfallParams {
  voucherNo: string;
  receiptRefId: string | null;
  advanceRefId: string | null;
  recDate: Date;
  customers: { id: number; name: string; payBy: string | null }[];
  isAgent: boolean;
  agentName: string | null;
  headName: string;
  headId: number;
  payMode: string;
  bankName: string | null;
  bankRef: string | null;
  chequeNo: string | null;
  cashLoc: string | null;
  cashBy: string | null;
  remarks: string | null;
  adjMode: string;
  selectedInvNos: string[] | undefined;
  receiptAmt: number;
  userName?: string | null;
  editedAt: Date | null;
  editedByName: string | null;
  sourceKey: string | null;
  createdAt: Date | null;
  /** Bills held for named receipts that settle later; an AUTOMATIC receipt skips them. */
  reserved?: Reserved;
  /** Bills this receipt's exact amount names (see findExact): settled first, ahead of the opening. */
  claimed?: Reserved;
  /** A replay re-creates what was already saved, so it must not refuse on input rules. */
  replay?: boolean;
}

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /* ── Pending context (grid + labels + KPI source) ─────────────────────────── */

  async context(q: PaymentContextQueryDto): Promise<PaymentContext> {
    const recDate = parseDay(q.recDate, 'Receipt date');
    // Which parties are reachable depends on the bucket being collected, so the
    // screen sends its pay mode and the list changes with it.
    const bucket = payBucketOf(q.payMode);
    const customers = await this.resolveCustomers(this.prisma, q.customerId ?? null, q.agentName ?? null, bucket);
    // A back-dated receipt settles ahead of the later-dated ones (see save), so
    // show the bills as they stood before those later receipts touched them.
    const later = await this.chainAfter(this.prisma, q.customerId ?? 0, q.customerId != null ? null : (q.agentName ?? null), recDate);
    const skip = new Set(later.map((r) => r.voucherNo));
    const [invoices, advances, openings, sameDayReceipts, today] = await Promise.all([
      this.invoicePending(this.prisma, customers, recDate, skip),
      this.advancePending(this.prisma, customers, recDate, skip),
      this.openingPending(this.prisma, customers, skip),
      this.receiptsOn(recDate, q.customerId ?? null, q.agentName ?? null),
      // Same bills with the later receipts counted — what is actually owed now.
      later.length ? this.invoicePending(this.prisma, customers, recDate) : null,
    ]);
    return {
      customers: customers.map((c) => ({ customerId: c.id, customerName: c.name })),
      invoices,
      advances,
      openings,
      sameDayReceipts,
      // Only this leg's money: a cash entry is not overstated by later bank receipts.
      laterReceipts: later
        .map((r) => ({
          voucherNo: r.voucherNo,
          recDate: r.transDate.toISOString(),
          amount: r2(bucket === 'cash' ? r.cashCredit : r.bankCredit),
        }))
        .filter((r) => r.amount > EPS),
      pendingToday: today && {
        invoiceBank: r2(today.reduce((a, i) => a + i.bankBal, 0)),
        invoiceCash: r2(today.reduce((a, i) => a + i.cashBal, 0)),
      },
      totals: {
        invoiceBank: r2(invoices.reduce((a, i) => a + i.bankBal, 0)),
        invoiceCash: r2(invoices.reduce((a, i) => a + i.cashBal, 0)),
        advanceBank: r2(advances.reduce((a, i) => a + i.bankBal, 0)),
        advanceCash: r2(advances.reduce((a, i) => a + i.cashBal, 0)),
        openingBank: r2(openings.reduce((a, i) => a + i.pendingBank, 0)),
        openingCash: r2(openings.reduce((a, i) => a + i.pendingCash, 0)),
      },
    };
  }

  /**
   * Every party (or agent) currently sitting on an outstanding advance —
   * across the whole book, not scoped to one customer/agent like `context()`.
   * The "who's paid in advance" quick-glance view.
   */
  async allAdvances(): Promise<PartyAdvanceSummary[]> {
    const advs = await this.prisma.acctPartyAdvance.findMany({ orderBy: [{ recDate: 'asc' }, { refId: 'asc' }] });
    if (!advs.length) return [];
    const used = await this.prisma.acctPaymentReceipt.groupBy({
      by: ['refRecId', 'payMode'],
      where: { refRecId: { in: advs.map((a) => a.refId) } },
      _sum: { recAmt: true },
    });
    const usedBank = new Map<string, number>();
    const usedCash = new Map<string, number>();
    for (const u of used) {
      const m = BANK_MODES.includes(u.payMode) ? usedBank : usedCash;
      m.set(u.refRecId ?? '', r2((m.get(u.refRecId ?? '') ?? 0) + (u._sum.recAmt ?? 0)));
    }

    // Group by party (custId) or, for AGENT-level advances, by agent name —
    // AGENT advances all share custId = 0, so grouping on that alone would
    // wrongly merge every agent's advances together.
    const byKey = new Map<string, PartyAdvanceSummary>();
    for (const a of advs) {
      const bankBal = Math.max(0, r2(a.bankAmt - (usedBank.get(a.refId) ?? 0)));
      const cashBal = Math.max(0, r2(a.cashAmt - (usedCash.get(a.refId) ?? 0)));
      if (bankBal <= EPS && cashBal <= EPS) continue;
      const isAgent = a.takeAccOn === 'AGENT';
      const key = isAgent ? `agent:${a.customerName}` : `party:${a.custId}`;
      const recIso = a.recDate.toISOString();
      const cur = byKey.get(key);
      if (cur) {
        cur.bankBal = r2(cur.bankBal + bankBal);
        cur.cashBal = r2(cur.cashBal + cashBal);
        cur.total = r2(cur.total + bankBal + cashBal);
        cur.refCount += 1;
        if (recIso < cur.oldestDate) cur.oldestDate = recIso;
      } else {
        byKey.set(key, {
          customerId: isAgent ? null : a.custId,
          customerName: a.customerName,
          agentName: a.agentName,
          takeAccOn: a.takeAccOn,
          bankBal,
          cashBal,
          total: r2(bankBal + cashBal),
          oldestDate: recIso,
          refCount: 1,
        });
      }
    }
    return [...byKey.values()].sort((x, y) => y.total - x.total);
  }

  /** CLEARED cheques of the party with un-received balance (CHEQUE mode picker). */
  async chequeOptions(customerId: number): Promise<ChequeOptionRow[]> {
    const cheques = await this.prisma.cheque.findMany({
      where: { customerId, status: 'CLEARED' },
      orderBy: [{ acctTransDate: 'asc' }, { id: 'asc' }],
    });
    if (!cheques.length) return [];
    const used = await this.prisma.acctPaymentReceipt.groupBy({
      by: ['chequeNo'],
      where: { custId: customerId, chequeNo: { in: cheques.map((c) => c.chequeNo) } },
      _sum: { recAmt: true },
    });
    const usedBy = new Map(used.map((u) => [u.chequeNo ?? '', u._sum.recAmt ?? 0]));
    return cheques
      .map((c) => ({
        chequeNo: c.chequeNo,
        bankName: c.drawerBank,
        balance: r2(c.chequeAmt - (usedBy.get(c.chequeNo) ?? 0)),
        comments: c.comments,
      }))
      .filter((c) => c.balance > EPS);
  }

  /**
   * Whether each of these RECEIPT rows can be edited — false once any LATER
   * voucher for the same party/agent group predates edit support (adjMode
   * null), since that later voucher can't be safely replayed. Grouped so one
   * "how far back does this party's edit-support boundary go" query covers
   * every row in the page for that party, rather than one query per row.
   */
  private async editabilityFor(
    rows: { id: number; voucherType: string; custId: number; agentName: string | null; adjMode: string | null }[],
  ): Promise<Map<number, boolean>> {
    const receiptRows = rows.filter((r) => r.voucherType === 'RECEIPT');
    if (!receiptRows.length) return new Map();
    const groupKey = (r: { custId: number; agentName: string | null }) => (r.custId !== 0 ? `c:${r.custId}` : `a:${r.agentName}`);
    const groups = new Map<string, { custId: number; agentName: string | null }>();
    for (const r of receiptRows) groups.set(groupKey(r), { custId: r.custId, agentName: r.agentName });

    const cutoffs = new Map<string, number>(); // group key -> highest id with adjMode null (0 = none)
    await Promise.all(
      [...groups.entries()].map(async ([key, g]) => {
        const blocker = await this.prisma.acctLedger.findFirst({
          where: { voucherType: 'RECEIPT', adjMode: null, custId: g.custId, ...(g.custId === 0 ? { agentName: g.agentName } : {}) },
          orderBy: { id: 'desc' },
          select: { id: true },
        });
        cutoffs.set(key, blocker?.id ?? 0);
      }),
    );

    const out = new Map<number, boolean>();
    for (const r of receiptRows) out.set(r.id, r.adjMode != null && r.id > (cutoffs.get(groupKey(r)) ?? 0));
    return out;
  }

  /** Voucher history for the Receipt Ledger browser (party or agent). */
  async ledger(q: LedgerQueryDto): Promise<Paginated<LedgerEntryDto>> {
    const and: Prisma.AcctLedgerWhereInput[] = [];
    if (q.customerId != null) and.push({ custId: q.customerId });
    if (q.agentName?.trim()) and.push({ agentName: q.agentName.trim() });
    if (q.dateFrom) and.push({ transDate: { gte: parseDay(q.dateFrom, 'From date') } });
    if (q.dateTo) {
      const to = parseDay(q.dateTo, 'To date');
      to.setHours(23, 59, 59, 999);
      and.push({ transDate: { lte: to } });
    }
    /*
     * Bank / Cash filter, applied to the AMOUNT columns rather than to
     * `transMode`.
     *
     * That is deliberate. `transMode` records how the money arrived (BANK,
     * CHEQUE, CASH), but the table shows BANK CR and CASH CR — so filtering on
     * the mode would hide a voucher whose money genuinely sits in the column the
     * user asked for. A cheque lands on the bank side, and a split voucher has
     * real amounts on BOTH sides and correctly appears under either filter.
     */
    const mode = (q.mode ?? '').trim().toUpperCase();
    if (mode === 'B') and.push({ bankCredit: { gt: 0 } });
    else if (mode === 'C') and.push({ cashCredit: { gt: 0 } });

    const search = q.search?.trim();
    if (search) and.push({ OR: [{ voucherNo: { contains: search } }, { customerName: { contains: search } }, { particulars: { contains: search } }, { bankRef: { contains: search } }] });
    const where: Prisma.AcctLedgerWhereInput = and.length ? { AND: and } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.acctLedger.findMany({ where, orderBy: [{ transDate: 'desc' }, { id: 'desc' }], skip: q.skip, take: q.pageSize }),
      this.prisma.acctLedger.count({ where }),
    ]);
    const editability = await this.editabilityFor(rows);
    return {
      items: rows.map((r) => ({
        id: r.id,
        voucherNo: r.voucherNo,
        transDate: r.transDate.toISOString(),
        customerName: r.customerName,
        customerId: r.custId,
        agentName: r.agentName,
        particulars: r.particulars,
        voucherType: r.voucherType,
        transMode: r.transMode,
        bankCredit: r.bankCredit,
        cashCredit: r.cashCredit,
        transRemarks: r.transRemarks,
        userName: r.userName,
        createdAt: r.createdAt.toISOString(),
        bankName: r.bankName,
        bankRef: r.bankRef,
        chequeNo: r.chequeNo,
        cashTransLocation: r.cashTransLocation,
        cashRecBy: r.cashRecBy,
        editable: editability.get(r.id) ?? false,
        editedAt: r.editedAt ? r.editedAt.toISOString() : null,
        editedByName: r.editedByName,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  /* ── Save (the legacy BtnSave waterfall, in one transaction) ──────────────── */

  /** Shared field validation for both a fresh save and an edit's new figures —
   *  mirrors the legacy ValidateBeforeSave messages, in order. */
  private validateFigures(input: {
    payMode: string;
    receiptAmt: number;
    bankName?: string | null;
    chequeNo?: string | null;
    cashTransLocation?: string | null;
    cashRecBy?: string | null;
    recDate: string;
  }): { receiptAmt: number; recDate: Date } {
    if (!['BANK', 'CHEQUE', 'CASH'].includes(input.payMode)) throw new BadRequestException('Please select Payment Mode (BANK / CHEQUE / CASH).');
    const receiptAmt = r2(input.receiptAmt);
    if (!Number.isFinite(receiptAmt) || receiptAmt <= 0) throw new BadRequestException('Receipt Amount must be greater than 0.');
    if (isBankMode(input.payMode) && !input.bankName?.trim()) throw new BadRequestException('Please select a Bank Name.');
    if (input.payMode === 'CHEQUE' && !input.chequeNo?.trim()) throw new BadRequestException('Please select / enter Cheque No.');
    if (input.payMode === 'CASH' && !input.cashTransLocation?.trim()) throw new BadRequestException('Please enter Cash Transfer Location.');
    if (input.payMode === 'CASH' && !input.cashRecBy?.trim()) throw new BadRequestException('Please enter Cash Received By.');
    const recDate = parseDay(input.recDate, 'Receipt date');
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (recDate.getTime() > today.getTime()) throw new BadRequestException('Receipt date cannot be in the future.');
    return { receiptAmt, recDate };
  }

  async save(dto: SavePaymentDto, userName?: string | null, transaction?: Db, internalSourceKey?: string): Promise<SavePaymentResult> {
    const isAgent = dto.takeAccOn === 'AGENT';
    if (isAgent ? !dto.agentName?.trim() : dto.customerId == null) {
      throw new BadRequestException('Please select either Customer / Party Name or Agent Name.');
    }
    if (dto.adjMode === 'AGST REF' && !(dto.selectedInvNos?.length ?? 0)) {
      throw new BadRequestException('AGST REF mode requires selecting at least one invoice.');
    }
    const { receiptAmt, recDate } = this.validateFigures(dto);

    const bankName = dto.bankName?.trim().toUpperCase() || null;
    const bankRef = dto.payMode === 'BANK' ? dto.bankRef?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || null : null;
    if (bankRef && bankRef.length < 6) throw new BadRequestException('Bank UTR / Reference must contain at least 6 letters or numbers.');
    const chequeNo = dto.payMode === 'CHEQUE' ? dto.chequeNo?.trim().toUpperCase() || null : null;
    const cashLoc = dto.payMode === 'CASH' ? dto.cashTransLocation?.trim().toUpperCase() || null : null;
    const cashBy = dto.payMode === 'CASH' ? dto.cashRecBy?.trim().toUpperCase() || null : null;
    const remarks = dto.remarks?.trim().toUpperCase() || null;
    const sourceKey = internalSourceKey ?? (dto.requestId ? `RECEIVE_PAYMENT:${dto.requestId}` : null);

    const save = async (tx: Db) => {
      if (sourceKey) {
        const prior = await tx.acctLedger.findUnique({ where: { sourceKey }, select: { voucherNo: true } });
        if (prior) throw new ConflictException(`This request was already saved as ${prior.voucherNo}. No second receipt was created.`);
      }
      if (bankRef) {
        let prior = await tx.acctLedger.findUnique({ where: { bankRef }, select: { voucherNo: true, customerName: true } });
        // Receipts created before `bankRef` existed still carry the UTR in the
        // immutable bank-statement audit remark. Honour those too, otherwise a
        // historical transfer could be re-entered after this migration.
        if (!prior) {
          const historical = await tx.acctLedger.findMany({
            where: { voucherType: 'RECEIPT', transMode: 'BANK', bankRef: null, transRemarks: { contains: bankRef } },
            select: { voucherNo: true, customerName: true, transRemarks: true },
          });
          prior = historical.find((row) => referenceTokens(row.transRemarks).includes(bankRef)) ?? null;
        }
        if (!prior) {
          // Some legacy receipts were entered manually and only later matched
          // to a statement. In that case the UTR belongs to the linked statement
          // row, while the receipt itself has neither `bankRef` nor a remark.
          const statementRows = await tx.bankStatementRow.findMany({
            where: {
              status: { in: ['MATCHED', 'PARTIAL', 'POSTED'] },
              OR: [{ refNo: { contains: bankRef } }, { narration: { contains: bankRef } }],
            },
            select: { refNo: true, narration: true, postedRef: true, matchedRefs: true },
          });
          const linked = statementRows.find((row) => referenceTokens(row.refNo).includes(bankRef) || referenceTokens(row.narration).includes(bankRef));
          if (linked?.postedRef) {
            prior = await tx.acctLedger.findFirst({ where: { voucherType: 'RECEIPT', voucherNo: linked.postedRef }, select: { voucherNo: true, customerName: true } });
          }
          if (!prior && linked?.matchedRefs) {
            const refs = linked.matchedRefs.split(',').map((ref) => ref.trim()).filter(Boolean);
            const voucherNos = refs.filter((ref) => ref.startsWith('VOUCHER:')).map((ref) => ref.slice('VOUCHER:'.length));
            prior = await tx.acctLedger.findFirst({
              where: {
                voucherType: 'RECEIPT',
                OR: [
                  { receiptRefId: { in: refs } },
                  { advanceRefId: { in: refs } },
                  ...(voucherNos.length ? [{ voucherNo: { in: voucherNos } }] : []),
                ],
              },
              select: { voucherNo: true, customerName: true },
            });
          }
        }
        if (prior) throw new ConflictException(`Bank reference ${bankRef} is already recorded as ${prior.voucherNo} for ${prior.customerName}.`);
      }
      const customers = await this.resolveCustomers(tx, isAgent ? null : (dto.customerId ?? null), isAgent ? (dto.agentName ?? null) : null, payBucketOf(dto.payMode));
      const agentName = isAgent ? dto.agentName!.trim() : null;
      const headName = isAgent ? agentName! : customers[0].name;
      const headId = isAgent ? 0 : customers[0].id;
      // A person's own save must explicitly confirm same-day duplicates. An
      // internal transaction (bank reconciliation) instead relies on its fresh
      // global rematch, unique UTR and unique source-row key.
      if (!transaction) {
        await this.assertNotDuplicateReceipt(tx, { headId, agentName, payMode: dto.payMode, chequeNo, receiptAmt, recDate, confirmed: dto.confirmDuplicate === true });
      }
      const voucherNo = await this.nextVoucherNo(tx);

      // Back-dated: the party's later-dated receipts come out, this one settles
      // first, and they go back in date order. A legacy receipt among them
      // cannot be replayed, so then it simply settles what is left, as before.
      let later = await this.chainAfter(tx, headId, agentName, recDate);
      // An exact amount can name a bill an older unnamed receipt already took;
      // those older receipts then settle again around it.
      let earlier = dto.adjMode === 'AUTOMATIC' ? await this.holdersOfExact(tx, customers, headId, agentName, recDate, receiptAmt, dto.payMode) : [];
      if ([...earlier, ...later].some((r) => r.adjMode == null)) (earlier = []), (later = []);
      const claims = await this.claimsOf(tx, [...earlier, ...later]);
      await this.reverseChain(tx, [...earlier, ...later]);
      const fresh: Entry = { voucherNo, transDate: recDate, adjMode: dto.adjMode, payMode: dto.payMode, amount: receiptAmt };
      await this.claimExact(tx, headId, agentName, [...earlier.map(entryOf), fresh, ...later.map(entryOf)], claims, earlier.length ? voucherNo : undefined);
      await this.replayInOrder(tx, earlier, claims);
      const own = claims.get(voucherNo);
      claims.delete(voucherNo);

      const result = await this.runWaterfall(tx, {
        voucherNo,
        receiptRefId: null,
        advanceRefId: null,
        recDate,
        customers,
        isAgent,
        agentName,
        headName,
        headId,
        payMode: dto.payMode,
        bankName,
        bankRef,
        chequeNo,
        cashLoc,
        cashBy,
        remarks,
        adjMode: dto.adjMode,
        selectedInvNos: dto.selectedInvNos,
        receiptAmt,
        userName: userName ?? null,
        editedAt: null,
        editedByName: null,
        sourceKey,
        createdAt: null,
        reserved: reservedFrom(claims),
        claimed: own,
      });
      await this.replayInOrder(tx, later, claims);
      await this.applyOnAccount(tx, headId);
      return result;
    };
    // Bank reconciliation includes its statement-row update in the same
    // transaction. Ordinary Receive Payment retains its own transaction.
    return transaction ? save(transaction) : this.prisma.$transaction(save);
  }

  /**
   * Correct an already-saved receipt's amount/date/mode/remarks. WHO it was
   * taken from and HOW it was adjusted (adjMode, ticked invoices) are kept
   * exactly as originally recorded — only the figures change.
   *
   * A receipt's amount doesn't live in one place: it can fund old-advance
   * clearances, invoice allocations and a new advance spill, and every LATER
   * receipt for the same party/agent computed its own allocation off the
   * balances this one left behind. So editing this voucher means reversing it
   * AND every later voucher for the same party/agent (the only ones whose
   * numbers could actually depend on it), then replaying them in original
   * order — the target with the corrected figures, everything after it exactly
   * as it was. Voucher numbers and REC-/ADV- ref ids are always reused, never
   * regenerated, so nothing referencing them elsewhere goes stale.
   *
   * Only possible when this voucher — and everything in its replay chain — was
   * itself saved with enough captured detail to reconstruct (adjMode non-null;
   * see the AcctLedger columns added for this). Receipts saved before edit
   * support existed can't be edited.
   *
   * Known scope limit: the replay chain is matched by custId (PARTY) or
   * agentName (AGENT) on the ledger row, which only follows a customer through
   * receipts taken the SAME way. A customer who normally pays directly but was
   * later swept into an AGENT-mode receipt for their agent — after the voucher
   * being edited — won't have that agent voucher caught by this chain.
   */
  async editReceipt(id: number, dto: EditPaymentDto, userName?: string | null): Promise<EditPaymentResult> {
    const target = await this.prisma.acctLedger.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Receipt not found.');
    if (target.voucherType !== 'RECEIPT') throw new BadRequestException('Only a receipt voucher can be edited here.');
    if (target.adjMode == null) throw new BadRequestException('This receipt predates edit support and cannot be edited.');

    const { receiptAmt, recDate } = this.validateFigures(dto);
    const bankName = dto.bankName?.trim().toUpperCase() || null;
    const chequeNo = dto.payMode === 'CHEQUE' ? dto.chequeNo?.trim().toUpperCase() || null : null;
    const cashLoc = dto.payMode === 'CASH' ? dto.cashTransLocation?.trim().toUpperCase() || null : null;
    const cashBy = dto.payMode === 'CASH' ? dto.cashRecBy?.trim().toUpperCase() || null : null;
    const remarks = dto.remarks?.trim().toUpperCase() || null;

    return this.prisma.$transaction(async (tx) => {
      const chain = await this.loadReplayChain(tx, target, 'edited', recDate);
      const claims = await this.claimsOf(tx, chain);
      await this.reverseChain(tx, chain);
      const entries = chain.map((r) => (r.id === target.id ? { ...entryOf(r), transDate: recDate, payMode: dto.payMode, amount: receiptAmt } : entryOf(r)));
      await this.claimExact(tx, target.custId, target.agentName, entries, claims);

      // Replay each voucher in original order — the target with the corrected
      // figures, everything after it exactly as it was originally recorded.
      const corrected: ReplayOverride = {
        recDate,
        payMode: dto.payMode,
        bankName,
        chequeNo,
        cashLoc,
        cashBy,
        remarks,
        receiptAmt,
        editedAt: new Date(),
        editedByName: userName ?? null,
      };
      await this.replayInOrder(tx, chain, claims, { id: target.id, data: corrected });
      await this.applyOnAccount(tx, target.custId);

      return { voucherNo: target.voucherNo, replayedCount: chain.length - 1 };
    });
  }

  /**
   * Remove an already-saved receipt, putting every balance back exactly where it
   * would have been had the receipt never been entered.
   *
   * Deleting is the same problem as editing (see {@link editReceipt}): the money
   * is spread across opening clearances, invoice allocations and an advance
   * spill, and every LATER receipt for the same party/agent allocated itself
   * against the balances this one left behind. So it reuses the same machinery —
   * reverse this voucher and every later one, then replay them all EXCEPT this
   * one. Not replaying it is what makes it a delete, and replaying the rest is
   * what re-points them at the invoices they should have paid all along.
   *
   * The same scope limit and edit-support requirement as `editReceipt` apply.
   */
  async deleteReceipt(id: number): Promise<DeletePaymentResult> {
    const target = await this.prisma.acctLedger.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Receipt not found.');
    if (target.voucherType !== 'RECEIPT') throw new BadRequestException('Only a receipt voucher can be deleted here.');
    if (target.adjMode == null) throw new BadRequestException('This receipt predates edit support and cannot be deleted.');

    // Tally Reconciliation stamps the voucher it created onto the report row and
    // then refuses to enter that row again. Deleting the voucher out from under
    // that stamp would strand the row as "already entered as RN/x" against a
    // receipt that no longer exists — and since voucher numbers are max+1 over
    // live rows, the number could later be handed to an unrelated receipt.
    const reconciled = await this.prisma.tallyReconRow.findFirst({
      where: { resolvedRef: target.voucherNo },
      select: { id: true },
    });
    if (reconciled) {
      throw new BadRequestException(
        `${target.voucherNo} was entered from Tally Reconciliation. Reset that row in the reconciliation report first, then delete this receipt.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const chain = await this.loadReplayChain(tx, target, 'deleted');
      const rest = chain.filter((row) => row.id !== target.id); // not replaying it IS the delete
      const claims = await this.claimsOf(tx, rest);
      await this.reverseChain(tx, chain);
      await this.claimExact(tx, target.custId, target.agentName, rest.map(entryOf), claims);
      await this.replayInOrder(tx, rest, claims);
      await this.applyOnAccount(tx, target.custId);
      return { voucherNo: target.voucherNo, replayedCount: rest.length };
    });
  }

  /**
   * Remove several receipts in one transaction.
   *
   * Deliberately NOT a loop over {@link deleteReceipt}. That would reverse and
   * replay the party's whole later-receipt chain once per target — five deletes
   * meaning five full replays of the same rows — and it would not be atomic: a
   * failure partway leaves some receipts gone, the others standing, and the
   * party's allocations rebuilt around a state nobody chose.
   *
   * Instead the targets are grouped by the chain they belong to (party, or agent
   * where there is no party), each group's chain is loaded ONCE from its
   * earliest target, reversed once, and every row replayed except the targets.
   * Not replaying them IS the delete — the same mechanism as the single case, so
   * the arithmetic cannot differ between deleting one and deleting five.
   *
   * Every target is validated BEFORE anything is written. A set that contains
   * one undeletable receipt fails whole, with a message naming it, rather than
   * deleting the four that were fine and leaving the user to work out which
   * one didn't go.
   */
  async deleteReceipts(ids: number[]): Promise<BulkDeletePaymentResult> {
    const unique = [...new Set(ids)];
    if (!unique.length) throw new BadRequestException('Pick at least one receipt to delete.');

    const targets = await this.prisma.acctLedger.findMany({ where: { id: { in: unique } } });
    if (targets.length !== unique.length) {
      throw new BadRequestException('One of those receipts no longer exists — reload the list and try again.');
    }
    for (const t of targets) {
      if (t.voucherType !== 'RECEIPT') throw new BadRequestException(`${t.voucherNo} is not a receipt, so it cannot be deleted here.`);
      if (t.adjMode == null) throw new BadRequestException(`${t.voucherNo} predates edit support and cannot be deleted.`);
    }

    // Same guard as the single delete, asked once for the whole set: a voucher
    // entered from Tally Reconciliation is stamped on that report's row, and
    // deleting it would strand the row against a receipt that no longer exists.
    const reconciled = await this.prisma.tallyReconRow.findFirst({
      where: { resolvedRef: { in: targets.map((t) => t.voucherNo) } },
      select: { resolvedRef: true },
    });
    if (reconciled) {
      throw new BadRequestException(
        `${reconciled.resolvedRef} was entered from Tally Reconciliation. Reset that row in the reconciliation report first, then delete these receipts.`,
      );
    }

    /*
     * Group by the chain each target belongs to.
     *
     * `loadReplayChain` keys on custId, falling back to agentName for an
     * agent-level voucher (custId 0) — so the group key has to be the same
     * thing, or two targets in one chain would each drag that chain through a
     * separate reverse-and-replay.
     */
    const groups = new Map<string, LedgerRow[]>();
    for (const t of targets) {
      const key = t.custId !== 0 ? `c:${t.custId}` : `a:${t.agentName ?? ''}`;
      const list = groups.get(key);
      if (list) list.push(t);
      else groups.set(key, [t]);
    }

    const targetIds = new Set(targets.map((t) => t.id));
    return this.prisma.$transaction(async (tx) => {
      const deleted: string[] = [];
      let replayedCount = 0;
      for (const members of groups.values()) {
        // The EARLIEST target anchors the chain: everything from there on could
        // depend on it, and everything before it is untouched by the delete.
        const earliest = members.reduce((a, b) => (byArrival(a, b) <= 0 ? a : b));
        const chain = await this.loadReplayChain(tx, earliest, 'deleted');
        deleted.push(...chain.filter((row) => targetIds.has(row.id)).map((row) => row.voucherNo));
        const rest = chain.filter((row) => !targetIds.has(row.id)); // not replaying them IS the delete
        const claims = await this.claimsOf(tx, rest);
        await this.reverseChain(tx, chain);
        await this.claimExact(tx, earliest.custId, earliest.agentName, rest.map(entryOf), claims);
        await this.replayInOrder(tx, rest, claims);
        await this.applyOnAccount(tx, earliest.custId);
        replayedCount += rest.length;
      }
      return { deleted, replayedCount };
    });
  }

  /**
   * This voucher plus every RECEIPT for the same party (custId) or agent group
   * (agentName) that settles after it in arrival order — the set whose
   * allocations could depend on it, and so the set that has to be reversed and
   * replayed together, in arrival order. An edit that moves the date starts
   * from whichever of the two dates is earlier, and sorts the target at its
   * new date. Throws when any member predates edit support, since it could not
   * be faithfully replayed.
   */
  private async loadReplayChain(tx: Db, target: LedgerRow, verb: 'edited' | 'deleted', newDate?: Date): Promise<LedgerRow[]> {
    const anchor = Math.min(dayOf(target.transDate), dayOf(newDate ?? target.transDate));
    const rows = await tx.acctLedger.findMany({
      where: {
        voucherType: 'RECEIPT',
        transDate: { gte: new Date(anchor) },
        ...(target.custId !== 0 ? { custId: target.custId } : { agentName: target.agentName }),
      },
    });
    // Same-day receipts typed before this one settle before it and are untouched.
    const at = (r: LedgerRow) => (r.id === target.id && newDate ? { transDate: newDate, id: r.id } : r);
    const chain = rows
      .filter((r) => r.id === target.id || dayOf(r.transDate) > anchor || r.id > target.id)
      .sort((a, b) => byArrival(at(a), at(b)));
    const blocker = chain.find((row) => row.adjMode == null);
    if (blocker) {
      throw new BadRequestException(
        blocker.id === target.id
          ? `This receipt predates edit support and cannot be ${verb}.`
          : `Receipt ${blocker.voucherNo} (saved after this one, for the same party/agent) predates edit support — this receipt can't be safely ${verb} until then.`,
      );
    }
    return chain;
  }

  /** The party's (or agent group's) receipts dated after `recDate`, in arrival order. */
  private async chainAfter(db: Db, headId: number, agentName: string | null, recDate: Date): Promise<LedgerRow[]> {
    if (headId === 0 && !agentName) return [];
    const rows = await db.acctLedger.findMany({
      where: { voucherType: 'RECEIPT', transDate: { gte: nextDay(recDate) }, ...(headId !== 0 ? { custId: headId } : { agentName }) },
    });
    return rows.sort(byArrival);
  }

  /**
   * What each named (AGST REF) receipt in `rows` currently holds, per invoice
   * and bucket. While the chain replays, an AUTOMATIC receipt must leave those
   * amounts alone: the party said which bill that money was for, so an older
   * unnamed receipt settling first must not take it.
   */
  private async claimsOf(tx: Db, rows: LedgerRow[]): Promise<Claims> {
    const named = new Set(rows.filter((r) => r.adjMode === 'AGST REF').map((r) => r.voucherNo));
    const claims: Claims = new Map();
    if (!named.size) return claims;
    const allocs = await tx.acctPaymentReceipt.findMany({
      where: { recType: 'RECEIPT', OR: [{ sourceVoucherNo: { in: [...named] } }, { refRecId: { in: [...named] } }] },
      select: { invNo: true, recAmt: true, payMode: true, sourceVoucherNo: true, refRecId: true },
    });
    for (const a of allocs) {
      const owner = a.sourceVoucherNo && named.has(a.sourceVoucherNo) ? a.sourceVoucherNo : a.refRecId!;
      const held = claims.get(owner) ?? claims.set(owner, new Map()).get(owner)!;
      const cur = held.get(a.invNo) ?? { bank: 0, cash: 0 };
      if (BANK_MODES.includes(a.payMode)) cur.bank = r2(cur.bank + a.recAmt);
      else cur.cash = r2(cur.cash + a.recAmt);
      held.set(a.invNo, cur);
    }
    return claims;
  }

  /** Replay reversed receipts in the given (arrival) order, releasing each
   *  receipt's hold on its bills just before it settles them itself. */
  private async replayInOrder(tx: Db, rows: LedgerRow[], claims: Claims, edit?: { id: number; data: ReplayOverride }): Promise<void> {
    for (const row of rows) {
      const own = claims.get(row.voucherNo);
      claims.delete(row.voucherNo);
      await this.replayRow(tx, row, row.id === edit?.id ? edit.data : undefined, reservedFrom(claims), row.adjMode === 'AUTOMATIC' ? own : undefined);
    }
  }

  /**
   * Adds to `claims` the bills each AUTOMATIC receipt's exact amount names
   * (see findExact), in arrival order, among the bills open on its date that
   * no earlier claim holds. Called with the receipts already reversed, so an
   * exact payment keeps its bill even from an older receipt that settles first.
   */
  private async claimExact(tx: Db, headId: number, agentName: string | null, entries: Entry[], claims: Claims, intent?: string): Promise<void> {
    const openBy = new Map<PayBucket, PendingInvoiceRow[]>();
    for (const e of entries) {
      if (e.adjMode !== 'AUTOMATIC') continue;
      const bucket = payBucketOf(e.payMode);
      if (!openBy.has(bucket)) {
        const customers = await this.resolveCustomers(tx, headId !== 0 ? headId : null, headId !== 0 ? null : agentName, bucket, true);
        openBy.set(bucket, await this.invoicePending(tx, customers, FAR));
      }
      const held = reservedFrom(claims);
      const bank = bucket !== 'cash';
      const open = openBy
        .get(bucket)!
        .filter((r) => dayOf(new Date(r.invDate)) <= dayOf(e.transDate))
        .map((r) => ({ invNo: r.invNo, bal: r2((bank ? r.bankBal : r.cashBal) - ((bank ? held.get(r.invNo)?.bank : held.get(r.invNo)?.cash) ?? 0)) }))
        .filter((r) => r.bal > EPS);
      const hit = findExact(open, e.amount);
      // The oldest open bills in a row are what oldest-first gives anyway, so
      // they say nothing about intent and older money must still come first.
      // A match that skips older bills is the party's choice, and holds.
      const oldestFirst = e.voucherNo !== intent && hit?.every((h, k) => h === open[k]);
      if (hit && !oldestFirst) claims.set(e.voucherNo, new Map(hit.map((h) => [h.invNo, bank ? { bank: h.bal, cash: 0 } : { bank: 0, cash: h.bal }])));
    }
  }

  /**
   * The party's receipts, from the earliest AUTOMATIC one that holds a bill
   * this new amount names (as if no automatic receipt had settled anything)
   * up to its date; [] when the amount names nothing, or only the oldest bills.
   */
  private async holdersOfExact(tx: Db, customers: { id: number; name: string }[], headId: number, agentName: string | null, recDate: Date, amount: number, payMode: string): Promise<LedgerRow[]> {
    const rows = (
      await tx.acctLedger.findMany({ where: { voucherType: 'RECEIPT', transDate: { lt: nextDay(recDate) }, ...(headId !== 0 ? { custId: headId } : { agentName }) } })
    ).sort(byArrival);
    const auto = rows.filter((r) => r.adjMode === 'AUTOMATIC');
    if (!auto.length) return [];
    const bank = payBucketOf(payMode) !== 'cash';
    const open = (await this.invoicePending(tx, customers, recDate, new Set(auto.map((r) => r.voucherNo))))
      .map((r) => ({ invNo: r.invNo, bal: bank ? r.bankBal : r.cashBal }))
      .filter((r) => r.bal > EPS);
    const hit = findExact(open, amount);
    if (!hit || hit.every((h, k) => h === open[k])) return [];
    const held = await tx.acctPaymentReceipt.findMany({ where: { invNo: { in: hit.map((h) => h.invNo) } }, select: { sourceVoucherNo: true, refRecId: true } });
    const owners = new Set(held.flatMap((h) => [h.sourceVoucherNo, h.refRecId]));
    const first = auto.find((r) => owners.has(r.voucherNo));
    return first ? rows.slice(rows.indexOf(first)) : [];
  }

  /**
   * Settle the party's open bills from money it already has on account: oldest
   * bill first, oldest money first, bank and cash kept apart. Runs after every
   * receipt change and every bill save, so a bill the party has already paid
   * for never shows as due. Each settlement is dated the later of the bill and
   * the money — it was paid the moment both existed.
   *
   * Only money a receipt parked for this party is used: an agent's money is
   * spread over several parties, and notes manage what they park themselves.
   * The rows carry the parking receipt as their source, so reversing that
   * receipt takes them back out.
   */
  async applyOnAccount(tx: Db, custId: number): Promise<void> {
    if (!custId) return;
    const c = await tx.customer.findUnique({ where: { id: custId }, select: { id: true, partyName: true } });
    if (!c) return;
    const customers = [{ id: c.id, name: c.partyName ?? `#${c.id}` }];
    const [bills, money] = await Promise.all([this.invoicePending(tx, customers, FAR), this.advancePending(tx, customers)]);
    const advs = money.filter((a) => a.takeAccOn !== 'AGENT');
    if (!bills.length || !advs.length) return;
    const parked = await tx.acctPartyAdvance.findMany({ where: { refId: { in: advs.map((a) => a.refId) } }, select: { refId: true, refRecId: true } });
    const owners = new Set((await tx.acctLedger.findMany({ where: { voucherType: 'RECEIPT', voucherNo: { in: parked.map((p) => p.refRecId ?? '') } }, select: { voucherNo: true } })).map((v) => v.voucherNo));
    const ownerOf = new Map(parked.filter((p) => p.refRecId && owners.has(p.refRecId)).map((p) => [p.refId, p.refRecId!]));

    for (const bank of [true, false]) {
      const pots = advs.filter((a) => ownerOf.has(a.refId)).map((a) => ({ ...a, left: bank ? a.bankBal : a.cashBal })).filter((a) => a.left > EPS);
      let i = 0;
      for (const bill of bills) {
        let need = bank ? bill.bankBal : bill.cashBal;
        while (need > EPS && i < pots.length) {
          const pot = pots[i];
          const use = r2(Math.min(need, pot.left));
          await tx.acctPaymentReceipt.create({
            data: {
              refId: pot.refId,
              recDate: new Date(Math.max(+new Date(bill.invDate), +new Date(pot.recDate))),
              invNo: bill.invNo,
              customerName: bill.customerName,
              custId: bill.customerId,
              recType: 'RECEIPT',
              recAmt: use,
              payMode: bank ? 'BANK' : 'CASH',
              modeOfAdj: 'ADVANCE',
              refRecId: pot.refId,
              sourceVoucherNo: ownerOf.get(pot.refId)!,
            },
          });
          need = r2(need - use);
          pot.left = r2(pot.left - use);
          if (pot.left <= EPS) i += 1;
        }
      }
    }
  }

  /** Undo every row the chain's vouchers wrote, most-recent first. `sourceVoucherNo`
   *  is stamped on all three child tables precisely so this is exact. */
  /**
   * Undo a chain of vouchers, newest first.
   *
   * Two linkages, because the book has two generations of rows:
   *
   *  - `sourceVoucherNo` — stamped by this system on everything it writes.
   *  - `refRecId` — how the ORIGINAL Access app tied an allocation to its
   *    voucher. Its DeleteReceiptEverywhere deleted from ACCT PAYMENT RECEIPT /
   *    ACCT PARTY ADVANCE / ACCT OPENING TRANS on `[REF REC ID] = voucherNo`,
   *    which is exactly this. Imported rows have no `sourceVoucherNo`, so
   *    without this second clause a replay would leave the old allocations in
   *    place and add a fresh set on top — the money would be spent twice.
   *
   * Matching both is what lets an imported receipt be edited or deleted at all.
   * A row whose `refRecId` is an ADV- id (an allocation funded by an older
   * advance rather than by this receipt) is deliberately NOT swept up — the
   * legacy app left those too, and the replay reads live invoice balances, so
   * whatever they still cover is simply seen as already paid.
   */
  private async reverseChain(tx: Db, chain: LedgerRow[]): Promise<void> {
    for (const row of [...chain].reverse()) {
      const owned = { OR: [{ sourceVoucherNo: row.voucherNo }, { refRecId: row.voucherNo }] };
      await tx.acctPaymentReceipt.deleteMany({ where: owned });
      // Spends of this receipt's money on account that it did not write itself
      // (old imports, notes) go too: the replay may park less or nothing, and a
      // spend of money that no longer exists pays a bill twice (DEVI METALS
      // ADV-2026-0010). Whatever they covered settles again from real money.
      // The voucher keeps its ADV- id even after an earlier replay parked nothing.
      const parkedIds = [...(await tx.acctPartyAdvance.findMany({ where: owned, select: { refId: true } })).map((a) => a.refId), ...(row.advanceRefId ? [row.advanceRefId] : [])];
      if (parkedIds.length) await tx.acctPaymentReceipt.deleteMany({ where: { refRecId: { in: parkedIds } } });
      await tx.acctPartyAdvance.deleteMany({ where: owned });
      await tx.acctOpeningTrans.deleteMany({ where: owned });
      await tx.acctLedger.delete({ where: { id: row.id } });
    }
  }

  /** Re-run one reversed voucher through the waterfall. Without `override` it is
   *  replayed exactly as originally recorded; with one, the target's figures are
   *  corrected. Voucher number and REC-/ADV- ref ids are always reused. */
  private async replayRow(tx: Db, row: LedgerRow, override?: ReplayOverride, reserved?: Reserved, claimed?: Reserved): Promise<void> {
    const isAgent = row.custId === 0;
    const customers = await this.resolveCustomers(tx, isAgent ? null : row.custId, isAgent ? row.agentName : null, payBucketOf(row.transMode), true);
    await this.runWaterfall(tx, {
      voucherNo: row.voucherNo,
      receiptRefId: row.receiptRefId,
      advanceRefId: row.advanceRefId,
      recDate: override?.recDate ?? row.transDate,
      customers,
      isAgent,
      agentName: isAgent ? row.agentName : null,
      headName: isAgent ? row.agentName! : customers[0].name,
      headId: isAgent ? 0 : customers[0].id,
      payMode: override?.payMode ?? row.transMode,
      bankName: override ? override.bankName : row.bankName,
      bankRef: row.bankRef,
      chequeNo: override ? override.chequeNo : row.chequeNo,
      cashLoc: override ? override.cashLoc : row.cashTransLocation,
      cashBy: override ? override.cashBy : row.cashRecBy,
      remarks: override ? override.remarks : row.transRemarks,
      adjMode: row.adjMode!,
      selectedInvNos: row.selectedInvNos ? (JSON.parse(row.selectedInvNos) as string[]) : undefined,
      receiptAmt: override?.receiptAmt ?? (row.bankCredit || row.cashCredit),
      userName: row.userName,
      editedAt: override?.editedAt ?? row.editedAt,
      editedByName: override ? override.editedByName : row.editedByName,
      sourceKey: row.sourceKey,
      createdAt: row.createdAt,
      reserved,
      claimed,
      replay: true,
    });
  }

  /**
   * The legacy BtnSave waterfall — creates one ledger voucher plus whatever
   * opening-clearance / invoice-allocation / advance-spill rows its amount
   * covers. Shared by `save()` (fresh voucher, fresh ids) and `editReceipt()`
   * (reused voucher number + ref ids, so a correction never breaks anything
   * that already refers to them).
   */
  private async runWaterfall(tx: Db, p: WaterfallParams): Promise<SavePaymentResult> {
    const bankish = isBankMode(p.payMode);
    const particulars =
      p.payMode === 'BANK' ? (p.bankName ?? '') : p.payMode === 'CHEQUE' ? `${p.bankName} ON CHEQUE: ${p.chequeNo}` : `CASH RECEIPT BY ${p.cashBy} / ${p.cashLoc}`;

    // 1) Ledger voucher — money in = CREDIT on the mode's bucket. receiptRefId/
    //    advanceRefId are filled in at the end, once known.
    const ledger = await tx.acctLedger.create({
      data: {
        voucherNo: p.voucherNo,
        transDate: p.recDate,
        customerName: p.headName,
        custId: p.headId,
        agentName: p.agentName,
        particulars,
        voucherType: 'RECEIPT',
        transMode: p.payMode,
        bankCredit: bankish ? p.receiptAmt : 0,
        cashCredit: bankish ? 0 : p.receiptAmt,
        transRemarks: p.remarks,
        userName: p.userName ?? null,
        adjMode: p.adjMode,
        selectedInvNos: p.selectedInvNos?.length ? JSON.stringify(p.selectedInvNos) : null,
        takeAccOn: p.isAgent ? 'AGENT' : 'PARTY',
        bankName: p.bankName,
        bankRef: p.bankRef,
        chequeNo: p.chequeNo,
        cashTransLocation: p.cashLoc,
        cashRecBy: p.cashBy,
        editedAt: p.editedAt,
        editedByName: p.editedByName,
        sourceKey: p.sourceKey,
        ...(p.createdAt ? { createdAt: p.createdAt } : {}),
      },
    });

    const allocations: PaymentAllocation[] = [];
    let remaining = p.receiptAmt;
    let openingCleared = 0;

    // 2) Clear opening balances first (mode bucket). Agent mode: per customer.
    //    Not when the amount names its own bills: that money was for them.
    const openings = p.claimed?.size ? [] : await this.openingPending(tx, p.customers);
    for (const o of openings) {
      if (remaining <= EPS) break;
      const pend = bankish ? o.pendingBank : o.pendingCash;
      if (pend <= EPS) continue;
      const clear = r2(Math.min(pend, remaining));
      await tx.acctOpeningTrans.create({
        data: {
          kind: 'CLEARANCE',
          customerName: o.customerName,
          custId: o.customerId,
          transDate: p.recDate,
          bankAmt: bankish ? clear : 0,
          cashAmt: bankish ? 0 : clear,
          refRecId: p.voucherNo,
          sourceVoucherNo: p.voucherNo,
          userName: p.userName ?? null,
        },
      });
      allocations.push({ kind: 'OPENING', customerName: o.customerName, fundedBy: p.voucherNo, modeOfAdj: p.adjMode, amount: clear });
      openingCleared = r2(openingCleared + clear);
      remaining = r2(remaining - clear);
    }

    // 3) Invoice allocation (skipped entirely in ADVANCE mode).
    let invoicesCleared = 0;
    let receiptRefId: string | null = p.receiptRefId;
    if (p.adjMode !== 'ADVANCE' && remaining > EPS) {
      let rows = (await this.invoicePending(tx, p.customers, p.recDate)).filter((r) => (bankish ? r.bankBal : r.cashBal) > EPS);
      if (p.adjMode === 'AGST REF') {
        // Only the ticked invoices, in the user's tick order.
        const order = new Map((p.selectedInvNos ?? []).map((n, i) => [n, i]));
        rows = rows.filter((r) => order.has(r.invNo)).sort((a, b) => order.get(a.invNo)! - order.get(b.invNo)!);
        // Typed in, a named receipt with nothing left to pay is a mistake to
        // refuse. Replayed, its bills were settled by money that arrived first,
        // so its amount waits on account instead.
        if (!rows.length && !p.replay) throw new BadRequestException('AGST REF mode requires selecting at least one invoice.');
      } else {
        // Bills another receipt is holding (named, or matched by its exact
        // amount) are not this receipt's to take.
        if (p.reserved?.size) {
          rows = rows
            .map((r) => {
              const held = p.reserved!.get(r.invNo);
              return held ? { ...r, bankBal: Math.max(0, r2(r.bankBal - held.bank)), cashBal: Math.max(0, r2(r.cashBal - held.cash)) } : r;
            })
            .filter((r) => (bankish ? r.bankBal : r.cashBal) > EPS);
        }
        // The bills its own amount names go first; anything over runs on oldest-first.
        if (p.claimed?.size) rows = [...rows.filter((r) => p.claimed!.has(r.invNo)), ...rows.filter((r) => !p.claimed!.has(r.invNo))];
      }

      // Party mode: fund each allocation from today's receipt first, then from
      // OLD advances FIFO for any shortfall. Agent mode uses only the receipt.
      const advRows = !p.isAgent
        ? (await this.advancePending(tx, p.customers, p.recDate)).filter((a) => (bankish ? a.bankBal : a.cashBal) > EPS)
        : [];
      let advIdx = 0;
      let advLeft = advRows.length ? (bankish ? advRows[0].bankBal : advRows[0].cashBal) : 0;

      /*
       * Two trackers, and they measure different things.
       *
       * `sizeLeft` is how much debt this voucher may clear: today's receipt PLUS
       * whatever the party already has on account. `remaining` is the cash, and
       * only the receipt-funded portions spend it — what an old advance pays for
       * costs today's receipt nothing, and any cash left over at the end parks
       * as a new advance.
       *
       * The advance used to be left OUT of the sizing (`sizeLeft = remaining`),
       * faithfully to PaymentForm.vb. That made an advance unusable: it funded
       * part of the allocation, freeing exactly its own value of receipt, which
       * then parked straight back as a new advance. A ₹1 advance stayed ₹1
       * forever and never came off a bill. Including it here is what lets an
       * advance actually be spent.
       *
       * Sizing alone was not enough, though: while advances were still drained
       * BEFORE the receipt, a voucher for the exact invoice total kept freeing
       * the advance's value straight back into a new advance, so the same ₹5
       * rolled from voucher to voucher indefinitely. The order below — receipt
       * first, advance only for the shortfall — is what actually ends that.
       */
      const advTotal = r2(advRows.reduce((sum, a) => sum + (bankish ? a.bankBal : a.cashBal), 0));
      let sizeLeft = r2(remaining + advTotal);
      for (const inv of rows) {
        if (sizeLeft <= EPS) break;
        const pend = bankish ? inv.bankBal : inv.cashBal;
        let need = r2(Math.min(pend, sizeLeft));
        if (need <= EPS) continue;
        sizeLeft = r2(sizeLeft - need);
        invoicesCleared = r2(invoicesCleared + need);

        // Step 1: today's receipt (this is the part that consumes actual cash).
        //
        // Deliberately BEFORE the advances. Draining the advance first meant a
        // receipt for the exact invoice total always had the advance's value
        // left over, which parked straight back as a fresh advance of the same
        // size — so one ₹5 overpayment rolled forward voucher after voucher,
        // putting an ADVANCE line on every invoice it touched and never
        // clearing. Spending today's money first leaves the advance untouched
        // when it is not needed, and still lets it settle a genuine shortfall
        // below.
        const fromReceipt = r2(Math.min(need, remaining));
        if (fromReceipt > EPS) {
          receiptRefId ??= await this.nextRefId(tx, 'REC', p.recDate);
          await tx.acctPaymentReceipt.create({
            data: {
              refId: receiptRefId,
              recDate: p.recDate,
              invNo: inv.invNo,
              customerName: inv.customerName,
              custId: inv.customerId,
              recType: 'RECEIPT',
              recAmt: fromReceipt,
              payMode: p.payMode,
              bankName: p.bankName,
              chequeNo: p.chequeNo,
              cashTransLocation: p.cashLoc,
              cashRecBy: p.cashBy,
              modeOfAdj: p.adjMode,
              refRecId: p.voucherNo,
              sourceVoucherNo: p.voucherNo,
            },
          });
          allocations.push({ kind: 'INVOICE', customerName: inv.customerName, invNo: inv.invNo, fundedBy: p.voucherNo, modeOfAdj: p.adjMode, amount: fromReceipt });
          remaining = r2(remaining - fromReceipt);
          need = r2(need - fromReceipt);
        }

        // Step 2: old advances FIFO, for whatever today's receipt did not cover.
        while (need > EPS && advIdx < advRows.length) {
          if (advLeft <= EPS) {
            advIdx += 1;
            advLeft = advIdx < advRows.length ? (bankish ? advRows[advIdx].bankBal : advRows[advIdx].cashBal) : 0;
            continue;
          }
          const use = r2(Math.min(need, advLeft));
          receiptRefId ??= await this.nextRefId(tx, 'REC', p.recDate);
          await tx.acctPaymentReceipt.create({
            data: {
              refId: receiptRefId,
              recDate: p.recDate,
              invNo: inv.invNo,
              customerName: inv.customerName,
              custId: inv.customerId,
              recType: 'RECEIPT',
              recAmt: use,
              payMode: p.payMode,
              bankName: p.bankName,
              chequeNo: p.chequeNo,
              cashTransLocation: p.cashLoc,
              cashRecBy: p.cashBy,
              modeOfAdj: 'ADVANCE',
              refRecId: advRows[advIdx].refId,
              sourceVoucherNo: p.voucherNo,
            },
          });
          allocations.push({ kind: 'INVOICE', customerName: inv.customerName, invNo: inv.invNo, fundedBy: advRows[advIdx].refId, modeOfAdj: 'ADVANCE', amount: use });
          need = r2(need - use);
          advLeft = r2(advLeft - use);
        }
      }
    }

    // 4) Whatever's left parks on account (ACCT PARTY ADVANCE).
    let advanceRefId: string | null = p.advanceRefId;
    if (remaining > EPS) {
      advanceRefId ??= await this.nextRefId(tx, 'ADV', p.recDate);
      await tx.acctPartyAdvance.create({
        data: {
          refId: advanceRefId,
          recDate: p.recDate,
          custId: p.headId,
          customerName: p.headName,
          agentName: p.agentName,
          bankAmt: bankish ? remaining : 0,
          cashAmt: bankish ? 0 : remaining,
          payMode: p.payMode,
          bankName: p.bankName,
          chequeNo: p.chequeNo,
          cashTransLocation: p.cashLoc,
          cashRecBy: p.cashBy,
          recType: 'RECEIPT',
          refRecId: p.voucherNo,
          takeAccOn: p.isAgent ? 'AGENT' : 'PARTY',
          sourceVoucherNo: p.voucherNo,
        },
      });
      allocations.push({ kind: 'ADVANCE_SPILL', customerName: p.headName, fundedBy: p.voucherNo, modeOfAdj: p.adjMode, amount: remaining });
    }

    // Persist whichever ref ids actually got used, so a future edit can reuse
    // them too. Always writes (even when unchanged from what was passed in) —
    // the initial create() above never sets these, so on a fresh save() they'd
    // otherwise be left null forever.
    await tx.acctLedger.update({ where: { id: ledger.id }, data: { receiptRefId, advanceRefId } });

    return {
      voucherNo: p.voucherNo,
      receiptRefId: receiptRefId ?? '',
      advanceRefId,
      allocations,
      openingCleared,
      invoicesCleared,
      advanceParked: remaining > EPS ? remaining : 0,
    };
  }

  /* ── Derivations (the legacy Access "…Summary" views) ─────────────────────── */

  /**
   * PARTY: the one customer. AGENT: the agent's customers. Both judged for ONE
   * money bucket.
   *
   * Routing is per bucket (see payByFor): a party commonly settles its own bank
   * transfers while its agent hands over the cash. So the same party is legal in
   * Party mode for a BANK receipt and illegal for a CASH one, and shows up under
   * its agent only for the bucket that agent actually collects.
   *
   * `replay` relaxes the PARTY check: it guards data *entry*, so a voucher already
   * recorded in Party mode must stay editable even if the party has since been
   * switched to AGENT for that bucket. Without this, flipping a party's routing
   * silently freezes every receipt ever taken from it.
   */
  private async resolveCustomers(
    db: Db,
    customerId: number | null,
    agentName: string | null,
    bucket: PayBucket,
    replay = false,
  ): Promise<{ id: number; name: string; payBy: string | null }[]> {
    const money = bucket === 'cash' ? 'cash' : 'bank';
    if (customerId != null) {
      const c = await db.customer.findUnique({ where: { id: customerId } });
      if (!c) throw new NotFoundException('Customer not found.');
      if (!replay && payByFor(c, bucket) === 'AGENT') {
        throw new BadRequestException(
          `This party's ${money} payments come through Agent: ${c.agentName ?? '(none set)'}. Please use the Agent Name field to process this receipt.`,
        );
      }
      return [{ id: c.id, name: c.partyName ?? `#${c.id}`, payBy: c.payBy }];
    }
    const agent = agentName?.trim();
    if (!agent) throw new BadRequestException('Please select either Customer / Party Name or Agent Name.');
    const list = await db.customer.findMany({ where: { agentName: agent }, orderBy: { partyName: 'asc' } });
    const linked = list.filter((c) => payByFor(c, bucket) === 'AGENT');
    if (!linked.length) {
      throw new BadRequestException(
        `No parties send their ${money} through Agent: ${agent}. Set PAY BY (${money}) = AGENT on at least one of this agent's parties in the Customer master.`,
      );
    }
    // Only the parties whose money in THIS bucket comes through the agent — one
    // that settles this bucket directly is collected in Party mode, never here.
    return linked.map((c) => ({ id: c.id, name: c.partyName ?? `#${c.id}`, payBy: c.payBy }));
  }

  /** InvPendingSummary: per CONFIRMED challan dated ≤ recDate, bank/cash pending.
   *  `skip`: vouchers whose settlements are left out (the later-dated receipts a
   *  back-dated one goes ahead of). */
  private async invoicePending(db: Db, customers: { id: number; name: string }[], recDate: Date, skip?: Set<string>): Promise<PendingInvoiceRow[]> {
    const names = customers.map((c) => c.name);
    const idByName = new Map(customers.map((c) => [c.name, c.id]));
    const end = new Date(recDate);
    end.setDate(end.getDate() + 1);
    const challans = await db.challan.findMany({
      where: { challanStatus: 'CONFIRMED', customerName: { in: names }, invDate: { lt: end } },
      orderBy: [{ invDate: 'asc' }, { customerName: 'asc' }, { id: 'asc' }],
      select: { code: true, invDate: true, dueDate: true, transaction: true, customerName: true, b: true, c: true },
    });
    if (!challans.length) return [];
    const codes = challans.map((c) => c.code);
    // Pending = amount − Σ receipts − Σ discounts (Sales Discount reduces the
    // same bank/cash bucket, so both screens reconcile).
    const [recs, discs] = await Promise.all([
      db.acctPaymentReceipt.findMany({ where: { invNo: { in: codes } }, select: { invNo: true, payMode: true, recAmt: true, sourceVoucherNo: true, refRecId: true } }),
      db.acctPartyDiscount.groupBy({ by: ['invNo', 'billType'], where: { invNo: { in: codes } }, _sum: { disAmt: true } }),
    ]);
    const bankRec = new Map<string, number>();
    const cashRec = new Map<string, number>();
    for (const r of recs) {
      if (skip?.has(r.sourceVoucherNo ?? '') || skip?.has(r.refRecId ?? '')) continue;
      const m = BANK_MODES.includes(r.payMode) ? bankRec : cashRec;
      m.set(r.invNo, r2((m.get(r.invNo) ?? 0) + r.recAmt));
    }
    const bankDisc = new Map<string, number>();
    const cashDisc = new Map<string, number>();
    for (const d of discs) {
      const m = d.billType === 'BANK' ? bankDisc : cashDisc;
      m.set(d.invNo, r2((m.get(d.invNo) ?? 0) + (d._sum.disAmt ?? 0)));
    }
    const rows: PendingInvoiceRow[] = [];
    for (const c of challans) {
      const bankBal = r2((c.b ?? 0) - (bankRec.get(c.code) ?? 0) - (bankDisc.get(c.code) ?? 0));
      const cashBal = r2((c.c ?? 0) - (cashRec.get(c.code) ?? 0) - (cashDisc.get(c.code) ?? 0));
      if (bankBal <= EPS && cashBal <= EPS) continue;
      // Ageing is measured from the RECEIPT date, not from "now" — back-dating
      // a receipt must show the due days as they stood on that day.
      const dd = dueTypeOf(c.invDate, c.dueDate, recDate);
      rows.push({
        invNo: c.code,
        invDate: c.invDate.toISOString(),
        dueDate: c.dueDate?.toISOString() ?? null,
        transaction: c.transaction,
        customerId: idByName.get(c.customerName) ?? 0,
        customerName: c.customerName,
        bankBal: Math.max(0, bankBal),
        cashBal: Math.max(0, cashBal),
        dueType: dd.dueType,
        dueDays: dd.dueDays,
      });
    }
    return rows;
  }

  /**
   * AdvPendingSummary: per advance REF ID, remaining bank/cash. FIFO by recDate.
   * Only money on account by `upTo` — a receipt cannot be topped up from money
   * that arrived after it. `skip` as in {@link invoicePending}.
   */
  private async advancePending(db: Db, customers: { id: number }[], upTo?: Date, skip?: Set<string>): Promise<PendingAdvanceRow[]> {
    const ids = customers.map((c) => c.id);
    const advs = (
      await db.acctPartyAdvance.findMany({
        where: { custId: { in: ids }, ...(upTo ? { recDate: { lt: nextDay(upTo) } } : {}) },
        orderBy: [{ recDate: 'asc' }, { refId: 'asc' }],
      })
    ).filter((a) => !skip?.has(a.refRecId ?? ''));
    if (!advs.length) return [];
    const used = await db.acctPaymentReceipt.findMany({
      where: { refRecId: { in: advs.map((a) => a.refId) } },
      select: { refRecId: true, payMode: true, recAmt: true, sourceVoucherNo: true },
    });
    const usedBank = new Map<string, number>();
    const usedCash = new Map<string, number>();
    for (const u of used) {
      if (skip?.has(u.sourceVoucherNo ?? '')) continue;
      const m = BANK_MODES.includes(u.payMode) ? usedBank : usedCash;
      m.set(u.refRecId ?? '', r2((m.get(u.refRecId ?? '') ?? 0) + u.recAmt));
    }
    return advs
      .map((a) => ({
        refId: a.refId,
        recDate: a.recDate.toISOString(),
        customerId: a.custId,
        customerName: a.customerName,
        bankBal: Math.max(0, r2(a.bankAmt - (usedBank.get(a.refId) ?? 0))),
        cashBal: Math.max(0, r2(a.cashAmt - (usedCash.get(a.refId) ?? 0))),
        takeAccOn: a.takeAccOn,
      }))
      .filter((a) => a.bankBal > EPS || a.cashBal > EPS);
  }

  /**
   * Receipts already entered for this party/agent on the SAME date — so the
   * form can warn before saving what looks like an accidental second entry of
   * the same amount (a double tap on Save, or two people entering the same
   * cheque). Returned with the context rather than as its own endpoint: the
   * context is already refetched whenever the party or date changes, which is
   * exactly when this answer changes too.
   */
  private async receiptsOn(recDate: Date, customerId: number | null, agentName: string | null): Promise<SameDayReceiptDto[]> {
    if (customerId == null && !agentName?.trim()) return [];
    const from = new Date(recDate);
    from.setHours(0, 0, 0, 0);
    const to = new Date(recDate);
    to.setHours(23, 59, 59, 999);
    const rows = await this.prisma.acctLedger.findMany({
      where: {
        voucherType: 'RECEIPT',
        transDate: { gte: from, lte: to },
        ...(customerId != null ? { custId: customerId } : { agentName: agentName!.trim() }),
      },
      orderBy: { id: 'desc' },
      select: { voucherNo: true, bankCredit: true, cashCredit: true, transMode: true, bankRef: true, transRemarks: true },
    });
    return rows.map((r) => ({
      voucherNo: r.voucherNo,
      amount: r2(r.bankCredit || r.cashCredit),
      payMode: r.transMode,
      bankRef: r.bankRef,
      remarks: r.transRemarks,
    }));
  }

  /** OpeningBalSummary: Σ OPENING DEBIT − Σ CLEARANCE per customer (CREDITs excluded). */
  private async openingPending(db: Db, customers: { id: number; name: string }[], skip?: Set<string>): Promise<OpeningPendingRow[]> {
    const ids = customers.map((c) => c.id);
    const rows = (await db.acctOpeningTrans.findMany({ where: { custId: { in: ids } } })).filter(
      (r) => !(r.kind === 'CLEARANCE' && (skip?.has(r.refRecId ?? '') || skip?.has(r.sourceVoucherNo ?? ''))),
    );
    const byCust = new Map<number, { bank: number; cash: number }>();
    for (const r of rows) {
      const cur = byCust.get(r.custId) ?? { bank: 0, cash: 0 };
      if (r.kind === 'OPENING' && r.drCr === 'DEBIT') {
        cur.bank = r2(cur.bank + r.bankAmt);
        cur.cash = r2(cur.cash + r.cashAmt);
      } else if (r.kind === 'CLEARANCE') {
        cur.bank = r2(cur.bank - r.bankAmt);
        cur.cash = r2(cur.cash - r.cashAmt);
      }
      byCust.set(r.custId, cur);
    }
    // Preserve the customer ordering (agent mode clears in partyName order).
    return customers
      .map((c) => ({ customerId: c.id, customerName: c.name, pendingBank: Math.max(0, byCust.get(c.id)?.bank ?? 0), pendingCash: Math.max(0, byCust.get(c.id)?.cash ?? 0) }))
      .filter((c) => c.pendingBank > EPS || c.pendingCash > EPS);
  }

  /* ── Numbering ────────────────────────────────────────────────────────────── */

  /**
   * Refuse a receipt that has already been entered.
   *
   * The Save button disables itself while saving, and the form warns about
   * same-day receipts — but both live in the browser. A network retry, a
   * second tab, or two people entering the same cheque all reached the server,
   * which accepted every copy. Two rules, each only as wide as its evidence:
   *
   * - A CHEQUE number is unique to one cheque, so the same party's cheque
   *   already on a live receipt is a duplicate on any date. A cheque that
   *   bounced and is re-presented must have its old receipt reversed first,
   *   which is exactly what this message asks for.
   * - Anything else identical (party, day, mode, amount) requires an explicit
   *   confirmation. The rule lives here, not only in the browser, so a stale
   *   tab or direct API request cannot bypass it.
   */
  private async assertNotDuplicateReceipt(
    db: Db,
    r: { headId: number; agentName: string | null; payMode: string; chequeNo: string | null; receiptAmt: number; recDate: Date; confirmed: boolean },
  ): Promise<void> {
    const party = r.headId !== 0 ? { custId: r.headId } : { agentName: r.agentName };
    if (r.payMode === 'CHEQUE' && r.chequeNo) {
      const hit = await db.acctLedger.findFirst({
        where: { voucherType: 'RECEIPT', chequeNo: r.chequeNo, ...party },
        select: { voucherNo: true, transDate: true },
      });
      if (hit) {
        throw new ConflictException(
          `Cheque ${r.chequeNo} from this party is already recorded as ${hit.voucherNo} (${hit.transDate.toLocaleDateString('en-IN')}). ` +
            'If it bounced and was paid again, reverse the old receipt first.',
        );
      }
      return;
    }
    const day = new Date(r.recDate);
    day.setHours(0, 0, 0, 0);
    const amt = { gte: r.receiptAmt - 0.005, lte: r.receiptAmt + 0.005 };
    const hit = await db.acctLedger.findFirst({
      where: {
        voucherType: 'RECEIPT',
        ...party,
        transMode: r.payMode,
        transDate: { gte: day, lt: new Date(day.getTime() + 86_400_000) },
        OR: [{ bankCredit: amt }, { cashCredit: amt }],
      },
      select: { voucherNo: true },
    });
    if (hit && !r.confirmed) {
      throw new ConflictException(
        `A possible duplicate is already recorded as ${hit.voucherNo} for this party, date, mode and amount. Confirm that this is a separate payment before saving another receipt.`,
      );
    }
  }

  /**
   * Next receipt number: RN/<n>, never reusing one.
   *
   * It was "highest number in use + 1". Deleting the newest receipt lowered
   * the highest, so the next save was handed the deleted receipt's number —
   * and a printout or bank note quoting RN/817 could then point at a
   * different receipt. The last number ever issued is now kept in `settings`
   * and only moves forward. It is updated in the same transaction as the
   * receipt, so a save that fails does not burn a number, and two saves
   * cannot both take the same one.
   */
  private async nextVoucherNo(db: Db): Promise<string> {
    const rows = await db.acctLedger.findMany({ where: { voucherNo: { startsWith: 'RN/' } }, select: { voucherNo: true } });
    let max = 0;
    for (const r of rows) {
      const n = parseInt(r.voucherNo.slice(3), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    const stored = await db.setting.findUnique({ where: { key: RECEIPT_SEQ_KEY } });
    const next = Math.max(max, Number(stored ? JSON.parse(stored.value) : 0) || 0) + 1;
    const value = JSON.stringify(next);
    await db.setting.upsert({ where: { key: RECEIPT_SEQ_KEY }, create: { key: RECEIPT_SEQ_KEY, value }, update: { value } });
    return `RN/${next}`;
  }

  /** Legacy REF ID: <PREFIX>-<year>-<0000>, serial per prefix+year. */
  private async nextRefId(db: Db, prefix: 'REC' | 'ADV', recDate: Date): Promise<string> {
    const year = recDate.getFullYear();
    const start = `${prefix}-${year}-`;
    const rows =
      prefix === 'REC'
        ? await db.acctPaymentReceipt.findMany({ where: { refId: { startsWith: start } }, select: { refId: true }, distinct: ['refId'] })
        : await db.acctPartyAdvance.findMany({ where: { refId: { startsWith: start } }, select: { refId: true } });
    let max = 0;
    for (const r of rows) {
      const n = parseInt(r.refId.slice(start.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `${start}${String(max + 1).padStart(4, '0')}`;
  }
}
