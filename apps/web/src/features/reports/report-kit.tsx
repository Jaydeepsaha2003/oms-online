import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Hammer, Lightbulb, type LucideIcon } from 'lucide-react';
import type { PeriodMetric, ReportSlice } from '@oms/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { inrCompact, inrFull } from '@/features/dashboard/format';

/** Page header shared by every report — gradient icon, title, subtitle, "as of" stamp. */
export function ReportHeader({ title, subtitle, icon: Icon, asOf, actions }: { title: string; subtitle: string; icon: LucideIcon; asOf?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="bg-gradient-brand flex size-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
          <Icon className="size-5.5" />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground text-sm">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {asOf && <span className="text-muted-foreground hidden text-xs sm:block">as of {new Date(asOf).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
      </div>
    </div>
  );
}

export function DeltaBadge({ metric }: { metric: PeriodMetric }) {
  const { direction, deltaPct } = metric;
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight;
  const tone =
    direction === 'up'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
      : direction === 'down'
        ? 'bg-red-50 text-red-700 ring-red-600/20'
        : 'bg-slate-100 text-slate-600 ring-slate-500/20';
  const text = deltaPct == null ? (metric.current > 0 ? 'New' : '—') : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset', tone)}>
      <Icon className="size-3" />
      {text}
    </span>
  );
}

export type KpiTone = 'blue' | 'emerald' | 'amber' | 'violet' | 'rose' | 'slate';
const TONE: Record<KpiTone, string> = {
  blue: 'from-blue-400 to-blue-600',
  emerald: 'from-emerald-400 to-emerald-600',
  amber: 'from-amber-400 to-amber-600',
  violet: 'from-violet-400 to-violet-600',
  rose: 'from-rose-400 to-rose-600',
  slate: 'from-slate-400 to-slate-600',
};

/** Compact headline KPI card with an optional icon badge and delta. */
export function Kpi({ label, value, hint, icon: Icon, tone = 'blue', metric, loading, title }: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: KpiTone;
  metric?: PeriodMetric;
  loading?: boolean;
  title?: string;
}) {
  return (
    <Card className="card-hover gap-0">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{label}</CardTitle>
        {Icon && <span className={cn('flex size-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm', TONE[tone])}><Icon className="size-4.5" /></span>}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="bg-muted h-8 w-24 animate-pulse rounded" />
        ) : (
          <div className="text-2xl font-bold tracking-tight tabular-nums" title={title}>{value}</div>
        )}
        <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
          {metric && !loading && <DeltaBadge metric={metric} />}
          {hint && <span>{hint}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

const BAR_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

/** A ranked horizontal-bar list (no chart lib) — great for top parties / regions / agents. */
export function RankedBars({ data, money = true, emptyText = 'No data.' }: { data: ReportSlice[]; money?: boolean; emptyText?: string }) {
  if (!data.length) return <div className="text-muted-foreground py-8 text-center text-sm">{emptyText}</div>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const fmt = (v: number) => (money ? inrCompact(v) : Math.round(v).toLocaleString('en-IN'));
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={d.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium" title={d.name}>{d.name}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums" title={money ? inrFull(d.value) : undefined}>{fmt(d.value)}</span>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div className="h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A titled report section card. */
export function ReportCard({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <Card className="card-hover">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {right}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export type InsightTone = 'good' | 'warn' | 'bad' | 'info';
const INSIGHT_DOT: Record<InsightTone, string> = { good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-rose-500', info: 'bg-blue-500' };

/** Plain-English "Summary" card — auto-generated takeaways from a report's data.
 *  Renders 1 column on phones, 2 on desktop. Pass `loading` for a skeleton. */
export function ReportSummary({ points, loading }: { points: { text: ReactNode; tone?: InsightTone }[]; loading?: boolean }) {
  return (
    <Card className="border-primary/20 bg-primary/[0.03]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="bg-gradient-brand flex size-7 items-center justify-center rounded-lg text-white shadow-sm"><Lightbulb className="size-4" /></span>
          Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="bg-muted h-4 w-full animate-pulse rounded" />)}</div>
        ) : points.length === 0 ? (
          <p className="text-muted-foreground text-sm">Not enough data yet to summarise.</p>
        ) : (
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {points.map((p, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm leading-snug">
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', INSIGHT_DOT[p.tone ?? 'info'])} />
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Placeholder body for reports still being built — keeps the menu complete. */
export function ComingSoon({ title, description, icon }: { title: string; description: string; icon: LucideIcon }) {
  return (
    <div className="space-y-4">
      <ReportHeader title={title} subtitle={description} icon={icon} />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-200">
            <Hammer className="size-7" />
          </span>
          <div>
            <p className="text-base font-semibold">This report is being built</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">{description}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export const REPORT_COLORS = BAR_COLORS;
