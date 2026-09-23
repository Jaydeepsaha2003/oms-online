import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BANK_AMOUNT_TOL,
  BANK_DATE_TOL_DAYS,
  aliasFragment,
  bestNarrationParty,
  chequeNoIn,
  CHEQUE_CLEAR_DAYS,
  isChequeCredit,
  isReturnNarration,
  type BankUnclearedCheque,
  narrationMatch,
  NARRATION_MATCH_MIN,
  payerNarration,
  type BankReturnedCheque,
  narrationTokens,
  type BankPartyBalance,
  type BankPartyPreview,
  type BankRowStatus,
  type BankStatementColumnMap,
  type BankStatementProcessResult,
  type BankStatementRowDto,
  type BankStatementRunDto,
  type BankStatementRunList,
  type BankStatementRunResult,
  parseStatementDate,
  detectStatementDateOrder,
  type StatementDateOrder,
  type BankStatementRecheckResult,
  statementRowKey,
  type BankStatementCreateResponse,
  type BankStatementDuplicate,
  payByFor,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { BankStatementAssignDto, BankStatementCreateDto, BankStatementRunsQueryDto } from './dto/bank-statement.dto';

/** Either the root client or a transaction client. */
type Db = Prisma.TransactionClient;

const DAY = 86_400_000;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** `yyyy-mm-dd` in LOCAL time — dates here are stored as local midnight, so
 *  toISOString() would shift them back a day anywhere east of UTC. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A bank-supplied identity such as a NEFT/RTGS/IMPS UTR. Generic prose and
 * account suffixes are deliberately ignored: a reference must contain both
 * letters and digits and be long enough to identify one transfer. */
function bankTransferReference(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const tokens = (value ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    const hit = tokens.find((token) => token.length >= 10 && /[A-Z]/.test(token) && /\d/.test(token));
    if (hit) return hit;
  }
  return null;
}

/**
 * Every column name present across the sheet's rows.
 *
 * The union rather than the first row's keys: a row whose trailing cells are
 * empty can arrive without those keys at all, and reading the header off that
 * one row alone would fingerprint the same statement differently depending on
 * which row happened to be first.
 */
function columnsOf(rows: readonly Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r ?? {})) seen.add(k);
  return [...seen];
}

@Injectable()
export class BankStatementService {
  private readonly logger = new Logger(BankStatementService.name);
  private transaction?: Db;

