/** Dispatch (shipment) shapes. A dispatch is a partial/full shipment of an order
 *  line; a line's pending qty = ordered − Σ(dispatched). */

import type { Paginated, PaginationQuery } from './common';

export const DISPATCH_STATUSES = ['PARTIALLY DISPATCH', 'FULLY DISPATCH'] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

/**
 * A dispatch row that gives quantity BACK, written when a credit note is saved
 * as "Undispatched". It carries NEGATIVE quantities against the same order line,
 * so `ordered − Σ dispatched` lifts the remaining quantity back up without the
 * original outward dispatch — a real event, referenced by a challan — being
 * edited or deleted.
 *
 * Deliberately NOT in {@link DISPATCH_STATUSES}: it is not a status a user can
 * choose when dispatching, only one the system writes.
 */
export const RETURNED_DISPATCH_STATUS = 'RETURNED';

/** One return event linking a credit note to the dispatch it gave back. */
export interface DispatchReturnRef {
  /** The reversing dispatch row (negative quantities). */
  returnDispatchId: number;
  /** The outward dispatch the quantity came off. */
  dispatchId: number | null;
  /** Credit note that recorded the return, e.g. "CN/7". */
  creditNoteCode: string;
  creditNoteDate: string;
  /** Quantity returned, as positive figures. */
  bags: number | null;
  pcs: number | null;
  kgs: number | null;
  box: number | null;
}

/** Columns offered by the pending-dispatch Excel export, in the order they're
 *  written to the sheet. Shared so the "which columns?" picker on the frontend
 *  and the xlsx builder on the backend can never drift apart. */
export const DISPATCH_EXPORT_COLUMNS = [
  { id: 'orderNo', header: 'Order #' },
  { id: 'orderDate', header: 'Order Date' },
  { id: 'dueDate', header: 'Due Date' },
  { id: 'due', header: 'Due' },
  { id: 'customer', header: 'Customer' },
  { id: 'product', header: 'Product' },
  { id: 'design', header: 'Design' },
  { id: 'subCategory', header: 'Sub Category' },
  { id: 'priority', header: 'Priority' },
  { id: 'bags', header: 'Bags' },
  { id: 'pcs', header: 'Pcs' },
  { id: 'kgs', header: 'Kgs' },
  { id: 'box', header: 'Box' },
  { id: 'productRate', header: 'Product ₹' },
  { id: 'designRate', header: 'Design ₹' },
  { id: 'rate', header: 'Rate ₹' },
  { id: 'amount', header: 'Pending ₹' },
  { id: 'comment', header: 'Comment' },
] as const;
export type DispatchExportColumnId = (typeof DISPATCH_EXPORT_COLUMNS)[number]['id'];

/** The ₹ columns above. Offered/written only for users with
 *  `dispatch:viewrates` — same gate the on-screen rate columns use. */
export const DISPATCH_RATE_EXPORT_COLUMN_IDS: readonly string[] = ['productRate', 'designRate', 'rate', 'amount'];

/** An order line with its still-to-dispatch (remaining) quantities. */
export interface PendingLineDto {
  orderItemId: number;
  orderId: number;
  orderCode: string | null;
  orderDate: string;
  dueDate: string | null;
  /** Where this line sits in its completion window: 'Due' (first half), 'Past
   *  Due' (second half), or 'Over Due' (past the actual due date). See
   *  DispatchService.dueBucket. */
  dueType: string;
  customerId: number | null;
  customerName: string;
  agentName: string | null;
  category: string | null;
  pCategory: string | null;
  subCategory: string | null;
  product: string | null;
  productName: string | null;
  designType: string | null;
  psize: number | null;
  priority: string | null;
  calField: string | null;
  ordType: string | null;
  productRate: number | null;
  designRate: number | null;
  rate: number | null;
  comment: string | null;
  /** Ordered quantities. */
  bags: number;
  pcs: number;
  kgs: number;
  box: number;
  /** Remaining (still to dispatch) quantities. */
  remBags: number;
  remPcs: number;
  remKgs: number;
  remBox: number;
  /** True when this line already has an open back-date approval request — lets
   *  the pending list show "Pending approval" instead of looking untouched. */
  hasPendingApproval?: boolean;
  /** Name of whoever currently has this line's dispatch dialog open (see
   *  DispatchService's in-memory line lock), so other users see it's taken
   *  before they even try to open it. Null/absent = free to open. */
  lockedByName?: string | null;
  /** How many reference photos this line already has. Counted server-side per
   *  page so a mobile card can offer "view photos" without each card firing its
   *  own request. 0 = nothing attached yet. */
  photoCount?: number;
}

