import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Ban, ChevronLeft, ChevronRight, ExternalLink, Filter, Loader2, Pencil, RotateCcw, Save, Trash2, Truck, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import type { OrderDto, OrderInput, OrderItemDto, QtyField } from '@oms/shared';
import { isUncommittedOrder, ORDER_LINE_EXPORT_COLUMNS, ORDER_PRIORITIES, qtyOrderForCategory, resolveLineDesignParts, resolveSpecialRates } from '@oms/shared';
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
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { settingValues, useOrderQtyLayout, useSettings } from '@/features/settings/use-settings';
import { useCustomerSpecialRates } from '@/features/special-rates/use-special-rates';
import { usePermissions } from '@/hooks/use-permissions';
import { exportOrderLines, fetchOrder, useOrderFilterOptions, useOrderLookups, useOrders, usePriceAsOf, useSaveOrder } from './use-orders';
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
  /** Design TYPE (parent, "WL+TOOL+LOGO") and NAME (child, "BUBBLE"), told
   *  apart by resolveLineDesignParts. Reading line.designType directly put the
   *  NAME in the Design Type column on imported rows, and "NA" where the type
   *  actually sat in line.design. */
  design: { type: string | null; name: string | null };
}

/**
 * Per-line shipping state — always spelled out, including "Not dispatched".
 *
 * This used to render nothing for an undispatched line, on the reasoning that
 * most of the list hasn't shipped so a chip on every row would be noise. That
 * traded one problem for a worse one: a blank cell is indistinguishable from
 * information the screen failed to load, so the state people most often need to
 * find — what has NOT gone yet — was the only one you couldn't see.
 */
