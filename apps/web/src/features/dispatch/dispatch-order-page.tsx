import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Filter, Flame, Loader2, Package, PackageCheck, Search, TriangleAlert, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { type DispatchStatus, type PendingLineDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, shortOrderCode } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useColumnOrder } from '@/hooks/use-column-order';
import { LiveLinePhotos } from '../orders/line-photos';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { ExportButton } from '@/components/common/excel-actions';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { exportPendingDispatch, useCreateDispatch, usePendingFilterOptions, usePendingOrders } from './use-dispatch';

const PAGE_SIZE = 50;
const num = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? 0 : Number(s));
const qty = (v: number | null) => (v ? v.toLocaleString('en-IN') : '—');

const DueBadge = ({ t }: { t: string }) => (
  <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', t === 'Over Due' ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-blue-50 text-blue-800 ring-blue-200')}>
    <CalendarClock className="size-3" />
    {t}
  </span>
);

/** Priority is always shown — URGENT stands out in rose, NORMAL as a quiet slate chip. */
const PriorityBadge = ({ p }: { p: string | null }) =>
  p === 'URGENT' ? (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-[1px] text-[10px] font-bold text-rose-700">
      <Flame className="size-2.5" /> URGENT
    </span>
  ) : (
    <span className="rounded-full bg-slate-100 px-1.5 py-[1px] text-[10px] font-semibold text-slate-500">{p || 'NORMAL'}</span>
  );

// Staggered fade+rise for the mobile cards; press-scale lives on the card button
// itself (separate element) so the two transforms never fight. Reduced-motion safe.
const DISPATCH_CARD_CSS = `
.dispatch-card-in { animation: dispatchCardIn .34s cubic-bezier(.22,1,.36,1) both; }
@keyframes dispatchCardIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .dispatch-card-in { animation: none; } }
`;

/** A tactile, native-feeling pending-line card for phones. Tap anywhere to dispatch. */
function DispatchCard({ line, index, showRates, onClick }: { line: PendingLineDto; index: number; showRates: boolean; onClick: () => void }) {
  const urgent = line.priority === 'URGENT';
  const overdue = line.dueType === 'Over Due';
  const qtys = ([['Bags', line.remBags], ['Pcs', line.remPcs], ['Kgs', line.remKgs], ['Box', line.remBox]] as const).filter(([, v]) => v > 0);
  const pendingAmt = line.rate != null ? Math.round(line.rate * ((line.calField ?? '').toUpperCase() === 'PCS' ? line.remPcs : line.remKgs)) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group bg-card relative block w-full overflow-hidden rounded-2xl border text-left shadow-sm transition-transform duration-150 ease-out active:scale-[0.98] [touch-action:manipulation]"
    >
      {/* Urgency rail — rose when overdue/urgent, navy otherwise. */}
      <span className={cn('absolute inset-y-0 left-0 w-1.5', overdue || urgent ? 'bg-rose-500' : 'bg-blue-900')} aria-hidden />
      <div className="dispatch-card-in space-y-2.5 py-3.5 pr-3.5 pl-5 text-[13px]" style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="bg-primary/10 text-primary rounded-md px-2 py-0.5 font-mono text-[13px] font-bold">{shortOrderCode(line.orderCode, line.orderId)}</span>
            <PriorityBadge p={line.priority} />
          </div>
          <DueBadge t={line.dueType} />
        </div>

        <div>
          <p className="truncate text-[16px] font-semibold leading-tight">{line.customerName}</p>
          <p className="text-muted-foreground mt-1 text-[12px]">Due {formatDate(line.dueDate)} · ordered {formatDate(line.orderDate)}</p>
        </div>

        <div className="bg-muted/50 rounded-lg px-3 py-1.5">
          <p className="text-[14.5px] leading-snug font-semibold">{line.productName || line.product || '—'}</p>
          {line.designType && line.designType.toUpperCase() !== 'NA' && <p className="text-muted-foreground text-[12px]">{line.designType}</p>}
        </div>

        {/* Remaining-quantity pills (non-zero units only) + the tap-to-dispatch truck. */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {qtys.length ? (
              qtys.map(([label, v]) => (
                <span key={label} className="border-primary/15 bg-primary/5 text-primary inline-flex items-baseline gap-1 rounded-full border px-2.5 py-1">
                  <span className="text-[11px] font-semibold uppercase opacity-70">{label}</span>
                  <span className="text-[14px] font-bold tabular-nums">{qty(v)}</span>
                </span>
              ))
            ) : (
              <span className="text-muted-foreground text-[13px]">Nothing pending</span>
            )}
          </div>
          <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full transition-transform group-active:translate-x-0.5" aria-hidden>
            <Truck className="size-4.5" />
          </span>
        </div>

        {showRates && (
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-[12px]">
            <span>Rate <span className="text-foreground font-semibold tabular-nums">{money(line.rate)}</span></span>
            <span>Pending <span className="text-foreground font-semibold tabular-nums">{money(pendingAmt)}</span></span>
          </div>
        )}

        {line.comment && (
          <div className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-2.5 py-2 ring-1 ring-rose-100">
            <TriangleAlert className="mt-[1px] size-3.5 shrink-0 text-rose-600" />
            <p className="line-clamp-5 text-[13.5px] leading-snug font-bold text-rose-600">{line.comment}</p>
          </div>
        )}
      </div>
    </button>
  );
}

