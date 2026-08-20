/**
 * Product Photos (Products → Product Photos)
 * ------------------------------------------
 * A read-only gallery over every photo staff have uploaded against an order
 * line, browsable BY PARTY or BY ITEM.
 *
 * The photos already exist — they are attached to order lines from New Order,
 * Order Modify, Dispatch and Design Track — but until now the only way to see
 * one was to already know which line it hung off. That makes the useful
 * question unanswerable: "what have we made for this party before?" and "what
 * does this item actually look like?". This gallery answers both by grouping
 * the same rows the other direction.
 *
 * Nothing here writes. Uploading and deleting stay on the screens that own the
 * order line, so a photo can never be orphaned from the line it documents.
 */
import type { PaginationQuery } from './common';

/** How the gallery is sectioned. */
export const PHOTO_GROUP_BYS = ['PARTY', 'ITEM'] as const;
export type PhotoGroupBy = (typeof PHOTO_GROUP_BYS)[number];

/** One uploaded photo, carrying the context needed to caption it on its own. */
export interface ProductPhotoDto {
  id: number;
  url: string;
  filename: string | null;
  mimeType: string | null;
  /** Bytes, when the upload recorded it. */
  size: number | null;
  uploadedBy: string | null;
  /** ISO timestamp of the upload. */
  uploadedAt: string;
  /** The order line the photo hangs off — the way back to its source screen. */
  orderItemId: number;
  orderId: number;
  orderCode: string | null;
  /** ISO date of the order the line belongs to. */
  orderDate: string;
  customerId: number | null;
  customerName: string;
  /** Composite line name, e.g. "10 BREZZA WL+LOGO". */
  productName: string | null;
  /** The bare product, without size or design, e.g. "BREZZA". */
  product: string | null;
  designType: string | null;
  designName: string | null;
}

/** One section of the gallery — a party, or an item. */
export interface ProductPhotoGroupDto {
  /** Stable key for React and for "expand this section" state. */
  key: string;
  /** Section heading — the party name, or the item name. */
  label: string;
  /** A second line under the heading: the item count for a party group, the
   *  party count for an item group. Null when it would add nothing. */
  subLabel: string | null;
  /** Photos in this section, newest upload first. */
  photos: ProductPhotoDto[];
}

export interface ProductPhotoGalleryDto {
  groups: ProductPhotoGroupDto[];
  /** Photos matching the filters, across every page. */
  totalPhotos: number;
  /** Sections matching the filters, across every page. */
  totalGroups: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /**
   * True when the filters matched more photos than the server was willing to
   * group in one pass. Sections are complete up to that point; the UI says so
   * rather than quietly showing a subset as if it were everything.
   */
  truncated: boolean;
}

export interface ProductPhotoQuery extends PaginationQuery {
  /** Defaults to 'PARTY'. Pages count SECTIONS, not photos, so a party's
   *  photos are never split across two pages. */
  groupBy?: PhotoGroupBy;
  customer?: string;
  /** Matches the bare product name, so "BREZZA" finds every size of it. */
  product?: string;
  designType?: string;
  /** Free text over party, item, design, file name and uploader. */
  search?: string;
  /** Upload date window (yyyy-mm-dd, inclusive). */
  from?: string;
  to?: string;
}

/** Dropdown values, each cascaded off the OTHER active filters. */
export interface ProductPhotoFilterOptions {
  customers: string[];
  products: string[];
  designTypes: string[];
}
