/** Quotation shapes — mirror orders so the order form/UI can be reused. */

import type { Paginated, PaginationQuery } from './common';
import type { OrderItemDto, OrderInput } from './order';

export const QUOTATION_STATUSES = ['DRAFT', 'SENT', 'CONVERTED', 'CANCELLED'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export interface QuotationDto {
  id: number;
  code: string | null;
  poNumber: string | null;
  customerId: number | null;
  customerName: string;
  /** Customer's city/state/region, joined for display on the printable bill.
   *  Only populated on the single-quotation fetch, not list views. */
  billingAddress?: string | null;
  agentName: string | null;
  category: string | null;
  /** Quotation date — named `orderDate` so the shared order form maps 1:1. */
  orderDate: string;
  completionDate: string | null;
  completionDay: number | null;
  priority: string | null;
  status: QuotationStatus;
  ordType: string;
  comment: string | null;
  userName: string | null;
  items: OrderItemDto[];
  itemCount: number;
  totalRate: number;
  /** Sum of line amounts: rate × quantity (Kgs or Pcs per the line's calc field). */
  totalAmount: number;
  /** "Sent to customer" tracking. */
  sentAt: string | null;
  sentByName: string | null;
  /** Conversion tracking. */
  convertedOrderId: number | null;
  convertedOrderCode: string | null;
  convertedAt: string | null;
  /** How it was converted: 'DIRECT' or 'EDITED'. */
  convertMode: string | null;
  /** Cancellation tracking (for analysis). */
  cancelReason: string | null;
  cancelNote: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Create/update payload — identical to an order's, so the form payload is reused. */
export type QuotationInput = OrderInput;

export interface CancelQuotationInput {
  reason: string;
  note?: string | null;
}

export interface ConvertQuotationInput {
  /** 'DIRECT' (convert as-is) or 'EDITED' (changed before converting). */
  mode?: 'DIRECT' | 'EDITED';
}

export type QuotationQuery = PaginationQuery & { status?: string };
export type QuotationList = Paginated<QuotationDto>;
