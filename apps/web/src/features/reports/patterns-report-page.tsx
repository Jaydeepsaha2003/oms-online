import { Sparkles } from 'lucide-react';
import { initials } from '@/features/crm/crm-shared';
import { Kpi, KpiGrid, RankedBars, ReportCard, ReportDeskHero, ReportHeader, ReportRow, ReportRowList, ReportSummary, type ReportHero } from './report-kit';
import { ReportFilterBar, useReportFilters } from './report-filters';
import { usePatterns } from './use-reports';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export function PatternsReportPage() {
  const filters = useReportFilters();
  const { data, isLoading } = usePatterns(filters.query);
  const loyal = data?.loyalParties[0];

  const hero: ReportHero | undefined = data ? {
    label: 'Reorder rate',
    value: pct(data.reorderRate),
    hint: 'of products get re-ordered by the same party',
    bar: data.reorderRate != null ? { pct: data.reorderRate * 100, label: 'products bought again', tone: 'good' } : undefined,
    stats: [
      { label: 'Repeat parties', value: pct(data.repeatPartyRate), hint: '≥ 2 invoices', dot: '#6ee7b7' },
      { label: 'Avg order gap', value: data.avgOrderGapDays != null ? `${data.avgOrderGapDays} days` : '—', hint: 'between orders', dot: '#7dd3fc' },
      { label: 'Avg basket', value: data.avgBasketItems != null ? `${data.avgBasketItems} items` : '—', hint: 'line-items per order', dot: '#fcd34d' },
      { label: 'Most loyal', value: loyal ? `${loyal.orders} orders` : '—', hint: loyal?.party ?? '—', dot: '#c4b5fd' },
    ],
  } : undefined;

  return (
    <div className="rp-page space-y-5">
      <ReportHeader
        title="Patterns & Insights"
        subtitle="How customers buy and what keeps them coming back."
        icon={Sparkles}
        asOf={data?.asOf}
        hero={data ? { label: 'Reorder rate', value: pct(data.reorderRate), hint: `parties reorder every ${data.avgOrderGapDays ?? '—'} days` } : undefined}
      />

      <ReportFilterBar f={filters.f} setF={filters.setF} active={filters.active} onReset={filters.reset} />

      <ReportDeskHero hero={hero} />

      <ReportSummary
        loading={isLoading}
        points={data ? [
          {
            text: <><strong>{pct(data.repeatPartyRate)}</strong> of parties buy again (≥2 invoices) — repeat business drives the book.</>,
            tone: (data.repeatPartyRate ?? 0) >= 0.5 ? 'good' : 'warn',
            desk: { value: pct(data.repeatPartyRate), text: 'Of parties buy again (2+ invoices). Repeat business drives the book.' },
          },
          {
            text: <><strong>{pct(data.reorderRate)}</strong> of products get re-ordered by the same party.</>,
            tone: 'info',
            desk: { value: pct(data.reorderRate), text: 'Of products are re-ordered by the same party.' },
          },
          {
            text: <>Parties order about every <strong>{data.avgOrderGapDays ?? '—'} days</strong>, <strong>{data.avgBasketItems ?? '—'}</strong> line-items per order.</>,
            tone: 'info',
            desk: { value: data.avgOrderGapDays != null ? `${data.avgOrderGapDays} days` : '—', text: `Typical gap between orders, with ${data.avgBasketItems ?? '—'} line items per order.` },
          },
          {
            text: <>Most loyal: <strong>{loyal?.party ?? '—'}</strong> with <strong>{loyal?.orders ?? 0}</strong> orders.</>,
            tone: 'good',
            desk: { value: `${loyal?.orders ?? 0} orders`, text: `From ${loyal?.party ?? '—'}, your most loyal party.` },
          },
        ] : []}
      />

      {/* The desktop hero carries these four; the phone lists them. */}
      <KpiGrid deskHidden className="gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Reorder rate" value={pct(data?.reorderRate)} hint="products bought again" loading={isLoading} tone="emerald" />
        <Kpi label="Repeat parties" value={pct(data?.repeatPartyRate)} hint="≥ 2 invoices" loading={isLoading} tone="blue" />
        <Kpi label="Avg order gap" value={data?.avgOrderGapDays != null ? `${data.avgOrderGapDays} days` : '—'} hint="between orders" loading={isLoading} tone="violet" />
        <Kpi label="Avg basket" value={data?.avgBasketItems != null ? `${data.avgBasketItems} items` : '—'} hint="line-items per order" loading={isLoading} tone="amber" />
      </KpiGrid>

      <div className="grid gap-[14px] lg:grid-cols-2">
        <ReportCard title="Order frequency">{isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.orderFrequency ?? []} money={false} unit="parties" />}</ReportCard>
        <ReportCard title="Category preference (by orders)">{isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.categoryPreference ?? []} money={false} unit="orders" />}</ReportCard>
      </div>

      <div className="grid gap-[14px] lg:grid-cols-2">
        <ReportCard title="Most re-ordered products">{isLoading ? <div className="bg-muted h-52 animate-pulse rounded-lg" /> : <RankedBars data={data?.topReorderProducts ?? []} money={false} unit="reorders" emptyText="No repeat products yet." />}</ReportCard>

        <ReportCard title="Most loyal parties" flush>
          {isLoading ? <div className="bg-muted m-4 h-64 animate-pulse rounded-lg" /> : !data?.loyalParties.length ? (
            <div className="text-muted-foreground py-8 text-center text-sm">No repeat parties yet.</div>
          ) : (
            <>
              <ReportRowList>
                {data.loyalParties.map((p, i) => (
                  <ReportRow
                    key={`${p.party}-${i}`}
                    i={i}
                    title={p.party}
                    stats={[
                      { label: 'Orders', value: p.orders },
                      { label: 'Avg gap', value: p.avgGapDays != null ? `${p.avgGapDays}d` : '—' },
                      { label: 'Categories', value: p.categories },
                    ]}
                  />
                ))}
              </ReportRowList>
              <div className="hidden max-h-[520px] overflow-auto sm:block">
                <table className="rd-table min-w-[480px]">
                  <thead className="sticky top-0 z-[1]">
                    <tr>
                      <th className="w-10">#</th>
                      <th>Party</th>
                      <th className="text-right">Orders</th>
                      <th className="text-right">Avg gap</th>
                      <th className="text-right">Categories</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.loyalParties.map((p, i) => (
                      <tr key={`${p.party}-${i}`}>
                        <td className="text-[11.5px] font-extrabold text-[#8a94a8] tabular-nums">{String(i + 1).padStart(2, '0')}</td>
                        <td>
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[11px] font-extrabold text-[#3b4fd8] ring-1 ring-indigo-200 ring-inset">{initials(p.party)}</span>
                            <span className="truncate font-bold">{p.party}</span>
                          </span>
                        </td>
                        <td className="num">{p.orders}</td>
                        <td className="num">{p.avgGapDays != null ? `${p.avgGapDays}d` : '—'}</td>
                        <td className="num">{p.categories}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </ReportCard>
      </div>
    </div>
  );
}
