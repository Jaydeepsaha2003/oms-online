/** Sales order shapes: a header (customer + dates) with many line items. */

import type { Paginated, PaginationQuery } from './common';

export const ORDER_PRIORITIES = ['NORMAL', 'URGENT'] as const;
export const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Statuses an order can hold while it is NOT yet a commitment to anybody, and
 * so must be kept out of the order lists, Order Modify, dispatch and bookings:
 *
 *  - DRAFT  — still being written; saved so it isn't lost, nothing promised.
 *  - QUOTED — parked because it was saved as a quotation. The quotation is the
 *             live document from then on; converting it revives this exact order
 *             (same Order #) instead of creating a duplicate. See
 *             QuotationDto.sourceOrderId.
 *
 * Neither appears in {@link ORDER_STATUSES}: they're lifecycle states the
 * system sets, never something a user picks from a dropdown.
 */
export const ORDER_UNCOMMITTED_STATUSES = ['DRAFT', 'QUOTED'] as const;

/** True while an order is only a draft or parked as a quotation — see
 *  {@link ORDER_UNCOMMITTED_STATUSES}. */
export const isUncommittedOrder = (status: string | null | undefined): boolean =>
  !!status && (ORDER_UNCOMMITTED_STATUSES as readonly string[]).includes(status);

/** Columns offered by Order Modify's Excel export, in the order they're written
 *  to the sheet. Shared so the "which columns?" picker on the frontend and the
 *  xlsx builder on the backend can never drift apart (mirrors
 *  DISPATCH_EXPORT_COLUMNS in dispatch.ts). */
export const ORDER_LINE_EXPORT_COLUMNS = [
  { id: 'orderId', header: 'Order ID' },
  { id: 'orderDate', header: 'Order Date' },
  { id: 'dueDate', header: 'Due Date' },
  { id: 'customer', header: 'Customer Name' },
  { id: 'product', header: 'Product Name' },
  { id: 'design', header: 'Design Type' },
  { id: 'priority', header: 'Priority' },
  { id: 'bags', header: 'Bags' },
  { id: 'pcs', header: 'Pcs' },
  { id: 'kgs', header: 'Kgs' },
  { id: 'box', header: 'Box' },
  { id: 'rate', header: 'Rate' },
  { id: 'comment', header: 'Comment' },
  { id: 'status', header: 'Status' },
] as const;
export type OrderLineExportColumnId = (typeof ORDER_LINE_EXPORT_COLUMNS)[number]['id'];

/** A file the upload endpoint stored — path + served URL, ready to attach to a line. */
export interface UploadedFileDto {
  /** Path relative to the /uploads root, e.g. "order-items/<uuid>.jpg". */
  path: string;
  /** Same-origin URL the web app loads. */
  url: string;
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  uploadedBy: string | null;
}

/** A photo attached to an order line (stored on disk under /uploads). */
export interface OrderItemPhotoDto {
  id: number;
  /** Path relative to the /uploads root. */
  path: string;
  /** Same-origin URL the web app loads. */
  url: string;
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  uploadedBy: string | null;
  createdAt: string;
}

/** A photo on an order-line input: existing photos carry `id`; newly-uploaded
 *  ones carry `path` + `url` (from {@link UploadedFileDto}). */
export interface OrderItemPhotoInput {
  id?: number | null;
  path?: string | null;
  url?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

export interface OrderItemDto {
  id: number;
  pCategory: string | null;
  subCategory: string | null;
  product: string | null;
  /** Human-readable selected design name(s), e.g. "AK RING+CHINA". */
  design: string | null;
  productName: string | null;
  designType: string | null;
  psize: number | null;
  bags: number | null;
  pcs: number | null;
  gram: number | null;
  box: number | null;
  productRate: number | null;
  designRate: number | null;
  rate: number | null;
  calField: string | null;
  priority: string | null;
  ordType: string | null;
  /** CONFIRMED (active) or CANCELLED (kept for the record, excluded from totals). */
  status: string;
  comment: string | null;
  /** True once at least one Dispatch record exists against this line — its
   *  quantity/rate/product details are then frozen server-side; only status
   *  (e.g. Cancel) and comment may still change. Add further changes as a new line. */
  dispatched?: boolean;
  /**
   * How far THIS line has shipped, so Order Modify can show it per line rather
   * than only rolling it up per order:
   *   NONE    — nothing dispatched yet
   *   PARTIAL — at least one dispatch exists, none marked "FULLY DISPATCH"
   *   FULL    — a "FULLY DISPATCH" record exists for it
   * Same source as {@link OrderDto.dispatchState}, just not collapsed to the order.
   */
  dispatchState?: 'NONE' | 'PARTIAL' | 'FULL';
  /** Set when this line was drawn from a bag Booking (rates frozen at that booking's date). */
  bookingId: number | null;
  /** The source booking's code (e.g. BKG-00001), when bookingId is set. */
  bookingCode?: string | null;
  /** Photos attached to this line (reference images / artwork / packing shots). */
  photos?: OrderItemPhotoDto[];
}

export interface OrderDto {
  id: number;
  code: string | null;
  poNumber: string | null;
  customerId: number | null;
  customerName: string;
  /** Customer's city/state/region, joined for display on the printable bill.
   *  Only populated on the single-order fetch (GET /orders/:id), not list views. */
  billingAddress?: string | null;
  agentName: string | null;
  category: string | null;
  orderDate: string;
  completionDate: string | null;
  completionDay: number | null;
  /**
   * The party's payment terms in days, for the {{pay_terms}} tag on the printed
   * Terms & Conditions.
   *
   * Read from the CUSTOMER (`creditPeriod`), because an order has no payment term
   * of its own — its `completionDate` is a delivery date, which is why a sales
   * order could show "Due Date 02/09/26" beside a clause promising 30 days and
   * neither figure was wrong, they were just answering different questions.
   *
   * Only populated on the single-order read (the one the printed document uses).
   * Null on list rows: resolving it there would be a lookup per row for a figure
   * no list column shows.
   */
  paymentTermDays?: number | null;
  priority: string | null;
  status: string;
  ordType: string;
  comment: string | null;
  userName: string | null;
  /** Why the order was cancelled + optional free-typed detail (reason "Others"). */
  cancelReason: string | null;
  cancelNote: string | null;
  items: OrderItemDto[];
  /** Convenience aggregates for list views. */
  itemCount: number;
  /** Sum of line rates (productRate + designRate). */
  totalRate: number;
  /** Sum of line amounts: rate × quantity (Kgs or Pcs per the line's calc field). */
  totalAmount: number;
  /** Dispatch roll-up across active lines (list views): FULL = every line fully
   *  dispatched, PARTIAL = some dispatches exist, NONE = untouched. */
  dispatchState?: 'NONE' | 'PARTIAL' | 'FULL' | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItemInput {
  /** Present for existing lines so the server updates them in place (preserving dispatches). */
  id?: number | null;
  pCategory?: string | null;
  subCategory?: string | null;
  product?: string | null;
  /** Human-readable selected design name(s), e.g. "AK RING+CHINA". */
  design?: string | null;
  productName?: string | null;
  designType?: string | null;
  psize?: number | null;
  bags?: number | null;
  pcs?: number | null;
  gram?: number | null;
  box?: number | null;
  productRate?: number | null;
  designRate?: number | null;
  rate?: number | null;
  calField?: string | null;
  priority?: string | null;
  ordType?: string | null;
  status?: string | null;
  comment?: string | null;
  /** Draw this line from a bag Booking — the server freezes its rate to the booking date. */
  bookingId?: number | null;
  /** Full desired photo set for this line. Existing photos keep their `id`;
   *  new uploads carry `path` + `url`. Omit the field entirely to leave a line's
   *  photos untouched (only present-and-synced when the caller manages photos). */
  photos?: OrderItemPhotoInput[];
}

export interface OrderInput {
  customerName: string;
  poNumber?: string | null;
  agentName?: string | null;
  category?: string | null;
  orderDate?: string | null;
  completionDate?: string | null;
  priority?: string | null;
  status?: string | null;
  comment?: string | null;
  items: OrderItemInput[];
}

export type OrderQuery = PaginationQuery & {
  status?: string;
  /** Filter to orders for this customer (exact match, values come from
   *  {@link OrderFilterOptions}). */
  customer?: string;
  /** Filter to orders for this sales agent (exact match). */
  agent?: string;
  /** Keep orders that contain this product / design on any line (exact match,
   *  values come from {@link OrderFilterOptions}). */
  product?: string;
  design?: string;
  /** Read `product` as a BASE item name — it then also matches that base's
   *  design variants ("12 MALBORO" brings in "12 MALBORO DL+LOGO"). Set by the
   *  screens whose picker lists {@link OrderFilterOptions.productBases}; left
   *  off where the picker lists full names and a pick means just that item. */
  productBase?: boolean;
  /** Exact match on the order's numeric id (the Order ID picker). */
  orderId?: number;
};
export type OrderList = Paginated<OrderDto>;

/** Distinct customer / agent / product / design values present on orders, for the
 *  Orders and Order Modify page filters. */
export interface OrderFilterOptions {
  customers: string[];
  agents: string[];
  products: string[];
  /** The same items with their design suffix dropped — "12 MALBORO DL+LOGO"
   *  and its siblings collapse to "12 MALBORO". Backs the shorter, typeable
   *  item picker on Order Modify; pair it with {@link OrderQuery.productBase}. */
  productBases: string[];
  designs: string[];
  /** Every non-draft order's id + code, newest first — backs the Order ID filter
   *  picker on Order Modify. */
  orders: { id: number; code: string | null }[];
}

/** A product available to order, with its master category/sub-category and rate. */
export interface OrderProductLite {
  product: string;
  category: string;
  subCategory: string;
  rate: number | null;
}

/** A design available to order, with its category/sub-category, type and rate.
 *  `designName` is the human-readable name from the Design Names master (falls
 *  back to the design-type code when no name has been added). */
export interface OrderDesignLite {
  category: string;
  subCategory: string;
  designType: string;
  designName: string;
  rate: number | null;
  /** The master design types that make up this option. Base designs contain
   *  themselves; combinations contain every linked type. */
  componentDesignTypes: string[];
}

/**
 * A single "item name" choice for the order dropdown — mirrors the legacy app,
 * where each entry is a product on its own OR a product × design-type pairing.
 * The label shown is "{size|pcs} {product} {designType}". `designType` is null
 * for the plain-product entry.
 */
export interface OrderItemOption {
  product: string;
  category: string;
  subCategory: string;
  size: number | null;
  /** Pieces per box (Product.PCS) — used to auto-calc Box from entered Pcs. */
  pcs: number | null;
  /** Per-piece weight (Product.WEIGHT) — used to auto-calc Kgs from entered Pcs. */
  weight: number | null;
  designType: string | null;
  designName: string | null;
  productRate: number | null;
  designRate: number | null;
}

/** Dropdown sources for the order form. Products/designs carry their rates so the
 *  form can auto-fill product/design rate and filter design types by category. */
export interface OrderLookups {
  customers: { id: number; name: string; agentName: string | null; category: string | null }[];
  categories: string[];
  subCategories: string[];
  products: OrderProductLite[];
  designs: OrderDesignLite[];
  /** Composite item-name choices (product + optional design type), like the legacy combo. */
  items: OrderItemOption[];
  /** Every design-type → design-name pair from the Design Names master (a code may have several names). */
  designNames: { designType: string; designName: string }[];
  /** Per-category price calculation field (KGS / PCS). */
  categoryFields: CategoryFieldDto[];
}

/** One raw active product row (incl. size variants) — the ingredient the
 *  client uses to compose `OrderLookups.items` locally. */
export interface OrderProductRow {
  product: string;
  category: string;
  subCategory: string;
  size: number | null;
  pcs: number | null;
  weight: number | null;
  rate: number | null;
}

/** Wire shape of GET /orders/lookups. The composed `items` list (product ×
 *  design pairings) was ~6,600 rows and 94% of a 1.3 MB payload, so it is NOT
 *  sent — the client rebuilds it from productRows + designs + designNames. */
export interface OrderLookupsWire extends Omit<OrderLookups, 'items'> {
  productRows: OrderProductRow[];
}

/** The pricing/calculation unit for an order line. */
export type CalcField = 'KGS' | 'PCS';

/** Maps a product category to the price-calc field used for it. */
export interface CategoryFieldDto {
  category: string;
  field: CalcField;
}

/* ── Order journey timeline (View Orders → truck icon modal) ─────────────────
 * Ordered → dispatched (per line) → challaned, with dates for the animation. */

export interface OrderTimelineChallanRef {
  id: number;
  code: string;
  invDate: string;
  challanStatus: string;
}

export interface OrderTimelineDispatch {
  id: number;
  code: string | null;
  dispatchDate: string;
  bags: number | null;
  pcs: number | null;
  kgs: number | null;
  box: number | null;
  dispatchStatus: string;
  /** The (non-cancelled) challan this dispatch was billed on, if any. */
  challan: OrderTimelineChallanRef | null;
}

export interface OrderTimelineLine {
  orderItemId: number;
  productName: string | null;
  designType: string | null;
  status: string;
  bags: number | null;
  pcs: number | null;
  kgs: number | null;
  box: number | null;
  calField: string | null;
  fullyDispatched: boolean;
  dispatches: OrderTimelineDispatch[];
}

export interface OrderTimeline {
  orderId: number;
  code: string;
  customerName: string;
  orderDate: string;
  completionDate: string | null;
  status: string;
  lines: OrderTimelineLine[];
}

/**
 * Order Modify's item-change rate check: "would the newly-picked item have
 * priced differently as of this order's own date?" — reuses Bag Bookings'
 * as-of-date pricing (see {@link BookingQuoteLine}), anchored on `asOfDate`
 * instead of a booking date, with no frozen special-rate snapshot to draw on
 * (a plain order never has one — both sides use the customer's CURRENT rates).
 */
export interface PriceAsOfInput {
  customerId?: number | null;
  asOfDate: string;
  pCategory?: string | null;
  subCategory?: string | null;
  product?: string | null;
  designType?: string | null;
  psize?: number | null;
}

/* ── "Does this line carry a real design?" ────────────────────────────────────
 * Every screen used to inline `x && x.toUpperCase() !== 'NA'`, which missed two
 * things and caused the reference-photo rule to silently skip design items:
 *
 *  1. The blank marker is not always exactly "NA". Legacy Access data also uses
 *     "N/A", "NONE", "NIL", "-" and friends for "no design".
 *  2. There are TWO data shapes for where the design lives. Native rows put the
 *     chosen design in `design` and its code in `designType`. Imported rows put
 *     the code in `design` (mirroring the productName suffix) and leave
 *     `designType` as "NA". Reading only `designType` therefore reports "no
 *     design" for ~40% of lines that genuinely have one — e.g.
 *     "5 RAMPATRA DL+LOGO" came back as undesigned and skipped its photo.
 *
 * Resolve through both fields, treating the full placeholder set as blank.
 */
const DESIGN_PLACEHOLDERS = new Set(['', 'NA', 'N/A', 'N.A.', 'N.A', 'NONE', 'NIL', '-', '--']);

/** True when a design field holds an actual design rather than a "none" marker. */
export function isRealDesign(value: string | null | undefined): boolean {
  return !DESIGN_PLACEHOLDERS.has((value ?? '').trim().toUpperCase());
}

/**
 * The line's actual design, or null when it genuinely has none. Prefers
 * `designType` (the code) and falls back to `design`, so both the native and the
 * imported shape resolve correctly.
 */
export function resolveLineDesign(line: { design?: string | null; designType?: string | null }): string | null {
  const type = (line.designType ?? '').trim();
  if (isRealDesign(type)) return type.toUpperCase();
  const name = (line.design ?? '').trim();
  if (isRealDesign(name)) return name.toUpperCase();
  return null;
}

/** True when the line carries a design of any kind. */
export const lineHasDesign = (line: { design?: string | null; designType?: string | null }): boolean =>
  resolveLineDesign(line) !== null;

/** Design parts that are just the customer's logo stamped on — nothing about
 *  the piece's shape or finish, so there is no craftsmanship to photograph. */
const LOGO_PARTS = new Set(['LOGO']);

/**
 * True when the line's design is NOTHING BUT a logo — "15 MALBORO LOGO".
 *
 * Both columns are considered and combinations are split on "+", so a single
 * other part anywhere makes it false: "DL" and "DL+LOGO" are real designs that
 * still have to be photographed, and only "LOGO" on its own is not. A
 * decorative design NAME ("ZEBRA") counts as a part too, so a logo type
 * carrying a named design is not waved through either — when in doubt this
 * errs towards asking for the photo.
 */
export function isLogoOnlyDesign(line: { design?: string | null; designType?: string | null }): boolean {
  const parts = [line.designType, line.design]
    .flatMap((v) => (v ?? '').split('+'))
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s !== '' && isRealDesign(s));
  return parts.length > 0 && parts.every((p) => LOGO_PARTS.has(p));
}

/**
 * Does this line fall under the reference-photo rule?
 *
 * The single answer used by both photo checks (a saved dispatch line and a
 * not-yet-created order line), so the New Order form and the Dispatch screen
 * can never disagree about which lines need documenting.
 */
export const lineNeedsReferencePhoto = (line: { design?: string | null; designType?: string | null }): boolean =>
  lineHasDesign(line) && !isLogoOnlyDesign(line);

/**
 * The line's design TYPE specifically — the priced thing in the Design master
 * (e.g. "WL+LOGO"), never a decorative design NAME ("ZEBRA", "GUCCI") and never
 * a combination.
 *
 * This is narrower than {@link resolveLineDesign} on purpose. That one answers
 * "does this line have any design at all?", so falling back to `design` is right
 * there — for the photo rule a name is as good as a type. But `design` holds a
 * TYPE only on imported rows; on rows entered here it holds the NAME. Reading it
 * blindly is what put 25 design names into Design Track's picker.
 *
 * `knownTypes` is the Design master's own set of types (upper-cased), which is
 * what makes the two shapes separable: a `design` value is only accepted as a
 * type when the master actually knows it as one.
 */
export function resolveLineDesignType(
  line: { design?: string | null; designType?: string | null },
  knownTypes: ReadonlySet<string>,
): string | null {
  const type = (line.designType ?? '').trim().toUpperCase();
  if (isRealDesign(type)) return type;
  const fallback = (line.design ?? '').trim().toUpperCase();
  if (isRealDesign(fallback) && knownTypes.has(fallback)) return fallback;
  return null;
}

/**
 * The line's design TYPE and NAME, told apart even on the awkward middle shape.
 *
 * Order lines carry the design in three shapes, depending on how they were made:
 *
 *     design=TYPE, designType="NA"     imported, no name ever chosen
 *     design=TYPE, designType=NAME     imported, a name chosen later
 *     design=NAME, designType=TYPE     entered in this app
 *
 * {@link resolveLineDesignType} reads `designType` first, so on the middle shape
 * it hands back the NAME as if it were the type — which is how "X BINDI" and
 * "GUCCI" end up offered as design types in a picker. The tell is the product
 * name: the composite is built as "<size> <product> <type>", so when it ENDS
 * with the `design` value, that value is the type and `designType` is the name.
 *
 * Kept separate from `resolveLineDesignType` rather than folded into it, because
 * that one also decides the reference-photo rules, where a name counts as good
 * as a type — see {@link lineNeedsReferencePhoto}.
 */
export function resolveLineDesignParts(
  line: { design?: string | null; designType?: string | null; productName?: string | null },
  knownTypes: ReadonlySet<string>,
): { type: string | null; name: string | null } {
  const design = (line.design ?? '').trim();
  const productName = (line.productName ?? '').toUpperCase();
  const type =
    design && isRealDesign(design) && productName.endsWith(` ${design.toUpperCase()}`)
      ? design.toUpperCase()
      : resolveLineDesignType(line, knownTypes);

  // Never let the name echo the type: on the first shape above, `designType` is
  // a placeholder, and on imported rows it can be the very same string.
  const named = (line.designType ?? '').trim();
  const name = isRealDesign(named) && named.toUpperCase() !== (type ?? '') ? named : null;
  return { type, name };
}
