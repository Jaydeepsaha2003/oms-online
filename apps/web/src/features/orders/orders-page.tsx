import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, ChevronLeft, ChevronRight, Eye, Filter, Plus, Printer, RotateCcw, Search, Truck } from 'lucide-react';
import { toast } from 'sonner';
import type { OrderDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, formatDateTime, shortOrderCode } from '@/lib/utils';
import { DATE_FORMATS, formatDate, useDateFormat } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { NativeSelect } from '@/components/common/combo';
import { useCancelOrder, useOrderFilterOptions, useOrders } from './use-orders';
import { OrderTimelineModal } from './order-timeline-modal';

const PAGE_SIZE = 50;

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  CANCELLED: 'bg-rose-50 text-rose-700 ring-rose-200',
  DRAFT: 'bg-slate-100 text-slate-700 ring-slate-200',
};

/** Truck colour + tooltip copy per dispatch roll-up (same colour language as the journey timeline). */
const TRUCK_STATE: Record<'FULL' | 'PARTIAL' | 'NONE', { cls: string; label: string; detail: string }> = {
  FULL: {
    cls: 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700',
    label: 'Fully dispatched',
    detail: 'Every line of this order has been dispatched.',
  },
  PARTIAL: {
    cls: 'text-sky-600 hover:bg-sky-50 hover:text-sky-700',
    label: 'Partially dispatched',
    detail: 'Some lines are dispatched; the rest are still pending.',
  },
  NONE: {
    cls: 'text-amber-500 hover:bg-amber-50 hover:text-amber-600',
    label: 'Not dispatched yet',
    detail: 'Nothing has been dispatched for this order so far.',
  },
};

