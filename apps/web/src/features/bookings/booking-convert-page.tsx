import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BadgePercent, Check, Loader2, Plus, Split, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BookingQuoteLine, ConvertBookingLineInput } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { shortOrderCode } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { NativeSelect } from '@/components/common/combo';
import { useOrderLookups } from '@/features/orders/use-orders';
import { useBooking, useBookingQuote, useConvertBooking } from './use-bookings';

const fmtNum = (v: number | null) => (v == null ? '' : String(v));
const n = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
const money = (v: number) => v.toLocaleString('en-IN');
const scopeWord = (s: string | null) =>
  s === 'ITEM' ? 'item' : s === 'SUBCATEGORY' ? 'sub-category' : s === 'CATEGORY' ? 'category' : '';

/** A line queued for conversion (mirrors the order form's line identity). */
interface Line {
  key: string;
  itemName: string;
  product: string;
  category: string;
  subCategory: string;
  designType: string;
  psize: string;
  bags: string;
  pcs: string;
  gram: string;
  box: string;
  calField: string;
  comment: string;
}

const blank = (): Omit<Line, 'key'> => ({
  itemName: '', product: '', category: '', subCategory: '', designType: '',
  psize: '', bags: '', pcs: '', gram: '', box: '', calField: 'KGS', comment: '',
});

