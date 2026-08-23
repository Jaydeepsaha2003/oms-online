import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  ChevronRight,
  ClipboardList,
  FileText,
  Loader2,
  type LucideIcon,
  Truck,
  Undo2,
  Users,
} from 'lucide-react';
import type { JourneyChallan, JourneyDispatch, JourneyEvent, JourneyOrder, JourneyStage, OrderJourneyReport } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { Card, CardContent } from '@/components/ui/card';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { ReportFilterBar, useReportFilters } from './report-filters';
import { ReportCard, ReportSummary } from './report-kit';
import { useOrderJourney } from './use-reports';

/* ── stage vocabulary ────────────────────────────────────────────────────────
   One place decides what each stage is called, coloured and iconed, so the
   funnel, the order rows and the timeline can never describe the same stage
   two different ways. */

type StageKey = JourneyStage['key'];

const STAGE: Record<StageKey, { icon: LucideIcon; ring: string; fill: string; text: string; bar: string; soft: string }> = {
  ORDERS: {
    icon: ClipboardList,
    ring: 'ring-blue-200 dark:ring-blue-400/25',
    fill: 'from-blue-500 to-blue-600',
    text: 'text-blue-700 dark:text-blue-300',
    bar: 'bg-blue-500',
    soft: 'bg-blue-50 dark:bg-blue-500/10',
  },
  DISPATCHED: {
    icon: Truck,
    ring: 'ring-violet-200 dark:ring-violet-400/25',
    fill: 'from-violet-500 to-violet-600',
    text: 'text-violet-700 dark:text-violet-300',
    bar: 'bg-violet-500',
    soft: 'bg-violet-50 dark:bg-violet-500/10',
  },
  CHALLAN: {
    icon: FileText,
    ring: 'ring-emerald-200 dark:ring-emerald-400/25',
    fill: 'from-emerald-500 to-emerald-600',
    text: 'text-emerald-700 dark:text-emerald-300',
    bar: 'bg-emerald-500',
    soft: 'bg-emerald-50 dark:bg-emerald-500/10',
  },
  RETURNS: {
    icon: Undo2,
    ring: 'ring-rose-200 dark:ring-rose-400/25',
    fill: 'from-rose-500 to-rose-600',
    text: 'text-rose-700 dark:text-rose-300',
    bar: 'bg-rose-500',
    soft: 'bg-rose-50 dark:bg-rose-500/10',
  },
};

const ORDER_STAGE_STYLE: Record<JourneyOrder['stage'], string> = {
  PENDING: 'bg-slate-100 text-slate-700 ring-slate-300 dark:bg-white/10 dark:text-slate-300 dark:ring-white/15',
  PARTIAL: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25',
  DISPATCHED: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/25',
  BILLED: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25',
  RETURNED: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25',
};

const num = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * A number that counts up to its value once, on mount.
 *
 * Deliberately time-based rather than step-based: a count that takes the same
 * ~0.9s whether it is climbing to 8 or to 84,000 reads as one deliberate motion
 * across the whole page, instead of small numbers snapping while big ones crawl.
 */
