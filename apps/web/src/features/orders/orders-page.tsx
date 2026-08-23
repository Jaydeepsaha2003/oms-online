import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Ban, ChevronLeft, ChevronRight, EllipsisVertical, FileDown, FileText, Filter, Loader2, Pencil, Plus, Printer, RotateCcw, Search, Trash2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import type { OrderDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, formatDateTime, shortOrderCode } from '@/lib/utils';
import { DATE_FORMATS, formatDate, useDateFormat } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useColumnOrder } from '@/hooks/use-column-order';
import { usePageSize } from '@/hooks/use-page-size';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/common/combo';
import { CancelReasonFields } from '@/components/common/cancel-reason';
import { settingValues, useSettings } from '@/features/settings/use-settings';
import { useCreateQuotationFromOrder } from '@/features/quotations/use-quotations';
import { useCancelOrder, useDeleteOrder, useOrderFilterOptions, useOrders } from './use-orders';
import { OrderTimelineModal } from './order-timeline-modal';

/** Matches the Pending Challan / Challans grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the challan screens. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25',
  CANCELLED: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25',
  DRAFT: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-white/10 dark:text-slate-300 dark:ring-white/15',
};
const STATUS_DOT: Record<string, string> = {
  CONFIRMED: 'bg-emerald-500',
  PENDING: 'bg-amber-500',
  CANCELLED: 'bg-rose-500',
  DRAFT: 'bg-slate-400',
};

/** A status pill with a coloured dot — carries the state alongside the word so
 *  it never relies on colour alone. */
function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-[11.5px] font-bold ring-1 ring-inset', STATUS_STYLE[status] ?? 'bg-muted text-muted-foreground ring-border')}>
      <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[status] ?? 'bg-slate-400')} />
      {status}
    </span>
  );
}

/** Truck colour + tooltip copy per dispatch roll-up (same colour language as the journey timeline). */
const TRUCK_STATE: Record<'FULL' | 'PARTIAL' | 'NONE', { cls: string; label: string; detail: string }> = {
  FULL: {
    cls: 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-400/10',
    label: 'Fully dispatched',
    detail: 'Every line of this order has been dispatched.',
  },
  PARTIAL: {
    cls: 'text-sky-600 hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-400/10',
    label: 'Partially dispatched',
    detail: 'Some lines are dispatched; the rest are still pending.',
  },
  NONE: {
    cls: 'text-amber-500 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-400/10',
    label: 'Not dispatched yet',
    detail: 'Nothing has been dispatched for this order so far.',
  },
};

const COLUMNS: DataColumn<OrderDto>[] = [
  { id: 'code', label: 'Order #', fixed: true, cell: (o) => <span className={cn(TEXT_CELL, 'tabular-nums text-indigo-700 dark:text-indigo-300')}>{shortOrderCode(o.code, o.id)}</span> },
  { id: 'customer', label: 'Customer', cell: (o) => <span className={TEXT_CELL}>{o.customerName}</span> },
  { id: 'agent', label: 'Agent', cell: (o) => <span className={TEXT_CELL}>{o.agentName ?? '—'}</span> },
  { id: 'orderDate', label: 'Order date', cell: (o) => <span className={cn(TEXT_CELL, 'whitespace-nowrap tabular-nums')}>{formatDate(o.orderDate)}</span> },
  { id: 'completion', label: 'Completion', cell: (o) => <span className={cn(TEXT_CELL, 'whitespace-nowrap tabular-nums')}>{formatDate(o.completionDate)}</span> },
  {
    id: 'priority',
    label: 'Priority',
    cell: (o) => (o.priority === 'URGENT' ? <span className="text-[11.5px] font-bold text-rose-600 dark:text-rose-400">URGENT</span> : <span className={TEXT_CELL}>{o.priority ?? '—'}</span>),
  },
  { id: 'items', label: 'Items', align: 'right', cell: (o) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{o.itemCount}</span> },
  { id: 'total', label: 'Total Amount', align: 'right', cell: (o) => <span className="text-[14px] font-bold tabular-nums text-slate-900 dark:text-slate-100">₹{(o.totalAmount ?? 0).toLocaleString('en-IN')}</span> },
  { id: 'status', label: 'Status', cell: (o) => <StatusPill status={o.status} /> },
  {
    id: 'updated',
    label: 'Last updated',
    cell: (o) => (
      <span className="text-muted-foreground whitespace-nowrap text-[12px] font-medium tabular-nums" title={formatDateTime(o.updatedAt)}>
        {formatDate(o.updatedAt)}
      </span>
    ),
  },
];

