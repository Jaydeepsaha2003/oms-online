/**
 * Rate List pivot engine — shared by the on-screen preview and the PDF/Excel
 * exporters.
 *
 * Mirrors the printed "RATE LIST" workbook layout: one row per ITEM with the
 * rates PIVOTED into columns —
 *   SR | ITEM | AVAILABLE PCS | 8pcs/10pcs | 12pcs | 15pcs | 6pcs
 * Adjacent columns whose rates always agree are merged into one column (that's
 * where the legacy "8pcs/10pcs" heading comes from). Each product category gets
 * its own section; designs-on-glass follow as their own pivot.
 *
 * Everything the Rate List Settings configure is applied HERE, once, so the
 * preview, the PDF and the Excel can never disagree about what is on the sheet
 * (spec §25/§26): which categories and sub-categories are included (§9/§10),
 * whether the Available column counts pieces or sizes (§6/§14), and which
 * columns are grouped under one heading (§7/§8/§16/§17).
 */
import {
  availableDisplayFor,
  availableDisplayForLine,
  combinationFor,
  isOnRateList,
  type AvailableDisplay,
  type CustomerRateList,
  type CustomerRateListDesign,
  type CustomerRateListProduct,
  type RateListConfig,
} from '@oms/shared';

const r0 = (v: number) => Math.round(v);

export interface PivotRow {
  sr: number;
  item: string;
  available: string;
  /** One display value per column ('' when the item has no rate there). */
  cells: string[];
  /**
   * Our own rate in each column — the base chart rate before this customer's
   * special-rate adjustment (§18). Only filled where it DIFFERS from `cells`:
   * an unadjusted item would otherwise print the same number twice and read as
   * though something had been applied.
   */
  baseCells: string[];
  /** The signed adjustment in each column, e.g. "+50" / "-25" ('' when none) (§20). */
  deltaCells: string[];
  minRate: number;
  /** True when any line of this item carries the customer's special-rate delta. */
  special: boolean;
}
export interface PivotTable {
  title: string;
  /** Category this section came from, so a caller can filter sections without
   *  re-parsing the title. */
  category: string;
  columns: string[]; // header labels for the rate columns
  /** Header for the third column — "Available pcs" or "Available size" (§6). */
  availableLabel: string;
  rows: PivotRow[];
}

/** How one line groups into a rate column. */
interface Line {
  name: string;
  /** Pieces per set, when recorded. */
  pcs: number | null;
  /** Size, when recorded. */
  size: number | null;
  /** Sub-category as held in the master — what a saved combination names (§7). */
  subCategory: string;
  rate: number;
  /** Our own rate — what the item costs before this customer's adjustment. */
  base: number;
  /** rate − base, i.e. this customer's special-rate adjustment. */
  delta: number;
  special?: boolean;
}

/** Legacy column order: pcs ≥ 8 ascending first, then the small packs (6, 4…). */
function orderPcs(values: (number | null)[]): (number | null)[] {
  const nums = [...new Set(values.filter((v): v is number => v != null))];
  const big = nums.filter((v) => v >= 8).sort((a, b) => a - b);
  const small = nums.filter((v) => v < 8).sort((a, b) => a - b);
  const out: (number | null)[] = [...big, ...small];
  if (values.some((v) => v == null)) out.push(null);
  return out;
}

/** Sizes read small-to-large, with the unrecorded ones last. */
function orderSizes(values: (number | null)[]): (number | null)[] {
  const nums = [...new Set(values.filter((v): v is number => v != null))].sort((a, b) => a - b);
  const out: (number | null)[] = [...nums];
  if (values.some((v) => v == null)) out.push(null);
  return out;
}

const pcsLabel = (p: number | null) => (p == null ? 'RATE' : `${p}pcs`);
const sizeLabel = (s: number | null) => (s == null ? 'RATE' : String(s));

/** Compact header for a (possibly merged) pcs column: "8pcs", "8pcs/10pcs",
 *  and for 3+ merged packs a range like "1–6pcs" so headers never overflow. */
function columnLabel(values: (number | null)[], display: AvailableDisplay): string {
  const nums = values.filter((p): p is number => p != null).sort((a, b) => a - b);
  const unit = display === 'SIZE' ? '' : 'pcs';
  if (nums.length === 0) return 'RATE';
  if (nums.length === 1) return `${nums[0]}${unit}`;
  if (nums.length === 2) return `${nums[0]}${unit}/${nums[1]}${unit}`;
  return `${nums[0]}–${nums[nums.length - 1]}${unit}`;
}

