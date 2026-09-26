import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Banknote, CircleDollarSign, Gauge, Lightbulb, ReceiptText } from 'lucide-react';
import type { SummaryActionCategory, SummaryActionPriority } from '@oms/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { Kpi, KpiGrid, ReportCard, ReportDeskHero, ReportHeader, ReportPill, ReportSeg, ReportSummary, type ReportHero } from './report-kit';
import { ReportFilterBar, useReportFilters } from './report-filters';
import { useSummaryAnalysis } from './use-reports';

const CATEGORIES: Array<'All' | SummaryActionCategory> = ['All', 'Cash', 'Sales', 'Margin', 'Customers', 'Operations'];
const PRIORITY_TONE: Record<SummaryActionPriority, string> = {
  'Do today': 'bg-rose-50 text-rose-700 ring-rose-200',
  'This week': 'bg-amber-50 text-amber-700 ring-amber-200',
  Watch: 'bg-slate-100 text-slate-600 ring-slate-200',
};
/** A desktop pill: the mockup's 11.5px tinted chip with a hairline ring. */
const PILL = 'inline-flex items-center rounded-full px-[9px] py-[3px] text-[11.5px] leading-[1.3] font-bold whitespace-nowrap ring-1 ring-inset';
const HAIR = 'border-[rgba(20,30,60,0.06)] dark:border-white/10';

export function SummaryAnalysisPage() {
  const navigate = useNavigate();
  const filters = useReportFilters();
  const { data, isLoading } = useSummaryAnalysis(filters.query);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All');
  const actions = useMemo(() => data?.actions.filter((a) => category === 'All' || a.category === category) ?? [], [data, category]);
  const todayCount = data?.actions.filter((a) => a.priority === 'Do today').length ?? 0;

  const hero: ReportHero | undefined = data ? {
    label: 'Outstanding',
    value: inrCompact(data.headline.outstanding),
    hint: 'net receivable · point-in-time',
    stats: [
      { label: 'Overdue', value: inrCompact(data.headline.overdue), hint: 'past due date', dot: '#ff8fab' },
      { label: 'Revenue', value: inrCompact(data.headline.revenue), hint: 'selected period', dot: '#7dd3fc' },
      { label: 'Next 30 days', value: inrCompact(data.forecast.next30DayRevenue), hint: 'forecast billing', dot: '#6ee7b7' },
      { label: 'Do today', value: String(todayCount), hint: 'highest-priority actions', dot: '#fcd34d' },
    ],
  } : undefined;

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

      <ReportDeskHero hero={hero} />

      <ReportSummary
        title="Forecast"
        loading={isLoading}
        points={data ? [
          {
            text: <>The recent sales run rate points to about <strong>{inrCompact(data.forecast.next30DayRevenue)}</strong> billing in the next 30 days.</>,
            tone: 'info',
            desk: { value: inrCompact(data.forecast.next30DayRevenue), text: 'Expected billing in the next 30 days, based on the recent run rate.' },
          },
          {
            text: <>About <strong>{inrCompact(data.forecast.collectible30Days)}</strong> may be collectible in 30 days if overdue and due-soon calls are completed.</>,
            tone: 'good',
            desk: { value: inrCompact(data.forecast.collectible30Days), text: 'Could be collected in 30 days if the overdue and due-soon calls are made.' },
          },
          {
            text: <>Reducing DSO by 10 days can release about <strong>{inrCompact(data.forecast.cashUnlockFromTenDsoDays)}</strong> of working cash.</>,
            tone: 'good',
            desk: { value: inrCompact(data.forecast.cashUnlockFromTenDsoDays), text: 'Released as working cash if the time to collect drops by 10 days.' },
          },
          {
            text: <><strong>{data.headline.activeParties}</strong> parties were billed in the period, while <strong>{data.headline.owingParties}</strong> parties currently owe money. These are different groups.</>,
            tone: 'warn',
            desk: { value: `${data.headline.owingParties} parties`, text: `Owe money now, while ${data.headline.activeParties} were billed in the period. These are different groups.` },
          },
        ] : []}
      />

      {/* The desktop hero carries these four; the phone lists them. */}
      <KpiGrid deskHidden className="gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Outstanding" value={data ? inrCompact(data.headline.outstanding) : '—'} title={data ? inrFull(data.headline.outstanding) : undefined} hint="point-in-time balance" icon={CircleDollarSign} tone="rose" loading={isLoading} />
        <Kpi label="Overdue" value={data ? inrCompact(data.headline.overdue) : '—'} title={data ? inrFull(data.headline.overdue) : undefined} hint="past due date" icon={Banknote} tone="amber" loading={isLoading} />
        <Kpi label="Revenue" value={data ? inrCompact(data.headline.revenue) : '—'} title={data ? inrFull(data.headline.revenue) : undefined} hint="selected period" icon={ReceiptText} tone="blue" loading={isLoading} />
        <Kpi label="Do today" value={data ? String(todayCount) : '—'} hint="highest-priority actions" icon={Gauge} tone="violet" loading={isLoading} />
      </KpiGrid>

      <ReportCard
        title={`${data?.actions.length ?? 25} action points`}
        right={`Confidence: ${data?.forecast.confidence ?? '—'}`}
        flush
      >
        <div className="sm:px-4 sm:pt-3">
          <ReportSeg options={CATEGORIES} value={category} onChange={setCategory} />
        </div>

        {isLoading ? (
          <div className="space-y-2 sm:p-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="bg-muted h-20 animate-pulse rounded-md" />)}</div>
        ) : (
          <>
          {/* Desktop: the mockup's two-up grid of actions. */}
          <div className={cn('hidden grid-cols-2 border-t sm:grid', HAIR)}>
            {actions.map((action, index) => (
              <div key={action.id} className={cn('rd-rise grid grid-cols-[36px_minmax(0,1fr)] gap-3 border-b px-4 py-3.5', HAIR, index % 2 === 1 && 'border-l')}>
                <span className={cn('flex size-9 items-center justify-center rounded-[11px] text-[13px] font-extrabold tabular-nums ring-1 ring-inset', PRIORITY_TONE[action.priority])}>
                  {String((data?.actions.indexOf(action) ?? index) + 1).padStart(2, '0')}
                </span>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-sm font-extrabold">{action.title}</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cn(PILL, PRIORITY_TONE[action.priority])}>{action.priority}</span>
                    <span className={cn(PILL, 'bg-indigo-50 text-blue-800 ring-indigo-200')}>{action.category}</span>
                  </div>
                  <p className="m-0 text-[13px] leading-[1.5] text-pretty text-[#3a4256] dark:text-[#c5d3ee]">{action.detail}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-[10px] bg-[#f5f7fc] px-2.5 py-2 text-xs leading-[1.45] text-[#5b6479] dark:bg-white/5 dark:text-[#93a6c9]">
                      <strong className="text-[#27304a] dark:text-white">Why:</strong> {action.evidence}
                    </div>
                    <div className="rounded-[10px] bg-emerald-50 px-2.5 py-2 text-xs leading-[1.45] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                      <strong>Expected result:</strong> {action.impact}
                    </div>
                  </div>
                  <div><Link to={action.route} className="rd-btn">Open →</Link></div>
                </div>
              </div>
            ))}
          </div>

          <div className="rp-rows sm:hidden">
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
          </>
        )}
      </ReportCard>

      <p className="text-muted-foreground text-xs">
        Forecasts are simple estimates from recent billing, ageing and due dates. They are for planning, not guaranteed results.
      </p>
    </div>
  );
}
