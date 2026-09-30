import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Eraser, Info, Loader2, Pencil, Plus, Send, Trash2, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { qtyOrderForCategory, type BookingDispatchLineInput, type BookingDispatchResult } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { NativeSelect } from '@/components/common/combo';
import { useOrderLookups } from '@/features/orders/use-orders';
import { useOrderQtyLayout } from '@/features/settings/use-settings';
import { useDraftPhotoCheck } from '@/features/dispatch/use-dispatch';
import { DesignNamePicker, resolveDesignNameChoices } from '@/features/orders/design-name-picker';
import { LinePhotoButton, toPhotoInput, type LinePhoto } from '@/features/orders/line-photos';
import { buildItemOptions } from '@/features/orders/item-options';
import { useAllDrawableBookings, useBookingDispatchOptions, useDispatchFromBooking } from './use-bookings';

const today = () => new Date().toISOString().slice(0, 10);
const n = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;
const norm = (s?: string | null) => (s ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

/** The category this screen works in. Cups are what moves this way. */
const CATEGORY = 'CUP';

/** One line being typed — the same fields the New Order form takes for a cup. */
interface Entry {
  subCategory: string;
  /** "BOROSIL CUP HAMMER" — product plus design type, as the item list shows it. */
  itemName: string;
  product: string;
  designType: string;
  designName: string;
  pcs: string;
  box: string;
  gram: string;
  comment: string;
  photos: LinePhoto[];
}
interface DraftLine extends Entry {
  key: string;
}
const blankEntry = (subCategory = ''): Entry => ({
  subCategory,
  itemName: '',
  product: '',
  designType: '',
  designName: '',
  pcs: '',
  box: '',
  gram: '',
  comment: '',
  photos: [],
});

/** Unsent lines survive a reload (a deploy reloads open tabs). */
const DRAFT_KEY = 'oms.booking-dispatch.draft';
const readDraft = (): { customer: string; bookingId: number | null; lines: DraftLine[] } | null => {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
    // Drafts saved before lines had every field fill the gaps from a blank line.
    return d && { ...d, lines: (d.lines ?? []).map((l: DraftLine) => ({ ...blankEntry(), ...l, itemName: l.itemName ?? l.product })) };
  } catch {
    return null;
  }
};

/**
 * Products → Booking Dispatch
 * ---------------------------
 * Send cups out against a bag booking without anyone raising an order first.
 * The server creates the order line (at the booking's frozen rate) and its
 * dispatch together. Lines are entered like on the New Order form: item and
 * design, design name, quantities in the category's field order, remark and
 * photos — and can be edited before dispatching.
 */
