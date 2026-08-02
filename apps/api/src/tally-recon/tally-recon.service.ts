import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ReconCreateReceiptInput,
  ReconCreateReceiptResult,
  ReconRow,
  ReconRunResult,
  ReconPartyBalance,
  ReconRunSummary,
  ReconReview,
  ReconStatus,
  MarkReconRowsResult,
  TallyAliasDto,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { parseTallyRegister, type ParsedLedger, type ParsedRegister } from './tally-register.parser';
import { exactKey, nameKey, reconcileParty, type MatchRow, type OmsParty } from './tally-recon.matcher';

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * `yyyy-mm-dd` in local time.
 *
 * Dates in this database are stored as local midnight, so `toISOString()` shifts
 * them back a day anywhere east of UTC — a register entry dated 22-Apr would post
 * as a 21-Apr receipt. Read the local components instead.
 */
/** One row of the per-party balance comparison, before persistence. */
interface BalanceRow {
  runId: number;
  ledgerName: string;
  customerId: number | null;
  customerName: string | null;
  tallyOpening: number;
  omsOpening: number;
  tallyClosing: number;
  omsClosing: number;
  difference: number;
  matched: boolean;
  lastReceiptDate: Date | null;
  lastReceiptRef: string | null;
  tallyAtLastReceipt: number | null;
  omsAtLastReceipt: number | null;
  agreedAtLastReceipt: boolean | null;
  firstDivergenceOn: Date | null;
  divergedAfterLastReceipt: boolean;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Stable identity for "the same discrepancy", so a review mark made on one
 * upload is recognised on the next.
 *
 * Rows are rewritten wholesale on every run, so identity has to come from the
 * voucher itself. The amount is part of the key on purpose: if the figure moves,
 * it is a *different* difference and last month's "solved" should not follow it.
 * Paise are folded into an integer so float noise can't split a key in two.
 */
function issueKeyOf(r: { source: string; ledgerName: string; vchType: string; vchNo: string; dr: number; cr: number; txnDate: Date }): string {
  const paise = Math.round((r.dr - r.cr) * 100);
  return [r.source, r.ledgerName.trim().toUpperCase(), r.vchType, r.vchNo.trim().toUpperCase(), paise, ymd(r.txnDate)].join('|');
}

/**
 * Start of the April–March financial year a date falls in — mirrors the party
 * ledger. An opening balance belongs to a year, not to the day it was keyed, so a
 * balance entered in Jul-2025 is in force from 01-Apr-2025.
 */
const FY_START_MONTH = 3; // April, 0-based
function fyStart(d: Date): Date {
  const y = d.getMonth() >= FY_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(y, FY_START_MONTH, 1);
}

/** A challan that is a Debit Note rather than a sale — mirrors the party ledger. */
function isDebitNoteChallan(prefix: string | null, transaction: string | null): boolean {
  return (prefix ?? '').toUpperCase().includes('DN') || (transaction ?? '').toUpperCase() === 'DEBIT NOTE';
}

@Injectable()
export class TallyReconService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  /* ── party name resolution ───────────────────────────────────────────────── */

  /**
   * Builds Tally-name → OMS-customer resolution in three passes, strongest first:
   * a saved alias, an exact name match, then a punctuation/suffix-insensitive key.
   * Fuzzy keys that collide across two customers are dropped rather than guessed
   * at — an ambiguous pin would silently reconcile against the wrong party.
   */
  private async buildResolver(): Promise<(tallyName: string) => { id: number; name: string } | null> {
    const customers = await this.prisma.customer.findMany({
      where: { partyName: { not: null } },
      select: { id: true, partyName: true },
    });
    const aliases = await this.prisma.tallyPartyAlias.findMany({ select: { tallyName: true, customerId: true } });

    const nameById = new Map(customers.map((c) => [c.id, c.partyName!]));
    const byAlias = new Map<string, number>();
    for (const a of aliases) byAlias.set(exactKey(a.tallyName), a.customerId);

    const byExact = new Map<string, number>();
    const byFuzzy = new Map<string, number | null>();
    for (const c of customers) {
      const ek = exactKey(c.partyName!);
      if (!byExact.has(ek)) byExact.set(ek, c.id);
      const fk = nameKey(c.partyName!);
      if (!fk) continue;
      // A second customer under the same fuzzy key makes it unusable.
      byFuzzy.set(fk, byFuzzy.has(fk) ? null : c.id);
    }

    return (tallyName: string) => {
      const ek = exactKey(tallyName);
      const aliasHit = byAlias.get(ek);
      if (aliasHit !== undefined) {
        const nm = nameById.get(aliasHit);
        if (nm) return { id: aliasHit, name: nm };
      }
      const exactHit = byExact.get(ek);
      if (exactHit !== undefined) return { id: exactHit, name: nameById.get(exactHit)! };
      const fuzzyHit = byFuzzy.get(nameKey(tallyName));
      if (fuzzyHit) return { id: fuzzyHit, name: nameById.get(fuzzyHit)! };
      return null;
    };
  }

