import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Banknote, CircleDollarSign, Gauge, Lightbulb, ReceiptText } from 'lucide-react';
import type { SummaryActionCategory, SummaryActionPriority } from '@oms/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { Kpi, KpiGrid, ReportCard, ReportHeader, ReportPill, ReportSeg, ReportSummary } from './report-kit';
import { ReportFilterBar, useReportFilters } from './report-filters';
import { useSummaryAnalysis } from './use-reports';

const CATEGORIES: Array<'All' | SummaryActionCategory> = ['All', 'Cash', 'Sales', 'Margin', 'Customers', 'Operations'];
const PRIORITY_TONE: Record<SummaryActionPriority, string> = {
  'Do today': 'bg-rose-50 text-rose-700 ring-rose-600/20',
  'This week': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  Watch: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

export function SummaryAnalysisPage() {
  const navigate = useNavigate();
  const filters = useReportFilters();
  const { data, isLoading } = useSummaryAnalysis(filters.query);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All');
  const actions = useMemo(() => data?.actions.filter((a) => category === 'All' || a.category === category) ?? [], [data, category]);
  const todayCount = data?.actions.filter((a) => a.priority === 'Do today').length ?? 0;

  return (
    <div className="rp-page space-y-5">
      <ReportHeader
        title="Summary Analysis"
        subtitle="Clear actions to release cash faster, protect margin and move steel utensils into paid invoices."
        icon={Lightbulb}
        asOf={data?.asOf}
        hero={data ? { label: 'Outstanding', value: inrCompact(data.headline.outstanding), hint: 'net receivable · point-in-time' } : undefined}
      />

      <ReportFilterBar f={filters.f} setF={filters.setF} active={filters.active} onReset={filters.reset} />

      <ReportSummary
        loading={isLoading}
        points={data ? [
          { text: <>The recent sales run rate points to about <strong>{inrCompact(data.forecast.next30DayRevenue)}</strong> billing in the next 30 days.</>, tone: 'info' },
          { text: <>About <strong>{inrCompact(data.forecast.collectible30Days)}</strong> may be collectible in 30 days if overdue and due-soon calls are completed.</>, tone: 'good' },
          { text: <>Reducing DSO by 10 days can release about <strong>{inrCompact(data.forecast.cashUnlockFromTenDsoDays)}</strong> of working cash.</>, tone: 'good' },
          { text: <><strong>{data.headline.activeParties}</strong> parties were billed in the period, while <strong>{data.headline.owingParties}</strong> parties currently owe money. These are different groups.</>, tone: 'warn' },
        ] : []}
      />

      <KpiGrid className="gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Outstanding" value={data ? inrCompact(data.headline.outstanding) : '—'} title={data ? inrFull(data.headline.outstanding) : undefined} hint="point-in-time balance" icon={CircleDollarSign} tone="rose" loading={isLoading} />
        <Kpi label="Overdue" value={data ? inrCompact(data.headline.overdue) : '—'} title={data ? inrFull(data.headline.overdue) : undefined} hint="past due date" icon={Banknote} tone="amber" loading={isLoading} />
        <Kpi label="Revenue" value={data ? inrCompact(data.headline.revenue) : '—'} title={data ? inrFull(data.headline.revenue) : undefined} hint="selected period" icon={ReceiptText} tone="blue" loading={isLoading} />
        <Kpi label="Do today" value={data ? String(todayCount) : '—'} hint="highest-priority actions" icon={Gauge} tone="violet" loading={isLoading} />
      </KpiGrid>

      <ReportCard
        title={`${data?.actions.length ?? 25} action points`}
        right={<span className="text-muted-foreground text-xs sm:text-xs">Confidence: {data?.forecast.confidence ?? '—'}</span>}
      >
        <ReportSeg options={CATEGORIES} value={category} onChange={setCategory} />

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="bg-muted h-20 animate-pulse rounded-md" />)}</div>
        ) : (
          <div className="rp-rows sm:divide-y sm:rounded-md sm:border">
            {actions.map((action, index) => (
              <div
                key={action.id}
                className="rp-row grid gap-3 sm:animate-none sm:rounded-none sm:border-0 sm:bg-none sm:p-3 sm:shadow-none sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:items-start"
                style={{ animationDelay: `${60 + Math.min(index, 14) * 45}ms` }}
              >
                <div className="rp-row-index sm:flex sm:size-9 sm:rounded-md sm:border-0 sm:bg-slate-100 sm:bg-none sm:text-sm sm:font-bold sm:text-slate-600 sm:shadow-none">
                  {String((data?.actions.indexOf(action) ?? index) + 1).padStart(2, '0')}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 max-sm:gap-1.5">
                    <h3 className="rp-row-title sm:font-semibold sm:text-slate-900 sm:text-base sm:tracking-normal">{action.title}</h3>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset max-sm:hidden', PRIORITY_TONE[action.priority])}>{action.priority}</span>
                    <span className="text-muted-foreground text-xs font-medium max-sm:hidden">{action.category}</span>
                  </div>
                  <div className="mt-[9px] flex flex-wrap gap-[5px] sm:hidden">
                    <ReportPill text={action.priority} tone={action.priority === 'Do today' ? 'rose' : action.priority === 'This week' ? 'amber' : 'slate'} />
                    <ReportPill text={action.category} tone="blue" />
                  </div>
                  <p className="mt-2 text-sm text-slate-700 max-sm:mt-[9px] max-sm:text-[12px] max-sm:leading-[1.5] max-sm:font-medium max-sm:text-[#2b3f5e] dark:max-sm:text-[#c5d3ee]">{action.detail}</p>
                  <div className="mt-1.5 grid gap-1 text-xs max-sm:mt-2 max-sm:gap-1.5 max-sm:border-t max-sm:border-[rgba(15,35,80,.1)] max-sm:pt-2 max-sm:text-[11px] sm:grid-cols-2">
                    <p className="text-slate-500 max-sm:text-[#52658a]"><strong className="text-slate-700 max-sm:text-[#0a1730] dark:max-sm:text-white">Why:</strong> {action.evidence}</p>
                    <p className="text-emerald-700"><strong>Expected result:</strong> {action.impact}</p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm" className="justify-self-start max-sm:hidden sm:justify-self-end">
                  <Link to={action.route}>Open <ArrowRight className="size-3.5" /></Link>
                </Button>
                <button type="button" className="rp-row-act mt-[11px] justify-self-start self-start sm:hidden" onClick={() => navigate(action.route)}>Open</button>
              </div>
            ))}
          </div>
        )}
      </ReportCard>

      <p className="text-muted-foreground text-xs">
        Forecasts are simple estimates from recent billing, ageing and due dates. They are for planning, not guaranteed results.
      </p>
    </div>
  );
}
