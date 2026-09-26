import type { CSSProperties, ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Hammer, Lightbulb, type LucideIcon } from 'lucide-react';
import type { PeriodMetric, ReportSlice } from '@oms/shared';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { MobileWallpaper } from '@/components/common/mobile-skin';
import { inrCompact, inrFull } from '@/features/dashboard/format';

/*
 * Two renderings, one set of props.
 *
 * Below `sm` every kit piece is the Reports mobile mockup: frosted glass on a
 * living liquid wallpaper (the `.rp-*` block in index.css). From `sm` up it is
 * the desktop report mockups: glass cards on a tinted plate under the CRM
 * desk's blue hero (`.pd-*` and `.rd-*`). The split is `sm:hidden` /
 * `hidden sm:block` rather than utility overrides because the two differ in
 * structure, not just in colour.
 *
 * Note for the desktop classes: they are unlayered, so they beat any Tailwind
 * utility on the same element. An element that must also be hidden on a phone
 * is therefore hidden by NOT rendering the desktop class there, or by a
 * wrapper — never by `hidden` next to a class that sets `display`.
 */

/** The desktop mockups' categorical palette (their first blue is #4f6ef7). */
const DESK_COLORS = ['#4f6ef7', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];
/** Bank / cash on the desktop charts and bars — the mockup's pair. */
export const DESK_BANK = '#2c4fd0';
export const DESK_CASH = '#34d399';
/** Recharts dressing shared by every desktop chart: dashed grid, quiet ticks. */
export const CHART_GRID = { vertical: false, stroke: '#e8ecf3', strokeDasharray: '4 4' } as const;
export const CHART_TICK = { fontSize: 10.5, fill: '#8a94a8', fontWeight: 600 } as const;
/** Column tops as the mockup draws them. */
export const BAR_RADIUS: [number, number, number, number] = [6, 6, 2, 2];

/** A swatch legend above a chart, the mockup's 9px rounded squares. */
export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="rd-legend">
      {items.map((it) => (
        <span key={it.label} className="rd-key"><i style={{ background: it.color }} />{it.label}</span>
      ))}
    </div>
  );
}

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

/** One glass tile beside the desktop hero's headline figure. */
export interface HeroStat {
  label: string;
  value: string;
  hint?: string;
  /** The tile's dot — the mockup gives each tile its own. */
  dot: string;
  /** A small change figure beside the value ("↑ 8.2%"). */
  delta?: { dir: 'up' | 'down' | 'flat'; text: string };
}

/** The headline figure the mockup puts on the blue. The phone uses the first
 *  four fields; the desktop hero also shows the chip, tiles and bar. */
export interface ReportHero {
  label: string;
  value: string;
  hint?: string;
  delta?: { dir: 'up' | 'down' | 'flat'; text: string };
  /** Desktop: the chip beside the figure when it is not the delta ("24 urgent"). */
  chip?: { text: string; tone: 'good' | 'bad' | 'neutral' };
  /** Desktop: the four glass tiles beside the headline. */
  stats?: HeroStat[];
  /** Desktop: a progress bar under the hint ("collected of billed"). */
  bar?: { pct: number; label: string; tone?: 'good' | 'bad' };
}

/**
 * The strip above a report: its one-line purpose, its actions, and how fresh
 * the figures are.
 *
 * Neither rendering repeats the report's NAME or its icon: the topbar already
 * shows both, and every `title` here is word-for-word its menu label, so the
 * page would be printing the same name and gradient icon a few pixels under
 * the topbar's on all nine reports. `title` is still taken and still used — it
 * labels the region for screen readers, which do not have the topbar in
 * earshot this far down the page.
 *
 * Desktop is the plain subtitle row. On a phone this is the mockup's blue
 * hero — "as of", the one headline figure, and the wallpaper behind
 * everything. Its bottom corners stay square because {@link ReportFilterBar}
 * continues the same blue block beneath it and carries the rounding.
 */