/**
 * Pivot one category's lines into the SR/ITEM/AVAILABLE/rate-by-column table.
 *
 * The column axis is whichever quantity the category is configured to show
 * (§6) — pieces by default, sizes when asked. Nothing about the RATES changes
 * with that choice; only which axis they are laid out along.
 */
function pivot(
  title: string,
  category: string,
  lines: Line[],
  config: RateListConfig | null,
  /** Which axis THIS table lays out along. Passed in rather than derived from the
   *  category, because one category can now produce several tables — see
   *  `splitByDisplay` in buildSections. */
  display: AvailableDisplay,
): PivotTable {
  const keyOf = (l: Line) => (display === 'SIZE' ? l.size : l.pcs);
  const order = display === 'SIZE' ? orderSizes : orderPcs;
  const label = display === 'SIZE' ? sizeLabel : pcsLabel;

  // A saved combination names sub-categories; the axis is a number. Map each
  // combination to the axis values its members actually cover, so "combine 5,
  // 5.5, 6, 6.5" ends up as one column whichever axis is on show.
  const comboKeys = new Map<string, { label: string; keys: (number | null)[] }>();
  if (config) {
    for (const l of lines) {
      const cb = combinationFor(config, category, l.subCategory);
      if (!cb) continue;
      const entry = comboKeys.get(cb.id) ?? { label: cb.label, keys: [] };
      const k = keyOf(l);
      if (!entry.keys.includes(k)) entry.keys.push(k);
      comboKeys.set(cb.id, entry);
    }
  }
  /** Axis values claimed by a saved combination — never auto-merged with anything
   *  else, because the user has already said how they want them grouped. */
  const claimed = new Set([...comboKeys.values()].flatMap((c) => c.keys));

  // item → axis value → set of distinct effective rates (different
  // sizes/sub-cats can rate the same pcs differently; the legacy sheet showed
  // those side by side — we join them with " / " in the one cell).
  const items = new Map<string, Map<number | null, Set<number>>>();
  // Our rate and the adjustment, keyed identically, so a cell can show all three
  // without the pivot having to be walked twice.
  const bases = new Map<string, Map<number | null, Set<number>>>();
  const deltas = new Map<string, Map<number | null, Set<number>>>();
  const specials = new Map<string, boolean>();
  const add = (m: Map<string, Map<number | null, Set<number>>>, name: string, k: number | null, v: number) => {
    const byKey = m.get(name) ?? new Map<number | null, Set<number>>();
    const set = byKey.get(k) ?? new Set<number>();
    set.add(v);
    byKey.set(k, set);
    m.set(name, byKey);
  };
  for (const l of lines) {
    const k = keyOf(l);
    add(items, l.name, k, r0(l.rate));
    add(bases, l.name, k, r0(l.base));
    if (r0(l.delta) !== 0) add(deltas, l.name, k, r0(l.delta));
    if (l.special) specials.set(l.name, true);
  }

  // Columns: the configured combinations first-class, everything else one
  // column per axis value, all laid out in the axis's own order.
  const singles = order(lines.map(keyOf)).filter((k) => !claimed.has(k));
  let cols: { label: string; keys: (number | null)[]; fixed: boolean }[] = [
    ...singles.map((k) => ({ label: label(k), keys: [k], fixed: false })),
    ...[...comboKeys.values()].map((c) => ({ label: c.label, keys: order(c.keys), fixed: true })),
  ];
  // Keep the axis reading in order even with combinations mixed in: a column
  // sits where its cheapest member would have sat.
  const axisRank = new Map(order(lines.map(keyOf)).map((k, i) => [k, i]));
  cols.sort((a, b) => Math.min(...a.keys.map((k) => axisRank.get(k) ?? 0)) - Math.min(...b.keys.map((k) => axisRank.get(k) ?? 0)));

  // Merge adjacent columns when every item's rates agree (or one side is
  // empty) — reproduces "8pcs/10pcs" without hard-coding it. A configured
  // combination is never swallowed by this: the user named that column.
  const canMerge = (a: (number | null)[], b: (number | null)[]) =>
    [...items.values()].every((byKey) => {
      const ra = [...new Set(a.flatMap((p) => [...(byKey.get(p) ?? [])]))].sort();
      const rb = [...new Set(b.flatMap((p) => [...(byKey.get(p) ?? [])]))].sort();
      return ra.length === 0 || rb.length === 0 || JSON.stringify(ra) === JSON.stringify(rb);
    });
  for (let i = 0; i < cols.length - 1; ) {
    const a = cols[i];
    const b = cols[i + 1];
    if (!a.fixed && !b.fixed && a.keys[0] != null && b.keys[0] != null && canMerge(a.keys, b.keys)) {
      cols.splice(i, 2, { label: `${a.label}/${b.label}`, keys: [...a.keys, ...b.keys], fixed: false });
    } else i++;
  }
  // Drop columns that ended up entirely empty, then re-label the merged ones
  // compactly (3+ merged packs become a range like "1–6pcs").
  cols = cols.filter((c) => [...items.values()].some((byKey) => c.keys.some((k) => byKey.has(k))));
  for (const c of cols) if (!c.fixed) c.label = columnLabel(c.keys, display);

  /** Distinct values of one map in one column, cheapest first. */
  const join = (byKey: Map<number | null, Set<number>> | undefined, keys: (number | null)[], sign = false) => {
    if (!byKey) return '';
    const vs = [...new Set(keys.flatMap((k) => [...(byKey.get(k) ?? [])]))].sort((x, y) => x - y);
    return vs.map((v) => (sign && v > 0 ? `+${v}` : String(v))).join(' / ');
  };

  const rows: PivotRow[] = [...items.entries()].map(([name, byKey]) => {
    const cells = cols.map((c) => {
      const rates = [...new Set(c.keys.flatMap((k) => [...(byKey.get(k) ?? [])]))].sort((x, y) => x - y);
      return rates.length ? rates.join(' / ') : '';
    });
    const deltaCells = cols.map((c) => join(deltas.get(name), c.keys, true));
    // Our rate only where it differs — see the note on `baseCells`.
    const baseCells = cols.map((c, i) => (deltaCells[i] ? join(bases.get(name), c.keys) : ''));
    const allRates = [...byKey.values()].flatMap((s) => [...s]);
    const available = order([...byKey.keys()])
      .filter((k): k is number => k != null)
      .join(',');
    return { sr: 0, item: name, available, cells, baseCells, deltaCells, minRate: Math.min(...allRates), special: specials.get(name) ?? false };
  });

  // The printed list runs cheapest-first, then A→Z.
  rows.sort((a, b) => a.minRate - b.minRate || a.item.localeCompare(b.item));
  rows.forEach((r, i) => (r.sr = i + 1));

  return {
    title,
    category,
    columns: cols.map((c) => c.label),
    availableLabel: display === 'SIZE' ? 'Available size' : 'Available pcs',
    rows,
  };
}

