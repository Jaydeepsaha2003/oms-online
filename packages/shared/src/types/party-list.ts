/**
 * Party Lists — a rules engine for classifying customers into Green-listed
 * (trusted / priority) and Black-listed (risky / hold) buckets, plus any custom
 * list the business wants. Each list is a named set of conditions over live
 * party metrics (money owed, ageing, payment behaviour, revenue, recency…),
 * combined with match-ALL or match-ANY. Definitions are stored as JSON in
 * AppConfig; membership is evaluated on demand from current data.
 */

/** Every metric a condition can test, with display metadata for the builder. */
export type PartyMetricKey =
  | 'outstanding'
  | 'overdue'
  | 'overduePct'
  | 'oldestOverdueDays'
  | 'daysPastCredit'
  | 'lifetimeRevenue'
  | 'fyRevenue'
  | 'invoiceCount'
  | 'openInvoices'
  | 'collectionRate'
  | 'avgPaymentDays'
  | 'lastReceiptDaysAgo'
  | 'lastOrderDaysAgo'
  | 'orderCount'
  | 'brokenPromises'
  | 'advanceHeld'
  | 'region'
  | 'agent'
  | 'state'
  | 'active';

export type PartyMetricType = 'money' | 'number' | 'days' | 'percent' | 'text' | 'bool';

export interface PartyMetricMeta {
  key: PartyMetricKey;
  label: string;
  type: PartyMetricType;
  /** One-line explanation shown in the condition builder. */
  hint: string;
}

/** The full catalogue of testable party metrics (drives the builder dropdown). */
export const PARTY_METRIC_META: PartyMetricMeta[] = [
  { key: 'outstanding', label: 'Outstanding ₹', type: 'money', hint: 'Net receivable across open invoices' },
  { key: 'overdue', label: 'Overdue ₹', type: 'money', hint: 'Balance past its due date' },
  { key: 'overduePct', label: 'Overdue %', type: 'percent', hint: 'Overdue ÷ outstanding' },
  { key: 'oldestOverdueDays', label: 'Oldest overdue (days)', type: 'days', hint: 'Days the oldest overdue invoice is past its due date' },
  {
    key: 'daysPastCredit',
    label: 'Days past credit period',
    type: 'days',
    hint: "How far the oldest unpaid bill has run beyond this party's credit period — its age less the credit days (0 while every bill is within credit). E.g. ≥ 15 = crossed credit by 15 days.",
  },
  { key: 'lifetimeRevenue', label: 'Lifetime revenue ₹', type: 'money', hint: 'All-time confirmed sales' },
  { key: 'fyRevenue', label: 'This-FY revenue ₹', type: 'money', hint: 'Confirmed sales this financial year' },
  { key: 'invoiceCount', label: 'Invoices (lifetime)', type: 'number', hint: 'Count of confirmed sales invoices' },
  { key: 'openInvoices', label: 'Open invoices', type: 'number', hint: 'Invoices still unpaid / part-paid' },
  { key: 'collectionRate', label: 'Collection rate %', type: 'percent', hint: 'Received ÷ billed, lifetime' },
  { key: 'avgPaymentDays', label: 'Avg payment days', type: 'days', hint: 'Average days from invoice to receipt' },
  { key: 'lastReceiptDaysAgo', label: 'Last receipt (days ago)', type: 'days', hint: 'Days since the party last paid' },
  { key: 'lastOrderDaysAgo', label: 'Last order (days ago)', type: 'days', hint: 'Days since the party last ordered' },
  { key: 'orderCount', label: 'Orders (lifetime)', type: 'number', hint: 'Count of confirmed orders' },
  { key: 'brokenPromises', label: 'Broken promises', type: 'number', hint: 'Open payment promises now past due' },
  { key: 'advanceHeld', label: 'Advance held ₹', type: 'money', hint: 'Unapplied advance money on file' },
  { key: 'region', label: 'Region', type: 'text', hint: 'Customer region' },
  { key: 'agent', label: 'Agent', type: 'text', hint: 'Assigned sales agent' },
  { key: 'state', label: 'State', type: 'text', hint: 'Customer state' },
  { key: 'active', label: 'Active customer', type: 'bool', hint: 'Whether the customer is marked active' },
];

export const PARTY_LIST_OPERATORS = ['>=', '<=', '>', '<', '==', '!=', 'contains', 'notContains'] as const;
export type PartyListOperator = (typeof PARTY_LIST_OPERATORS)[number];

/** Operators valid for each metric type (the builder filters to these). */
export const OPERATORS_FOR_TYPE: Record<PartyMetricType, PartyListOperator[]> = {
  money: ['>=', '<=', '>', '<', '==', '!='],
  number: ['>=', '<=', '>', '<', '==', '!='],
  days: ['>=', '<=', '>', '<', '==', '!='],
  percent: ['>=', '<=', '>', '<', '==', '!='],
  text: ['==', '!=', 'contains', 'notContains'],
  bool: ['==', '!='],
};

