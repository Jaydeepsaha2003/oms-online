import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Building2, ChevronRight, Layers, Scale, TrendingUp, Truck } from 'lucide-react';
import type { ChallanQuery, TradingNoteRow } from '@oms/shared';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { NativeSelect } from '@/components/common/combo';
import { InfoTip } from '@/components/common/info-tip';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChallanAnalytics } from './use-challans';
import { PRESETS, presetRange } from './date-presets';

const money = (v: number | null | undefined) => `₹ ${(v ?? 0).toLocaleString('en-IN')}`;
/** Compact Indian money for headline cards (₹1.69Cr / ₹4.2L / ₹9,120). */
function moneyShort(v: number | null | undefined): string {
  const n = v ?? 0;
  const a = Math.abs(n);
  if (a >= 1e7) return `₹ ${(n / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `₹ ${(n / 1e5).toFixed(2)}L`;
  return `₹ ${n.toLocaleString('en-IN')}`;
}
const count = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN');

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Filters currently applied to the list — the modal starts from these. */
  base: { search?: string; dateFrom?: string; dateTo?: string; status?: string };
}

/**
 * One figure in the header strip.
 *
 * Replaces a shadowed card per KPI. Twelve of those, each with its own border,
 * padding and drop shadow, spent more of the dialog on decoration than on
 * numbers — and on a phone they stacked two-up into a wall of boxes. This is the
 * ERP treatment instead: a hairline grid, the figure loud, the label a whisper,
 * and the exact rupee value on hover for the shortened ones.
 */
function Fig({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className="bg-card px-2.5 py-1.5" title={hint}>
      <p className="text-muted-foreground text-[9.5px] font-bold tracking-[0.1em] uppercase">{label}</p>
      <p
        className={cn(
          'text-[15px] leading-tight font-bold tabular-nums',
          tone === 'good' && 'text-emerald-700 dark:text-emerald-400',
          tone === 'warn' && 'text-amber-700 dark:text-amber-400',
          tone === 'bad' && 'text-rose-600 dark:text-rose-400',
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** A plain figures table in the Tally idiom: hairline grid, right-aligned
 *  numbers, one bold total row. Used for the per-category charge breakdown. */
function TallyTable({
  title,
  icon: Icon,
  head,
  rows,
  foot,
}: {
  title: string;
  icon: typeof Layers;
  head: string[];
  rows: (string | number)[][];
  foot?: (string | number)[];
}) {
  return (
    <div>
      <SectionTitle icon={Icon}>{title}</SectionTitle>
      <div className="overflow-x-auto rounded-[4px] border">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-muted/60 text-muted-foreground text-[10px] font-bold tracking-wide uppercase">
              {head.map((h, i) => (
                <th key={h} className={cn('px-2.5 py-1.5', i === 0 ? 'text-left' : 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={String(r[0]) + ri} className="border-t even:bg-slate-50/70 dark:even:bg-white/[0.03]">
                {r.map((c, i) => (
                  <td
                    key={i}
                    className={cn(
                      'px-2.5 py-1',
                      i === 0 ? 'font-semibold text-slate-800 dark:text-slate-200' : 'text-right tabular-nums',
                    )}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {foot && (
            <tfoot>
              <tr className="bg-muted/40 border-t-2 font-bold">
                {foot.map((c, i) => (
                  <td key={i} className={cn('px-2.5 py-1.5', i === 0 ? 'text-left' : 'text-right tabular-nums')}>
                    {c}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/**
 * A statement row that opens to show the documents behind it.
 *
 * "3 note(s)" is precisely the figure nobody can check without leaving the
 * screen — which party, which note, how much. The row now expands in place to
 * name them, and each debit note opens its own document.
 *
 * Credit notes list but do not link: they live in their own table and the app has
 * no viewer for them yet, and a row that looks clickable and does nothing is
 * worse than one that plainly does not.
 */
function NoteRows({
  label,
  info,
  value,
  notes,
  truncated,
  negative,
  onOpen,
}: {
  label: string;
  info?: string;
  value: string;
  notes: TradingNoteRow[];
  truncated: boolean;
  negative?: boolean;
  onOpen?: (n: TradingNoteRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const canExpand = notes.length > 0;
  return (
    <>
      <tr className="border-b last:border-b-0">
        <td className="py-1 pr-3 pl-6 text-sm">
          <button
            type="button"
            disabled={!canExpand}
            onClick={() => setOpen((o) => !o)}
            className={cn(
              'inline-flex items-center gap-1 text-left',
              canExpand && 'cursor-pointer hover:underline',
            )}
            aria-expanded={open}
          >
            {canExpand && <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />}
            {label}
            <span className="text-muted-foreground ml-1 text-xs font-normal">
              {notes.length ? `${count(notes.length)} note(s)` : 'none'}
            </span>
          </button>
          {info && <InfoTip className="ml-1 align-[-2px]" text={info} />}
        </td>
        <td className={cn('py-1 pr-3 text-right text-sm tabular-nums', negative && 'text-rose-600 dark:text-rose-400')}>
          {negative ? `(${value})` : value}
        </td>
      </tr>
      {open &&
        notes.map((n) => (
          <tr key={n.id} className="bg-muted/25 border-b last:border-b-0">
            <td className="py-0.5 pr-3 pl-12 text-[12px]">
              {onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(n)}
                  className="text-primary cursor-pointer font-semibold hover:underline"
                  title="Open this note"
                >
                  {n.code}
                </button>
              ) : (
                <span className="font-semibold">{n.code}</span>
              )}
              <span className="text-muted-foreground ml-2">{n.customerName}</span>
              <span className="text-muted-foreground/70 ml-2 tabular-nums">{n.date.slice(0, 10)}</span>
            </td>
            <td className={cn('py-0.5 pr-3 text-right text-[12px] tabular-nums', negative && 'text-rose-600 dark:text-rose-400')}>
              {money(n.amount)}
            </td>
          </tr>
        ))}
      {open && truncated && (
        <tr className="bg-muted/25 border-b last:border-b-0">
          <td colSpan={2} className="text-muted-foreground py-0.5 pl-12 text-[11px]">
            Showing the first {count(notes.length)} — the figure above covers them all.
          </td>
        </tr>
      )}
    </>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Layers; children: React.ReactNode }) {
  return (
    <h4 className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
      <Icon className="size-3.5" /> {children}
    </h4>
  );
}


/** One line of the trading statement. `kind` drives the styling: a plain row, a
 *  subtotal rule, or the closing total. */
function TradeRow({
  label,
  value,
  note,
  kind = 'row',
  negative,
}: {
  label: string;
  value: string;
  note?: string;
  kind?: 'row' | 'subtotal' | 'total';
  /** Deducted from the running figure — shown in red with a leading minus. */
  negative?: boolean;
}) {
  return (
    <tr
      className={cn(
        'border-b last:border-b-0',
        kind === 'subtotal' && 'bg-muted/40 font-semibold',
        kind === 'total' && 'bg-primary/5 border-t-2 border-t-primary/30 font-bold',
      )}
    >
      <td className={cn('py-1.5 pr-3 pl-3 text-sm', kind === 'row' && 'pl-6')}>
        {label}
        {note && <span className="text-muted-foreground ml-2 text-xs font-normal">{note}</span>}
      </td>
      <td className={cn('py-1.5 pr-3 text-right text-sm tabular-nums', negative && 'text-rose-600 dark:text-rose-400')}>
        {negative ? `(${value})` : value}
      </td>
    </tr>
  );
}

export function ChallanAnalyticsDialog({ open, onOpenChange, base }: Props) {
  const navigate = useNavigate();
  // The modal keeps its own filter state, (re)seeded from the list's current
  // filters each time it opens.
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState(base.status ?? '');
  const [preset, setPreset] = useState('This Year');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // On each open, seed straight from the list's own filters so the KPIs reflect
  // exactly what the list is showing — all-time when the list has no date range.
  // (Previously this forced "This Year", which silently hid older data: e.g. a
  // sparse, mostly-historical category like SCRAP looked empty and its totals
  // never matched the list. Users can still narrow with the Quick-range picker.)
  useEffect(() => {
    if (!open) return;
    setCategory('');
    setStatus(base.status ?? '');
    setDateFrom(base.dateFrom ?? '');
    setDateTo(base.dateTo ?? '');
    setPreset('');
    // Only re-run when the dialog opens; base is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const query: ChallanQuery = useMemo(
    () => ({
      page: 1,
      pageSize: 1,
      search: base.search || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      status: status || undefined,
      category: category || undefined,
    }),
    [base.search, dateFrom, dateTo, status, category],
  );

  const { data, isLoading, isFetching } = useChallanAnalytics(query, open);
  const t = data?.totals;
  const tr = data?.trading;
  const maxCat = Math.max(1, ...(data?.byCategory ?? []).map((c) => c.total));
  const maxParty = Math.max(1, ...(data?.topParties ?? []).map((p) => p.total));

  const applyPreset = (p: string) => {
    setPreset(p);
    const r = presetRange(p);
    if (r) {
      setDateFrom(r.from);
      setDateTo(r.to);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[min(1000px,96vw)] max-w-[96vw] overflow-y-auto sm:!max-w-[1000px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="bg-gradient-brand flex size-8 items-center justify-center rounded-lg text-white shadow-sm ring-1 ring-white/20">
              <BarChart3 className="size-4" />
            </span>
            Challan Analytics
            {isFetching && !isLoading && <span className="text-muted-foreground text-xs font-normal">updating…</span>}
          </DialogTitle>
          <DialogDescription>Sales, billing and receivables at a glance. Filter by category, date range and status.</DialogDescription>
        </DialogHeader>

        {/* Filters */}
        <div className="bg-muted/40 flex flex-wrap items-end gap-2 rounded-md border p-2.5">
          <div className="w-40 space-y-1">
            <Label className="text-xs">Category</Label>
            <NativeSelect value={category} onChange={setCategory} options={['', ...(data?.categories ?? [])]} placeholder="All categories" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" className="w-36" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPreset(''); }} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" className="w-36" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPreset(''); }} />
          </div>
          <div className="w-36 space-y-1">
            <Label className="text-xs">Quick range</Label>
            <NativeSelect value={preset} onChange={applyPreset} options={['', ...PRESETS]} placeholder="Range…" />
          </div>
          <div className="w-40 space-y-1">
            <Label className="text-xs">Status</Label>
            <NativeSelect value={status} onChange={setStatus} options={['', 'CONFIRMED', 'CANCELLED']} placeholder="All statuses" />
          </div>
        </div>

        {isLoading || !t || !tr ? (
          <div className="text-muted-foreground grid place-items-center py-16 text-sm">Crunching numbers…</div>
        ) : (
          <div className="space-y-5">
            {/* Headline KPIs */}
            {/* Hairlines over a border-coloured background rather than gaps
                between cards: a Tally screen is a grid, and 12 shadowed cards
                with 10px gutters spent most of the dialog on air. */}
            <div className="bg-border grid grid-cols-3 gap-px overflow-hidden rounded-[4px] border sm:grid-cols-4 lg:grid-cols-6">
              {/* Says its basis outright: this is the invoice value of the
                  challans (tax and charges in, returns not netted), which is a
                  different measure from the Trading Account's goods-value Gross
                  Sales. Two cards reading plain "Sales" is what made them look
                  like they disagreed. */}
              <Fig label="Sales" value={moneyShort(t.totalSales)} hint={money(t.totalSales)} />
              <Fig label="Challans" value={count(t.count)} hint={`avg ${money(t.avgValue)}`} />
              <Fig label="Bags" value={count(t.totalBags)} hint="across all lines" />
              <Fig label="Billed (B)" value={moneyShort(t.totalB)} hint={money(t.totalB)} />
              <Fig label="Cash (C)" value={moneyShort(t.totalC)} hint={money(t.totalC)} />
              <Fig label="GST" value={moneyShort(t.totalGst)} hint={money(t.totalGst)} />
              <Fig label="Freight" value={money(t.totalFreight)} />
              <Fig label="Packing" value={money(t.totalPacking)} />
              <Fig label="Confirmed" value={count(data.byStatus.confirmed.count)} hint={money(data.byStatus.confirmed.total)} tone="good" />
              <Fig
                label="Cancelled"
                value={count(data.byStatus.cancelled.count)}
                hint={money(data.byStatus.cancelled.total)}
                tone={data.byStatus.cancelled.count ? 'bad' : undefined}
              />
              {t.totalTds > 0 && <Fig label="TDS" value={money(t.totalTds)} tone="warn" />}
              {t.totalTcs > 0 && <Fig label="TCS" value={money(t.totalTcs)} tone="warn" />}
              <Fig
                label="Overdue"
                value={moneyShort(data.overdue.total)}
                hint={`${count(data.overdue.count)} challan(s)`}
                tone={data.overdue.total ? 'bad' : 'good'}
              />
            </div>

            {/* Freight & packing, per category — a freight total says what was
                spent, not what it was spent on, and "which category is eating the
                freight, and on how many bags" is the question actually asked of
                it. */}
            {data.byCategory.some((c) => c.freight || c.packing || c.bags) && (
              <TallyTable
                title="Freight & Packing by Category"
                icon={Truck}
                head={['Category', 'Challans', 'Bags', 'Freight', 'Packing', 'Freight/Bag']}
                rows={data.byCategory.map((c) => [
                  c.category,
                  count(c.count),
                  count(c.bags),
                  money(c.freight),
                  money(c.packing),
                  c.bags > 0 ? money(Math.round(c.freight / c.bags)) : '—',
                ])}
                foot={[
                  'Total',
                  count(t.count),
                  count(t.totalBags),
                  money(t.totalFreight),
                  money(t.totalPacking),
                  t.totalBags > 0 ? money(Math.round(t.totalFreight / t.totalBags)) : '—',
                ]}
              />
            )}

            {/* Trading account — the statement view: what was sold, what came
                back, and what was actually invoiced over the selected range. */}
            <div>
              <SectionTitle icon={Scale}>
                Trading Account · {dateFrom || 'start'} to {dateTo || 'today'}
                <span className="text-muted-foreground ml-1 font-normal normal-case">
                  ({status ? status.toLowerCase() : 'all statuses'}
                  {category ? ` · ${category}` : ''})
                </span>
              </SectionTitle>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full border-collapse">
                  <caption className="sr-only">Trading account for the selected filters</caption>
                  <tbody>
                    {/* Opens on the same figure as the Total Sales card, then
                        strips tax and charges back out to reach a goods value —
                        so the statement bridges to the KPI in its own column
                        rather than in a footnote. */}
                    <TradeRow label="Total Sales (invoice value)" value={money(tr.totalSales.amount)} note={`${count(tr.totalSales.count)} challan(s), incl. GST & charges`} kind="subtotal" />
                    <TradeRow label="Less: GST charged" value={money(tr.grossGst)} negative />
                    <TradeRow label="Less: Freight, Packing & Box" value={money(tr.grossCharges)} negative />
                    {tr.grossTcs > 0 && <TradeRow label="Less: TCS collected" value={money(tr.grossTcs)} negative />}
                    {/* Only when documents don't decompose — keeps the column tying. */}
                    {Math.abs(tr.openingVariance) >= 1 && (
                      <TradeRow
                        label={tr.openingVariance > 0 ? 'Less: unreconciled document variance' : 'Add: unreconciled document variance'}
                        value={money(Math.abs(tr.openingVariance))}
                        note={`${count(tr.documentsOutOfLine)} challan(s)`}
                        negative={tr.openingVariance > 0}
                      />
                    )}
                    <TradeRow label="Goods value invoiced" value={money(tr.goodsInvoiced)} kind="subtotal" />
                    {tr.debitNotes.amount !== 0 && (
                      <NoteRows
                        label="of which: Debit Notes"
                        info="Already inside the goods value above — listed here so it can be checked, not added again."
                        value={money(tr.debitNotes.amount)}
                        notes={tr.debitNoteList}
                        truncated={tr.debitNotesTruncated}
                        onOpen={(n) => {
                          onOpenChange(false);
                          navigate(`/challans/${n.id}/bill`);
                        }}
                      />
                    )}
                    <NoteRows
                      label="Less: Sales Returns"
                      value={money(tr.salesReturns.amount)}
                      notes={tr.creditNoteList}
                      truncated={tr.creditNotesTruncated}
                      negative
                    />
                    <TradeRow label="Net Sales" value={money(tr.netSales)} kind="subtotal" />
                    <TradeRow label="Add: Freight, Packing & Box" value={money(tr.freight + tr.packing + tr.pouch)} note="net of returns" />
                    <TradeRow label="Net Revenue (before GST)" value={money(tr.netRevenue)} kind="subtotal" />
                    <TradeRow label="Add: GST" value={money(tr.gst)} note="net of returns" />
                    {tr.tcs > 0 && <TradeRow label="Add: TCS" value={money(tr.tcs)} />}
                    {tr.tds > 0 && <TradeRow label="Less: TDS" value={money(tr.tds)} negative />}
                    <TradeRow label="Total Invoiced (net of returns)" value={money(tr.totalInvoiced)} kind="total" />
                  </tbody>
                </table>
              </div>
              <div className="text-muted-foreground mt-1.5 space-y-1 text-[11.5px]">
                <p>
                  Return rate <span className="text-foreground font-semibold tabular-nums">{tr.returnRatePercent}%</span> of gross
                  sales.
                  {tr.cancelled.count > 0 &&
                    (status.toUpperCase() === 'CONFIRMED'
                      ? ` Excludes ${count(tr.cancelled.count)} cancelled worth ${money(tr.cancelled.amount)}.`
                      : ` Includes ${count(tr.cancelled.count)} cancelled worth ${money(tr.cancelled.amount)}.`)}
                </p>
                {/* Kept as a visible warning, not folded into a tooltip: it says
                    the documents do not add up, which is the one thing here that
                    needs acting on rather than understanding. */}
                {tr.documentsOutOfLine > 0 && (
                  <p className="text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mr-1 inline size-3.5 align-[-2px]" />
                    {count(tr.documentsOutOfLine)} challan(s) carry a stored total differing from their own goods + charges + tax
                    — a net {money(tr.documentTotal - tr.totalInvoiced)} against {money(tr.documentTotal)} of document totals.
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              {/* By category */}
              <div>
                <SectionTitle icon={Layers}>By Customer Category</SectionTitle>
                {data.byCategory.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No data.</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.byCategory.map((c) => (
                      <div key={c.category} className="grid grid-cols-[1fr_auto] items-center gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">{c.category}</span>
                            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                              {count(c.count)} · {money(c.total)}
                            </span>
                          </div>
                          <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                            <div className="bg-gradient-brand h-full rounded-full" style={{ width: `${(c.total / maxCat) * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Top parties */}
              <div>
                <SectionTitle icon={Building2}>Top Parties</SectionTitle>
                {data.topParties.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No data.</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.topParties.map((p, i) => (
                      <div key={p.customerName} className="min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            <span className="text-muted-foreground mr-1.5 tabular-nums">{i + 1}.</span>
                            {p.customerName}
                          </span>
                          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            {count(p.count)} · {money(p.total)}
                          </span>
                        </div>
                        <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                          <div className="h-full rounded-full bg-sky-500" style={{ width: `${(p.total / maxParty) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <p className="text-muted-foreground flex items-center gap-1.5 border-t pt-3 text-xs">
              {data.overdue.total > 0 ? (
                <>
                  <AlertTriangle className="size-3.5 text-rose-500" />
                  {money(data.overdue.total)} across {count(data.overdue.count)} confirmed challan(s) is past due.
                </>
              ) : (
                <>
                  <TrendingUp className="size-3.5 text-emerald-500" />
                  Nothing overdue in the current filter.
                </>
              )}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ChallanAnalyticsDialog;
