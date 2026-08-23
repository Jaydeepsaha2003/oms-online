/**
 * Rate List Settings (spec §5, §9, §10, §27)
 * ------------------------------------------
 * What a rate list should contain and how it should be laid out, saved once and
 * reused — as a DEFAULT for everybody and, where a party always wants something
 * different, as that party's own configuration.
 *
 * This is the substrate the rest of the Rate List work stands on: §6 (Pieces vs
 * Size), §7/§8 (price combinations), §9 (default configuration), §10 (party
 * configuration), §14/§16/§17 (the same for designs), §25/§26 (downloads honour
 * the configuration) and §29 (configuration is reused) all resolve to "there is
 * nowhere to store this yet". This is that place.
 *
 * Nothing here decides how a rate is CALCULATED. Rates come from the product and
 * design masters plus the customer's special-rate cascade, exactly as they do
 * today; these settings only decide what is shown, in what unit, grouped how.
 */

/** What the "Available" column shows for a category (§6). */
export const AVAILABLE_DISPLAYS = ['PCS', 'SIZE'] as const;
export type AvailableDisplay = (typeof AVAILABLE_DISPLAYS)[number];

/**
 * One saved price combination (§7): several sizes / sub-categories shown under a
 * single column instead of one column each.
 *
 * `members` are sub-category values as they appear in the product master. The
 * label is what the column is titled; when blank the UI derives one from the
 * members, so an unnamed combination is still readable.
 *
 * A combination may only be SAVED when every member carries the same rate (§8) —
 * enforced server-side, because a client-side-only check is one stale tab away
 * from writing a combination that hides two different prices under one heading.
 */
export interface RateListCombination {
  /** Stable id within its config, so a rename does not orphan the members. */
  id: string;
  label: string;
  members: string[];
}

/** What an Available-column override applies to. */
export const AVAILABLE_OVERRIDE_SCOPES = ['SUBCATEGORY', 'ITEM', 'DESIGN'] as const;
export type AvailableOverrideScope = (typeof AVAILABLE_OVERRIDE_SCOPES)[number];

/**
 * "Inside GLASS, show SIZE for this one thing."
 *
 * The Available column used to be decided per CATEGORY and nothing finer, so a
 * category where one sub-category is sold by size and the rest by pieces had no
 * correct setting — whichever you chose was wrong for part of the sheet.
 *
 * Three scopes, resolved most-specific-first, the same cascade the special-rate
 * engine already uses so there is one precedence rule to learn:
 *
 *   ITEM / DESIGN  (a named product or design type)
 *        ▲ beats
 *   SUBCATEGORY
 *        ▲ beats
 *   the category's own `availableDisplay`
 *        ▲ beats
 *   the config's global `availableDisplay`
 *
 * ITEM and DESIGN are separate scopes rather than one "target": a product and a
 * design type can share a name, and the product rate list and the design rate
 * list are different tables. Being explicit stops a rule written for a design
 * silently re-laying-out a product.
 *
 * `subCategory` narrows an ITEM/DESIGN rule to one sub-category; blank means the
 * rule applies wherever that item appears. It is required for SUBCATEGORY scope
 * — that is what the rule is about.
 *
 * Lines whose resolved display differs from the rest of their category are
 * pivoted into their OWN table (see customer-rate-list-pivot): one grid cannot
 * have two column axes, and forcing them together would put a size under a
 * "12pcs" heading.
 */
export interface RateListAvailableOverride {
  /** Stable id within its category, so editing one row never disturbs another. */
  id: string;
  scope: AvailableOverrideScope;
  /** Sub-category, upper-cased. Required for SUBCATEGORY; optional narrowing for ITEM/DESIGN. */
  subCategory: string;
  /** Product name or design type, upper-cased. Required for ITEM/DESIGN; '' for SUBCATEGORY. */
  target: string;
  display: AvailableDisplay;
}

