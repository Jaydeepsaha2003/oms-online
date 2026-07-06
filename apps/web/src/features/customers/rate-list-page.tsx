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
import { buildSections, type PivotTable } from './customer-rate-list-pivot';

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

function RateDelta({ oldRate, newRate }: { oldRate: number | null; newRate: number | null }) {
  const up = (newRate ?? 0) > (oldRate ?? 0);
  const down = (newRate ?? 0) < (oldRate ?? 0);
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <span className="text-muted-foreground">{oldRate == null ? '—' : oldRate}</span>
      <ChevronRight className="size-3.5 text-muted-foreground" />
      <span className={cn('font-semibold', up && 'text-rose-600', down && 'text-emerald-600')}>
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
    <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-muted/40 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
      >
        <ChevronRight className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-90')} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{formatDateTime(v.changedAt)}</div>
          <div className="text-muted-foreground text-xs">
            {v.changes.length} rate{v.changes.length > 1 ? 's' : ''} changed{v.changedByName ? ` · by ${v.changedByName}` : ''}
          </div>
        </div>
        {!open && !multi && (
          <span className="shrink-0 text-sm">
            <RateDelta oldRate={v.changes[0].oldRate} newRate={v.changes[0].newRate} />
          </span>
        )}
        {multi && <span className="bg-primary/10 text-primary shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold">{v.changes.length} items</span>}
      </button>
      {open && (
        <div className="border-t">
          <table className="w-full text-[15px] [&_td]:border-r [&_td]:border-border/60 [&_td:last-child]:border-r-0">
            <tbody className="[&_td]:border-t [&_td]:px-4 [&_td]:py-2 [&_tr:first-child_td]:border-t-0">
              {v.changes.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{changeLabel(c)}</td>
                  <td className="text-muted-foreground w-40 text-xs">
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
    <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
      <div className="bg-gradient-brand px-4 py-2.5 text-sm font-semibold tracking-wide text-white">{t.title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm [&_td]:border-r [&_td]:border-border/60 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-border/40 [&_th:last-child]:border-r-0">
          <thead>
            <tr className="bg-muted/60 text-muted-foreground text-xs uppercase">
              <th className="w-12 px-3 py-2 text-left font-semibold">SR</th>
              <th className="px-3 py-2 text-left font-semibold">Item</th>
              <th className="w-28 px-3 py-2 text-left font-semibold">Available pcs</th>
              {t.columns.map((c) => (
                <th key={c} className="w-24 px-3 py-2 text-right font-semibold">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="[&_td]:border-t [&_td]:px-3 [&_td]:py-2">
            {t.rows.map((r) => (
              <tr key={r.sr} className="even:bg-muted/25">
                <td className="text-muted-foreground tabular-nums">{r.sr}</td>
                <td className="font-medium">{r.item}</td>
                <td className="text-muted-foreground tabular-nums text-xs">{r.available}</td>
                {r.cells.map((cell, i) => (
                  <td key={i} className="text-right font-semibold tabular-nums">{cell || <span className="text-muted-foreground/40">—</span>}</td>
                ))}
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
  const allTables = useMemo(() => (sections ? [...sections.products, ...sections.designs] : []), [sections]);

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
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <IndianRupee className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Rate List</h2>
          <p className="text-muted-foreground text-sm">Pick a customer to see their current rate list, every rate-change version, and download the list.</p>
        </div>
      </div>

      {/* Customer picker + download */}
      <div className="bg-card flex flex-wrap items-end gap-3 rounded-md border p-3 shadow-sm">
        <div className="w-72 space-y-1">
          <Label className="text-xs">Customer</Label>
          <NativeSelect value={customerLabel} onChange={setCustomerLabel} options={options} placeholder="Select a customer…" />
        </div>
        <Button
          className="bg-gradient-brand ml-auto text-white shadow-sm hover:opacity-95"
          disabled={customerId == null}
          onClick={() => setDownloadOpen(true)}
          title={customerId == null ? 'Select a customer first' : 'Download this customer’s rate list'}
        >
          <Download /> Download Rate List
        </Button>
      </div>

      {customerId == null ? (
        <div className="text-muted-foreground grid place-items-center rounded-lg border border-dashed py-20 text-sm">
          <IndianRupee className="mb-2 size-8 opacity-40" />
          Select a customer to view their rate list.
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="bg-muted/60 inline-flex rounded-lg p-1">
            {(
              [
                { id: 'list' as const, label: 'Rate List', icon: TableProperties },
                { id: 'history' as const, label: 'Change History', icon: History },
              ]
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
                  tab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>

          {tab === 'list' ? (
            listLoading ? (
              <div className="grid place-items-center py-20">
                <Loader2 className="text-muted-foreground size-6 animate-spin" />
              </div>
            ) : allTables.length === 0 ? (
              <div className="text-muted-foreground grid place-items-center rounded-lg border border-dashed py-20 text-sm">
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
                <div className="relative z-10 space-y-4">
                  <p className="text-muted-foreground flex items-center gap-2 text-sm">
                    {listFetching && <Loader2 className="size-3.5 animate-spin" />}
                    Current effective rates for <b className="text-foreground">{customerLabel}</b> — base chart rate + this customer’s special-rate adjustments.
                  </p>
                  {allTables.map((t) => (
                    <PivotCard key={t.title} t={t} />
                  ))}
                </div>
              </div>
            )
          ) : historyLoading ? (
            <div className="grid place-items-center py-20">
              <Loader2 className="text-muted-foreground size-6 animate-spin" />
            </div>
          ) : versions.length === 0 ? (
            <div className="text-muted-foreground grid place-items-center rounded-lg border border-dashed py-20 text-sm">
              <History className="mb-2 size-8 opacity-40" />
              No special-rate changes recorded for {customerLabel} yet.
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-muted-foreground text-sm">
                {versions.length} version{versions.length > 1 ? 's' : ''} · newest first — click a version to expand its items.
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