/**
 * Whether this party + item + design combination has ever been documented
 * with a reference photo — checked before a dispatch is allowed to save (see
 * DispatchController.photoCheck). `hasPhoto` is true when either a PRIOR
 * dispatched line of the same customer + product + design has a photo on
 * file, or this exact line already has one attached.
 */
export interface DispatchPhotoCheckDto {
  hasPhoto: boolean;
  /** True when the photo came from an earlier dispatched line (not this one). */
  fromHistory: boolean;
  /** A representative photo URL to show as proof, when one exists. */
  sampleUrl: string | null;
  /**
   * Does this line carry a design, and therefore fall under the reference-photo
   * rule at all? Resolved server-side (see `resolveLineDesign`) because the
   * design can live in either of two columns depending on whether the line was
   * entered here or imported — the client used to guess from one of them and got
   * it wrong for every imported line.
   */
  needsPhoto: boolean;
}

/**
 * The same question as {@link DispatchPhotoCheckDto}, asked for lines that do
 * NOT exist in the database yet — the New Order form, where "Create & Dispatch"
 * would otherwise ship a designed line with no reference photo on file and no
 * way to notice until it was too late.
 *
 * Sent as one batch per form rather than a request per line: an order is
 * commonly ten-plus lines, and the answer is only needed all together (the
 * button is gated on the whole set).
 */
export interface DraftPhotoCheckLine {
  /** Echoed back untouched so the client can match answers to its own rows. */
  key: string;
  product: string | null;
  psize: number | null;
  designType: string | null;
  design: string | null;
}

export interface DraftPhotoCheckInput {
  customerId: number | null;
  lines: DraftPhotoCheckLine[];
}

export type DraftPhotoCheckResult = Record<string, DispatchPhotoCheckDto>;

export interface DispatchDto {
  id: number;
  code: string | null;
  orderItemId: number;
  orderId: number;
  orderCode: string | null;
  customerId: number | null;
  customerName: string;
  agentName: string | null;
  category: string | null;
  pCategory: string | null;
  subCategory: string | null;
  product: string | null;
  productName: string | null;
  designType: string | null;
  psize: number | null;
  priority: string | null;
  calField: string | null;
  ordType: string | null;
  productRate: number | null;
  designRate: number | null;
  rate: number | null;
  bags: number | null;
  pcs: number | null;
  gram: number | null;
  box: number | null;
  /** Includes {@link RETURNED_DISPATCH_STATUS}, which the system writes but no
   *  user can choose — hence wider here than on the create/update input. */
  dispatchStatus: DispatchStatus | typeof RETURNED_DISPATCH_STATUS;
  dispatchDate: string;
  comment: string | null;
  supItem: string | null;
  userName: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * The challan (tax invoice) this dispatch has been billed on, or null while it
   * is still pending challan. A dispatch billed on both an invoice and a later
   * debit note reports the invoice — see DispatchService.challanByDispatch.
   */
  challanId: number | null;
  challanCode: string | null;
  challanStatus: string | null;
  /**
   * Set when THIS row is a return (`dispatchStatus === RETURNED_DISPATCH_STATUS`):
   * the credit note that created it and the outward dispatch it reverses.
   */
  returnOf?: DispatchReturnRef | null;
  /**
   * Set on an OUTWARD dispatch that has since had quantity returned against it.
   * The history the Modify Dispatch row needs to explain why its line reopened.
   */
  returns?: DispatchReturnRef[];
}

