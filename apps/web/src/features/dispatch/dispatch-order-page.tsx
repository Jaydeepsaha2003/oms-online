import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Package, PackageCheck, Search, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { DISPATCH_STATUSES, type DispatchStatus, type PendingLineDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, shortOrderCode } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useCreateDispatch, usePendingFilterOptions, usePendingOrders } from './use-dispatch';

const PAGE_SIZE = 50;
const num = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? 0 : Number(s));
const qty = (v: number | null) => (v ? v.toLocaleString('en-IN') : '—');

const DueBadge = ({ t }: { t: string }) => (
  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', t === 'Over Due' ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200')}>
    {t}
  </span>
);

const COLUMNS: DataColumn<PendingLineDto>[] = [
  { id: 'order', label: 'Order #', pin: 'left0', fixed: true, cell: (r) => <span className="font-mono text-xs font-medium">{shortOrderCode(r.orderCode, r.orderId)}</span> },
  { id: 'orderDate', label: 'Order date', cell: (r) => <span className="whitespace-nowrap">{formatDate(r.orderDate)}</span> },
  { id: 'due', label: 'Due', cell: (r) => <span className="flex items-center gap-2 whitespace-nowrap">{formatDate(r.dueDate)} <DueBadge t={r.dueType} /></span> },
  { id: 'customer', label: 'Customer', cell: (r) => <span className="font-medium">{r.customerName}</span> },
  { id: 'product', label: 'Product', cell: (r) => <span className="font-medium">{r.productName || r.product || '—'}</span> },
  { id: 'design', label: 'Design', cell: (r) => r.designType || '—' },
  { id: 'priority', label: 'Priority', cell: (r) => (r.priority === 'URGENT' ? <span className="font-semibold text-rose-600">URGENT</span> : r.priority || '—') },
  { id: 'bags', label: 'Bags', align: 'right', cell: (r) => <span className="tabular-nums">{qty(r.remBags)}</span> },
  { id: 'pcs', label: 'Pcs', align: 'right', cell: (r) => <span className="tabular-nums">{qty(r.remPcs)}</span> },
  { id: 'kgs', label: 'Kgs', align: 'right', cell: (r) => <span className="tabular-nums">{qty(r.remKgs)}</span> },
  { id: 'box', label: 'Box', align: 'right', cell: (r) => <span className="tabular-nums">{qty(r.remBox)}</span> },
  { id: 'comment', label: 'Comment', cell: (r) => <span className="text-muted-foreground">{r.comment || '—'}</span> },
];

export function DispatchOrderPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dueType, setDueType] = useState('');
  const [customer, setCustomer] = useState('');
  const [product, setProduct] = useState('');
  const [design, setDesign] = useState('');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<PendingLineDto | null>(null);
  const [shipped, setShipped] = useState<string | null>(null); // dispatch code → plays the truck animation

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data: options } = usePendingFilterOptions();
  const query = {
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    dueType: dueType || undefined,
    customer: customer || undefined,
    product: product || undefined,
    design: design || undefined,
  };
  const { data, isLoading } = usePendingOrders(query);
  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const cols = useColumnOrder('dispatch-pending', COLUMNS);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
            <Truck className="size-5" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Dispatch Order</h2>
            <p className="text-muted-foreground text-sm">{data?.total ?? 0} pending line(s) · click a row to dispatch</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <div className="relative w-full sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input placeholder="Search order #, customer or product…" className="pl-9" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <div className="w-40">
            <NativeSelect value={dueType} onChange={(v) => { setDueType(v); setPage(1); }} options={['', 'Due', 'Over Due']} placeholder="All due" />
          </div>
          <div className="w-64">
            <NativeSelect value={customer} onChange={(v) => { setCustomer(v); setPage(1); }} options={['', ...(options?.customers ?? [])]} placeholder="All customers" />
          </div>
          <div className="w-64">
            <NativeSelect value={product} onChange={(v) => { setProduct(v); setPage(1); }} options={['', ...(options?.products ?? [])]} placeholder="All products" />
          </div>
          <div className="w-40">
            <NativeSelect value={design} onChange={(v) => { setDesign(v); setPage(1); }} options={['', ...(options?.designs ?? [])]} placeholder="All designs" />
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
      </div>

      <DataTable
        columns={cols.visibleColumns}
        rows={items}
        rowKey={(r) => r.orderItemId}
        isLoading={isLoading}
        dense
        maxBodyHeight="max-h-[calc(100dvh-16rem)]"
        // Compact, readable data font; columns still auto-fit their content.
        className="text-[13px] [&_thead_th]:h-9 [&_thead_th]:text-[12px] [&_td]:px-3 [&_td]:py-1.5 [&_th]:px-3 [&_tbody_button]:size-7"
        emptyText="No pending order lines — everything is dispatched."
        onRowClick={(r) => setActive(r)}
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

      <Sheet open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        {active && (
          <DispatchSheet
            line={active}
            onClose={() => setActive(null)}
            onDispatched={(code) => {
              setActive(null);
              setShipped(code);
            }}
          />
        )}
      </Sheet>

      {shipped !== null && <DispatchTruckAnimation code={shipped} onDone={() => setShipped(null)} />}
    </div>
  );
}

