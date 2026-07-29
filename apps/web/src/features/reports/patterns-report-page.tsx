import { Sparkles } from 'lucide-react';
import { Kpi, RankedBars, ReportCard, ReportHeader, ReportSummary } from './report-kit';
import { ReportFilterBar, useReportFilters } from './report-filters';
import { usePatterns } from './use-reports';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export function PatternsReportPage() {
  const filters = useReportFilters();
  const { data, isLoading } = usePatterns(filters.query);

  return (
    <div className="space-y-5">
      <ReportHeader title="Patterns & Insights" subtitle="How customers buy and what keeps them coming back." icon={Sparkles} asOf={data?.asOf} />

      <ReportFilterBar f={filters.f} setF={filters.setF} active={filters.active} onReset={filters.reset} />

      <ReportSummary
        loading={isLoading}
        points={data ? [
          { text: <><strong>{pct(data.repeatPartyRate)}</strong> of parties buy again (≥2 invoices) — repeat business drives the book.</>, tone: (data.repeatPartyRate ?? 0) >= 0.5 ? 'good' : 'warn' },
          { text: <><strong>{pct(data.reorderRate)}</strong> of products get re-ordered by the same party.</>, tone: 'info' },
          { text: <>Parties order about every <strong>{data.avgOrderGapDays ?? '—'} days</strong>, <strong>{data.avgBasketItems ?? '—'}</strong> line-items per order.</>, tone: 'info' },
          { text: <>Most loyal: <strong>{data.loyalParties[0]?.party ?? '—'}</strong> with <strong>{data.loyalParties[0]?.orders ?? 0}</strong> orders.</>, tone: 'good' },
        ] : []}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Reorder rate" value={pct(data?.reorderRate)} hint="products bought again" loading={isLoading} tone="emerald" />
        <Kpi label="Repeat parties" value={pct(data?.repeatPartyRate)} hint="≥ 2 invoices" loading={isLoading} tone="blue" />
        <Kpi label="Avg order gap" value={data?.avgOrderGapDays != null ? `${data.avgOrderGapDays} days` : '—'} hint="between orders" loading={isLoading} tone="violet" />
        <Kpi label="Avg basket" value={data?.avgBasketItems != null ? `${data.avgBasketItems} items` : '—'} hint="line-items per order" loading={isLoading} tone="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="Order frequency (parties)">{isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.orderFrequency ?? []} money={false} />}</ReportCard>
        <ReportCard title="Category preference (by orders)">{isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.categoryPreference ?? []} money={false} />}</ReportCard>
      </div>

      <ReportCard title="Most re-ordered products">{isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.topReorderProducts ?? []} money={false} emptyText="No repeat products yet." />}</ReportCard>

      <ReportCard title="Most loyal parties">
        {isLoading ? <div className="bg-muted h-64 animate-pulse rounded-lg" /> : !data?.loyalParties.length ? (
          <div className="text-muted-foreground py-8 text-center text-sm">No repeat parties yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs uppercase tracking-wide">
                  <th className="py-2 pr-3 font-semibold">Party</th>
                  <th className="py-2 pr-3 text-right font-semibold">Orders</th>
                  <th className="py-2 pr-3 text-right font-semibold">Avg gap</th>
                  <th className="py-2 pr-3 text-right font-semibold">Categories</th>
                </tr>
              </thead>
              <tbody>
                {data.loyalParties.map((p, i) => (
                  <tr key={`${p.party}-${i}`} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{p.party}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{p.orders}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{p.avgGapDays != null ? `${p.avgGapDays}d` : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{p.categories}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportCard>
    </div>
  );
}
