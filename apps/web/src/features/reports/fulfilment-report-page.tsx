import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Boxes } from 'lucide-react';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { BAR_RADIUS, CHART_GRID, CHART_TICK, Kpi, KpiGrid, RankedBars, ReportCard, ReportDeskHero, ReportFunnel, ReportHeader, ReportSummary, type ReportHero } from './report-kit';
import { ReportFilterBar, useReportFilters } from './report-filters';
import { useFulfilment } from './use-reports';

/** Ordered → dispatched → billed, each its own gradient (mockup's funnel). */
const FUNNEL_TONES: [string, string][] = [['#60a5fa', '#1d4ed8'], ['#a78bfa', '#6d28d9'], ['#34d399', '#047857']];

const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

export function FulfilmentReportPage() {
  const filters = useReportFilters();
  const { data, isLoading } = useFulfilment(filters.query);
  const backlog = (data?.aging ?? []).reduce((t, a) => t + a.value, 0);
  const funnel = data?.funnel ?? [];
  const billedShare = funnel.length === 3 && funnel[0].value > 0 ? funnel[2].value / funnel[0].value : null;

  const hero: ReportHero | undefined = data ? {
    label: 'Open orders',
    value: (data.pendingOrders ?? 0).toLocaleString('en-IN'),
    hint: data.avgLeadDays != null ? `${data.avgLeadDays} days average lead time, order to completion` : undefined,
    chip: data.urgentOpen > 0 ? { text: `${data.urgentOpen} urgent`, tone: 'bad' } : undefined,
    stats: [
      { label: 'Cancellation rate', value: pct(data.cancellationRate), hint: `${data.cancelledOrders} of ${data.totalOrders.toLocaleString('en-IN')} orders`, dot: '#ff8fab' },
      { label: 'Partial dispatch', value: pct(data.partialRate), hint: `${data.partialRows} of ${data.dispatchRows.toLocaleString('en-IN')} rows`, dot: '#fcd34d' },
      { label: 'Avg lead time', value: data.avgLeadDays != null ? `${data.avgLeadDays} days` : '—', hint: 'order → completion', dot: '#7dd3fc' },
      { label: 'Backlog value', value: inrCompact(backlog), hint: 'undispatched quantity', dot: '#c4b5fd' },
    ],
  } : undefined;

  return (
    <div className="rp-page space-y-5">
      <ReportHeader
        title="Orders & Fulfilment"
        subtitle="Where the operational friction is: cancellations, partial dispatch, lead time and backlog."
        icon={Boxes}
        asOf={data?.asOf}
        hero={data ? { label: 'Open orders', value: (data.pendingOrders ?? 0).toLocaleString('en-IN'), hint: `${data.urgentOpen ?? 0} urgent · ${data.avgLeadDays ?? '—'}d avg lead` } : undefined}
      />

      <ReportFilterBar f={filters.f} setF={filters.setF} active={filters.active} onReset={filters.reset} />

      <ReportDeskHero hero={hero} />

      <ReportSummary
        loading={isLoading}
        points={data ? [
          {
            text: <><strong>{pct(data.cancellationRate)}</strong> of orders get cancelled ({data.cancelledOrders} of {data.totalOrders}).</>,
            tone: (data.cancellationRate ?? 0) > 0.1 ? 'bad' : 'good',
            desk: { value: pct(data.cancellationRate), text: `Of orders get cancelled (${data.cancelledOrders} of ${data.totalOrders.toLocaleString('en-IN')}).` },
          },
          {
            text: <>Average lead time is <strong>{data.avgLeadDays ?? '—'} days</strong> from order to completion.</>,
            tone: 'info',
            desk: { value: data.avgLeadDays != null ? `${data.avgLeadDays} days` : '—', text: 'Average time from order to completion.' },
          },
          {
            text: <><strong>{data.pendingOrders}</strong> orders are still open, <strong>{data.urgentOpen}</strong> of them marked urgent.</>,
            tone: data.urgentOpen > 0 ? 'warn' : 'info',
            desk: { value: `${data.pendingOrders} open`, text: `Orders still open, ${data.urgentOpen} of them marked urgent.` },
          },
          ...(funnel.length === 3 ? [{
            text: <>Selected-period value: <strong>{inrCompact(funnel[0]?.value ?? 0)}</strong> ordered, <strong>{inrCompact(funnel[1]?.value ?? 0)}</strong> dispatched and <strong>{inrCompact(funnel[2]?.value ?? 0)}</strong> billed.</>,
            tone: 'info' as const,
            desk: {
              value: billedShare != null ? `${Math.round(billedShare * 100)}%` : '—',
              text: `Of the ${inrCompact(funnel[0].value)} ordered has been billed. ${inrCompact(funnel[1].value)} has been dispatched.`,
            },
          }] : []),
        ] : []}
      />

      {/* The desktop hero carries these four; the phone lists them. */}
      <KpiGrid deskHidden className="gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Cancellation rate" value={pct(data?.cancellationRate)} hint={data ? `${data.cancelledOrders} of ${data.totalOrders}` : undefined} loading={isLoading} tone="rose" />
        <Kpi label="Partial dispatch" value={pct(data?.partialRate)} hint={data ? `${data.partialRows} of ${data.dispatchRows} rows` : undefined} loading={isLoading} tone="amber" />
        <Kpi label="Avg lead time" value={data?.avgLeadDays != null ? `${data.avgLeadDays} days` : '—'} hint="order → completion" loading={isLoading} tone="blue" />
        <Kpi label="Pending orders" value={data ? (data.pendingOrders ?? 0).toLocaleString('en-IN') : '—'} hint={data ? `${data.urgentOpen ?? 0} urgent` : undefined} loading={isLoading} tone="violet" />
      </KpiGrid>

      <div className="grid gap-[14px] lg:grid-cols-2">
        <ReportCard
          title="Ordered, dispatched and billed"
          note="Each stage uses its own natural date in the selected period. Values are not treated as one linked order cohort."
        >
          {isLoading ? <div className="bg-muted h-40 animate-pulse rounded-lg" /> : (
            <ReportFunnel
              steps={funnel.map((f, i) => ({
                label: f.stage,
                value: inrCompact(f.value),
                ratio: (funnel[0]?.value ?? 0) > 0 ? f.value / funnel[0].value : 0,
                from: FUNNEL_TONES[i % FUNNEL_TONES.length][0],
                to: FUNNEL_TONES[i % FUNNEL_TONES.length][1],
              }))}
            />
          )}
        </ReportCard>

        <ReportCard title="Open-order backlog by age" note="Value of undispatched quantity, bucketed by how long the order has been open.">
          {isLoading ? <div className="bg-muted h-[220px] animate-pulse rounded-lg" /> : (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.aging ?? []} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
                  <defs>
                    <linearGradient id="backlog-age" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#7c3aed" /></linearGradient>
                  </defs>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="label" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: '#dfe4ee' }} />
                  <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => inrCompact(v)} />
                  <Tooltip formatter={(v: number, _n, p) => [inrFull(v), `${p.payload.orders} orders`]} cursor={{ fill: 'rgba(79,110,247,0.06)' }} />
                  <Bar dataKey="value" fill="url(#backlog-age)" radius={BAR_RADIUS} maxBarSize={56} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ReportCard>
      </div>

      <ReportCard title="Cancellations by party" right={data ? `${data.cancelledOrders} cancelled orders` : undefined}>
        {isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.cancellationByParty ?? []} money={false} emptyText="No cancellations." unit="orders" cols={2} />}
      </ReportCard>
    </div>
  );
}
