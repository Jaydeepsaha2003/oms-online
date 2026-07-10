import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Save, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { OrderDto, OrderInput, OrderItemDto } from '@oms/shared';
import { ORDER_PRIORITIES } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { shortOrderCode } from '@/lib/utils';
import { DATE_FORMATS, formatDate, useDateFormat } from '@/lib/date-format';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/common/combo';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { settingValues, useSettings } from '@/features/settings/use-settings';
import { usePermissions } from '@/hooks/use-permissions';
import { useOrderLookups, useOrders, useSaveOrder } from './use-orders';
import { LiveLinePhotos } from './line-photos';

const PAGE_SIZE = 50;

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  CANCELLED: 'bg-rose-50 text-rose-700 ring-rose-200',
};

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
  { id: 'orderId', label: 'Order ID', fixed: true, cell: (r) => <span className="font-mono font-semibold">{shortOrderCode(r.order.code, r.order.id)}</span> },
  { id: 'orderDate', label: 'Order Date', cell: (r) => <span className="whitespace-nowrap">{formatDate(r.order.orderDate)}</span> },
  { id: 'dueDate', label: 'Due Date', cell: (r) => <span className="whitespace-nowrap">{formatDate(r.order.completionDate)}</span> },
  { id: 'customer', label: 'Customer Name', cell: (r) => <span className="font-medium">{r.order.customerName}</span> },
  {
    id: 'product',
    label: 'Product Name',
    cell: (r) => (
      <span className={r.line.status === 'CANCELLED' ? 'text-muted-foreground font-medium line-through' : 'font-medium'}>
        {r.line.productName || r.line.product || '—'}
      </span>
    ),
  },
  { id: 'designType', label: 'Design Type', cell: (r) => r.line.designType || '—' },
  {
    id: 'priority',
    label: 'Priority',
    cell: (r) => (r.line.priority === 'URGENT' ? <span className="font-semibold text-rose-600">URGENT</span> : r.line.priority || '—'),
  },
  { id: 'bags', label: 'Bags', align: 'right', cell: (r) => <span className="tabular-nums">{dash(r.line.bags)}</span> },
  { id: 'pcs', label: 'Pcs', align: 'right', cell: (r) => <span className="tabular-nums">{dash(r.line.pcs)}</span> },
  { id: 'kgs', label: 'Kgs', align: 'right', cell: (r) => <span className="tabular-nums">{dash(r.line.gram)}</span> },
  { id: 'box', label: 'Box', align: 'right', cell: (r) => <span className="tabular-nums">{dash(r.line.box)}</span> },
  { id: 'rate', label: 'Rate', align: 'right', cell: (r) => <span className="font-semibold tabular-nums text-emerald-700">₹{(r.line.rate ?? 0).toLocaleString('en-IN')}</span> },
  { id: 'comment', label: 'Comment', cell: (r) => <span className="inline-block max-w-[12rem] truncate align-middle" title={r.line.comment ?? ''}>{r.line.comment || '—'}</span> },
  {
    id: 'status',
    label: 'Status',
    cell: (r) => {
      const cancelled = r.line.status === 'CANCELLED';
      const label = cancelled ? 'CANCELLED' : r.order.status;
      const style = cancelled ? STATUS_STYLE.CANCELLED : STATUS_STYLE[r.order.status] ?? 'bg-muted text-muted-foreground ring-border';
      return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ${style}`}>{label}</span>;
    },
  },
];

export function OrderModifyPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useOrders({ page, pageSize: PAGE_SIZE, search: search || undefined });
  const save = useSaveOrder();
  const { data: settings } = useSettings();
  const orderTypeOptions = useMemo(() => settingValues(settings, 'ORDER_TYPE'), [settings]);
  const cols = useColumnOrder('order-modify', COLUMNS);
  const { format, setFormat } = useDateFormat();

  const [edit, setEdit] = useState<Row | null>(null);

  // Draft orders are work-in-progress and stay hidden from Order Modify.
  const orders = useMemo(() => (data?.items ?? []).filter((o) => o.status !== 'DRAFT'), [data]);
  const totalPages = data?.totalPages ?? 1;

  // Flatten every order's lines into a single list (order info repeats per line).
  const rows = useMemo<Row[]>(() => orders.flatMap((order) => order.items.map((line) => ({ order, line }))), [orders]);

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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Order Modify</h2>
          <p className="text-muted-foreground text-sm">Every order line in one place — click a row to edit it.</p>
        </div>
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

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          placeholder="Search order #, customer or agent…"
          className="pl-9"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value.trim());
            setPage(1);
          }}
        />
      </div>

      <DataTable
        columns={cols.visibleColumns}
        rows={rows}
        rowKey={(r) => `${r.order.id}-${r.line.id}`}
        isLoading={isLoading}
        dense
        // Larger, easy-to-read data font (columns still auto-fit their content).
        className="text-[16px] [&_thead_th]:text-[14px] [&_td]:py-1.5 [&_th]:py-2 [&_tbody_button]:size-8"
        emptyText="No order lines found."
        onRowClick={(r) => setEdit(r)}
      />

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {rows.length} line(s) across {orders.length} order(s) · page {data?.page ?? page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <ChevronLeft /> Prev
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
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
  onDelete,
  onViewFull,
  onClose,
}: {
  row: Row;
  orderTypes: string[];
  saving: boolean;
  onSave: (updated: OrderItemDto) => void;
  onDelete: () => void;
  onViewFull: () => void;
  onClose: () => void;
}) {
  const { order, line } = row;
  const { can } = usePermissions();
  const { data: lookups } = useOrderLookups();
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

  const submit = () => {
    onSave({
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
  };

  return (
    <SheetContent className="flex w-full max-w-md flex-col" onOpenAutoFocus={(e) => e.preventDefault()}>
      <SheetHeader>
        <SheetTitle>Edit item line</SheetTitle>
        <p className="text-muted-foreground truncate text-sm">
          {order.code ?? `#${order.id}`} · {order.customerName}
        </p>
      </SheetHeader>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
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
        <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete} disabled={saving}>
          <Trash2 /> Delete
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !dirty}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
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