export function BookingDispatchPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: lookups } = useOrderLookups();
  const { data: qtyLayout } = useOrderQtyLayout();
  const send = useDispatchFromBooking();
  const [done, setDone] = useState<BookingDispatchResult | null>(null);

  const [draft] = useState(readDraft);
  const [customer, setCustomer] = useState(draft?.customer ?? '');
  const [bookingId, setBookingId] = useState<number | null>(draft?.bookingId ?? null);
  const [dispatchDate, setDispatchDate] = useState(today());
  const [lines, setLines] = useState<DraftLine[]>(draft?.lines ?? []);
  const keyer = useRef(Date.now());
  const keepLines = useRef(!!draft?.lines.length);
  useEffect(() => {
    try {
      if (lines.length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ customer, bookingId, lines }));
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* storage blocked — the draft just isn't kept */
    }
  }, [customer, bookingId, lines]);

  const [entry, setEntry] = useState<Entry>(blankEntry());
  /** Bags the whole dispatch goes in — asked once, after the lines, and drawn off the booking. */
  const [totalBags, setTotalBags] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const entryRef = useRef<HTMLDivElement>(null);
  /** What a Box edit overwrote, so emptying Box puts Pcs/Kgs back (as on New Order). */
  const pcsBeforeBoxRef = useRef<{ pcs: string; gram: string } | null>(null);
  /** Fields the user has typed in or cleared on this line — never auto-filled again. */
  const touched = useRef(new Set<'pcs' | 'box' | 'gram'>());

  const customers = useMemo(() => (lookups?.customers ?? []).map((c) => c.name), [lookups]);
  const customerId = lookups?.customers.find((c) => c.name === customer)?.id ?? null;
  const { data: options, isFetching } = useBookingDispatchOptions(customer || undefined, CATEGORY);

  const bookings = options?.bookings ?? [];
  const booking = bookings.find((b) => b.id === bookingId) ?? null;
  const kgsPerBag = options?.kgsPerBag ?? null;

  // Every party's open CUP bookings, to pick one from the list.
  const { data: allBookings = [], isLoading: allLoading } = useAllDrawableBookings(CATEGORY);
  const [bookingSearch, setBookingSearch] = useState('');
  const shownBookings = useMemo(() => {
    const q = bookingSearch.trim().toUpperCase();
    return q ? allBookings.filter((b) => `${b.customerName ?? ''} ${b.code}`.toUpperCase().includes(q)) : allBookings;
  }, [allBookings, bookingSearch]);
  /** A booking picked from the list, applied once its party's options load. */
  const pickRef = useRef<number | null>(draft?.bookingId ?? null);
  const pickBooking = (b: { id: number; customerName?: string }) => {
    if (!b.customerName) return;
    if (b.customerName === customer) return setBookingId(b.id);
    pickRef.current = b.id;
    setCustomer(b.customerName);
  };

  // Changing party invalidates the booking — its rates and remaining belong to
  // the old one, and silently keeping it would price against the wrong deal.
  useEffect(() => {
    setBookingId(pickRef.current);
    pickRef.current = null;
    // The restored draft belongs to this party — keep it on the first run.
    if (keepLines.current) keepLines.current = false;
    else setLines([]);
    setEditingKey(null);
    setEntry(blankEntry());
  }, [customer]);

  // One booking is the common case; pre-select it so there is nothing to click.
  useEffect(() => {
    if (bookingId == null && bookings.length === 1) setBookingId(bookings[0].id);
  }, [bookings, bookingId]);

  /** The New Order item-name list (same builder), cups only. Picking one
   *  fills in its sub-category. */
  const [itemQuery, setItemQuery] = useState('');
  const itemOptions = useMemo(
    () => buildItemOptions((lookups?.items ?? []).filter((it) => norm(it.category) === CATEGORY), 'SIZE', itemQuery),
    [lookups, itemQuery],
  );

  /** Pieces per box and per-piece weight come from the product master. */
  const productFor = (subCategory: string, product: string) =>
    (options?.items ?? []).find((i) => i.subCategory === subCategory && i.product === product) ?? null;

  /** The rate this line is billed at: frozen on the chosen booking at its
   *  booking date, product + design (today's chart only as a fallback). */
  const rateFor = (l: Pick<Entry, 'subCategory' | 'product' | 'designType'>) =>
    (options?.frozenRates ?? []).find(
      (r) =>
        r.bookingId === bookingId &&
        r.subCategory === l.subCategory &&
        r.product === l.product &&
        (r.designType ?? '') === l.designType,
    )?.rate ??
    productFor(l.subCategory, l.product)?.rate ??
    0;

  const designNames = useMemo(
    () => resolveDesignNameChoices(lookups, entry.designType, CATEGORY, entry.subCategory),
    [lookups, entry.designType, entry.subCategory],
  );
  const noDesignNames = designNames.choices.length === 0;

  /** Kgs as the server will take it: typed, else pcs × per-piece weight. */
  const figures = (l: Entry) => {
    const w = productFor(l.subCategory, l.product)?.weight ?? 0;
    const pcs = n(l.pcs) ?? 0;
    return { box: n(l.box) ?? 0, pcs, kgs: n(l.gram) || r2(pcs * w) };
  };

  const computed = useMemo(
    () =>
      lines.map((l) => {
        const f = figures(l);
        const rate = rateFor(l);
        return { ...l, ...f, rate, amount: r2(f.pcs * rate) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, options, bookingId],
  );

  const totals = useMemo(
    () => ({
      box: r2(computed.reduce((s, l) => s + l.box, 0)),
      pcs: r2(computed.reduce((s, l) => s + l.pcs, 0)),
      kgs: r2(computed.reduce((s, l) => s + l.kgs, 0)),
      amount: r2(computed.reduce((s, l) => s + l.amount, 0)),
    }),
    [computed],
  );

  // ── Reference photos: the same rule Create & Dispatch applies ─────────────
  const photoLines = useMemo(
    () =>
      lines.map((l) => ({
        key: l.key,
        product: l.product,
        psize: productFor(l.subCategory, l.product)?.size ?? null,
        designType: l.designType || null,
        design: l.designName || null,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, options],
  );
  const { data: photoStatus } = useDraftPhotoCheck({ customerId, lines: photoLines }, !!customerId);
  const missingPhotoKeys = useMemo(() => {
    if (!photoStatus) return new Set<string>();
    const attached = new Map(lines.map((l) => [l.key, l.photos.length > 0]));
    return new Set(
      Object.entries(photoStatus)
        .filter(([key, st]) => st.needsPhoto && !st.hasPhoto && !attached.get(key))
        .map(([key]) => key),
    );
  }, [photoStatus, lines]);
  const photoStatusFor = (key: string) => ({
    required: missingPhotoKeys.has(key),
    onFile: photoStatus?.[key]?.sampleUrl ?? null,
  });
  const setLinePhotos = (key: string, photos: LinePhoto[]) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, photos } : l)));

  // ── Quantities ───────────────────────────────────────────────────────────
  // Pcs, Box and Kgs fill each other the first time. Once the user types in or
  // clears a field, it is theirs: nothing auto-fills it again on this line.
  const auto = (f: 'pcs' | 'box' | 'gram') => !touched.current.has(f);

  const onItemPick = (label: string) => {
    const it = itemOptions.map.get(label);
    if (!it) return setEntry((e) => ({ ...e, itemName: label, subCategory: '', product: '', designType: '', designName: '' }));
    const p = productFor(it.subCategory, it.product);
    setEntry((e) => {
      const pcs = n(e.pcs);
      return {
        ...e,
        itemName: label,
        subCategory: it.subCategory,
        product: it.product,
        designType: it.designType ?? '',
        // Never pre-pick a design name — it is chosen explicitly, as on New Order.
        designName: '',
        gram: pcs != null && p?.weight && auto('gram') ? String(r2(pcs * p.weight)) : e.gram,
        box: pcs != null && p?.pcs && auto('box') ? String(r2(pcs / p.pcs)) : e.box,
      };
    });
  };

  const onPcs = (value: string) => {
    touched.current.add('pcs');
    pcsBeforeBoxRef.current = null;
    setEntry((e) => {
      const p = productFor(e.subCategory, e.product);
      const pcs = n(value);
      return {
        ...e,
        pcs: value,
        gram: pcs != null && p?.weight && auto('gram') ? String(r2(pcs * p.weight)) : e.gram,
        box: pcs != null && p?.pcs && auto('box') ? String(r2(pcs / p.pcs)) : e.box,
      };
    });
  };

  // Box drives Pcs only while Pcs is still automatic. Emptying Box then puts
  // back what it overwrote, so a half-deleted "32" never leaves Pcs at 18.
  const onBox = (value: string) => {
    touched.current.add('box');
    const has = value.trim() !== '';
    if (has && pcsBeforeBoxRef.current == null) {
      pcsBeforeBoxRef.current = { pcs: entry.pcs, gram: entry.gram };
    }
    const restore = has ? null : pcsBeforeBoxRef.current;
    if (!has) pcsBeforeBoxRef.current = null;
    setEntry((e) => {
      const p = productFor(e.subCategory, e.product);
      if (!p?.pcs || !auto('pcs')) return { ...e, box: value };
      if (!has) return { ...e, box: value, pcs: restore?.pcs ?? e.pcs, gram: restore?.gram ?? e.gram };
      const pcs = (n(value) ?? 0) * p.pcs;
      const gram = p.weight && auto('gram') ? String(r2(pcs * p.weight)) : e.gram;
      return { ...e, box: value, pcs: String(r2(pcs)), gram };
    });
  };

  const onKgs = (value: string) => {
    touched.current.add('gram');
    setEntry((e) => ({ ...e, gram: value }));
  };

  const resetEntry = () => {
    pcsBeforeBoxRef.current = null;
    touched.current.clear();
    setEditingKey(null);
    setEntry(blankEntry());
  };

  // ── Add / update — New Order's checks ─────────────────────────────────────
  const addLine = async () => {
    if (!entry.product || !entry.subCategory) return toast.error('Please select a correct item from the list');
    if (!noDesignNames && !entry.designName.trim()) return toast.error('Please select a Design Name for this item');
    for (const [label, v] of [['Pcs', entry.pcs], ['Box', entry.box], ['Kgs', entry.gram]] as const) {
      if ((n(v) ?? 0) < 0) return toast.error(`${label} cannot be negative`);
    }
    if (!((n(entry.pcs) ?? 0) > 0)) return toast.error('Enter Pcs — this item is billed by pieces');
    if (rateFor(entry) <= 0) return toast.error('This item has no rate on the booking — it cannot be ₹0');
    const designName = noDesignNames ? 'NA' : entry.designName;
    const dupIdx = lines.findIndex(
      (l) =>
        l.key !== editingKey &&
        norm(l.itemName) === norm(entry.itemName) &&
        l.subCategory === entry.subCategory &&
        norm(l.designName || 'NA') === norm(designName) &&
        norm(l.comment) === norm(entry.comment),
    );
    if (dupIdx >= 0) {
      const ok = await confirm({
        title: 'Item already added',
        description: `"${entry.itemName}" is already on this list (line ${dupIdx + 1}). Add it again as a separate line?`,
        confirmText: 'Add anyway',
      });
      if (!ok) return;
    }
    const line: DraftLine = { ...entry, designName, key: editingKey ?? String(keyer.current++) };
    setLines((ls) => (editingKey ? ls.map((l) => (l.key === editingKey ? line : l)) : [...ls, line]));
    if (editingKey) toast.success('Item updated');
    resetEntry();
  };

  const editLine = (l: DraftLine) => {
    if (editingKey) return toast.info('Finish or cancel the current item edit first.');
    const { key, ...rest } = l;
    pcsBeforeBoxRef.current = null;
    // A field left empty on the line was removed on purpose — keep it that way.
    touched.current = new Set((['pcs', 'box', 'gram'] as const).filter((f) => !rest[f]));
    setEditingKey(key);
    setEntry(rest);
    entryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast.info('Editing item — change the fields above, then tap Update.');
  };

  const removeLine = (key: string) => {
    setLines((ls) => ls.filter((l) => l.key !== key));
    if (editingKey === key) resetEntry();
  };

  const entryDirty = !!(entry.itemName || entry.pcs || entry.box || entry.gram || entry.comment || entry.photos.length);

  const submitRef = useRef<() => void>(() => {});
  const submit = async () => {
    if (!customer) return toast.error('Select a customer');
    if (!booking) return toast.error('Select a booking');
    if (!lines.length) return toast.error('Add at least one item');
    if (editingKey) return toast.error('Finish or cancel the item being edited first');
    const bags = n(totalBags) ?? 0;
    if (bags <= 0) return toast.error('Enter how many bags this dispatch goes in');
    if (missingPhotoKeys.size) {
      const names = lines.filter((l) => missingPhotoKeys.has(l.key)).map((l) => l.itemName);
      return toast.error(
        `Reference photo required before dispatching: ${names.join(', ')}. Add a photo on ${names.length === 1 ? 'that line' : 'those lines'} (red camera).`,
      );
    }

    const ok = await confirm({
      title: 'Dispatch these against the booking?',
      description:
        `${lines.length} item(s) · ${totals.box} box · ${totals.pcs} pcs · ${totals.kgs} kgs in ${bags} bags ` +
        `off ${booking.code} for "${customer}". An order line is created for each and dispatched in full, ` +
        `then they go to Pending Challan like any other dispatch.`,
      confirmText: 'Dispatch',
    });
    if (!ok) return;

    const payload: BookingDispatchLineInput[] = lines.map((l) => ({
      subCategory: l.subCategory,
      product: l.product,
      designType: l.designType || null,
      design: l.designName || 'NA',
      box: n(l.box),
      pcs: n(l.pcs),
      gram: n(l.gram),
      comment: l.comment.trim() || null,
      photos: toPhotoInput(l.photos),
    }));
    send.mutate(
      { bookingId: booking.id, dispatchDate, bags, lines: payload },
      {
        onSuccess: (res) => {
          setDone(res);
          setLines([]);
          setTotalBags('');
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Dispatch failed')),
      },
    );
  };
  submitRef.current = submit;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const enterAdds = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void addLine();
    }
  };
  const qtyInput = (label: string, value: string, onChange: (v: string) => void) => (
    <div key={label} className="space-y-1">
      <Label className="text-base">{label}</Label>
      <Input
        type="number"
        step="any"
        min={0}
        className="text-right tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={enterAdds}
        placeholder="0"
      />
    </div>
  );
  const entryRate = entry.product ? rateFor(entry) : 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 font-sans">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/bookings')} aria-label="Back">
          <ArrowLeft />
        </Button>
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <Truck className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight">Booking Dispatch</h2>
          <p className="text-muted-foreground text-xs">
            Send {CATEGORY.toLowerCase()}s out against a bag booking — the order line is created for you.
          </p>
        </div>
      </div>

      {done && (
        <Card className="border-l-4 border-l-emerald-500 bg-emerald-50/60 py-0">
          <CardContent className="space-y-1.5 px-4 py-3">
            <p className="flex items-center gap-2 text-[13.5px] font-bold text-emerald-800">
              <Check className="size-4" /> Dispatched · order {done.orderCode ?? done.orderId}
            </p>
            <p className="text-[12px] font-medium text-emerald-900/80">
              {done.totals.box} box · {done.totals.pcs} pcs · {done.totals.kgs} kgs · {done.totals.bags} bags off the booking.
              {done.lines.some((l) => l.approvalCode)
                ? ` Some lines need approval: ${done.lines.filter((l) => l.approvalCode).map((l) => l.approvalCode).join(', ')}.`
                : ' Now waiting in Pending Challan.'}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" className="h-8 rounded-[4px]" onClick={() => setDone(null)}>
                Dispatch more
              </Button>
              <Button size="sm" className="h-8 rounded-[4px]" onClick={() => navigate('/challans/pending')}>
                Go to Pending Challan
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Every party's open CUP bookings: pick a row, then add its items below. */}
      <Card className="py-0">
        <CardContent className="space-y-2 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold">
              {CATEGORY} bag bookings <span className="text-muted-foreground font-medium">· {allBookings.length} open</span>
            </p>
            <Input
              value={bookingSearch}
              onChange={(e) => setBookingSearch(e.target.value)}
              placeholder="Search party or booking…"
              className="h-8 w-56"
            />
          </div>
          <div className="max-h-64 overflow-auto rounded-md border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted sticky top-0 text-left text-[11px] uppercase">
                <tr>
                  <th className="px-2.5 py-1.5">Customer</th>
                  <th className="px-2.5 py-1.5">Booking</th>
                  <th className="px-2.5 py-1.5">Date</th>
                  <th className="px-2.5 py-1.5 text-right">Bags left</th>
                  <th className="px-2.5 py-1.5 text-right">Kgs left</th>
                  <th className="px-2.5 py-1.5">Bag weight</th>
                </tr>
              </thead>
              <tbody>
                {shownBookings.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => pickBooking(b)}
                    className={
                      b.id === bookingId
                        ? 'cursor-pointer border-t bg-indigo-50 font-semibold dark:bg-indigo-500/15'
                        : 'hover:bg-muted/60 cursor-pointer border-t'
                    }
                  >
                    <td className="px-2.5 py-1.5">
                      {b.id === bookingId && <Check className="mr-1 inline size-3.5 text-indigo-600" />}
                      {b.customerName}
                    </td>
                    <td className="px-2.5 py-1.5 font-mono text-[12px]">{b.code}</td>
                    <td className="px-2.5 py-1.5">{formatDate(b.bookingDate)}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{b.remainingBags}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{b.remainingKgs}</td>
                    <td className="px-2.5 py-1.5">
                      {b.kgsPerBag ? `1 bag = ${b.kgsPerBag} kgs` : '—'}
                    </td>
                  </tr>
                ))}
                {!shownBookings.length && (
                  <tr>
                    <td colSpan={6} className="text-muted-foreground px-2.5 py-4 text-center">
                      {allLoading ? 'Loading…' : `No open ${CATEGORY} bookings${bookingSearch ? ' match this search' : ''}.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-l-primary border-l-4 py-0">
        <CardContent className="grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-base">
              Customer <span className="text-rose-500">*</span>
            </Label>
            <NativeSelect
              value={customer}
              onChange={setCustomer}
              options={customers}
              placeholder="Select customer…"
              onInvalidEntry={() => toast.error('Please select a correct customer')}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-base">
              Booking <span className="text-rose-500">*</span>
              {isFetching && <Loader2 className="text-muted-foreground ml-1.5 inline size-3 animate-spin" />}
            </Label>
            {/* Keyed by CODE, not id: the closed field shows its own value, and
                "4" tells an operator nothing about which booking they picked. */}
            <NativeSelect
              value={booking?.code ?? ''}
              onChange={(v) => setBookingId(bookings.find((b) => b.code === v)?.id ?? null)}
              options={bookings.map((b) => b.code)}
              renderOption={(v) => {
                const b = bookings.find((x) => x.code === v);
                return b ? `${b.code} · ${formatDate(b.bookingDate)} · ${b.remainingBags} bags left` : v;
              }}
              placeholder={customer ? 'Select booking…' : 'Pick a customer first'}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-base">Dispatch date</Label>
            <DatePicker value={dispatchDate} onChange={setDispatchDate} clearable={false} />
            <p className="text-muted-foreground text-[11px]">A past date needs approval, same as any other dispatch.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-base">Bag weight</Label>
            <Input
              readOnly
              tabIndex={-1}
              value={kgsPerBag ? `1 bag = ${kgsPerBag} kgs` : '—'}
              className="border-indigo-200/70 bg-indigo-50/60 font-medium text-indigo-700"
            />
          </div>
        </CardContent>
      </Card>

      {booking && (
        <Card className="border-border border-l-4 border-l-slate-400 bg-slate-50/70 py-0">
          <CardContent className="space-y-2.5 px-4 py-3">
            <div ref={entryRef} className="space-y-2.5">
              {editingKey && (
                <p className="text-[12px] font-bold text-amber-700">Editing a line — change it, then tap Update.</p>
              )}
              <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[2fr_1fr_1.2fr_0.8fr]">
                <div className="col-span-2 space-y-1 sm:col-span-1">
                  <Label className="text-base">Item name</Label>
                  <NativeSelect
                    value={entry.itemName}
                    onChange={onItemPick}
                    onType={setItemQuery}
                    options={itemOptions.options}
                    placeholder="Item name"
                    className="text-left"
                    digitsFirst
                    onInvalidEntry={() => toast.error('Please select a correct item')}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-base">Sub-category</Label>
                  <Input readOnly tabIndex={-1} value={entry.subCategory} placeholder="From the item" className="bg-muted/40 font-mono text-[12px]" />
                </div>
                <div className="space-y-1">
                  <Label className="text-base">Design Name</Label>
                  <DesignNamePicker
                    value={noDesignNames ? 'NA' : entry.designName}
                    onChange={(designName) => setEntry((e) => ({ ...e, designName }))}
                    choices={designNames.choices}
                    multiple={designNames.multiple}
                    disabled={noDesignNames}
                    onInvalidEntry={() => toast.error('Please select a correct design name')}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-base">Rate ₹</Label>
                  <Input
                    readOnly
                    tabIndex={-1}
                    value={entryRate ? entryRate.toLocaleString('en-IN') : ''}
                    title="Frozen on the booking at its booking date"
                    className="border-emerald-200 bg-emerald-50 text-right font-bold text-emerald-700 tabular-nums"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_2fr_auto]">
                {/* Bags are not per line — asked once for the whole dispatch below. */}
                {qtyOrderForCategory(qtyLayout, CATEGORY)
                  .filter((f) => f !== 'bags')
                  .map((f) =>
                    f === 'pcs' ? qtyInput('Pcs', entry.pcs, onPcs) : f === 'box' ? qtyInput('Box', entry.box, onBox) : qtyInput('Kgs', entry.gram, onKgs),
                  )}
                <div className="col-span-2 space-y-1 sm:col-span-1">
                  <Label className="text-base">Remarks</Label>
                  <Input
                    value={entry.comment}
                    onChange={(e) => setEntry((x) => ({ ...x, comment: e.target.value }))}
                    onKeyDown={enterAdds}
                    placeholder="Item remark…"
                  />
                </div>
                <div className="col-span-2 flex items-center justify-end gap-1.5 sm:col-span-1">
                  <LinePhotoButton
                    photos={entry.photos}
                    onChange={(photos) => setEntry((e) => ({ ...e, photos }))}
                    status={editingKey ? photoStatusFor(editingKey) : undefined}
                  />
                  {editingKey ? (
                    <>
                      <Button onClick={() => void addLine()} size="icon" aria-label="Update item" title="Update this item">
                        <Check className="size-4" />
                      </Button>
                      <Button type="button" variant="outline" size="icon" onClick={resetEntry} aria-label="Cancel item edit" title="Cancel item edit">
                        <X className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button type="button" onClick={() => void addLine()}>
                        <Plus /> Add
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={resetEntry}
                        disabled={!entryDirty}
                        aria-label="Clear the item fields"
                        title="Clear the item fields"
                        className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        <Eraser className="size-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                <Info className="size-3.5 shrink-0" />
                Pcs, Box and Kgs fill each other the first time; a field you change or clear stays as you left it. Pcs is what gets billed.
              </p>
            </div>

            {computed.length > 0 && (
              <div className="overflow-x-auto rounded-lg border bg-white">
                <table className="w-full text-[13px]">
                  <thead className="bg-slate-100 text-[11px] font-bold tracking-wide text-slate-700 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-left">Size</th>
                      <th className="px-3 py-2 text-right">Box</th>
                      <th className="px-3 py-2 text-right">Pcs</th>
                      <th className="px-3 py-2 text-right">Kgs</th>
                      <th className="px-3 py-2 text-right">Rate</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="w-28" />
                    </tr>
                  </thead>
                  <tbody className="[&_td]:border-t [&_td]:px-3 [&_td]:py-1.5">
                    {computed.map((l) => (
                      <tr key={l.key} className={l.key === editingKey ? 'bg-amber-50' : undefined}>
                        <td>
                          <p className="font-semibold">{l.itemName}</p>
                          {(l.designName !== 'NA' || l.comment) && (
                            <p className="text-muted-foreground text-[11.5px]">
                              {[l.designName !== 'NA' ? l.designName : '', l.comment].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </td>
                        <td className="text-muted-foreground font-mono text-[11.5px]">{l.subCategory}</td>
                        <td className="text-right tabular-nums">{l.box || '—'}</td>
                        <td className="text-right tabular-nums">{l.pcs}</td>
                        <td className="text-right tabular-nums">{l.kgs}</td>
                        <td className="text-right tabular-nums">{l.rate}</td>
                        <td className="text-right font-semibold tabular-nums">{l.amount.toLocaleString('en-IN')}</td>
                        <td>
                          <div className="flex items-center justify-end gap-0.5">
                            <LinePhotoButton
                              photos={l.photos}
                              onChange={(photos) => setLinePhotos(l.key, photos)}
                              status={photoStatusFor(l.key)}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              onClick={() => editLine(lines.find((x) => x.key === l.key)!)}
                              aria-label={`Edit ${l.itemName}`}
                              title="Edit this line"
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive size-7"
                              onClick={() => removeLine(l.key)}
                              aria-label={`Remove ${l.itemName}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-100 font-bold">
                    <tr>
                      <td className="px-3 py-2 text-right" colSpan={2}>
                        Total
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{totals.box}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{totals.pcs}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{totals.kgs}</td>
                      <td />
                      <td className="px-3 py-2 text-right tabular-nums">{totals.amount.toLocaleString('en-IN')}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {computed.length > 0 && (
              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2.5">
                <div className="space-y-1">
                  <Label className="text-base">
                    Dispatch in how many bags? <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    type="number"
                    step="any"
                    min={0}
                    value={totalBags}
                    onChange={(e) => setTotalBags(e.target.value)}
                    placeholder={kgsPerBag ? String(r2(totals.kgs / kgsPerBag)) : '0'}
                    className="w-40 text-right font-bold tabular-nums"
                  />
                </div>
                <p className="text-muted-foreground pb-2 text-[11.5px]">
                  These bags come off {booking.code}.{kgsPerBag ? ` By bag weight it is about ${r2(totals.kgs / kgsPerBag)}.` : ''}
                </p>
              </div>
            )}

            <p className="text-muted-foreground text-[11.5px] font-medium">
              {booking.code} has <b className="text-foreground tabular-nums">{booking.remainingBags}</b> bags /{' '}
              <b className="text-foreground tabular-nums">{booking.remainingKgs}</b> kgs left.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end gap-2 border-t px-1 py-3">
        <Button type="button" variant="destructive" onClick={() => navigate('/bookings')}>
          Cancel
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={send.isPending || !booking || !lines.length}
          title="Dispatch (Ctrl+S)"
        >
          {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
          Dispatch {lines.length > 0 ? `${lines.length} item(s)` : ''}
        </Button>
      </div>
    </div>
  );
}

export default BookingDispatchPage;
