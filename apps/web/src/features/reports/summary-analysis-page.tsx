import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, CircleDollarSign, Gauge, Lightbulb, ReceiptText } from 'lucide-react';
import type { SummaryActionCategory, SummaryActionPriority } from '@oms/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { Kpi, ReportCard, ReportHeader, ReportSummary } from './report-kit';
import { ReportFilterBar, useReportFilters } from './report-filters';
import { useSummaryAnalysis } from './use-reports';

const CATEGORIES: Array<'All' | SummaryActionCategory> = ['All', 'Cash', 'Sales', 'Margin', 'Customers', 'Operations'];
const PRIORITY_TONE: Record<SummaryActionPriority, string> = {
  'Do today': 'bg-rose-50 text-rose-700 ring-rose-600/20',
  'This week': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  Watch: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

export function SummaryAnalysisPage() {
  const filters = useReportFilters();
  const { data, isLoading } = useSummaryAnalysis(filters.query);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All');
  const actions = useMemo(() => data?.actions.filter((a) => category === 'All' || a.category === category) ?? [], [data, category]);
  const todayCount = data?.actions.filter((a) => a.priority === 'Do today').length ?? 0;

  return (
    <div className="space-y-5">
      <ReportHeader
        title="Summary Analysis"
        subtitle="Clear actions to release cash faster, protect margin and move steel utensils into paid invoices."
        icon={Lightbulb}
        asOf={data?.asOf}
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Outstanding" value={data ? inrCompact(data.headline.outstanding) : '—'} title={data ? inrFull(data.headline.outstanding) : undefined} hint="point-in-time balance" icon={CircleDollarSign} tone="rose" loading={isLoading} />
        <Kpi label="Overdue" value={data ? inrCompact(data.headline.overdue) : '—'} title={data ? inrFull(data.headline.overdue) : undefined} hint="past due date" icon={Banknote} tone="amber" loading={isLoading} />
        <Kpi label="Revenue" value={data ? inrCompact(data.headline.revenue) : '—'} title={data ? inrFull(data.headline.revenue) : undefined} hint="selected period" icon={ReceiptText} tone="blue" loading={isLoading} />
        <Kpi label="Do today" value={data ? String(todayCount) : '—'} hint="highest-priority actions" icon={Gauge} tone="violet" loading={isLoading} />
      </div>

      <ReportCard
        title={`${data?.actions.length ?? 25} action points`}
        right={<span className="text-muted-foreground text-xs">Forecast confidence: {data?.forecast.confidence ?? '—'}</span>}
      >
        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Action category">
          {CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={category === item}
              onClick={() => setCategory(item)}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', category === item ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
            >
              {item}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="bg-muted h-20 animate-pulse rounded-md" />)}</div>
        ) : (
          <div className="divide-y rounded-md border">
            {actions.map((action, index) => (
              <div key={action.id} className="grid gap-3 p-3 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:items-start">
                <div className="flex size-9 items-center justify-center rounded-md bg-slate-100 text-sm font-bold tabular-nums text-slate-600">
                  {String((data?.actions.indexOf(action) ?? index) + 1).padStart(2, '0')}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-900">{action.title}</h3>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', PRIORITY_TONE[action.priority])}>{action.priority}</span>
                    <span className="text-muted-foreground text-xs font-medium">{action.category}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{action.detail}</p>
                  <div className="mt-1.5 grid gap-1 text-xs sm:grid-cols-2">
                    <p className="text-slate-500"><strong className="text-slate-700">Why:</strong> {action.evidence}</p>
                    <p className="text-emerald-700"><strong>Expected result:</strong> {action.impact}</p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm" className="justify-self-start sm:justify-self-end">
                  <Link to={action.route}>Open <ArrowRight className="size-3.5" /></Link>
                </Button>
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
