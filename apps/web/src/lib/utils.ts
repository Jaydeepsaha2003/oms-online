import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
// Safe: date-format only depends on React, so there's no import cycle here.
import { formatDate } from '@/lib/date-format';

/** Merge class names, resolving Tailwind conflicts. Used by every shadcn component. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** YYYY-MM-DD stamp for export filenames. */
export function dateStamp(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Short order number for display: "ORD-01160" → "1160" (drop the ORD- prefix and
 * leading zeros). Falls back to "#<id>" when there's no usable code, or the raw
 * code if stripping leaves it empty. Used everywhere an order is shown.
 */
export function shortOrderCode(code: string | null | undefined, id?: number | string | null): string {
  if (code) {
    const stripped = code.replace(/^ORD-0*/i, '');
    if (stripped) return stripped;
    return code;
  }
  return id != null && id !== '' ? `#${id}` : '—';
}

/**
 * Short dispatch number for display: "DSP-04090" → "4090" (drop the DSP- prefix
 * and leading zeros), same convention as {@link shortOrderCode}. Falls back to
 * "#<id>" when there's no usable code, or the raw code if stripping leaves it
 * empty. Used on the Modify Dispatch grid/cards so the ID column stays narrow.
 */
export function shortDispatchCode(code: string | null | undefined, id?: number | string | null): string {
  if (code) {
    const stripped = code.replace(/^DSP-0*/i, '');
    if (stripped) return stripped;
    return code;
  }
  return id != null && id !== '' ? `#${id}` : '—';
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Human-readable date + time in the system-wide date format — e.g. "20-06-26, 09:10 PM".
 *  Returns "—" if empty/invalid. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${formatDate(d)}, ${time}`;
}

/** Compact date + time, year omitted — e.g. "20-06, 09:10 PM". Dash-separated to match
 *  the system-wide dd-mm-yy format. For table cells; pair with {@link formatDateTime}
 *  in a tooltip/form to show the full date. */
export function formatDateShort(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}, ${time}`;
}
