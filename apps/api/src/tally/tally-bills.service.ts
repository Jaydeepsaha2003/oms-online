import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TallyRecon, TallyReconResult, TallyReconRow } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { tag } from '../account-groups/tally-master.parser';
import { TallyService } from './tally.service';
import { currentFy, DEBTORS_TDL, parseLedgers, tallyVoucherNo } from './tally-parties.service';

/** This FY's Sales vouchers, cancelled ones included — explicit fields only. */
const SALES_TDL =
  '<COLLECTION NAME="OmsSales"><TYPE>Voucher</TYPE><FETCH>GUID,MasterId,AlterId,VoucherNumber,Date,PartyLedgerName,Amount,IsCancelled,IRNAckNo</FETCH>' +
  '<FILTER>OmsIsSale</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="OmsIsSale">$VoucherTypeName = "Sales"</SYSTEM>';

/** This FY's credit and debit notes — matched to OMS by party + amount + date, as their numbers never paired. */
const NOTES_TDL =
  '<COLLECTION NAME="OmsNotes"><TYPE>Voucher</TYPE><FETCH>GUID,MasterId,AlterId,VoucherTypeName,VoucherNumber,Date,PartyLedgerName,Amount,IsCancelled,IRNAckNo</FETCH>' +
  '<FILTER>OmsIsNote</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="OmsIsNote">$VoucherTypeName = "Credit Note" OR $VoucherTypeName = "Debit Note"</SYSTEM>';
const NOTE_WINDOW_DAYS = 15;

/** Tally "20260401" → local midnight. */
const tallyDate = (s: string | null) => (s && /^\d{8}$/.test(s) ? new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) : null);
const dayKey = (d: Date) => d.toDateString();
const dmy = (d: Date) => d.toLocaleDateString('en-GB');
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const int = (s: string | null) => (s && Number.isFinite(+s) ? +s : null);

