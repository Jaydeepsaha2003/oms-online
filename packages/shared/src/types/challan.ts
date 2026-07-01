/**
 * Challan / Tax-Invoice shapes (legacy PendChallan + Form14).
 *
 * A challan is a tax invoice built from one customer's dispatched-but-not-yet-
 * challaned lines. Phase 1 covers the data model + the "Pending Challan" list;
 * the Form14 pricing engine (freight/packing/pouch/GST/half-bill/TCS) + PDF
 * print arrive in Phase 2.
 */

import type { Paginated, PaginationQuery } from './common';

export const CHALLAN_STATUSES = ['CONFIRMED', 'CANCELLED'] as const;
export type ChallanStatus = (typeof CHALLAN_STATUSES)[number];

/** A dispatch line still awaiting a challan (mirrors the legacy PendChallan grid). */
export interface PendingChallanLine {
  dispatchId: number;
  dispatchDate: string;
  orderId: number | null;
  orderCode: string | null;
  customerId: number | null;
  customerName: string;
  productName: string | null;
  design: string | null;
  bags: number | null;
  /** Weight (legacy GRAM column), shown as KGS. */
  kgs: number | null;
  pcs: number | null;
  box: number | null;
  /** Pricing unit (legacy CAL FIELD): KGS / PCS. */
  unit: string | null;
  rate: number | null;
}

export type PendingChallanQuery = PaginationQuery & {
  /** Inclusive dispatch-date range (ISO yyyy-mm-dd). */
  dateFrom?: string;
  dateTo?: string;
  /** Restrict to one party (exact) — standalone Create Challan picker. */
  customerName?: string;
};
export type PendingChallanList = Paginated<PendingChallanLine>;

export interface ChallanItemDto {
  id: number;
  challanId: number;
  dispatchId: number | null;
  productName: string | null;
  design: string | null;
  bags: number | null;
  pcs: number | null;
  kgs: number | null;
  box: number | null;
  unit: string | null;
  price: number | null;
  amount: number | null;
  pCategory: string | null;
  comment: string | null;
}

export interface ChallanDto {
  id: number;
  code: string;
  prefix: string | null;
  invDate: string;
  customerId: number | null;
  customerName: string;
  billingAddress: string | null;
  shippingAddress: string | null;
  category: string | null;
  paymentTerm: number | null;
  dueDate: string | null;
  transName: string | null;
  packing: number | null;
  freight: number | null;
  pouch: number | null;
  tcs: number | null;
  tds: number | null;
  tdsPercent: number | null;
  tax: number | null;
  total: number | null;
  b: number | null;
  c: number | null;
  remarks: string | null;
  gst: number | null;
  billingRate: number | null;
  noBill: boolean;
  transaction: string;
  challanStatus: ChallanStatus;
  userName: string | null;
  items: ChallanItemDto[];
  createdAt: string;
  updatedAt: string;
}

export type ChallanQuery = PaginationQuery & {
  status?: string;
  /** Inclusive invoice-date range (yyyy-mm-dd). */
  dateFrom?: string;
  dateTo?: string;
};
export type ChallanList = Paginated<ChallanDto>;

/** KPI roll-up for the Challans list (ViewChallan KPI cards). */
export interface ChallanSummary {
  count: number;
  totalSales: number;
  totalB: number;
  totalC: number;
  totalTds: number;
}

export interface UpdateChallanStatusInput {
  challanStatus: ChallanStatus;
}

/** Configurable challan-number prefixes (Settings). Number = PREFIX/FY/serial. */
export interface ChallanPrefixSettings {
  prefixes: string[];
  default: string;
}

/** One challan line for a product (ViewItemChallan detail grid). */
export interface ChallanItemHistoryRow {
  id: number;
  challanId: number;
  code: string;
  invDate: string;
  customerName: string;
  productName: string | null;
  design: string | null;
  qty: number;
  unit: string | null;
  price: number | null;
  amount: number | null;
}
export type ChallanItemHistoryList = Paginated<ChallanItemHistoryRow>;

