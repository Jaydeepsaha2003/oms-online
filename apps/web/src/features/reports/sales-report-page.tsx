import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { Kpi, RankedBars, ReportCard, ReportHeader, ReportSummary } from './report-kit';
import { useSalesReport } from './use-reports';

export function SalesReportPage() {
  const { data, isLoading } = useSalesReport(12);
  const monthly = useMemo(() => data?.monthly ?? [], [data]);
  const total12 = monthly.reduce((s, m) => s + m.billed, 0);
  const peak = monthly.reduce<{ label: string; billed: number } | null>((best, m) => (!best || m.billed > best.billed ? m : best), null);

  return (
    <div className="space-y-5">
      <ReportHeader title="Sales & Revenue" subtitle="The seasonal rhythm of your billing and where revenue comes from." icon={TrendingUp} asOf={data?.asOf} />

      <ReportSummary
        loading={isLoading}
        points={data ? [
          { text: <>This FY-to-date billing is <strong>{inrCompact(data.yoyTotals.thisYear)}</strong>{data.yoyTotals.growthPct != null && <>, {data.yoyTotals.growthPct >= 0 ? 'up' : 'down'} <strong>{Math.abs(data.yoyTotals.growthPct).toFixed(0)}%</strong> vs the same months last year</>}.</>, tone: (data.yoyTotals.growthPct ?? 0) >= 0 ? 'good' : 'warn' },
          { text: <>Peak month was <strong>{peak?.label ?? '—'}</strong> at <strong>{peak ? inrCompact(peak.billed) : '—'}</strong>.</>, tone: 'info' },
          { text: <>Top agent is <strong>{data.byAgent[0]?.name ?? '—'}</strong> ({inrCompact(data.byAgent[0]?.value ?? 0)}); leading region <strong>{data.byRegion[0]?.name ?? '—'}</strong>.</>, tone: 'info' },
          { text: <>Strongest state is <strong>{data.byState[0]?.name ?? '—'}</strong> at <strong>{inrCompact(data.byState[0]?.value ?? 0)}</strong>.</>, tone: 'info' },
        ] : []}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Billed (12 mo)" value={inrCompact(total12)} title={inrFull(total12)} hint="rolling 12 months" loading={isLoading} tone="blue" />
        <Kpi label="Peak month" value={peak ? inrCompact(peak.billed) : '—'} hint={peak?.label} loading={isLoading} tone="emerald" />
        <Kpi label="YoY growth" value={data?.yoyTotals.growthPct != null ? `${data.yoyTotals.growthPct > 0 ? '+' : ''}${data.yoyTotals.growthPct.toFixed(1)}%` : '—'} hint="FY-to-date vs last FY (same months)" loading={isLoading} tone={data && (data.yoyTotals.growthPct ?? 0) >= 0 ? 'emerald' : 'rose'} />
        <Kpi label="Regions" value={data ? String(data.byRegion.length) : '—'} hint="with revenue" loading={isLoading} tone="amber" />
      </div>

      <ReportCard title="This financial year vs last (Apr → Mar)">
        {isLoading ? <div className="bg-muted h-[280px] animate-pulse rounded-lg" /> : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.yoy ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => inrCompact(v)} />
                <Tooltip formatter={(v: number) => inrFull(v)} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar name="Last FY" dataKey="lastYear" fill="#cbd5e1" radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar name="This FY" dataKey="thisYear" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ReportCard>

      <ReportCard title="Monthly billed revenue — last 12 months">
        {isLoading ? <div className="bg-muted h-[280px] animate-pulse rounded-lg" /> : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => inrCompact(v)} />
                <Tooltip formatter={(v: number) => inrFull(v)} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Bar dataKey="billed" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ReportCard>

      <ReportCard title="Seasonality — which months run hot or cold">
        {isLoading ? <div className="bg-muted h-[240px] animate-pulse rounded-lg" /> : (
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.seasonality ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => `${v}×`} />
                <Tooltip formatter={(v: number) => `${v}× average`} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Bar dataKey="index" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {(data?.seasonality ?? []).map((s, i) => <Cell key={i} fill={s.index >= 1 ? '#10b981' : '#f59e0b'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="text-muted-foreground mt-2 text-xs">1× = an average month. Green months beat the average; amber trail it.</p>
      </ReportCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="Revenue by agent">{isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.byAgent ?? []} />}</ReportCard>
        <ReportCard title="Top parties">{isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.topParties ?? []} />}</ReportCard>
        <ReportCard title="Revenue by region">{isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.byRegion ?? []} />}</ReportCard>
        <ReportCard title="Revenue by state">{isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.byState ?? []} />}</ReportCard>
      </div>
    </div>
  );
}
