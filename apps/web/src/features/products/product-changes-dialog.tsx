import { ChevronRight, History, Loader2 } from 'lucide-react';
import type { ProductChangeEntry } from '@oms/shared';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useProductChanges } from './use-products';

/**
 * Recent edits to products — name, category, sub-category and the rest (§6.1).
 *
 * Rate changes are deliberately absent: they have their own richer trail that
 * booking-date repricing reads, and mixing the two would put the same edit in
 * two places with two different shapes. This answers the plainer question —
 * "what did somebody change lately, and who?".
 */
export function ProductChangesDialog({
  open,
  onOpenChange,
  productId,
  productName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  productId?: number;
  productName?: string;
}) {
  const { data = [], isLoading } = useProductChanges(open, productId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(96vw,52rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <History className="size-4 text-indigo-600" />
            {productName ? `Changes — ${productName}` : 'Recent product changes'}
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Newest first. Rate changes are tracked separately under Price History.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="text-muted-foreground grid place-items-center py-12">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-[13px]">
            No product changes recorded yet. Edits made from now on will appear here.
          </p>
        ) : (
          <div className="max-h-[58vh] overflow-auto rounded-[4px] border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/60 sticky top-0">
                <tr className="text-muted-foreground text-left text-[10.5px] font-bold tracking-widest uppercase">
                  {!productId && <th className="px-3 py-2">Product</th>}
                  <th className="px-3 py-2">Field</th>
                  <th className="px-3 py-2">Changed</th>
                  <th className="px-3 py-2">When</th>
                  <th className="hidden px-3 py-2 sm:table-cell">By</th>
                </tr>
              </thead>
              <tbody>
                {data.map((c: ProductChangeEntry) => (
                  <tr key={c.id} className="border-t even:bg-slate-50/70 dark:even:bg-white/[0.03]">
                    {!productId && (
                      <td className="px-3 py-1.5 font-semibold text-slate-900 dark:text-slate-100">{c.productName}</td>
                    )}
                    <td className="text-muted-foreground px-3 py-1.5 font-medium">{c.field || c.kind}</td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-muted-foreground line-through decoration-slate-400/60">
                          {c.oldValue || '—'}
                        </span>
                        <ChevronRight className="text-muted-foreground/50 size-3.5" />
                        <span className="font-bold text-slate-900 dark:text-slate-100">{c.newValue || '—'}</span>
                      </span>
                    </td>
                    <td className="text-muted-foreground px-3 py-1.5 text-[12px] whitespace-nowrap tabular-nums">
                      {formatDateTime(c.changedAt)}
                    </td>
                    <td className="text-muted-foreground hidden px-3 py-1.5 sm:table-cell">{c.changedByName || '—'}</td>
                  </tr>
                ))}
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
