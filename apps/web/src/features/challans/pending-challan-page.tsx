import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Filter,
  Layers,
  Search,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PendingChallanLine } from '@oms/shared';
import { cn, shortOrderCode } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { MissingRateBadge, missingRatesFor } from './rate-status';
import { usePermissions } from '@/hooks/use-permissions';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { DateRangeCalendar } from '@/components/common/date-range-calendar';
import { NativeSelect } from '@/components/common/combo';
import { usePageSize } from '@/hooks/use-page-size';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useConfirm } from '@/components/common/confirm';
import { usePendingChallanFilters, usePendingChallans } from './use-challans';
import { presetRange } from './date-presets';

/**
 * Figures keep `tabular-nums` so columns of numbers stay optically aligned and don't
 * shift as values change, but use the same Inter face as the rest of the grid — there
 * is no monospace anywhere on the challan screens. Weight comes from the caller.
 */
const NUM = 'tabular-nums';

/**
 * The shared look for most data cells — Inter, semibold, near-black. D-Date and the
 * quantity/unit/rate columns all use it so they match the Product column exactly;
 * the numeric ones add `tabular-nums` on top, which keeps the right-aligned figures
 * in a straight column without changing the typeface.
 */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800';

/**
 * Shared look for every control in the filter bar: compact (36px) with an amber
 * border, so the filters read as one warm band that's clearly separate from the
 * blue data grid below. A control holding a value deepens to amber-500 on a tinted
 * ground, which is legible without relying on colour alone (the value shows too).
 */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

/** "All" clears the date filter rather than naming a range. */
const ALL_DATES = 'All';

/**
 * Filters survive a reload (and coming back to the page) so a part-finished job
 * isn't lost — they're only dropped when Reset is pressed. Bumping the `v` suffix
 * retires older shapes rather than trying to migrate them.
 */
const FILTER_KEY = 'oms:pending-challan-filters:v1';

interface StoredFilters {
  search: string;
  customer: string;
  product: string;
  design: string;
  dateFrom: string;
  dateTo: string;
  preset: string;
}

const NO_FILTERS: StoredFilters = { search: '', customer: '', product: '', design: '', dateFrom: '', dateTo: '', preset: '' };

/** Read saved filters — reset to clean defaults. */
function loadFilters(): StoredFilters {
  try {
    localStorage.removeItem(FILTER_KEY);
  } catch {}
  return NO_FILTERS;
}
/**
 * The quick ranges offered on this page — a short, everyday set. Deliberately a
 * local list, not the shared `PRESETS`: that array also drives the Challans list
 * filter, which still offers the quarter/year ranges.
 */
const QUICK_RANGES = ['Today', 'Yesterday', 'This Month', 'Last Month', ALL_DATES] as const;

const num = (v: number | null) => (v ? v.toLocaleString('en-IN') : '—');
/** Compact form for the summary strip — totals read better without an em-dash. */
const total = (v: number) => v.toLocaleString('en-IN');
const party = (r: PendingChallanLine) => r.customerName.trim();

