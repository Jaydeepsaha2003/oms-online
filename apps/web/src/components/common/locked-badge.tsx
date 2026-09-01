import { Lock } from 'lucide-react';

/**
 * "Someone else has this line open right now" — shared by every screen that
 * reads DispatchService's line lock (Dispatch Order, and Pending Challan,
 * which shows the same lock on the dispatch a locked order line already
 * produced). One component so the two never drift apart visually.
 */
export const LockedBadge = ({ name }: { name: string }) => (
  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-400/25">
    <Lock className="size-3" />
    {name}
  </span>
);
