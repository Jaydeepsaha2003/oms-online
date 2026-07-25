import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DISPATCH_STATUSES, RESOURCES, type DispatchDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, shortOrderCode } from '@/lib/utils';
import { DATE_FORMATS, formatDate, useDateFormat } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { RecordHistory } from '@/components/common/record-history';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDeleteDispatch, useDispatches, useDispatchFilterOptions, useUpdateDispatch } from './use-dispatch';

const PAGE_SIZE = 50;
const num = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? 0 : Number(s));
const qty = (v: number | null) => (v ? v.toLocaleString('en-IN') : '—');

const STATUS_STYLE: Record<string, string> = {
  'PARTIALLY DISPATCH': 'bg-amber-50 text-amber-700 ring-amber-200',
  'FULLY DISPATCH': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};
const StatusBadge = ({ s }: { s: string }) => (
  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', STATUS_STYLE[s] ?? 'bg-muted')}>{s}</span>
);

const COLUMNS: DataColumn<DispatchDto>[] = [
  { id: 'code', label: 'Dispatch #', pin: 'left0', fixed: true, cell: (d) => <span className="font-mono text-xs font-medium">{d.code ?? `#${d.id}`}</span> },
  { id: 'date', label: 'Date', cell: (d) => <span className="whitespace-nowrap">{formatDate(d.dispatchDate)}</span> },
  { id: 'order', label: 'Order #', cell: (d) => <span className="font-mono text-xs">{shortOrderCode(d.orderCode, d.orderId)}</span> },
  { id: 'customer', label: 'Customer', cell: (d) => <span className="font-medium">{d.customerName}</span> },
  { id: 'product', label: 'Product', cell: (d) => <span className="font-medium">{d.productName || d.product || '—'}</span> },
  { id: 'design', label: 'Design', cell: (d) => d.designType || '—' },
  { id: 'bags', label: 'Bags', align: 'right', cell: (d) => <span className="tabular-nums">{qty(d.bags)}</span> },
  { id: 'pcs', label: 'Pcs', align: 'right', cell: (d) => <span className="tabular-nums">{qty(d.pcs)}</span> },
  { id: 'kgs', label: 'Kgs', align: 'right', cell: (d) => <span className="tabular-nums">{qty(d.gram)}</span> },
  { id: 'box', label: 'Box', align: 'right', cell: (d) => <span className="tabular-nums">{qty(d.box)}</span> },
  { id: 'status', label: 'Status', cell: (d) => <StatusBadge s={d.dispatchStatus} /> },
  { id: 'remarks', label: 'Remarks', cell: (d) => <span className="text-muted-foreground">{d.comment || '—'}</span> },
];

const money = (v: number | null) => (v == null ? '—' : `₹${v.toLocaleString('en-IN')}`);

/** Rate columns, shown only with `dispatch:viewrates`. Amount = rate × the
 *  dispatched quantity (pcs or kgs, per the line's calc field). */
const RATE_COLUMNS: DataColumn<DispatchDto>[] = [
  { id: 'productRate', label: 'Product ₹', align: 'right', cell: (d) => <span className="tabular-nums">{money(d.productRate)}</span> },
  { id: 'designRate', label: 'Design ₹', align: 'right', cell: (d) => <span className="tabular-nums">{money(d.designRate)}</span> },
  { id: 'rate', label: 'Rate ₹', align: 'right', cell: (d) => <span className="font-semibold tabular-nums">{money(d.rate)}</span> },
  {
    id: 'amount',
    label: 'Amount ₹',
    align: 'right',
    cell: (d) => {
      const q = (d.calField ?? '').toUpperCase() === 'PCS' ? d.pcs : d.gram;
      return <span className="tabular-nums">{money(d.rate != null && q != null ? Math.round(d.rate * q) : null)}</span>;
    },
  },
];

/** Insert rate columns just before the Remarks column (their default slot). */
const withRates = (cols: DataColumn<DispatchDto>[]): DataColumn<DispatchDto>[] => {
  const at = cols.findIndex((c) => c.id === 'remarks');
  const i = at < 0 ? cols.length : at;
  return [...cols.slice(0, i), ...RATE_COLUMNS, ...cols.slice(i)];
};

const MODIFY_CARD_CSS = `
.mdisp-card-in { animation: mdispIn .3s cubic-bezier(.22,1,.36,1) both; }
@keyframes mdispIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .mdisp-card-in { animation: none; } }
`;

/** Phone card for one dispatch record — the readable, tappable equivalent of a
 *  table row, with inline Edit / Delete actions matching the user's permissions. */
