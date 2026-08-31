import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  EllipsisVertical,
  Eye,
  FileSearch,
  FileSpreadsheet,
  Filter,
  Layers,
  Pencil,
  Percent,
  Printer,
  Receipt,
  Search,
  Trash2,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ChallanDto } from '@oms/shared';
import { cn } from '@/lib/utils';
import { isIOS, reservePreviewTab } from '@/lib/pdf';
import { DATE_FORMATS, formatDate, useDateFormat } from '@/lib/date-format';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { usePermissions } from '@/hooks/use-permissions';
import { useColumnOrder } from '@/hooks/use-column-order';
import { usePageSize } from '@/hooks/use-page-size';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { DateRangeCalendar } from '@/components/common/date-range-calendar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { fetchAllChallans, useChallans, useChallanSummary, useDeleteChallan, useUpdateChallanStatus } from './use-challans';
import { PRESETS, presetRange } from './date-presets';
import { ChallanAnalyticsDialog } from './challan-analytics-dialog';
import { NativeSelect } from '@/components/common/combo';
import { downloadFile } from '@/lib/api';
import { ReportDownloadOverlay, type ReportPhase } from './report-download-overlay';

const money = (v: number | null) => `₹ ${(v ?? 0).toLocaleString('en-IN')}`;

/** Matches the Pending Challan grid: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800';
/**
 * Filter controls share the amber-bordered, 36px, lightly-rounded look used on
 * Pending Challan, so the two challan screens read as one product.
 */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

