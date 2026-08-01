/**
 * Universal approvals
 * -------------------
 * Anything a user isn't allowed to do outright becomes an ApprovalRequest instead
 * of a half-finished record. The pending action is kept as a JSON payload and is
 * only replayed against the real tables when an admin approves it, so the rest of
 * the system never has to filter out "not yet approved" rows.
 *
 * Adding a new kind of approval: add a `type` below, give it a payload interface,
 * and register a handler on the API side. No schema migration is needed.
 */

export const APPROVAL_TYPES = ['DISPATCH_BACKDATE', 'DISPATCH_DATE_CHANGE'] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Human labels for the inbox filter pills. */
export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  DISPATCH_BACKDATE: 'Back-dated dispatch',
  DISPATCH_DATE_CHANGE: 'Dispatch date change',
};

export interface ApprovalRequestDto {
  id: number;
  code: string | null;
  type: string;
  /** Falls back to the raw `type` for a kind this build doesn't know about. */
  typeLabel: string;
  status: ApprovalStatus;
  title: string;
  summary: string | null;
  /** Parsed payload; shape depends on `type`. */
  payload: Record<string, unknown>;
  entity: string | null;
  entityId: number | null;
  requestedByName: string | null;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  resultId: number | null;
}

export interface ApprovalListResult {
  items: ApprovalRequestDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Pending count across ALL types, for the sidebar badge (ignores filters). */
  pendingTotal: number;
}

export interface ApprovalQuery {
  page?: number;
  pageSize?: number;
  status?: ApprovalStatus | 'ALL';
  type?: string;
  search?: string;
}

/** Approver's decision. `note` is required when rejecting so the requester knows why. */
export interface ApprovalDecisionInput {
  note?: string;
}

/**
 * Payload for {@link APPROVAL_TYPES} `DISPATCH_BACKDATE` — everything needed to
 * create the dispatch later, exactly as the requester submitted it.
 */
export interface DispatchBackdatePayload {
  orderItemId: number;
  dispatchStatus: string;
  bags?: number | null;
  pcs?: number | null;
  gram?: number | null;
  box?: number | null;
  comment?: string | null;
  supItem?: string | null;
  /** The requested (non-today) dispatch date, ISO. */
  dispatchDate: string;
  /** Snapshot for display in the inbox, so it reads without extra lookups. */
  customerName?: string | null;
  orderCode?: string | null;
  productName?: string | null;
  /** Who asked. Carried in the payload so the created Dispatch is stamped with the
   *  requester, not with whoever happened to approve it. */
  requestedByName?: string | null;
}

/**
 * Payload for `DISPATCH_DATE_CHANGE` — moving an EXISTING dispatch to another
 * date. Without this, Modify Dispatch would be a free bypass of the back-date
 * gate on the Dispatch form.
 */
export interface DispatchDateChangePayload {
  dispatchId: number;
  /** The requested new date, ISO. */
  dispatchDate: string;
  /** The date it currently sits on, for the inbox to show the before/after. */
  currentDate: string;
  customerName?: string | null;
  dispatchCode?: string | null;
  productName?: string | null;
  requestedByName?: string | null;
}