/** Parse the pcs count out of a design sub-category like "8-PCS-FG-22G". */
const pcsFromSub = (sub: string): number | null => {
  const m = /(\d+)\s*-?\s*PCS/i.exec(sub);
  return m ? Number(m[1]) : null;
};

/**
 * Design rates, pivoted a different way than products.
 *
 * A product's price genuinely tends to move with pcs/size, so the wide
 * pcs-by-pcs grid earns its columns there. A design almost always charges ONE
 * rate no matter how many pieces or what size it's printed on — the design fee
 * is per kg, not per pcs — so pivoting it into 4+ near-identical pcs columns is
 * mostly repetition. Each design type collapses to ONE row with ONE rate: the
 * one it's billed at most often across its pcs/size variants (ties go to the
 * cheaper one).
 *
 * Earlier this showed every distinct rate as its own labelled group instead —
 * but pcs is only ever recorded when the sub-category spells out "N-PCS"; sizes
 * that don't (different weights, say) all fall through to the SAME "no pcs
 * recorded" bucket while still carrying genuinely different rates. That printed
 * as two identically-labelled "kg" entries at two different prices on the same
 * row — nothing pcs-related actually explained the split, so it just read as a
 * contradiction. One representative rate avoids manufacturing an explanation
 * the data doesn't have.
 */
export interface DesignRateRow {
  sr: number;
  item: string;
  /** Every pcs/sub-category this design type is available in, cheapest-ordering
   *  re-used from the product pivot so the two sections read consistently. */
  available: string;
  /** The rate this design is billed at most often. */
  rate: number;
  /** Our own rate for that same representative rate (§18). */
  baseRate: number;
  /** The adjustment behind it — 0 when the design is not adjusted (§20). */
  delta: number;
  minRate: number;
  special: boolean;
}
export interface DesignPivotTable {
  title: string;
  category: string;
  /** Header for the Available column, following the category's configuration. */
  availableLabel: string;
  rows: DesignRateRow[];
}