function CountUp({ to, format = num, delay = 0 }: { to: number; format?: (v: number) => string; delay?: number }) {
  const [v, setV] = useState(0);
  const raf = useRef<number | undefined>(undefined);
  useEffect(() => {
    // Respect the OS setting — no animation, just the final figure.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setV(to);
      return;
    }
    const DURATION = 900;
    let start: number | null = null;
    const timer = window.setTimeout(() => {
      const tick = (t: number) => {
        start ??= t;
        const p = Math.min(1, (t - start) / DURATION);
        // easeOutCubic — fast off the mark, settling gently on the real figure.
        setV(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf.current = requestAnimationFrame(tick);
        else setV(to);
      };
      raf.current = requestAnimationFrame(tick);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [to, delay]);
  return <>{format(v)}</>;
}

/* ── one type scale, used by every card ──────────────────────────────────────
   Arbitrary per-element sizes are what made the four cards read as four
   different designs. These five tokens are the only sizes the stage cards use. */
const T = {
  label: 'text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground',
  big: 'text-[26px] font-extrabold leading-none tabular-nums',
  bigUnit: 'text-[11px] font-semibold tracking-normal text-muted-foreground',
  rowKey: 'text-[11.5px] font-medium text-muted-foreground',
  rowVal: 'text-[12.5px] font-bold tabular-nums',
  caption: 'text-[11px] font-semibold text-muted-foreground',
} as const;

/** The noun that follows a stage's headline count. */
const DOC_NOUN: Record<StageKey, string> = {
  ORDERS: 'orders',
  DISPATCHED: 'dispatches',
  CHALLAN: 'challans',
  RETURNS: 'credit notes',
};

/**
 * One metric row.
 *
 * Rendered on EVERY card whether or not the stage has that figure — an absent
 * row shows an em dash instead of collapsing. Conditionally dropping rows is
 * what left the four cards ragged: different row counts meant different heights
 * and no shared baseline, so "Lines" on one card sat next to "Value" on the one
 * beside it.
 */
function MetricRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={T.rowKey}>{label}</span>
      <span className={T.rowVal}>{children}</span>
    </div>
  );
}

const DASH = <span className="text-muted-foreground/40 font-normal">—</span>;

/** One of the four stage cards. All four render the identical skeleton. */
function StageCard({ s, index, unit, dispatchDocs }: { s: JourneyStage; index: number; unit: string; dispatchDocs: number }) {
  const st = STAGE[s.key];
  const Icon = st.icon;
  const delay = index * 160;

  const qty = s.key === 'CHALLAN' ? null : unit === 'kgs' ? s.kgs : unit === 'pcs' ? s.pcs : s.bags;

  /*
   * Every card carries a footer bar, so all four are the same height and the
   * funnel reads across in one line. Each states its OWN basis rather than
   * borrowing another stage's: Ordered is the baseline it is all measured
   * against, Billed is a share of dispatch lines (it bills documents, not kgs),
   * and the other two are shares of the ordered quantity.
   */
  const footer: { pct: number; text: string } = (() => {
    if (s.key === 'ORDERS') return { pct: 1, text: `baseline · ${s.docs} order${s.docs === 1 ? '' : 's'}` };
    if (s.key === 'CHALLAN') {
      const p = dispatchDocs > 0 ? Math.min(1, s.lines / dispatchDocs) : 0;
      return { pct: p, text: `${s.lines} of ${dispatchDocs} dispatches billed` };
    }
    const p = s.ofFirst ?? 0;
    return { pct: p, text: `${Math.round(p * 100)}% of ordered ${unit}` };
  })();

  return (
    <div
      className={cn(
        'bg-card animate-journey-rise relative flex flex-1 flex-col overflow-hidden rounded-2xl border p-4 shadow-sm ring-1 ring-inset',
        st.ring,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* One pass of light as the card lands. Decorative only — hidden from
          assistive tech, and disabled under prefers-reduced-motion. */}
      <span
        aria-hidden
        className="animate-journey-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/20"
        style={{ animationDelay: `${delay + 220}ms` }}
      />

      {/* Head — fixed two-line block, so the divider below starts level on all
          four cards regardless of how long the label is. */}
      <div className="flex items-center gap-2.5">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm', st.fill)}>
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0">
          <div className={T.label}>{s.label}</div>
          <div className={cn(T.big, st.text)}>
            <CountUp to={s.docs} delay={delay} />
            <span className={cn('ml-1.5', T.bigUnit)}>{DOC_NOUN[s.key]}</span>
          </div>
        </div>
      </div>

      {/* Body — the same three rows, in the same order, on every card. */}
      <div className="mt-3 space-y-1.5 border-t pt-3">
        <MetricRow label="Quantity">
          {qty == null ? (
            DASH
          ) : (
            <>
              <CountUp to={qty} delay={delay} /> <span className="text-muted-foreground text-[10.5px] font-semibold">{unit}</span>
            </>
          )}
        </MetricRow>
        <MetricRow label="Value">
          {s.amount > 0 ? (
            <span title={inrFull(s.amount)}>
              <CountUp to={s.amount} format={inrCompact} delay={delay} />
            </span>
          ) : (
            DASH
          )}
        </MetricRow>
        <MetricRow label="Lines">{s.lines > 0 ? <CountUp to={s.lines} delay={delay} /> : DASH}</MetricRow>
      </div>

      {/* Footer — pinned to the bottom (mt-auto) so the bars line up across the
          row even if a card's body ever grows. */}
      <div className="mt-auto pt-3">
        <div className={cn('h-1.5 overflow-hidden rounded-full', st.soft)} aria-hidden>
          <div
            className={cn('animate-journey-fill h-full rounded-full', st.bar)}
            style={{ width: `${Math.round(footer.pct * 100)}%`, animationDelay: `${delay + 260}ms` }}
          />
        </div>
        <div className={cn('mt-1.5', T.caption)}>{footer.text}</div>
      </div>
    </div>
  );
}

/** The arrow between two stage cards, drawn after the left card has landed. */
function Connector({ index }: { index: number }) {
  return (
    <div className="hidden shrink-0 items-center self-center lg:flex" aria-hidden>
      <span
        className="animate-journey-draw bg-gradient-to-r from-slate-300 to-slate-400 dark:from-white/20 dark:to-white/30 block h-0.5 w-7 rounded-full"
        style={{ animationDelay: `${index * 160 + 120}ms` }}
      />
      <ArrowRight
        className="text-muted-foreground/70 animate-journey-rise -ml-1 size-4"
        style={{ animationDelay: `${index * 160 + 260}ms` }}
      />
    </div>
  );
}

/** One order, as a track showing how far down the pipeline it got. */
function OrderTrack({ o, unit, index }: { o: JourneyOrder; unit: string; index: number }) {
  const [open, setOpen] = useState(false);
  const ordered = unit === 'kgs' ? o.kgs : unit === 'pcs' ? o.pcs : o.bags;
  const shipped = unit === 'kgs' ? o.dispKgs : unit === 'pcs' ? o.dispPcs : o.dispBags;
  const returned = unit === 'kgs' ? o.returnedKgs : unit === 'pcs' ? o.returnedPcs : o.returnedBags;
  const pct = Math.round(o.progress * 100);
  // Stagger only the first rows: past ~20 the delay would outlast the reader's
  // patience and the last rows would look broken rather than choreographed.
  const delay = Math.min(index, 20) * 45;

  return (
    <div
      className={cn(
        'animate-journey-rise bg-card rounded-xl border shadow-sm transition-colors',
        open && 'ring-primary/30 ring-1',
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* The whole summary is the toggle — a row this wide with one small caret
          would make people hunt for the hit area. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="hover:bg-muted/40 w-full cursor-pointer rounded-xl px-3 py-2.5 text-left transition-colors"
      >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ChevronRight className={cn('text-muted-foreground size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="text-[13px] font-bold tabular-nums text-indigo-700 dark:text-indigo-300">
          {o.orderCode ?? `ORD-${o.orderId}`}
        </span>
        <span className="text-muted-foreground text-[11.5px] font-medium tabular-nums">{formatDate(o.orderDate)}</span>
        {o.priority === 'URGENT' && (
          <span className="rounded-[4px] bg-rose-50 px-1.5 py-0.5 text-[10.5px] font-extrabold text-rose-700 ring-1 ring-rose-200 ring-inset dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25">
            URGENT
          </span>
        )}
        <span
          className={cn(
            'rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-extrabold ring-1 ring-inset',
            ORDER_STAGE_STYLE[o.stage],
          )}
        >
          {o.stage}
        </span>
        <span className="text-muted-foreground ml-auto text-[11.5px] font-semibold tabular-nums">
          {num(shipped)} / {num(ordered)} {unit}
        </span>
      </div>

      {/* Ordered is the track; dispatched fills it; returns sit on top in rose. */}
      <div className="bg-muted relative mt-2 h-2 overflow-hidden rounded-full">
        <div
          className="animate-journey-fill h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-600"
          style={{ width: `${pct}%`, animationDelay: `${delay + 120}ms` }}
        />
        {returned > 0 && ordered > 0 && (
          <div
            className="animate-journey-fill absolute inset-y-0 right-0 rounded-full bg-gradient-to-r from-rose-400 to-rose-500"
            style={{ width: `${Math.min(100, (returned / ordered) * 100)}%`, animationDelay: `${delay + 320}ms` }}
            title={`${num(returned)} ${unit} returned`}
          />
        )}
      </div>

      <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-medium">
        <span>{o.lines} lines</span>
        <span>· {pct}% dispatched</span>
        {o.challanCodes.length > 0 && (
          <span className="text-emerald-700 dark:text-emerald-400">
            · Billed on {o.challanCodes.join(', ')}
            {o.billedAmount > 0 ? ` (${inrCompact(o.billedAmount)})` : ''}
          </span>
        )}
        {o.returns > 0 && (
          <span className="text-rose-700 dark:text-rose-400">
            · {num(returned)} {unit} returned
          </span>
        )}
        {o.stage === 'PENDING' && <span className="text-amber-700 dark:text-amber-400">· nothing dispatched yet</span>}
        <span className="text-muted-foreground/70 ml-auto">
          {o.dispatchList.length ? `${open ? 'Hide' : 'Show'} ${o.dispatchList.length} dispatch${o.dispatchList.length === 1 ? '' : 'es'}` : ''}
        </span>
      </div>
      </button>

      {open && <OrderDetail o={o} unit={unit} />}
    </div>
  );
}

/**
 * What actually moved under one order, and when each movement was billed.
 *
 * The summary row answers "how far did this order get"; this answers "out of
 * what, exactly" — which dispatch, on what date, on whose challan. Returns are
 * listed alongside rather than in a separate block, because the point is the
 * chronology: a return only makes sense next to the dispatch it came back from.
 */
function DispatchDetail({ rows, unit }: { rows: JourneyDispatch[]; unit: string }) {
  if (!rows.length) {
    return (
      <p className="text-muted-foreground py-3 text-center text-[12px] font-medium">
        Nothing dispatched against this order yet.
      </p>
    );
  }
  const qtyOf = (d: JourneyDispatch) => (unit === 'kgs' ? d.kgs : unit === 'pcs' ? d.pcs : d.bags) ?? 0;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-0">
        <table className="w-full min-w-max text-[12px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className={TH}>Dispatch</th>
              <th className={TH}>Date</th>
              <th className={TH}>Item</th>
              <th className={THR}>Qty</th>
              <th className={TH}>Challan</th>
              <th className={TH}>Billed on</th>
            </tr>
          </thead>
          <tbody className="[&_td]:border-t [&_td]:border-slate-200 [&_td]:py-1.5 [&_td]:pr-3 dark:[&_td]:border-white/10">
            {rows.map((d) => (
              <tr key={d.id} className={cn(d.isReturn && 'bg-rose-50/50 dark:bg-rose-500/[0.07]')}>
                <td className="font-bold tabular-nums">
                  <span className={d.isReturn ? 'text-rose-700 dark:text-rose-400' : 'text-indigo-700 dark:text-indigo-300'}>
                    {d.code ?? `#${d.id}`}
                  </span>
                </td>
                <td className="text-muted-foreground font-medium tabular-nums whitespace-nowrap">{formatDate(d.date)}</td>
                <td className="font-semibold">
                  {d.productName ?? '—'}
                  {d.design && <span className="text-muted-foreground ml-1 font-normal">· {d.design}</span>}
                </td>
                {/* A return carries negative quantities — shown signed, because
                    the sign is the fact. */}
                <td className={cn('text-right font-bold tabular-nums', d.isReturn && 'text-rose-700 dark:text-rose-400')}>
                  {num(qtyOf(d))} <span className="text-muted-foreground text-[10.5px] font-semibold">{unit}</span>
                </td>
                <td className="font-semibold">
                  {d.isReturn ? (
                    <span className="text-rose-700 dark:text-rose-400">Returned on {d.creditNoteCode ?? 'a credit note'}</span>
                  ) : d.challanCode ? (
                    <span className="text-emerald-700 dark:text-emerald-400">{d.challanCode}</span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400">Not billed yet</span>
                  )}
                </td>
                <td className="text-muted-foreground font-medium tabular-nums whitespace-nowrap">
                  {d.challanDate ? formatDate(d.challanDate) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Shared chrome for the three groups, so they read as one sequence. */
function Group({
  n,
  title,
  count,
  children,
}: {
  n: number;
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <header className="mb-1.5 flex items-center gap-2">
        <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold tabular-nums">
          {n}
        </span>
        <h4 className="text-[11px] font-bold tracking-[0.09em] text-slate-600 uppercase dark:text-slate-300">{title}</h4>
        <span className="text-muted-foreground text-[11px] font-semibold tabular-nums">{count}</span>
      </header>
      {children}
    </section>
  );
}

const TH = 'py-1 pr-3 text-left text-[10px] font-bold tracking-wide uppercase';
const THR = 'py-1 pr-3 text-right text-[10px] font-bold tracking-wide uppercase';
const TD = '[&_td]:border-t [&_td]:border-slate-200 [&_td]:py-1.5 [&_td]:pr-3 dark:[&_td]:border-white/10';

/** A quantity in whichever units the row actually carries — a line ordered in
 *  pcs must not be reported in bags just because bags is the page's unit. */
function Qty({ bags, pcs, kgs, box }: { bags?: number | null; pcs?: number | null; kgs?: number | null; box?: number | null }) {
  const parts = [
    [bags, 'b'],
    [pcs, 'pcs'],
    [kgs, 'kg'],
    [box, 'box'],
  ].filter(([v]) => !!v) as [number, string][];
  if (!parts.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular-nums whitespace-nowrap">
      {parts.map(([v, u], i) => (
        <span key={u}>
          {i > 0 && <span className="text-muted-foreground"> · </span>}
          {num(v)}
          <span className="text-muted-foreground ml-0.5 text-[10px] font-semibold">{u}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * What an opened order row shows: the same work in the three stages it passes
 * through — ORDERED, then DISPATCHED, then BILLED.
 *
 * Grouped rather than run together because each stage answers a different
 * question and is measured in different things: an order line is a promise with
 * a quantity still owed, a dispatch is a physical movement on a date, a challan
 * is a money document with charges and tax. One flat table forced all three into
 * the same columns and served none of them.
 */
function OrderDetail({ o, unit }: { o: JourneyOrder; unit: string }) {
  return (
    <div className="space-y-4 border-t bg-slate-50/60 px-3 py-3 dark:bg-white/[0.02]">
      {/* 1 — what was asked for, and what is still owed on each line */}
      <Group n={1} title="Ordered" count={o.orderLines.length}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-[12px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className={TH}>Item</th>
                <th className={TH}>Design</th>
                <th className={THR}>Ordered</th>
                <th className={THR}>Dispatched</th>
                <th className={THR}>Still owed</th>
                <th className={THR}>Rate</th>
                <th className={THR}>Amount</th>
              </tr>
            </thead>
            <tbody className={TD}>
              {o.orderLines.map((l) => {
                const owed = !!(l.remBags || l.remPcs || l.remKgs || l.remBox);
                return (
                  <tr key={l.id}>
                    <td className="font-semibold">{l.productName ?? '—'}</td>
                    <td className="text-muted-foreground">{l.design ?? '—'}</td>
                    <td className="text-right"><Qty bags={l.bags} pcs={l.pcs} kgs={l.kgs} box={l.box} /></td>
                    <td className="text-right"><Qty bags={l.dispBags} pcs={l.dispPcs} kgs={l.dispKgs} box={l.dispBox} /></td>
                    {/* The only figure here anyone acts on, so it is the only one coloured. */}
                    <td className={cn('text-right font-bold', owed ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400')}>
                      {owed ? <Qty bags={l.remBags} pcs={l.remPcs} kgs={l.remKgs} box={l.remBox} /> : 'clear'}
                    </td>
                    <td className="text-right tabular-nums">{l.rate != null ? inrCompact(l.rate) : '—'}</td>
                    <td className="text-right font-semibold tabular-nums">{inrCompact(l.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Group>

      {/* 2 — what physically moved */}
      <Group n={2} title="Dispatches" count={o.dispatchList.length}>
        <DispatchDetail rows={o.dispatchList} unit={unit} />
      </Group>

      {/* 3 — what was billed, document by document */}
      <Group n={3} title="Challans" count={o.challanList.length}>
        {o.challanList.length === 0 ? (
          <p className="text-muted-foreground py-3 text-center text-[12px] font-medium">Nothing billed against this order yet.</p>
        ) : (
          <div className="space-y-2">
            {o.challanList.map((c) => (
              <ChallanCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </Group>
    </div>
  );
}

/** One challan: every figure on the document, then the lines it billed. */
function ChallanCard({ c }: { c: JourneyChallan }) {
  const charges: [string, number, string?][] = [
    ['Taxable', c.taxable],
    [`GST${c.gstPercent ? ` ${c.gstPercent}%` : ''}`, c.gst],
    ['Packing', c.packing],
    ['Freight', c.freight],
    ['Box / pouch', c.pouch],
    [`TCS${c.tcsPercent ? ` ${c.tcsPercent}%` : ''}`, c.tcs],
    ['Other charges', c.otherCharges],
    [`TDS${c.tdsPercent ? ` ${c.tdsPercent}%` : ''}`, -c.tds],
  ];
  return (
    <div className="bg-card overflow-hidden rounded-md border border-slate-200 dark:border-white/10">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-white/10 dark:bg-white/[0.03]">
        <span className="text-[12.5px] font-bold text-emerald-700 dark:text-emerald-400">{c.code ?? `#${c.id}`}</span>
        <span className="text-muted-foreground text-[11.5px] font-medium tabular-nums">{formatDate(c.date)}</span>
        {c.transaction && <span className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">{c.transaction}</span>}
        {c.transporter && <span className="text-muted-foreground truncate text-[11px]">via {c.transporter}</span>}
        <span className="ml-auto text-[13px] font-bold tabular-nums" title={inrFull(c.total)}>
          {inrCompact(c.total)}
        </span>
      </header>

      <div className="flex flex-wrap gap-x-4 gap-y-1 px-2.5 py-2 text-[11.5px]">
        {charges
          // A charge that was not applied is noise on a document with six of them.
          .filter(([, v], i) => i === 0 || Math.abs(v) > 0)
          .map(([label, v]) => (
            <span key={label} className="whitespace-nowrap">
              <span className="text-muted-foreground">{label} </span>
              <span className={cn('font-semibold tabular-nums', v < 0 && 'text-rose-600 dark:text-rose-400')}>
                {v < 0 ? `−${inrCompact(-v)}` : inrCompact(v)}
              </span>
            </span>
          ))}
        <span className="whitespace-nowrap">
          <span className="text-muted-foreground">B </span>
          <span className="font-semibold tabular-nums text-blue-700 dark:text-blue-400">{inrCompact(c.bank)}</span>
          <span className="text-muted-foreground"> · C </span>
          <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{inrCompact(c.cash)}</span>
        </span>
        {c.dueDate && (
          <span className="whitespace-nowrap">
            <span className="text-muted-foreground">Due </span>
            <span className="font-semibold tabular-nums">{formatDate(c.dueDate)}</span>
          </span>
        )}
      </div>

      {/* Said out loud rather than hidden: on ~5% of challans the stored total
          does not equal the sum of the parts above it. Printing the parts and a
          total that disagree, with no note, is what makes a report untrustworthy. */}
      {Math.abs(c.unexplained) > 1 && (
        <p className="border-t border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100">
          The parts above come to {inrCompact(c.total - c.unexplained)} — {inrCompact(Math.abs(c.unexplained))}{' '}
          {c.unexplained > 0 ? 'less than' : 'more than'} the stored total of {inrCompact(c.total)}.
        </p>
      )}

      <div className="overflow-x-auto border-t border-slate-200 dark:border-white/10">
        <table className="w-full min-w-max text-[12px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className={cn(TH, 'pl-2.5')}>Billed item</th>
              <th className={TH}>Design</th>
              <th className={THR}>Qty</th>
              <th className={THR}>Rate</th>
              <th className={cn(THR, 'pr-2.5')}>Amount</th>
            </tr>
          </thead>
          <tbody className={TD}>
            {c.lines.map((l, i) => (
              <tr key={`${l.productName}-${i}`}>
                <td className="pl-2.5 font-semibold">{l.productName ?? '—'}</td>
                <td className="text-muted-foreground">{l.design ?? '—'}</td>
                <td className="text-right"><Qty bags={l.bags} pcs={l.pcs} kgs={l.kgs} box={l.box} /></td>
                <td className="text-right tabular-nums">{l.price != null ? inrCompact(l.price) : '—'}</td>
                <td className="pr-2.5 text-right font-semibold tabular-nums">{l.amount != null ? inrCompact(l.amount) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const EVENT_STYLE: Record<JourneyEvent['kind'], { dot: string; icon: LucideIcon }> = {
  ORDER: { dot: 'bg-blue-500', icon: ClipboardList },
  DISPATCH: { dot: 'bg-violet-500', icon: Truck },
  CHALLAN: { dot: 'bg-emerald-500', icon: FileText },
  RETURN: { dot: 'bg-rose-500', icon: Undo2 },
};

/** The party's activity, newest first, on a single vertical rail. */
function Timeline({ events }: { events: JourneyEvent[] }) {
  if (!events.length) return <p className="text-muted-foreground py-8 text-center text-[13px]">Nothing happened in this window.</p>;
  return (
    <div className="relative space-y-2 pl-5">
      {/* The rail itself. */}
      <span aria-hidden className="bg-border absolute top-1 bottom-1 left-[7px] w-px" />
      {events.map((e, i) => {
        const st = EVENT_STYLE[e.kind];
        const Icon = st.icon;
        return (
          <div
            key={`${e.kind}-${e.title}-${i}`}
            className="animate-journey-slide relative"
            style={{ animationDelay: `${Math.min(i, 24) * 35}ms` }}
          >
            <span aria-hidden className={cn('absolute top-2 -left-[15px] size-2 rounded-full ring-2 ring-card', st.dot)} />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <Icon className="text-muted-foreground size-3.5 self-center" />
              <span className="text-[12.5px] font-bold">{e.title}</span>
              <span className="text-muted-foreground text-[11.5px] font-medium tabular-nums">{formatDate(e.date)}</span>
              {e.amount != null && e.amount > 0 && (
                <span className="ml-auto text-[12px] font-bold tabular-nums" title={inrFull(e.amount)}>
                  {inrCompact(e.amount)}
                </span>
              )}
            </div>
            <div className="text-muted-foreground text-[11.5px] font-medium">{e.detail}</div>
          </div>
        );
      })}
    </div>
  );
}

export function OrderJourneyPage() {
  const filters = useReportFilters();
  // Not-started by default: the question this page is usually asked first is
  // "what has nobody begun yet", i.e. orders with zero dispatches against them.
  // "All orders" is the other tab for everything else.
  const [activeOnly, setActiveOnly] = useState(true);
  const { data, isFetching } = useOrderJourney({ ...filters.query, activeOnly: activeOnly || undefined });
  const j: OrderJourneyReport | undefined = data;

  /** The one unit the whole page reads in — whatever this party actually orders
   *  in. Mixing kgs and pcs in one funnel makes the percentages meaningless. */
  const unit = useMemo(() => {
    const o = j?.stages[0];
    if (!o) return 'kgs';
    return o.kgs > 0 ? 'kgs' : o.pcs > 0 ? 'pcs' : 'bags';
  }, [j]);

  const [tab, setTab] = useState<'orders' | 'timeline'>('orders');
  const hasParty = !!filters.f.customerId;

  /*
   * Snap the date range onto the party's open work, once per party.
   *
   * The window comes back independent of the current range (see the service), so
   * this can widen as well as narrow — picking a party whose oldest open order
   * predates the default financial year still lands on all of it. Keyed by
   * party in a ref so it happens on SELECTION only: re-applying on every fetch
   * would fight the user the moment they set a range of their own.
   */
  const snappedFor = useRef<number | null>(null);
  const setF = filters.setF;
  useEffect(() => {
    const id = filters.f.customerId ? Number(filters.f.customerId) : null;
    if (id == null) {
      snappedFor.current = null;
      return;
    }
    if (snappedFor.current === id) return;
    const w = data?.activeWindow;
    if (!w) return;
    snappedFor.current = id;
    setF((prev) => ({ ...prev, from: w.from, to: w.to }));
  }, [filters.f.customerId, data?.activeWindow, setF]);

  return (
    <div className="space-y-4">
      <ReportFilterBar f={filters.f} setF={filters.setF} active={filters.active} onReset={filters.reset} />

      {hasParty && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-[4px] border border-amber-300 bg-amber-50/40 p-0.5 dark:border-amber-400/40">
            {(
              [
                [true, 'Not started'],
                [false, 'All orders'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setActiveOnly(val)}
                className={cn(
                  'cursor-pointer rounded-[3px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
                  activeOnly === val
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-amber-900/70 hover:bg-amber-100 dark:text-amber-200/70',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-muted-foreground text-[11.5px] font-medium">
            {activeOnly
              ? 'Orders with quantity still to dispatch.'
              : 'Everything in the range, including fully shipped and billed.'}
          </span>
          {/* The range was moved onto the open work on selection — say so, and
              offer the way back, rather than leaving the user wondering why the
              dates changed under them. */}
          {data?.activeWindow && (
            <button
              type="button"
              onClick={() => filters.setF((prev) => ({ ...prev, from: data.activeWindow!.from, to: data.activeWindow!.to }))}
              className="text-primary ml-auto cursor-pointer text-[11.5px] font-semibold hover:underline"
              title="Set the range to span every order still open for this party"
            >
              Fit range to {data.activeWindow.orders} open order{data.activeWindow.orders === 1 ? '' : 's'} (
              {formatDate(data.activeWindow.from)} → {formatDate(data.activeWindow.to)})
            </button>
          )}
        </div>
      )}

      {!hasParty && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Users className="text-muted-foreground/50 size-8" />
            <p className="text-[13.5px] font-semibold">Pick a party to follow</p>
            <p className="text-muted-foreground max-w-md text-[12.5px]">
              Choose a customer above and the page traces their goods from the order that started it through to anything that
              came back. Without a party this would average every customer together, which tells you nothing about any of them.
            </p>
          </CardContent>
        </Card>
      )}

      {hasParty && j && (
        <>
          {/* ── the four beats ── */}
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-stretch">
            {j.stages.map((s, i) => (
              <div key={s.key} className="contents">
                <StageCard s={s} index={i} unit={unit} dispatchDocs={j.stages[1]?.docs ?? 0} />
                {i < j.stages.length - 1 && <Connector index={i} />}
              </div>
            ))}
          </div>

          <ReportSummary points={j.insights.map((text) => ({ text }))} />

          {/* ── detail ── */}
          <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-[4px] border border-amber-300 bg-amber-50/40 p-0.5 dark:border-amber-400/40 sm:w-auto">
            {(
              [
                ['orders', `Orders (${j.orders.length})`],
                ['timeline', `Timeline (${j.events.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  'flex-1 rounded-[3px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors sm:flex-none',
                  tab === id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-amber-900/70 hover:bg-amber-100 dark:text-amber-200/70',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {isFetching && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
          </div>

          {tab === 'orders' ? (
            <ReportCard title={`Every order, followed through`}>
              {j.orders.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-[13px]">No orders for this party in this window.</p>
              ) : (
                <div className="space-y-2">
                  {j.orders.map((o, i) => (
                    <OrderTrack key={o.orderId} o={o} unit={unit} index={i} />
                  ))}
                </div>
              )}
            </ReportCard>
          ) : (
            <ReportCard title="What happened, newest first">
              <Timeline events={j.events} />
            </ReportCard>
          )}
        </>
      )}
    </div>
  );
}

export default OrderJourneyPage;
