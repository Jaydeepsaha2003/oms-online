/** Customer (and its transporter) shapes shared across the stack. */

import type { Paginated, PaginationQuery } from './common';

/** Fixed dropdown values (from the legacy form). */
export const PARTY_SOURCES = ['SELF', 'AGENT'] as const;
export const PAY_BYS = ['PARTY', 'AGENT'] as const;
export type PartySource = (typeof PARTY_SOURCES)[number];
export type PayBy = (typeof PAY_BYS)[number];

/**
 * The two money buckets a receipt can land in.
 *
 * Mirrors the split the payment waterfall already makes: BANK and CHEQUE settle
 * the invoice's bank balance, CASH settles its cash balance. Routing is per
 * bucket because a party commonly pays its bank transfers directly while its
 * agent hands over the cash and asks for the pending invoices to be cleared.
 */
export const PAY_BUCKETS = ['bank', 'cash'] as const;
export type PayBucket = (typeof PAY_BUCKETS)[number];

/**
 * Per-bucket override of `payBy`, stored as JSON on the customer.
 *
 * A missing key falls back to `payBy`, so a party with no override behaves
 * exactly as it always has.
 */
export type PayByModes = Partial<Record<PayBucket, PayBy>>;

/** Which bucket a pay mode settles. CASH is cash; BANK and CHEQUE are bank. */
export function payBucketOf(payMode: string | null | undefined): PayBucket {
  return (payMode ?? '').trim().toUpperCase() === 'CASH' ? 'cash' : 'bank';
}

/**
 * Read the stored JSON, tolerating anything that is not a well-formed override.
 *
 * Never throws: a malformed or hand-edited value degrades to "no override", so
 * the party falls back to `payBy` rather than becoming uncollectible. Unknown
 * keys and values outside PARTY/AGENT are dropped for the same reason.
 */
export function parsePayByModes(raw: string | null | undefined): PayByModes {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: PayByModes = {};
  for (const bucket of PAY_BUCKETS) {
    const v = (parsed as Record<string, unknown>)[bucket];
    if (typeof v !== 'string') continue;
    const up = v.trim().toUpperCase();
    if ((PAY_BYS as readonly string[]).includes(up)) out[bucket] = up as PayBy;
  }
  return out;
}

/**
 * Who settles this party's money in one bucket — the single place that decides.
 *
 * Falls back to `payBy` when the bucket has no override, and to PARTY when even
 * that is unset, so the answer is always one of PARTY / AGENT.
 */
export function payByFor(
  customer: { payBy?: string | null; payByModes?: string | null },
  bucket: PayBucket,
): PayBy {
  const override = parsePayByModes(customer.payByModes)[bucket];
  if (override) return override;
  return (customer.payBy ?? '').trim().toUpperCase() === 'AGENT' ? 'AGENT' : 'PARTY';
}

export interface TransporterLite {
  id: number;
  name: string;
  packing: number | null;
  freight: number | null;
}

