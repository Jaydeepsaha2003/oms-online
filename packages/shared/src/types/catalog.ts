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

/**
 * Is this a BASE design, or is it already a combination of others?
 *
 * Design types are written as their parts joined with "+": "DL+LOGO" is the DL
 * design and the LOGO design together, and each of those also exists as its own
 * row. So a "+" in the name is what marks a composite — and a composite is
 * never a valid PART of a further combination, because "DL + DL+LOGO" names the
 * same design twice.
 *
 * This is why the Designs screen offers only base designs when asking which
 * combinations to build: of the 66 design rows under GLASS / 10-PCS-FG-22G only
 * 18 are real building blocks, and listing the other 48 alongside them is what
 * made the picker unusable.
 */
export function isBaseDesignType(designType: string | null | undefined): boolean {
  return !(designType ?? '').includes('+');
}

/**
 * One design type created across SEVERAL sub-categories at once.
 *
 * The same design ("AMBIENT") is normally sold in every sub-category of its
 * category, at the same cost and rate — so entering it once per sub-category is
 * the same form filled in a dozen times. One row is written per sub-category;
 * ones that already have this design type are skipped rather than erroring, so
 * re-running after a new sub-category is added is safe.
 */
export interface BulkDesignInput {
  category: string;
  subCategories: string[];
  designType: string;
  cost?: number | null;
  rate?: number | null;
  active?: boolean;
  showOnRateList?: boolean;
}

export interface BulkDesignResult {
  created: DesignDto[];
  /** Sub-categories that already carried this design type — left untouched. */
  skipped: string[];
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

/**
 * Several combinations in one request.
 *
 * Adding a design and then pairing it with each of its partners is one decision
 * that produces many combinations — "AMBIENT + DL", "AMBIENT + LOGO",
 * "AMBIENT + WL" — and across several sub-categories at that. Sending them one
 * at a time means a request per row and a partial result when one fails.
 *
 * A group whose exact design set already exists is SKIPPED, not duplicated:
 * re-opening the step after adding one more partner is the natural way to use
 * it, and a second identical combination would be nothing but noise.
 */
export interface BulkCombinationInput {
  groups: CombinationInput[];
}

export interface BulkCombinationResult {
  created: number;
  /** Groups whose design set already existed (or held fewer than two designs). */
  skipped: number;
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

/* ── Bulk chart-rate adjustment (Products → Bulk rate change) ──────────────── */

/** How the adjustment is expressed. */
export const RATE_ADJUST_MODES = ['AMOUNT', 'PERCENT'] as const;
export type RateAdjustMode = (typeof RATE_ADJUST_MODES)[number];

/**
 * "Put every GLASS rate up by ₹5" / "take 2.5% off 10-PCS-FG".
 *
 * `value` is SIGNED — negative lowers. A separate direction flag would let the
 * two disagree ("decrease by -5" is an increase), so the sign is the only place
 * direction lives; the UI's +/- buttons write the sign.
 */
export interface BulkRateChangeInput {
  category: string;
  /** Blank/omitted means the whole category. */
  subCategory?: string | null;
  mode: RateAdjustMode;
  value: number;
  /** Round each new rate to whole rupees. Off keeps 2 decimals. */
  roundToRupee?: boolean;
  /** Leave inactive products alone. Defaults to true — a withdrawn product's
   *  rate is history, and moving it silently rewrites that history. */
  activeOnly?: boolean;
}

/** One product the adjustment would touch. */
export interface BulkRatePreviewRow {
  id: number;
  product: string;
  subCategory: string;
  size: number | null;
  oldRate: number;
  newRate: number;
}

/**
 * What the change would do, before it does it.
 *
 * The counts matter as much as the rows: a bulk write over a category nobody
 * can see the end of needs to say what it will NOT touch, or the silence reads
 * as "nothing was skipped".
 */
export interface BulkRatePreview {
  /** Products matching the scope, whatever their rate. */
  matched: number;
  /** Of those, how many will actually be written. */
  willChange: number;
  /** Skipped: no chart rate set — adding to "no rate" would invent a price. */
  skippedNoRate: number;
  /** Skipped: the result would be negative. */
  skippedNegative: number;
  /** Skipped: rounding left the rate exactly as it was. */
  skippedUnchanged: number;
  /** Sample of the affected rows, capped — the counts above are the full truth. */
  rows: BulkRatePreviewRow[];
  /** True when `rows` was cut short. */
  truncated: boolean;
}

export interface BulkRateChangeResult {
  updated: number;
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