export function ReportHeader({ title, subtitle, icon: _icon, asOf, actions, hero }: {
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
      <MobileWallpaper />

      {/* Phones: the mockup's hero. */}
      <div className="rp-hero sm:hidden">
        <span aria-hidden className="rp-hero-sheen" />
        <span aria-hidden className="rp-hero-grid" />
        <p className="rp-hero-sub relative">{asOfText ? `as of ${asOfText}` : subtitle}</p>
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

      {/* Desktop: the mockup's header row, less the name the topbar shows. */}
      <div aria-hidden className="pd-backdrop max-sm:hidden" />
      <div className="hidden flex-wrap items-center gap-3.5 sm:flex">
        <p className="rd-sub mr-auto min-w-0">{subtitle}</p>
        {asOfText && <span className="rd-asof">as of {asOfText}</span>}
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const ARROW = { up: '↑', down: '↓', flat: '→' } as const;

/**
 * The desktop hero: the report's headline figure with its chip, hint and bar,
 * and four glass tiles beside it — the CRM desk's blue band (`.pd-hero`), as
 * every desktop report mockup opens. Rendered after the filter bar, because
 * the filters are what these figures answer to. Nothing on a phone, where
 * {@link ReportHeader} carries the headline.
 */
export function ReportDeskHero({ hero, children }: { hero?: ReportHero; children?: ReactNode }) {
  if (!hero) return <div className="pd-hero h-[132px] animate-pulse max-sm:hidden" aria-hidden />;
  const chip = hero.chip ?? (hero.delta ? { text: `${ARROW[hero.delta.dir]} ${hero.delta.text} vs prev.`, tone: hero.delta.dir === 'down' ? 'bad' : hero.delta.dir === 'up' ? 'good' : 'neutral' } : undefined);
  const chipColor = chip?.tone === 'bad' ? 'text-rose-700' : chip?.tone === 'good' ? 'text-emerald-700' : 'text-slate-600';
  return (
    <section className="pd-hero max-sm:hidden">
      <div className="flex flex-wrap items-center gap-[18px]">
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
          <span className="pd-hero-label">{hero.label}</span>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="pd-hero-value">{hero.value}</span>
            {chip && <span className={cn('pd-hero-chip', chipColor)}>{chip.text}</span>}
          </div>
          {hero.hint && <span className="pd-hero-hint">{hero.hint}</span>}
          {hero.bar && (
            <div className="mt-0.5 flex max-w-[360px] items-center gap-2.5">
              <div className="pd-hero-track">
                <span
                  style={{
                    width: `${Math.max(0, Math.min(100, hero.bar.pct))}%`,
                    background: hero.bar.tone === 'good' ? 'linear-gradient(90deg,#b9f6dc,#6ee7b7)' : undefined,
                  }}
                />
              </div>
              <span className="text-[11.5px] font-bold whitespace-nowrap text-white/85">{hero.bar.label}</span>
            </div>
          )}
        </div>
        {hero.stats && hero.stats.length > 0 && (
          <div className="grid flex-[2_1_520px] grid-cols-2 gap-2.5 lg:grid-cols-4">
            {hero.stats.map((s) => (
              <div key={s.label} className="pd-hero-stat min-w-0">
                <div className="pd-hero-stat-label"><span className="size-[7px] shrink-0 rounded-full" style={{ background: s.dot }} /><span className="truncate">{s.label}</span></div>
                <div className="flex items-baseline gap-1.5">
                  <span className="pd-hero-stat-value whitespace-nowrap">{s.value}</span>
                  {s.delta && (
                    <span className={cn('text-[11px] font-extrabold whitespace-nowrap', s.delta.dir === 'down' ? 'text-rose-200' : 'text-emerald-200')}>
                      {ARROW[s.delta.dir]} {s.delta.text}
                    </span>
                  )}
                </div>
                {s.hint && <div className="pd-hero-stat-hint truncate">{s.hint}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* The foot: switches and actions that belong on the blue. */}
      {children && <div className="pd-hero-foot">{children}</div>}
    </section>
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
 * Wraps a page's KPIs: the phone's two-column tile grid, and on desktop the
 * mockup's KPI strip — one glass bar, a column per figure. `deskHidden` is for
 * figures the desktop hero already shows, which the phone still lists here.
 */
export function KpiGrid({ className, children, deskHidden }: { className?: string; children: ReactNode; deskHidden?: boolean }) {
  return <div className={cn('rp-kpis', deskHidden ? 'sm:hidden' : 'rd-strip', className)}>{children}</div>;
}

const KPI_DOT: Record<KpiTone, string> = { blue: '#4f6ef7', emerald: '#10b981', amber: '#f59e0b', violet: '#8b5cf6', rose: '#f43f5e', slate: '#94a3b8' };

/** Compact headline KPI — a glass tile on a phone, the plain card on desktop. */
export function Kpi({ label, value, hint, icon: _icon, tone = 'blue', metric, loading, title, deskHidden }: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: KpiTone;
  metric?: PeriodMetric;
  loading?: boolean;
  title?: string;
  /** Already on the desktop hero: listed on the phone only. */
  deskHidden?: boolean;
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

      {/* Desktop: a cell of the KPI strip */}
      {!deskHidden && (
        <div className="rd-cell hidden">
          <span className="rd-cell-label"><span className="size-[7px] shrink-0 rounded-full" style={{ background: KPI_DOT[tone] }} />{label}</span>
          <span className="flex flex-wrap items-center gap-2">
            {loading ? <span className="h-6 w-20 animate-pulse rounded bg-slate-900/10" /> : <span className="rd-cell-value" title={title}>{value}</span>}
            {deltaText && !loading && (
              <span
                className={cn(
                  'rd-delta',
                  metric!.direction === 'up' ? 'bg-emerald-50 text-emerald-700' : metric!.direction === 'down' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600',
                )}
              >
                {ARROW[metric!.direction === 'up' ? 'up' : metric!.direction === 'down' ? 'down' : 'flat']} {deltaText.replace(/^[+-]/, '')}
              </span>
            )}
          </span>
          {hint && <span className="rd-hint">{hint}</span>}
        </div>
      )}
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
export function RankedBars({ data, money = true, emptyText = 'No data.', subFor, unit, cols = 1, colorFor, format }: {
  data: ReportSlice[];
  money?: boolean;
  emptyText?: string;
  /** Overrides the "x% of top" line under each bar. */
  subFor?: (d: ReportSlice) => string;
  /** Desktop: a small word before each value ("orders"). */
  unit?: string;
  /** Desktop: split the list into two side-by-side columns. */
  cols?: 1 | 2;
  /** Desktop: a fixed colour per row (bank blue / cash green) instead of the cycle. */
  colorFor?: (d: ReportSlice) => string;
  /** Desktop: how a value is written, when it is neither money nor a count ("14.2%"). */
  format?: (v: number) => string;
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

      {/* Desktop: the mockup's rows — name and value over an 8px track. A
          second column restarts the colour cycle, as the mockup's does. */}
      <div className="hidden sm:block">
        {split && <ChartLegend items={[{ label: 'Bank', color: DESK_BANK }, { label: 'Cash', color: DESK_CASH }]} />}
        <div className={cn(cols === 2 && 'grid grid-cols-2 gap-x-9 gap-y-3')}>
          {(cols === 2 ? [data.slice(0, Math.ceil(data.length / 2)), data.slice(Math.ceil(data.length / 2))] : [data]).map((part, c) => (
            <div key={c} className="rd-bars">
              {part.map((d, i) => {
                const bank = d.bank ?? 0;
                const cash = d.cash ?? 0;
                const color = colorFor?.(d) ?? DESK_COLORS[i % DESK_COLORS.length];
                // A column's own leader is its 100%, as in the mockup's second column.
                const top = Math.max(...part.map((x) => x.value), 1);
                return (
                  <div key={d.name} className="flex min-w-0 flex-col gap-[5px]">
                    <div className="rd-bar-head">
                      <span className="rd-bar-name" title={d.name}>{d.name}</span>
                      <span className="rd-bar-value" title={money ? inrFull(d.value) : undefined}>
                        {unit && <span className="rd-bar-unit">{unit}</span>}
                        {format ? format(d.value) : fmt(d.value)}
                        {split && <span className="rd-bar-unit ml-1.5 mr-0">{fmt(bank)} · {fmt(cash)}</span>}
                      </span>
                    </div>
                    <div className="rd-track">
                      {split ? (
                        <>
                          <span style={{ width: `${(bank / top) * 100}%`, background: DESK_BANK }} />
                          <span style={{ width: `${(cash / top) * 100}%`, background: DESK_CASH }} />
                        </>
                      ) : (
                        <span className="rounded-full" style={{ width: `${(d.value / top) * 100}%`, background: `linear-gradient(90deg,${color}cc,${color})` }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** A titled report section — the mockup's glass card on a phone, the plain
 *  bordered card on desktop. `note` is the small grey line the mockup puts
 *  under a chart to explain it. */
export function ReportCard({ title, children, right, note, flush }: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
  note?: ReactNode;
  /** Desktop: no body padding — for a table that runs edge to edge. */
  flush?: boolean;
}) {
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

      {/* Desktop: the mockup's glass card. The wrapper does the hiding, since
          `.rd-card` sets its own display. */}
      <div className="hidden sm:contents">
        <section className="rd-card rd-rise">
          <header className="rd-card-head">
            <h3 className="rd-card-title">{title}</h3>
            {right && <div className="rd-card-right">{right}</div>}
          </header>
          <div className="rd-card-body" data-flush={flush}>{children}</div>
          {note && <p className="rd-note">{note}</p>}
        </section>
      </div>
    </>
  );
}

export type InsightTone = 'good' | 'warn' | 'bad' | 'info';
const DOT_HEX: Record<InsightTone, string> = { good: '#059669', warn: '#d97706', bad: '#e11d48', info: '#2563eb' };

/** How each insight tone reads on the desktop Summary: its tag, its top bar,
 *  the colour of its figure, and the count chip in the header. */
const INSIGHT: Record<InsightTone, { tag: string; count: string; bar: string; value: string; pill: string; chip: string; dot: string }> = {
  bad: { tag: 'Act now', count: 'act now', bar: '#f43f5e', value: 'text-rose-700 dark:text-rose-300', pill: 'bg-rose-50 text-rose-700', chip: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200', dot: '#f43f5e' },
  warn: { tag: 'Watch', count: 'watch', bar: '#f59e0b', value: 'text-amber-700 dark:text-amber-300', pill: 'bg-amber-50 text-amber-700', chip: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200', dot: '#f59e0b' },
  good: { tag: 'On track', count: 'on track', bar: '#10b981', value: 'text-emerald-700 dark:text-emerald-300', pill: 'bg-emerald-50 text-emerald-700', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200', dot: '#10b981' },
  info: { tag: 'Note', count: 'note', bar: '#4f6ef7', value: '', pill: 'bg-indigo-50 text-[#3b4fd8]', chip: 'bg-indigo-50 text-[#3b4fd8] ring-1 ring-inset ring-indigo-200', dot: '#4f6ef7' },
};
const TONE_ORDER: InsightTone[] = ['bad', 'warn', 'good', 'info'];

export interface SummaryPoint {
  /** The phone's sentence. */
  text: ReactNode;
  tone?: InsightTone;
  /** Desktop: the tile's headline figure and its sentence, as the mockup
   *  splits them. Without it the tile shows `text` alone. */
  desk?: { value: string; text: ReactNode };
}

/** Plain-English "Summary" card — auto-generated takeaways from a report's data. */
export function ReportSummary({ points, loading, title = 'Summary' }: { points: SummaryPoint[]; loading?: boolean; title?: string }) {
  const counts = TONE_ORDER.map((t) => [t, points.filter((p) => (p.tone ?? 'info') === t).length] as const).filter(([, n]) => n > 0);
  return (
    <>
      {/* Phones */}
      <div className="rp-summary sm:hidden">
        <span aria-hidden className="rp-summary-glow" />
        <div className="relative mb-3 flex items-center gap-2.5">
          <span className="rp-summary-icon"><Lightbulb className="size-3.5" /></span>
          <div className="rp-summary-title">{title}</div>
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

      {/* Desktop: the mockup's Summary — tone counts up top, one tile each. */}
      <div className="hidden sm:contents">
        <section className="rd-summary">
          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <span className="rd-summary-icon" aria-hidden>✦</span>
            <span className="text-[15px] font-extrabold">{title}</span>
            <span className="flex-1" />
            {!loading && counts.map(([t, n]) => (
              <span key={t} className={cn('rd-count', INSIGHT[t].chip)}>
                <span className="size-1.5 rounded-full" style={{ background: INSIGHT[t].dot }} />
                {n} {INSIGHT[t].count}
              </span>
            ))}
          </div>
          {loading ? (
            <div className="rd-insights">{[0, 1, 2, 3].map((i) => <div key={i} className="rd-insight h-[92px] animate-pulse" />)}</div>
          ) : points.length === 0 ? (
            <p className="rd-insight-text">Not enough data yet to summarise.</p>
          ) : (
            // Six read as 3 + 3 and four as one row, as in the mockups.
            <div className="rd-insights" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${points.length > 4 && points.length % 3 === 0 ? 280 : 220}px), 1fr))` }}>
              {points.map((p, i) => {
                const t = INSIGHT[p.tone ?? 'info'];
                return (
                  <div key={i} className="rd-insight rd-rise" style={delay(i * 45)}>
                    <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: t.bar }} />
                    <div className="flex items-center justify-between gap-2">
                      {p.desk ? <span className={cn('rd-insight-value', t.value)}>{p.desk.value}</span> : <span />}
                      <span className={cn('rd-tag', t.pill)}>{t.tag}</span>
                    </div>
                    <p className="rd-insight-text">{p.desk ? p.desk.text : p.text}</p>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
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
      <div className="mb-3 hidden sm:block">
        <div className="rd-seg rd-seg-sm" role="tablist">
          {options.map((o) => (
            <button key={o} type="button" role="tab" aria-selected={value === o} data-on={value === o} className="rd-seg-btn" onClick={() => onChange(o)}>
              {o}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/** Stat chips — the recovery pipeline and the party segments, two-up. */
/** The mockup's tinted pipeline tiles, desktop side: Tailwind's 50 / 200 / 700. */
const CHIP_DESK: Record<KpiTone, string> = {
  rose: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/15',
  blue: 'bg-indigo-50 text-blue-800 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-400/25',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/25',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25',
};

export function ReportChips({ chips, unit }: { chips: { label: string; count: string; value?: string; tone: KpiTone }[]; unit?: string }) {
  return (
    <>
      <div className="rp-chips sm:hidden">
        {chips.map((c, i) => (
          <div key={c.label} className="rp-chip max-sm:!block" style={{ ...toneSurface(c.tone), ...delay(60 + i * 45) }}>
            <div className="rp-chip-label">{c.label}</div>
            <div className="rp-chip-count">{c.count}</div>
            {c.value && <div className="rp-chip-value">{c.value}</div>}
          </div>
        ))}
      </div>
      <div className="hidden gap-2.5 sm:grid" style={{ gridTemplateColumns: `repeat(${Math.min(chips.length, 6)}, minmax(0,1fr))` }}>
        {chips.map((c, i) => (
          <div key={c.label} className={cn('rd-rise min-w-0 rounded-[14px] px-[13px] py-[11px] ring-1 ring-inset', CHIP_DESK[c.tone])} style={delay(i * 45)}>
            <div className="truncate text-[11.5px] font-bold">{c.label}</div>
            <div className="mt-[3px] flex items-baseline gap-1.5">
              <span className="text-[22px] font-extrabold tabular-nums">{c.count}</span>
              {unit && <span className="text-[11.5px] font-semibold opacity-80">{unit}</span>}
            </div>
            {c.value && <div className="text-[12.5px] font-bold tabular-nums opacity-85">{c.value}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

/** A value funnel — ordered → dispatched → billed, each a fat proportional bar. */
export function ReportFunnel({ steps }: { steps: { label: string; value: string; ratio: number; from: string; to: string }[] }) {
  return (
    <>
    {/* Desktop: the mockup's stage bars. */}
    <div className="hidden flex-col gap-4 sm:flex">
      {steps.map((s, i) => (
        <div key={s.label}>
          <div className="mb-1.5 flex items-baseline gap-2.5">
            <span className="flex-1 text-[13px] font-bold">{s.label}</span>
            <span className="text-[17px] font-extrabold tabular-nums">{s.value}</span>
            <span className="w-11 text-right text-xs font-extrabold text-[#7a849c]">{Math.round(s.ratio * 100)}%</span>
          </div>
          <div className="rd-stage-track">
            <div className="rd-rise" style={{ width: `${Math.max(s.ratio, 0) * 100}%`, background: `linear-gradient(90deg,${s.from},${s.to})`, ...delay(90 + i * 120) }} />
          </div>
        </div>
      ))}
    </div>
    <div className="rp-funnel sm:hidden">
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
    </>
  );
}

/**
 * A category mix as the desktop mockups draw it: a ring (a CSS conic
 * gradient, hairline gaps between slices) with the total in its hole, and a
 * legend of swatch, name, value and share beside it.
 */
export function ReportDonut({ data, emptyText = 'No data yet.', center = 'Total', money = true, colorFor, cols = 1 }: {
  data: ReportSlice[];
  emptyText?: string;
  /** The word in the ring's hole, over the total. */
  center?: string;
  /** False for counts (parties), which also drops the share column. */
  money?: boolean;
  /** A fixed colour per slice (segments have their own) instead of the cycle. */
  colorFor?: (d: ReportSlice) => string;
  /** The legend in two columns, for a long list of short names. */
  cols?: 1 | 2;
}) {
  const total = data.reduce((t, d) => t + Math.max(0, d.value), 0);
  if (!data.length || total <= 0) return <div className="text-muted-foreground py-8 text-center text-sm">{emptyText}</div>;
  const color = (d: ReportSlice, i: number) => colorFor?.(d) ?? DESK_COLORS[i % DESK_COLORS.length];
  const fmt = (v: number) => (money ? inrCompact(v) : Math.round(v).toLocaleString('en-IN'));
  let at = 0;
  const stops: string[] = [];
  data.forEach((d, i) => {
    const deg = (Math.max(0, d.value) / total) * 360;
    const gap = Math.min(0.8, deg / 3);
    stops.push(`${color(d, i)} ${at}deg ${at + deg - gap}deg`, `var(--rd-gap) ${at + deg - gap}deg ${at + deg}deg`);
    at += deg;
  });
  return (
    <div className="flex flex-wrap items-center gap-[22px]">
      <div className="rd-donut" style={{ background: `conic-gradient(${stops.join(', ')})` }}>
        <div className="rd-donut-hole">
          <span className="text-[10.5px] font-extrabold tracking-[0.08em] text-[#7a849c] uppercase">{center}</span>
          <span className="text-[19px] font-extrabold tabular-nums" title={money ? inrFull(total) : undefined}>{fmt(total)}</span>
        </div>
      </div>
      <div className={cn('min-w-[220px] flex-[1_1_240px] gap-2', cols === 2 ? 'grid grid-cols-2 gap-x-5' : 'flex flex-col')}>
        {data.map((d, i) => (
          <div key={d.name} className="rd-donut-row" style={money ? undefined : { gridTemplateColumns: '10px minmax(0,1fr) auto' }}>
            <span className="size-2.5 rounded-[3px]" style={{ background: color(d, i) }} />
            <span className="truncate font-semibold" title={d.name}>{d.name}</span>
            <span className="font-extrabold tabular-nums" title={money ? inrFull(d.value) : undefined}>{fmt(d.value)}</span>
            {money && <span className="text-right text-[11.5px] font-bold text-[#7a849c] tabular-nums">{Math.round((d.value / total) * 100)}%</span>}
          </div>
        ))}
      </div>
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