function ModifyDispatchCard({
  d,
  index,
  canEdit,
  canDelete,
  showRates,
  onEdit,
  onDelete,
}: {
  d: DispatchDto;
  index: number;
  canEdit: boolean;
  canDelete: boolean;
  showRates: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const qtys = ([['Bags', d.bags], ['Pcs', d.pcs], ['Kgs', d.gram], ['Box', d.box]] as const).filter(([, v]) => v && v > 0);
  const amount = d.rate != null ? Math.round(d.rate * ((d.calField ?? '').toUpperCase() === 'PCS' ? (d.pcs ?? 0) : (d.gram ?? 0))) : null;
  return (
    <div className="mdisp-card-in bg-card relative overflow-hidden rounded-2xl border shadow-sm" style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
      <div className="space-y-2.5 p-3.5 text-[13px]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="bg-primary/10 text-primary rounded-md px-2 py-0.5 font-mono text-[13px] font-bold">{d.code ?? `#${d.id}`}</span>
            <span className="text-muted-foreground font-mono text-[12px]">{shortOrderCode(d.orderCode, d.orderId)}</span>
          </div>
          <StatusBadge s={d.dispatchStatus} />
        </div>

        <div>
          <p className="truncate text-[16px] font-semibold leading-tight">{d.customerName}</p>
          <p className="text-muted-foreground mt-0.5 text-[12px]">{formatDate(d.dispatchDate)}</p>
        </div>

        <div className="bg-muted/50 rounded-lg px-3 py-1.5">
          <p className="text-[14.5px] leading-snug font-semibold">{d.productName || d.product || '—'}</p>
          {d.designType && d.designType.toUpperCase() !== 'NA' && <p className="text-muted-foreground text-[12px]">{d.designType}</p>}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {qtys.length ? (
            qtys.map(([label, v]) => (
              <span key={label} className="border-primary/15 bg-primary/5 text-primary inline-flex items-baseline gap-1 rounded-full border px-2.5 py-1">
                <span className="text-[11px] font-semibold uppercase opacity-70">{label}</span>
                <span className="text-[14px] font-bold tabular-nums">{qty(v)}</span>
              </span>
            ))
          ) : (
            <span className="text-muted-foreground text-[13px]">No quantities</span>
          )}
        </div>

        {showRates && (
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-[12px]">
            <span>Rate <span className="text-foreground font-semibold tabular-nums">{money(d.rate)}</span></span>
            <span>Amount <span className="text-foreground font-semibold tabular-nums">{money(amount)}</span></span>
          </div>
        )}

        {d.comment && <p className="text-muted-foreground text-[12.5px] leading-snug">{d.comment}</p>}
      </div>

      {(canEdit || canDelete) && (
        <div className="flex border-t text-[13px] font-semibold">
          {canEdit && (
            <button type="button" onClick={onEdit} className="text-primary active:bg-primary/5 flex flex-1 items-center justify-center gap-1.5 py-2.5 transition-colors">
              <Pencil className="size-4" /> Edit
            </button>
          )}
          {canEdit && canDelete && <div className="bg-border w-px" />}
          {canDelete && (
            <button type="button" onClick={onDelete} className="text-destructive active:bg-destructive/5 flex flex-1 items-center justify-center gap-1.5 py-2.5 transition-colors">
              <Trash2 className="size-4" /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ModifyDispatchPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [designFilter, setDesignFilter] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DispatchDto | null>(null);
  const canViewRates = can('dispatch:viewrates');
  const columns = useMemo(() => (canViewRates ? withRates(COLUMNS) : COLUMNS), [canViewRates]);
  const cols = useColumnOrder('dispatch-modify', columns);
  const { format, setFormat } = useDateFormat();
  const { data: options } = useDispatchFilterOptions();

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    status: statusFilter || undefined,
    customer: customerFilter || undefined,
    product: productFilter || undefined,
    design: designFilter || undefined,
  };
  const { data, isLoading } = useDispatches(query);
  const del = useDeleteDispatch();
  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const handleDelete = async (d: DispatchDto) => {
    const ok = await confirm({
      title: 'Delete dispatch?',
      description: `${d.code ?? `#${d.id}`} will be removed and its quantity returned to the pending list.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(d.id, {
      onSuccess: () => toast.success('Dispatch deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Modify Dispatch</h2>
          <p className="text-muted-foreground text-sm">{data?.total ?? 0} dispatch record(s) · edit or delete</p>
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

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="relative col-span-2 sm:w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input placeholder="Search #, customer, item, design or remark…" className="pl-9" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <div className="sm:w-44">
          <NativeSelect value={productFilter} onChange={(v) => { setProductFilter(v); setPage(1); }} options={['', ...(options?.products ?? [])]} placeholder="All items" />
        </div>
        <div className="sm:w-44">
          <NativeSelect value={customerFilter} onChange={(v) => { setCustomerFilter(v); setPage(1); }} options={['', ...(options?.customers ?? [])]} placeholder="All customers" />
        </div>
        <div className="sm:w-40">
          <NativeSelect value={designFilter} onChange={(v) => { setDesignFilter(v); setPage(1); }} options={['', ...(options?.designs ?? [])]} placeholder="All designs" />
        </div>
        <div className="sm:w-40">
          <NativeSelect value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} options={['', ...DISPATCH_STATUSES]} placeholder="All statuses" />
        </div>
      </div>

      {/* Desktop: the data table. */}
      <div className="hidden sm:block">
        <DataTable
          columns={cols.visibleColumns}
          rows={items}
          rowKey={(d) => d.id}
          isLoading={isLoading}
          dense
          emptyText="No dispatch records yet."
          onRowClick={(d) => can('dispatch:update') && setEditing(d)}
          actions={(d) => (
            <div className="flex justify-end gap-1">
              <RecordHistory resource={RESOURCES.DISPATCH} resourceId={d.id} label={d.code ?? `#${d.id}`} />
              {can('dispatch:update') && (
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(d)} aria-label="Edit" title="Edit">
                  <Pencil className="size-4" />
                </Button>
              )}
              {can('dispatch:delete') && (
                <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => handleDelete(d)} aria-label="Delete" title="Delete">
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          )}
        />
      </div>

      {/* Phones: card list mirroring the dispatch-order cards. */}
      <div className="space-y-3 sm:hidden">
        <style>{MODIFY_CARD_CSS}</style>
        {isLoading ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="bg-muted/40 h-44 animate-pulse rounded-2xl border" />)
        ) : items.length === 0 ? (
          <div className="text-muted-foreground rounded-2xl border border-dashed bg-card px-4 py-12 text-center text-sm">No dispatch records yet.</div>
        ) : (
          items.map((d, i) => (
            <ModifyDispatchCard
              key={d.id}
              d={d}
              index={i}
              canEdit={can('dispatch:update')}
              canDelete={can('dispatch:delete')}
              showRates={canViewRates}
              onEdit={() => setEditing(d)}
              onDelete={() => handleDelete(d)}
            />
          ))
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">Page {data?.page ?? page} of {totalPages}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <ChevronLeft /> Prev
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next <ChevronRight />
          </Button>
        </div>
      </div>

      {editing && <EditDispatchDialog dispatch={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditDispatchDialog({ dispatch, onClose }: { dispatch: DispatchDto; onClose: () => void }) {
  const update = useUpdateDispatch(dispatch.id);
  const s = (v: number | null) => (v == null ? '' : String(v));
  const [form, setForm] = useState({
    bags: s(dispatch.bags),
    pcs: s(dispatch.pcs),
    gram: s(dispatch.gram),
    box: s(dispatch.box),
    dispatchStatus: dispatch.dispatchStatus,
    comment: dispatch.comment ?? '',
    supItem: dispatch.supItem ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = () => {
    const cf = (dispatch.calField ?? '').toUpperCase();
    if (cf === 'PCS' && num(form.pcs) <= 0) return toast.error('Pcs is required — this item is priced by PCS.');
    if (cf === 'KGS' && num(form.gram) <= 0) return toast.error('Kgs is required to dispatch this item.');
    update.mutate(
      {
        bags: num(form.bags),
        pcs: num(form.pcs),
        gram: num(form.gram),
        box: num(form.box),
        dispatchStatus: form.dispatchStatus,
        comment: form.comment.trim() || null,
        supItem: form.supItem.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success('Dispatch updated');
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Update failed')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {dispatch.code ?? `#${dispatch.id}`}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="bg-muted/40 rounded-lg border p-3 text-sm">
            <div className="font-medium">{dispatch.productName || dispatch.product}{dispatch.designType ? ` · ${dispatch.designType}` : ''}</div>
            <div className="text-muted-foreground">{dispatch.customerName} · {shortOrderCode(dispatch.orderCode, dispatch.orderId)}</div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {(['bags', 'pcs', 'gram', 'box'] as const).map((k, i) => (
              <div key={k} className="space-y-1">
                <Label className="text-xs">{['Bags', 'Pcs', 'Kgs', 'Box'][i]}</Label>
                <Input type="number" step="any" className="text-right tabular-nums" value={form[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<typeof form>)} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Dispatch status</Label>
              <NativeSelect value={form.dispatchStatus} onChange={(v) => set({ dispatchStatus: v === 'FULLY DISPATCH' ? 'FULLY DISPATCH' : 'PARTIALLY DISPATCH' })} options={[...DISPATCH_STATUSES]} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Supplementary</Label>
              <Input value={form.supItem} onChange={(e) => set({ supItem: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Dispatch remarks</Label>
            <Input value={form.comment} onChange={(e) => set({ comment: e.target.value })} placeholder="Dispatch remark…" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={update.isPending}>
            {update.isPending ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModifyDispatchPage;
