import { useEffect, useReducer } from 'react';

export interface DateFormatOption {
  id: string;
  /** Example rendering of this format, shown in the picker. */
  label: string;
}

/** The date formats a user can choose from (label = a sample date). */
// Digits-and-separators only — the month-name formats ("21 Jun 2026") are gone so
// no date anywhere in the system can render with spaces in it.
export const DATE_FORMATS: DateFormatOption[] = [
  { id: 'dmyDash', label: '21-06-2026' },
  { id: 'dmyDash2', label: '21-06-26' },
  { id: 'dmy', label: '21/06/2026' },
  { id: 'dmy2', label: '21/06/26' },
  { id: 'mdy', label: '06/21/2026' },
  { id: 'ymd', label: '2026-06-21' },
];

// Bumped whenever the system-wide default changes: the suffix retires the format a
// browser had already saved, so everyone picks up the new default instead of being
// stuck on their previous choice. (v2 was the short-lived dd-mm-yy default.)
const KEY = 'oms:date-format:v3';
// dd-mm-yyyy (e.g. 21-06-2026) — the system-wide default. Every list view, filter,
// account ledger, date picker and printed document reads this unless the user
// picks another format in Settings.
const DEFAULT = 'dmyDash';

let current = (() => {
  try {
    return localStorage.getItem(KEY) || DEFAULT;
  } catch {
    return DEFAULT;
  }
})();
const listeners = new Set<() => void>();

export function getDateFormat(): string {
  return current;
}

export function setDateFormat(id: string): void {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** Format a date using the user's chosen format (or an explicit one). */
export function formatDate(value: string | Date | null | undefined, fmt: string = current): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  const dd = String(day).padStart(2, '0');
  const mm = String(month + 1).padStart(2, '0');
  switch (fmt) {
    case 'dmyDash2':
      return `${dd}-${mm}-${String(year).slice(2)}`;
    case 'dmy2':
      return `${dd}/${mm}/${String(year).slice(2)}`;
    case 'dmy':
      return `${dd}/${mm}/${year}`;
    case 'mdy':
      return `${mm}/${dd}/${year}`;
    case 'ymd':
      return `${year}-${mm}-${dd}`;
    // dd-mm-yyyy is both a real choice and the fallback: an unrecognised id (a
    // preference saved by an older build, or anything unexpected) must never
    // silently render a spaced, month-name date — every date in the system reads
    // as digits and dashes only.
    case 'dmyDash':
    default:
      return `${dd}-${mm}-${year}`;
  }
}

/**
 * Subscribe a component to the chosen date format. Returns the current format,
 * a setter, and the formatter. Re-renders the component when the format changes.
 */
export function useDateFormat() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
  return { format: current, setFormat: setDateFormat, formatDate };
}
