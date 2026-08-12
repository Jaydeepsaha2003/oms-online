import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, ChevronLeft, ChevronRight, ExternalLink, Filter, Loader2, Pencil, RotateCcw, Save, Trash2, Truck, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import type { OrderDto, OrderInput, OrderItemDto, QtyField } from '@oms/shared';
import { isUncommittedOrder, ORDER_LINE_EXPORT_COLUMNS, ORDER_PRIORITIES, qtyOrderForCategory, resolveSpecialRates } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, shortOrderCode } from '@/lib/utils';
import { DATE_FORMATS, formatDate, useDateFormat } from '@/lib/date-format';
import { useAutoSizePcs } from '@/lib/auto-size-pcs';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { usePageSize } from '@/hooks/use-page-size';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { CancelReasonFields } from '@/components/common/cancel-reason';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { ExportButton, ExportColumnsDialog } from '@/components/common/excel-actions';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combo, NativeSelect } from '@/components/common/combo';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { settingValues, useOrderQtyLayout, useSettings } from '@/features/settings/use-settings';
import { useCustomerSpecialRates } from '@/features/special-rates/use-special-rates';
import { usePermissions } from '@/hooks/use-permissions';
import { exportOrderLines, useOrderFilterOptions, useOrderLookups, useOrders, usePriceAsOf, useSaveOrder } from './use-orders';
import { LiveLinePhotos } from './line-photos';
import { DesignNamePicker, resolveDesignNameChoices } from './design-name-picker';

/** {@link ORDER_LINE_EXPORT_COLUMNS} reshaped for the export dialog's `{id, label}` prop. */
const EXPORT_COLUMN_OPTIONS = ORDER_LINE_EXPORT_COLUMNS.map((c) => ({ id: c.id, label: c.header }));

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25',
  CANCELLED: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25',
};
const STATUS_DOT: Record<string, string> = {
  CONFIRMED: 'bg-emerald-500',
  PENDING: 'bg-amber-500',
  CANCELLED: 'bg-rose-500',
};

/** Matches the Pending Challan / Challans / View Orders grids. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

/** A status pill with a coloured dot — carries the state alongside the word. */
function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-[11.5px] font-bold ring-1 ring-inset', STATUS_STYLE[status] ?? 'bg-muted text-muted-foreground ring-border')}>
      <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[status] ?? 'bg-slate-400')} />
      {status}
    </span>
  );
}

const num = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmtNum = (v: number | null) => (v == null ? '' : String(v));
const dash = (v: number | null) => (v == null || v === 0 ? '—' : v.toLocaleString('en-IN'));

/** Maps the shared QtyField key ('kgs') to the line editor's own form key ('gram'). */
const QTY_FIELD_INFO: Record<QtyField, { key: 'bags' | 'pcs' | 'gram' | 'box'; label: string }> = {
  bags: { key: 'bags', label: 'Bags' },
  pcs: { key: 'pcs', label: 'Pcs' },
  kgs: { key: 'gram', label: 'Kgs' },
  box: { key: 'box', label: 'Box' },
};

/** One flat row = an order line plus its parent order's header info. */
const isLogoDesign = (designType?: string | null) => (designType ?? '').toUpperCase().includes('LOGO');

interface Row {
  order: OrderDto;
  line: OrderItemDto;
}

/** Per-line shipping state. Nothing renders for an undispatched line — a chip on
 *  every row would just be noise when most of the list hasn't shipped. */
/**
 * @param showPending render an explicit "Not dispatched" chip instead of nothing
 *   when the line hasn't shipped. Used by the phone card: there, absence of a
 *   chip is indistinguishable from information the card failed to show, so the
 *   state is always spelled out. The desktop table leaves it off — it has a
 *   Status column header, and most lines are pending, so a chip on every row
 *   would be noise.
 */
function DispatchChip({ state, showPending }: { state?: OrderItemDto['dispatchState']; showPending?: boolean }) {
  if (state !== 'PARTIAL' && state !== 'FULL') {
    return showPending ? (
      <span className="text-muted-foreground inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ring-slate-200 dark:ring-white/15">
        <Truck className="size-2.5" /> Not dispatched
      </span>
    ) : null;
  }
  const full = state === 'FULL';
  return (
    <span
      className={cn(
        'mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset',
        full
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25'
          : 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25',
      )}
      title={full ? 'Fully dispatched — quantities and rate are locked' : 'Partly dispatched — quantities and rate are locked'}
    >
      <Truck className="size-2.5" />
      {full ? 'Fully dispatched' : 'Part dispatched'}
    </span>
  );
}

/** Build the full update payload from an order + a (possibly edited) item set. */
function toInput(o: OrderDto, items: OrderItemDto[]): OrderInput {
  return {
    customerName: o.customerName,
    agentName: o.agentName,
    category: o.category,
    orderDate: o.orderDate,
    completionDate: o.completionDate,
    status: o.status,
    comment: o.comment,
    items: items.map((it) => ({
      id: it.id,
      pCategory: it.pCategory,
      subCategory: it.subCategory,
      product: it.product,
      design: it.design,
      productName: it.productName,
      designType: it.designType,
      psize: it.psize,
      bags: it.bags,
      pcs: it.pcs,
      gram: it.gram,
      box: it.box,
      productRate: it.productRate,
      designRate: it.designRate,
      rate: it.rate,
      calField: it.calField,
      priority: it.priority,
      ordType: it.ordType,
      status: it.status,
      comment: it.comment,
    })),
  };
}

