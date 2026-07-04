import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowRight, ArrowUpRight, ClipboardList, FileText, PackageOpen, TrendingUp } from 'lucide-react';
import type { DashboardKpis, MonthlyOrderVsChallanPoint, PeriodMetric } from '@oms/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useDashboardKpis, useOrderVsChallan } from './use-analytics';
import { BacklogSection } from './backlog-section';
import { InfoTip } from './info-tip';
import { inrCompact, inrFull } from './format';

function DeltaBadge({ metric }: { metric: PeriodMetric }) {
  const { direction, deltaPct } = metric;
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight;
  const tone =
    direction === 'up'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
      : direction === 'down'
        ? 'bg-red-50 text-red-700 ring-red-600/20'
        : 'bg-slate-100 text-slate-600 ring-slate-500/20';
  // No baseline (previous = 0): show "New" when we grew from nothing, else "—".
  const text =
    deltaPct == null
      ? metric.current > 0
        ? 'New'
        : '—'
      : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset', tone)}>
      <Icon className="size-3" />
      {text}
    </span>
  );
}

/** Headline order-value card for one period, comparing against the previous period. */
function PeriodCard({ label, sub, metric, loading, info }: { label: string; sub: string; metric?: PeriodMetric; loading: boolean; info: string }) {
  return (
    <Card className="card-hover gap-0">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-1.5">
        <CardTitle className="text-muted-foreground flex items-center gap-1 text-sm font-medium">
          {label}
          <InfoTip text={info} />
        </CardTitle>
        {metric && <DeltaBadge metric={metric} />}
      </CardHeader>
      <CardContent>
        {loading || !metric ? (
          <div className="bg-muted h-8 w-24 animate-pulse rounded" />
        ) : (
          <div className="text-2xl font-bold tracking-tight tabular-nums" title={inrFull(metric.current)}>
            {inrCompact(metric.current)}
          </div>
        )}
        <p className="text-muted-foreground mt-1 text-xs">
          {sub}
          {metric && !loading ? ` · was ${inrCompact(metric.previous)}` : ''}
        </p>
      </CardContent>
    </Card>
  );
}

type OpTone = 'sky' | 'amber' | 'violet';
const OP_TONE: Record<OpTone, string> = {
  sky: 'bg-gradient-to-br from-sky-400 to-sky-600',
  amber: 'bg-gradient-to-br from-amber-400 to-amber-600',
  violet: 'bg-gradient-to-br from-violet-400 to-violet-600',
};

/** Operational KPI card (challan value / backlog / open orders / order count). */
function OpCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  metric,
  loading,
  info,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof ClipboardList;
  tone: OpTone;
  metric?: PeriodMetric;
  loading: boolean;
  info: string;
}) {
  return (
    <Card className="card-hover gap-0">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-muted-foreground flex items-center gap-1 text-sm font-medium">
          {label}
          <InfoTip text={info} />
        </CardTitle>
        <span className={cn('flex size-9 items-center justify-center rounded-xl text-white shadow-sm', OP_TONE[tone])}>
          <Icon className="size-4.5" />
        </span>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="bg-muted h-8 w-20 animate-pulse rounded" />
        ) : (
          <div className="text-3xl font-bold tracking-tight tabular-nums">{value}</div>
        )}
        <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
          {metric && !loading && <DeltaBadge metric={metric} />}
          {hint && <span>{hint}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: MonthlyOrderVsChallanPoint }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const pct = p.orderValue > 0 ? (p.challanValue / p.orderValue) * 100 : null;
  return (
    <div className="rounded-lg border bg-white/95 px-3 py-2 text-xs shadow-md backdrop-blur">
      <div className="mb-1 font-semibold text-slate-700">{label}</div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-sm bg-blue-500" />
        Ordered: <span className="font-semibold tabular-nums">{inrFull(p.orderValue)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-sm bg-amber-500" />
        Challaned: <span className="font-semibold tabular-nums">{inrFull(p.challanValue)}</span>
      </div>
      {pct != null && <div className="mt-1 text-slate-500">Invoiced {pct.toFixed(0)}% of ordered</div>}
    </div>
  );
}

