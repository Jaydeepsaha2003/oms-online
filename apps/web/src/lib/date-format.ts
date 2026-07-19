import { useEffect, useReducer } from 'react';

export interface DateFormatOption {
  id: string;
  /** Example rendering of this format, shown in the picker. */
  label: string;
}

/** The date formats a user can choose from (label = a sample date). */
export const DATE_FORMATS: DateFormatOption[] = [
  { id: 'dmy2', label: '21/06/26' },
  { id: 'dmmmy', label: '21 Jun 2026' },
  { id: 'dmmy', label: '21 Jun 26' },
  { id: 'dmyDash', label: '21-06-2026' },
  { id: 'dmy', label: '21/06/2026' },
  { id: 'mdy', label: '06/21/2026' },
  { id: 'ymd', label: '2026-06-21' },
];

const KEY = 'oms:date-format';
// dd/mm/yyyy — the default across every list-view table (Orders, Quotations,
// Order Modify, Dispatch, and anywhere else that reads the shared preference).
const DEFAULT = 'dmy';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
    case 'dmy2':
      return `${dd}/${mm}/${String(year).slice(2)}`;
    case 'dmmy':
      return `${day} ${MONTHS[month]} ${String(year).slice(2)}`;
    case 'dmyDash':
      return `${dd}-${mm}-${year}`;
    case 'dmy':
      return `${dd}/${mm}/${year}`;
    case 'mdy':
      return `${mm}/${dd}/${year}`;
    case 'ymd':
      return `${year}-${mm}-${dd}`;
    case 'dmmmy':
    default:
      return `${day} ${MONTHS[month]} ${year}`;
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