/**
 * The design section's Available column (§14).
 *
 * A design row carries a category, a sub-category and a design type — and no
 * size. Where a product's size is a number on the record, a design's only
 * size-ish information is inside the sub-category string ("10-PCS-FG-22G"), and
 * what that string encodes is the pack and the gauge, not a size. So a category
 * configured for SIZE shows the sub-categories themselves rather than inventing
 * a number: the column is then headed "Available" rather than "Available size",
 * because sub-category is what it is showing.
 */
function pivotDesigns(
  title: string,
  category: string,
  lines: { name: string; pcs: number | null; subCategory: string; rate: number; base: number; delta: number; special?: boolean }[],
  config: RateListConfig | null,
  display: AvailableDisplay,
): DesignPivotTable {
  const byItem = new Map<string, { pcs: number | null; subCategory: string; rate: number; base: number; delta: number }[]>();
  const specials = new Map<string, boolean>();
  for (const l of lines) {
    const arr = byItem.get(l.name) ?? [];
    arr.push({ pcs: l.pcs, subCategory: l.subCategory, rate: r0(l.rate), base: r0(l.base), delta: r0(l.delta) });
    byItem.set(l.name, arr);
    if (l.special) specials.set(l.name, true);
  }

  const rows: DesignRateRow[] = [...byItem.entries()].map(([name, entries]) => {
    const available =
      display === 'SIZE'
        ? [...new Set(entries.map((e) => e.subCategory).filter(Boolean))].sort().join(', ')
        : orderPcs(entries.map((e) => e.pcs))
            .filter((p): p is number => p != null)
            .join(',');
    // Most common rate wins. Tallying in ascending-rate order and only
    // replacing on a STRICTLY higher count means a tie keeps whichever rate was
    // seen first — the cheaper one.
    const counts = new Map<number, number>();
    for (const e of entries) counts.set(e.rate, (counts.get(e.rate) ?? 0) + 1);
    let rate = entries[0].rate;
    let bestCount = 0;
    for (const candidate of [...counts.keys()].sort((a, b) => a - b)) {
      const count = counts.get(candidate)!;
      if (count > bestCount) {
        rate = candidate;
        bestCount = count;
      }
    }
    const minRate = Math.min(...entries.map((e) => e.rate));
    // Our rate for the SAME variant the representative rate came from — pairing
    // it with any other variant's base would invent a difference that is not
    // there.
    const rep = entries.find((e) => e.rate === rate)!;
    return { sr: 0, item: name, available, rate, baseRate: rep.base, delta: rep.delta, minRate, special: specials.get(name) ?? false };
  });

  rows.sort((a, b) => a.minRate - b.minRate || a.item.localeCompare(b.item));
  rows.forEach((r, i) => (r.sr = i + 1));
  return { title, category, availableLabel: display === 'SIZE' ? 'Available' : 'Available pcs', rows };
}

/**
 * A design type that is several designs applied together, e.g. "WL+FULL
 * LASER+TOOL+LOGO".
 *
 * The master holds both the individual designs and every combination of them —
 * on current data, 58 of 79 design types are combinations. Listing them turns a
 * one-page rate card into pages of permutations while telling the customer
 * nothing they can't read off the individual rows, so the sheet carries only the
 * unique designs.
 */
export const isCombinationDesign = (designType: string): boolean => /[+&]/.test(designType);

export interface BuildSectionsOptions {
  /**
   * The configuration in force — the default with the selected party's overrides
   * folded in (§9/§10). Null means "no configuration saved", which reproduces
   * today's sheet exactly: every category, all sub-categories, pieces in the
   * Available column.
   */
  config?: RateListConfig | null;
  /**
   * Categories the user picked for THIS view or download (§3, §4, §25, §26).
   * Null/undefined means everything the configuration allows — the selection is
   * a narrowing on top of the configuration, never a widening of it, so a
   * download can't smuggle back a category the configuration excluded.
   */
  categories?: string[] | null;
  /** Include the design sections. Defaults to the configuration's own answer. */
  includeDesigns?: boolean;
}

