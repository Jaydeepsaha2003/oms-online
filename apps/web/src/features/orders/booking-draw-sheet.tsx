import { useEffect, useMemo, useRef, useState } from 'react';
import { BadgePercent, ExternalLink, History, Loader2, PackageOpen, Plus, Split, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ORDER_PRIORITIES, qtyOrderForCategory, type BookingDto, type BookingQuoteLine, type ConvertBookingLineInput, type CustomerBagWeightDto, type CustomerLogoDto, type OrderLookups, type QtyField } from '@oms/shared';
import { formatDate } from '@/lib/date-format';
import { cn } from '@/lib/utils';
import { detectSizeOrPcs, useAutoSizePcs } from '@/lib/auto-size-pcs';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/common/combo';
import { useOrderQtyLayout } from '@/features/settings/use-settings';
import { useBookingQuote } from '@/features/bookings/use-bookings';
import { DesignNamePicker, resolveDesignNameChoices } from './design-name-picker';

/** Open the Price History page in a new tab, pre-filtered to one product. */
function openPriceHistory(product: string) {
  const q = new URLSearchParams();
  if (product.trim()) q.set('search', product.trim());
  q.set('kind', 'PRODUCT');
  window.open(`/price-history?${q.toString()}`, '_blank', 'noopener,noreferrer');
}

/** Prompt shown at Add time when an item's latest price differs from the frozen
 *  booking-date price; `resolve` returns the user's choice (or null if cancelled). */
