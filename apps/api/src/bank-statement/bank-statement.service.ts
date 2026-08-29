import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BANK_AMOUNT_TOL,
  BANK_DATE_TOL_DAYS,
  aliasFragment,
  bestNarrationParty,
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
  statementRowKey,
  type BankStatementCreateResponse,
  type BankStatementDuplicate,
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

@Injectable()
export class BankStatementService {
  private readonly logger = new Logger(BankStatementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  /* ── Column mapping memory ─────────────────────────────────────────────── */

  async columnPreset(bankName: string | undefined): Promise<{ map: BankStatementColumnMap | null }> {
    const row = await this.prisma.bankStatementColumnPreset.findUnique({ where: { bankName: (bankName ?? '').trim() } });
    if (!row) return { map: null };
    try {
      return { map: JSON.parse(row.mapJson) as BankStatementColumnMap };
    } catch {
      return { map: null };
    }
  }

  private async rememberPreset(bankName: string, map: BankStatementColumnMap): Promise<void> {
    const key = (bankName ?? '').trim();
    await this.prisma.bankStatementColumnPreset.upsert({
      where: { bankName: key },
      create: { bankName: key, mapJson: JSON.stringify(map) },
      update: { mapJson: JSON.stringify(map) },
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

    const parsed: { rowNo: number; txnDate: Date; narration: string; refNo: string | null; amount: number }[] = [];
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
        skippedDebit += 1;
        return;
      }
      if (credit <= 0) {
        skippedDebit += 1;
        return;
      }
      const txnDate = this.cellDate(raw[map.date]);
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
      return this.createRun(dto, map, parsed, userName, 0, from, to);
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

    return this.createRun(dto, map, fresh, userName, parsed.length - fresh.length, from, to);
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
    await this.rememberPreset(dto.bankName?.trim() ?? '', map);

    await this.attributeParties(run.id);
    await this.rematch(run.id);
    const result = await this.result(run.id);
    if (duplicateSkipped) this.logger.log(`Run ${run.id}: left out ${duplicateSkipped} line(s) already held.`);
    return {
      outcome: 'created' as const,
      ...result,
      run: { ...result.run, ...(duplicateSkipped ? { duplicateSkipped } : {}) },
    };
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
    const receipts = await this.receiptVouchers(null, run.fromDate, run.toDate);

    for (const row of rows) {
      let customerId: number | null = null;
      let source: string | null = null;

      const tokens = narrationTokens(row.narration);
      const alias = aliases.find((a) => tokens.includes(a.fragment) || row.narration.toUpperCase().includes(a.fragment));
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
      if (!customerId) {
        const hits = receipts.filter(
          (v) => Math.abs(v.amount - row.amount) <= BANK_AMOUNT_TOL && Math.abs(+v.recDate - +row.txnDate) <= BANK_DATE_TOL_DAYS * DAY,
        );
        const parties = [...new Set(hits.map((h) => h.custId))];
        if (parties.length === 1) {
          customerId = parties[0];
          source = 'RECEIPT';
        }
      }

      if (!customerId) {
        // Returns null when the narration names no one, or names two parties
        // equally well — an unassigned line costs a click, a wrongly assigned
        // one puts a customer's money against another customer's name.
        const hit = bestNarrationParty(row.narration, named);
        if (hit) {
          customerId = hit.id;
          source = 'NARRATION';
        }
      }

      if (!customerId) continue;
      const name = customers.find((c) => c.id === customerId)?.partyName ?? null;
      await this.prisma.bankStatementRow.update({
        where: { id: row.id },
        data: { customerId, customerName: name, partySource: source },
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
    const run = await this.prisma.bankStatementRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const rows = await this.prisma.bankStatementRow.findMany({ where: { runId }, orderBy: [{ txnDate: 'asc' }, { id: 'asc' }] });

    const byParty = new Map<number, typeof rows>();
    for (const row of rows) {
      if (row.status === 'IGNORED' || row.status === 'POSTED') continue;
      if (row.customerId == null) continue;
      const list = byParty.get(row.customerId) ?? [];
      list.push(row);
      byParty.set(row.customerId, list);
    }

    const updates: { id: number; status: BankRowStatus; matchedRefs: string | null; matchedAmount: number }[] = [];

    for (const [customerId, partyRows] of byParty) {
      const vouchers = (await this.receiptVouchers(customerId, run.fromDate, run.toDate)).map((v) => ({ ...v, used: false }));

      // Pass 1 — line level, nearest date.
      for (const row of partyRows) {
        const candidates = vouchers
          .filter((v) => !v.used && Math.abs(v.amount - row.amount) <= BANK_AMOUNT_TOL && Math.abs(+v.recDate - +row.txnDate) <= BANK_DATE_TOL_DAYS * DAY)
          .sort((a, b) => Math.abs(+a.recDate - +row.txnDate) - Math.abs(+b.recDate - +row.txnDate));
        const hit = candidates[0];
        if (hit) {
          hit.used = true;
          updates.push({ id: row.id, status: 'MATCHED', matchedRefs: hit.refId, matchedAmount: row.amount });
        }
      }

      // Pass 2 — whatever is left, in total.
      const matchedIds = new Set(updates.filter((u) => u.status === 'MATCHED').map((u) => u.id));
      const leftoverRows = partyRows.filter((r) => !matchedIds.has(r.id));
      const spareVouchers = vouchers.filter((v) => !v.used);
      let spare = r2(spareVouchers.reduce((s, v) => s + v.amount, 0));
      const spareRefs = spareVouchers.map((v) => v.refId);

      for (const row of leftoverRows) {
        if (spare >= row.amount - BANK_AMOUNT_TOL) {
          // Covered by receipts that exist, just not one-to-one with this line.
          spare = r2(spare - row.amount);
          updates.push({ id: row.id, status: 'PARTIAL', matchedRefs: spareRefs.join(','), matchedAmount: row.amount });
        } else {
          const covered = r2(Math.max(0, spare));
          spare = 0;
          updates.push({
            id: row.id,
            status: 'UNMATCHED',
            matchedRefs: covered > 0 ? spareRefs.join(',') : null,
            matchedAmount: covered,
          });
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Every row that has a party starts from a clean slate each time, so a
      // reassignment cannot leave last round's verdict behind.
      await tx.bankStatementRow.updateMany({
        where: { runId, status: { notIn: ['IGNORED', 'POSTED'] } },
        data: { status: 'NO_PARTY', matchedRefs: null, matchedAmount: 0 },
      });
      for (const u of updates) {
        await tx.bankStatementRow.update({
          where: { id: u.id },
          data: { status: u.status, matchedRefs: u.matchedRefs, matchedAmount: u.matchedAmount },
        });
      }
      await this.recount(tx, runId);
    });
  }

  /** Receipt VOUCHERS (not allocation rows) on the bank leg for the range. */
  private async receiptVouchers(
    customerId: number | null,
    from: Date,
    to: Date,
  ): Promise<{ refId: string; custId: number; recDate: Date; amount: number }[]> {
    const rows = await this.prisma.acctPaymentReceipt.findMany({
      where: {
        ...(customerId != null ? { custId: customerId } : {}),
        recType: 'RECEIPT',
        payMode: { in: ['BANK', 'CHEQUE'] },
        recDate: { gte: from, lt: new Date(to.getTime() + DAY) },
      },
      select: { refId: true, custId: true, recDate: true, recAmt: true },
    });
    // One Receive Payment voucher writes one row PER INVOICE it allocated to,
    // all sharing a refId. The bank saw the voucher, not the allocations.
    const byRef = new Map<string, { refId: string; custId: number; recDate: Date; amount: number }>();
    for (const r of rows) {
      const cur = byRef.get(r.refId);
      if (cur) cur.amount = r2(cur.amount + r.recAmt);
      else byRef.set(r.refId, { refId: r.refId, custId: r.custId, recDate: r.recDate, amount: r2(r.recAmt) });
    }
    return [...byRef.values()].sort((a, b) => +a.recDate - +b.recDate);
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
    const live = rows.filter((r) => r.status !== 'IGNORED');
    const statementTotal = r2(live.reduce((s, r) => s + r.amount, 0));
    // POSTED counts as accounted-for: the receipt now exists because this run
    // created it. Leaving it out made a processed run read as though its money
    // were neither matched nor outstanding.
    const accounted = ['MATCHED', 'PARTIAL', 'POSTED'];
    const matchedTotal = r2(live.filter((r) => accounted.includes(r.status)).reduce((s, r) => s + r.amount, 0));
    const shortfall = r2(live.filter((r) => r.status === 'UNMATCHED').reduce((s, r) => s + (r.amount - r.matchedAmount), 0));

    const vouchers = await this.receiptVouchers(customerId, run.fromDate, run.toDate);
    const omsTotal = r2(vouchers.reduce((s, v) => s + v.amount, 0));

    const before = await this.balanceOf(customerId, customer.partyName ?? '', vouchers.length, omsTotal);
    // The projection: the shortfall lands on the bank leg as new receipts, which
    // is exactly what Process would do.
    // Anything beyond what the party owes does not disappear — the payments
    // engine parks it as an advance, so the projection says so.
    const spill = r2(Math.max(0, shortfall - before.pendingBank));
    const after: BankPartyBalance = {
      receiptCount: before.receiptCount + live.filter((r) => r.status === 'UNMATCHED').length,
      receiptTotal: r2(before.receiptTotal + shortfall),
      pendingBank: r2(Math.max(0, before.pendingBank - shortfall)),
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
  async process(runId: number, userName?: string | null): Promise<BankStatementProcessResult> {
    const run = await this.mustBeDraft(runId);
    const rows = await this.prisma.bankStatementRow.findMany({
      where: { runId, status: 'UNMATCHED' },
      orderBy: [{ txnDate: 'asc' }, { id: 'asc' }],
    });
    if (!rows.length) {
      throw new BadRequestException('Nothing to post — every line either matches a receipt already or has no party.');
    }

    const created: BankStatementProcessResult['created'] = [];
    const failed: BankStatementProcessResult['failed'] = [];

    for (const row of rows) {
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
      try {
        const res = await this.payments.save(
          {
            takeAccOn: 'PARTY',
            customerId: row.customerId,
            payMode: 'BANK',
            bankName: run.bankName ?? null,
            adjMode: 'AUTOMATIC',
            receiptAmt: amount,
            recDate: ymd(row.txnDate),
            remarks: `Bank statement ${run.fileName}${row.refNo ? ` — ref ${row.refNo}` : ''}`,
          },
          userName,
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
        created.push({ rowId: row.id, voucherNo, amount, customerName: row.customerName ?? '' });
      } catch (e) {
        failed.push({ rowId: row.id, reason: e instanceof Error ? e.message : 'Could not post this receipt.' });
      }
    }

    // Processed only when something actually landed — a run that failed
    // entirely stays a draft so it can be fixed and run again.
    if (created.length) {
      await this.prisma.bankStatementRun.update({
        where: { id: runId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
    }
    await this.prisma.$transaction(async (tx) => this.recount(tx, runId));
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
      if (r.customerId == null || r.status === 'IGNORED') continue;
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
  private cellDate(v: unknown): Date | null {
    return parseStatementDate(v);
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
      status: r.status as BankRowStatus,
      matchedRefs: r.matchedRefs ? r.matchedRefs.split(',').filter(Boolean) : [],
      matchedAmount: r.matchedAmount,
      note: r.note,
      postedRef: r.postedRef,
      postedAt: iso(r.postedAt),
    };
  }
}