  /* ── OMS books for the period ────────────────────────────────────────────── */

  /**
   * Loads every OMS document for the resolved parties in one pass per table, then
   * buckets by customer — 100+ parties would otherwise mean 300+ queries.
   */
  private async loadOmsBooks(custIds: number[], from: Date, toExclusive: Date): Promise<Map<number, OmsParty>> {
    const books = new Map<number, OmsParty>();
    if (!custIds.length) return books;

    const customers = await this.prisma.customer.findMany({
      where: { id: { in: custIds } },
      select: { id: true, partyName: true },
    });
    for (const c of customers) {
      books.set(c.id, {
        customerId: c.id,
        customerName: c.partyName ?? `#${c.id}`,
        openingBankNet: 0,
        openingCashNet: 0,
        hasOpening: false,
        invoices: [],
        vouchers: [],
      });
    }

    // Confirmed sales invoices in the period. Cancelled challans are void, and a
    // Debit Note challan reaches the ledger through AcctLedger instead.
    const challans = await this.prisma.challan.findMany({
      where: { challanStatus: 'CONFIRMED', invDate: { gte: from, lt: toExclusive }, customerId: { in: custIds } },
      select: { code: true, invDate: true, prefix: true, transaction: true, customerId: true, b: true, c: true },
    });
    for (const ch of challans) {
      if (ch.customerId == null) continue;
      if (isDebitNoteChallan(ch.prefix, ch.transaction)) continue;
      const book = books.get(ch.customerId);
      if (!book) continue;
      book.invoices.push({ code: ch.code, invDate: ch.invDate, bank: r2(ch.b ?? 0), cash: r2(ch.c ?? 0) });
    }

    // Receipts, notes and discounts.
    const ledger = await this.prisma.acctLedger.findMany({
      where: { transDate: { gte: from, lt: toExclusive }, custId: { in: custIds } },
      select: {
        custId: true,
        voucherNo: true,
        transDate: true,
        voucherType: true,
        particulars: true,
        bankDebit: true,
        bankCredit: true,
        cashDebit: true,
        cashCredit: true,
      },
    });
    for (const l of ledger) {
      const book = books.get(l.custId);
      if (!book) continue;
      book.vouchers.push({
        voucherNo: l.voucherNo,
        transDate: l.transDate,
        voucherType: l.voucherType || 'RECEIPT',
        particulars: l.particulars,
        bankDr: r2(l.bankDebit ?? 0),
        bankCr: r2(l.bankCredit ?? 0),
        cashDr: r2(l.cashDebit ?? 0),
        cashCr: r2(l.cashCredit ?? 0),
      });
    }

    await this.applyOpenings(books, from);

    for (const book of books.values()) {
      book.invoices.sort((a, b) => a.invDate.getTime() - b.invDate.getTime());
      book.vouchers.sort((a, b) => a.transDate.getTime() - b.transDate.getTime());
    }
    return books;
  }

