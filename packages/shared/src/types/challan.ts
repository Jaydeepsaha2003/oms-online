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
  /** Product category the rates are keyed by — named in the unpriced-line warning. */
  pCategory: string | null;
  /** Rates resolved from the masters for this line's category, so an unpriced
   *  line is visible BEFORE it is pulled into a challan. `null` = no master row
   *  at all; `0` = configured and genuinely zero. Same meaning as on
   *  {@link ChallanDraftItem}. */
  gstRate: number | null;
  freightRate: number | null;
  packingRate: number | null;
  /** Name of whoever currently has this line's ORDER LINE open in the Dispatch
   *  form — a soft lock (see DispatchService.acquireLock). A dispatch already
   *  sitting here un-challaned can still belong to an order line someone is
   *  actively dispatching MORE of, so the same lock name that warns the
   *  Dispatch Order screen also warns here. Null/absent = nobody's on it. */
  lockedByName?: string | null;
}

export type PendingChallanQuery = PaginationQuery & {
  /** Inclusive dispatch-date range (ISO yyyy-mm-dd). */
  dateFrom?: string;
  dateTo?: string;
  /** Restrict to one party (exact) — standalone Create Challan picker. */
  customerName?: string;
  /** Restrict to one product / design (exact) — Pending Challan filter bar. */
  productName?: string;
  design?: string;
};
export type PendingChallanList = Paginated<PendingChallanLine>;

/** Dropdown options for the Pending Challan filter bar. Each list holds only
 *  values that currently appear on un-challaned dispatch lines, so picking one
 *  can never return an empty page. */
export interface PendingChallanFilterOptions {
  customers: string[];
  products: string[];
  designs: string[];
}

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
  /** % `tcs` was computed at (Settings → SCRAP TCS Rate at save time). */
  tcsPercent: number | null;
  tds: number | null;
  tdsPercent: number | null;
  tax: number | null;
  total: number | null;
  b: number | null;
  c: number | null;
  /**
   * Money received against this challan, and what is left on it.
   *
   * Only the LIST fills these in — it is the one screen that has to tell a bill
   * that is merely late from one that is late and unpaid. Without them the DUE
   * column could only compare the due date with today, so 1,523 settled
   * challans sat there in red saying "40 over".
   */
  received?: number;
  balance?: number;
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
  /** Restrict to one customer category (exact, from the master). */
  category?: string;
  /**
   * Restrict to the parties of one agent (exact, from the customer master).
   *
   * A challan records the party, not the agent, so this resolves to that
   * agent's customers and matches those — see `agentScope` in the service.
   */
  agent?: string;
};
export type ChallanList = Paginated<ChallanDto>;

/** KPI roll-up for the Challans list (ViewChallan KPI cards). */
export interface ChallanSummary {
  count: number;
  totalSales: number;
  totalB: number;
  totalC: number;
  /** Total GST (tax) across the filtered set. */
  totalTax: number;
  totalTds: number;
  /** Status split across the filtered set (not just the current page). */
  confirmed: number;
  cancelled: number;
  /**
   * Every agent named on the customer master, UNFILTERED — the options for the
   * list's agent dropdown. Unfiltered on purpose: narrowing it to the current
   * result set would make an agent disappear the moment you picked them.
   */
  agents: string[];
}

/** Rich analytics roll-up for the Challans "Show KPI" modal. Honours the same
 *  filters as the list (search / date range / status) plus an optional category. */
export interface ChallanAnalytics {
  /** Headline totals over the filtered set. */
  totals: {
    count: number;
    totalSales: number;
    totalB: number;
    totalC: number;
    totalGst: number;
    totalTds: number;
    totalTcs: number;
    totalFreight: number;
    totalPacking: number;
    /** Σ bags across every line in scope — what the freight was actually paid on. */
    totalBags: number;
    avgValue: number;
  };
  /** Split by challan status. */
  byStatus: {
    confirmed: { count: number; total: number };
    cancelled: { count: number; total: number };
  };
  /**
   * One row per customer category (largest first).
   *
   * Carries the charges and the bag count as well as the value: a freight total
   * on its own says what was spent but not what it was spent on, and the
   * question people actually ask of it is "which category is eating the
   * freight, and how many bags went out".
   */
  byCategory: {
    category: string;
    count: number;
    total: number;
    b: number;
    c: number;
    freight: number;
    packing: number;
    bags: number;
  }[];
  /** Highest-billing parties (largest first, capped). */
  topParties: { customerName: string; count: number; total: number }[];
  /** Confirmed challans past their due date (money still to receive). */
  overdue: { count: number; total: number };
  /** All distinct categories in the master (for the filter dropdown). */
  categories: string[];
  /** Trading-account statement over the same filters (see {@link TradingAccount}). */
  trading: TradingAccount;
}

