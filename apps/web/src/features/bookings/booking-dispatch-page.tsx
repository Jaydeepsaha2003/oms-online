import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Info, Loader2, Plus, Send, Trash2, TriangleAlert, Truck } from 'lucide-react';
import { toast } from 'sonner';
import type { BookingDispatchLineInput, BookingDispatchResult } from '@oms/shared';
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
import { useBookingDispatchOptions, useDispatchFromBooking } from './use-bookings';

const today = () => new Date().toISOString().slice(0, 10);
const n = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** The category this screen works in. Cups are what moves this way. */
const CATEGORY = 'CUP';

interface DraftLine {
  key: string;
  subCategory: string;
  product: string;
  box: string;
}

/**
 * Products → Booking Dispatch
 * ---------------------------
 * Send cups out against a bag booking without anyone raising an order first.
 *
 * The order still exists behind this screen — it has to, because every dispatch
 * hangs off an order line and so does the challan, the ledger and the reports.
 * What this removes is the paperwork: pick the party, pick the booking, say how
 * many BOXES of what, and the server makes the line and the dispatch together.
 *
 * Boxes are the only quantity typed. Pcs, kgs and bags are shown here as a
 * preview and computed again on the server, which is the figure that counts —
 * bags are what the booking is reserved in, so the client must not get to
 * decide them.
 */
