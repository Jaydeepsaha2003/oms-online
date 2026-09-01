import { useMemo, useState } from 'react';
import { Loader2, PencilRuler, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { BULK_CUSTOMER_COLUMNS, type BulkCustomerColumn, type BulkCustomerValues, type CustomerDto, type CustomerLookups } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/common/confirm';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useBulkUpdateCustomers, useBulkUpdateCustomersPreview, useCustomerLookups } from './use-customers';

/** Column → the label on screen and which lookup list fills its dropdown. */
const COLUMN_META: Record<BulkCustomerColumn, { label: string; options: (l: CustomerLookups | undefined) => string[] }> = {
  partySource: { label: 'Party source', options: (l) => l?.partySources ?? [] },
  payBy: { label: 'Pay by', options: (l) => l?.payBys ?? [] },
  agentName: { label: 'Agent', options: (l) => l?.agents ?? [] },
  category: { label: 'Category', options: (l) => l?.categories ?? [] },
  brand: { label: 'Brand', options: (l) => l?.brands ?? [] },
  city: { label: 'City', options: (l) => l?.cities ?? [] },
  state: { label: 'State', options: (l) => l?.states ?? [] },
  region: { label: 'Region', options: (l) => l?.regions ?? [] },
};

/**
 * Set one or more of the dropdown-backed columns across the selected parties.
 *
 * Three things keep a write this wide honest:
 *
 *  1. The preview is not optional — it runs as soon as a column has a value, so
 *     the exact before→after rows are on screen before Apply is reachable.
 *  2. Blank means "leave that column alone", never "clear it". A bulk editor
 *     that empties a column across 100 rows because a field went untouched is a
 *     footgun; clearing stays a per-customer edit.
 *  3. The server plans and applies through the same code, and refuses the whole
 *     write if any party is blocked — a bulk change that quietly does 20 of 23
 *     is worse than one that does none.
 *
 * Transporter is deliberately absent: picking one also rewrites the party's
 * packing and freight, so it is a freight-cost change wearing a dropdown's
 * clothes.
 */
export function BulkEditDialog({ customers, onClose }: { customers: CustomerDto[]; onClose: () => void }) {
  const { data: lookups } = useCustomerLookups();
  const confirm = useConfirm();
  const apply = useBulkUpdateCustomers();

  const [values, setValues] = useState<BulkCustomerValues>({});

  const ids = useMemo(() => customers.map((c) => c.id), [customers]);
  // Only columns actually given a value are sent; the rest are left alone.
  const set = useMemo(() => {
    const out: BulkCustomerValues = {};
    for (const col of BULK_CUSTOMER_COLUMNS) {
      const v = values[col]?.trim();
      if (v) out[col] = v;
    }
    return out;
  }, [values]);

  const chosen = Object.keys(set) as BulkCustomerColumn[];
  const input = chosen.length && ids.length ? { ids, set } : null;
  const { data: plan, isFetching } = useBulkUpdateCustomersPreview(input);

  const blocked = plan?.blocked ?? [];
  const canApply = !!plan && plan.affected > 0 && blocked.length === 0 && !apply.isPending;

  const run = async () => {
    if (!input || !canApply || !plan) return;
    const cols = chosen.map((c) => COLUMN_META[c].label).join(', ');
    const ok = await confirm({
      title: `Update ${plan.affected} customer${plan.affected === 1 ? '' : 's'}?`,
      description: [`${cols} will be rewritten on ${plan.affected} part${plan.affected === 1 ? 'y' : 'ies'}.`, ...plan.warnings].join(' '),
      confirmText: 'Apply',
      destructive: plan.warnings.length > 0,
    });
    if (!ok) return;
    apply.mutate(input, {
      onSuccess: (r) => {
        toast.success(`${r.updated} customer${r.updated === 1 ? '' : 's'} updated`);
        onClose();
      },
      onError: (e) => toast.error(getApiErrorMessage(e, 'Could not apply the change')),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(96vw,48rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilRuler className="text-primary size-5" /> Bulk edit
          </DialogTitle>
          <DialogDescription>
            Set the dropdown columns on the <span className="text-foreground font-bold">{customers.length.toLocaleString('en-IN')}</span>{' '}
            selected part{customers.length === 1 ? 'y' : 'ies'}. Leave a column blank to leave it untouched. Transporter is not here — it
            also rewrites packing and freight, so it stays a per-customer edit.
          </DialogDescription>
        </DialogHeader>

        {/* ── the columns ── */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BULK_CUSTOMER_COLUMNS.map((col) => (
            <div key={col} className="space-y-1">
              <Label className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">{COLUMN_META[col].label}</Label>
              <NativeSelect
                value={values[col] ?? ''}
                onChange={(v) => setValues((s) => ({ ...s, [col]: v }))}
                options={['', ...COLUMN_META[col].options(lookups)]}
                placeholder="Leave unchanged"
                className={cn('h-9', values[col] && 'border-amber-500 bg-amber-50 font-semibold dark:bg-amber-400/10')}
              />
            </div>
          ))}
        </div>

        {/* ── what it will do ── */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {!chosen.length ? (
            <p className="text-muted-foreground py-6 text-center text-[13px] font-medium">Pick a value above to see what will change.</p>
          ) : isFetching && !plan ? (
            <p className="text-muted-foreground py-6 text-center text-[13px] font-medium">
              <Loader2 className="mr-1 inline size-3.5 animate-spin align-[-2px]" /> Working out what changes…
            </p>
          ) : (
            <>
              {blocked.length > 0 && (
                <div className="rounded-[4px] border border-rose-300 bg-rose-50 p-2.5 dark:border-rose-400/40 dark:bg-rose-500/10">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-rose-800 dark:text-rose-300">
                    <TriangleAlert className="size-4" /> {blocked.length} part{blocked.length === 1 ? 'y' : 'ies'} cannot take this change
                  </p>
                  <p className="mt-1 text-[12px] font-medium text-rose-700 dark:text-rose-300/90">{blocked[0].reason}</p>
                  <p className="mt-1.5 text-[12px] font-semibold text-rose-800 dark:text-rose-300">
                    {blocked.map((b) => b.partyName ?? `#${b.id}`).join(', ')}
                  </p>
                  <p className="mt-1.5 text-[11.5px] font-medium text-rose-700/80 dark:text-rose-300/70">
                    Nothing is written while any party is blocked. Deselect them, or set the missing column in this same change.
                  </p>
                </div>
              )}

              {plan?.warnings.map((w) => (
                <div key={w} className="rounded-[4px] border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-400/40 dark:bg-amber-400/10">
                  <p className="flex items-start gap-1.5 text-[12px] font-semibold text-amber-900 dark:text-amber-200">
                    <TriangleAlert className="mt-px size-4 shrink-0" /> {w}
                  </p>
                </div>
              ))}

              {plan && plan.affected === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-[13px] font-medium">
                  Every selected party already holds these values — nothing to change.
                </p>
              ) : (
                plan && (
                  <div className="overflow-hidden rounded-[4px] border">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="bg-muted/60 text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">
                          <th className="px-2.5 py-1.5 text-left">Customer</th>
                          <th className="px-2.5 py-1.5 text-left">Column</th>
                          <th className="px-2.5 py-1.5 text-left">From</th>
                          <th className="px-2.5 py-1.5 text-left">To</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.changes.map((c) => (
                          <tr key={`${c.id}-${c.column}`} className="border-t">
                            <td className="px-2.5 py-1 font-semibold text-slate-800 dark:text-slate-200">{c.partyName ?? `#${c.id}`}</td>
                            <td className="text-muted-foreground px-2.5 py-1 font-medium">{COLUMN_META[c.column].label}</td>
                            <td className="text-muted-foreground px-2.5 py-1 font-medium">{c.from ?? '—'}</td>
                            <td className="px-2.5 py-1 font-bold text-emerald-700 dark:text-emerald-400">{c.to}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </>
          )}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-muted-foreground text-[12px] font-medium tabular-nums">
            {plan ? (
              <>
                <span className="text-foreground font-bold">{plan.affected}</span> of {plan.matched} selected will change
                {isFetching && <Loader2 className="ml-1 inline size-3 animate-spin align-[-2px]" />}
              </>
            ) : (
              `${customers.length} selected`
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-9 rounded-[4px] text-[12.5px] font-bold" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" className="h-9 rounded-[4px] text-[12.5px] font-bold" disabled={!canApply} onClick={run}>
              {apply.isPending && <Loader2 className="animate-spin" />} Apply
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
