import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge class names, resolving Tailwind conflicts. Used by every shadcn component. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** YYYY-MM-DD stamp for export filenames. */
export function dateStamp(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
