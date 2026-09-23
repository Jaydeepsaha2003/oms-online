import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ACTIONS,
  ledgerNameKey,
  RESOURCES,
  type SaveTallyMappingInput,
  type TallyLedger,
  type TallyMappingList,
  type TallyMappingStatus,
  type TallyPartyMapping,
  type TallySuggestionSource,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { tag } from '../account-groups/tally-master.parser';
import { TallyService } from './tally.service';

/** Every ledger under Sundry Debtors (sub-groups included), with its GST details. */
export const DEBTORS_TDL =
  '<COLLECTION NAME="OmsDebtors"><TYPE>Ledger</TYPE><FETCH>Name,GUID,PartyGSTIN,LedStateName,GSTRegistrationType,LedGSTRegDetails.List,LedMailingDetails.List,Pincode</FETCH>' +
  '<FILTER>OmsIsDebtor</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="OmsIsDebtor">$$IsBelongsTo:$$GroupSundryDebtors</SYSTEM>';

/** This FY's live sales bills: number → party ledger, for "billed to X last time". */
const BILLS_TDL =
  '<COLLECTION NAME="OmsBills"><TYPE>Voucher</TYPE><FETCH>VoucherNumber,PartyLedgerName</FETCH><FILTER>OmsIsSale</FILTER></COLLECTION>' +
  '<SYSTEM TYPE="Formulae" NAME="OmsIsSale">$VoucherTypeName = "Sales" AND NOT $IsCancelled</SYSTEM>';

/** The one OMS series that is Tally's Sales series. NB (no bill), DN and any
 *  other prefix never go to Tally, whatever their number looks like. */
export const TALLY_PREFIX = 'SSS';

/** OMS "SSS/26-27/7" → Tally "SSS-07/26-27", the way the two series have always
 *  paired. Null for any other prefix — every Tally path goes through this. */
export function tallyVoucherNo(code: string): string | null {
  const m = /^([A-Z0-9]+)\/(\d{2}-\d{2})\/0*(\d+)$/i.exec(code.trim());
  return m && m[1].toUpperCase() === TALLY_PREFIX ? `${TALLY_PREFIX}-${m[3].padStart(2, '0')}/${m[2]}` : null;
}

/** The latest-dated block of one of Tally's dated lists (GST registrations, mailing details). */
const latest = (body: string, list: string) =>
  [...body.matchAll(new RegExp(`<${list}\\.LIST>([^]*?)</${list}\\.LIST>`, 'g'))]
    .map((m) => m[1])
    .sort((a, b) => (tag(b, 'APPLICABLEFROM') ?? '').localeCompare(tag(a, 'APPLICABLEFROM') ?? ''))[0] ?? '';