  /**
   * Fills in each party's opening as of the period start.
   *
   * This is deliberately the same calculation the Party Ledger's footer performs,
   * because that is the figure a user would compare against Tally by hand. A
   * stated opening row is only the *anchor*: everything OMS booked between that
   * anchor and the period start moves the balance too, so Tally's brought-forward
   * figure has to be measured against `opening row + pre-period movement`. Taking
   * the opening row alone reported almost every party as a mismatch.
   *
   * The anchor is per-party — parties were onboarded on different dates — and
   * pre-anchor documents are excluded because the opening row already subsumes
   * them.
   */
  private async applyOpenings(books: Map<number, OmsParty>, from: Date): Promise<void> {
    const custIds = [...books.keys()];
    if (!custIds.length) return;
    const EPOCH = new Date(1900, 0, 1);

    // No date filter in SQL: an opening keyed mid-year is in force from that
    // year's start, so `transDate <= from` would exclude it from its own year.
    const openings = await this.prisma.acctOpeningTrans.findMany({
      where: { kind: 'OPENING', custId: { in: custIds } },
      select: { custId: true, bankAmt: true, cashAmt: true, transDate: true, drCr: true },
    });
    /** custId → the start of the year that party's opening figure belongs to. */
    const anchor = new Map<number, Date>();
    for (const o of openings) {
      const book = books.get(o.custId);
      if (!book) continue;
      const effective = fyStart(o.transDate);
      if (effective > from) continue; // a later year's opening isn't in force yet
      const sign = (o.drCr ?? 'DEBIT').toUpperCase() === 'CREDIT' ? -1 : 1;
      book.openingBankNet += sign * (o.bankAmt ?? 0);
      book.openingCashNet += sign * (o.cashAmt ?? 0);
      book.hasOpening = true;
      const prev = anchor.get(o.custId);
      if (!prev || effective > prev) anchor.set(o.custId, effective);
    }

    const [challans, ledger] = await Promise.all([
      this.prisma.challan.findMany({
        where: { challanStatus: 'CONFIRMED', invDate: { lt: from }, customerId: { in: custIds } },
        select: { customerId: true, invDate: true, prefix: true, transaction: true, b: true, c: true },
      }),
      this.prisma.acctLedger.findMany({
        where: { transDate: { lt: from }, custId: { in: custIds } },
        select: { custId: true, transDate: true, bankDebit: true, bankCredit: true, cashDebit: true, cashCredit: true },
      }),
    ]);

    for (const ch of challans) {
      if (ch.customerId == null) continue;
      const book = books.get(ch.customerId);
      if (!book) continue;
      if (isDebitNoteChallan(ch.prefix, ch.transaction)) continue;
      if (ch.invDate < (anchor.get(ch.customerId) ?? EPOCH)) continue;
      book.openingBankNet += ch.b ?? 0;
      book.openingCashNet += ch.c ?? 0;
      // Pre-period trading is itself evidence of a balance to carry forward.
      book.hasOpening = true;
    }
    for (const l of ledger) {
      const book = books.get(l.custId);
      if (!book) continue;
      if (l.transDate < (anchor.get(l.custId) ?? EPOCH)) continue;
      book.openingBankNet += (l.bankDebit ?? 0) - (l.bankCredit ?? 0);
      book.openingCashNet += (l.cashDebit ?? 0) - (l.cashCredit ?? 0);
      book.hasOpening = true;
    }

    for (const book of books.values()) {
      book.openingBankNet = r2(book.openingBankNet);
      book.openingCashNet = r2(book.openingCashNet);
    }
  }

  /* ── per-party balance comparison ────────────────────────────────────────── */

