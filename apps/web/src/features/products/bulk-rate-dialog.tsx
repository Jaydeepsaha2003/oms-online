import { useEffect, useMemo, useState } from 'react';
import { IndianRupee, Loader2, Minus, Percent, Plus, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { BulkRateChangeInput, RateAdjustMode } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/common/confirm';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBulkRateChange, useBulkRatePreview, useProductLookups } from './use-products';

const inr = (v: number) => `₹${v.toLocaleString('en-IN')}`;

/**
 * Move every chart rate in a category (or one sub-category) up or down at once.
 *
 * Two things make this safe enough to hand to someone:
 *
 *  1. The preview is not optional. It runs as soon as the inputs make sense, so
 *     the counts and the before→after rows are already on screen when the user
 *     reaches for Apply — rather than being something they must remember to ask
 *     for before a write that touches hundreds of rows.
 *  2. The instruction is RELATIVE ("+₹5"), and the server re-reads the current
 *     rates when applying. A preview left open while someone else edits a rate
 *     therefore still moves that rate by ₹5; it never replays a stale figure
 *     over their edit.
 *
 * Direction is a pair of buttons rather than a minus sign typed into the amount:
 * "-5" with Decrease selected is an increase, and there is no reading of that
 * input which is not a trap. The buttons own the sign; the box holds size only.
 */
export function BulkRateDialog({ onClose }: { onClose: () => void }) {
  const { data: lookups } = useProductLookups();
  const confirm = useConfirm();
  const apply = useBulkRateChange();

  const [category, setCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [mode, setMode] = useState<RateAdjustMode>('AMOUNT');
  const [direction, setDirection] = useState<1 | -1>(1);
  const [amount, setAmount] = useState('');
  const [roundToRupee, setRoundToRupee] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);

  const subOptions = useMemo(
    () => [...new Set((lookups?.subCategories ?? []).filter((s) => s.category === category).map((s) => s.subCategory))].sort(),
    [lookups, category],
  );
  // A sub-category from the previous category would silently narrow the scope to
  // nothing, and the preview would just say "0 products" with no reason given.
  useEffect(() => setSubCategory(''), [category]);

  const magnitude = Number(amount);
  const valid = !!category && Number.isFinite(magnitude) && magnitude > 0;
  const value = valid ? direction * magnitude : 0;

  const input: BulkRateChangeInput | null = valid
    ? { category, subCategory: subCategory || null, mode, value, roundToRupee, activeOnly }
    : null;
  const { data: preview, isFetching } = useBulkRatePreview(input);

  const scope = subCategory ? `${category} / ${subCategory}` : category;
  const describe = mode === 'PERCENT' ? `${direction > 0 ? '+' : '−'}${magnitude || 0}%` : `${direction > 0 ? '+' : '−'}${inr(magnitude || 0)}`;

  const run = async () => {
    if (!input || !preview?.willChange) return;
    const ok = await confirm({
      title: `Change ${preview.willChange} rate${preview.willChange === 1 ? '' : 's'}?`,
      description: `${describe} on ${scope}. This rewrites the chart rate on ${preview.willChange} product${preview.willChange === 1 ? '' : 's'} and records each change in the rate history.`,
      confirmText: 'Apply',
    });
    if (!ok) return;
    apply.mutate(input, {
      onSuccess: (r) => {
        toast.success(`${r.updated} rate${r.updated === 1 ? '' : 's'} updated`);
        onClose();
      },
      onError: (e) => toast.error(getApiErrorMessage(e, 'Could not apply the rate change')),
    });
  };

  const skipped = preview ? preview.skippedNoRate + preview.skippedNegative + preview.skippedUnchanged : 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(96vw,44rem)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IndianRupee className="size-5 text-primary" /> Bulk rate change
          </DialogTitle>
          <DialogDescription>
            Move every chart rate in a category — or one sub-category — up or down at once. Special rates are per-party
            adjustments on top of these and are not touched.
          </DialogDescription>
        </DialogHeader>

        {/* ── scope ── */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">Category</Label>
            <NativeSelect
              value={category}
              onChange={setCategory}
              options={['', ...(lookups?.categories ?? [])]}
              placeholder="Pick a category…"
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">
              Sub-category — optional
            </Label>
            <NativeSelect
              value={subCategory}
              onChange={setSubCategory}
              options={['', ...subOptions]}
              placeholder={category ? 'All sub-categories' : 'Pick a category first'}
              disabled={!category}
              className="h-9"
            />
          </div>
        </div>

        {/* ── the adjustment ── */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">Direction</Label>
            <div role="group" aria-label="Increase or decrease" className="inline-flex h-9 overflow-hidden rounded-md border">
              {([[1, 'Increase', Plus], [-1, 'Decrease', Minus]] as const).map(([d, label, Icon], i) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={direction === d}
                  onClick={() => setDirection(d)}
                  className={cn(
                    'flex cursor-pointer items-center gap-1 px-3 text-[12px] font-semibold transition-colors',
                    i > 0 && 'border-l',
                    direction === d
                      ? d > 0
                        ? 'bg-emerald-600 text-white'
                        : 'bg-rose-600 text-white'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">By</Label>
            <div role="group" aria-label="Amount or percent" className="inline-flex h-9 overflow-hidden rounded-md border">
              {([['AMOUNT', '₹', IndianRupee], ['PERCENT', '%', Percent]] as const).map(([m, label, Icon], i) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'flex cursor-pointer items-center gap-1 px-3 text-[12px] font-semibold transition-colors',
                    i > 0 && 'border-l',
                    mode === m ? 'bg-slate-700 text-white' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>

          <div className="w-32 space-y-1">
            <Label htmlFor="bulk-rate-amount" className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">
              {mode === 'PERCENT' ? 'Percent' : 'Amount'}
            </Label>
            <Input
              id="bulk-rate-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder={mode === 'PERCENT' ? '2.5' : '5'}
              className="h-9 tabular-nums"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={roundToRupee} onChange={(e) => setRoundToRupee(e.target.checked)} />
            Round to whole rupees
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            {/* Default OFF. A withdrawn product's rate is a record of what it cost
                when it was sold; moving it rewrites that quietly. */}
            <input type="checkbox" checked={!activeOnly} onChange={(e) => setActiveOnly(!e.target.checked)} />
            Include inactive products
          </label>
        </div>

        {/* ── the preview ── */}
        {!valid ? (
          <p className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-[12.5px]">
            Pick a category and enter an amount to see exactly what will change.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="font-semibold">
                {describe} on {scope}
              </span>
              {isFetching && <Loader2 className="text-muted-foreground size-3.5 animate-spin" />}
              {preview && (
                <span className="text-muted-foreground">
                  · {preview.matched} product{preview.matched === 1 ? '' : 's'} in scope ·{' '}
                  <b className={preview.willChange ? 'text-foreground' : 'text-amber-700 dark:text-amber-300'}>
                    {preview.willChange} will change
                  </b>
                </span>
              )}
            </div>

            {/* Say what will NOT be touched. Silence on a bulk write reads as
                "nothing was skipped", which is the one thing it must not imply. */}
            {!!preview && skipped > 0 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100">
                <TriangleAlert className="mr-1 inline size-3.5" />
                {[
                  preview.skippedNoRate ? `${preview.skippedNoRate} with no rate set` : '',
                  preview.skippedNegative ? `${preview.skippedNegative} would go below ₹0` : '',
                  preview.skippedUnchanged ? `${preview.skippedUnchanged} unchanged after rounding` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}{' '}
                — left exactly as they are.
              </p>
            )}

            {!!preview?.rows.length && (
              <div className="max-h-[38vh] overflow-y-auto rounded-md border">
                <table className="w-full text-[13px]">
                  <thead className="bg-muted/60 sticky top-0">
                    <tr className="text-muted-foreground text-left text-[10.5px] font-bold tracking-wide uppercase">
                      <th className="px-3 py-2">Product</th>
                      <th className="hidden px-3 py-2 sm:table-cell">Sub-category</th>
                      <th className="px-3 py-2 text-right">Now</th>
                      <th className="px-3 py-2 text-right">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.id} className="border-t even:bg-slate-50/70 dark:even:bg-white/[0.03]">
                        <td className="px-3 py-1.5 font-semibold text-slate-900 dark:text-slate-100">
                          {r.product}
                          {r.size != null ? <span className="text-muted-foreground font-normal"> · {r.size}</span> : null}
                        </td>
                        <td className="text-muted-foreground hidden px-3 py-1.5 text-[12px] sm:table-cell">{r.subCategory}</td>
                        <td className="text-muted-foreground px-3 py-1.5 text-right tabular-nums">{inr(r.oldRate)}</td>
                        <td
                          className={cn(
                            'px-3 py-1.5 text-right font-bold tabular-nums',
                            r.newRate > r.oldRate ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                          )}
                        >
                          {inr(r.newRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.truncated && (
                  <p className="text-muted-foreground border-t px-3 py-1.5 text-[11.5px]">
                    Showing the first {preview.rows.length}. All {preview.willChange} will be changed.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>
            Cancel
          </Button>
          <Button
            onClick={run}
            disabled={!preview?.willChange || apply.isPending || isFetching}
            title={preview && !preview.willChange ? 'Nothing would change' : undefined}
          >
            {apply.isPending ? <Loader2 className="animate-spin" /> : null}
            {preview?.willChange ? `Apply to ${preview.willChange} product${preview.willChange === 1 ? '' : 's'}` : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
