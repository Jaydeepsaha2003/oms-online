/**
 * Design Track (Dispatch → Design Track)
 * --------------------------------------
 * Pending order lines narrowed to the design types the business is tracking,
 * with a manually-entered processed quantity ("Kalwat") per line.
 *
 * Which design types appear is a global choice made in Settings — the point of
 * the screen is to watch a handful of designs currently being worked, not every
 * design in the catalog.
 */
import type { Paginated, PaginationQuery } from './common';

export interface DesignTrackRow {
  /** The order line this row tracks — also the Kalwat entry's key. */
  orderItemId: number;
  orderId: number;
  orderCode: string | null;
  orderDate: string;
  customerName: string;
  productName: string | null;
  /** The tracked design type this line matched. */
  designType: string | null;
  /** Bags ORDERED on the line — the figure Remaining is measured against. */
  bags: number;
  comment: string | null;
  /** Processed so far, typed in by hand. Null = nothing entered yet. */
  kalwat: number | null;
  /** Always `bags - (kalwat ?? 0)`; derived server-side so the grid, the Excel
   *  export and any future consumer can't drift apart. Negative means more was
   *  entered than was ordered — usually a typo, and shown as such. */
  remaining: number;
}

export interface DesignTrackQuery extends PaginationQuery {
  customer?: string;
  product?: string;
  /** One tracked design type, or omitted for all of them. */
  design?: string;
}

export type DesignTrackList = Paginated<DesignTrackRow>;

/** Dropdown values for the Design Track filters, cascaded like the other grids. */
export interface DesignTrackFilterOptions {
  customers: string[];
  products: string[];
  /** Tracked design types that actually appear in the current pool. */
  designs: string[];
}

export interface SetKalwatInput {
  /** Null clears the entry (back to "nothing processed yet"). */
  kalwat: number | null;
}

/**
 * The design types Design Track is allowed to show, chosen in Settings.
 * `available` is every distinct design type currently on a pending order line —
 * the pick-list. Empty `selected` means nothing is tracked yet, so the grid is
 * deliberately empty rather than showing all designs.
 */
export interface DesignTrackTypesDto {
  selected: string[];
  available: string[];
}

export interface DesignTrackTypesInput {
  selected: string[];
}