  /**
   * Compares each party's *balance* against the register and works out where the
   * two stopped agreeing.
   *
   * The row report already says which vouchers differ, but a user reconciling by
   * hand asks a blunter question: does this party's bottom line agree, and if not,
   * from when? So both sides are walked as a running balance over the union of
   * their dates, and the first date they part company is recorded.
   *
   * The headline checkpoint is the **last receipt recorded in OMS**: if both sides
   * still agree as at that date, then nothing before it is at fault and the user
   * only has to look at what came after.
   *
   * Bank leg only, like everything else here — the register has no cash side.
   */
  private balanceFor(
    ledger: ParsedLedger,
    oms: OmsParty,
    from: Date,
    toExclusive: Date,
  ): Omit<BalanceRow, 'runId'> {
    const TOL = 1.0; // same rupee tolerance the row matcher uses

    const tallyOpening = r2(ledger.openingNet ?? 0);
    const omsOpening = r2(oms.openingBankNet);

    /** Dated bank movements, Dr positive. */
    const tallyMoves = ledger.vouchers.map((v) => ({ on: v.txnDate, amt: r2(v.debit - v.credit) }));
    const omsMoves = [
      ...oms.invoices.filter((i) => Math.abs(i.bank) > 0.004).map((i) => ({ on: i.invDate, amt: r2(i.bank) })),
      ...oms.vouchers.map((v) => ({ on: v.transDate, amt: r2(v.bankDr - v.bankCr) })),
    ].filter((m) => Math.abs(m.amt) > 0.004);

    const sum = (moves: { on: Date; amt: number }[], upto?: Date) =>
      r2(moves.reduce((t, m) => (upto && m.on > upto ? t : t + m.amt), 0));

    // Prefer the closing Tally itself states; fall back to arithmetic when the
    // register omits it.
    const tallyClosing = r2(ledger.closingNet ?? tallyOpening + sum(tallyMoves));
    const omsClosing = r2(omsOpening + sum(omsMoves));
    const difference = r2(tallyClosing - omsClosing);

    // The last receipt the user recorded inside the period.
    const receipts = oms.vouchers
      .filter((v) => v.voucherType.trim().toUpperCase() === 'RECEIPT' && Math.abs(v.bankDr - v.bankCr) > 0.004)
      .filter((v) => v.transDate >= from && v.transDate < toExclusive)
      .sort((a, b) => a.transDate.getTime() - b.transDate.getTime());
    const last = receipts.length ? receipts[receipts.length - 1] : null;

    const tallyAtLastReceipt = last ? r2(tallyOpening + sum(tallyMoves, last.transDate)) : null;
    const omsAtLastReceipt = last ? r2(omsOpening + sum(omsMoves, last.transDate)) : null;
    const agreedAtLastReceipt =
      tallyAtLastReceipt == null || omsAtLastReceipt == null ? null : Math.abs(tallyAtLastReceipt - omsAtLastReceipt) <= TOL;

    // Where they first part company. A difference already present in the opening
    // means they never agreed inside this period at all.
    let firstDivergenceOn: Date | null = null;
    if (Math.abs(tallyOpening - omsOpening) > TOL) {
      firstDivergenceOn = from;
    } else {
      const dates = [...new Set([...tallyMoves, ...omsMoves].map((m) => m.on.getTime()))].sort((a, b) => a - b);
      for (const t of dates) {
        const d = new Date(t);
        if (Math.abs(r2(tallyOpening + sum(tallyMoves, d)) - r2(omsOpening + sum(omsMoves, d))) > TOL) {
          firstDivergenceOn = d;
          break;
        }
      }
    }

    return {
      ledgerName: ledger.ledgerName,
      customerId: oms.customerId,
      customerName: oms.customerName,
      tallyOpening,
      omsOpening,
      tallyClosing,
      omsClosing,
      difference,
      matched: Math.abs(difference) <= TOL,
      lastReceiptDate: last?.transDate ?? null,
      lastReceiptRef: last?.voucherNo ?? null,
      tallyAtLastReceipt,
      omsAtLastReceipt,
      agreedAtLastReceipt,
      firstDivergenceOn,
      divergedAfterLastReceipt:
        !!last && !!firstDivergenceOn && agreedAtLastReceipt === true && firstDivergenceOn > last.transDate,
    };
  }

  /* ── run a reconciliation ────────────────────────────────────────────────── */

  async run(file: { buffer: Buffer; originalname: string }, userName?: string | null): Promise<ReconRunResult> {
    if (!file?.buffer?.length) throw new BadRequestException('No file was uploaded.');
    const register: ParsedRegister = await parseTallyRegister(file.buffer, file.originalname);
    const from = register.fromDate;
    // The register's own period drives the comparison window, as the user asked.
    const toExclusive = new Date(register.toDate.getTime() + DAY);

    const resolve = await this.buildResolver();
    const resolved = new Map<string, { id: number; name: string } | null>();
    for (const l of register.ledgers) resolved.set(l.ledgerName, resolve(l.ledgerName));

    const custIds = [...new Set([...resolved.values()].filter(Boolean).map((r) => r!.id))];
    const books = await this.loadOmsBooks(custIds, from, toExclusive);

    const rows: MatchRow[] = [];
    for (const ledger of register.ledgers) {
      const hit = resolved.get(ledger.ledgerName) ?? null;
      rows.push(...reconcileParty(ledger, hit ? books.get(hit.id) ?? null : null, from));
    }

    // Per-party balance verdicts — only possible where the ledger maps to a customer.
    const balances = register.ledgers
      .map((ledger) => {
        const hit = resolved.get(ledger.ledgerName) ?? null;
        const book = hit ? books.get(hit.id) : null;
        return book ? this.balanceFor(ledger, book, from, toExclusive) : null;
      })
      .filter((b): b is Omit<BalanceRow, 'runId'> => b !== null)
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

    // Carry forward whatever the user already decided about these same lines.
    const keyed = rows.map((r) => ({ row: r, issueKey: issueKeyOf(r) }));
    const marks = await this.marksFor(keyed.map((k) => k.issueKey));

    const count = (s: ReconStatus) => rows.filter((r) => r.status === s).length;
    const reviewCount = (v: string) => keyed.filter((k) => (marks.get(k.issueKey)?.review ?? 'OPEN') === v).length;
    const summary = {
      fileName: file.originalname,
      fromDate: from,
      toDate: register.toDate,
      userName: userName ?? null,
      ledgerCount: register.ledgers.length,
      voucherCount: register.ledgers.reduce((s, l) => s + l.vouchers.length, 0),
      matchedCount: count('MATCHED'),
      missingInOms: count('MISSING_IN_OMS'),
      missingInTally: count('MISSING_IN_TALLY'),
      mismatchCount: count('AMOUNT_MISMATCH') + count('DATE_MISMATCH'),
      unmatchedParty: count('UNMATCHED_PARTY'),
      pendingCount: reviewCount('PENDING'),
      solvedCount: reviewCount('SOLVED'),
      balanceCheckedCount: balances.length,
      balanceMismatchCount: balances.filter((b) => !b.matched).length,
    };

    const run = await this.prisma.tallyReconRun.create({
      data: {
        ...summary,
        rows: {
          create: keyed.map(({ row: r, issueKey }) => ({
            issueKey,
            review: marks.get(issueKey)?.review ?? 'OPEN',
            reviewNote: marks.get(issueKey)?.note ?? null,
            reviewedAt: marks.get(issueKey)?.reviewedAt ?? null,
            reviewedBy: marks.get(issueKey)?.reviewedBy ?? null,
            source: r.source,
            ledgerName: r.ledgerName,
            customerId: r.customerId,
            customerName: r.customerName,
            txnDate: r.txnDate,
            vchType: r.vchType,
            vchNo: r.vchNo,
            particulars: r.particulars,
            dr: r.dr,
            cr: r.cr,
            status: r.status,
            omsRef: r.omsRef,
            omsAmount: r.omsAmount,
            omsDate: r.omsDate,
            note: r.note,
          })),
        },
        balances: { create: balances },
      },
      select: { id: true },
    });

    return this.result(run.id);
  }