export interface CustomerDto {
  id: number;
  /** Auto-generated code (e.g. CUST-00001). Server-assigned; shown on export, not on screen. */
  code: string | null;
  partySource: string | null;
  agentName: string | null;
  category: string | null;
  partyName: string | null;
  billingRate: number | null;
  transporterId: number | null;
  transportName: string | null;
  bagName: string | null;
  packing: number | null;
  freight: number | null;
  boxRate: number | null;
  creditPeriod: number | null;
  city: string | null;
  state: string | null;
  region: string | null;
  mobile: string | null;
  email: string | null;
  brand: string | null;
  billRatePc: number | null;
  payBy: string | null;
  /** JSON per-bucket override of payBy; null = follow payBy. Read via payByFor(). */
  payByModes: string | null;
  /** Whether TDS is deducted at source for this customer, and at what %. */
  tdsApplicable: boolean;
  tdsPercent: number | null;
  /** Active parties appear in every picker; inactive ones are hidden from dropdowns. */
  active: boolean;
  /**
   * On dispatch hold — no NEW dispatch may be recorded for this party.
   *
   * Independent of {@link active}, and needed alongside it: a held party stays
   * in every picker and keeps taking orders, and what it has already shipped
   * stays billable and returnable. Only shipping again is blocked.
   */
  dispatchHold: boolean;
  /** Why it was held, shown wherever the hold blocks something. */
  dispatchHoldReason: string | null;
  /** Who placed the hold, and when (ISO) — both null on a party never held. */
  dispatchHoldBy: string | null;
  dispatchHoldAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Payload for create/update. Transporter is resolved by name on the server. */
export interface CustomerInput {
  partySource?: string | null;
  agentName?: string | null;
  category?: string | null;
  partyName: string;
  billingRate?: number | null;
  transportName?: string | null;
  bagName?: string | null;
  packing?: number | null;
  freight?: number | null;
  boxRate?: number | null;
  creditPeriod?: number | null;
  city?: string | null;
  state?: string | null;
  region?: string | null;
  mobile?: string | null;
  email?: string | null;
  brand?: string | null;
  billRatePc?: number | null;
  payBy?: string | null;
  payByModes?: string | null;
  tdsApplicable?: boolean;
  tdsPercent?: number | null;
  active?: boolean;
}

export const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'ON_HOLD', 'ALL'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export interface CustomerQuery extends PaginationQuery {
  // search/sort handled by PaginationQuery
  agentName?: string;
  category?: string;
  /** ACTIVE (default when omitted) | INACTIVE | ALL. Pickers omit it → active-only. */
  status?: string;
}

export type CustomerList = Paginated<CustomerDto>;

/** Dropdown sources for the customer form (distinct existing values + transporters). */
export interface CustomerLookups {
  partySources: string[];
  payBys: string[];
  agents: string[];
  categories: string[];
  brands: string[];
  cities: string[];
  states: string[];
  regions: string[];
  transporters: TransporterLite[];
}

/**
 * The dropdown-backed columns a bulk edit may set.
 *
 * Transporter is absent on purpose: picking one also rewrites the party's
 * packing and freight, so it is a freight-cost change wearing a dropdown's
 * clothes and stays a per-customer edit.
 */
export const BULK_CUSTOMER_COLUMNS = [
  'partySource',
  'payBy',
  'agentName',
  'category',
  'brand',
  'city',
  'state',
  'region',
] as const;
export type BulkCustomerColumn = (typeof BULK_CUSTOMER_COLUMNS)[number];

/** Values to write. Absent or blank means "leave that column alone". */
export type BulkCustomerValues = Partial<Record<BulkCustomerColumn, string>>;

/**
 * The parties to change, always as explicit ids.
 *
 * "Apply to all N matching" is materialised into ids on the client (the page's
 * Select-all-matching, same as the Products page) rather than sent as a filter.
 * That keeps one code path, and — because preview and apply then name the same
 * rows — what the dialog showed cannot drift from what gets written.
 */
export interface BulkUpdateCustomersInput {
  ids: number[];
  set: BulkCustomerValues;
}

/** One column moving on one party. Rows already holding the new value are not listed. */
export interface BulkCustomerChange {
  id: number;
  partyName: string | null;
  column: BulkCustomerColumn;
  from: string | null;
  to: string;
}

/** A party the change cannot be applied to, and why. Blockers stop the whole apply. */
export interface BulkCustomerBlocker {
  id: number;
  partyName: string | null;
  reason: string;
}

export interface BulkCustomerPlan {
  /** How many parties the target resolved to. */
  matched: number;
  /** Parties with at least one column actually moving. */
  affected: number;
  changes: BulkCustomerChange[];
  blocked: BulkCustomerBlocker[];
  /** Consequences worth reading before applying (e.g. losing Party-mode receipts). */
  warnings: string[];
}
