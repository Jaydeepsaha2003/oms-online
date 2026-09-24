import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Banknote, HandCoins, LayoutDashboard, Package, ReceiptText, ScrollText, Timer, TrendingUp, Users, Wallet } from 'lucide-react';
import type { ReportMonthPoint } from '@oms/shared';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import {
  BAR_RADIUS,
  CHART_GRID,
  CHART_TICK,
  ChartLegend,
  DESK_BANK,
  DESK_CASH,
  Kpi,
  KpiGrid,
  RankedBars,
  ReportCard,
  ReportDeskHero,
  ReportDonut,
  ReportHeader,
  ReportSummary,
  REPORT_COLORS,
  type ReportHero,
} from './report-kit';
import { ReportFilterBar, useReportFilters } from './report-filters';
import { useBusinessOverview } from './use-reports';

/** Collected is drawn in the lighter half of each pair, beside billed. */
const COLLECTED_BANK = '#9fb0f2';
const COLLECTED_CASH = '#b7f0d6';

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: ReportMonthPoint }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const rate = p.billed > 0 ? (p.collected / p.billed) * 100 : null;
  return (
    <div className="rounded-lg border bg-white/95 px-3 py-2 text-xs shadow-md backdrop-blur">
      <div className="mb-1 font-semibold text-slate-700">{label}</div>
      <div className="font-semibold text-slate-600">Billed: {inrFull(p.billed)}</div>
      <div className="flex items-center gap-1.5 pl-1"><span className="inline-block size-2.5 rounded-sm" style={{ background: DESK_BANK }} />Bank: <span className="font-semibold tabular-nums">{inrFull(p.billedBank)}</span></div>
      <div className="flex items-center gap-1.5 pl-1"><span className="inline-block size-2.5 rounded-sm" style={{ background: DESK_CASH }} />Cash: <span className="font-semibold tabular-nums">{inrFull(p.billedCash)}</span></div>
      <div className="mt-1.5 font-semibold text-slate-600">Collected: {inrFull(p.collected)}</div>
      <div className="flex items-center gap-1.5 pl-1"><span className="inline-block size-2.5 rounded-sm" style={{ background: COLLECTED_BANK }} />Bank: <span className="font-semibold tabular-nums">{inrFull(p.collectedBank)}</span></div>
      <div className="flex items-center gap-1.5 pl-1"><span className="inline-block size-2.5 rounded-sm" style={{ background: COLLECTED_CASH }} />Cash: <span className="font-semibold tabular-nums">{inrFull(p.collectedCash)}</span></div>
      {rate != null && <div className="mt-1 text-slate-500">Collected {rate.toFixed(0)}% of billed</div>}
    </div>
  );
}

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const dirOf = (d?: string) => (d === 'down' ? 'down' : d === 'up' ? 'up' : 'flat') as 'up' | 'down' | 'flat';