export function buildSections(
  list: CustomerRateList,
  opts: BuildSectionsOptions = {},
): { products: PivotTable[]; designs: DesignPivotTable[] } {
  const config = opts.config ?? null;
  const picked = opts.categories?.length ? new Set(opts.categories.map((c) => c.trim().toUpperCase())) : null;
  const wanted = (category: string) => !picked || picked.has((category || 'OTHER').toUpperCase());
  const onSheet = (category: string, subCategory: string) =>
    wanted(category) && (!config || isOnRateList(config, category, subCategory));

  const byCat = <T>(rows: T[], cat: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = cat(r) || 'OTHER';
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  /**
   * Split one category's rows by the Available display each row resolves to.
   *
   * A pivot table has ONE column axis, so rows measured in sizes cannot share a
   * grid with rows measured in pieces — a size would print under a "12pcs"
   * heading. When an override singles out a sub-category or an item, those rows
   * come out as their own table.
   *
   * The common case is one group and nothing changes: same single table, same
   * title. Only when a category genuinely mixes the two does the title gain the
   * unit, so the two tables can be told apart.
   */
  const splitByDisplay = <T>(
    cat: string,
    rows: T[],
    displayOf: (r: T) => AvailableDisplay,
  ): { display: AvailableDisplay; rows: T[]; suffix: string }[] => {
    const groups = new Map<AvailableDisplay, T[]>();
    for (const r of rows) {
      const d = displayOf(r);
      (groups.get(d) ?? groups.set(d, []).get(d)!).push(r);
    }
    // Category default first, so the exception reads as the exception.
    const fallback = config ? availableDisplayFor(config, cat) : 'PCS';
    const order = [...groups.keys()].sort((a, b) => (a === fallback ? -1 : b === fallback ? 1 : a.localeCompare(b)));
    const mixed = groups.size > 1;
    return order.map((d) => ({
      display: d,
      rows: groups.get(d)!,
      suffix: mixed ? (d === 'SIZE' ? ' (BY SIZE)' : ' (BY PCS)') : '',
    }));
  };

  const products = byCat(
    list.products.filter((p) => onSheet(p.category, p.subCategory)),
    (p: CustomerRateListProduct) => p.category,
  )
    .flatMap(([cat, rows]) =>
      splitByDisplay(cat, rows, (p) =>
        availableDisplayForLine(config, { category: p.category, subCategory: p.subCategory, item: p.product, kind: 'PRODUCT' }),
      ).map((g) =>
        pivot(
          `${cat} — RATE LIST${g.suffix}`,
          cat,
          g.rows.map((p) => ({
            name: p.product,
            pcs: p.pcs,
            size: p.size,
            subCategory: p.subCategory,
            rate: p.rate,
            base: p.baseRate,
            delta: p.delta,
            special: p.delta !== 0,
          })),
          config,
          g.display,
        ),
      ),
    )
    .filter((t) => t.rows.length > 0);

  // Only the unique designs reach the sheet — combinations are dropped here, so
  // the PDF, the Excel export and the on-screen preview can never disagree.
  const includeDesigns = opts.includeDesigns ?? config?.includeDesigns ?? true;
  const uniqueDesigns = includeDesigns
    ? list.designs.filter((d) => !isCombinationDesign(d.designType) && onSheet(d.category, d.subCategory))
    : [];
  const designs = byCat(uniqueDesigns, (d: CustomerRateListDesign) => d.category)
    .flatMap(([cat, rows]) =>
      splitByDisplay(cat, rows, (d) =>
        availableDisplayForLine(config, { category: d.category, subCategory: d.subCategory, item: d.designType, kind: 'DESIGN' }),
      ).map((g) =>
        pivotDesigns(
          `RATE OF DESIGNS ON ${cat} (per kg)${g.suffix}`,
          cat,
          g.rows.map((d) => ({
            name: d.designType,
            pcs: pcsFromSub(d.subCategory),
            subCategory: d.subCategory,
            rate: d.rate,
            base: d.baseRate,
            delta: d.delta,
            special: d.delta !== 0,
          })),
          config,
          g.display,
        ),
      ),
    )
    // A category whose designs were all combinations would otherwise print an
    // empty table under a heading.
    .filter((t) => t.rows.length > 0);
  return { products, designs };
}

/** Every category present in a rate list, products and designs together — what
 *  the category filter and the download picker offer (§3, §4). */
export function rateListCategories(list: CustomerRateList): string[] {
  const set = new Set<string>();
  for (const p of list.products) set.add(p.category || 'OTHER');
  for (const d of list.designs) if (!isCombinationDesign(d.designType)) set.add(d.category || 'OTHER');
  return [...set].sort((a, b) => a.localeCompare(b));
}