/** How one category behaves on the rate list. */
export interface RateListCategoryConfig {
  /** Category as it appears in the product/design master, upper-cased. */
  category: string;
  /** Include this category at all. */
  included: boolean;
  /**
   * Which sub-categories to include. Empty means ALL of them — deliberately, so
   * a new sub-category appears on the sheet by default rather than silently
   * missing until somebody remembers to tick it.
   */
  subCategories: string[];
  /** Pieces or Size in the Available column (§6). Null inherits the default. */
  availableDisplay: AvailableDisplay | null;
  /** Finer-grained exceptions inside this category. Empty is the normal case:
   *  the whole category follows `availableDisplay`. */
  availableOverrides: RateListAvailableOverride[];
  /** Saved price combinations for this category (§7). */
  combinations: RateListCombination[];
}

/** The default configuration, used for every party that has none of its own. */
export interface RateListConfig {
  /** Fallback for a category with no `availableDisplay` of its own. */
  availableDisplay: AvailableDisplay;
  /** Per-category behaviour. A category absent from this list is included with
   *  all its sub-categories — again so new catalogue data shows up by default. */
  categories: RateListCategoryConfig[];
  /** Include the design rate list alongside the product rate list (§13). */
  includeDesigns: boolean;
}

/**
 * A party's configuration (§10). Every field is optional: a party overrides only
 * what it actually wants different and inherits the rest, so a change to the
 * default still reaches parties that never asked to differ.
 */
export interface PartyRateListConfig {
  customerId: number;
  availableDisplay?: AvailableDisplay | null;
  categories?: RateListCategoryConfig[] | null;
  includeDesigns?: boolean | null;
}

/** Where each field of an effective config came from — so a screen can say why
 *  it is showing what it is showing, and §29's "reused automatically" is visible
 *  rather than mysterious. */
export interface RateListConfigProvenance {
  availableDisplay: 'PARTY' | 'DEFAULT';
  categories: 'PARTY' | 'DEFAULT';
  includeDesigns: 'PARTY' | 'DEFAULT';
}

export interface EffectiveRateListConfig extends RateListConfig {
  customerId: number | null;
  /** True when this party has a saved configuration of its own at all. */
  partyConfigured: boolean;
  from: RateListConfigProvenance;
}

/**
 * The item names inside one category, for picking the target of an
 * Available-column override.
 *
 * Fetched per category on demand rather than shipped in
 * {@link RateListConfigBundle}: the bundle loads on every visit to the settings
 * screen, and the catalogue runs to thousands of products across all categories
 * — almost none of which the person editing GLASS will ever look at.
 */
export interface RateListCategoryItems {
  category: string;
  /** Distinct product names, with the sub-category each appears under. */
  products: { subCategory: string; item: string }[];
  /** Distinct design types, same shape. Combinations ("WL+TOOL") are excluded —
   *  they never reach the sheet, so a rule about one could never apply. */
  designs: { subCategory: string; item: string }[];
}

/** Everything the settings screen needs in one call. */
export interface RateListConfigBundle {
  default: RateListConfig;
  parties: PartyRateListConfig[];
  /** Catalogue values to choose from, so the screen never invents a category. */
  lookups: {
    categories: string[];
    /** Distinct (category, sub-category) pairs, product side. */
    subCategories: { category: string; subCategory: string }[];
    /** Distinct (category, sub-category) pairs, design side. */
    designSubCategories: { category: string; subCategory: string }[];
  };
}

/* ── wire shapes ────────────────────────────────────────────────────────────
   What a client may SEND, as opposed to what is stored. Looser on purpose: a
   caller should not have to spell out `included: true, subCategories: []` to say
   "this category, everything in it". The service sanitises an Input into the
   strict shape above, so the looseness stops at the boundary. */

export interface RateListCombinationInput {
  id?: string;
  label?: string;
  members: string[];
}

/** Every field optional on the way IN — the service sanitises. */
export interface RateListAvailableOverrideInput {
  id?: string;
  scope?: AvailableOverrideScope | string;
  subCategory?: string;
  target?: string;
  display?: AvailableDisplay | string;
}

export interface RateListCategoryConfigInput {
  category: string;
  included?: boolean;
  subCategories?: string[];
  availableDisplay?: AvailableDisplay | null;
  availableOverrides?: RateListAvailableOverrideInput[];
  combinations?: RateListCombinationInput[];
}

