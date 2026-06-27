/**
 * Customer "Special Rates" (legacy Form10).
 *
 * A special rate is a per-customer DELTA added on top of the base product/design
 * rate. The effective rate is resolved most-specific-first — ITEM → SUBCATEGORY →
 * CATEGORY — and only the first matching level applies (the cascade is wired into
 * order pricing in Phase 2). A logo restriction blocks the logo for a customer at
 * the category (or category + sub-category) level.
 */

import type { Paginated, PaginationQuery } from './common';

/** Which base rate a {@link CustomerRateDto} adjusts. */
export const RATE_KINDS = ['PRODUCT', 'DESIGN'] as const;
export type RateKind = (typeof RATE_KINDS)[number];

/** Specificity level of a rate override (most specific wins). */
export const RATE_SCOPES = ['CATEGORY', 'SUBCATEGORY', 'ITEM'] as const;
export type RateScope = (typeof RATE_SCOPES)[number];

/** Specificity level of a logo restriction. */
export const LOGO_SCOPES = ['CATEGORY', 'SUBCATEGORY'] as const;
export type LogoScope = (typeof LOGO_SCOPES)[number];

export interface CustomerRateDto {
  id: number;
  customerId: number;
  kind: RateKind;
  scope: RateScope;
  category: string;
  /** '' when scope = CATEGORY. */
  subCategory: string;
  /** Product name (PRODUCT) or design type (DESIGN); '' unless scope = ITEM. */
  target: string;
  /** Rate delta — may be negative. */
  rate: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerLogoDto {
  id: number;
  customerId: number;
  scope: LogoScope;
  category: string;
  /** '' when scope = CATEGORY. */
  subCategory: string;
  createdAt: string;
  updatedAt: string;
}

/** Upsert a rate override. `subCategory` required unless scope = CATEGORY;
 *  `target` required when scope = ITEM. */
export interface SaveCustomerRateInput {
  customerId: number;
  kind: RateKind;
  scope: RateScope;
  category: string;
  subCategory?: string | null;
  target?: string | null;
  rate: number;
}

/** Upsert a logo restriction. `subCategory` required when scope = SUBCATEGORY. */
export interface SaveCustomerLogoInput {
  customerId: number;
  scope: LogoScope;
  category: string;
  subCategory?: string | null;
}

/** Everything configured for one customer. */
export interface CustomerSpecialRates {
  rates: CustomerRateDto[];
  logos: CustomerLogoDto[];
}

/** Catalog values for the cascading category → sub-category → item dropdowns. */
export interface SpecialRateLookups {
  categories: string[];
  /** Distinct (category, sub-category) pairs. */
  subCategories: { category: string; subCategory: string }[];
  /** Distinct (category, sub-category, product) tuples. */
  products: { category: string; subCategory: string; product: string }[];
  /** Distinct (category, sub-category, designType) tuples. */
  designs: { category: string; subCategory: string; designType: string }[];
}

/* ── Master list (everyone's special rates in one filterable table) ──────────── */

/** A single row of the master list — a rate override OR a logo restriction,
 *  flattened with the owning customer's name + agent for cross-customer viewing. */
export interface SpecialRateMasterRow {
  /** Stable key for the table ('rate:<id>' / 'logo:<id>'). */
  rowKey: string;
  /** Which table the row came from (drives delete). */
  source: 'RATE' | 'LOGO';
  id: number;
  customerId: number;
  customerName: string;
  agentName: string | null;
  /** PRODUCT / DESIGN (a rate) or LOGO (a restriction). */
  type: RateKind | 'LOGO';
  scope: string;
  category: string;
  subCategory: string;
  target: string;
  /** Rate delta; null for a logo restriction. */
  rate: number | null;
}

export type SpecialRateMasterQuery = PaginationQuery & {
  customer?: string;
  agent?: string;
  type?: string;
  scope?: string;
  category?: string;
  subCategory?: string;
};
export type SpecialRateMasterList = Paginated<SpecialRateMasterRow>;

/* ── Agent (bulk) mode ───────────────────────────────────────────────────────── */

/** A customer under an agent, for the bulk-apply picker. */
export interface AgentCustomer {
  id: number;
  partyName: string;
  city: string;
}

/** Apply one rate override to many customers at once. */
export interface BulkSaveCustomerRateInput {
  customerIds: number[];
  kind: RateKind;
  scope: RateScope;
  category: string;
  subCategory?: string | null;
  target?: string | null;
  rate: number;
}

/** Apply one logo restriction to many customers at once. */
export interface BulkSaveCustomerLogoInput {
  customerIds: number[];
  scope: LogoScope;
  category: string;
  subCategory?: string | null;
}

/* ── Cascade resolution (used by the order form to price a line) ──────────────── */

export interface SpecialRateContext {
  category: string;
  subCategory: string;
  /** Product name (for the product cascade). */
  product?: string | null;
  /** Design type (for the design cascade); omit for a plain product line. */
  designType?: string | null;
}

export interface SpecialRateResolution {
  /** Delta to add to the base product rate. */
  productDelta: number;
  /** Delta to add to the base design rate. */
  designDelta: number;
  /** True if the logo is not allowed for this line's category / sub-category. */
  logoBlocked: boolean;
  /** Which level supplied each delta (for display), or null when none matched. */
  productFrom: RateScope | null;
  designFrom: RateScope | null;
}

/**
 * Resolve a customer's special-rate deltas for one order line, most-specific-first
 * (ITEM → SUBCATEGORY → CATEGORY); only the first matching level applies — exactly
 * mirroring the legacy Form10 cascade.
 */
export function resolveSpecialRates(
  data: { rates: CustomerRateDto[]; logos: CustomerLogoDto[] },
  ctx: SpecialRateContext,
): SpecialRateResolution {
  const cat = ctx.category;
  const sub = ctx.subCategory;

  const pick = (kind: RateKind, target: string): { delta: number; from: RateScope | null } => {
    const rs = data.rates.filter((r) => r.kind === kind);
    if (target) {
      const item = rs.find((r) => r.scope === 'ITEM' && r.category === cat && r.subCategory === sub && r.target === target);
      if (item) return { delta: item.rate, from: 'ITEM' };
    }
    const subc = rs.find((r) => r.scope === 'SUBCATEGORY' && r.category === cat && r.subCategory === sub);
    if (subc) return { delta: subc.rate, from: 'SUBCATEGORY' };
    const c = rs.find((r) => r.scope === 'CATEGORY' && r.category === cat);
    if (c) return { delta: c.rate, from: 'CATEGORY' };
    return { delta: 0, from: null };
  };

  const product = pick('PRODUCT', ctx.product ?? '');
  const design = ctx.designType ? pick('DESIGN', ctx.designType) : { delta: 0, from: null };
  const logoBlocked = data.logos.some(
    (l) =>
      (l.scope === 'SUBCATEGORY' && l.category === cat && l.subCategory === sub) ||
      (l.scope === 'CATEGORY' && l.category === cat),
  );

  return {
    productDelta: product.delta,
    designDelta: design.delta,
    logoBlocked,
    productFrom: product.from,
    designFrom: design.from,
  };
}