/* ── Draft (Form14 CreateGridList): selected dispatches → priced challan lines ── */
export interface DraftChallanInput {
  customerName: string;
  /** Omit to price the customer's entire un-challaned pool (Form14 dropdown flow). */
  dispatchIds?: number[];
}

export interface ChallanDraftItem {
  dispatchId: number | null;
  orderId: number | null;
  orderCode: string | null;
  productName: string | null;
  design: string | null;
  bags: number | null;
  pcs: number | null;
  kgs: number | null;
  box: number | null;
  unit: string | null;
  price: number | null;
  amount: number;
  pCategory: string | null;
  comment: string | null;
  /** Per-line rates resolved from the master tables (Form14 grid columns). */
  gstRate: number;
  freightRate: number;
  packingRate: number;
}

export interface ChallanDraft {
  code: string;
  prefix: string;
  /** Prefixes configured in Settings (for the invoice-no prefix dropdown). */
  prefixes: string[];
  customerId: number | null;
  customerName: string;
  billingAddress: string;
  category: string | null;
  paymentTerm: number | null;
  transName: string | null;
  billingRate: number | null;
  boxRate: number | null;
  /** Whole-challan GST% = max per-line GST rate. */
  gst: number;
  /** Pre-computed suggested charges (Form14 ApplyChargesFromGridView). */
  freight: number;
  packing: number;
  pouch: number;
  /** Customer TDS settings (drives the TDS deduction on the challan). */
  tdsApplicable: boolean;
  tdsPercent: number | null;
  isScrap: boolean;
  items: ChallanDraftItem[];
}

/* ── Create / save ──────────────────────────────────────────────────────────── */
export interface CreateChallanItemInput {
  dispatchId: number | null;
  productName: string | null;
  design: string | null;
  bags: number | null;
  pcs: number | null;
  kgs: number | null;
  box: number | null;
  unit: string | null;
  price: number | null;
  amount: number | null;
  pCategory: string | null;
  comment: string | null;
}

export interface CreateChallanInput {
  code?: string;
  prefix?: string;
  invDate?: string;
  customerId?: number | null;
  customerName: string;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  category?: string | null;
  paymentTerm?: number | null;
  dueDate?: string | null;
  transName?: string | null;
  packing?: number | null;
  freight?: number | null;
  pouch?: number | null;
  tcs?: number | null;
  tds?: number | null;
  tdsPercent?: number | null;
  tax?: number | null;
  total?: number | null;
  b?: number | null;
  c?: number | null;
  remarks?: string | null;
  gst?: number | null;
  billingRate?: number | null;
  noBill?: boolean;
  challanStatus?: ChallanStatus;
  items: CreateChallanItemInput[];
}

/** Loads a saved challan for editing (Form14 SearchBtn): the stored challan, the
 *  customer's still-available pool to add more, and the saved lines re-priced. */
export interface ChallanEditContext {
  challan: ChallanDto;
  draft: ChallanDraft;
  rows: ChallanDraftItem[];
}

/* ── Totals engine (Form14 CalculateTotal) — shared by the form + the server ──── */
export interface ChallanTotalsInput {
  items: { bags?: number | null; pcs?: number | null; kgs?: number | null; box?: number | null; amount?: number | null; gstRate?: number | null }[];
  freight?: number | null;
  packing?: number | null;
  pouch?: number | null;
  /** Overall GST%; defaults to the max per-line GST rate. */
  gstRatePct?: number | null;
  /** > 0 switches to half-bill (bill only on KGS that carry GST). */
  billingRate?: number | null;
  noBill?: boolean;
  noBillRemoveGst?: boolean;
  /** SCRAP parties add 1% TCS. */
  isScrap?: boolean;
  tdsApplicable?: boolean;
  tdsPercent?: number | null;
  /** Manual overrides (Form14 Button2/Editbtn): typed Tax back-derives GST%, typed B/C are kept as-is. */
  taxOverride?: number | null;
  bOverride?: number | null;
  cOverride?: number | null;
}

