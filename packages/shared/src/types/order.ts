/** Sales order shapes: a header (customer + dates) with many line items. */

import type { Paginated, PaginationQuery } from './common';

export const ORDER_PRIORITIES = ['NORMAL', 'URGENT'] as const;
export const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderItemDto {
  id: number;
  pCategory: string | null;
  subCategory: string | null;
  product: string | null;
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
}

export interface OrderDto {
  id: number;
  code: string | null;
  poNumber: string | null;
  customerId: number | null;
  customerName: string;
  agentName: string | null;
  category: string | null;
  orderDate: string;
  completionDate: string | null;
  completionDay: number | null;
  priority: string | null;
  status: string;
  ordType: string;
  comment: string | null;
  userName: string | null;
  items: OrderItemDto[];
  /** Convenience aggregates for list views. */
  itemCount: number;
  /** Sum of line rates (productRate + designRate). */
  totalRate: number;
  /** Sum of line amounts: rate × quantity (Kgs or Pcs per the line's calc field). */
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItemInput {
  /** Present for existing lines so the server updates them in place (preserving dispatches). */
  id?: number | null;
  pCategory?: string | null;
  subCategory?: string | null;
  product?: string | null;
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

export type OrderQuery = PaginationQuery & { status?: string };
export type OrderList = Paginated<OrderDto>;

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

/** The pricing/calculation unit for an order line. */
export type CalcField = 'KGS' | 'PCS';

/** Maps a product category to the price-calc field used for it. */
export interface CategoryFieldDto {
  category: string;
  field: CalcField;
}