/**
 * A trading-account style statement over the filtered date range: what was sold,
 * what came back, and what was actually invoiced.
 *
 * Every figure is a GOODS value (the sum of the document's line amounts), not the
 * document grand total — charges and tax are separate lines below, so the whole
 * statement adds up in one column:
 *
 *   grossSales + debitNotes - salesReturns          = netSales
 *   netSales + freight + packing + pouch            = netRevenue
 *   netRevenue + gst + tcs - tds                    = totalInvoiced
 *
 * Charges and GST are NET of credit notes (a return can carry its own freight and
 * tax), which is what makes `totalInvoiced` reconcile to the documents.
 */
/** One debit/credit note behind a Trading Account row. */
export interface TradingNoteRow {
  id: number;
  code: string;
  customerName: string;
  /** Goods value of the note (Σ line amounts) — the figure that feeds the row. */
  amount: number;
  /** ISO date of the document. */
  date: string;
}

export interface TradingAccount {
  /**
   * Where the statement opens: Σ challan totals for the filter — the same figure
   * as the "Total Sales" KPI card, tax and charges included, returns not netted.
   * The rows beneath strip those back out to reach a goods value.
   */
  totalSales: { amount: number; count: number };
  /** GST / charges / TCS as invoiced (NOT net of credit notes) — the deductions
   *  that take `totalSales` down to a goods value. */
  grossGst: number;
  grossCharges: number;
  grossTcs: number;
  /** Goods value of every challan in scope = grossSales + debitNotes. */
  goodsInvoiced: number;
  /**
   * Residual on the opening block: totalSales − GST − charges − TCS − goods.
   * Zero when every document decomposes cleanly; non-zero is the same drift
   * `documentsOutOfLine` counts, shown as its own row so the column still ties
   * instead of quietly absorbing it.
   */
  openingVariance: number;
  /** SALES INVOICE documents. */
  grossSales: { amount: number; count: number };
  /** DEBIT NOTE documents — extra charged to the party, so added to sales. */
  debitNotes: { amount: number; count: number };
  /** Credit notes: goods returned / credited back, so deducted. */
  salesReturns: { amount: number; count: number };
  netSales: number;
  /** Charges, net of any carried on a credit note. */
  freight: number;
  packing: number;
  pouch: number;
  netRevenue: number;
  /** GST, net of credit-note GST. */
  gst: number;
  tcs: number;
  tds: number;
  totalInvoiced: number;
  /** salesReturns / grossSales, as a percentage (0 when there are no sales). */
  returnRatePercent: number;
  /**
   * Σ document totals (challans − credit notes). The statement is built from
   * component sums, so this is an independent figure: if it differs from
   * `totalInvoiced` the underlying documents don't decompose cleanly and the UI
   * says so rather than quietly showing a statement that doesn't add up.
   */
  documentTotal: number;
  /**
   * How many challans in range carry a stored `total` that does not equal their
   * own goods + charges + GST + TCS − TDS. The totals engine always composes a
   * total that way, so a non-zero count means those documents' stored totals and
   * stored components disagree — worth investigating, and the reason
   * `documentTotal` can differ from `totalInvoiced`.
   */
  documentsOutOfLine: number;
  /** Which challan statuses the figures cover — '' when unfiltered (all). */
  statusScope: string;
  /** Cancelled challans inside the range, so the UI can flag what's included or
   *  left out under the current status filter. */
  cancelled: { amount: number; count: number };
  /**
   * The actual documents behind the Debit Notes and Sales Returns rows.
   *
   * A count and a sum tell you something moved but not what — and "3 note(s)"
   * is exactly the figure nobody can verify without leaving the screen. Capped,
   * because these rows are for checking a handful of notes, not for browsing a
   * year of them; `debitNotesTruncated` says when the list was cut.
   *
   * Debit notes are Challan records, so `id` opens the real document. Credit
   * notes live in their own table with no viewer in the app yet, so their `id`
   * is there for later and the UI does not offer a link it cannot honour.
   */
  debitNoteList: TradingNoteRow[];
  creditNoteList: TradingNoteRow[];
  debitNotesTruncated: boolean;
  creditNotesTruncated: boolean;
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
  /** The source dispatch's order line — lets Modify Challan show that line's
   *  reference photos (see the Dispatch photo-documentation feature). Null for
   *  a manual/SCRAP line with no dispatch behind it. */
  orderItemId: number | null;
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
  /** Per-line rates resolved from the master tables (Form14 grid columns).
   *  `null` means the rate master has NO row for this category/transport at
   *  all — not configured — as opposed to `0`, which means it's configured
   *  and genuinely zero. Create Challan warns on the former, not the latter. */
  gstRate: number | null;
  freightRate: number | null;
  packingRate: number | null;
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
  /** Customer TDS settings (drives the TDS deduction on the challan). Ignored
   *  when isScrap — SCRAP parties carry TCS only, never TDS. */
  tdsApplicable: boolean;
  tdsPercent: number | null;
  isScrap: boolean;
  /** Resolved GST rate for the SCRAP category if this is a scrap party. */
  scrapGstRate: number | null;
  /** Globally configured TCS % (Settings → SCRAP TCS Rate), applied when isScrap. */
  tcsPercent: number;
  /** Active catalogue products offered by the manual-line Product picker, so a
   *  manual line names a real item instead of free-typed text. For a SCRAP party
   *  the SCRAP-category products are listed first. */
  manualProducts: string[];
  /** The SCRAP-category product to pre-select on the manual line for a SCRAP
   *  party (null when the party isn't scrap, or no scrap product is set up yet). */
  defaultManualProduct: string | null;
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
  tcsPercent?: number | null;
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
  /** Set by the client after the operator confirms a near-duplicate warning, to
   *  save it anyway. Omitted on a first attempt so the server can check. */
  confirmDuplicate?: boolean;
  items: CreateChallanItemInput[];
}

