import { useEffect, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRightLeft,
  Ban,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  EllipsisVertical,
  Eye,
  FileSearch,
  Filter,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Send,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { QUOTATION_STATUSES, type QuotationDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { usePageSize } from '@/hooks/use-page-size';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Combo, NativeSelect } from '@/components/common/combo';
import { CancelReasonFields } from '@/components/common/cancel-reason';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { openPdf } from '@/lib/pdf';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { settingValues, useSettings } from '@/features/settings/use-settings';
import {
  useCancelQuotation,
  useConvertQuotation,
  useDeleteQuotation,
  useMarkQuotationSent,
  useQuotations,
} from './use-quotations';

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 ring-slate-200',
  SENT: 'bg-sky-50 text-sky-700 ring-sky-200',
  CONVERTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CANCELLED: 'bg-rose-50 text-rose-700 ring-rose-200',
};
const StatusBadge = ({ s }: { s: string }) => (
  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', STATUS_STYLE[s] ?? 'bg-muted')}>{s}</span>
);

const isOpen = (s: string) => s === 'DRAFT' || s === 'SENT';

const COLUMNS: DataColumn<QuotationDto>[] = [
  {
    id: 'code',
    label: 'Quote #',
    pin: 'left0',
    fixed: true,
    cell: (q) => (
      <div className="flex flex-col items-start gap-1">
        <span className="font-mono text-xs font-medium">{q.code ?? `#${q.id}`}</span>
        {isOpen(q.status) && q.sourceOrderCode && <HeldOrder code={q.sourceOrderCode} />}
      </div>
    ),
  },
  { id: 'date', label: 'Date', cell: (q) => <span className="whitespace-nowrap">{formatDate(q.orderDate)}</span> },
  { id: 'customer', label: 'Customer', cell: (q) => <span className="font-medium">{q.customerName}</span> },
  { id: 'items', label: 'Items', align: 'right', cell: (q) => <span className="tabular-nums">{q.itemCount}</span> },
  { id: 'total', label: 'Total Amount', align: 'right', cell: (q) => <span className="font-semibold tabular-nums text-emerald-700">₹{(q.totalAmount ?? 0).toLocaleString('en-IN')}</span> },
  { id: 'status', label: 'Status', cell: (q) => <StatusBadge s={q.status} /> },
  {
    id: 'outcome',
    label: 'Outcome',
    cell: (q) =>
      q.status === 'CONVERTED' ? (
        <span className="text-emerald-700">
          → {q.convertedOrderCode ?? 'order'}
          {q.convertMode ? <span className="text-muted-foreground"> ({q.convertMode.toLowerCase()})</span> : ''}
        </span>
      ) : q.status === 'CANCELLED' ? (
        <span className="text-rose-700" title={q.cancelNote ?? undefined}>{q.cancelReason ?? 'Cancelled'}</span>
      ) : q.status === 'SENT' ? (
        <span className="text-sky-700">Sent {q.sentAt ? formatDate(q.sentAt) : ''}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

/** Shown while a quotation still holds the order number it was saved from, so
 *  it's obvious the Order # isn't lost — converting brings it back. */
const HeldOrder = ({ code }: { code: string }) => (
  <span
    className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
    title={`Saved from order ${code} — that order is parked and comes back under the same number when this quotation is converted.`}
  >
    <Bookmark className="size-3" /> Holds {code}
  </span>
);

export function QuotationsPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { page, setPage, pageSize, setPageSize } = usePageSize('quotations');
  const [acting, setActing] = useState<QuotationDto | null>(null);
  const [cancelling, setCancelling] = useState<QuotationDto | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const activeFilterCount = statusFilter ? 1 : 0;
  const resetFilters = () => {
    setStatusFilter('');
    setPage(1);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize, search: search || undefined, status: statusFilter || undefined };
  const { data, isLoading } = useQuotations(query);
  const convert = useConvertQuotation();
  const markSent = useMarkQuotationSent();
  const del = useDeleteQuotation();

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const doConvert = (q: QuotationDto, mode: 'DIRECT' | 'EDITED') => {
    convert.mutate(
      { id: q.id, mode },
      {
        onSuccess: (order) => {
          toast.success(`Converted to ${order.code ?? 'order'}`);
          setActing(null);
          navigate(`/orders/${order.id}/bill`);
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Convert failed')),
      },
    );
  };

  const doSent = (q: QuotationDto) => {
    markSent.mutate(q.id, {
      onSuccess: () => {
        toast.success('Marked as sent to customer');
        setActing(null);
      },
      onError: (e) => toast.error(getApiErrorMessage(e, 'Update failed')),
    });
  };

  const handleDelete = async (q: QuotationDto) => {
    const ok = await confirm({
      title: 'Delete quotation?',
      description: `${q.code ?? `#${q.id}`} will be permanently removed.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(q.id, {
      onSuccess: () => toast.success('Quotation deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  /** Opens the quotation statement in a new tab rather than saving a file —
   *  a quick look at what the customer would receive, no download involved. */
  const handlePreview = (q: QuotationDto) => {
    void openPdf(`/quotations/${q.id}/bill.pdf`, `${q.code ?? `Quotation-${q.id}`}.pdf`).catch((e) =>
      toast.error(getApiErrorMessage(e, 'Preview failed')),
    );
  };

  /** Every row action behind one kebab, same as Orders and Bag Bookings.
   *
   *  Converting is the point of no return: from then on the ORDER is the live
   *  document, so editing its lines (or deleting the quotation that produced it)
   *  would either be silently discarded or destroy the order's provenance. Those
   *  entries stay visible but disabled, with the reason on hover, rather than
   *  disappearing — otherwise the menu changes shape row to row and it's not
   *  obvious the action ever existed. The API enforces the same rules. */
  const quotationActionsMenu = (q: QuotationDto) => {
    const open = isOpen(q.status);
    const converted = q.status === 'CONVERTED';
    // Why an entry is disabled — shown on hover so it doesn't look broken.
    const lockedWhy = converted
      ? `Already converted to ${q.convertedOrderCode ?? 'an order'} — change the order instead`
      : 'This quotation is cancelled';
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for quotation ${q.code ?? q.id}`} title="Quotation actions">
            <EllipsisVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 font-sans">
          {can('quotation:view') && (
            <>
              <DropdownMenuItem onSelect={() => handlePreview(q)}>
                <FileSearch className="text-violet-600" /> Preview PDF
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate(`/quotations/${q.id}/bill`)}>
                <Printer /> Print / view quotation
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {can('quotation:update') && (
            <DropdownMenuItem disabled={!open} onSelect={() => navigate(`/quotations/${q.id}/edit`)} title={open ? undefined : lockedWhy}>
              <Pencil /> Edit quotation (items &amp; rates)
            </DropdownMenuItem>
          )}
          {can('quotation:convert') && (
            <DropdownMenuItem
              disabled={!open || convert.isPending}
              onSelect={() => doConvert(q, 'DIRECT')}
              title={
                !open
                  ? lockedWhy
                  : q.sourceOrderCode
                    ? `Brings back order ${q.sourceOrderCode}, the draft this quotation was saved from`
                    : undefined
              }
            >
              {/* When the quotation holds a parked order, converting revives THAT
                  order — say its number so nobody expects a fresh one. */}
              <ArrowRightLeft /> {q.sourceOrderCode ? `Convert back to ${q.sourceOrderCode}` : 'Convert to order'}
            </DropdownMenuItem>
          )}
          {can('quotation:update') && (
            <DropdownMenuItem
              disabled={!open || q.status === 'SENT' || markSent.isPending}
              onSelect={() => doSent(q)}
              title={q.status === 'SENT' ? 'Already marked as sent' : open ? undefined : lockedWhy}
            >
              <Send /> Mark as sent to customer
            </DropdownMenuItem>
          )}
          {converted && q.convertedOrderId != null && can('order:view') && (
            <DropdownMenuItem onSelect={() => navigate(`/orders/${q.convertedOrderId}/edit`)}>
              <Eye className="text-emerald-600" /> View {q.convertedOrderCode ?? 'the order'}
            </DropdownMenuItem>
          )}
          {(can('quotation:cancel') || can('quotation:delete')) && <DropdownMenuSeparator />}
          {can('quotation:cancel') && (
            <DropdownMenuItem variant="destructive" disabled={!open} onSelect={() => setCancelling(q)} title={open ? undefined : lockedWhy}>
              <Ban /> Cancel with reason
            </DropdownMenuItem>
          )}
          {can('quotation:delete') && (
            <DropdownMenuItem
              variant="destructive"
              disabled={converted}
              onSelect={() => void handleDelete(q)}
              title={converted ? lockedWhy : undefined}
            >
              <Trash2 /> Delete permanently
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Phones: one stacked card per quotation instead of a horizontally-scrolling table.
  const quotationMobileCard = (q: QuotationDto) => (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-muted-foreground font-mono text-xs font-semibold">{q.code ?? `#${q.id}`}</p>
          <p className="truncate leading-tight font-medium">{q.customerName}</p>
          <p className="text-muted-foreground text-xs">{formatDate(q.orderDate)}</p>
          {isOpen(q.status) && q.sourceOrderCode && <div className="mt-1"><HeldOrder code={q.sourceOrderCode} /></div>}
        </div>
        <StatusBadge s={q.status} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-muted-foreground">Items</p>
          <p className="font-medium tabular-nums">{q.itemCount}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Total Amount</p>
          <p className="font-semibold tabular-nums text-emerald-700">₹{(q.totalAmount ?? 0).toLocaleString('en-IN')}</p>
        </div>
      </div>
      {q.status === 'CONVERTED' ? (
        <p className="text-xs text-emerald-700">
          → {q.convertedOrderCode ?? 'order'}
          {q.convertMode ? <span className="text-muted-foreground"> ({q.convertMode.toLowerCase()})</span> : ''}
        </p>
      ) : q.status === 'CANCELLED' ? (
        <p className="truncate text-xs text-rose-700" title={q.cancelNote ?? undefined}>{q.cancelReason ?? 'Cancelled'}</p>
      ) : q.status === 'SENT' ? (
        <p className="text-xs text-sky-700">Sent {q.sentAt ? formatDate(q.sentAt) : ''}</p>
      ) : null}
      <div className="flex items-center justify-end gap-1.5 border-t pt-2.5" onClick={(e) => e.stopPropagation()}>
        {quotationActionsMenu(q)}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Quotations</h2>
          <p className="text-muted-foreground text-sm">{data?.total ?? 0} quotations · click a row to choose an action</p>
        </div>
        {can('quotation:create') && (
          <Button size="sm" onClick={() => navigate('/orders/new')}>
            <Plus /> New quotation
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full flex-1 sm:max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input placeholder="Search quote #, customer or agent…" className="pl-9" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
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
        <div className="hidden w-40 sm:block">
          <NativeSelect value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} options={['', ...QUOTATION_STATUSES]} placeholder="All statuses" />
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
              <NativeSelect value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} options={['', ...QUOTATION_STATUSES]} placeholder="All statuses" />
            </div>
          </div>
          <SheetFooter>
            <Button className="w-full" onClick={() => setMobileFiltersOpen(false)}>
              Show {(data?.total ?? 0).toLocaleString('en-IN')} quotations
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <DataTable
        columns={COLUMNS}
        rows={items}
        rowKey={(q) => q.id}
        isLoading={isLoading}
        emptyText="No quotations yet."
        onRowClick={(q) => { if (isOpen(q.status) || q.status === 'CONVERTED') setActing(q); }}
        mobileCard={quotationMobileCard}
        actions={(q) => <div className="flex items-center justify-end">{quotationActionsMenu(q)}</div>}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Page {data?.page ?? page} of {totalPages}
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

      {acting && (
        <ActionDialog
          quotation={acting}
          can={can}
          busy={convert.isPending || markSent.isPending}
          onConvertDirect={() => doConvert(acting, 'DIRECT')}
          onEditConvert={() => {
            const id = acting.id;
            setActing(null);
            navigate(`/quotations/${id}/edit`);
          }}
          onSent={() => doSent(acting)}
          onCancel={() => {
            setCancelling(acting);
            setActing(null);
          }}
          onViewOrder={() => {
            const orderId = acting.convertedOrderId;
            setActing(null);
            if (orderId != null) navigate(`/orders/${orderId}/edit`);
          }}
          onClose={() => setActing(null)}
        />
      )}
      {cancelling && <CancelDialog quotation={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}

/** The "what would you like to do with this quotation?" chooser. */
function ActionDialog({
  quotation,
  can,
  busy,
  onConvertDirect,
  onEditConvert,
  onSent,
  onCancel,
  onViewOrder,
  onClose,
}: {
  quotation: QuotationDto;
  can: (p: string) => boolean;
  busy: boolean;
  onConvertDirect: () => void;
  onEditConvert: () => void;
  onSent: () => void;
  onCancel: () => void;
  onViewOrder: () => void;
  onClose: () => void;
}) {
  const q = quotation;
  const Option = ({
    show,
    icon: Icon,
    color,
    title,
    desc,
    onClick,
  }: {
    show: boolean;
    icon: ComponentType<{ className?: string }>;
    color: string;
    title: string;
    desc: string;
    onClick: () => void;
  }) =>
    show ? (
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="hover:bg-muted/60 flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-50"
      >
        <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md', color)}>
          <Icon className="size-4" />
        </span>
        <span>
          <span className="block text-sm font-medium">{title}</span>
          <span className="text-muted-foreground block text-xs">{desc}</span>
        </span>
      </button>
    ) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>What to do with {q.code ?? `#${q.id}`}?</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Option
            show={q.status === 'CONVERTED' && q.convertedOrderId != null && can('order:view')}
            icon={Eye}
            color="bg-emerald-100 text-emerald-700"
            title="View the order"
            desc={`Open ${q.convertedOrderCode ?? 'the resulting order'} — this quotation has already been converted.`}
            onClick={onViewOrder}
          />
          <Option
            show={isOpen(q.status) && can('quotation:convert')}
            icon={ArrowRightLeft}
            color="bg-emerald-100 text-emerald-700"
            title={q.sourceOrderCode ? `Convert back to ${q.sourceOrderCode}` : 'Convert to order directly'}
            desc={
              q.sourceOrderCode
                ? `Bring back order ${q.sourceOrderCode} — the draft this was saved from — with these lines, then open it to print.`
                : 'Create a sales order from this quotation as-is, then open it to print.'
            }
            onClick={onConvertDirect}
          />
          <Option
            show={isOpen(q.status) && can('quotation:update')}
            icon={Pencil}
            color="bg-indigo-100 text-indigo-700"
            title="Edit & convert"
            desc="Adjust the quotation first, then convert it to an order."
            onClick={onEditConvert}
          />
          <Option
            show={isOpen(q.status) && can('quotation:update') && q.status !== 'SENT'}
            icon={Send}
            color="bg-sky-100 text-sky-700"
            title="Mark as sent to customer"
            desc="Record that the quotation was sent (status → Sent)."
            onClick={onSent}
          />
          <Option
            show={isOpen(q.status) && can('quotation:cancel')}
            icon={Ban}
            color="bg-rose-100 text-rose-700"
            title="Cancel with reason"
            desc="Cancel and record why — kept for analysis."
            onClick={onCancel}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null} Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ quotation, onClose }: { quotation: QuotationDto; onClose: () => void }) {
  const cancel = useCancelQuotation();
  const { data: settings } = useSettings();
  const reasons = settingValues(settings, 'QUOTATION_CANCEL_REASON');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  const submit = () => {
    if (!reason.trim()) return toast.error('Please choose or enter a reason');
    cancel.mutate(
      { id: quotation.id, input: { reason: reason.trim(), note: note.trim() || null } },
      {
        onSuccess: () => {
          toast.success('Quotation cancelled');
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Cancel failed')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel {quotation.code ?? `#${quotation.id}`}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <p className="text-muted-foreground text-sm">
            Record why this quotation was cancelled — it's kept for analysis (e.g. why deals are lost).
          </p>
          <CancelReasonFields reasons={reasons} reason={reason} note={note} onReason={setReason} onNote={setNote} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Keep quotation
          </Button>
          <Button type="button" variant="destructive" onClick={submit} disabled={cancel.isPending}>
            {cancel.isPending ? <Loader2 className="animate-spin" /> : <Ban />} Cancel quotation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default QuotationsPage;
