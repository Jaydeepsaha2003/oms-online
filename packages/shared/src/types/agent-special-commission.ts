import type { RepriceResult } from './agent-commission';
/**
 * Special Commission (Agent → Commission Rates → Special Commission)
 * ------------------------------------------------------------------
 * An override of an agent's base commission rate, narrowed to a particular
 * party, category, sub-category, product or design.
 *
 * The base rate answers "what does this agent earn on GLASS?" — one number per
 * agent per category. Real arrangements are not that flat: an agent brings a
 * large party on a thinner margin, or earns more on a design that is hard to
 * sell. Until now the only way to express that was to change the base rate,
 * which changed it for every party and every product at once.
 *
 * Resolution is MOST SPECIFIC FIRST, and only the winning rule applies — these
 * are replacement rates, not deltas stacked on top of each other. Unlike
 * customer Special Rates (which ARE deltas), a commission rate is the whole
 * number the agent is paid per unit, so adding two of them together would be
 * meaningless.
 *
 * If nothing matches, the base rate applies. That is the point of the fallback:
 * a special is an exception, and the exception list is never required to be
 * complete.
 */
import type { CommissionBasis } from './agent-commission';

/**
 * How narrowly a rule is aimed. Ordered least → most specific; see
 * {@link SPECIAL_COMMISSION_SCOPE_WEIGHT} for the precedence actually used.
 *
 * - `CUSTOMER`     this party, whatever they buy
 * - `CATEGORY`     a product category (optionally for one party)
 * - `SUBCATEGORY`  a sub-category within a category
 * - `PRODUCT`      one product
 * - `DESIGN`       one design type
 */
export const SPECIAL_COMMISSION_SCOPES = ['CUSTOMER', 'CATEGORY', 'SUBCATEGORY', 'PRODUCT', 'DESIGN'] as const;
export type SpecialCommissionScope = (typeof SPECIAL_COMMISSION_SCOPES)[number];

/** Human labels for the scope dropdown and for explaining a resolved rate. */
export const SPECIAL_COMMISSION_SCOPE_LABEL: Record<SpecialCommissionScope, string> = {
  CUSTOMER: 'Party',
  CATEGORY: 'Category',
  SUBCATEGORY: 'Sub-category',
  PRODUCT: 'Product',
  DESIGN: 'Design',
};

/** Within the same "is it party-specific?" tier, a narrower aim wins. */
export const SPECIAL_COMMISSION_SCOPE_WEIGHT: Record<SpecialCommissionScope, number> = {
  DESIGN: 5,
  PRODUCT: 4,
  SUBCATEGORY: 3,
  CATEGORY: 2,
  CUSTOMER: 1,
};

/**
 * The same rule aimed at several parties at once.
 *
 * One rule per party is what the data model wants — a rule names at most one
 * party — so this is a convenience over `create`, not a new kind of rule. It
 * exists as an endpoint rather than a loop in the browser because every single
 * create RE-PRICES the invoices it affects: ten parties done client-side means
 * ten re-pricing passes over the same challans. Here the rows are written
 * together and the re-price runs once.
 *
 * An empty `customerIds` means "not aimed at any party" — the all-parties rule,
 * which is a single row with a null customer.
 */
export interface BulkSpecialCommissionInput extends Omit<AgentSpecialCommissionInput, 'customerId'> {
  customerIds: number[];
}

export interface BulkSpecialCommissionResult {
  /** How many rule rows were written. */
  created: number;
  /** Parties skipped because an identical rule already existed for them. */
  skipped: number;
  repriced: RepriceResult;
}