export function BookingDispatchPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: lookups } = useOrderLookups();
  const send = useDispatchFromBooking();
  const [done, setDone] = useState<BookingDispatchResult | null>(null);

  const [customer, setCustomer] = useState('');
  const [bookingId, setBookingId] = useState<number | null>(null);
  const [dispatchDate, setDispatchDate] = useState(today());
  const [lines, setLines] = useState<DraftLine[]>([]);
  const keyer = useRef(0);

  const [lineSub, setLineSub] = useState('');
  const [lineProduct, setLineProduct] = useState('');
  const [lineBox, setLineBox] = useState('');

  const customers = useMemo(() => (lookups?.customers ?? []).map((c) => c.name), [lookups]);
  const { data: options, isFetching } = useBookingDispatchOptions(customer || undefined, CATEGORY);

  const bookings = options?.bookings ?? [];
  const booking = bookings.find((b) => b.id === bookingId) ?? null;
  const kgsPerBag = options?.kgsPerBag ?? null;

  // Changing party invalidates the booking — its rates and remaining belong to
  // the old one, and silently keeping it would price against the wrong deal.
  useEffect(() => {
    setBookingId(null);
    setLines([]);
  }, [customer]);

  // One booking is the common case; pre-select it so there is nothing to click.
  useEffect(() => {
    if (bookingId == null && bookings.length === 1) setBookingId(bookings[0].id);
  }, [bookings, bookingId]);

  /** Size classes that actually have items, newest-size first like the master. */
  const sizeClasses = useMemo(() => {
    const seen = new Map<string, { subCategory: string; size: number | null; pcs: number | null }>();
    for (const it of options?.items ?? []) {
      if (!seen.has(it.subCategory)) seen.set(it.subCategory, { subCategory: it.subCategory, size: it.size, pcs: it.pcs });
    }
    return [...seen.values()];
  }, [options]);

  const productsFor = (subCategory: string) =>
    (options?.items ?? []).filter((i) => i.subCategory === subCategory).map((i) => i.product);

  const itemFor = (subCategory: string, product: string) =>
    (options?.items ?? []).find((i) => i.subCategory === subCategory && i.product === product) ?? null;

  /** The rate this line will actually go out at — settled first, chart second. */
  const rateFor = (subCategory: string, product: string) => {
    const settled = (options?.rates ?? []).find(
      (r) => r.bookingId === bookingId && r.pCategory === CATEGORY && r.subCategory === subCategory,
    );
    if (settled) return { rate: settled.rate, agreed: true };
    return { rate: itemFor(subCategory, product)?.rate ?? 0, agreed: false };
  };

  /**
   * The same arithmetic the server does, shown before saving.
   *
   * Deliberately a preview and nothing more: the server recomputes every figure
   * from the product master and the party's bag weight, so a stale price list
   * in this tab can mislead the eye but never the booking.
   */
  const computed = useMemo(
    () =>
      lines.map((l) => {
        const item = itemFor(l.subCategory, l.product);
        const box = n(l.box) ?? 0;
        const pcs = item?.pcs ? r2(box * item.pcs) : 0;
        const kgs = item?.weight ? r2(pcs * item.weight) : 0;
        const bags = kgsPerBag ? r3(kgs / kgsPerBag) : 0;
        const { rate, agreed } = rateFor(l.subCategory, l.product);
        return { ...l, box, pcs, kgs, bags, rate, agreed, amount: r2(pcs * rate) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, options, kgsPerBag, bookingId],
  );

  const totals = useMemo(
    () => ({
      box: r2(computed.reduce((s, l) => s + l.box, 0)),
      pcs: r2(computed.reduce((s, l) => s + l.pcs, 0)),
      kgs: r2(computed.reduce((s, l) => s + l.kgs, 0)),
      bags: r2(computed.reduce((s, l) => s + l.bags, 0)),
      amount: r2(computed.reduce((s, l) => s + l.amount, 0)),
    }),
    [computed],
  );

  const overBags = booking ? totals.bags > booking.remainingBags + 0.001 : false;
  const overKgs = booking ? totals.kgs > booking.remainingKgs + 0.001 : false;

  const addLine = () => {
    if (!lineSub) return toast.error('Pick a size first');
    if (!lineProduct) return toast.error('Pick an item');
    const box = n(lineBox) ?? 0;
    if (box <= 0) return toast.error('Enter how many boxes');
    if (lines.some((l) => l.subCategory === lineSub && l.product === lineProduct)) {
      return toast.error(`${lineProduct} is already on the list — remove it to change the boxes`);
    }
    setLines((ls) => [...ls, { key: String(keyer.current++), subCategory: lineSub, product: lineProduct, box: lineBox }]);
    setLineProduct('');
    setLineBox('');
  };
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const submitRef = useRef<() => void>(() => {});
  const submit = async () => {
    if (!customer) return toast.error('Select a customer');
    if (!booking) return toast.error('Select a booking');
    if (!lines.length) return toast.error('Add at least one item');
    if (kgsPerBag == null) {
      return toast.error(`No bag weight is set for ${customer} in ${CATEGORY} — set it under Special Rates first`);
    }
    if (overBags || overKgs) return toast.error('That is more than this booking has left');

    const ok = await confirm({
      title: 'Dispatch these against the booking?',
      description:
        `${lines.length} item(s) · ${totals.box} box · ${totals.pcs} pcs · ${totals.kgs} kgs · ~${totals.bags} bags ` +
        `off ${booking.code} for "${customer}". An order line is created for each and dispatched in full, ` +
        `then they go to Pending Challan like any other dispatch.`,
      confirmText: 'Dispatch',
    });
    if (!ok) return;

    const payload: BookingDispatchLineInput[] = lines.map((l) => ({
      subCategory: l.subCategory,
      product: l.product,
      box: n(l.box) ?? 0,
    }));
    send.mutate(
      { bookingId: booking.id, dispatchDate, lines: payload },
      {
        onSuccess: (res) => {
          setDone(res);
          setLines([]);
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

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 font-sans">
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
              value={kgsPerBag ? `1 bag = ${kgsPerBag} kgs` : customer ? 'Not set for this party' : '—'}
              className={
                customer && kgsPerBag == null
                  ? 'border-rose-300 bg-rose-50 font-semibold text-rose-700'
                  : 'border-indigo-200/70 bg-indigo-50/60 font-medium text-indigo-700'
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Without a bag weight nothing can be worked out, so say so once, loudly,
          instead of letting every line quietly compute zero bags. */}
      {customer && kgsPerBag == null && !isFetching && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            <b>{customer}</b> has no {CATEGORY} bag weight on file. Bags are what the booking is reserved in, so nothing
            can be dispatched against it until one is set — add it under <b>Special Rates → Bag Weight</b>.
          </p>
        </div>
      )}

      {booking && (
        <Card className="border-border border-l-4 border-l-slate-400 bg-slate-50/70 py-0">
          <CardContent className="space-y-2.5 px-4 py-3">
            <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-base">Size</Label>
                <NativeSelect
                  value={lineSub}
                  onChange={(v) => {
                    setLineSub(v);
                    setLineProduct('');
                  }}
                  options={sizeClasses.map((s) => s.subCategory)}
                  renderOption={(v) => {
                    const sc = sizeClasses.find((s) => s.subCategory === v);
                    return sc ? `${sc.subCategory}${sc.pcs ? ` · ${sc.pcs}/box` : ''}` : v;
                  }}
                  placeholder="Pick a size…"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-base">Item</Label>
                <NativeSelect
                  value={lineProduct}
                  onChange={setLineProduct}
                  options={lineSub ? productsFor(lineSub) : []}
                  placeholder={lineSub ? 'Pick an item…' : 'Pick a size first'}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-base">Boxes</Label>
                <Input
                  type="number"
                  step="any"
                  min={0}
                  className="text-right tabular-nums"
                  value={lineBox}
                  onChange={(e) => setLineBox(e.target.value)}
                  placeholder="0"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addLine();
                    }
                  }}
                />
              </div>
              <Button type="button" variant="outline" onClick={addLine}>
                <Plus /> Add
              </Button>
            </div>
            <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
              <Info className="size-3.5 shrink-0" />
              Boxes are the only figure you type — pcs, kgs and bags follow from the item and the party's bag weight.
            </p>

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
                      <th className="px-3 py-2 text-right">Bags</th>
                      <th className="px-3 py-2 text-right">Rate</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="[&_td]:border-t [&_td]:px-3 [&_td]:py-1.5">
                    {computed.map((l) => (
                      <tr key={l.key}>
                        <td className="font-semibold">{l.product}</td>
                        <td className="text-muted-foreground font-mono text-[11.5px]">{l.subCategory}</td>
                        <td className="text-right tabular-nums">{l.box}</td>
                        <td className="text-right tabular-nums">{l.pcs}</td>
                        <td className="text-right tabular-nums">{l.kgs}</td>
                        <td className="text-right tabular-nums">{l.bags}</td>
                        <td className="text-right tabular-nums">
                          {l.rate}
                          {l.agreed && (
                            <span className="ml-1 rounded-[3px] bg-amber-100 px-1 text-[9.5px] font-bold text-amber-800" title="Rate settled on this booking">
                              DEAL
                            </span>
                          )}
                        </td>
                        <td className="text-right font-semibold tabular-nums">{l.amount.toLocaleString('en-IN')}</td>
                        <td className="text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive size-7"
                            onClick={() => removeLine(l.key)}
                            aria-label={`Remove ${l.product}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
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
                      <td className={`px-3 py-2 text-right tabular-nums ${overKgs ? 'text-rose-600' : ''}`}>{totals.kgs}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${overBags ? 'text-rose-600' : ''}`}>{totals.bags}</td>
                      <td />
                      <td className="px-3 py-2 text-right tabular-nums">{totals.amount.toLocaleString('en-IN')}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <p className="text-muted-foreground text-[11.5px] font-medium">
              {booking.code} has <b className="text-foreground tabular-nums">{booking.remainingBags}</b> bags /{' '}
              <b className="text-foreground tabular-nums">{booking.remainingKgs}</b> kgs left.
              {(overBags || overKgs) && <span className="font-bold text-rose-600"> That is more than remains.</span>}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end gap-2 border-t px-1 py-3">
        <Button type="button" variant="destructive" onClick={() => navigate('/bookings')}>
          Cancel
        </Button>
        <Button
          onClick={submit}
          disabled={send.isPending || !booking || !lines.length || overBags || overKgs || kgsPerBag == null}
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
