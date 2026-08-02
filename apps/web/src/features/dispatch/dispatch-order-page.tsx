import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CalendarClock, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Filter, Flame, Hourglass, Loader2, Package, PackageCheck, RotateCcw, TriangleAlert, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { qtyOrderForCategory, type DispatchStatus, type PendingLineDto, type QtyField } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, shortOrderCode } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useOrderQtyLayout } from '@/features/settings/use-settings';
import { LiveLinePhotos } from '../orders/line-photos';
import { useOrderItemPhotos } from '../orders/use-orders';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { ExportButton } from '@/components/common/excel-actions';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { exportPendingDispatch, useCreateDispatch, usePendingFilterOptions, usePendingOrders } from './use-dispatch';
import { useDispatchDate } from './use-dispatch-date';

const PAGE_SIZE = 50;
const num = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? 0 : Number(s));
const qty = (v: number | null) => (v ? v.toLocaleString('en-IN') : '—');

const DueBadge = ({ t }: { t: string }) => (
  <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', t === 'Over Due' ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-blue-50 text-blue-800 ring-blue-200')}>
    <CalendarClock className="size-3" />
    {t}
  </span>
);

/** Shown when a line already has an open back-date approval request awaiting a
 *  decision — otherwise the line looks untouched after a non-approver submits
 *  and refreshes, even though a request is already in flight. */
