import { useEffect, useReducer } from 'react';

/**
 * User preference: auto-detect Size vs Pcs from what's typed in the order form's
 * Item name field. ON (default) hides the manual Size/Pcs radio and flips it
 * automatically; OFF shows the radio for manual selection. Stored per-browser.
 */
const KEY = 'oms:auto-size-pcs';

let current = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off'; // default ON
  } catch {
    return true;
  }
})();
const listeners = new Set<() => void>();

export function getAutoSizePcs(): boolean {
  return current;
}

export function setAutoSizePcs(on: boolean): void {
  current = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** Subscribe a component to the preference; re-renders when it changes. */
export function useAutoSizePcs() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
  return { autoSizePcs: current, setAutoSizePcs };
}

/** Word boundaries inside an item name: spaces, brackets, plus, slash, dash. */
const NAME_SEP = /[\s(),+/-]+/;

/** The fields of an item option this decision actually reads. */
export type SizePcsItem = {
  product: string;
  designType: string | null;
  size: number | null;
  pcs: number | null;
};

const wordsOf = (it: SizePcsItem) =>
  `${it.product} ${it.designType ?? ''}`.toLowerCase().split(NAME_SEP).filter(Boolean);

/**
 * Decide whether the number leading the Item name field is a SIZE or a PCS
 * count, so the picker can label its options with the one the user meant.
 * Returns null to leave the current mode alone (nothing typed yet, no leading
 * number, or nothing in the catalogue to judge against).
 *
 * The leading number is judged against ONLY the products whose name matches
 * what was typed after it — so "15 RAJWADI" is settled by RAJWADI's own sizes
 * (5.5/6.5/7) and pcs (15/12/10), not by unrelated products that happen to come
 * in a 15-inch size.
 */
export function detectSizeOrPcs(text: string, items: readonly SizePcsItem[]): 'SIZE' | 'PCS' | null {
  const t = text.trim();
  const lead = t.match(/^(\d+(?:\.\d+)?)/)?.[1];
  if (!lead || !items.length) return null;

  const nameTerms = t.slice(lead.length).trim().toLowerCase().split(NAME_SEP).filter(Boolean);
  const named = nameTerms.length
    ? items.filter((it) => {
        const words = wordsOf(it);
        return nameTerms.every((q) => words.some((w) => w.startsWith(q)));
      })
    : items;
  const pool = named.length ? named : items;
  const some = (key: 'size' | 'pcs', test: (v: string) => boolean) =>
    pool.some((it) => it[key] != null && test(String(it[key])));

  const sizeExact = some('size', (v) => v === lead);
  const pcsExact = some('pcs', (v) => v === lead);
  if (pcsExact && !sizeExact) return 'PCS';
  if (sizeExact && !pcsExact) return 'SIZE';
  if (sizeExact || pcsExact) {
    // Both readings have an exact hit, so the number alone cannot settle it —
    // ask which reading the NAME points at. "8 RDX" finds size 8 only on RDX
    // CUP (a different, longer-named product) but pcs 8 on RDX itself, and the
    // whole name having been typed is the stronger signal: the user asked for
    // the 8-pcs RDX, not the RDX CUP. Only a whole-name Pcs hit beating a
    // part-name Size hit flips it; anything else stays on Size as before.
    const whole = (key: 'size' | 'pcs') =>
      pool.some((it) => {
        if (it[key] == null || String(it[key]) !== lead) return false;
        const words = wordsOf(it);
        return words.length > 0 && words.every((w) => nameTerms.some((q) => w.startsWith(q)));
      });
    if (whole('pcs') && !whole('size')) return 'PCS';
    return 'SIZE';
  }

  // Mid-number (still typing): fall back to a prefix match within the same pool.
  const sizePre = some('size', (v) => v.startsWith(lead));
  const pcsPre = some('pcs', (v) => v.startsWith(lead));
  if (pcsPre && !sizePre) return 'PCS';
  if (sizePre) return 'SIZE';
  return null;
}
