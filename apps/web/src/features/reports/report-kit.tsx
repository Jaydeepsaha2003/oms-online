import type { CSSProperties, ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Hammer, Lightbulb, type LucideIcon } from 'lucide-react';
import type { PeriodMetric, ReportSlice } from '@oms/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { inrCompact, inrFull } from '@/features/dashboard/format';

/*
 * Two renderings, one set of props.
 *
 * Desktop keeps the plain bordered cards the reports have always had. Below
 * `sm` every kit piece switches to the shared Reports mobile design: frosted
 * glass floating on a living liquid wallpaper, transcribed from the mockup
 * (see the `.rp-*` block in index.css, which holds the actual numbers). The
 * split is `sm:hidden` / `hidden sm:block` rather than utility overrides
 * because the two versions differ in structure — sheens, tone dots and stat
 * grids exist only on the phone — not just in colour.
 */

/** Tone palette — the mockup's own gradients, tints and rings. */
export type KpiTone = 'blue' | 'emerald' | 'amber' | 'violet' | 'rose' | 'slate';
type ToneSpec = { grad: string; bg: string; fg: string; ring: string; deskGrad: string };
const TONE: Record<KpiTone, ToneSpec> = {
  blue: { grad: 'linear-gradient(150deg,#60a5fa,#1d4ed8)', bg: 'rgba(219,234,254,.72)', fg: '#1e40af', ring: 'rgba(59,130,246,.34)', deskGrad: 'from-blue-400 to-blue-600' },
  emerald: { grad: 'linear-gradient(150deg,#34d399,#047857)', bg: 'rgba(209,250,229,.72)', fg: '#065f46', ring: 'rgba(16,185,129,.34)', deskGrad: 'from-emerald-400 to-emerald-600' },
  amber: { grad: 'linear-gradient(150deg,#fbbf24,#b45309)', bg: 'rgba(254,243,199,.75)', fg: '#92400e', ring: 'rgba(245,158,11,.36)', deskGrad: 'from-amber-400 to-amber-600' },
  violet: { grad: 'linear-gradient(150deg,#a78bfa,#6d28d9)', bg: 'rgba(237,233,254,.75)', fg: '#5b21b6', ring: 'rgba(139,92,246,.34)', deskGrad: 'from-violet-400 to-violet-600' },
  rose: { grad: 'linear-gradient(150deg,#fb7185,#be123c)', bg: 'rgba(255,228,230,.75)', fg: '#9f1239', ring: 'rgba(244,63,94,.34)', deskGrad: 'from-rose-400 to-rose-600' },
  slate: { grad: 'linear-gradient(150deg,#94a3b8,#334155)', bg: 'rgba(226,232,240,.75)', fg: '#334155', ring: 'rgba(100,116,139,.32)', deskGrad: 'from-slate-400 to-slate-600' },
};
/** A tinted surface (pill, chip) in a given tone. */
export const toneSurface = (tone: KpiTone): CSSProperties => ({
  background: TONE[tone].bg,
  color: TONE[tone].fg,
  boxShadow: `inset 0 0 0 1px ${TONE[tone].ring}, inset 0 1px 0 rgba(255,255,255,.7)`,
});
/** Stagger helper — every list in the mockup enters one item at a time. */
const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/**
 * The living wallpaper: a soft vertical plate with three tinted blobs
 * drifting across it on their own clocks. Fixed, so it stays still while the
 * report scrolls over it. Rendered once per page by {@link ReportHeader}, so
 * no page has to remember to include it.
 */
function ReportWallpaper() {
  return (
    <div aria-hidden className="rp-wallpaper sm:hidden">
      <span className="rp-blob rp-blob-1" />
      <span className="rp-blob rp-blob-2" />
      <span className="rp-blob rp-blob-3" />
    </div>
  );
}

/** The headline figure the mockup puts on the blue, above the range chips. */
export interface ReportHero {
  label: string;
  value: string;
  hint?: string;
  delta?: { dir: 'up' | 'down' | 'flat'; text: string };
}