/** Brief full-screen "out for delivery" animation shown after a dispatch is saved. */
const DISPATCH_ANIM_CSS = `
.dispatch-truck { animation: dispatch-drive 1.75s cubic-bezier(.45,0,.25,1) forwards; }
.dispatch-parcel { display:inline-block; animation: dispatch-bounce .5s ease-in-out infinite; }
.dispatch-road { background-image: repeating-linear-gradient(to right, #cbd5e1 0 14px, transparent 14px 28px); animation: dispatch-road .22s linear infinite; }
.dispatch-text { animation: dispatch-fade .45s ease-out .55s both; }
@keyframes dispatch-drive {
  0%   { transform: translateX(-70px); opacity: 0; }
  16%  { opacity: 1; }
  52%  { transform: translateX(120px); }
  58%  { transform: translateX(112px); }
  64%  { transform: translateX(120px); }
  100% { transform: translateX(330px); opacity: 0; }
}
@keyframes dispatch-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
@keyframes dispatch-road { from { background-position-x: 0; } to { background-position-x: -28px; } }
@keyframes dispatch-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .dispatch-truck, .dispatch-parcel, .dispatch-road, .dispatch-text { animation: none !important; }
}`;

function DispatchTruckAnimation({ code, onDone }: { code: string; onDone: () => void }) {
  // Bind the timer once — re-renders (e.g. the pending list refetching) must not reset it.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const t = window.setTimeout(() => onDoneRef.current(), 1950);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="bg-background/70 animate-in fade-in fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm duration-200">
      <style>{DISPATCH_ANIM_CSS}</style>
      <div className="flex flex-col items-center gap-5">
        <div className="relative h-28 w-72 overflow-hidden">
          <div className="dispatch-road absolute right-0 bottom-3 left-0 h-1 rounded" />
          <div className="dispatch-truck absolute bottom-4 left-0 flex items-end gap-1">
            <span className="dispatch-parcel mb-1">
              <Package className="size-7 text-amber-500" strokeWidth={2} />
            </span>
            <Truck className="text-primary size-16" strokeWidth={1.6} />
          </div>
        </div>
        <div className="dispatch-text flex flex-col items-center gap-1">
          <div className="flex items-center gap-2 text-lg font-bold text-emerald-700">
            <PackageCheck className="size-6" /> Dispatched!
          </div>
          {code && <span className="text-muted-foreground font-mono text-sm">{code}</span>}
        </div>
      </div>
    </div>
  );
}

const QTY_FIELDS = [
  ['bags', 'Bags', 'remBags'],
  ['pcs', 'Pcs', 'remPcs'],
  ['gram', 'Kgs', 'remKgs'],
  ['box', 'Box', 'remBox'],
] as const;

