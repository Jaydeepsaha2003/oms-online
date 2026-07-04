import { useEffect, useMemo, useRef, useState } from 'react';
import { BadgePercent, Loader2, PackageOpen, Plus, Split, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ORDER_PRIORITIES, type BookingDto, type BookingQuoteLine, type ConvertBookingLineInput, type OrderLookups } from '@oms/shared';
import { formatDate } from '@/lib/date-format';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { NativeSelect } from '@/components/common/combo';
import { useBookingQuote } from '@/features/bookings/use-bookings';

/** One item drawn from a booking, ready to drop into the order's item list. */
export interface DrawnBookingLine {
  bookingId: number;
  bookingCode: string;
  itemName: string;
  product: string;
  category: string;
  subCategory: string;
  designType: string;
  designName: string;
  psize: string;
  productRate: string;
  designRate: string;
  priority: string;
  bags: string;
  pcs: string;
  gram: string;
  box: string;
  calField: string;
  comment: string;
}

const fmtNum = (v: number | null) => (v == null ? '' : String(v));
const n = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
const money = (v: number) => v.toLocaleString('en-IN');
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

interface EntryLine {
  key: string;
  itemName: string;
  product: string;
  category: string;
  subCategory: string;
  designType: string;
  designName: string;
  psize: string;
  priority: string;
  bags: string;
  pcs: string;
  gram: string;
  box: string;
  calField: string;
  comment: string;
}
const blank = (priority = 'NORMAL'): Omit<EntryLine, 'key'> => ({
  itemName: '', product: '', category: '', subCategory: '', designType: '', designName: '',
  psize: '', priority, bags: '', pcs: '', gram: '', box: '', calField: 'KGS', comment: '',
});

/**
 * Slide-over to draw items from a customer's bag bookings into the current order.
 * Mirrors the order form's entry row (item + design name + priority + remarks);
 * each line is priced at the booking's frozen (booking-date) rate via the quote
 * endpoint, and on confirm the lines are handed back to the order form.
 */
