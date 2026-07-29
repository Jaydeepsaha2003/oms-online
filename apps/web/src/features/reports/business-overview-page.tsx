import { useMemo } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Banknote, HandCoins, LayoutDashboard, Package, PieChart as PieIcon, ReceiptText, ScrollText, Timer, TrendingUp, Users, Wallet } from 'lucide-react';
import type { ReportMonthPoint } from '@oms/shared';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { Kpi, RankedBars, ReportCard, ReportHeader, ReportSummary, REPORT_COLORS } from './report-kit';
import { useBusinessOverview } from './use-reports';

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: ReportMonthPoint }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const rate = p.billed > 0 ? (p.collected / p.billed) * 100 : null;
  return (
    <div className="rounded-lg border bg-white/95 px-3 py-2 text-xs shadow-md backdrop-blur">
      <div className="mb-1 font-semibold text-slate-700">{label}</div>
      <div className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-blue-500" />Billed: <span className="font-semibold tabular-nums">{inrFull(p.billed)}</span></div>
      <div className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-emerald-500" />Collected: <span className="font-semibold tabular-nums">{inrFull(p.collected)}</span></div>
      {rate != null && <div className="mt-1 text-slate-500">Collected {rate.toFixed(0)}% of billed</div>}
    </div>
  );
}