@Injectable()
export class TallyBillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tally: TallyService,
  ) {}

  /**
   * Link every OMS invoice of this FY to its Tally voucher (by the paired
   * number) and record how the two differ. Reads Tally only; writes only the
   * OMS link table. Safe to run any time, as often as wanted.
   */
  async run(): Promise<TallyReconResult> {
    const fy = currentFy();
    const { companyGuid } = await this.tally.getConfig();
    const ledgers = parseLedgers(await this.tally.exportFromCompany('OmsDebtors', DEBTORS_TDL));
    const xml = await this.tally.exportFromCompany(
      'OmsSales',
      SALES_TDL,
      `<SVFROMDATE TYPE="Date">${fy.from}</SVFROMDATE><SVTODATE TYPE="Date">${fy.to}</SVTODATE>`,
    );
    const vouchers = [...xml.matchAll(/<VOUCHER [^>]*>([^]*?)<\/VOUCHER>/g)]
      .map(([, v]) => ({
        guid: tag(v, 'GUID') ?? '',
        masterId: int(tag(v, 'MASTERID')),
        alterId: int(tag(v, 'ALTERID')),
        vchNo: tag(v, 'VOUCHERNUMBER'),
        date: tallyDate(tag(v, 'DATE')),
        party: tag(v, 'PARTYLEDGERNAME'),
        amount: Math.abs(Number(tag(v, 'AMOUNT') ?? 0)),
        cancelled: tag(v, 'ISCANCELLED') === 'Yes',
        irnAckNo: tag(v, 'IRNACKNO'),
      }))
      .filter((v) => v.guid);
    const byNo = new Map(vouchers.map((v) => [v.vchNo, v]));

    const challans = (
      await this.prisma.challan.findMany({
        where: { transaction: 'SALES INVOICE', noBill: false, invDate: { gte: fy.start } },
        select: { id: true, code: true, invDate: true, customerId: true, b: true, challanStatus: true },
      })
    ).filter((c) => tallyVoucherNo(c.code));

    // A voucher's party is right if it is the party's mapped ledger, or any
    // ledger the owner linked to that party (old ledgers after a GSTIN change).
    const ledgerName = new Map(ledgers.map((l) => [l.guid, l.name]));
    const mapped = new Map(
      (await this.prisma.customer.findMany({ where: { tallyLedgerGuid: { not: null } }, select: { id: true, tallyLedgerGuid: true } })).map((c) => [
        c.id,
        ledgerName.get(c.tallyLedgerGuid!) ?? null,
      ]),
    );
    const aliases = new Map<number, Set<string>>();
    for (const a of await this.prisma.tallyPartyAlias.findMany()) aliases.set(a.customerId, (aliases.get(a.customerId) ?? new Set()).add(a.tallyName));

    // A post in flight or awaiting a check is the posting service's to settle —
    // the sweep only ever moves it forward, to POSTED, when it sees the voucher.
    const inFlight = new Map(
      (await this.prisma.tallyVoucher.findMany({ where: { status: { in: ['POSTING', 'UNKNOWN', 'FAILED'] } }, select: { challanId: true, status: true } })).map((r) => [
        r.challanId,
        r.status,
      ]),
    );
    const now = new Date();
    const used = new Set<string>();
    const linkRows = challans.map((c) => {
      const v = byNo.get(tallyVoucherNo(c.code)!);
      const issues: [TallyRecon, string][] = [];
      if (!v) {
        if (c.challanStatus !== 'CANCELLED') issues.push(['MISSING_IN_TALLY', `No Tally voucher ${tallyVoucherNo(c.code)}`]);
      } else {
        used.add(v.guid);
        const omsCancelled = c.challanStatus === 'CANCELLED';
        if (omsCancelled && !v.cancelled) issues.push(['CANCELLED_IN_OMS', 'Cancelled in OMS but live in Tally — a credit note in Tally should cancel it out']);
        else if (!omsCancelled && v.cancelled) issues.push(['CANCELLED_IN_TALLY', 'Cancelled in Tally but live in OMS']);
        else if (!omsCancelled) {
          if (Math.abs(v.amount - (c.b ?? 0)) > 1.01) issues.push(['AMOUNT_MISMATCH', `Tally ${rupees(v.amount)}, OMS ${rupees(c.b ?? 0)}`]);
          const expected = c.customerId != null ? mapped.get(c.customerId) : null;
          if (expected && v.party !== expected && !aliases.get(c.customerId!)?.has(v.party ?? '')) {
            issues.push(['PARTY_MISMATCH', `Tally billed ${v.party}, but this party is mapped to ${expected}`]);
          }
          if (v.date && dayKey(v.date) !== dayKey(c.invDate)) issues.push(['DATE_MISMATCH', `Tally ${dmy(v.date)}, OMS ${dmy(c.invDate)}`]);
        }
      }
      return {
        challanId: c.id,
        data: {
          companyGuid: companyGuid ?? '',
          status: v ? 'POSTED' : (inFlight.get(c.id) ?? 'NOT_POSTED'),
          tallyGuid: v?.guid ?? null,
          tallyMasterId: v?.masterId ?? null,
          tallyAlterId: v?.alterId ?? null,
          vchNo: v?.vchNo ?? null,
          vchDate: v?.date ?? null,
          partyLedger: v?.party ?? null,
          amount: v?.amount ?? null,
          cancelled: v?.cancelled ?? false,
          irnAckNo: v?.irnAckNo ?? null,
          recon: issues[0]?.[0] ?? 'OK',
          reconNote: issues.map((i) => i[1]).join('; ') || null,
          checkedAt: now,
        },
      };
    });

    // Tally sales with no OMS invoice behind them. A cancelled one is only a used-up number.
    const tallyOnly = vouchers
      .filter((v) => !used.has(v.guid))
      .map((v) => ({
        companyGuid: companyGuid ?? '',
        status: 'POSTED',
        tallyGuid: v.guid,
        tallyMasterId: v.masterId,
        tallyAlterId: v.alterId,
        vchNo: v.vchNo,
        vchDate: v.date,
        partyLedger: v.party,
        amount: v.amount,
        cancelled: v.cancelled,
        irnAckNo: v.irnAckNo,
        recon: v.cancelled ? 'OK' : 'TALLY_ONLY',
        reconNote: v.cancelled ? null : 'No OMS invoice with this number',
        checkedAt: now,
      }));

    await this.prisma.$transaction(
      async (tx) => {
        // Tally-only rows are rebuilt each run; carry their acceptances across.
        const kept = new Map(
          (await tx.tallyVoucher.findMany({ where: { vchType: 'Sales', challanId: null, acceptedRecon: { not: null } } })).map((r) => [r.tallyGuid, r]),
        );
        await tx.tallyVoucher.deleteMany({ where: { vchType: 'Sales', challanId: null } });
        // Free every GUID first: a renumbered invoice may now own another's voucher.
        await tx.tallyVoucher.updateMany({ where: { challanId: { in: linkRows.map((r) => r.challanId) } }, data: { tallyGuid: null } });
        for (const r of linkRows) {
          await tx.tallyVoucher.upsert({ where: { challanId: r.challanId }, create: { challanId: r.challanId, ...r.data }, update: r.data });
        }
        for (const r of tallyOnly) {
          const a = kept.get(r.tallyGuid);
          await tx.tallyVoucher.create({
            data: {
              ...r,
              ...(a && { acceptedRecon: a.acceptedRecon, acceptedAlterId: a.acceptedAlterId, acceptedNote: a.acceptedNote, acceptedBy: a.acceptedBy, acceptedAt: a.acceptedAt }),
            },
          });
        }
      },
      { timeout: 60_000 },
    );
    await this.syncNotes(fy, companyGuid ?? '', (customerId) => {
      if (customerId == null || !mapped.get(customerId)) return null;
      return new Set([mapped.get(customerId)!, ...(aliases.get(customerId) ?? [])]);
    });
    return this.result();
  }

  /**
   * Credit / debit notes. Their OMS and Tally numbers never paired (CN/14 in OMS
   * is 2 in Tally), so a note is linked by party + amount (±₹1) + date within
   * NOTE_WINDOW_DAYS, nearest date first, each Tally note used once. Only notes
   * with a billed part (B > 0) belong in Tally. Rows are rebuilt every run;
   * acceptances carry over by Tally voucher (or by the OMS note when unlinked).
   */
  private async syncNotes(fy: ReturnType<typeof currentFy>, companyGuid: string, allowedFor: (customerId: number | null) => Set<string> | null) {
    const xml = await this.tally.exportFromCompany(
      'OmsNotes',
      NOTES_TDL,
      `<SVFROMDATE TYPE="Date">${fy.from}</SVFROMDATE><SVTODATE TYPE="Date">${fy.to}</SVTODATE>`,
    );
    const tally = [...xml.matchAll(/<VOUCHER [^>]*>([^]*?)<\/VOUCHER>/g)]
      .map(([, v]) => ({
        type: tag(v, 'VOUCHERTYPENAME') ?? '',
        guid: tag(v, 'GUID') ?? '',
        masterId: int(tag(v, 'MASTERID')),
        alterId: int(tag(v, 'ALTERID')),
        vchNo: tag(v, 'VOUCHERNUMBER'),
        date: tallyDate(tag(v, 'DATE')),
        party: tag(v, 'PARTYLEDGERNAME'),
        amount: Math.abs(Number(tag(v, 'AMOUNT') ?? 0)),
        cancelled: tag(v, 'ISCANCELLED') === 'Yes',
        irnAckNo: tag(v, 'IRNACKNO'),
      }))
      .filter((v) => v.guid);
    const [cns, dns] = await Promise.all([
      this.prisma.creditNote.findMany({ where: { invDate: { gte: fy.start }, b: { gt: 0 } }, select: { id: true, invDate: true, customerId: true, b: true } }),
      this.prisma.challan.findMany({
        where: { transaction: 'DEBIT NOTE', challanStatus: 'CONFIRMED', invDate: { gte: fy.start }, b: { gt: 0 } },
        select: { id: true, invDate: true, customerId: true, b: true },
      }),
    ]);
    const oms = [
      ...cns.map((n) => ({ ...n, type: 'Credit Note', key: `cn:${n.id}`, creditNoteId: n.id, challanId: null as number | null })),
      ...dns.map((n) => ({ ...n, type: 'Debit Note', key: `dn:${n.id}`, creditNoteId: null as number | null, challanId: n.id })),
    ].sort((a, b) => a.invDate.getTime() - b.invDate.getTime());

    const now = new Date();
    const used = new Set<string>();
    const window = NOTE_WINDOW_DAYS * 86_400_000;
    const rows: { key: string; omsKey?: string; data: Prisma.TallyVoucherUncheckedCreateInput }[] = oms.map((o) => {
      const allowed = allowedFor(o.customerId);
      const t = tally
        .filter((v) => v.type === o.type && !v.cancelled && !used.has(v.guid) && v.date && Math.abs(v.amount - (o.b ?? 0)) <= 1.01)
        .filter((v) => (!allowed || allowed.has(v.party ?? '')) && Math.abs(v.date!.getTime() - o.invDate.getTime()) <= window)
        .sort((a, b) => Math.abs(a.date!.getTime() - o.invDate.getTime()) - Math.abs(b.date!.getTime() - o.invDate.getTime()))[0];
      if (t) used.add(t.guid);
      const issues: [TallyRecon, string][] = !t
        ? [['MISSING_IN_TALLY', `No Tally ${o.type.toLowerCase()} of ${rupees(o.b ?? 0)} for this party within ${NOTE_WINDOW_DAYS} days`]]
        : t.date && dayKey(t.date) !== dayKey(o.invDate)
          ? [['DATE_MISMATCH', `Tally ${dmy(t.date)}, OMS ${dmy(o.invDate)}`]]
          : [];
      return {
        key: t?.guid ?? o.key,
        omsKey: o.key,
        data: {
          vchType: o.type, challanId: o.challanId, creditNoteId: o.creditNoteId, companyGuid,
          status: t ? 'POSTED' : 'NOT_POSTED', tallyGuid: t?.guid ?? null, tallyMasterId: t?.masterId ?? null, tallyAlterId: t?.alterId ?? null,
          vchNo: t?.vchNo ?? null, vchDate: t?.date ?? null, partyLedger: t?.party ?? null, amount: t?.amount ?? null,
          cancelled: false, irnAckNo: t?.irnAckNo ?? null, recon: issues[0]?.[0] ?? 'OK', reconNote: issues[0]?.[1] ?? null, checkedAt: now,
        },
      };
    });
    for (const t of tally.filter((v) => !used.has(v.guid))) {
      rows.push({
        key: t.guid,
        data: {
          vchType: t.type, challanId: null, creditNoteId: null, companyGuid, status: 'POSTED', tallyGuid: t.guid, tallyMasterId: t.masterId,
          tallyAlterId: t.alterId, vchNo: t.vchNo, vchDate: t.date, partyLedger: t.party, amount: t.amount, cancelled: t.cancelled,
          irnAckNo: t.irnAckNo, recon: t.cancelled ? 'OK' : 'TALLY_ONLY',
          reconNote: t.cancelled ? null : `No OMS ${t.type.toLowerCase()} for this party and amount`, checkedAt: now,
        },
      });
    }

    await this.prisma.$transaction(
      async (tx) => {
        const notes = { vchType: { in: ['Credit Note', 'Debit Note'] } };
        const kept = new Map(
          (await tx.tallyVoucher.findMany({ where: { ...notes, acceptedRecon: { not: null } } })).map((r) => [
            r.tallyGuid ?? (r.creditNoteId ? `cn:${r.creditNoteId}` : `dn:${r.challanId}`),
            r,
          ]),
        );
        // A note OMS is posting, or could not confirm, is the posting service's to settle:
        // keep its row as it is unless Tally now shows the note. OMS-posted rows keep who posted them.
        const existing = await tx.tallyVoucher.findMany({ where: notes });
        const matched = new Set(rows.filter((r) => r.omsKey && r.data.tallyGuid).map((r) => r.omsKey));
        const keep = existing.filter(
          (r) => ['POSTING', 'UNKNOWN', 'FAILED'].includes(r.status) && !matched.has(r.creditNoteId ? `cn:${r.creditNoteId}` : `dn:${r.challanId}`),
        );
        const keptKeys = new Set(keep.map((r) => (r.creditNoteId ? `cn:${r.creditNoteId}` : `dn:${r.challanId}`)));
        const posted = new Map(existing.filter((r) => r.tallyGuid && r.source === 'OMS').map((r) => [r.tallyGuid, r]));
        await tx.tallyVoucher.deleteMany({ where: { ...notes, id: { notIn: keep.map((r) => r.id) } } });
        for (const r of rows) {
          if (r.omsKey && keptKeys.has(r.omsKey)) continue;
          const a = kept.get(r.key);
          const p = r.data.tallyGuid ? posted.get(r.data.tallyGuid) : undefined;
          await tx.tallyVoucher.create({
            data: {
              ...r.data,
              ...(p && { source: p.source, postedBy: p.postedBy, postedAt: p.postedAt }),
              ...(a && { acceptedRecon: a.acceptedRecon, acceptedAlterId: a.acceptedAlterId, acceptedNote: a.acceptedNote, acceptedBy: a.acceptedBy, acceptedAt: a.acceptedAt }),
            },
          });
        }
      },
      { timeout: 60_000 },
    );
  }

  async result(): Promise<TallyReconResult> {
    const { companyGuid } = await this.tally.getConfig();
    const where = { companyGuid: companyGuid ?? '' };
    const [rows, linked, ok, last] = await Promise.all([
      this.prisma.tallyVoucher.findMany({
        where: { ...where, recon: { not: 'OK' } },
        include: { challan: { select: { id: true, code: true, invDate: true, customerName: true, b: true, challanStatus: true } } },
        orderBy: [{ vchDate: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.tallyVoucher.count({ where: { ...where, vchType: 'Sales', challanId: { not: null }, tallyGuid: { not: null } } }),
      this.prisma.tallyVoucher.count({ where: { ...where, vchType: 'Sales', challanId: { not: null }, recon: 'OK' } }),
      this.prisma.tallyVoucher.aggregate({ where, _max: { checkedAt: true } }),
    ]);
    const notes = new Map(
      (
        await this.prisma.creditNote.findMany({
          where: { id: { in: rows.map((r) => r.creditNoteId).filter((id): id is number => id != null) } },
          select: { id: true, code: true, invDate: true, customerName: true, b: true, status: true },
        })
      ).map((n) => [n.id, n]),
    );
    return {
      checkedAt: last._max.checkedAt?.toISOString() ?? null,
      linked,
      ok,
      rows: rows.map(
        (r): TallyReconRow => ({
          id: r.id,
          recon: r.recon as TallyRecon,
          note: r.reconNote,
          accepted: r.acceptedRecon === r.recon && r.acceptedAlterId === r.tallyAlterId,
          acceptedNote: r.acceptedNote,
          acceptedBy: r.acceptedBy,
          vchType: r.vchType,
          oms: r.challan
            ? { challanId: r.challan.id, code: r.challan.code, date: r.challan.invDate.toISOString(), customerName: r.challan.customerName, amount: r.challan.b, status: r.challan.challanStatus }
            : r.creditNoteId && notes.get(r.creditNoteId)
              ? (({ id, code, invDate, customerName, b, status }) => ({ challanId: id, code, date: invDate.toISOString(), customerName, amount: b, status }))(notes.get(r.creditNoteId)!)
              : null,
          tally: r.tallyGuid
            ? { vchNo: r.vchNo, date: r.vchDate?.toISOString() ?? null, party: r.partyLedger, amount: r.amount, cancelled: r.cancelled, irn: !!r.irnAckNo }
            : null,
        }),
      ),
    };
  }

  /** A human says "this difference is known and fine" (e.g. cancelled in OMS, credit note in Tally). */
  async accept(id: number, note: string, by: string | null): Promise<TallyReconResult> {
    const row = await this.prisma.tallyVoucher.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('That row is gone — run the check again.');
    await this.prisma.tallyVoucher.update({
      where: { id },
      data: { acceptedRecon: row.recon, acceptedAlterId: row.tallyAlterId, acceptedNote: note.trim(), acceptedBy: by, acceptedAt: new Date() },
    });
    return this.result();
  }
}