export interface RateListConfigInput {
  availableDisplay: AvailableDisplay;
  includeDesigns?: boolean;
  categories?: RateListCategoryConfigInput[];
}

export interface PartyRateListConfigInput {
  customerId: number;
  availableDisplay?: AvailableDisplay | null;
  includeDesigns?: boolean | null;
  categories?: RateListCategoryConfigInput[] | null;
}

const norm = (v: string | null | undefined): string => (v ?? '').trim().toUpperCase();

/** The default configuration used when nothing has ever been saved: everything
 *  in, pieces in the Available column — i.e. exactly today's behaviour, so
 *  turning the feature on changes nothing until somebody configures it. */
export function emptyRateListConfig(): RateListConfig {
  return { availableDisplay: 'PCS', categories: [], includeDesigns: true };
}

/**
 * The configuration that actually applies to one party.
 *
 * Field-by-field inheritance rather than "party config wins wholesale": a party
 * that only wanted Size instead of Pieces should not thereby freeze its category
 * list at the moment it was saved. Each field resolves independently and reports
 * which level supplied it.
 */
export function resolveRateListConfig(
  def: RateListConfig,
  party: PartyRateListConfig | null | undefined,
): EffectiveRateListConfig {
  const hasCats = !!party?.categories && party.categories.length > 0;
  return {
    customerId: party?.customerId ?? null,
    partyConfigured: !!party,
    availableDisplay: party?.availableDisplay ?? def.availableDisplay,
    categories: hasCats ? party!.categories! : def.categories,
    includeDesigns: party?.includeDesigns ?? def.includeDesigns,
    from: {
      availableDisplay: party?.availableDisplay ? 'PARTY' : 'DEFAULT',
      categories: hasCats ? 'PARTY' : 'DEFAULT',
      includeDesigns: party?.includeDesigns != null ? 'PARTY' : 'DEFAULT',
    },
  };
}

/**
 * Is this (category, sub-category) on the sheet under this configuration?
 *
 * An unlisted category is INCLUDED, and a category with no sub-category list
 * includes all of them. Both defaults point the same way: catalogue data that
 * nobody has ruled on shows up. The opposite default — hide anything
 * unconfigured — turns every new product into a silent omission, and a rate
 * sheet that is quietly missing an item is worse than one that shows too much.
 */
export function isOnRateList(config: RateListConfig, category: string, subCategory: string): boolean {
  const cat = config.categories.find((c) => norm(c.category) === norm(category));
  if (!cat) return true;
  if (!cat.included) return false;
  if (!cat.subCategories.length) return true;
  return cat.subCategories.some((s) => norm(s) === norm(subCategory));
}

/** The Available display in force for a category (§6): the category's own choice,
 *  else the configuration's fallback. */
export function availableDisplayFor(config: RateListConfig, category: string): AvailableDisplay {
  const cat = config.categories.find((c) => norm(c.category) === norm(category));
  return cat?.availableDisplay ?? config.availableDisplay;
}

/**
 * The Available display for ONE line, honouring the overrides above.
 *
 * `availableDisplayFor` remains the category-level answer and is what a
 * category with no overrides resolves to; this is the per-line refinement. The
 * two agree whenever no override matches, so callers that only care about the
 * category are unaffected.
 *
 * Ordering is explicit rather than relying on array order: a config written by
 * an older client, or hand-edited, must resolve the same way.
 */
export function availableDisplayForLine(
  config: RateListConfig | null,
  line: { category: string; subCategory: string; item: string; kind: 'PRODUCT' | 'DESIGN' },
): AvailableDisplay {
  if (!config) return 'PCS';
  const cat = config.categories.find((c) => norm(c.category) === norm(line.category));
  const categoryLevel = cat?.availableDisplay ?? config.availableDisplay;
  if (!cat?.availableOverrides?.length) return categoryLevel;

  const sub = norm(line.subCategory);
  const item = norm(line.item);
  const itemScope = line.kind === 'DESIGN' ? 'DESIGN' : 'ITEM';

  // Most specific first: the named item in one sub-category, then the named item
  // anywhere, then the sub-category.
  const rules = cat.availableOverrides;
  const exact = rules.find((r) => r.scope === itemScope && norm(r.target) === item && norm(r.subCategory) === sub && !!sub);
  if (exact) return exact.display;
  const anySub = rules.find((r) => r.scope === itemScope && norm(r.target) === item && !norm(r.subCategory));
  if (anySub) return anySub.display;
  const bySub = rules.find((r) => r.scope === 'SUBCATEGORY' && norm(r.subCategory) === sub);
  if (bySub) return bySub.display;
  return categoryLevel;
}

