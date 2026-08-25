import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, Brush, Check, ChevronRight, Download, ExternalLink, Eye, FileDown, FileSpreadsheet, FileText, History, IndianRupee, Layers, Loader2, type LucideIcon, Package, Percent, Settings2, TableProperties, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_RATE_LIST_TITLE, type CustomerRateList } from '@oms/shared';
import type { CustomerRateDto, RateChangeEntry } from '@oms/shared';
import { isIOS, showPreviewPlaceholder } from '@/lib/pdf';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/common/combo';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import kavishLogo from '@/assets/kavish-logo.png';
import { fetchCustomerRateList, useCustomerRateHistory, useCustomerRateList, useCustomers, useDefaultRateList } from './use-customers';
import { useEffectiveRateListConfig, useRateListConfigBundle } from './use-rate-list-config';
import { RateListSettingsCard } from '@/features/settings/rate-list-settings-card';
import { usePermissions } from '@/hooks/use-permissions';
import { useCustomerSpecialRates } from '@/features/special-rates/use-special-rates';
import { useCompany } from '@/features/settings/use-settings';
import { measureSpecialRates, summariseSpecialRates, type RateImpact } from './special-rate-impact';
import { buildRateListPdfBlob, exportRateListExcel, exportRateListPdf } from './customer-rate-list-export';
import { buildSections, rateListCategories, type DesignPivotTable, type PivotTable } from './customer-rate-list-pivot';

/** Rapid successive rate saves (same editing session) collapse into one version. */
const VERSION_WINDOW_MS = 30_000;

/** A set of rate changes that happened together (one editing session) = one "version". */
interface Version {
  key: string;
  changedAt: string;
  changedByName: string | null;
  changes: RateChangeEntry[];
}

/**
 * Each special-rate save writes its own history row with its own timestamp, so
 * grouping by an exact timestamp would never cluster a multi-rate edit. Instead
 * we walk the (newest-first) list and fold consecutive changes made by the same
 * person within {@link VERSION_WINDOW_MS} into one version.
 */
function groupIntoVersions(entries: RateChangeEntry[]): Version[] {
  const sorted = [...entries].sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  const versions: Version[] = [];
  for (const e of sorted) {
    const cur = versions[versions.length - 1];
    const withinWindow =
      cur &&
      cur.changedByName === e.changedByName &&
      new Date(cur.changes[cur.changes.length - 1].changedAt).getTime() - new Date(e.changedAt).getTime() <= VERSION_WINDOW_MS;
    if (withinWindow) cur.changes.push(e);
    else versions.push({ key: `${e.changedAt}#${e.id}`, changedAt: e.changedAt, changedByName: e.changedByName, changes: [e] });
  }
  return versions;
}

/** Human label for one change row: "PRODUCT · AJUBA (ITEM)". */
function changeLabel(c: RateChangeEntry): string {
  const what = c.target || c.subCategory || c.category || '—';
  const kind = c.rateKind ? `${c.rateKind} · ` : '';
  return `${kind}${what}${c.scope ? ` (${c.scope.toLowerCase()})` : ''}`;
}

/*
 * Typography for the header band.
 *
 * Three fonts already bundled with the app, each doing the job it is good at:
 *  - MICRO_LABEL  Montserrat — geometric caps stay crisp at 9.5px with wide
 *                 tracking, where Inter's tighter caps go muddy.
 *  - FIGURE       Calibri (Carlito) bold — the figure face used across the
 *                 printed documents this screen mirrors, so a rate reads the
 *                 same on screen as it does on the challan. `tabular-nums`
 *                 keeps the columns aligned without a monospace face.
 * Body text stays Inter. No new font is downloaded for any of this.
 */
/* Strip the browser viewer's own chrome so the sheet sits on an app surface
   rather than in a grey PDF shell. Firefox's pdf.js ignores these and keeps its
   toolbar — the document still renders, it just keeps that chrome. */
const PDF_VIEWER_PARAMS = '#toolbar=0&navpanes=0&scrollbar=0&view=FitH';

const MICRO_LABEL = 'font-montserrat text-[9.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground';
const FIGURE = 'font-calibri font-bold tabular-nums';

/** Matches the Products / Orders / Challans grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';

function RateDelta({ oldRate, newRate }: { oldRate: number | null; newRate: number | null }) {
  const up = (newRate ?? 0) > (oldRate ?? 0);
  const down = (newRate ?? 0) < (oldRate ?? 0);
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] tabular-nums">
      <span className="text-muted-foreground font-medium">{oldRate == null ? '—' : oldRate}</span>
      <ChevronRight className="text-muted-foreground size-3.5" />
      {/* Same convention as the Special Rates tab: green = customer pays more. */}
      <span className={cn('font-bold', up && 'text-emerald-600 dark:text-emerald-400', down && 'text-rose-600 dark:text-rose-400')}>
        {up && <TrendingUp className="mr-0.5 inline size-3.5" />}
        {down && <TrendingDown className="mr-0.5 inline size-3.5" />}
        {newRate == null ? '—' : newRate}
      </span>
    </span>
  );
}

