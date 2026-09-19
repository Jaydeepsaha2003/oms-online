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
