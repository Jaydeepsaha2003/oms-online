import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Package } from 'lucide-react';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { cn } from '@/lib/utils';
import { RankedBars, ReportCard, ReportHeader, ReportSummary, REPORT_COLORS } from './report-kit';
import { useProductReport } from './use-reports';

const marginTone = (flag: 'loss' | 'thin' | 'ok') =>
  flag === 'loss' ? 'bg-red-50 text-red-700 ring-red-600/20' : flag === 'thin' ? 'bg-amber-50 text-amber-700 ring-amber-600/20' : 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';

export function ProductReportPage() {
  const { data, isLoading } = useProductReport();
  const cat = data?.categoryMix ?? [];
  const losses = data?.designMargin.filter((d) => d.flag !== 'ok').length ?? 0;

  return (
    <div className="space-y-5">
      <ReportHeader title="Product & Design" subtitle="What sells, and what actually makes money." icon={Package} asOf={data?.asOf} />

      <ReportSummary
        loading={isLoading}
        points={data ? [
          { text: <>Best seller is <strong>{data.topProducts[0]?.name ?? '—'}</strong> at <strong>{inrCompact(data.topProducts[0]?.value ?? 0)}</strong>.</>, tone: 'good' },
          { text: <>Top design is <strong>{data.topDesigns[0]?.name ?? '—'}</strong> ({inrCompact(data.topDesigns[0]?.value ?? 0)}).</>, tone: 'info' },
          { text: <>Biggest category is <strong>{cat[0]?.name ?? '—'}</strong> with <strong>{inrCompact(cat[0]?.value ?? 0)}</strong>.</>, tone: 'info' },
          { text: <><strong>{losses}</strong> designs are priced at a loss or thin margin — review their pricing.</>, tone: losses > 0 ? 'bad' : 'good' },
        ] : []}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="Top products (by billed value)">{isLoading ? <div className="bg-muted h-64 animate-pulse rounded-lg" /> : <RankedBars data={data?.topProducts ?? []} />}</ReportCard>
        <ReportCard title="Top designs (by billed value)">{isLoading ? <div className="bg-muted h-64 animate-pulse rounded-lg" /> : <RankedBars data={data?.topDesigns ?? []} emptyText="No design breakdown." />}</ReportCard>
      </div>

      <ReportCard title="Revenue by category">
        {isLoading ? <div className="bg-muted h-64 animate-pulse rounded-lg" /> : (
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="h-[220px] w-full sm:w-1/2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={cat} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={88} paddingAngle={2}>
                    {cat.map((_, i) => <Cell key={i} fill={REPORT_COLORS[i % REPORT_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => inrFull(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-full sm:w-1/2"><RankedBars data={cat.slice(0, 6)} /></div>
          </div>
        )}
      </ReportCard>

      <ReportCard title="Average margin by category" right={<span className="text-muted-foreground text-xs">list-price margin</span>}>
        {isLoading ? <div className="bg-muted h-40 animate-pulse rounded-lg" /> : <RankedBars data={(data?.marginByCategory ?? []).map((m) => ({ name: `${m.name} · ${m.value}%`, value: m.value }))} money={false} />}
      </ReportCard>

      <ReportCard title="Design margins — worst priced first" right={losses > 0 ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-600/20">{losses} to review</span> : undefined}>
        {isLoading ? <div className="bg-muted h-64 animate-pulse rounded-lg" /> : (
          <div className="max-h-[440px] overflow-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-card sticky top-0">
                <tr className="text-muted-foreground border-b text-left text-xs uppercase tracking-wide">
                  <th className="py-2 pr-3 font-semibold">Design</th>
                  <th className="py-2 pr-3 font-semibold">Category</th>
                  <th className="py-2 pr-3 text-right font-semibold">Cost</th>
                  <th className="py-2 pr-3 text-right font-semibold">Rate</th>
                  <th className="py-2 pr-3 text-right font-semibold">Margin</th>
                  <th className="py-2 pr-3 text-right font-semibold">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {(data?.designMargin ?? []).map((d, i) => (
                  <tr key={`${d.design}-${i}`} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{d.design}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{d.category}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">₹{d.cost.toLocaleString('en-IN')}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">₹{d.rate.toLocaleString('en-IN')}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">₹{d.unitMargin.toLocaleString('en-IN')}</td>
                    <td className="py-2 pr-3 text-right"><span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', marginTone(d.flag))}>{d.marginPct != null ? `${d.marginPct}%` : '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted-foreground mt-2 text-xs">Margin is list-price (rate − cost) per design — it flags mispriced designs, not realised profit on sales.</p>
      </ReportCard>
    </div>
  );
}