export function BookingDrawSheet({
  open,
  onOpenChange,
  customerName,
  bookings,
  lookups,
  alreadyQueued,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerName: string;
  /** The customer's drawable bookings (fetched by the order form). */
  bookings: BookingDto[];
  lookups: OrderLookups | undefined;
  /** Bags/kgs already queued in the order for a booking (so remaining is accurate before save). */
  alreadyQueued: (bookingId: number) => { bags: number; kgs: number };
  onAdd: (lines: DrawnBookingLine[]) => void;
}) {
  const quote = useBookingQuote();
  const confirmDialog = useConfirm();
  const keyer = useRef(0);

  const [bookingId, setBookingId] = useState<number | null>(null);
  const booking = bookings.find((b) => b.id === bookingId) ?? null;
  const [entry, setEntry] = useState(blank());
  const [lines, setLines] = useState<EntryLine[]>([]);
  const [quoted, setQuoted] = useState<BookingQuoteLine[]>([]);

  // Reset when the sheet opens or the customer changes.
  useEffect(() => {
    if (open) {
      setBookingId(null);
      setEntry(blank());
      setLines([]);
      setQuoted([]);
    }
  }, [open, customerName]);

  // Default to the first booking once loaded.
  useEffect(() => {
    if (open && bookingId == null && bookings.length) setBookingId(bookings[0].id);
  }, [open, bookings, bookingId]);

  const itemOptions = useMemo(() => {
    const list = lookups?.items ?? [];
    const map = new Map<string, (typeof list)[number]>();
    const labels: string[] = [];
    for (const it of list) {
      const label = [fmtNum(it.size), it.product, it.designType ?? ''].filter(Boolean).join(' ');
      if (!label || map.has(label)) continue;
      map.set(label, it);
      labels.push(label);
    }
    return { labels, map };
  }, [lookups]);

  const categoryFieldMap = useMemo(() => {
    const m = new Map<string, 'KGS' | 'PCS'>();
    for (const cf of lookups?.categoryFields ?? []) m.set(cf.category.toUpperCase(), cf.field === 'PCS' ? 'PCS' : 'KGS');
    return m;
  }, [lookups]);

  // designType code -> its design names from the Design Names master (like the order form).
  const designNamesByCode = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const dn of lookups?.designNames ?? []) {
      const k = dn.designType.toUpperCase();
      const list = m.get(k) ?? [];
      if (!list.includes(dn.designName)) list.push(dn.designName);
      if (!m.has(k)) m.set(k, list);
    }
    return m;
  }, [lookups]);

  const designChoices = useMemo(() => {
    const code = entry.designType.trim().toUpperCase();
    return code ? (designNamesByCode.get(code) ?? []) : [];
  }, [designNamesByCode, entry.designType]);
  const noDesignNames = designChoices.length === 0;

  const onItemPick = (label: string) => {
    const it = itemOptions.map.get(label);
    if (!it) return setEntry((e) => ({ ...e, itemName: label, product: label }));
    setEntry((e) => ({
      ...e,
      itemName: label,
      product: it.product,
      category: it.category,
      subCategory: it.subCategory,
      designType: it.designType ?? '',
      // Never pre-pick a design name — the user chooses it explicitly.
      designName: '',
      psize: it.size != null ? String(it.size) : '',
    }));
  };

  const addLine = async () => {
    if (!entry.product.trim() && !entry.designType.trim()) return toast.error('Pick an item to add');
    // A design name must be chosen explicitly whenever the design code has names.
    if (!noDesignNames && !entry.designName.trim()) return toast.error('Please select a Design Name for this item');
    // Quantities can never be negative.
    for (const [label, v] of [['Bags', entry.bags], ['Pcs', entry.pcs], ['Kgs', entry.gram], ['Box', entry.box]] as const) {
      const num = n(v);
      if (num != null && num < 0) return toast.error(`${label} cannot be negative`);
    }
    // The billing quantity (Kgs or Pcs, per the category's calc field) is required.
    const calcBy = categoryFieldMap.get(entry.category.trim().toUpperCase()) ?? 'KGS';
    const billQty = calcBy === 'PCS' ? n(entry.pcs) : n(entry.gram);
    if (billQty == null || billQty <= 0) {
      return toast.error(calcBy === 'PCS' ? 'Enter Pcs — this item is billed by pieces' : 'Enter Kgs — this item is billed by weight');
    }
    // Duplicate guard within this draw: same item + design already queued → confirm.
    const dupName = (noDesignNames ? 'NA' : entry.designName).toUpperCase();
    const dupIdx = lines.findIndex(
      (l) => l.itemName.trim().toUpperCase() === entry.itemName.trim().toUpperCase() && (l.designName || 'NA').toUpperCase() === dupName,
    );
    if (dupIdx >= 0) {
      const ok = await confirmDialog({
        title: 'Item already added',
        description: `"${entry.itemName}" is already queued (line ${dupIdx + 1}). Add it again as a separate line?`,
        confirmText: 'Add anyway',
      });
      if (!ok) return;
    }
    // Hard stop at entry time: a line may never draw more bags/kgs than the
    // booking still has left (after the order's + this sheet's queued lines).
    const wantBags = n(entry.bags) ?? 0;
    const wantKgs = n(entry.gram) ?? 0;
    if (wantBags - remaining.bags > 0.001) {
      return toast.error(
        remaining.bags <= 0
          ? `No bags left to draw on ${booking?.code ?? 'this booking'}.`
          : `Only ${money(remaining.bags)} bag(s) left on ${booking?.code ?? 'this booking'} — reduce the Bags.`,
      );
    }
    if (wantKgs - remaining.kgs > 0.001) {
      return toast.error(
        remaining.kgs <= 0
          ? `No kgs left to draw on ${booking?.code ?? 'this booking'}.`
          : `Only ${money(remaining.kgs)} kg(s) left on ${booking?.code ?? 'this booking'} — reduce the Kgs.`,
      );
    }
    const calField = categoryFieldMap.get(entry.category.trim().toUpperCase()) ?? 'KGS';
    const designName = noDesignNames ? 'NA' : entry.designName;
    setLines((ls) => [...ls, { ...entry, key: `d${keyer.current++}`, calField, designName }]);
    // Keep the chosen priority for the next line — matches the order form's flow.
    setEntry(blank(entry.priority));
  };
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const toQuoteInput = (l: EntryLine): ConvertBookingLineInput => ({
    pCategory: l.category.trim() || null,
    subCategory: l.subCategory.trim() || null,
    product: l.product.trim() || null,
    productName: l.itemName.trim() || l.product.trim() || null,
    designType: l.designType.trim() || null,
    psize: n(l.psize),
    bags: n(l.bags),
    pcs: n(l.pcs),
    gram: n(l.gram),
    box: n(l.box),
    calField: l.calField || null,
  });

  // Re-price whenever the picked booking or the lines change.
  useEffect(() => {
    if (!booking || !lines.length) {
      setQuoted([]);
      return;
    }
    const t = window.setTimeout(() => {
      quote.mutate(
        { id: booking.id, lines: lines.map(toQuoteInput) },
        { onSuccess: (res) => setQuoted(res.lines), onError: () => setQuoted([]) },
      );
    }, 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id, lines]);

  // Remaining on the picked booking, minus what's already in the order AND queued here.
  const remaining = useMemo(() => {
    if (!booking) return { bags: 0, kgs: 0 };
    const queued = alreadyQueued(booking.id);
    const here = lines.reduce((a, l) => ({ bags: a.bags + (n(l.bags) ?? 0), kgs: a.kgs + (n(l.gram) ?? 0) }), { bags: 0, kgs: 0 });
    return { bags: round2(booking.remainingBags - queued.bags - here.bags), kgs: round2(booking.remainingKgs - queued.kgs - here.kgs) };
  }, [booking, lines, alreadyQueued]);

  const overBags = remaining.bags < -0.001;
  const overKgs = remaining.kgs < -0.001;

  const confirm = () => {
    if (!booking) return toast.error('Pick a booking first');
    if (!lines.length) return toast.error('Add at least one item');
    if (overBags || overKgs) return toast.error('The items exceed what is left on this booking');
    const drawn: DrawnBookingLine[] = lines.map((l, i) => {
      const q = quoted[i];
      const productRate = q ? q.productRate + q.productDelta : 0;
      const designRate = q ? q.designRate + q.designDelta : 0;
      return {
        bookingId: booking.id,
        bookingCode: booking.code,
        itemName: l.itemName || l.product,
        product: l.product,
        category: l.category,
        subCategory: l.subCategory,
        designType: l.designType,
        designName: l.designName || 'NA',
        psize: l.psize,
        productRate: productRate ? String(round2(productRate)) : '',
        designRate: designRate ? String(round2(designRate)) : '',
        priority: l.priority || 'NORMAL',
        bags: l.bags,
        pcs: l.pcs,
        gram: l.gram,
        box: l.box,
        calField: l.calField,
        comment: l.comment,
      };
    });
    onAdd(drawn);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Inline maxWidth (not a Tailwind class) so the wide sheet doesn't depend on
          utility generation — near-full-screen on desktop, full-width on phones. */}
      <SheetContent className="w-full" style={{ maxWidth: 'min(72rem, 96vw)' }}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-xl">
            <PackageOpen className="size-6 text-primary" /> Draw from Bag Booking
          </SheetTitle>
          <p className="text-muted-foreground text-sm">
            {customerName ? `Pull ${customerName}'s reserved bags into this order at the frozen booking-date rates.` : 'Select a customer first.'}
          </p>
        </SheetHeader>

        {bookings.length === 0 ? (
          <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
            No open bookings with remaining quantity for this customer.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
            {/* Booking picker */}
            <div className="grid gap-2 sm:grid-cols-3">
              {bookings.map((b) => (
                <BookingCard key={b.id} b={b} active={b.id === bookingId} queued={alreadyQueued(b.id)} onPick={() => setBookingId(b.id)} />
              ))}
            </div>

            {booking && (
              <>
                {/* Live remaining after this order + queued lines */}
                <div className="grid grid-cols-2 gap-3 rounded-lg border bg-slate-50/70 px-3 py-2">
                  <Stat label="Bags left to draw" value={money(Math.max(0, remaining.bags))} over={overBags} />
                  <Stat label="Kgs left to draw" value={money(Math.max(0, remaining.kgs))} over={overKgs} />
                </div>

                {/* Item entry — mirrors the order form: item, design name, priority… */}
                <div className="space-y-2.5 rounded-lg border bg-slate-50/70 p-3">
                  <div className="grid grid-cols-2 items-end gap-2.5 lg:grid-cols-12">
                    <div className="col-span-2 space-y-1.5 lg:col-span-6">
                      <Label className="text-base">Item name</Label>
                      <NativeSelect value={entry.itemName} onChange={onItemPick} options={itemOptions.labels} placeholder="Pick an item…" className="h-11 text-left text-base" onInvalidEntry={() => toast.error('Please select a correct item')} />
                    </div>
                    <div className="col-span-1 space-y-1.5 lg:col-span-3">
                      <Label className="text-base">Design Name</Label>
                      <NativeSelect
                        value={noDesignNames ? 'NA' : entry.designName}
                        onChange={(v) => setEntry((s) => ({ ...s, designName: v }))}
                        options={noDesignNames ? ['NA'] : designChoices}
                        placeholder="Design name"
                        disabled={noDesignNames}
                        className="h-11 text-base"
                        onInvalidEntry={() => toast.error('Please select a correct design name')}
                      />
                    </div>
                    <div className="col-span-1 space-y-1.5 lg:col-span-3">
                      <Label className="text-base">Priority</Label>
                      <NativeSelect value={entry.priority} onChange={(v) => setEntry((s) => ({ ...s, priority: v }))} options={[...ORDER_PRIORITIES]} className="h-11 text-base" />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 items-end gap-2.5 lg:grid-cols-12">
                    <div className="space-y-1.5 lg:col-span-2"><Label className="text-base">Bags</Label><Input type="number" step="any" min={0} className="h-11 text-right text-lg font-semibold tabular-nums" value={entry.bags} onChange={(e) => setEntry((s) => ({ ...s, bags: e.target.value }))} /></div>
                    <div className="space-y-1.5 lg:col-span-2"><Label className="text-base">Pcs</Label><Input type="number" step="any" min={0} className="h-11 text-right text-lg font-semibold tabular-nums" value={entry.pcs} onChange={(e) => setEntry((s) => ({ ...s, pcs: e.target.value }))} /></div>
                    <div className="space-y-1.5 lg:col-span-2"><Label className="text-base">Kgs</Label><Input type="number" step="any" min={0} className="h-11 text-right text-lg font-semibold tabular-nums" value={entry.gram} onChange={(e) => setEntry((s) => ({ ...s, gram: e.target.value }))} /></div>
                    <div className="space-y-1.5 lg:col-span-2"><Label className="text-base">Box</Label><Input type="number" step="any" min={0} className="h-11 text-right text-lg font-semibold tabular-nums" value={entry.box} onChange={(e) => setEntry((s) => ({ ...s, box: e.target.value }))} /></div>
                    <div className="col-span-4 space-y-1.5 lg:col-span-2"><Label className="text-base">Remarks</Label><Input className="h-11 text-base" value={entry.comment} onChange={(e) => setEntry((s) => ({ ...s, comment: e.target.value }))} placeholder="Item remark…" /></div>
                    <div className="col-span-4 lg:col-span-2"><Button onClick={addLine} className="h-11 w-full text-base"><Plus /> Add</Button></div>
                  </div>
                </div>

                {/* Queued lines with frozen-rate quote */}
                <div className="overflow-auto rounded-lg border">
                  <table className="w-full text-base">
                    <thead className="[&_th]:bg-muted [&_th]:px-3.5 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold">
                      <tr>
                        <th>Item</th>
                        <th>Design</th>
                        <th>Priority</th>
                        <th className="text-right">Bags</th>
                        <th className="text-right">Pcs</th>
                        <th className="text-right">Kgs</th>
                        <th className="text-right">Box</th>
                        <th className="text-right">Frozen ₹</th>
                        <th>Remarks</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody className="[&_td]:border-t [&_td]:px-3.5 [&_td]:py-2.5">
                      {lines.length === 0 ? (
                        <tr><td colSpan={10} className="text-muted-foreground h-12 text-center">No items yet — pick an item above and click “Add”.</td></tr>
                      ) : (
                        lines.map((l, i) => {
                          const q = quoted[i];
                          const special = q && (q.productDelta !== 0 || q.designDelta !== 0);
                          return (
                            <tr key={l.key}>
                              <td className="font-medium">
                                {l.itemName || l.product || '—'}
                                {special && <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700"><BadgePercent className="size-3" /> special</span>}
                              </td>
                              <td>{l.designName || 'NA'}</td>
                              <td>{l.priority === 'URGENT' ? <span className="font-semibold text-rose-600">URGENT</span> : l.priority}</td>
                              <td className="text-right tabular-nums">{l.bags || '—'}</td>
                              <td className="text-right tabular-nums">{l.pcs || '—'}</td>
                              <td className="text-right tabular-nums">{l.gram || '—'}</td>
                              <td className="text-right tabular-nums">{l.box || '—'}</td>
                              <td className="text-right tabular-nums">{quote.isPending && !q ? <Loader2 className="ml-auto size-3 animate-spin" /> : q ? money(q.rate) : '—'}</td>
                              <td className="max-w-[10rem] truncate" title={l.comment}>{l.comment || '—'}</td>
                              <td><Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => removeLine(l.key)}><Trash2 className="size-4" /></Button></td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        <SheetFooter className="justify-between">
          <Button variant="outline" className="h-11 text-base" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-11 text-base" onClick={confirm} disabled={!booking || lines.length === 0 || overBags || overKgs}>
            <Split /> Add {lines.length || ''} to order
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function BookingCard({ b, active, queued, onPick }: { b: BookingDto; active: boolean; queued: { bags: number; kgs: number }; onPick: () => void }) {
  const remBags = Math.max(0, round2(b.remainingBags - queued.bags));
  const remKgs = Math.max(0, round2(b.remainingKgs - queued.kgs));
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'flex flex-col items-start gap-0.5 rounded-lg border px-3.5 py-2.5 text-left transition-colors',
        active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50',
      )}
    >
      <span className="font-mono text-sm font-semibold text-slate-700">{b.code}</span>
      <span className="text-muted-foreground text-xs">booked {formatDate(b.bookingDate)}</span>
      <span className="text-sm tabular-nums">
        <b className="text-sky-700">{money(remBags)}</b> bags · <b className="text-sky-700">{money(remKgs)}</b> kgs left
      </span>
    </button>
  );
}

function Stat({ label, value, over }: { label: string; value: string; over?: boolean }) {
  return (
    <div>
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className={cn('text-2xl font-bold tabular-nums', over ? 'text-rose-600' : 'text-slate-800')}>{value}</p>
    </div>
  );
}
