/** Tally-style account groups (Customers → Masters → Group). */

export const GROUP_ALLOC_METHODS = ['NOT_APPLICABLE', 'BY_QTY', 'BY_VALUE'] as const;
export type GroupAllocMethod = (typeof GROUP_ALLOC_METHODS)[number];
export const GROUP_ALLOC_LABELS: Record<GroupAllocMethod, string> = {
  NOT_APPLICABLE: 'Not Applicable',
  BY_QTY: 'Appropriate by Qty',
  BY_VALUE: 'Appropriate by Value',
};

export interface AccountGroupDto {
  id: number;
  name: string;
  alias: string | null;
  /** null = Primary. */
  parentId: number | null;
  parentName: string | null;
  isSubLedger: boolean;
  nettBalances: boolean;
  usedForCalc: boolean;
  allocMethod: GroupAllocMethod;
  isSystem: boolean;
  /** Customers (ledgers) directly under this group. */
  ledgerCount: number;
}

export interface AccountGroupInput {
  name: string;
  alias?: string | null;
  parentId?: number | null;
  isSubLedger?: boolean;
  nettBalances?: boolean;
  usedForCalc?: boolean;
  allocMethod?: GroupAllocMethod;
}

/** A customer seen as a Tally ledger (Masters → Ledger). */
export interface GroupLedgerDto {
  id: number;
  partyName: string;
  category: string | null;
  active: boolean;
  groupId: number | null;
}

export interface MoveLedgersInput {
  customerIds: number[];
  groupId: number;
}

/** Name of the group every customer goes under unless told otherwise. */
export const DEFAULT_LEDGER_GROUP = 'Sundry Debtors';

const nameWords = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);

/** Name with punctuation and spacing ignored, for exact-name comparison. */
export const ledgerNameKey = (s: string) => nameWords(s).join(' ');

/** Trade words too common to identify a party on their own. */
const GENERIC = new Set(
  (
    'SHREE SHRI SRI SHAH M S MS THE AND OF CO COMPANY PVT PRIVATE LTD LIMITED LLP ' +
    'ENTERPRISE TRADER TRADING TRADE CORPORATION CORP INDUSTRY INDUSTRIES INDIA INTERNATIONAL ' +
    'METAL STEEL STAINLESS STORE SALE AGENCY AGENCIES HOUSE MARKETING WORK WARE WARES ' +
    'KITCHEN KITCHENWARE APPLIANCE UTENSIL EMPORIUM CENTRE CENTER BROTHER BROS SON SONS GROUP ' +
    'IMPEX EXPORT IMPORT OVERSEAS NEW OLD'
  ).split(' '),
);
const stem = (w: string) => (w.length > 3 && w.endsWith('S') ? w.slice(0, -1) : w);
const distinctive = (s: string) => nameWords(s).map(stem).filter((w) => !GENERIC.has(w));

/**
 * OMS names that plausibly are this Tally ledger, best first (max 3).
 *
 * Only names whose EVERY distinctive word (ignoring common trade words like
 * SHREE, METAL, CO, PVT) appears in the ledger name, with at least one real
 * word of 3+ letters in common — so "SHREE CHARBHUJA METAL" is never offered
 * for "SHREE BALAJI METAL CORPORATION". `sure` = the first distinctive words
 * agree too.
 */
export function suggestCustomers(ledger: string, customers: string[]) {
  const t = new Set(distinctive(ledger));
  const first = distinctive(ledger)[0];
  if (!t.size) return [];
  return customers
    .map((name) => {
      const c = distinctive(name);
      const all = c.length > 0 && c.every((w) => t.has(w));
      const real = c.some((w) => w.length >= 3 && t.has(w));
      return { name, ok: all && real, score: c.length / t.size, sure: all && real && c[0] === first };
    })
    .filter((s) => s.ok)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/* ── Tally master (XML) import ─────────────────────────────────────────── */

export type TallyImportMatchHow = 'LINKED' | 'SAME_NAME' | 'LOOKS_LIKE';

export interface TallyImportGroup {
  name: string;
  /** Tally parent; null = Primary. */
  parent: string | null;
  /** NEW = not in OMS, MOVE = in OMS under a different parent, SAME = nothing to do. */
  status: 'NEW' | 'MOVE' | 'SAME';
  omsParent: string | null;
}

export interface TallyImportParty {
  tallyName: string;
  tallyGroup: string;
  /** The system's pick; null = no OMS party found. */
  match: { customerId: number; how: TallyImportMatchHow } | null;
  /** Other likely OMS parties. */
  suggestions: number[];
  /** OMS party this Tally name is already linked to, if any. */
  linkedTo: number | null;
  /** From the latest Tally Reconciliation register; signed, Dr positive. */
  tallyOpening: number | null;
  tallyClosing: number | null;
  /** Already waiting in the addition list. */
  inList: boolean;
  /** Credit period, state, contact… as read from Tally. */
  details?: TallyLedgerDetails;
}

/** A ledger outside Sundry Debtors — shown by its Tally group, never a party. */
export interface TallyImportOther {
  tallyName: string;
  tallyGroup: string;
}

export interface TallyImportPreview {
  fileName: string;
  /** Period of the register the balances come from; null when none uploaded yet. */
  balanceFrom: string | null;
  balanceTo: string | null;
  groups: TallyImportGroup[];
  parties: TallyImportParty[];
  others: TallyImportOther[];
  customers: { id: number; name: string; active: boolean; groupId: number | null }[];
}

export interface TallyImportApply {
  groups: { name: string; parent: string | null }[];
  parties: { tallyName: string; customerId: number; groupName: string }[];
  /** Every ledger in the file with its group, saved so OMS knows each ledger's group. */
  ledgers: { name: string; group: string }[];
}

export interface TallyImportResult {
  groupsCreated: number;
  groupsMoved: number;
  partiesUpdated: number;
  linksSaved: number;
  ledgersSaved: number;
}

/* ── Addition list (Tally ledgers to add as OMS customers) ─────────────── */

export interface TallyLedgerDetails {
  creditPeriod?: number | null;
  state?: string | null;
  city?: string | null;
  mobile?: string | null;
  email?: string | null;
  gstin?: string | null;
}

export interface CustomerAdditionDto {
  id: number;
  tallyName: string;
  groupName: string;
  details: TallyLedgerDetails;
  tallyOpening: number | null;
  tallyClosing: number | null;
  balanceFrom: string | null;
  balanceTo: string | null;
  status: 'PENDING' | 'ADDED';
  customerId: number | null;
  createdAt: string;
}

/** A party still needing its opening balance (Opening Balance page). */
export interface NewPartyOpeningDto {
  customerId: number;
  name: string;
  /** TALLY = added from the Tally addition list; OMS = created here recently. */
  source: 'TALLY' | 'OMS';
  createdAt: string;
  additionId: number | null;
  tallyOpening: number | null;
  /** Date Tally's opening is as at (start of the register period). */
  openingDate: string | null;
}
