import { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Building2, Layers, TrendingUp } from 'lucide-react';
import type { ChallanQuery } from '@oms/shared';
import { cn } from '@/lib/utils';
import { NativeSelect } from '@/components/common/combo';
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

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3 shadow-sm',
        tone === 'good' && 'border-emerald-200 bg-emerald-50/60',
        tone === 'warn' && 'border-amber-200 bg-amber-50/60',
        tone === 'bad' && 'border-rose-200 bg-rose-50/60',
        (!tone || tone === 'default') && 'bg-card',
      )}
    >
      <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">{sub}</p>}
    </div>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Layers; children: React.ReactNode }) {
  return (
    <h4 className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
      <Icon className="size-3.5" /> {children}
    </h4>
  );
}

export function ChallanAnalyticsDialog({ open, onOpenChange, base }: Props) {
  // The modal keeps its own filter state, seeded from the list's current filters.
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState(base.status ?? '');
  const [preset, setPreset] = useState('');
  const [dateFrom, setDateFrom] = useState(base.dateFrom ?? '');
  const [dateTo, setDateTo] = useState(base.dateTo ?? '');

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

        {isLoading || !t ? (
          <div className="text-muted-foreground grid place-items-center py-16 text-sm">Crunching numbers…</div>
        ) : (
          <div className="space-y-5">
            {/* Headline KPIs */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              <StatCard label="Total Sales" value={moneyShort(t.totalSales)} sub={money(t.totalSales)} />
              <StatCard label="Challans" value={count(t.count)} sub={`avg ${money(t.avgValue)}`} />
              <StatCard label="Total B (billed)" value={moneyShort(t.totalB)} sub={money(t.totalB)} />
              <StatCard label="Total C (cash)" value={moneyShort(t.totalC)} sub={money(t.totalC)} />
              <StatCard label="Total GST" value={moneyShort(t.totalGst)} sub={money(t.totalGst)} />
              <StatCard label="Total TDS" value={money(t.totalTds)} tone={t.totalTds ? 'warn' : 'default'} />
              <StatCard label="Total TCS" value={money(t.totalTcs)} tone={t.totalTcs ? 'warn' : 'default'} />
              <StatCard
                label="Overdue (confirmed)"
                value={moneyShort(data.overdue.total)}
                sub={`${count(data.overdue.count)} challan(s)`}
                tone={data.overdue.total ? 'bad' : 'good'}
              />
            </div>

            {/* Status split + charges */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatCard label="Confirmed" value={count(data.byStatus.confirmed.count)} sub={money(data.byStatus.confirmed.total)} tone="good" />
              <StatCard label="Cancelled" value={count(data.byStatus.cancelled.count)} sub={money(data.byStatus.cancelled.total)} tone={data.byStatus.cancelled.count ? 'bad' : 'default'} />
              <StatCard label="Freight" value={money(t.totalFreight)} />
              <StatCard label="Packing" value={money(t.totalPacking)} />
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
