import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingUp } from 'lucide-react';
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
  ReportHeader,
  ReportSummary,
  type ReportHero,
} from './report-kit';
import { ReportFilterBar, useReportFilters } from './report-filters';
import { useSalesReport } from './use-reports';

/** Last FY in the lighter half of each pair, this FY in the full colours. */
const LAST_BANK = '#9fb0f2';
const LAST_CASH = '#b7f0d6';

export function SalesReportPage() {
  const filters = useReportFilters();
  const { data, isLoading } = useSalesReport(12, filters.query);
  const monthly = useMemo(() => data?.monthly ?? [], [data]);
  const total12 = monthly.reduce((s, m) => s + m.billed, 0);
  const peak = monthly.reduce<{ label: string; billed: number } | null>((best, m) => (!best || m.billed > best.billed ? m : best), null);
  const growth = data?.yoyTotals?.growthPct ?? null;
  const growthText = growth != null ? `${growth > 0 ? '+' : ''}${growth.toFixed(1)}%` : '—';

  // The months of this FY not reached yet — the tail with nothing billed.
  const yoy = useMemo(() => data?.yoy ?? [], [data]);
  const toCome = useMemo(() => {
    let i = yoy.length;
    while (i > 0 && !((yoy[i - 1].thisYearBank ?? 0) + (yoy[i - 1].thisYearCash ?? 0))) i -= 1;
    return i < yoy.length ? `${yoy[i].label} → ${yoy[yoy.length - 1].label} still to come` : undefined;
  }, [yoy]);

  const hero: ReportHero = {
    label: 'Billed this period',
    value: inrCompact(total12),
    hint: 'FY-to-date vs the same months last FY',
    delta: growth != null ? { dir: growth >= 0 ? 'up' : 'down', text: `${Math.abs(growth).toFixed(1)}%` } : undefined,
    chip: growth != null ? { text: `${growth >= 0 ? '↑' : '↓'} ${Math.abs(growth).toFixed(1)}% YoY`, tone: growth >= 0 ? 'good' : 'bad' } : undefined,
    stats: [
      { label: 'Peak month', value: peak ? inrCompact(peak.billed) : '—', hint: peak?.label, dot: '#6ee7b7' },
      { label: 'YoY growth', value: growthText, hint: data?.yoyTotals ? `${inrCompact(data.yoyTotals.lastYear ?? 0)} last FY, same months` : undefined, dot: '#7dd3fc' },
      { label: 'Top agent', value: inrCompact(data?.byAgent[0]?.value ?? 0), hint: data?.byAgent[0]?.name ?? '—', dot: '#c4b5fd' },
      { label: 'Regions', value: data ? String(data.byRegion.length) : '—', hint: 'with revenue', dot: '#fcd34d' },
    ],
  };

  return (
    <div className="rp-page space-y-5">
      <ReportHeader
        title="Sales & Revenue"
        subtitle="The seasonal rhythm of your billing and where revenue comes from."
        icon={TrendingUp}
        asOf={data?.asOf}
        hero={{ label: hero.label, value: hero.value, hint: 'FY-to-date vs last FY', delta: hero.delta }}
      />

      <ReportFilterBar f={filters.f} setF={filters.setF} active={filters.active} onReset={filters.reset} />

      <ReportDeskHero hero={data ? hero : undefined} />

      <ReportSummary
        loading={isLoading}
        points={data ? [
          {
            text: <>This FY-to-date billing is <strong>{inrCompact(data.yoyTotals?.thisYear ?? 0)}</strong>{growth != null && <>, {growth >= 0 ? 'up' : 'down'} <strong>{Math.abs(growth).toFixed(0)}%</strong> vs the same months last year</>}.</>,
            tone: (growth ?? 0) >= 0 ? 'good' : 'warn',
            desk: { value: growthText, text: `Growth this FY so far (${inrCompact(data.yoyTotals?.thisYear ?? 0)}) vs the same months last year.` },
          },
          {
            text: <>Peak month was <strong>{peak?.label ?? '—'}</strong> at <strong>{peak ? inrCompact(peak.billed) : '—'}</strong>.</>,
            tone: 'info',
            desk: { value: peak?.label ?? '—', text: `Busiest month, at ${peak ? inrCompact(peak.billed) : '—'} billed.` },
          },
          {
            text: <>Top agent is <strong>{data.byAgent[0]?.name ?? '—'}</strong> ({inrCompact(data.byAgent[0]?.value ?? 0)}); leading region <strong>{data.byRegion[0]?.name ?? '—'}</strong>.</>,
            tone: 'info',
            desk: { value: data.byAgent[0]?.name ?? '—', text: `Top agent with ${inrCompact(data.byAgent[0]?.value ?? 0)}. ${data.byRegion[0]?.name ?? '—'} is the leading region.` },
          },
          {
            text: <>Strongest state is <strong>{data.byState[0]?.name ?? '—'}</strong> at <strong>{inrCompact(data.byState[0]?.value ?? 0)}</strong>.</>,
            tone: 'info',
            desk: { value: data.byState[0]?.name ?? '—', text: `Strongest state, at ${inrCompact(data.byState[0]?.value ?? 0)}.` },
          },
        ] : []}
      />

      {/* The desktop hero carries these four; the phone lists them. */}
      <KpiGrid deskHidden className="gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Billed (period)" value={inrCompact(total12)} title={inrFull(total12)} hint="selected dates" loading={isLoading} tone="blue" />
        <Kpi label="Peak month" value={peak ? inrCompact(peak.billed) : '—'} hint={peak?.label} loading={isLoading} tone="emerald" />
        <Kpi label="YoY growth" value={growthText} hint="FY-to-date vs last FY (same months)" loading={isLoading} tone={data && (growth ?? 0) >= 0 ? 'emerald' : 'rose'} />
        <Kpi label="Regions" value={data ? String(data.byRegion.length) : '—'} hint="with revenue" loading={isLoading} tone="amber" />
      </KpiGrid>

      <ReportCard title="This financial year vs last (Apr → Mar)" right={toCome}>
        {isLoading ? <div className="bg-muted h-[260px] animate-pulse rounded-lg" /> : (
          <>
            <ChartLegend items={[{ label: 'Last FY · bank', color: LAST_BANK }, { label: 'Last FY · cash', color: LAST_CASH }, { label: 'This FY · bank', color: DESK_BANK }, { label: 'This FY · cash', color: DESK_CASH }]} />
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yoy} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barGap={3} barCategoryGap="24%">
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="label" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: '#dfe4ee' }} />
                  <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => inrCompact(v)} />
                  <Tooltip formatter={(v: number) => inrFull(v)} cursor={{ fill: 'rgba(79,110,247,0.06)' }} />
                  <Bar name="Last FY (Bank)" dataKey="lastYearBank" stackId="last" fill={LAST_BANK} maxBarSize={18} />
                  <Bar name="Last FY (Cash)" dataKey="lastYearCash" stackId="last" fill={LAST_CASH} radius={BAR_RADIUS} maxBarSize={18} />
                  <Bar name="This FY (Bank)" dataKey="thisYearBank" stackId="this" fill={DESK_BANK} maxBarSize={18} />
                  <Bar name="This FY (Cash)" dataKey="thisYearCash" stackId="this" fill={DESK_CASH} radius={BAR_RADIUS} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </ReportCard>

      <div className="grid gap-[14px] lg:grid-cols-2">
        <ReportCard title="Monthly billed revenue, selected period">
          {isLoading ? <div className="bg-muted h-[240px] animate-pulse rounded-lg" /> : (
            <>
              <ChartLegend items={[{ label: 'Bank', color: DESK_BANK }, { label: 'Cash', color: DESK_CASH }]} />
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
                    <CartesianGrid {...CHART_GRID} />
                    <XAxis dataKey="label" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: '#dfe4ee' }} />
                    <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => inrCompact(v)} />
                    <Tooltip formatter={(v: number) => inrFull(v)} cursor={{ fill: 'rgba(79,110,247,0.06)' }} />
                    <Bar name="Bank" dataKey="billedBank" stackId="billed" fill={DESK_BANK} maxBarSize={28} />
                    <Bar name="Cash" dataKey="billedCash" stackId="billed" fill={DESK_CASH} radius={BAR_RADIUS} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </ReportCard>

        <ReportCard title="Historical seasonality" note="1× = an average month. Green months beat the average; amber months trail it.">
          {isLoading ? <div className="bg-muted h-[240px] animate-pulse rounded-lg" /> : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.seasonality ?? []} margin={{ top: 14, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
                  <defs>
                    <linearGradient id="season-up" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#34d399" /><stop offset="1" stopColor="#10b981" /></linearGradient>
                    <linearGradient id="season-down" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fcd34d" /><stop offset="1" stopColor="#f59e0b" /></linearGradient>
                  </defs>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="label" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: '#dfe4ee' }} />
                  <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={34} tickFormatter={(v: number) => `${v}×`} />
                  <Tooltip formatter={(v: number) => `${v}× average`} cursor={{ fill: 'rgba(79,110,247,0.06)' }} />
                  <ReferenceLine y={1} stroke="#7a849c" strokeDasharray="4 4" label={{ value: '1× average', position: 'insideTopRight', fill: '#7a849c', fontSize: 10.5, fontWeight: 700 }} />
                  <Bar dataKey="index" radius={BAR_RADIUS} maxBarSize={28}>
                    {(data?.seasonality ?? []).map((s, i) => <Cell key={i} fill={s.index >= 1 ? 'url(#season-up)' : 'url(#season-down)'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ReportCard>
      </div>

      <div className="grid gap-[14px] lg:grid-cols-2">
        <ReportCard title="Revenue by agent">{isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.byAgent ?? []} />}</ReportCard>
        <ReportCard title="Top parties">{isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.topParties ?? []} />}</ReportCard>
        <ReportCard title="Revenue by region">{isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.byRegion ?? []} />}</ReportCard>
        <ReportCard title="Revenue by state">{isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.byState ?? []} />}</ReportCard>
      </div>
    </div>
  );
}