/** The saved combination a sub-category belongs to, or null. */
export function combinationFor(
  config: RateListConfig,
  category: string,
  subCategory: string,
): RateListCombination | null {
  const cat = config.categories.find((c) => norm(c.category) === norm(category));
  if (!cat) return null;
  return cat.combinations.find((cb) => cb.members.some((m) => norm(m) === norm(subCategory))) ?? null;
}

/* ── §8 combination validation ──────────────────────────────────────────────── */

/** One item's rate in each member column. A member the item does not appear in
 *  is simply absent — not zero, not null-as-zero. */
export interface CombinationItemRates {
  item: string;
  /** member sub-category (upper-cased) → that item's rate there. */
  rates: Record<string, number>;
}

export interface CombinationConflict {
  item: string;
  /** The differing rates, keyed by member, exactly as found. */
  rates: Record<string, number>;
}

export interface CombinationCheckResult {
  ok: boolean;
  /** Human explanation when it is refused — names the items and their rates,
   *  because "different rates" alone sends the user back to compare by hand,
   *  which is the work this check exists to do. */
  message: string | null;
  /** Every item that disagrees across the chosen members. */
  conflicts: CombinationConflict[];
  /** Items that appear in more than one member and DO agree — the evidence that
   *  the combination is meaningful rather than merely unopposed. */
  agreeing: number;
}

/**
 * May these sub-categories share one price column? (§7, §8, §28)
 *
 * The test is per ITEM across the chosen columns, NOT "all members have one
 * rate". A rate belongs to a product, not to a sub-category: in this book
 * `10-PCS-FG-22G` alone holds 47 products at 14 different rates, so asking
 * whether a sub-category "has a rate" has no answer. What §7 actually merges is
 * COLUMNS (its example is the sizes 5, 5.5, 6, 6.5), and a column merge is safe
 * exactly when no single item is priced differently in the columns being merged.
 *
 * An item appearing in only one of the members cannot conflict and is ignored —
 * the same rule the existing pivot already applies when it auto-merges adjacent
 * pcs columns (`canMerge`). This makes that rule explicit and saveable rather
 * than re-deriving it.
 */
export function checkCombination(members: string[], items: CombinationItemRates[]): CombinationCheckResult {
  const uniq = [...new Set(members.map(norm).filter(Boolean))];
  if (uniq.length < 2) {
    return { ok: false, message: 'Choose at least two sizes or sub-categories to combine.', conflicts: [], agreeing: 0 };
  }

  const conflicts: CombinationConflict[] = [];
  let agreeing = 0;
  for (const it of items) {
    const present: Record<string, number> = {};
    for (const m of uniq) {
      const r = it.rates[m];
      if (typeof r === 'number') present[m] = Math.round(r * 100) / 100;
    }
    const distinct = new Set(Object.values(present));
    if (Object.keys(present).length < 2) continue; // cannot conflict with itself
    if (distinct.size > 1) conflicts.push({ item: it.item, rates: present });
    else agreeing += 1;
  }

  if (!conflicts.length) return { ok: true, message: null, conflicts: [], agreeing };

  const shown = conflicts
    .slice(0, 3)
    .map((c) => `${c.item} (${Object.entries(c.rates).map(([m, r]) => `${m} ₹${r}`).join(' vs ')})`)
    .join('; ');
  const more = conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : '';
  return {
    ok: false,
    message:
      `${conflicts.length} item${conflicts.length === 1 ? '' : 's'} would be priced differently in these columns — ` +
      `${shown}${more}. Only columns where every shared item costs the same can be combined.`,
    conflicts,
    agreeing,
  };
}