/** Whole days between a dispatch date and today (negative dates clamp to 0). */
function daysPending(iso: string): number {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 0;
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const now = new Date();
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Aging bands for a pending line. Colour is a *secondary* cue — the day count is
 * always spelled out, so the bands never carry meaning on their own.
 */
function agingTone(days: number): string {
  if (days <= 7) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (days <= 30) return 'bg-amber-50 text-amber-800 ring-amber-200';
  return 'bg-rose-50 text-rose-700 ring-rose-200';
}

export function PendingChallanPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { can } = usePermissions();
  const canCreate = can('challan:create');

  // Clean default filters on mount.
  const [saved] = useState(loadFilters);
  const [searchInput, setSearchInput] = useState(saved.search);
  const [search, setSearch] = useState(saved.search);
  // Exact-match field filters, backed by the dropdowns in the filter bar.
  const [customer, setCustomer] = useState(saved.customer);
  const [product, setProduct] = useState(saved.product);
  const [design, setDesign] = useState(saved.design);
  const [dateFrom, setDateFrom] = useState(saved.dateFrom);
  const [dateTo, setDateTo] = useState(saved.dateTo);
  const [preset, setPreset] = useState(saved.preset);
  const [dateOpen, setDateOpen] = useState(false);
  const { page, setPage, pageSize, setPageSize } = usePageSize('pending-challan');
  // Selection preserves insertion order (= the order rows were ticked).
  const [selected, setSelected] = useState<Map<number, PendingChallanLine>>(new Map());
  // Phones: the field + date filters live behind this Filter icon (see the sheet below).
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const dateActive = !!(dateFrom || dateTo || preset);
  const activeFilterCount =
    (dateActive ? 1 : 0) + (customer ? 1 : 0) + (product ? 1 : 0) + (design ? 1 : 0);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Filters reset on page refresh or navigation per user requirement.
  useEffect(() => {
    try {
      localStorage.removeItem(FILTER_KEY);
    } catch {}
  }, []);

  const query = {
    page,
    pageSize,
    search: search || undefined,
    customerName: customer || undefined,
    productName: product || undefined,
    design: design || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };
  const { data, isLoading } = usePendingChallans(query);
  const { data: filterOptions } = usePendingChallanFilters();
  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const totalRows = data?.total ?? 0;

  const toggle = (r: PendingChallanLine) =>
    setSelected((m) => {
      const n = new Map(m);
      if (n.has(r.dispatchId)) n.delete(r.dispatchId);
      else n.set(r.dispatchId, r);
      return n;
    });

  /** Clicking the active preset again clears it, so the pills work as a toggle. */
  const applyPreset = (p: string) => {
    if (p === preset) {
      setPreset('');
      setDateFrom('');
      setDateTo('');
      setPage(1);
      return;
    }
    setPreset(p);
    const r = presetRange(p);
    if (r) {
      setDateFrom(r.from);
      setDateTo(r.to);
      setPage(1);
    }
  };
  const hasFilters = !!(search || customer || product || design || dateActive);
  const clearAll = () => {
    setSearchInput('');
    setSearch('');
    setCustomer('');
    setProduct('');
    setDesign('');
    setDateFrom('');
    setDateTo('');
    setPreset('');
    setPage(1);
  };
  /** Every filter control resets paging — page 3 of the old result set is meaningless. */
  const onField = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };
  const clearDates = () => {
    setDateFrom('');
    setDateTo('');
    setPreset('');
    setPage(1);
  };

  const selectedCount = selected.size;
  const selectedParties = useMemo(() => [...new Set([...selected.values()].map(party))], [selected]);
  /** The one customer the in-progress challan is for — null when nothing is ticked
   *  or the selection spans several customers. Drives the row de-emphasis below. */
  const activeParty = selectedParties.length === 1 ? selectedParties[0] : null;
  // Count the party's complete pending pool, not just rows on the current page or
  // under the active screen filters. This decides whether the selection is partial.
  const { refetch: refetchActivePartyPending } = usePendingChallans(
    { page: 1, pageSize: 1, customerName: activeParty || undefined },
    { enabled: !!activeParty },
  );

  // Page-scoped quantity totals for the summary strip. The API paginates and
  // returns no aggregates, so these describe the rows currently loaded — the
  // strip labels them "this page" so they're never mistaken for the grand total.
  const pageTotals = useMemo(() => {
    const sum = (pick: (r: PendingChallanLine) => number | null) =>
      items.reduce((acc, r) => acc + (pick(r) ?? 0), 0);
    return {
      customers: new Set(items.map(party).filter(Boolean)).size,
      bags: sum((r) => r.bags),
      kgs: sum((r) => r.kgs),
      pcs: sum((r) => r.pcs),
      box: sum((r) => r.box),
    };
  }, [items]);

  /** Quantity totals for what's ticked — shown in the footer while selecting. */
  const selectedTotals = useMemo(() => {
    const lines = [...selected.values()];
    const sum = (pick: (r: PendingChallanLine) => number | null) =>
      lines.reduce((acc, r) => acc + (pick(r) ?? 0), 0);
    return { bags: sum((r) => r.bags), kgs: sum((r) => r.kgs), pcs: sum((r) => r.pcs), box: sum((r) => r.box) };
  }, [selected]);

  /** Visible lines that could join the current challan (same customer). */
  const eligibleRows = useMemo(
    () => (activeParty ? items.filter((r) => party(r) === activeParty) : items),
    [items, activeParty],
  );
  const allEligibleSelected =
    eligibleRows.length > 0 && eligibleRows.every((r) => selected.has(r.dispatchId));
  const pageParties = useMemo(() => new Set(items.map(party).filter(Boolean)).size, [items]);
  // Header tick-box: with a customer locked in it selects/clears that customer's
  // visible lines; with nothing ticked it can only "select all" when the page holds
  // a single customer (a challan covers one customer); a mixed selection clears.
  const headerToggleEnabled = selectedCount > 0 || pageParties === 1;
  const toggleAllVisible = () => {
    if (!headerToggleEnabled) return;
    if (!activeParty && selectedCount > 0) return setSelected(new Map());
    if (allEligibleSelected) {
      return setSelected((m) => {
        const n = new Map(m);
        eligibleRows.forEach((r) => n.delete(r.dispatchId));
        return n;
      });
    }
    setSelected((m) => {
      const n = new Map(m);
      eligibleRows.forEach((r) => n.set(r.dispatchId, r));
      return n;
    });
  };

  const createChallan = async () => {
    const lines = [...selected.values()];
    if (lines.length === 0) return toast.error('Please select one or more rows.');
    const parties = [...new Set(lines.map(party).filter(Boolean))];
    if (parties.length !== 1) {
      return toast.error(
        parties.length === 0 ? 'Selected rows are missing the customer name.' : `Select rows for the SAME customer. Found: ${parties.join(', ')}`,
      );
    }
    const only = parties[0];
    // Confirm only when rows are being left behind. A complete selection — most
    // importantly a party whose entire pool is one row — proceeds without noise.
    const fetched = (await refetchActivePartyPending()).data;
    const partyTotal = Math.max(lines.length, fetched?.total ?? lines.length);
    if (lines.length < partyTotal) {
      const remaining = partyTotal - lines.length;
      const ok = await confirm({
        title: 'Create challan with selected rows only?',
        description: `${only} has ${partyTotal} pending lines. You selected ${lines.length}; ${remaining} line${remaining === 1 ? '' : 's'} will remain pending.`,
        confirmText: 'Create Selected',
        autoFocusConfirm: true,
      });
      if (!ok) return;
    }
    navigate('/challans/new', { state: { customerName: only, lines } });
  };

  /** De-emphasise lines that can't join the current challan. */
  const isOtherParty = (r: PendingChallanLine) => !!activeParty && party(r) !== activeParty;
  /** Shared per-cell classes: fade the row's content when it's a different customer. */
  const cellTone = (r: PendingChallanLine) => (isOtherParty(r) ? 'opacity-45' : undefined);

  const columns: DataColumn<PendingChallanLine>[] = [
    {
      id: 'sel',
      label: '',
      fixed: true,
      noSort: true,
      header: (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleAllVisible();
          }}
          disabled={!headerToggleEnabled}
          aria-label={allEligibleSelected ? 'Clear selection' : 'Select all visible lines'}
          title={
            headerToggleEnabled
              ? allEligibleSelected
                ? 'Clear selection'
                : activeParty
                  ? `Select all visible lines for ${activeParty}`
                  : 'Select all visible lines'
              : 'Tick a line first — a challan covers one customer'
          }
          className={cn(
            // Mirrors the row checkbox, but inverted for the dark blue header.
            'flex size-[17px] cursor-pointer items-center justify-center rounded-[3px] border-[1.5px] border-white transition-colors',
            allEligibleSelected ? 'bg-white text-blue-800' : 'hover:bg-white/25',
            !headerToggleEnabled && 'cursor-not-allowed opacity-40',
          )}
        >
          {allEligibleSelected ? (
            <Check className="size-3.5" strokeWidth={3.5} />
          ) : (
            selectedCount > 0 && <span className="h-[2px] w-2.5 rounded-full bg-white" />
          )}
        </button>
      ),
      cell: (r) => (
        <span
          className={cn(
            // A visible 1.5px dark-grey box on white, so the tick target reads clearly
            // against the row bands instead of fading into them.
            'flex size-[17px] items-center justify-center rounded-[3px] border-[1.5px] bg-white transition-colors',
            selected.has(r.dispatchId)
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-slate-500 group-hover:border-primary group-hover:bg-primary/5',
          )}
        >
          {selected.has(r.dispatchId) && <Check className="size-3.5" strokeWidth={3.5} />}
        </span>
      ),
    },
    {
      id: 'order',
      label: 'Ord #',
      sortValue: (r) => r.orderId ?? 0,
      cell: (r) => (
        <span className={cn(TEXT_CELL, NUM, cellTone(r))}>{shortOrderCode(r.orderCode, r.orderId)}</span>
      ),
    },
    {
      id: 'date',
      label: 'D-Date',
      sortValue: (r) => r.dispatchDate,
      cell: (r) => (
        <span className={cn(TEXT_CELL, 'whitespace-nowrap tabular-nums', cellTone(r))}>
          {formatDate(r.dispatchDate)}
        </span>
      ),
    },
    {
      // Same type as Product (see TEXT_CELL); the only difference is colour — the
      // customer the in-progress challan belongs to turns sky, which is a state
      // highlight rather than a typographic one.
      id: 'customer',
      label: 'Customer',
      sortValue: (r) => r.customerName,
      cell: (r) => (
        <span
          className={cn(
            TEXT_CELL,
            activeParty && party(r) === activeParty && 'text-sky-900 dark:text-sky-300',
            cellTone(r),
          )}
        >
          {r.customerName || '—'}
        </span>
      ),
    },
    {
      id: 'product',
      label: 'Product',
      sortValue: (r) => r.productName ?? '',
      cell: (r) => (
        <span className={cn(TEXT_CELL, cellTone(r))}>
          {r.productName || '—'}
          {/* Flagged here so an unpriced line is caught before any time is
              spent pulling it into a challan. */}
          <MissingRateBadge missing={missingRatesFor(r)} pCategory={r.pCategory} className="ml-1.5" />
        </span>
      ),
    },
    {
      id: 'design',
      label: 'Design',
      sortValue: (r) => r.design ?? '',
      cell: (r) => <span className={cn(TEXT_CELL, cellTone(r))}>{r.design || '—'}</span>,
    },
    {
      id: 'bags',
      label: 'Bags',
      align: 'right',
      sortValue: (r) => r.bags ?? 0,
      cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums', cellTone(r))}>{num(r.bags)}</span>,
    },
    {
      id: 'kgs',
      label: 'Kgs',
      align: 'right',
      sortValue: (r) => r.kgs ?? 0,
      cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums', cellTone(r))}>{num(r.kgs)}</span>,
    },
    {
      id: 'pcs',
      label: 'Pcs',
      align: 'right',
      sortValue: (r) => r.pcs ?? 0,
      cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums', cellTone(r))}>{num(r.pcs)}</span>,
    },
    {
      id: 'box',
      label: 'Box',
      align: 'right',
      sortValue: (r) => r.box ?? 0,
      cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums', cellTone(r))}>{num(r.box)}</span>,
    },
    {
      id: 'unit',
      label: 'Unit',
      sortValue: (r) => r.unit ?? '',
      cell: (r) => <span className={cn(TEXT_CELL, cellTone(r))}>{r.unit || '—'}</span>,
    },
    {
      // Money keeps its emerald tint (colour, not typeface) so it stays easy to hunt for.
      id: 'rate',
      label: 'Rate',
      align: 'right',
      sortValue: (r) => r.rate ?? 0,
      cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums text-emerald-700 dark:text-emerald-400', cellTone(r))}>{num(r.rate)}</span>,
    },
  ];

  // Ctrl/Cmd+C → Create Challan from the selected rows (partial selections confirm).
  // Bound once; reads the latest handler/state via refs. We never hijack a genuine
  // copy: typing in a field or an active text selection is left to the browser, and
  // with nothing ticked the key does nothing (so a plain Ctrl+C still copies).
  const createRef = useRef(createChallan);
  createRef.current = createChallan;
  const canActRef = useRef(false);
  canActRef.current = canCreate && selectedCount > 0;
  const hasSelectionRef = useRef(false);
  hasSelectionRef.current = selectedCount > 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
      // Escape drops the selection — the quickest way out of a wrong pick.
      if (e.key === 'Escape' && !typing && hasSelectionRef.current) {
        setSelected(new Map());
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;
      if (typing) return;
      if ((window.getSelection()?.toString() ?? '') !== '') return;
      if (!canActRef.current) return;
      e.preventDefault();
      void createRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Phones: one card per dispatched line, tap to select (mirrors Order Modify's
  // mobile list). The whole card is highlighted when selected — the `-m-3 p-3`
  // fills exactly the parent card's own padding (see DataTable's mobileCard wrapper).
  const pendingMobileCard = (r: PendingChallanLine) => {
    const isSel = selected.has(r.dispatchId);
    const d = daysPending(r.dispatchDate);
    return (
      <div
        className={cn(
          '-m-3 space-y-1.5 rounded-[4px] p-3 font-sans transition-colors',
          isSel && 'bg-primary/5 ring-2 ring-primary',
          isOtherParty(r) && !isSel && 'opacity-45',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={cn(NUM, 'text-muted-foreground text-[11px] font-bold uppercase tracking-widest')}>{shortOrderCode(r.orderCode, r.orderId)}</p>
            <p className="truncate text-[14.5px] leading-tight font-bold text-slate-900">{r.customerName}</p>
            <p className="text-muted-foreground truncate text-[11.5px] font-medium">{r.productName || '—'}{r.design ? ` · ${r.design}` : ''}</p>
            <MissingRateBadge missing={missingRatesFor(r)} pCategory={r.pCategory} className="mt-1" showCategory />
          </div>
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] bg-white transition-colors',
              isSel ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-500',
            )}
          >
            {isSel && <Check className="size-3.5" strokeWidth={3.5} />}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 text-[12px]">
          {([['Bags', r.bags], ['Kgs', r.kgs], ['Pcs', r.pcs], ['Box', r.box]] as const).map(([label, value]) => (
            <div key={label}>
              <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">{label}</p>
              <p className={cn(NUM, 'text-[13px] font-bold text-slate-900')}>{num(value)}</p>
            </div>
          ))}
        </div>
        <div className="text-muted-foreground flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className={cn(NUM, 'font-medium')}>{formatDate(r.dispatchDate)}</span>
            <span className="font-bold uppercase tracking-wider">{r.unit || '—'}</span>
            <span className={cn(NUM, 'rounded px-1 py-0.5 text-[10px] font-bold ring-1 ring-inset', agingTone(d))}>
              {d === 0 ? 'today' : `${d}d`}
            </span>
          </span>
          <span className={cn(NUM, 'text-[13px] font-bold text-emerald-700 dark:text-emerald-400')}>₹{num(r.rate)}</span>
        </div>
      </div>
    );
  };

  const from = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalRows);

  /** Quick ranges — a compact wrapping row of pills. "All" isn't a range: it drops
   *  the date filter entirely, and shows as the active pill whenever no dates are set. */
  const presetPills = (
    <div className="flex flex-wrap items-center gap-1">
      {QUICK_RANGES.map((p) => {
        const on = p === ALL_DATES ? !dateActive : preset === p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => (p === ALL_DATES ? clearDates() : applyPreset(p))}
            aria-pressed={on}
            className={cn(
              'cursor-pointer rounded-[4px] border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap transition-colors duration-150',
              on
                ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                : 'border-border bg-muted/40 text-slate-600 hover:border-primary/40 hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {p}
          </button>
        );
      })}
    </div>
  );

  /** What the Date button reads: the preset name, else the explicit range. */
  const dateLabel = preset || (dateFrom || dateTo ? `${dateFrom ? formatDate(dateFrom) : '…'} → ${dateTo ? formatDate(dateTo) : '…'}` : 'Any date');

  /** Body of the Date dropdown: quick ranges down the side, a two-month range
   *  calendar beside them, and the resolved range echoed in the footer. */
  const datePanel = (
    <div className="w-[15.5rem] space-y-2">
      {presetPills}

      <div className="border-t pt-2">
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

      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <span className="min-w-0 truncate text-[11.5px] font-semibold">
          {dateActive ? (
            <>
              {dateFrom ? formatDate(dateFrom) : '…'} <span className="text-muted-foreground">→</span>{' '}
              {dateTo ? formatDate(dateTo) : '…'}
            </>
          ) : (
            <span className="text-muted-foreground font-medium">All dates</span>
          )}
        </span>
        <Button size="sm" className="h-7 shrink-0 px-3 text-[12px] font-semibold" onClick={() => setDateOpen(false)}>
          Done
        </Button>
      </div>
    </div>
  );

  /** The three exact-match field dropdowns, shared by the bar and the phone sheet. */
  const fieldSelects = (
    <>
      <FilterSelect label="Customer" value={customer} onChange={onField(setCustomer)} options={filterOptions?.customers ?? []} className="w-full sm:w-40" />
      <FilterSelect label="Product" value={product} onChange={onField(setProduct)} options={filterOptions?.products ?? []} className="w-full sm:w-36" />
      <FilterSelect label="Design" value={design} onChange={onField(setDesign)} options={filterOptions?.designs ?? []} className="w-full sm:w-32" />
    </>
  );

  return (
    // Fills the viewport exactly: toolbar + summary pinned on top, footer pinned at
    // the bottom, and only the table body scrolls. `/challans/pending` is a flush
    // route (see app-shell) so the page owns its own padding.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      {/* ── Filter bar ───────────────────────────────────────────────────────────
          Free-text search, then exact-match dropdowns for Customer / Product /
          Design, then one Date button holding both the quick ranges and a custom
          From/To. Set in Poppins — a rounder, friendlier face than the Inter used
          for the data grid, which keeps the controls visually distinct from it. */}
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          {/* Search */}
          <div className="relative w-full sm:w-56">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              className={cn(CONTROL, 'pr-8 pl-8 font-medium', searchInput && CONTROL_ON)}
              placeholder="Search…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
                title="Clear search"
                className="text-amber-700/70 hover:bg-amber-100 hover:text-amber-900 absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded transition-colors"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          {/* Phones: date range + presets move into the sheet. */}
          <Button
            variant="outline"
            size="icon"
            className={cn('relative size-9 shrink-0 rounded-[4px] border-amber-300 sm:hidden', activeFilterCount > 0 && CONTROL_ON)}
            onClick={() => setMobileFiltersOpen(true)}
            aria-label="Filters"
          >
            <Filter className="size-4" />
            {activeFilterCount > 0 && (
              <span className={cn(NUM, 'bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-bold')}>
                {activeFilterCount}
              </span>
            )}
          </Button>

          {/* Customer / Product / Design (desktop) */}
          <div className="hidden items-center gap-2 sm:flex sm:gap-2.5">{fieldSelects}</div>

          {/* One Date control: quick ranges and a custom From/To in a single dropdown. */}
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(CONTROL, 'hidden max-w-52 font-medium sm:inline-flex', dateActive && CONTROL_ON)}
                title="Filter by dispatch date"
              >
                <CalendarRange className="size-3.5 shrink-0" />
                <span className="truncate">{dateLabel}</span>
                <ChevronDown className="size-3 shrink-0 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="font-poppins w-auto max-w-[calc(100vw-1.5rem)] p-2.5">
              {datePanel}
            </PopoverContent>
          </Popover>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="hidden h-9 rounded-[4px] text-[12.5px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900 sm:inline-flex"
              onClick={clearAll}
              title="Clear every filter (filters are otherwise remembered between visits)"
            >
              <X className="size-3.5" /> Reset
            </Button>
          )}

          {/* Selection status + the primary Create Challan action. */}
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            {selectedCount > 0 && (
              <span
                // Single-customer selections show a compact "(*)" instead of the full
                // party name (kept out of the pill to avoid clutter); the name is still
                // available on hover via the title. Mixed selections stay spelled out.
                title={activeParty ?? (selectedParties.length > 1 ? `Mixed customers: ${selectedParties.join(', ')}` : undefined)}
                className={cn('rounded-[4px] px-2.5 py-1 text-[12px] font-semibold tabular-nums ring-1 ring-inset', activeParty ? 'bg-sky-50 text-sky-700 ring-sky-200' : 'bg-rose-50 text-rose-700 ring-rose-200')}
              >
                {selectedCount} selected{selectedParties.length > 1 ? ' · mixed customers' : activeParty ? ' · (*)' : ''}
              </span>
            )}
            {canCreate && (
              <Button onClick={createChallan} disabled={selectedCount === 0} className="h-9 flex-1 rounded-[4px] text-[13px] font-bold sm:flex-none" title="Create a challan from the selected lines — one customer (Ctrl+C)">
                <ClipboardList className="size-4" /> Create Challan
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Summary strip: what's in front of you, at a glance ──────────────────
          Quantities are sums of the rows on this page (the API paginates and sends
          no aggregates), so they're labelled as such and never read as a grand total. */}
      <div className="bg-card flex items-stretch gap-0 overflow-x-auto rounded-[4px] border shadow-sm">
        <Stat icon={<Layers className="size-3.5" />} label="Pending lines" value={total(totalRows)} hint="Matching the current filters" emphasis />
        <Stat icon={<Users className="size-3.5" />} label="Customers" value={total(pageTotals.customers)} hint="Distinct customers on this page" />
        <Stat label="Bags" value={total(pageTotals.bags)} hint="Total bags on this page" scoped />
        <Stat label="Kgs" value={total(pageTotals.kgs)} hint="Total kgs on this page" scoped />
        <Stat label="Pcs" value={total(pageTotals.pcs)} hint="Total pcs on this page" scoped />
        <Stat label="Box" value={total(pageTotals.box)} hint="Total box on this page" scoped />
      </div>

      {/* Phones only: the field + date filters live behind the Filter icon above. */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="font-poppins sm:hidden">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>Filters</SheetTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground -mr-2 gap-1.5 font-semibold"
                onClick={clearAll}
                disabled={!hasFilters}
              >
                <X className="size-3.5" /> Reset
              </Button>
            </div>
          </SheetHeader>
          <div className="space-y-4 overflow-y-auto">
            <div className="space-y-2">{fieldSelects}</div>
            {datePanel}
          </div>
          <SheetFooter>
            <Button className="w-full font-bold" onClick={() => setMobileFiltersOpen(false)}>
              Show {total(totalRows)} lines
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* The grid pans sideways whenever the columns are wider than the screen (cells
          never wrap). This wrapper only styles the scroll area: slim, always-visible
          scrollbars so it's obvious there's more to the right, and contained
          overscroll so panning the grid never drags the page with it. */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          '[&_[data-slot=table-container]]:overscroll-x-contain',
          '[&_[data-slot=table-container]]:[scrollbar-width:thin]',
          '[&_[data-slot=table-container]]:[scrollbar-color:var(--color-slate-400)_var(--color-slate-100)]',
        )}
      >
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(r) => r.dispatchId}
          isLoading={isLoading}
          dense
          hideRowView
          // Take the leftover height so the body is the page's only scroll region.
          fill
          // Headers stay clickable to sort, but show no sort icon (kept clean at the
          // user's request). The pointer cursor + hover darken still signal they act.
          hideSortIcon
          // Just a marker class — the tint itself is defined in `className` below, where
          // it can out-specify the zebra/hover rules. (Each cell also fades its own
          // content for other customers — see `cellTone` in the columns.)
          rowClassName={(r) => (selected.has(r.dispatchId) ? 'is-picked' : undefined)}
          // Typography: Inter throughout; figures add tabular-nums (see NUM).
          // Weights carry the hierarchy — customer/quantities bold, supporting
          // fields medium — so the eye lands on the identifying columns first.
          className={[
            'font-sans text-[13px]',
            // Column headers: large, heavy, UPPERCASE — readable at a glance across a
            // wide grid, and the anchor you scan back to after panning sideways.
            '[&_thead_th]:text-[13.5px] [&_thead_th]:font-extrabold [&_thead_th]:uppercase [&_thead_th]:tracking-wide [&_thead_th]:py-1.5',
            // Sorting affordance without an icon: headers still feel clickable (pointer
            // cursor + the blue gradient darkens on hover).
            '[&_thead_th_button]:cursor-pointer',
            '[&_thead_th:hover]:from-blue-900 [&_thead_th:hover]:to-indigo-900',
            // Compact rows so more fit in view (matches the Challans grid).
            '[&_td]:py-1 [&_td]:px-3 [&_th]:px-3',
            // Full grid: grey rules both ways so a value can be traced to its column
            // and its row. Horizontal on the row, vertical on each cell; the last
            // cell drops its rule so the grid doesn't double up on the table border.
            // (These paint the td, so the global dark remap can't reach them — hence
            // the explicit dark variants here and on the row tiers below.)
            '[&_tbody_tr]:border-b [&_tbody_tr]:border-slate-200 dark:[&_tbody_tr]:border-white/10',
            '[&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0',
            // Row backgrounds are three deliberate tiers. Specificity is pinned by
            // repeating the selector so the winner never depends on the order Tailwind
            // emits the utilities in: zebra (0,2,3) < hover (0,3,3) < picked (0,4,3).
            // Banded alternate rows — strong enough to follow a row across all columns.
            '[&_tbody_tr:nth-child(even)_td]:bg-slate-100/80 dark:[&_tbody_tr:nth-child(even)_td]:bg-white/[0.04]',
            // Warm amber hover wash — never changes row size
            '[&_tbody_tr:hover:hover_td]:bg-amber-100/70 dark:[&_tbody_tr:hover:hover_td]:bg-amber-400/10',
            // Ticked rows, tinted so a multi-line pick reads as one contiguous block
            '[&_tbody_tr.is-picked.is-picked.is-picked_td]:bg-sky-100 dark:[&_tbody_tr.is-picked.is-picked.is-picked_td]:bg-sky-500/20',
          ].join(' ')}
          mobileCard={pendingMobileCard}
          emptyText="No pending challan lines — everything dispatched has been challaned."
          onRowClick={(r) => toggle(r)}
        />
      </div>

      {/* ── Footer: range + paging; becomes the selection read-out while picking ── */}
      <div className="bg-card flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[4px] border px-3 py-2 shadow-sm">
        {selectedCount > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className={cn(NUM, 'text-[13px] font-bold text-sky-800 dark:text-sky-300')}>
              {total(selectedCount)} line{selectedCount === 1 ? '' : 's'} selected
            </span>
            {activeParty && <span className="truncate text-[12.5px] font-bold text-slate-900">{activeParty}</span>}
            {!activeParty && <span className="text-[12.5px] font-bold text-amber-700 dark:text-amber-300">Mixed customers — pick one customer</span>}
            <span className={cn(NUM, 'text-muted-foreground font-semibold')}>
              {total(selectedTotals.bags)} bags · {total(selectedTotals.kgs)} kgs · {total(selectedTotals.pcs)} pcs · {total(selectedTotals.box)} box
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Map())}
              className="text-muted-foreground hover:text-foreground cursor-pointer font-semibold underline decoration-dotted underline-offset-2 transition-colors"
              title="Clear the selection (Esc)"
            >
              Clear
            </button>
          </div>
        ) : (
          <p className="text-muted-foreground text-[12px] font-medium">
            {totalRows === 0 ? (
              'No lines'
            ) : (
              <>
                Showing <span className={cn(NUM, 'text-foreground font-bold')}>{total(from)}–{total(to)}</span> of{' '}
                <span className={cn(NUM, 'text-foreground font-bold')}>{total(totalRows)}</span>
              </>
            )}
          </p>
        )}

        <div className="ml-auto flex items-center gap-3">
          <p className="text-muted-foreground text-[12px] font-medium">
            Page <span className={cn(NUM, 'text-foreground font-bold')}>{data?.page ?? page}</span> of{' '}
            <span className={cn(NUM, 'text-foreground font-bold')}>{totalPages}</span>
          </p>
          <PageSizeSelect value={pageSize} onChange={setPageSize} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="font-semibold" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft /> Prev
            </Button>
            <Button variant="outline" size="sm" className="font-semibold" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One exact-match dropdown in the filter bar. The field name doubles as the
 * placeholder (no separate label row, so the bar stays one line tall), and the
 * control rings in the brand colour with a clear "×" once a value is picked.
 */
