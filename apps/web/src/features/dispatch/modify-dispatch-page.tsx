import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DISPATCH_STATUSES, RESOURCES, type DispatchDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, shortDispatchCode, shortOrderCode } from '@/lib/utils';
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
  'PARTIALLY DISPATCH': 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25',
  'FULLY DISPATCH': 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25',
};
const STATUS_DOT: Record<string, string> = {
  'PARTIALLY DISPATCH': 'bg-amber-500',
  'FULLY DISPATCH': 'bg-emerald-500',
};
/** A status pill with a coloured dot — carries the state alongside the word. */
const StatusBadge = ({ s }: { s: string }) => (
  <span className={cn('inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-[11.5px] font-bold ring-1 ring-inset', STATUS_STYLE[s] ?? 'bg-muted text-muted-foreground ring-border')}>
    <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[s] ?? 'bg-slate-400')} />
    {s}
  </span>
);

/** Matches the Pending Challan / Challans / Orders grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

const COLUMNS: DataColumn<DispatchDto>[] = [
  { id: 'code', label: 'DIS#', pin: 'left0', pinWidthClass: 'sm:w-16 sm:min-w-16', fixed: true, cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums text-indigo-700 dark:text-indigo-300')}>{shortDispatchCode(d.code, d.id)}</span> },
  { id: 'date', label: 'Date', cell: (d) => <span className={cn(TEXT_CELL, 'whitespace-nowrap tabular-nums')}>{formatDate(d.dispatchDate)}</span> },
  { id: 'order', label: 'ORD#', cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{shortOrderCode(d.orderCode, d.orderId)}</span> },
  { id: 'customer', label: 'Customer', cell: (d) => <span className={TEXT_CELL}>{d.customerName}</span> },
  { id: 'product', label: 'Product', cell: (d) => <span className={TEXT_CELL}>{d.productName || d.product || '—'}</span> },
  { id: 'design', label: 'Design', cell: (d) => <span className={TEXT_CELL}>{d.designType || '—'}</span> },
  { id: 'bags', label: 'Bags', align: 'right', cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{qty(d.bags)}</span> },
  { id: 'pcs', label: 'Pcs', align: 'right', cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{qty(d.pcs)}</span> },
  { id: 'kgs', label: 'Kgs', align: 'right', cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{qty(d.gram)}</span> },
  { id: 'box', label: 'Box', align: 'right', cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{qty(d.box)}</span> },
  { id: 'status', label: 'Status', cell: (d) => <StatusBadge s={d.dispatchStatus} /> },
  { id: 'remarks', label: 'Remarks', cell: (d) => <span className="text-muted-foreground text-[13px] font-medium">{d.comment || '—'}</span> },
];

const money = (v: number | null) => (v == null ? '—' : `₹${v.toLocaleString('en-IN')}`);

/** Rate columns, shown only with `dispatch:viewrates`. Amount = rate × the
 *  dispatched quantity (pcs or kgs, per the line's calc field). */
