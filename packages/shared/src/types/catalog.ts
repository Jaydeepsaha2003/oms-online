/** Catalog shapes: products, designs, design names and combinations. */

import type { Paginated, PaginationQuery } from './common';
import type { CategoryFieldDto } from './order';

export interface ProductDto {
  id: number;
  code: string | null;
  category: string;
  subCategory: string;
  product: string;
  size: number | null;
  weight: number | null;
  pcs: number | null;
  rate: number | null;
  /** Inactive products are hidden from the order item pickers (kept for the record). */
  active: boolean;
  /** Whether this product is shown on the customer Rate List. */
  showOnRateList: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  category: string;
  subCategory: string;
  product: string;
  size?: number | null;
  weight?: number | null;
  pcs?: number | null;
  rate?: number | null;
  active?: boolean;
  showOnRateList?: boolean;
}

/** Quick partial update of a catalog item's active / rate-list flags (inline toggle). */
export interface CatalogFlagsInput {
  active?: boolean;
  showOnRateList?: boolean;
}

/** Same flags, applied to a whole bulk row-selection at once. */
export interface BulkCatalogFlagsInput extends CatalogFlagsInput {
  ids: number[];
}

export interface BulkCatalogFlagsResult {
  updated: number;
}

export interface DesignDto {
  id: number;
  code: string | null;
  category: string;
  subCategory: string;
  designType: string;
  cost: number | null;
  rate: number | null;
  /** Inactive designs are hidden from the order item pickers (kept for the record). */
  active: boolean;
  /** Whether this design is shown on the customer Rate List. */
  showOnRateList: boolean;
  /** Names of every Combination this design is a component of — empty means
   *  it's used standalone, never combined with another design. */
  combinationNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DesignInput {
  category: string;
  subCategory: string;
  designType: string;
  cost?: number | null;
  rate?: number | null;
  active?: boolean;
  showOnRateList?: boolean;
}

export interface DesignNameDto {
  id: number;
  designType: string;
  designName: string;
  /** Reference photo so the right design is recognisable at a glance. */
  photoPath?: string | null;
  photoUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesignNameInput {
  designType: string;
  designName: string;
  photoPath?: string | null;
  photoUrl?: string | null;
}

/** A design that is part of a combination (with its own cost/rate). */
export interface CombinationDesignLite {
  id: number;
  code: string | null;
  category: string;
  subCategory: string;
  designType: string;
  cost: number | null;
  rate: number | null;
}

export interface CombinationDto {
  id: number;
  code: string | null;
  /** Auto-built from the component design types (e.g. "DL + LOGO"); editable. */
  name: string;
  /** Distinct category / sub-category of the component designs (comma-joined when mixed). */
  category: string;
  subCategory: string;
  designs: CombinationDesignLite[];
  /** Live sum of the component designs' cost / rate. */
  cost: number;
  rate: number;
  createdAt: string;
  updatedAt: string;
}

/** Create/update a combination from a set of designs. */
export interface CombinationInput {
  name?: string | null;
  designIds: number[];
}

/** Existing distinct values to populate the product form's category dropdowns.
 *  `subCategories` is every distinct (category, sub-category) PAIR that actually
 *  exists, not a flat list — so a sub-category dropdown can be filtered down to
 *  just the ones under the currently-selected category. */
export interface ProductLookups {
  categories: string[];
  subCategories: { category: string; subCategory: string }[];
  /** Per-category price calculation field (KGS / PCS). */
  categoryFields: CategoryFieldDto[];
}

/** Existing distinct values to populate the design form's category dropdowns.
 *  `subCategories` is every distinct (category, sub-category) pair — see
 *  {@link ProductLookups} for why this isn't a flat list. */
export interface DesignLookups {
  categories: string[];
  subCategories: { category: string; subCategory: string }[];
}

export type ProductQuery = PaginationQuery & {
  /** Exact-match list filters (Products page dropdowns). */
  category?: string;
  subCategory?: string;
};
export type DesignQuery = PaginationQuery & {
  /** Exact-match list filters (Designs page dropdowns). */
  category?: string;
  subCategory?: string;
  /** standalone = used in no combination; combined = used in at least one. */
  combinationStatus?: 'standalone' | 'combined';
};
export type DesignNameQuery = PaginationQuery;
export type CombinationQuery = PaginationQuery & {
  /** Exact-match list filters (Combinations grid dropdowns). */
  category?: string;
  subCategory?: string;
};

export type ProductList = Paginated<ProductDto>;
export type DesignList = Paginated<DesignDto>;
export type DesignNameList = Paginated<DesignNameDto>;
export type CombinationList = Paginated<CombinationDto>;

/** One recorded edit to a product — what the Recent Changes view lists (§6.1). */
export interface ProductChangeEntry {
  id: number;
  productId: number | null;
  productName: string;
  /** CREATED / UPDATED / DELETED. */
  kind: string;
  /** Human field label, '' for whole-row events. */
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedByName: string | null;
  changedAt: string;
}
