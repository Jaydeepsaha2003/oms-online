import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Boxes } from 'lucide-react';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { Kpi, KpiGrid, RankedBars, ReportCard, ReportFunnel, ReportHeader, ReportSummary } from './report-kit';
import { ReportFilterBar, useReportFilters } from './report-filters';
import { useFulfilment } from './use-reports';

/** Ordered → dispatched → billed, each its own gradient (mockup's funnel). */
const FUNNEL_TONES: [string, string][] = [['#60a5fa', '#1d4ed8'], ['#a78bfa', '#6d28d9'], ['#34d399', '#047857']];

const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

export function FulfilmentReportPage() {
  const filters = useReportFilters();
  const { data, isLoading } = useFulfilment(filters.query);

  return (
    <div className="rp-page space-y-5">
      <ReportHeader
        title="Orders & Fulfilment"
        subtitle="Where the operational friction is — cancellations, partial dispatch, lead time and backlog."
        icon={Boxes}
        asOf={data?.asOf}
        hero={data ? { label: 'Open orders', value: (data.pendingOrders ?? 0).toLocaleString('en-IN'), hint: `${data.urgentOpen ?? 0} urgent · ${data.avgLeadDays ?? '—'}d avg lead` } : undefined}
      />

      <ReportFilterBar f={filters.f} setF={filters.setF} active={filters.active} onReset={filters.reset} />

      <ReportSummary
        loading={isLoading}
        points={data ? [
          { text: <><strong>{pct(data.cancellationRate)}</strong> of orders get cancelled ({data.cancelledOrders} of {data.totalOrders}).</>, tone: (data.cancellationRate ?? 0) > 0.1 ? 'bad' : 'good' },
          { text: <>Average lead time is <strong>{data.avgLeadDays ?? '—'} days</strong> from order to completion.</>, tone: 'info' },
          { text: <><strong>{data.pendingOrders}</strong> orders are still open, <strong>{data.urgentOpen}</strong> of them marked urgent.</>, tone: data.urgentOpen > 0 ? 'warn' : 'info' },
          ...((data.funnel?.length ?? 0) === 3 ? [{ text: <>Selected-period value: <strong>{inrCompact(data.funnel[0]?.value ?? 0)}</strong> ordered, <strong>{inrCompact(data.funnel[1]?.value ?? 0)}</strong> dispatched and <strong>{inrCompact(data.funnel[2]?.value ?? 0)}</strong> billed.</>, tone: 'info' as const }] : []),
        ] : []}
      />

      <KpiGrid className="gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Cancellation rate" value={pct(data?.cancellationRate)} hint={data ? `${data.cancelledOrders} of ${data.totalOrders}` : undefined} loading={isLoading} tone="rose" />
        <Kpi label="Partial dispatch" value={pct(data?.partialRate)} hint={data ? `${data.partialRows} of ${data.dispatchRows} rows` : undefined} loading={isLoading} tone="amber" />
        <Kpi label="Avg lead time" value={data?.avgLeadDays != null ? `${data.avgLeadDays} days` : '—'} hint="order → completion" loading={isLoading} tone="blue" />
        <Kpi label="Pending orders" value={data ? (data.pendingOrders ?? 0).toLocaleString('en-IN') : '—'} hint={data ? `${data.urgentOpen ?? 0} urgent` : undefined} loading={isLoading} tone="violet" />
      </KpiGrid>

      <ReportCard
        title="Selected-period value — ordered, dispatched and billed"
        right="ordered → dispatched → billed"
        note="Each stage uses its own natural date in the selected period. Values are not treated as one linked order cohort."
      >
        {isLoading ? <div className="bg-muted h-40 animate-pulse rounded-lg" /> : (
          <>
            {/* Phones: the mockup's fat proportional funnel. Desktop keeps the
                ranked bars, which read better beside the other charts there. */}
            <div className="sm:hidden">
              <ReportFunnel
                steps={(data?.funnel ?? []).map((f, i) => ({
                  label: f.stage,
                  value: inrCompact(f.value),
                  ratio: (data?.funnel?.[0]?.value ?? 0) > 0 ? f.value / data!.funnel[0].value : 0,
                  from: FUNNEL_TONES[i % FUNNEL_TONES.length][0],
                  to: FUNNEL_TONES[i % FUNNEL_TONES.length][1],
                }))}
              />
            </div>
            <div className="hidden sm:block">
              <RankedBars data={(data?.funnel ?? []).map((f) => ({ name: f.stage, value: f.value }))} />
            </div>
          </>
        )}
      </ReportCard>

      <ReportCard title="Open-order backlog by age" note="Value of undispatched quantity, bucketed by how long the order has been open.">
        {isLoading ? <div className="bg-muted h-[280px] animate-pulse rounded-lg" /> : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.aging ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => inrCompact(v)} />
                <Tooltip formatter={(v: number, _n, p) => [inrFull(v), `${p.payload.orders} orders`]} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={64} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ReportCard>

      <ReportCard title="Cancellations by party">
        {isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.cancellationByParty ?? []} money={false} emptyText="No cancellations." />}
      </ReportCard>
    </div>
  );
}
