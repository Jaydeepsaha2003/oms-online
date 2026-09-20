import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Hammer, Lightbulb, type LucideIcon } from 'lucide-react';
import type { PeriodMetric, ReportSlice } from '@oms/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { inrCompact, inrFull } from '@/features/dashboard/format';

/**
 * The strip above a report: its one-line purpose, its actions, and how fresh the
 * figures are.
 *
 * It no longer repeats the report's NAME or its icon on desktop — the topbar
 * already shows both there. On a phone there is no topbar icon to lean on (the
 * app bar just names the screen), so below `sm` this renders a small gradient
 * hero card instead — icon, title and "as of", the same glass-on-blue language
 * as the rest of the reports' mobile skin — and the plain desktop strip is
 * hidden. Every existing call site is untouched: same props, richer mobile
 * output.
 */
export function ReportHeader({ title, subtitle, icon: Icon, asOf, actions }: { title: string; subtitle: string; icon: LucideIcon; asOf?: string; actions?: ReactNode }) {
  const asOfText = asOf ? new Date(asOf).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : null;
  return (
    <div aria-label={title}>
      {/* Phones: gradient hero, matching the Reports mobile mockup. */}
      <div className="rp-rise relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0f2356]/95 via-[#1d4ed8]/90 to-[#2563eb]/85 p-4 text-white shadow-[0_18px_40px_-22px_rgba(9,26,74,.9)] sm:hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(85%_120%_at_14%_-14%,rgba(255,255,255,.3),transparent_58%)]" />
        <div className="relative flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-white/30 bg-white/15 shadow-inner backdrop-blur-md">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[19px] leading-tight font-bold tracking-tight">{title}</h1>
            <p className="mt-1 text-[12px] leading-snug font-medium text-white/80">{subtitle}</p>
            {asOfText && <p className="mt-1.5 text-[10.5px] font-semibold text-blue-100/90">as of {asOfText}</p>}
          </div>
        </div>
        {actions && <div className="relative mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {/* Desktop: unchanged plain strip. */}
      <div className="hidden flex-wrap items-center justify-between gap-3 sm:flex">
        <p className="text-muted-foreground min-w-0 text-sm">{subtitle}</p>
        <div className="flex items-center gap-2">
          {actions}
          {asOfText && <span className="text-muted-foreground text-xs">as of {asOfText}</span>}
        </div>
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
/** Tinted ring for the mobile glass KPI tile — one per tone, used only below `sm`. */
const TONE_RING: Record<KpiTone, string> = {
  blue: 'max-sm:shadow-[0_14px_30px_-20px_rgba(29,78,216,.55)]',
  emerald: 'max-sm:shadow-[0_14px_30px_-20px_rgba(4,120,87,.55)]',
  amber: 'max-sm:shadow-[0_14px_30px_-20px_rgba(180,83,9,.55)]',
  violet: 'max-sm:shadow-[0_14px_30px_-20px_rgba(109,40,217,.55)]',
  rose: 'max-sm:shadow-[0_14px_30px_-20px_rgba(190,18,60,.55)]',
  slate: 'max-sm:shadow-[0_14px_30px_-20px_rgba(51,65,85,.45)]',
};

/** Compact headline KPI card with an optional icon badge and delta.
 *
 *  Desktop keeps the plain bordered card it always had. Below `sm` it becomes
 *  a frosted glass tile — tone-tinted shadow, rounded-2xl, a subtle rise-in —
 *  matching the Reports mobile mockup's KPI grid. */
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
    <Card
      className={cn(
        'card-hover gap-0 max-sm:rp-rise max-sm:rounded-2xl max-sm:border-white/70 max-sm:bg-white/65 max-sm:backdrop-blur-xl max-sm:dark:border-white/10 max-sm:dark:bg-white/[0.06]',
        TONE_RING[tone],
      )}
    >
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{label}</CardTitle>
        {Icon && <span className={cn('flex size-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm max-sm:rounded-lg max-sm:shadow-md', TONE[tone])}><Icon className="size-4.5" /></span>}
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

/*
 * Bank / Cash — the one pair, for every report chart and bar in the app.
 *
 * Blue for bank, green for cash, matching the B / Bank and C / Cash columns on
 * the payment desk, so the two words mean the same colour wherever they appear.
 *
 * A DEEP blue against a LIGHT green, not two mid tones: these two always sit
 * flush against each other — stacked in a bar, adjacent in a split rail — with
 * no gap to separate them, so they have to differ in lightness as well as hue.
 * This pair separates 4.5:1 where the old #3b82f6/#10b981 managed 1.6:1, which
 * is why a cash segment used to read as a shade of the bank one.
 *
 * The light green is weak on white on its own (1.9:1), so anything filled with
 * CASH_COLOR against the card takes CASH_EDGE as its outline: the fill carries
 * the separation, the stroke carries the edge.
 */
export const BANK_COLOR = '#1e40af';
export const CASH_COLOR = '#34d399';
export const CASH_EDGE = '#059669';

/** A ranked horizontal-bar list (no chart lib) — great for top parties / regions / agents.
 *  When a slice carries `bank`/`cash` (real money with a payment mode — billed via
 *  Challan.b/.c, or collected via receipt mode), its bar renders as a Bank+Cash
 *  stacked split instead of one solid colour, with a small legend up top. Slices
 *  without a mode (counts, ratios, physical quantities) keep the plain single-colour bar. */
export function RankedBars({ data, money = true, emptyText = 'No data.' }: { data: ReportSlice[]; money?: boolean; emptyText?: string }) {
  if (!data.length) return <div className="text-muted-foreground py-8 text-center text-sm">{emptyText}</div>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const fmt = (v: number) => (money ? inrCompact(v) : Math.round(v).toLocaleString('en-IN'));
  const split = money && data.some((d) => d.bank != null && d.cash != null);
  return (
    <div className="space-y-2.5 max-sm:space-y-3.5">
      {split && (
        <div className="text-muted-foreground -mt-0.5 mb-1 flex items-center gap-3 text-[11px] font-semibold">
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: BANK_COLOR }} /> Bank</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: CASH_COLOR, boxShadow: `inset 0 0 0 1px ${CASH_EDGE}` }} /> Cash</span>
        </div>
      )}
      {data.map((d, i) => {
        const bank = d.bank ?? 0;
        const cash = d.cash ?? 0;
        return (
          <div key={d.name} className="rp-rise grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3" style={{ animationDelay: `${i * 45}ms` }}>
            <div className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium" title={d.name}>{d.name}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums" title={money ? inrFull(d.value) : undefined}>
                  {fmt(d.value)}
                  {split && <span className="text-muted-foreground ml-1 font-normal">({fmt(bank)} bank / {fmt(cash)} cash)</span>}
                </span>
              </div>
              <div className="bg-muted flex h-2 overflow-hidden rounded-full max-sm:h-2.5 max-sm:shadow-inner">
                {split ? (
                  <>
                    <div className="rp-grow-x h-full origin-left" style={{ width: `${(bank / max) * 100}%`, background: BANK_COLOR, animationDelay: `${i * 45}ms` }} />
                    <div className="rp-grow-x h-full origin-left" style={{ width: `${(cash / max) * 100}%`, background: CASH_COLOR, boxShadow: `inset 0 0 0 1px ${CASH_EDGE}`, animationDelay: `${i * 45 + 60}ms` }} />
                  </>
                ) : (
                  <div className="rp-grow-x h-full origin-left rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: BAR_COLORS[i % BAR_COLORS.length], animationDelay: `${i * 45}ms` }} />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A titled report section card.
 *
 *  Desktop: unchanged plain card. Below `sm`: frosted glass, rounded-3xl, a
 *  soft rise-in — the same section-card look every card of the mobile mockup
 *  shares (Recharts content inside renders exactly as before either way). */
export function ReportCard({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <Card className="card-hover max-sm:rp-rise max-sm:overflow-hidden max-sm:rounded-3xl max-sm:border-white/80 max-sm:bg-white/70 max-sm:p-0.5 max-sm:shadow-[0_16px_36px_-22px_rgba(13,38,92,.4)] max-sm:backdrop-blur-xl max-sm:dark:border-white/10 max-sm:dark:bg-white/[0.05]">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {right}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export type Pill = { text: string; tone: KpiTone | 'good' | 'warn' | 'bad' };
const PILL_TONE: Record<Pill['tone'], string> = {
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-400/10 dark:text-blue-300 dark:ring-blue-400/25',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/25',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/25',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-400/25',
  rose: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-400/25',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-white/10 dark:text-slate-300 dark:ring-white/15',
  good: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/25',
  warn: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/25',
  bad: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-400/25',
};
export function ReportPill({ text, tone }: Pill) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold ring-1 ring-inset', PILL_TONE[tone])}>{text}</span>;
}

/**
 * A phone-friendly row card — index, title, subtitle, pills, a small stat grid
 * and an optional action button. Every report page that shows a data table
 * (recovery call list, parties, loyal parties, design margins…) renders the
 * SAME `<table>` on desktop it always did, and one of these per row below
 * `sm` instead of the horizontally-scrolling table a phone can't use well.
 */
export function ReportRow({
  index, title, sub, pills, stats, action, i = 0,
}: {
  index?: string;
  title: ReactNode;
  sub?: ReactNode;
  pills?: Pill[];
  stats?: { label: string; value: ReactNode; tone?: 'bad' | 'good' | 'muted' }[];
  action?: { label: string; onClick: () => void };
  /** Position in the list — staggers the entrance animation. */
  i?: number;
}) {
  return (
    <div
      className="rp-rise rounded-2xl border border-white/80 bg-gradient-to-br from-white/85 to-blue-50/50 p-3 shadow-[0_8px_20px_-14px_rgba(13,38,92,.5)] dark:border-white/10 dark:from-white/[0.06] dark:to-white/[0.02]"
      style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
    >
      <div className="flex items-start gap-2.5">
        {index && (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-bold tabular-nums text-slate-600 dark:bg-white/10 dark:text-slate-300">
            {index}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13.5px] font-bold text-slate-900 dark:text-white">{title}</span>
            {pills?.map((p, j) => <ReportPill key={j} {...p} />)}
          </div>
          {sub && <p className="text-muted-foreground mt-0.5 truncate text-[11.5px] font-medium">{sub}</p>}
        </div>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="h-8 shrink-0 rounded-lg border border-white/90 bg-white/85 px-2.5 text-[11.5px] font-bold text-blue-800 shadow-sm active:scale-95 dark:border-white/15 dark:bg-white/10 dark:text-blue-300"
          >
            {action.label}
          </button>
        )}
      </div>
      {stats && stats.length > 0 && (
        <div className="mt-2.5 grid gap-x-2 gap-y-1.5 border-t border-slate-200/70 pt-2.5 dark:border-white/10" style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 3)}, minmax(0,1fr))` }}>
          {stats.map((s, j) => (
            <div key={j} className="min-w-0">
              <p className="text-muted-foreground truncate text-[9.5px] font-bold tracking-wide uppercase">{s.label}</p>
              <p className={cn(
                'truncate text-[12.5px] font-bold tabular-nums',
                s.tone === 'bad' ? 'text-rose-600' : s.tone === 'good' ? 'text-emerald-600' : 'text-slate-900 dark:text-white',
              )}>
                {s.value}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Wraps a list of {@link ReportRow}s for the mobile view of a data table —
 *  pass the exact rows the desktop `<table>` renders. Shown only below `sm`;
 *  pair it with `hidden sm:block`/`overflow-x-auto` on the table itself. */
export function ReportRowList({ children, emptyText }: { children: ReactNode; emptyText?: string }) {
  const empty = Array.isArray(children) ? children.length === 0 : !children;
  if (empty) return <div className="text-muted-foreground py-8 text-center text-sm sm:hidden">{emptyText ?? 'No data.'}</div>;
  return <div className="space-y-2 sm:hidden">{children}</div>;
}

export type InsightTone = 'good' | 'warn' | 'bad' | 'info';
const INSIGHT_DOT: Record<InsightTone, string> = { good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-rose-500', info: 'bg-blue-500' };

/** Plain-English "Summary" card — auto-generated takeaways from a report's data.
 *  Renders 1 column on phones, 2 on desktop. Pass `loading` for a skeleton. */
export function ReportSummary({ points, loading }: { points: { text: ReactNode; tone?: InsightTone }[]; loading?: boolean }) {
  return (
    <Card className="border-primary/20 bg-primary/[0.03] max-sm:rp-rise max-sm:rounded-3xl max-sm:border-white/85 max-sm:bg-gradient-to-br max-sm:from-white/80 max-sm:to-blue-50/60 max-sm:shadow-[0_16px_36px_-22px_rgba(13,38,92,.4)] max-sm:backdrop-blur-xl max-sm:dark:border-white/10 max-sm:dark:from-white/[0.06] max-sm:dark:to-white/[0.02]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="bg-gradient-brand flex size-7 items-center justify-center rounded-lg text-white shadow-sm max-sm:size-8 max-sm:rounded-xl max-sm:shadow-md"><Lightbulb className="size-4" /></span>
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
              <li key={i} className="rp-rise flex items-start gap-2.5 text-sm leading-snug max-sm:text-[12px]" style={{ animationDelay: `${i * 55}ms` }}>
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full max-sm:shadow-[0_0_0_3px_rgba(0,0,0,0.04)]', INSIGHT_DOT[p.tone ?? 'info'])} />
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
