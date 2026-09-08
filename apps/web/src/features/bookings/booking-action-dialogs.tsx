import { useEffect, useMemo, useState } from 'react';
import { Check, Link2, Loader2, Search, TriangleAlert, Minus, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import type { BookingDto } from '@oms/shared';
import { withinBooked } from '@oms/shared';
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
/**
 * The one checkbox used at every level of the assign picker.
 *
 * `part` is what makes an order readable at a glance: a half-picked order has
 * to look different from an untouched one, or the only way to tell is to open
 * it and count.
 */
function Tick({ state, onClick, title }: { state: 'on' | 'off' | 'part'; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] transition-colors',
        state === 'on'
          ? 'border-primary bg-primary text-primary-foreground'
          : state === 'part'
            ? 'border-primary bg-primary/25'
            : 'border-slate-400 hover:border-slate-500',
      )}
    >
      {state === 'on' && <Check className="size-3" strokeWidth={3} />}
      {state === 'part' && <Minus className="size-2.5" strokeWidth={3} />}
    </button>
  );
}

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

  /*
   * Lines grouped under their order.
   *
   * The list is naturally one order per several lines, and a flat table
   * repeated "ORD-903  09/03/26" on every row while giving no way to take the
   * order as a whole — which is the usual intent, since an order either fulfils
   * this booking or it does not. Grouping makes the order the unit you act on
   * and leaves the individual lines available underneath for the partial case.
   */
  const groups = useMemo(() => {
    const by = new Map<string, { orderCode: string; orderDate: string; lines: typeof candidates }>();
    for (const c of candidates) {
      const key = c.orderCode ?? '—';
      const g = by.get(key) ?? { orderCode: key, orderDate: c.orderDate, lines: [] as typeof candidates };
      g.lines.push(c);
      by.set(key, g);
    }
    return [...by.values()].map((g) => ({
      ...g,
      bags: g.lines.reduce((s, c) => s + (c.bags ?? 0), 0),
      kgs: g.lines.reduce((s, c) => s + (c.gram ?? 0), 0),
      picked: g.lines.filter((c) => selected.has(c.orderItemId)).length,
    }));
  }, [candidates, selected]);

  /** Collapsed orders, by code. Expanded by default — nothing is hidden unless
   *  the user chooses to fold it away. */
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggleFold = (code: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });

  /** Take or drop a whole order in one click — the common case. */
  const toggleGroup = (code: string) =>
    setSelected((prev) => {
      const g = groups.find((x) => x.orderCode === code);
      if (!g) return prev;
      const next = new Set(prev);
      const all = g.lines.every((c) => next.has(c.orderItemId));
      g.lines.forEach((c) => (all ? next.delete(c.orderItemId) : next.add(c.orderItemId)));
      return next;
    });

  const allVisibleSelected = candidates.length > 0 && candidates.every((c) => selected.has(c.orderItemId));
  const someVisibleSelected = candidates.some((c) => selected.has(c.orderItemId));
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) candidates.forEach((c) => next.delete(c.orderItemId));
      else candidates.forEach((c) => next.add(c.orderItemId));
      return next;
    });

  const totals = useMemo(() => {
    const picked = candidates.filter((c) => selected.has(c.orderItemId));
    return {
      count: picked.length,
      orders: new Set(picked.map((c) => c.orderCode)).size,
      bags: picked.reduce((s, c) => s + (c.bags ?? 0), 0),
      kgs: picked.reduce((s, c) => s + (c.gram ?? 0), 0),
    };
  }, [candidates, selected]);

  /*
   * Only a dimension the booking actually reserved can block the assign.
   *
   * A bags-only booking has kgs = 0, which is "kgs were never booked", not "the
   * kgs are used up" — but the old check read the 0 as exhausted and greyed the
   * button out for every line, since a real order line always carries kgs.
   * `withinBooked` is the server's own rule, now shared, so the browser cannot
   * refuse a draw the server would accept.
   */
  const bagsFit = withinBooked(totals.bags, booking.remainingBags, booking.bags);
  const kgsFit = withinBooked(totals.kgs, booking.remainingKgs, booking.kgs);
  const overCapacity = !bagsFit || !kgsFit;

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
            <div>
              {/* One sticky bar for select-all + what the whole list holds. */}
              <div className="bg-muted/60 sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-1.5">
                <Tick
                  state={allVisibleSelected ? 'on' : someVisibleSelected ? 'part' : 'off'}
                  onClick={toggleAllVisible}
                  title={allVisibleSelected ? 'Deselect everything' : 'Select everything'}
                />
                <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                  {groups.length} order{groups.length === 1 ? '' : 's'} · {candidates.length} line
                  {candidates.length === 1 ? '' : 's'}
                </span>
              </div>

              {groups.map((g) => {
                const all = g.picked === g.lines.length;
                const some = g.picked > 0 && !all;
                const shut = folded.has(g.orderCode);
                return (
                  <div key={g.orderCode} className="border-b last:border-b-0">
                    {/* ── The order itself: one click takes or drops all of it ── */}
                    <div
                      className={cn(
                        'flex items-center gap-2 px-2 py-2',
                        all ? 'bg-primary/[0.10]' : some ? 'bg-primary/[0.04]' : 'bg-muted/25',
                      )}
                    >
                      <Tick
                        state={all ? 'on' : some ? 'part' : 'off'}
                        onClick={() => toggleGroup(g.orderCode)}
                        title={all ? `Deselect ${g.orderCode}` : `Select all of ${g.orderCode}`}
                      />
                      <button
                        type="button"
                        onClick={() => toggleFold(g.orderCode)}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        title={shut ? 'Show lines' : 'Hide lines'}
                      >
                        <ChevronRight className={cn('size-4 transition-transform', !shut && 'rotate-90')} />
                      </button>
                      <button type="button" onClick={() => toggleGroup(g.orderCode)} className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
                        <span className="font-mono text-[13px] font-bold">{g.orderCode}</span>
                        <span className="text-muted-foreground text-[11.5px]">{formatDate(g.orderDate)}</span>
                        <span className="text-muted-foreground text-[11px]">
                          {g.picked ? `${g.picked}/${g.lines.length} picked` : `${g.lines.length} line${g.lines.length === 1 ? '' : 's'}`}
                        </span>
                      </button>
                      <span className="shrink-0 text-right text-[12px] font-semibold tabular-nums">
                        {num(g.bags)} <span className="text-muted-foreground font-normal">bags</span>
                        <span className="text-muted-foreground mx-1">·</span>
                        {num(g.kgs)} <span className="text-muted-foreground font-normal">kgs</span>
                      </span>
                    </div>

                    {/* ── Its lines, for when only part of an order applies ── */}
                    {!shut && (
                      <table className="w-full text-[12.5px]">
                        <tbody>
                          {g.lines.map((c) => {
                            const on = selected.has(c.orderItemId);
                            return (
                              <tr
                                key={c.orderItemId}
                                onClick={() => toggle(c.orderItemId)}
                                className={cn('cursor-pointer border-t', on ? 'bg-primary/[0.06]' : 'hover:bg-muted/40')}
                              >
                                <td className="w-8 py-1.5 pr-2 pl-8">
                                  <Tick state={on ? 'on' : 'off'} onClick={() => toggle(c.orderItemId)} />
                                </td>
                                <td className="px-2 py-1.5 font-medium">{c.productName ?? '—'}</td>
                                <td className="text-muted-foreground px-2 py-1.5">{c.designType ?? '—'}</td>
                                <td className="w-20 px-2 py-1.5 text-right tabular-nums">{num(c.bags)}</td>
                                <td className="w-24 px-2 py-1.5 text-right tabular-nums">{num(c.gram)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 space-y-2">
          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[4px] border px-2.5 py-1.5 text-[12px]',
              overCapacity
                ? 'border-destructive/40 bg-destructive/5 text-destructive'
                : totals.count
                  ? 'border-primary/30 bg-primary/[0.04]'
                  : 'text-muted-foreground',
            )}
          >
            <span>
              <strong className="tabular-nums">{totals.count}</strong> line{totals.count === 1 ? '' : 's'}
              {totals.orders > 0 && (
                <>
                  {' from '}
                  <strong className="tabular-nums">{totals.orders}</strong> order{totals.orders === 1 ? '' : 's'}
                </>
              )}
              {' · '}
              <strong className="tabular-nums">{num(totals.bags)}</strong> bags / <strong className="tabular-nums">{num(totals.kgs)}</strong> kgs
            </span>
            <span>
              {/* A dimension the booking never reserved is said so, rather than
                  shown as "0 left" — which reads as exhausted. */}
              booking has{' '}
              {booking.bags > 0 ? (
                <>
                  <strong className="tabular-nums">{num(booking.remainingBags)}</strong> bags
                </>
              ) : (
                <span className="text-muted-foreground">no bags booked</span>
              )}
              {' / '}
              {booking.kgs > 0 ? (
                <>
                  <strong className="tabular-nums">{num(booking.remainingKgs)}</strong> kgs left
                </>
              ) : (
                <span className="text-muted-foreground">kgs not booked</span>
              )}
            </span>
            {overCapacity && (
              /* Name the overshoot. "Exceeds remaining" left the user to work out
                 how much to drop; the figure turns it into one decision. */
              <span className="w-full font-semibold">
                Over by{' '}
                {[
                  !bagsFit ? `${num(totals.bags - booking.remainingBags)} bags` : null,
                  !kgsFit ? `${num(totals.kgs - booking.remainingKgs)} kgs` : null,
                ]
                  .filter(Boolean)
                  .join(' and ')}{' '}
                — deselect some lines to continue.
              </span>
            )}
          </div>
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