const PendingApprovalBadge = () => (
  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/30">
    <Hourglass className="size-3" />
    Pending approval
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

        {line.hasPendingApproval && (
          <div>
            <PendingApprovalBadge />
          </div>
        )}

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

/** Matches the Pending Challan / Challans / Orders grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

const COLUMNS: DataColumn<PendingLineDto>[] = [
  { id: 'order', label: 'ORD#', pin: 'left0', pinWidthClass: 'sm:w-16 sm:min-w-16', fixed: true, cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{shortOrderCode(r.orderCode, r.orderId)}</span> },
  { id: 'orderDate', label: 'Order date', cell: (r) => <span className={cn(TEXT_CELL, 'whitespace-nowrap tabular-nums')}>{formatDate(r.orderDate)}</span> },
  { id: 'due', label: 'Due', cell: (r) => <span className={cn(TEXT_CELL, 'flex items-center gap-1.5 whitespace-nowrap tabular-nums')}>{formatDate(r.dueDate)} <DueBadge t={r.dueType} /> {r.hasPendingApproval && <PendingApprovalBadge />}</span> },
  { id: 'customer', label: 'Customer', cell: (r) => <span className={TEXT_CELL}>{r.customerName}</span> },
  { id: 'product', label: 'Product', cell: (r) => <span className={TEXT_CELL}>{r.productName || r.product || '—'}</span> },
  { id: 'design', label: 'Design', cell: (r) => <span className={TEXT_CELL}>{r.designType || '—'}</span> },
  { id: 'priority', label: 'Priority', cell: (r) => (r.priority === 'URGENT' ? <span className="text-[11.5px] font-bold text-rose-600 dark:text-rose-400">URGENT</span> : <span className={TEXT_CELL}>{r.priority || '—'}</span>) },
  { id: 'bags', label: 'Bags', align: 'right', cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{qty(r.remBags)}</span> },
  { id: 'pcs', label: 'Pcs', align: 'right', cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{qty(r.remPcs)}</span> },
  { id: 'kgs', label: 'Kgs', align: 'right', cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{qty(r.remKgs)}</span> },
  { id: 'box', label: 'Box', align: 'right', cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{qty(r.remBox)}</span> },
  { id: 'comment', label: 'Comment', cell: (r) => (r.comment ? <span className="text-[13px] font-bold text-rose-600 dark:text-rose-400">{r.comment}</span> : <span className="text-muted-foreground text-[13px]">—</span>) },
];

const money = (v: number | null) => (v == null ? '—' : `₹${v.toLocaleString('en-IN')}`);

/** Rate columns, shown only to users with `dispatch:viewrates`. Amount is the
 *  ₹ value of the still-pending quantity (rate × remaining pcs or kgs). */
const RATE_COLUMNS: DataColumn<PendingLineDto>[] = [
  { id: 'productRate', label: 'Product ₹', align: 'right', cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(r.productRate)}</span> },
  { id: 'designRate', label: 'Design ₹', align: 'right', cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(r.designRate)}</span> },
  { id: 'rate', label: 'Rate ₹', align: 'right', cell: (r) => <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(r.rate)}</span> },
  {
    id: 'amount',
    label: 'Pending ₹',
    align: 'right',
    cell: (r) => {
      const qtyLeft = (r.calField ?? '').toUpperCase() === 'PCS' ? r.remPcs : r.remKgs;
      return <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(r.rate != null ? Math.round(r.rate * qtyLeft) : null)}</span>;
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
  const [dueType, setDueType] = useState('');
  const [customer, setCustomer] = useState('');
  const [agent, setAgent] = useState('');
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
  const [draftAgent, setDraftAgent] = useState('');
  const [exporting, setExporting] = useState(false);
  // "ALL" toggle (legacy Form13 checkbox linked to SelectProduct): when on, the
  // product picker lists base names and one pick matches every design variant.
  const [all, setAll] = useState(false);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    dueType: dueType || undefined,
    customer: customer || undefined,
    agent: agent || undefined,
    product: product || undefined,
    design: design || undefined,
    subCategory: subCategory || undefined,
    all: all || undefined,
  };
  // Filter dropdowns list only values that exist under the other active filters
  // (cascading), so you can't pick a combination that yields no rows.
  const { data: options } = usePendingFilterOptions(query);
  // Default → short base-name list (one pick = all its designs). ALL on → the full
  // list with every design variant, so a pick targets that specific item.
  const productOptions = all ? (options?.products ?? []) : (options?.productBases ?? []);
  const { data, isLoading } = usePendingOrders(query);
  const hasFilters = !!dueType || !!customer || !!agent || !!product || !!design || !!subCategory || all;
  const resetFilters = () => {
    setDueType('');
    setCustomer('');
    setAgent('');
    setProduct('');
    setDesign('');
    setSubCategory('');
    setAll(false);
    setPage(1);
  };
  // Flipping ALL swaps the product option set (base ↔ full), so the current pick is
  // no longer valid — clear it. Design is a sub-attribute of a specific variant, so
  // it doesn't apply while grouping by base; clear that too.
  const toggleAll = (next: boolean) => {
    setAll(next);
    setProduct('');
    if (next) setDesign('');
    setPage(1);
  };
  // Open the mobile sheet with its drafts seeded from what's currently applied.
  const openMobileFilters = () => {
    setDraftDue(dueType);
    setDraftDesign(design);
    setDraftSubCategory(subCategory);
    setDraftAgent(agent);
    setMobileFiltersOpen(true);
  };
  // "Show": commit the drafts to the real filter state, then close.
  const applyDraftFilters = () => {
    setDueType(draftDue);
    setDesign(draftDesign);
    setSubCategory(draftSubCategory);
    setAgent(draftAgent);
    setPage(1);
    setMobileFiltersOpen(false);
  };
  // Sheet "Reset": clear every filter that lives behind the Filter icon
  // (Agent/Due/Design/Sub category/ALL) — both the drafts and what's applied —
  // immediately. Customer and Product keep their own on-screen selects, so a
  // phone still has a one-tap way to clear just those.
  // `all` counts here: the ALL switch is rendered inside this sheet, so leaving it
  // out left Reset DISABLED whenever ALL was the only active filter — making it
  // impossible to turn off from a phone.
  const draftDirty = !!(draftDue || draftDesign || draftSubCategory || draftAgent || dueType || design || subCategory || agent || all);
  const resetSheetFilters = () => {
    setDraftDue('');
    setDraftDesign('');
    setDraftSubCategory('');
    setDraftAgent('');
    setDueType('');
    setDesign('');
    setSubCategory('');
    setAgent('');
    // ALL is one of this sheet's own filters, so it resets with them. Turning it
    // off swaps the product options (full variants → base names) and invalidates
    // any current pick, which is why toggleAll() clears the product as well.
    if (all) {
      setAll(false);
      setProduct('');
    }
    setPage(1);
  };
  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  // Customer + Product are their own on-screen selects on mobile, so the
  // filter-icon badge counts only what lives behind it (Agent/Due/Design/Sub
  // category/ALL).
  const sheetFilterCount = (agent ? 1 : 0) + (dueType ? 1 : 0) + (design ? 1 : 0) + (subCategory ? 1 : 0) + (all ? 1 : 0);
  const { can } = usePermissions();
  const canViewRates = can('dispatch:viewrates');
  const canApproveDispatch = can('dispatch:approve');
  // The date every dispatch created from this page uses — defaults to today,
  // sticks for the rest of the calendar day once changed, resets on its own the
  // next day. See use-dispatch-date.ts.
  const dispatchDateCtl = useDispatchDate();
  const columns = useMemo(() => (canViewRates ? withRates(COLUMNS) : COLUMNS), [canViewRates]);
  const cols = useColumnOrder('dispatch-pending', columns);
  // Export the pending list under the CURRENTLY applied filters (the server
  // re-runs the same query without paging, so you get every matching line).
  const onExport = async () => {
    setExporting(true);
    try {
      await exportPendingDispatch({
        dueType: dueType || undefined,
        customer: customer || undefined,
        agent: agent || undefined,
        product: product || undefined,
        design: design || undefined,
        subCategory: subCategory || undefined,
        all: all || undefined,
      });
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Excel export failed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    // Fills the viewport: toolbar pinned on top, footer pinned at the bottom, only
    // the list scrolls. `/dispatch/new` is a flush route (app-shell), so the page
    // owns its own padding. Mobile keeps its own filter sheet + tap-to-dispatch
    // cards + truck animation untouched.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      {/* ── Dispatch date — applies to every dispatch created below until changed
          or the day rolls over. A date other than today needs `dispatch:approve`;
          without it the entry is parked in Approvals instead of created. */}
      <div
        className={cn(
          'bg-card font-poppins rounded-[4px] border shadow-sm',
          !dispatchDateCtl.isToday && 'border-amber-400 dark:border-amber-400/50',
        )}
      >
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <CalendarDays className="text-muted-foreground size-4 shrink-0" />
          <Label htmlFor="dispatch-date" className="shrink-0 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
            Dispatching for
          </Label>
          <Input
            id="dispatch-date"
            type="date"
            value={dispatchDateCtl.date}
            onChange={(e) => e.target.value && dispatchDateCtl.setDate(e.target.value)}
            className={cn(CONTROL, 'w-auto shrink-0', !dispatchDateCtl.isToday && CONTROL_ON)}
          />
          {!dispatchDateCtl.isToday && (
            <>
              <span className="shrink-0 rounded-[4px] bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">
                Back-dated
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1 text-[12px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-400/10"
                onClick={dispatchDateCtl.resetToToday}
              >
                <RotateCcw className="size-3" /> Reset to today
              </Button>
            </>
          )}
          {!dispatchDateCtl.isToday && (
            <p className="text-muted-foreground ml-auto hidden max-w-sm text-right text-[11.5px] font-medium sm:block">
              {canApproveDispatch
                ? 'You can approve, so this date applies directly — no sign-off needed.'
                : 'Dispatches on this date will wait in Approvals for an admin to sign off.'}
            </p>
          )}
        </div>
      </div>

      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          {/* Phones: just the two filters people actually reach for first —
              Customer and Product — each on their own full-width line. Everything
              else (Agent / Due / Design / Sub category / ALL) lives behind the
              Filter icon, which sits with Export and a one-tap Reset-all. */}
          <div className="flex w-full flex-col gap-2 sm:hidden">
            <NativeSelect value={customer} onChange={(v) => { setCustomer(v); setPage(1); }} options={['', ...(options?.customers ?? [])]} placeholder="Customer" className={cn(CONTROL, 'font-medium', customer && CONTROL_ON)} />
            <NativeSelect value={product} onChange={(v) => { setProduct(v); setPage(1); }} options={['', ...productOptions]} placeholder={all ? 'Product (any design)' : 'Product'} className={cn(CONTROL, 'font-medium', product && CONTROL_ON)} />
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className={cn('relative size-9 shrink-0 rounded-[4px] border-amber-300', sheetFilterCount > 0 && CONTROL_ON)} onClick={openMobileFilters} aria-label="More filters">
                <Filter className="size-4" />
                {sheetFilterCount > 0 && (
                  <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-bold tabular-nums">
                    {sheetFilterCount}
                  </span>
                )}
              </Button>
              {hasFilters && (
                <Button
                  variant="outline"
                  size="icon"
                  className="size-9 shrink-0 rounded-[4px] border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-400/10"
                  onClick={resetFilters}
                  aria-label="Reset all filters"
                  title="Reset all filters"
                >
                  <X className="size-4" />
                </Button>
              )}
              <div className="min-w-0 flex-1" />
              {can('dispatch:export') && <ExportButton onClick={onExport} disabled={exporting} label="Export to Excel" />}
            </div>
          </div>

          {/* Desktop: filters inline. */}
          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            <div className="w-36">
              <NativeSelect value={dueType} onChange={(v) => { setDueType(v); setPage(1); }} options={['', 'Due', 'Over Due']} placeholder="All due" className={cn(CONTROL, 'font-medium', dueType && CONTROL_ON)} />
            </div>
            {/* Filter order follows the house pattern: Customer, Item Name, Agent,
                Category, Sub Category, Design (no separate top-level Category
                dropdown on this page — only Sub Category — so that's skipped). */}
            <div className="w-56">
              <NativeSelect value={customer} onChange={(v) => { setCustomer(v); setPage(1); }} options={['', ...(options?.customers ?? [])]} placeholder="All customers" className={cn(CONTROL, 'font-medium', customer && CONTROL_ON)} />
            </div>
            <div className="w-56">
              <NativeSelect value={product} onChange={(v) => { setProduct(v); setPage(1); }} options={['', ...productOptions]} placeholder={all ? 'All (any design)' : 'All products'} className={cn(CONTROL, 'font-medium', product && CONTROL_ON)} />
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12.5px] font-semibold select-none" title="ALL: one product pick matches every design variant">
              <Switch checked={all} onCheckedChange={toggleAll} /> All
            </label>
            <div className="w-40">
              <NativeSelect value={agent} onChange={(v) => { setAgent(v); setPage(1); }} options={['', ...(options?.agents ?? [])]} placeholder="All agents" className={cn(CONTROL, 'font-medium', agent && CONTROL_ON)} />
            </div>
            <div className="w-40">
              <NativeSelect value={subCategory} onChange={(v) => { setSubCategory(v); setPage(1); }} options={['', ...(options?.subCategories ?? [])]} placeholder="All sub categories" className={cn(CONTROL, 'font-medium', subCategory && CONTROL_ON)} />
            </div>
            <div className="w-36">
              <NativeSelect value={design} onChange={(v) => { setDesign(v); setPage(1); }} options={['', ...(options?.designs ?? [])]} placeholder="All designs" disabled={all} className={cn(CONTROL, 'font-medium', design && CONTROL_ON)} />
            </div>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 rounded-[4px] text-[12.5px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-400/10"
                onClick={resetFilters}
                title="Clear all filters"
              >
                <X className="size-3.5" /> Reset
              </Button>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-2">
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
            <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <span className="flex flex-col">
                <span className="text-sm font-medium">All designs</span>
                <span className="text-muted-foreground text-xs">One product pick matches every design variant</span>
              </span>
              <Switch checked={all} onCheckedChange={toggleAll} />
            </label>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Agent</Label>
              <NativeSelect value={draftAgent} onChange={setDraftAgent} options={['', ...(options?.agents ?? [])]} placeholder="All agents" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Due</Label>
              <NativeSelect value={draftDue} onChange={setDraftDue} options={['', 'Due', 'Over Due']} placeholder="All due" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Sub category</Label>
              <NativeSelect value={draftSubCategory} onChange={setDraftSubCategory} options={['', ...(options?.subCategories ?? [])]} placeholder="All sub categories" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Design</Label>
              <NativeSelect value={draftDesign} onChange={setDraftDesign} options={['', ...(options?.designs ?? [])]} placeholder={all ? 'Any (ALL on)' : 'All designs'} disabled={all} />
            </div>
          </div>
          <SheetFooter>
            <Button className="h-11 w-full text-base font-semibold" onClick={applyDraftFilters}>
              Show results
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* The table/card list takes the leftover height and scrolls WITHIN itself
          (both directions on desktop), so the horizontal scrollbar sits right
          under the visible rows instead of being pushed to the bottom of a
          50-row table that only the page's own scroll could ever reach. */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          '[&_[data-slot=table-container]]:overscroll-x-contain',
          '[&_[data-slot=table-container]]:[scrollbar-width:thin]',
          '[&_[data-slot=table-container]]:[scrollbar-color:var(--color-slate-400)_var(--color-slate-100)]',
        )}
      >
        {/* Desktop: the data table. */}
        <div className="hidden min-h-0 flex-1 sm:flex sm:flex-col">
          <DataTable
            columns={cols.visibleColumns}
            rows={items}
            rowKey={(r) => r.orderItemId}
            isLoading={isLoading}
            dense
            hideSortIcon
            // Bounded to the space actually left on screen — its own scroll
            // region (vertical + horizontal) stays fully visible on first
            // paint, no scrolling the whole page down to reach it.
            fill
            emptyText="No pending order lines — everything is dispatched."
            onRowClick={(r) => setActive(r)}
            className={[
              'font-sans text-[13px]',
              // Rows are click-to-dispatch, so block accidental text selection (a
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

        {/* Phones: engaging tap-to-dispatch cards with staggered entrance + press
            feedback — untouched. A small horizontal inset keeps the cards clear of
            the screen edges. Own scroll region now that the outer wrapper doesn't
            scroll (that's the desktop table's job via `fill` above). */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 sm:hidden sm:px-0">
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

      <Sheet open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        {active && (
          <DispatchSheet
            line={active}
            dispatchDate={dispatchDateCtl.date}
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

/** Maps the shared QtyField key ('kgs') to this sheet's own field name ('gram')
 *  + its form key + remaining-quantity key. */
const QTY_FIELD_INFO: Record<QtyField, { key: 'bags' | 'pcs' | 'gram' | 'box'; label: string; remKey: 'remBags' | 'remPcs' | 'remKgs' | 'remBox' }> = {
  bags: { key: 'bags', label: 'Bags', remKey: 'remBags' },
  pcs: { key: 'pcs', label: 'Pcs', remKey: 'remPcs' },
  kgs: { key: 'gram', label: 'Kgs', remKey: 'remKgs' },
  box: { key: 'box', label: 'Box', remKey: 'remBox' },
};
/** Bags/Pcs/Kgs/Box in the order configured for this line's product category
 *  (Settings → Order quantity fields) — the same layout the New Order form uses,
 *  so the packing floor sees quantities arranged the same way end to end. */
const orderedQtyFields = (qtyLayout: Parameters<typeof qtyOrderForCategory>[0], pCategory: string | null) =>
  qtyOrderForCategory(qtyLayout, pCategory).map((f) => QTY_FIELD_INFO[f]);

/** Slide-over to dispatch a pending order line — a native bottom sheet on phones,
 *  a right side-panel on desktop. Qty fields start blank. */
function DispatchSheet({
  line,
  dispatchDate,
  onClose,
  onDispatched,
}: {
  line: PendingLineDto;
  /** The sticky date from the page's top bar — every dispatch this sheet creates
   *  is stamped with it. */
  dispatchDate: string;
  onClose: () => void;
  onDispatched: (code: string) => void;
}) {
  const create = useCreateDispatch();
  const confirm = useConfirm();
  const { can } = usePermissions();
  const isMobile = useIsMobile();
  // Photos default collapsed on phones — packing staff mainly need qty entry,
  // and the sheet should fit with minimal scrolling. Desktop keeps it open.
  const [photosOpen, setPhotosOpen] = useState(!isMobile);
  const { data: existingPhotos } = useOrderItemPhotos(line.orderItemId);
  // Bags/Pcs/Kgs/Box entry order follows this line's product category, per
  // Settings → Order quantity fields — same layout as the New Order form.
  const { data: qtyLayout } = useOrderQtyLayout();
  const qtyFields = useMemo(() => orderedQtyFields(qtyLayout, line.pCategory), [qtyLayout, line.pCategory]);
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
    } else {
      // Exact-remaining Kgs is suspicious: real dispatched weight is almost always
      // a little more or less than the ordered amount. Nudge the user to re-check
      // when the entered Kgs matches the remaining exactly. (Takes precedence over
      // the generic "fully dispatch" confirm, which is a less specific message.)
      const remKgs = line.remKgs ?? 0;
      const exactKgs = gram > 1e-6 && Math.abs(gram - remKgs) < 1e-6;
      if (exactKgs) {
        const ok = await confirm({
          title: 'Dispatch the exact remaining Kgs?',
          description: `You entered ${n(gram)} Kgs — exactly the full remaining weight. The actual weight going out is usually a little more or less, so please double-check this is really the exact weight before dispatching.`,
          confirmText: 'Yes, dispatch this Kgs',
        });
        if (!ok) return;
      } else if (form.dispatchStatus === 'FULLY DISPATCH') {
        const ok = await confirm({
          title: 'Fully dispatch this line?',
          description: `${line.productName || line.product} for ${line.customerName} will be closed (no longer pending).`,
          confirmText: 'Dispatch fully',
        });
        if (!ok) return;
      }
    }
    create.mutate(
      { orderItemId: line.orderItemId, bags, pcs, gram, box, dispatchStatus: status, comment: form.comment.trim() || null, dispatchDate },
      {
        onSuccess: (res) => {
          if (res.status === 'CREATED') {
            onDispatched(res.dispatch.code ?? '');
          } else {
            // Back-dated, and this user can't approve it themselves — nothing was
            // created; it's now waiting in Approvals.
            toast.info(`Sent for approval — ${res.approvalCode}`, {
              description: 'This dispatch needs an admin sign-off before it takes effect.',
            });
            onClose();
          }
        },
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
      <div className="-mx-1.5 flex-1 space-y-3 overflow-y-auto px-1.5 pt-1 pb-1.5 sm:space-y-4">
        <div className="bg-muted/40 rounded-xl border p-2.5 sm:p-3">
          <div className="text-sm font-semibold">
            {line.productName || line.product}
            {line.designType && line.designType.toUpperCase() !== 'NA' ? ` · ${line.designType}` : ''}
          </div>
          {line.calField && <div className="text-muted-foreground mt-0.5 text-xs">Priced by {line.calField}</div>}
        </div>

        {/* Read-only — set from the "Dispatching for" control at the top of the
            page, which applies to every dispatch created there. The "how to
            change it" hint is desktop-only clutter on a phone. */}
        <div className="flex items-center gap-1.5 text-xs">
          <CalendarDays className="text-muted-foreground size-3.5 shrink-0" />
          <span className="text-muted-foreground">Dispatching for</span>
          <span className="font-semibold">{formatDate(dispatchDate)}</span>
          <span className="text-muted-foreground hidden sm:inline">— change it from the top of the page.</span>
        </div>

        <div>
          <p className="text-muted-foreground mb-2 text-xs">Enter what's going out — tap <span className="text-primary font-semibold">MAX</span> to fill the remaining amount.</p>
          <div className="grid grid-cols-2 gap-2">
            {qtyFields.map(({ key: k, label, remKey }, i) => {
              const rem = line[remKey] ?? 0;
              return (
                <div key={k} className="bg-card space-y-1 rounded-xl border p-2">
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

        {/* This order line's photos — collapsed by default on phones so the
            sheet stays short; tap to view/add from the shop floor. */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70">
          <button
            type="button"
            onClick={() => setPhotosOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5"
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <Camera className="size-3.5" /> Order-line photos
              {!!existingPhotos?.length && (
                <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-indigo-700">
                  {existingPhotos.length}
                </span>
              )}
            </span>
            <ChevronDown className={cn('text-muted-foreground size-4 shrink-0 transition-transform', photosOpen && 'rotate-180')} />
          </button>
          {photosOpen && (
            <div className="px-3 pb-3">
              <LiveLinePhotos orderItemId={line.orderItemId} canEdit={can('order:update')} hideHeader />
            </div>
          )}
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
