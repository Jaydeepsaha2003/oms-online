import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ReconCreateOpeningInput,
  ReconCreateOpeningResult,
  ReconMatchOpeningInput,
  ReconMatchOpeningResult,
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
  UnmappedLedger,
  UnmappedLedgers,
} from '@oms/shared';
import { payByFor } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { loadLedgerGroups, type LedgerGroups } from '../account-groups/ledger-groups';
import { PaymentsService } from '../payments/payments.service';
import { OpeningBalancesService } from '../opening-balances/opening-balances.service';
import { omsCodeCandidates, parseTallyRegister, type ParsedLedger, type ParsedRegister } from './tally-register.parser';
import { exactKey, nameKey, reconcileParty, type MatchRow, type OmsParty } from './tally-recon.matcher';

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
/** The reverse of the JSON.stringify done when a merged balance row is
 *  persisted — see compare()'s balanceData. Malformed/empty stays null rather
 *  than throwing, same spirit as parseTallyRegister's other defensive reads. */
function parseSourceLedgerNames(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : null;
  } catch {
    return null;
  }
}

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
  /** Set by the caller (compare()) when this row combines 2+ Tally ledger
   *  names — see mergeLedgersForBalance. balanceFor itself always leaves this
   *  null; it only ever sees whatever ledger it was handed. */
  sourceLedgerNames: string[] | null;
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

/**
 * Turn a stored register back into a ParsedRegister.
 *
 * JSON.stringify flattens every Date to an ISO string, and the whole comparison
 * does arithmetic on those dates (`getTime`, day gaps, period windows) — so they
 * have to be Dates again before the register is handed back to it. Reviving is
 * explicit rather than a JSON.parse reviver keyed on field names: the shape is
 * small, fixed and known, and a name-matching reviver would silently start
 * converting any future string field that happened to look like a date.
 */
function reviveRegister(json: string): ParsedRegister {
  const raw = JSON.parse(json) as unknown as ParsedRegister;
  const date = (v: unknown) => new Date(v as string);
  const orNull = (v: unknown) => (v == null ? null : date(v));
  return {
    fromDate: date(raw.fromDate),
    toDate: date(raw.toDate),
    ledgers: (raw.ledgers ?? []).map((l) => ({
      ...l,
      openingDate: orNull(l.openingDate),
      vouchers: (l.vouchers ?? []).map((v) => ({ ...v, txnDate: date(v.txnDate) })),
    })),
  };
}

