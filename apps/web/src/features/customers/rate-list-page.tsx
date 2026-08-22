import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Check, ChevronRight, Download, FileSpreadsheet, FileText, History, IndianRupee, Loader2, Percent, Sliders, TableProperties, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomerRateDto, RateChangeEntry } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/common/combo';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import kavishLogo from '@/assets/kavish-logo.png';
import { fetchCustomerRateList, useCustomerRateHistory, useCustomerRateList, useCustomers } from './use-customers';
import { useEffectiveRateListConfig } from './use-rate-list-config';
import { useCustomerSpecialRates } from '@/features/special-rates/use-special-rates';
import { useCompany } from '@/features/settings/use-settings';
import { measureSpecialRates, summariseSpecialRates, type RateImpact } from './special-rate-impact';
import { exportRateListExcel, exportRateListPdf } from './customer-rate-list-export';
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
      <span className={cn('font-bold', up && 'text-rose-600 dark:text-rose-400', down && 'text-emerald-600 dark:text-emerald-400')}>
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
function RateCell({ rate, base, delta, compare }: { rate: string; base: string; delta: string; compare: boolean }) {
  if (!rate) return <span className="text-muted-foreground/40">—</span>;
  const down = delta.startsWith('-');
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="text-[13px] font-bold tabular-nums text-slate-900 dark:text-slate-100">{rate}</span>
      {compare && delta && (
        <span className="flex items-center gap-1 text-[10.5px] font-semibold tabular-nums">
          <span className="text-muted-foreground">{base}</span>
          <span className={cn(down ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>{delta}</span>
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
                  <td key={i} className="text-right align-top">
                    <RateCell rate={cell} base={r.baseCells[i]} delta={r.deltaCells[i]} compare={compare} />
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
 */
function CategoryChips({
  all,
  selected,
  onToggle,
  onAll,
}: {
  all: string[];
  selected: string[];
  onToggle: (c: string) => void;
  onAll: () => void;
}) {
  const none = selected.length === 0;
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
function ruleTarget(r: CustomerRateDto): string {
  return [r.category, r.subCategory, r.target].filter(Boolean).join(' · ');
}

const span = (from: number | null, to: number | null): string =>
  from == null ? '—' : from === to ? String(from) : `${from}–${to}`;

/**
 * The consolidated Set Special Rate view (§19).
 *
 * Change History answers "what changed and when". This answers the different
 * question: what is configured RIGHT NOW, what is it doing, and how far from our
 * own rate does it put this party. Each rule is measured against the party's
 * actual sheet, so a rule that looks sweeping but is overridden everywhere
 * reports that plainly instead of implying reach it does not have.
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
  if (!impacts.length) {
    return (
      <div className="text-muted-foreground grid place-items-center rounded-[4px] border border-dashed py-20 text-[13px] font-medium">
        <Percent className="mb-2 size-8 opacity-40" />
        No special rates configured for {customerLabel} — they pay our rate on everything.
      </div>
    );
  }

  const chip = (label: string, value: string | number, tone: string) => (
    <span className={cn('rounded-[4px] px-2 py-1 text-[11.5px] font-bold', tone)}>
      {value} <span className="font-semibold opacity-70">{label}</span>
    </span>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {chip('rules', summary.rules, 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200')}
        {chip('increase the rate', summary.up, 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300')}
        {chip('reduce it', summary.down, 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300')}
        {chip('items priced', summary.items, 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300')}
        {summary.idle > 0 &&
          chip('price nothing', summary.idle, 'bg-amber-50 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200')}
        {logos > 0 && chip('logo restrictions', logos, 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200')}
      </div>

      <div className="bg-card overflow-hidden rounded-[4px] border shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] [&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-white/20 [&_th:last-child]:border-r-0">
            <thead>
              <tr className="bg-gradient-to-b from-blue-800 to-indigo-800 text-[11.5px] text-white uppercase">
                <th className="px-3 py-1.5 text-left font-extrabold">Applies to</th>
                <th className="w-24 px-3 py-1.5 text-left font-extrabold">Kind</th>
                <th className="w-28 px-3 py-1.5 text-left font-extrabold">Level</th>
                <th className="w-24 px-3 py-1.5 text-right font-extrabold">Adjustment</th>
                <th className="w-24 px-3 py-1.5 text-right font-extrabold">Items</th>
                <th className="w-32 px-3 py-1.5 text-right font-extrabold">Our rate</th>
                <th className="w-32 px-3 py-1.5 text-right font-extrabold">They pay</th>
              </tr>
            </thead>
            <tbody className="[&_td]:border-t [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1.5 dark:[&_td]:border-white/10">
              {impacts.map((i) => {
                const up = i.rule.rate > 0;
                return (
                  <tr key={i.rule.id} className="even:bg-slate-100/80 dark:even:bg-white/[0.04]">
                    <td className={TEXT_CELL}>{ruleTarget(i.rule)}</td>
                    <td className="text-muted-foreground text-[11.5px] font-bold">{i.rule.kind}</td>
                    <td className="text-muted-foreground text-[11.5px] font-bold">{i.rule.scope}</td>
                    <td
                      className={cn(
                        'text-right text-[13px] font-bold tabular-nums',
                        up ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400',
                      )}
                    >
                      {up ? <TrendingUp className="mr-0.5 inline size-3.5" /> : <TrendingDown className="mr-0.5 inline size-3.5" />}
                      {up ? `+${i.rule.rate}` : i.rule.rate}
                    </td>
                    {/* A rule pricing nothing is the interesting case, so it says why. */}
                    <td className="text-right text-[12.5px] font-bold tabular-nums">
                      {i.items > 0 ? (
                        i.items
                      ) : (
                        <span className="text-amber-700 dark:text-amber-300">
                          {i.shadowed > 0 ? `0 · ${i.shadowed} overridden` : '0'}
                        </span>
                      )}
                    </td>
                    <td className="text-muted-foreground text-right text-[12.5px] font-bold tabular-nums">
                      {span(i.baseFrom, i.baseTo)}
                    </td>
                    <td className="text-right text-[13px] font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {span(i.rateFrom, i.rateTo)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-muted-foreground text-[11.5px] font-medium">
        Measured against {customerLabel}’s current sheet through the same cascade that prices an order — ITEM beats
        SUBCATEGORY beats CATEGORY, and only the winner applies. A rule showing <b className="text-foreground">0 items</b> is
        configured but priced out of every line it matches.
      </p>
    </div>
  );
}

type Tab = 'list' | 'special' | 'history';

export function RateListPage() {
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
  const [busy, setBusy] = useState<'pdf' | 'excel' | null>(null);

  /** Opening the picker starts from whatever is on screen — the user's current
   *  filter if they set one, otherwise the party's configuration (§26: the saved
   *  setup is the starting point, not a cage). */
  const openDownload = () => {
    setDlCats(catFilter.length ? catFilter : configured);
    setDownloadOpen(true);
  };

  const doDownload = async (format: 'pdf' | 'excel') => {
    if (customerId == null) return;
    try {
      setBusy(format);
      const list = rateList ?? (await fetchCustomerRateList(customerId));
      // Same config, same selection, same pivot as the preview — the download
      // cannot show something the screen didn't.
      const opts = { config, categories: dlCats.length ? dlCats : null };
      if (format === 'pdf') await exportRateListPdf(list, opts, company?.logo ?? null);
      else exportRateListExcel(list, opts);
      setDownloadOpen(false);
    } catch {
      toast.error('Failed to build the rate list.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2.5 font-sans">
      {/* Customer picker + download — one compact toolbar (no separate page header;
          the topbar already says "Rate List"). */}
      <div className="bg-card font-poppins flex flex-wrap items-end gap-3 rounded-[4px] border p-2.5 shadow-sm sm:p-3">
        <div className="w-full space-y-1 sm:w-64">
          <Label className="text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">Customer</Label>
          <NativeSelect value={customerLabel} onChange={setCustomerLabel} options={options} placeholder="Select a customer…" className={cn(CONTROL, 'font-medium')} />
        </div>
        {customerId != null && configured.length > 1 && (
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">Categories</Label>
            <CategoryChips all={configured} selected={catFilter} onToggle={toggleCat} onAll={() => setCatFilter([])} />
          </div>
        )}
        {customerId != null && (
          <Button
            variant={compare ? 'default' : 'outline'}
            className={cn('ml-auto h-9 rounded-[4px] text-[12.5px] font-bold', !compare && CONTROL)}
            onClick={() => setCompare((c) => !c)}
            title="Show our own rate and the adjustment beside the customer's rate"
          >
            <ArrowRightLeft /> {compare ? 'Comparing our rate' : 'Compare our rate'}
          </Button>
        )}
        <Button
          className={cn('bg-gradient-brand h-9 rounded-[4px] text-[12.5px] font-bold text-white shadow-sm hover:opacity-95', customerId == null && 'ml-auto')}
          disabled={customerId == null}
          onClick={openDownload}
          title={customerId == null ? 'Select a customer first' : 'Download this customer’s rate list'}
        >
          <Download /> Download Rate List
        </Button>
      </div>

      {/* Why the sheet looks the way it does — §29's "reused automatically" is
          only useful if the user can see that it happened. */}
      {customerId != null && (effective?.partyConfigured || excludedCount > 0) && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[11.5px] font-medium">
          <Sliders className="size-3.5" />
          {effective?.partyConfigured
            ? `Using ${customerLabel}’s saved rate list configuration`
            : 'Using the default rate list configuration'}
          {excludedCount > 0 && ` · ${excludedCount} categor${excludedCount === 1 ? 'y is' : 'ies are'} excluded by it`}
        </p>
      )}

      {customerId == null ? (
        <div className="text-muted-foreground grid place-items-center rounded-[4px] border border-dashed py-20 text-[13px] font-medium">
          <IndianRupee className="mb-2 size-8 opacity-40" />
          Select a customer to view their rate list.
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="inline-flex items-center gap-1 rounded-[4px] border border-amber-300 bg-amber-50/40 p-0.5 dark:border-amber-400/40">
            {(
              [
                { id: 'list' as const, label: 'Rate List', icon: TableProperties },
                { id: 'special' as const, label: 'Special Rates', icon: Percent },
                { id: 'history' as const, label: 'Change History', icon: History },
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
                    'flex cursor-pointer items-center gap-1.5 rounded-[3px] px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors duration-150',
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
                  <p className="text-muted-foreground flex items-center gap-2 text-[12px] font-medium">
                    {listFetching && <Loader2 className="size-3.5 animate-spin" />}
                    Current effective rates for <b className="text-foreground">{customerLabel}</b> — base chart rate + this customer’s special-rate adjustments.
                  </p>
                  {compare && (
                    <p className="text-muted-foreground rounded-[4px] border border-dashed px-2.5 py-1.5 text-[11.5px] font-medium">
                      Under an adjusted rate: <b className="text-foreground">our rate</b> and the{' '}
                      <span className="font-bold text-rose-600 dark:text-rose-400">adjustment</span>. A single figure means the
                      customer pays our rate — no adjustment applies there.
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
              <Download className="size-5 text-primary" /> Download rate list
            </DialogTitle>
            <DialogDescription>
              Current effective rate list for <b>{customerLabel}</b> (base rates + this customer’s adjustments). Choose what to
              include, then a format.
            </DialogDescription>
          </DialogHeader>

          {/* §4: the download is not forced to be everything. Starts from the
              party's configuration (or the on-screen filter) and can be narrowed
              — never widened past what the configuration allows. */}
          {configured.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">Include</Label>
              <CategoryChips
                all={configured}
                selected={dlCats.length === configured.length ? [] : dlCats}
                onToggle={(c) =>
                  setDlCats((prev) => {
                    const base = prev.length ? prev : configured;
                    const next = base.includes(c) ? base.filter((x) => x !== c) : [...base, c];
                    return next;
                  })
                }
                onAll={() => setDlCats(configured)}
              />
              <p className="text-muted-foreground text-[11px]">
                {dlCats.length === 0 || dlCats.length === configured.length
                  ? `All ${configured.length} categories`
                  : `${dlCats.length} of ${configured.length} categories`}
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" className="h-12 flex-1" disabled={!!busy} onClick={() => doDownload('pdf')}>
              {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <FileText className="text-rose-600" />} PDF
            </Button>
            <Button variant="outline" className="h-12 flex-1" disabled={!!busy} onClick={() => doDownload('excel')}>
              {busy === 'excel' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet className="text-emerald-600" />} Excel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default RateListPage;
