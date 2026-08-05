import { useEffect, useState } from 'react';

/** Row-count choices offered by every paginated table's page-size selector. */
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
export const DEFAULT_LIST_PAGE_SIZE = 50;

function load(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Per-table "rows per page" choice, persisted to localStorage — same pattern
 * as {@link useColumnOrder}. Defaults to 50 and resets to page 1 whenever the
 * size actually changes (a stale page number would otherwise land past the
 * new last page, or silently repeat rows already seen on the previous size).
 *
 * @param key stable storage key for this table (e.g. 'dispatch-modify')
 * @param defaultSize rows/page when nothing is saved yet (default 50)
 * @param initialPage seeds the starting page — for a page that restores its own
 *   filters (incl. page number) from session/local storage, so that restore
 *   isn't clobbered by this hook always starting at 1
 */
export function usePageSize(key: string, defaultSize: number = DEFAULT_LIST_PAGE_SIZE, initialPage: number = 1) {
  const storageKey = `oms:page-size:${key}`;
  const [pageSize, setPageSizeRaw] = useState<number>(() => load(storageKey) ?? defaultSize);
  const [page, setPage] = useState(initialPage);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(pageSize));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [storageKey, pageSize]);

  const setPageSize = (n: number) => {
    setPageSizeRaw(n);
    setPage(1);
  };

  return { page, setPage, pageSize, setPageSize };
}