export function AnalyticsSection() {
  const kpis = useDashboardKpis();
  const chart = useOrderVsChallan(12);
  const k: DashboardKpis | undefined = kpis.data;
  const loading = kpis.isLoading;
  const points = useMemo(() => chart.data?.points ?? [], [chart.data]);

  return (
    <div className="space-y-4">
      {/* Headline: order value by period, each vs the previous equivalent period. */}
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <TrendingUp className="size-4 text-blue-600" />
          Order value
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <PeriodCard label="Today" sub="vs yesterday" metric={k?.orderValue.today} loading={loading} info="Total rupee value of all orders you took today. The coloured badge compares it with yesterday — green is up, red is down." />
          <PeriodCard label="This Week" sub="vs last week" metric={k?.orderValue.week} loading={loading} info="Total value of orders taken since Monday this week, compared with the same stretch of days last week." />
          <PeriodCard label="This Month" sub="vs last month" metric={k?.orderValue.month} loading={loading} info="Total value of all orders placed this calendar month so far, compared with the whole of last month." />
          <PeriodCard label="This FY" sub="vs last FY · Apr–Mar" metric={k?.orderValue.year} loading={loading} info="Total order value for this financial year (April to March), compared with the previous financial year." />
        </div>
      </div>

      {/* Operational KPIs. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <OpCard
          label="Challan Value (MTD)"
          value={k ? inrCompact(k.challanValueMonth.current) : '—'}
          hint="vs last month"
          icon={FileText}
          tone="amber"
          metric={k?.challanValueMonth}
          loading={loading}
          info="MTD = month-to-date. The total value you have billed (created challans / invoices for) so far this month, compared with last month."
        />
        <OpCard
          label="Orders (MTD)"
          value={k ? Math.round(k.ordersCountMonth.current).toLocaleString('en-IN') : '—'}
          hint="vs last month"
          icon={ClipboardList}
          tone="sky"
          metric={k?.ordersCountMonth}
          loading={loading}
          info="How many orders you have taken so far this month, compared with last month."
        />
        <OpCard
          label="To-Challan Backlog"
          value={k ? inrCompact(k.toChallanBacklog) : '—'}
          hint={k ? `${k.toChallanLines} dispatched line${k.toChallanLines === 1 ? '' : 's'} to bill` : undefined}
          icon={PackageOpen}
          tone="violet"
          loading={loading}
          info="Value of goods already dispatched (sent out) but not yet put on a challan / invoice. In short: shipped but still to be billed."
        />
        <OpCard
          label="Pending Parties"
          value={k ? k.openOrders.toLocaleString('en-IN') : '—'}
          hint="customers awaiting dispatch"
          icon={ClipboardList}
          tone="sky"
          loading={loading}
          info="How many different parties (customers) still have at least one order waiting to be dispatched — i.e. not fully shipped and not yet invoiced."
        />
      </div>

      {/* Order fulfilment backlog — what's outstanding + where action is needed. */}
      <BacklogSection />

      {/* Order value vs challan value — last 12 months. */}
      <Card className="card-hover">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
              <TrendingUp className="size-4" />
            </span>
            Order value vs Challan value
            <span className="text-muted-foreground text-xs font-normal">last 12 months</span>
            <InfoTip text="For each of the last 12 months: the blue bars are the total value of orders you took that month, and the amber line is the total value you billed (challaned) that month. Hover any month for exact figures." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chart.isLoading ? (
            <div className="bg-muted h-[320px] animate-pulse rounded-lg" />
          ) : points.length === 0 ? (
            <div className="text-muted-foreground flex h-[320px] items-center justify-center text-sm">No data yet.</div>
          ) : (
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tickFormatter={(v: number) => inrCompact(v)}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                  <Bar name="Ordered" dataKey="orderValue" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={36} />
                  <Line
                    name="Challaned"
                    type="monotone"
                    dataKey="challanValue"
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: '#f59e0b' }}
                    activeDot={{ r: 5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
