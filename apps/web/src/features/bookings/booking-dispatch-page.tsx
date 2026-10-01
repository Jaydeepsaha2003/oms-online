import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ChevronRight, Coffee, Eraser, Info, Loader2, Lock, Pencil, Plus, Search, Send, ShoppingBag, Trash2, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { qtyOrderForCategory, type BookingDispatchLineInput, type BookingDispatchResult } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useConfirm } from '@/components/common/confirm';
import { DatePicker } from '@/components/ui/date-picker';
import { NativeSelect } from '@/components/common/combo';
import { useOrderLookups } from '@/features/orders/use-orders';
import { useOrderQtyLayout } from '@/features/settings/use-settings';
import { useDraftPhotoCheck } from '@/features/dispatch/use-dispatch';
import { DesignNamePicker, resolveDesignNameChoices } from '@/features/orders/design-name-picker';
import { LinePhotoButton, toPhotoInput, type LinePhoto } from '@/features/orders/line-photos';
import { buildItemOptions } from '@/features/orders/item-options';
import { DispatchTruckAnimation } from '@/features/dispatch/dispatch-order-page';
import { useAllDrawableBookings, useBookingDispatchOptions, useDispatchFromBooking } from './use-bookings';

const today = () => new Date().toISOString().slice(0, 10);
const n = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;
const norm = (s?: string | null) => (s ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const nf = (x: number) => x.toLocaleString('en-IN');
const inr = (x: number) => `₹ ${nf(x)}`;
const items = (k: number) => `${k} item${k === 1 ? '' : 's'}`;
const QTY_TIP = 'Pcs, Box and Kgs fill each other the first time; a field you change or clear stays as you left it. Pcs is what gets billed.';

/** A party's initials on a colour that stays the same for that party. */
const AVATARS = [
  'linear-gradient(145deg,#4aa3ff,#0a6cff)',
  'linear-gradient(145deg,#a78bfa,#6d4bdb)',
  'linear-gradient(145deg,#34d399,#0f9d63)',
  'linear-gradient(145deg,#fbbf24,#e07a00)',
  'linear-gradient(145deg,#fb7185,#d6264a)',
];
const avatarOf = (name = '') => ({
  initials: name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join(''),
  bg: AVATARS[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % AVATARS.length],
});

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
  const isMobile = useIsMobile();
  const [done, setDone] = useState<BookingDispatchResult | null>(null);
  /** Order code the truck animation plays for, after a dispatch. */
  const [shipped, setShipped] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const [draft] = useState(readDraft);
  const [customer, setCustomer] = useState(draft?.customer ?? '');
  const [bookingId, setBookingId] = useState<number | null>(draft?.bookingId ?? null);
  const [dispatchDate, setDispatchDate] = useState(today());
  const [lines, setLines] = useState<DraftLine[]>(draft?.lines ?? []);
  /** Phone only: the booking list, then the form for the booking picked. */
  const [screen, setScreen] = useState<'pick' | 'form'>(draft?.lines.length && draft.bookingId != null ? 'form' : 'pick');
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
  /** The lines belong to one party: switching party clears them, so ask first. */
  const okToSwitch = async (name: string) =>
    name === customer ||
    !lines.length ||
    confirm({
      title: 'Change party?',
      description: `The ${items(lines.length)} on this list ${lines.length === 1 ? 'belongs' : 'belong'} to ${customer} and will be cleared.`,
      confirmText: 'Change',
      destructive: true,
    });
  const changeCustomer = async (name: string) => {
    if (await okToSwitch(name)) setCustomer(name);
  };
  const pickBooking = async (b: { id: number; customerName?: string }) => {
    if (!b.customerName || !(await okToSwitch(b.customerName))) return;
    setDone(null);
    setScreen('form');
    topRef.current?.scrollIntoView({ block: 'start' });
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
          setShipped(res.orderCode ?? '');
          setDone(res);
          setLines([]);
          setTotalBags('');
          setScreen('pick');
          topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
  const entryRate = entry.product ? rateFor(entry) : 0;
  const bags = n(totalBags) ?? 0;
  /** Where the user is: Booking → Items → Bags → Dispatch. */
  const step = !booking ? 0 : !lines.length ? 1 : bags <= 0 ? 2 : 3;
  const hint = kgsPerBag && totals.kgs ? r2(totals.kgs / kgsPerBag) : 0;
  const over = !!booking && bags > booking.remainingBags;
  const past = dispatchDate < today();
  const onForm = isMobile && screen === 'form' && !!booking;
  const editNo = editingKey ? lines.findIndex((l) => l.key === editingKey) + 1 : 0;

  const backToList = () => {
    setScreen('pick');
    if (editingKey) resetEntry();
    topRef.current?.scrollIntoView({ block: 'start' });
  };
  const cancelAll = async () => {
    if (!lines.length) return isMobile ? backToList() : navigate('/bookings');
    const ok = await confirm({
      title: 'Discard this dispatch?',
      description: `The ${items(lines.length)} on this list will be removed.`,
      confirmText: 'Discard',
      destructive: true,
    });
    if (!ok) return;
    setLines([]);
    setTotalBags('');
    resetEntry();
    if (isMobile) backToList();
  };

  const qtyBox = (f: 'pcs' | 'box' | 'gram', label: string, value: string, onChange: (v: string) => void) => {
    const filled = !!value && auto(f) && !!entry.product;
    return (
      <label key={label} className="bd-f bd-float bd-qty flex-1" data-auto={filled || undefined}>
        <span className="bd-lbl justify-between">
          {label}
          {filled && (
            <span className="bd-auto" title="Filled from the other quantities">
              AUTO
            </span>
          )}
        </span>
        <input
          type="number"
          step="any"
          min={0}
          inputMode="decimal"
          placeholder="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={enterAdds}
        />
      </label>
    );
  };
  const req = <span className="text-[#ff3b30]">*</span>;
  const muted = { color: 'var(--bd-muted)' };

  const bookingList = (
    <section className="bd-card" aria-label={`Open ${CATEGORY} bookings`} style={{ animationDelay: '.08s' }}>
      <div className="bd-head">
        <span className="bd-kicker">Step 1</span>
        <span className="bd-title">{CATEGORY} bag bookings</span>
        <span className="bd-pill">{allBookings.length} open</span>
      </div>
      <label className="bd-search">
        <span className="sr-only">Search bookings</span>
        <Search className="size-[15px]" strokeWidth={2.4} />
        <input value={bookingSearch} onChange={(e) => setBookingSearch(e.target.value)} placeholder="Search party or booking…" />
      </label>
      <div role="listbox" aria-label="Bookings" className="bd-list">
        {shownBookings.map((b, i) => {
          const on = b.id === bookingId;
          const av = avatarOf(b.customerName);
          return (
            <button
              key={b.id}
              type="button"
              role="option"
              aria-selected={on}
              className="bd-row"
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              onClick={() => void pickBooking(b)}
            >
              <span className="bd-av" style={{ background: av.bg }}>
                {av.initials}
                {on && (
                  <span className="bd-av-check">
                    <Check className="size-2.5 text-white" strokeWidth={4} />
                  </span>
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-px">
                <span className="bd-row-name">{b.customerName}</span>
                <span className="bd-row-sub">
                  <span className="bd-mono">{b.code}</span> · {formatDate(b.bookingDate)}
                  {b.kgsPerBag ? ` · 1 bag = ${b.kgsPerBag} kgs` : ''}
                </span>
                {isMobile && on && lines.length > 0 && <span className="bd-draft">Draft · {items(lines.length)}</span>}
              </span>
              <span className="flex flex-col items-end leading-tight">
                <span className="bd-big">
                  {nf(b.remainingBags)}
                  <small>BAGS</small>
                </span>
                <span className="bd-tiny">{nf(b.remainingKgs)} kgs left</span>
              </span>
              {isMobile && <ChevronRight className="size-[13px] text-[#c7c7cc]" strokeWidth={3} />}
            </button>
          );
        })}
        {!shownBookings.length && (
          <p className="px-2.5 py-5 text-center text-[13px]" style={muted}>
            {allLoading ? 'Loading…' : `No open ${CATEGORY} bookings${bookingSearch ? ' match this search' : ''}.`}
          </p>
        )}
      </div>
    </section>
  );

  const partyCard = (
    <section className="bd-card" aria-label="Party and booking" style={{ animationDelay: '.14s' }}>
      <div className="bd-grid">
        {/* On a phone the dark booking card above already says who and which. */}
        {!isMobile && (
          <>
            <div className="bd-f" data-on={customer ? '' : undefined}>
              <span className="bd-lbl">Customer {req}</span>
              <NativeSelect
                value={customer}
                onChange={(v) => void changeCustomer(v)}
                options={customers}
                placeholder="Select customer…"
                onInvalidEntry={() => toast.error('Please select a correct customer')}
              />
            </div>
            <div className="bd-f" data-on={booking ? '' : undefined}>
              <span className="bd-lbl">
                Booking {req}
                {isFetching && <Loader2 className="size-3 animate-spin text-[#0a6cff]" />}
              </span>
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
                disabled={!customer}
              />
            </div>
          </>
        )}
        <div className="bd-f" data-past={past ? '' : undefined}>
          <span className="bd-lbl">Dispatch date</span>
          <DatePicker value={dispatchDate} onChange={setDispatchDate} clearable={false} />
        </div>
        <div className="bd-f">
          <span className="bd-lbl">Bag weight</span>
          <span className="bd-ro bd-bagw">
            <ShoppingBag className="size-[15px]" strokeWidth={2.2} />
            {kgsPerBag ? `1 bag = ${kgsPerBag} kgs` : '—'}
          </span>
        </div>
      </div>
      <p className="bd-note items-center" style={past ? { color: '#b25000' } : undefined}>
        <span className="size-1.5 rounded-full" style={{ background: past ? '#ff9500' : '#c7c7cc' }} />A past date needs approval, same as
        any other dispatch.
      </p>
      {booking && (
        <div className="bd-meter" data-over={over ? '' : undefined}>
          <div className="flex items-baseline gap-2">
            <span className="flex-1">
              <b className="bd-mono">{booking.code}</b> has <b>{nf(booking.remainingBags)}</b> bags / <b>{nf(booking.remainingKgs)}</b> kgs left
            </span>
            <span className="bd-meter-use">
              {bags ? `${nf(bags)} of ${nf(booking.remainingBags)} bags${over ? ' — over' : ''}` : 'No bags yet'}
            </span>
          </div>
          <div className="bd-bar" role="img" aria-label={`${nf(bags)} of ${nf(booking.remainingBags)} bags used by this dispatch`}>
            <span style={{ width: `${over ? 100 : booking.remainingBags ? (bags / booking.remainingBags) * 100 : 0}%` }} />
          </div>
        </div>
      )}
    </section>
  );

  const entryCard = (
    <section ref={entryRef} className="bd-card bd-entry" data-editing={editingKey ? '' : undefined} aria-label="Add item">
      <div className="bd-head">
        {isMobile ? (
          <span className="bd-plus">
            <Plus className="size-3" strokeWidth={3} />
          </span>
        ) : (
          <span className="bd-kicker">Step 2</span>
        )}
        <span className="bd-title">{editingKey ? 'Edit cup' : 'Add cups'}</span>
        {editingKey && <span className="bd-badge-orange">{isMobile ? 'Line' : 'Editing line'} {editNo}</span>}
        {isMobile && (
          <span className="bd-i" title={QTY_TIP} aria-label={QTY_TIP}>
            i
          </span>
        )}
      </div>
      <div className="bd-flex">
        <div className="bd-f bd-wide flex-[2_1_240px]" data-on={entry.itemName ? '' : undefined}>
          <span className={isMobile ? 'sr-only' : 'bd-lbl'}>Item name</span>
          <NativeSelect
            value={entry.itemName}
            onChange={onItemPick}
            onType={setItemQuery}
            options={itemOptions.options}
            placeholder="Choose an item…"
            className="text-left"
            digitsFirst
            onInvalidEntry={() => toast.error('Please select a correct item')}
          />
        </div>
        <div className="bd-f bd-float flex-[1_1_130px]">
          <span className="bd-lbl">{isMobile ? 'Sub-cat' : 'Sub-category'}</span>
          <span className="bd-ro bd-mono" style={entry.subCategory ? undefined : { color: '#aeaeb2' }}>
            {entry.subCategory || 'From the item'}
          </span>
        </div>
        <div className="bd-f bd-float flex-[1_1_150px]" data-on={entry.designName && !noDesignNames ? '' : undefined}>
          <span className="bd-lbl">{isMobile ? 'Design' : 'Design Name'}</span>
          <DesignNamePicker
            value={noDesignNames ? 'NA' : entry.designName}
            onChange={(designName) => setEntry((e) => ({ ...e, designName }))}
            choices={designNames.choices}
            multiple={designNames.multiple}
            disabled={noDesignNames}
            onInvalidEntry={() => toast.error('Please select a correct design name')}
          />
        </div>
        <div className="bd-f bd-float bd-narrow flex-[1_1_110px]">
          <span className="bd-lbl" style={isMobile ? { color: '#3a9a5c' } : undefined}>
            Rate ₹
          </span>
          <span className="bd-ro bd-rate" title="Frozen on the booking at its booking date">
            {!isMobile && <Lock className="size-3 opacity-60" strokeWidth={2.6} />}
            {entryRate ? nf(entryRate) : '—'}
          </span>
        </div>
      </div>
      <div className="bd-flex">
        {/* Bags are not per line — asked once for the whole dispatch below. */}
        <div className="bd-grp bd-wide flex-[3_1_300px]">
          {qtyOrderForCategory(qtyLayout, CATEGORY)
            .filter((f) => f !== 'bags')
            .map((f) =>
              f === 'pcs' ? qtyBox('pcs', 'Pcs', entry.pcs, onPcs) : f === 'box' ? qtyBox('box', 'Box', entry.box, onBox) : qtyBox('gram', 'Kgs', entry.gram, onKgs),
            )}
        </div>
        <div className="bd-grp bd-wide flex-[2_1_320px]">
          <label className="bd-f flex-1">
            <span className={isMobile ? 'sr-only' : 'bd-lbl'}>Remarks</span>
            <input
              value={entry.comment}
              onChange={(e) => setEntry((x) => ({ ...x, comment: e.target.value }))}
              onKeyDown={enterAdds}
              placeholder={isMobile ? 'Remark (optional)' : 'Item remark…'}
            />
          </label>
          <span className="bd-photo" data-miss={editingKey && missingPhotoKeys.has(editingKey) ? '' : undefined}>
            <LinePhotoButton
              photos={entry.photos}
              onChange={(photos) => setEntry((e) => ({ ...e, photos }))}
              status={editingKey ? photoStatusFor(editingKey) : undefined}
            />
          </span>
          {editingKey ? (
            <>
              <button type="button" className="bd-btn bd-orange max-sm:order-last" onClick={() => void addLine()} title="Update this item">
                <Check className="size-4" strokeWidth={3} /> Update
              </button>
              <button type="button" className="bd-btn bd-grey bd-sq" onClick={resetEntry} aria-label="Cancel item edit" title="Cancel item edit">
                <X className="size-4" strokeWidth={2.8} />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="bd-btn bd-blue max-sm:order-last" onClick={() => void addLine()}>
                <Plus className="size-[17px]" strokeWidth={2.8} /> Add
              </button>
              <button
                type="button"
                className="bd-btn bd-red bd-sq"
                onClick={resetEntry}
                disabled={!entryDirty}
                aria-label="Clear the item fields"
                title="Clear the item fields"
              >
                <Eraser className="size-[17px]" strokeWidth={2.2} />
              </button>
            </>
          )}
        </div>
      </div>
      {!isMobile && (
        <p className="bd-note">
          <Info className="mt-px size-[13px] shrink-0" strokeWidth={2.4} />
          {QTY_TIP}
        </p>
      )}
    </section>
  );

  const linesCard = computed.length > 0 && (
    <section className="bd-card" aria-label="Items to dispatch" style={{ gap: 7 }}>
      <div className="bd-head px-0.5 pb-0.5">
        <span className="bd-title">Items</span>
        <span className="bd-pill">{items(lines.length)}</span>
      </div>
      {computed.map((l, i) => {
        const meta = [l.designName !== 'NA' ? l.designName : '', l.comment].filter(Boolean).join(' · ');
        return (
          <div key={l.key} className="bd-line" data-editing={l.key === editingKey ? '' : undefined}>
            <span className="bd-idx">{i + 1}</span>
            <div className="min-w-0 flex-[1_1_180px]">
              <div className="text-sm leading-tight font-bold">{l.itemName}</div>
              <div className="mt-px text-[11.5px]" style={muted}>
                <span className="font-mono">{l.subCategory}</span>
                {meta && (
                  <>
                    {' · '}
                    <span className="font-semibold" style={{ color: 'var(--bd-lbl)' }}>
                      {meta}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-[5px]">
              {(
                [
                  ['Box', l.box],
                  ['Pcs', l.pcs],
                  ['Kgs', l.kgs],
                ] as const
              ).map(([k, v]) => (
                <span key={k} className="bd-chip" data-zero={v ? undefined : ''}>
                  <small>{k}</small>
                  {v ? nf(v) : '—'}
                </span>
              ))}
            </div>
            <div className="flex min-w-[86px] flex-col items-end leading-tight">
              <span className="text-[14.5px] font-extrabold tabular-nums">{inr(l.amount)}</span>
              <span className="bd-tiny">@ {inr(l.rate)}</span>
            </div>
            <div className="flex gap-1">
              <span className="bd-photo" data-miss={missingPhotoKeys.has(l.key) ? '' : undefined}>
                <LinePhotoButton photos={l.photos} onChange={(photos) => setLinePhotos(l.key, photos)} status={photoStatusFor(l.key)} />
              </span>
              <button
                type="button"
                className="bd-ib"
                onClick={() => editLine(lines.find((x) => x.key === l.key)!)}
                aria-label={`Edit ${l.itemName}`}
                title="Edit this line"
              >
                <Pencil className="size-[15px]" strokeWidth={2.2} />
              </button>
              <button type="button" className="bd-ib bd-red" onClick={() => removeLine(l.key)} aria-label={`Remove ${l.itemName}`} title="Remove">
                <Trash2 className="size-[15px]" strokeWidth={2.2} />
              </button>
            </div>
          </div>
        );
      })}
      <div className="bd-totals">
        {[
          ['Box', nf(totals.box)],
          ['Pcs', nf(totals.pcs)],
          ['Kgs', nf(totals.kgs)],
          ['Amount', inr(totals.amount)],
        ].map(([k, v]) => (
          <div key={k}>
            <small>{k}</small>
            {v}
          </div>
        ))}
      </div>
    </section>
  );

  const bagsCard = booking && computed.length > 0 && (
    <section className="bd-card bd-bags" aria-label="Bags" style={{ animationDelay: '.05s' }}>
      <label className="flex flex-[0_1_210px] flex-col gap-[5px]">
        <span className="bd-kicker" style={{ color: '#6b6fd0' }}>
          {isMobile ? 'Bags' : 'Step 3'}
        </span>
        <span className="text-sm font-extrabold">Dispatch in how many bags? {req}</span>
        <input
          type="number"
          step="any"
          min={0}
          inputMode="decimal"
          value={totalBags}
          onChange={(e) => setTotalBags(e.target.value)}
          placeholder={hint ? String(hint) : '0'}
          data-set={bags > 0 ? '' : undefined}
          data-over={over ? '' : undefined}
        />
      </label>
      <div className="flex flex-[1_1_220px] flex-col gap-[7px] pb-[3px]">
        <span className="bd-bags-text">
          These bags come off {booking.code}.{hint ? ` By bag weight it is about ${nf(hint)}.` : ''}
          {over ? ` That is more than the ${nf(booking.remainingBags)} left on it.` : ''}
        </span>
        {!!hint && !totalBags && (
          <button type="button" className="bd-hint" onClick={() => setTotalBags(String(Math.max(1, Math.round(hint))))}>
            Use {Math.max(1, Math.round(hint))} bag{Math.round(hint) > 1 ? 's' : ''}
          </button>
        )}
      </div>
    </section>
  );

  return (
    <div
      ref={topRef}
      data-m={isMobile || undefined}
      className="bd-page -mx-2.5 -my-3 min-h-[calc(100%+1.5rem)] px-2.5 pt-3 sm:-m-4 sm:min-h-[calc(100%+2rem)] sm:px-4 sm:pt-4 md:-m-6 md:min-h-[calc(100%+3rem)] md:px-6 md:pt-6"
    >
      <div className="bd-wrap">
        <header className="flex items-center gap-[11px]">
          <button
            type="button"
            className="bd-back"
            onClick={onForm ? backToList : () => navigate('/bookings')}
            aria-label={onForm ? 'Back to booking list' : 'Back to bookings'}
          >
            <ArrowLeft className="size-[17px]" strokeWidth={2.4} />
          </button>
          <span className="bd-logo">
            <Truck className="size-[21px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[21px] leading-tight font-extrabold tracking-tight">{onForm ? 'New dispatch' : 'Booking Dispatch'}</h1>
            <p className="mt-0.5 text-[12.5px] leading-snug" style={{ color: 'var(--bd-sub)' }}>
              {onForm
                ? 'Add the cups, enter the bags, then dispatch.'
                : isMobile
                  ? 'Choose a bag booking to dispatch cups against.'
                  : `Send ${CATEGORY.toLowerCase()}s out against a bag booking — the order line is created for you.`}
            </p>
          </div>
        </header>

        <nav className="bd-steps" aria-label="Progress">
          <span className="bd-track" style={{ width: `${(step / 3) * 75}%` }} />
          {['Booking', 'Items', 'Bags', 'Dispatch'].map((label, i) => (
            <div key={label} className="bd-step" data-s={i < step ? 'done' : i === step ? 'cur' : undefined} aria-current={i === step ? 'step' : undefined}>
              <span>{i < step ? <Check className="size-3" strokeWidth={3.5} /> : i + 1}</span>
              {label}
            </div>
          ))}
        </nav>

        {done && (
          <section role="status" className="bd-done">
            <span className="bd-done-ic">
              <Check className="size-[18px]" strokeWidth={3} />
            </span>
            <div className="min-w-0 flex-[1_1_260px]">
              <div className="text-[15px] font-extrabold">Dispatched · order {done.orderCode ?? done.orderId}</div>
              <div className="mt-0.5 text-[12.5px] leading-snug text-white/90">
                {done.totals.box} box · {done.totals.pcs} pcs · {done.totals.kgs} kgs · {done.totals.bags} bags off the booking.
                {done.lines.some((l) => l.approvalCode)
                  ? ` Some lines need approval: ${done.lines.filter((l) => l.approvalCode).map((l) => l.approvalCode).join(', ')}.`
                  : ' Now waiting in Pending Challan.'}
              </div>
            </div>
            <div className="flex gap-[7px]">
              <button type="button" onClick={() => setDone(null)}>
                Dispatch more
              </button>
              <button type="button" onClick={() => navigate('/challans/pending')}>
                Go to Pending Challan
              </button>
            </div>
          </section>
        )}

        {isMobile ? (
          onForm && booking ? (
            <>
              <section className="bd-hero" aria-label="Selected booking">
                <div className="flex items-center gap-2.5">
                  <span className="bd-av" style={{ width: 42, height: 42, borderRadius: 13, fontSize: 14, background: avatarOf(customer).bg }}>
                    {avatarOf(customer).initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-extrabold">{customer}</div>
                    <div className="text-xs text-white/70">
                      <span className="bd-mono text-white">{booking.code}</span> · booked {formatDate(booking.bookingDate)}
                    </div>
                  </div>
                  <button type="button" className="bd-change" onClick={backToList}>
                    Change
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    ['Bags left', nf(booking.remainingBags)],
                    ['Kgs left', nf(booking.remainingKgs)],
                    ['Per bag', kgsPerBag ? `${kgsPerBag} kg` : '—'],
                  ].map(([k, v]) => (
                    <div key={k} className="bd-hero-stat">
                      {v}
                      <small>{k}</small>
                    </div>
                  ))}
                </div>
              </section>
              {partyCard}
              {entryCard}
              {linesCard}
              {bagsCard}
            </>
          ) : (
            bookingList
          )
        ) : (
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
              {bookingList}
              {partyCard}
            </div>
            <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-3">
              {booking ? (
                <>
                  {entryCard}
                  {linesCard}
                  {bagsCard}
                </>
              ) : (
                <section className="bd-empty">
                  <span className="bd-empty-ic">
                    <Coffee className="size-[26px]" strokeWidth={1.8} />
                  </span>
                  <div className="text-base font-extrabold tracking-tight">Pick a booking to start</div>
                  <div className="max-w-80 text-[13px] leading-snug" style={{ color: 'var(--bd-sub)' }}>
                    Tap a booking on the list, or choose the customer and booking. The cups you add are priced at that booking's frozen rates.
                  </div>
                </section>
              )}
            </div>
          </div>
        )}

        {(!isMobile || onForm) && (
          <div className="bd-foot">
            <div>
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="text-base font-extrabold whitespace-nowrap tabular-nums">{inr(totals.amount)}</span>
                <span className="truncate text-[11.5px] font-semibold" style={muted}>
                  {lines.length
                    ? `${items(lines.length)} · ${nf(totals.pcs)} pcs · ${nf(totals.kgs)} kgs${bags ? ` · ${nf(bags)} bags` : ''}`
                    : booking
                      ? `${booking.code} · ${customer}`
                      : 'No booking picked'}
                </span>
              </div>
              <button type="button" className="bd-btn bd-red" style={{ fontWeight: 700, paddingInline: 14 }} onClick={() => void cancelAll()}>
                Cancel
              </button>
              <button
                type="button"
                className="bd-btn bd-blue"
                onClick={() => void submit()}
                disabled={send.isPending || !booking || !lines.length}
                title="Dispatch (Ctrl+S)"
              >
                {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-[17px]" strokeWidth={2.2} />}
                {lines.length ? `Dispatch ${items(lines.length)}` : 'Dispatch'}
              </button>
            </div>
          </div>
        )}
      </div>
      {shipped !== null && <DispatchTruckAnimation code={shipped} onDone={() => setShipped(null)} />}
    </div>
  );
}

export default BookingDispatchPage;
