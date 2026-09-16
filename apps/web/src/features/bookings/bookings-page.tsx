import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, ChevronLeft, ChevronRight, EllipsisVertical, FileSearch, Filter, Info, Link2, Plus, Printer, RotateCcw, Search, Split, TriangleAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BookingDto, BookingStatus } from '@oms/shared';
import { BOOKING_NO_CATEGORY } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { PdfPreviewDialog } from '@/components/common/pdf-preview-dialog';
import { downloadPdf, fetchPdf } from '@/lib/pdf';
import { cn, shortOrderCode } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { usePageSize } from '@/hooks/use-page-size';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NativeSelect } from '@/components/common/combo';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { PrecloseBookingDialog, AssignOldOrderDialog } from './booking-action-dialogs';
import { useBookings, useCancelBooking, useDeleteBooking } from './use-bookings';

const STATUS_STYLE: Record<BookingStatus, string> = {
  OPEN: 'bg-amber-50 text-amber-700 ring-amber-200',
  PARTIALLY_CONVERTED: 'bg-sky-50 text-sky-700 ring-sky-200',
  CONVERTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CANCELLED: 'bg-rose-50 text-rose-700 ring-rose-200',
  PRECLOSED: 'bg-slate-100 text-slate-700 ring-slate-200',
};
const STATUS_LABEL: Record<BookingStatus, string> = {
  OPEN: 'Open',
  PARTIALLY_CONVERTED: 'Partial',
  CONVERTED: 'Converted',
  CANCELLED: 'Cancelled',
  PRECLOSED: 'Preclosed',
};

const num = (v: number) => v.toLocaleString('en-IN');

/**
 * How far a booking has been converted.
 *
 * Measured PER DIMENSION and reported as the least-complete one, because that
 * is what finishes the booking: `statusFor` on the server calls it CONVERTED
 * only once every dimension it actually booked is done. Taking the minimum
 * makes the bar agree with the status — 100% exactly when it says CONVERTED.
 *
 * A dimension the booking never reserved is skipped entirely. This used to add
 * bags to kgs and divide by their sum — arithmetic on two different units that
 * only looked right while both moved together. On a bags-only booking it read
 * (57 bags + 4,400 kgs) / (81 bags + 0 kgs) = 5,502%, clamped to a confident
 * "100%" on a booking with 24 bags still to draw.
 */
/**
 * Every order this booking was drawn into, each with its own date — a booking
 * is filled by as many dated orders as the customer asks for, so showing only
 * the first one hid the rest.
 */
function LinkedOrders({ booking }: { booking: Pick<BookingDto, 'orders'> }) {
  const orders = booking.orders ?? [];
  if (!orders.length) return <span className="text-muted-foreground">—</span>;
  // Chips, not bare numbers. Two orders side by side read as one long number
  // ("1132 1282") when nothing separates them — which is exactly how many
  // orders a booking gets drawn into.
  return (
    // No wrapping. The column sizes itself narrow, so a wrapping flex box put
    // each order on its own line and made EVERY row in the table as tall as the
    // busiest one. The cell is already `whitespace-nowrap`, so letting the chips
    // sit in a row lets the column take the width it actually needs.
    <span className="inline-flex flex-nowrap items-center gap-1 align-middle">
      {orders.map((o) => (
        <span
          key={o.id}
          className={cn(
            'rounded-[3px] px-1.5 py-px font-mono text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset',
            o.status === 'CANCELLED'
              ? 'text-muted-foreground line-through ring-border bg-muted'
              : 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/30',
          )}
          title={`${o.code} · ${formatDate(o.orderDate)}`}
        >
          {shortOrderCode(o.code)}
        </span>
      ))}
    </span>
  );
}