  /* ── reads ───────────────────────────────────────────────────────────────── */

  async runs(limit = 25): Promise<ReconRunSummary[]> {
    const list = await this.prisma.tallyReconRun.findMany({
      orderBy: { uploadedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return list.map((r) => this.toSummary(r));
  }

  async result(id: number): Promise<ReconRunResult> {
    const run = await this.prisma.tallyReconRun.findUnique({
      where: { id },
      include: {
        rows: { orderBy: [{ ledgerName: 'asc' }, { txnDate: 'asc' }, { id: 'asc' }] },
        // Worst difference first, so the parties needing attention lead.
        balances: { orderBy: [{ matched: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!run) throw new NotFoundException('That reconciliation run no longer exists.');
    const unmatchedLedgers = [...new Set(run.rows.filter((r) => r.status === 'UNMATCHED_PARTY').map((r) => r.ledgerName))].sort();
    return {
      ...this.toSummary(run),
      unmatchedLedgers,
      rows: run.rows.map((r) => this.toRow(run.uploadedAt, r)),
      balances: run.balances.map(
        (b): ReconPartyBalance => ({
          id: b.id,
          ledgerName: b.ledgerName,
          customerId: b.customerId,
          customerName: b.customerName,
          tallyOpening: b.tallyOpening,
          omsOpening: b.omsOpening,
          tallyClosing: b.tallyClosing,
          omsClosing: b.omsClosing,
          difference: b.difference,
          matched: b.matched,
          lastReceiptDate: iso(b.lastReceiptDate),
          lastReceiptRef: b.lastReceiptRef,
          tallyAtLastReceipt: b.tallyAtLastReceipt,
          omsAtLastReceipt: b.omsAtLastReceipt,
          agreedAtLastReceipt: b.agreedAtLastReceipt,
          firstDivergenceOn: iso(b.firstDivergenceOn),
          divergedAfterLastReceipt: b.divergedAfterLastReceipt,
        }),
      ),
    };
  }

  async remove(id: number): Promise<void> {
    const run = await this.prisma.tallyReconRun.findUnique({ where: { id }, select: { id: true } });
    if (!run) throw new NotFoundException('That reconciliation run no longer exists.');
    await this.prisma.tallyReconRun.delete({ where: { id } });
  }

  private toSummary(r: {
    id: number;
    fileName: string;
    fromDate: Date;
    toDate: Date;
    uploadedAt: Date;
    userName: string | null;
    ledgerCount: number;
    voucherCount: number;
    matchedCount: number;
    missingInOms: number;
    missingInTally: number;
    mismatchCount: number;
    unmatchedParty: number;
    pendingCount: number;
    solvedCount: number;
    balanceMismatchCount: number;
    balanceCheckedCount: number;
  }): ReconRunSummary {
    return {
      id: r.id,
      fileName: r.fileName,
      fromDate: r.fromDate.toISOString(),
      toDate: r.toDate.toISOString(),
      uploadedAt: r.uploadedAt.toISOString(),
      userName: r.userName,
      ledgerCount: r.ledgerCount,
      voucherCount: r.voucherCount,
      matchedCount: r.matchedCount,
      missingInOms: r.missingInOms,
      missingInTally: r.missingInTally,
      mismatchCount: r.mismatchCount,
      unmatchedParty: r.unmatchedParty,
      pendingCount: r.pendingCount,
      solvedCount: r.solvedCount,
      balanceMismatchCount: r.balanceMismatchCount,
      balanceCheckedCount: r.balanceCheckedCount,
    };
  }

  private toRow(runUploadedAt: Date | null, r: {
    id: number;
    source: string;
    ledgerName: string;
    customerId: number | null;
    customerName: string | null;
    txnDate: Date;
    vchType: string;
    vchNo: string;
    particulars: string | null;
    dr: number;
    cr: number;
    status: string;
    omsRef: string | null;
    omsAmount: number | null;
    omsDate: Date | null;
    note: string | null;
    resolvedAt: Date | null;
    resolvedRef: string | null;
    review: string;
    reviewNote: string | null;
    reviewedAt: Date | null;
    reviewedBy: string | null;
  }): ReconRow {
    return {
      id: r.id,
      source: r.source as ReconRow['source'],
      ledgerName: r.ledgerName,
      customerId: r.customerId,
      customerName: r.customerName,
      txnDate: r.txnDate.toISOString(),
      vchType: r.vchType as ReconRow['vchType'],
      vchNo: r.vchNo,
      particulars: r.particulars,
      dr: r.dr,
      cr: r.cr,
      status: r.status as ReconStatus,
      omsRef: r.omsRef,
      omsAmount: r.omsAmount,
      omsDate: iso(r.omsDate),
      note: r.note,
      resolvedAt: iso(r.resolvedAt),
      resolvedRef: r.resolvedRef,
      review: (r.review || 'OPEN') as ReconRow['review'],
      reviewNote: r.reviewNote,
      reviewedAt: iso(r.reviewedAt),
      reviewedBy: r.reviewedBy,
      // A mark predating this run's upload was inherited from an earlier one.
      reviewCarried: !!r.reviewedAt && !!runUploadedAt && r.reviewedAt < runUploadedAt,
    };
  }

  /* ── review marks ────────────────────────────────────────────────────────── */

  /** Existing marks for a batch of issue keys, keyed for O(1) lookup. */
  private async marksFor(
    issueKeys: string[],
  ): Promise<Map<string, { review: string; note: string | null; reviewedAt: Date; reviewedBy: string | null }>> {
    const out = new Map<string, { review: string; note: string | null; reviewedAt: Date; reviewedBy: string | null }>();
    const keys = [...new Set(issueKeys)];
    if (!keys.length) return out;
    // SQLite caps parameters per statement, so ask in chunks rather than one
    // 800-key IN clause.
    const CHUNK = 400;
    for (let i = 0; i < keys.length; i += CHUNK) {
      const found = await this.prisma.tallyReconMark.findMany({
        where: { issueKey: { in: keys.slice(i, i + CHUNK) } },
        select: { issueKey: true, review: true, note: true, reviewedAt: true, reviewedBy: true },
      });
      for (const m of found) out.set(m.issueKey, { review: m.review, note: m.note, reviewedAt: m.reviewedAt, reviewedBy: m.reviewedBy });
    }
    return out;
  }

  /**
   * Records the user's verdict on a set of report lines.
   *
   * The mark is written twice: onto the rows of this run (so the report reflects
   * it at once) and into `TallyReconMark` keyed by issue identity, which is what
   * makes it survive the next upload. Clearing deletes the durable mark instead of
   * storing OPEN, so a cleared issue genuinely starts fresh next time.
   */
  async markRows(input: { rowIds: number[]; review: string; note?: string | null }, userName?: string | null): Promise<MarkReconRowsResult> {
    const ids = [...new Set(input.rowIds ?? [])];
    if (!ids.length) throw new BadRequestException('Select at least one line to mark.');
    const review = (input.review ?? '').toUpperCase() as ReconReview;
    if (!['OPEN', 'PENDING', 'SOLVED'].includes(review)) throw new BadRequestException('Unknown review state.');

    const rows = await this.prisma.tallyReconRow.findMany({
      where: { id: { in: ids } },
      select: { id: true, runId: true, issueKey: true, ledgerName: true, vchType: true, vchNo: true, status: true },
    });
    if (!rows.length) throw new NotFoundException('Those report lines no longer exist.');

    // Marking a line that isn't a discrepancy is meaningless — there is nothing
    // to resolve — so those are skipped rather than silently accepted.
    const markable = rows.filter((r) => r.status !== 'MATCHED' && r.status !== 'NOT_APPLICABLE');
    if (!markable.length) throw new BadRequestException('Only flagged lines can be marked.');

    const note = input.note?.trim() ? input.note.trim() : null;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      if (review === 'OPEN') {
        await tx.tallyReconRow.updateMany({
          where: { id: { in: markable.map((r) => r.id) } },
          data: { review: 'OPEN', reviewNote: null, reviewedAt: null, reviewedBy: null },
        });
        await tx.tallyReconMark.deleteMany({ where: { issueKey: { in: markable.map((r) => r.issueKey) } } });
        return;
      }
      await tx.tallyReconRow.updateMany({
        where: { id: { in: markable.map((r) => r.id) } },
        data: { review, reviewNote: note, reviewedAt: now, reviewedBy: userName ?? null },
      });
      // One issue key can appear on several rows only if the register repeats a
      // voucher verbatim; upsert keeps that harmless.
      for (const r of markable) {
        await tx.tallyReconMark.upsert({
          where: { issueKey: r.issueKey },
          create: {
            issueKey: r.issueKey,
            review,
            note,
            reviewedAt: now,
            reviewedBy: userName ?? null,
            ledgerName: r.ledgerName,
            vchType: r.vchType,
            vchNo: r.vchNo,
          },
          update: { review, note, reviewedAt: now, reviewedBy: userName ?? null },
        });
      }
    });

    for (const runId of [...new Set(markable.map((r) => r.runId))]) await this.refreshCounts(runId);
    return { updated: markable.length };
  }

  /* ── aliases ─────────────────────────────────────────────────────────────── */

  async aliases(): Promise<TallyAliasDto[]> {
    const list = await this.prisma.tallyPartyAlias.findMany({ orderBy: { tallyName: 'asc' } });
    const ids = [...new Set(list.map((a) => a.customerId))];
    const customers = ids.length
      ? await this.prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, partyName: true } })
      : [];
    const nameById = new Map(customers.map((c) => [c.id, c.partyName]));
    return list.map((a) => ({
      id: a.id,
      tallyName: a.tallyName,
      customerId: a.customerId,
      customerName: nameById.get(a.customerId) ?? null,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async saveAlias(tallyName: string, customerId: number, userName?: string | null): Promise<TallyAliasDto> {
    const name = tallyName?.trim();
    if (!name) throw new BadRequestException('Tally ledger name is required.');
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, partyName: true } });
    if (!customer) throw new BadRequestException('Customer not found.');
    const saved = await this.prisma.tallyPartyAlias.upsert({
      where: { tallyName: name },
      create: { tallyName: name, customerId, createdBy: userName ?? null },
      update: { customerId, createdBy: userName ?? null },
    });
    return {
      id: saved.id,
      tallyName: saved.tallyName,
      customerId: saved.customerId,
      customerName: customer.partyName,
      createdAt: saved.createdAt.toISOString(),
    };
  }

  async removeAlias(id: number): Promise<void> {
    await this.prisma.tallyPartyAlias.deleteMany({ where: { id } });
  }

  /* ── quick receipt entry from the report ─────────────────────────────────── */

  /**
   * Posts the OMS receipts that a set of MISSING_IN_OMS receipt rows describe.
   *
   * Each row becomes one receipt through the ordinary payments engine, so the
   * allocation waterfall, voucher numbering and ledger double-entry are identical
   * to a receipt keyed by hand. Rows are posted one at a time and reported
   * individually: one party failing must not roll back the rest.
   */
  async createReceipts(input: ReconCreateReceiptInput, userName?: string | null): Promise<ReconCreateReceiptResult> {
    const ids = [...new Set(input.rowIds ?? [])];
    if (!ids.length) throw new BadRequestException('Select at least one receipt to enter.');

    const rows = await this.prisma.tallyReconRow.findMany({ where: { id: { in: ids } } });
    const created: ReconCreateReceiptResult['created'] = [];
    const failed: ReconCreateReceiptResult['failed'] = [];

    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      if (!row) {
        failed.push({ rowId: id, reason: 'Row not found.' });
        continue;
      }
      if (row.vchType !== 'RECEIPT') {
        failed.push({ rowId: id, reason: 'Only missing receipts can be entered from the report.' });
        continue;
      }
      if (row.status !== 'MISSING_IN_OMS') {
        failed.push({ rowId: id, reason: `This row is ${row.status.replace(/_/g, ' ').toLowerCase()}, not a missing receipt.` });
        continue;
      }
      if (row.resolvedAt) {
        failed.push({ rowId: id, reason: `Already entered as ${row.resolvedRef ?? 'a receipt'}.` });
        continue;
      }
      if (!row.customerId) {
        failed.push({ rowId: id, reason: 'No OMS customer is mapped to this Tally ledger name.' });
        continue;
      }
      // A receipt reduces the receivable, so the register shows it on the credit side.
      const amount = r2(row.cr || row.dr);
      if (amount <= 0) {
        failed.push({ rowId: id, reason: 'Receipt amount is zero.' });
        continue;
      }

      // The register's particulars name the receiving bank ("AXIS BANK LTD"), or
      // read "Cash" when it never went through one.
      const particulars = (row.particulars ?? '').trim();
      const isCash = /^cash$/i.test(particulars);
      const bankName = input.bankName?.trim() || (isCash ? null : particulars || null);

      try {
        const res = await this.payments.save(
          {
            takeAccOn: 'PARTY',
            customerId: row.customerId,
            payMode: isCash ? 'CASH' : 'BANK',
            bankName: isCash ? null : bankName,
            adjMode: input.adjMode?.trim() || 'AUTOMATIC',
            receiptAmt: amount,
            recDate: ymd(row.txnDate),
            remarks: `Tally recon — register voucher ${row.vchNo || '(no number)'}`,
          },
          userName,
        );
        const voucherNo = res?.voucherNo ?? '';
        await this.prisma.tallyReconRow.update({
          where: { id: row.id },
          data: {
            status: 'MATCHED',
            resolvedAt: new Date(),
            resolvedRef: voucherNo || 'entered',
            // Genuinely dealt with, so it reads as solved in the report. No durable
            // mark is needed: the receipt now exists, so the next upload matches it
            // and never flags it again.
            review: 'SOLVED',
            reviewNote: `Receipt entered from the report${voucherNo ? ` as ${voucherNo}` : ''}.`,
            reviewedAt: new Date(),
            reviewedBy: userName ?? null,
            omsRef: voucherNo || row.omsRef,
            omsAmount: amount,
            omsDate: row.txnDate,
            note: `Entered from the reconciliation report${voucherNo ? ` as ${voucherNo}` : ''}.`,
          },
        });
        created.push({ rowId: row.id, voucherNo, amount, customerName: row.customerName ?? row.ledgerName });
      } catch (e) {
        failed.push({ rowId: id, reason: e instanceof Error ? e.message : 'Could not post this receipt.' });
      }
    }

    if (created.length) {
      const createdIds = new Set(created.map((c) => c.rowId));
      const touched = [...new Set(rows.filter((r) => createdIds.has(r.id)).map((r) => r.runId))];
      for (const runId of touched) await this.refreshCounts(runId);
    }
    return { created, failed };
  }

  /** Recompute a run's headline counts after rows were resolved. */
  private async refreshCounts(runId: number): Promise<void> {
    const grouped = await this.prisma.tallyReconRow.groupBy({
      by: ['status'],
      where: { runId },
      _count: { _all: true },
    });
    const of = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;
    const byReview = await this.prisma.tallyReconRow.groupBy({
      by: ['review'],
      where: { runId },
      _count: { _all: true },
    });
    const reviewed = (v: string) => byReview.find((g) => g.review === v)?._count._all ?? 0;
    await this.prisma.tallyReconRun.update({
      where: { id: runId },
      data: {
        matchedCount: of('MATCHED'),
        missingInOms: of('MISSING_IN_OMS'),
        missingInTally: of('MISSING_IN_TALLY'),
        mismatchCount: of('AMOUNT_MISMATCH') + of('DATE_MISMATCH'),
        unmatchedParty: of('UNMATCHED_PARTY'),
        pendingCount: reviewed('PENDING'),
        solvedCount: reviewed('SOLVED'),
      },
    });
  }
}
