import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TallyPostResult, TallyPreview } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TallyService } from './tally.service';
import { currentFy } from './tally-parties.service';
import { TallyPostingService, LINES_TDL, parseActual, differences, parseImport, type Actual, type Ctx } from './tally-posting.service';
import { buildSalesVoucher, salesVoucherXml, type SalesVoucher } from './tally-voucher';

const CN = 'Credit Note';
/** A Tally credit note within this many days of the OMS one, same party and amount, is the same note. */
const WINDOW_MS = 15 * 86_400_000;
const STALE_MS = 2 * 60_000;
const SETTLE_MS = 60_000;
const n = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : 0);

type Note = NonNullable<Awaited<ReturnType<TallyNotesService['load']>>>;

/**
 * OMS credit note → Tally Credit Note. Same safety as bills (claim, send, read
 * back, UNKNOWN settled only by looking in Tally), with two differences:
 *  - Tally numbers credit notes itself (1, 2, 3…), so OMS takes the next free
 *    Tally number and keeps it on the link; nothing about OMS goes into Tally.
 *  - Before sending, a Tally note of the same party + amount near the date
 *    counts as this one (typed by hand) and is linked instead.
 */
@Injectable()
export class TallyNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tally: TallyService,
    private readonly posting: TallyPostingService,
  ) {}

  private load(code: string) {
    return this.prisma.creditNote.findUnique({ where: { code: code.trim().toUpperCase() }, include: { items: true } });
  }

  /** A line credited far below what it was billed at is a rate cut, not goods coming back. */
  private async itemLedger(note: Note): Promise<string> {
    const ids = note.items.map((i) => i.dispatchId).filter((id): id is number => !!id);
    const rate = new Map((await this.prisma.dispatch.findMany({ where: { id: { in: ids } }, select: { id: true, rate: true } })).map((d) => [d.id, d.rate]));
    const cut = note.items.length > 0 && note.items.every((i) => i.dispatchId && n(i.price) < 0.5 * n(rate.get(i.dispatchId)));
    return cut ? 'RATE DIFFERANCE' : 'SALES RETURN';
  }

  private async build(note: Note, ctx: Ctx) {
    const { party, partyBlock } = this.posting.partyFor(note.customerId, note.customerName, ctx);
    const own: string[] = [];
    if (!(n(note.b) > 0)) own.push('No-bill credit note (B = 0) — it does not go to Tally.');
    if (n(note.billingRate) > 0) own.push('Half-bill credit note — enter it in Tally by hand.');
    if (n(note.otherCharges) !== 0) own.push('This note has "other charges" — enter it in Tally by hand.');
    if (ctx.lockedUpTo && note.invDate <= ctx.lockedUpTo) own.push(`GST is filed up to ${ctx.lockedUpTo.toLocaleDateString('en-GB')} — this note is not posted.`);
    const { voucher, blocks } = buildSalesVoucher(
      {
        code: note.code, invDate: note.invDate, transaction: 'SALES INVOICE', challanStatus: 'CONFIRMED', noBill: note.noBill, billingRate: 0,
        gst: note.gst, tax: note.tax, tcs: 0, total: note.total, b: note.b, packing: note.packing, freight: note.freight, pouch: note.pouch, transName: null,
        items: note.items,
      },
      party,
      ctx.companyState,
      '',
    );
    const all = own.length ? own : partyBlock ? [partyBlock, ...blocks] : blocks;
    return { party, built: all.length ? null : voucher, blocks: all, itemLedger: await this.itemLedger(note) };
  }

  /** This FY's Tally credit notes, with lines. */
  private async tallyNotes(filter = ''): Promise<Actual[]> {
    const fy = currentFy();
    return parseActual(
      await this.tally.exportFromCompany('OmsNoteLines', LINES_TDL(filter, CN), `<SVFROMDATE TYPE="Date">${fy.from}</SVFROMDATE><SVTODATE TYPE="Date">${fy.to}</SVTODATE>`),
    );
  }

  private async byNumber(vchNo: string) {
    return (await this.tallyNotes(` AND $VoucherNumber = "${vchNo.replace(/"/g, '')}"`)).find((a) => a.vchNo === vchNo);
  }

  /** Record a Tally credit note against this OMS one. */
  private async link(creditNoteId: number, a: Actual, source: 'OMS' | 'HISTORY', by: string | null, v: SalesVoucher | null) {
    const { companyGuid } = await this.tally.getConfig();
    const diffs = v ? differences(v, a, -1) : [];
    const data = {
      vchType: CN, companyGuid: companyGuid ?? '', status: 'POSTED', tallyGuid: a.guid, tallyMasterId: a.masterId, tallyAlterId: a.alterId,
      vchNo: a.vchNo, vchDate: a.date, partyLedger: a.party, amount: Math.abs(a.ledgers.get(a.party) ?? 0), cancelled: a.cancelled, irnAckNo: a.irnAckNo,
      recon: diffs.length ? 'AMOUNT_MISMATCH' : 'OK', reconNote: diffs.join('; ') || null, checkedAt: new Date(), lastError: null,
      ...(source === 'OMS' ? { source, postedBy: by, postedAt: new Date() } : {}),
    };
    await this.prisma.tallyVoucher.updateMany({ where: { tallyGuid: a.guid, NOT: { creditNoteId } }, data: { tallyGuid: null } });
    await this.prisma.tallyVoucher.upsert({ where: { creditNoteId }, create: { creditNoteId, ...data }, update: data });
    return diffs;
  }

  async preview(code: string): Promise<TallyPreview & { itemLedger: string }> {
    const note = await this.load(code);
    if (!note) throw new NotFoundException(`No credit note ${code.trim()} in OMS.`);
    const b = await this.build(note, await this.posting.context());
    const row = await this.prisma.tallyVoucher.findUnique({ where: { creditNoteId: note.id } });
    let diffs: string[] | null = null;
    if (b.built && row?.tallyGuid) {
      const a = (await this.tallyNotes(` AND $GUID = "${row.tallyGuid}"`))[0];
      if (a) diffs = [...differences(b.built, a, -1), ...(a.itemLedger && a.itemLedger !== b.itemLedger ? [`Item ledger: Tally ${a.itemLedger}, OMS ${b.itemLedger}`] : [])];
    }
    return {
      challanId: note.id, code: note.code, customerName: note.customerName, billingRate: note.billingRate, gaushalaAmount: note.c,
      blocks: b.blocks, voucher: b.built ? { ...b.built, vchNo: row?.vchNo ?? '(next)', date: b.built.date.toISOString() } : null,
      differences: diffs, itemLedger: b.itemLedger,
    };
  }

  /** Every OMS credit note already linked to a Tally one, rebuilt and compared line by line. */
  async testAgainstTally() {
    const ctx = await this.posting.context();
    const tally = new Map((await this.tallyNotes()).map((a) => [a.guid, a]));
    const rows = await this.prisma.tallyVoucher.findMany({ where: { vchType: CN, creditNoteId: { not: null }, tallyGuid: { not: null } } });
    const out: { code: string; tallyNo: string | null; itemLedger: string; blocks: string[]; differences: string[] }[] = [];
    for (const r of rows) {
      const note = await this.prisma.creditNote.findUnique({ where: { id: r.creditNoteId! }, include: { items: true } });
      const a = tally.get(r.tallyGuid!);
      if (!note || !a) continue;
      const b = await this.build(note, ctx);
      const diffs = b.built ? [...differences(b.built, a, -1), ...(a.itemLedger !== b.itemLedger ? [`Item ledger: Tally ${a.itemLedger}, OMS ${b.itemLedger}`] : [])] : [];
      out.push({ code: note.code, tallyNo: a.vchNo, itemLedger: b.itemLedger, blocks: b.blocks, differences: diffs });
    }
    return out;
  }

  /** WRITES TO TALLY: post one OMS credit note. */
  async post(code: string, by: string | null): Promise<TallyPostResult> {
    await this.prisma.tallyVoucher.updateMany({
      where: { vchType: CN, status: 'POSTING', updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
      data: { status: 'UNKNOWN', lastError: 'The posting was interrupted before Tally answered.' },
    });
    const note = await this.load(code);
    if (!note) throw new NotFoundException(`No credit note ${code.trim()} in OMS.`);
    const row = await this.prisma.tallyVoucher.findUnique({ where: { creditNoteId: note.id } });
    if (row?.status === 'POSTED') throw new ConflictException(`${note.code} is already in Tally as credit note ${row.vchNo}.`);
    if (row?.status === 'POSTING' || row?.status === 'UNKNOWN') {
      throw new ConflictException(`An earlier attempt for ${note.code} has no clear answer yet. Press "Check again" — OMS looks in Tally first.`);
    }
    const ctx = await this.posting.context();
    const b = await this.build(note, ctx);
    if (!b.built) throw new BadRequestException(b.blocks.join(' '));

    // Typed by hand already? Same party, same amount, near the date, and not another OMS note's.
    const all = await this.tallyNotes();
    const taken = new Set(
      (await this.prisma.tallyVoucher.findMany({ where: { vchType: CN, tallyGuid: { not: null }, NOT: { creditNoteId: note.id } }, select: { tallyGuid: true } })).map(
        (t) => t.tallyGuid,
      ),
    );
    const same = all.find(
      (a) =>
        !a.cancelled && !taken.has(a.guid) && a.party === b.party.name && Math.abs(Math.abs(a.ledgers.get(a.party) ?? 0) - n(note.b)) <= 1.01 &&
        a.date && Math.abs(a.date.getTime() - note.invDate.getTime()) <= WINDOW_MS,
    );
    if (same) {
      const diffs = await this.link(note.id, same, 'HISTORY', by, b.built);
      await this.prisma.tallyPostLog.create({ data: { challanId: note.id, code: note.code, userName: by, finishedAt: new Date(), outcome: 'LINKED' } });
      return { status: 'POSTED', message: `Tally already has this credit note (no. ${same.vchNo}, typed by hand) — linked, not sent again.`, vchNo: same.vchNo, warnings: diffs };
    }

    // Tally's next number — cancelled ones included, as Tally never reuses them.
    const vchNo = String(all.reduce((m, a) => Math.max(m, parseInt(a.vchNo ?? '', 10) || 0), 0) + 1);
    const { companyGuid } = await this.tally.getConfig();
    try {
      if (row) {
        const r = await this.prisma.tallyVoucher.updateMany({
          where: { creditNoteId: note.id, status: { in: ['NOT_POSTED', 'FAILED'] } },
          data: { status: 'POSTING', vchNo, lastError: null },
        });
        if (r.count !== 1) throw new ConflictException(`${note.code} is already being posted.`);
      } else {
        await this.prisma.tallyVoucher.create({
          data: { vchType: CN, creditNoteId: note.id, companyGuid: companyGuid ?? '', status: 'POSTING', vchNo, recon: 'MISSING_IN_TALLY', checkedAt: new Date() },
        });
      }
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException(`${note.code} is already being posted.`);
      throw e;
    }

    const xml = salesVoucherXml({ ...b.built, vchNo }, b.party, { itemLedger: b.itemLedger });
    // tally_post_log.challanId holds the credit note's id here; `code` (CN/…) says which table.
    const log = await this.prisma.tallyPostLog.create({ data: { challanId: note.id, code: note.code, userName: by, requestXml: xml } });
    let responseXml: string;
    try {
      responseXml = (await this.tally.importVoucher(xml, ctx.company)).responseXml;
    } catch (e) {
      const msg = `No clear answer from Tally (${(e as Error).message}). It may or may not have saved the credit note.`;
      await this.prisma.tallyVoucher.update({ where: { creditNoteId: note.id }, data: { status: 'UNKNOWN', lastError: msg } });
      await this.prisma.tallyPostLog.update({ where: { id: log.id }, data: { finishedAt: new Date(), outcome: 'UNKNOWN', error: msg } });
      return { status: 'UNKNOWN', message: `${msg} Press "Check again" in a minute.`, vchNo, warnings: [] };
    }
    const r = parseImport(responseXml);
    const found = await this.byNumber(vchNo).catch(() => undefined);
    if (found && found.party === b.party.name) {
      const warnings = await this.link(note.id, found, 'OMS', by, b.built);
      if (b.party.gstin && !found.partyGstin) warnings.push('The party GSTIN is not on the Tally credit note — check it in Tally before the e-invoice.');
      await this.prisma.tallyPostLog.update({ where: { id: log.id }, data: { finishedAt: new Date(), outcome: 'POSTED', responseXml } });
      return { status: 'POSTED', message: `Posted as Tally credit note ${found.vchNo} (${b.itemLedger}) and read back.`, vchNo: found.vchNo, warnings };
    }
    if (r.created === 0 && (r.errors > 0 || r.exceptions > 0 || r.lineErrors.length)) {
      const msg = `Tally refused it: ${r.lineErrors.join('; ') || `${r.errors} error(s)`}. Nothing was created.`;
      await this.prisma.tallyVoucher.update({ where: { creditNoteId: note.id }, data: { status: 'FAILED', lastError: msg } });
      await this.prisma.tallyPostLog.update({ where: { id: log.id }, data: { finishedAt: new Date(), outcome: 'FAILED', responseXml, error: msg } });
      return { status: 'FAILED', message: msg, vchNo, warnings: [] };
    }
    const msg = `Tally said created=${r.created}, errors=${r.errors}, but credit note ${vchNo} could not be read back.`;
    await this.prisma.tallyVoucher.update({ where: { creditNoteId: note.id }, data: { status: 'UNKNOWN', lastError: msg } });
    await this.prisma.tallyPostLog.update({ where: { id: log.id }, data: { finishedAt: new Date(), outcome: 'UNKNOWN', responseXml, error: msg } });
    return { status: 'UNKNOWN', message: `${msg} Press "Check again".`, vchNo, warnings: [] };
  }

  /** Settle an UNKNOWN by looking in Tally for the number OMS sent. */
  async resolve(code: string, by: string | null): Promise<TallyPostResult> {
    const note = await this.load(code);
    if (!note) throw new NotFoundException(`No credit note ${code.trim()} in OMS.`);
    const row = await this.prisma.tallyVoucher.findUnique({ where: { creditNoteId: note.id } });
    if (row?.status !== 'UNKNOWN' || !row.vchNo) throw new ConflictException(`${note.code} is not waiting for a check.`);
    const found = await this.byNumber(row.vchNo);
    if (found) {
      const ctx = await this.posting.context();
      const warnings = await this.link(note.id, found, 'OMS', by, (await this.build(note, ctx)).built);
      return { status: 'POSTED', message: `Tally did save it: credit note ${found.vchNo}. Linked.`, vchNo: found.vchNo, warnings };
    }
    if (Date.now() - row.updatedAt.getTime() < SETTLE_MS) {
      return { status: 'UNKNOWN', message: 'Not in Tally yet — check again in a minute.', vchNo: row.vchNo, warnings: [] };
    }
    const msg = 'Tally did not save it (checked). Safe to post again.';
    await this.prisma.tallyVoucher.update({ where: { creditNoteId: note.id }, data: { status: 'FAILED', lastError: msg } });
    return { status: 'FAILED', message: msg, vchNo: row.vchNo, warnings: [] };
  }
}
