import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Package } from 'lucide-react';
import type { ReportMeasure } from '@oms/shared';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { cn } from '@/lib/utils';
import { RankedBars, ReportCard, ReportDeskHero, ReportDonut, ReportHeader, ReportRow, ReportRowList, ReportSummary, REPORT_COLORS, type Pill, type ReportHero } from './report-kit';
import { ReportFilterBar, useReportFilters } from './report-filters';
import { useProductReport } from './use-reports';

const marginTone = (flag: 'loss' | 'thin' | 'ok') =>
  flag === 'loss' ? 'bg-rose-50 text-rose-700 ring-rose-200' : flag === 'thin' ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200';
const PILL = 'inline-flex items-center rounded-full px-[9px] py-[3px] text-[11.5px] leading-[1.3] font-bold whitespace-nowrap ring-1 ring-inset';
const marginPillTone = (flag: 'loss' | 'thin' | 'ok'): Pill['tone'] => (flag === 'loss' ? 'rose' : flag === 'thin' ? 'amber' : 'emerald');

const MEASURES: { key: ReportMeasure; label: string }[] = [
  { key: 'amount', label: 'Amount' },
  { key: 'bags', label: 'Bags' },
  { key: 'pcs', label: 'Pcs' },
  { key: 'kgs', label: 'Kgs' },
  { key: 'box', label: 'Box' },
];

