import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, ChevronLeft, ChevronRight, PackageOpen, Plus, Search, Split, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BookingDto, BookingStatus } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { shortOrderCode } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NativeSelect } from '@/components/common/combo';
import { useBookings, useCancelBooking, useDeleteBooking } from './use-bookings';

const PAGE_SIZE = 50;

const STATUS_STYLE: Record<BookingStatus, string> = {
  OPEN: 'bg-amber-50 text-amber-700 ring-amber-200',
  PARTIALLY_CONVERTED: 'bg-sky-50 text-sky-700 ring-sky-200',
  CONVERTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CANCELLED: 'bg-rose-50 text-rose-700 ring-rose-200',
};
const STATUS_LABEL: Record<BookingStatus, string> = {
  OPEN: 'Open',
  PARTIALLY_CONVERTED: 'Partial',
  CONVERTED: 'Converted',
  CANCELLED: 'Cancelled',
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
  const [page, setPage] = useState(1);
  const { data, isLoading } = useBookings({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    status: status || undefined,
  });
  const cancel = useCancelBooking();
  const remove = useDeleteBooking();

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

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
        <div className="relative w-full sm:w-80">
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
        <div className="w-52">
          <NativeSelect
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            options={['', 'OPEN', 'PARTIALLY_CONVERTED', 'CONVERTED', 'CANCELLED']}
            placeholder="All statuses"
            renderOption={(v) => (v ? STATUS_LABEL[v as BookingStatus] : 'All statuses')}
          />
        </div>
      </div>

      <DataTable
        columns={COLUMNS}
        rows={items}
        rowKey={(b) => b.id}
        isLoading={isLoading}
        emptyText="No bookings yet — create one."
        onRowClick={can('booking:convert') ? (b) => navigate(`/bookings/${b.id}/convert`) : undefined}
        actions={(b) => {
          const convertible = b.status === 'OPEN' || b.status === 'PARTIALLY_CONVERTED';
          const untouched = b.convertedBags === 0 && b.convertedKgs === 0;
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
                        onClick={() => navigate(`/bookings/${b.id}/convert`)}
                        aria-label="Convert to items"
                      >
                        <Split className="size-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-56">
                    <p className="font-semibold">Convert to items</p>
                    <p className="opacity-80">Draw down remaining bags/kgs into real order lines at the frozen booking-date rates.</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {can('booking:cancel') && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-amber-600 hover:bg-amber-50 hover:text-amber-700 disabled:text-slate-300"
                        disabled={!untouched || b.status === 'CANCELLED'}
                        onClick={() => handleCancel(b)}
                        aria-label="Cancel booking"
                      >
                        <Ban className="size-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-56">
                    <p className="font-semibold">Cancel booking</p>
                    <p className="opacity-80">Only bookings with nothing converted yet can be cancelled.</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {can('booking:delete') && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive disabled:text-slate-300"
                        disabled={!untouched}
                        onClick={() => handleDelete(b)}
                        aria-label="Delete booking"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-56">
                    <p className="font-semibold">Delete booking</p>
                    <p className="opacity-80">Permanently remove — only while nothing has been converted.</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        }}
      />

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {data?.total ?? 0} booking(s) · page {data?.page ?? page} of {totalPages}
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
    </div>
  );
}

export default BookingsPage;