function VersionCard({ v, defaultOpen }: { v: Version; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const multi = v.changes.length > 1;
  return (
    <div className="bg-card overflow-hidden rounded-[4px] border shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-amber-50/60 dark:hover:bg-amber-400/5 flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors"
      >
        <ChevronRight className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-90')} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold tabular-nums">{formatDateTime(v.changedAt)}</div>
          <div className="text-muted-foreground text-[11.5px] font-medium">
            {v.changes.length} rate{v.changes.length > 1 ? 's' : ''} changed{v.changedByName ? ` · by ${v.changedByName}` : ''}
          </div>
        </div>
        {!open && !multi && <span className="shrink-0">{<RateDelta oldRate={v.changes[0].oldRate} newRate={v.changes[0].newRate} />}</span>}
        {multi && <span className="bg-primary/10 text-primary shrink-0 rounded-[4px] px-2 py-0.5 text-[11.5px] font-bold tabular-nums">{v.changes.length} items</span>}
      </button>
      {open && (
        <div className="border-t">
          <table className="w-full text-[13px] [&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0">
            <tbody className="[&_td]:border-t [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1.5 [&_tr:first-child_td]:border-t-0 dark:[&_td]:border-white/10">
              {v.changes.map((c) => (
                <tr key={c.id}>
                  <td className={TEXT_CELL}>{changeLabel(c)}</td>
                  <td className="text-muted-foreground w-40 text-[11.5px] font-medium">
                    {[c.category, c.subCategory].filter(Boolean).join(' · ')}
                  </td>
                  <td className="w-40 text-right">
                    <RateDelta oldRate={c.oldRate} newRate={c.newRate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * One rate cell. In compare mode a cell that carries an adjustment shows all
 * three numbers — the customer's rate, our rate, and the difference (§18/§20).
 * A cell with no adjustment shows one number and nothing else: our rate and the
 * customer's rate are the same figure there, and printing it twice would read as
 * though something had been applied.
 */
/**
 * `null` when this item is not sold in that column, so the CELL can be tinted
 * rather than only its contents — a fill has to be on the `<td>`, and a
 * component returning a dash cannot reach its own cell's background.
 */
function RateCell({ rate, base, delta, compare }: { rate: string; base: string; delta: string; compare: boolean }) {
  if (!rate) return null;
  const down = delta.startsWith('-');
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="text-[13px] font-bold tabular-nums text-slate-900 dark:text-slate-100">{rate}</span>
      {compare && delta && (
        <span className="flex items-center gap-1 text-[10.5px] font-semibold tabular-nums">
          <span className="text-muted-foreground">{base}</span>
          <span className={cn(down ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>{delta}</span>
        </span>
      )}
    </span>
  );
}

/** One category's pivoted rate table, mirroring the printed sheet / the PDF. */
function PivotCard({ t, compare }: { t: PivotTable; compare: boolean }) {
  return (
    <div className="bg-card overflow-hidden rounded-[4px] border shadow-sm">
      <div className="bg-gradient-to-b from-blue-800 to-indigo-800 px-3 py-2 text-[13.5px] font-extrabold tracking-wide text-white uppercase">{t.title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] [&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-white/20 [&_th:last-child]:border-r-0">
          <thead>
            <tr className="bg-gradient-to-b from-blue-800 to-indigo-800 text-[11.5px] text-white uppercase">
              <th className="w-12 px-3 py-1.5 text-left font-extrabold">SR</th>
              <th className="px-3 py-1.5 text-left font-extrabold">Item</th>
              <th className="w-32 px-3 py-1.5 text-left font-extrabold">{t.availableLabel}</th>
              {t.columns.map((c) => (
                <th key={c} className="w-24 px-3 py-1.5 text-right font-extrabold">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="[&_td]:border-t [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1 dark:[&_td]:border-white/10">
            {t.rows.map((r) => (
              <tr key={r.sr} className="even:bg-slate-100/80 dark:even:bg-white/[0.04]">
                <td className="text-muted-foreground text-[12px] font-medium tabular-nums">{r.sr}</td>
                <td className={TEXT_CELL}>{r.item}</td>
                <td className="text-[13px] font-bold tabular-nums text-slate-900 dark:text-slate-100">{r.available || <span className="text-muted-foreground/40">—</span>}</td>
                {r.cells.map((cell, i) => (
                  <td
                    key={i}
                    className={cn(
                      'text-right align-top',
                      // Not sold in this column. A very light fill labelled NA,
                      // matching the PDF and the workbook: a lone faint dash read
                      // as missing data, so a 2-pcs-only item looked like most of
                      // its row had been skipped. `!` because the zebra stripe on
                      // the row would otherwise win on even rows.
                      !cell && 'bg-slate-100 !text-center !text-muted-foreground/60 dark:bg-white/[0.05]',
                    )}
                  >
                    {cell ? (
                      <RateCell rate={cell} base={r.baseCells[i]} delta={r.deltaCells[i]} compare={compare} />
                    ) : (
                      <span className="text-[11px] font-semibold">NA</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Design rates, presented as a plain "design type → rate" list rather than a
 * pcs-by-pcs grid — a design almost always charges the same fee no matter the
 * pcs count or size, so pivoting it into several near-identical columns (like
 * products get) was mostly repeated numbers. Each row shows the ONE rate the
 * design is billed at most often; showing every minor variant as a
 * slash-separated combination was more confusing than useful (a size with no
 * pcs recorded at all could end up listed twice at two different prices, both
 * labelled identically, which reads as a contradiction rather than a fact).
 */
function DesignPivotCard({ t, compare }: { t: DesignPivotTable; compare: boolean }) {
  return (
    <div className="bg-card overflow-hidden rounded-[4px] border shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-gradient-to-b from-blue-800 to-indigo-800 px-3 py-2 text-[13.5px] font-extrabold tracking-wide text-white uppercase">
        <span>{t.title}</span>
        <span className="text-[11px] font-semibold tracking-normal text-blue-100 normal-case">
          {t.rows.length} design{t.rows.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] [&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-white/20 [&_th:last-child]:border-r-0">
          <thead>
            <tr className="bg-gradient-to-b from-blue-800 to-indigo-800 text-[11.5px] text-white uppercase">
              <th className="w-12 px-3 py-1.5 text-left font-extrabold">SR</th>
              <th className="px-3 py-1.5 text-left font-extrabold">Design type</th>
              <th className="w-32 px-3 py-1.5 text-left font-extrabold">{t.availableLabel}</th>
              <th className="w-28 px-3 py-1.5 text-right font-extrabold">Rate</th>
            </tr>
          </thead>
          <tbody className="[&_td]:border-t [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1 dark:[&_td]:border-white/10">
            {t.rows.map((r) => (
              <tr key={r.sr} className="even:bg-slate-100/80 dark:even:bg-white/[0.04]">
                <td className="text-muted-foreground text-[12px] font-medium tabular-nums">{r.sr}</td>
                <td className={TEXT_CELL}>{r.item}</td>
                <td className="text-[13px] font-bold tabular-nums text-slate-900 dark:text-slate-100">{r.available || <span className="text-muted-foreground/40">—</span>}</td>
                <td className="text-right align-top">
                  <RateCell
                    rate={String(r.rate)}
                    base={String(r.baseRate)}
                    delta={r.delta ? (r.delta > 0 ? `+${r.delta}` : String(r.delta)) : ''}
                    compare={compare}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Category chips (§3, §4). Multi-select, and "nothing selected" deliberately
 * means EVERY category rather than none — a filter that starts empty and shows
 * nothing looks broken, and a category added to the configuration later should
 * appear without anyone re-touching the filter.
 *
 * `showAllActive` overrides that for callers where empty means empty. The
 * download picker holds a real list of categories and needs the chips to show
 * it, so it lights All from `selected.length === all.length` instead — see the
 * note at its call site.
 */
function CategoryChips({
  all,
  selected,
  onToggle,
  onAll,
  showAllActive,
}: {
  all: string[];
  selected: string[];
  onToggle: (c: string) => void;
  onAll: () => void;
  showAllActive?: boolean;
}) {
  const none = showAllActive ?? selected.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={onAll}
        className={cn(
          'rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition-colors',
          none
            ? 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-400/50 dark:bg-amber-400/20 dark:text-amber-200'
            : 'text-muted-foreground border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5',
        )}
      >
        All
      </button>
      {all.map((c) => {
        const on = selected.includes(c);
        return (
          <button
            key={c}
            type="button"
            onClick={() => onToggle(c)}
            className={cn(
              'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition-colors',
              on
                ? 'border-blue-400 bg-blue-50 text-blue-800 dark:border-blue-400/50 dark:bg-blue-500/15 dark:text-blue-200'
                : 'text-muted-foreground border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5',
            )}
          >
            {on && <Check className="size-3" />}
            {c}
          </button>
        );
      })}
    </div>
  );
}

/** "CUP · 10-PCS-FG-22G · BEAT" — what a rule applies to, most specific part last. */
/*
 * Colour convention for a rate movement, used everywhere on this page.
 *
 * GREEN = the customer pays MORE, RED = the customer pays LESS. Read from the
 * business's side of the counter, which is whose screen this is: a rate going up
 * is money in, a discount is money given away. (The opposite reading — "up is
 * bad because prices rose" — is the customer's, and would have every discount
 * showing green on our own screen.)
 */
const UP_TONE = 'text-emerald-600 dark:text-emerald-400';
const DOWN_TONE = 'text-rose-600 dark:text-rose-400';
const UP_CHIP = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
const DOWN_CHIP = 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300';

/** Plain words for the stored codes — nobody outside the database calls it a
 *  "SUBCATEGORY scope". */
const KIND_TEXT: Record<string, string> = { PRODUCT: 'Product', DESIGN: 'Design' };
const SCOPE_TEXT: Record<string, string> = {
  ITEM: 'This item only',
  SUBCATEGORY: 'Whole sub-category',
  CATEGORY: 'Whole category',
};

/** "GLASS · 10-PCS-FG-22G · AMRAPALI (APS)" split into its parts, so the thing a
 *  rate actually names can be bolder than the path leading to it. */
function ruleParts(r: CustomerRateDto): string[] {
  return [r.category, r.subCategory, r.target].filter(Boolean) as string[];
}

const span = (from: number | null, to: number | null): string =>
  from == null ? '—' : from === to ? String(from) : `${from}–${to}`;

/**
 * How broad a rate is, expressed visually rather than only in words.
 *
 * A rate on one item and a rate on a whole category are wildly different in
 * consequence, and a table that prints both in the same grey text makes the
 * reader work that out from the label every time. Each level gets its own rail
 * colour and pill, so breadth is legible at a glance.
 */
const SCOPE_STYLE: Record<string, { rail: string; pill: string; text: string }> = {
  ITEM: {
    rail: 'bg-sky-400',
    pill: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/25',
    text: 'This item only',
  },
  SUBCATEGORY: {
    rail: 'bg-violet-400',
    pill: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/25',
    text: 'Whole sub-category',
  },
  CATEGORY: {
    rail: 'bg-amber-400',
    pill: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-400/25',
    text: 'Whole category',
  },
};

/**
 * The consolidated Set Special Rate view.
 *
 * Change History answers "what changed and when". This answers the different
 * question: what is configured RIGHT NOW, what is it doing, and how far from our
 * own rate does it put this party.
 */
function SpecialRatesPanel({
  customerLabel,
  impacts,
  summary,
  logos,
}: {
  customerLabel: string;
  impacts: RateImpact[];
  summary: ReturnType<typeof summariseSpecialRates>;
  logos: number;
}) {
  const [showing, setShowing] = useState<RateImpact | null>(null);
  const onShowItems = (i: RateImpact) => setShowing(i);
  if (!impacts.length) {
    return (
      <div className="text-muted-foreground grid place-items-center rounded-[4px] border border-dashed py-20 text-[13px] font-medium">
        <Percent className="mb-2 size-8 opacity-40" />
        No special rates for {customerLabel} — they pay the normal price on everything.
      </div>
    );
  }

  const chip = (label: string, value: string | number, tone: string) => (
    <span className={cn('inline-flex items-baseline gap-1 rounded-full px-3 py-1 text-[12.5px] font-bold', tone)}>
      <span className={FIGURE}>{value}</span>
      <span className="font-semibold opacity-75">{label}</span>
    </span>
  );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {chip('special rates set', summary.rules, 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200')}
        {chip('charge more', summary.up, UP_CHIP)}
        {chip('give a discount', summary.down, DOWN_CHIP)}
        {chip('items affected', summary.items, 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300')}
        {summary.idle > 0 &&
          chip('not being used', summary.idle, 'bg-amber-50 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200')}
        {logos > 0 && chip('logo restrictions', logos, 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200')}
      </div>

      {/* Phones get the card list below instead: seven columns on a 375px screen
          is a sideways scroll through numbers, which is how you misread a rate. */}
      <div className="bg-card hidden overflow-hidden rounded-[6px] border shadow-sm ring-1 ring-slate-900/5 sm:block dark:ring-white/5">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              {/* Sticky so the columns stay named on a long list — the single
                  thing that most makes a data table feel finished. */}
              <tr className="sticky top-0 z-10 bg-gradient-to-b from-indigo-700 to-indigo-800 text-[11.5px] tracking-wider text-white uppercase">
                <th className="w-1 p-0" aria-hidden />
                <th className="px-3 py-2.5 text-left font-bold">Product / Category</th>
                <th className="w-40 px-3 py-2.5 text-left font-bold">Applies to</th>
                <th className="w-28 px-3 py-2.5 text-right font-bold">Rate change</th>
                <th className="w-44 px-3 py-2.5 text-left font-bold">Items affected</th>
                <th className="w-28 px-3 py-2.5 text-right font-bold">Normal price</th>
                <th className="w-32 px-3 py-2.5 text-right font-bold">They pay</th>
              </tr>
            </thead>
            <tbody>
              {impacts.map((i) => {
                const up = i.rule.rate > 0;
                const st = SCOPE_STYLE[i.rule.scope] ?? SCOPE_STYLE.ITEM;
                const parts = ruleParts(i.rule);
                return (
                  <tr
                    key={i.rule.id}
                    className="group border-t border-slate-200 transition-colors even:bg-slate-50/70 hover:bg-indigo-50/50 dark:border-white/10 dark:even:bg-white/[0.03] dark:hover:bg-indigo-500/10"
                  >
                    {/* Breadth rail — the widest rate on the sheet is the one you
                        want to notice first, and colour carries that faster than
                        reading the label. */}
                    <td className="p-0">
                      <span className={cn('block h-full min-h-9 w-1', st.rail)} />
                    </td>

                    <td className="px-3 py-2">
                      <span className="flex flex-wrap items-baseline gap-x-1.5">
                        {parts.map((p, n) => (
                          <span key={n} className="inline-flex items-baseline gap-1.5">
                            {n > 0 && <span className="text-muted-foreground/40 text-[12px]">›</span>}
                            <span
                              className={cn(
                                n === parts.length - 1
                                  ? 'text-[14.5px] font-bold text-slate-900 dark:text-slate-100'
                                  : 'text-muted-foreground text-[12px] font-semibold',
                              )}
                            >
                              {p}
                            </span>
                          </span>
                        ))}
                      </span>
                      <span className="text-muted-foreground/70 mt-0.5 block text-[11px] font-semibold tracking-wide uppercase">
                        {KIND_TEXT[i.rule.kind] ?? i.rule.kind} rate
                      </span>
                    </td>

                    <td className="px-3 py-2">
                      <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ring-1 ring-inset', st.pill)}>
                        {st.text}
                      </span>
                    </td>

                    <td className={cn('px-3 py-2 text-right text-[16px]', FIGURE, up ? UP_TONE : DOWN_TONE)}>
                      <span className="inline-flex items-center gap-0.5">
                        {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                        {up ? `+${i.rule.rate}` : i.rule.rate}
                      </span>
                    </td>

                    {/* The count opens the list behind it — "192 items" is only
                        useful if you can find out which 192. */}
                    <td className="px-3 py-2 text-right">
                      {i.items > 0 ? (
                        <button
                          type="button"
                          onClick={() => onShowItems(i)}
                          title={`Show the ${i.items} item${i.items === 1 ? '' : 's'} this rate applies to`}
                          className="text-primary hover:bg-primary/10 focus-visible:ring-ring/50 inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 transition-colors outline-none focus-visible:ring-2"
                        >
                          <span className={cn(FIGURE, 'text-[14px]')}>{i.items}</span>
                          <ChevronRight className="size-3.5" />
                        </button>
                      ) : (
                        <span className="text-[12.5px] font-semibold text-amber-700 dark:text-amber-300">
                          {i.shadowed > 0 ? `None — ${i.shadowed} use a more specific rate` : 'None'}
                        </span>
                      )}
                    </td>

                    <td className={cn(FIGURE, 'text-muted-foreground px-3 py-2 text-right text-[14px]')}>
                      {span(i.baseFrom, i.baseTo)}
                    </td>
                    <td className={cn(FIGURE, 'px-3 py-2 text-right text-[15.5px] text-slate-900 dark:text-slate-100')}>
                      {span(i.rateFrom, i.rateTo)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-muted-foreground bg-muted/40 border-t px-3 py-2.5 text-[12.5px] font-medium">
          When two rates could both apply, the more specific one wins —{' '}
          <span className="font-bold text-sky-700 dark:text-sky-300">one item</span> beats{' '}
          <span className="font-bold text-violet-700 dark:text-violet-300">sub-category</span>, which beats{' '}
          <span className="font-bold text-amber-700 dark:text-amber-300">whole category</span>. Only the winner is used.
        </p>
      </div>

      {/* ── phones ── */}
      <div className="space-y-2 sm:hidden">
        {impacts.map((i) => {
          const up = i.rule.rate > 0;
          const st = SCOPE_STYLE[i.rule.scope] ?? SCOPE_STYLE.ITEM;
          const parts = ruleParts(i.rule);
          return (
            <div key={i.rule.id} className="bg-card flex overflow-hidden rounded-[6px] border shadow-sm">
              <span className={cn('w-1 shrink-0', st.rail)} aria-hidden />
              <div className="min-w-0 flex-1 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[14.5px] font-bold text-slate-900 dark:text-slate-100">
                      {parts[parts.length - 1]}
                    </div>
                    {parts.length > 1 && (
                      <div className="text-muted-foreground truncate text-[12px] font-semibold">
                        {parts.slice(0, -1).join(' › ')}
                      </div>
                    )}
                  </div>
                  <span className={cn(FIGURE, 'shrink-0 text-[18px]', up ? UP_TONE : DOWN_TONE)}>
                    {up ? `+${i.rule.rate}` : i.rule.rate}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className={cn('rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ring-1 ring-inset', st.pill)}>{st.text}</span>
                  <span className="text-muted-foreground text-[11.5px] font-bold tracking-wide uppercase">
                    {KIND_TEXT[i.rule.kind] ?? i.rule.kind}
                  </span>
                </div>

                {/* Price movement reads left-to-right on one line — two separate
                    columns would be two glances on a screen this narrow. */}
                <div className="mt-2 flex items-center gap-2 text-[14px]">
                  <span className={cn(FIGURE, 'text-muted-foreground')}>{span(i.baseFrom, i.baseTo)}</span>
                  <ChevronRight className="text-muted-foreground/50 size-3.5" />
                  <span className={cn(FIGURE, 'text-slate-900 dark:text-slate-100')}>{span(i.rateFrom, i.rateTo)}</span>
                  {i.items > 0 ? (
                    <button
                      type="button"
                      onClick={() => onShowItems(i)}
                      className="text-primary ml-auto inline-flex cursor-pointer items-center gap-0.5 text-[12.5px] font-bold"
                    >
                      {i.items} item{i.items === 1 ? '' : 's'} <ChevronRight className="size-3" />
                    </button>
                  ) : (
                    <span className="ml-auto text-[12px] font-semibold text-amber-700 dark:text-amber-300">not used</span>
                  )}
                </div>

                {i.items === 0 && i.shadowed > 0 && (
                  <p className="mt-1 text-[12px] font-semibold text-amber-700 dark:text-amber-300">
                    {i.shadowed} items use a more specific rate
                  </p>
                )}
              </div>
            </div>
          );
        })}
        <p className="text-muted-foreground px-1 text-[12.5px] font-medium">
          The more specific rate wins — <span className="font-bold text-sky-700 dark:text-sky-300">item</span> beats{' '}
          <span className="font-bold text-violet-700 dark:text-violet-300">sub-category</span> beats{' '}
          <span className="font-bold text-amber-700 dark:text-amber-300">category</span>.
        </p>
      </div>

      {showing && <AffectedItemsDialog impact={showing} customerLabel={customerLabel} onClose={() => setShowing(null)} />}
    </div>
  );
}

/**
 * The items behind an "items affected" count, each with what it normally costs
 * and what this customer pays.
 *
 * The count on its own invites the question and then refuses to answer it —
 * particularly for a category-wide rate, where "192" is precisely the number you
 * cannot verify by eye. Every item is listed, not a sample.
 */
function AffectedItemsDialog({
  impact,
  customerLabel,
  onClose,
}: {
  impact: RateImpact;
  customerLabel: string;
  onClose: () => void;
}) {
  const up = impact.rule.rate > 0;
  const st = SCOPE_STYLE[impact.rule.scope] ?? SCOPE_STYLE.ITEM;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(96vw,44rem)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-[15px]">
            {ruleParts(impact.rule).join(' › ')}
            <span className={cn('rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ring-1 ring-inset', st.pill)}>{st.text}</span>
          </DialogTitle>
          <DialogDescription className="text-[13.5px]">
            {impact.items} item{impact.items === 1 ? '' : 's'} on {customerLabel}’s sheet, priced{' '}
            <span className={cn('font-bold', up ? UP_TONE : DOWN_TONE)}>
              {up ? `+${impact.rule.rate}` : impact.rule.rate}
            </span>{' '}
            by this rate.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto rounded-[4px] border">
          <table className="w-full text-[14px]">
            <thead className="bg-muted/60 sticky top-0">
              <tr className={cn(MICRO_LABEL, 'text-left text-[11px]')}>
                <th className="px-3 py-2.5 font-bold">Item</th>
                <th className="hidden px-3 py-2 font-bold sm:table-cell">Sub-category</th>
                <th className="px-3 py-2 text-right font-bold">Normal</th>
                <th className="px-3 py-2 text-right font-bold">They pay</th>
                <th className="px-3 py-2 text-right font-bold">Change</th>
              </tr>
            </thead>
            <tbody>
              {impact.affected.map((a, n) => {
                const diff = Math.round((a.rate - a.base) * 100) / 100;
                return (
                  <tr key={`${a.name}-${a.subCategory}-${n}`} className="border-t even:bg-slate-50/70 dark:even:bg-white/[0.03]">
                    <td className="px-3 py-2 text-[14px] font-semibold text-slate-900 dark:text-slate-100">{a.name}</td>
                    <td className="text-muted-foreground hidden px-3 py-2 text-[13px] font-medium sm:table-cell">{a.subCategory || '—'}</td>
                    <td className={cn(FIGURE, 'text-muted-foreground px-3 py-2 text-right text-[14px]')}>{a.base}</td>
                    <td className={cn(FIGURE, 'px-3 py-2 text-right text-[15px] text-slate-900 dark:text-slate-100')}>{a.rate}</td>
                    <td className={cn(FIGURE, 'px-3 py-2 text-right text-[14px]', diff > 0 ? UP_TONE : diff < 0 ? DOWN_TONE : 'text-muted-foreground/50')}>
                      {diff === 0 ? '—' : diff > 0 ? `+${diff}` : diff}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One cell of the header's figure strip.
 *
 * ERP headers state the shape of what you are looking at before you scroll into
 * it — how many products, how many designs, how many rules are in play. The
 * numbers are deliberately the loudest thing in the cell; the label is a
 * whisper above it.
 *
 * Sized up from 19px/10px: this strip sits above a dense rate table, and at the
 * old size the figures read as part of the table's chrome rather than as the
 * summary of it — you had to hunt for how many special rates were in play. The
 * label went up too, because a 10px all-caps whisper stops being legible on a
 * laptop panel once the number beside it grows.
 */
function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'slate',
}: {
  label: string;
  value: number;
  hint?: string;
  icon: LucideIcon;
  tone?: 'slate' | 'violet' | 'amber' | 'indigo';
}) {
  const TONE = {
    slate: { tile: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300', num: 'text-slate-900 dark:text-slate-100' },
    violet: { tile: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300', num: 'text-violet-700 dark:text-violet-300' },
    amber: { tile: 'bg-amber-100 text-amber-700 dark:bg-amber-400/20 dark:text-amber-300', num: 'text-amber-700 dark:text-amber-300' },
    indigo: { tile: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300', num: 'text-indigo-700 dark:text-indigo-300' },
  }[tone];
  return (
    <div className="bg-card flex items-center gap-3 px-3.5 py-3">
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-[5px]', TONE.tile)}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <div className={cn(MICRO_LABEL, 'text-[11.5px] leading-none')}>{label}</div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className={cn(FIGURE, 'text-[25px] leading-none', TONE.num)}>{value.toLocaleString('en-IN')}</span>
          {hint && <span className={cn(FIGURE, 'text-muted-foreground truncate text-[12px]')}>{hint}</span>}
        </div>
      </div>
    </div>
  );
}

/** A read-only fact in the identity strip — label above, value below. */
function Meta({ label, value, tone }: { label: string; value: string; tone?: 'amber' }) {
  return (
    <div className="min-w-0">
      <div className={cn(MICRO_LABEL, 'leading-none')}>{label}</div>
      <div
        className={cn(
          'mt-1 truncate font-montserrat text-[12px] font-semibold',
          tone === 'amber' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-800 dark:text-slate-200',
        )}
      >
        {value}
      </div>
    </div>
  );
}

type Tab = 'list' | 'special' | 'history' | 'settings';

export function RateListPage() {
  const { can } = usePermissions();
  const { data: customerData } = useCustomers({ page: 1, pageSize: 1000 });
  const customers = customerData?.items ?? [];

  const byLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of customers) if (c.partyName) m.set(c.partyName, c.id);
    return m;
  }, [customers]);
  const options = useMemo(() => [...byLabel.keys()].sort((a, b) => a.localeCompare(b)), [byLabel]);

  const [customerLabel, setCustomerLabel] = useState('');
  const customerId = byLabel.get(customerLabel);

  const [tab, setTab] = useState<Tab>('list');

  const { data: history, isLoading: historyLoading } = useCustomerRateHistory(customerId);
  const versions = useMemo(() => groupIntoVersions(history ?? []), [history]);

  const { data: rateList, isLoading: listLoading, isFetching: listFetching } = useCustomerRateList(customerId);

  // The Rate List Settings in force for this party — the default with the
  // party's own overrides folded in — loaded automatically on selection (§10,
  // §29). Until anything is configured this resolves to today's behaviour, so
  // the sheet is unchanged for parties nobody has set up.
  const { data: effective } = useEffectiveRateListConfig(customerId);
  const config = effective ?? null;
  /** The default configuration, for the party-less chart sheet — there is no
   *  party whose overrides could apply to it. */
  const { data: configBundle } = useRateListConfigBundle();
  /* Same permission the Settings screen used for this card — moving where it
     lives must not change who may edit it. */
  const canEditRateList = can('customer:update');
  const defaultConfig = configBundle?.default ?? null;

  /** Categories the configuration actually puts on THIS party's sheet. Both the
   *  filter and the download picker offer these and only these: a selection
   *  narrows the configuration, it never widens it back (§25/§26). */
  const configured = useMemo(() => {
    if (!rateList) return [] as string[];
    const s = buildSections(rateList, { config });
    return [...new Set([...s.products.map((t) => t.category), ...s.designs.map((t) => t.category)])].sort((a, b) =>
      a.localeCompare(b),
    );
  }, [rateList, config]);
  /** Categories the catalogue has but the configuration leaves off — worth saying
   *  out loud, so a missing category reads as a setting rather than a bug. */
  const excludedCount = useMemo(
    () => (rateList ? rateListCategories(rateList).filter((c) => !configured.includes(c)).length : 0),
    [rateList, configured],
  );

  // Empty = every configured category. Kept as "empty means all" so a newly
  // configured category shows up without the filter having to be re-touched.
  const [catFilter, setCatFilter] = useState<string[]>([]);
  useEffect(() => setCatFilter([]), [customerId]);
  const toggleCat = (c: string) => setCatFilter((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const sections = useMemo(
    () => (rateList ? buildSections(rateList, { config, categories: catFilter.length ? catFilter : null }) : null),
    [rateList, config, catFilter],
  );
  const totalTableCount = (sections?.products.length ?? 0) + (sections?.designs.length ?? 0);
  // Counted off the BUILT sections, so the strip states what is actually on the
  // sheet under the current configuration and filter — not what the catalogue
  // happens to hold.
  const productRows = useMemo(() => (sections?.products ?? []).reduce((n, t) => n + t.rows.length, 0), [sections]);
  const designRows = useMemo(() => (sections?.designs ?? []).reduce((n, t) => n + t.rows.length, 0), [sections]);

  // Off by default: the sheet's job is to quote the customer's price, and our own
  // rate is internal. Turning it on is a deliberate act (§18).
  const [compare, setCompare] = useState(false);

  const { data: special } = useCustomerSpecialRates(customerId);
  const impacts = useMemo(() => measureSpecialRates(special?.rates ?? [], rateList), [special, rateList]);
  const summary = useMemo(() => summariseSpecialRates(impacts), [impacts]);

  // The logo uploaded on Settings → General (§23) — used for the PDF masthead
  // and watermark, and for the same faint watermark on this screen preview.
  // Falls back to the bundled KAVISH mark inside the exporter itself when the
  // company hasn't uploaded one.
  const { data: company } = useCompany();

  const [downloadOpen, setDownloadOpen] = useState(false);
  const [dlCats, setDlCats] = useState<string[]>([]);
  const [busy, setBusy] = useState<'pdf' | 'excel' | 'preview' | null>(null);
  /** Object URL of the built PDF while the preview overlay is open. Kept in a ref
   *  too, so unmounting can revoke it without the effect depending on the state. */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  previewUrlRef.current = previewUrl;
  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); }, []);
  /*
   * Downloading the chart sheet instead of a party's.
   *
   * Same dialog rather than a second one: the format buttons, the category
   * picker and the whole export path are identical — only the source of the
   * rates and the name at the top differ. `defaultName` is optional and is
   * printed, not saved; naming a quote is not creating a customer.
   */
  const [defaultMode, setDefaultMode] = useState(false);
  const [defaultName, setDefaultName] = useState('');

  /*
   * The chart sheet itself, loaded once the download dialog is open on it.
   *
   * Needed BEFORE the export, because the category picker has to offer the
   * categories this sheet actually carries. Deriving them from the catalogue
   * lookups instead would offer categories the default configuration excludes,
   * or ones with nothing on the rate list — a tick that produces an empty
   * section. The same payload is then exported, so opening the picker is not a
   * wasted round trip.
   */
  const { data: defaultList, isFetching: defaultListLoading } = useDefaultRateList(downloadOpen && defaultMode);

  /** Categories the DEFAULT configuration puts on the chart sheet — the
   *  party-less counterpart of `configured`. */
  const defaultConfigured = useMemo(() => {
    if (!defaultList) return [] as string[];
    const sec = buildSections(defaultList, { config: defaultConfig });
    return [...new Set([...sec.products.map((t) => t.category), ...sec.designs.map((t) => t.category)])].sort((a, b) =>
      a.localeCompare(b),
    );
  }, [defaultList, defaultConfig]);

  /** Whichever scope the dialog is currently working in. Everything below reads
   *  this rather than branching on `defaultMode` in five places. */
  const dlScope = defaultMode ? defaultConfigured : configured;

  /** Opening the picker starts from whatever is on screen — the user's current
   *  filter if they set one, otherwise the party's configuration (§26: the saved
   *  setup is the starting point, not a cage). */
  const openDownload = () => {
    setDefaultMode(false);
    setDlCats(catFilter.length ? catFilter : configured);
    setDownloadOpen(true);
  };

  /** The chart sheet: no party, so no party filter and no party categories —
   *  every category the DEFAULT configuration allows. */
  const openDefaultDownload = () => {
    setDefaultMode(true);
    setDefaultName('');
    // Left empty here and seeded by the effect below — the categories are not
    // known until the sheet arrives, and guessing them now would tick a list
    // that turns out to be wrong.
    setDlCats([]);
    setDownloadOpen(true);
  };

  /* Tick everything the moment the chart sheet's categories are known. Same
     starting point as the party dialog: the download is a narrowing of the whole
     sheet, never an opt-in to it. */
  useEffect(() => {
    if (!downloadOpen || !defaultMode || !defaultConfigured.length) return;
    setDlCats((prev) => (prev.length ? prev : defaultConfigured));
  }, [downloadOpen, defaultMode, defaultConfigured]);

  /** An empty selection is a real state now, so it has to block the download
   *  rather than silently mean "everything". */
  /** An empty selection is a real state, so it has to block the export rather
   *  than silently mean "everything" — in either mode. */
  const nothingPicked = dlScope.length > 1 && dlCats.length === 0;
  /** The chart sheet has not arrived yet — nothing to preview or save from. */
  const exportBlocked = defaultMode && !defaultList;

  /**
   * The scope every export shares.
   *
   * Extracted so Preview and Download cannot disagree about what is on the
   * sheet — a preview built from a different `opts` is a preview of a document
   * nobody will receive.
   */
  /**
   * The chart sheet with the typed name on it.
   *
   * The payload was fetched WITHOUT a name (see useDefaultRateList) so the cache
   * is not keyed on a free-text box; the heading is substituted here instead of
   * re-fetching 650 lines to change one string. `DEFAULT_RATE_LIST_TITLE` is the
   * same constant the server falls back to, so a blank name prints identically
   * whichever side supplied it.
   */
  const namedDefaultList = (): CustomerRateList => {
    const base = defaultList!;
    const name = defaultName.trim();
    return { ...base, customerName: name || DEFAULT_RATE_LIST_TITLE };
  };

  const downloadOpts = () => ({
    config: defaultMode ? defaultConfig : config,
    // `null` means "no narrowing", so it may only stand for a FULL selection —
    // and it is now decided against whichever scope the dialog is in. It used to
    // be hard-coded to null for the chart sheet, which is why that sheet ignored
    // the picker entirely.
    categories: dlCats.length === dlScope.length ? null : dlCats,
  });

  /**
   * Build the PDF and show it, rather than saving it.
   *
   * iOS gets a tab instead of the in-app overlay: Safari will not render a blob:
   * PDF in an iframe, so the overlay would be an empty grey box. The tab is
   * reserved inside this tap — a popup opened after the async build is blocked.
   */
  const doPreview = async () => {
    if (!defaultMode && customerId == null) return;
    // The chart sheet is the source for the export as well as the picker, so
    // there is nothing to build until it has landed.
    if (defaultMode && !defaultList) return;
    const iosTab = isIOS() ? window.open('', '_blank') : null;
    if (iosTab) showPreviewPlaceholder(iosTab);
    try {
      setBusy('preview');
      const list = defaultMode ? namedDefaultList() : (rateList ?? (await fetchCustomerRateList(customerId!)));
      const { blob } = await buildRateListPdfBlob(list, downloadOpts(), company?.logo ?? null);
      const url = URL.createObjectURL(blob);
      if (iosTab) {
        if (!iosTab.closed) iosTab.location.href = url;
        else window.location.href = url;
        // Long enough for Safari to have loaded it; revoking sooner blanks the tab.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      }
      setDownloadOpen(false);
    } catch {
      iosTab?.close();
      toast.error('Could not build the preview.');
    } finally {
      setBusy(null);
    }
  };

  const closePreview = () =>
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

  const doDownload = async (format: 'pdf' | 'excel') => {
    if (!defaultMode && customerId == null) return;
    if (defaultMode && !defaultList) return;
    try {
      setBusy(format);
      // The chart sheet is always fetched fresh — there is no on-screen preview
      // of it to reuse, and it carries no party rates to go stale against.
      const list = defaultMode ? namedDefaultList() : (rateList ?? (await fetchCustomerRateList(customerId!)));
      // Same config, same selection, same pivot as the preview — the download
      // cannot show something the screen didn't.
      // `null` means "no category filter" to the pivot builder, so it may only
      // stand for a FULL selection. Passing it for an empty one turned "I
      // unticked everything" into "give me everything" — the buttons are
      // disabled in that state now, and this keeps the two in step.
      const opts = downloadOpts();
      if (format === 'pdf') await exportRateListPdf(list, opts, company?.logo ?? null);
      else await exportRateListExcel(list, opts);
      setDownloadOpen(false);
    } catch {
      toast.error('Failed to build the rate list.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2.5 font-sans">
      {/*
        One consolidated header instead of three floating bands.
        ERP screens put identity, key figures and actions in a single bordered
        block with hairline dividers, so the eye lands on the party once and
        everything below it is understood as belonging to that party. Padding is
        deliberately tight (10–12px) and controls are a uniform 34px — density is
        the point, not decoration.
      */}
      <div className="bg-card font-poppins overflow-hidden rounded-[4px] border shadow-sm">
        {/* ── Band 1: who, and what you can do about it ── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="bg-gradient-brand hidden size-8 shrink-0 place-items-center rounded-[4px] text-white shadow-sm sm:grid">
              <IndianRupee className="size-4" />
            </span>
            <div className="min-w-0">
              <Label className={cn(MICRO_LABEL, 'block leading-none')}>Customer</Label>
              <NativeSelect
                value={customerLabel}
                onChange={setCustomerLabel}
                options={options}
                placeholder="Select a customer…"
                className={cn(CONTROL, 'mt-1 h-8 w-full font-semibold sm:w-60')}
              />
            </div>
          </div>

          {/* Party context, read-only — the kind of at-a-glance identity strip an
              ERP header carries so nobody has to open another screen for it. */}
          {customerId != null && (
            <div className="hidden items-center gap-3 self-stretch border-l pl-3 lg:flex">
              <Meta label="Rate basis" value={effective?.partyConfigured ? 'Party configuration' : 'Default configuration'} />
              {excludedCount > 0 && (
                <Meta label="Excluded" value={`${excludedCount} categor${excludedCount === 1 ? 'y' : 'ies'}`} tone="amber" />
              )}
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {listFetching && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
            {customerId != null && (
              <Button
                variant={compare ? 'default' : 'outline'}
                className={cn('h-8 rounded-[4px] text-[12px] font-bold', !compare && CONTROL)}
                onClick={() => setCompare((c) => !c)}
                title="Show our own rate and the adjustment beside the customer's rate"
              >
                <ArrowRightLeft className="size-3.5" />
                <span className="hidden sm:inline">{compare ? 'Comparing' : 'Compare our rate'}</span>
                <span className="sm:hidden">{compare ? 'Comparing' : 'Compare'}</span>
              </Button>
            )}
            {/* Always available, party or not — this is the sheet you hand a new
                enquiry, so requiring a customer first would defeat it. */}
            <Button
              variant="outline"
              className={cn('h-8 rounded-[4px] text-[12px] font-bold', CONTROL)}
              onClick={openDefaultDownload}
              title="Download the standard chart rate list — base rates, no party discounts. You can print any name on it."
            >
              <FileDown className="size-3.5" />
              <span className="hidden sm:inline">Default rate list</span>
              <span className="sm:hidden">Default</span>
            </Button>
            <Button
              className="bg-gradient-brand h-8 rounded-[4px] text-[12px] font-bold text-white shadow-sm hover:opacity-95"
              disabled={customerId == null}
              onClick={openDownload}
              title={customerId == null ? 'Select a customer first' : 'Download this customer’s rate list'}
            >
              <Download className="size-3.5" /> Download
            </Button>
          </div>
        </div>

        {/* ── Band 2: the figures, as an ERP stat strip ── */}
        {/* gap-px over a border-coloured background draws hairlines that stay
            correct however the grid wraps — per-cell borders leave a stray edge
            on the second column once it becomes 2-up on a phone. */}
        {customerId != null && (
          <div className="bg-border grid grid-cols-2 gap-px border-t sm:grid-cols-4">
            <Stat label="Products" value={productRows} icon={Package} />
            <Stat label="Designs" value={designRows} icon={Brush} tone="violet" />
            <Stat
              label="Categories"
              value={configured.length}
              icon={Layers}
              tone="amber"
              hint={catFilter.length ? `${catFilter.length} filtered` : undefined}
            />
            <Stat
              label="Special rates"
              value={impacts.length}
              icon={Percent}
              tone={impacts.length ? 'indigo' : 'slate'}
              hint={impacts.length ? `${summary.up} up · ${summary.down} down` : 'none set'}
            />
          </div>
        )}

        {/*
          * ── Band 3: view switch + the category filter that narrows it ──
          *
          * NOT gated on a selected customer any more. The strip carries the Rate
          * List Settings tab, and the configuration is not about one party — the
          * DEFAULT lives there. Hiding the strip until a customer was picked made
          * the settings unreachable without first choosing a party they have
          * nothing to do with.
          */}
        <div className="bg-muted/30 flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-3 py-2">
            <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-[4px] border border-amber-300 bg-amber-50/60 p-0.5 dark:border-amber-400/40 dark:bg-amber-400/10">
              {(
                [
                  { id: 'list' as const, label: 'Rate List', icon: TableProperties },
                  { id: 'special' as const, label: 'Special Rates', icon: Percent },
                  { id: 'history' as const, label: 'Change History', icon: History },
                  // Moved here from Settings → Rate List. It configures THIS
                  // screen and nothing else, and the person laying out a sheet
                  // needs to see the sheet while they do it — two menus away
                  // meant configure, navigate, check, navigate back.
                  ...(canEditRateList ? [{ id: 'settings' as const, label: 'Rate List Settings', icon: Settings2 }] : []),
                ]
              ).map(({ id, label, icon: Icon }) => {
                const on = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    aria-pressed={on}
                    className={cn(
                      'flex cursor-pointer items-center gap-1.5 rounded-[3px] px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap transition-colors duration-150',
                      on
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-200/70 dark:hover:bg-amber-400/10',
                    )}
                  >
                    <Icon className="size-3.5" /> {label}
                  </button>
                );
              })}
            </div>

            {/* Only narrows the Rate List — showing it over the other two tabs
                would imply a filter that does nothing. */}
            {/* Still party-scoped: it narrows the sheet on screen. */}
            {tab === 'list' && customerId != null && configured.length > 1 && (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className={cn(MICRO_LABEL, 'hidden sm:block')}>Categories</span>
                <CategoryChips all={configured} selected={catFilter} onToggle={toggleCat} onAll={() => setCatFilter([])} />
              </div>
            )}
        </div>
      </div>

      {/* The configuration is not about one party — the DEFAULT lives there — so
          this tab renders with nothing selected. Everything else needs a party. */}
      {tab === 'settings' ? (
        <RateListSettingsCard canEdit={canEditRateList} />
      ) : customerId == null ? (
        <div className="text-muted-foreground grid place-items-center rounded-[4px] border border-dashed py-20 text-[13px] font-medium">
          <IndianRupee className="mb-2 size-8 opacity-40" />
          Select a customer to view their rate list.
        </div>
      ) : (
        <>
          {tab === 'list' ? (
            listLoading ? (
              <div className="grid place-items-center py-20">
                <Loader2 className="text-muted-foreground size-6 animate-spin" />
              </div>
            ) : totalTableCount === 0 ? (
              <div className="text-muted-foreground grid place-items-center rounded-[4px] border border-dashed py-20 text-[13px] font-medium">
                <TableProperties className="mb-2 size-8 opacity-40" />
                No products or designs to rate yet.
              </div>
            ) : (
              <div className="relative">
                {/* Faint centered KAVISH watermark, mirroring the printed rate sheet. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-0 flex items-start justify-center overflow-hidden"
                >
                  <img src={company?.logo || kavishLogo} alt="" className="mt-24 w-[min(60%,520px)] opacity-[0.05]" />
                </div>
                <div className="relative z-10 space-y-2.5">
                  {/* The header already names the party and the rate basis, so
                      this says only what it doesn't: how these figures are built. */}
                  <p className="text-muted-foreground text-[11.5px] font-medium">
                    Base chart rate + this customer’s special-rate adjustments.
                  </p>
                  {compare && (
                    <p className="text-muted-foreground rounded-[4px] border border-dashed px-2.5 py-1.5 text-[11.5px] font-medium">
                      Under an adjusted rate: <b className="text-foreground">our rate</b> and the{' '}
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">adjustment</span> — green where the
                      customer pays more than our rate, red where they pay less. A single figure means they pay our rate, with
                      no adjustment.
                    </p>
                  )}
                  {sections?.products.map((t) => <PivotCard key={t.title} t={t} compare={compare} />)}
                  {sections?.designs.map((t) => <DesignPivotCard key={t.title} t={t} compare={compare} />)}
                </div>
              </div>
            )
          ) : tab === 'special' ? (
            <SpecialRatesPanel customerLabel={customerLabel} impacts={impacts} summary={summary} logos={special?.logos.length ?? 0} />
          ) : historyLoading ? (
            <div className="grid place-items-center py-20">
              <Loader2 className="text-muted-foreground size-6 animate-spin" />
            </div>
          ) : versions.length === 0 ? (
            <div className="text-muted-foreground grid place-items-center rounded-[4px] border border-dashed py-20 text-[13px] font-medium">
              <History className="mb-2 size-8 opacity-40" />
              No special-rate changes recorded for {customerLabel} yet.
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-muted-foreground text-[12px] font-medium">
                <span className="font-bold text-foreground">{versions.length}</span> version{versions.length > 1 ? 's' : ''} · newest first — click a version to expand its items.
              </p>
              {versions.map((v, i) => (
                <VersionCard key={v.key} v={v} defaultOpen={i === 0} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Download format chooser */}
      <Dialog open={downloadOpen} onOpenChange={(o) => !busy && setDownloadOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {defaultMode ? <FileDown className="size-5 text-primary" /> : <Download className="size-5 text-primary" />}
              {defaultMode ? 'Download default rate list' : 'Download rate list'}
            </DialogTitle>
            <DialogDescription>
              {defaultMode ? (
                <>
                  The standard chart rates — <b>no party discounts applied</b>. For quoting someone who isn’t a customer yet.
                </>
              ) : (
                <>
                  Current effective rate list for <b>{customerLabel}</b> (base rates + this customer’s adjustments). Choose what
                  to include, then a format.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {defaultMode && (
            <div className="space-y-1.5">
              <Label htmlFor="dl-name" className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">
                Print this name on the sheet — optional
              </Label>
              <Input
                id="dl-name"
                value={defaultName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDefaultName(e.target.value)}
                placeholder="Leave blank for “STANDARD RATE LIST”"
                autoComplete="off"
                className="h-9"
              />
              <p className="text-muted-foreground text-[11px]">
                Printed at the top of the sheet only. It does not create a customer or save anything.
              </p>
            </div>
          )}

          {/* §4: the download is not forced to be everything. Starts from the
              party's configuration (or the on-screen filter) and can be narrowed
              — never widened past what the configuration allows. */}
          {/* Shown for the chart sheet too. It used to be party-only, so the
              default download silently sent every category — the one sheet you
              are most likely to want trimmed before handing it to an enquiry. */}
          {defaultMode && defaultListLoading && !defaultConfigured.length && (
            <p className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-[12.5px]">
              <Loader2 className="size-3.5 animate-spin" /> Loading the categories on this sheet…
            </p>
          )}
          {dlScope.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">Include</Label>
              {/*
                * `selected` is handed straight through — deliberately.
                *
                * It used to be `dlCats.length === configured.length ? [] : dlCats`,
                * borrowing the page filter's "empty means everything" convention to
                * light up the All chip. That lit All by leaving all six category
                * chips looking UNTICKED while the state actually held all six. So
                * the first click read as the opposite of what it did: clicking
                * GLASS removed GLASS from a full selection, five chips lit up, and
                * it looked as though clicking one category had auto-selected the
                * other five.
                *
                * Here the chips just say what will be downloaded. All six start
                * ticked because all six are included, and clicking GLASS unticks
                * GLASS. `showAllActive` keeps the All chip meaningful without
                * lying about the individual ones.
                */}
              <CategoryChips
                all={dlScope}
                selected={dlCats}
                showAllActive={dlCats.length === dlScope.length}
                onToggle={(c) => setDlCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))}
                onAll={() => setDlCats(dlCats.length === dlScope.length ? [] : dlScope)}
              />
              <p
                className={cn(
                  'text-[11px]',
                  dlCats.length === 0 ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
                )}
              >
                {dlCats.length === 0
                  ? 'Pick at least one category to download.'
                  : dlCats.length === dlScope.length
                    ? `All ${dlScope.length} categories`
                    : `${dlCats.length} of ${dlScope.length} categories`}
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {/* Preview first: it is the non-committal option, and reading left to
                right the row now goes look → save → save-as-sheet. */}
            <Button
              variant="outline"
              className="h-12 flex-1"
              disabled={!!busy || nothingPicked || exportBlocked}
              title={nothingPicked ? 'Pick at least one category' : 'See the sheet before saving it'}
              onClick={doPreview}
            >
              {busy === 'preview' ? <Loader2 className="animate-spin" /> : <Eye className="text-violet-600" />} Preview
            </Button>
            <Button
              variant="outline"
              className="h-12 flex-1"
              disabled={!!busy || nothingPicked || exportBlocked}
              title={nothingPicked ? 'Pick at least one category' : undefined}
              onClick={() => doDownload('pdf')}
            >
              {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <FileText className="text-rose-600" />} PDF
            </Button>
            <Button
              variant="outline"
              className="h-12 flex-1"
              disabled={!!busy || nothingPicked || exportBlocked}
              title={nothingPicked ? 'Pick at least one category' : undefined}
              onClick={() => doDownload('excel')}
            >
              {busy === 'excel' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet className="text-emerald-600" />} Excel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The preview shows the REAL generated document — the same bytes Download
          writes, via the same builder — not a re-render of the on-screen table,
          which lays out differently and would mislead about what prints. */}
      {previewUrl && (
        <Dialog open onOpenChange={(open) => !open && closePreview()}>
          <DialogContent className="flex h-[92dvh] w-[min(1100px,96vw)] max-w-[96vw] flex-col gap-3 overflow-hidden p-4 sm:!max-w-[1100px]">
            <DialogHeader className="space-y-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Eye className="size-4.5 text-violet-600" /> Preview — {defaultMode ? defaultName || 'Standard rate list' : customerLabel}
              </DialogTitle>
            </DialogHeader>

            <div className="min-h-0 w-full flex-1 overflow-hidden rounded-[6px] border bg-slate-200/60 shadow-inner dark:bg-slate-800/60">
              <iframe src={`${previewUrl}${PDF_VIEWER_PARAMS}`} title="Rate list preview" className="size-full border-0" />
            </div>

            <DialogFooter className="gap-2 sm:justify-end">
              <Button variant="outline" onClick={closePreview}>
                Close
              </Button>
              {/* Hiding the viewer's toolbar takes its own open/print controls
                  with it, so the app supplies the ones that matter. */}
              <Button variant="outline" onClick={() => window.open(previewUrl, '_blank')} title="Open this PDF in a browser tab">
                <ExternalLink /> Open in tab
              </Button>
              <Button
                onClick={() => {
                  closePreview();
                  void doDownload('pdf');
                }}
                disabled={!!busy}
              >
                {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default RateListPage;