/** Right slide-over to dispatch a pending order line. Qty fields start blank. */
function DispatchSheet({ line, onClose, onDispatched }: { line: PendingLineDto; onClose: () => void; onDispatched: (code: string) => void }) {
  const create = useCreateDispatch();
  const confirm = useConfirm();
  const [form, setForm] = useState({
    bags: '',
    pcs: '',
    gram: '',
    box: '',
    dispatchStatus: 'PARTIALLY DISPATCH' as DispatchStatus,
    comment: '',
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const dispatchAll = () =>
    set({
      bags: String(line.remBags || ''),
      pcs: String(line.remPcs || ''),
      gram: String(line.remKgs || ''),
      box: String(line.remBox || ''),
      dispatchStatus: 'FULLY DISPATCH',
    });

  const submit = async () => {
    const bags = num(form.bags), pcs = num(form.pcs), gram = num(form.gram), box = num(form.box);
    const cf = (line.calField ?? '').toUpperCase();
    if (cf === 'PCS' && pcs <= 0) return toast.error('Pcs is required — this item is priced by PCS.');
    if (cf === 'KGS' && gram <= 0) return toast.error('Kgs is required to dispatch this item.');
    if (cf !== 'PCS' && cf !== 'KGS' && bags <= 0 && pcs <= 0 && gram <= 0 && box <= 0) return toast.error('Enter at least one quantity to dispatch');
    if (form.dispatchStatus === 'FULLY DISPATCH') {
      const ok = await confirm({
        title: 'Fully dispatch this line?',
        description: `${line.productName || line.product} for ${line.customerName} will be closed (no longer pending).`,
        confirmText: 'Dispatch fully',
      });
      if (!ok) return;
    }
    create.mutate(
      { orderItemId: line.orderItemId, bags, pcs, gram, box, dispatchStatus: form.dispatchStatus, comment: form.comment.trim() || null },
      {
        onSuccess: (d) => onDispatched(d.code ?? ''),
        onError: (e) => toast.error(getApiErrorMessage(e, 'Dispatch failed')),
      },
    );
  };

  // Ctrl/Cmd+S saves the dispatch (bound once; always calls the latest submit).
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <SheetContent className="flex w-full max-w-lg flex-col">
      <SheetHeader>
        <SheetTitle>Dispatch — {shortOrderCode(line.orderCode, line.orderId)}</SheetTitle>
        <p className="text-muted-foreground truncate text-sm">{line.customerName}</p>
      </SheetHeader>

      {/* px + negative margin gives the inputs' focus ring room to paint into the
          sheet's padding instead of being clipped by overflow-y-auto. */}
      <div className="-mx-1.5 flex-1 space-y-4 overflow-y-auto px-1.5 pt-2 pb-1.5">
        <div className="bg-muted/40 rounded-lg border p-3 text-sm">
          <div className="font-medium">
            {line.productName || line.product}
            {line.designType ? ` · ${line.designType}` : ''}
          </div>
          <div className="text-muted-foreground">{line.calField ? `Priced by ${line.calField}` : ''}</div>
        </div>

        <p className="text-muted-foreground text-xs">Enter the dispatched quantity — remaining is shown after the “/”.</p>

        <div className="grid grid-cols-2 gap-3">
          {QTY_FIELDS.map(([k, label, remKey], i) => (
            <div key={k} className="space-y-1">
              <Label className="flex items-baseline justify-between text-sm font-semibold">
                <span>{label}</span>
                <span className="text-base font-bold tabular-nums text-primary">/ {qty(line[remKey])}</span>
              </Label>
              <Input
                autoFocus={i === 0}
                type="number"
                step="any"
                placeholder="0"
                className="text-right tabular-nums"
                value={form[k]}
                onChange={(e) => set({ [k]: e.target.value } as Partial<typeof form>)}
              />
            </div>
          ))}
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Dispatch status</Label>
          <NativeSelect
            value={form.dispatchStatus}
            onChange={(v) => set({ dispatchStatus: v === 'FULLY DISPATCH' ? 'FULLY DISPATCH' : 'PARTIALLY DISPATCH' })}
            options={[...DISPATCH_STATUSES]}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Comment</Label>
          <Input value={form.comment} onChange={(e) => set({ comment: e.target.value })} placeholder="Dispatch remark…" />
        </div>
      </div>

      <SheetFooter className="justify-between">
        <Button type="button" variant="outline" onClick={dispatchAll} title="Fill the remaining quantities and mark Fully Dispatch">
          <PackageCheck /> Dispatch Full
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending} title="Save dispatch (Ctrl+S)">
            {create.isPending ? <Loader2 className="animate-spin" /> : <Truck />} Save dispatch
            <kbd className="ml-1 rounded bg-white/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold">Ctrl+S</kbd>
          </Button>
        </div>
      </SheetFooter>
    </SheetContent>
  );
}

export default DispatchOrderPage;