function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  className?: string;
}) {
  // Grow the field to fit whatever was picked, so a long customer name isn't cut off
  // ("KEERTHIKA STAINL…"). `ch` tracks the font's digit/character width, and the extra
  // allowance covers the chevron + clear button; clamped so one long value can't push
  // the rest of the bar off screen. Passed as a CSS variable rather than a plain
  // `style` width so it only applies from `sm:` up — on phones the field stays
  // full-width and there's nothing to fit.
  const fitted = value ? `${Math.min(Math.max(value.length + 6, 12), 34)}ch` : undefined;

  return (
    <div
      className={cn('relative', className, value && 'sm:w-[var(--fit)]')}
      style={fitted ? ({ '--fit': fitted } as CSSProperties) : undefined}
    >
      <Label className="sr-only">{label}</Label>
      <NativeSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={label}
        className={cn(CONTROL, 'font-medium', value && CONTROL_ON)}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={`Clear ${label} filter`}
          title={`Clear ${label} filter`}
          className="absolute top-1/2 right-6 z-10 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-amber-700/70 transition-colors hover:bg-amber-100 hover:text-amber-900"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

/** One cell of the summary strip. `scoped` marks a page-scoped total. */
function Stat({
  icon,
  label,
  value,
  hint,
  emphasis,
  scoped,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
  scoped?: boolean;
}) {
  return (
    <div
      title={hint}
      className="flex min-w-24 flex-1 flex-col gap-0.5 border-r px-3 py-2 last:border-r-0 sm:min-w-28 sm:px-4"
    >
      <span className="text-muted-foreground flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest">
        {icon}
        {label}
        {scoped && <span className="font-semibold normal-case tracking-normal opacity-60">(page)</span>}
      </span>
      <span
        className={cn(
          NUM,
          emphasis ? 'text-primary text-[20px] font-extrabold' : 'text-[17px] font-bold text-slate-900',
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default PendingChallanPage;
