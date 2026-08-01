import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, RotateCcw, Save, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { OrderDto, OrderInput, OrderItemDto } from '@oms/shared';
import { ORDER_PRIORITIES } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, shortOrderCode } from '@/lib/utils';
import { DATE_FORMATS, formatDate, useDateFormat } from '@/lib/date-format';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combo, NativeSelect } from '@/components/common/combo';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { settingValues, useSettings } from '@/features/settings/use-settings';
import { usePermissions } from '@/hooks/use-permissions';
import { useOrderFilterOptions, useOrderLookups, useOrders, useSaveOrder } from './use-orders';
import { LiveLinePhotos } from './line-photos';

const PAGE_SIZE = 50;

// Persist the list's filters so they survive a page refresh or navigating away and back.
const FILTER_KEY = 'oms:order-modify-filters';
interface OrderModifyFilters {
  search: string;
  agent: string;
  product: string;
  design: string;
  priority: string;
  page: number;
}
const loadFilters = (): Partial<OrderModifyFilters> => {
  try {
    return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}') as Partial<OrderModifyFilters>;
  } catch {
    return {};
  }
};

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
const dash = (v: number | null) => (v == null || v === 0 ? '—' : v.toLocaleString('en-IN'));

/** One flat row = an order line plus its parent order's header info. */
interface Row {
  order: OrderDto;
  line: OrderItemDto;
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
      return <StatusPill status={cancelled ? 'CANCELLED' : r.order.status} />;
    },
  },
];