const COLUMNS: DataColumn<PendingLineDto>[] = [
  { id: 'order', label: 'Order #', pin: 'left0', pinWidthClass: 'sm:w-16 sm:min-w-16', fixed: true, cell: (r) => <span className="font-mono text-xs font-medium">{shortOrderCode(r.orderCode, r.orderId)}</span> },
  { id: 'orderDate', label: 'Order date', cell: (r) => <span className="whitespace-nowrap">{formatDate(r.orderDate)}</span> },
  { id: 'due', label: 'Due', cell: (r) => <span className="flex items-center gap-1.5 whitespace-nowrap">{formatDate(r.dueDate)} <DueBadge t={r.dueType} /></span> },
  { id: 'customer', label: 'Customer', cell: (r) => <span className="font-medium">{r.customerName}</span> },
  { id: 'product', label: 'Product', cell: (r) => <span className="font-medium">{r.productName || r.product || '—'}</span> },
  { id: 'design', label: 'Design', cell: (r) => r.designType || '—' },
  { id: 'priority', label: 'Priority', cell: (r) => (r.priority === 'URGENT' ? <span className="font-semibold text-rose-600">URGENT</span> : r.priority || '—') },
  { id: 'bags', label: 'Bags', align: 'right', cell: (r) => <span className="tabular-nums">{qty(r.remBags)}</span> },
  { id: 'pcs', label: 'Pcs', align: 'right', cell: (r) => <span className="tabular-nums">{qty(r.remPcs)}</span> },
  { id: 'kgs', label: 'Kgs', align: 'right', cell: (r) => <span className="tabular-nums">{qty(r.remKgs)}</span> },
  { id: 'box', label: 'Box', align: 'right', cell: (r) => <span className="tabular-nums">{qty(r.remBox)}</span> },
  { id: 'comment', label: 'Comment', cell: (r) => (r.comment ? <span className="font-bold text-rose-600">{r.comment}</span> : <span className="text-muted-foreground">—</span>) },
];

const money = (v: number | null) => (v == null ? '—' : `₹${v.toLocaleString('en-IN')}`);

/** Rate columns, shown only to users with `dispatch:viewrates`. Amount is the
 *  ₹ value of the still-pending quantity (rate × remaining pcs or kgs). */
