/**
 * System-wide date formatting for server-rendered output (PDFs, Excel exports).
 *
 * The web app has its own preference-based formatter; the server has no user
 * context, so it renders the system default — dd-mm-yyyy (e.g. 01-08-2026) — to
 * match what the app shows on screen. Keep this the single source for API date
 * strings so a future format change is one edit, not a hunt across services.
 */
const pad = (n: number) => String(n).padStart(2, '0');

/** dd-mm-yyyy, or a fallback (default '—') for null / unparseable input. */
export function formatDate(value?: string | Date | null, fallback = '—'): string {
  if (!value) return fallback;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return fallback;
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}