export function OrderModifyPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [search, setSearch] = useState(() => loadFilters().search ?? '');
  const [agent, setAgent] = useState(() => loadFilters().agent ?? '');
  const [product, setProduct] = useState(() => loadFilters().product ?? '');
  const [design, setDesign] = useState(() => loadFilters().design ?? '');
  const [priority, setPriority] = useState(() => loadFilters().priority ?? '');
  const [page, setPage] = useState(() => loadFilters().page ?? 1);

  // Persist the current filters whenever they change.
  useEffect(() => {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify({ search, agent, product, design, priority, page }));
  }, [search, agent, product, design, priority, page]);

  const { data, isLoading } = useOrders({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    agent: agent || undefined,
    product: product || undefined,
    design: design || undefined,
  });
  const { data: filterOptions } = useOrderFilterOptions();
  const save = useSaveOrder();
  const { data: settings } = useSettings();
  const orderTypeOptions = useMemo(() => settingValues(settings, 'ORDER_TYPE'), [settings]);
  const cols = useColumnOrder('order-modify', COLUMNS);
  const { format, setFormat } = useDateFormat();

  const [edit, setEdit] = useState<Row | null>(null);
  const hasFilters = !!search || !!agent || !!product || !!design || !!priority;
  const resetFilters = () => {
    setSearch('');
    setAgent('');
    setProduct('');
    setDesign('');
    setPriority('');
    setPage(1);
    sessionStorage.removeItem(FILTER_KEY);
  };

  // Draft orders are work-in-progress and stay hidden from Order Modify.
  const orders = useMemo(() => (data?.items ?? []).filter((o) => o.status !== 'DRAFT'), [data]);
  const totalPages = data?.totalPages ?? 1;

  // Flatten every order's lines into a single list (order info repeats per line).
  // Priority has no server-side filter (a tiny fixed NORMAL/URGENT enum), so it's
  // applied here, after flattening — product/design are already narrowed server-side.
  const rows = useMemo<Row[]>(() => {
    const flat = orders.flatMap((order) => order.items.map((line) => ({ order, line })));
    return priority ? flat.filter((r) => r.line.priority === priority) : flat;
  }, [orders, priority]);

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
          <div className="relative w-full flex-1 sm:max-w-56 sm:flex-none">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search order #, customer or agent…"
              className={cn(CONTROL, 'pl-8 font-medium', search && CONTROL_ON)}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value.trim());
                setPage(1);
              }}
            />
          </div>
          <div className="w-36">
            <NativeSelect
              value={agent}
              onChange={(v) => { setAgent(v); setPage(1); }}
              options={['', ...(filterOptions?.agents ?? [])]}
              placeholder="All agents"
              className={cn(CONTROL, 'font-medium', agent && CONTROL_ON)}
            />
          </div>
          <div className="w-40">
            <NativeSelect
              value={product}
              onChange={(v) => { setProduct(v); setPage(1); }}
              options={['', ...(filterOptions?.products ?? [])]}
              placeholder="All products"
              className={cn(CONTROL, 'font-medium', product && CONTROL_ON)}
            />
          </div>
          <div className="w-36">
            <NativeSelect
              value={design}
              onChange={(v) => { setDesign(v); setPage(1); }}
              options={['', ...(filterOptions?.designs ?? [])]}
              placeholder="All designs"
              className={cn(CONTROL, 'font-medium', design && CONTROL_ON)}
            />
          </div>
          <div className="w-32">
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
              className="h-9 shrink-0 rounded-[4px] text-[12.5px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-400/10"
              onClick={resetFilters}
              title="Clear all filters"
            >
              <RotateCcw className="size-3.5" /> Reset
            </Button>
          )}
          <div className="ml-auto shrink-0">
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

      {/* One scroll region holds BOTH branches (desktop table / phone cards) — the
          desktop table renders at its natural height (no `fill`/height cap) exactly
          as before, it's just this wrapper that now scrolls instead of the page. */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-y-auto',
          '[&_[data-slot=table-container]]:overscroll-x-contain',
          '[&_[data-slot=table-container]]:[scrollbar-width:thin]',
          '[&_[data-slot=table-container]]:[scrollbar-color:var(--color-slate-400)_var(--color-slate-100)]',
        )}
      >
        <div className="hidden sm:block">
          <DataTable
            columns={cols.visibleColumns}
            rows={rows}
            rowKey={(r) => `${r.order.id}-${r.line.id}`}
            isLoading={isLoading}
            dense
            hideSortIcon
            emptyText="No order lines found."
            onRowClick={(r) => setEdit(r)}
            className={[
              'font-sans text-[13px]',
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

        {/* Phones: one card per order, its lines grouped underneath. */}
        <div className="sm:hidden">
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
                        <p className="truncate text-[14px] font-bold text-slate-900 dark:text-slate-100">{o.customerName}</p>
                      </div>
                      <StatusPill status={o.status} />
                    </div>
                    <p className="text-muted-foreground text-[11px] font-medium">
                      {formatDate(o.orderDate)} → {formatDate(o.completionDate)} · {lines.length} line{lines.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-white/10">
                    {lines.map((r) => {
                      const cancelled = r.line.status === 'CANCELLED';
                      return (
                        <div key={r.line.id} className="active:bg-muted cursor-pointer px-3 py-2" onClick={() => setEdit(r)}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className={cn('truncate text-[13px] font-bold', cancelled ? 'text-muted-foreground line-through' : 'text-slate-800 dark:text-slate-200')}>
                                {r.line.productName || r.line.product || '—'}
                              </p>
                              <p className="text-muted-foreground truncate text-[11px] font-medium">
                                {r.line.designType || '—'}
                                {r.line.priority === 'URGENT' && <span className="ml-1.5 font-bold text-rose-600 dark:text-rose-400">URGENT</span>}
                              </p>
                            </div>
                            <span className="shrink-0 text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">₹{(r.line.rate ?? 0).toLocaleString('en-IN')}</span>
                          </div>
                          <div className="mt-1 grid grid-cols-4 gap-1.5 text-[11px]">
                            {([['Bags', r.line.bags], ['Pcs', r.line.pcs], ['Kgs', r.line.gram], ['Box', r.line.box]] as const).map(([lbl, v]) => (
                              <div key={lbl}>
                                <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">{lbl}</p>
                                <p className="font-bold tabular-nums text-slate-700 dark:text-slate-200">{dash(v)}</p>
                              </div>
                            ))}
                          </div>
                          {r.line.comment && <p className="text-muted-foreground mt-1 truncate text-[11px]">{r.line.comment}</p>}
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
        <div className="ml-auto flex items-center gap-2">
          <p className="text-muted-foreground text-[12px] font-medium">
            Page <span className="font-bold tabular-nums text-foreground">{data?.page ?? page}</span> of{' '}
            <span className="font-bold tabular-nums text-foreground">{totalPages}</span>
          </p>
          <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <ChevronLeft /> Prev
          </Button>
          <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next <ChevronRight />
          </Button>
        </div>
      </div>

      <Sheet open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        {edit && (
          <LineEditor
            row={edit}
            orderTypes={orderTypeOptions}
            saving={save.isPending}
            onSave={(updated) => saveLine(edit.order, updated)}
            onAddAsNew={(newItem) => addLineAsNew(edit.order, newItem)}
            onDelete={() => deleteLine(edit.order, edit.line)}
            onViewFull={() => navigate(`/orders/${edit.order.id}/edit`)}
            onClose={() => setEdit(null)}
          />
        )}
      </Sheet>
    </div>
  );
}

/** Right slide-over form to edit a single order line. */
function LineEditor({
  row,
  orderTypes,
  saving,
  onSave,
  onAddAsNew,
  onDelete,
  onViewFull,
  onClose,
}: {
  row: Row;
  orderTypes: string[];
  saving: boolean;
  onSave: (updated: OrderItemDto) => void;
  /** Dispatched-line detour: append the edited details as a brand new line
   *  instead of touching the original (which the backend won't allow anyway). */
  onAddAsNew: (newItem: OrderItemDto) => void;
  onDelete: () => void;
  onViewFull: () => void;
  onClose: () => void;
}) {
  const { order, line } = row;
  const { can } = usePermissions();
  const confirm = useConfirm();
  const { data: lookups } = useOrderLookups();
  // Once the user has confirmed "add as a new item" (see submit()), the form
  // keeps whatever they typed but Save now creates a fresh line instead of
  // touching the dispatched original — it does NOT auto-submit on its own.
  const [addNewMode, setAddNewMode] = useState(false);
  const s = (v: number | null) => (v == null ? '' : String(v));
  const [form, setForm] = useState({
    itemName: line.productName ?? [line.product, line.designType].filter(Boolean).join(' '),
    product: line.product ?? '',
    designType: line.designType ?? '',
    designName: '',
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

  // Snapshot of the untouched form — Save stays disabled until something differs.
  const baseline = useRef(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline.current);
  // Quantity/rate/product fields — the exact set the backend freezes once a line
  // has been dispatched (status/priority/order-type/comment stay editable there).
  const MATERIAL_KEYS = ['itemName', 'product', 'designType', 'bags', 'pcs', 'gram', 'box', 'productRate', 'designRate'] as const;
  const materialDirty = MATERIAL_KEYS.some((k) => form[k] !== baseline.current[k]);

  // Composite "item name" choices — same dropdown as the New Order page:
  // each label is "{size} {product} {designType}".
  const itemOptions = useMemo(() => {
    const list = lookups?.items ?? [];
    const map = new Map<string, (typeof list)[number]>();
    const labels: string[] = [];
    for (const it of list) {
      const label = [it.size != null ? String(it.size) : '', it.product, it.designType ?? ''].filter(Boolean).join(' ');
      if (!label || map.has(label)) continue;
      map.set(label, it);
      labels.push(label);
    }
    return { labels, map };
  }, [lookups]);

  // Design names available for the current design-type code.
  const designChoices = useMemo(() => {
    const code = form.designType.trim().toUpperCase();
    if (!code) return [] as string[];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const dn of lookups?.designNames ?? []) {
      if (dn.designType.toUpperCase() === code && !seen.has(dn.designName)) {
        seen.add(dn.designName);
        names.push(dn.designName);
      }
    }
    return names;
  }, [lookups, form.designType]);
  const noDesignNames = designChoices.length === 0;

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
  const onItemPick = (label: string) => {
    const it = itemOptions.map.get(label);
    if (!it) {
      set({ itemName: label, product: label });
      return;
    }
    const realName = it.designName && it.designName !== it.designType ? it.designName : '';
    set({
      itemName: label,
      product: it.product,
      designType: it.designType ?? '',
      designName: realName,
      productRate: it.productRate != null ? String(it.productRate) : '',
      designRate: it.designType && it.designRate != null ? String(it.designRate) : '',
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
    product: form.product.trim() || null,
    designType: form.designType.trim() || null,
    productName: form.itemName.trim() || [form.product.trim(), form.designType.trim()].filter(Boolean).join(' ') || null,
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

  return (
    <SheetContent className="flex w-full max-w-md flex-col" onOpenAutoFocus={(e) => e.preventDefault()}>
      <SheetHeader>
        <SheetTitle>{addNewMode ? 'Add as a new item' : 'Edit item line'}</SheetTitle>
        <p className="text-muted-foreground truncate text-sm">
          {order.code ?? `#${order.id}`} · {order.customerName}
        </p>
      </SheetHeader>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {addNewMode && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            The original dispatched line stays untouched — review the details below and click{' '}
            <span className="font-semibold">Add as New Item</span> to save this as a separate line.
          </div>
        )}
        <Field label="Item name">
          <NativeSelect
            value={form.itemName}
            onChange={onItemPick}
            options={itemOptions.labels}
            placeholder="Item name"
            className="text-left"
            onInvalidEntry={() => toast.error('Please select a correct item')}
          />
        </Field>
        <Field label="Design Name">
          <NativeSelect
            value={noDesignNames ? 'NA' : form.designName}
            onChange={(v) => set({ designName: v })}
            options={noDesignNames ? ['NA'] : designChoices}
            placeholder="Design name"
            disabled={noDesignNames}
            onInvalidEntry={() => toast.error('Please select a correct design')}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Order type">
            <NativeSelect value={form.ordType} onChange={(v) => set({ ordType: v })} options={orderTypes} placeholder="Type…" />
          </Field>
          <Field label="Priority">
            <NativeSelect value={form.priority} onChange={(v) => set({ priority: v })} options={[...ORDER_PRIORITIES]} />
          </Field>
          <Field label="Bags">
            <Input type="number" step="any" value={form.bags} onKeyDown={onlyNum} onChange={(e) => set({ bags: e.target.value })} />
          </Field>
          <Field label="Pcs">
            <Input type="number" step="any" value={form.pcs} onKeyDown={onlyNum} onChange={(e) => set({ pcs: e.target.value })} />
          </Field>
          <Field label="Kgs">
            <Input type="number" step="any" value={form.gram} onKeyDown={onlyNum} onChange={(e) => set({ gram: e.target.value })} />
          </Field>
          <Field label="Box">
            <Input type="number" step="any" value={form.box} onKeyDown={onlyNum} onChange={(e) => set({ box: e.target.value })} />
          </Field>
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

      <SheetFooter className="justify-between">
        <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete} disabled={saving || addNewMode}>
          <Trash2 /> Delete
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={addNewMode ? () => setAddNewMode(false) : onClose} disabled={saving}>
            {addNewMode ? 'Back to editing' : 'Cancel'}
          </Button>
          <Button onClick={submit} disabled={saving || (!addNewMode && !dirty)}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} {addNewMode ? 'Add as New Item' : 'Save'}
          </Button>
        </div>
      </SheetFooter>
    </SheetContent>
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
