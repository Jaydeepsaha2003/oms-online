/**
 * Rate List pivot engine — shared by the on-screen preview and the PDF/Excel
 * exporters.
 *
 * Mirrors the printed "RATE LIST" workbook layout: one row per ITEM with the
 * rates PIVOTED into pcs columns —
 *   SR | ITEM | AVAILABLE PCS | 8pcs/10pcs | 12pcs | 15pcs | 6pcs
 * Adjacent pcs columns whose rates always agree are merged into one column
 * (that's where the legacy "8pcs/10pcs" heading comes from). Each product
 * category gets its own section; designs-on-glass follow as their own pivot.
 */
import type { CustomerRateList, CustomerRateListDesign, CustomerRateListProduct } from '@oms/shared';

const r0 = (v: number) => Math.round(v);

export interface PivotRow {
  sr: number;
  item: string;
  available: string;
  /** One display value per column ('' when the item has no rate there). */
  cells: string[];
  minRate: number;
  /** True when any line of this item carries the customer's special-rate delta. */
  special: boolean;
}
export interface PivotTable {
  title: string;
  columns: string[]; // header labels for the rate columns
  rows: PivotRow[];
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

const pcsLabel = (p: number | null) => (p == null ? 'RATE' : `${p}pcs`);

/** Compact header for a (possibly merged) pcs column: "8pcs", "8pcs/10pcs",
 *  and for 3+ merged packs a range like "1–6pcs" so headers never overflow. */
function columnLabel(pcs: (number | null)[]): string {
  const nums = pcs.filter((p): p is number => p != null).sort((a, b) => a - b);
  if (nums.length === 0) return 'RATE';
  if (nums.length === 1) return `${nums[0]}pcs`;
  if (nums.length === 2) return `${nums[0]}pcs/${nums[1]}pcs`;
  return `${nums[0]}–${nums[nums.length - 1]}pcs`;
}

/** Pivot one category's lines into the SR/ITEM/AVAILABLE/rate-by-pcs table. */
function pivot(title: string, lines: { name: string; pcs: number | null; rate: number; special?: boolean }[]): PivotTable {
  // item → pcs → set of distinct effective rates (different sizes/sub-cats can
  // rate the same pcs differently; the legacy sheet showed those side by side —
  // we join them with " / " in the one cell).
  const items = new Map<string, Map<number | null, Set<number>>>();
  const specials = new Map<string, boolean>();
  for (const l of lines) {
    const byPcs = items.get(l.name) ?? new Map<number | null, Set<number>>();
    const set = byPcs.get(l.pcs) ?? new Set<number>();
    set.add(r0(l.rate));
    byPcs.set(l.pcs, set);
    items.set(l.name, byPcs);
    if (l.special) specials.set(l.name, true);
  }

  let pcsCols = orderPcs(lines.map((l) => l.pcs)).map((p) => ({ label: pcsLabel(p), pcs: [p] as (number | null)[] }));

  // Merge adjacent pcs columns when every item's rates agree (or one side is
  // empty) — reproduces "8pcs/10pcs" without hard-coding it.
  const canMerge = (a: (number | null)[], b: (number | null)[]) =>
    [...items.values()].every((byPcs) => {
      const ra = [...new Set(a.flatMap((p) => [...(byPcs.get(p) ?? [])]))].sort();
      const rb = [...new Set(b.flatMap((p) => [...(byPcs.get(p) ?? [])]))].sort();
      return ra.length === 0 || rb.length === 0 || JSON.stringify(ra) === JSON.stringify(rb);
    });
  for (let i = 0; i < pcsCols.length - 1; ) {
    const a = pcsCols[i];
    const b = pcsCols[i + 1];
    if (a.pcs[0] != null && b.pcs[0] != null && canMerge(a.pcs, b.pcs)) {
      pcsCols.splice(i, 2, { label: `${a.label}/${b.label}`, pcs: [...a.pcs, ...b.pcs] });
    } else i++;
  }
  // Drop columns that ended up entirely empty, then re-label the merged ones
  // compactly (3+ merged packs become a range like "1–6pcs").
  pcsCols = pcsCols.filter((c) => [...items.values()].some((byPcs) => c.pcs.some((p) => byPcs.has(p))));
  for (const c of pcsCols) c.label = columnLabel(c.pcs);

  const rows: PivotRow[] = [...items.entries()].map(([name, byPcs]) => {
    const cells = pcsCols.map((c) => {
      const rates = [...new Set(c.pcs.flatMap((p) => [...(byPcs.get(p) ?? [])]))].sort((x, y) => x - y);
      return rates.length ? rates.join(' / ') : '';
    });
    const allRates = [...byPcs.values()].flatMap((s) => [...s]);
    const available = orderPcs([...byPcs.keys()])
      .filter((p): p is number => p != null)
      .join(',');
    return { sr: 0, item: name, available, cells, minRate: Math.min(...allRates), special: specials.get(name) ?? false };
  });

  // The printed list runs cheapest-first, then A→Z.
  rows.sort((a, b) => a.minRate - b.minRate || a.item.localeCompare(b.item));
  rows.forEach((r, i) => (r.sr = i + 1));

  return { title, columns: pcsCols.map((c) => c.label), rows };
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
  /** Every pcs/size this design type is available in, cheapest-ordering re-used
   *  from the product pivot so the two sections read consistently. */
  available: string;
  /** The rate this design is billed at most often. */
  rate: number;
  minRate: number;
  special: boolean;
}
export interface DesignPivotTable {
  title: string;
  rows: DesignRateRow[];
}

function pivotDesigns(title: string, lines: { name: string; pcs: number | null; rate: number; special?: boolean }[]): DesignPivotTable {
  const byItem = new Map<string, { pcs: number | null; rate: number }[]>();
  const specials = new Map<string, boolean>();
  for (const l of lines) {
    const arr = byItem.get(l.name) ?? [];
    arr.push({ pcs: l.pcs, rate: r0(l.rate) });
    byItem.set(l.name, arr);
    if (l.special) specials.set(l.name, true);
  }

  const rows: DesignRateRow[] = [...byItem.entries()].map(([name, entries]) => {
    const available = orderPcs(entries.map((e) => e.pcs))
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
    return { sr: 0, item: name, available, rate, minRate, special: specials.get(name) ?? false };
  });

  rows.sort((a, b) => a.minRate - b.minRate || a.item.localeCompare(b.item));
  rows.forEach((r, i) => (r.sr = i + 1));
  return { title, rows };
}

export function buildSections(list: CustomerRateList): { products: PivotTable[]; designs: DesignPivotTable[] } {
  const byCat = <T>(rows: T[], cat: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = cat(r) || 'OTHER';
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  const products = byCat(list.products, (p: CustomerRateListProduct) => p.category).map(([cat, rows]) =>
    pivot(`${cat} — RATE LIST`, rows.map((p) => ({ name: p.product, pcs: p.pcs, rate: p.rate, special: p.delta !== 0 }))),
  );
  const designs = byCat(list.designs, (d: CustomerRateListDesign) => d.category).map(([cat, rows]) =>
    pivotDesigns(
      `RATE OF DESIGNS ON ${cat} (per kg)`,
      rows.map((d) => ({ name: d.designType, pcs: pcsFromSub(d.subCategory), rate: d.rate, special: d.delta !== 0 })),
    ),
  );
  return { products, designs };
}