export function BusinessOverviewPage() {
  const filters = useReportFilters();
  const { data, isLoading } = useBusinessOverview(filters.query);
  const trend = useMemo(() => data?.trend ?? [], [data]);
  const catMix = useMemo(() => data?.categoryMix ?? [], [data]);
  const money = (v?: number) => (v == null ? '—' : inrCompact(v));

  const hero: ReportHero | undefined = data ? {
    label: 'Revenue this period',
    value: inrCompact(data.revenue.current),
    hint: data.collectionRate != null ? `${Math.round(data.collectionRate * 100)}% of it already collected` : undefined,
    delta: data.revenue.deltaPct != null ? { dir: dirOf(data.revenue.direction), text: `${Math.abs(data.revenue.deltaPct).toFixed(1)}%` } : undefined,
    bar: data.collectionRate != null ? { pct: data.collectionRate * 100, label: 'collected of billed', tone: 'good' } : undefined,
    stats: [
      {
        label: 'Collections',
        value: inrCompact(data.collections.current),
        hint: 'vs previous period',
        dot: '#6ee7b7',
        delta: data.collections.deltaPct != null ? { dir: dirOf(data.collections.direction), text: `${Math.abs(data.collections.deltaPct).toFixed(1)}%` } : undefined,
      },
      { label: 'Outstanding', value: inrCompact(data.outstanding), hint: 'net receivable', dot: '#ff8fab' },
      { label: 'To-bill backlog', value: inrCompact(data.backlogValue), hint: 'dispatched, not challaned', dot: '#c4b5fd' },
      { label: 'DSO', value: data.dsoDays != null ? `${data.dsoDays} days` : '—', hint: 'days sales outstanding', dot: '#fcd34d' },
    ],
  } : undefined;
  const range = trend.length ? `${trend[0].label} → ${trend[trend.length - 1].label}` : undefined;

  return (
    <div className="rp-page space-y-5">
      <ReportHeader
        title="Business Overview"
        subtitle="Your whole business in one screen: revenue, collections, receivables and where they come from."
        icon={LayoutDashboard}
        asOf={data?.asOf}
        hero={hero}
      />

      <ReportFilterBar f={filters.f} setF={filters.setF} active={filters.active} onReset={filters.reset} />

      <ReportDeskHero hero={hero} />

      <ReportSummary
        loading={isLoading}
        points={data ? [
          {
            text: <>Revenue in the selected period is <strong>{inrCompact(data.revenue.current)}</strong>{data.revenue.deltaPct != null && <>, {data.revenue.deltaPct >= 0 ? 'up' : 'down'} <strong>{Math.abs(data.revenue.deltaPct).toFixed(0)}%</strong> vs the previous equal period</>}.</>,
            tone: data.revenue.direction === 'down' ? 'warn' : 'good',
            desk: {
              value: inrCompact(data.revenue.current),
              text: data.revenue.deltaPct != null
                ? `Revenue this period, ${Math.abs(data.revenue.deltaPct).toFixed(0)}% ${data.revenue.deltaPct >= 0 ? 'higher' : 'lower'} than the previous period of the same length.`
                : 'Revenue this period.',
            },
          },
          {
            text: <>You've collected <strong>{pct(data.collectionRate)}</strong> of what you billed in this period.</>,
            tone: (data.collectionRate ?? 0) >= 0.8 ? 'good' : 'warn',
            desk: { value: pct(data.collectionRate), text: 'Share of this period’s billing already collected.' },
          },
          {
            text: <>Outstanding receivable is <strong>{inrCompact(data.outstanding)}</strong>, roughly <strong>{data.dsoDays ?? '—'} days</strong> of sales (DSO).</>,
            tone: 'info',
            desk: { value: data.dsoDays != null ? `${data.dsoDays} days` : '—', text: `Average time to collect (DSO). ${inrCompact(data.outstanding)} is outstanding right now.` },
          },
          {
            text: <><strong>{data.topParties[0]?.name ?? '—'}</strong> is your biggest party at <strong>{inrCompact(data.topParties[0]?.value ?? 0)}</strong> in this period.</>,
            tone: 'info',
            desk: { value: inrCompact(data.topParties[0]?.value ?? 0), text: `Billed to ${data.topParties[0]?.name ?? '—'}, your biggest party this period.` },
          },
          {
            text: <><strong>{inrCompact(data.backlogValue)}</strong> is dispatched but not yet billed.</>,
            tone: data.backlogValue > 0 ? 'warn' : 'good',
            desk: {
              value: inrCompact(data.backlogValue),
              text: data.backlogValue > 0 ? 'Dispatched but not billed yet. Raise the challans so it can be collected.' : 'Everything dispatched has been billed.',
            },
          },
          {
            text: <><strong>{data.activeParties}</strong> parties were billed in this period. <strong>{data.owingParties}</strong> parties owe money, including <strong>{data.olderOwingParties}</strong> not billed in this period.</>,
            tone: data.olderOwingParties > 0 ? 'warn' : 'info',
            desk: {
              value: `${data.owingParties} parties`,
              text: `Owe you money. ${data.olderOwingParties} of them were not billed this period, so their dues are older.`,
            },
          },
        ] : []}
      />

      {/* Revenue, collections, outstanding and backlog: the desktop hero shows them. */}
      <KpiGrid deskHidden className="gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Revenue (period)" value={money(data?.revenue.current)} title={data ? inrFull(data.revenue.current) : undefined} hint="vs previous period" icon={TrendingUp} tone="blue" metric={data?.revenue} loading={isLoading} />
        <Kpi label="Collections (period)" value={money(data?.collections.current)} title={data ? inrFull(data.collections.current) : undefined} hint="vs previous period" icon={HandCoins} tone="emerald" metric={data?.collections} loading={isLoading} />
        <Kpi label="Outstanding" value={money(data?.outstanding)} title={data ? inrFull(data.outstanding) : undefined} hint="net receivable" icon={Wallet} tone="rose" loading={isLoading} />
        <Kpi label="To-bill backlog" value={money(data?.backlogValue)} title={data ? inrFull(data.backlogValue) : undefined} hint="dispatched, not challaned" icon={Package} tone="violet" loading={isLoading} />
      </KpiGrid>

      {/* The operational figures: the desktop KPI strip, two-up tiles on a phone. */}
      <KpiGrid className="gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Orders" value={data ? Math.round(data.orders?.current ?? 0).toLocaleString('en-IN') : '—'} hint="vs previous period" icon={ReceiptText} tone="blue" metric={data?.orders} loading={isLoading} />
        <Kpi label="Challans" value={data ? Math.round(data.challans?.current ?? 0).toLocaleString('en-IN') : '—'} hint="vs previous period" icon={ScrollText} tone="amber" metric={data?.challans} loading={isLoading} />
        <Kpi label="Collection rate" value={pct(data?.collectionRate)} hint="collected ÷ billed" icon={Banknote} tone="emerald" loading={isLoading} />
        <Kpi label="DSO" value={data?.dsoDays != null ? `${data.dsoDays} days` : '—'} hint="days sales outstanding" icon={Timer} tone="slate" loading={isLoading} deskHidden />
        <Kpi label="Avg invoice value" value={money(data?.avgInvoiceValue)} title={data ? inrFull(data.avgInvoiceValue) : undefined} hint="per challan" icon={ReceiptText} tone="violet" loading={isLoading} />
        <Kpi label="Billed parties" value={data ? (data.activeParties ?? 0).toLocaleString('en-IN') : '—'} hint="selected period" icon={Users} tone="blue" loading={isLoading} />
      </KpiGrid>

      {/* Phone: modes, then the trend. Desktop: the trend first, modes beside it. */}
      <div className="grid gap-[14px] lg:grid-cols-2">
        <div className="flex flex-col sm:order-2">
          <ReportCard title="Collections by mode" right="period">
            {isLoading ? <div className="bg-muted h-16 animate-pulse rounded" /> : <RankedBars data={data?.collectionModes ?? []} emptyText="No receipts in this period." colorFor={(d) => (/cash/i.test(d.name) ? DESK_CASH : DESK_BANK)} />}
          </ReportCard>
        </div>
        <div className="flex flex-col sm:order-1">
          <ReportCard title="Billed vs collected, last 12 months" right={range}>
            {isLoading ? (
              <div className="bg-muted h-[260px] animate-pulse rounded-lg" />
            ) : trend.length === 0 ? (
              <div className="text-muted-foreground flex h-[260px] items-center justify-center text-sm">No data yet.</div>
            ) : (
              <>
                <ChartLegend items={[{ label: 'Billed · bank', color: DESK_BANK }, { label: 'Billed · cash', color: DESK_CASH }, { label: 'Collected · bank', color: COLLECTED_BANK }, { label: 'Collected · cash', color: COLLECTED_CASH }]} />
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trend} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barGap={3} barCategoryGap="22%">
                      <CartesianGrid {...CHART_GRID} />
                      <XAxis dataKey="label" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: '#dfe4ee' }} />
                      <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => inrCompact(v)} />
                      <Tooltip content={<TrendTooltip />} cursor={{ fill: 'rgba(79,110,247,0.06)' }} />
                      <Bar dataKey="billedBank" stackId="billed" fill={DESK_BANK} maxBarSize={16} />
                      <Bar dataKey="billedCash" stackId="billed" fill={DESK_CASH} radius={BAR_RADIUS} maxBarSize={16} />
                      <Bar dataKey="collectedBank" stackId="collected" fill={COLLECTED_BANK} maxBarSize={16} />
                      <Bar dataKey="collectedCash" stackId="collected" fill={COLLECTED_CASH} radius={BAR_RADIUS} maxBarSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </ReportCard>
        </div>
      </div>

      <div className="grid gap-[14px] lg:grid-cols-2">
        <ReportCard title="Revenue by category">
          {isLoading ? (
            <div className="bg-muted h-[200px] animate-pulse rounded-lg" />
          ) : (
            <>
              {/* Phone: the ring and the bars, as its mockup has them. */}
              <div className="sm:hidden">
                {catMix.length === 0 ? (
                  <div className="text-muted-foreground flex h-[200px] items-center justify-center text-sm">No data yet.</div>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <div className="h-[220px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={catMix} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={88} paddingAngle={2}>
                            {catMix.map((_, i) => <Cell key={i} fill={REPORT_COLORS[i % REPORT_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => inrFull(v)} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="w-full"><RankedBars data={catMix.slice(0, 6)} /></div>
                  </div>
                )}
              </div>
              <div className="hidden sm:block"><ReportDonut data={catMix.slice(0, 8)} /></div>
            </>
          )}
        </ReportCard>

        <ReportCard title="Top parties by revenue">
          {isLoading ? <div className="bg-muted h-[240px] animate-pulse rounded-lg" /> : <RankedBars data={data?.topParties.slice(0, 8) ?? []} />}
        </ReportCard>
      </div>

      <div className="grid gap-[14px] lg:grid-cols-2">
        <ReportCard title="Revenue by region">
          {isLoading ? <div className="bg-muted h-[240px] animate-pulse rounded-lg" /> : <RankedBars data={data?.byRegion.slice(0, 8) ?? []} />}
        </ReportCard>
        <ReportCard title="Revenue by agent">
          {isLoading ? <div className="bg-muted h-[240px] animate-pulse rounded-lg" /> : <RankedBars data={data?.byAgent.slice(0, 8) ?? []} />}
        </ReportCard>
      </div>
    </div>
  );
}