export interface CreateDispatchInput {
  orderItemId: number;
  bags?: number | null;
  pcs?: number | null;
  gram?: number | null;
  box?: number | null;
  dispatchStatus: DispatchStatus;
  comment?: string | null;
  supItem?: string | null;
  dispatchDate?: string | null;
}

export interface UpdateDispatchInput {
  bags?: number | null;
  pcs?: number | null;
  gram?: number | null;
  box?: number | null;
  dispatchStatus?: DispatchStatus;
  comment?: string | null;
  supItem?: string | null;
  dispatchDate?: string | null;
}

export type DispatchQuery = PaginationQuery & {
  status?: string;
  /** Exact-match filters (values come from {@link DispatchFilterOptions}). */
  customer?: string;
  /** Product category (the line's `pCategory`) — same short GLASS / CUP / LOTI
   *  list Dispatch Order filters by, and the reason it sits above the item
   *  picker: choosing it cuts the item list to that category's names. */
  category?: string;
  product?: string;
  design?: string;
  agent?: string;
  /** Dispatch-date range (inclusive), 'YYYY-MM-DD'. */
  dateFrom?: string;
  dateTo?: string;
};
/** Distinct values present in dispatch records, for the Modify Dispatch filters.
 *  `categories` is populated for BOTH the pending pool (Dispatch Order) and the
 *  dispatch records (Modify Dispatch). `subCategories` remains pending-only —
 *  it is ~40 build codes like "10-PCS-FG-22G" that nobody picks an item by. */
export interface DispatchFilterOptions {
  customers: string[];
  /** Distinct sales agents present in dispatch records (Modify Dispatch filter). */
  agents?: string[];
  /** Distinct PRODUCT categories (GLASS / CUP / LOTI / …) — the line's `pCategory`,
   *  not the order-level `category`. A short list (single digits in practice),
   *  which is what makes it usable as a top-level filter above the product picker:
   *  choosing one cuts the product options down to that category's items. */
  categories?: string[];
  products: string[];
  /** Base product names (design suffix stripped, e.g. "15 Rajwadi") — the option
   *  set the Dispatch Order product picker shows when its "ALL" toggle is on, so a
   *  single pick matches every design variant. Only populated for the pending pool. */
  productBases?: string[];
  designs: string[];
  subCategories?: string[];
}
export type DispatchList = Paginated<DispatchDto>;

/**
 * Response for `POST /dispatch`. A dispatch dated anything other than today needs
 * `dispatch:approve` — without it the entry is parked in the Approvals inbox
 * instead of being created, so the caller has to branch on `status`.
 */
export type SubmitDispatchResult =
  | { status: 'CREATED'; dispatch: DispatchDto }
  | { status: 'PENDING_APPROVAL'; approvalCode: string };

/**
 * Response for `PATCH /dispatch/:id`. The edit always applies; a date MOVE only
 * applies immediately for an approver — otherwise `dateApprovalCode` is set and
 * the dispatch keeps its old date until that request is approved.
 */
export interface UpdateDispatchResult {
  dispatch: DispatchDto;
  dateApprovalCode?: string;
}
export type PendingQuery = PaginationQuery & {
  dueType?: string;
  unit?: string;
  /** Exact-match filters (values come from the pending-pool {@link DispatchFilterOptions}). */
  customer?: string;
  agent?: string;
  product?: string;
  design?: string;
  /** Product category (matched against the line's `pCategory`). */
  category?: string;
  subCategory?: string;
  /** "ALL" toggle (mirrors the legacy Form13 checkbox linked to SelectProduct):
   *  when true the `product` value is matched as a base-name prefix so every design
   *  variant is included; when false/omitted it's an exact match. */
  all?: boolean;
  /** Excel export only: comma-separated column ids to include (see
   *  `DISPATCH_EXPORT_COLUMNS`). Omitted/empty means every column. */
  columns?: string;
};
export type PendingList = Paginated<PendingLineDto>;