function Progress({ booking }: { booking: Pick<BookingDto, 'bags' | 'kgs' | 'convertedBags' | 'convertedKgs'> }) {
  const parts: number[] = [];
  if (booking.bags > 0) parts.push(booking.convertedBags / booking.bags);
  if (booking.kgs > 0) parts.push(booking.convertedKgs / booking.kgs);
  const pct = parts.length ? Math.min(100, Math.round(Math.min(...parts) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="bg-muted h-1.5 w-14 shrink-0 overflow-hidden rounded-full">
        <div
          className={cn('h-full rounded-full transition-[width]', pct >= 100 ? 'bg-emerald-500' : 'bg-sky-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Zero is the common case on an open booking, so it is muted; anything
          actually drawn is worth reading. */}
      <span className={cn('text-[11.5px] font-semibold tabular-nums', pct > 0 ? 'text-foreground' : 'text-muted-foreground')}>
        {pct}%
      </span>
    </div>
  );
}

/**
 * "97.5 / 300" — drawn so far against what was reserved.
 *
 * The two numbers answer different questions and were set identically, so the
 * eye had to parse the slash to tell which was which. The drawn figure carries
 * the weight; the reservation it is measured against steps back.
 */
function OfTotal({ done, total }: { done: number; total: number }) {
  return (
    <span className="tabular-nums whitespace-nowrap">
      <span className="font-semibold">{num(done)}</span>
      <span className="text-muted-foreground font-normal"> / {num(total)}</span>
    </span>
  );
}

const COLUMNS: DataColumn<BookingDto>[] = [
  { id: 'code', label: 'Booking #', fixed: true, cell: (b) => <span className="font-mono text-[12px] font-semibold">{b.code}</span> },
  { id: 'customer', label: 'Customer', cell: (b) => <span className="font-semibold">{b.customerName}</span> },
  { id: 'agent', label: 'Agent', cell: (b) => b.agentName ?? <span className="text-muted-foreground">—</span> },
  {
    id: 'categories',
    label: 'Categories',
    noSort: true,
    cell: (b) =>
      b.items.length ? (
        <div className="flex flex-wrap gap-1">
          {b.items.map((it) => (
            <span key={it.id} className="rounded-[3px] bg-violet-50 px-1.5 py-px text-[11px] font-semibold whitespace-nowrap text-violet-700 ring-1 ring-violet-200 ring-inset dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/30">
              {it.pCategory || BOOKING_NO_CATEGORY} {it.bags || it.kgs ? `· ${it.bags || 0}b/${it.kgs || 0}k` : ''}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  { id: 'bookingDate', label: 'Booking date', cell: (b) => <span className="tabular-nums whitespace-nowrap">{formatDate(b.bookingDate)}</span> },
  { id: 'bags', label: 'Bags', align: 'right', cell: (b) => <OfTotal done={b.convertedBags} total={b.bags} /> },
  { id: 'kgs', label: 'Kgs', align: 'right', cell: (b) => <OfTotal done={b.convertedKgs} total={b.kgs} /> },
  { id: 'progress', label: 'Converted', cell: (b) => <Progress booking={b} /> },
  { id: 'order', label: 'Orders', cell: (b) => <LinkedOrders booking={b} /> },
  {
    id: 'status',
    label: 'Status',
    cell: (b) => (
      <span className={cn('rounded-[3px] px-1.5 py-px text-[11px] font-bold whitespace-nowrap ring-1 ring-inset', STATUS_STYLE[b.status])}>
        {STATUS_LABEL[b.status]}
      </span>
    ),
  },
];

export function BookingsPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const { page, setPage, pageSize, setPageSize } = usePageSize('bookings-main');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const activeFilterCount = status ? 1 : 0;
  const resetFilters = () => {
    setStatus('');
    setPage(1);
  };
  const { data, isLoading } = useBookings({
    page,
    pageSize,
    search: search || undefined,
    status: status || undefined,
  });
  const cancel = useCancelBooking();
  const remove = useDeleteBooking();
  const [precloseFor, setPrecloseFor] = useState<BookingDto | null>(null);
  const [assignFor, setAssignFor] = useState<BookingDto | null>(null);

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  /** Open the normal item editor with this specific booking selected. */
  const goToNewOrder = (b: BookingDto) => navigate('/orders/new', { state: { customerName: b.customerName, bookingId: b.id, openBookingDraw: true } });

  const handleCancel = async (b: BookingDto) => {
    const ok = await confirm({
      title: 'Cancel this booking?',
      description: `Booking ${b.code} for "${b.customerName}" will be marked CANCELLED. Its already-converted bags/kgs and the orders they became are untouched — this only stops any further draw-down.`,
      confirmText: 'Cancel booking',
      destructive: true,
    });
    if (!ok) return;
    cancel.mutate(b.id, {
      onSuccess: () => toast.success('Booking cancelled'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Cancel failed')),
    });
  };

  const handlePrint = (b: BookingDto) => {
    void downloadPdf(`/bookings/${b.id}/pdf`, `${b.code}.pdf`).catch((e) => toast.error(getApiErrorMessage(e, 'PDF failed')));
  };

  /**
   * Same statement as Print PDF, shown IN PLACE rather than saved or thrown
   * into another tab — for a quick look at the bags' journey (booked →
   * converted → dispatched → billed) without leaving the bookings list.
   *
   * It used to `window.open`, which cost the user the app around the document:
   * a separate tab titled with the blob's UUID, and no way back except the
   * browser's own controls.
   */
  const [preview, setPreview] = useState<{ url: string; blob: Blob; filename: string; code: string } | null>(null);
  // A preview blob is a few MB — release it when the dialog closes, and again
  // on unmount so leaving the page mid-preview doesn't strand it.
  const closePreview = () => {
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
  };
  const previewRef = useRef<string | null>(null);
  previewRef.current = preview?.url ?? null;
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const handlePreview = (b: BookingDto) => {
    void fetchPdf(`/bookings/${b.id}/pdf`, `${b.code}.pdf`)
      .then(({ blob, filename }) => setPreview({ url: URL.createObjectURL(blob), blob, filename, code: b.code ?? '' }))
      .catch((e) => toast.error(getApiErrorMessage(e, 'Preview failed')));
  };

  const handleDelete = async (b: BookingDto) => {
    const ok = await confirm({
      title: 'Delete this booking?',
      description: `Booking ${b.code} will be permanently removed. This is only possible while nothing has been converted — once it has, use Cancel instead.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(b.id, {
      onSuccess: () => toast.success('Booking deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  /** Cancel / Preclose / Assign old order(s) / Delete — grouped behind one
   *  kebab menu since Convert is the one action common enough to earn its own
   *  icon, and the rest are occasional corrections.
   *
   *  Delete and Cancel are deliberately mutually exclusive, never both enabled
   *  at once: an untouched booking (nothing converted) has nothing worth
   *  preserving, so it's simply deleted; the moment any bag/kg is converted,
   *  real OrderItems exist against it, so hard-deleting the booking would leave
   *  them pointing at nothing — Cancel (a soft status flip) is the only safe
   *  way to stop it from then on. */
  const bookingActionsMenu = (b: BookingDto) => {
    const untouched = b.convertedBags === 0 && b.convertedKgs === 0;
    const canCancel = !untouched && b.status !== 'CANCELLED' && b.status !== 'PRECLOSED';
    const canPreclose = b.status === 'PARTIALLY_CONVERTED';
    const canAssign = b.status === 'OPEN' || b.status === 'PARTIALLY_CONVERTED';
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for booking ${b.code}`} title="Booking actions">
            <EllipsisVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60 font-sans">
          {can('booking:print') && (
            <>
              <DropdownMenuItem onSelect={() => handlePreview(b)}>
                <FileSearch className="text-violet-600" /> Preview PDF
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handlePrint(b)}>
                <Printer /> Print PDF
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {can('booking:cancel') && (
            <DropdownMenuItem
              variant="destructive"
              disabled={!canCancel}
              onSelect={() => handleCancel(b)}
              title={untouched ? 'Nothing converted yet — delete it instead' : undefined}
            >
              <Ban /> Cancel booking
            </DropdownMenuItem>
          )}
          {can('booking:preclose') && (
            <DropdownMenuItem disabled={!canPreclose} onSelect={() => setPrecloseFor(b)}>
              <TriangleAlert /> Preclose (write off remaining)
            </DropdownMenuItem>
          )}
          {can('booking:update') && (
            <DropdownMenuItem disabled={!canAssign} onSelect={() => setAssignFor(b)}>
              <Link2 /> Assign old order(s)
            </DropdownMenuItem>
          )}
          {can('booking:delete') && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={!untouched}
                onSelect={() => handleDelete(b)}
                title={!untouched ? 'Already converted — cancel it instead' : undefined}
              >
                <Trash2 /> Delete permanently
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Phones: one stacked card per booking instead of a horizontally-scrolling table.
  const bookingMobileCard = (b: BookingDto) => {
    const convertible = b.status === 'OPEN' || b.status === 'PARTIALLY_CONVERTED';
    return (
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-muted-foreground font-mono text-[11.5px] font-semibold">{b.code}</p>
            <p className="truncate text-[13.5px] leading-tight font-bold">{b.customerName}</p>
            <p className="text-muted-foreground truncate text-[11.5px] font-medium">
              {b.agentName ?? '—'} · <span className="tabular-nums">{formatDate(b.bookingDate)}</span>
            </p>
          </div>
          <span className={cn('shrink-0 rounded-[3px] px-1.5 py-px text-[11px] font-bold ring-1 ring-inset', STATUS_STYLE[b.status])}>
            {STATUS_LABEL[b.status]}
          </span>
        </div>
        {b.items.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {b.items.map((it) => (
              <span key={it.id} className="rounded-[3px] bg-violet-50 px-1.5 py-px text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200 ring-inset dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/30">
                {it.pCategory || BOOKING_NO_CATEGORY} · {it.bags || 0}b/{it.kgs || 0}k
              </span>
            ))}
          </div>
        )}
        <div className="bg-muted/40 grid grid-cols-2 gap-2 rounded-[4px] px-2.5 py-2">
          <div>
            <p className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">Bags</p>
            <p className="text-[13px]">
              <OfTotal done={b.convertedBags} total={b.bags} />
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">Kgs</p>
            <p className="text-[13px]">
              <OfTotal done={b.convertedKgs} total={b.kgs} />
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Progress booking={b} />
          <LinkedOrders booking={b} />
        </div>
        <div className="flex items-center justify-end gap-1 border-t pt-2.5" onClick={(e) => e.stopPropagation()}>
          {can('booking:convert') && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-sky-600 hover:bg-sky-50 hover:text-sky-700 disabled:text-slate-300"
              disabled={!convertible}
              onClick={() => goToNewOrder(b)}
              aria-label="New order using booking"
            >
              <Split className="size-4" />
            </Button>
          )}
          {bookingActionsMenu(b)}
        </div>
      </div>
    );
  };

  const totalRows = data?.total ?? 0;
  const firstRow = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, totalRows);

  return (
    // Fills the viewport, like every other main list in the app: toolbar pinned
    // on top, footer pinned at the bottom, only the grid scrolls. `/bookings` is
    // a flush route (app-shell), so the page owns its padding.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      {/* ── Toolbar: what the page is for, then the filters and the one action ──
          All in one card, matching Challans. It used to be a bare sticky strip
          under a near-empty row that held one sentence on the left and one
          button on the right — a whole band of the screen for two elements. */}
      <div className="bg-card rounded-[4px] border shadow-sm">
        <p className="text-muted-foreground flex items-center gap-1.5 border-b px-2.5 py-1.5 text-[11.5px] font-medium sm:px-3">
          <Info className="size-3.5 shrink-0" />
          Reserve bags &amp; kgs now, convert to real items later — priced at the booking-date rates.
        </p>
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:p-3">
          <div className="relative basis-full sm:w-72 sm:basis-auto">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search booking #, customer or agent…"
              className="h-9 rounded-[4px] pl-8 text-[12.5px] font-medium"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setSearch(e.target.value.trim());
                setPage(1);
              }}
            />
          </div>
          {/* Phones: Status filter moves behind this icon (see the sheet below). */}
          <Button
            variant="outline"
            size="icon"
            className="relative size-9 shrink-0 rounded-[4px] sm:hidden"
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
          <div className="hidden w-48 sm:block">
            <NativeSelect
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={['', 'OPEN', 'PARTIALLY_CONVERTED', 'CONVERTED', 'PRECLOSED', 'CANCELLED']}
              placeholder="All statuses"
              renderOption={(v) => (v ? STATUS_LABEL[v as BookingStatus] : 'All statuses')}
            />
          </div>
          {can('booking:create') && (
            <Button size="sm" className="ml-auto h-9 shrink-0 rounded-[4px] font-semibold" onClick={() => navigate('/bookings/new')}>
              <Plus className="size-4" /> New booking
            </Button>
          )}
        </div>
      </div>

      {/* Phones only: Status lives behind the Filter icon above. */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="sm:hidden">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>Filters</SheetTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground -mr-2 gap-1.5"
                onClick={resetFilters}
                disabled={activeFilterCount === 0}
              >
                <RotateCcw className="size-3.5" /> Reset
              </Button>
            </div>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Status</Label>
              <NativeSelect
                value={status}
                onChange={(v) => { setStatus(v); setPage(1); }}
                options={['', 'OPEN', 'PARTIALLY_CONVERTED', 'CONVERTED', 'PRECLOSED', 'CANCELLED']}
                placeholder="All statuses"
                renderOption={(v) => (v ? STATUS_LABEL[v as BookingStatus] : 'All statuses')}
              />
            </div>
          </div>
          <SheetFooter>
            <Button className="w-full" onClick={() => setMobileFiltersOpen(false)}>
              Show {(data?.total ?? 0).toLocaleString('en-IN')} bookings
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <DataTable
        columns={COLUMNS}
        rows={items}
        rowKey={(b) => b.id}
        isLoading={isLoading}
        dense
        fill
        emptyText="No bookings yet — create one."
        onRowClick={can('booking:convert') ? (b) => goToNewOrder(b) : undefined}
        mobileCard={bookingMobileCard}
        // Same grid as Challans, so the two list screens read as one product:
        // 13px body, heavy headers, tight rows, a full grey grid and a warm
        // hover. Comfortable mode put this table at 16px with 20px cell padding,
        // which is why three rows filled the screen.
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
        actions={(b) => {
          const convertible = b.status === 'OPEN' || b.status === 'PARTIALLY_CONVERTED';
          return (
            <div className="flex justify-end gap-1">
              {can('booking:convert') && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-sky-600 hover:bg-sky-50 hover:text-sky-700 disabled:text-slate-300"
                        disabled={!convertible}
                        onClick={() => goToNewOrder(b)}
                        aria-label="New order using booking"
                      >
                        <Split className="size-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-56">
                    <p className="font-semibold">New order using booking</p>
                    <p className="opacity-80">Opens New Order for {b.customerName} using {b.code}.</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {bookingActionsMenu(b)}
            </div>
          );
        }}
      />

      {/* ── Footer: range + paging, same bar as the other lists ──────────────── */}
      <div className="bg-card flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[4px] border px-3 py-2 shadow-sm">
        <p className="text-muted-foreground text-[12px] font-medium">
          {totalRows === 0 ? (
            'No bookings'
          ) : (
            <>
              Showing{' '}
              <span className="text-foreground font-bold tabular-nums">
                {firstRow.toLocaleString('en-IN')}–{lastRow.toLocaleString('en-IN')}
              </span>{' '}
              of <span className="text-foreground font-bold tabular-nums">{totalRows.toLocaleString('en-IN')}</span>
            </>
          )}
        </p>
        <div className="flex w-full items-center justify-between gap-3 sm:ml-auto sm:w-auto sm:justify-end">
          {/* Hidden on a phone: "Showing 1-3 of 3" above already answers it, and
              at 375px this was breaking "Page 1 of 1" across three lines. */}
          <p className="text-muted-foreground hidden text-[12px] font-medium sm:block">
            Page <span className="text-foreground font-bold tabular-nums">{data?.page ?? page}</span> of{' '}
            <span className="text-foreground font-bold tabular-nums">{totalPages}</span>
          </p>
          <div className="flex items-center gap-2">
            <PageSizeSelect value={pageSize} onChange={setPageSize} />
            <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft /> Prev
            </Button>
            <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      </div>

      {precloseFor && <PrecloseBookingDialog booking={precloseFor} onClose={() => setPrecloseFor(null)} />}
      {assignFor && <AssignOldOrderDialog booking={assignFor} onClose={() => setAssignFor(null)} />}
      {preview && (
        <PdfPreviewDialog
          title={`Booking ${preview.code}`}
          url={preview.url}
          blob={preview.blob}
          filename={preview.filename}
          onClose={closePreview}
        />
      )}
    </div>
  );
}

export default BookingsPage;
