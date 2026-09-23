import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TallyLedger, TallyPostResult, TallyPostStatus, TallyPreview, TallyPreviewTest, TallyQueueRow } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { tag } from '../account-groups/tally-master.parser';
import { TallyService } from './tally.service';
import { currentFy, DEBTORS_TDL, parseLedgers, TALLY_PREFIX, tallyVoucherNo } from './tally-parties.service';
import { buildSalesVoucher, salesVoucherXml, type SalesVoucher, type VoucherParty } from './tally-voucher';

/** Sales vouchers with their stock and ledger lines (cancelled ones included). */
const LINES_TDL = (filter: string) =>
  '<COLLECTION NAME="OmsSaleLines"><TYPE>Voucher</TYPE>' +
  '<FETCH>GUID,MasterId,AlterId,VoucherNumber,Date,PartyLedgerName,PartyGSTIN,IsCancelled,IRNAckNo,EWayBillDetails.List,AllInventoryEntries.List,LedgerEntries.List</FETCH>' +
  `<FILTER>OmsPick</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="OmsPick">$VoucherTypeName = "Sales"${filter}</SYSTEM>`;


const CHALLAN_SELECT = {
  id: true,
  code: true,
  invDate: true,
  customerId: true,
  customerName: true,
  transaction: true,
  challanStatus: true,
  noBill: true,
  billingRate: true,
  gst: true,
  tax: true,
  tcs: true,
  total: true,
  b: true,
  c: true,
  packing: true,
  freight: true,
  pouch: true,
  transName: true,
  items: { select: { productName: true, unit: true, pCategory: true, kgs: true, pcs: true, price: true, bags: true, gstRate: true } },
  tallyVoucher: { select: { tallyGuid: true, cancelled: true, status: true, vchNo: true, updatedAt: true } },
} satisfies Prisma.ChallanSelect;
type ChallanRow = Prisma.ChallanGetPayload<{ select: typeof CHALLAN_SELECT }>;

/** "180.00/KGS" → 180, " 168.400 KGS" → 168.4, "-31828.00" → -31828 */
const num = (s: string | null) => parseFloat((s ?? '').replace(/[^0-9.-]/g, '')) || 0;
const int = (s: string | null) => (s && Number.isFinite(+s) ? +s : null);
/** A POSTING older than this was interrupted (crash, restart) and is treated as UNKNOWN. */
const STALE_MS = 2 * 60_000;
/** An UNKNOWN is declared FAILED only if the voucher is still absent this long after the attempt. */
const SETTLE_MS = 60_000;

interface Actual {
  guid: string;
  masterId: number | null;
  alterId: number | null;
  vchNo: string | null;
  date: Date | null;
  party: string;
  partyGstin: string | null;
  /** E-way bill Part-A transporter ID on the voucher, if any. */
  transporterId: string | null;
  cancelled: boolean;
  irnAckNo: string | null;
  items: Map<string, { qty: number; amount: number }>;
  ledgers: Map<string, number>;
}

function parseActual(xml: string): Actual[] {
  return [...xml.matchAll(/<VOUCHER [^>]*>([^]*?)<\/VOUCHER>/g)].map(([, v]) => {
    const items = new Map<string, { qty: number; amount: number }>();
    for (const [, b] of v.matchAll(/<ALLINVENTORYENTRIES\.LIST>([^]*?)<\/ALLINVENTORYENTRIES\.LIST>/g)) {
      const key = `${tag(b, 'STOCKITEMNAME')}|${num(tag(b, 'RATE'))}`;
      const m = items.get(key) ?? { qty: 0, amount: 0 };
      items.set(key, { qty: m.qty + num(tag(b, 'BILLEDQTY')), amount: m.amount + Math.abs(num(tag(b, 'AMOUNT'))) });
    }
    const ledgers = new Map<string, number>();
    for (const [, b] of v.matchAll(/<LEDGERENTRIES\.LIST>([^]*?)<\/LEDGERENTRIES\.LIST>/g)) {
      const name = tag(b, 'LEDGERNAME');
      if (name) ledgers.set(name, (ledgers.get(name) ?? 0) + num(tag(b, 'AMOUNT')));
    }
    // Header fields are read from the part before the first line list, so a
    // line's own DATE or GUID can never be mistaken for the voucher's.
    const head = v.split(/<ALLINVENTORYENTRIES\.LIST>|<LEDGERENTRIES\.LIST>/)[0];
    const d = tag(head, 'DATE');
    return {
      guid: tag(head, 'GUID') ?? '',
      masterId: int(tag(head, 'MASTERID')),
      alterId: int(tag(head, 'ALTERID')),
      vchNo: tag(head, 'VOUCHERNUMBER'),
      date: d && /^\d{8}$/.test(d) ? new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) : null,
      party: tag(head, 'PARTYLEDGERNAME') ?? '',
      partyGstin: tag(head, 'PARTYGSTIN'),
      transporterId: tag(v, 'TRANSPORTERID'),
      cancelled: tag(head, 'ISCANCELLED') === 'Yes',
      irnAckNo: tag(head, 'IRNACKNO'),
      items,
      ledgers,
    };
  });
}

