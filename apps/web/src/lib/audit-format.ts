/** Shared display formatting for audit log entries — used by the Activity Log
 *  page and by the per-record RecordHistory control so both read identically. */
import { ACTIONS, RESOURCE_DEFINITIONS } from '@oms/shared';

const RESOURCE_LABEL = new Map<string, string>(RESOURCE_DEFINITIONS.map((d) => [d.resource, d.label]));
export const resourceLabel = (key: string) => RESOURCE_LABEL.get(key) ?? key;

const ACTION_LABEL: Record<string, string> = {
  [ACTIONS.VIEW]: 'Viewed',
  [ACTIONS.CREATE]: 'Created',
  [ACTIONS.UPDATE]: 'Updated',
  [ACTIONS.DELETE]: 'Deleted',
  [ACTIONS.EXPORT]: 'Exported',
  [ACTIONS.IMPORT]: 'Imported',
  [ACTIONS.APPROVE]: 'Approved',
  [ACTIONS.PRINT]: 'Printed',
  [ACTIONS.CONVERT]: 'Converted',
  [ACTIONS.CANCEL]: 'Cancelled',
  login: 'Logged in',
  logout: 'Logged out',
  login_failed: 'Login failed',
  sent: 'Sent',
  post: 'Created',
  patch: 'Updated',
  put: 'Updated',
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a.charAt(0).toUpperCase() + a.slice(1);

const ACTION_COLOR: Record<string, string> = {
  [ACTIONS.CREATE]: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  post: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  [ACTIONS.UPDATE]: 'bg-sky-50 text-sky-700 ring-sky-200',
  patch: 'bg-sky-50 text-sky-700 ring-sky-200',
  put: 'bg-sky-50 text-sky-700 ring-sky-200',
  [ACTIONS.DELETE]: 'bg-rose-50 text-rose-700 ring-rose-200',
  [ACTIONS.CANCEL]: 'bg-rose-50 text-rose-700 ring-rose-200',
  login_failed: 'bg-rose-50 text-rose-700 ring-rose-200',
  [ACTIONS.CONVERT]: 'bg-amber-50 text-amber-700 ring-amber-200',
  sent: 'bg-sky-50 text-sky-700 ring-sky-200',
  [ACTIONS.EXPORT]: 'bg-violet-50 text-violet-700 ring-violet-200',
  [ACTIONS.IMPORT]: 'bg-violet-50 text-violet-700 ring-violet-200',
  login: 'bg-slate-100 text-slate-700 ring-slate-200',
  logout: 'bg-slate-100 text-slate-700 ring-slate-200',
};
export const actionColor = (a: string) => ACTION_COLOR[a] ?? 'bg-slate-100 text-slate-700 ring-slate-200';

// dd/mm/yyyy, HH:MM.
export const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${time}`;
};

export function statusColor(code: number | null | undefined): string {
  if (code == null) return 'text-muted-foreground';
  if (code >= 500) return 'font-semibold text-red-600';
  if (code >= 400) return 'font-semibold text-amber-600';
  return 'text-emerald-700';
}