const COLUMNS: DataColumn<OrderDto>[] = [
  { id: 'code', label: 'Order #', fixed: true, cell: (o) => <span className="font-mono font-semibold">{shortOrderCode(o.code, o.id)}</span> },
  { id: 'customer', label: 'Customer', cell: (o) => <span className="font-medium">{o.customerName}</span> },
  { id: 'agent', label: 'Agent', cell: (o) => o.agentName ?? '—' },
  { id: 'orderDate', label: 'Order date', cell: (o) => <span className="whitespace-nowrap">{formatDate(o.orderDate)}</span> },
  { id: 'completion', label: 'Completion', cell: (o) => <span className="whitespace-nowrap">{formatDate(o.completionDate)}</span> },
  {
    id: 'priority',
    label: 'Priority',
    cell: (o) => (o.priority === 'URGENT' ? <span className="font-semibold text-rose-600">URGENT</span> : (o.priority ?? '—')),
  },
  { id: 'items', label: 'Items', align: 'right', cell: (o) => <span className="tabular-nums">{o.itemCount}</span> },
  { id: 'total', label: 'Total Amount', align: 'right', cell: (o) => <span className="text-[17px] font-bold tabular-nums">₹{(o.totalAmount ?? 0).toLocaleString('en-IN')}</span> },
  {
    id: 'status',
    label: 'Status',
    cell: (o) => (
      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLE[o.status] ?? 'bg-muted text-muted-foreground ring-border'}`}>{o.status}</span>
    ),
  },
  {
    id: 'updated',
    label: 'Last updated',
    cell: (o) => (
      <span className="text-muted-foreground whitespace-nowrap font-mono text-xs" title={formatDateTime(o.updatedAt)}>
        {formatDate(o.updatedAt)}
      </span>
    ),
  },
];

export function OrdersPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [product, setProduct] = useState('');
  const [design, setDesign] = useState('');
  const [page, setPage] = useState(1);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const activeFilterCount = (product ? 1 : 0) + (design ? 1 : 0);
  const resetFilters = () => {
    setProduct('');
    setDesign('');
    setPage(1);
  };
  const { data: filterOptions } = useOrderFilterOptions();
  const { data, isLoading } = useOrders({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    product: product || undefined,
    design: design || undefined,
  });
  const cancel = useCancelOrder();
  const cols = useColumnOrder('orders', COLUMNS);
  const { format, setFormat } = useDateFormat();
  const [timelineFor, setTimelineFor] = useState<OrderDto | null>(null);

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const handleCancel = async (o: OrderDto) => {
    const ok = await confirm({
      title: 'Cancel this order?',
      description: `Order ${o.code ?? `#${o.id}`} for "${o.customerName}" will be marked CANCELLED. It stays on record but can no longer be dispatched.`,
      confirmText: 'Cancel order',
      destructive: true,
    });
    if (!ok) return;
    cancel.mutate(o.id, {
      onSuccess: () => toast.success('Order cancelled'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Cancel failed')),
    });
  };

  // Phones: one stacked card per order instead of a horizontally-scrolling table.
  const orderMobileCard = (o: OrderDto) => {
    const truck = TRUCK_STATE[o.dispatchState ?? 'NONE'] ?? TRUCK_STATE.NONE;
    const alreadyCancelled = o.status === 'CANCELLED';
    const hasDispatches = (o.dispatchState ?? 'NONE') !== 'NONE';
    const canCancel = !alreadyCancelled && !hasDispatches;
    return (
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-muted-foreground font-mono text-xs font-semibold">{shortOrderCode(o.code, o.id)}</p>
            <p className="truncate leading-tight font-medium">{o.customerName}</p>
            <p className="text-muted-foreground truncate text-xs">
              {o.agentName ?? '—'} · {formatDate(o.orderDate)}
              {o.priority === 'URGENT' && <span className="ml-1.5 font-semibold text-rose-600">URGENT</span>}
            </p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ring-1',
              STATUS_STYLE[o.status] ?? 'bg-muted text-muted-foreground ring-border',
            )}
          >
            {o.status}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-muted-foreground">Items</p>
            <p className="font-medium tabular-nums">{o.itemCount}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total Amount</p>
            <p className="text-lg font-bold tabular-nums">₹{(o.totalAmount ?? 0).toLocaleString('en-IN')}</p>
          </div>
        </div>
        <div className="flex items-center justify-between border-t pt-2.5" onClick={(e) => e.stopPropagation()}>
          <span className="text-muted-foreground font-mono text-[11px]" title={formatDateTime(o.updatedAt)}>
            {formatDate(o.updatedAt)}
          </span>
          <div className="flex items-center gap-1">
            {can('order:view') && (
              <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate(`/orders/${o.id}/edit`)} aria-label="View order">
                <Eye className="size-4" />
              </Button>
            )}
            {can('order:view') && (
              <Button
                variant="ghost"
                size="icon"
                className={cn('size-8', truck.cls)}
                onClick={() => setTimelineFor(o)}
                aria-label={`Order journey — ${truck.label}`}
                title={truck.label}
              >
                <Truck className="size-4" />
              </Button>
            )}
            {can('order:print') && (
              <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate(`/orders/${o.id}/bill`)} aria-label="Bill / Invoice">
                <Printer className="size-4" />
              </Button>
            )}
            {can('order:update') && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive disabled:text-slate-300"
                disabled={!canCancel}
                onClick={() => handleCancel(o)}
                aria-label={alreadyCancelled ? 'Order already cancelled' : hasDispatches ? 'Cannot cancel — items dispatched' : 'Cancel order'}
              >
                <Ban className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* No page title here — the topbar already shows "View Orders". Search,
          filters and actions share one row (sticky) so the list starts right
          below it instead of losing a whole row to a redundant heading. */}
      <div className="bg-background/85 sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-md px-1 py-1.5 backdrop-blur">
        <div className="relative w-full flex-1 sm:w-72 sm:flex-none">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search order #, customer or agent…"
            className="pl-9"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setSearch(e.target.value.trim());
              setPage(1);
            }}
          />
        </div>
        {/* Phones: Product / Design filters move behind this icon (see the sheet below). */}
        <Button
          variant="outline"
          size="icon"
          className="relative shrink-0 lg:hidden"
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
        {/* Keep orders whose lines contain the picked product / design. */}
        <div className="hidden w-56 lg:block">
          <NativeSelect value={product} onChange={(v) => { setProduct(v); setPage(1); }} options={['', ...(filterOptions?.products ?? [])]} placeholder="All products" />
        </div>
        <div className="hidden w-44 lg:block">
          <NativeSelect value={design} onChange={(v) => { setDesign(v); setPage(1); }} options={['', ...(filterOptions?.designs ?? [])]} placeholder="All designs" />
        </div>
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
            <Button size="sm" onClick={() => navigate('/orders/new')}>
              <Plus /> New order
            </Button>
          )}
        </div>
      </div>

      {/* Phones only: Product / Design live behind the Filter icon above. */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="lg:hidden">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>Filters</SheetTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground -mr-2 gap-1.5"
                onClick={resetFilters}
                disabled={activeFilterCount === 0}
              >
                <RotateCcw className="size-3.5" /> Reset
              </Button>
            </div>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Product</Label>
              <NativeSelect
                value={product}
                onChange={(v) => { setProduct(v); setPage(1); }}
                options={['', ...(filterOptions?.products ?? [])]}
                placeholder="All products"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Design</Label>
              <NativeSelect
                value={design}
                onChange={(v) => { setDesign(v); setPage(1); }}
                options={['', ...(filterOptions?.designs ?? [])]}
                placeholder="All designs"
              />
            </div>
          </div>
          <SheetFooter>
            <Button className="w-full" onClick={() => setMobileFiltersOpen(false)}>
              Show {(data?.total ?? 0).toLocaleString('en-IN')} orders
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <DataTable
        columns={cols.visibleColumns}
        rows={items}
        rowKey={(o) => o.id}
        isLoading={isLoading}
        dense
        // No height cap — every row renders in the page's own natural scroll
        // (same as every other list page), so pagination sits right after the
        // last row instead of behind a second, nested scrollbar.
        // Larger, easy-to-read data font (columns still auto-fit their content).
        className="text-[16px] [&_thead_th]:text-[14px] [&_td]:py-1.5 [&_th]:py-2 [&_tbody_button]:size-8"
        emptyText="No orders yet — create one."
        onRowClick={can('order:update') ? (o) => navigate(`/orders/${o.id}/edit`) : undefined}
        mobileCard={orderMobileCard}
        actions={(o) => {
          if (!(can('order:view') || can('order:print') || can('order:update'))) return null;
          const truck = TRUCK_STATE[o.dispatchState ?? 'NONE'] ?? TRUCK_STATE.NONE;
          const alreadyCancelled = o.status === 'CANCELLED';
          const hasDispatches = (o.dispatchState ?? 'NONE') !== 'NONE';
          const canCancel = !alreadyCancelled && !hasDispatches;
          return (
            <div className="flex justify-end gap-1">
              {can('order:view') && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate(`/orders/${o.id}/edit`)} aria-label="View order">
                      <Eye className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="font-semibold">View order</p>
                    <p className="opacity-80">Open the full order to see or edit its details.</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {can('order:view') && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn('size-8', truck.cls)}
                      onClick={() => setTimelineFor(o)}
                      aria-label={`Order journey — ${truck.label}`}
                    >
                      <Truck className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-60">
                    <p className="font-semibold">Order journey · {truck.label}</p>
                    <p className="opacity-80">{truck.detail} Click to see every dispatch and challan, step by step.</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {can('order:print') && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate(`/orders/${o.id}/bill`)} aria-label="Bill / Invoice">
                      <Printer className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="font-semibold">Bill / Invoice</p>
                    <p className="opacity-80">Open the printable sales-order bill.</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {can('order:update') && (
                <Tooltip>
                  {/* span wrapper — a disabled button swallows pointer events, so the
                      tooltip explaining WHY it's disabled would never show without it */}
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive disabled:text-slate-300"
                        disabled={!canCancel}
                        onClick={() => handleCancel(o)}
                        aria-label={alreadyCancelled ? 'Order already cancelled' : hasDispatches ? 'Cannot cancel — items dispatched' : 'Cancel order'}
                      >
                        <Ban className="size-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-56">
                    {alreadyCancelled ? (
                      <>
                        <p className="font-semibold">Already cancelled</p>
                        <p className="opacity-80">This order is cancelled and kept for records.</p>
                      </>
                    ) : hasDispatches ? (
                      <>
                        <p className="font-semibold">Cannot cancel</p>
                        <p className="opacity-80">Items of this order are already dispatched — only untouched orders can be cancelled.</p>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold">Cancel order</p>
                        <p className="opacity-80">Marks the order CANCELLED. It stays on record but can no longer be dispatched.</p>
                      </>
                    )}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        }}
      />

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {data?.total ?? 0} order(s) · page {data?.page ?? page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <ChevronLeft /> Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next <ChevronRight />
          </Button>
        </div>
      </div>

      {timelineFor && <OrderTimelineModal order={timelineFor} onClose={() => setTimelineFor(null)} />}
    </div>
  );
}