/**
 * The strip above a report: its one-line purpose, its actions, and how fresh
 * the figures are.
 *
 * Desktop stays the plain subtitle row — the topbar already names the report
 * there. On a phone this is the mockup's blue hero: title, "as of", the one
 * headline figure, and the wallpaper behind everything. Its bottom corners
 * stay square because {@link ReportFilterBar} continues the same blue block
 * directly beneath it and carries the rounding.
 */
export function ReportHeader({ title, subtitle, icon: Icon, asOf, actions, hero }: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  asOf?: string;
  actions?: ReactNode;
  hero?: ReportHero;
}) {
  const asOfText = asOf ? new Date(asOf).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : null;
  const deltaTone = hero?.delta ? (hero.delta.dir === 'up' ? '#a7f3d0' : hero.delta.dir === 'down' ? '#fecdd3' : '#e2e8f0') : undefined;

  return (
    <div aria-label={title}>
      <ReportWallpaper />

      {/* Phones: the mockup's hero. */}
      <div className="rp-hero sm:hidden">
        <span aria-hidden className="rp-hero-sheen" />
        <span aria-hidden className="rp-hero-grid" />
        <div className="relative flex items-start gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[13px] border border-white/35 bg-white/[0.16] shadow-[inset_0_1px_0_rgba(255,255,255,.4)] backdrop-blur-md">
            <Icon className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="rp-hero-title truncate">{title}</h1>
            <p className="rp-hero-sub">{asOfText ? `as of ${asOfText}` : subtitle}</p>
          </div>
        </div>
        {hero && (
          <div className="relative flex items-end gap-3 pt-3">
            <div className="min-w-0">
              <div className="rp-hero-label">{hero.label}</div>
              <div className="rp-hero-value">{hero.value}</div>
            </div>
            <div className="ml-auto flex flex-col items-end gap-1.5 pb-0.5">
              {hero.delta && (
                <span className="rp-hero-delta" style={{ color: deltaTone }}>
                  {hero.delta.dir === 'up' ? '↑' : hero.delta.dir === 'down' ? '↓' : '→'} {hero.delta.text}
                </span>
              )}
              {hero.hint && <span className="rp-hero-hint">{hero.hint}</span>}
            </div>
          </div>
        )}
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

/**
 * Wraps a page's KPIs so the phone gets the mockup's two-column tile grid
 * while desktop keeps whatever responsive grid the page already declared.
 * Pages pass their existing grid classes; they apply from `sm` up only.
 */
export function KpiGrid({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rp-kpis sm:grid', className)}>{children}</div>;
}

/** Compact headline KPI — a glass tile on a phone, the plain card on desktop. */
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
  const t = TONE[tone];
  const deltaTone: KpiTone = metric?.direction === 'up' ? 'emerald' : metric?.direction === 'down' ? 'rose' : 'slate';
  const deltaText = metric ? (metric.deltaPct == null ? (metric.current > 0 ? 'New' : '—') : `${metric.deltaPct > 0 ? '+' : ''}${metric.deltaPct.toFixed(1)}%`) : null;

  return (
    <>
      {/* Phones */}
      <div className="rp-glass rp-kpi sm:hidden">
        <span aria-hidden className="rp-kpi-sheen" />
        <div className="relative flex min-w-0 items-center gap-1.5">
          <span className="rp-kpi-dot" style={{ background: t.grad }} />
          <span className="rp-kpi-label">{label}</span>
        </div>
        {loading ? (
          <div className="h-6 w-20 animate-pulse rounded bg-slate-900/10" />
        ) : (
          <div className="rp-kpi-value" data-long={value.length > 9} title={title}>{value}</div>
        )}
        <div className="relative flex flex-wrap items-center gap-1.5">
          {deltaText && !loading && (
            <span className="rp-delta" style={toneSurface(deltaTone)}>
              {metric!.direction === 'up' ? '↑' : metric!.direction === 'down' ? '↓' : '→'} {deltaText}
            </span>
          )}
          {hint && <span className="rp-kpi-hint">{hint}</span>}
        </div>
      </div>

      {/* Desktop */}
      <Card className="card-hover hidden gap-0 sm:block">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-muted-foreground text-sm font-medium">{label}</CardTitle>
          {Icon && <span className={cn('flex size-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm', t.deskGrad)}><Icon className="size-4.5" /></span>}
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
    </>
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
 */
export const BANK_COLOR = '#1e40af';
export const BANK_GRAD = 'linear-gradient(90deg,#2c5fd6,#1e3a8a)';
export const CASH_COLOR = '#34d399';
export const CASH_GRAD = 'linear-gradient(90deg,#34d399,#0ea371)';
export const CASH_EDGE = '#059669';

/** A ranked horizontal-bar list (no chart lib) — top parties / regions / agents.
 *  A slice carrying `bank`/`cash` splits its bar into the Bank+Cash pair with a
 *  legend up top; slices without a payment mode keep one solid colour. */
export function RankedBars({ data, money = true, emptyText = 'No data.', subFor }: {
  data: ReportSlice[];
  money?: boolean;
  emptyText?: string;
  /** Overrides the "x% of top" line under each bar. */
  subFor?: (d: ReportSlice) => string;
}) {
  if (!data.length) return <div className="text-muted-foreground py-8 text-center text-sm">{emptyText}</div>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const fmt = (v: number) => (money ? inrCompact(v) : Math.round(v).toLocaleString('en-IN'));
  const split = money && data.some((d) => d.bank != null && d.cash != null);
  const legend = split && (
    <>
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: BANK_COLOR }} /> Bank</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: CASH_COLOR, boxShadow: `inset 0 0 0 1px ${CASH_EDGE}` }} /> Cash</span>
    </>
  );

  return (
    <>
      {/* Phones */}
      <div className="sm:hidden">
        {split && <div className="mb-[11px] flex items-center gap-[13px] text-[10.5px] font-bold text-[#3d5273] dark:text-[#93a6c9]">{legend}</div>}
        <div className="rp-bars">
          {data.map((d, i) => {
            const bank = d.bank ?? 0;
            const cash = d.cash ?? 0;
            const del = 80 + i * 55;
            const sub = subFor
              ? subFor(d)
              : split
                ? `${fmt(bank)} bank · ${fmt(cash)} cash`
                : `${Math.round((d.value / max) * 100)}% of top`;
            return (
              <div key={d.name} className="min-w-0">
                <div className="rp-bar-head">
                  <span className="rp-bar-name" title={d.name}>{d.name}</span>
                  <span className="rp-bar-value">{fmt(d.value)}</span>
                </div>
                <div className="rp-bar-track">
                  {split ? (
                    <>
                      <span className="rp-bar-fill" style={{ width: `${(bank / max) * 100}%`, background: BANK_GRAD, ...delay(del) }} />
                      <span className="rp-bar-fill" style={{ width: `${(cash / max) * 100}%`, background: CASH_GRAD, boxShadow: `inset 0 0 0 1px ${CASH_EDGE}`, ...delay(del + 90) }} />
                    </>
                  ) : (
                    <span
                      className="rp-bar-fill"
                      style={{
                        width: `${(d.value / max) * 100}%`,
                        background: `linear-gradient(90deg,${BAR_COLORS[i % BAR_COLORS.length]},${BAR_COLORS[i % BAR_COLORS.length]}cc)`,
                        borderRadius: 999,
                        ...delay(del),
                      }}
                    />
                  )}
                </div>
                <div className="rp-bar-sub">{sub}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden space-y-2.5 sm:block">
        {split && <div className="text-muted-foreground -mt-0.5 mb-1 flex items-center gap-3 text-[11px]">{legend}</div>}
        {data.map((d, i) => {
          const bank = d.bank ?? 0;
          const cash = d.cash ?? 0;
          return (
            <div key={d.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
              <div className="min-w-0">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium" title={d.name}>{d.name}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums" title={money ? inrFull(d.value) : undefined}>
                    {fmt(d.value)}
                    {split && <span className="text-muted-foreground ml-1 font-normal">({fmt(bank)} bank / {fmt(cash)} cash)</span>}
                  </span>
                </div>
                <div className="bg-muted flex h-2 overflow-hidden rounded-full">
                  {split ? (
                    <>
                      <div className="h-full" style={{ width: `${(bank / max) * 100}%`, background: BANK_COLOR }} />
                      <div className="h-full" style={{ width: `${(cash / max) * 100}%`, background: CASH_COLOR, boxShadow: `inset 0 0 0 1px ${CASH_EDGE}` }} />
                    </>
                  ) : (
                    <div className="h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** A titled report section — the mockup's glass card on a phone, the plain
 *  bordered card on desktop. `note` is the small grey line the mockup puts
 *  under a chart to explain it. */
export function ReportCard({ title, children, right, note }: { title: string; children: ReactNode; right?: ReactNode; note?: ReactNode }) {
  return (
    <>
      {/* Phones */}
      <div className="rp-glass sm:hidden">
        <span aria-hidden className="rp-glass-sheen" />
        <div className="rp-card-head">
          <div className="rp-card-title">{title}</div>
          {right && <div className="rp-card-right">{right}</div>}
        </div>
        <div className="rp-card-body">
          {children}
          {note && <p className="rp-note">{note}</p>}
        </div>
      </div>

      {/* Desktop */}
      <Card className="card-hover hidden sm:block">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">{title}</CardTitle>
          {right}
        </CardHeader>
        <CardContent>
          {children}
          {note && <p className="text-muted-foreground mt-2 text-xs">{note}</p>}
        </CardContent>
      </Card>
    </>
  );
}

export type InsightTone = 'good' | 'warn' | 'bad' | 'info';
const INSIGHT_DOT: Record<InsightTone, string> = { good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-rose-500', info: 'bg-blue-500' };
const DOT_HEX: Record<InsightTone, string> = { good: '#059669', warn: '#d97706', bad: '#e11d48', info: '#2563eb' };

/** Plain-English "Summary" card — auto-generated takeaways from a report's data. */
export function ReportSummary({ points, loading }: { points: { text: ReactNode; tone?: InsightTone }[]; loading?: boolean }) {
  return (
    <>
      {/* Phones */}
      <div className="rp-summary sm:hidden">
        <span aria-hidden className="rp-summary-glow" />
        <div className="relative mb-3 flex items-center gap-2.5">
          <span className="rp-summary-icon"><Lightbulb className="size-3.5" /></span>
          <div className="rp-summary-title">Summary</div>
          {points.length > 0 && !loading && <div className="rp-summary-count">{points.length} points</div>}
        </div>
        {loading ? (
          <div className="relative space-y-2.5">{[0, 1, 2].map((i) => <div key={i} className="h-3.5 w-full animate-pulse rounded bg-slate-900/10" />)}</div>
        ) : points.length === 0 ? (
          <p className="relative text-[12.5px] font-medium text-[#52658a]">Not enough data yet to summarise.</p>
        ) : (
          <div className="relative flex flex-col gap-[11px]">
            {points.map((p, i) => {
              const hex = DOT_HEX[p.tone ?? 'info'];
              return (
                <div key={i} className="rp-point" style={delay(80 + i * 60)}>
                  <span className="rp-dot" style={{ background: hex, boxShadow: `0 0 0 3px ${hex}22` }} />
                  <span>{p.text}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Desktop */}
      <Card className="border-primary/20 bg-primary/[0.03] hidden sm:block">
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
    </>
  );
}

/* ── pieces the mockup uses inside a card ─────────────────────────────────── */

export type Pill = { text: string; tone: KpiTone | 'good' | 'warn' | 'bad' };
const PILL_TONE: Record<Pill['tone'], KpiTone> = {
  blue: 'blue', emerald: 'emerald', amber: 'amber', violet: 'violet', rose: 'rose', slate: 'slate',
  good: 'emerald', warn: 'amber', bad: 'rose',
};
export function ReportPill({ text, tone }: Pill) {
  return <span className="rp-pill" style={toneSurface(PILL_TONE[tone])}>{text}</span>;
}

/** The mockup's segmented control — category / measure switchers inside a card. */
export function ReportSeg<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <>
      <div className="rp-seg rp-noscroll mb-[13px] sm:hidden">
        {options.map((o) => (
          <button key={o} type="button" className="rp-seg-btn" data-on={value === o} onClick={() => onChange(o)}>{o}</button>
        ))}
      </div>
      <div className="mb-4 hidden flex-wrap gap-1.5 sm:flex" role="tablist">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="tab"
            aria-selected={value === o}
            onClick={() => onChange(o)}
            className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', value === o ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
          >
            {o}
          </button>
        ))}
      </div>
    </>
  );
}

/** Stat chips — the recovery pipeline and the party segments, two-up. */
export function ReportChips({ chips }: { chips: { label: string; count: string; value?: string; tone: KpiTone }[] }) {
  return (
    <div className="rp-chips sm:grid-cols-3 lg:grid-cols-6">
      {chips.map((c, i) => (
        <div key={c.label} className="rp-chip max-sm:!block sm:rounded-lg sm:px-3 sm:py-2 sm:ring-1 sm:ring-inset" style={{ ...toneSurface(c.tone), ...delay(60 + i * 45) }}>
          <div className="rp-chip-label sm:text-xs sm:tracking-wide sm:opacity-80">{c.label}</div>
          <div className="rp-chip-count sm:mt-0.5 sm:text-lg sm:font-bold">{c.count}</div>
          {c.value && <div className="rp-chip-value sm:text-xs sm:opacity-80">{c.value}</div>}
        </div>
      ))}
    </div>
  );
}

/** A value funnel — ordered → dispatched → billed, each a fat proportional bar. */
export function ReportFunnel({ steps }: { steps: { label: string; value: string; ratio: number; from: string; to: string }[] }) {
  return (
    <div className="rp-funnel">
      {steps.map((s, i) => (
        <div key={s.label}>
          <div className="rp-funnel-head">
            <span className="rp-funnel-label">{s.label}</span>
            <span className="rp-funnel-value">{s.value}</span>
            <span className="rp-funnel-pct">{Math.round(s.ratio * 100)}%</span>
          </div>
          <div className="rp-funnel-track">
            <div
              className="rp-funnel-fill"
              style={{ width: `${Math.max(s.ratio, 0) * 100}%`, background: `linear-gradient(90deg,${s.from},${s.to})`, ...delay(90 + i * 120) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
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
  /** Position in the list — staggers the entrance. */
  i?: number;
}) {
  return (
    <div className="rp-row" style={delay(60 + Math.min(i, 14) * 45)}>
      <div className="flex items-start gap-2.5">
        {index && <span className="rp-row-index">{index}</span>}
        <div className="min-w-0 flex-1">
          <div className="rp-row-title">{title}</div>
          {sub && <div className="rp-row-sub">{sub}</div>}
        </div>
        {action && <button type="button" className="rp-row-act" onClick={action.onClick}>{action.label}</button>}
      </div>
      {pills && pills.length > 0 && (
        <div className="mt-[9px] flex flex-wrap gap-[5px]">
          {pills.map((p, j) => <ReportPill key={j} {...p} />)}
        </div>
      )}
      {stats && stats.length > 0 && (
        <div className="rp-row-stats" style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 3)}, minmax(0,1fr))` }}>
          {stats.map((s, j) => (
            <div key={j} className="min-w-0">
              <div className="rp-stat-label">{s.label}</div>
              <div className="rp-stat-value" style={s.tone === 'bad' ? { color: '#be123c' } : s.tone === 'good' ? { color: '#047857' } : undefined}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Wraps a list of {@link ReportRow}s for the mobile view of a data table —
 *  pass the exact rows the desktop `<table>` renders. Shown only below `sm`. */
export function ReportRowList({ children, emptyText }: { children: ReactNode; emptyText?: string }) {
  const empty = Array.isArray(children) ? children.length === 0 : !children;
  if (empty) return <div className="text-muted-foreground py-8 text-center text-sm sm:hidden">{emptyText ?? 'No data.'}</div>;
  return <div className="rp-rows sm:hidden">{children}</div>;
}

/** Placeholder body for reports still being built — keeps the menu complete. */
export function ComingSoon({ title, description, icon }: { title: string; description: string; icon: LucideIcon }) {
  return (
    <div className="rp-page space-y-4">
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