export function BusinessOverviewPage() {
  const { data, isLoading } = useBusinessOverview();
  const trend = useMemo(() => data?.trend ?? [], [data]);
  const catMix = useMemo(() => data?.categoryMix ?? [], [data]);
  const money = (v?: number) => (v == null ? '—' : inrCompact(v));

  return (
    <div className="space-y-5">
      <ReportHeader
        title="Business Overview"
        subtitle="Your whole business in one screen — revenue, collections, receivables and where they come from."
        icon={LayoutDashboard}
        asOf={data?.asOf}
      />

      <ReportSummary
        loading={isLoading}
        points={data ? [
          { text: <>Revenue this FY is <strong>{inrCompact(data.revenue.current)}</strong>{data.revenue.deltaPct != null && <>, {data.revenue.deltaPct >= 0 ? 'up' : 'down'} <strong>{Math.abs(data.revenue.deltaPct).toFixed(0)}%</strong> vs last FY</>}.</>, tone: data.revenue.direction === 'down' ? 'warn' : 'good' },
          { text: <>You've collected <strong>{data.collectionRate != null ? Math.round(data.collectionRate * 100) : '—'}%</strong> of what you billed this FY.</>, tone: (data.collectionRate ?? 0) >= 0.8 ? 'good' : 'warn' },
          { text: <>Outstanding receivable is <strong>{inrCompact(data.outstanding)}</strong>, roughly <strong>{data.dsoDays ?? '—'} days</strong> of sales (DSO).</>, tone: 'info' },
          { text: <><strong>{data.topParties[0]?.name ?? '—'}</strong> is your biggest party at <strong>{inrCompact(data.topParties[0]?.value ?? 0)}</strong> this FY.</>, tone: 'info' },
          { text: <><strong>{inrCompact(data.backlogValue)}</strong> is dispatched but not yet billed.</>, tone: data.backlogValue > 0 ? 'warn' : 'good' },
          { text: <>Avg invoice <strong>{inrCompact(data.avgInvoiceValue)}</strong> across <strong>{data.activeParties}</strong> active parties.</>, tone: 'info' },
        ] : []}
      />

      {/* Headline money KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Revenue (FY)" value={money(data?.revenue.current)} title={data ? inrFull(data.revenue.current) : undefined} hint="vs last FY" icon={TrendingUp} tone="blue" metric={data?.revenue} loading={isLoading} />
        <Kpi label="Collections (FY)" value={money(data?.collections.current)} title={data ? inrFull(data.collections.current) : undefined} hint="vs last FY" icon={HandCoins} tone="emerald" metric={data?.collections} loading={isLoading} />
        <Kpi label="Outstanding" value={money(data?.outstanding)} title={data ? inrFull(data.outstanding) : undefined} hint="net receivable" icon={Wallet} tone="rose" loading={isLoading} />
        <Kpi label="To-bill backlog" value={money(data?.backlogValue)} title={data ? inrFull(data.backlogValue) : undefined} hint="dispatched, not challaned" icon={Package} tone="violet" loading={isLoading} />
      </div>

      {/* Operational + efficiency KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Orders (FY)" value={data ? Math.round(data.orders?.current ?? 0).toLocaleString('en-IN') : '—'} hint="vs last FY" icon={ReceiptText} tone="blue" metric={data?.orders} loading={isLoading} />
        <Kpi label="Challans (FY)" value={data ? Math.round(data.challans?.current ?? 0).toLocaleString('en-IN') : '—'} hint="vs last FY" icon={ScrollText} tone="amber" metric={data?.challans} loading={isLoading} />
        <Kpi label="Collection rate" value={data?.collectionRate != null ? `${Math.round(data.collectionRate * 100)}%` : '—'} hint="collected ÷ billed (FY)" icon={Banknote} tone="emerald" loading={isLoading} />
        <Kpi label="DSO" value={data?.dsoDays != null ? `${data.dsoDays} days` : '—'} hint="days sales outstanding" icon={Timer} tone="slate" loading={isLoading} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Avg invoice value" value={money(data?.avgInvoiceValue)} title={data ? inrFull(data.avgInvoiceValue) : undefined} hint="per challan (FY)" icon={ReceiptText} tone="blue" loading={isLoading} />
        <Kpi label="Active parties" value={data ? (data.activeParties ?? 0).toLocaleString('en-IN') : '—'} hint="billed this FY" icon={Users} tone="violet" loading={isLoading} />
        <div className="sm:col-span-2">
          <ReportCard title="Collections by mode (FY)">
            {isLoading ? <div className="bg-muted h-16 animate-pulse rounded" /> : <RankedBars data={data?.collectionModes ?? []} emptyText="No receipts this FY." />}
          </ReportCard>
        </div>
      </div>

      {/* Billed vs collected trend */}
      <ReportCard title="Billed vs Collected — last 12 months">
        {isLoading ? (
          <div className="bg-muted h-[300px] animate-pulse rounded-lg" />
        ) : trend.length === 0 ? (
          <div className="text-muted-foreground flex h-[300px] items-center justify-center text-sm">No data yet.</div>
        ) : (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => inrCompact(v)} />
                <Tooltip content={<TrendTooltip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar name="Billed" dataKey="billed" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={34} />
                <Line name="Collected" type="monotone" dataKey="collected" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </ReportCard>

      {/* Category mix + top parties */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="Revenue by category (FY)">
          {isLoading ? (
            <div className="bg-muted h-[280px] animate-pulse rounded-lg" />
          ) : catMix.length === 0 ? (
            <div className="text-muted-foreground flex h-[280px] items-center justify-center text-sm">No data yet.</div>
          ) : (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="h-[220px] w-full sm:w-1/2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={catMix} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={88} paddingAngle={2}>
                      {catMix.map((_, i) => <Cell key={i} fill={REPORT_COLORS[i % REPORT_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => inrFull(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full sm:w-1/2">
                <RankedBars data={catMix.slice(0, 6)} />
              </div>
            </div>
          )}
        </ReportCard>

        <ReportCard title="Top parties by revenue (FY)">
          {isLoading ? <div className="bg-muted h-[280px] animate-pulse rounded-lg" /> : <RankedBars data={data?.topParties.slice(0, 8) ?? []} />}
        </ReportCard>
      </div>

      {/* Region + agent */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="Revenue by region (FY)">
          {isLoading ? <div className="bg-muted h-[240px] animate-pulse rounded-lg" /> : <RankedBars data={data?.byRegion.slice(0, 8) ?? []} />}
        </ReportCard>
        <ReportCard title="Revenue by agent (FY)" right={<PieIcon className="text-muted-foreground size-4" />}>
          {isLoading ? <div className="bg-muted h-[240px] animate-pulse rounded-lg" /> : <RankedBars data={data?.byAgent.slice(0, 8) ?? []} />}
        </ReportCard>
      </div>
    </div>
  );
}
