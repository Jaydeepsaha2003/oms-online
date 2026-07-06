import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DISPATCH_STATUSES, type DispatchDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, formatDateShort, shortOrderCode } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
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
  { id: 'date', label: 'Date', cell: (d) => <span className="whitespace-nowrap">{formatDateShort(d.dispatchDate)}</span> },
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
  const cols = useColumnOrder('dispatch-modify', COLUMNS);
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
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input placeholder="Search #, customer, item, design or remark…" className="pl-9" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <div className="w-44">
          <NativeSelect value={productFilter} onChange={(v) => { setProductFilter(v); setPage(1); }} options={['', ...(options?.products ?? [])]} placeholder="All items" />
        </div>
        <div className="w-44">
          <NativeSelect value={customerFilter} onChange={(v) => { setCustomerFilter(v); setPage(1); }} options={['', ...(options?.customers ?? [])]} placeholder="All customers" />
        </div>
        <div className="w-40">
          <NativeSelect value={designFilter} onChange={(v) => { setDesignFilter(v); setPage(1); }} options={['', ...(options?.designs ?? [])]} placeholder="All designs" />
        </div>
        <div className="w-40">
          <NativeSelect value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} options={['', ...DISPATCH_STATUSES]} placeholder="All statuses" />
        </div>
      </div>

      <DataTable
        columns={cols.visibleColumns}
        rows={items}
        rowKey={(d) => d.id}
        isLoading={isLoading}
        dense
        maxBodyHeight="max-h-[calc(100dvh-16rem)]"
        emptyText="No dispatch records yet."
        onRowClick={(d) => can('dispatch:update') && setEditing(d)}
        actions={(d) => (
          <div className="flex justify-end gap-1">
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
