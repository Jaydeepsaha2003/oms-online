import { History, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import type { RateHistoryEntry } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRecentTransRateChanges } from './use-trans-rates';

const money = (v: number | null | undefined) => (v == null ? '—' : `₹${v.toLocaleString('en-IN')}`);

/**
 * "What did we change lately?" across every transporter rate (spec §5.2).
 *
 * The per-row History button already answers "what happened to THIS rate", but
 * it needs you to know which row to look at. This is the other question — the
 * one you ask after a bulk change, when you want to remember what you just did.
 *
 * Loaded only when opened; the list is capped server-side at the 500 most recent.
 */
export function RecentChangesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data = [], isLoading } = useRecentTransRateChanges(open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(96vw,58rem)] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <History className="size-4 text-indigo-600" /> Recent rate changes
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Every transporter-rate change, newest first — so you can see at a glance what was changed recently and by whom.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="text-muted-foreground grid place-items-center py-12">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-[13px]">No rate changes recorded yet.</p>
        ) : (
          <div className="max-h-[58vh] overflow-auto rounded-[4px] border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/60 sticky top-0">
                <tr className="text-muted-foreground text-left text-[10.5px] font-bold tracking-widest uppercase">
                  <th className="px-3 py-2">Party</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="hidden px-3 py-2 sm:table-cell">Transporter</th>
                  <th className="px-3 py-2 text-right">Old</th>
                  <th className="px-3 py-2 text-right">New</th>
                  <th className="px-3 py-2 text-right">Change</th>
                  <th className="px-3 py-2">When</th>
                  <th className="hidden px-3 py-2 sm:table-cell">By</th>
                </tr>
              </thead>
              <tbody>
                {data.map((h: RateHistoryEntry) => {
                  const diff = (h.newRate ?? 0) - (h.oldRate ?? 0);
                  const up = diff > 0;
                  return (
                    <tr key={h.id} className="border-t even:bg-slate-50/70 dark:even:bg-white/[0.03]">
                      <td className="px-3 py-1.5 font-semibold text-slate-900 dark:text-slate-100">{h.customerName}</td>
                      <td className="text-muted-foreground px-3 py-1.5">{h.category || '—'}</td>
                      <td className="px-3 py-1.5">
                        <span className="bg-muted rounded px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide uppercase">
                          {h.type || '—'}
                        </span>
                      </td>
                      <td className="text-muted-foreground hidden px-3 py-1.5 sm:table-cell">{h.transportName || '—'}</td>
                      <td className="text-muted-foreground px-3 py-1.5 text-right font-medium tabular-nums">{money(h.oldRate)}</td>
                      <td className="px-3 py-1.5 text-right font-bold tabular-nums text-slate-900 dark:text-slate-100">
                        {money(h.newRate)}
                      </td>
                      {/* Freight going UP costs us more, so the colours here read
                          as cost — the opposite of the customer-rate screens,
                          where up means we charge more. */}
                      <td
                        className={cn(
                          'px-3 py-1.5 text-right font-bold tabular-nums',
                          diff === 0 ? 'text-muted-foreground/50' : up ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400',
                        )}
                      >
                        {diff === 0 ? (
                          '—'
                        ) : (
                          <span className="inline-flex items-center gap-0.5">
                            {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                            {up ? '+' : '−'}
                            {Math.abs(diff).toLocaleString('en-IN')}
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground px-3 py-1.5 text-[12px] whitespace-nowrap tabular-nums">
                        {formatDateTime(h.changedAt)}
                      </td>
                      <td className="text-muted-foreground hidden px-3 py-1.5 sm:table-cell">{h.changedByName || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
