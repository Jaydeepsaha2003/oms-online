import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ReconCreateReceiptInput,
  ReconCreateReceiptResult,
  ReconRow,
  ReconRunResult,
  ReconRunSummary,
  ReconStatus,
  TallyAliasDto,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { parseTallyRegister, type ParsedRegister } from './tally-register.parser';
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
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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

    const openings = await this.prisma.acctOpeningTrans.findMany({
      where: { kind: 'OPENING', transDate: { lte: from }, custId: { in: custIds } },
      select: { custId: true, bankAmt: true, cashAmt: true, transDate: true, drCr: true },
    });
    /** custId → the date that party's opening figure is stated as at. */
    const anchor = new Map<number, Date>();
    for (const o of openings) {
      const book = books.get(o.custId);
      if (!book) continue;
      const sign = (o.drCr ?? 'DEBIT').toUpperCase() === 'CREDIT' ? -1 : 1;
      book.openingBankNet += sign * (o.bankAmt ?? 0);
      book.openingCashNet += sign * (o.cashAmt ?? 0);
      book.hasOpening = true;
      const prev = anchor.get(o.custId);
      if (!prev || o.transDate > prev) anchor.set(o.custId, o.transDate);
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

    const count = (s: ReconStatus) => rows.filter((r) => r.status === s).length;
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
    };

    const run = await this.prisma.tallyReconRun.create({
      data: {
        ...summary,
        rows: {
          create: rows.map((r) => ({
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
      include: { rows: { orderBy: [{ ledgerName: 'asc' }, { txnDate: 'asc' }, { id: 'asc' }] } },
    });
    if (!run) throw new NotFoundException('That reconciliation run no longer exists.');
    const unmatchedLedgers = [...new Set(run.rows.filter((r) => r.status === 'UNMATCHED_PARTY').map((r) => r.ledgerName))].sort();
    return {
      ...this.toSummary(run),
      unmatchedLedgers,
      rows: run.rows.map((r) => this.toRow(r)),
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
    };
  }

  private toRow(r: {
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
    };
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
    await this.prisma.tallyReconRun.update({
      where: { id: runId },
      data: {
        matchedCount: of('MATCHED'),
        missingInOms: of('MISSING_IN_OMS'),
        missingInTally: of('MISSING_IN_TALLY'),
        mismatchCount: of('AMOUNT_MISMATCH') + of('DATE_MISMATCH'),
        unmatchedParty: of('UNMATCHED_PARTY'),
      },
    });
  }
}