export function ProductReportPage() {
  const filters = useReportFilters();
  const [measure, setMeasure] = useState<ReportMeasure>('amount');
  const { data, isLoading } = useProductReport(filters.query, measure);
  const cat = data?.categoryMix ?? [];
  const losses = data?.designMargin.filter((d) => d.flag !== 'ok').length ?? 0;
  const isMoney = measure === 'amount';
  const unit = isMoney ? '' : ` ${measure}`;
  const fmt = (v: number) => (isMoney ? inrCompact(v) : `${Math.round(v).toLocaleString('en-IN')}${unit}`);
  const fmtFull = (v: number) => (isMoney ? inrFull(v) : `${Math.round(v).toLocaleString('en-IN')}${unit}`);
  const by = isMoney ? 'billed value' : MEASURES.find((m) => m.key === measure)?.label.toLowerCase();
  const catTotal = cat.reduce((t, c) => t + c.value, 0);
  const catShare = catTotal > 0 && cat[0] ? Math.round((cat[0].value / catTotal) * 100) : null;
  const margins = (data?.designMargin ?? []).filter((d) => d.marginPct != null);
  const avgMargin = margins.length ? margins.reduce((t, d) => t + (d.marginPct ?? 0), 0) / margins.length : null;

  const hero: ReportHero | undefined = data ? {
    label: `Top product by ${by}`,
    value: fmt(data.topProducts[0]?.value ?? 0),
    hint: data.topProducts[0]?.name ?? undefined,
    stats: [
      { label: 'Leading design', value: fmt(data.topDesigns[0]?.value ?? 0), hint: data.topDesigns[0]?.name ?? '—', dot: '#c4b5fd' },
      { label: 'Biggest category', value: fmt(cat[0]?.value ?? 0), hint: cat[0] ? `${cat[0].name}${catShare != null ? ` · ${catShare}% of ${isMoney ? 'revenue' : 'the total'}` : ''}` : '—', dot: '#7dd3fc' },
      { label: 'Avg list margin', value: avgMargin != null ? `${avgMargin.toFixed(1)}%` : '—', hint: 'across all designs', dot: '#6ee7b7' },
      { label: 'To review', value: `${losses} design${losses === 1 ? '' : 's'}`, hint: 'loss or thin margin', dot: '#ff8fab' },
    ],
  } : undefined;

  return (
    <div className="rp-page space-y-5">
      <ReportHeader
        title="Product & Design"
        subtitle="What sells, and what actually makes money."
        icon={Package}
        asOf={data?.asOf}
        hero={data ? { label: `Top ${by}`, value: fmt(data.topProducts[0]?.value ?? 0), hint: data.topProducts[0]?.name ?? undefined } : undefined}
      />

      <ReportFilterBar f={filters.f} setF={filters.setF} active={filters.active} onReset={filters.reset} />

      <ReportDeskHero hero={hero} />

      {/* Measure slicer — analyse the same products by amount / bags / pcs / kgs / box. */}
      <div className="rp-seg rp-noscroll sm:hidden">
        {MEASURES.map((m) => (
          <button key={m.key} type="button" className="rp-seg-btn" data-on={measure === m.key} onClick={() => setMeasure(m.key)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="hidden flex-wrap items-center gap-2.5 sm:flex">
        <span className="rd-asof">Measure by</span>
        <div className="rd-seg rd-seg-sm" role="tablist">
          {MEASURES.map((m) => (
            <button key={m.key} type="button" role="tab" aria-selected={measure === m.key} data-on={measure === m.key} className="rd-seg-btn" onClick={() => setMeasure(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <ReportSummary
        loading={isLoading}
        points={data ? [
          {
            text: <>Top {by} is <strong>{data.topProducts[0]?.name ?? '—'}</strong> at <strong>{fmt(data.topProducts[0]?.value ?? 0)}</strong>.</>,
            tone: 'good',
            desk: { value: fmt(data.topProducts[0]?.value ?? 0), text: `${isMoney ? 'Billed on' : 'Moved on'} ${data.topProducts[0]?.name ?? '—'}, your top product.` },
          },
          {
            text: <>Leading design is <strong>{data.topDesigns[0]?.name ?? '—'}</strong> ({fmt(data.topDesigns[0]?.value ?? 0)}).</>,
            tone: 'info',
            desk: { value: data.topDesigns[0]?.name ?? '—', text: `Leading design finish, at ${fmt(data.topDesigns[0]?.value ?? 0)}.` },
          },
          {
            text: <>Biggest category is <strong>{cat[0]?.name ?? '—'}</strong> with <strong>{fmt(cat[0]?.value ?? 0)}</strong>.</>,
            tone: 'info',
            desk: { value: cat[0]?.name ?? '—', text: `Biggest category, at ${fmt(cat[0]?.value ?? 0)}${catShare != null ? ` (${catShare}% of ${isMoney ? 'revenue' : 'the total'})` : ''}.` },
          },
          {
            text: <><strong>{losses}</strong> designs are priced at a loss or thin margin — review their pricing.</>,
            tone: losses > 0 ? 'bad' : 'good',
            desk: { value: `${losses} design${losses === 1 ? '' : 's'}`, text: losses > 0 ? 'Priced at a loss or a thin margin. Review their pricing.' : 'Every design is priced with a healthy margin.' },
          },
        ] : []}
      />

      <div className="grid gap-[14px] lg:grid-cols-2">
        <ReportCard title={`Top products (by ${by})`}>{isLoading ? <div className="bg-muted h-64 animate-pulse rounded-lg" /> : <RankedBars data={data?.topProducts ?? []} money={isMoney} />}</ReportCard>
        <ReportCard title={`Top designs (by ${by})`}>{isLoading ? <div className="bg-muted h-64 animate-pulse rounded-lg" /> : <RankedBars data={data?.topDesigns ?? []} money={isMoney} emptyText="No design breakdown." />}</ReportCard>
      </div>

      <div className="grid gap-[14px] lg:grid-cols-2">
      <ReportCard title={`${isMoney ? 'Revenue' : MEASURES.find((m) => m.key === measure)?.label} by category`}>
        {isLoading ? <div className="bg-muted h-64 animate-pulse rounded-lg" /> : (
          <>
          <div className="hidden sm:block"><ReportDonut data={cat.slice(0, 8)} money={isMoney} /></div>
          <div className="flex flex-col items-center gap-4 sm:hidden">
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={cat} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={88} paddingAngle={2}>
                    {cat.map((_, i) => <Cell key={i} fill={REPORT_COLORS[i % REPORT_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtFull(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-full"><RankedBars data={cat.slice(0, 6)} money={isMoney} /></div>
          </div>
          </>
        )}
      </ReportCard>

      <ReportCard title="Average margin by category" right="list-price margin">
        {isLoading ? <div className="bg-muted h-40 animate-pulse rounded-lg" /> : (
          <>
            {/* Phone: the name carries the %, as its mockup writes it. */}
            <div className="sm:hidden">
              <RankedBars
                data={(data?.marginByCategory ?? []).map((m) => ({ name: `${m.name} · ${m.value}%`, value: m.value }))}
                money={false}
                subFor={(d) => `${d.value}% of list price`}
              />
            </div>
            <div className="hidden sm:block">
              <RankedBars data={data?.marginByCategory ?? []} money={false} unit="of list price" format={(v) => `${v}%`} />
            </div>
          </>
        )}
      </ReportCard>
      </div>

      <ReportCard note="Margin is list-price (rate − cost) per design. It flags mispriced designs, not realised profit on sales." title="Design margins, worst priced first" right={losses > 0 ? <span className={cn(PILL, 'bg-rose-50 text-rose-700 ring-rose-200')}>{losses} to review</span> : undefined} flush>
        {isLoading ? <div className="bg-muted h-64 animate-pulse rounded-lg" /> : (
          <>
            <ReportRowList emptyText="No design pricing yet.">
              {(data?.designMargin ?? []).map((d, i) => (
                <ReportRow
                  key={`${d.design}-${i}`}
                  i={i}
                  title={d.design}
                  sub={d.category}
                  pills={[{ text: d.marginPct != null ? `${d.marginPct}%` : '—', tone: marginPillTone(d.flag) }]}
                  stats={[
                    { label: 'Cost', value: `₹${d.cost.toLocaleString('en-IN')}` },
                    { label: 'Rate', value: `₹${d.rate.toLocaleString('en-IN')}` },
                    { label: 'Margin', value: `₹${d.unitMargin.toLocaleString('en-IN')}`, tone: d.unitMargin < 0 ? 'bad' : undefined },
                  ]}
                />
              ))}
            </ReportRowList>
          <div className="hidden max-h-[520px] overflow-auto sm:block">
            <table className="rd-table min-w-[600px]">
              <thead className="sticky top-0 z-[1]">
                <tr>
                  <th>Design</th>
                  <th>Category</th>
                  <th className="text-right">Cost</th>
                  <th className="text-right">Rate</th>
                  <th className="text-right">Margin</th>
                  <th className="text-right">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {(data?.designMargin ?? []).map((d, i) => (
                  <tr key={`${d.design}-${i}`}>
                    <td className="font-bold">{d.design}</td>
                    <td className="text-[#5b6479] dark:text-[#93a6c9]">{d.category}</td>
                    <td className="num font-semibold">₹{d.cost.toLocaleString('en-IN')}</td>
                    <td className="num font-semibold">₹{d.rate.toLocaleString('en-IN')}</td>
                    <td className={cn('num', d.unitMargin < 0 && 'text-rose-700 dark:text-rose-400')}>₹{d.unitMargin.toLocaleString('en-IN')}</td>
                    <td className="text-right"><span className={cn(PILL, marginTone(d.flag))}>{d.marginPct != null ? `${d.marginPct}%` : '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </ReportCard>
    </div>
  );
}
