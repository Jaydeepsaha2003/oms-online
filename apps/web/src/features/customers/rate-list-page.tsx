import { useMemo, useState } from 'react';
import { ChevronRight, Download, FileSpreadsheet, FileText, History, IndianRupee, Loader2, TableProperties, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import type { RateChangeEntry } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/common/combo';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import kavishLogo from '@/assets/kavish-logo.png';
import { fetchCustomerRateList, useCustomerRateHistory, useCustomerRateList, useCustomers } from './use-customers';
import { exportRateListExcel, exportRateListPdf } from './customer-rate-list-export';
import { buildSections, type DesignPivotTable, type PivotTable } from './customer-rate-list-pivot';

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

/** One category's pivoted rate table, mirroring the printed sheet / the PDF. */
function PivotCard({ t }: { t: PivotTable }) {
  return (
    <div className="bg-card overflow-hidden rounded-[4px] border shadow-sm">
      <div className="bg-gradient-to-b from-blue-800 to-indigo-800 px-3 py-2 text-[13.5px] font-extrabold tracking-wide text-white uppercase">{t.title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] [&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-white/20 [&_th:last-child]:border-r-0">
          <thead>
            <tr className="bg-gradient-to-b from-blue-800 to-indigo-800 text-[11.5px] text-white uppercase">
              <th className="w-12 px-3 py-1.5 text-left font-extrabold">SR</th>
              <th className="px-3 py-1.5 text-left font-extrabold">Item</th>
              <th className="w-28 px-3 py-1.5 text-left font-extrabold">Available pcs</th>
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
                <td className="text-muted-foreground text-[11.5px] font-medium tabular-nums">{r.available}</td>
                {r.cells.map((cell, i) => (
                  <td key={i} className="text-right text-[13px] font-bold tabular-nums text-slate-900 dark:text-slate-100">{cell || <span className="text-muted-foreground/40">—</span>}</td>
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
function DesignPivotCard({ t }: { t: DesignPivotTable }) {
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
              <th className="w-28 px-3 py-1.5 text-left font-extrabold">Available pcs</th>
              <th className="w-28 px-3 py-1.5 text-right font-extrabold">Rate</th>
            </tr>
          </thead>
          <tbody className="[&_td]:border-t [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1 dark:[&_td]:border-white/10">
            {t.rows.map((r) => (
              <tr key={r.sr} className="even:bg-slate-100/80 dark:even:bg-white/[0.04]">
                <td className="text-muted-foreground text-[12px] font-medium tabular-nums">{r.sr}</td>
                <td className={TEXT_CELL}>{r.item}</td>
                <td className="text-muted-foreground text-[11.5px] font-medium tabular-nums">{r.available || '—'}</td>
                <td className="text-right text-[13.5px] font-bold tabular-nums text-slate-900 dark:text-slate-100">{r.rate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Tab = 'list' | 'history';

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
  const sections = useMemo(() => (rateList ? buildSections(rateList) : null), [rateList]);
  const totalTableCount = (sections?.products.length ?? 0) + (sections?.designs.length ?? 0);

  const [downloadOpen, setDownloadOpen] = useState(false);
  const [busy, setBusy] = useState<'pdf' | 'excel' | null>(null);

  const doDownload = async (format: 'pdf' | 'excel') => {
    if (customerId == null) return;
    try {
      setBusy(format);
      const list = rateList ?? (await fetchCustomerRateList(customerId));
      if (format === 'pdf') await exportRateListPdf(list);
      else exportRateListExcel(list);
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
        <Button
          className="bg-gradient-brand ml-auto h-9 rounded-[4px] text-[12.5px] font-bold text-white shadow-sm hover:opacity-95"
          disabled={customerId == null}
          onClick={() => setDownloadOpen(true)}
          title={customerId == null ? 'Select a customer first' : 'Download this customer’s rate list'}
        >
          <Download /> Download Rate List
        </Button>
      </div>

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
                  <img src={kavishLogo} alt="" className="mt-24 w-[min(60%,520px)] opacity-[0.05]" />
                </div>
                <div className="relative z-10 space-y-2.5">
                  <p className="text-muted-foreground flex items-center gap-2 text-[12px] font-medium">
                    {listFetching && <Loader2 className="size-3.5 animate-spin" />}
                    Current effective rates for <b className="text-foreground">{customerLabel}</b> — base chart rate + this customer’s special-rate adjustments.
                  </p>
                  {sections?.products.map((t) => <PivotCard key={t.title} t={t} />)}
                  {sections?.designs.map((t) => <DesignPivotCard key={t.title} t={t} />)}
                </div>
              </div>
            )
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
              Current effective rate list for <b>{customerLabel}</b> (base rates + this customer’s adjustments). Choose a format.
            </DialogDescription>
          </DialogHeader>
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