/*
 * The filter set lives in the URL, not in component state.
 *
 * Opening an order's PDF or its form unmounts this page, and plain `useState`
 * went with it — so coming back landed on an unfiltered list and the work of
 * narrowing it down had to be redone every time.
 *
 * In the query string the browser's own Back button restores them, because the
 * filters are part of the address it returns to. They still reset when they
 * should: the sidebar's "View Orders" link points at a bare `/orders`, so
 * arriving from the menu gives a clean list. Nothing to expire and nothing to
 * clear — and a filtered view is now a link that can be shared or bookmarked.
 *
 * `replace: true` on every write keeps Back pointing at the page you came FROM
 * rather than walking back through each keystroke of a search.
 */
function useOrderFilters() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const filters = {
    search: get('q'),
    agent: get('agent'),
    product: get('product'),
    design: get('design'),
    page: Math.max(1, Number(params.get('page')) || 1),
  };
  /** One writer for the whole set: a filter change also resets the page, and
   *  separate setters would each read the same pre-update query string and
   *  clobber one another when two moved together. */
  const patch = (changes: Partial<typeof filters>) => {
    const next = new URLSearchParams(params);
    const write = (k: string, v: string) => (v ? next.set(k, v) : next.delete(k));
    if (changes.search !== undefined) write('q', changes.search);
    if (changes.agent !== undefined) write('agent', changes.agent);
    if (changes.product !== undefined) write('product', changes.product);
    if (changes.design !== undefined) write('design', changes.design);
    // An explicit page is honoured; any OTHER change drops back to page 1,
    // because page 7 of a freshly narrowed result set is usually empty.
    if (changes.page !== undefined) next.set('page', String(changes.page));
    else next.delete('page');
    setParams(next, { replace: true });
  };
  return { ...filters, patch };
}