const close = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

/** Every way the voucher OMS would send differs from the one in Tally. */
function differences(v: SalesVoucher, a: Actual): string[] {
  const d: string[] = [];
  if (a.party !== v.party) d.push(`Party: Tally "${a.party}", OMS "${v.party}"`);
  const billed = Math.abs(a.ledgers.get(a.party) ?? 0);
  if (!close(billed, v.total, 0.01)) d.push(`Total: Tally ₹${billed}, OMS ₹${v.total}`);
  const mine = new Map(v.lines.map((l) => [`${l.item}|${l.rate}`, l]));
  for (const key of new Set([...mine.keys(), ...a.items.keys()])) {
    const [item, rate] = key.split('|');
    const m = mine.get(key);
    const t = a.items.get(key);
    if (!m || !t) d.push(`${item} @ ₹${rate}: ${m ? `only in OMS (${m.qty})` : `only in Tally (${t!.qty})`}`);
    else if (!close(m.qty, t.qty, 0.001) || !close(m.amount, t.amount)) d.push(`${item} @ ₹${rate}: Tally ${t.qty} = ₹${t.amount}, OMS ${m.qty} = ₹${m.amount}`);
  }
  const ledgers = new Map(v.ledgers.map((l) => [l.name, l.amount]));
  for (const name of new Set([...ledgers.keys(), ...[...a.ledgers.keys()].filter((n) => n !== a.party)])) {
    const m = ledgers.get(name) ?? 0;
    const t = a.ledgers.get(name) ?? 0;
    if (!close(m, t)) d.push(`${name}: Tally ₹${t}, OMS ₹${m}`);
  }
  return d;
}

/** Tally's import reply: counters plus any line errors, in words. */
function parseImport(xml: string) {
  const n = (t: string) => int(tag(xml, t)) ?? 0;
  const lineErrors = [...xml.matchAll(/<LINEERROR>([^<]*)<\/LINEERROR>/g)].map((m) => m[1].trim()).filter(Boolean);
  return { created: n('CREATED'), altered: n('ALTERED'), errors: n('ERRORS'), exceptions: n('EXCEPTIONS'), lineErrors };
}

type Ctx = Awaited<ReturnType<TallyPostingService['context']>>;