export function parseLedgers(xml: string): TallyLedger[] {
  return [...xml.matchAll(/<LEDGER NAME="[^"]*"[^>]*>([^]*?)<\/LEDGER>/g)]
    .map(([, body]) => {
      // Ledgers made in newer Tally keep GSTIN only in this dated list (61 of
      // 237 at discovery), so read the latest entry first, the old field second.
      const reg = latest(body, 'LEDGSTREGDETAILS');
      const mail = latest(body, 'LEDMAILINGDETAILS');
      return {
        guid: tag(body, 'GUID') ?? '',
        name: tag(body, 'NAME') ?? '',
        gstin: tag(reg, 'GSTIN') ?? tag(body, 'PARTYGSTIN'),
        state: tag(reg, 'STATE') ?? tag(body, 'LEDSTATENAME'),
        registrationType: tag(reg, 'GSTREGISTRATIONTYPE') ?? tag(body, 'GSTREGISTRATIONTYPE'),
        address: [...mail.matchAll(/<ADDRESS(?:\s[^>]*)?>[^<]*<\/ADDRESS>/g)].map((m) => tag(m[0], 'ADDRESS') ?? '').filter(Boolean),
        pincode: tag(mail, 'PINCODE') ?? tag(body, 'PINCODE'),
      };
    })
    .filter((l) => l.guid && l.name);
}

/** Indian financial year containing today. */
export function currentFy(): { start: Date; from: string; to: string } {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { start: new Date(y, 3, 1), from: `01-Apr-${y}`, to: `31-Mar-${y + 1}` };
}

@Injectable()
export class TallyPartiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tally: TallyService,
    private readonly audit: AuditService,
  ) {}

  private async liveLedgers(): Promise<TallyLedger[]> {
    return parseLedgers(await this.tally.exportFromCompany('OmsDebtors', DEBTORS_TDL));
  }

  async list(): Promise<TallyMappingList> {
    const fy = currentFy();
    const ledgers = await this.liveLedgers();
    const billsXml = await this.tally.exportFromCompany(
      'OmsBills',
      BILLS_TDL,
      `<SVFROMDATE TYPE="Date">${fy.from}</SVFROMDATE><SVTODATE TYPE="Date">${fy.to}</SVTODATE>`,
    );

    const byGuid = new Map(ledgers.map((l) => [l.guid, l]));
    const byName = new Map(ledgers.map((l) => [l.name, l]));
    const byKey = new Map<string, TallyLedger[]>();
    for (const l of ledgers) byKey.set(ledgerNameKey(l.name), [...(byKey.get(ledgerNameKey(l.name)) ?? []), l]);

    // What the accountant actually billed each party to this FY, latest bill wins.
    const billTo = new Map<string, string>();
    for (const [, v] of billsXml.matchAll(/<VOUCHER [^>]*>([^]*?)<\/VOUCHER>/g)) {
      const no = tag(v, 'VOUCHERNUMBER');
      const party = tag(v, 'PARTYLEDGERNAME');
      if (no && party) billTo.set(no, party);
    }
    const challans = await this.prisma.challan.findMany({
      where: { transaction: 'SALES INVOICE', challanStatus: 'CONFIRMED', invDate: { gte: fy.start }, customerId: { not: null } },
      select: { code: true, customerId: true },
      orderBy: [{ invDate: 'asc' }, { id: 'asc' }],
    });
    const lastBill = new Map<number, TallyLedger>();
    for (const c of challans) {
      const no = tallyVoucherNo(c.code);
      const l = no ? byName.get(billTo.get(no) ?? '') : undefined;
      if (l) lastBill.set(c.customerId!, l);
    }

    // The owner's Customers → Tally XML upload links: an alias, else the same
    // ledgerNameKey — exactly how that upload matched them.
    const aliasLedgers = new Map<number, Set<TallyLedger>>();
    for (const a of await this.prisma.tallyPartyAlias.findMany()) {
      const l = byName.get(a.tallyName);
      if (l) aliasLedgers.set(a.customerId, (aliasLedgers.get(a.customerId) ?? new Set()).add(l));
    }

    const customers = await this.prisma.customer.findMany({
      where: { partyName: { not: null }, OR: [{ active: true }, { tallyLedgerGuid: { not: null } }] },
      select: { id: true, partyName: true, agentName: true, city: true, tallyLedgerGuid: true, tallyLedgerName: true, tallyGstin: true },
      orderBy: { partyName: 'asc' },
    });

    const rows = customers.map((c): TallyPartyMapping => {
      const live = c.tallyLedgerGuid ? (byGuid.get(c.tallyLedgerGuid) ?? null) : null;
      const status: TallyMappingStatus = !c.tallyLedgerGuid
        ? 'UNMAPPED'
        : !live
          ? 'MISSING'
          : (live.gstin ?? '') !== (c.tallyGstin ?? '')
            ? 'GSTIN_CHANGED'
            : 'OK';
      let suggestion: TallyPartyMapping['suggestion'] = null;
      let uploadLedgerName: string | null = null;
      if (status === 'UNMAPPED' || status === 'MISSING') {
        const linked = [...(aliasLedgers.get(c.id) ?? byKey.get(ledgerNameKey(c.partyName!)) ?? [])];
        const upload = linked.length === 1 ? linked[0] : null;
        const bill = lastBill.get(c.id);
        // Both agree, or only one knows → take it. They disagree → offer the
        // last bill (current practice) and show the upload's, for a human to pick.
        const pick: TallyLedger | undefined | null = bill ?? upload;
        const source: TallySuggestionSource = upload && (!bill || bill.guid === upload.guid) ? 'UPLOAD' : 'LAST_BILL';
        if (pick) suggestion = { ...pick, source };
        if (upload && bill && bill.guid !== upload.guid) uploadLedgerName = upload.name;
      }
      return {
        customerId: c.id,
        customerName: c.partyName!,
        agentName: c.agentName,
        city: c.city,
        status,
        ledger: live,
        savedName: c.tallyLedgerName,
        savedGstin: c.tallyGstin,
        suggestion,
        uploadLedgerName,
      };
    });

    return { ledgers: ledgers.sort((a, b) => a.name.localeCompare(b.name)), rows };
  }

  /** Map (or clear) parties to ledgers. Each ledger is re-read from Tally first, so
   *  what is stored is what Tally has now — never a stale name from the screen. */
  async save(input: SaveTallyMappingInput, actor?: AuthenticatedUser): Promise<{ saved: number }> {
    const wanted = input.items.filter((i) => i.ledgerGuid);
    const byGuid = new Map((wanted.length ? await this.liveLedgers() : []).map((l) => [l.guid, l]));
    if (wanted.some((i) => !byGuid.has(i.ledgerGuid!))) {
      throw new BadRequestException('A chosen ledger is no longer under Sundry Debtors in Tally. Refresh the list and choose again.');
    }
    const before = new Map(
      (await this.prisma.customer.findMany({
        where: { id: { in: input.items.map((i) => i.customerId) } },
        select: { id: true, partyName: true, tallyLedgerName: true, tallyGstin: true },
      })).map((c) => [c.id, c]),
    );
    if (before.size !== new Set(input.items.map((i) => i.customerId)).size) throw new BadRequestException('Unknown party in the list.');

    await this.prisma.$transaction(
      input.items.map(({ customerId, ledgerGuid }) => {
        const l = ledgerGuid ? byGuid.get(ledgerGuid)! : null;
        return this.prisma.customer.update({
          where: { id: customerId },
          data: { tallyLedgerGuid: l?.guid ?? null, tallyLedgerName: l?.name ?? null, tallyGstin: l?.gstin ?? null },
        });
      }),
    );

    for (const { customerId, ledgerGuid } of input.items) {
      const b = before.get(customerId)!;
      const l = ledgerGuid ? byGuid.get(ledgerGuid)! : null;
      void this.audit.record({
        userId: actor?.id ?? null,
        userEmail: actor?.email ?? null,
        action: ACTIONS.UPDATE,
        resource: RESOURCES.TALLY,
        resourceId: String(customerId),
        description: l
          ? `Mapped ${b.partyName} to Tally ledger ${l.name}${l.gstin ? ` (${l.gstin})` : ''}`
          : `Cleared the Tally ledger of ${b.partyName}`,
        statusCode: 200,
        metadata: {
          before: { ledger: b.tallyLedgerName, gstin: b.tallyGstin },
          after: { ledger: l?.name ?? null, gstin: l?.gstin ?? null, guid: l?.guid ?? null },
        },
      });
    }
    return { saved: input.items.length };
  }
}