const RATE_COLUMNS: DataColumn<DispatchDto>[] = [
  { id: 'productRate', label: 'Product ₹', align: 'right', cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(d.productRate)}</span> },
  { id: 'designRate', label: 'Design ₹', align: 'right', cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(d.designRate)}</span> },
  { id: 'rate', label: 'Rate ₹', align: 'right', cell: (d) => <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(d.rate)}</span> },
  {
    id: 'amount',
    label: 'Amount ₹',
    align: 'right',
    cell: (d) => {
      const q = (d.calField ?? '').toUpperCase() === 'PCS' ? d.pcs : d.gram;
      return <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(d.rate != null && q != null ? Math.round(d.rate * q) : null)}</span>;
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
            <span className="bg-primary/10 text-primary rounded-md px-2 py-0.5 font-mono text-[13px] font-bold">{shortDispatchCode(d.code, d.id)}</span>
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
  const [agentFilter, setAgentFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [designFilter, setDesignFilter] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DispatchDto | null>(null);
  const canViewRates = can('dispatch:viewrates');
  const columns = useMemo(() => (canViewRates ? withRates(COLUMNS) : COLUMNS), [canViewRates]);
  const cols = useColumnOrder('dispatch-modify', columns);
  const { format, setFormat } = useDateFormat();
  // Cascading options: pass the active filters so each dropdown only lists values
  // that still exist under the others.
  const { data: options } = useDispatchFilterOptions({
    status: statusFilter || undefined,
    customer: customerFilter || undefined,
    agent: agentFilter || undefined,
    product: productFilter || undefined,
    design: designFilter || undefined,
  });

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
    agent: agentFilter || undefined,
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
    // Fills the viewport: toolbar pinned on top, footer pinned at the bottom, only
    // the list scrolls. `/dispatch` is a flush route (app-shell), so the page owns
    // its own padding. Mobile keeps its own tap-to-edit card list untouched.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      {/* ── Toolbar: search + filters, then column settings — one card. */}
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="grid grid-cols-2 gap-2 p-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-2.5 sm:p-3">
          <div className="relative col-span-2 sm:w-56">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search #, customer, item, design or remark…"
              className={cn(CONTROL, 'pl-8 font-medium', searchInput && CONTROL_ON)}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="sm:w-40">
            <NativeSelect value={productFilter} onChange={(v) => { setProductFilter(v); setPage(1); }} options={['', ...(options?.products ?? [])]} placeholder="All items" className={cn(CONTROL, 'font-medium', productFilter && CONTROL_ON)} />
          </div>
          <div className="sm:w-40">
            <NativeSelect value={customerFilter} onChange={(v) => { setCustomerFilter(v); setPage(1); }} options={['', ...(options?.customers ?? [])]} placeholder="All customers" className={cn(CONTROL, 'font-medium', customerFilter && CONTROL_ON)} />
          </div>
          <div className="sm:w-36">
            <NativeSelect value={agentFilter} onChange={(v) => { setAgentFilter(v); setPage(1); }} options={['', ...(options?.agents ?? [])]} placeholder="All agents" className={cn(CONTROL, 'font-medium', agentFilter && CONTROL_ON)} />
          </div>
          <div className="sm:w-36">
            <NativeSelect value={designFilter} onChange={(v) => { setDesignFilter(v); setPage(1); }} options={['', ...(options?.designs ?? [])]} placeholder="All designs" className={cn(CONTROL, 'font-medium', designFilter && CONTROL_ON)} />
          </div>
          <div className="sm:w-36">
            <NativeSelect value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} options={['', ...DISPATCH_STATUSES]} placeholder="All statuses" className={cn(CONTROL, 'font-medium', statusFilter && CONTROL_ON)} />
          </div>
          <div className="col-span-2 ml-auto sm:col-span-1">
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

      {/* One scroll region holds BOTH branches — the desktop table renders at its
          natural height (no `fill`), it's just this wrapper that scrolls now. */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-y-auto',
          '[&_[data-slot=table-container]]:overscroll-x-contain',
          '[&_[data-slot=table-container]]:[scrollbar-width:thin]',
          '[&_[data-slot=table-container]]:[scrollbar-color:var(--color-slate-400)_var(--color-slate-100)]',
        )}
      >
        {/* Desktop: the data table. */}
        <div className="hidden sm:block">
          <DataTable
            columns={cols.visibleColumns}
            rows={items}
            rowKey={(d) => d.id}
            isLoading={isLoading}
            dense
            hideSortIcon
            emptyText="No dispatch records yet."
            onRowClick={(d) => can('dispatch:update') && setEditing(d)}
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
            actions={(d) => (
              <div className="flex justify-end gap-1">
                <RecordHistory resource={RESOURCES.DISPATCH} resourceId={d.id} label={d.code ?? `#${d.id}`} />
                {can('dispatch:update') && (
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(d)} aria-label="Edit" title="Edit">
                    <Pencil className="size-4" />
                  </Button>
                )}
                {can('dispatch:delete') && (
                  <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => handleDelete(d)} aria-label="Delete" title="Delete">
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            )}
          />
        </div>

        {/* Phones: card list mirroring the dispatch-order cards — untouched. */}
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
      </div>

      {/* ── Footer: paging ─────────────────────────────────────────────────────── */}
      <div className="bg-card flex items-center justify-between rounded-[4px] border px-3 py-2 shadow-sm">
        <p className="text-muted-foreground text-[12px] font-medium">
          Page <span className="font-bold tabular-nums text-foreground">{data?.page ?? page}</span> of{' '}
          <span className="font-bold tabular-nums text-foreground">{totalPages}</span>
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <ChevronLeft /> Prev
          </Button>
          <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
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
