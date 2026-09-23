import { Injectable, NotFoundException } from '@nestjs/common';
import type { TallyRecon, TallyReconResult, TallyReconRow } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { tag } from '../account-groups/tally-master.parser';
import { TallyService } from './tally.service';
import { currentFy, DEBTORS_TDL, parseLedgers, tallyVoucherNo } from './tally-parties.service';

/** This FY's Sales vouchers, cancelled ones included — explicit fields only. */
const SALES_TDL =
  '<COLLECTION NAME="OmsSales"><TYPE>Voucher</TYPE><FETCH>GUID,MasterId,AlterId,VoucherNumber,Date,PartyLedgerName,Amount,IsCancelled,IRNAckNo</FETCH>' +
  '<FILTER>OmsIsSale</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="OmsIsSale">$VoucherTypeName = "Sales"</SYSTEM>';

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
          (await tx.tallyVoucher.findMany({ where: { challanId: null, acceptedRecon: { not: null } } })).map((r) => [r.tallyGuid, r]),
        );
        await tx.tallyVoucher.deleteMany({ where: { challanId: null } });
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
    return this.result();
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
      this.prisma.tallyVoucher.count({ where: { ...where, challanId: { not: null }, tallyGuid: { not: null } } }),
      this.prisma.tallyVoucher.count({ where: { ...where, challanId: { not: null }, recon: 'OK' } }),
      this.prisma.tallyVoucher.aggregate({ where, _max: { checkedAt: true } }),
    ]);
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
          oms: r.challan
            ? { challanId: r.challan.id, code: r.challan.code, date: r.challan.invDate.toISOString(), customerName: r.challan.customerName, amount: r.challan.b, status: r.challan.challanStatus }
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