const RATE_COLUMNS: DataColumn<PendingLineDto>[] = [
  { id: 'productRate', label: 'Product ₹', align: 'right', cell: (r) => <span className="tabular-nums">{money(r.productRate)}</span> },
  { id: 'designRate', label: 'Design ₹', align: 'right', cell: (r) => <span className="tabular-nums">{money(r.designRate)}</span> },
  { id: 'rate', label: 'Rate ₹', align: 'right', cell: (r) => <span className="font-semibold tabular-nums">{money(r.rate)}</span> },
  {
    id: 'amount',
    label: 'Pending ₹',
    align: 'right',
    cell: (r) => {
      const qtyLeft = (r.calField ?? '').toUpperCase() === 'PCS' ? r.remPcs : r.remKgs;
      return <span className="tabular-nums">{money(r.rate != null ? Math.round(r.rate * qtyLeft) : null)}</span>;
    },
  },
];

/** Insert the rate columns just before the Comment column (their default slot). */
const withRates = (cols: DataColumn<PendingLineDto>[]): DataColumn<PendingLineDto>[] => {
  const at = cols.findIndex((c) => c.id === 'comment');
  const i = at < 0 ? cols.length : at;
  return [...cols.slice(0, i), ...RATE_COLUMNS, ...cols.slice(i)];
};