/** One test in a list's rule set. */
export interface PartyCondition {
  field: PartyMetricKey;
  op: PartyListOperator;
  /** Number for numeric metrics; string for text; 'true'/'false' for bool. */
  value: number | string;
}

export type PartyListKind = 'GREEN' | 'BLACK' | 'CUSTOM';

export interface PartyListDef {
  id: string;
  name: string;
  kind: PartyListKind;
  /** Tailwind-ish hex used for CUSTOM lists (GREEN/BLACK have fixed palettes). */
  color?: string | null;
  description?: string | null;
  /** ALL = every condition must hold (AND); ANY = at least one (OR). */
  match: 'ALL' | 'ANY';
  conditions: PartyCondition[];
  enabled: boolean;
}

export interface PartyListsConfig {
  lists: PartyListDef[];
}

/** Computed metrics for one party (all the fields a condition can test). */
export interface PartyMetrics {
  outstanding: number;
  overdue: number;
  overduePct: number | null;
  oldestOverdueDays: number;
  /** See the `daysPastCredit` metric: 0 while every unpaid bill is within credit. */
  daysPastCredit: number;
  /** The party's credit period in days, as its customer record has it. */
  creditPeriod: number | null;
  lifetimeRevenue: number;
  fyRevenue: number;
  invoiceCount: number;
  openInvoices: number;
  collectionRate: number | null;
  avgPaymentDays: number | null;
  lastReceiptDaysAgo: number | null;
  lastOrderDaysAgo: number | null;
  orderCount: number;
  brokenPromises: number;
  advanceHeld: number;
  region: string | null;
  agent: string | null;
  state: string | null;
  active: boolean;
}

/**
 * Does a party's metrics meet one condition? The server evaluates the lists
 * with this and the list editor counts its live "N match" with it, so the two
 * can never disagree about who is in a list.
 */
export function matchPartyCondition(c: PartyCondition, m: PartyMetrics): boolean {
  const raw = (m as unknown as Record<string, unknown>)[c.field];
  // Text metrics.
  if (typeof raw === 'string' || c.op === 'contains' || c.op === 'notContains') {
    const a = String(raw ?? '').toLowerCase();
    const b = String(c.value ?? '').toLowerCase();
    switch (c.op) {
      case 'contains': return a.includes(b);
      case 'notContains': return !a.includes(b);
      case '==': return a === b;
      case '!=': return a !== b;
      default: return false;
    }
  }
  // Boolean metrics.
  if (typeof raw === 'boolean') {
    const b = c.value === 'true' || c.value === 1 || c.value === '1';
    return c.op === '!=' ? raw !== b : raw === b;
  }
  // Numeric metrics — a null metric (e.g. no receipts yet) never matches, and
  // neither does a half-typed value.
  if (raw == null || c.value === '') return false;
  const a = Number(raw);
  const b = Number(c.value);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  switch (c.op) {
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '<': return a < b;
    case '==': return a === b;
    case '!=': return a !== b;
    default: return false;
  }
}

/** A list matches when ALL (or ANY) of its conditions hold; an empty one never does. */
export function matchPartyList(list: Pick<PartyListDef, 'match' | 'conditions'>, m: PartyMetrics): boolean {
  if (!list.conditions.length) return false;
  return list.match === 'ANY' ? list.conditions.some((c) => matchPartyCondition(c, m)) : list.conditions.every((c) => matchPartyCondition(c, m));
}

/** One party with its metrics and which lists it currently matches. */
export interface PartyClassRow {
  customerId: number | null;
  party: string;
  metrics: PartyMetrics;
  /** ids of the lists this party matches. */
  matched: string[];
}

export interface PartyListsResult {
  lists: PartyListDef[];
  parties: PartyClassRow[];
  asOf: string;
}

/** Sensible starter lists shown when nothing is configured yet. */
export const DEFAULT_PARTY_LISTS: PartyListDef[] = [
  {
    id: 'green-trusted',
    name: 'Green — Trusted payers',
    kind: 'GREEN',
    match: 'ALL',
    enabled: true,
    description: 'Reliable, high-value customers who pay on time.',
    conditions: [
      { field: 'lifetimeRevenue', op: '>=', value: 200000 },
      { field: 'overdue', op: '<=', value: 0 },
      { field: 'brokenPromises', op: '==', value: 0 },
    ],
  },
  {
    id: 'black-risky',
    name: 'Black — Payment risk',
    kind: 'BLACK',
    match: 'ANY',
    enabled: true,
    description: 'Parties to put on hold or chase hard before shipping more.',
    conditions: [
      { field: 'oldestOverdueDays', op: '>=', value: 90 },
      { field: 'brokenPromises', op: '>=', value: 1 },
      { field: 'overdue', op: '>=', value: 200000 },
    ],
  },
];