export interface ChallanTotals {
  tBags: number;
  tPcs: number;
  tKgs: number;
  tBox: number;
  tAmt: number;
  gstRatePct: number;
  taxableBase: number;
  tax: number;
  tcs: number;
  total: number;
  b: number;
  c: number;
  tdsAmount: number;
  netReceivable: number;
}

const r0 = (x: number) => Math.round(x);
const r2 = (x: number) => Math.round(x * 100) / 100;
const sumBy = <T>(arr: T[], f: (x: T) => number) => arr.reduce((a, x) => a + f(x), 0);
const num = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : 0);

/**
 * Faithful port of Form14.CalculateTotal, plus the new TDS deduction.
 * GST base differs by mode: full-bill taxes (amount + freight + packing + pouch),
 * half-bill taxes only the billed KGS value, no-bill can drop GST entirely.
 * TDS (when the party is TDS-applicable) is deducted on the taxable goods value
 * (TAmt, before GST) and yields the net receivable.
 */
export function computeChallanTotals(input: ChallanTotalsInput): ChallanTotals {
  const items = input.items ?? [];
  const tBags = sumBy(items, (i) => num(i.bags));
  const tPcs = sumBy(items, (i) => num(i.pcs));
  const tKgs = sumBy(items, (i) => num(i.kgs));
  const tBox = sumBy(items, (i) => num(i.box));
  const tAmt = r0(sumBy(items, (i) => num(i.amount)));

  const freight = num(input.freight);
  const packing = num(input.packing);
  const pouch = num(input.pouch);
  let gstRatePct = input.gstRatePct != null ? num(input.gstRatePct) : Math.max(0, ...items.map((i) => num(i.gstRate)));
  const billingRate = num(input.billingRate);
  const tcs = input.isScrap ? r2(tAmt * 0.01) : 0;

  // Tax base + auto GST amount per billing mode.
  let taxableBase: number;
  let autoTax: number;
  if (input.noBill) {
    taxableBase = tAmt + freight + packing + pouch;
    autoTax = input.noBillRemoveGst ? 0 : r0((taxableBase * gstRatePct) / 100);
  } else if (billingRate > 0) {
    const billedKg = sumBy(items, (i) => (num(i.gstRate) > 0 ? num(i.kgs) : 0));
    taxableBase = billingRate * billedKg;
    autoTax = r0((taxableBase * gstRatePct) / 100);
  } else {
    taxableBase = tAmt + freight + packing + pouch;
    autoTax = r0((taxableBase * gstRatePct) / 100);
  }

  // Manual Tax override (Form14 Button2) back-derives the displayed GST%.
  let tax = autoTax;
  if (input.taxOverride != null) {
    tax = num(input.taxOverride);
    if (taxableBase > 0) gstRatePct = r2((tax / taxableBase) * 100);
  }

  // Total + billed (B) from the effective tax.
  let total: number;
  let b: number;
  if (input.noBill) {
    total = r0(packing + freight + tAmt + pouch + tax + tcs);
    b = 0;
  } else if (billingRate > 0) {
    total = r0(packing + freight + tAmt + pouch + tax);
    b = r0(taxableBase + tax);
  } else {
    total = r0(packing + freight + tAmt + pouch + tax + tcs);
    b = r0(taxableBase + tax + tcs);
  }
  if (input.bOverride != null) b = num(input.bOverride); // Form14 Editbtn

  let c = r0(total - b);
  if (input.cOverride != null) c = num(input.cOverride);
  const tdsAmount = input.tdsApplicable ? r0((tAmt * num(input.tdsPercent)) / 100) : 0;
  const netReceivable = r0(total - tdsAmount);

  return { tBags, tPcs, tKgs, tBox, tAmt, gstRatePct, taxableBase, tax, tcs, total, b, c, tdsAmount, netReceivable };
}
