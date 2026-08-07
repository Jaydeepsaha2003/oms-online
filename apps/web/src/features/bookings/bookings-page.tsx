import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, ChevronLeft, ChevronRight, EllipsisVertical, Filter, Link2, PackageOpen, Plus, RotateCcw, Search, Split, TriangleAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BookingDto, BookingStatus } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
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

/** Bags + Kgs progress bar (converted vs booked). */
function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
        <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-muted-foreground text-xs tabular-nums">{pct}%</span>
    </div>
  );
}

const COLUMNS: DataColumn<BookingDto>[] = [
  { id: 'code', label: 'Booking #', fixed: true, cell: (b) => <span className="font-mono text-xs font-medium">{b.code}</span> },
  { id: 'customer', label: 'Customer', cell: (b) => <span className="font-medium">{b.customerName}</span> },
  { id: 'agent', label: 'Agent', cell: (b) => b.agentName ?? '—' },
  {
    id: 'categories',
    label: 'Categories',
    noSort: true,
    cell: (b) =>
      b.items.length ? (
        <div className="flex flex-wrap gap-1">
          {b.items.map((it) => (
            <span key={it.id} className="bg-sky-50 text-sky-700 ring-sky-200 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap">
              {it.pCategory} {it.bags || it.kgs ? `· ${it.bags || 0}b/${it.kgs || 0}k` : ''}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  { id: 'bookingDate', label: 'Booking date', cell: (b) => <span className="whitespace-nowrap">{formatDate(b.bookingDate)}</span> },
  { id: 'bags', label: 'Bags', align: 'right', cell: (b) => <span className="tabular-nums">{num(b.convertedBags)} / {num(b.bags)}</span> },
  { id: 'kgs', label: 'Kgs', align: 'right', cell: (b) => <span className="tabular-nums">{num(b.convertedKgs)} / {num(b.kgs)}</span> },
  { id: 'progress', label: 'Converted', cell: (b) => <Progress done={b.convertedBags + b.convertedKgs} total={b.bags + b.kgs} /> },
  { id: 'order', label: 'Order', cell: (b) => (b.orderCode ? <span className="font-mono text-xs text-sky-700">{shortOrderCode(b.orderCode)}</span> : <span className="text-muted-foreground">—</span>) },
  {
    id: 'status',
    label: 'Status',
    cell: (b) => (
      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLE[b.status]}`}>{STATUS_LABEL[b.status]}</span>
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

  /** Draw down remaining bags/kgs by way of the New Order form's "Draw from Bag
   *  Booking" sheet, instead of the older standalone Convert page — one place to
   *  build a real order out of a booking, with the item picker already there. */
  const goToDrawSheet = (b: BookingDto) => navigate('/orders/new', { state: { customerName: b.customerName, openBookingDraw: true } });

  const handleCancel = async (b: BookingDto) => {
    const ok = await confirm({
      title: 'Cancel this booking?',
      description: `Booking ${b.code} for "${b.customerName}" will be marked CANCELLED. Only bookings with nothing converted yet can be cancelled.`,
      confirmText: 'Cancel booking',
      destructive: true,
    });
    if (!ok) return;
    cancel.mutate(b.id, {
      onSuccess: () => toast.success('Booking cancelled'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Cancel failed')),
    });
  };

  const handleDelete = async (b: BookingDto) => {
    const ok = await confirm({
      title: 'Delete this booking?',
      description: `Booking ${b.code} will be permanently removed. This is only possible while nothing has been converted.`,
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
   *  icon, and the rest are occasional corrections. */
  const bookingActionsMenu = (b: BookingDto) => {
    const untouched = b.convertedBags === 0 && b.convertedKgs === 0;
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
          {can('booking:cancel') && (
            <DropdownMenuItem
              variant="destructive"
              disabled={!untouched || b.status === 'CANCELLED'}
              onSelect={() => handleCancel(b)}
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
              <DropdownMenuItem variant="destructive" disabled={!untouched} onSelect={() => handleDelete(b)}>
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
            <p className="text-muted-foreground font-mono text-xs font-semibold">{b.code}</p>
            <p className="truncate leading-tight font-medium">{b.customerName}</p>
            <p className="text-muted-foreground truncate text-xs">{b.agentName ?? '—'} · {formatDate(b.bookingDate)}</p>
          </div>
          <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ring-1', STATUS_STYLE[b.status])}>{STATUS_LABEL[b.status]}</span>
        </div>
        {b.items.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {b.items.map((it) => (
              <span key={it.id} className="bg-sky-50 text-sky-700 ring-sky-200 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset">
                {it.pCategory} · {it.bags || 0}b/{it.kgs || 0}k
              </span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-muted-foreground">Bags</p>
            <p className="font-medium tabular-nums">{num(b.convertedBags)} / {num(b.bags)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Kgs</p>
            <p className="font-medium tabular-nums">{num(b.convertedKgs)} / {num(b.kgs)}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Progress done={b.convertedBags + b.convertedKgs} total={b.bags + b.kgs} />
          {b.orderCode && <span className="font-mono text-xs text-sky-700">{shortOrderCode(b.orderCode)}</span>}
        </div>
        <div className="flex items-center justify-end gap-1 border-t pt-2.5" onClick={(e) => e.stopPropagation()}>
          {can('booking:convert') && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-sky-600 hover:bg-sky-50 hover:text-sky-700 disabled:text-slate-300"
              disabled={!convertible}
              onClick={() => goToDrawSheet(b)}
              aria-label="Draw into a new order"
            >
              <Split className="size-4" />
            </Button>
          )}
          {bookingActionsMenu(b)}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
            <PackageOpen className="size-5" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Bag Bookings</h2>
            <p className="text-muted-foreground text-sm">Reserve bags &amp; kgs now, convert to real items later — priced at the booking-date rates.</p>
          </div>
        </div>
        {can('booking:create') && (
          <Button size="sm" onClick={() => navigate('/bookings/new')}>
            <Plus /> New booking
          </Button>
        )}
      </div>

      <div className="bg-background/85 sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-md px-1 py-1.5 backdrop-blur">
        <div className="relative w-full flex-1 sm:w-80 sm:flex-none">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search booking #, customer or agent…"
            className="pl-9"
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
          className="relative shrink-0 sm:hidden"
          onClick={() => setMobileFiltersOpen(true)}
          aria-label="Filters"
        >
          <Filter className="size-4" />
          {activeFilterCount > 0 && (
            <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-medium">
              {activeFilterCount}
            </span>
          )}
        </Button>
        <div className="hidden w-52 sm:block">
          <NativeSelect
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            options={['', 'OPEN', 'PARTIALLY_CONVERTED', 'CONVERTED', 'PRECLOSED', 'CANCELLED']}
            placeholder="All statuses"
            renderOption={(v) => (v ? STATUS_LABEL[v as BookingStatus] : 'All statuses')}
          />
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
        emptyText="No bookings yet — create one."
        onRowClick={can('booking:convert') ? (b) => goToDrawSheet(b) : undefined}
        mobileCard={bookingMobileCard}
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
                        onClick={() => goToDrawSheet(b)}
                        aria-label="Draw into a new order"
                      >
                        <Split className="size-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-56">
                    <p className="font-semibold">Draw into a new order</p>
                    <p className="opacity-80">Opens New Order for {b.customerName} with "Draw from Bag Booking" ready to go.</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {bookingActionsMenu(b)}
            </div>
          );
        }}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {data?.total ?? 0} booking(s) · page {data?.page ?? page} of {totalPages}
        </p>
        <div className="flex items-center gap-3">
          <PageSizeSelect value={pageSize} onChange={setPageSize} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft /> Prev
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      </div>

      {precloseFor && <PrecloseBookingDialog booking={precloseFor} onClose={() => setPrecloseFor(null)} />}
      {assignFor && <AssignOldOrderDialog booking={assignFor} onClose={() => setAssignFor(null)} />}
    </div>
  );
}

export default BookingsPage;
