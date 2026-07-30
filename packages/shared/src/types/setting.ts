/** User-editable option lists surfaced on the Settings page and used by forms. */

export const SETTING_GROUPS = ['COMPLETION_DAYS', 'ORDER_TYPE', 'QUOTATION_CANCEL_REASON'] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export interface OrderOptionDto {
  id: number;
  group: string;
  value: string;
  sortOrder: number;
}

/* ── Order quantity-field layout ─────────────────────────────────────────────
 * The New Order form shows four quantity inputs — Bags, Pcs, Kgs, Box. Their
 * left-to-right order can be arranged per product category (so, e.g., cup
 * categories can lead with Box), with a default order for everything else. */
export const QTY_FIELDS = ['bags', 'pcs', 'kgs', 'box'] as const;
export type QtyField = (typeof QTY_FIELDS)[number];
export const QTY_FIELD_LABEL: Record<QtyField, string> = { bags: 'Bags', pcs: 'Pcs', kgs: 'Kgs', box: 'Box' };

export interface OrderQtyLayout {
  /** Order used when a category has no specific arrangement. */
  default: QtyField[];
  /** Per-category (UPPER-CASED key) field-order overrides. */
  byCategory: Record<string, QtyField[]>;
}
export const DEFAULT_ORDER_QTY_LAYOUT: OrderQtyLayout = { default: ['bags', 'pcs', 'kgs', 'box'], byCategory: {} };

/** Normalise a field list to exactly the four fields (dedupe, keep order, append
 *  any missing) — so a stored/partial list can never drop or duplicate a field. */
export function normalizeQtyOrder(order: readonly string[] | undefined | null): QtyField[] {
  const seen = new Set<QtyField>();
  const out: QtyField[] = [];
  for (const f of order ?? []) {
    const k = String(f).toLowerCase() as QtyField;
    if (QTY_FIELDS.includes(k) && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  for (const f of QTY_FIELDS) if (!seen.has(f)) out.push(f);
  return out;
}

/** Resolve the field order for a given product category (falls back to default). */
export function qtyOrderForCategory(layout: OrderQtyLayout | undefined, category: string | null | undefined): QtyField[] {
  const base = layout ?? DEFAULT_ORDER_QTY_LAYOUT;
  const key = (category ?? '').trim().toUpperCase();
  return normalizeQtyOrder(key && base.byCategory[key] ? base.byCategory[key] : base.default);
}

/** Company branding shown on printed documents (bill / invoice / quotation). */
export interface CompanyProfileDto {
  name: string | null;
  /** Logo as a base64 data URL (e.g. "data:image/png;base64,…") or null. */
  logo: string | null;
}

export interface CompanyProfileInput {
  name?: string | null;
  logo?: string | null;
}

/** Sales Order / Quotation bill's "Terms & Conditions" list — editable in Settings. */
export interface OrderTermsDto {
  terms: string[];
}

export interface OrderTermsInput {
  terms: string[];
}

/** Sales Order / Quotation bill's footer text lines — editable in Settings.
 *  A line containing the token "{DOC_TYPE}" has it replaced with "SALES ORDER" or "QUOTATION" when printed. */
export interface OrderFooterDto {
  lines: string[];
}

export interface OrderFooterInput {
  lines: string[];
}

/** Challan / Tax Invoice bill's "Terms & Conditions" list — editable in Settings.
 *  Empty by default (no terms printed) until the business saves its own list. */
export interface ChallanTermsDto {
  terms: string[];
}

export interface ChallanTermsInput {
  terms: string[];
}

export interface OrderOptionInput {
  group: string;
  value: string;
}

export interface SettingGroupMeta {
  group: SettingGroup;
  label: string;
  description: string;
  /** Values are whole numbers (e.g. completion days). */
  numeric: boolean;
  placeholder: string;
}

/** The setting groups the UI knows how to render, in display order. */
export const SETTING_GROUP_META: SettingGroupMeta[] = [
  {
    group: 'COMPLETION_DAYS',
    label: 'Completion Days',
    description: 'Delivery durations (in days) selectable when creating an order.',
    numeric: true,
    placeholder: 'e.g. 7',
  },
  {
    group: 'ORDER_TYPE',
    label: 'Order Types',
    description: 'Order type options available on order line items.',
    numeric: false,
    placeholder: 'e.g. SALES ORDER',
  },
  {
    // Key kept for back-compat with existing stored values; label is now universal.
    group: 'QUOTATION_CANCEL_REASON',
    label: 'Cancellation Reasons',
    description: 'Reasons selectable when cancelling a quotation or an order — used for analysis. Add "Others" to allow a free-typed reason.',
    numeric: false,
    placeholder: 'e.g. PRICE TOO HIGH',
  },
];
