import { useEffect, useMemo, useState } from 'react';
import { Check, Link2, Loader2, Search, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { BookingDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePrecloseBooking, useLinkableBookingItems, useLinkBookingItems } from './use-bookings';

const num = (v: number | null) => (v ?? 0).toLocaleString('en-IN');

/**
 * Preclose = write off a booking's still-pending qty and close it for good.
 * The amount written off is always the CURRENT remaining figure (computed
 * server-side) — not typed here — so the booking can't be left in an ambiguous
 * "closed but also still open for X" state. Only a comment (why) is captured.
 */
export function PrecloseBookingDialog({ booking, onClose }: { booking: BookingDto; onClose: () => void }) {
  const preclose = usePrecloseBooking();
  const [comment, setComment] = useState('');

  const submit = () => {
    preclose.mutate(
      { id: booking.id, comment: comment.trim() || null },
      {
        onSuccess: () => {
          toast.success(`Booking ${booking.code} preclosed`);
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Preclose failed')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-amber-600" /> Preclose {booking.code}?
          </DialogTitle>
          <DialogDescription>
            This permanently writes off what's still pending and closes the booking — it can no longer be drawn from
            afterwards. This can't be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 rounded-md border bg-amber-50/60 p-3 text-sm dark:bg-amber-500/10">
          <div>
            <p className="text-muted-foreground text-xs">Bags to be written off</p>
            <p className="font-bold tabular-nums text-amber-800 dark:text-amber-300">{num(booking.remainingBags)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Kgs to be written off</p>
            <p className="font-bold tabular-nums text-amber-800 dark:text-amber-300">{num(booking.remainingKgs)}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="preclose-comment">Reason (optional, kept on record)</Label>
          <textarea
            id="preclose-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="e.g. customer won't be taking the rest…"
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-[4px] border bg-transparent px-3 py-2 text-[13px] shadow-xs outline-none focus-visible:ring-[3px]"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={preclose.isPending}>
            {preclose.isPending ? <Loader2 className="animate-spin" /> : null} Preclose booking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Assign old order(s)" — retroactively attach existing, not-yet-linked order
 * lines to this booking. For when an order was created directly (not via Draw
 * from Bag Booking) but actually fulfils it, so the booking's converted qty can
 * reflect that. Picking every line under one order is the same as "assigning
 * the whole order"; picking a subset is "assigning just those items" — one
 * picker naturally covers both.
 */
export function AssignOldOrderDialog({ booking, onClose }: { booking: BookingDto; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const { data: candidates = [], isLoading } = useLinkableBookingItems(booking.id, search);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const link = useLinkBookingItems();

  useEffect(() => setSelected(new Set()), [booking.id]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const totals = useMemo(() => {
    const picked = candidates.filter((c) => selected.has(c.orderItemId));
    return {
      count: picked.length,
      bags: picked.reduce((s, c) => s + (c.bags ?? 0), 0),
      kgs: picked.reduce((s, c) => s + (c.gram ?? 0), 0),
    };
  }, [candidates, selected]);

  const overCapacity = totals.bags - booking.remainingBags > 0.001 || totals.kgs - booking.remainingKgs > 0.001;

  const submit = () => {
    if (!selected.size) return;
    link.mutate(
      { id: booking.id, orderItemIds: [...selected] },
      {
        onSuccess: () => {
          toast.success(`${selected.size} line${selected.size === 1 ? '' : 's'} assigned to ${booking.code}`);
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Assign failed')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4 text-sky-600" /> Assign old order(s) to {booking.code}
          </DialogTitle>
          <DialogDescription>
            Pick existing order lines for <span className="font-medium">{booking.customerName}</span> that weren't drawn
            from this booking but should count against it. Select every line under an order to assign the whole order.
          </DialogDescription>
        </DialogHeader>

        <div className="relative shrink-0">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order # or product…" className="pl-8" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          {isLoading ? (
            <div className="text-muted-foreground flex h-32 items-center justify-center">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-muted-foreground p-6 text-center text-sm">
              {search ? `No unlinked lines match "${search}".` : `No unlinked order lines found for ${booking.customerName}.`}
            </p>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-muted-foreground text-left text-[11px] font-semibold tracking-wide uppercase">
                  <th className="w-8 px-2 py-1.5" />
                  <th className="px-2 py-1.5">Order</th>
                  <th className="px-2 py-1.5">Product</th>
                  <th className="px-2 py-1.5">Design</th>
                  <th className="px-2 py-1.5 text-right">Bags</th>
                  <th className="px-2 py-1.5 text-right">Kgs</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const on = selected.has(c.orderItemId);
                  return (
                    <tr
                      key={c.orderItemId}
                      onClick={() => toggle(c.orderItemId)}
                      className={cn('cursor-pointer border-t', on ? 'bg-primary/[0.06]' : 'hover:bg-muted/40')}
                    >
                      <td className="px-2 py-1.5">
                        <span
                          className={cn(
                            'flex size-4 items-center justify-center rounded-[4px] border-[1.5px]',
                            on ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-400',
                          )}
                        >
                          {on && <Check className="size-3" strokeWidth={3} />}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 font-mono whitespace-nowrap">
                        {c.orderCode}
                        <span className="text-muted-foreground ml-1 font-sans">{formatDate(c.orderDate)}</span>
                      </td>
                      <td className="px-2 py-1.5 font-medium">{c.productName ?? '—'}</td>
                      <td className="text-muted-foreground px-2 py-1.5">{c.designType ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{num(c.bags)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{num(c.gram)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="shrink-0 space-y-2">
          <p className={cn('text-xs', overCapacity ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
            {totals.count} selected · {num(totals.bags)} bags / {num(totals.kgs)} kgs
            {' — '}
            {num(booking.remainingBags)} bags / {num(booking.remainingKgs)} kgs remaining on this booking
            {overCapacity ? ' (exceeds remaining)' : ''}
          </p>
          <DialogFooter className="!mt-0">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!selected.size || overCapacity || link.isPending}>
              {link.isPending ? <Loader2 className="animate-spin" /> : <Link2 />} Assign {totals.count || ''} line
              {totals.count === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