export function DispatchOrderPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dueType, setDueType] = useState('');
  const [customer, setCustomer] = useState('');
  const [product, setProduct] = useState('');
  const [design, setDesign] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<PendingLineDto | null>(null);
  const [shipped, setShipped] = useState<string | null>(null); // dispatch code → plays the truck animation
  // Phones: the dropdown filters live behind a Filter icon (in the sheet below) so the
  // list starts right under a single compact search+icon row instead of a tall stack.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // The sheet edits DRAFT values only — nothing filters the list until the user
  // taps "Show". (Previously the sheet's selects wrote straight to the applied
  // filter state, so picking any option auto-applied it before "Show" was pressed.)
  const [draftDue, setDraftDue] = useState('');
  const [draftDesign, setDraftDesign] = useState('');
  const [draftSubCategory, setDraftSubCategory] = useState('');

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
    subCategory: subCategory || undefined,
  };
  const { data, isLoading } = usePendingOrders(query);
  const hasFilters = !!searchInput || !!dueType || !!customer || !!product || !!design || !!subCategory;
  const resetFilters = () => {
    setSearchInput('');
    setSearch('');
    setDueType('');
    setCustomer('');
    setProduct('');
    setDesign('');
    setSubCategory('');
    setPage(1);
  };
  // Open the mobile sheet with its drafts seeded from what's currently applied.
  const openMobileFilters = () => {
    setDraftDue(dueType);
    setDraftDesign(design);
    setDraftSubCategory(subCategory);
    setMobileFiltersOpen(true);
  };
  // "Show": commit the drafts to the real filter state, then close.
  const applyDraftFilters = () => {
    setDueType(draftDue);
    setDesign(draftDesign);
    setSubCategory(draftSubCategory);
    setPage(1);
    setMobileFiltersOpen(false);
  };
  // Sheet "Reset": clear only the sheet's own three filters (Due/Design/Sub
  // category) — both the drafts and what's applied — immediately. The Customer
  // and Product quick-selects sit outside the sheet and keep their own values.
  const draftDirty = !!(draftDue || draftDesign || draftSubCategory || dueType || design || subCategory);
  const resetSheetFilters = () => {
    setDraftDue('');
    setDraftDesign('');
    setDraftSubCategory('');
    setDueType('');
    setDesign('');
    setSubCategory('');
    setPage(1);
  };
  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  // Customer + Product are their own search boxes on mobile now, so the filter-icon
  // badge counts only what still lives behind it (Due / Design / Sub category).
  const sheetFilterCount = (dueType ? 1 : 0) + (design ? 1 : 0) + (subCategory ? 1 : 0);
  const { can } = usePermissions();
  const canViewRates = can('dispatch:viewrates');
  const columns = useMemo(() => (canViewRates ? withRates(COLUMNS) : COLUMNS), [canViewRates]);
  const cols = useColumnOrder('dispatch-pending', columns);
  const [exporting, setExporting] = useState(false);
  // Export the pending list under the CURRENTLY applied filters (the server
  // re-runs the same query without paging, so you get every matching line).
  const onExport = async () => {
    setExporting(true);
    try {
      await exportPendingDispatch({
        search: search || undefined,
        dueType: dueType || undefined,
        customer: customer || undefined,
        product: product || undefined,
        design: design || undefined,
        subCategory: subCategory || undefined,
      });
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Excel export failed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* Desktop: general search box. */}
        <div className="relative hidden w-64 sm:block">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input placeholder="Search order #, customer or product…" className="pl-9" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>

        {/* Phones: Customer + Product are the two primary quick-search boxes; the rest
            (Due / Design / Sub category) live behind the filter icon. */}
        <div className="flex w-full items-center gap-2 sm:hidden">
          <div className="min-w-0 flex-1">
            <NativeSelect value={customer} onChange={(v) => { setCustomer(v); setPage(1); }} options={['', ...(options?.customers ?? [])]} placeholder="Customer" />
          </div>
          <div className="min-w-0 flex-1">
            <NativeSelect value={product} onChange={(v) => { setProduct(v); setPage(1); }} options={['', ...(options?.products ?? [])]} placeholder="Product" />
          </div>
          <Button variant="outline" size="icon" className="relative shrink-0" onClick={openMobileFilters} aria-label="More filters">
            <Filter className="size-4" />
            {sheetFilterCount > 0 && (
              <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-medium">
                {sheetFilterCount}
              </span>
            )}
          </Button>
          {can('dispatch:export') && <ExportButton onClick={onExport} disabled={exporting} label="Export to Excel" />}
        </div>

        {/* Desktop: filters inline. */}
        <div className="hidden flex-wrap items-center gap-2 sm:flex">
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
          <div className="w-44">
            <NativeSelect value={subCategory} onChange={(v) => { setSubCategory(v); setPage(1); }} options={['', ...(options?.subCategories ?? [])]} placeholder="All sub categories" />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-rose-200 font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 disabled:border-input disabled:text-rose-600/40"
            onClick={resetFilters}
            disabled={!hasFilters}
            title={hasFilters ? 'Clear all filters' : 'No filters applied'}
          >
            <X /> Reset
          </Button>
          {can('dispatch:export') && <ExportButton onClick={onExport} disabled={exporting} label="Export pending list to Excel" />}
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

      {/* Phones only: every dropdown filter lives behind the Filter icon above. */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="sm:hidden">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>Filters</SheetTitle>
              <Button variant="ghost" size="sm" className="-mr-2 gap-1.5 font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 disabled:text-rose-600/40" onClick={resetSheetFilters} disabled={!draftDirty}>
                <X className="size-3.5" /> Reset
              </Button>
            </div>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Due</Label>
              <NativeSelect value={draftDue} onChange={setDraftDue} options={['', 'Due', 'Over Due']} placeholder="All due" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Design</Label>
              <NativeSelect value={draftDesign} onChange={setDraftDesign} options={['', ...(options?.designs ?? [])]} placeholder="All designs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Sub category</Label>
              <NativeSelect value={draftSubCategory} onChange={setDraftSubCategory} options={['', ...(options?.subCategories ?? [])]} placeholder="All sub categories" />
            </div>
          </div>
          <SheetFooter>
            <Button className="h-11 w-full text-base font-semibold" onClick={applyDraftFilters}>
              Show results
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Desktop: the data table. */}
      <div className="hidden sm:block">
        <DataTable
          columns={cols.visibleColumns}
          rows={items}
          rowKey={(r) => r.orderItemId}
          isLoading={isLoading}
          dense
          // Compact, readable data font; columns still auto-fit their content.
          className="text-[15px] [&_thead_th]:h-9 [&_thead_th]:text-[13px] [&_td]:px-3 [&_td]:py-1.5 [&_th]:px-3 [&_tbody_button]:size-7"
          emptyText="No pending order lines — everything is dispatched."
          onRowClick={(r) => setActive(r)}
        />
      </div>

      {/* Phones: engaging tap-to-dispatch cards with staggered entrance + press feedback. */}
      <div className="space-y-3 sm:hidden">
        <style>{DISPATCH_CARD_CSS}</style>
        {isLoading ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="bg-muted/40 h-40 animate-pulse rounded-2xl border" />)
        ) : items.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-card px-4 py-12 text-center text-sm">
            <PackageCheck className="size-9 text-blue-500" />
            No pending order lines — everything is dispatched.
          </div>
        ) : (
          items.map((r, i) => <DispatchCard key={r.orderItemId} line={r} index={i} showRates={canViewRates} onClick={() => setActive(r)} />)
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

/** Slide-over to dispatch a pending order line — a native bottom sheet on phones,
 *  a right side-panel on desktop. Qty fields start blank. */
function DispatchSheet({ line, onClose, onDispatched }: { line: PendingLineDto; onClose: () => void; onDispatched: (code: string) => void }) {
  const create = useCreateDispatch();
  const confirm = useConfirm();
  const { can } = usePermissions();
  const isMobile = useIsMobile();
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
    // Guard against a double-fire (fast double-tap, or the Ctrl+S shortcut pressed
    // while a save is already in flight) creating two dispatch records.
    if (create.isPending) return;
    const bags = num(form.bags), pcs = num(form.pcs), gram = num(form.gram), box = num(form.box);
    const cf = (line.calField ?? '').toUpperCase();
    if (cf === 'PCS' && pcs <= 0) return toast.error('Pcs is required — this item is priced by PCS.');
    if (cf === 'KGS' && gram <= 0) return toast.error('Kgs is required to dispatch this item.');
    if (cf !== 'PCS' && cf !== 'KGS' && bags <= 0 && pcs <= 0 && gram <= 0 && box <= 0) return toast.error('Enter at least one quantity to dispatch');

    // Over-dispatch is allowed (packing/weighing variance is normal) but never
    // silently — flag exactly which unit(s) go past what's left and make the
    // user explicitly confirm before it's saved.
    const n = (v: number) => v.toLocaleString('en-IN');
    const over = ([
      ['Bags', bags, line.remBags],
      ['Pcs', pcs, line.remPcs],
      ['Kgs', gram, line.remKgs],
      ['Box', box, line.remBox],
    ] as const).filter(([, v, rem]) => v > (rem ?? 0));

    let status = form.dispatchStatus;
    if (over.length) {
      const ok = await confirm({
        title: 'Dispatch more than what remains?',
        description: (
          <>
            This goes past what's left on this order line:
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
              {over.map(([label, v, rem]) => (
                <li key={label}>
                  <span className="font-semibold">{label}</span>: dispatching {n(v)}, only {n(rem ?? 0)} remaining.
                </li>
              ))}
            </ul>
            <p className="mt-2">The line will be marked Fully Dispatched. Continue anyway?</p>
          </>
        ),
        confirmText: 'Dispatch anyway',
        destructive: true,
      });
      if (!ok) return;
      status = 'FULLY DISPATCH'; // nothing is left pending once you go over
    } else if (form.dispatchStatus === 'FULLY DISPATCH') {
      const ok = await confirm({
        title: 'Fully dispatch this line?',
        description: `${line.productName || line.product} for ${line.customerName} will be closed (no longer pending).`,
        confirmText: 'Dispatch fully',
      });
      if (!ok) return;
    }
    create.mutate(
      { orderItemId: line.orderItemId, bags, pcs, gram, box, dispatchStatus: status, comment: form.comment.trim() || null },
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
    <SheetContent side={isMobile ? 'bottom' : 'right'} className={cn('flex w-full flex-col', isMobile ? 'rounded-t-2xl' : 'max-w-lg')}>
      {/* Native grabber handle on the phone bottom sheet. */}
      {isMobile && <div className="bg-muted-foreground/25 mx-auto -mt-1 mb-1 h-1.5 w-10 shrink-0 rounded-full" aria-hidden />}

      <SheetHeader>
        <div className="flex items-center gap-2">
          <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 font-mono text-sm font-bold">{shortOrderCode(line.orderCode, line.orderId)}</span>
          {line.priority === 'URGENT' && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
              <Flame className="size-2.5" /> URGENT
            </span>
          )}
        </div>
        <SheetTitle className="truncate text-lg leading-tight">{line.customerName}</SheetTitle>
      </SheetHeader>

      {/* px + negative margin gives the inputs' focus ring room to paint into the
          sheet's padding instead of being clipped by overflow-y-auto. */}
      <div className="-mx-1.5 flex-1 space-y-4 overflow-y-auto px-1.5 pt-1 pb-1.5">
        <div className="bg-muted/40 rounded-xl border p-3">
          <div className="text-sm font-semibold">
            {line.productName || line.product}
            {line.designType && line.designType.toUpperCase() !== 'NA' ? ` · ${line.designType}` : ''}
          </div>
          {line.calField && <div className="text-muted-foreground mt-0.5 text-xs">Priced by {line.calField}</div>}
        </div>

        <div>
          <p className="text-muted-foreground mb-2 text-xs">Enter what's going out — tap <span className="text-primary font-semibold">MAX</span> to fill the remaining amount.</p>
          <div className="grid grid-cols-2 gap-2.5">
            {QTY_FIELDS.map(([k, label, remKey], i) => {
              const rem = line[remKey] ?? 0;
              return (
                <div key={k} className="bg-card space-y-1.5 rounded-xl border p-2.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-semibold">{label}</span>
                    {rem > 0 && (
                      <button
                        type="button"
                        onClick={() => set({ [k]: String(rem) } as Partial<typeof form>)}
                        className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums transition-transform active:scale-95"
                      >
                        MAX {qty(rem)}
                      </button>
                    )}
                  </div>
                  <Input
                    autoFocus={i === 0 && !isMobile}
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder="0"
                    className="h-11 text-right text-base tabular-nums"
                    value={form[k]}
                    onChange={(e) => set({ [k]: e.target.value } as Partial<typeof form>)}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Segmented Partial/Full toggle — more tactile than a dropdown on touch. */}
        <div className="space-y-1.5">
          <Label className="text-xs">Dispatch status</Label>
          <div className="bg-muted grid grid-cols-2 gap-1 rounded-xl p-1">
            {([['PARTIALLY DISPATCH', 'Partial'], ['FULLY DISPATCH', 'Full']] as const).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => set({ dispatchStatus: val })}
                className={cn(
                  'rounded-lg py-2 text-sm font-semibold transition-all active:scale-[0.97]',
                  form.dispatchStatus === val ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Comment</Label>
          <Input value={form.comment} onChange={(e) => set({ comment: e.target.value })} placeholder="Dispatch remark…" />
        </div>

        {/* This order line's photos — view, and add more from the shop floor. */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <LiveLinePhotos orderItemId={line.orderItemId} canEdit={can('order:update')} title="Order-line photos" />
        </div>
      </div>

      <SheetFooter className="flex-col gap-2 pb-[max(env(safe-area-inset-bottom),0.25rem)] sm:flex-row sm:items-center sm:justify-between sm:pb-4">
        <Button type="button" variant="outline" className="w-full transition-transform active:scale-[0.98] sm:w-auto" onClick={dispatchAll} title="Fill the remaining quantities and mark Fully Dispatch">
          <PackageCheck /> Dispatch Full
        </Button>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button type="button" variant="outline" className="flex-1 transition-transform active:scale-[0.98] sm:flex-none" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending} className="flex-1 transition-transform active:scale-[0.98] sm:flex-none" title="Save dispatch (Ctrl+S)">
            {create.isPending ? <Loader2 className="animate-spin" /> : <Truck />} Save dispatch
          </Button>
        </div>
      </SheetFooter>
    </SheetContent>
  );
}

export default DispatchOrderPage;