interface LinePrompt {
  item: string;
  product: string;
  oldRate: number;
  newRate: number;
  resolve: (choice: 'old' | 'new' | null) => void;
}

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
  /** Per-piece weight / pieces-per-box of the source product, carried through so
   *  the order form's Pcs ⇄ Box ⇄ Kgs cascade still works when a drawn line is
   *  edited there (it reloads the whole line back into its entry row). */
  weight: string;
  pcsBox: string;
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
  /** Per-piece weight of the picked product (drives Pcs → Kgs). */
  weight: string;
  /** Pieces per box of the picked product (drives Pcs ⇄ Box). */
  pcsBox: string;
  priority: string;
  bags: string;
  pcs: string;
  gram: string;
  box: string;
  calField: string;
  comment: string;
  /** When the item's price changed since booking, the user's choice: bill the
   *  latest price (true) or keep the frozen booking-date price (false/undefined). */
  useLatest?: boolean;
}
const blank = (priority = 'NORMAL'): Omit<EntryLine, 'key'> => ({
  itemName: '', product: '', category: '', subCategory: '', designType: '', designName: '',
  psize: '', weight: '', pcsBox: '', priority, bags: '', pcs: '', gram: '', box: '', calField: 'KGS', comment: '',
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
  bagWeights,
  logos,
  alreadyQueued,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerName: string;
  /** The customer's drawable bookings (fetched by the order form). */
  bookings: BookingDto[];
  lookups: OrderLookups | undefined;
  /** The customer's per-category "1 bag = X kgs" weights, to auto-fill Kgs from Bags. */
  bagWeights: CustomerBagWeightDto[];
  /** The customer's logo restrictions — blocked-logo items are hidden from the list. */
  logos: CustomerLogoDto[];
  /** Bags/kgs already queued in the order for a booking (so remaining is accurate before save). */
  alreadyQueued: (bookingId: number) => { bags: number; kgs: number };
  onAdd: (lines: DrawnBookingLine[]) => void;
}) {
  const quote = useBookingQuote();
  const confirmDialog = useConfirm();
  const keyer = useRef(0);
  // Same Size/Pcs behaviour as the New Order item picker: the label's leading
  // number is the item's size or its pcs count depending on this, auto-detected
  // from what's typed (shared per-browser preference — see useAutoSizePcs).
  const { autoSizePcs } = useAutoSizePcs();
  const [showBy, setShowBy] = useState<'PCS' | 'SIZE'>('SIZE');
  // Per-category Bags/Pcs/Kgs/Box ordering from Settings, same source the New
  // Order form reads.
  const { data: qtyLayout } = useOrderQtyLayout();

  const [bookingId, setBookingId] = useState<number | null>(null);
  const booking = bookings.find((b) => b.id === bookingId) ?? null;
  const [entry, setEntry] = useState(blank());
  const [lines, setLines] = useState<EntryLine[]>([]);
  const [quoted, setQuoted] = useState<BookingQuoteLine[]>([]);
  // Set while asking the user, at Add time, whether a just-added item should bill
  // its frozen booking-date price or the newer current price.
  const [linePrompt, setLinePrompt] = useState<LinePrompt | null>(null);

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
    // Hide logo items when this customer's logo is blocked for that category /
    // sub-category — same rule as the main order form.
    const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
    const isLogo = (designType?: string | null) => norm(designType).includes('LOGO');
    const logoBlocked = (category: string, subCategory: string) =>
      logos.some(
        (l) =>
          (l.scope === 'CATEGORY' && norm(l.category) === norm(category)) ||
          (l.scope === 'SUBCATEGORY' && norm(l.category) === norm(category) && norm(l.subCategory) === norm(subCategory)),
      );
    const map = new Map<string, (typeof list)[number]>();
    const options: { value: string; label: string; keywords: string }[] = [];
    for (const it of list) {
      if (isLogo(it.designType) && logoBlocked(it.category, it.subCategory)) continue;
      // Leading number is the size or the pcs count depending on showBy — same
      // composite-label rule the New Order item picker uses.
      const prefix = showBy === 'PCS' ? fmtNum(it.pcs) : fmtNum(it.size);
      const label = [prefix, it.product, it.designType ?? ''].filter(Boolean).join(' ');
      if (!label || map.has(label)) continue;
      map.set(label, it);
      // Search-only tokens: BOTH size and pcs (whichever isn't the visible
      // prefix) plus the sub-category, so a Size-view row is still found by
      // typing its pcs and vice versa.
      const keywords = [fmtNum(it.size), fmtNum(it.pcs), it.subCategory ?? ''].filter(Boolean).join(' ');
      options.push({ value: label, label, keywords });
    }
    return { options, map };
  }, [lookups, logos, showBy]);

  const categoryFieldMap = useMemo(() => {
    const m = new Map<string, 'KGS' | 'PCS'>();
    for (const cf of lookups?.categoryFields ?? []) m.set(cf.category.toUpperCase(), cf.field === 'PCS' ? 'PCS' : 'KGS');
    return m;
  }, [lookups]);

  const designNameOptions = useMemo(
    () => resolveDesignNameChoices(lookups, entry.designType, entry.category, entry.subCategory),
    [lookups, entry.designType, entry.category, entry.subCategory],
  );
  const noDesignNames = designNameOptions.choices.length === 0;

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
      // Always the item's actual SIZE, regardless of which number the label is
      // currently showing — psize downstream means size, never a pcs count.
      psize: it.size != null ? String(it.size) : '',
      // Feed the Pcs ⇄ Box ⇄ Kgs cascade below.
      weight: it.weight != null ? String(it.weight) : '',
      pcsBox: it.pcs != null ? String(it.pcs) : '',
    }));
  };

  // As the user types the item name, the leading number is either a size or a
  // pcs value — auto-flip Size/Pcs to whichever the catalogue matches. Identical
  // rule to the New Order item picker's detector, scoped to this booking's item
  // list. Only runs when the auto-detect preference is on.
  const detectShowBy = (text: string) => {
    if (!autoSizePcs) return;
    const mode = detectSizeOrPcs(text, lookups?.items ?? []);
    if (mode) setShowBy(mode);
  };

  // Auto-fill Kgs (= Bags × the customer's per-category bag weight) as bags are
  // typed — same as the main order form. The user can still overtype Kgs; with no
  // weight configured for the item's category, only Bags changes.
  const onBags = (value: string) => {
    setEntry((e) => {
      const cat = e.category.trim().toUpperCase();
      const bw = bagWeights.find((b) => b.category.trim().toUpperCase() === cat);
      const bags = n(value) ?? 0;
      return {
        ...e,
        bags: value,
        gram: bw && value.trim() !== '' ? String(round2(bags * bw.kgsPerBag)) : e.gram,
      };
    });
  };

  // Pcs ⇄ Box are linked by the product's pieces-per-box (pcsBox): typing Pcs fills
  // Box (= Pcs ÷ pcs-per-box) AND Kgs (= Pcs × weight). Fully dynamic — onBox does
  // the reverse. With no pcs-per-box on the product, Box is left untouched.
  const onPcs = (value: string) => {
    setEntry((e) => {
      const pcs = n(value) ?? 0;
      const w = n(e.weight);
      const per = n(e.pcsBox);
      const has = value.trim() !== '';
      return {
        ...e,
        pcs: value,
        gram: w != null && has ? String(round2(pcs * w)) : e.gram,
        box: per != null && per > 0 && has ? String(round2(pcs / per)) : e.box,
      };
    });
  };

  // Box ⇄ Pcs reverse: typing Box fills Pcs (= Box × pcs-per-box) and cascades Kgs
  // (= Pcs × weight). e.g. a cup with 6 pcs-per-box: Box 32 → Pcs 192. With no
  // pcs-per-box, Box is just a plain number (nothing to derive).
  const onBox = (value: string) => {
    setEntry((e) => {
      const per = n(e.pcsBox);
      if (per == null || per <= 0) return { ...e, box: value };
      const box = n(value) ?? 0;
      const pcs = box * per;
      const w = n(e.weight);
      const has = value.trim() !== '';
      return {
        ...e,
        box: value,
        pcs: has ? String(round2(pcs)) : e.pcs,
        gram: w != null && has ? String(round2(pcs * w)) : e.gram,
      };
    });
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
    if (booksBags && wantBags - remaining.bags > 0.001) {
      return toast.error(
        remaining.bags <= 0
          ? `No bags left to draw on ${booking?.code ?? 'this booking'}.`
          : `Only ${money(remaining.bags)} bag(s) left on ${booking?.code ?? 'this booking'} — reduce the Bags.`,
      );
    }
    if (booksKgs && wantKgs - remaining.kgs > 0.001) {
      return toast.error(
        remaining.kgs <= 0
          ? `No kgs left to draw on ${booking?.code ?? 'this booking'}.`
          : `Only ${money(remaining.kgs)} kg(s) left on ${booking?.code ?? 'this booking'} — reduce the Kgs.`,
      );
    }
    const calField = categoryFieldMap.get(entry.category.trim().toUpperCase()) ?? 'KGS';
    const designName = noDesignNames ? 'NA' : entry.designName;

    // Price this line now. If the current price differs from the frozen booking-
    // date price, ask which one to bill BEFORE queuing the line.
    let useLatest = false;
    if (booking) {
      try {
        const priced = { ...entry, key: 'temp', calField, designName } as EntryLine;
        const res = await quote.mutateAsync({ id: booking.id, lines: [toQuoteInput(priced)] });
        const q0 = res.lines?.[0];
        if (q0?.priceChanged) {
          const choice = await new Promise<'old' | 'new' | null>((resolve) =>
            setLinePrompt({ item: entry.itemName || entry.product, product: entry.product || entry.itemName, oldRate: q0.rate, newRate: q0.currentRate, resolve }),
          );
          setLinePrompt(null);
          if (choice === null) return; // user backed out of adding this item
          useLatest = choice === 'new';
        }
      } catch {
        // If pricing fails, fall through and add at the frozen booking rate.
      }
    }

    setLines((ls) => [...ls, { ...entry, key: `d${keyer.current++}`, calField, designName, useLatest }]);
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

  // A booking is denominated in bags, in kgs, or in both. A bags-only booking
  // (kgs = 0) reserves no kgs, so a line's Kgs — which auto-fills from the
  // party's kgs-per-bag — is a detail of that line, not a draw against the
  // booking. Only a dimension the booking actually books can limit the draw.
  const booksBags = (booking?.bags ?? 0) > 0;
  const booksKgs = (booking?.kgs ?? 0) > 0;

  const overBags = booksBags && remaining.bags < -0.001;
  const overKgs = booksKgs && remaining.kgs < -0.001;

  // Build the drawn lines and hand them to the order. Each line already carries the
  // user's per-item choice (`useLatest`, made at Add time) of latest vs booking price.
  const buildAndAdd = () => {
    if (!booking) return;
    const drawn: DrawnBookingLine[] = lines.map((l, i) => {
      const q = quoted[i];
      const pickNew = !!l.useLatest && !!q?.priceChanged;
      // Latest price uses the current base + current special delta; the frozen
      // (booking-date) price uses the snapshotted base + snapshotted delta.
      const productRate = q ? (pickNew ? q.currentProductRate + q.currentProductDelta : q.productRate + q.productDelta) : 0;
      const designRate = q ? (pickNew ? q.currentDesignRate + q.currentDesignDelta : q.designRate + q.designDelta) : 0;
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
        weight: l.weight,
        pcsBox: l.pcsBox,
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

  const confirm = () => {
    if (!booking) return toast.error('Pick a booking first');
    if (!lines.length) return toast.error('Add at least one item');
    if (overBags || overKgs) return toast.error('The items exceed what is left on this booking');
    // Each line's old/new price was already chosen at Add time — just build.
    buildAndAdd();
  };

  return (
    <>
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
                {/* Only the dimension(s) this booking is actually denominated in —
                    a bags-only booking showing "Kgs left to draw 0" reads as a
                    blocker when nothing about kgs constrains the draw. */}
                <div className={cn('grid gap-3 rounded-lg border bg-slate-50/70 px-3 py-2', booksBags && booksKgs ? 'grid-cols-2' : 'grid-cols-1')}>
                  {booksBags && <Stat label="Bags left to draw" value={money(Math.max(0, remaining.bags))} over={overBags} />}
                  {booksKgs && <Stat label="Kgs left to draw" value={money(Math.max(0, remaining.kgs))} over={overKgs} />}
                </div>

                {/* Item entry — mirrors the order form: item, design name, priority… */}
                <div className="space-y-2.5 rounded-lg border bg-slate-50/70 p-3">
                  <div className="grid grid-cols-2 items-end gap-2.5 lg:grid-cols-12">
                    {/* Manual Size/Pcs picker — shown only when auto-detect is off,
                        same as the New Order item picker. */}
                    {!autoSizePcs && (
                      <div className="col-span-2 space-y-1.5 lg:col-span-2">
                        <Label className="text-base">Show item by</Label>
                        <div className="flex h-11 items-center gap-4 text-sm">
                          <label className="flex cursor-pointer items-center gap-1.5">
                            <input type="radio" className="accent-indigo-600" checked={showBy === 'SIZE'} onChange={() => setShowBy('SIZE')} /> Size
                          </label>
                          <label className="flex cursor-pointer items-center gap-1.5">
                            <input type="radio" className="accent-indigo-600" checked={showBy === 'PCS'} onChange={() => setShowBy('PCS')} /> Pcs
                          </label>
                        </div>
                      </div>
                    )}
                    <div className={cn('col-span-2 space-y-1.5', autoSizePcs ? 'lg:col-span-6' : 'lg:col-span-4')}>
                      <Label className="text-base">Item name</Label>
                      {/* Item labels are "{size|pcs} {product} {design}" — the
                          keyboard opens on digits and hands over to letters the
                          moment no item continues the typed number, same as the
                          New Order picker. */}
                      <NativeSelect
                        value={entry.itemName}
                        onChange={onItemPick}
                        onType={detectShowBy}
                        options={itemOptions.options}
                        placeholder="Pick an item…"
                        className="h-11 text-left text-base"
                        digitsFirst
                        onInvalidEntry={() => toast.error('Please select a correct item')}
                      />
                    </div>
                    <div className="col-span-1 space-y-1.5 lg:col-span-3">
                      <Label className="text-base">Design Name</Label>
                      <DesignNamePicker
                        value={noDesignNames ? 'NA' : entry.designName}
                        onChange={(v) => setEntry((s) => ({ ...s, designName: v }))}
                        choices={designNameOptions.choices}
                        multiple={designNameOptions.multiple}
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
                    {/* Bags / Pcs / Kgs / Box in the order configured per product
                        category in Settings -> Order quantity fields — the same
                        call the New Order form makes, so the two screens can't
                        disagree about where a field sits. */}
                    {qtyOrderForCategory(qtyLayout, entry.category).map((f: QtyField) => {
                      if (f === 'bags')
                        return (
                          <div key="bags" className="space-y-1.5 lg:col-span-2"><Label className="text-base">Bags</Label><Input type="number" step="any" min={0} className="h-11 text-right text-lg font-semibold tabular-nums" value={entry.bags} onChange={(e) => onBags(e.target.value)} /></div>
                        );
                      if (f === 'pcs')
                        return (
                          <div key="pcs" className="space-y-1.5 lg:col-span-2"><Label className={cn('text-base', showBy === 'PCS' && 'text-primary font-semibold')}>Pcs</Label><Input type="number" step="any" min={0} className="h-11 text-right text-lg font-semibold tabular-nums" value={entry.pcs} onChange={(e) => onPcs(e.target.value)} /></div>
                        );
                      if (f === 'kgs')
                        return (
                          <div key="kgs" className="space-y-1.5 lg:col-span-2"><Label className={cn('text-base', showBy === 'SIZE' && 'text-primary font-semibold')}>Kgs</Label><Input type="number" step="any" min={0} className="h-11 text-right text-lg font-semibold tabular-nums" value={entry.gram} onChange={(e) => setEntry((s) => ({ ...s, gram: e.target.value }))} /></div>
                        );
                      return (
                        <div key="box" className="space-y-1.5 lg:col-span-2"><Label className="text-base">Box</Label><Input type="number" step="any" min={0} className="h-11 text-right text-lg font-semibold tabular-nums" value={entry.box} onChange={(e) => onBox(e.target.value)} /></div>
                      );
                    })}
                    <div className="col-span-4 space-y-1.5 lg:col-span-2"><Label className="text-base">Remarks</Label><Input className="h-11 text-base" value={entry.comment} onChange={(e) => setEntry((s) => ({ ...s, comment: e.target.value }))} placeholder="Item remark…" /></div>
                    <div className="col-span-4 lg:col-span-2"><Button onClick={addLine} className="h-11 w-full text-base"><Plus /> Add</Button></div>
                  </div>
                </div>

                {/* Queued lines with frozen-rate quote */}
                <div className="overflow-auto rounded-lg border">
                  <table className="w-full text-base [&_td]:border-r [&_td]:border-border/60 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-border/40 [&_th:last-child]:border-r-0">
                    <thead className="[&_th]:bg-muted [&_th]:px-3.5 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold">
                      <tr>
                        <th>Item</th>
                        <th>Design</th>
                        <th>Priority</th>
                        <th className="text-right">Bags</th>
                        <th className="text-right">Pcs</th>
                        <th className="text-right">Kgs</th>
                        <th className="text-right">Box</th>
                        <th className="text-right">Rate ₹</th>
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
                              <td className="text-right tabular-nums">
                                {quote.isPending && !q ? (
                                  <Loader2 className="ml-auto size-3 animate-spin" />
                                ) : q ? (
                                  <div className="flex flex-col items-end gap-0.5">
                                    <span className={cn(l.useLatest && q.priceChanged && 'text-amber-700')}>{money(l.useLatest ? q.currentRate : q.rate)}</span>
                                    {q.priceChanged && (
                                      <button
                                        type="button"
                                        onClick={() => openPriceHistory(l.product || l.itemName)}
                                        title={`booking ₹${money(q.rate)} · latest ₹${money(q.currentRate)} — view history`}
                                        className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-200"
                                      >
                                        <History className="size-3" /> {l.useLatest ? 'latest price' : 'booking price'}
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </td>
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

      {/* Old-vs-new price confirmation — shown at Add time when the item being added
          has a newer price than the frozen booking-date rate. */}
      <Dialog open={!!linePrompt} onOpenChange={(o) => { if (!o) linePrompt?.resolve(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-2xl">
              <History className="size-6 text-amber-600" /> Newer price found
            </DialogTitle>
            <DialogDescription className="text-base">
              “{linePrompt?.item}” has a newer price than the booking-date rate. Which price should this item use?
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2 rounded-md border bg-slate-50/70 px-4 py-3">
            <span className="text-lg tabular-nums">
              booking <b className="text-slate-700">₹{money(linePrompt?.oldRate ?? 0)}</b> → latest <b className="text-amber-700">₹{money(linePrompt?.newRate ?? 0)}</b>
            </span>
            <button
              type="button"
              onClick={() => linePrompt && openPriceHistory(linePrompt.product)}
              title="View this item's price history"
              className="text-muted-foreground hover:text-primary inline-flex shrink-0 items-center gap-1 text-sm font-medium"
            >
              History <ExternalLink className="size-4" />
            </button>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button className="h-11 bg-amber-600 text-base text-white hover:bg-amber-700" onClick={() => linePrompt?.resolve('new')}>Use latest price</Button>
            <Button variant="outline" className="h-11 text-base" onClick={() => linePrompt?.resolve('old')}>Keep booking price</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