const STATUSES = [
  { value: '', label: 'All' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const;

// Persist the list's filters so they survive navigating into a challan and back.
const FILTER_KEY = 'oms:challans-filters:v2';
const DEFAULT_PRESET = 'This Year';
interface ChallanFilters {
  searchInput: string;
  dateFrom: string;
  dateTo: string;
  preset: string;
  status: string;
  agent: string;
  page: number;
}
const loadFilters = (): Partial<ChallanFilters> => {
  try {
    sessionStorage.removeItem(FILTER_KEY);
  } catch {}
  return {};
};

/**
 * Filters read off the URL.
 *
 * Leaving the list to preview a challan and coming back used to land on a bare
 * `/challans`, which rebuilt the page with default filters — a search for "DN"
 * and the chosen date range were simply gone. The trip back now carries them,
 * so the list the user left is the list they return to. Browser Back gets the
 * same treatment for free.
 *
 * A plain `/challans` with no query still starts clean, which keeps the
 * "a fresh visit is a fresh start" behaviour.
 */
const filtersFromParams = (p: URLSearchParams): Partial<ChallanFilters> => {
  const get = (k: string) => p.get(k) ?? undefined;
  const out: Partial<ChallanFilters> = {
    searchInput: get('q'),
    dateFrom: get('from'),
    dateTo: get('to'),
    preset: get('preset'),
    status: get('status'),
    agent: get('agent'),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Partial<ChallanFilters>;
};

/**
 * What the DUE column says.
 *
 * A settled bill is never overdue, however long ago its date passed. This used
 * to compare the due date with today and nothing else — the note here said the
 * paid state "needs the accounting module" — so a challan paid weeks early
 * still sat in red claiming "40 over". The list now carries what is left on
 * each challan (see `balance` on ChallanDto), which is the same amount − receipts
 * − discounts the payments engine settles by.
 */
function dueInfo(due: string | null, balance?: number): { text: string; over: boolean; paid: boolean } {
  // Nil balance wins over any date. Undefined means the caller did not supply
  // one, and then the old date-only answer is the honest one.
  if (balance != null && balance <= 0.004) return { text: 'Paid', over: false, paid: true };
  if (!due) return { text: '—', over: false, paid: false };
  const d = new Date(due);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { text: `${Math.abs(days)} over`, over: true, paid: false };
  return { text: `${days} left`, over: false, paid: false };
}

export function ChallansListPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { can } = usePermissions();
  const { format, setFormat } = useDateFormat();
  const canUpdate = can('challan:update');
  const canDelete = can('challan:delete');
  const canPrint = can('challan:print');
  const [urlParams] = useSearchParams();
  const location = useLocation();
  // Read once: after this the filters are ordinary state the user drives.
  const initialFilters = useMemo(() => {
    const fromUrl = filtersFromParams(urlParams);
    return Object.keys(fromUrl).length ? fromUrl : loadFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const defaultFy = useMemo(() => presetRange(DEFAULT_PRESET)!, []);

  // Fresh visit or refresh starts at default clean filters (current Indian financial year).
  const [searchInput, setSearchInput] = useState(() => initialFilters.searchInput ?? '');
  const [search, setSearch] = useState(() => (initialFilters.searchInput ?? '').trim());
  const [dateFrom, setDateFrom] = useState(() => initialFilters.dateFrom ?? defaultFy.from);
  const [dateTo, setDateTo] = useState(() => initialFilters.dateTo ?? defaultFy.to);
  const [preset, setPreset] = useState(() => initialFilters.preset ?? DEFAULT_PRESET);
  const [status, setStatus] = useState(() => initialFilters.status ?? '');
  const [agent, setAgent] = useState(() => initialFilters.agent ?? '');
  const { page, setPage, pageSize, setPageSize } = usePageSize('challans-list', undefined, 1);
  // Phones: date range / quick range / status live behind this Filter icon.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const dateActive = !!(dateFrom || dateTo || preset);
  const activeFilterCount = (dateActive ? 1 : 0) + (status ? 1 : 0) + (agent ? 1 : 0);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  /*
   * Keep the address bar showing what is on screen.
   *
   * `replace`, so this never adds history entries as the user types — but it
   * does mean the entry they leave FROM already carries their filters. That is
   * what makes browser Back, and the bill page's own back button, return to the
   * list they were looking at instead of a default one. The preview round-trip
   * is the case that was reported; this covers every other way out and back.
   */
  useEffect(() => {
    const target = listUrl();
    if (`${location.pathname}${location.search}` !== target) navigate(target, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, dateFrom, dateTo, preset, status, agent]);

  /** This list, as a URL — so a page we hand off to can send the user back to
   *  exactly what they were looking at rather than to a default list. */
  const listUrl = () => {
    const p = new URLSearchParams();
    if (searchInput.trim()) p.set('q', searchInput.trim());
    if (dateFrom) p.set('from', dateFrom);
    if (dateTo) p.set('to', dateTo);
    if (preset) p.set('preset', preset);
    if (status) p.set('status', status);
    if (agent) p.set('agent', agent);
    const qs = p.toString();
    return qs ? `/challans?${qs}` : '/challans';
  };

  // Filters reset on page refresh or navigation per user requirement.
  useEffect(() => {
    try {
      sessionStorage.removeItem(FILTER_KEY);
    } catch {}
  }, []);

  const query = {
    page,
    pageSize,
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    status: status || undefined,
    agent: agent || undefined,
  };
  const { data, isLoading } = useChallans(query);
  // KPI totals cover the whole filtered set, not the current page — so they only
  // move when a filter changes. Page/pageSize are omitted so paging never refetches
  // them (the aggregate ignores pagination anyway).
  const { data: summary } = useChallanSummary({
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    status: status || undefined,
    agent: agent || undefined,
  });
  const updateStatus = useUpdateChallanStatus();
  const del = useDeleteChallan();

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const totalRows = data?.total ?? 0;

  // "Show KPI" analytics modal + "Get Report by" export animation.
  const [kpiOpen, setKpiOpen] = useState(false);
  const [report, setReport] = useState<{ kind: 'detailed' | 'summary'; phase: ReportPhase; count?: number } | null>(null);

  const runReport = async (kind: 'detailed' | 'summary') => {
    try {
      setReport({ kind, phase: 'fetching' });
      const res = await fetchAllChallans(query);
      const rows = res.items ?? [];
      if (rows.length === 0) {
        toast.error('No challans match the current filters.');
        setReport(null);
        return;
      }
      setReport({ kind, phase: 'building', count: rows.length });
      /*
       * Built on the SERVER now.
       *
       * The browser copy used SheetJS, whose free build cannot write a font, a
       * fill or a border, so no amount of asking produced a formatted file.
       * The same filters go up as query parameters, along with the wording of
       * the filter block so the saved file says what it covers.
       */
      const params = new URLSearchParams({
        ...(Object.fromEntries(
          Object.entries(query).filter(([, v]) => v !== undefined && v !== '' && v !== null),
        ) as Record<string, string>),
        kind,
        metaStatus: status || 'All',
        metaCategory: 'All',
        metaAgent: agent || 'All',
        metaDateRange:
          dateFrom || dateTo ? `${dateFrom ? formatDate(dateFrom) : '…'} to ${dateTo ? formatDate(dateTo) : '…'}` : 'All',
        metaSearch: search || '—',
      });
      // brief pause so the download animation registers before the file save dialog
      await new Promise((r) => setTimeout(r, 650));
      await downloadFile(`/challans/report.xlsx?${params.toString()}`, `Challans-${kind === 'summary' ? 'Detailed' : 'Summary'}.xlsx`);
      // Stay open on "done" so the user can dismiss it themselves (X, Close, or backdrop).
      setReport({ kind, phase: 'done', count: rows.length });
    } catch {
      toast.error('Failed to build the report.');
      setReport(null);
    }
  };

  const applyPreset = (p: string) => {
    setPreset(p);
    const r = presetRange(p);
    if (r) {
      setDateFrom(r.from);
      setDateTo(r.to);
      setPage(1);
    }
  };
  const clearDates = () => {
    setDateFrom('');
    setDateTo('');
    setPreset('');
    setPage(1);
  };
  const clearAll = () => {
    setSearchInput('');
    setSearch('');
    setDateFrom(defaultFy.from);
    setDateTo(defaultFy.to);
    setPreset(DEFAULT_PRESET);
    setStatus('');
    setAgent('');
    setPage(1);
  };
  const isDefaultFy = preset === DEFAULT_PRESET && dateFrom === defaultFy.from && dateTo === defaultFy.to;
  const hasFilters = !!(search || status || agent || !isDefaultFy);

  const setRowStatus = (c: ChallanDto, next: 'CONFIRMED' | 'CANCELLED') =>
    updateStatus.mutate(
      { id: c.id, challanStatus: next },
      { onSuccess: () => toast.success(`${c.code} marked ${next}`), onError: () => toast.error('Failed to update status') },
    );
  const remove = async (c: ChallanDto) => {
    const ok = await confirm({
      title: `Delete challan ${c.code}?`,
      description: `This challan will be permanently deleted, and its dispatch lines will move back to — and become visible in — the Pending Challan tab.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(c.id, { onSuccess: () => toast.success(`${c.code} deleted`), onError: () => toast.error('Failed to delete') });
  };

  const columns: DataColumn<ChallanDto>[] = useMemo(
    () => [
      {
        id: 'date',
        label: 'Date',
        sortValue: (r) => r.invDate,
        cell: (r) => <span className={cn(TEXT_CELL, 'whitespace-nowrap tabular-nums')}>{formatDate(r.invDate)}</span>,
      },
      {
        id: 'code',
        label: 'Challan No',
        sortValue: (r) => r.code,
        // Same type as every other cell; only the indigo marks it as the identifier.
        cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums text-indigo-700 dark:text-indigo-300')}>{r.code}</span>,
      },
      { id: 'party', label: 'Party', sortValue: (r) => r.customerName, cell: (r) => <span className={TEXT_CELL}>{r.customerName}</span> },
      {
        id: 'total',
        label: 'Total',
        align: 'right',
        sortValue: (r) => r.total ?? 0,
        cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(r.total)}</span>,
      },
      { id: 'b', label: 'B', align: 'right', sortValue: (r) => r.b ?? 0, cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(r.b)}</span> },
      { id: 'c', label: 'C', align: 'right', sortValue: (r) => r.c ?? 0, cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(r.c)}</span> },
      {
        id: 'gst',
        label: 'GST',
        align: 'right',
        sortValue: (r) => r.tax ?? 0,
        cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums text-violet-700 dark:text-violet-300')}>{money(r.tax)}</span>,
      },
      {
        id: 'tds',
        label: 'TDS',
        align: 'right',
        sortValue: (r) => r.tds ?? 0,
        cell: (r) =>
          r.tds ? (
            <span className={cn(TEXT_CELL, 'tabular-nums text-amber-700 dark:text-amber-300')}>{money(r.tds)}</span>
          ) : (
            <span className="text-[13px] text-slate-400">—</span>
          ),
      },
      {
        id: 'due',
        label: 'Due',
        cell: (r) => {
          const di = dueInfo(r.dueDate, r.balance);
          if (di.text === '—') return <span className="text-[13px] text-slate-400">—</span>;
          return (
            <span
              className={cn(
                'inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-[11.5px] font-bold whitespace-nowrap tabular-nums ring-1 ring-inset',
                di.paid
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : di.over
                    ? 'bg-rose-50 text-rose-700 ring-rose-200'
                    : 'bg-slate-50 text-slate-600 ring-slate-200',
              )}
            >
              {di.text}
            </span>
          );
        },
      },
      {
        id: 'status',
        label: 'Status',
        sortValue: (r) => r.challanStatus,
        cell: (r) => {
          const ok = r.challanStatus === 'CONFIRMED';
          return (
            <span
              className={cn(
                // A coloured dot carries the state alongside the word, so it reads at
                // a glance without colour being the only signal.
                'inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 text-[11.5px] font-bold whitespace-nowrap ring-1 ring-inset',
                ok ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200',
              )}
            >
              <span className={cn('size-1.5 shrink-0 rounded-full', ok ? 'bg-emerald-500' : 'bg-rose-500')} />
              {r.challanStatus}
            </span>
          );
        },
      },
    ],
    [],
  );

  // Per-user column order + show/hide (persisted); the sticky Actions column is
  // rendered separately via the DataTable's `actions` prop.
  const cols = useColumnOrder('challans', columns);

  const rowActions = (r: ChallanDto) => {
    const confirmed = r.challanStatus === 'CONFIRMED';
    return (
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-full border border-transparent text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 data-[state=open]:border-indigo-300 data-[state=open]:bg-indigo-100 data-[state=open]:text-indigo-800"
              aria-label={`Actions for challan ${r.code}`}
              title="Challan actions"
            >
              <EllipsisVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            aria-label={`Actions for challan ${r.code}`}
            className="w-64 overflow-hidden rounded-lg border-slate-200 p-0 font-sans shadow-xl shadow-slate-900/15"
          >
            <DropdownMenuLabel className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-indigo-600">Challan actions</span>
              <span className="mt-0.5 block truncate text-[13px] font-bold text-slate-900">{r.code}</span>
              <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-500">{r.customerName}</span>
            </DropdownMenuLabel>
            <div className="p-1.5">
            {canPrint && (
              <>
                {/* `returnTo` on every exit, not just Preview: the bill page's
                    back button otherwise falls through to history, and Edit to a
                    bare `/challans`, either of which drops the filters the user
                    is looking at. */}
                <DropdownMenuItem
                  className="rounded-md px-2.5 py-1.5 font-medium"
                  onSelect={() => navigate(`/challans/${r.id}/bill`, { state: { returnTo: listUrl() } })}
                >
                  <Eye className="text-slate-600" /> View challan
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="rounded-md px-2.5 py-1.5 font-medium"
                  onSelect={() => navigate(`/challans/${r.id}/bill`, { state: { returnTo: listUrl() } })}
                >
                  <Printer className="text-blue-600" /> Print / PDF
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="rounded-md px-2.5 py-1.5 font-medium"
                  onSelect={() => {
                    // Opened synchronously here (still inside the click) so the
                    // popup blocker doesn't catch it once the bill page navigates
                    // to and asynchronously builds the PDF a moment later.
                    // The preview now opens IN PAGE, so no popup is needed —
                    // except on iOS, which can't render a PDF in an iframe and
                    // still needs a tab reserved inside this click.
                    // `returnTo` brings the user back here when they close it.
                    if (isIOS()) reservePreviewTab();
                    navigate(`/challans/${r.id}/bill`, { state: { autoPreview: true, returnTo: listUrl() } });
                  }}
                >
                  <FileSearch className="text-violet-600" /> Preview PDF
                </DropdownMenuItem>
              </>
            )}
            {canUpdate && (
              <DropdownMenuItem
                className="rounded-md px-2.5 py-1.5 font-medium"
                onSelect={() => navigate(`/challans/${r.id}/edit`, { state: { returnTo: listUrl() } })}
              >
                <Pencil className="text-amber-600" /> Edit challan
              </DropdownMenuItem>
            )}
            {canUpdate && (
              <>
                <DropdownMenuSeparator className="my-1" />
                {confirmed ? (
                  <DropdownMenuItem className="rounded-md px-2.5 py-1.5 font-medium" variant="destructive" onSelect={() => setRowStatus(r, 'CANCELLED')}>
                    <XCircle /> Mark cancelled
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem className="rounded-md px-2.5 py-1.5 font-medium text-emerald-700 focus:bg-emerald-50 focus:text-emerald-800" onSelect={() => setRowStatus(r, 'CONFIRMED')}>
                    <CheckCircle2 className="text-emerald-600" /> Mark confirmed
                  </DropdownMenuItem>
                )}
              </>
            )}
            {canDelete && (
              <>
                {(canPrint || canUpdate) && <DropdownMenuSeparator className="my-1" />}
                <DropdownMenuItem className="rounded-md px-2.5 py-1.5 font-medium" variant="destructive" onSelect={() => remove(r)}>
                  <Trash2 /> Delete permanently
                </DropdownMenuItem>
              </>
            )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  // Phones: one card per challan (mirrors the Quotations/Bookings mobile list).
  const challanMobileCard = (r: ChallanDto) => {
    const di = dueInfo(r.dueDate, r.balance);
    const ok = r.challanStatus === 'CONFIRMED';
    return (
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11.5px] font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{r.code}</p>
            <p className="truncate text-[14px] leading-tight font-bold text-slate-900">{r.customerName}</p>
            <p className="text-muted-foreground text-[11.5px] font-medium tabular-nums">{formatDate(r.invDate)}</p>
          </div>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-[4px] px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset',
              ok ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200',
            )}
          >
            <span className={cn('size-1.5 shrink-0 rounded-full', ok ? 'bg-emerald-500' : 'bg-rose-500')} />
            {r.challanStatus}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <div>
            <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Total</p>
            <p className="text-[15px] font-bold tabular-nums text-slate-900">{money(r.total)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Due</p>
            <p className={cn('font-bold tabular-nums', di.paid ? 'text-emerald-700 dark:text-emerald-400' : di.over ? 'text-rose-600' : 'text-slate-700')}>{di.text}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">B / C</p>
            <p className="font-semibold tabular-nums text-slate-700">{money(r.b)} / {money(r.c)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">GST{r.tds ? ' / TDS' : ''}</p>
            <p className="font-semibold tabular-nums text-violet-700">
              {money(r.tax)}
              {r.tds ? <span className="text-amber-700"> / {money(r.tds)}</span> : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end border-t pt-2" onClick={(e) => e.stopPropagation()}>
          {rowActions(r)}
        </div>
      </div>
    );
  };

  /**
   * Agent filter.
   *
   * A challan records the party, not its agent, so this asks the server to
   * resolve the agent's customers and match on those — see `agentScope`. The
   * options come from the customer master unfiltered, so picking one never
   * empties the list it was chosen from.
   */
  const agentSelect = (
    <NativeSelect
      value={agent}
      onChange={(v) => {
        setAgent(v);
        setPage(1);
      }}
      options={['', ...(summary?.agents ?? [])]}
      placeholder="All agents"
      className={cn(CONTROL, 'font-medium', agent && CONTROL_ON)}
    />
  );

  /** Status segmented control — three states, so pills beat a dropdown. */
  const statusPills = (
    <div className="flex items-center gap-1 rounded-[4px] border border-amber-300 bg-amber-50/40 p-0.5">
      {STATUSES.map((s) => {
        const on = status === s.value;
        return (
          <button
            key={s.label}
            type="button"
            onClick={() => {
              setStatus(s.value);
              setPage(1);
            }}
            aria-pressed={on}
            className={cn(
              'cursor-pointer rounded-[3px] px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap transition-colors duration-150',
              on
                ? s.value === 'CONFIRMED'
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : s.value === 'CANCELLED'
                    ? 'bg-rose-500 text-white shadow-sm'
                    : 'bg-slate-700 text-white shadow-sm'
                : 'text-amber-900/70 hover:bg-amber-100 hover:text-amber-900',
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );

  const presetOptions = (
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-1">
      {PRESETS.map((p) => {
        const on = preset === p;
        const label = p === 'This Year' ? 'This FY' : p === 'Last Year' ? 'Last FY' : p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => (on ? clearDates() : applyPreset(p))}
            aria-pressed={on}
            className={cn(
              'flex h-8 cursor-pointer items-center rounded-[4px] border px-2.5 text-left text-[11.5px] font-semibold whitespace-nowrap transition-colors duration-150',
              on
                ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  const datePresetLabel = preset === 'This Year' ? 'This FY' : preset === 'Last Year' ? 'Last FY' : preset;
  const dateLabel = datePresetLabel || (dateFrom || dateTo ? `${dateFrom ? formatDate(dateFrom) : '…'} → ${dateTo ? formatDate(dateTo) : '…'}` : 'Any date');

  const datePanel = (
    <div className="w-full sm:w-[31rem]">
      <div className="border-b bg-slate-50 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-indigo-100 text-indigo-700">
            <CalendarRange className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[12.5px] font-bold text-slate-900">Challan date range</p>
            <p className="truncate text-[11px] font-medium text-slate-500">
              {dateActive ? `${dateFrom ? formatDate(dateFrom) : 'Start date'} to ${dateTo ? formatDate(dateTo) : 'End date'}` : 'Showing challans from all dates'}
            </p>
          </div>
        </div>
      </div>
      <div className="grid sm:grid-cols-[9rem_1fr]">
        <div className="border-b bg-slate-50/60 p-2 sm:border-r sm:border-b-0">
          <p className="mb-1.5 px-2 text-[9.5px] font-bold uppercase tracking-wider text-slate-400">Quick ranges</p>
          {presetOptions}
        </div>
        <div className="p-3">
          <DateRangeCalendar
            from={dateFrom}
            to={dateTo}
            onChange={(f, t) => {
              setDateFrom(f);
              setDateTo(t);
              setPreset('');
              setPage(1);
            }}
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5 border-t bg-slate-50 px-3 py-2">
        {dateActive && (
          <Button variant="ghost" size="sm" className="h-8 px-2.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-200 hover:text-slate-900" onClick={clearDates}>
            <X className="size-3.5" /> Clear
          </Button>
        )}
        <Button size="sm" className="h-8 shrink-0 bg-indigo-600 px-4 text-[12px] font-semibold hover:bg-indigo-700" onClick={() => setDateOpen(false)}>
          Done
        </Button>
      </div>
    </div>
  );

  const from = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalRows);

  return (
    // Fills the viewport: header, KPI rail and filters pinned on top, footer pinned
    // at the bottom, only the grid scrolls. `/challans` is a flush route (app-shell),
    // so the page owns its padding.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      {/* ── Toolbar: filters on the left, the page's actions on the right, all in one
          card (the page title lives in the top bar, so no separate identity header).
          Poppins + amber controls match Pending Challan so the two screens feel like
          one product. */}
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <div className="relative w-full sm:w-56">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              className={cn(CONTROL, 'pr-8 pl-8 font-medium', searchInput && CONTROL_ON)}
              placeholder="Challan no or party…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
                title="Clear search"
                className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-amber-700/70 transition-colors hover:bg-amber-100 hover:text-amber-900"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          <Button
            variant="outline"
            size="icon"
            className={cn('relative size-9 shrink-0 rounded-[4px] border-amber-300 sm:hidden', activeFilterCount > 0 && CONTROL_ON)}
            onClick={() => setMobileFiltersOpen(true)}
            aria-label="Filters"
          >
            <Filter className="size-4" />
            {activeFilterCount > 0 && (
              <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-bold tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </Button>

          <div className="hidden sm:block">{statusPills}</div>

          <div className="hidden w-44 sm:block">{agentSelect}</div>

          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(CONTROL, 'hidden max-w-52 font-medium sm:inline-flex', dateActive && CONTROL_ON)}
                title="Filter by challan date"
              >
                <CalendarRange className="size-3.5 shrink-0" />
                <span className="truncate">{dateLabel}</span>
                <ChevronDown className="size-3 shrink-0 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="font-poppins w-auto max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border-slate-200 p-0 shadow-xl shadow-slate-900/15">
              {datePanel}
            </PopoverContent>
          </Popover>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="hidden h-9 rounded-[4px] text-[12.5px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900 sm:inline-flex"
              onClick={clearAll}
              title="Clear all filters"
            >
              <X className="size-3.5" /> Reset
            </Button>
          )}

          {/* Actions — right-aligned in the same bar. */}
          <div className="flex w-full flex-wrap items-center gap-1.5 sm:ml-auto sm:w-auto sm:gap-2">
            <span className="text-muted-foreground mr-0.5 hidden text-[10px] font-bold tracking-widest uppercase sm:inline">Report</span>
            {/* The two names were the wrong way round: the 'detailed' export is
                the challan LIST (one row per challan) and the 'summary' export
                is the list WITH its line items. The labels now describe what
                each one produces. The `kind` values are the wire contract and
                keep their original spelling. */}
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-[4px] text-[12.5px] font-semibold"
              disabled={!!report}
              onClick={() => runReport('detailed')}
              title="Export the filtered challan list to Excel — one row per challan"
            >
              <Layers className="text-sky-600" /> <span className="hidden sm:inline">Challan Summary</span>
              <span className="sm:hidden">Summary</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-[4px] text-[12.5px] font-semibold"
              disabled={!!report}
              onClick={() => runReport('summary')}
              title="Export challans plus every line item to Excel"
            >
              <FileSpreadsheet className="text-emerald-600" /> <span className="hidden sm:inline">Detailed View</span>
              <span className="sm:hidden">Detailed</span>
            </Button>
            <Button
              size="sm"
              className="bg-gradient-brand h-9 rounded-[4px] text-[12.5px] font-bold text-white shadow-sm hover:opacity-95"
              onClick={() => setKpiOpen(true)}
              title="Open analytics dashboard"
            >
              <BarChart3 /> Show KPI
            </Button>
            <ColumnSettings
              columns={cols.orderedReorderable}
              hidden={cols.hidden}
              onReorder={cols.moveBefore}
              onMove={cols.move}
              onToggle={cols.toggle}
              onReset={cols.reset}
              dateFormat={{ value: format, options: DATE_FORMATS, onChange: setFormat }}
            />
          </div>
        </div>
      </div>

      {/* ── KPI rail ────────────────────────────────────────────────────────────
          Every tile is a total across the WHOLE filtered set (server aggregate), so
          it stays put as you page and only moves when a filter changes — with no
          filters, these are the all-time totals. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 sm:gap-2.5">
        <Kpi icon={<Receipt className="size-3.5" />} label="Challans" value={(summary?.count ?? totalRows).toLocaleString('en-IN')} tone="indigo" hint="Challans matching the current filters" />
        <Kpi icon={<Wallet className="size-3.5" />} label="Value" value={inrCompact(summary?.totalSales ?? 0)} title={inrFull(summary?.totalSales ?? 0)} tone="blue" hint="Total value of all matching challans" />
        <Kpi icon={<CheckCircle2 className="size-3.5" />} label="Confirmed" value={(summary?.confirmed ?? 0).toLocaleString('en-IN')} tone="emerald" hint="Confirmed challans across the filter" />
        <Kpi icon={<XCircle className="size-3.5" />} label="Cancelled" value={(summary?.cancelled ?? 0).toLocaleString('en-IN')} tone="rose" hint="Cancelled challans across the filter" />
        <Kpi icon={<Percent className="size-3.5" />} label="GST" value={inrCompact(summary?.totalTax ?? 0)} title={inrFull(summary?.totalTax ?? 0)} tone="violet" hint="Total GST across all matching challans" />
        <Kpi icon={<Percent className="size-3.5" />} label="TDS" value={inrCompact(summary?.totalTds ?? 0)} title={inrFull(summary?.totalTds ?? 0)} tone="amber" hint="Total TDS across all matching challans" />
      </div>

      {/* Phones only: date range / quick range / status live behind the Filter icon. */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="font-poppins sm:hidden">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>Filters</SheetTitle>
              <Button variant="ghost" size="sm" className="text-muted-foreground -mr-2 gap-1.5 font-semibold" onClick={clearAll} disabled={!hasFilters}>
                <X className="size-3.5" /> Reset
              </Button>
            </div>
          </SheetHeader>
          <div className="space-y-4 overflow-y-auto">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Status</Label>
              {statusPills}
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Agent</Label>
              {agentSelect}
            </div>
            {datePanel}
          </div>
          <SheetFooter>
            <Button className="w-full font-bold" onClick={() => setMobileFiltersOpen(false)}>
              Show {totalRows.toLocaleString('en-IN')} challans
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* The grid pans sideways when the columns outgrow the screen; slim scrollbars
          make that discoverable. */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          '[&_[data-slot=table-container]]:overscroll-x-contain',
          '[&_[data-slot=table-container]]:[scrollbar-width:thin]',
          '[&_[data-slot=table-container]]:[scrollbar-color:var(--color-slate-400)_var(--color-slate-100)]',
        )}
      >
        <DataTable
          columns={cols.visibleColumns}
          rows={items}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          dense
          fill
          hideSortIcon
          actions={rowActions}
          actionsHeader={null}
          mobileCard={challanMobileCard}
          emptyText="No challans yet — create one from Pending Challan."
          className={[
            'font-sans text-[13px]',
            // Heavy, legible headers — the anchor when panning across a wide grid.
            '[&_thead_th]:text-[13.5px] [&_thead_th]:font-extrabold [&_thead_th]:uppercase [&_thead_th]:tracking-wide [&_thead_th]:py-1.5',
            '[&_thead_th_button]:cursor-pointer',
            '[&_thead_th:hover]:from-blue-900 [&_thead_th:hover]:to-indigo-900',
            // Compact rows so more fit in view. The default `dense` mode forces every
            // action button to size-8 (32px), which was the real height floor — the
            // matching override below drops them to size-6 so the tighter `py-1`
            // padding actually takes effect (the row is as tall as its tallest cell).
            '[&_td]:py-1 [&_td]:px-3 [&_th]:px-3',
            '[&_thead_th:last-child]:w-16 [&_tbody_td:last-child]:w-16',
            '[&_tbody_button:not([role=switch]):not([role=checkbox])]:size-7',
            // Full grey grid, both directions (dark variants because these paint the
            // td, out of reach of the global neutral remap).
            '[&_tbody_tr]:border-b [&_tbody_tr]:border-slate-200 dark:[&_tbody_tr]:border-white/10',
            '[&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0',
            // Banded rows, then a warm hover on top (specificity pinned by repeating
            // the pseudo-class, so the winner never depends on Tailwind's emit order).
            '[&_tbody_tr:nth-child(even)_td]:bg-slate-100/80 dark:[&_tbody_tr:nth-child(even)_td]:bg-white/[0.04]',
            '[&_tbody_tr:hover:hover_td]:bg-amber-100/70 dark:[&_tbody_tr:hover:hover_td]:bg-amber-400/10',
          ].join(' ')}
        />
      </div>

      {/* ── Footer: range + paging ─────────────────────────────────────────────── */}
      <div className="bg-card flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[4px] border px-3 py-2 shadow-sm">
        <p className="text-muted-foreground text-[12px] font-medium">
          {totalRows === 0 ? (
            'No challans'
          ) : (
            <>
              Showing <span className="font-bold tabular-nums text-foreground">{from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')}</span> of{' '}
              <span className="font-bold tabular-nums text-foreground">{totalRows.toLocaleString('en-IN')}</span>
            </>
          )}
        </p>
        <div className="ml-auto flex items-center gap-3">
          <p className="text-muted-foreground text-[12px] font-medium">
            Page <span className="font-bold tabular-nums text-foreground">{data?.page ?? page}</span> of{' '}
            <span className="font-bold tabular-nums text-foreground">{totalPages}</span>
          </p>
          <div className="flex items-center gap-2">
            <PageSizeSelect value={pageSize} onChange={setPageSize} />
            <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft /> Prev
            </Button>
            <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      </div>

      <ChallanAnalyticsDialog open={kpiOpen} onOpenChange={setKpiOpen} base={{ search, dateFrom, dateTo, status }} />
      <ReportDownloadOverlay
        open={!!report}
        title={report?.kind === 'summary' ? 'Detailed View' : 'Challan Summary'}
        phase={report?.phase ?? 'fetching'}
        count={report?.count}
        onClose={() => setReport(null)}
      />
    </div>
  );
}

/** Per-tile colour recipes for the KPI rail. */
const KPI_TONE = {
  indigo: 'from-indigo-50 to-indigo-100/40 ring-indigo-200 text-indigo-700 dark:from-indigo-500/15 dark:to-indigo-500/5 dark:ring-indigo-400/25 dark:text-indigo-300',
  blue: 'from-blue-50 to-blue-100/40 ring-blue-200 text-blue-700 dark:from-blue-500/15 dark:to-blue-500/5 dark:ring-blue-400/25 dark:text-blue-300',
  emerald: 'from-emerald-50 to-emerald-100/40 ring-emerald-200 text-emerald-700 dark:from-emerald-500/15 dark:to-emerald-500/5 dark:ring-emerald-400/25 dark:text-emerald-300',
  rose: 'from-rose-50 to-rose-100/40 ring-rose-200 text-rose-700 dark:from-rose-500/15 dark:to-rose-500/5 dark:ring-rose-400/25 dark:text-rose-300',
  violet: 'from-violet-50 to-violet-100/40 ring-violet-200 text-violet-700 dark:from-violet-500/15 dark:to-violet-500/5 dark:ring-violet-400/25 dark:text-violet-300',
  amber: 'from-amber-50 to-amber-100/40 ring-amber-200 text-amber-700 dark:from-amber-500/15 dark:to-amber-500/5 dark:ring-amber-400/25 dark:text-amber-300',
} as const;

/** A compact headline figure — a total across the whole filtered set. */
function Kpi({
  icon,
  label,
  value,
  tone,
  hint,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: keyof typeof KPI_TONE;
  hint: string;
  /** Exact value for the tooltip when `value` is abbreviated (₹3.4L). */
  title?: string;
}) {
  return (
    <div
      title={title ? `${hint} — ${title}` : hint}
      className={cn('rounded-[4px] bg-gradient-to-br p-2 ring-1 ring-inset sm:px-2.5', KPI_TONE[tone])}
    >
      <p className="flex items-center gap-1 text-[10px] font-bold tracking-widest uppercase opacity-80">
        {icon}
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-0.5 truncate text-[17px] font-extrabold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

export default ChallansListPage;