const COLUMNS: DataColumn<Row>[] = [
  { id: 'orderId', label: 'Order ID', fixed: true, cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums text-indigo-700 dark:text-indigo-300')}>{shortOrderCode(r.order.code, r.order.id)}</span> },
  { id: 'orderDate', label: 'Order Date', cell: (r) => <span className={cn(TEXT_CELL, 'whitespace-nowrap tabular-nums')}>{formatDate(r.order.orderDate)}</span> },
  { id: 'dueDate', label: 'Due Date', cell: (r) => <span className={cn(TEXT_CELL, 'whitespace-nowrap tabular-nums')}>{formatDate(r.order.completionDate)}</span> },
  { id: 'customer', label: 'Customer Name', cell: (r) => <span className={TEXT_CELL}>{r.order.customerName}</span> },
  {
    id: 'product',
    label: 'Product Name',
    cell: (r) => (
      <span className={r.line.status === 'CANCELLED' ? 'text-muted-foreground text-[13px] font-semibold line-through' : TEXT_CELL}>
        {r.line.productName || r.line.product || '—'}
      </span>
    ),
  },
  { id: 'designType', label: 'Design Type', cell: (r) => <span className={TEXT_CELL}>{r.line.designType || '—'}</span> },
  {
    id: 'priority',
    label: 'Priority',
    cell: (r) => (r.line.priority === 'URGENT' ? <span className="text-[11.5px] font-bold text-rose-600 dark:text-rose-400">URGENT</span> : <span className={TEXT_CELL}>{r.line.priority || '—'}</span>),
  },
  { id: 'bags', label: 'Bags', align: 'right', cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{dash(r.line.bags)}</span> },
  { id: 'pcs', label: 'Pcs', align: 'right', cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{dash(r.line.pcs)}</span> },
  { id: 'kgs', label: 'Kgs', align: 'right', cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{dash(r.line.gram)}</span> },
  { id: 'box', label: 'Box', align: 'right', cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{dash(r.line.box)}</span> },
  { id: 'rate', label: 'Rate', align: 'right', cell: (r) => <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">₹{(r.line.rate ?? 0).toLocaleString('en-IN')}</span> },
  { id: 'comment', label: 'Comment', cell: (r) => <span className={cn(TEXT_CELL, 'inline-block max-w-[12rem] truncate align-middle')} title={r.line.comment ?? ''}>{r.line.comment || '—'}</span> },
  {
    id: 'status',
    label: 'Status',
    cell: (r) => {
      const cancelled = r.line.status === 'CANCELLED';
      // The pill shows the ORDER's status; the chip below it shows how far THIS
      // line has shipped. Folded into the existing column rather than added as a
      // new one, so nobody's saved column order gets rearranged.
      return (
        <div className="flex flex-col items-start gap-0.5">
          <StatusPill status={cancelled ? 'CANCELLED' : r.order.status} />
          {!cancelled && <DispatchChip state={r.line.dispatchState} />}
        </div>
      );
    },
  },
];

export function OrderModifyPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { can } = usePermissions();
  // Deliberately NOT persisted (unlike most other list pages): these filters
  // should start fresh every time you arrive here, rather than still be applied
  // from whatever you were last looking for after stepping away to another page.
  const [customer, setCustomer] = useState('');
  const [agent, setAgent] = useState('');
  const [product, setProduct] = useState('');
  const [design, setDesign] = useState('');
  const [priority, setPriority] = useState('');
  const [orderId, setOrderId] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const { page, setPage, pageSize, setPageSize } = usePageSize('order-modify');

  // Priority goes to the server too, so it prunes lines exactly like the other
  // line-level filters instead of being trimmed off after paging.
  const filters = {
    customer: customer || undefined,
    agent: agent || undefined,
    product: product || undefined,
    design: design || undefined,
    priority: priority || undefined,
    orderId: orderId ? Number(orderId) : undefined,
  };
  const { data, isLoading } = useOrders({ page, pageSize, ...filters });
  // Same filters drive the dropdowns, so each one only offers values that would
  // actually return rows next to the others.
  const { data: filterOptions } = useOrderFilterOptions(filters);
  const save = useSaveOrder();
  const { data: settings } = useSettings();
  const orderTypeOptions = useMemo(() => settingValues(settings, 'ORDER_TYPE'), [settings]);
  const cancelReasons = useMemo(() => settingValues(settings, 'QUOTATION_CANCEL_REASON'), [settings]);
  const cols = useColumnOrder('order-modify', COLUMNS);
  const { format, setFormat } = useDateFormat();
  // Order ID picker: value = order id (as string), label = its short code —
  // newest orders first, matching the picker's own default sort.
  const orderIdOptions = useMemo(
    () => (filterOptions?.orders ?? []).map((o) => ({ value: String(o.id), label: shortOrderCode(o.code, o.id) })),
    [filterOptions],
  );

  const [edit, setEdit] = useState<Row | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const onExport = async (columns: string[]) => {
    setExporting(true);
    try {
      await exportOrderLines(filters, columns);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Excel export failed'));
    } finally {
      setExporting(false);
    }
  };
  const hasFilters = !!customer || !!agent || !!product || !!design || !!priority || !!orderId;
  // Product/Agent/Design/Priority move behind the Filter icon on phones — this
  // count feeds its badge and drives the mobile sheet's own Reset button.
  const activeFilterCount = (product ? 1 : 0) + (agent ? 1 : 0) + (design ? 1 : 0) + (priority ? 1 : 0);
  const resetFilters = () => {
    setCustomer('');
    setAgent('');
    setProduct('');
    setDesign('');
    setPriority('');
    setOrderId('');
    setPage(1);
  };

  // Drafts are work-in-progress and orders parked as a quotation aren't orders
  // yet — neither belongs on Order Modify.
  const orders = useMemo(() => (data?.items ?? []).filter((o) => !isUncommittedOrder(o.status)), [data]);
  const totalPages = data?.totalPages ?? 1;

  // Flatten every order's lines into a single list (order info repeats per line).
  // The API now prunes each order's lines to the ones matching the line-level
  // filters, so everything here is already a row the user asked for — no
  // post-flatten filtering. (It used to only narrow the parent ORDER, which is
  // why filtering by one product still listed that order's other products.)
  const rows = useMemo<Row[]>(
    () => orders.flatMap((order) => order.items.map((line) => ({ order, line }))),
    [orders],
  );

  // Phones: group lines by their parent order — one card per order, its lines
  // nested underneath, instead of repeating the order/customer on every line.
  const groupedByOrder = useMemo(() => {
    const order: number[] = [];
    const groups = new Map<number, Row[]>();
    for (const r of rows) {
      if (!groups.has(r.order.id)) {
        groups.set(r.order.id, []);
        order.push(r.order.id);
      }
      groups.get(r.order.id)!.push(r);
    }
    return order.map((id) => {
      const lines = groups.get(id)!;
      return { order: lines[0].order, lines };
    });
  }, [rows]);

  const saveItems = (order: OrderDto, items: OrderItemDto[], okMsg: string) => {
    save.mutate(
      { id: order.id, input: toInput(order, items) },
      { onSuccess: () => toast.success(okMsg), onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')) },
    );
  };

  const deleteLine = async (order: OrderDto, line: OrderItemDto) => {
    const ok = await confirm({
      title: 'Remove this item line?',
      description: `${line.productName || line.product || 'Item'} will be removed from ${order.code ?? `#${order.id}`}.`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    saveItems(order, order.items.filter((i) => i.id !== line.id), 'Item removed');
    setEdit(null);
  };

  const saveLine = (order: OrderDto, updated: OrderItemDto) => {
    saveItems(order, order.items.map((i) => (i.id === updated.id ? updated : i)), 'Item updated');
    setEdit(null);
  };

  // Cancel keeps the line on record (status=CANCELLED) instead of removing it —
  // the backend already relies on this for lines that have dispatches (a hard
  // delete is rejected there), and it's the reversible choice either way.
  const cancelLine = (order: OrderDto, line: OrderItemDto, reason: string, note: string) => {
    if (line.status === 'CANCELLED') return; // already cancelled — nothing to do
    const tag = `Cancelled — ${reason}${note.trim() ? `: ${note.trim()}` : ''}`;
    const updated: OrderItemDto = { ...line, status: 'CANCELLED', comment: [line.comment, tag].filter(Boolean).join(' | ') };
    saveItems(order, order.items.map((i) => (i.id === line.id ? updated : i)), 'Item cancelled');
    setEdit(null);
  };

  const restoreLine = async (order: OrderDto, line: OrderItemDto) => {
    const ok = await confirm({
      title: 'Restore this item?',
      description: `${line.productName || line.product || 'Item'} will be active again on ${order.code ?? `#${order.id}`} and count toward its totals.`,
      confirmText: 'Restore',
    });
    if (!ok) return;
    const updated: OrderItemDto = { ...line, status: 'CONFIRMED' };
    saveItems(order, order.items.map((i) => (i.id === line.id ? updated : i)), 'Item restored');
    setEdit(null);
  };

  // A dispatched line's quantity/rate/product details are frozen (the backend
  // rejects that edit outright) — this appends the edited details as a brand
  // new line instead, leaving the original dispatched line untouched.
  const addLineAsNew = (order: OrderDto, newItem: OrderItemDto) => {
    saveItems(order, [...order.items, { ...newItem, id: 0 }], 'Added as a new item');
    setEdit(null);
  };

  return (
    // Fills the viewport: toolbar pinned on top, footer pinned at the bottom, only
    // the line list scrolls. `/orders/modify` is a flush route (app-shell), so the
    // page owns its own padding.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      {/* ── Toolbar: search + filters, then column settings — one card. */}
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          {/* Filter order follows the house pattern: Order ID, Customer, Item Name, Agent, Design. */}
          <div className="w-full sm:w-36">
            <NativeSelect
              value={orderId}
              onChange={(v) => { setOrderId(v); setPage(1); }}
              options={['', ...orderIdOptions]}
              placeholder="All order IDs"
              className={cn(CONTROL, 'font-medium tabular-nums', orderId && CONTROL_ON)}
            />
          </div>
          <div className="w-full sm:w-56">
            <NativeSelect
              value={customer}
              onChange={(v) => { setCustomer(v); setPage(1); }}
              options={['', ...(filterOptions?.customers ?? [])]}
              placeholder="All customers"
              className={cn(CONTROL, 'font-medium', customer && CONTROL_ON)}
            />
          </div>
          {/* Phones: Product / Agent / Design / Priority move behind this icon
              (see the sheet below) — they don't fit the toolbar at phone widths. */}
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
          <div className="hidden w-40 lg:block">
            <NativeSelect
              value={product}
              onChange={(v) => { setProduct(v); setPage(1); }}
              options={['', ...(filterOptions?.products ?? [])]}
              placeholder="All products"
              className={cn(CONTROL, 'font-medium', product && CONTROL_ON)}
            />
          </div>
          <div className="hidden w-36 lg:block">
            <NativeSelect
              value={agent}
              onChange={(v) => { setAgent(v); setPage(1); }}
              options={['', ...(filterOptions?.agents ?? [])]}
              placeholder="All agents"
              className={cn(CONTROL, 'font-medium', agent && CONTROL_ON)}
            />
          </div>
          <div className="hidden w-36 lg:block">
            <NativeSelect
              value={design}
              onChange={(v) => { setDesign(v); setPage(1); }}
              options={['', ...(filterOptions?.designs ?? [])]}
              placeholder="All designs"
              className={cn(CONTROL, 'font-medium', design && CONTROL_ON)}
            />
          </div>
          <div className="hidden w-32 lg:block">
            <NativeSelect
              value={priority}
              onChange={(v) => { setPriority(v); setPage(1); }}
              options={['', ...ORDER_PRIORITIES]}
              placeholder="All priorities"
              className={cn(CONTROL, 'font-medium', priority && CONTROL_ON)}
            />
          </div>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="hidden h-9 shrink-0 rounded-[4px] text-[12.5px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900 lg:inline-flex dark:text-amber-300 dark:hover:bg-amber-400/10"
              onClick={resetFilters}
              title="Clear all filters"
            >
              <RotateCcw className="size-3.5" /> Reset
            </Button>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {can('order:export') && <ExportButton onClick={() => setExportDialogOpen(true)} disabled={exporting} label="Export order lines to Excel" />}
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

      {/* Phones only: Product / Agent / Design / Priority live behind the Filter icon above. */}
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
                onChange={(v) => { setProduct(v); setPage(1); }}
                options={['', ...(filterOptions?.products ?? [])]}
                placeholder="All products"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Agent</Label>
              <NativeSelect
                value={agent}
                onChange={(v) => { setAgent(v); setPage(1); }}
                options={['', ...(filterOptions?.agents ?? [])]}
                placeholder="All agents"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Design</Label>
              <NativeSelect
                value={design}
                onChange={(v) => { setDesign(v); setPage(1); }}
                options={['', ...(filterOptions?.designs ?? [])]}
                placeholder="All designs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Priority</Label>
              <NativeSelect
                value={priority}
                onChange={(v) => { setPriority(v); setPage(1); }}
                options={['', ...ORDER_PRIORITIES]}
                placeholder="All priorities"
              />
            </div>
          </div>
          <SheetFooter>
            <Button className="w-full font-bold" onClick={() => setMobileFiltersOpen(false)}>
              Show {(data?.total ?? 0).toLocaleString('en-IN')} lines
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* The table/card list takes the leftover height and scrolls WITHIN itself
          (both directions on desktop), so the horizontal scrollbar sits right
          under the visible rows instead of being pushed to the bottom of a long
          table that only the page's own scroll could ever reach. */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          '[&_[data-slot=table-container]]:overscroll-x-contain',
          '[&_[data-slot=table-container]]:[scrollbar-width:thin]',
          '[&_[data-slot=table-container]]:[scrollbar-color:var(--color-slate-400)_var(--color-slate-100)]',
        )}
      >
        <div className="hidden min-h-0 flex-1 sm:flex sm:flex-col">
          <DataTable
            columns={cols.visibleColumns}
            rows={rows}
            rowKey={(r) => `${r.order.id}-${r.line.id}`}
            isLoading={isLoading}
            dense
            // Bounded to the space actually left on screen — its own scroll
            // region (vertical + horizontal) stays fully visible on first
            // paint, no scrolling the whole page down to reach it.
            fill
            hideSortIcon
            emptyText="No order lines found."
            onRowClick={(r) => setEdit(r)}
            className={[
              'font-sans text-[13px]',
              // Rows are click-to-edit, so block accidental text selection (a
              // stray drag while scrolling otherwise highlights the row's text).
              '[&_tbody]:select-none',
              '[&_thead_th]:text-[13.5px] [&_thead_th]:font-extrabold [&_thead_th]:uppercase [&_thead_th]:tracking-wide [&_thead_th]:py-1.5',
              '[&_thead_th_button]:cursor-pointer',
              '[&_thead_th:hover]:from-blue-900 [&_thead_th:hover]:to-indigo-900',
              '[&_td]:py-1 [&_td]:px-3 [&_th]:px-3',
              '[&_tbody_button:not([role=switch]):not([role=checkbox])]:size-7',
              '[&_tbody_tr]:border-b [&_tbody_tr]:border-slate-200 dark:[&_tbody_tr]:border-white/10',
              '[&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0',
              '[&_tbody_tr:nth-child(even)_td]:bg-slate-100/80 dark:[&_tbody_tr:nth-child(even)_td]:bg-white/[0.04]',
              '[&_tbody_tr:hover:hover_td]:bg-amber-100/70 dark:[&_tbody_tr:hover:hover_td]:bg-amber-400/10',
            ].join(' ')}
          />
        </div>

        {/* Phones: one card per order, its lines grouped underneath. Own scroll
            region now that the outer wrapper doesn't scroll (that's the desktop
            table's job via `fill` above). */}
        <div className="min-h-0 flex-1 overflow-y-auto sm:hidden">
          {isLoading ? (
            <div className="text-muted-foreground flex h-24 items-center justify-center">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : groupedByOrder.length === 0 ? (
            <div className="text-muted-foreground rounded-[4px] border px-4 py-10 text-center text-sm">No order lines found.</div>
          ) : (
            <div className="space-y-2.5">
              {groupedByOrder.map(({ order: o, lines }) => (
                <div key={o.id} className="bg-card overflow-hidden rounded-[4px] border shadow-sm">
                  <div className="bg-muted/40 border-b px-3 py-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{shortOrderCode(o.code, o.id)}</p>
                        <p className="text-[14px] font-bold break-words text-slate-900 dark:text-slate-100">{o.customerName}</p>
                      </div>
                      <StatusPill status={o.status} />
                    </div>
                    {/* Labelled rather than "date → date": on a phone there's no
                        column header above it to say which is which. */}
                    <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-medium">
                      <span>
                        Ordered <span className="text-foreground font-semibold tabular-nums">{formatDate(o.orderDate)}</span>
                      </span>
                      <span>
                        Due <span className="text-foreground font-semibold tabular-nums">{formatDate(o.completionDate)}</span>
                      </span>
                      {o.agentName && <span>Agent <span className="text-foreground font-semibold">{o.agentName}</span></span>}
                      <span>
                        {lines.length} line{lines.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-white/10">
                    {lines.map((r) => {
                      const cancelled = r.line.status === 'CANCELLED';
                      return (
                        <div
                          key={r.line.id}
                          role="button"
                          tabIndex={0}
                          className="active:bg-muted cursor-pointer px-3 py-2"
                          onClick={() => setEdit(r)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setEdit(r);
                            }
                          }}
                        >
                          {/* Nothing here truncates. A phone card is the ONLY view of
                              this line on mobile — there is no column to widen and no
                              hover title to fall back on — so a clipped product name or
                              comment is information the user simply cannot reach. Long
                              values wrap instead. */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className={cn('text-[13px] font-bold break-words', cancelled ? 'text-muted-foreground line-through' : 'text-slate-800 dark:text-slate-200')}>
                                {r.line.productName || r.line.product || '—'}
                              </p>
                              <p className="text-muted-foreground text-[11px] font-medium break-words">
                                Design <span className="text-foreground font-semibold">{r.line.designType || '—'}</span>
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">₹{(r.line.rate ?? 0).toLocaleString('en-IN')}</span>
                              {/* The row was already tappable, but nothing said so — on a
                                  phone there's no hover to discover it with. */}
                              <Pencil className="text-muted-foreground size-3.5" aria-hidden />
                            </div>
                          </div>
                          {/* Every badge the desktop Status column carries: the line's own
                              CANCELLED state, how far it has shipped, and its priority —
                              including NORMAL, which the phone used to leave blank so a
                              normal line looked like one with no priority set at all. */}
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {cancelled && <StatusPill status="CANCELLED" />}
                            {!cancelled && <DispatchChip state={r.line.dispatchState} showPending />}
                            {r.line.priority === 'URGENT' ? (
                              <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-inset ring-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-400/25">
                                URGENT
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-[10px] font-semibold">{r.line.priority || 'NORMAL'}</span>
                            )}
                            {r.line.ordType && <span className="text-muted-foreground text-[10px] font-semibold">{r.line.ordType}</span>}
                          </div>
                          <div className="mt-1 grid grid-cols-4 gap-1.5 text-[11px]">
                            {([['Bags', r.line.bags], ['Pcs', r.line.pcs], ['Kgs', r.line.gram], ['Box', r.line.box]] as const).map(([lbl, v]) => (
                              <div key={lbl}>
                                <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">{lbl}</p>
                                <p className="font-bold tabular-nums text-slate-700 dark:text-slate-200">{dash(v)}</p>
                              </div>
                            ))}
                          </div>
                          {r.line.comment && (
                            <p className="text-muted-foreground mt-1 text-[11px] break-words">
                              <span className="text-[9px] font-bold uppercase tracking-widest">Comment </span>
                              {r.line.comment}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer: line/order counts + paging ─────────────────────────────────── */}
      <div className="bg-card flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[4px] border px-3 py-2 shadow-sm">
        <p className="text-muted-foreground text-[12px] font-medium">
          <span className="font-bold tabular-nums text-foreground">{rows.length}</span> line(s) across{' '}
          <span className="font-bold tabular-nums text-foreground">{new Set(rows.map((r) => r.order.id)).size}</span> order(s)
        </p>
        <div className="ml-auto flex items-center gap-3">
          <p className="text-muted-foreground text-[12px] font-medium">
            Page <span className="font-bold tabular-nums text-foreground">{data?.page ?? page}</span> of{' '}
            <span className="font-bold tabular-nums text-foreground">{totalPages}</span>
          </p>
          <PageSizeSelect value={pageSize} onChange={setPageSize} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft /> Prev
            </Button>
            <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      </div>

      <Sheet open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        {edit && (
          <LineEditor
            row={edit}
            orderTypes={orderTypeOptions}
            cancelReasons={cancelReasons}
            saving={save.isPending}
            onSave={(updated) => saveLine(edit.order, updated)}
            onAddAsNew={(newItem) => addLineAsNew(edit.order, newItem)}
            onDelete={() => deleteLine(edit.order, edit.line)}
            onCancelItem={(reason, note) => cancelLine(edit.order, edit.line, reason, note)}
            onRestoreItem={() => restoreLine(edit.order, edit.line)}
            onViewFull={() => navigate(`/orders/${edit.order.id}/edit`)}
            onClose={() => setEdit(null)}
          />
        )}
      </Sheet>

      <ExportColumnsDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        columns={EXPORT_COLUMN_OPTIONS}
        storageKey="oms:order-modify-export-columns:v1"
        onExport={onExport}
        exporting={exporting}
        title="Choose columns to export"
        description="Pick which columns go into the order-lines Excel file — matches your current filters."
      />
    </div>
  );
}

/** Right slide-over form to edit a single order line. */
function LineEditor({
  row,
  orderTypes,
  cancelReasons,
  saving,
  onSave,
  onAddAsNew,
  onDelete,
  onCancelItem,
  onRestoreItem,
  onViewFull,
  onClose,
}: {
  row: Row;
  orderTypes: string[];
  cancelReasons: string[];
  saving: boolean;
  onSave: (updated: OrderItemDto) => void;
  /** Dispatched-line detour: append the edited details as a brand new line
   *  instead of touching the original (which the backend won't allow anyway). */
  onAddAsNew: (newItem: OrderItemDto) => void;
  onDelete: () => void;
  /** Soft-cancel: keeps the line on record instead of removing it. Required for
   *  a line with dispatches — the backend rejects a hard delete there. */
  onCancelItem: (reason: string, note: string) => void;
  onRestoreItem: () => void;
  onViewFull: () => void;
  onClose: () => void;
}) {
  const { order, line } = row;
  const { can } = usePermissions();
  const confirm = useConfirm();
  const priceAsOf = usePriceAsOf();
  // Blocks Save while onItemPick's rate check is in flight, so a fast
  // double-click can't submit before the confirm dialog even has a chance to appear.
  const [checkingRate, setCheckingRate] = useState(false);
  // The "this changes the line's rate" question. It has three answers, so it
  // can't be the app's yes/no confirm — see RateChoiceDialog below.
  const [rateAsk, setRateAsk] = useState<(RateAskProps & { resolve: (c: RateChoice) => void }) | null>(null);
  const askRate = (props: RateAskProps) =>
    new Promise<RateChoice>((resolve) => setRateAsk({ ...props, resolve }));
  const { data: lookups } = useOrderLookups();
  const { data: special } = useCustomerSpecialRates(order.customerId ?? undefined);
  const { data: qtyLayout } = useOrderQtyLayout();
  const { autoSizePcs } = useAutoSizePcs();
  const [showBy, setShowBy] = useState<'PCS' | 'SIZE'>('SIZE');
  const isCancelled = line.status === 'CANCELLED';
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNote, setCancelNote] = useState('');
  const submitCancel = () => {
    if (!cancelReason.trim()) return toast.error('Please choose a reason.');
    onCancelItem(cancelReason.trim(), cancelNote);
    setCancelOpen(false);
  };
  // Once the user has confirmed "add as a new item" (see submit()), the form
  // keeps whatever they typed but Save now creates a fresh line instead of
  // touching the dispatched original — it does NOT auto-submit on its own.
  const [addNewMode, setAddNewMode] = useState(false);
  const s = (v: number | null) => (v == null ? '' : String(v));
  const [form, setForm] = useState({
    itemName: line.productName ?? [line.product, line.designType].filter(Boolean).join(' '),
    pCategory: line.pCategory ?? '',
    subCategory: line.subCategory ?? '',
    product: line.product ?? '',
    designType: line.designType ?? '',
    designName: line.design?.trim() || '',
    psize: s(line.psize),
    ordType: line.ordType ?? '',
    priority: line.priority ?? 'NORMAL',
    bags: s(line.bags),
    pcs: s(line.pcs),
    gram: s(line.gram),
    box: s(line.box),
    productRate: s(line.productRate),
    designRate: s(line.designRate),
    comment: line.comment ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const rate = (num(form.productRate) ?? 0) + (num(form.designRate) ?? 0);
  // Bags/Pcs/Kgs/Box order follows the item's product category, per Settings →
  // Order quantity fields — same layout as the New Order form. Re-picking a
  // different item updates form.pCategory, so this re-sequences live too.
  const qtyFields = useMemo(() => qtyOrderForCategory(qtyLayout, form.pCategory).map((f) => QTY_FIELD_INFO[f]), [qtyLayout, form.pCategory]);

  // Snapshot of the untouched form — Save stays disabled until something differs.
  const baseline = useRef(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline.current);
  // Quantity/rate/product fields — the exact set the backend freezes once a line
  // has been dispatched (status/priority/order-type/comment stay editable there).
  const MATERIAL_KEYS = ['itemName', 'pCategory', 'subCategory', 'product', 'designType', 'psize', 'bags', 'pcs', 'gram', 'box', 'productRate', 'designRate'] as const;
  const materialDirty = MATERIAL_KEYS.some((k) => form[k] !== baseline.current[k]);

  // Match New Order: show one item-name form at a time, using either the
  // catalogue size or pieces-per-box as the visible prefix.
  const itemOptions = useMemo(() => {
    const list = lookups?.items ?? [];
    const logos = special?.logos ?? [];
    const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
    const logoBlocked = (category: string, subCategory: string) =>
      logos.some(
        (l) =>
          (l.scope === 'CATEGORY' && norm(l.category) === norm(category)) ||
          (l.scope === 'SUBCATEGORY' && norm(l.category) === norm(category) && norm(l.subCategory) === norm(subCategory)),
      );
    const map = new Map<string, (typeof list)[number]>();
    const options: { value: string; label: string; keywords: string }[] = [];
    for (const it of list) {
      if (isLogoDesign(it.designType) && logoBlocked(it.category, it.subCategory)) continue;
      const prefix = showBy === 'PCS' ? fmtNum(it.pcs) : fmtNum(it.size);
      const label = [prefix, it.product, it.designType ?? ''].filter(Boolean).join(' ');
      if (!label || map.has(label)) continue;
      map.set(label, it);
      const keywords = [fmtNum(it.size), fmtNum(it.pcs), it.subCategory ?? ''].filter(Boolean).join(' ');
      options.push({ value: label, label, keywords });
    }
    return { options, map };
  }, [lookups, showBy, special]);

  // Open an existing Pcs-labelled line in the matching mode when the catalogue
  // makes that distinction unambiguous.
  const initialShowBySet = useRef(false);
  useEffect(() => {
    if (!lookups || initialShowBySet.current) return;
    initialShowBySet.current = true;
    const lead = form.itemName.trim().match(/^(\d+(?:\.\d+)?)/)?.[1];
    if (!lead) return;
    const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
    const matchingItems = lookups.items.filter(
      (it) => norm(it.product) === norm(form.product) && norm(it.designType) === norm(form.designType),
    );
    const sizeExact = matchingItems.some((it) => fmtNum(it.size) === lead);
    const pcsExact = matchingItems.some((it) => fmtNum(it.pcs) === lead);
    if (pcsExact && !sizeExact) setShowBy('PCS');
  }, [lookups, form.itemName, form.product, form.designType]);

  // Use the same product-aware Size/Pcs auto-detection as New Order.
  const detectShowBy = (text: string) => {
    if (!autoSizePcs) return;
    const t = text.trim();
    const lead = t.match(/^(\d+(?:\.\d+)?)/)?.[1];
    if (!lead) return;
    const separator = /[\s(),+/-]+/;
    const list = lookups?.items ?? [];
    const nameTerms = t.slice(lead.length).trim().toLowerCase().split(separator).filter(Boolean);
    const named = nameTerms.length
      ? list.filter((it) => {
          const words = `${it.product} ${it.designType ?? ''}`.toLowerCase().split(separator).filter(Boolean);
          return nameTerms.every((term) => words.some((word) => word.startsWith(term)));
        })
      : list;
    const pool = named.length ? named : list;
    const some = (key: 'size' | 'pcs', test: (value: string) => boolean) =>
      pool.some((it) => it[key] != null && test(String(it[key])));
    const sizeExact = some('size', (value) => value === lead);
    const pcsExact = some('pcs', (value) => value === lead);
    if (pcsExact && !sizeExact) return setShowBy('PCS');
    if (sizeExact && !pcsExact) return setShowBy('SIZE');
    if (sizeExact || pcsExact) return setShowBy('SIZE');
    const sizePrefix = some('size', (value) => value.startsWith(lead));
    const pcsPrefix = some('pcs', (value) => value.startsWith(lead));
    if (pcsPrefix && !sizePrefix) return setShowBy('PCS');
    if (sizePrefix) setShowBy('SIZE');
  };

  const designNameOptions = useMemo(
    () => resolveDesignNameChoices(lookups, form.designType, form.pCategory, form.subCategory),
    [lookups, form.designType, form.pCategory, form.subCategory],
  );
  const noDesignNames = designNameOptions.choices.length === 0;

  // Seed the design-name label from the line's design type once lookups arrive.
  useEffect(() => {
    if (!lookups || form.designName || !form.designType) return;
    const code = form.designType.toUpperCase();
    const dn = lookups.designNames.find((d) => d.designType.toUpperCase() === code);
    if (dn) {
      set({ designName: dn.designName });
      baseline.current = { ...baseline.current, designName: dn.designName };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookups]);

  // Picking an item fills product, design type, design name and both rates.
  //
  // Swapping the item to a genuinely different one (e.g. "5 RAMPATRA
  // HANDLE+LASER+LOGO" → "5 RAMPATRA LASER+LOGO" — same product, fewer design
  // parts) normally re-prices the line on the spot. That is the whole
  // "it changed my rate without telling me" complaint, so whenever the rate
  // that WOULD be applied differs from the rate already on the line, it asks
  // first and lets the user keep the existing one.
  //
  // The rate offered is the new item's price AS OF THE ORDER'S DATE, not
  // today's — this order was placed on that date, so that's its correct basis.
  // (Today's chart rate is only used as a fallback when the order-date rate
  // can't be resolved.)
  const onItemPick = async (label: string) => {
    const it = itemOptions.map.get(label);
    if (!it) {
      set({ itemName: label, product: label });
      return;
    }
    const realName = it.designName && it.designName !== it.designType ? it.designName : '';
    const resolved = special
      ? resolveSpecialRates(special, {
          category: it.category,
          subCategory: it.subCategory,
          product: it.product,
          designType: it.designType ?? null,
        })
      : null;
    const currentProductRate = (it.productRate ?? 0) + (resolved?.productDelta ?? 0);
    const currentDesignRate = (it.designRate ?? 0) + (resolved?.designDelta ?? 0);
    const hasProductRate = it.productRate != null || (resolved?.productDelta ?? 0) !== 0;
    const hasDesignRate = !!it.designType && (it.designRate != null || (resolved?.designDelta ?? 0) !== 0);

    // Default: today's catalogue rate, exactly as before.
    let finalProductRate: number | null = hasProductRate ? currentProductRate : null;
    let finalDesignRate: number | null = hasDesignRate ? currentDesignRate : null;

    const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
    // Compared against the CURRENT form values, not the original line: picking
    // A → B → C should ask on each real change, not just when it differs from A.
    const itemChanged = norm(it.product) !== norm(form.product) || norm(it.designType) !== norm(form.designType);
    // The rate already sitting on this line — what "keep the old rate" means.
    const existingRate = (num(form.productRate) ?? 0) + (num(form.designRate) ?? 0);

    // The identity change lands FIRST, before anything is asked. It is not in
    // question — the user picked this item — and tying it to the rate answer is
    // what made a dismissed dialog lose the new name as well. It also stops the
    // combobox reverting its text to the old name (its blur handler does that
    // when the value hasn't changed yet) while the dialog is still on screen,
    // which read as "it ignored my pick".
    set({
      itemName: label,
      pCategory: it.category,
      subCategory: it.subCategory,
      product: it.product,
      designType: it.designType ?? '',
      designName: realName,
      psize: it.size != null ? String(it.size) : '',
    });

    // Nothing to protect if the line had no rate yet — just fill it in.
    if (itemChanged && existingRate > 0) {
      setCheckingRate(true);
      try {
        if (order.orderDate) {
          const asOf = await priceAsOf.mutateAsync({
            customerId: order.customerId ?? undefined,
            asOfDate: order.orderDate,
            pCategory: it.category,
            subCategory: it.subCategory,
            product: it.product,
            designType: it.designType ?? undefined,
            psize: it.size ?? undefined,
          });
          // Only trust the historical lookup when it actually resolved the item
          // (it returns zeros for anything it can't match) — otherwise today's
          // catalogue rate above stays the offer.
          if (asOf.rate > 0) {
            finalProductRate = hasProductRate ? round2(asOf.productRate + asOf.productDelta) : null;
            finalDesignRate = hasDesignRate ? round2(asOf.designRate + asOf.designDelta) : null;
          }
        }
        const newRate = (finalProductRate ?? 0) + (finalDesignRate ?? 0);
        if (Math.abs(newRate - existingRate) > 0.001) {
          const choice = await askRate({
            label,
            asOf: order.orderDate ?? null,
            newProductRate: finalProductRate,
            newDesignRate: finalDesignRate,
            oldProductRate: num(form.productRate),
            oldDesignRate: num(form.designRate),
            hasDesignRate,
          });
          if (choice.kind === 'keep') {
            // Keep exactly what was on the line — the item identity still changed.
            finalProductRate = num(form.productRate);
            finalDesignRate = num(form.designRate);
          } else if (choice.kind === 'custom') {
            finalProductRate = choice.productRate;
            finalDesignRate = choice.designRate;
          }
        }
      } catch {
        // A failed rate check shouldn't block picking the item — fall back to
        // silently applying the current rate, same as before this feature existed.
      } finally {
        setCheckingRate(false);
      }
    }

    // Only the rate is left to apply — the identity went in before the question.
    set({
      productRate: finalProductRate != null ? String(finalProductRate) : '',
      designRate: finalDesignRate != null ? String(finalDesignRate) : '',
    });
  };

  const onlyNum = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length > 1) return;
    if (/[0-9]/.test(e.key)) return;
    if (e.key === '.' && !e.currentTarget.value.includes('.')) return;
    e.preventDefault();
  };

  const buildUpdated = (): OrderItemDto => ({
    ...line,
    pCategory: form.pCategory.trim() || null,
    subCategory: form.subCategory.trim() || null,
    product: form.product.trim() || null,
    designType: form.designType.trim() || null,
    design: noDesignNames ? 'NA' : form.designName.trim() || null,
    productName: form.itemName.trim() || [form.product.trim(), form.designType.trim()].filter(Boolean).join(' ') || null,
    psize: num(form.psize),
    ordType: form.ordType || null,
    priority: form.priority || null,
    bags: num(form.bags),
    pcs: num(form.pcs),
    gram: num(form.gram),
    box: num(form.box),
    productRate: num(form.productRate),
    designRate: num(form.designRate),
    rate,
    comment: form.comment.trim() || null,
  });

  const submit = async () => {
    // Already agreed to add-as-new — just do it (this click never auto-fires on
    // its own; the confirm below only pre-fills and waits for this explicit click).
    if (addNewMode) return onAddAsNew(buildUpdated());

    // A dispatched line's quantity/rate/product details are frozen server-side —
    // don't even attempt the save; offer to add the edit as a new line instead.
    if (line.dispatched && materialDirty) {
      const ok = await confirm({
        title: 'This item has already been dispatched',
        description:
          'Its quantity, rate and product details can\'t be changed directly — the dispatch already reflects what was shipped. Add these changes as a NEW item with the same details instead? The original dispatched line stays untouched.',
        confirmText: 'Add as new item',
        cancelText: 'Cancel',
      });
      if (ok) setAddNewMode(true); // fills in below — waits for an explicit Save/Add click
      return;
    }

    onSave(buildUpdated());
  };

  useSaveShortcut(submit);

  return (
    <SheetContent className="flex w-full max-w-md flex-col" onOpenAutoFocus={(e) => e.preventDefault()}>
      <SheetHeader>
        <SheetTitle>{addNewMode ? 'Add as a new item' : 'Edit item line'}</SheetTitle>
        <p className="text-muted-foreground truncate text-sm">
          {order.code ?? `#${order.id}`} · {order.customerName}
        </p>
      </SheetHeader>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {isCancelled && (
          <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-400/25 dark:bg-rose-500/10 dark:text-rose-300">
            <Ban className="size-4 shrink-0" />
            This item is cancelled — it's kept on record but excluded from the order's totals.
          </div>
        )}
        {addNewMode && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            The original dispatched line stays untouched — review the details below and click{' '}
            <span className="font-semibold">Add as New Item</span> to save this as a separate line.
          </div>
        )}
        {!autoSizePcs && (
          <Field label="Show item by">
            <div className="flex h-9 items-center gap-5 text-sm">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" className="accent-indigo-600" checked={showBy === 'SIZE'} onChange={() => setShowBy('SIZE')} /> Size
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" className="accent-indigo-600" checked={showBy === 'PCS'} onChange={() => setShowBy('PCS')} /> Pcs
              </label>
            </div>
          </Field>
        )}
        <Field label="Item name">
          {/* Same composite "{size|pcs} {product} {design}" list as the new-order
              form, so it gets the same digits-first keyboard and auto-space. */}
          <NativeSelect
            value={form.itemName}
            onChange={onItemPick}
            onType={detectShowBy}
            options={itemOptions.options}
            placeholder="Item name"
            className="text-left"
            onInvalidEntry={() => toast.error('Please select a correct item')}
            digitsFirst
          />
        </Field>
        <Field label="Design Name">
          <DesignNamePicker
            value={noDesignNames ? 'NA' : form.designName}
            onChange={(v) => set({ designName: v })}
            choices={designNameOptions.choices}
            multiple={designNameOptions.multiple}
            disabled={noDesignNames}
            onInvalidEntry={() => toast.error('Please select a correct design name')}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Order type">
            <NativeSelect value={form.ordType} onChange={(v) => set({ ordType: v })} options={orderTypes} placeholder="Type…" />
          </Field>
          <Field label="Priority">
            <NativeSelect value={form.priority} onChange={(v) => set({ priority: v })} options={[...ORDER_PRIORITIES]} />
          </Field>
          {qtyFields.map(({ key: k, label }) => (
            <Field key={k} label={label}>
              <Input type="number" step="any" value={form[k]} onKeyDown={onlyNum} onChange={(e) => set({ [k]: e.target.value } as Partial<typeof form>)} />
            </Field>
          ))}
          <Field label="Prod ₹">
            <Input type="number" step="any" value={form.productRate} onKeyDown={onlyNum} onChange={(e) => set({ productRate: e.target.value })} />
          </Field>
          <Field label="Dsgn ₹">
            <Input type="number" step="any" value={form.designRate} onKeyDown={onlyNum} onChange={(e) => set({ designRate: e.target.value })} />
          </Field>
        </div>
        <Field label="Rate ₹">
          <div className="flex h-9 items-center justify-end rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-bold tabular-nums text-emerald-700">
            {rate.toLocaleString('en-IN')}
          </div>
        </Field>
        <Field label="Comment">
          <Input value={form.comment} onChange={(e) => set({ comment: e.target.value })} placeholder="Item remark…" />
        </Field>

        {/* Line photos — attach/detach immediately (independent of Save). */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <LiveLinePhotos orderItemId={line.id} canEdit={can('order:update')} title="Line photos" />
        </div>

        <button type="button" onClick={onViewFull} className="text-primary flex items-center gap-1.5 pt-1 text-sm font-medium hover:underline">
          <ExternalLink className="size-3.5" /> Open full order
        </button>
      </div>

      <SheetFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {isCancelled ? (
            <Button variant="outline" onClick={onRestoreItem} disabled={saving || addNewMode}>
              <Undo2 /> Restore item
            </Button>
          ) : (
            <Button
              variant="outline"
              className="text-rose-700 hover:text-rose-800 dark:text-rose-300"
              onClick={() => setCancelOpen(true)}
              disabled={saving || addNewMode}
              title="Marks the item CANCELLED — kept on record and reversible, unlike Delete"
            >
              <Ban /> Cancel item
            </Button>
          )}
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={saving || addNewMode || !!line.dispatched}
            title={line.dispatched ? 'Already dispatched — use Cancel item instead, which keeps the dispatch record intact' : 'Permanently remove this line'}
          >
            <Trash2 /> Delete
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={addNewMode ? () => setAddNewMode(false) : onClose} disabled={saving}>
            {addNewMode ? 'Back to editing' : 'Close'}
          </Button>
          <Button onClick={submit} disabled={saving || checkingRate || (!addNewMode && !dirty)}>
            {saving || checkingRate ? <Loader2 className="animate-spin" /> : <Save />} {checkingRate ? 'Checking rate…' : addNewMode ? 'Add as New Item' : 'Save'}
          </Button>
        </div>
      </SheetFooter>

      {rateAsk && (
        <RateChoiceDialog
          {...rateAsk}
          onDone={(choice) => {
            rateAsk.resolve(choice);
            setRateAsk(null);
          }}
        />
      )}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel this item?</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <p className="text-muted-foreground text-sm">
              “{line.productName || line.product || 'This item'}” will be marked CANCELLED on {order.code ?? `#${order.id}`}. It
              stays on record and excludes from the order's totals, but can no longer be dispatched — restore it any time to
              undo.
            </p>
            <CancelReasonFields reasons={cancelReasons} reason={cancelReason} note={cancelNote} onReason={setCancelReason} onNote={setCancelNote} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>Keep item</Button>
            <Button type="button" variant="destructive" onClick={submitCancel} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Ban />} Cancel item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SheetContent>
  );
}

/* ── "This changes the line's rate" ─────────────────────────────────────────── */

interface RateAskProps {
  /** The item just picked, as shown in the Item name field. */
  label: string;
  /** The order's date — the basis the new rate was priced on. */
  asOf: string | null;
  newProductRate: number | null;
  newDesignRate: number | null;
  oldProductRate: number | null;
  oldDesignRate: number | null;
  /** False for items with no design, so the design row is hidden entirely. */
  hasDesignRate: boolean;
}

type RateChoice =
  | { kind: 'new' }
  | { kind: 'keep' }
  | { kind: 'custom'; productRate: number | null; designRate: number | null };

const inr = (v: number) => `₹${v.toLocaleString('en-IN')}`;

/**
 * Three answers, not two — so this can't be the app's yes/no `confirm()`.
 *
 * "Custom" asks for the product and design parts separately rather than one
 * total, because that is how a line actually stores its rate. Taking a single
 * figure would mean inventing a split, and a rate the user didn't choose
 * appearing on the line is the exact complaint this whole dialog exists to
 * answer — so it asks for what it needs instead of guessing.
 *
 * Dismissing without answering (Escape, clicking away, the X) means KEEP: the
 * line is left as it was priced, which is the choice that changes nothing.
 */
function RateChoiceDialog({
  label,
  asOf,
  newProductRate,
  newDesignRate,
  oldProductRate,
  oldDesignRate,
  hasDesignRate,
  onDone,
}: RateAskProps & { onDone: (choice: RateChoice) => void }) {
  const newRate = (newProductRate ?? 0) + (newDesignRate ?? 0);
  const oldRate = (oldProductRate ?? 0) + (oldDesignRate ?? 0);
  const [custom, setCustom] = useState(false);
  // Seeded from the new rate — the most likely starting point for a tweak.
  const [cProd, setCProd] = useState(newProductRate != null ? String(newProductRate) : '');
  const [cDsgn, setCDsgn] = useState(newDesignRate != null ? String(newDesignRate) : '');
  const customTotal = (num(cProd) ?? 0) + (num(cDsgn) ?? 0);
  const customValid = customTotal > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onDone({ kind: 'keep' })}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>This changes the line’s rate</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">{label}</span> prices at{' '}
          <span className="text-foreground font-semibold">{inr(newRate)}</span>
          {asOf ? ` as of ${formatDate(asOf)}` : ''}, but this line is currently{' '}
          <span className="text-foreground font-semibold">{inr(oldRate)}</span>.
        </p>

        {custom ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Product ₹">
                <Input value={cProd} onChange={(e) => setCProd(e.target.value)} inputMode="decimal" autoFocus />
              </Field>
              {hasDesignRate && (
                <Field label="Design ₹">
                  <Input value={cDsgn} onChange={(e) => setCDsgn(e.target.value)} inputMode="decimal" />
                </Field>
              )}
            </div>
            <p className="text-sm">
              Line rate: <span className="font-semibold tabular-nums">{inr(round2(customTotal))}</span>
            </p>
          </div>
        ) : null}

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
          {custom ? (
            <>
              <Button variant="outline" onClick={() => setCustom(false)}>
                Back
              </Button>
              <Button
                disabled={!customValid}
                title={customValid ? undefined : 'Enter a rate above zero'}
                onClick={() => onDone({ kind: 'custom', productRate: num(cProd), designRate: hasDesignRate ? num(cDsgn) : null })}
              >
                Use {inr(round2(customTotal))}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onDone({ kind: 'keep' })}>
                Keep {inr(oldRate)}
              </Button>
              <Button variant="outline" onClick={() => setCustom(true)}>
                Custom rate…
              </Button>
              <Button onClick={() => onDone({ kind: 'new' })}>Use {inr(newRate)}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export default OrderModifyPage;