  private async inTransaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
    return this.transaction ? work(this.transaction) : this.prisma.$transaction(work, { timeout: 60000 });
  }

  /**
   * Run one of the three write paths (rematch / process / recheck) inside a
   * transaction, re-entering it on a copy of this service bound to that
   * transaction.
   *
   * A COPY, not `this`: the service is a Nest singleton, so setting
   * `this.transaction` would hand one request's transaction to every other
   * request running at the same time. The copy is private to this call.
   *
   * The `as PrismaService` is the one unchecked cast in this file and it is
   * narrow by construction: a transaction client carries every model accessor
   * these methods use, and the only thing it lacks — `$transaction` — is never
   * reached, because `inTransaction` sees `this.transaction` set and runs the
   * work inline instead of opening a second one. Keeping it in a single place
   * is the point: three copies of it were three places to get that wrong.
   *
   * The no-op write to the run row first takes SQLite's write lock, so two
   * requests for the same working queue instead of both reading the same
   * coverage and both deciding to post it.
   */
  private async reenterInTransaction<T>(runId: number, work: (service: BankStatementService) => Promise<T>): Promise<T> {
    return this.inTransaction(async (tx) => {
      await tx.bankStatementRun.update({ where: { id: runId }, data: { id: runId } });
      const scoped = new BankStatementService(tx as PrismaService, this.payments);
      scoped.transaction = tx;
      return work(scoped);
    });
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  /* ── Column mapping memory ─────────────────────────────────────────────── */

  /**
   * A sheet's header row, reduced to something stable to look up by.
   *
   * Normalised (case and punctuation dropped) and SORTED, so the same export
   * matches even if the bank reorders its columns or changes their casing
   * between downloads. Blank headers are dropped — spreadsheet exports are full
   * of unnamed trailing columns, and letting those into the key would make two
   * downloads of the same statement look like different layouts.
   */
  private columnsKeyOf(columns: readonly string[]): string | null {
    const cleaned = [...new Set(columns.map((c) => (c ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean))].sort();
    // One or two columns is not a pattern — it would match half the statements
    // ever uploaded. Below that, only the bank name is trusted.
    return cleaned.length >= 3 ? cleaned.join('|') : null;
  }

  /**
   * The mapping to offer for this upload: what this BANK used last time, and
   * failing that, what any statement with THESE COLUMNS used last time.
   *
   * Bank name first because it is the more specific of the two — someone who
   * names the bank has told us which of several layouts they mean. The column
   * fingerprint is the fallback that makes the memory work at all when the box
   * was left blank or filled in differently from last time.
   */
  async columnPreset(bankName: string | undefined, columns?: readonly string[]): Promise<{ map: BankStatementColumnMap | null; from: 'bank' | 'columns' | null }> {
    const name = (bankName ?? '').trim();
    const parse = (json: string): BankStatementColumnMap | null => {
      try {
        return JSON.parse(json) as BankStatementColumnMap;
      } catch {
        return null;
      }
    };

    if (name) {
      const byName = await this.prisma.bankStatementColumnPreset.findUnique({ where: { bankName: name } });
      const map = byName && parse(byName.mapJson);
      if (map) return { map, from: 'bank' };
    }

    const key = this.columnsKeyOf(columns ?? []);
    if (key) {
      // Most recent wins: two banks CAN share a layout, and the one used last is
      // the better guess.
      const byColumns = await this.prisma.bankStatementColumnPreset.findFirst({
        where: { columnsKey: key },
        orderBy: { updatedAt: 'desc' },
      });
      const map = byColumns && parse(byColumns.mapJson);
      if (map) return { map, from: 'columns' };
    }

    return { map: null, from: null };
  }

  /**
   * Remember this mapping against both keys.
   *
   * With no bank name the row is filed under a synthetic one derived from the
   * fingerprint, so two unnamed banks no longer overwrite each other in a single
   * blank-named bucket — which is what the old `''` key did.
   */
  private async rememberPreset(bankName: string, map: BankStatementColumnMap, columns: readonly string[]): Promise<void> {
    const columnsKey = this.columnsKeyOf(columns);
    const name = (bankName ?? '').trim() || (columnsKey ? `#cols:${columnsKey.slice(0, 80)}` : '');
    await this.prisma.bankStatementColumnPreset.upsert({
      where: { bankName: name },
      create: { bankName: name, mapJson: JSON.stringify(map), columnsKey },
      update: { mapJson: JSON.stringify(map), columnsKey },
    });
  }

  /* ── Upload ────────────────────────────────────────────────────────────── */

  /**
   * Turn an uploaded sheet into a run.
   *
   * The sheet arrives already read into `{ column: cell }` rows — the browser
   * does that with the same helper every other import uses. What happens HERE
   * is the part that must not vary: which rows count (credits, in range), how
   * the amount is read, and who each one belongs to.
   */
  async create(dto: BankStatementCreateDto, userName?: string | null): Promise<BankStatementCreateResponse> {
    const map = dto.map;
    if (!map?.date?.trim() || !map?.narration?.trim() || !map?.credit?.trim()) {
      throw new BadRequestException('Map the Date, Narration and Credit columns before continuing.');
    }
    // Every receipt Process creates is a BANK receipt, and the payments engine
    // will not take one without an account. Refusing here rather than at Process
    // means the answer is asked for at the point of the decision, not after the
    // whole statement has been matched.
    if (!dto.bankName?.trim()) {
      throw new BadRequestException('Choose which bank account this statement is for — the receipts it posts need one.');
    }
    const from = this.day(dto.fromDate, 'From date');
    const to = this.day(dto.toDate, 'To date');
    if (to < from) throw new BadRequestException('The To date is before the From date.');
    // Inclusive of the whole `to` day.
    const toEnd = new Date(to.getTime() + DAY);

    // Which way round THIS file writes its dates, decided once from the whole
    // column. Derived here rather than sent by the client so the rows the page
    // showed and the rows this honours can never disagree - the same function
    // over the same rows gives the same answer on both sides.
    const dateOrder = detectStatementDateOrder((dto.rows ?? []).map((r) => r[map.date]));

    const parsed: { rowNo: number; txnDate: Date; narration: string; refNo: string | null; amount: number }[] = [];
    /** Return/reject DEBITS found in this file — see the branch that fills it. */
    const returns: { rowNo: number; txnDate: Date | null; narration: string; amount: number }[] = [];
    let skippedDebit = 0;
    let skippedRange = 0;
    let skippedUnreadable = 0;

    (dto.rows ?? []).forEach((raw, i) => {
      const rowNo = i + 1;
      const credit = this.num(raw[map.credit]);
      const debit = map.debit ? this.num(raw[map.debit]) : 0;
      // Money out is not a customer receipt. Covers both shapes: a separate
      // debit column with a value in it, and a single signed column where a
      // payment out arrives as a negative.
      if (debit > 0 || credit < 0) {
        /*
         * ONE debit matters: the bank taking back a cheque it already credited.
         * Kept aside (never stored as a row — it is not money in) so the credit
         * it cancels can be marked RETURNED below. Dropping it, as this did for
         * every debit, is how a bounced cheque stayed in the reconciliation
         * looking like cash and got posted as a receipt.
         */
        const text = (raw[map.narration] ?? '').toString().trim();
        if (isReturnNarration(text)) {
          const d = this.cellDate(raw[map.date], dateOrder);
          returns.push({ rowNo, txnDate: d, narration: text, amount: r2(Math.abs(debit || credit)) });
        }
        skippedDebit += 1;
        return;
      }
      if (credit <= 0) {
        skippedDebit += 1;
        return;
      }
      const txnDate = this.cellDate(raw[map.date], dateOrder);
      if (!txnDate) {
        skippedUnreadable += 1;
        return;
      }
      if (txnDate < from || txnDate >= toEnd) {
        skippedRange += 1;
        return;
      }
      parsed.push({
        rowNo,
        txnDate,
        narration: (raw[map.narration] ?? '').toString().trim(),
        refNo: map.ref ? ((raw[map.ref] ?? '').toString().trim() || null) : null,
        amount: r2(credit),
      });
    });

    if (!parsed.length) {
      throw new BadRequestException(
        `No credit entries fall inside ${dto.fromDate} – ${dto.toDate}. ` +
          `Checked ${(dto.rows ?? []).length} rows: ${skippedDebit} were not credits, ${skippedRange} were outside the range` +
          `${skippedUnreadable ? `, ${skippedUnreadable} had an unreadable date` : ''}.`,
      );
    }

    /*
     * Lines this bank account already holds.
     *
     * Re-importing one is not merely untidy: a line a previous run already
     * POSTED comes back as UNMATCHED here (this run has no receipt of its own
     * for it yet), and Process would create the receipt a second time.
     *
     * The comparison is per LINE and by COUNT, not by presence. Presence was
     * wrong in a way that loses money: a party paying ₹5,000 twice on the same
     * day with the same narration produces two identical lines, and if one was
     * already held, a set-based check discarded BOTH. Counting imports the
     * second one, which is the one that is genuinely new.
     */
    const bank = dto.bankName!.trim();
    const held = await this.heldRowCounts(bank, parsed);
    const duplicates = this.duplicateReport(parsed, held);

    // Nothing to decide — no line is already on record.
    if (duplicates.length === 0) {
      const gate = this.unclearedGate(dto, parsed, returns, to);
      if (gate) return gate;
      return this.createRun(dto, map, parsed, userName, 0, from, to, returns);
    }

    const action = dto.onDuplicate ?? 'ask';
    if (action === 'ask') {
      // Create nothing. There is no safe automatic answer: skipping silently
      // loses a real second payment, importing silently can double-post.
      return {
        outcome: 'duplicates' as const,
        duplicates,
        totalIncoming: parsed.length,
        totalOnRecord: duplicates.reduce((sum, d) => sum + Math.min(d.incoming, d.onRecord), 0),
      };
    }

    let fresh = parsed;
    if (action === 'skip') {
      // Drop only as many copies of each line as are already held — the surplus
      // is new money and stays.
      const budget = new Map(held.counts);
      fresh = parsed.filter((p) => {
        const key = statementRowKey(p.txnDate, p.amount, p.narration);
        const left = budget.get(key) ?? 0;
        if (left > 0) {
          budget.set(key, left - 1);
          return false;
        }
        return true;
      });
      if (!fresh.length) {
        const names = [...new Set(duplicates.flatMap((d) => d.runIds))].sort((a, b) => a - b).map((id) => `#${id}`).join(', ');
        throw new BadRequestException(
          `Nothing left to load — all ${parsed.length} credit lines are already held by working ${names} for ${bank}.`,
        );
      }
    }

    const gate = this.unclearedGate(dto, fresh, returns, to);
    if (gate) return gate;
    return this.createRun(dto, map, fresh, userName, parsed.length - fresh.length, from, to, returns);
  }

  /**
   * Stop before importing cheque credits the statement ends too soon to vouch
   * for, unless the user has already said to go ahead.
   *
   * A cheque is credited the day it is presented and only bounced a few days
   * later. So a file that ends on the 13th cannot tell you whether the cheque
   * credited on the 12th was good — the reject debit, if there is one, is in
   * next week's statement. Posting it is a bet, and this is where the bet gets
   * made deliberately instead of silently: exactly the case that put a
   * ₹2,55,000 receipt in the ledger for a cheque that came back.
   *
   * Only CHEQUES, and only ones with no return already in this file. A NEFT is
   * final on arrival and a cheque already seen to bounce needs no warning.
   * Returns null when there is nothing to ask about, which is the normal case.
   */
  private unclearedGate(
    dto: BankStatementCreateDto,
    rows: { rowNo: number; txnDate: Date; narration: string; refNo: string | null; amount: number }[],
    returns: { narration: string }[],
    to: Date,
  ): { outcome: 'uncleared'; cheques: BankUnclearedCheque[]; statementTo: string; days: number } | null {
    if (dto.acceptUncleared) return null;
    const bounced = new Set(returns.map((r) => chequeNoIn(r.narration)).filter(Boolean) as string[]);

    const cheques: BankUnclearedCheque[] = [];
    for (const r of rows) {
      if (!isChequeCredit(r.narration, r.refNo)) continue;
      const chq = chequeNoIn(`${r.refNo ?? ''} ${r.narration}`);
      if (chq && bounced.has(chq)) continue; // already known to have returned
      const daysWatched = Math.floor((+to - +r.txnDate) / DAY);
      if (daysWatched >= CHEQUE_CLEAR_DAYS) continue;
      cheques.push({
        rowNo: r.rowNo,
        txnDate: r.txnDate.toISOString(),
        narration: r.narration,
        chequeNo: chq,
        amount: r.amount,
        daysWatched: Math.max(0, daysWatched),
      });
    }
    if (!cheques.length) return null;
    return { outcome: 'uncleared' as const, cheques, statementTo: to.toISOString(), days: CHEQUE_CLEAR_DAYS };
  }

  /** How many of each incoming line this bank account already holds, and where. */
  private async heldRowCounts(
    bank: string,
    parsed: { txnDate: Date; amount: number; narration: string }[],
  ): Promise<{ counts: Map<string, number>; runs: Map<string, Set<number>>; posted: Set<string> }> {
    const spanFrom = new Date(Math.min(...parsed.map((p) => +p.txnDate)));
    const spanTo = new Date(Math.max(...parsed.map((p) => +p.txnDate)));
    const prior = await this.prisma.bankStatementRow.findMany({
      where: { txnDate: { gte: spanFrom, lte: spanTo }, run: { bankName: bank } },
      select: { id: true, runId: true, txnDate: true, amount: true, narration: true, rowKey: true, status: true },
    });

    const counts = new Map<string, number>();
    const runs = new Map<string, Set<number>>();
    const posted = new Set<string>();
    const backfill: { id: number; rowKey: string }[] = [];

    for (const r of prior) {
      const key = statementRowKey(r.txnDate, r.amount, r.narration);
      // Rows imported before this column existed carry ''. Fill them in as they
      // are consulted rather than in the migration — SQLite cannot do the
      // narration squashing the key needs.
      if (r.rowKey !== key) backfill.push({ id: r.id, rowKey: key });
      counts.set(key, (counts.get(key) ?? 0) + 1);
      (runs.get(key) ?? runs.set(key, new Set()).get(key)!).add(r.runId);
      if (r.status === 'POSTED') posted.add(key);
    }

    if (backfill.length) {
      await this.prisma.$transaction(
        backfill.map((b) => this.prisma.bankStatementRow.update({ where: { id: b.id }, data: { rowKey: b.rowKey } })),
      );
      this.logger.log(`Filled in ${backfill.length} row reference(s) for ${bank}.`);
    }
    return { counts, runs, posted };
  }

  /** The lines the caller has to make a decision about. */
  private duplicateReport(
    parsed: { txnDate: Date; amount: number; narration: string }[],
    held: { counts: Map<string, number>; runs: Map<string, Set<number>>; posted: Set<string> },
  ): BankStatementDuplicate[] {
    const incoming = new Map<string, { n: number; sample: { txnDate: Date; amount: number; narration: string } }>();
    for (const p of parsed) {
      const key = statementRowKey(p.txnDate, p.amount, p.narration);
      const cur = incoming.get(key);
      if (cur) cur.n += 1;
      else incoming.set(key, { n: 1, sample: p });
    }
    const out: BankStatementDuplicate[] = [];
    for (const [key, { n, sample }] of incoming) {
      const onRecord = held.counts.get(key) ?? 0;
      if (!onRecord) continue;
      out.push({
        txnDate: iso(sample.txnDate)!,
        amount: sample.amount,
        narration: sample.narration,
        incoming: n,
        onRecord,
        runIds: [...(held.runs.get(key) ?? [])].sort((a, b) => a - b),
        posted: held.posted.has(key),
      });
    }
    // Posted first: those are the ones that can double-post if waved through.
    return out.sort((a, b) => Number(b.posted) - Number(a.posted) || +new Date(a.txnDate) - +new Date(b.txnDate));
  }

  /** Write the working and its rows. */
  private async createRun(
    dto: BankStatementCreateDto,
    map: BankStatementColumnMap,
    fresh: { rowNo: number; txnDate: Date; narration: string; refNo: string | null; amount: number }[],
    userName: string | null | undefined,
    duplicateSkipped: number,
    from: Date,
    to: Date,
    /** Return/reject debits found in the same file — see {@link applyReturns}. */
    returns: { rowNo: number; txnDate: Date | null; narration: string; amount: number }[] = [],
  ): Promise<BankStatementCreateResponse> {
    const run = await this.prisma.bankStatementRun.create({
      data: {
        fileName: dto.fileName?.trim() || 'statement',
        bankName: dto.bankName?.trim() || null,
        fromDate: from,
        toDate: to,
        userName: userName ?? null,
        rowCount: fresh.length,
        creditTotal: r2(fresh.reduce((s, p) => s + p.amount, 0)),
        noPartyCount: fresh.length,
      },
    });
    await this.prisma.bankStatementRow.createMany({
      // The reference is written at import, so the next upload can be checked
      // against it without re-deriving one for every stored row.
      data: fresh.map((p) => ({ ...p, runId: run.id, rowKey: statementRowKey(p.txnDate, p.amount, p.narration) })),
    });
    // The header row comes off the sheet itself rather than being sent
    // separately: the rows are already `{ column: cell }`, so their keys ARE
    // the columns and a client cannot get them wrong.
    await this.rememberPreset(dto.bankName?.trim() ?? '', map, columnsOf(dto.rows));

    const returned = await this.applyReturns(run.id, dto.bankName?.trim() || null, returns);

    await this.attributeParties(run.id);
    await this.rematch(run.id);
    const result = await this.result(run.id);
    if (duplicateSkipped) this.logger.log(`Run ${run.id}: left out ${duplicateSkipped} line(s) already held.`);
    if (returned.length) {
      this.logger.log(`Run ${run.id}: ${returned.length} returned cheque(s) cancelled their credit.`);
    }
    return {
      outcome: 'created' as const,
      ...result,
      run: { ...result.run, ...(duplicateSkipped ? { duplicateSkipped } : {}) },
      ...(returned.length ? { returnedCheques: returned } : {}),
    };
  }

  /**
   * Cancel the credits that returned cheques took back.
   *
   * Matched on cheque number AND amount. The cheque number alone is not enough
   * — a six-digit date in the narration looks just like one — and the amount
   * alone is not either, since two parties pay round sums on the same day. The
   * pair is what makes it safe.
   *
   * Looks beyond this file on purpose: a cheque credited in August and returned
   * in September has its credit in the EARLIER run, and that is the case that
   * actually costs money, because by then the receipt has usually been posted.
   *
   * A POSTED credit is never altered here. Its receipt is already in the
   * ledger, and silently rewriting a posted line would leave the books saying
   * one thing and this screen another. It is reported instead, for a human to
   * reverse — which is the only place that reversal can correctly be decided.
   */
  private async applyReturns(
    runId: number,
    bank: string | null,
    returns: { rowNo: number; txnDate: Date | null; narration: string; amount: number }[],
  ): Promise<BankReturnedCheque[]> {
    if (!returns.length) return [];
    const out: BankReturnedCheque[] = [];

    for (const ret of returns) {
      const chq = chequeNoIn(ret.narration);
      if (!chq) continue;

      // This run first, then older runs of the same bank account — nearest
      // credit before the return wins when a cheque was presented more than once.
      const candidates = await this.prisma.bankStatementRow.findMany({
        where: {
          amount: { gte: ret.amount - BANK_AMOUNT_TOL, lte: ret.amount + BANK_AMOUNT_TOL },
          status: { not: 'RETURNED' },
          ...(bank ? { OR: [{ runId }, { run: { bankName: bank } }] } : { runId }),
        },
        select: { id: true, runId: true, txnDate: true, narration: true, refNo: true, amount: true, status: true, postedRef: true, customerName: true },
      });
      const hit = candidates
        .filter((c) => chequeNoIn(`${c.refNo ?? ''} ${c.narration}`) === chq || (c.refNo ?? '').trim() === chq)
        .filter((c) => !ret.txnDate || c.txnDate <= new Date(+ret.txnDate + DAY))
        .sort((a, b) => +b.txnDate - +a.txnDate)[0];
      if (!hit) continue;

      const note = `Cheque ${chq} returned — ${ret.narration}`;
      if (hit.status === 'POSTED') {
        // Flag only. See the note above about never rewriting a posted line.
        out.push({
          chequeNo: chq, amount: ret.amount, rowId: hit.id, runId: hit.runId,
          customerName: hit.customerName, postedRef: hit.postedRef, cancelled: false,
          narration: hit.narration, returnNarration: ret.narration,
        });
        continue;
      }
      await this.prisma.bankStatementRow.update({
        where: { id: hit.id },
        data: { status: 'RETURNED', matchedRefs: null, matchedAmount: 0, note },
      });
      out.push({
        chequeNo: chq, amount: ret.amount, rowId: hit.id, runId: hit.runId,
        customerName: hit.customerName, postedRef: null, cancelled: true,
        narration: hit.narration, returnNarration: ret.narration,
      });
    }
    return out;
  }

  /* ── Who does each credit belong to? ───────────────────────────────────── */

  /**
   * Attribute each line to a party, best evidence first.
   *
   *   1. A saved alias — the user has already said this narration is this party.
   *   2. The narration naming a customer.
   *   3. A receipt of the same amount and date belonging to exactly ONE party:
   *      the money is already recorded, so the statement line is that party's.
   *      Only used when it is unambiguous — two parties with the same amount on
   *      the same day is not evidence of anything.
   *
   * Lines the user has already assigned by hand are never overwritten.
   */
  private async attributeParties(runId: number): Promise<void> {
    // `{ not: 'MANUAL' }` alone would exclude every row: in SQL, NULL != 'MANUAL'
    // is NULL, not true, so a freshly parsed line (partySource NULL — the only
    // kind there is on a new run) matches nothing and attribution never runs.
    const rows = await this.prisma.bankStatementRow.findMany({
      where: { runId, OR: [{ partySource: null }, { partySource: { not: 'MANUAL' } }] },
    });
    if (!rows.length) return;
    const run = await this.prisma.bankStatementRun.findUnique({ where: { id: runId } });
    if (!run) return;

    const [aliases, customers] = await Promise.all([
      this.prisma.bankStatementAlias.findMany(),
      this.prisma.customer.findMany({ select: { id: true, partyName: true } }),
    ]);
    const named = customers
      .map((c) => ({ id: c.id, name: (c.partyName ?? '').trim() }))
      .filter((c) => c.name.length > 2);

    // Receipt vouchers across ALL parties in the range, for rule 3.
    const receipts = await this.receiptVouchers(null, run.fromDate, run.toDate, run.bankName);

    for (const row of rows) {
      let customerId: number | null = null;
      let source: string | null = null;

      /*
       * Aliases are matched against the PAYER part only, never the raw
       * narration.
       *
       * The raw substring test was the hole: an alias learned as "PUNJAB" — off
       * a cheque line whose bank segment read "Punjab Nat" and so escaped the
       * bank filter — then matched every NEFT that merely ROUTED through Punjab
       * National Bank. Ten WINCHEF INTERNATIONAL lines had matched correctly for
       * months; the next two were handed to the party that owned the alias.
       * Stripping the bank and the UTR first is what payerNarration is for, and
       * the alias rule was the one place not using it.
       */
      const payerTokens = narrationTokens(payerNarration(row.narration));
      const alias = aliases.find((a) => payerTokens.includes(a.fragment));
      if (alias) {
        customerId = alias.customerId;
        source = 'ALIAS';
      }

      /*
       * A receipt of this amount, on about this date, belonging to exactly one
       * party — checked BEFORE the narration, because money is stronger
       * evidence than a name.
       *
       * Two customers here are called "SRI MURUGAN METAL" and "SRI MURUGAN
       * METAL (K.S.GUNASEKARAN)". A narration reading "SRI MURUGAN METAL"
       * scores a perfect match on the first and a partial one on the second,
       * so the name test picked the first — while every receipt for those
       * transfers belongs to the second. Process would have posted ₹3.31L to
       * the wrong customer. The receipt says which one it actually was.
       */
      /*
       * Returns null when the narration names no one, or names two parties
       * equally well — an unassigned line costs a click, a wrongly assigned one
       * puts a customer's money against another customer's name.
       *
       * Worked out BEFORE the receipt rule now, not after, purely so the receipt
       * rule can be asked whether it disagrees with it. Which rule wins is
       * decided below; this is only the reading.
       */
      const narrationHit = bestNarrationParty(row.narration, named);

      /*
       * An alias that contradicts the narration is not trusted — the line is
       * left for a person to map instead.
       *
       * An alias earns its place when the narration names NOBODY: that is the
       * whole reason for teaching one. When the narration does name a party and
       * it is a different party, the two readings disagree and there is no
       * honest way to pick automatically — the alias may be a good rule meeting
       * an exception, or a bad rule finally showing itself. Guessing either way
       * moves real money, so neither is chosen and it surfaces as "No party".
       */
      if (customerId && source === 'ALIAS' && narrationHit && narrationHit.id !== customerId) {
        this.logger.log(
          `Run ${runId} row ${row.id}: alias points at ${customerId} but the narration names ${narrationHit.name} — left unassigned.`,
        );
        customerId = null;
        source = null;
      }

      if (!customerId) {
        const hits = receipts.filter(
          (v) => Math.abs(v.amount - row.amount) <= BANK_AMOUNT_TOL && Math.abs(+v.recDate - +row.txnDate) <= BANK_DATE_TOL_DAYS * DAY,
        );
        const parties = [...new Set(hits.map((h) => h.custId))];
        if (parties.length === 1) {
          /*
           * Does the narration name the party the receipt points at?
           *
           * This is the question, NOT "did the narration pick the same party" —
           * and the difference is the whole SRI MURUGAN case. There the
           * narration names both Murugans, `bestNarrationParty` returns the
           * wrong one on a tie-break, and only the receipt knows which actually
           * paid. The receipt's party still scores well on that narration, so it
           * keeps its say.
           *
           * What it no longer survives is naming someone the narration does not
           * mention at all. A ₹2,00,000 credit narrated KEETHIKA STAINLES was
           * handed to SHREE VINAYAK SALES because a voucher of theirs — eight
           * unrelated invoice allocations that happened to total exactly
           * 2,00,000 — sat seven days away, the very edge of the window. "Same
           * amount, same-ish week" is a coincidence a round number invites, and
           * against a narration that plainly names a different customer it is
           * not evidence.
           */
          const receiptName = customers.find((c) => c.id === parties[0])?.partyName ?? '';
          const receiptIsNamed = narrationMatch(row.narration, receiptName).score >= NARRATION_MATCH_MIN;
          if (receiptIsNamed || !narrationHit) {
            customerId = parties[0];
            source = 'RECEIPT';
          }
        }
      }

      if (!customerId && narrationHit) {
        customerId = narrationHit.id;
        source = 'NARRATION';
      }

      if (!customerId) continue;
      const name = customers.find((c) => c.id === customerId)?.partyName ?? null;
      await this.prisma.bankStatementRow.update({
        where: { id: row.id },
        // partyBy stays null — this was the matcher, not a person.
        data: { customerId, customerName: name, partySource: source, partyAt: new Date(), partyBy: null },
      });
    }
  }

  /* ── Matching ──────────────────────────────────────────────────────────── */

  /**
   * Compare each party's credits against their receipts, both ways.
   *
   * Line by line first: a credit paired with a receipt voucher of the same
   * amount, nearest date wins, each voucher spent once. What is left over is
   * then compared IN TOTAL — because one transfer often settles several
   * receipts, and several transfers often make up one. Only what survives both
   * passes is a genuine shortfall, and only that is what Process would create.
   */
  private async rematch(runId: number): Promise<void> {
    if (!this.transaction) return this.reenterInTransaction(runId, (s) => s.rematch(runId));
    // Recompute all saved workings together. A receipt has ONE remaining
    // balance, even when statement date ranges overlap.
    const runs = await this.prisma.bankStatementRun.findMany({ orderBy: { id: 'asc' } });
    if (!runs.some((r) => r.id === runId)) return;
    const rows = await this.prisma.bankStatementRow.findMany({ orderBy: [{ txnDate: 'asc' }, { runId: 'asc' }, { id: 'asc' }] });
    const pool = new Map<string, Awaited<ReturnType<BankStatementService['receiptVouchers']>>>();
    const remaining = new Map<string, number>();
    const ownKey = (v: { refId: string; custId: number }) => `${v.refId}:${v.custId}`;
    for (const run of runs) {
      const vouchers = await this.receiptVouchers(null, run.fromDate, run.toDate, run.bankName);
      pool.set(String(run.id), vouchers);
      for (const v of vouchers) remaining.set(ownKey(v), v.amount);
    }
    const posted = rows.filter((r) => r.status === 'POSTED' && r.postedRef);
    const postedNos = new Set(posted.map((r) => r.postedRef!));
    for (const vouchers of pool.values()) {
      for (const v of vouchers) if (postedNos.has(v.voucherNo)) remaining.set(ownKey(v), 0);
    }
    const active = rows.filter((r) => !['IGNORED', 'RETURNED', 'POSTED'].includes(r.status));
    const updates = new Map<number, { status: BankRowStatus; matchedRefs: string | null; matchedAmount: number }>();
    const candidates = (row: typeof rows[number]) => {
      const rowBankRef = bankTransferReference(row.refNo, row.narration);
      return (pool.get(String(row.runId)) ?? [])
        .filter((v) => v.custId === row.customerId && Math.abs(+v.recDate - +row.txnDate) <= BANK_DATE_TOL_DAYS * DAY)
        // When both sides identify the transfer, disagreement is conclusive.
        // Party + amount + nearby date must never override a different UTR.
        .filter((v) => !(rowBankRef && v.bankRef && rowBankRef !== v.bankRef))
        .sort((a, b) => {
          const aRef = rowBankRef && a.bankRef === rowBankRef ? 0 : 1;
          const bRef = rowBankRef && b.bankRef === rowBankRef ? 0 : 1;
          return aRef - bRef || Math.abs(+a.recDate - +row.txnDate) - Math.abs(+b.recDate - +row.txnDate) || a.voucherNo.localeCompare(b.voucherNo);
        });
    };
    /*
     * Could these remembered receipt links ever have been a real match?
     *
     * The review block below exists for one danger: a receipt that genuinely
     * covered this credit was edited or deleted, so posting a new one might
     * record the same money twice. That only applies to links today's rules
     * would accept — same party, within BANK_DATE_TOL_DAYS. Older versions of
     * the matcher let ANY of a party's receipts in the statement range "cover"
     * a credit, so lines still remember links like an April receipt against
     * an August cheque (103 days apart). Treating the removal of such a link as
     * "coverage changed" blocked real, unrecorded money from ever being posted:
     * the line could never become covered, so the block could never lift.
     */
    const refsIn = (s: string | null | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter((x) => x && x !== 'not recorded');
    // Exact matches across EVERY run precede aggregate allocation.
    for (const row of active) {
      const hit = candidates(row).find((v) => (remaining.get(ownKey(v)) ?? 0) === v.amount && Math.abs(v.amount - row.amount) <= BANK_AMOUNT_TOL);
      if (!hit) continue;
      remaining.set(ownKey(hit), 0);
      updates.set(row.id, { status: 'MATCHED', matchedRefs: hit.refId, matchedAmount: row.amount });
    }
    // Historical partial postings may contain an over-broad candidate list.
    // Never let that list steal an exact match and suggest posting it again.
    // Reserve only the remaining coverage, and expose any conflict on the
    // partially posted line without deleting or recreating its real receipt.
    const postedLedger = await this.prisma.acctLedger.findMany({
      where: { voucherType: 'RECEIPT', voucherNo: { in: [...postedNos] } },
      select: { voucherNo: true, bankCredit: true },
    });
    for (const row of posted) {
      const voucher = postedLedger.find((v) => v.voucherNo === row.postedRef);
      if (!voucher) continue; // recheck handles a missing link on opening its run.
      const required = r2(Math.max(0, row.amount - voucher.bankCredit));
      let need = required;
      const refs = new Set((row.matchedRefs ?? '').split(','));
      for (const v of pool.get(String(row.runId)) ?? []) {
        if (v.custId !== row.customerId || !refs.has(v.refId) || need <= 0) continue;
        const used = Math.min(need, remaining.get(ownKey(v)) ?? 0);
        remaining.set(ownKey(v), r2((remaining.get(ownKey(v)) ?? 0) - used));
        need = r2(need - used);
      }
      const note = need > BANK_AMOUNT_TOL
        ? `Receipt review required: ${row.postedRef} still exists, but ${need.toFixed(2)} of this line's previous coverage is no longer available (references: ${row.matchedRefs || 'not recorded'}). Check Receive Payments; this posted line will not create another receipt automatically.`
        : row.note?.startsWith('Receipt review required:') ? null : row.note;
      await this.prisma.bankStatementRow.update({ where: { id: row.id }, data: { matchedAmount: r2(required - need), note } });
    }
    for (const row of active) {
      if (updates.has(row.id)) continue;
      let need = row.amount;
      const usedRefs: string[] = [];
      for (const v of candidates(row)) {
        const available = remaining.get(ownKey(v)) ?? 0;
        const use = r2(Math.min(need, available));
        if (use <= 0) continue;
        remaining.set(ownKey(v), r2(available - use));
        need = r2(need - use);
        usedRefs.push(v.refId);
        if (need <= 0) break;
      }
      updates.set(row.id, {
        status: row.customerId == null ? 'NO_PARTY' : need <= BANK_AMOUNT_TOL ? 'PARTIAL' : 'UNMATCHED',
        matchedRefs: usedRefs.length ? [...new Set(usedRefs)].join(',') : null,
        matchedAmount: r2(row.amount - need),
      });
    }
    /*
     * Proven unrelated = every remembered receipt still EXISTS and is either
     * another party's or further than BANK_DATE_TOL_DAYS from this credit.
     * Looked up in the ledger itself, not the matching pool: a receipt that
     * was DELETED is missing from both, and a deleted nearby receipt is the
     * very case the review protects against. Missing therefore counts as
     * "could be related", and the block stays.
     */
    const lostRefs = [...new Set(active.flatMap((r) => [...refsIn(r.matchedRefs), ...refsIn(r.note?.match(/references: ([^)]*)\)/)?.[1])]))];
    const byRef = new Map<string, { custId: number; recDate: Date }[]>();
    if (lostRefs.length) {
      const found = [
        ...(await this.prisma.acctPaymentReceipt.findMany({ where: { refId: { in: lostRefs } }, select: { refId: true, custId: true, recDate: true } })),
        ...(await this.prisma.acctPartyAdvance.findMany({ where: { refId: { in: lostRefs } }, select: { refId: true, custId: true, recDate: true } })),
      ];
      for (const f of found) (byRef.get(f.refId) ?? byRef.set(f.refId, []).get(f.refId)!).push(f);
    }
    const provablyUnrelated = (row: typeof rows[number], refs: string[]) =>
      refs.length > 0 &&
      refs.every((ref) => {
        const hits = byRef.get(ref);
        return !!hits?.length && hits.every((h) => h.custId !== row.customerId || Math.abs(+h.recDate - +row.txnDate) > BANK_DATE_TOL_DAYS * DAY);
      });
    await this.inTransaction(async (tx) => {
      for (const row of active) {
        const update = updates.get(row.id)!;
        const staleNote = /receipt.*(deleted|reopened)/i.test(row.note ?? '');
        const identifiedTransfer = bankTransferReference(row.refNo, row.narration) != null;
        const needsReview =
          update.status === 'UNMATCHED' && row.matchedAmount > update.matchedAmount && !identifiedTransfer &&
          !provablyUnrelated(row, refsIn(row.matchedRefs));
        const oldReview = row.note?.startsWith('Receipt review required:');
        // An existing block over links proven unrelated is lifted. "not recorded"
        // or missing links cannot be proven, so those blocks stay.
        const phantomReview = oldReview && provablyUnrelated(row, refsIn(row.note!.match(/references: ([^)]*)\)/)?.[1]));
        const note = needsReview && !oldReview
          ? `Receipt review required: previous coverage changed (references: ${row.matchedRefs || 'not recorded'}). Check these receipts in Receive Payments before recording any missing money there. Automatic posting is blocked until this line is covered.`
          : (oldReview && (update.status !== 'UNMATCHED' || identifiedTransfer || phantomReview)) || staleNote ? null : row.note;
        await tx.bankStatementRow.update({ where: { id: row.id }, data: { ...update, note } });
      }
      for (const run of runs) {
        if (active.some((r) => r.runId === run.id && updates.get(r.id)?.status === 'UNMATCHED') && run.status === 'PROCESSED') {
          await tx.bankStatementRun.update({ where: { id: run.id }, data: { status: 'DRAFT', processedAt: null } });
        }
        await this.recount(tx, run.id);
      }
    });
  }

  /** Real receipt cash, including money held on account or clearing openings. */
  private async receiptVouchers(
    customerId: number | null, from: Date, to: Date, bankName?: string | null,
  ): Promise<{ refId: string; voucherNo: string; custId: number; recDate: Date; amount: number; bankRef: string | null }[]> {
    const range = { gte: new Date(+from - BANK_DATE_TOL_DAYS * DAY), lt: new Date(+to + (BANK_DATE_TOL_DAYS + 1) * DAY) };
    const ledger = await this.prisma.acctLedger.findMany({
      where: { voucherType: 'RECEIPT', transMode: { in: ['BANK', 'CHEQUE'] }, transDate: range, bankCredit: { gt: 0 } },
      orderBy: [{ transDate: 'asc' }, { id: 'asc' }],
    });
    const allocations = await this.prisma.acctPaymentReceipt.findMany({
      where: { recType: 'RECEIPT', payMode: { in: ['BANK', 'CHEQUE'] }, recDate: range },
    });
    const openings = await this.prisma.acctOpeningTrans.findMany({
      where: { kind: 'CLEARANCE', transDate: range, bankAmt: { gt: 0 } },
    });
    const advances = await this.prisma.acctPartyAdvance.findMany({
      where: { recDate: range, bankAmt: { gt: 0 } },
    });
    const bankParts = (value: string) => ({
      institution: value.toUpperCase().replace(/[^A-Z ]+.*$/, '').replace(/\b(LTD|LIMITED)\b/g, '').trim(),
      account: value.match(/\d{4,}/)?.[0] ?? null,
    });
    const bankMatches = (actual: string | null | undefined) => {
      if (!bankName?.trim() || !actual?.trim()) return true;
      const a = bankParts(actual), b = bankParts(bankName);
      return a.institution === b.institution && (!a.account || !b.account || a.account === b.account);
    };
    const result: Awaited<ReturnType<BankStatementService['receiptVouchers']>> = [];
    for (const v of ledger) {
      const linked = allocations.filter((a) => a.refId === v.receiptRefId || a.refRecId === v.voucherNo);
      const actualBank = v.bankName || linked.find((a) => a.bankName)?.bankName;
      if (!bankMatches(actualBank)) continue;
      const refId = v.receiptRefId || v.advanceRefId || `VOUCHER:${v.voucherNo}`;
      const bankRef = v.bankRef || (v.transMode === 'CHEQUE' ? v.chequeNo?.replace(/[^A-Z0-9]/gi, '').toUpperCase() || null : bankTransferReference(v.transRemarks));
      if (v.custId > 0) {
        if (customerId == null || customerId === v.custId) result.push({ refId, voucherNo: v.voucherNo, custId: v.custId, recDate: v.transDate, amount: r2(v.bankCredit), bankRef });
      } else {
        // Agent receipts can settle several customers. Only each customer's
        // fresh-money allocations belong to that customer; never repeat the
        // entire agent voucher for every invoice.
        const portions = new Map<number, number>();
        const add = (id: number, amount: number) => { if (id > 0) portions.set(id, r2((portions.get(id) ?? 0) + amount)); };
        for (const a of linked) if (a.refRecId === v.voucherNo) add(a.custId, a.recAmt);
        for (const o of openings) if (o.refRecId === v.voucherNo) add(o.custId, o.bankAmt);
        for (const a of advances) if (a.refRecId === v.voucherNo) add(a.custId, a.bankAmt);
        let available = v.bankCredit;
        for (const [custId, amount] of portions) {
          const part = r2(Math.min(available, amount));
          available = r2(available - part);
          if (part > 0 && (customerId == null || customerId === custId)) result.push({ refId, voucherNo: v.voucherNo, custId, recDate: v.transDate, amount: part, bankRef });
        }
      }
    }
    return result;
  }

  /* ── Assignment ────────────────────────────────────────────────────────── */

  async assign(runId: number, dto: BankStatementAssignDto, userName?: string | null): Promise<BankStatementRunResult> {
    const run = await this.mustBeDraft(runId);
    const ids = [...new Set(dto.rowIds ?? [])];
    if (!ids.length) throw new BadRequestException('Select at least one line.');

    const customer = dto.customerId != null
      ? await this.prisma.customer.findUnique({ where: { id: dto.customerId }, select: { id: true, partyName: true } })
      : null;
    if (dto.customerId != null && !customer) throw new NotFoundException('Customer not found.');

    const rows = await this.prisma.bankStatementRow.findMany({ where: { id: { in: ids }, runId: run.id } });
    await this.prisma.bankStatementRow.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: {
        customerId: customer?.id ?? null,
        customerName: customer?.partyName ?? null,
        // MANUAL is sticky: re-running attribution must not undo a human answer.
        partySource: customer ? 'MANUAL' : null,
        // Stamped on clearing too, not just on setting: "I un-assigned this one
        // a minute ago" is exactly the thing worth finding again, and blanking
        // the time would hide the correction in with the untouched lines.
        partyAt: new Date(),
        partyBy: userName ?? null,
        status: customer ? 'UNMATCHED' : 'NO_PARTY',
        matchedRefs: null,
        matchedAmount: 0,
      },
    });

    // Teach the narration, so the next statement recognises the same payer.
    if (dto.rememberAlias && customer) {
      /*
       * A fragment that also names another customer is not an alias, it is a
       * trap. The table is keyed by fragment, so learning "CRYSTAL" for CRYSTAL
       * STEEL would quietly capture every future line naming NX CRYSTAL IMPEX —
       * a real pair in this data, along with VINAYAK STEEL / SHREE VINAYAK
       * SALES. Checked against every active party, so it also holds for the
       * customer added next month.
       */
      const others = await this.prisma.customer.findMany({
        where: { active: true, partyName: { not: null }, id: { not: customer.id } },
        select: { partyName: true },
      });
      const takenByOthers = new Set(others.flatMap((c) => narrationTokens(c.partyName ?? '')));

      const skipped: string[] = [];
      for (const row of rows) {
        const fragment = aliasFragment(row.narration, customer.partyName ?? '');
        if (!fragment) continue;
        if (takenByOthers.has(fragment)) {
          skipped.push(fragment);
          continue;
        }
        /*
         * A fragment a SECOND party also turns out to be paid under identifies
         * neither of them, and the last writer would silently take the first
         * one's future money. The check above cannot see these — "TAMILNAD" is
         * Tamilnad Mercantile Bank truncated past the word "bank", so it names
         * no customer at all yet was learnable for two. Whoever claims it
         * second retires it instead of stealing it.
         */
        const existing = await this.prisma.bankStatementAlias.findUnique({ where: { fragment } });
        if (existing && existing.customerId !== customer.id) {
          await this.prisma.bankStatementAlias.delete({ where: { fragment } });
          skipped.push(fragment);
          continue;
        }
        await this.prisma.bankStatementAlias.upsert({
          where: { fragment },
          create: { fragment, customerId: customer.id, customerName: customer.partyName ?? '', createdBy: userName ?? null },
          update: { customerId: customer.id, customerName: customer.partyName ?? '' },
        });
      }
      if (skipped.length) {
        this.logger.log(
          `Not remembered for ${customer.partyName}: ${[...new Set(skipped)].join(', ')} — each also identifies another party.`,
        );
      }
    }

    await this.rematch(runId);
    return this.result(runId);
  }

  /**
   * Undo an assignment properly: clear the party AND forget what that line
   * taught.
   *
   * Clearing alone was never a real undo. `Assign` also writes a
   * BankStatementAlias so the next statement recognises the payer, and that
   * alias outlives the run — so a line cleared here came back attributed to the
   * same wrong party on the next upload, with no screen anywhere in the app to
   * unlearn it. The fragment is derived the same way `assign` derived it, and
   * only deleted when it still points at the party being removed; a fragment
   * since re-taught to someone else is left alone rather than silently taken
   * from them.
   *
   * Returns the fragments actually forgotten so the UI can name them — this is
   * shared state, and "UMIYA is no longer recognised" is worth saying out loud.
   */
  async clearParty(runId: number, rowIds: number[], forgetAlias: boolean, userName?: string | null): Promise<{ result: BankStatementRunResult; forgotten: string[] }> {
    await this.mustBeDraft(runId);
    const ids = [...new Set(rowIds ?? [])];
    if (!ids.length) throw new BadRequestException('Select at least one line.');

    // POSTED lines are excluded: a receipt already exists for them, and pulling
    // the party off the line would orphan it. Those are reversed, not cleared.
    const rows = await this.prisma.bankStatementRow.findMany({
      where: { id: { in: ids }, runId, status: { not: 'POSTED' } },
    });
    if (!rows.length) throw new BadRequestException('Nothing to clear — those lines are already posted.');

    const forgotten: string[] = [];
    if (forgetAlias) {
      for (const row of rows) {
        if (row.customerId == null) continue;
        const fragment = aliasFragment(row.narration, row.customerName ?? '');
        if (!fragment) continue;
        const existing = await this.prisma.bankStatementAlias.findUnique({ where: { fragment } });
        if (!existing || existing.customerId !== row.customerId) continue;
        await this.prisma.bankStatementAlias.delete({ where: { fragment } });
        forgotten.push(fragment);
      }
    }

    await this.prisma.bankStatementRow.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: {
        customerId: null,
        customerName: null,
        partySource: null,
        partyAt: new Date(),
        partyBy: userName ?? null,
        status: 'NO_PARTY',
        matchedRefs: null,
        matchedAmount: 0,
      },
    });

    await this.rematch(runId);
    return { result: await this.result(runId), forgotten: [...new Set(forgotten)] };
  }

  /**
   * Undo a posted line whose cheque came back: delete the receipt it created,
   * then mark the line RETURNED.
   *
   * The ledger half is `payments.deleteReceipt`, deliberately rather than
   * anything written here. That method does not merely remove the voucher — it
   * reverses it and REPLAYS every later receipt for the party, so the ones that
   * allocated themselves around this money re-point at the invoices they should
   * have paid. A hand-rolled delete would strip the voucher and leave those
   * later receipts pointing at allocations that no longer make sense.
   *
   * Order matters: the ledger is changed first and the row only after it
   * succeeds. The reverse order would leave a line reading "returned" beside a
   * receipt still standing — the exact disagreement this screen exists to catch.
   */
  async reverseReturned(runId: number, rowId: number): Promise<{ voucherNo: string; replayedCount: number; row: BankStatementRowDto }> {
    /*
     * Looked up by id ALONE, not by id within `runId`.
     *
     * The line being reversed usually is NOT in the working the user is looking
     * at: the return debit arrives in this month's file while the credit it
     * cancels sits in last month's run, which is the whole reason the banner
     * searches across runs. Scoping this to the open run made the one case it
     * was built for — a cheque credited in August, bounced in September —
     * fail with "that line is not in this working".
     */
    const row = await this.prisma.bankStatementRow.findUnique({ where: { id: rowId } });
    if (!row) throw new NotFoundException('That line no longer exists.');
    void runId; // the row carries its own run; see above
    if (row.status !== 'POSTED' || !row.postedRef) {
      throw new BadRequestException('Only a line that posted a receipt can be reversed here.');
    }

    const ledger = await this.prisma.acctLedger.findMany({
      where: { voucherNo: row.postedRef, voucherType: 'RECEIPT' },
      select: { id: true },
    });
    if (ledger.length !== 1) {
      throw new BadRequestException(
        ledger.length === 0
          ? `${row.postedRef} is no longer in the ledger — it may already have been reversed.`
          : `${row.postedRef} matches ${ledger.length} ledger rows; reverse it from the Payments screen instead.`,
      );
    }

    // Refusals from here (a receipt predating edit support, one stamped by Tally
    // Reconciliation) surface as-is. They name what to do, and swallowing them
    // would leave the user pressing a button that silently does nothing.
    const res = await this.payments.deleteReceipt(ledger[0].id);

    const updated = await this.prisma.bankStatementRow.update({
      where: { id: row.id },
      data: {
        status: 'RETURNED',
        postedRef: null,
        postedAt: null,
        matchedRefs: null,
        matchedAmount: 0,
        note: `${row.note ? `${row.note} ` : ''}Receipt ${res.voucherNo} reversed — the cheque was returned unpaid.`,
      },
    });
    // The row's OWN run, which is the one whose totals just changed — not the
    // run the user happens to have open.
    await this.rematch(row.runId);
    return { ...res, row: this.rowDto(updated) };
  }

  /** Take a line out of the reconciliation entirely (an interest credit, a
   *  transfer between our own accounts — real money, but not a customer). */
  async setIgnored(runId: number, rowIds: number[], ignored: boolean): Promise<BankStatementRunResult> {
    await this.mustBeDraft(runId);
    const ids = [...new Set(rowIds ?? [])];
    if (!ids.length) throw new BadRequestException('Select at least one line.');
    await this.prisma.bankStatementRow.updateMany({
      where: { id: { in: ids }, runId, status: { not: 'POSTED' } },
      data: ignored
        ? { status: 'IGNORED', matchedRefs: null, matchedAmount: 0 }
        : { status: 'NO_PARTY', matchedRefs: null, matchedAmount: 0 },
    });
    await this.rematch(runId);
    return this.result(runId);
  }

  /* ── Per-party before / after ──────────────────────────────────────────── */

  async partyPreview(runId: number, customerId: number): Promise<BankPartyPreview> {
    const run = await this.prisma.bankStatementRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Run not found.');
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, partyName: true } });
    if (!customer) throw new NotFoundException('Customer not found.');

    const rows = await this.prisma.bankStatementRow.findMany({
      where: { runId, customerId },
      orderBy: [{ txnDate: 'asc' }, { id: 'asc' }],
    });
    const live = rows.filter((r) => r.status !== 'IGNORED' && r.status !== 'RETURNED');
    const statementTotal = r2(live.reduce((s, r) => s + r.amount, 0));
    // POSTED counts as accounted-for: the receipt now exists because this run
    // created it. Leaving it out made a processed run read as though its money
    // were neither matched nor outstanding.
    const accounted = ['MATCHED', 'PARTIAL', 'POSTED'];
    const matchedTotal = r2(live.filter((r) => accounted.includes(r.status)).reduce((s, r) => s + r.amount, 0));
    const shortfall = r2(live.filter((r) => r.status === 'UNMATCHED').reduce((s, r) => s + (r.amount - r.matchedAmount), 0));

    const vouchers = await this.receiptVouchers(customerId, run.fromDate, run.toDate, run.bankName);
    const omsTotal = r2(vouchers.reduce((s, v) => s + v.amount, 0));

    const before = await this.balanceOf(customerId, customer.partyName ?? '', vouchers.length, omsTotal);
    // The projection: the shortfall lands on the bank leg as new receipts, which
    // is exactly what Process would do.
    // Anything beyond what the party owes does not disappear — the payments
    // engine parks it as an advance, so the projection says so.
    const postable = live.filter((r) => r.status === 'UNMATCHED' && !r.note?.startsWith('Receipt review required:'));
    const postableAmount = r2(postable.reduce((sum, r) => sum + r.amount - r.matchedAmount, 0));
    const spill = r2(Math.max(0, postableAmount - before.pendingBank));
    const after: BankPartyBalance = {
      receiptCount: before.receiptCount + postable.length,
      receiptTotal: r2(before.receiptTotal + postableAmount),
      pendingBank: r2(Math.max(0, before.pendingBank - postableAmount)),
      pendingCash: before.pendingCash,
      advance: r2(before.advance + spill),
    };

    return {
      customerId,
      customerName: customer.partyName ?? '',
      rows: live.map((r) => this.rowDto(r)),
      statementTotal,
      matchedTotal,
      shortfall,
      // Receipts the bank never showed — the other half of the story.
      unbackedReceiptTotal: r2(Math.max(0, omsTotal - matchedTotal)),
      before,
      after,
    };
  }

  /** The party's outstanding as the ledger currently stands. */
  private async balanceOf(custId: number, custName: string, receiptCount: number, receiptTotal: number): Promise<BankPartyBalance> {
    const challans = await this.prisma.challan.findMany({
      where: { challanStatus: 'CONFIRMED', customerName: custName },
      select: { code: true, b: true, c: true },
    });
    const codes = challans.map((c) => c.code);
    const [recs, discs] = await Promise.all([
      codes.length
        ? this.prisma.acctPaymentReceipt.groupBy({ by: ['invNo', 'payMode'], where: { invNo: { in: codes } }, _sum: { recAmt: true } })
        : Promise.resolve([] as { invNo: string; payMode: string; _sum: { recAmt: number | null } }[]),
      codes.length
        ? this.prisma.acctPartyDiscount.groupBy({ by: ['invNo', 'billType'], where: { invNo: { in: codes } }, _sum: { disAmt: true } })
        : Promise.resolve([] as { invNo: string; billType: string; _sum: { disAmt: number | null } }[]),
    ]);
    const bankPaid = new Map<string, number>();
    const cashPaid = new Map<string, number>();
    for (const rr of recs) {
      const m = rr.payMode === 'BANK' || rr.payMode === 'CHEQUE' ? bankPaid : cashPaid;
      m.set(rr.invNo, r2((m.get(rr.invNo) ?? 0) + (rr._sum.recAmt ?? 0)));
    }
    for (const d of discs) {
      const m = d.billType === 'BANK' ? bankPaid : cashPaid;
      m.set(d.invNo, r2((m.get(d.invNo) ?? 0) + (d._sum.disAmt ?? 0)));
    }
    let pendingBank = 0;
    let pendingCash = 0;
    for (const c of challans) {
      pendingBank = r2(pendingBank + Math.max(0, r2((c.b ?? 0) - (bankPaid.get(c.code) ?? 0))));
      pendingCash = r2(pendingCash + Math.max(0, r2((c.c ?? 0) - (cashPaid.get(c.code) ?? 0))));
    }
    // Advances already on account, net of what has been spent from them.
    const advs = await this.prisma.acctPartyAdvance.findMany({ where: { custId }, select: { refId: true, bankAmt: true, cashAmt: true } });
    let advance = 0;
    if (advs.length) {
      const used = await this.prisma.acctPaymentReceipt.groupBy({
        by: ['refRecId'],
        where: { refRecId: { in: advs.map((a) => a.refId) } },
        _sum: { recAmt: true },
      });
      const spent = new Map(used.map((u) => [u.refRecId ?? '', u._sum.recAmt ?? 0]));
      for (const a of advs) advance = r2(advance + Math.max(0, r2(a.bankAmt + a.cashAmt - (spent.get(a.refId) ?? 0))));
    }
    return { receiptCount, receiptTotal, pendingBank, pendingCash, advance };
  }

  /**
   * A receipt already in the books that may be this very payment but that
   * matching cannot see — typed by hand under the agent or a sister party
   * (B KUMAR: RN/537 sat under the agent, the statement said BK METAL, and
   * Process wrote RN/869 on top of it). Same amount, within 3 days, and not
   * already linked to any statement line.
   */
  private async possibleTwin(row: { customerId: number | null; txnDate: Date }, amount: number, agentName: string | null) {
    const sisters = agentName ? (await this.prisma.customer.findMany({ where: { agentName }, select: { id: true } })).map((c) => c.id) : [];
    const candidates = await this.prisma.acctLedger.findMany({
      where: {
        voucherType: 'RECEIPT',
        transMode: { in: ['BANK', 'CHEQUE'] },
        bankCredit: { gte: amount - 0.5, lte: amount + 0.5 },
        transDate: { gte: new Date(+row.txnDate - 3 * DAY), lte: new Date(+row.txnDate + 3 * DAY) },
        OR: [{ custId: row.customerId ?? -1 }, ...(agentName ? [{ custId: 0, agentName }, { custId: { in: sisters } }] : [])],
      },
      orderBy: { transDate: 'asc' },
    });
    for (const v of candidates) {
      const refs = [v.receiptRefId, v.advanceRefId, `VOUCHER:${v.voucherNo}`].filter((r): r is string => !!r);
      const linked = await this.prisma.bankStatementRow.findFirst({
        where: { OR: [{ postedRef: v.voucherNo }, ...refs.map((r) => ({ matchedRefs: { contains: r } }))] },
        select: { id: true },
      });
      if (!linked) return v;
    }
    return null;
  }

  /* ── Process ───────────────────────────────────────────────────────────── */

  /**
   * Post the shortfall.
   *
   * Only UNMATCHED lines create anything: a matched line is money already in
   * the books, and posting it again would double the party's receipts. Each one
   * goes through the ordinary Receive Payment engine, so it allocates to
   * invoices exactly as a hand-entered receipt would — there is no second
   * posting path to keep in step with the first.
   */
  async process(runId: number, userName?: string | null, rowIds?: number[]): Promise<BankStatementProcessResult> {
    if (!this.transaction) return this.reenterInTransaction(runId, (s) => s.process(runId, userName, rowIds));
    await this.rematch(runId);
    const run = await this.prisma.bankStatementRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status === 'PROCESSED') return { runId, created: [], failed: [] };
    /*
     * `rowIds` posts only the lines the user ticked; omitted, every unmatched
     * line goes, which is the usual case and stays the default.
     *
     * The status filter is applied REGARDLESS. A ticked line that is already
     * matched or posted must not be forced through just because it was
     * selected — the tick chooses among the postable lines, it does not
     * override what makes a line postable.
     */
    const picked = rowIds?.length ? [...new Set(rowIds)] : null;
    const rows = await this.prisma.bankStatementRow.findMany({
      where: { runId, status: 'UNMATCHED', ...(picked ? { id: { in: picked } } : {}) },
      orderBy: [{ txnDate: 'asc' }, { id: 'asc' }],
    });
    if (!rows.length) {
      // Commit refreshed matches even when a receipt was entered after the
      // screen loaded. A repeated Process request is a harmless no-op.
      return { runId, created: [], failed: [] };
    }

    const created: BankStatementProcessResult['created'] = [];
    const failed: BankStatementProcessResult['failed'] = [];

    for (const selected of rows) {
      const row = await this.prisma.bankStatementRow.findUniqueOrThrow({ where: { id: selected.id } });
      if (row.status !== 'UNMATCHED') continue;
      if (row.note?.startsWith('Receipt review required:')) {
        failed.push({ rowId: row.id, reason: `${row.customerName ?? 'This line'} needs receipt review. ${row.note}` });
        continue;
      }
      if (row.customerId == null) {
        failed.push({ rowId: row.id, reason: 'No party assigned to this line.' });
        continue;
      }
      // Only the part no receipt accounts for. A line half-covered in aggregate
      // must not post its whole face value.
      const amount = r2(row.amount - row.matchedAmount);
      if (amount <= 0) {
        failed.push({ rowId: row.id, reason: 'Already accounted for by existing receipts.' });
        continue;
      }
      /*
       * Collect it the way Receive Payment would collect it by hand.
       *
       * A party whose BANK money comes through an agent cannot be receipted in
       * Party mode — the engine refuses it outright ("please use the Agent Name
       * field"). Posting every line as PARTY therefore left those lines
       * permanently unpostable from this screen: Process reported a failure the
       * operator could do nothing about, because the screen has no agent field
       * to switch to. The routing is a property of the party, not of how the
       * receipt was typed in, so it is read from the customer here exactly as
       * the Receive Payment screen reads it.
       */
      const customer = await this.prisma.customer.findUnique({
        where: { id: row.customerId },
        select: { payBy: true, payByModes: true, agentName: true },
      });
      const viaAgent = customer ? payByFor(customer, 'bank') === 'AGENT' : false;
      const agentName = customer?.agentName?.trim() || null;
      if (viaAgent && !agentName) {
        failed.push({
          rowId: row.id,
          reason: `${row.customerName ?? 'This party'} is set to receive bank payments through an agent, but no agent is named on the customer. Set the agent, or change PAY BY (bank) to PARTY.`,
        });
        continue;
      }
      const twin = await this.possibleTwin(row, amount, agentName);
      if (twin && !picked?.includes(row.id)) {
        failed.push({
          rowId: row.id,
          reason:
            `${twin.voucherNo} (${ymd(twin.transDate)}, ₹${twin.bankCredit.toLocaleString('en-IN')}) is already in the books for this party or its agent and may be this same payment. ` +
            `If it is, delete ${twin.voucherNo} in Receive Payments and Process again, so the receipt is linked to this bank line. If it is a different payment, tick only this line and Process it.`,
        });
        continue;
      }
      await this.transaction.$executeRawUnsafe('SAVEPOINT bank_statement_receipt');
      try {
        const res = await this.payments.save(
          {
            takeAccOn: viaAgent ? 'AGENT' : 'PARTY',
            customerId: viaAgent ? undefined : row.customerId,
            agentName: viaAgent ? agentName! : undefined,
            payMode: 'BANK',
            bankName: run.bankName ?? null,
            bankRef: bankTransferReference(row.refNo, row.narration),
            adjMode: 'AUTOMATIC',
            receiptAmt: amount,
            recDate: ymd(row.txnDate),
            remarks: `Bank statement ${run.fileName}${row.refNo ? ` — ref ${row.refNo}` : ''}`,
          },
          userName,
          this.transaction,
          `BANK_STATEMENT_ROW:${row.id}`,
        );
        const voucherNo = res?.voucherNo ?? '';
        await this.prisma.bankStatementRow.update({
          where: { id: row.id },
          data: {
            status: 'POSTED',
            postedRef: voucherNo || 'posted',
            postedAt: new Date(),
            note: `Receipt created from the bank statement${voucherNo ? ` as ${voucherNo}` : ''}.`,
          },
        });
        await this.transaction.$executeRawUnsafe('RELEASE SAVEPOINT bank_statement_receipt');
        created.push({ rowId: row.id, voucherNo, amount, customerName: row.customerName ?? '' });
      } catch (e) {
        await this.transaction.$executeRawUnsafe('ROLLBACK TO SAVEPOINT bank_statement_receipt');
        await this.transaction.$executeRawUnsafe('RELEASE SAVEPOINT bank_statement_receipt');
        failed.push({ rowId: row.id, reason: e instanceof Error ? e.message : 'Could not post this receipt.' });
      }
      await this.rematch(runId);
    }

    /*
     * Processed only when something landed AND nothing postable is left.
     *
     * A run that failed entirely stays a draft so it can be fixed and run
     * again — and now that a subset can be posted on its own, so does a run
     * with lines still to go. Marking the whole run PROCESSED after posting
     * ten of twenty made it read-only and stranded the other ten with no way
     * to post them at all.
     */
    /*
     * Posting changes the answer for every OTHER line of the same party.
     *
     * Each receipt just written is spoken for by the line that wrote it, so the
     * cover left over for the rest of the run is not what it was a moment ago.
     * Without re-running the match here, a line kept the figure worked out
     * BEFORE its neighbour was posted: RAMSON's 16 Aug credit went on claiming
     * ₹53,269 of cover from the 11 Aug receipt, and went on reporting itself
     * ₹76,088 short, until someone happened to press Recheck. Nobody should
     * have to know that.
     */
    if (created.length) await this.rematch(runId);

    const stillPostable = created.length
      ? await this.prisma.bankStatementRow.count({ where: { runId, status: 'UNMATCHED' } })
      : 0;
    if (created.length && stillPostable === 0) {
      await this.prisma.bankStatementRun.update({
        where: { id: runId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
    }
    await this.inTransaction(async (tx) => this.recount(tx, runId));
    return { runId, created, failed };
  }

  /* ── Reads ─────────────────────────────────────────────────────────────── */

  async runs(q: BankStatementRunsQueryDto): Promise<BankStatementRunList> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 25));
    const [items, total] = await Promise.all([
      this.prisma.bankStatementRun.findMany({ orderBy: { uploadedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.bankStatementRun.count(),
    ]);
    return {
      items: items.map((r) => this.runDto(r)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async result(runId: number): Promise<BankStatementRunResult> {
    const run = await this.prisma.bankStatementRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Run not found.');
    const rows = await this.prisma.bankStatementRow.findMany({
      where: { runId },
      orderBy: [{ txnDate: 'asc' }, { rowNo: 'asc' }],
    });
    const parties = new Map<number, { customerId: number; customerName: string; lines: number; total: number }>();
    for (const r of rows) {
      if (r.customerId == null || r.status === 'IGNORED' || r.status === 'RETURNED') continue;
      const cur = parties.get(r.customerId) ?? { customerId: r.customerId, customerName: r.customerName ?? '', lines: 0, total: 0 };
      cur.lines += 1;
      cur.total = r2(cur.total + r.amount);
      parties.set(r.customerId, cur);
    }
    /*
     * The voucher number behind each matched REF ID.
     *
     * `refRecId` is what funded the allocation: a voucher number on a fresh
     * receipt ("RN/373"), or an advance's own REF ID where the allocation was
     * paid out of an advance. Either is what the Party Ledger shows, which is
     * the point — the two screens have to be checkable against each other.
     */
    const refIds = [...new Set(rows.flatMap((r) => (r.matchedRefs ?? '').split(',').filter(Boolean)))];
    const receiptVouchers: Record<string, string> = {};
    if (refIds.length) {
      const ledger = await this.prisma.acctLedger.findMany({
        where: { voucherType: 'RECEIPT', OR: [
          { receiptRefId: { in: refIds } }, { advanceRefId: { in: refIds } },
          { voucherNo: { in: refIds.filter((r) => r.startsWith('VOUCHER:')).map((r) => r.slice(8)) } },
        ] },
        select: { voucherNo: true, receiptRefId: true, advanceRefId: true },
      });
      for (const v of ledger) receiptVouchers[v.receiptRefId || v.advanceRefId || `VOUCHER:${v.voucherNo}`] = v.voucherNo;
      const alloc = await this.prisma.acctPaymentReceipt.findMany({
        where: { refId: { in: refIds } },
        select: { refId: true, refRecId: true },
        distinct: ['refId', 'refRecId'],
      });
      for (const a of alloc) {
        // One REF ID can span more than one funding voucher; name the first and
        // let the row's own tooltip carry the rest.
        if (a.refRecId && !receiptVouchers[a.refId]) receiptVouchers[a.refId] = a.refRecId;
      }
    }

    return {
      run: this.runDto(run),
      rows: rows.map((r) => this.rowDto(r)),
      parties: [...parties.values()].sort((a, b) => b.total - a.total),
      receiptVouchers,
    };
  }

  async remove(runId: number): Promise<void> {
    const run = await this.prisma.bankStatementRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Run not found.');
    if (run.status === 'PROCESSED') {
      throw new BadRequestException(
        'This run has already posted receipts. Deleting it would remove the working while leaving the money in the ledger — reverse the receipts in Receive Payment instead.',
      );
    }
    await this.prisma.bankStatementRun.delete({ where: { id: runId } });
  }

  /** Refresh statement coverage without changing accounting. A missing old
   * reference is not proof of missing money: look for a replacement first.
   * Historical coverage conflicts require review, not automatic reposting. */
  async recheck(runId: number): Promise<BankStatementRecheckResult> {
    if (!this.transaction) return this.reenterInTransaction(runId, (s) => s.recheck(runId));
    const run = await this.prisma.bankStatementRun.findUniqueOrThrow({ where: { id: runId } });
    const before = await this.prisma.bankStatementRow.findMany({ where: { runId } });
    const posted = before.filter((r) => r.status === 'POSTED');
    const missing = new Map<number, string>();
    for (const row of posted) {
      const ref = row.postedRef?.trim() ?? '';
      const alive = ref ? await this.prisma.acctLedger.count({ where: { voucherNo: ref, voucherType: 'RECEIPT' } }) : 0;
      if (alive) continue;
      missing.set(row.id, ref);
      await this.prisma.bankStatementRow.update({
        where: { id: row.id },
        data: { status: 'NO_PARTY', postedRef: null, postedAt: null, matchedRefs: null, matchedAmount: 0, note: null },
      });
    }
    await this.rematch(runId);
    const after = await this.prisma.bankStatementRow.findMany({ where: { runId, status: 'UNMATCHED' } });
    // A missing old voucher may already have a replacement. Only unresolved
    // shortfalls need review; changed matches are never called deletions.
    const reopened = after.filter((r) => missing.has(r.id)).map((r) => ({
      rowId: r.id, rowNo: r.rowNo, postedRef: missing.get(r.id)!,
      amount: r2(r.amount - r.matchedAmount), customerName: r.customerName ?? '',
    }));
    const previous = new Map(before.map((r) => [r.id, r]));
    const uncovered = after.filter((r) => !missing.has(r.id) && (r.note?.startsWith('Receipt review required:') || run.status === 'PROCESSED' || (previous.get(r.id)?.matchedAmount ?? 0) > r.matchedAmount))
      .map((r) => ({ rowId: r.id, rowNo: r.rowNo, amount: r.amount, shortfall: r2(r.amount - r.matchedAmount), customerName: r.customerName ?? '' }));
    const postedReview = await this.prisma.bankStatementRow.findMany({ where: { runId, status: 'POSTED', note: { startsWith: 'Receipt review required:' } } });
    for (const row of postedReview) {
      const receipt = await this.prisma.acctLedger.findFirst({ where: { voucherNo: row.postedRef ?? '', voucherType: 'RECEIPT' } });
      uncovered.push({ rowId: row.id, rowNo: row.rowNo, amount: row.amount, shortfall: r2(Math.max(0, row.amount - row.matchedAmount - (receipt?.bankCredit ?? 0))), customerName: row.customerName ?? '' });
    }
    return { runId, reopened, uncovered, stillPosted: posted.length - missing.size, reopenedRun: reopened.length > 0 || uncovered.length > 0 };
  }

  /* ── Plumbing ──────────────────────────────────────────────────────────── */

  private async mustBeDraft(runId: number) {
    const run = await this.prisma.bankStatementRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Run not found.');
    if (run.status === 'PROCESSED') throw new BadRequestException('This run has been processed and can no longer be changed.');
    return run;
  }

  /** Re-derive the run's counters from its rows. */
  private async recount(tx: Db, runId: number) {
    const rows = await tx.bankStatementRow.findMany({ where: { runId }, select: { status: true, amount: true } });
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    await tx.bankStatementRun.update({
      where: { id: runId },
      data: {
        rowCount: rows.length,
        creditTotal: r2(rows.reduce((s, r) => s + r.amount, 0)),
        matchedCount: count('MATCHED'),
        partialCount: count('PARTIAL'),
        unmatchedCount: count('UNMATCHED'),
        noPartyCount: count('NO_PARTY'),
        postedCount: count('POSTED'),
        ignoredCount: count('IGNORED'),
      },
    });
  }

  private day(s: string, label: string): Date {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} is not a valid date.`);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** A number from a spreadsheet cell — tolerant of "1,23,456.00", "(500)" and blanks. */
  private num(v: unknown): number {
    if (v == null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    let s = String(v).trim();
    if (!s) return 0;
    const bracketed = /^\((.*)\)$/.exec(s);
    if (bracketed) s = `-${bracketed[1]}`;
    const n = Number(s.replace(/[₹\s,]/g, '').replace(/(CR|DR)$/i, ''));
    return Number.isFinite(n) ? n : 0;
  }

  /** A date from a spreadsheet cell — see `parseStatementDate` in @oms/shared,
   *  which the Bank Statement page uses to derive the range this then honours. */
  private cellDate(v: unknown, order: StatementDateOrder = 'dmy'): Date | null {
    return parseStatementDate(v, order);
  }

  private runDto(r: {
    id: number; fileName: string; bankName: string | null; fromDate: Date; toDate: Date; uploadedAt: Date;
    userName: string | null; status: string; processedAt: Date | null; rowCount: number; creditTotal: number;
    matchedCount: number; partialCount: number; unmatchedCount: number; noPartyCount: number; postedCount: number; ignoredCount: number;
  }): BankStatementRunDto {
    return {
      id: r.id,
      fileName: r.fileName,
      bankName: r.bankName,
      fromDate: r.fromDate.toISOString(),
      toDate: r.toDate.toISOString(),
      uploadedAt: r.uploadedAt.toISOString(),
      userName: r.userName,
      status: r.status as BankStatementRunDto['status'],
      processedAt: iso(r.processedAt),
      rowCount: r.rowCount,
      creditTotal: r.creditTotal,
      matchedCount: r.matchedCount,
      partialCount: r.partialCount,
      unmatchedCount: r.unmatchedCount,
      noPartyCount: r.noPartyCount,
      postedCount: r.postedCount,
      ignoredCount: r.ignoredCount,
    };
  }

  private rowDto(r: {
    id: number; runId: number; rowNo: number; txnDate: Date; narration: string; refNo: string | null; amount: number;
    customerId: number | null; customerName: string | null; partySource: string | null; status: string;
    partyAt: Date | null; partyBy: string | null;
    matchedRefs: string | null; matchedAmount: number; note: string | null; postedRef: string | null; postedAt: Date | null;
  }): BankStatementRowDto {
    return {
      id: r.id,
      runId: r.runId,
      rowNo: r.rowNo,
      txnDate: r.txnDate.toISOString(),
      narration: r.narration,
      refNo: r.refNo,
      amount: r.amount,
      customerId: r.customerId,
      customerName: r.customerName,
      partySource: r.partySource as BankStatementRowDto['partySource'],
      partyAt: iso(r.partyAt),
      partyBy: r.partyBy,
      status: r.status as BankRowStatus,
      matchedRefs: r.matchedRefs ? r.matchedRefs.split(',').filter(Boolean) : [],
      matchedAmount: r.matchedAmount,
      note: r.note,
      postedRef: r.postedRef,
      postedAt: iso(r.postedAt),
    };
  }
}
