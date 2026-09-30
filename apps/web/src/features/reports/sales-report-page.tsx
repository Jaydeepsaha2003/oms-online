import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { TrendingUp } from 'lucide-react';
import type { SalesReport } from '@oms/shared';
import { cn } from '@/lib/utils';
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

/** Last FY in slate — readable, but clearly the year before — this FY in the full colours. */
const LAST_BANK = '#475569';
const LAST_CASH = '#94a3b8';

type YoyRow = SalesReport['yoy'][number];
const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
const pctText = (p: number | null) => (p == null ? '—' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`);

/** One month, both years, in dark text — the series colours are only the dots. */
function YoyTooltip({ active, payload, label, fy, book }: TooltipProps<number, string> & { fy: SalesReport['fy']; book: string }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as YoyRow;
  const g = r.thisYear > 0 ? pct(r.thisYear, r.lastYear) : null;
  const year = (name: string, bank: number, cash: number, total: number, dots: [string, string]) => (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-extrabold">{name}</span>
        <span className="font-extrabold tabular-nums">{inrFull(total)}</span>
      </div>
      {(
        [
          ['Bank', bank, dots[0]],
          ['Cash', cash, dots[1]],
        ] as const
      ).filter(() => !book).map(([k, v, dot]) => (
        <div key={k} className="text-muted-foreground flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: dot }} />
            {k}
          </span>
          <span className="tabular-nums">{inrFull(v)}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="bg-popover text-popover-foreground min-w-[230px] space-y-2 rounded-xl border p-3 text-[12px] shadow-lg">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-extrabold">{label}</span>
        {g != null && (
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', g >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300')}>
            {pctText(g)}
          </span>
        )}
      </div>
      {year(fy.this, r.thisYearBank, r.thisYearCash, r.thisYear, [DESK_BANK, DESK_CASH])}
      <div className="border-t" />
      {year(fy.last, r.lastYearBank, r.lastYearCash, r.lastYear, [LAST_BANK, LAST_CASH])}
    </div>
  );
}

/** A figure at the top of the FY card. */
function FyTile({ label, value, sub, bar, tone }: { label: string; value: string; sub?: string; bar: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="bg-card relative overflow-hidden rounded-xl border px-3.5 py-2.5 shadow-sm">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: bar }} />
      <div className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">{label}</div>
      <div className={cn('mt-0.5 text-[18px] leading-tight font-extrabold tabular-nums', tone === 'good' && 'text-emerald-600 dark:text-emerald-400', tone === 'bad' && 'text-rose-600 dark:text-rose-400')}>
        {value}
      </div>
      {sub && <div className="text-muted-foreground truncate text-[11.5px]">{sub}</div>}
    </div>
  );
}

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
  const fy = data?.fy;
  // Bank / Cash / Both: the server already counts only that part; the charts
  // then draw only its series.
  const book = filters.f.book;
  const showBank = book !== 'CASH';
  const showCash = book !== 'BANK';
  const bookLabel = book === 'BANK' ? 'Bank' : book === 'CASH' ? 'Cash' : null;
  const thisTotals = useMemo(
    () => yoy.reduce((t, m) => ({ total: t.total + m.thisYear, bank: t.bank + m.thisYearBank, cash: t.cash + m.thisYearCash }), { total: 0, bank: 0, cash: 0 }),
    [yoy],
  );

  const hero: ReportHero = {
    label: `Billed this period${bookLabel ? ` · ${bookLabel}` : ''}`,
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

      <ReportFilterBar f={filters.f} setF={filters.setF} active={filters.active} onReset={filters.reset} books />

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

      <ReportCard title={fy ? `${fy.this} vs ${fy.last} · Apr → Mar` : 'This financial year vs last (Apr → Mar)'} right={toCome}>
        {isLoading || !fy ? <div className="bg-muted h-[320px] animate-pulse rounded-lg" /> : (
          <>
            <div className="mb-3 grid grid-cols-3 gap-2 sm:gap-3">
              <FyTile
                label={`${fy.this}${toCome ? ' so far' : ''}`}
                value={inrCompact(thisTotals.total)}
                sub={bookLabel ? `${bookLabel} bills only` : `Bank ${inrCompact(thisTotals.bank)} · Cash ${inrCompact(thisTotals.cash)}`}
                bar={DESK_BANK}
              />
              <FyTile
                label={`${fy.last}${toCome ? ' same months' : ''}`}
                value={inrCompact(data?.yoyTotals.lastYear ?? 0)}
                sub={toCome ? `Full year ${inrCompact(data?.yoyTotals.lastYearFull ?? 0)}` : undefined}
                bar={LAST_BANK}
              />
              <FyTile label="Growth" value={growthText} sub={toCome ? 'same months' : 'full year'} bar={(growth ?? 0) >= 0 ? '#10b981' : '#e11d48'} tone={growth == null ? undefined : growth >= 0 ? 'good' : 'bad'} />
            </div>
            <ChartLegend
              items={[
                ...(showBank ? [{ label: `${fy.this} · bank`, color: DESK_BANK }] : []),
                ...(showCash ? [{ label: `${fy.this} · cash`, color: DESK_CASH }] : []),
                ...(showBank ? [{ label: `${fy.last} · bank`, color: LAST_BANK }] : []),
                ...(showCash ? [{ label: `${fy.last} · cash`, color: LAST_CASH }] : []),
              ]}
            />
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yoy} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barGap={3} barCategoryGap="22%">
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="label" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: '#dfe4ee' }} />
                  <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => inrCompact(v)} />
                  <Tooltip content={<YoyTooltip fy={fy} book={book} />} cursor={{ fill: 'rgba(79,110,247,0.07)' }} />
                  {showBank && <Bar name={`${fy.last} (Bank)`} dataKey="lastYearBank" stackId="last" fill={LAST_BANK} radius={showCash ? undefined : BAR_RADIUS} maxBarSize={20} />}
                  {showCash && <Bar name={`${fy.last} (Cash)`} dataKey="lastYearCash" stackId="last" fill={LAST_CASH} radius={BAR_RADIUS} maxBarSize={20} />}
                  {showBank && <Bar name={`${fy.this} (Bank)`} dataKey="thisYearBank" stackId="this" fill={DESK_BANK} radius={showCash ? undefined : BAR_RADIUS} maxBarSize={20} />}
                  {showCash && <Bar name={`${fy.this} (Cash)`} dataKey="thisYearCash" stackId="this" fill={DESK_CASH} radius={BAR_RADIUS} maxBarSize={20} />}
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
              <ChartLegend items={[...(showBank ? [{ label: 'Bank', color: DESK_BANK }] : []), ...(showCash ? [{ label: 'Cash', color: DESK_CASH }] : [])]} />
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
                    <CartesianGrid {...CHART_GRID} />
                    <XAxis dataKey="label" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: '#dfe4ee' }} />
                    <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => inrCompact(v)} />
                    <Tooltip formatter={(v: number) => inrFull(v)} cursor={{ fill: 'rgba(79,110,247,0.06)' }} />
                    {showBank && <Bar name="Bank" dataKey="billedBank" stackId="billed" fill={DESK_BANK} radius={showCash ? undefined : BAR_RADIUS} maxBarSize={28} />}
                    {showCash && <Bar name="Cash" dataKey="billedCash" stackId="billed" fill={DESK_CASH} radius={BAR_RADIUS} maxBarSize={28} />}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </ReportCard>

        <ReportCard
          title={fy ? `Seasonality · ${fy.this} (Apr → Mar)` : 'Seasonality (Apr → Mar)'}
          note={`1× = ${fy?.this ?? 'the FY'}'s average ${toCome ? 'completed ' : ''}month. Green months beat it; amber months trail it${toCome ? '; this month counts so far, and months still to come have no bar' : ''}.`}
        >
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
                  <Tooltip formatter={(v: number) => `${v}× the average month`} cursor={{ fill: 'rgba(79,110,247,0.06)' }} />
                  <ReferenceLine y={1} stroke="#7a849c" strokeDasharray="4 4" label={{ value: '1× average', position: 'insideTopRight', fill: '#7a849c', fontSize: 10.5, fontWeight: 700 }} />
                  <Bar dataKey="index" radius={BAR_RADIUS} maxBarSize={28}>
                    {(data?.seasonality ?? []).map((s, i) => <Cell key={i} fill={(s.index ?? 0) >= 1 ? 'url(#season-up)' : 'url(#season-down)'} />)}
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