@Injectable()
export class TallyReconService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly openings: OpeningBalancesService,
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

  /** Splits no-OMS-match ledger names by their Tally group: parties (under
   *  Sundry Debtors, or group unknown) still need a mapping; the rest are not parties. */
  private bucketLedgers(names: string[], groups: LedgerGroups): UnmappedLedgers {
    const party: UnmappedLedger[] = [];
    const other: UnmappedLedger[] = [];
    for (const name of [...names].sort()) {
      const group = groups.groupOf(name);
      (group && !groups.isParty(group) ? other : party).push({ name, group });
    }
    return { party, other };
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

    // Receipts taken against the AGENT of a party whose bank money comes
    // through one — matchable, never counted as the party's own (see viaAgent).
    const routed = (await this.prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, payBy: true, payByModes: true, agentName: true } }))
      .filter((c) => c.agentName?.trim() && payByFor(c, 'bank') === 'AGENT');
    const agents = [...new Set(routed.map((c) => c.agentName!.trim()))];
    if (agents.length) {
      const agentVouchers = await this.prisma.acctLedger.findMany({
        where: { custId: 0, agentName: { in: agents }, voucherType: 'RECEIPT', bankCredit: { gt: 0 }, transDate: { gte: from, lt: toExclusive } },
        select: { voucherNo: true, transDate: true, particulars: true, bankCredit: true, agentName: true },
      });
      for (const c of routed) {
        const book = books.get(c.id);
        for (const v of agentVouchers.filter((a) => a.agentName === c.agentName!.trim())) {
          book?.vouchers.push({ voucherNo: v.voucherNo, transDate: v.transDate, voucherType: 'RECEIPT', particulars: v.particulars, bankDr: 0, bankCr: r2(v.bankCredit), cashDr: 0, cashCr: 0, viaAgent: v.agentName! });
        }
      }
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
      ...oms.vouchers.filter((v) => !v.viaAgent).map((v) => ({ on: v.transDate, amt: r2(v.bankDr - v.bankCr) })),
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
      .filter((v) => !v.viaAgent && v.voucherType.trim().toUpperCase() === 'RECEIPT' && Math.abs(v.bankDr - v.bankCr) > 0.004)
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
      sourceLedgerNames: null,
    };
  }

  /**
   * Combines 2+ Tally ledger names for the SAME OMS customer into one
   * ParsedLedger-shaped position, so the party gets exactly one (correct)
   * balance and one voucher match, instead of one (wrong) of each per name.
   *
   * openingNet: summed across whichever ledgers actually carry one — the
   * usual case is exactly one does, but this adds
   * correctly even if more than one genuinely does.
   * closingNet: left null on purpose rather than trying to combine each
   * ledger's own STATED closing — those aren't independently meaningful once
   * merged. balanceFor already falls back to opening + summed moves when
   * closingNet is null, which is exactly right for a combined ledger.
   * ledgerName: the member with the most recent voucher activity — the name
   * someone looking at Tally today would actually recognise as current.
   * vouchers: every member's vouchers, concatenated — each already carries
   * its own date and amount, so there is nothing to reconcile between them.
   */
  private mergeLedgersForBalance(ledgers: ParsedLedger[]): ParsedLedger {
    const openings = ledgers.map((l) => l.openingNet).filter((n): n is number => n != null);
    const latestVoucherDate = (l: ParsedLedger) =>
      l.vouchers.reduce((max, v) => (v.txnDate > max ? v.txnDate : max), new Date(0));
    const mostRecent = [...ledgers].sort((a, b) => latestVoucherDate(b).getTime() - latestVoucherDate(a).getTime())[0];
    return {
      ledgerName: mostRecent.ledgerName,
      openingNet: openings.length ? r2(openings.reduce((s, n) => s + n, 0)) : null,
      openingDate: mostRecent.openingDate,
      closingNet: null,
      vouchers: ledgers.flatMap((l) => l.vouchers),
    };
  }

  /* ── run a reconciliation ────────────────────────────────────────────────── */

  async run(file: { buffer: Buffer; originalname: string }, userName?: string | null): Promise<ReconRunResult> {
    if (!file?.buffer?.length) throw new BadRequestException('No file was uploaded.');
    const register: ParsedRegister = await parseTallyRegister(file.buffer, file.originalname);
    const built = await this.compare(register, file.originalname, userName ?? null);

    const run = await this.prisma.tallyReconRun.create({
      data: {
        ...built.summary,
        // Kept so mapping a ledger later can replay this same comparison
        // without the workbook — see rerun().
        registerJson: JSON.stringify(register),
        rows: { create: built.rowData },
        balances: { create: built.balances },
      },
      select: { id: true },
    });

    return this.result(run.id);
  }

  /**
   * Re-reconcile a run in place, from the register stored on it.
   *
   * This is what makes mapping an unmatched ledger take effect immediately.
   * Before, the mapping was saved and the report left untouched, so the user
   * was told to upload the same workbook again just to see the party move out
   * of "Party not mapped" — for a change that alters nothing about the register.
   *
   * IN PLACE, keeping the run's id: the user stays on the report they were
   * reading, and the history list does not fill up with near-identical runs of
   * the same file. Marks survive by `issueKey`, exactly as they do across
   * uploads, so a line already marked solved stays marked.
   */
  async rerun(id: number, userName?: string | null): Promise<ReconRunResult> {
    const run = await this.prisma.tallyReconRun.findUnique({
      where: { id },
      select: { id: true, fileName: true, registerJson: true, userName: true },
    });
    if (!run) throw new NotFoundException('That reconciliation run no longer exists.');
    if (!run.registerJson) {
      throw new BadRequestException(
        'This reconciliation was recorded before registers were kept, so it cannot be re-checked on its own. Upload the register again.',
      );
    }
    const register = reviveRegister(run.registerJson);
    const built = await this.compare(register, run.fileName, userName ?? run.userName);

    // One transaction: a half-replaced report — new rows against the old
    // counters, or no rows at all if the second write failed — would be read as
    // a reconciliation result.
    await this.prisma.$transaction(async (tx) => {
      await tx.tallyReconRow.deleteMany({ where: { runId: id } });
      await tx.tallyReconBalance.deleteMany({ where: { runId: id } });
      await tx.tallyReconRun.update({
        where: { id },
        data: {
          ...built.summary,
          // fileName and uploadedAt stay as they were: this is the same
          // register being re-read, not a new upload.
          fileName: run.fileName,
          rows: { create: built.rowData },
          balances: { create: built.balances },
        },
      });
    });

    return this.result(id);
  }

  /**
   * The comparison itself: register in, rows + balances + counters out.
   *
   * Shared by the upload and the replay so the two can never diverge — a second
   * copy of this for the replay would be a second reconciliation engine, and
   * the report would eventually depend on which route produced it.
   */
  private async compare(register: ParsedRegister, fileName: string, userName: string | null) {
    const from = register.fromDate;
    // The register's own period drives the comparison window, as the user asked.
    const toExclusive = new Date(register.toDate.getTime() + DAY);

    const resolve = await this.buildResolver();
    const resolved = new Map<string, { id: number; name: string } | null>();
    for (const l of register.ledgers) resolved.set(l.ledgerName, resolve(l.ledgerName));

    const custIds = [...new Set([...resolved.values()].filter(Boolean).map((r) => r!.id))];
    const books = await this.loadOmsBooks(custIds, from, toExclusive);
    const groups = await loadLedgerGroups(this.prisma);

    /*
     * Every Tally ledger mapped to the same OMS customer is matched as ONE
     * ledger (PNB: "PNB KITCHENMATE LTD BAHALGARH" and "... PVT. LTD. (OLD)").
     * Matching each on its own handed both the whole OMS book, so an entry
     * Tally keeps under the other ledger was reported missing — once per
     * ledger. Each Tally row still shows under its own ledger name.
     */
    const rows: MatchRow[] = [];
    const done = new Set<string>();
    for (const ledger of register.ledgers) {
      if (done.has(ledger.ledgerName)) continue;
      const hit = resolved.get(ledger.ledgerName) ?? null;
      if (hit) {
        const siblings = register.ledgers.filter((l) => resolved.get(l.ledgerName)?.id === hit.id);
        for (const l of siblings) done.add(l.ledgerName);
        rows.push(...reconcileParty(siblings.length > 1 ? this.mergeLedgersForBalance(siblings) : ledger, books.get(hit.id) ?? null, from));
        continue;
      }
      const group = groups.groupOf(ledger.ledgerName);
      rows.push(...reconcileParty(ledger, null, from, group && !groups.isParty(group) ? group : null));
    }

    // A bill Tally keeps under this party but OMS under another: say whose, so
    // the fix is a party correction, not re-keying a bill that already exists.
    const lost = rows.filter((r) => r.status === 'MISSING_IN_OMS' && r.vchType === 'SALES' && r.customerId);
    if (lost.length) {
      const codes = [...new Set(lost.flatMap((r) => omsCodeCandidates(r.vchNo)))];
      const elsewhere = new Map((await this.prisma.challan.findMany({ where: { code: { in: codes } }, select: { code: true, customerId: true, customerName: true, challanStatus: true } })).map((c) => [c.code, c]));
      for (const r of lost) {
        const c = omsCodeCandidates(r.vchNo).map((k) => elsewhere.get(k)).find(Boolean);
        if (c && c.customerId !== r.customerId) r.note = `${c.code} is in OMS under ${c.customerName}${c.challanStatus !== 'CONFIRMED' ? ` (${c.challanStatus.toLowerCase()})` : ''} — Tally has it under this party. Correct the party on one side.`;
        else if (c && c.challanStatus !== 'CONFIRMED') r.note = `${c.code} is in OMS but ${c.challanStatus.toLowerCase()}.`;
      }
    }

    // Per-party balance verdicts — only possible where the ledger maps to a customer.
    // One balance ROW per OMS customer, not per Tally ledger name. A party
    // renamed in Tally can have 2+ ledger names in one register (see
    // findOpeningCarriers); a balance is fundamentally ONE number per party,
    // so comparing each Tally ledger's own PARTIAL opening+moves against the
    // SAME full OMS position independently produced one wrong balance per
    // ledger instead of one right one. Grouped by customer first so a
    // multi-ledger party gets its ledgers combined before the verdict —
    // see mergeLedgersForBalance.
    const ledgersByCustomer = new Map<number, ParsedLedger[]>();
    for (const ledger of register.ledgers) {
      const hit = resolved.get(ledger.ledgerName);
      if (!hit) continue;
      const arr = ledgersByCustomer.get(hit.id) ?? [];
      arr.push(ledger);
      ledgersByCustomer.set(hit.id, arr);
    }
    const balances = [...ledgersByCustomer.entries()]
      .map(([custId, ledgers]) => {
        const book = books.get(custId);
        if (!book) return null;
        if (ledgers.length === 1) return this.balanceFor(ledgers[0], book, from, toExclusive);
        const merged = this.mergeLedgersForBalance(ledgers);
        return { ...this.balanceFor(merged, book, from, toExclusive), sourceLedgerNames: ledgers.map((l) => l.ledgerName) };
      })
      .filter((b): b is Omit<BalanceRow, 'runId'> => b !== null)
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

    // Carry forward whatever the user already decided about these same lines.
    const keyed = rows.map((r) => ({ row: r, issueKey: issueKeyOf(r) }));
    const marks = await this.marksFor(keyed.map((k) => k.issueKey));

    const count = (s: ReconStatus) => rows.filter((r) => r.status === s).length;
    const reviewCount = (v: string) => keyed.filter((k) => (marks.get(k.issueKey)?.review ?? 'OPEN') === v).length;
    const summary = {
      fileName,
      fromDate: from,
      toDate: register.toDate,
      userName,
      ledgerCount: register.ledgers.length,
      voucherCount: register.ledgers.reduce((s, l) => s + l.vouchers.length, 0),
      matchedCount: count('MATCHED'),
      missingInOms: count('MISSING_IN_OMS'),
      missingInTally: count('MISSING_IN_TALLY'),
      mismatchCount: count('AMOUNT_MISMATCH') + count('DATE_MISMATCH'),
      unmatchedParty: count('UNMATCHED_PARTY'),
      bankMismatchCount: count('BANK_MISMATCH'),
      pendingCount: reviewCount('PENDING'),
      solvedCount: reviewCount('SOLVED'),
      balanceCheckedCount: balances.length,
      balanceMismatchCount: balances.filter((b) => !b.matched).length,
    };

    const rowData = keyed.map(({ row: r, issueKey }) => ({
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
      omsBank: r.omsBank,
      note: r.note,
    }));

    // sourceLedgerNames is a string[] in BalanceRow (structured, for anything
    // that wants to work with it in memory) but the DB column is TEXT — same
    // JSON-in-TEXT idiom as registerJson above, encoded here since this is
    // the one place `balances` turns into something Prisma's `create` will
    // accept.
    const balanceData = balances.map((b) => ({ ...b, sourceLedgerNames: b.sourceLedgerNames ? JSON.stringify(b.sourceLedgerNames) : null }));

    return { summary, rowData, balances: balanceData };
  }

  /* ── reads ───────────────────────────────────────────────────────────────── */

  async runs(limit = 25): Promise<ReconRunSummary[]> {
    const take = Math.min(Math.max(limit, 1), 100);
    /*
     * Every column EXCEPT registerJson.
     *
     * The history list only needs to know WHETHER a register is stored, and a
     * bare findMany would have pulled up to 100 whole registers — hundreds of
     * kilobytes each — into memory to answer a boolean. The flags come from the
     * query below, which tests for null without reading the text.
     */
    const list = await this.prisma.tallyReconRun.findMany({
      orderBy: { uploadedAt: 'desc' },
      take,
      select: {
        id: true,
        fileName: true,
        fromDate: true,
        toDate: true,
        uploadedAt: true,
        userName: true,
        ledgerCount: true,
        voucherCount: true,
        matchedCount: true,
        missingInOms: true,
        missingInTally: true,
        mismatchCount: true,
        unmatchedParty: true,
        bankMismatchCount: true,
        pendingCount: true,
        solvedCount: true,
        balanceMismatchCount: true,
        balanceCheckedCount: true,
      },
    });
    if (!list.length) return [];
    const flags = await this.prisma.$queryRaw<{ id: number; hasRegister: number }[]>`
      SELECT id, CASE WHEN registerJson IS NULL THEN 0 ELSE 1 END AS hasRegister
      FROM tally_recon_run
    `;
    const stored = new Set(flags.filter((f) => Number(f.hasRegister) === 1).map((f) => Number(f.id)));
    return list.map((r) => this.toSummary({ ...r, registerJson: stored.has(r.id) ? 'stored' : null }));
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
    // customerId is null for exactly the rows with no OMS match.
    const uncategorizedNames = [...new Set(run.rows.filter((r) => r.customerId == null).map((r) => r.ledgerName))];
    const unmatchedLedgers = this.bucketLedgers(uncategorizedNames, await loadLedgerGroups(this.prisma));
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
          sourceLedgerNames: parseSourceLedgerNames(b.sourceLedgerNames),
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
    bankMismatchCount: number;
    /** Selected, not read: the caller passes whether a register is stored, and
     *  only its presence matters — the JSON itself is never sent to the client. */
    registerJson?: string | null;
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
      bankMismatchCount: r.bankMismatchCount,
      canRerun: !!r.registerJson,
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
    omsBank: string | null;
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
      omsBank: r.omsBank,
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

      // Collected the way Receive Payment would: a party whose money comes
      // through its agent is receipted on the agent (the same rule Bank Reco uses).
      const customer = await this.prisma.customer.findUnique({ where: { id: row.customerId }, select: { payBy: true, payByModes: true, agentName: true } });
      const agentName = customer?.agentName?.trim() || null;
      const viaAgent = !!customer && !!agentName && payByFor(customer, isCash ? 'cash' : 'bank') === 'AGENT';

      /*
       * Never a second copy of money already in OMS. The report only compares
       * this party's own receipts, so a payment taken against the agent or a
       * sister party of the same agent (BK METAL's 29 May ₹95,800 sits under
       * agent B KUMAR as RN/869) reads as missing here. Same amount within
       * 3 days is refused, naming the receipt to look at.
       */
      const sisters = agentName ? (await this.prisma.customer.findMany({ where: { agentName }, select: { id: true } })).map((c) => c.id) : [];
      const twin = await this.prisma.acctLedger.findFirst({
        where: {
          voucherType: 'RECEIPT',
          OR: [{ bankCredit: { gte: amount - 0.5, lte: amount + 0.5 } }, { cashCredit: { gte: amount - 0.5, lte: amount + 0.5 } }],
          transDate: { gte: new Date(row.txnDate.getTime() - 3 * DAY), lte: new Date(row.txnDate.getTime() + 3 * DAY) },
          AND: [{ OR: [{ custId: row.customerId }, ...(agentName ? [{ custId: 0, agentName }, { custId: { in: sisters } }] : [])] }],
        },
        select: { voucherNo: true, transDate: true, customerName: true, custId: true },
      });
      if (twin) {
        failed.push({
          rowId: id,
          reason: `${twin.voucherNo} (${ymd(twin.transDate)}, ${amount.toFixed(2)}) is already in OMS${twin.custId === 0 ? ` under agent ${twin.customerName}` : twin.custId !== row.customerId ? ` for ${twin.customerName}` : ''} — most likely this same payment, so it was not entered again. If it really is a different payment, enter it in Receive Payment.`,
        });
        continue;
      }

      try {
        const res = await this.payments.save(
          {
            takeAccOn: viaAgent ? 'AGENT' : 'PARTY',
            customerId: viaAgent ? undefined : row.customerId,
            agentName: viaAgent ? agentName : undefined,
            payMode: isCash ? 'CASH' : 'BANK',
            bankName: isCash ? null : bankName,
            // Receive Payment asks where cash was handed over and to whom; the
            // register only says "Cash", so say where this one came from.
            cashTransLocation: isCash ? 'AS PER TALLY' : null,
            cashRecBy: isCash ? (userName?.trim() || 'TALLY RECON') : null,
            adjMode: input.adjMode?.trim() || 'AUTOMATIC',
            receiptAmt: amount,
            recDate: ymd(row.txnDate),
            remarks: `Tally recon — register voucher ${row.vchNo || '(no number)'}`,
          },
          userName,
          undefined,
          `TALLY_RECON_ROW:${row.id}`,
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

  /**
   * Creates the OMS opening balances that a set of OPENING rows describe.
   *
   * Same shape as {@link createReceipts}, and for the same reason: the row
   * already holds the party, the date, the amount and the side, so re-keying it
   * into Opening Balances is copying from one screen to another. Each one goes
   * through OpeningBalancesService so it is stored exactly as a hand-keyed
   * opening — including the "opening settled" flag on a party added from Tally,
   * which nothing here would have known to set.
   *
   * The register is the BANK leg of the account, so the figure is a bank
   * opening. Rows are created one at a time and reported individually: one
   * party failing must not take the rest with it.
   */
  async createOpenings(input: ReconCreateOpeningInput, userName?: string | null): Promise<ReconCreateOpeningResult> {
    const ids = [...new Set(input.rowIds ?? [])];
    if (!ids.length) throw new BadRequestException('Select at least one opening balance to add.');

    const rows = await this.prisma.tallyReconRow.findMany({
      where: { id: { in: ids } },
      include: { run: { select: { fromDate: true } } },
    });
    const created: ReconCreateOpeningResult['created'] = [];
    const failed: ReconCreateOpeningResult['failed'] = [];

    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      if (!row) {
        failed.push({ rowId: id, reason: 'Row not found.' });
        continue;
      }
      if (row.vchType !== 'OPENING') {
        failed.push({ rowId: id, reason: 'Only an opening balance row can be added this way.' });
        continue;
      }
      if (row.resolvedAt) {
        failed.push({ rowId: id, reason: 'Already added from this report.' });
        continue;
      }
      if (!row.customerId) {
        failed.push({ rowId: id, reason: 'No OMS customer is mapped to this Tally ledger name.' });
        continue;
      }
      /*
       * Only where OMS holds nothing yet.
       *
       * A row saying "Tally 3562 vs OMS 0" is an opening OMS never received. A
       * row where both sides carry a figure is a DISAGREEMENT, and adding a
       * second opening on top would make the party's books wrong in a new way
       * rather than fix them — that one has to be settled by hand.
       */
      if (Math.abs(row.omsAmount ?? 0) > 0.004) {
        failed.push({ rowId: id, reason: `OMS already holds an opening of ${(row.omsAmount ?? 0).toFixed(2)} for this party — settle the difference by hand.` });
        continue;
      }

      // The report is only a snapshot. Re-check the live books immediately
      // before creating anything so a later opening, or another pre-period
      // posting, cannot turn this action into a duplicate or a wrong balance.
      const allOpenings = await this.prisma.acctOpeningTrans.findMany({
        where: { kind: 'OPENING', custId: row.customerId },
        select: { transDate: true },
      });
      if (allOpenings.some((o) => fyStart(o.transDate) <= row.run.fromDate)) {
        failed.push({ rowId: id, reason: 'OMS already has an opening for this period. Re-check the report, then use Match opening.' });
        continue;
      }
      const toExclusive = new Date(row.run.fromDate.getTime() + DAY);
      const currentBook = (await this.loadOmsBooks([row.customerId], row.run.fromDate, toExclusive)).get(row.customerId);
      const currentAmount = r2(currentBook?.openingBankNet ?? 0);
      if (Math.abs(currentAmount - (row.omsAmount ?? 0)) > 0.004) {
        failed.push({ rowId: id, reason: 'The OMS balance changed after this report was created. Re-check the report, then try again.' });
        continue;
      }
      // Tally states an opening on the side it falls: Dr = the party owes us.
      const amount = r2(Math.max(row.dr || 0, row.cr || 0));
      const drCr = (row.dr || 0) >= (row.cr || 0) ? 'DEBIT' : 'CREDIT';
      if (amount <= 0) {
        failed.push({ rowId: id, reason: 'Opening amount is zero.' });
        continue;
      }

      try {
        await this.openings.create(
          {
            customerId: row.customerId,
            transDate: ymd(row.txnDate),
            bankAmt: amount,
            cashAmt: 0,
            drCr,
            remarks: `Tally recon — opening from ${row.ledgerName}`,
          },
          userName,
        );
        await this.prisma.tallyReconRow.update({
          where: { id: row.id },
          data: {
            status: 'MATCHED',
            resolvedAt: new Date(),
            resolvedRef: 'Opening Balance',
            review: 'SOLVED',
            reviewNote: 'Opening balance added to OMS from the report.',
            reviewedAt: new Date(),
            reviewedBy: userName ?? null,
            omsAmount: amount,
            omsDate: row.txnDate,
            note: `Opening of ${amount.toFixed(2)} (${drCr === 'DEBIT' ? 'Dr' : 'Cr'}) added to OMS from this report.`,
          },
        });
        created.push({ rowId: row.id, customerName: row.customerName ?? row.ledgerName, amount, drCr });
      } catch (e) {
        failed.push({ rowId: id, reason: e instanceof Error ? e.message : 'Could not add this opening balance.' });
      }
    }

    if (created.length) {
      const createdIds = new Set(created.map((c) => c.rowId));
      const touched = [...new Set(rows.filter((r) => createdIds.has(r.id)).map((r) => r.runId))];
      for (const runId of touched) await this.refreshCounts(runId);
    }
    return { created, failed };
  }

  /**
   * Makes an existing OMS bank opening agree with an OPENING row from Tally.
   *
   * The report's OMS figure is a brought-forward balance: stored opening plus
   * every OMS movement before the register period. Therefore this applies only
   * the reported difference to the stored opening anchor. Replacing the anchor
   * with Tally's total would count those earlier movements twice.
   *
   * One effective opening record is required. With two, choosing which record
   * to edit would be guesswork. The update and the row resolution are one
   * transaction, and the opening values are included in the update predicate so
   * a concurrent edit cannot be silently overwritten.
   */
  async matchOpenings(input: ReconMatchOpeningInput, userName?: string | null): Promise<ReconMatchOpeningResult> {
    const ids = [...new Set(input.rowIds ?? [])];
    if (!ids.length) throw new BadRequestException('Select at least one opening balance to match.');

    const rows = await this.prisma.tallyReconRow.findMany({
      where: { id: { in: ids } },
      include: { run: { select: { fromDate: true, registerJson: true } } },
    });
    const updated: ReconMatchOpeningResult['updated'] = [];
    const failed: ReconMatchOpeningResult['failed'] = [];
    const touchedRuns = new Map<number, boolean>();

    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      if (!row) {
        failed.push({ rowId: id, reason: 'Row not found.' });
        continue;
      }
      if (row.vchType !== 'OPENING' || row.status !== 'AMOUNT_MISMATCH') {
        failed.push({ rowId: id, reason: 'Only an opening row whose amount differs can be matched.' });
        continue;
      }
      if (row.resolvedAt) {
        failed.push({ rowId: id, reason: 'This opening difference has already been resolved.' });
        continue;
      }
      if (!row.customerId) {
        failed.push({ rowId: id, reason: 'No OMS customer is mapped to this Tally ledger name.' });
        continue;
      }

      try {
        const allOpenings = await this.prisma.acctOpeningTrans.findMany({
          where: { kind: 'OPENING', custId: row.customerId },
          orderBy: { id: 'asc' },
        });
        const effective = allOpenings.filter((o) => fyStart(o.transDate) <= row.run.fromDate);
        if (effective.length > 1) {
          failed.push({ rowId: id, reason: 'Multiple OMS opening records affect this period. Edit them in Opening Balance so the system does not guess which record to change.' });
          continue;
        }

        // Re-read today's brought-forward amount. The saved report value may be
        // stale if somebody edited the party after this report was opened.
        const toExclusive = new Date(row.run.fromDate.getTime() + DAY);
        const currentBook = (await this.loadOmsBooks([row.customerId], row.run.fromDate, toExclusive)).get(row.customerId);
        const currentAmount = r2(currentBook?.openingBankNet ?? 0);
        if (row.omsAmount == null || Math.abs(currentAmount - row.omsAmount) > 0.004) {
          failed.push({ rowId: id, reason: 'The OMS opening changed after this report was created. Re-check the report, then try again.' });
          continue;
        }

        const tallyAmount = r2((row.dr || 0) - (row.cr || 0));
        if (!effective.length) {
          /*
           * No opening record: OMS's brought-forward figure is its own bills and
           * receipts from before the period (RIDDHI SIDDHI's two scrap bills).
           * Record the difference as an opening dated at the start of the year
           * of the party's EARLIEST document, so none of those documents drops
           * out of the arithmetic — the brought-forward then equals Tally's.
           * An opening in our favour (Cr) is money on account and settles the
           * old bills; one in the party's (Dr) is cleared by the next receipts.
           */
          const diff = r2(tallyAmount - currentAmount);
          const [firstBill, firstVoucher] = await Promise.all([
            this.prisma.challan.findFirst({ where: { customerId: row.customerId, challanStatus: 'CONFIRMED', invDate: { lt: row.run.fromDate } }, orderBy: { invDate: 'asc' }, select: { invDate: true } }),
            this.prisma.acctLedger.findFirst({ where: { custId: row.customerId, transDate: { lt: row.run.fromDate } }, orderBy: { transDate: 'asc' }, select: { transDate: true } }),
          ]);
          const earliest = [firstBill?.invDate, firstVoucher?.transDate].filter((d): d is Date => !!d).sort((a, b) => +a - +b)[0] ?? new Date(row.run.fromDate.getTime() - DAY);
          await this.prisma.$transaction(async (tx) => {
            await tx.acctOpeningTrans.create({
              data: {
                kind: 'OPENING',
                custId: row.customerId!,
                customerName: row.customerName ?? row.ledgerName,
                transDate: fyStart(earliest),
                bankAmt: Math.abs(diff),
                cashAmt: 0,
                drCr: diff > 0 ? 'DEBIT' : 'CREDIT',
                remarks: `Tally recon — brings OMS to Tally's opening of ${tallyAmount.toFixed(2)} on ${ymd(row.run.fromDate)} (${row.ledgerName})`,
                userName: userName ?? null,
              },
            });
            const rowWrite = await tx.tallyReconRow.updateMany({
              where: { id: row.id, status: 'AMOUNT_MISMATCH', resolvedAt: null, omsAmount: row.omsAmount },
              data: {
                status: 'MATCHED', resolvedAt: new Date(), resolvedRef: 'Opening Balance', review: 'SOLVED',
                reviewNote: 'Opening difference added to OMS from the report.', reviewedAt: new Date(), reviewedBy: userName ?? null,
                omsAmount: tallyAmount, omsDate: row.txnDate,
                note: `OMS had no opening record; ${Math.abs(diff).toFixed(2)} ${diff > 0 ? 'Dr' : 'Cr'} added so it matches Tally's ${tallyAmount.toFixed(2)}.`,
              },
            });
            if (rowWrite.count !== 1) throw new Error('This reconciliation row changed. Re-check the report, then try again.');
            await this.payments.resettleParty(tx, row.customerId!);
          }, { timeout: 120_000 });
          updated.push({ rowId: row.id, customerName: row.customerName ?? row.ledgerName, previousAmount: currentAmount, amount: tallyAmount, drCr: tallyAmount >= 0 ? 'DEBIT' : 'CREDIT' });
          touchedRuns.set(row.runId, !!row.run.registerJson);
          continue;
        }
        const opening = effective[0];
        const openingSign = (opening.drCr ?? 'DEBIT').toUpperCase() === 'CREDIT' ? -1 : 1;
        const storedBank = r2(openingSign * (opening.bankAmt ?? 0));
        const nextStoredBank = r2(storedBank + (tallyAmount - currentAmount));
        const nextDrCr = nextStoredBank > 0.004 ? 'DEBIT' : nextStoredBank < -0.004 ? 'CREDIT' : (opening.drCr ?? 'DEBIT').toUpperCase();
        const nextBankAmt = Math.abs(nextStoredBank) <= 0.004 ? 0 : Math.abs(nextStoredBank);

        if (nextDrCr !== (opening.drCr ?? 'DEBIT').toUpperCase() && (opening.cashAmt ?? 0) > 0.004) {
          failed.push({
            rowId: id,
            reason: 'Matching this bank opening would also reverse the existing cash opening. Edit this mixed bank/cash opening manually.',
          });
          continue;
        }
        if (nextBankAmt <= 0.004 && (opening.cashAmt ?? 0) <= 0.004) {
          failed.push({ rowId: id, reason: 'Matching would leave an empty opening record. Remove or edit it in Opening Balance.' });
          continue;
        }

        await this.prisma.$transaction(async (tx) => {
          const openingWrite = await tx.acctOpeningTrans.updateMany({
            where: {
              id: opening.id,
              kind: 'OPENING',
              custId: row.customerId!,
              bankAmt: opening.bankAmt,
              cashAmt: opening.cashAmt,
              drCr: opening.drCr,
            },
            data: { bankAmt: nextBankAmt, drCr: nextDrCr, userName: userName ?? null },
          });
          if (openingWrite.count !== 1) throw new Error('The opening was edited by somebody else. Re-check the report, then try again.');

          const rowWrite = await tx.tallyReconRow.updateMany({
            where: { id: row.id, status: 'AMOUNT_MISMATCH', resolvedAt: null, omsAmount: row.omsAmount },
            data: {
              status: 'MATCHED',
              resolvedAt: new Date(),
              resolvedRef: 'Opening Balance',
              review: 'SOLVED',
              reviewNote: 'Existing OMS opening matched to Tally from the report.',
              reviewedAt: new Date(),
              reviewedBy: userName ?? null,
              omsAmount: tallyAmount,
              omsDate: row.txnDate,
              note: `OMS opening updated from ${currentAmount.toFixed(2)} to ${tallyAmount.toFixed(2)} to match Tally.`,
            },
          });
          if (rowWrite.count !== 1) throw new Error('This reconciliation row changed. Re-check the report, then try again.');
          // The opening moved under the receipts that cleared it — settle them again.
          await this.payments.resettleParty(tx, row.customerId!);
        }, { timeout: 120_000 });

        updated.push({
          rowId: row.id,
          customerName: row.customerName ?? row.ledgerName,
          previousAmount: currentAmount,
          amount: tallyAmount,
          drCr: tallyAmount >= 0 ? 'DEBIT' : 'CREDIT',
        });
        touchedRuns.set(row.runId, !!row.run.registerJson);
      } catch (e) {
        failed.push({ rowId: id, reason: e instanceof Error ? e.message : 'Could not match this opening balance.' });
      }
    }

    // A stored register lets us rebuild all row and balance verdicts against the
    // new opening, rather than leaving the rest of the report as a stale snapshot.
    for (const [runId, canRerun] of touchedRuns) {
      if (canRerun) await this.rerun(runId);
      else await this.refreshCounts(runId);
    }
    return { updated, failed };
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
        bankMismatchCount: of('BANK_MISMATCH'),
        pendingCount: reviewed('PENDING'),
        solvedCount: reviewed('SOLVED'),
      },
    });
  }
}