function DispatchChip({ state }: { state?: OrderItemDto['dispatchState'] }) {
  const full = state === 'FULL';
  const partial = state === 'PARTIAL';
  const tone = full
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25'
    : partial
      ? 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25'
      : // Deliberately the quietest of the three: it is the commonest state, so
        // it should read as a fact rather than compete with the two that mean
        // something has happened.
        'bg-slate-50 text-slate-600 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/15';
  return (
    <span
      className={cn('mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset', tone)}
      title={
        full
          ? 'Fully dispatched — quantities and rate are locked'
          : partial
            ? 'Partly dispatched — quantities and rate are locked'
            : 'Not dispatched yet — this line can still be edited freely'
      }
    >
      <Truck className="size-2.5" />
      {full ? 'Fully dispatched' : partial ? 'Part dispatched' : 'Not dispatched'}
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
  {
    // Storage key stays 'designType': that is the slot already saved in every
    // user's column order, so this appears where the old column was rather than
    // being appended off the right edge. The design TYPE itself is gone — it is
    // already the suffix of Product Name ("10 DAMRU DL+LOGO"), so the column only
    // ever repeated it. The NAME ("ZEBRA") is the part not shown anywhere else.
    id: 'designType',
    label: 'Design Name',
    cell: (r) => <span className={TEXT_CELL}>{r.design.name || '—'}</span>,
  },
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
  /*
   * Deliberately NOT persisted (unlike most other list pages): these filters
   * should start fresh every time you arrive here, rather than still be applied
   * from whatever you were last looking for after stepping away.
   *
   * The ONE exception is arriving with them in the URL. Opening a line's full
   * order and pressing Back should land on this grid as you left it, and the
   * only way Back can know the filters is to have carried them — so a URL that
   * names them wins over "start fresh", while a bare /orders/modify still starts
   * clean. Read once on mount: they are the starting point, not a binding.
   */
  const [urlParams] = useSearchParams();
  const seed = (key: string) => urlParams.get(key) ?? '';
  const [customer, setCustomer] = useState(() => seed('customer'));
  const [agent, setAgent] = useState(() => seed('agent'));
  const [product, setProduct] = useState(() => seed('product'));
  const [design, setDesign] = useState(() => seed('design'));
  const [priority, setPriority] = useState(() => seed('priority'));
  const [orderId, setOrderId] = useState(() => seed('orderId'));
  // Item picker mode. Off (default) → the short BASE-name list, where one pick
  // covers every design variant of that item. On → the full list, one entry per
  // variant, so a pick targets exactly that item. Same control as Dispatch Order.
  const [allVariants, setAllVariants] = useState(() => urlParams.get('allVariants') === '1');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const { page, setPage, pageSize, setPageSize } = usePageSize('order-modify');

  /**
   * This grid's own URL, filters included — what Back on the full-order form
   * returns to.
   *
   * Only non-empty filters are written, so the common case (nothing filtered)
   * produces a plain path and Back behaves exactly as it always did.
   */
  const modifyPathWithFilters = () => {
    const q = new URLSearchParams();
    const put = (k: string, v: string) => {
      if (v.trim()) q.set(k, v.trim());
    };
    put('customer', customer);
    put('agent', agent);
    put('product', product);
    put('design', design);
    put('priority', priority);
    put('orderId', orderId);
    if (allVariants) q.set('allVariants', '1');
    const qs = q.toString();
    return qs ? `/orders/modify?${qs}` : '/orders/modify';
  };

  // Priority goes to the server too, so it prunes lines exactly like the other
  // line-level filters instead of being trimmed off after paging.
  const filters = {
    customer: customer || undefined,
    agent: agent || undefined,
    product: product || undefined,
    // Tells the server which list the pick came from, so a base name also pulls
    // in its variants instead of matching only a line named exactly that.
    productBase: allVariants ? undefined : true,
    design: design || undefined,
    priority: priority || undefined,
    orderId: orderId ? Number(orderId) : undefined,
  };
  const { data, isLoading } = useOrders({ page, pageSize, ...filters });
  // Same filters drive the dropdowns, so each one only offers values that would
  // actually return rows next to the others.
  const { data: filterOptions } = useOrderFilterOptions(filters);
  // Shared with the line editor (React Query dedupes the request) — needed here
  // to tell a design TYPE from a design NAME on each row.
  const { data: lookups } = useOrderLookups();
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
  const hasFilters = !!customer || !!agent || !!product || !!design || !!priority || !!orderId || allVariants;
  // Agent/Design/Priority move behind the Filter icon on phones — this
  // count feeds its badge and drives the mobile sheet's own Reset button.
  const activeFilterCount = (agent ? 1 : 0) + (design ? 1 : 0) + (priority ? 1 : 0);
  const resetFilters = () => {
    setCustomer('');
    setAgent('');
    setProduct('');
    setDesign('');
    setPriority('');
    setOrderId('');
    setAllVariants(false);
    setPage(1);
  };

  // Flipping All swaps the item option set (base ↔ full), so whatever is picked
  // is no longer in the list — clear it rather than leave a filter applied that
  // the dropdown can no longer show.
  const toggleAllVariants = (next: boolean) => {
    setAllVariants(next);
    setProduct('');
    setPage(1);
  };

  // Off → base names ("12 MALBORO"); on → every variant ("12 MALBORO DL+LOGO").
  const productOptions = allVariants ? (filterOptions?.products ?? []) : (filterOptions?.productBases ?? []);

  // Drafts are work-in-progress and orders parked as a quotation aren't orders
  // yet — neither belongs on Order Modify.
  const orders = useMemo(() => (data?.items ?? []).filter((o) => !isUncommittedOrder(o.status)), [data]);
  const totalPages = data?.totalPages ?? 1;

  // Flatten every order's lines into a single list (order info repeats per line).
  // The API now prunes each order's lines to the ones matching the line-level
  // filters, so everything here is already a row the user asked for — no
  // post-flatten filtering. (It used to only narrow the parent ORDER, which is
  // why filtering by one product still listed that order's other products.)
  // The Design master's own type set — the tiebreak resolveLineDesignParts uses
  // when only one of the two design columns is filled.
  const knownDesignTypes = useMemo(
    () => new Set((lookups?.designs ?? []).map((d) => d.designType.trim().toUpperCase())),
    [lookups],
  );
  const rows = useMemo<Row[]>(
    () =>
      orders.flatMap((order) =>
        order.items.map((line) => ({ order, line, design: resolveLineDesignParts(line, knownDesignTypes) })),
      ),
    [orders, knownDesignTypes],
  );

  // Quantity totals for the lines this page is holding — deliberately the same
  // scope as the line/order counts in the footer they sit above, so the two
  // never disagree. CANCELLED lines still carry their old quantities in the
  // data but no longer represent real work, so they are counted OUT and the
  // strip says how many it dropped (otherwise re-adding the column by hand
  // gives a different number and the total looks wrong).
  const totals = useMemo(() => {
    let bags = 0, pcs = 0, kgs = 0, box = 0, cancelled = 0;
    for (const { line } of rows) {
      if (line.status === 'CANCELLED') { cancelled++; continue; }
      bags += line.bags ?? 0;
      pcs += line.pcs ?? 0;
      kgs += line.gram ?? 0;
      box += line.box ?? 0;
    }
    // Kgs are fractional, so sum then round — 0.1 + 0.2 must not surface as 0.30000000000000004.
    return { bags: round2(bags), pcs: round2(pcs), kgs: round2(kgs), box: round2(box), cancelled };
  }, [rows]);

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

  /**
   * Save a line change.
   *
   * `apply` is handed the order's COMPLETE line set, freshly fetched — never the
   * rows on screen. The list endpoint prunes each order's items to the ones
   * matching the product / design / priority filters, while the update endpoint
   * reconciles the whole set by id and deletes anything absent from the payload.
   * Editing one line under a filter therefore used to delete every line the
   * filter had hidden (and cascade away their photos with them). Re-reading the
   * order first makes the payload complete however the list is filtered.
   */
  const saveItems = async (order: OrderDto, apply: (items: OrderItemDto[]) => OrderItemDto[], okMsg: string) => {
    let full: OrderDto;
    try {
      full = await fetchOrder(order.id);
    } catch (e) {
      return toast.error(getApiErrorMessage(e, 'Could not load the order — nothing was saved'));
    }
    save.mutate(
      { id: full.id, input: toInput(full, apply(full.items)) },
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
    void saveItems(order, (items) => items.filter((i) => i.id !== line.id), 'Item removed');
    setEdit(null);
  };

  const saveLine = (order: OrderDto, updated: OrderItemDto) => {
    void saveItems(order, (items) => items.map((i) => (i.id === updated.id ? updated : i)), 'Item updated');
    setEdit(null);
  };

  // Cancel keeps the line on record (status=CANCELLED) instead of removing it —
  // the backend already relies on this for lines that have dispatches (a hard
  // delete is rejected there), and it's the reversible choice either way.
  const cancelLine = (order: OrderDto, line: OrderItemDto, reason: string, note: string) => {
    if (line.status === 'CANCELLED') return; // already cancelled — nothing to do
    const tag = `Cancelled — ${reason}${note.trim() ? `: ${note.trim()}` : ''}`;
    const updated: OrderItemDto = { ...line, status: 'CANCELLED', comment: [line.comment, tag].filter(Boolean).join(' | ') };
    void saveItems(order, (items) => items.map((i) => (i.id === line.id ? updated : i)), 'Item cancelled');
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
    void saveItems(order, (items) => items.map((i) => (i.id === line.id ? updated : i)), 'Item restored');
    setEdit(null);
  };

  // A dispatched line's quantity/rate/product details are frozen (the backend
  // rejects that edit outright) — this appends the edited details as a brand
  // new line instead, leaving the original dispatched line untouched.
  const addLineAsNew = (order: OrderDto, newItem: OrderItemDto) => {
    void saveItems(order, (items) => [...items, { ...newItem, id: 0 }], 'Added as a new item');
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
          {/* Filter order follows the house pattern: Order ID, Customer, Product, Agent, Design. */}
          <div className="min-w-0 flex-1 basis-[calc(50%-0.25rem)] sm:w-36 sm:flex-none sm:basis-auto">
            <NativeSelect
              value={orderId}
              onChange={(v) => { setOrderId(v); setPage(1); }}
              options={['', ...orderIdOptions]}
              placeholder="All order IDs"
              className={cn(CONTROL, 'font-medium tabular-nums', orderId && CONTROL_ON)}
            />
          </div>
          <div className="min-w-0 flex-1 basis-[calc(50%-0.25rem)] sm:w-56 sm:flex-none sm:basis-auto">
            <NativeSelect
              value={customer}
              onChange={(v) => { setCustomer(v); setPage(1); }}
              options={['', ...(filterOptions?.customers ?? [])]}
              placeholder="All customers"
              className={cn(CONTROL, 'font-medium', customer && CONTROL_ON)}
            />
          </div>
          {/* Product sits out here with Order ID and Customer rather than behind
              the Filter icon: on this screen you are usually hunting one item
              across orders, so it is reached as often as the customer is. */}
          <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
            <NativeSelect
              value={product}
              onChange={(v) => { setProduct(v); setPage(1); }}
              options={['', ...productOptions]}
              placeholder={allVariants ? 'All items (any design)' : 'All items'}
              className={cn(CONTROL, 'font-medium', product && CONTROL_ON)}
              digitsFirst
            />
          </div>
          <label
            className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12.5px] font-semibold select-none"
            title="ALL: list every design variant separately instead of grouping them under the item name"
          >
            <Switch checked={allVariants} onCheckedChange={toggleAllVariants} /> All
          </label>
          {/* Phones: Agent / Design / Priority move behind this icon (see the
              sheet below) — they don't fit the toolbar at phone widths. */}
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

      {/* Phones only: Agent / Design / Priority live behind the Filter icon above. */}
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
                // Clears every filter, not just the ones in this sheet — so it
                // stays live whenever anything is set, including the Product and
                // Customer pickers that now live out on the toolbar.
                disabled={!hasFilters}
              >
                <RotateCcw className="size-3.5" /> Reset
              </Button>
            </div>
          </SheetHeader>
          <div className="space-y-4">
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
            <div className="space-y-3 pb-1">
              {groupedByOrder.map(({ order: o, lines }) => (
                <div key={o.id} className="bg-card overflow-hidden rounded-2xl border shadow-sm ring-1 ring-black/[0.02]">
                  {/* Sticky, so you always know which order the line under your
                      thumb belongs to — a long order scrolls its own header away
                      otherwise and every card starts to look alike. */}
                  <div className="sticky top-0 z-10 border-b bg-gradient-to-r from-indigo-50 to-white px-3.5 py-2.5 dark:from-indigo-500/10 dark:to-transparent">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[15px] leading-tight font-extrabold break-words text-slate-900 dark:text-slate-100">{o.customerName}</p>
                        <p className="mt-0.5 text-[11.5px] font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{shortOrderCode(o.code, o.id)}</p>
                      </div>
                      <StatusPill status={o.status} />
                    </div>
                    {/* Labelled rather than "date → date": on a phone there's no
                        column header above it to say which is which. */}
                    <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium">
                      <span>
                        Ordered <span className="text-foreground font-semibold tabular-nums">{formatDate(o.orderDate)}</span>
                      </span>
                      <span>
                        Due <span className="text-foreground font-semibold tabular-nums">{formatDate(o.completionDate)}</span>
                      </span>
                      {o.agentName && <span>Agent <span className="text-foreground font-semibold">{o.agentName}</span></span>}
                      <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-white/10 dark:text-slate-300 dark:ring-white/10">
                        {lines.length} line{lines.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                    {lines.map((r) => {
                      const cancelled = r.line.status === 'CANCELLED';
                      return (
                        <div
                          key={r.line.id}
                          role="button"
                          tabIndex={0}
                          className="active:bg-muted/70 cursor-pointer px-3.5 py-2.5 transition-colors"
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
                          <div className="flex items-start justify-between gap-2.5">
                            <div className="min-w-0 flex-1">
                              <p className={cn('text-[14px] leading-snug font-bold break-words', cancelled ? 'text-muted-foreground line-through' : 'text-slate-900 dark:text-slate-100')}>
                                {r.line.productName || r.line.product || '—'}
                              </p>
                              {/* Only when there IS one. "Design —" on every line
                                  was a row of nothing on most cards. */}
                              {r.line.designType && (
                                <p className="text-muted-foreground mt-0.5 text-[11.5px] font-medium break-words">
                                  Design <span className="text-foreground font-semibold">{r.line.designType}</span>
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <span className="text-[15px] leading-none font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">
                                ₹{(r.line.rate ?? 0).toLocaleString('en-IN')}
                              </span>
                              {/* The row was already tappable, but nothing said so — on a
                                  phone there's no hover to discover it with. A round
                                  target also reads as a control rather than decoration. */}
                              <span className="text-muted-foreground/70 inline-flex size-6 items-center justify-center rounded-full bg-slate-100 dark:bg-white/10" aria-hidden>
                                <Pencil className="size-3" />
                              </span>
                            </div>
                          </div>
                          {/* Every badge the desktop Status column carries: the line's own
                              CANCELLED state, how far it has shipped, and its priority —
                              including NORMAL, which the phone used to leave blank so a
                              normal line looked like one with no priority set at all. */}
                          {/* Every badge the desktop Status column carries, all
                              rendered AS badges — priority and order type used to
                              be bare grey words sitting beside real chips, which
                              read as leftover text rather than status. */}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {cancelled && <StatusPill status="CANCELLED" />}
                            {!cancelled && <DispatchChip state={r.line.dispatchState} />}
                            {r.line.priority === 'URGENT' ? (
                              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-inset ring-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-400/25">
                                URGENT
                              </span>
                            ) : (
                              <span className="text-muted-foreground rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold dark:bg-white/10">
                                {r.line.priority || 'NORMAL'}
                              </span>
                            )}
                            {r.line.ordType && (
                              <span className="text-muted-foreground rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold dark:bg-white/10">
                                {r.line.ordType}
                              </span>
                            )}
                          </div>
                          {/* Only the quantities this line actually carries. The
                              fixed four-column grid printed "—" for the ones it
                              didn't, so half of every card was empty placeholders
                              competing with the figures that mattered. */}
                          {(() => {
                            const qty = ([['Bags', r.line.bags], ['Pcs', r.line.pcs], ['Kgs', r.line.gram], ['Box', r.line.box]] as const)
                              .filter(([, v]) => v != null && v !== 0);
                            if (!qty.length) return null;
                            return (
                              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-white/[0.04]">
                                {qty.map(([lbl, v]) => (
                                  <span key={lbl} className="flex items-baseline gap-1.5">
                                    <span className="text-muted-foreground text-[9.5px] font-bold uppercase tracking-widest">{lbl}</span>
                                    <span className="text-[13px] font-bold tabular-nums text-slate-800 dark:text-slate-100">{(v as number).toLocaleString('en-IN')}</span>
                                  </span>
                                ))}
                              </div>
                            );
                          })()}
                          {r.line.comment && (
                            <p className="text-muted-foreground mt-1.5 border-l-2 border-amber-300 pl-2 text-[11.5px] break-words dark:border-amber-400/40">
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

          {/* ── Phones: totals, counts and paging in ONE two-line bar ───────────
              Inside the scroller, after the last card, so it behaves like the end
              of the list rather than a bar bolted across the bottom of the screen
              — on a phone that strip was taking permanent height from the cards
              while only being wanted once you had read them.

              It also replaces the desktop pair below, which costs six lines here:
              a caption, four wrapping totals, a count line and a pager. Same
              information, minus the words that only repeat what the numbers say. */}
          {rows.length > 0 && (
            <div className="bg-card mt-3 space-y-1 rounded-xl border px-2.5 py-1.5 shadow-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                {([['Bags', totals.bags], ['Pcs', totals.pcs], ['Kgs', totals.kgs], ['Box', totals.box]] as const)
                  .filter(([, v]) => v != null && v !== 0)
                  .map(([label, value]) => (
                    <span key={label} className="flex items-baseline gap-1">
                      <span className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">{label}</span>
                      <span className="text-[12px] font-bold tabular-nums text-slate-800 dark:text-slate-100">{value.toLocaleString('en-IN')}</span>
                    </span>
                  ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-[11px] font-medium">
                  <span className="text-foreground font-bold tabular-nums">{rows.length}</span> lines ·{' '}
                  <span className="text-foreground font-bold tabular-nums">{new Set(rows.map((r) => r.order.id)).size}</span> orders
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <PageSizeSelect value={pageSize} onChange={setPageSize} hideLabel />
                  <span className="text-[11px] font-bold tabular-nums whitespace-nowrap">
                    {data?.page ?? page}/{totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7 rounded-[4px]"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7 rounded-[4px]"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    aria-label="Next page"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Quantity totals for the lines on this page (tablet and up) ──────────── */}
      {rows.length > 0 && (
        <div className="bg-card hidden flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[4px] border px-3 py-2 shadow-sm sm:flex">
          <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Totals — this page</span>
          {totals.cancelled > 0 && (
            <span className="text-muted-foreground text-[11px] font-medium">
              {totals.cancelled.toLocaleString('en-IN')} cancelled line{totals.cancelled === 1 ? '' : 's'} not counted
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1.5">
            {([['Bags', totals.bags], ['Pcs', totals.pcs], ['Kgs', totals.kgs], ['Box', totals.box]] as const).map(([label, value]) => (
              <span key={label} className="flex items-baseline gap-1.5">
                <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">{label}</span>
                <span className={cn(TEXT_CELL, 'tabular-nums')}>{dash(value)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Footer: line/order counts + paging (tablet and up) ─────────────────── */}
      <div className="bg-card hidden flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[4px] border px-3 py-2 shadow-sm sm:flex">
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
            onViewFull={() => navigate(`/orders/${edit.order.id}/edit`, { state: { backTo: modifyPathWithFilters() } })}
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
  // Mirrors the backend's split for a dispatched line. WHAT shipped and at what
  // price is settled and stays frozen; HOW MUCH was ordered may still move while
  // the line is only PART shipped — under-counting the bags for the kgs still to
  // go is ordinary, and a second line would split one physical item in two.
  const IDENTITY_KEYS = ['itemName', 'pCategory', 'subCategory', 'product', 'designType', 'psize', 'productRate', 'designRate'] as const;
  const QTY_KEYS = ['bags', 'pcs', 'gram', 'box'] as const;
  const identityDirty = IDENTITY_KEYS.some((k) => form[k] !== baseline.current[k]);
  const qtyDirty = QTY_KEYS.some((k) => form[k] !== baseline.current[k]);
  // A fully-dispatched line is skipped by the pending pool, so raising it would
  // never reach the shop floor — the server refuses that one too.
  const fullyDispatched = line.dispatchState === 'FULL';
  const needsAddAsNew = identityDirty || (qtyDirty && fullyDispatched);

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
    // Whichever special-rate adjustment is baked into the rate finally offered —
    // today's, or the as-of one if the historical lookup wins below.
    let appliedProductDelta = resolved?.productDelta ?? 0;
    let appliedDesignDelta = resolved?.designDelta ?? 0;
    /** The date the offered rate-list figure belongs to — null means today's. */
    let listDate: string | null = null;

    /*
     * Today's price for the newly-picked item, kept separately from the
     * order-date one.
     *
     * Both are needed at once when the PRODUCT was swapped: the order-date rate
     * is what that order is entitled to, and today's is the newer rate to offer
     * if the chart has moved since. Previously only one survived — the as-of
     * lookup overwrote today's figure — so there was nothing left to offer.
     */
    const todayProductRate: number | null = hasProductRate ? currentProductRate : null;
    const todayDesignRate: number | null = hasDesignRate ? currentDesignRate : null;
    const todayProductDelta = resolved?.productDelta ?? 0;
    const todayDesignDelta = resolved?.designDelta ?? 0;
    /** The same item priced on the ORDER's date. Null when the historical lookup
     *  could not resolve it — see the `asOf.rate > 0` guard below. */
    let asOfProductRate: number | null = null;
    let asOfDesignRate: number | null = null;
    let asOfProductDelta = 0;
    let asOfDesignDelta = 0;

    const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
    // Compared against the CURRENT form values, not the original line: picking
    // A → B → C should ask on each real change, not just when it differs from A.
    //
    // The two halves are tracked SEPARATELY. Swapping only the design leaves the
    // product exactly as it was, and re-pricing a product the user never
    // re-chose is an unasked-for change — that is what made a design swap
    // announce "Product changed" and look broken.
    const productChanged =
      norm(it.product) !== norm(form.product) ||
      norm(it.subCategory) !== norm(form.subCategory) ||
      String(it.size ?? '') !== String(num(form.psize) ?? '');
    const designChanged = norm(it.designType) !== norm(form.designType);
    const itemChanged = productChanged || designChanged;
    // The rate already sitting on this line — what "keep the old rate" means.
    const existingRate = (num(form.productRate) ?? 0) + (num(form.designRate) ?? 0);

    /*
     * What the line said before this pick, so a cancel can put it back.
     *
     * Captured from `form` rather than from `line`: picking A → B → C and then
     * cancelling should land on B, the state the user was actually looking at,
     * not all the way back to the line's original item.
     */
    const identityBefore = {
      itemName: form.itemName,
      pCategory: form.pCategory,
      subCategory: form.subCategory,
      product: form.product,
      designType: form.designType,
      designName: form.designName,
      psize: form.psize,
    };

    // The identity change still lands FIRST, before anything is asked — the
    // dialog compares the two items and needs the form to already show the new
    // one, and it stops the combobox blurring its text back to the old name
    // (its blur handler does that while the value is unchanged), which read as
    // "it ignored my pick". The difference is that it is now provisional: a
    // cancel below puts `identityBefore` back.
    set({
      itemName: label,
      pCategory: it.category,
      subCategory: it.subCategory,
      product: it.product,
      designType: it.designType ?? '',
      designName: realName,
      psize: it.size != null ? String(it.size) : '',
    });

    /** Set when the user backs out, so the identity set above is rolled back. */
    let cancelled = false;

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
            asOfProductRate = hasProductRate ? round2(asOf.productRate + asOf.productDelta) : null;
            asOfDesignRate = hasDesignRate ? round2(asOf.designRate + asOf.designDelta) : null;
            asOfProductDelta = asOf.productDelta;
            asOfDesignDelta = asOf.designDelta;
            finalProductRate = asOfProductRate;
            finalDesignRate = asOfDesignRate;
            appliedProductDelta = asOf.productDelta;
            appliedDesignDelta = asOf.designDelta;
            // Only now may the dialog put a date on the rate-list figure. When
            // the historical lookup finds nothing it falls back to TODAY's
            // catalogue, and labelling that with the order date would be a lie.
            listDate = order.orderDate;
          }
        }
        /*
         * One rule, two halves, and only ONE of them is a choice.
         *
         * DESIGN rate — compulsory. Swap DL for FULL LASER+TOOL and you are
         * buying a different design: it costs ₹50 where DL cost ₹15, so the
         * ₹35 is not on offer, it is what the new design is worth. Presenting
         * it as "keep ₹355 or use ₹390" invited a price that does not exist.
         *
         * PRODUCT rate — negotiable. This is the half a customer's price was
         * agreed on, so the line's own figure is held unless the user asks for
         * the rate list instead.
         *
         * So both options carry the new design rate and differ only in the
         * product half — which is why they collapse into a single button
         * whenever the product rate has not moved.
         */
        const lineProductRate = num(form.productRate);
        const lineDesignRate = num(form.designRate);

        /*
         * Re-specifying the item makes both columns DATES, not a negotiation.
         *
         * KEEP used to hold the figure already saved on the line, on the reading
         * that the product half was "the price agreed with this party". It is
         * not: a party's agreed price is already IN the rate list, as their
         * special-rate delta — so the order-date figure of ₹320 is chart plus
         * this party's own adjustment on that date. The ₹340 sitting on the line
         * is simply stale, and offering it as "your rate" dressed up a stale
         * number as a decision.
         *
         * So once the item is swapped, KEEP is what this item cost on the
         * ORDER's own date — the rate that order is entitled to, mandatory in
         * the same sense the design rate is. USE becomes "the chart has moved
         * since; bill the newer rate", and only appears when a newer one exists.
         *
         * Gated on the historical lookup having resolved, not on which half
         * changed: this whole block only runs when the item changed at all, and
         * a swap of the design alone still re-prices the line — it is the same
         * item record being re-specified either way. Where the lookup fails
         * there is no order-date rate to stand on, so the old "your figure
         * versus the rate list's" reading is kept as the fallback.
         */
        const dated = asOfProductRate != null;

        const keepProductRate = dated ? asOfProductRate : (lineProductRate ?? finalProductRate);
        const keepDesignRate = dated
          ? (asOfDesignRate ?? todayDesignRate)
          : designChanged
            ? finalDesignRate
            : (lineDesignRate ?? finalDesignRate);
        /** The figures behind the USE column. Today's chart when the columns are
         *  dates; the (as-of) rate list otherwise. */
        const offerProductRate = dated ? todayProductRate : finalProductRate;
        const offerDesignRate = dated ? todayDesignRate : finalDesignRate;
        const offerProductDelta = dated ? todayProductDelta : appliedProductDelta;
        const offerDesignDelta = dated ? todayDesignDelta : appliedDesignDelta;
        /** Which date each column's figures belong to. Null on KEEP means "your
         *  own negotiated rate"; null on USE means "today". */
        const keepAsOf = dated ? order.orderDate : null;
        const offerAsOf = dated ? null : listDate;

        const keepRate = round2((keepProductRate ?? 0) + (keepDesignRate ?? 0));
        const listRate = (offerProductRate ?? 0) + (offerDesignRate ?? 0);

        /*
         * Was the line's own product rate a deliberate customization — a price
         * agreed for THIS order that the order-date lookup would otherwise
         * quietly erase?
         *
         * Only possible when the PRODUCT itself did not change: a genuine item
         * swap means the old figure priced a different product, and offering it
         * back would be inventing a rate for something that was never quoted.
         * Compared against the AS-OF figure, not today's — a rate that only
         * differs from TODAY's chart is just the chart having moved since, which
         * is exactly what Keep/Use already cover. Differing from the order-date
         * figure is the actual signature of "someone typed a number here".
         */
        const productCustomized =
          !productChanged && dated && lineProductRate != null && Math.abs((lineProductRate ?? 0) - (keepProductRate ?? 0)) > 0.001;
        /** The line's own product rate, kept exactly as typed, combined with the
         *  new design's (compulsory) rate. Null unless there is one to offer. */
        const originalProductRate = productCustomized ? lineProductRate : null;
        const originalRate = productCustomized ? round2((lineProductRate ?? 0) + (keepDesignRate ?? 0)) : null;

        /*
         * Is there actually a decision to make?
         *
         * Same product: only the DESIGN rate can be in question. If the new
         * design costs what the old one did, nothing about this line moves and
         * asking would be noise — offering "use the rate list" there would only
         * be offering to re-price a product the user never re-chose.
         *
         * Product changed: the two outcomes are the whole old rate versus the
         * whole rate-list rate, so ask whenever they differ.
         */
        /*
         * Speak up when the line's rate is about to move at all — either because
         * the new design costs something different (compulsory, so this is a
         * heads-up plus the custom-rate escape hatch) or because the product
         * rate differs from the list (a genuine choice). Silence only when
         * nothing moves.
         */
        const productRateMoved = Math.abs(listRate - keepRate) > 0.001;
        const decisionToMake = Math.abs(keepRate - existingRate) > 0.001 || productRateMoved;

        if (decisionToMake) {
          const choice = await askRate({
            label,
            asOf: offerAsOf,
            keepAsOf,
            newProductRate: offerProductRate,
            newDesignRate: offerDesignRate,
            oldProductRate: lineProductRate,
            oldDesignRate: num(form.designRate),
            hasDesignRate,
            newProductDelta: offerProductDelta,
            newDesignDelta: offerDesignDelta,
            productChanged,
            designChanged,
            oldDesignType: form.designType || null,
            newDesignType: it.designType ?? null,
            keepProductRate,
            keepDesignRate,
            keepRate,
            productRateMoved,
            originalProductRate,
            originalRate,
          });
          if (choice.kind === 'cancel') {
            cancelled = true;
          } else if (choice.kind === 'new') {
            // Set explicitly rather than left to fall through. It used to rely on
            // finalProductRate ALREADY holding the offered figure, which stopped
            // being true the moment USE could mean today's chart instead of the
            // as-of one — the old code would have silently applied the order-date
            // rate under a button labelled with today's.
            finalProductRate = offerProductRate;
            finalDesignRate = offerDesignRate;
          } else if (choice.kind === 'keep') {
            finalProductRate = keepProductRate;
            finalDesignRate = keepDesignRate;
          } else if (choice.kind === 'custom') {
            finalProductRate = choice.productRate;
            finalDesignRate = choice.designRate;
          } else if (choice.kind === 'original') {
            finalProductRate = originalProductRate;
            finalDesignRate = keepDesignRate;
          }
        } else {
          // Silent path: the two outcomes were the same figure, so hold the
          // line's own rate rather than quietly re-pricing anything.
          finalProductRate = keepProductRate;
          finalDesignRate = keepDesignRate;
        }
      } catch {
        // A failed rate check shouldn't block picking the item — fall back to
        // silently applying the current rate, same as before this feature existed.
      } finally {
        setCheckingRate(false);
      }
    }

    // Backed out: undo the provisional identity and leave every rate alone. The
    // line is exactly as it was before the pick.
    if (cancelled) {
      set(identityBefore);
      return;
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
    // When the design type has no names to pick from, the picker is empty AND
    // disabled — so the user cannot have chosen anything, and writing 'NA' here
    // destroyed whatever `design` already held. On imported lines (the majority
    // of this book) that column holds the design TYPE, e.g. "WL+TOOL"; wiping it
    // silently unlinked the line from Design Track and the reference-photo rules.
    // Keep what is there; only fall back to 'NA' when it really is empty.
    design: noDesignNames ? line.design?.trim() || 'NA' : form.designName.trim() || null,
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
    if (line.dispatched && needsAddAsNew) {
      const ok = await confirm({
        title: 'This item has already been dispatched',
        description: fullyDispatched && !identityDirty
          ? 'It is fully dispatched, so changing the quantity would not affect what still ships. Add the extra quantity as a NEW item with the same details instead? The original dispatched line stays untouched.'
          : 'Its product, design and rate can\'t be changed directly — the dispatch already reflects what was shipped. Add these changes as a NEW item with the same details instead? The original dispatched line stays untouched.',
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
  /** Date the USE column's figures belong to; null means today's chart. */
  asOf: string | null;
  /** Date the KEEP column's figures belong to. Null means "the rate agreed on
   *  this line", which is what KEEP means when only the design was swapped. */
  keepAsOf?: string | null;
  newProductRate: number | null;
  newDesignRate: number | null;
  oldProductRate: number | null;
  oldDesignRate: number | null;
  /** False for items with no design, so the design row is hidden entirely. */
  hasDesignRate: boolean;
  /** This customer's special-rate adjustment inside the new rate, if any. A
   *  product part can move purely because of it — without saying so, the jump
   *  reads as arbitrary. */
  newProductDelta?: number;
  newDesignDelta?: number;
  /** False when only the design was swapped — the product rate is then not in
   *  question at all and is left out of the comparison. */
  productChanged?: boolean;
  /** True when a different design was picked — its rate is then compulsory. */
  designChanged?: boolean;
  oldDesignType?: string | null;
  newDesignType?: string | null;
  /** True when the product half differs between this line and the rate list —
   *  the only half that is ever a choice, so this decides whether the dialog
   *  offers one button or two. */
  productRateMoved?: boolean;
  /** The design rate that will be applied either way. */
  keepDesignRate?: number | null;
  /** The product rate "Keep" will apply. */
  keepProductRate?: number | null;
  /** The whole rate "Keep" will apply. */
  keepRate?: number;
  /** The line's own product rate, when it looks like a deliberate customization
   *  the order-date lookup would otherwise discard — see `productCustomized` in
   *  `onItemPick`. Null when there is nothing to preserve. */
  originalProductRate?: number | null;
  /** `originalProductRate` plus the new (compulsory) design rate — the figure a
   *  third "Keep" button would apply. */
  originalRate?: number | null;
}

type RateChoice =
  | { kind: 'new' }
  | { kind: 'keep' }
  /** The line's own product rate, preserved as-is — see `originalRate`. */
  | { kind: 'original' }
  | { kind: 'custom'; productRate: number | null; designRate: number | null }
  /** Backed out — the item pick is undone too, not just the rate. */
  | { kind: 'cancel' };

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
 * Dismissing without answering (Escape, clicking away, the X, Cancel) CANCELS
 * the whole pick — the item goes back to what it was, not just the rate.
 *
 * It used to mean "keep the old rate", which left the new item applied at the
 * old price. That is a real combination and one of the three buttons produces
 * it, so a dismissal silently choosing it was indistinguishable from having
 * chosen it — and there was then no way to back out of an item swap at all.
 * Escape now means what it means everywhere else: nothing happened.
 */
function RateChoiceDialog({
  label,
  asOf,
  keepAsOf = null,
  newProductRate,
  newDesignRate,
  oldProductRate,
  oldDesignRate,
  hasDesignRate,
  newProductDelta,
  newDesignDelta,
  productChanged = true,
  designChanged = false,
  oldDesignType,
  newDesignType,
  productRateMoved = true,
  keepProductRate,
  keepDesignRate,
  keepRate,
  originalProductRate = null,
  originalRate = null,
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
    <Dialog open onOpenChange={(o) => !o && onDone({ kind: 'cancel' })}>
      <DialogContent className="w-[calc(100vw-2rem)] overflow-x-hidden sm:max-w-xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>This changes the line’s rate</DialogTitle>
        </DialogHeader>
        {/* Two sentences at most, in the order the user needs them: what is
            already decided, then what is left to decide. */}
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">{label}</span> — this line is saved at{' '}
          <span className="text-foreground font-semibold">{inr(oldRate)}</span>, and it now comes to{' '}
          <span className="text-foreground font-semibold">{inr(keepRate ?? newRate)}</span>.
        </p>

        {/* The design half is not a choice. Say so plainly and say why, naming
            both designs — "the design rate changed" leaves the user wondering
            whether they may refuse it. */}
        {designChanged && Math.abs((newDesignRate ?? 0) - (oldDesignRate ?? 0)) > 0.001 && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100">
            You picked {newDesignType ? <span className="font-semibold">{newDesignType}</span> : 'a different design'}
            {oldDesignType ? <> in place of <span className="font-semibold">{oldDesignType}</span></> : null}. Its rate is{' '}
            <span className="font-semibold tabular-nums">{inr(newDesignRate ?? 0)}</span> against{' '}
            <span className="font-semibold tabular-nums">{inr(oldDesignRate ?? 0)}</span> before, so{' '}
            <span className="font-semibold tabular-nums">
              {(newDesignRate ?? 0) > (oldDesignRate ?? 0) ? '+' : '−'}
              {inr(Math.abs(round2((newDesignRate ?? 0) - (oldDesignRate ?? 0)))).slice(1)}
            </span>{' '}
            is <span className="font-semibold">part of the new design, not optional</span>. Use Custom rate if you have agreed
            something else with this party.
          </p>
        )}

        {/* The product half IS a choice — but only when it actually differs. */}
        {/* Two different questions, so two different explanations. With dated
            columns the product rate was never a choice on this line — the
            question is which DATE's chart to bill it on. */}
        {productRateMoved && keepAsOf && (
          <p className="rounded-md border border-dashed px-3 py-2 text-[12.5px]">
            On <span className="font-semibold">{formatDate(keepAsOf)}</span> — this order&rsquo;s own date — this product was{' '}
            <span className="font-semibold tabular-nums">{inr(keepProductRate ?? 0)}</span>, which is what the order is entitled
            to. It is <span className="font-semibold tabular-nums">{inr(newProductRate ?? 0)}</span> on today&rsquo;s rate list.
            Take the newer rate only if that is what was agreed.
          </p>
        )}
        {productRateMoved && !keepAsOf && (
          <p className="rounded-md border border-dashed px-3 py-2 text-[12.5px]">
            Your product rate of <span className="font-semibold tabular-nums">{inr(keepProductRate ?? oldProductRate ?? 0)}</span>{' '}
            differs from the <span className="font-semibold tabular-nums">{inr(newProductRate ?? 0)}</span> on the{' '}
            {asOf ? <>rate list of <span className="font-semibold">{formatDate(asOf)}</span> — this order&rsquo;s own date</> : <>current rate list</>}.
            That part is yours to decide.
          </p>
        )}

        {/* The line's own figure was NOT what the chart said on the order's own
            date either — the strongest sign this was a price agreed just for
            this order, which the two columns above would otherwise silently
            drop. Named and offered back explicitly rather than folded into
            Custom rate, which asks the user to retype a number the app already
            has. */}
        {originalRate != null && (
          <p className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-[12.5px] text-sky-900 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-100">
            This line was already at <span className="font-semibold tabular-nums">{inr(oldRate)}</span> — a rate that doesn&rsquo;t
            match what {keepAsOf ? <>the rate list said on {formatDate(keepAsOf)}</> : 'the rate list says'}, so it looks like
            one agreed just for this order. You can keep it, with the new design added in.
          </p>
        )}

        {/* WHICH PART moved, and by how much — not just the total. A line can
            shift by ₹10 because the customer's special rate applies to the
            product while the design rate stood still; the two totals alone gave
            no way to tell that apart, so "use the current price" read as an
            unexplained jump. A real table (not a 3-column grid) so the right-hand
            column can never be pushed out of the dialog. */}
        {/*
          * The columns ARE the two buttons.
          *
          * This table used to compare "on this line" against "the rate list",
          * which are not the two things on offer: the offers are KEEP (your
          * product + the new design) and USE (the rate list's product + the new
          * design). The Keep total appeared nowhere in the table at all, so the
          * figures on screen and the figures on the buttons were different sets
          * of numbers. Now every number here is on a button and every button
          * number is here.
          *
          * The design row reads the same in both option columns, which is the
          * clearest possible way to show that half is not a choice.
          */}
        {productRateMoved && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="text-muted-foreground bg-muted/50 border-b text-[10.5px] font-bold tracking-wide uppercase">
                  <th className="px-2.5 py-1.5 text-left font-bold sm:px-3">Part</th>
                  <th className="px-2.5 py-1.5 text-right font-bold sm:px-3">Was</th>
                  <th className="border-l px-2.5 py-1.5 text-right font-bold text-slate-600 sm:px-3 dark:text-slate-300">
                    Keep
                    {/* Dated columns have to be labelled, or "Keep 320 / Use 310"
                        is two numbers with no stated reason to prefer either. */}
                    {keepAsOf && <span className="ml-1 font-semibold normal-case opacity-70">{formatDate(keepAsOf)}</span>}
                  </th>
                  <th className="border-l bg-blue-50/70 px-2.5 py-1.5 text-right font-bold text-blue-700 sm:px-3 dark:bg-blue-500/10 dark:text-blue-300">
                    Use
                    <span className="ml-1 font-semibold normal-case opacity-70">{asOf ? formatDate(asOf) : 'today'}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    [
                      'Product',
                      oldProductRate ?? 0,
                      keepProductRate ?? 0,
                      newProductRate ?? 0,
                      true,
                      newProductDelta ?? 0,
                      keepAsOf ? 'rate on the day' : 'your choice',
                    ],
                    [
                      'Design',
                      oldDesignRate ?? 0,
                      keepDesignRate ?? 0,
                      newDesignRate ?? 0,
                      hasDesignRate,
                      newDesignDelta ?? 0,
                      Math.abs((keepDesignRate ?? 0) - (newDesignRate ?? 0)) < 0.001 ? 'same either way' : 'moved too',
                    ],
                  ] as const
                )
                  .filter(([, , , , show]) => show)
                  .map(([name, was, keep, use, , delta, badge]) => {
                    const fixed = Math.abs(keep - use) < 0.001;
                    return (
                      <tr key={name} className="border-b last:border-b-0">
                        <td className="px-2.5 py-1.5 sm:px-3">
                          <span className="text-muted-foreground">{name} ₹</span>
                          <span
                            className={cn(
                              'ml-1.5 text-[10px] font-bold tracking-wide uppercase',
                              fixed ? 'text-muted-foreground/70' : 'text-amber-700 dark:text-amber-400',
                            )}
                          >
                            {badge}
                          </span>
                        </td>
                        <td className="text-muted-foreground px-2.5 py-1.5 text-right tabular-nums sm:px-3">{inr(was)}</td>
                        <td className={cn('border-l px-2.5 py-1.5 text-right tabular-nums sm:px-3', !fixed && 'font-semibold')}>
                          {inr(keep)}
                        </td>
                        <td
                          className={cn(
                            'border-l bg-blue-50/70 px-2.5 py-1.5 text-right tabular-nums sm:px-3 dark:bg-blue-500/10',
                            !fixed && 'font-semibold text-blue-800 dark:text-blue-200',
                          )}
                        >
                          {inr(use)}
                          {/* Name the cause where there is one: a part that moved
                              purely because of this customer's special rate is not
                              a catalogue price change, and saying so is the
                              difference between "why?" and "of course". */}
                          {Math.abs(delta) > 0.001 && (
                            <div className="text-muted-foreground text-[10px] font-medium">
                              incl. {delta > 0 ? '+' : '−'}₹{Math.abs(delta)} special
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                <tr className="bg-muted/30 border-t-2 font-bold">
                  <td className="px-2.5 py-2 sm:px-3">Line total</td>
                  <td className="text-muted-foreground px-2.5 py-2 text-right tabular-nums sm:px-3">{inr(oldRate)}</td>
                  <TotalCell value={keepRate ?? oldRate} was={oldRate} />
                  <TotalCell value={newRate} was={oldRate} accent />
                </tr>
              </tbody>
            </table>
          </div>
        )}

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

        {/* `Custom rate…` is pushed left by `sm:mr-auto` below: it opens a
            sub-form rather than answering the question, so grouping it with the
            two real answers made three equal-looking buttons out of one choice
            and one detour. */}
        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
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
              {/*
                * One button or two, decided by whether anything is actually
                * negotiable. When only the design moved there is a single
                * correct figure, and offering it twice under two names — which
                * is what "Keep ₹390 / Use ₹390" did — reads as a trick
                * question. Custom rate is always there for a agreed price.
                */}
              <Button variant="ghost" onClick={() => onDone({ kind: 'cancel' })}>
                Cancel
              </Button>
              <Button variant="ghost" className="sm:mr-auto" onClick={() => setCustom(true)}>
                Custom rate…
              </Button>
              {/* The escape hatch this whole dialog exists for: a rate agreed
                  just for this order, offered back pre-filled instead of making
                  the user retype it into Custom rate. Sky rather than the
                  Keep/Use greys, so it reads as the one button that's actually
                  about THIS order rather than a chart lookup. */}
              {originalRate != null && (
                <Button
                  variant="outline"
                  onClick={() => onDone({ kind: 'original' })}
                  className="h-auto min-w-[8.5rem] flex-col gap-0 border-sky-300 py-1.5 leading-tight text-sky-800 hover:bg-sky-50 dark:border-sky-400/40 dark:text-sky-200 dark:hover:bg-sky-400/10"
                >
                  <span>Keep {inr(originalRate)}</span>
                  <span className="text-[10.5px] font-normal opacity-80">your original rate — {inr(originalProductRate ?? 0)}</span>
                </Button>
              )}
              {productRateMoved ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => onDone({ kind: 'keep' })}
                    className="h-auto min-w-[8.5rem] flex-col gap-0 py-1.5 leading-tight"
                  >
                    <span>Keep {inr(keepRate ?? oldRate)}</span>
                    <span className="text-muted-foreground text-[10.5px] font-normal">
                      {keepAsOf ? `rate on ${formatDate(keepAsOf)}` : `product stays ${inr(keepProductRate ?? 0)}`}
                    </span>
                  </Button>
                  <Button onClick={() => onDone({ kind: 'new' })} className="h-auto min-w-[8.5rem] flex-col gap-0 py-1.5 leading-tight">
                      <span>Use {inr(newRate)}</span>
                    <span className="text-[10.5px] font-normal opacity-80">
                      {keepAsOf ? `today’s rate ${inr(newProductRate ?? 0)}` : `product moves to ${inr(newProductRate ?? 0)}`}
                    </span>
                  </Button>
                </>
              ) : (
                <Button onClick={() => onDone({ kind: 'keep' })} className="h-auto flex-col gap-0 py-1.5 leading-tight">
                  <span>Apply {inr(keepRate ?? oldRate)}</span>
                  <span className="text-[10.5px] font-normal opacity-80">
                    your {inr(keepProductRate ?? 0)} + design {inr(keepDesignRate ?? newDesignRate ?? 0)}
                  </span>
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A total under one of the two option columns: the figure, and — because that
 *  is the question actually being asked — what it does to the line's rate. */
function TotalCell({ value, was, accent }: { value: number; was: number; accent?: boolean }) {
  const diff = round2(value - was);
  const same = Math.abs(diff) < 0.001;
  return (
    <td
      className={cn(
        'border-l px-2.5 py-2 text-right tabular-nums sm:px-3',
        accent && 'bg-blue-50/70 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200',
      )}
    >
      <div className="text-[15px]">{inr(value)}</div>
      <div
        className={cn(
          'text-[10.5px] font-semibold',
          same && 'text-muted-foreground/60',
          !same && diff > 0 && 'text-rose-600 dark:text-rose-400',
          !same && diff < 0 && 'text-emerald-600 dark:text-emerald-400',
        )}
      >
        {same ? 'no change' : `${diff > 0 ? '+' : '−'}${inr(Math.abs(diff)).slice(1)}`}
      </div>
    </td>
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