export function OrdersPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const confirm = useConfirm();
  const { search, agent, product, design, page, patch } = useOrderFilters();
  // The box keeps its own copy so typing stays instant even while the list
  // re-queries; the URL is the source of truth it is seeded from.
  const [searchInput, setSearchInput] = useState(search);
  const setPage = (n: number) => patch({ page: n });
  const { pageSize, setPageSize: setStoredPageSize } = usePageSize('orders');
  const setPageSize = (n: number) => {
    setStoredPageSize(n);
    patch({});
  };
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const activeFilterCount = (agent ? 1 : 0) + (product ? 1 : 0) + (design ? 1 : 0);
  const resetFilters = () => {
    setSearchInput('');
    patch({ search: '', agent: '', product: '', design: '' });
  };
  const { data: filterOptions } = useOrderFilterOptions();
  const { data, isLoading } = useOrders({
    page,
    pageSize,
    search: search || undefined,
    agent: agent || undefined,
    product: product || undefined,
    design: design || undefined,
  });
  const cols = useColumnOrder('orders', COLUMNS);
  const { format, setFormat } = useDateFormat();
  const [timelineFor, setTimelineFor] = useState<OrderDto | null>(null);
  const [cancelling, setCancelling] = useState<OrderDto | null>(null);
  const [deleting, setDeleting] = useState<OrderDto | null>(null);
  const [quotingDraft, setQuotingDraft] = useState<OrderDto | null>(null);
  const canDelete = can('order:delete');
  const saveAsQuotation = useCreateQuotationFromOrder();

  const items = data?.items ?? [];
  const totalRows = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const from = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalRows);

  const handleCancel = (o: OrderDto) => setCancelling(o);

  const orderActionsMenu = (o: OrderDto) => {
    const truck = TRUCK_STATE[o.dispatchState ?? 'NONE'] ?? TRUCK_STATE.NONE;
    const alreadyCancelled = o.status === 'CANCELLED';
    const hasDispatches = (o.dispatchState ?? 'NONE') !== 'NONE';
    const canCancel = !alreadyCancelled && !hasDispatches;
    const cancelLabel = alreadyCancelled ? 'Already cancelled' : hasDispatches ? 'Cannot cancel - items dispatched' : 'Cancel order';
    // Only a DRAFT is quotable — a confirmed order is a real commitment (and may
    // already have dispatches behind it), so quoting it after the fact is backwards.
    const isDraft = o.status === 'DRAFT';

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label={`Actions for order ${shortOrderCode(o.code, o.id)}`} title="Order actions">
            <EllipsisVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 font-sans">
          {can('order:view') && (
            // Named for where it goes: this route is the order FORM, so calling
            // it "View order" set up the wrong expectation before the page even
            // loaded. The permission stays order:view — opening the form is
            // still allowed; order:update is what gates saving from it.
            <DropdownMenuItem onSelect={() => navigate(`/orders/${o.id}/edit`)}>
              <Pencil /> Edit order
            </DropdownMenuItem>
          )}
          {can('order:view') && (
            <DropdownMenuItem onSelect={() => setTimelineFor(o)}>
              <Truck /> Order journey - {truck.label}
            </DropdownMenuItem>
          )}
          {can('order:print') && (
            // This prints the SALES ORDER. "Bill / Invoice" named it after a tax
            // invoice, which is the challan — a different document entirely.
            <DropdownMenuItem onSelect={() => navigate(`/orders/${o.id}/bill`)}>
              <Printer /> Print Sales Order
            </DropdownMenuItem>
          )}
          {isDraft && can('quotation:create') && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setQuotingDraft(o)}>
                <FileText className="text-violet-600" /> Save as Quotation
              </DropdownMenuItem>
            </>
          )}
          {can('order:update') && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={!canCancel} onSelect={() => handleCancel(o)}>
                <Ban /> {cancelLabel}
              </DropdownMenuItem>
            </>
          )}
          {canDelete && (
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(o)}>
              <Trash2 /> Delete permanently
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Phones: one stacked card per order instead of a horizontally-scrolling table.
  const orderMobileCard = (o: OrderDto) => {
    const truck = TRUCK_STATE[o.dispatchState ?? 'NONE'] ?? TRUCK_STATE.NONE;
    return (
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{shortOrderCode(o.code, o.id)}</p>
            <p className="truncate text-[14px] leading-tight font-bold text-slate-900 dark:text-slate-100">{o.customerName}</p>
            <p className="text-muted-foreground truncate text-[11.5px] font-medium">
              {o.agentName ?? '—'} · {formatDate(o.orderDate)}
              {o.priority === 'URGENT' && <span className="ml-1.5 font-bold text-rose-600 dark:text-rose-400">URGENT</span>}
            </p>
          </div>
          <StatusPill status={o.status} />
        </div>
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <div>
            <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Items</p>
            <p className="font-bold tabular-nums text-slate-800 dark:text-slate-200">{o.itemCount}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Total Amount</p>
            <p className="text-[15px] font-bold tabular-nums text-slate-900 dark:text-slate-100">₹{(o.totalAmount ?? 0).toLocaleString('en-IN')}</p>
          </div>
        </div>
        <div className="flex items-center justify-between border-t pt-2" onClick={(e) => e.stopPropagation()}>
          <span className="text-muted-foreground text-[11px] font-medium tabular-nums" title={formatDateTime(o.updatedAt)}>
            {formatDate(o.updatedAt)}
          </span>
          {/* Quick actions, then the kebab for everything else. The truck both
              opens the order's journey AND carries how far it has shipped in its
              colour — which is why the written "Fully dispatched" chip that used
              to sit here is gone: it said the same thing twice and cost a line of
              the card. Print and PDF fire on the bill page without a second tap
              (see its autoPrint/autoPdf effect). */}
          <div className="flex items-center gap-0.5">
            {can('order:view') && (
              <Button
                variant="ghost"
                size="icon"
                className={cn('size-8', truck.cls)}
                onClick={() => setTimelineFor(o)}
                aria-label={`Order journey — ${truck.label}`}
                title={`Order journey — ${truck.label}`}
              >
                <Truck className="size-4" />
              </Button>
            )}
            {can('order:print') && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-primary size-8"
                  onClick={() => navigate(`/orders/${o.id}/bill`, { state: { autoPrint: true } })}
                  aria-label="Print order"
                  title="Print"
                >
                  <Printer className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-primary size-8"
                  onClick={() => navigate(`/orders/${o.id}/bill`, { state: { autoPdf: true } })}
                  aria-label="Download order PDF"
                  title="PDF"
                >
                  <FileDown className="size-4" />
                </Button>
              </>
            )}
            {orderActionsMenu(o)}
          </div>
          {/* The SAME kebab the desktop rows use, rather than a hand-picked row of
              icons. The icons only ever covered five of the actions, so anything
              added to the menu later — Save as Quotation being the one that
              prompted this — silently never reached a phone. One menu, one place
              to add to, and the two views can't drift apart again. */}
          {orderActionsMenu(o)}
        </div>
      </div>
    );
  };

  return (
    // Fills the viewport: toolbar pinned on top, footer pinned at the bottom, only
    // the grid scrolls. `/orders` is a flush route (app-shell), so the page owns
    // its own padding.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      {/* ── Toolbar: search + filters on the left, actions on the right, one card.
          Poppins + amber controls match the challan screens. */}
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <div className="relative w-full sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search order #, customer or agent…"
              className={cn(CONTROL, 'pl-8 font-medium', searchInput && CONTROL_ON)}
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                patch({ search: e.target.value.trim() });
              }}
            />
          </div>
          {/* Phones: Product / Design filters move behind this icon (see the sheet below). */}
          <Button
            variant="outline"
            size="icon"
            className={cn('relative size-9 shrink-0 rounded-[4px] border-amber-300 lg:hidden', activeFilterCount > 0 && CONTROL_ON)}
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
          {/* Keep orders whose lines contain the picked product / design. Order
              follows the house pattern: Item Name, Agent, Design (no Customer
              filter on this screen, so it starts from Product). */}
          <div className="hidden w-52 lg:block">
            <NativeSelect value={product} onChange={(v) => patch({ product: v })} options={['', ...(filterOptions?.products ?? [])]} placeholder="All products" className={cn(CONTROL, 'font-medium', product && CONTROL_ON)} />
          </div>
          <div className="hidden w-40 lg:block">
            <NativeSelect value={agent} onChange={(v) => patch({ agent: v })} options={['', ...(filterOptions?.agents ?? [])]} placeholder="All agents" className={cn(CONTROL, 'font-medium', agent && CONTROL_ON)} />
          </div>
          <div className="hidden w-40 lg:block">
            <NativeSelect value={design} onChange={(v) => patch({ design: v })} options={['', ...(filterOptions?.designs ?? [])]} placeholder="All designs" className={cn(CONTROL, 'font-medium', design && CONTROL_ON)} />
          </div>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="hidden h-9 rounded-[4px] text-[12.5px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900 lg:inline-flex dark:text-amber-300 dark:hover:bg-amber-400/10"
              onClick={resetFilters}
              title="Clear all filters"
            >
              <RotateCcw className="size-3.5" /> Reset
            </Button>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ColumnSettings
              columns={cols.orderedReorderable}
              hidden={cols.hidden}
              onReorder={cols.moveBefore}
              onMove={cols.move}
              onToggle={cols.toggle}
              onReset={cols.reset}
              dateFormat={{ value: format, options: DATE_FORMATS, onChange: setFormat }}
            />
            {can('order:create') && (
              <Button size="sm" className="h-9 rounded-[4px] text-[12.5px] font-bold" onClick={() => navigate('/orders/new')}>
                <Plus /> New order
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Phones only: Product / Design live behind the Filter icon above. */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="font-poppins lg:hidden">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>Filters</SheetTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground -mr-2 gap-1.5 font-semibold"
                onClick={resetFilters}
                disabled={activeFilterCount === 0}
              >
                <RotateCcw className="size-3.5" /> Reset
              </Button>
            </div>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Product</Label>
              <NativeSelect
                value={product}
                onChange={(v) => patch({ product: v })}
                options={['', ...(filterOptions?.products ?? [])]}
                placeholder="All products"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Agent</Label>
              <NativeSelect
                value={agent}
                onChange={(v) => patch({ agent: v })}
                options={['', ...(filterOptions?.agents ?? [])]}
                placeholder="All agents"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Design</Label>
              <NativeSelect
                value={design}
                onChange={(v) => patch({ design: v })}
                options={['', ...(filterOptions?.designs ?? [])]}
                placeholder="All designs"
              />
            </div>
          </div>
          <SheetFooter>
            <Button className="w-full font-bold" onClick={() => setMobileFiltersOpen(false)}>
              Show {totalRows.toLocaleString('en-IN')} orders
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* The grid pans sideways when columns outgrow the screen; slim scrollbars
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
          rowKey={(o) => o.id}
          isLoading={isLoading}
          dense
          fill
          hideSortIcon
          emptyText="No orders yet — create one."
          onRowClick={can('order:update') ? (o) => navigate(`/orders/${o.id}/edit`) : undefined}
          mobileCard={orderMobileCard}
          className={[
            'font-sans text-[13px]',
            // Rows are click-to-edit, so block accidental text selection (a
            // stray drag while scrolling otherwise highlights the row's text).
            '[&_tbody]:select-none',
            '[&_thead_th]:text-[13.5px] [&_thead_th]:font-extrabold [&_thead_th]:uppercase [&_thead_th]:tracking-wide [&_thead_th]:py-1.5',
            '[&_thead_th_button]:cursor-pointer',
            '[&_thead_th:hover]:from-blue-900 [&_thead_th:hover]:to-indigo-900',
            '[&_td]:py-1 [&_td]:px-3 [&_th]:px-3',
            '[&_thead_th:last-child]:w-16 [&_tbody_td:last-child]:w-16',
            '[&_tbody_button:not([role=switch]):not([role=checkbox])]:size-7',
            '[&_tbody_tr]:border-b [&_tbody_tr]:border-slate-200 dark:[&_tbody_tr]:border-white/10',
            '[&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0',
            '[&_tbody_tr:nth-child(even)_td]:bg-slate-100/80 dark:[&_tbody_tr:nth-child(even)_td]:bg-white/[0.04]',
            '[&_tbody_tr:hover:hover_td]:bg-amber-100/70 dark:[&_tbody_tr:hover:hover_td]:bg-amber-400/10',
          ].join(' ')}
          actions={(o) => {
            if (!(can('order:view') || can('order:print') || can('order:update') || canDelete)) return null;
            return <div className="flex justify-end">{orderActionsMenu(o)}</div>;
          }}
        />
      </div>

      {/* ── Footer: range + paging ─────────────────────────────────────────────── */}
      <div className="bg-card flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[4px] border px-3 py-2 shadow-sm">
        <p className="text-muted-foreground text-[12px] font-medium">
          {totalRows === 0 ? (
            'No orders'
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
            <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>
              <ChevronLeft /> Prev
            </Button>
            <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      </div>

      {timelineFor && <OrderTimelineModal order={timelineFor} onClose={() => setTimelineFor(null)} />}
      {cancelling && <CancelOrderDialog order={cancelling} onClose={() => setCancelling(null)} />}
      {deleting && <DeleteOrderDialog order={deleting} onClose={() => setDeleting(null)} />}

      {quotingDraft && (
        <Dialog open onOpenChange={(o) => !o && setQuotingDraft(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="text-violet-600 size-5" /> Save as Quotation
              </DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    A quotation will be created for <span className="text-foreground font-semibold">{quotingDraft.customerName}</span> with this
                    draft&apos;s items and rates.
                  </p>
                  {/* Spelling out the park-and-reuse deal, because "where did my
                      draft go?" is the obvious first reaction otherwise. */}
                  <p>
                    This draft then moves out of View Orders and lives as the quotation. Order&nbsp;
                    <span className="text-foreground font-semibold">{shortOrderCode(quotingDraft.code, quotingDraft.id)}</span> is held for it — when
                    you convert the quotation, it comes back under that same number. Cancelling or deleting the quotation puts it back as a draft.
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setQuotingDraft(null)} disabled={saveAsQuotation.isPending}>
                Cancel
              </Button>
              <Button
                disabled={saveAsQuotation.isPending}
                onClick={() =>
                  saveAsQuotation.mutate(quotingDraft.id, {
                    onSuccess: (q) => {
                      setQuotingDraft(null);
                      toast.success(`Saved as quotation ${q.code}`);
                      navigate('/quotations');
                    },
                    onError: (e) => toast.error(getApiErrorMessage(e, 'Could not save as quotation')),
                  })
                }
              >
                {saveAsQuotation.isPending ? <Loader2 className="animate-spin" /> : <FileText />} Create quotation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* ── Cancel with reason ──────────────────────────────────────────────────────── */

function CancelOrderDialog({ order, onClose }: { order: OrderDto; onClose: () => void }) {
  const cancel = useCancelOrder();
  const { data: settings } = useSettings();
  const reasons = settingValues(settings, 'QUOTATION_CANCEL_REASON');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  const submit = () => {
    if (!reason.trim()) return toast.error('Please choose a reason.');
    cancel.mutate(
      { id: order.id, reason: reason.trim(), note: note.trim() || null },
      {
        onSuccess: () => { toast.success('Order cancelled'); onClose(); },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Cancel failed')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel {order.code ?? `#${order.id}`}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <p className="text-muted-foreground text-sm">
            Order for “{order.customerName}” will be marked CANCELLED. It stays on record but can no longer be dispatched.
          </p>
          <CancelReasonFields reasons={reasons} reason={reason} note={note} onReason={setReason} onNote={setNote} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Keep order</Button>
          <Button type="button" variant="destructive" onClick={submit} disabled={cancel.isPending}>
            {cancel.isPending ? <Loader2 className="animate-spin" /> : <Ban />} Cancel order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Permanent (hard) delete — admin only, typed confirmation ─────────────────── */

function DeleteOrderDialog({ order, onClose }: { order: OrderDto; onClose: () => void }) {
  const del = useDeleteOrder();
  const [confirmText, setConfirmText] = useState('');
  const armed = confirmText.trim().toUpperCase() === 'DELETE';

  const submit = () => {
    if (!armed) return;
    del.mutate(order.id, {
      onSuccess: () => { toast.success('Order deleted permanently'); onClose(); },
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Permanently delete {order.code ?? `#${order.id}`}?</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-400/25 dark:bg-rose-500/10 dark:text-rose-300">
            This <strong>permanently removes</strong> the order and its lines for “{order.customerName}”. This cannot be undone.
            Prefer <strong>Cancel</strong> if you only want to stop it while keeping the record.
          </div>
          <div className="space-y-1.5">
            <Label>Type <span className="font-mono font-bold">DELETE</span> to confirm</Label>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" autoFocus />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={submit} disabled={!armed || del.isPending}>
            {del.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OrdersPage;
