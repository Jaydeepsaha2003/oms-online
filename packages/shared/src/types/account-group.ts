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

/**
 * Names resembling a Tally ledger name, best first (max 3). Scored by the share
 * of the candidate's words found in the ledger name (a 4+ letter word may match
 * as a prefix either way: "ENTERPRISE" ~ "ENTERPRISES"), plus a boost when the
 * first words agree. `sure` = every candidate word found and first word matches.
 */
export function suggestCustomers(ledger: string, customers: string[]) {
  const t = nameWords(ledger);
  if (!t.length) return [];
  const same = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
  return customers
    .map((name) => {
      const c = nameWords(name);
      const hit = c.filter((w) => t.some((x) => same(x, w))).length;
      const first = !!c[0] && same(t[0], c[0]);
      return { name, share: c.length ? hit / c.length : 0, score: c.length ? hit / c.length + (first ? 0.5 : 0) + hit * 0.01 : 0, sure: first && hit === c.length };
    })
    .filter((s) => s.share >= 0.5 && s.score >= 0.75)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/* ── Tally master (XML) import ─────────────────────────────────────────── */

export type TallyImportMatchHow = 'LINKED' | 'SAME_NAME' | 'LOOKS_LIKE';
export type TallyImportFiling = 'AGENT' | 'EXPENSE' | 'OTHER';

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
}

export interface TallyImportOther {
  tallyName: string;
  tallyGroup: string;
  proposed: TallyImportFiling;
  /** Current filing in Tally Reconciliation, if any. */
  filed: TallyImportFiling | null;
  /** OMS party this name is currently linked to, if any. */
  linkedTo: number | null;
}

export interface TallyImportPreview {
  fileName: string;
  groups: TallyImportGroup[];
  parties: TallyImportParty[];
  others: TallyImportOther[];
  customers: { id: number; name: string; active: boolean; groupId: number | null }[];
}

export interface TallyImportApply {
  groups: { name: string; parent: string | null }[];
  parties: { tallyName: string; customerId: number; groupName: string }[];
  others: { tallyName: string; filing: TallyImportFiling }[];
}

export interface TallyImportResult {
  groupsCreated: number;
  groupsMoved: number;
  partiesUpdated: number;
  linksSaved: number;
  othersFiled: number;
}