@Injectable()
export class TallyPostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tally: TallyService,
  ) {}

  /** Party + company context every build needs, read live once. */
  private async context() {
    const company = await this.tally.lockedCompany();
    const ledgers = new Map(parseLedgers(await this.tally.exportFromCompany('OmsDebtors', DEBTORS_TDL)).map((l) => [l.guid, l]));
    const customers = new Map(
      (
        await this.prisma.customer.findMany({ where: { tallyLedgerGuid: { not: null } }, select: { id: true, tallyLedgerGuid: true, tallyGstin: true, city: true } })
      ).map((c) => [c.id, c]),
    );
    const { gstLockDate } = await this.tally.getConfig();
    // End of the filed day, local time: a bill dated that day is inside the filed period.
    const lockedUpTo = gstLockDate ? new Date(`${gstLockDate}T23:59:59.999`) : null;
    // Transporter name → GSTIN/TRANSIN, for the e-way bill details sent with each bill.
    const transporters = new Map(
      (await this.prisma.transporter.findMany({ where: { gstin: { not: null } }, select: { name: true, gstin: true } })).map((t) => [t.name.trim().toUpperCase(), t.gstin!]),
    );
    return { company, companyState: company.state ?? '', ledgers, customers, lockedUpTo, transporters };
  }

  private build(c: ChallanRow, ctx: Ctx): TallyPreview & { party: VoucherParty; built: SalesVoucher | null } {
    const cust = c.customerId != null ? ctx.customers.get(c.customerId) : undefined;
    const ledger: TallyLedger | undefined = cust ? ctx.ledgers.get(cust.tallyLedgerGuid!) : undefined;
    const partyBlock = !cust
      ? `${c.customerName} is not mapped to a Tally ledger (Tally Sync Center → Party mapping).`
      : !ledger
        ? `${c.customerName}'s Tally ledger is gone from Tally — map it again.`
        : (ledger.gstin ?? '') !== (cust.tallyGstin ?? '')
          ? `${c.customerName}'s GSTIN changed in Tally — re-confirm the mapping.`
          : null;
    const party: VoucherParty = {
      name: ledger?.name ?? c.customerName,
      state: ledger?.state ?? null,
      gstin: ledger?.gstin,
      registrationType: ledger?.registrationType,
      address: ledger?.address,
      pincode: ledger?.pincode,
      city: cust?.city,
    };
    const vchNo = tallyVoucherNo(c.code);
    const { voucher, blocks } = buildSalesVoucher(c, party, ctx.companyState, vchNo ?? c.code);
    // Checked first and alone: an NB/DN bill is not a Tally bill at all, and a
    // bill inside a filed GST period must not change that return — nothing else matters then.
    const all = !vchNo
      ? [`Only ${TALLY_PREFIX} series bills go to Tally — ${c.code} is not one.`]
      : ctx.lockedUpTo && c.invDate <= ctx.lockedUpTo
        ? [`GST is filed up to ${ctx.lockedUpTo.toLocaleDateString('en-GB')} — a bill dated ${c.invDate.toLocaleDateString('en-GB')} is not posted. Enter it in Tally only after checking with the CA.`]
        : partyBlock
          ? [partyBlock, ...blocks]
          : blocks;
    const built = all.length ? null : voucher;
    if (built) built.transporterId = ctx.transporters.get((c.transName ?? '').trim().toUpperCase()) ?? null;
    return {
      challanId: c.id,
      code: c.code,
      customerName: c.customerName,
      billingRate: c.billingRate,
      gaushalaAmount: c.c,
      blocks: all,
      voucher: built ? { ...built, date: built.date.toISOString() } : null,
      differences: null,
      party,
      built,
    };
  }

  /** Look a voucher up in Tally by its number (this FY). */
  private async findInTally(vchNo: string): Promise<Actual | undefined> {
    return (await this.findWhere(` AND $VoucherNumber = "${vchNo.replace(/"/g, '')}"`)).find((a) => a.vchNo === vchNo);
  }

  private async findWhere(filter: string): Promise<Actual[]> {
    const fy = currentFy();
    const xml = await this.tally.exportFromCompany(
      'OmsSaleLines',
      LINES_TDL(filter),
      `<SVFROMDATE TYPE="Date">${fy.from}</SVFROMDATE><SVTODATE TYPE="Date">${fy.to}</SVTODATE>`,
    );
    return parseActual(xml);
  }

  /** An interrupted POSTING (crash, restart, closed tab) becomes UNKNOWN — never silently retried. */
  private async expireStale(): Promise<void> {
    await this.prisma.tallyVoucher.updateMany({
      where: { status: 'POSTING', updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
      data: { status: 'UNKNOWN', lastError: 'The posting was interrupted before Tally answered.' },
    });
  }

  /** Record a voucher now in Tally against this invoice. */
  private async link(challanId: number, a: Actual, source: 'OMS' | 'HISTORY', by: string | null, v: SalesVoucher | null) {
    const { companyGuid } = await this.tally.getConfig();
    const diffs = v ? differences(v, a) : [];
    const data = {
      companyGuid: companyGuid ?? '',
      status: 'POSTED',
      tallyGuid: a.guid,
      tallyMasterId: a.masterId,
      tallyAlterId: a.alterId,
      vchNo: a.vchNo,
      vchDate: a.date,
      partyLedger: a.party,
      amount: Math.abs(a.ledgers.get(a.party) ?? 0),
      cancelled: a.cancelled,
      irnAckNo: a.irnAckNo,
      recon: a.cancelled ? 'CANCELLED_IN_TALLY' : diffs.length ? 'AMOUNT_MISMATCH' : 'OK',
      reconNote: a.cancelled ? 'Cancelled in Tally but live in OMS' : diffs.join('; ') || null,
      checkedAt: new Date(),
      lastError: null,
      ...(source === 'OMS' ? { source, postedBy: by, postedAt: new Date() } : {}),
    };
    // Another invoice may hold this voucher from an old link; the voucher is this one's now.
    await this.prisma.tallyVoucher.updateMany({ where: { tallyGuid: a.guid, challanId: { not: challanId } }, data: { tallyGuid: null } });
    await this.prisma.tallyVoucher.upsert({ where: { challanId }, create: { challanId, ...data }, update: data });
    return diffs;
  }

  /** What OMS would send for this invoice, and — if it is already in Tally — how that compares. */
  async preview(code: string): Promise<TallyPreview> {
    const c = await this.prisma.challan.findUnique({ where: { code: code.trim().toUpperCase() }, select: CHALLAN_SELECT });
    if (!c) throw new NotFoundException(`No invoice ${code.trim()} in OMS.`);
    const { party, built, ...p } = this.build(c, await this.context());
    if (built && c.tallyVoucher?.tallyGuid) {
      const actual = await this.findInTally(built.vchNo);
      if (actual && actual.guid === c.tallyVoucher.tallyGuid) p.differences = differences(built, actual);
    }
    void party;
    return p;
  }

  /** This year's invoices not (yet) in Tally, each with why it can't be posted, if it can't. */
  async queue(): Promise<TallyQueueRow[]> {
    await this.expireStale();
    const fy = currentFy();
    const challans = await this.prisma.challan.findMany({
      where: {
        transaction: 'SALES INVOICE',
        challanStatus: 'CONFIRMED',
        noBill: false,
        invDate: { gte: fy.start },
        OR: [{ tallyVoucher: null }, { tallyVoucher: { status: { not: 'POSTED' } } }],
      },
      select: { ...CHALLAN_SELECT, tallyVoucher: { select: { status: true, lastError: true, tallyGuid: true, cancelled: true, vchNo: true, updatedAt: true } } },
      orderBy: [{ invDate: 'desc' }, { id: 'desc' }],
    });
    const rows = challans.filter((c) => tallyVoucherNo(c.code));
    if (!rows.length) return [];
    const ctx = await this.context();
    return rows.map((c) => ({
      challanId: c.id,
      code: c.code,
      date: c.invDate.toISOString(),
      customerName: c.customerName,
      amount: c.b,
      status: (c.tallyVoucher?.status ?? 'NOT_POSTED') as TallyPostStatus,
      lastError: c.tallyVoucher?.lastError ?? null,
      blocks: this.build(c, ctx).blocks,
    }));
  }

  /**
   * Post one invoice to Tally. The order is the safety:
   *   1. every check, read-only;  2. is the number already in Tally? → link, never send twice;
   *   3. claim the invoice (one winner, enforced by the DB);  4. log what is sent;
   *   5. send;  6. read the voucher back from Tally — only that makes it POSTED.
   * No clear answer at 5 → UNKNOWN, resolved only by looking in Tally.
   */
  async post(code: string, by: string | null): Promise<TallyPostResult> {
    await this.expireStale();
    const c = await this.prisma.challan.findUnique({ where: { code: code.trim().toUpperCase() }, select: CHALLAN_SELECT });
    if (!c) throw new NotFoundException(`No invoice ${code.trim()} in OMS.`);
    const tv = c.tallyVoucher;
    if (tv?.status === 'POSTED') throw new ConflictException(`${c.code} is already in Tally as ${tv.vchNo}.`);
    if (tv?.status === 'POSTING' || tv?.status === 'UNKNOWN') {
      throw new ConflictException(`An earlier attempt for ${c.code} has no clear answer yet. Press "Check again" — OMS looks in Tally first.`);
    }
    const ctx = await this.context();
    const b = this.build(c, ctx);
    if (!b.built) throw new BadRequestException(b.blocks.join(' '));

    const already = await this.findInTally(b.built.vchNo);
    if (already) {
      const diffs = await this.link(c.id, already, 'HISTORY', by, b.built);
      await this.prisma.tallyPostLog.create({ data: { challanId: c.id, code: c.code, userName: by, finishedAt: new Date(), outcome: 'LINKED' } });
      return {
        status: 'POSTED',
        message: `${b.built.vchNo} was already in Tally (typed by hand) — linked, not sent again.`,
        vchNo: b.built.vchNo,
        warnings: diffs,
      };
    }

    // The claim. Only NOT_POSTED/FAILED can become POSTING, and the unique
    // challanId stops two first-time claims — a double click loses here.
    const { companyGuid } = await this.tally.getConfig();
    try {
      if (tv) {
        const r = await this.prisma.tallyVoucher.updateMany({
          where: { challanId: c.id, status: { in: ['NOT_POSTED', 'FAILED'] } },
          data: { status: 'POSTING', lastError: null },
        });
        if (r.count !== 1) throw new ConflictException(`${c.code} is already being posted.`);
      } else {
        await this.prisma.tallyVoucher.create({
          data: { challanId: c.id, companyGuid: companyGuid ?? '', status: 'POSTING', recon: 'MISSING_IN_TALLY', checkedAt: new Date() },
        });
      }
    } catch (e) {
      // P2002: the unique challanId — a second first-time claim lost the race.
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException(`${c.code} is already being posted.`);
      throw e;
    }

    const xml = salesVoucherXml(b.built, b.party);
    const log = await this.prisma.tallyPostLog.create({ data: { challanId: c.id, code: c.code, userName: by, requestXml: xml } });
    let responseXml: string;
    try {
      responseXml = (await this.tally.importVoucher(xml, ctx.company)).responseXml;
    } catch (e) {
      const msg = `No clear answer from Tally (${(e as Error).message}). It may or may not have saved the bill.`;
      await this.prisma.tallyVoucher.update({ where: { challanId: c.id }, data: { status: 'UNKNOWN', lastError: msg } });
      await this.prisma.tallyPostLog.update({ where: { id: log.id }, data: { finishedAt: new Date(), outcome: 'UNKNOWN', error: msg } });
      return { status: 'UNKNOWN', message: `${msg} Press "Check again" in a minute — OMS will look in Tally.`, vchNo: b.built.vchNo, warnings: [] };
    }

    const r = parseImport(responseXml);
    // Read back by our number; if Tally numbered it itself (Sales numbering is
    // Automatic), find it by the id Tally just reported and say so loudly.
    const lastId = int(tag(responseXml, 'LASTVCHID'));
    const found =
      (await this.findInTally(b.built.vchNo).catch(() => undefined)) ??
      (r.created === 1 && lastId ? (await this.findWhere(` AND $MasterId = ${lastId}`).catch(() => []))[0] : undefined);
    if (found) {
      const diffs = await this.link(c.id, found, 'OMS', by, b.built);
      const warnings = [...diffs];
      if (found.vchNo !== b.built.vchNo) warnings.unshift(`Tally gave it number ${found.vchNo}, not ${b.built.vchNo}. Do not make the e-invoice — tell the developer.`);
      if (b.party.gstin && !found.partyGstin) warnings.push('The party GSTIN is not on the Tally voucher — open it in Tally and check before the e-invoice.');
      if (b.built.transporterId && found.transporterId !== b.built.transporterId) {
        warnings.push(`Transporter ID ${b.built.transporterId} did not reach Tally's e-way bill details — fill it in there before the e-way bill.`);
      }
      if (!b.built.transporterId && b.built.shippedBy) {
        warnings.push(`Transporter ${b.built.shippedBy} has no GSTIN in OMS (Masters → Transporters) — fill it in Tally's e-way bill screen this time.`);
      }
      await this.prisma.tallyPostLog.update({ where: { id: log.id }, data: { finishedAt: new Date(), outcome: 'POSTED', responseXml } });
      return { status: 'POSTED', message: `Posted as ${found.vchNo} and read back from Tally.`, vchNo: found.vchNo, warnings };
    }
    if (r.created === 0 && (r.errors > 0 || r.exceptions > 0 || r.lineErrors.length)) {
      const msg = `Tally refused it: ${r.lineErrors.join('; ') || `${r.errors} error(s)`}. Nothing was created.`;
      await this.prisma.tallyVoucher.update({ where: { challanId: c.id }, data: { status: 'FAILED', lastError: msg } });
      await this.prisma.tallyPostLog.update({ where: { id: log.id }, data: { finishedAt: new Date(), outcome: 'FAILED', responseXml, error: msg } });
      return { status: 'FAILED', message: msg, vchNo: b.built.vchNo, warnings: [] };
    }
    const msg = `Tally said created=${r.created}, errors=${r.errors}, but the voucher could not be read back.`;
    await this.prisma.tallyVoucher.update({ where: { challanId: c.id }, data: { status: 'UNKNOWN', lastError: msg } });
    await this.prisma.tallyPostLog.update({ where: { id: log.id }, data: { finishedAt: new Date(), outcome: 'UNKNOWN', responseXml, error: msg } });
    return { status: 'UNKNOWN', message: `${msg} Press "Check again".`, vchNo: b.built.vchNo, warnings: [] };
  }

  /** Settle an UNKNOWN by looking in Tally — the only way it is ever settled. */
  async resolve(code: string, by: string | null): Promise<TallyPostResult> {
    await this.expireStale();
    const c = await this.prisma.challan.findUnique({ where: { code: code.trim().toUpperCase() }, select: CHALLAN_SELECT });
    if (!c) throw new NotFoundException(`No invoice ${code.trim()} in OMS.`);
    const tv = c.tallyVoucher;
    if (tv?.status !== 'UNKNOWN') throw new ConflictException(`${c.code} is not waiting for a check (it is ${tv?.status ?? 'NOT_POSTED'}).`);
    const vchNo = tallyVoucherNo(c.code)!;
    const found = await this.findInTally(vchNo); // throws if Tally is not reachable → stays UNKNOWN
    if (found) {
      const ctx = await this.context();
      const diffs = await this.link(c.id, found, 'OMS', by, this.build(c, ctx).built);
      await this.prisma.tallyPostLog.create({ data: { challanId: c.id, code: c.code, userName: by, finishedAt: new Date(), outcome: 'RESOLVED_POSTED' } });
      return { status: 'POSTED', message: `Tally did save it: ${found.vchNo}. Linked.`, vchNo: found.vchNo, warnings: diffs };
    }
    if (Date.now() - tv.updatedAt.getTime() < SETTLE_MS) {
      return { status: 'UNKNOWN', message: 'Not in Tally yet — Tally may still be saving. Check again in a minute.', vchNo, warnings: [] };
    }
    const msg = 'Tally did not save it (checked). Safe to post again.';
    await this.prisma.tallyVoucher.update({ where: { challanId: c.id }, data: { status: 'FAILED', lastError: msg } });
    await this.prisma.tallyPostLog.create({ data: { challanId: c.id, code: c.code, userName: by, finishedAt: new Date(), outcome: 'RESOLVED_FAILED' } });
    return { status: 'FAILED', message: msg, vchNo, warnings: [] };
  }

  /** Run the builder over every bill of this year already in Tally, and compare each with Tally's own. */
  async testAgainstTally(): Promise<TallyPreviewTest> {
    const fy = currentFy();
    const ctx = await this.context();
    const actual = new Map(
      parseActual(
        await this.tally.exportFromCompany('OmsSaleLines', LINES_TDL(' AND NOT $IsCancelled'), `<SVFROMDATE TYPE="Date">${fy.from}</SVFROMDATE><SVTODATE TYPE="Date">${fy.to}</SVTODATE>`, 120_000),
      ).map((a) => [a.guid, a]),
    );
    const challans = await this.prisma.challan.findMany({
      where: { challanStatus: 'CONFIRMED', tallyVoucher: { tallyGuid: { not: null }, cancelled: false } },
      select: CHALLAN_SELECT,
    });

    const skipped = new Map<string, number>();
    const mismatches: TallyPreview[] = [];
    let tested = 0;
    for (const c of challans) {
      const { party, built, ...p } = this.build(c, ctx);
      void party;
      const a = actual.get(c.tallyVoucher!.tallyGuid!);
      if (!built || !a) {
        const reason = p.blocks[0]?.replace(/\(₹[^)]*\)|₹[\d.,-]+|\d+(\.\d+)?%/g, '…').split(/ — |: /)[0].trim() ?? 'Not found in Tally';
        skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
        continue;
      }
      tested++;
      p.differences = differences(built, a);
      if (p.differences.length) mismatches.push(p);
    }
    return {
      tested,
      identical: tested - mismatches.length,
      skipped: [...skipped].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      mismatches: mismatches.slice(0, 50),
    };
  }
}