export interface AgentSpecialCommissionDto {
  id: number;
  agentId: number;
  agentName: string;
  scope: SpecialCommissionScope;
  /** Null = the rule is not tied to one party (applies across this agent's parties). */
  customerId: number | null;
  customerName: string | null;
  /** Null only when scope = CUSTOMER. */
  pCategory: string | null;
  /** Set when scope is SUBCATEGORY or narrower and the rule names one. */
  subCategory: string | null;
  /** Set when scope = PRODUCT. */
  product: string | null;
  /** Set when scope = DESIGN. */
  designType: string | null;
  /** The unit the rate is charged in — must match the category's own basis. */
  basis: CommissionBasis;
  /** The whole rate per unit, REPLACING the base rate. Not a delta. */
  ratePerUnit: number;
  effectiveFrom: string;
  note: string | null;
  userName: string | null;
  /** The newest non-future rule for this exact scope — the one actually in force. */
  current: boolean;
  /**
   * When true, this rule's rate is ALSO added onto the price the named
   * customer pays — the order form folds it into Product ₹. The agent still
   * accrues and gets settled the normal way regardless; this never changes
   * that, only what the customer is charged. Only meaningful when
   * `customerId` is set — a rule with no party is never consulted for
   * pricing, so the flag has nothing to attach to.
   */
  addToRate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSpecialCommissionInput {
  agentId: number;
  scope: SpecialCommissionScope;
  customerId?: number | null;
  pCategory?: string | null;
  subCategory?: string | null;
  product?: string | null;
  designType?: string | null;
  basis: CommissionBasis;
  ratePerUnit: number;
  effectiveFrom: string;
  note?: string | null;
  /** Defaults to false — see {@link AgentSpecialCommissionDto.addToRate}. */
  addToRate?: boolean;
}

/** What a challan LINE is, for the purpose of pricing its commission. */
export interface CommissionRateContext {
  customerId: number | null;
  pCategory: string | null;
  subCategory: string | null;
  product: string | null;
  designType: string | null;
}

/** Which rule priced a line, and at what. */
export interface ResolvedCommissionRate {
  ratePerUnit: number;
  basis: CommissionBasis;
  /** Null when the base rate applied. */
  scope: SpecialCommissionScope | null;
  /** True when the winning rule named a specific party. */
  partySpecific: boolean;
  /** One-line explanation, e.g. "Product BREZZA · ANIL METAL". */
  label: string;
  /** The special rule's id, for tracing a figure back to the rule that set it. */
  specialId: number | null;
  /** True when the winning rule is flagged to also raise the customer's price
   *  by this amount (see {@link AgentSpecialCommissionDto.addToRate}). Always
   *  false when the base rate applied — a base rate is never customer-priced. */
  addToRate: boolean;
}

const norm = (v: string | null | undefined): string => (v ?? '').trim().toUpperCase();

/**
 * Does this rule apply to that line?
 *
 * Every field the rule names must match; fields it leaves null are wildcards.
 * A rule tied to a party never applies to a different party — that is the one
 * mismatch that must never be treated as a wildcard, or a negotiated rate would
 * leak onto everybody.
 */
function ruleMatches(
  rule: AgentSpecialCommissionDto,
  ctx: CommissionRateContext,
  lineBasis: CommissionBasis | null,
): boolean {
  /*
   * A rate carries a UNIT, and a rate in the wrong unit is not a discount — it
   * is a different quantity of money entirely. ₹30 per kg applied to a
   * per-piece category pays ₹30 a piece, which against a ₹0.50 base is sixty
   * times the intended amount.
   *
   * This bites hardest on a party-wide rule, which names no category and would
   * otherwise reach every category that party buys, per-kg and per-piece alike.
   * So a rule only prices a line whose category is charged in the rule's own
   * unit. Where the category has no base rate there is nothing to contradict,
   * and the rule's unit stands.
   */
  if (lineBasis && rule.basis !== lineBasis) return false;
  if (rule.customerId != null && rule.customerId !== ctx.customerId) return false;
  if (rule.pCategory && norm(rule.pCategory) !== norm(ctx.pCategory)) return false;
  if (rule.subCategory && norm(rule.subCategory) !== norm(ctx.subCategory)) return false;
  if (rule.product && norm(rule.product) !== norm(ctx.product)) return false;
  if (rule.designType && norm(rule.designType) !== norm(ctx.designType)) return false;
  // A scope must have something to aim at. A DESIGN rule with no design named
  // would otherwise match every line in its category.
  switch (rule.scope) {
    case 'DESIGN':
      return !!rule.designType;
    case 'PRODUCT':
      return !!rule.product;
    case 'SUBCATEGORY':
      return !!rule.subCategory;
    case 'CATEGORY':
      return !!rule.pCategory;
    case 'CUSTOMER':
      return rule.customerId != null;
    default:
      return false;
  }
}

/**
 * Precedence, highest first.
 *
 * A rule naming the PARTY outranks any rule that does not, even a narrower one:
 * "we agreed ₹30/kg with this party" is a negotiated arrangement, while "we pay
 * ₹45 on BREZZA" is general policy, and the arrangement is what the agent will
 * hold you to. Within each tier the narrower aim wins, and a later
 * `effectiveFrom` breaks a remaining tie (handled by the caller's ordering).
 *
 * Deliberately explicit rather than emergent: with five scopes × party-or-not
 * there are ten ways to be "more specific", and an ordering nobody wrote down
 * is one nobody can defend when an agent disputes his statement.
 */
function precedence(rule: AgentSpecialCommissionDto): number {
  const party = rule.customerId != null ? 100 : 0;
  return party + SPECIAL_COMMISSION_SCOPE_WEIGHT[rule.scope];
}

/** How a rule reads in one line, for the UI and for the accrual's audit note. */
export function specialCommissionLabel(rule: AgentSpecialCommissionDto): string {
  const target =
    rule.scope === 'DESIGN'
      ? rule.designType
      : rule.scope === 'PRODUCT'
        ? rule.product
        : rule.scope === 'SUBCATEGORY'
          ? rule.subCategory
          : rule.scope === 'CATEGORY'
            ? rule.pCategory
            : rule.customerName;
  const head = `${SPECIAL_COMMISSION_SCOPE_LABEL[rule.scope]} ${target ?? '—'}`;
  // The party is already the target on a CUSTOMER rule; repeating it reads badly.
  return rule.customerName && rule.scope !== 'CUSTOMER' ? `${head} · ${rule.customerName}` : head;
}

/**
 * The commission rate for one line: the winning special, or the base rate.
 *
 * `rules` must already be filtered to the agent and to rules effective on or
 * before the invoice date, newest first — the date rule is the caller's job
 * because it is a database query, and getting it wrong (pricing an April
 * invoice at August's rate) is the mistake this whole subsystem exists to
 * avoid.
 *
 * `base` may be null: an agent with no base rate for a category earns nothing
 * there unless a special says otherwise, which is exactly how a business that
 * pays commission on only some categories is expressed. It also carries the
 * category's UNIT, which is what lets a per-kg rule be kept away from a
 * per-piece category — see `ruleMatches`.
 */
export function resolveCommissionRate(
  rules: AgentSpecialCommissionDto[],
  base: { ratePerUnit: number; basis: CommissionBasis } | null,
  ctx: CommissionRateContext,
): ResolvedCommissionRate | null {
  const lineBasis = base?.basis ?? null;
  let best: AgentSpecialCommissionDto | null = null;
  let bestScore = -1;
  for (const r of rules) {
    if (!ruleMatches(r, ctx, lineBasis)) continue;
    const score = precedence(r);
    // Strictly greater, so that among equals the FIRST wins — and the caller
    // ordered them newest-effective-first, which is the tie-break we want.
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }

  if (best) {
    return {
      ratePerUnit: best.ratePerUnit,
      // The basis belongs to the category, not to the deal — a special that
      // disagreed would change the QUANTITY the money is calculated on, which
      // is never what "a special rate" means. The base wins where it exists.
      basis: base?.basis ?? best.basis,
      scope: best.scope,
      partySpecific: best.customerId != null,
      label: specialCommissionLabel(best),
      specialId: best.id,
      addToRate: best.addToRate,
    };
  }

  if (!base) return null;
  return {
    ratePerUnit: base.ratePerUnit,
    basis: base.basis,
    scope: null,
    partySpecific: false,
    label: 'Base rate',
    specialId: null,
    addToRate: false,
  };
}
