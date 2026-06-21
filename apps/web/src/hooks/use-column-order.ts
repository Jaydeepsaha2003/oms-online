import { useEffect, useMemo, useState } from 'react';

/** A table column that can be reordered/hidden. `fixed` columns are always shown
 * first and can't be moved or hidden (e.g. frozen identity columns). */
export interface OrderableColumn {
  id: string;
  label: string;
  fixed?: boolean;
}

interface Saved {
  order: string[];
  hidden: string[];
}

function load(key: string): Saved | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

/**
 * Per-table column ordering + visibility, persisted to localStorage.
 *
 * @param key      stable storage key for this table (e.g. 'customers')
 * @param columns  the full column set (module-level constant for a stable identity)
 */
export function useColumnOrder<C extends OrderableColumn>(key: string, columns: C[]) {
  const storageKey = `oms:cols:${key}`;
  const reorderable = useMemo(() => columns.filter((c) => !c.fixed), [columns]);
  const fixed = useMemo(() => columns.filter((c) => c.fixed), [columns]);

  const saved = useMemo(() => load(storageKey), [storageKey]);
  const [order, setOrder] = useState<string[]>(() => saved?.order ?? reorderable.map((c) => c.id));
  const [hidden, setHidden] = useState<string[]>(() => saved?.hidden ?? []);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ order, hidden }));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [storageKey, order, hidden]);

  // Apply the saved order to the reorderable set; unknown ids dropped, new appended.
  const orderedReorderable = useMemo(() => {
    const byId = new Map(reorderable.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const out: C[] = [];
    for (const id of order) {
      const c = byId.get(id);
      if (c) {
        out.push(c);
        seen.add(id);
      }
    }
    for (const c of reorderable) if (!seen.has(c.id)) out.push(c);
    return out;
  }, [reorderable, order]);

  const visibleColumns = useMemo(
    () => [...fixed, ...orderedReorderable.filter((c) => !hidden.includes(c.id))],
    [fixed, orderedReorderable, hidden],
  );

  const ids = () => orderedReorderable.map((c) => c.id);

  /** Move `srcId` to sit just before `targetId` (used by drag-and-drop). */
  const moveBefore = (srcId: string, targetId: string) => {
    if (srcId === targetId) return;
    const arr = ids();
    const from = arr.indexOf(srcId);
    if (from < 0) return;
    arr.splice(from, 1);
    const to = arr.indexOf(targetId);
    arr.splice(to < 0 ? arr.length : to, 0, srcId);
    setOrder(arr);
  };

  /** Nudge a column up (-1) or down (+1) the list. */
  const move = (id: string, dir: -1 | 1) => {
    const arr = ids();
    const i = arr.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setOrder(arr);
  };

  const toggle = (id: string) =>
    setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));

  const reset = () => {
    setOrder(reorderable.map((c) => c.id));
    setHidden([]);
  };

  return { visibleColumns, orderedReorderable, hidden, moveBefore, move, toggle, reset };
}
