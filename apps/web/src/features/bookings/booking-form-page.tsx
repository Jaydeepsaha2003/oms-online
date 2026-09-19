import { useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Lock, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CreateBookingInput } from '@oms/shared';
import { BOOKING_NO_CATEGORY } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { useConfirm } from '@/components/common/confirm';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { NativeSelect } from '@/components/common/combo';
import { cn } from '@/lib/utils';
import { useOrderLookups } from '@/features/orders/use-orders';
import { useCreateBooking } from './use-bookings';

const today = () => new Date().toISOString().slice(0, 10);
const n = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
/** yyyy-mm-dd → dd-mm-yyyy, as the mockup's pill and summary read it. */
const ddmmyyyy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}-${m}-${y}` : iso;
};

/** One product-category line queued for this booking, e.g. "1 bag GLASS". */
interface BookingLine {
  key: string;
  category: string;
  bags: string;
  kgs: string;
}

/** A line's quantity as one compact phrase for the summary, e.g. "50 bags · 1200 kgs". */
const lineQtyText = (l: BookingLine): string => {
  const b = n(l.bags) ?? 0;
  const k = n(l.kgs) ?? 0;
  const parts: string[] = [];
  if (b) parts.push(`${b} ${b === 1 ? 'bag' : 'bags'}`);
  if (k) parts.push(`${k} ${k === 1 ? 'kg' : 'kgs'}`);
  return parts.join(' · ') || '—';
};

// Shared field styling — the mockup's soft off-white input on a hairline border.
const FIELD =
  'h-10 rounded-[10px] border-[0.8px] border-[var(--bb-line)] bg-[var(--bb-input-bg)] text-[13.5px] text-[var(--bb-ink)] shadow-none focus-visible:border-[var(--bb-blue)] focus-visible:ring-[3px] focus-visible:ring-[var(--bb-blue)]/15';
// Small uppercase section eyebrow, in the mockup's blue-700.
const SECTION = 'text-[11px] font-black uppercase tracking-[0.11em] text-[var(--bb-blue-dark)]';
// Field label above each control.
const FLABEL = 'text-[12px] font-bold text-[var(--bb-ink)]';
// The read-only "auto" chip used for Agent and Category.
const CHIP =
  'flex h-10 items-center rounded-[10px] bg-[var(--bb-chip-bg)] px-3 text-[13.5px] font-bold tracking-[0.02em] text-[var(--bb-blue-dark)]';
// Motion applied to interactive controls.
const EASE = '[transition-timing-function:cubic-bezier(0.22,1,0.36,1)]';

export function BookingFormPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: lookups } = useOrderLookups();
  const create = useCreateBooking();
  const [saved, setSaved] = useState(false);

  const [customer, setCustomer] = useState('');
  const [agentName, setAgentName] = useState('');
  const [category, setCategory] = useState('SALES');
  const [bookingDate, setBookingDate] = useState(today());
  const [comment, setComment] = useState('');

  // Multi-line entry: queue one product-category line at a time, à la the
  // order form's "add item" pattern — 1 bag GLASS + 1 bag CUP in one booking.
  const [lineCategory, setLineCategory] = useState('');
  const [lineBags, setLineBags] = useState('');
  const [lineKgs, setLineKgs] = useState('');
  const [lines, setLines] = useState<BookingLine[]>([]);
  const keyer = useRef(0);

  /**
   * Rates settled with the customer, keyed `CATEGORY|SUBCATEGORY`.
   *
   * Held as raw strings so a half-typed box behaves like every other input on
   * the form; blanks are dropped on submit, since an empty box means "no deal
   * on this size", not "this size is free".
   */
  const [agreed, setAgreed] = useState<Record<string, string>>({});

  const customers = useMemo(() => (lookups?.customers ?? []).map((c) => c.name), [lookups]);
  const productCategories = useMemo(() => lookups?.categories ?? [], [lookups]);

  /**
   * The size classes each product category sells in.
   *
   * The sub-category IS the size class — `4-PCS-CUP-FG` carries the size (6.5)
   * and the pcs per box (4) — so the product master already answers this and
   * no new master data is needed. Both figures are shown next to the rate box
   * so the operator can see what they are pricing.
   */
  const sizeClasses = useMemo(() => {
    const byCategory = new Map<string, { subCategory: string; size: number | null; pcs: number | null }[]>();
    for (const row of lookups?.items ?? []) {
      const cat = (row.category ?? '').trim().toUpperCase();
      const sub = (row.subCategory ?? '').trim().toUpperCase();
      if (!cat || !sub) continue;
      const list = byCategory.get(cat) ?? [];
      if (!list.some((x) => x.subCategory === sub)) list.push({ subCategory: sub, size: row.size, pcs: row.pcs });
      byCategory.set(cat, list);
    }
    for (const list of byCategory.values()) list.sort((a, b) => (a.size ?? 0) - (b.size ?? 0) || a.subCategory.localeCompare(b.subCategory));
    return byCategory;
  }, [lookups]);

  const onCustomer = (name: string) => {
    setCustomer(name);
    const c = lookups?.customers.find((x) => x.name === name);
    if (c) {
      setAgentName(c.agentName ?? '');
      if (c.category) setCategory(c.category);
    }
  };

  const addLine = () => {
    /*
     * The category is OPTIONAL.
     *
     * A party often reserves capacity before deciding what to make of it —
     * "hold me 81 bags" — and forcing a category there made the operator invent
     * one, so the booking recorded a decision nobody had taken.
     *
     * Leaving it blank is safe by the server's own rules: the per-category cap
     * is only applied to a line whose category MATCHES one actually booked, so
     * a blank line caps nothing and only the booking TOTAL binds. Rates are
     * unaffected too — they are snapshotted per customer and priced from the
     * booking date, never from the category.
     */
    const cat = lineCategory.trim().toUpperCase();
    const bagsN = n(lineBags) ?? 0;
    const kgsN = n(lineKgs) ?? 0;
    if (bagsN <= 0 && kgsN <= 0) return toast.error('Enter bags and/or kgs for this line');
    // One unspecified line only: a second one is the same "not decided yet"
    // bucket, and two of them just split a number that has no reason to be split.
    if (!cat && lines.some((l) => !l.category)) {
      return toast.error('There is already a line with no category — remove it first to change the quantity');
    }
    if (cat && lines.some((l) => l.category === cat)) return toast.error(`${cat} is already added — remove it first to change the quantity`);
    setLines((ls) => [...ls, { key: String(keyer.current++), category: cat, bags: lineBags, kgs: lineKgs }]);
    setLineCategory('');
    setLineBags('');
    setLineKgs('');
  };
  const removeLine = (key: string) => {
    const gone = lines.find((l) => l.key === key);
    setLines((ls) => ls.filter((l) => l.key !== key));
    // Rates for a category that is no longer booked would be saved against
    // nothing — and would silently reappear if the line were added back.
    if (gone?.category) {
      setAgreed((a) => Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith(`${gone.category}|`))));
    }
  };

  /** Booked categories that actually sell in size classes — the only ones a
   *  per-size rate means anything for. A blank category has none. */
  const ratedLines = useMemo(() => lines.filter((l) => l.category && (sizeClasses.get(l.category)?.length ?? 0) > 0), [lines, sizeClasses]);

  const totalBags = useMemo(() => lines.reduce((s, l) => s + (n(l.bags) ?? 0), 0), [lines]);
  const totalKgs = useMemo(() => lines.reduce((s, l) => s + (n(l.kgs) ?? 0), 0), [lines]);

  /** Only the boxes actually filled in, as the server's shape. */
  const agreedRates = useMemo(
    () =>
      Object.entries(agreed)
        .map(([key, value]) => {
          const [pCategory, subCategory] = key.split('|');
          return { pCategory, subCategory, rate: n(value) ?? 0 };
        })
        .filter((r) => r.pCategory && r.subCategory && r.rate > 0),
    [agreed],
  );

  const submitRef = useRef<() => void>(() => {});
  const submit = async () => {
    if (!customer.trim()) return toast.error('Please select a customer');
    if (!lines.length) return toast.error('Add at least one line (bags and/or kgs)');
    const ok = await confirm({
      title: 'Create this booking?',
      description:
        `${lines.length} line(s) — ${lines.map((l) => `${l.bags || 0} bag / ${l.kgs || 0} kg ${l.category || BOOKING_NO_CATEGORY}`).join(', ')} — reserved for "${customer.trim()}". Rates are frozen as of ${bookingDate}.` +
        (agreedRates.length
          ? ` ${agreedRates.length} settled rate(s): ${agreedRates.map((r) => `${r.subCategory} @ ₹${r.rate}`).join(', ')}.`
          : ''),
      confirmText: 'Create booking',
    });
    if (!ok) return;
    const input: CreateBookingInput = {
      customerName: customer.trim(),
      agentName: agentName.trim() || null,
      category: category.trim() || null,
      bookingDate,
      items: lines.map((l) => ({ pCategory: l.category, bags: n(l.bags) ?? 0, kgs: n(l.kgs) ?? 0 })),
      rates: agreedRates,
      comment: comment.trim() || null,
    };
    create.mutate(input, {
      onSuccess: () => {
        setSaved(true);
        window.setTimeout(() => navigate('/bookings'), 850);
      },
      onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
    });
  };
  submitRef.current = submit;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        submitRef.current();
      } else if (e.key === 'Escape') {
        if (!document.querySelector('[data-slot="popover-content"], [role="dialog"], [role="alertdialog"]')) navigate('/bookings');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const hasLines = lines.length > 0;

  return (
    <div className="bb-scope h-full overflow-y-auto bg-[var(--bb-bg)] text-[var(--bb-ink)]">
      {saved && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--bb-bg)]/70 backdrop-blur-sm">
          <div className="bb-pop flex flex-col items-center gap-3">
            <div className="flex size-24 items-center justify-center rounded-full bg-emerald-500 shadow-xl shadow-emerald-500/30 ring-8 ring-emerald-500/15">
              <Check className="size-12 text-white" strokeWidth={3} />
            </div>
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">Booking created</p>
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 lg:px-[60px]">
        {/* ── Header — stacks on a phone (back · title · pill each on its own
            row), collapses to one row from sm up (back · title · pill-right). */}
        <div className="bb-rise flex flex-col gap-3 sm:flex-row sm:items-center" style={{ animationDelay: '0s' }}>
          <button
            type="button"
            onClick={() => navigate('/bookings')}
            aria-label="Back"
            className={cn(
              'flex size-9 shrink-0 items-center justify-center self-start rounded-[10px] bg-[var(--bb-card)] text-[var(--bb-muted)] shadow-[0_1px_2px_rgb(16_24_40_/_0.06)]',
              'transition-[transform,color,box-shadow] duration-200 hover:-translate-x-[3px] hover:text-[var(--bb-ink)] hover:shadow-[0_4px_12px_-4px_rgb(16_24_40_/_0.18)]',
              EASE,
            )}
          >
            <ArrowLeft className="size-5" />
          </button>
          {/* The top app bar already names this screen on a phone, so the in-page
              title/subtitle only shows from sm up. */}
          <div className="hidden min-w-0 sm:block sm:flex-1">
            <h1 className="text-[22px] font-black leading-tight tracking-[-0.025em] text-[var(--bb-ink)]">New Bag Booking</h1>
            <p className="text-[12.5px] font-semibold text-[var(--bb-muted)]">
              Reserve bags &amp; kgs by product category — items are picked &amp; priced later at these booking-date rates.
            </p>
          </div>
          {/* Rates-frozen pill — a live indicator, hence the breathing dot. Its
              own line on a phone (left-aligned), top-right on wider screens. */}
          <div
            className={cn(
              'flex items-center gap-2.5 self-start rounded-[12px] bg-[var(--bb-card)] px-3 py-2 shadow-[var(--bb-shadow-pill)] sm:self-auto',
              'transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5',
              EASE,
            )}
          >
            <Lock className="size-3.5 text-[var(--bb-blue-dark)]" />
            <div className="leading-tight">
              <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[var(--bb-muted)]">Rates frozen at</div>
              <div className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--bb-blue-dark)]">
                {ddmmyyyy(bookingDate)}
                <span className="bb-breathe size-[5px] rounded-full bg-[var(--bb-blue)]" />
              </div>
            </div>
          </div>
        </div>

        {/* ── Two columns: form (left) · summary (right) ─────────────────────── */}
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_400px]">
          <div className="flex flex-col gap-5">
            {/* Booking details card */}
            <section
              className="bb-rise rounded-2xl bg-[var(--bb-card)] px-[22px] pt-5 pb-[22px] shadow-[var(--bb-shadow-card)]"
              style={{ animationDelay: '0.06s' }}
            >
              <p className={SECTION}>Booking details</p>
              <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
                <div className="col-span-2 space-y-1.5">
                  <label className={FLABEL}>
                    Customer <span className="text-rose-500">*</span>
                  </label>
                  <NativeSelect value={customer} onChange={onCustomer} options={customers} placeholder="Select customer…" className={FIELD} />
                </div>
                <div className="space-y-1.5">
                  <label className={FLABEL}>
                    Agent <span className="text-[11px] font-semibold lowercase text-[var(--bb-muted)]">auto</span>
                  </label>
                  <div className={CHIP}>{agentName || '—'}</div>
                </div>
                <div className="space-y-1.5">
                  <label className={FLABEL}>
                    Category <span className="text-[11px] font-semibold lowercase text-[var(--bb-muted)]">auto</span>
                  </label>
                  <div className={CHIP}>{category || '—'}</div>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className={FLABEL}>
                    Booking date <span className="text-rose-500">*</span>
                  </label>
                  <DatePicker value={bookingDate} onChange={(v) => setBookingDate(v || today())} className={FIELD} />
                  <p className="text-[11px] text-[var(--bb-muted)]">Converted items will be charged at this date's chart rates.</p>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className={FLABEL}>Remarks</label>
                  <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional note about this booking…" className={FIELD} />
                </div>
              </div>
            </section>

            {/* Reserved quantities card */}
            <section
              className="bb-rise rounded-2xl bg-[var(--bb-card)] px-[22px] pt-5 pb-[22px] shadow-[var(--bb-shadow-card)]"
              style={{ animationDelay: '0.14s' }}
            >
              <div className="flex items-center justify-between">
                <p className={SECTION}>Reserved quantities</p>
                <span className="text-[11px] font-semibold text-[var(--bb-muted)]">
                  {hasLines ? `${lines.length} line${lines.length > 1 ? 's' : ''}` : 'nothing added yet'}
                </span>
              </div>

              {/* Phone: Product category on its own row, then Bags · Kgs · Add
                  line together beneath it. Desktop: all four in one row. */}
              <div className="mt-4 grid grid-cols-[1fr_1fr_auto] items-end gap-3 sm:grid-cols-[1fr_110px_110px_auto]">
                <div className="col-span-3 space-y-1.5 sm:col-span-1">
                  <label className={FLABEL}>
                    Product category <span className="text-[10px] font-semibold lowercase text-[var(--bb-muted)]">optional</span>
                  </label>
                  <NativeSelect value={lineCategory} onChange={setLineCategory} options={productCategories} placeholder="Leave blank if not decided" className={FIELD} />
                </div>
                <div className="space-y-1.5">
                  <label className={FLABEL}>Bags</label>
                  <Input type="number" step="any" min={0} className={cn(FIELD, 'text-right tabular-nums')} value={lineBags} onChange={(e) => setLineBags(e.target.value)} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <label className={FLABEL}>Kgs</label>
                  <Input type="number" step="any" min={0} className={cn(FIELD, 'text-right tabular-nums')} value={lineKgs} onChange={(e) => setLineKgs(e.target.value)} placeholder="0" />
                </div>
                <button
                  type="button"
                  onClick={addLine}
                  className={cn(
                    'flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--bb-blue)] px-4 text-[13px] font-extrabold text-white shadow-[var(--bb-shadow-btn)]',
                    'transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-[var(--bb-blue-dark)] active:translate-y-0 active:scale-[0.98]',
                    EASE,
                  )}
                >
                  <Plus className="size-4" /> Add line
                </button>
              </div>

              {hasLines ? (
                <div className="mt-4 overflow-hidden rounded-xl border-[0.8px] border-[var(--bb-line)]">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="bg-[var(--bb-input-bg)] text-[10.5px] font-black uppercase tracking-[0.08em] text-[var(--bb-muted)]">
                        <th className="px-3.5 py-2.5 text-left">Category</th>
                        <th className="px-3.5 py-2.5 text-right">Bags</th>
                        <th className="px-3.5 py-2.5 text-right">Kgs</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.key} className="bb-rowin border-t-[0.8px] border-[var(--bb-line)]">
                          <td className="px-3.5 py-2.5 font-bold text-[var(--bb-ink)]">
                            {l.category || <span className="italic font-semibold text-[var(--bb-muted)]">{BOOKING_NO_CATEGORY}</span>}
                          </td>
                          <td className="px-3.5 py-2.5 text-right tabular-nums">{l.bags || '—'}</td>
                          <td className="px-3.5 py-2.5 text-right tabular-nums">{l.kgs || '—'}</td>
                          <td className="px-2 py-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => removeLine(l.key)}
                              aria-label="Remove line"
                              className={cn(
                                'flex size-7 items-center justify-center rounded-lg text-[var(--bb-muted)]',
                                'transition-[transform,background-color,color] duration-150 hover:scale-110 hover:bg-[var(--bb-danger-bg)] hover:text-[var(--bb-danger)]',
                              )}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-[0.8px] border-[var(--bb-line)] bg-[var(--bb-input-bg)] font-black text-[var(--bb-ink)]">
                        <td className="px-3.5 py-2.5 text-right">Total</td>
                        <td className="px-3.5 py-2.5 text-right tabular-nums">{totalBags}</td>
                        <td className="px-3.5 py-2.5 text-right tabular-nums">{totalKgs}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border-[0.8px] border-dashed border-[var(--bb-line)] bg-[var(--bb-input-bg)]/60 px-4 py-6 text-center text-[12.5px] font-medium text-[var(--bb-muted)]">
                  No lines yet. A line without a category reserves capacity that gets decided later.
                </div>
              )}
            </section>

            {/*
              Agreed rates — only for the categories actually booked, and only those
              that sell in size classes. Optional throughout: leave every box empty
              and the booking prices off the chart exactly as it always has.
            */}
            {ratedLines.length > 0 && (
              <section className="bb-rise rounded-2xl bg-[var(--bb-card)] px-[22px] pt-5 pb-[22px] shadow-[var(--bb-shadow-card)]" style={{ animationDelay: '0.2s' }}>
                <p className={cn(SECTION, 'text-amber-600')}>Agreed rates</p>
                <p className="mt-1 text-[11px] text-[var(--bb-muted)]">
                  A rate settled with this party for a size. It replaces the chart rate <em>and</em> this party's own discount
                  for that size — a negotiated price is the whole price, not a base to discount again. Leave a box empty to
                  price it off the chart.
                </p>
                <div className="mt-3 space-y-3">
                  {ratedLines.map((l) => (
                    <div key={l.key} className="space-y-1.5">
                      <p className="text-[11px] font-black uppercase tracking-wide text-[var(--bb-muted)]">{l.category}</p>
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        {(sizeClasses.get(l.category) ?? []).map((sc) => {
                          const key = `${l.category}|${sc.subCategory}`;
                          return (
                            <div key={key} className="space-y-1 rounded-xl border-[0.8px] border-[var(--bb-line)] bg-[var(--bb-input-bg)] px-2.5 py-2">
                              <p className="truncate text-[12px] font-bold text-[var(--bb-ink)]" title={sc.subCategory}>
                                {sc.subCategory}
                              </p>
                              <p className="text-[10.5px] font-medium text-[var(--bb-muted)]">
                                {sc.size ? `Size ${sc.size}` : 'No size'}
                                {sc.pcs ? ` · ${sc.pcs} pcs/box` : ''}
                              </p>
                              <Input
                                type="number"
                                step="any"
                                min={0}
                                inputMode="decimal"
                                className={cn(FIELD, 'h-8 text-right tabular-nums')}
                                placeholder="Chart rate"
                                value={agreed[key] ?? ''}
                                onChange={(e) => setAgreed((a) => ({ ...a, [key]: e.target.value }))}
                                aria-label={`Agreed rate for ${sc.subCategory}`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* ── Summary panel ───────────────────────────────────────────────── */}
          <aside className="bb-rise lg:sticky lg:top-5 lg:self-start" style={{ animationDelay: '0.1s' }}>
            <div className="overflow-hidden rounded-2xl bg-[var(--bb-card)] shadow-[var(--bb-shadow-panel)]">
              <div className="bg-[var(--bb-blue-dark)] px-5 py-4">
                <p className="text-[11px] font-black uppercase tracking-[0.11em] text-[var(--bb-blue-100)]">Summary</p>
                <p className="mt-0.5 truncate text-[16px] font-black text-white">{customer.trim() || 'No customer selected'}</p>
              </div>
              <div className="px-5 py-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-[var(--bb-input-bg)] px-3 py-2.5">
                    <p className="text-[10.5px] font-black uppercase tracking-[0.1em] text-[var(--bb-muted)]">Bags</p>
                    <p key={`b-${totalBags}`} className={cn('bb-pop text-[28px] font-black leading-none', totalBags > 0 ? 'text-[var(--bb-ink)]' : 'text-[#98a2b3]')}>
                      {totalBags}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[var(--bb-input-bg)] px-3 py-2.5">
                    <p className="text-[10.5px] font-black uppercase tracking-[0.1em] text-[var(--bb-muted)]">Kgs</p>
                    <p key={`k-${totalKgs}`} className={cn('bb-pop text-[28px] font-black leading-none', totalKgs > 0 ? 'text-[var(--bb-ink)]' : 'text-[#98a2b3]')}>
                      {totalKgs}
                    </p>
                  </div>
                </div>

                <dl className="mt-4 space-y-2 text-[13px]">
                  <SummaryRow label="Agent" value={agentName || '—'} />
                  <SummaryRow label="Category" value={category || '—'} />
                  <SummaryRow label="Booking date" value={ddmmyyyy(bookingDate)} />
                  <SummaryRow label="Lines" value={<span key={lines.length} className="bb-pop inline-block">{lines.length}</span>} />
                </dl>

                {/* Per-category breakdown — so a booking that reserves several
                    product categories shows each one and its share, not just the
                    grand totals above. */}
                {hasLines && (
                  <div className="mt-4 border-t border-[var(--bb-line)] pt-3">
                    <p className="text-[10.5px] font-black uppercase tracking-[0.1em] text-[var(--bb-muted)]">Reserved by category</p>
                    <ul className="mt-2 space-y-1.5">
                      {lines.map((l) => (
                        <li key={l.key} className="bb-rowin flex items-center justify-between gap-3 text-[12.5px]">
                          <span className="min-w-0 truncate font-bold text-emerald-600 dark:text-emerald-400">
                            {l.category || <span className="font-semibold italic text-[var(--bb-muted)]">No category</span>}
                          </span>
                          <span className="shrink-0 font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{lineQtyText(l)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  type="button"
                  onClick={submit}
                  disabled={create.isPending}
                  title="Create booking (Ctrl+S)"
                  className={cn(
                    'mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-[var(--bb-blue)] text-[14px] font-black tracking-[0.01em] text-white shadow-[var(--bb-shadow-btn)]',
                    'transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-[var(--bb-blue-dark)] hover:shadow-[0_12px_22px_-10px_rgb(37_99_235_/_0.8)] active:translate-y-0 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-70',
                    EASE,
                  )}
                >
                  {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Create booking
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/bookings')}
                  title="Cancel (Esc)"
                  className="mt-2 h-9 w-full rounded-[10px] text-[13px] font-bold text-[var(--bb-muted)] transition-colors duration-200 hover:text-[var(--bb-danger)]"
                >
                  Cancel
                </button>
                <p className="mt-1 text-center text-[11px] text-[var(--bb-muted)]">Ctrl+S to save · Esc to cancel</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** A label/value line in the summary panel. */
function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[var(--bb-muted)]">{label}</dt>
      <dd className="font-bold text-[var(--bb-ink)]">{value}</dd>
    </div>
  );
}

export default BookingFormPage;
