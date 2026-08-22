/**
 * What a party's Set Special Rate configuration actually DOES (spec §19, §20).
 *
 * The Set Special Rate screen stores rules — "CUP, +30" — and the rate list
 * shows prices. Neither, on its own, answers the questions §19 asks: which of
 * these rules is doing anything, to how many items, and how far from our own
 * rate does it move them.
 *
 * So each rule is matched against the party's actual rate sheet through the SAME
 * cascade that priced it ({@link resolveSpecialRateRule}), which means a rule
 * that is shadowed by a more specific one honestly reports zero items rather
 * than claiming a category's worth.
 */
import { resolveSpecialRateRule, type CustomerRateDto, type CustomerRateList } from '@oms/shared';
import { isCombinationDesign } from './customer-rate-list-pivot';

export interface RateImpact {
  rule: CustomerRateDto;
  /** Items on this party's sheet the rule actually prices. */
  items: number;
  /** Our rate across those items (min/max — one rule can span many rates). */
  baseFrom: number | null;
  baseTo: number | null;
  /** The customer's rate across the same items. */
  rateFrom: number | null;
  rateTo: number | null;
  /**
   * Items the rule matches but does not price, because a more specific rule
   * wins there. Worth surfacing: a category rule reading "0 items priced, 14
   * overridden" is a very different fact from one reading "0 items".
   */
  shadowed: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Every rule with its measured effect, most specific and largest first. */
export function measureSpecialRates(rates: CustomerRateDto[], list: CustomerRateList | undefined): RateImpact[] {
  const acc = new Map<number, { items: number; shadowed: number; bases: number[]; effs: number[] }>();
  for (const r of rates) acc.set(r.id, { items: 0, shadowed: 0, bases: [], effs: [] });

  const attribute = (kind: 'PRODUCT' | 'DESIGN', category: string, subCategory: string, target: string, base: number, eff: number) => {
    const winner = resolveSpecialRateRule(rates, kind, { category, subCategory, target });
    if (!winner) return;
    const a = acc.get(winner.id);
    if (a) {
      a.items += 1;
      a.bases.push(base);
      a.effs.push(eff);
    }
    // Anything less specific that also matches this line is shadowed by it.
    for (const r of rates) {
      if (r.id === winner.id || r.kind !== kind) continue;
      if (resolveSpecialRateRule([r], kind, { category, subCategory, target })?.id === r.id) {
        const s = acc.get(r.id);
        if (s) s.shadowed += 1;
      }
    }
  };

  if (list) {
    for (const p of list.products) attribute('PRODUCT', p.category, p.subCategory, p.product, p.baseRate, p.rate);
    for (const d of list.designs) {
      if (isCombinationDesign(d.designType)) continue;
      attribute('DESIGN', d.category, d.subCategory, d.designType, d.baseRate, d.rate);
    }
  }

  const SCOPE_ORDER = { ITEM: 0, SUBCATEGORY: 1, CATEGORY: 2 } as const;
  return rates
    .map<RateImpact>((rule) => {
      const a = acc.get(rule.id)!;
      const span = (xs: number[]) => (xs.length ? ([r2(Math.min(...xs)), r2(Math.max(...xs))] as const) : ([null, null] as const));
      const [baseFrom, baseTo] = span(a.bases);
      const [rateFrom, rateTo] = span(a.effs);
      return { rule, items: a.items, shadowed: a.shadowed, baseFrom, baseTo, rateFrom, rateTo };
    })
    .sort(
      (x, y) =>
        x.rule.kind.localeCompare(y.rule.kind) ||
        SCOPE_ORDER[x.rule.scope] - SCOPE_ORDER[y.rule.scope] ||
        y.items - x.items ||
        x.rule.category.localeCompare(y.rule.category),
    );
}

/** Headline numbers for the consolidated view (§19). */
export function summariseSpecialRates(impacts: RateImpact[]) {
  const up = impacts.filter((i) => i.rule.rate > 0).length;
  const down = impacts.filter((i) => i.rule.rate < 0).length;
  const idle = impacts.filter((i) => i.items === 0).length;
  const items = impacts.reduce((n, i) => n + i.items, 0);
  return { up, down, idle, items, rules: impacts.length };
}
