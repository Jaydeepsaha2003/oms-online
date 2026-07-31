import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, ClipboardList, Filter, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import type { PendingChallanLine } from '@oms/shared';
import { cn, shortOrderCode } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useConfirm } from '@/components/common/confirm';
import { usePendingChallans } from './use-challans';
import { PRESETS, presetRange } from './date-presets';

const PAGE_SIZE = 50;
const num = (v: number | null) => (v ? v.toLocaleString('en-IN') : '—');

export function PendingChallanPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { can } = usePermissions();
  const canCreate = can('challan:create');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [preset, setPreset] = useState('');
  const [page, setPage] = useState(1);
  // Selection preserves insertion order (= the order rows were ticked).
  const [selected, setSelected] = useState<Map<number, PendingChallanLine>>(new Map());
  // Phones: From/To/Quick range live behind this Filter icon (see the sheet below).
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const activeFilterCount = dateFrom || dateTo ? 1 : 0;

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize: PAGE_SIZE, search: search || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined };
  const { data, isLoading } = usePendingChallans(query);
  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const toggle = (r: PendingChallanLine) =>
    setSelected((m) => {
      const n = new Map(m);
      if (n.has(r.dispatchId)) n.delete(r.dispatchId);
      else n.set(r.dispatchId, r);
      return n;
    });

  const applyPreset = (p: string) => {
    setPreset(p);
    const r = presetRange(p);
    if (r) {
      setDateFrom(r.from);
      setDateTo(r.to);
      setPage(1);
    }
  };
  const clearAll = () => {
    setSearchInput('');
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setPreset('');
    setPage(1);
  };

  const createChallan = async () => {
    const lines = [...selected.values()];
    if (lines.length === 0) return toast.error('Please select one or more rows.');
    const parties = [...new Set(lines.map((l) => l.customerName.trim()).filter(Boolean))];
    if (parties.length !== 1) {
      return toast.error(
        parties.length === 0 ? 'Selected rows are missing the customer name.' : `Select rows for the SAME customer. Found: ${parties.join(', ')}`,
      );
    }
    const party = parties[0];
    // "X of Y" — Y is how many pending lines this party has in the list; clamped so a
    // cross-page selection never reads as more than the total.
    const partyTotal = Math.max(lines.length, items.filter((r) => r.customerName.trim() === party).length);
    const ok = await confirm({
      title: 'Create challan?',
      description: `Proceed with ${lines.length} of ${partyTotal} pending line${partyTotal === 1 ? '' : 's'} for ${party}?`,
      confirmText: 'Create Challan',
      autoFocusConfirm: true, // Enter proceeds
    });
    if (!ok) return;
    navigate('/challans/new', { state: { customerName: party, lines } });
  };

  const columns: DataColumn<PendingChallanLine>[] = [
    {
      id: 'sel',
      label: '',
      fixed: true,
      cell: (r) => (
        <span className={cn('flex size-4 items-center justify-center rounded border transition-colors', selected.has(r.dispatchId) ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
          {selected.has(r.dispatchId) && <span className="text-[10px] leading-none">✓</span>}
        </span>
      ),
    },
    { id: 'order', label: 'Ord #', sortValue: (r) => r.orderId ?? 0, cell: (r) => <span className="font-medium tabular-nums text-[13px]">{shortOrderCode(r.orderCode, r.orderId)}</span> },
    { id: 'date', label: 'D-Date', sortValue: (r) => r.dispatchDate, cell: (r) => <span className="whitespace-nowrap text-[13px]">{formatDate(r.dispatchDate)}</span> },
    // Customer is the row's primary identifier → medium 500.
    { id: 'customer', label: 'Customer', sortValue: (r) => r.customerName, cell: (r) => <span className="font-medium text-[13px]">{r.customerName || '—'}</span> },
    { id: 'product', label: 'Product', sortValue: (r) => r.productName ?? '', cell: (r) => <span className="text-[13px]">{r.productName || '—'}</span> },
    { id: 'design', label: 'Design', sortValue: (r) => r.design ?? '', cell: (r) => <span className="text-[13px]">{r.design || '—'}</span> },
    { id: 'bags', label: 'Bags', align: 'right', sortValue: (r) => r.bags ?? 0, cell: (r) => <span className="tabular-nums text-[13px]">{num(r.bags)}</span> },
    { id: 'kgs', label: 'Kgs', align: 'right', sortValue: (r) => r.kgs ?? 0, cell: (r) => <span className="tabular-nums text-[13px]">{num(r.kgs)}</span> },
    { id: 'pcs', label: 'Pcs', align: 'right', sortValue: (r) => r.pcs ?? 0, cell: (r) => <span className="tabular-nums text-[13px]">{num(r.pcs)}</span> },
    { id: 'box', label: 'Box', align: 'right', sortValue: (r) => r.box ?? 0, cell: (r) => <span className="tabular-nums text-[13px]">{num(r.box)}</span> },
    { id: 'unit', label: 'Unit', sortValue: (r) => r.unit ?? '', cell: (r) => <span className="text-[13px]">{r.unit || '—'}</span> },
    { id: 'rate', label: 'Rate', align: 'right', sortValue: (r) => r.rate ?? 0, cell: (r) => <span className="tabular-nums text-[13px]">{num(r.rate)}</span> },
  ];

  const selectedCount = selected.size;
  const selectedParties = useMemo(() => [...new Set([...selected.values()].map((l) => l.customerName.trim()))], [selected]);

  // Ctrl/Cmd+C → Create Challan from the selected rows (with the "X of Y" confirm).
  // Bound once; reads the latest handler/state via refs. We never hijack a genuine
  // copy: typing in a field or an active text selection is left to the browser, and
  // with nothing ticked the key does nothing (so a plain Ctrl+C still copies).
  const createRef = useRef(createChallan);
  createRef.current = createChallan;
  const canActRef = useRef(false);
  canActRef.current = canCreate && selectedCount > 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
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
    return (
      <div className={cn('-m-3 space-y-1.5 rounded-lg p-3 font-sans transition-colors', isSel && 'bg-primary/5 ring-2 ring-primary')}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-widest tabular-nums">{shortOrderCode(r.orderCode, r.orderId)}</p>
            <p className="truncate text-[14px] leading-tight font-medium">{r.customerName}</p>
            <p className="text-muted-foreground truncate text-[11px]">{r.productName || '—'}{r.design ? ` · ${r.design}` : ''}</p>
          </div>
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
              isSel ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
            )}
          >
            {isSel && <Check className="size-3" strokeWidth={3} />}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 text-[12px]">
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-widest">Bags</p>
            <p className="font-medium tabular-nums">{num(r.bags)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-widest">Kgs</p>
            <p className="font-medium tabular-nums">{num(r.kgs)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-widest">Pcs</p>
            <p className="font-medium tabular-nums">{num(r.pcs)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-widest">Box</p>
            <p className="font-medium tabular-nums">{num(r.box)}</p>
          </div>
        </div>
        <div className="text-muted-foreground flex items-center justify-between text-[11px]">
          <span>{formatDate(r.dispatchDate)} · {r.unit || '—'}</span>
          <span className="font-semibold tabular-nums text-emerald-700">₹{num(r.rate)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Filters + the primary Create Challan action, all in one card. Search stays
          visible; From/To/Quick range collapse behind the Filter icon on phones. The
          page title lives in the top bar, so there's no separate header row. */}
      <div className="bg-card flex flex-wrap items-end gap-2.5 rounded-md border p-2.5 font-sans shadow-sm sm:p-3">
        <div className="relative w-full sm:w-64">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Search</Label>
          <Search className="text-muted-foreground pointer-events-none absolute top-[34px] left-3 size-4" />
          <Input className="pl-9 text-[14px]" placeholder="Customer, product, design… (comma = multi)" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <Button
          variant="outline"
          size="icon"
          className="relative shrink-0 sm:hidden"
          onClick={() => setMobileFiltersOpen(true)}
          aria-label="Filters"
        >
          <Filter className="size-4" />
          {activeFilterCount > 0 && (
            <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-medium">
              {activeFilterCount}
            </span>
          )}
        </Button>
        <div className="hidden items-end gap-2.5 sm:flex sm:flex-wrap">
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">From</Label>
            <Input type="date" className="w-40 text-[14px]" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">To</Label>
            <Input type="date" className="w-40 text-[14px]" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
          </div>
          <div className="w-40 space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Quick range</Label>
            <NativeSelect value={preset} onChange={applyPreset} options={['', ...PRESETS]} placeholder="Range…" className="text-[14px]" />
          </div>
          {(search || dateFrom || dateTo || preset) && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clearAll}>
              <X /> Clear
            </Button>
          )}
        </div>

        {/* Selection status + the primary Create Challan action — right-aligned in
            the same card, always visible (not tucked into the mobile filter sheet). */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          {selectedCount > 0 && (
            <span
              // Single-customer selections show a compact "(*)" instead of the full
              // party name (kept out of the pill to avoid clutter); the name is still
              // available on hover via the title. Mixed selections stay spelled out.
              title={selectedParties.length === 1 ? selectedParties[0] : selectedParties.length > 1 ? `Mixed customers: ${selectedParties.join(', ')}` : undefined}
              className={cn('rounded-lg px-3 py-1.5 text-[13px] font-medium tabular-nums ring-1 ring-inset', selectedParties.length === 1 ? 'bg-sky-50 text-sky-700 ring-sky-200' : 'bg-amber-50 text-amber-700 ring-amber-200')}
            >
              {selectedCount} selected{selectedParties.length > 1 ? ' · mixed customers' : selectedParties[0] ? ' · (*)' : ''}
            </span>
          )}
          {canCreate && (
            <Button onClick={createChallan} disabled={selectedCount === 0} className="flex-1 text-[14px] font-semibold sm:flex-none" title="Create a challan from the selected lines — one customer (Ctrl+C)">
              <ClipboardList /> Create Challan
            </Button>
          )}
        </div>
      </div>

      {/* Phones only: From/To/Quick range live behind the Filter icon above. */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="sm:hidden">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>Filters</SheetTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground -mr-2 gap-1.5"
                onClick={clearAll}
                disabled={!(search || dateFrom || dateTo || preset)}
              >
                <X className="size-3.5" /> Reset
              </Button>
            </div>
          </SheetHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-[10px] font-semibold uppercase tracking-widest">From</Label>
                <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-[10px] font-semibold uppercase tracking-widest">To</Label>
                <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[10px] font-semibold uppercase tracking-widest">Quick range</Label>
              <NativeSelect value={preset} onChange={applyPreset} options={['', ...PRESETS]} placeholder="Range…" />
            </div>
          </div>
          <SheetFooter>
            <Button className="w-full" onClick={() => setMobileFiltersOpen(false)}>
              Show {(data?.total ?? 0).toLocaleString('en-IN')} lines
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(r) => r.dispatchId}
        isLoading={isLoading}
        dense
        hideRowView
        // No idle sort chevron on the headers — an up/down arrow appears only on
        // the column you click to sort.
        hideIdleSortIcon
        // Inter Variable typography spec:
        // • 13px data rows (font-normal 400), customer column uses font-medium 500
        // • 10px bold uppercase column headers with wide tracking, muted foreground
        // • Compact ~6px vertical padding, 12px horizontal
        // • Dotted 1px row separators instead of solid borders
        // • Warm amber hover wash
        // • tabular-nums on all numeric cells (handled per-column)
        className={[
          'font-sans text-[13px]',
          // Column headers: 10px, bold, UPPERCASE, wide letter-spacing, muted foreground
          '[&_thead_th]:text-[10px] [&_thead_th]:font-bold [&_thead_th]:uppercase [&_thead_th]:tracking-widest',
          // Compact row height: ~6px vertical padding, 12px horizontal
          '[&_td]:py-1.5 [&_td]:px-3 [&_th]:px-3',
          // Dotted 1px row separators instead of solid heavy borders
          '[&_tbody_tr]:border-b [&_tbody_tr]:border-dotted [&_tbody_tr]:border-border/50',
          // Remove default solid td right borders for a cleaner look
          '[&_td]:border-r-0',
          // Warm amber hover wash — never changes row size
          '[&_tbody_tr:hover_td]:bg-amber-50/60',
          // Subtle even-row zebra
          '[&_tbody_tr:nth-child(even)_td]:bg-slate-50/50',
          // Data rows use regular 400 weight (specific columns override to 500/600)
          '[&_tbody_td]:font-normal',
        ].join(' ')}
        mobileCard={pendingMobileCard}
        emptyText="No pending challan lines — everything dispatched has been challaned."
        onRowClick={(r) => toggle(r)}
      />

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-[13px] tabular-nums">Page {data?.page ?? page} of {totalPages}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <ChevronLeft /> Prev
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default PendingChallanPage;