export function BookingConvertPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { data: booking, isLoading } = useBooking(id);
  const { data: lookups } = useOrderLookups();
  const quote = useBookingQuote();
  const convert = useConvertBooking();
  const keyer = useRef(0);
  const [saved, setSaved] = useState(false);

  const [entry, setEntry] = useState(blank());
  const [lines, setLines] = useState<Line[]>([]);
  const [quoted, setQuoted] = useState<BookingQuoteLine[]>([]);

  // Composite item-name dropdown (same shape as the order form): "{size} {product} {designType}".
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

  const onItemPick = (label: string) => {
    const it = itemOptions.map.get(label);
    if (!it) {
      setEntry((e) => ({ ...e, itemName: label, product: label }));
      return;
    }
    setEntry((e) => ({
      ...e,
      itemName: label,
      product: it.product,
      category: it.category,
      subCategory: it.subCategory,
      designType: it.designType ?? '',
      psize: it.size != null ? String(it.size) : '',
    }));
  };

  const addLine = () => {
    if (!entry.product.trim() && !entry.designType.trim()) return toast.error('Pick an item to add');
    const calField = categoryFieldMap.get(entry.category.trim().toUpperCase()) ?? 'KGS';
    setLines((ls) => [...ls, { ...entry, key: `l${keyer.current++}`, calField }]);
    setEntry(blank());
  };
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  // Map a UI line → the API convertible-line shape.
  const toInput = (l: Line): ConvertBookingLineInput => ({
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

  // Re-price whenever the lines change — always at the booking-date rates.
  useEffect(() => {
    if (!lines.length) {
      setQuoted([]);
      return;
    }
    const t = window.setTimeout(() => {
      quote.mutate(
        { id, lines: lines.map(toInput) },
        { onSuccess: (res) => setQuoted(res.lines), onError: () => setQuoted([]) },
      );
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, id]);

  const lineQty = (l: Line) => (l.calField === 'PCS' ? n(l.pcs) ?? 0 : n(l.gram) ?? 0);
  const lineAmount = (l: Line, i: number) => (quoted[i]?.rate ?? 0) * lineQty(l);

  const totals = useMemo(() => {
    return lines.reduce(
      (a, l, i) => ({
        bags: a.bags + (n(l.bags) ?? 0),
        kgs: a.kgs + (n(l.gram) ?? 0),
        amount: a.amount + lineAmount(l, i),
      }),
      { bags: 0, kgs: 0, amount: 0 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, quoted]);

  const remainingBags = booking?.remainingBags ?? 0;
  const remainingKgs = booking?.remainingKgs ?? 0;
  const overBags = totals.bags - remainingBags > 0.001;
  const overKgs = totals.kgs - remainingKgs > 0.001;

  const submit = async () => {
    if (!lines.length) return toast.error('Add at least one item to convert');
    if (overBags) return toast.error(`Bags (${money(totals.bags)}) exceed the ${money(remainingBags)} remaining`);
    if (overKgs) return toast.error(`Kgs (${money(totals.kgs)}) exceed the ${money(remainingKgs)} remaining`);
    const ok = await confirm({
      title: 'Convert these items?',
      description: `${lines.length} line(s) · ₹${money(Math.round(totals.amount))} will be added to ${booking?.orderCode ? `order ${shortOrderCode(booking.orderCode)}` : 'a new order'} at the frozen booking-date rates.`,
      confirmText: 'Convert',
    });
    if (!ok) return;
    convert.mutate(
      { id, lines: lines.map(toInput) },
      {
        onSuccess: () => {
          setSaved(true);
          window.setTimeout(() => navigate('/bookings'), 850);
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Convert failed')),
      },
    );
  };

  if (isLoading || !booking) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {saved && (
        <div className="bg-background/70 fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm">
          <div className="animate-in fade-in zoom-in-50 flex flex-col items-center gap-3 duration-300">
            <div className="flex size-24 items-center justify-center rounded-full bg-emerald-500 shadow-xl shadow-emerald-500/30 ring-8 ring-emerald-500/15">
              <Check className="size-12 text-white" strokeWidth={3} />
            </div>
            <p className="text-sm font-semibold text-emerald-700">Converted</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/bookings')} aria-label="Back">
          <ArrowLeft />
        </Button>
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <Split className="size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight">Convert booking {booking.code}</h2>
          <p className="text-muted-foreground truncate text-xs">
            {booking.customerName} · booked {formatDate(booking.bookingDate)} · rates frozen at that date
          </p>
        </div>
      </div>

      {/* Remaining summary */}
      <Card className="border-l-4 border-l-sky-400 py-0">
        <CardContent className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
          <Stat label="Remaining bags" value={money(remainingBags)} over={overBags} />
          <Stat label="Remaining kgs" value={money(remainingKgs)} over={overKgs} />
          <Stat label="This conversion — bags" value={money(totals.bags)} over={overBags} />
          <Stat label="This conversion — kgs" value={money(totals.kgs)} over={overKgs} />
        </CardContent>
      </Card>

      {/* Item entry */}
      <Card className="border-border border-l-4 border-l-slate-400 bg-slate-50/70 py-0">
        <CardContent className="space-y-2 px-4 py-3">
          <div className="grid grid-cols-2 items-end gap-2 lg:grid-cols-12">
            <div className="col-span-2 space-y-1 lg:col-span-5">
              <Label className="text-base">Item name</Label>
              <NativeSelect
                value={entry.itemName}
                onChange={onItemPick}
                options={itemOptions.labels}
                placeholder="Pick an item…"
                className="text-left"
                onInvalidEntry={() => toast.error('Please select a correct item')}
              />
            </div>
            <div className="space-y-1 lg:col-span-1">
              <Label className="text-base">Bags</Label>
              <Input type="number" step="any" value={entry.bags} onChange={(e) => setEntry((s) => ({ ...s, bags: e.target.value }))} />
            </div>
            <div className="space-y-1 lg:col-span-1">
              <Label className="text-base">Pcs</Label>
              <Input type="number" step="any" value={entry.pcs} onChange={(e) => setEntry((s) => ({ ...s, pcs: e.target.value }))} />
            </div>
            <div className="space-y-1 lg:col-span-1">
              <Label className="text-base">Kgs</Label>
              <Input type="number" step="any" value={entry.gram} onChange={(e) => setEntry((s) => ({ ...s, gram: e.target.value }))} />
            </div>
            <div className="space-y-1 lg:col-span-1">
              <Label className="text-base">Box</Label>
              <Input type="number" step="any" value={entry.box} onChange={(e) => setEntry((s) => ({ ...s, box: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1 lg:col-span-2">
              <Label className="text-base">Remarks</Label>
              <Input value={entry.comment} onChange={(e) => setEntry((s) => ({ ...s, comment: e.target.value }))} placeholder="Item remark…" />
            </div>
            <div className="col-span-2 lg:col-span-1">
              <Button onClick={addLine} className="w-full" aria-label="Add line">
                <Plus /> Add
              </Button>
            </div>
          </div>

          {/* Queued lines with live frozen-rate quote */}
          <div className="max-h-[40vh] overflow-auto rounded-lg border">
            <table className="w-full text-sm [&_td]:border-r [&_td]:border-border/60 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-border/40 [&_th:last-child]:border-r-0">
              <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:bg-gradient-to-b [&_th]:from-sky-50 [&_th]:to-indigo-100 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-slate-900">
                <tr>
                  <th className="w-10 text-center">Sr</th>
                  <th>Item name</th>
                  <th className="text-right">Bags</th>
                  <th className="text-right">Pcs</th>
                  <th className="text-right">Kgs</th>
                  <th className="text-right">Box</th>
                  <th className="text-right">Frozen rate ₹</th>
                  <th className="text-right">Amount ₹</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="[&_td]:border-t [&_td]:px-3 [&_td]:py-2">
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-muted-foreground h-14 text-center">
                      No items yet — pick an item above and click “Add”.
                    </td>
                  </tr>
                ) : (
                  lines.map((l, idx) => {
                    const q = quoted[idx];
                    const special = q && (q.productDelta !== 0 || q.designDelta !== 0);
                    return (
                      <tr key={l.key} className="hover:bg-muted/40">
                        <td className="text-muted-foreground text-center tabular-nums">{idx + 1}</td>
                        <td className="font-medium">
                          {l.itemName || l.product || '—'}
                          {special && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700" title={`Special rate: product ${q!.productDelta} (${scopeWord(q!.productFrom)}), design ${q!.designDelta} (${scopeWord(q!.designFrom)})`}>
                              <BadgePercent className="size-3" /> special
                            </span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">{l.bags || '—'}</td>
                        <td className="text-right tabular-nums">{l.pcs || '—'}</td>
                        <td className="text-right tabular-nums">{l.gram || '—'}</td>
                        <td className="text-right tabular-nums">{l.box || '—'}</td>
                        <td className="text-right tabular-nums">
                          {quote.isPending && !q ? <Loader2 className="ml-auto size-3.5 animate-spin" /> : q ? money(q.rate) : '—'}
                        </td>
                        <td className="text-right font-semibold tabular-nums text-emerald-700">{q ? money(Math.round(lineAmount(l, idx))) : '—'}</td>
                        <td>
                          <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => removeLine(l.key)} aria-label="Remove">
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {lines.length > 0 && (
                <tfoot className="[&_td]:sticky [&_td]:bottom-0 [&_td]:border-t-2 [&_td]:bg-slate-100 [&_td]:px-3 [&_td]:py-2 [&_td]:font-semibold">
                  <tr>
                    <td colSpan={2} className="text-right">Total</td>
                    <td className="text-right tabular-nums">{money(totals.bags)}</td>
                    <td />
                    <td className="text-right tabular-nums">{money(totals.kgs)}</td>
                    <td colSpan={2} />
                    <td className="text-right tabular-nums text-emerald-700">{money(Math.round(totals.amount))}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Existing conversions on this booking */}
      {booking.conversions.length > 0 && (
        <Card className="py-0">
          <CardContent className="px-4 py-3">
            <p className="mb-2 text-sm font-semibold text-slate-700">Already converted ({booking.conversions.length})</p>
            <div className="max-h-40 overflow-auto rounded-lg border">
              <table className="w-full text-sm [&_td]:border-r [&_td]:border-border/60 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-border/40 [&_th:last-child]:border-r-0">
                <thead className="[&_th]:bg-muted [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold">
                  <tr>
                    <th>Item</th>
                    <th className="text-right">Bags</th>
                    <th className="text-right">Kgs</th>
                    <th className="text-right">Rate ₹</th>
                    <th className="text-right">Amount ₹</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody className="[&_td]:border-t [&_td]:px-3 [&_td]:py-1.5">
                  {booking.conversions.map((c) => (
                    <tr key={c.id}>
                      <td>{c.productName || '—'}</td>
                      <td className="text-right tabular-nums">{c.bags ?? '—'}</td>
                      <td className="text-right tabular-nums">{c.kgs ?? '—'}</td>
                      <td className="text-right tabular-nums">{c.frozenRate != null ? money(c.frozenRate) : '—'}</td>
                      <td className="text-right tabular-nums text-emerald-700">{c.amount != null ? money(Math.round(c.amount)) : '—'}</td>
                      <td className="text-muted-foreground whitespace-nowrap text-xs">{formatDate(c.convertedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-1 py-3">
        <p className="text-sm">
          {lines.length} line(s) · <span className="font-bold tabular-nums text-emerald-600">₹{money(Math.round(totals.amount))}</span>
          {(overBags || overKgs) && <span className="ml-2 font-semibold text-rose-600">exceeds remaining</span>}
        </p>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="destructive" onClick={() => navigate('/bookings')}>Cancel</Button>
          <Button onClick={submit} disabled={convert.isPending || overBags || overKgs || lines.length === 0}>
            {convert.isPending ? <Loader2 className="animate-spin" /> : <Split />}
            Convert to items
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, over }: { label: string; value: string; over?: boolean }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${over ? 'text-rose-600' : 'text-slate-800'}`}>{value}</p>
    </div>
  );
}

export default BookingConvertPage;