/** Loads a saved challan for editing (Form14 SearchBtn): the stored challan, the
 *  customer's still-available pool to add more, and the saved lines re-priced. */
export interface ChallanEditContext {
  challan: ChallanDto;
  draft: ChallanDraft;
  rows: ChallanDraftItem[];
}

/* ── Missing Challan (legacy MissingChallanForm): gaps in a prefix/FY invoice-
   number series, e.g. #45 never issued between #44 and #46. An operator can
   "dismiss" a gap (acknowledge it's intentionally skipped, e.g. voided by hand)
   or "restore" a dismissed one back onto the missing list. ── */
export interface MissingChallanFysDto {
  /** Every FY that has at least one challan for this prefix, newest first. */
  fys: string[];
  /** The current calendar fiscal year (always included, even with zero challans yet). */
  current: string;
  /** FY of the most recently created ("last built") invoice for this prefix — the
   *  sensible default series to check, since right after a fiscal-year rollover
   *  `current` can still be empty while the prior year's series has real gaps. */
  lastBuilt: string;
}

export interface MissingChallanEntry {
  /** Full display invoice number, e.g. "SSS/26-27/45". */
  code: string;
  /** Just the numeric serial within the prefix/FY series. */
  invNo: number;
  /** Why this number was dismissed (only set in "Show Deleted Only" mode). */
  reason?: string | null;
}

export type MissingChallanQuery = {
  prefix: string;
  fy: string;
  deletedOnly?: boolean;
};

export interface DismissMissingChallanInput {
  prefix: string;
  fy: string;
  invNo: number;
  /** Required when dismissing — kept on record for future reference. */
  reason?: string;
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
  /** SCRAP parties add TCS (at `tcsPercent`) instead of TDS. */
  isScrap?: boolean;
  /** Globally configured TCS %, fetched from settings. Defaults to 1. */
  tcsPercent?: number | null;
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
// Quantities cap at 3 decimals — summing floats (69.8 + 71.6) otherwise surfaces
// artifacts like 141.39999999999998 in the KGS total.
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const sumBy = <T>(arr: T[], f: (x: T) => number) => arr.reduce((a, x) => a + f(x), 0);
const num = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : 0);

/**
 * Faithful port of Form14.CalculateTotal, plus the new TDS deduction.
 * GST base differs by mode: full-bill taxes (amount + freight + packing + pouch),
 * half-bill taxes only the billed KGS value, no-bill can drop GST entirely.
 * TDS (when the party is TDS-applicable) is deducted on the taxable goods value
 * (TAmt, before GST) and yields the net receivable — except for SCRAP parties,
 * which carry TCS instead and never TDS.
 */
export function computeChallanTotals(input: ChallanTotalsInput): ChallanTotals {
  const items = input.items ?? [];
  const tBags = r3(sumBy(items, (i) => num(i.bags)));
  const tPcs = r3(sumBy(items, (i) => num(i.pcs)));
  const tKgs = r3(sumBy(items, (i) => num(i.kgs)));
  const tBox = r3(sumBy(items, (i) => num(i.box)));
  const tAmt = r0(sumBy(items, (i) => num(i.amount)));

  const freight = num(input.freight);
  const packing = num(input.packing);
  const pouch = num(input.pouch);
  let gstRatePct = input.gstRatePct != null ? num(input.gstRatePct) : Math.max(0, ...items.map((i) => num(i.gstRate)));
  const billingRate = num(input.billingRate);
  const tcsPercent = input.tcsPercent != null ? num(input.tcsPercent) : 1;
  const tcs = input.isScrap ? r2((tAmt * tcsPercent) / 100) : 0;

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
  // SCRAP parties are TCS-only — TDS never applies here even if the customer
  // record separately carries tdsApplicable (e.g. from a prior non-scrap use).
  const tdsAmount = input.tdsApplicable && !input.isScrap ? r0((tAmt * num(input.tdsPercent)) / 100) : 0;
  const netReceivable = r0(total - tdsAmount);

  return { tBags, tPcs, tKgs, tBox, tAmt, gstRatePct, taxableBase, tax, tcs, total, b, c, tdsAmount, netReceivable };
}
