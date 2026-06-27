/** Dispatch (shipment) shapes. A dispatch is a partial/full shipment of an order
 *  line; a line's pending qty = ordered − Σ(dispatched). */

import type { Paginated, PaginationQuery } from './common';

export const DISPATCH_STATUSES = ['PARTIALLY DISPATCH', 'FULLY DISPATCH'] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

/** An order line with its still-to-dispatch (remaining) quantities. */
export interface PendingLineDto {
  orderItemId: number;
  orderId: number;
  orderCode: string | null;
  orderDate: string;
  dueDate: string | null;
  /** 'Over Due' (past the due date) or 'Due'. */
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
}

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
  dispatchStatus: DispatchStatus;
  dispatchDate: string;
  comment: string | null;
  supItem: string | null;
  userName: string | null;
  createdAt: string;
  updatedAt: string;
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
  product?: string;
  design?: string;
};
/** Distinct values present in dispatch records, for the Modify Dispatch filters. */
export interface DispatchFilterOptions {
  customers: string[];
  products: string[];
  designs: string[];
}
export type DispatchList = Paginated<DispatchDto>;
export type PendingQuery = PaginationQuery & { dueType?: string; unit?: string };
export type PendingList = Paginated<PendingLineDto>;
