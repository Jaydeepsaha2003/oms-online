/**
 * Bag Bookings
 * ------------
 * A customer reserves quantity ("book 1 bag, 70 kg") without naming the items.
 * The rate basis is frozen at the **booking date**: whenever the booking is later
 * converted into real order lines (in parts, over months), each converted item is
 * priced at the customer's *effective chart rate as of the booking date* — not the
 * conversion date. Every product/design/special-rate change is tracked (see
 * {@link RateChangeEntry}) so a past rate can always be reproduced.
 */

import type { Paginated, PaginationQuery } from './common';

/** Lifecycle of a booking as it is drawn down by conversions. */
export const BOOKING_STATUSES = ['OPEN', 'PARTIALLY_CONVERTED', 'CONVERTED', 'CANCELLED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface BookingDto {
  id: number;
  code: string;
  customerId: number | null;
  customerName: string;
  agentName: string | null;
  category: string | null;
  /** The rate-basis date — converted items are priced as of this date. */
  bookingDate: string;
  bags: number;
  kgs: number;
  convertedBags: number;
  convertedKgs: number;
  /** bags - convertedBags (never below 0). */
  remainingBags: number;
  /** kgs - convertedKgs (never below 0). */
  remainingKgs: number;
  status: BookingStatus;
  comment: string | null;
  orderId: number | null;
  /** Code of the order holding the converted lines, once one exists. */
  orderCode: string | null;
  userName: string | null;
  conversions: BookingConversionDto[];
  createdAt: string;
  updatedAt: string;
}

export interface BookingConversionDto {
  id: number;
  bookingId: number;
  orderItemId: number | null;
  productName: string | null;
  designType: string | null;
  bags: number | null;
  kgs: number | null;
  pcs: number | null;
  box: number | null;
  frozenRate: number | null;
  amount: number | null;
  convertedByName: string | null;
  convertedAt: string;
}

/** Create a booking (no items yet — just reserved bags/kgs). */
export interface CreateBookingInput {
  customerName: string;
  agentName?: string | null;
  category?: string | null;
  /** Defaults to today on the server; this is the rate-basis date. */
  bookingDate?: string | null;
  bags: number;
  kgs: number;
  comment?: string | null;
}

export interface UpdateBookingInput {
  customerName?: string;
  agentName?: string | null;
  category?: string | null;
  bookingDate?: string | null;
  bags?: number;
  kgs?: number;
  comment?: string | null;
}

/** One line the user wants to convert from a booking into a real order item. */
export interface ConvertBookingLineInput {
  /** Item identity — same shape the order form produces. */
  pCategory?: string | null;
  subCategory?: string | null;
  product?: string | null;
  design?: string | null;
  productName?: string | null;
  designType?: string | null;
  psize?: number | null;
  bags?: number | null;
  pcs?: number | null;
  /** Kgs (stored as `gram` on the order line, mirroring the order form). */
  gram?: number | null;
  box?: number | null;
  calField?: string | null;
  comment?: string | null;
}

export interface ConvertBookingInput {
  lines: ConvertBookingLineInput[];
}

/** A priced preview of one convertible line, using booking-date rates. */
export interface BookingQuoteLine {
  productName: string | null;
  designType: string | null;
  /** Base product chart rate as of the booking date. */
  productRate: number;
  /** Base design rate as of the booking date. */
  designRate: number;
  /** Customer special-rate delta (product) captured at booking. */
  productDelta: number;
  /** Customer special-rate delta (design) captured at booking. */
  designDelta: number;
  /** productRate + designRate + productDelta + designDelta (frozen booking-date price). */
  rate: number;
  /** Current (latest) base product chart rate — may differ if the price changed since booking. */
  currentProductRate: number;
  /** Current (latest) base design chart rate. */
  currentDesignRate: number;
  /** currentProductRate + currentDesignRate + the (frozen) special deltas. */
  currentRate: number;
  /** True when the latest price differs from the frozen booking-date price. */
  priceChanged: boolean;
  /** Where each delta came from (for display). */
  productFrom: string | null;
  designFrom: string | null;
}

export type BookingQuoteInput = ConvertBookingInput;
export interface BookingQuoteResult {
  bookingDate: string;
  lines: BookingQuoteLine[];
}

export type BookingQuery = PaginationQuery & {
  status?: string;
  customer?: string;
};
export type BookingList = Paginated<BookingDto>;

/* ── Price-change history (products / designs / customer special rates) ───────── */

export type RateHistoryKind = 'PRODUCT' | 'DESIGN' | 'CUSTOMER';

/** One old→new rate change, unified across products, designs and special rates. */
export interface RateChangeEntry {
  id: number;
  kind: RateHistoryKind;
  /** Product name / design type / customer name depending on `kind`. */
  name: string;
  category: string;
  subCategory: string;
  /** For CUSTOMER rows: PRODUCT or DESIGN special rate; else null. */
  rateKind: string | null;
  /** For CUSTOMER rows: the scope (CATEGORY/SUBCATEGORY/ITEM); else null. */
  scope: string | null;
  /** For CUSTOMER rows: the specific product/design target; else null. */
  target: string | null;
  oldRate: number | null;
  newRate: number | null;
  changedByName: string | null;
  changedAt: string;
}

export type PriceHistoryQuery = PaginationQuery & {
  kind?: RateHistoryKind;
};
export type PriceHistoryList = Paginated<RateChangeEntry>;
