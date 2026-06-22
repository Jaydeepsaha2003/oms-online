import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { OrderDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { DATE_FORMATS, formatDate, useDateFormat } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDeleteOrder, useOrders } from './use-orders';

const PAGE_SIZE = 50;

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  CANCELLED: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const COLUMNS: DataColumn<OrderDto>[] = [
  { id: 'code', label: 'Order #', fixed: true, cell: (o) => <span className="font-mono text-xs font-medium">{o.code ?? `#${o.id}`}</span> },
  { id: 'customer', label: 'Customer', cell: (o) => <span className="font-medium">{o.customerName}</span> },
  { id: 'agent', label: 'Agent', cell: (o) => o.agentName ?? '—' },
  { id: 'orderDate', label: 'Order date', cell: (o) => <span className="whitespace-nowrap">{formatDate(o.orderDate)}</span> },
  { id: 'completion', label: 'Completion', cell: (o) => <span className="whitespace-nowrap">{formatDate(o.completionDate)}</span> },
  {
    id: 'priority',
    label: 'Priority',
    cell: (o) => (o.priority === 'URGENT' ? <span className="font-semibold text-rose-600">URGENT</span> : (o.priority ?? '—')),
  },
  { id: 'items', label: 'Items', align: 'right', cell: (o) => <span className="tabular-nums">{o.itemCount}</span> },
  { id: 'total', label: 'Total', align: 'right', cell: (o) => <span className="font-semibold tabular-nums">₹{o.totalRate.toLocaleString()}</span> },
  {
    id: 'status',
    label: 'Status',
    cell: (o) => (
      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLE[o.status] ?? 'bg-muted text-muted-foreground ring-border'}`}>{o.status}</span>
    ),
  },
  {
    id: 'updated',
    label: 'Last updated',
    cell: (o) => (
      <span className="text-muted-foreground whitespace-nowrap font-mono text-xs" title={formatDateTime(o.updatedAt)}>
        {formatDate(o.updatedAt)}
      </span>
    ),
  },
];

export function OrdersPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useOrders({ page, pageSize: PAGE_SIZE, search: search || undefined });
  const del = useDeleteOrder();
  const cols = useColumnOrder('orders', COLUMNS);
  const { format, setFormat } = useDateFormat();

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const handleDelete = async (o: OrderDto) => {
    const ok = await confirm({
      title: 'Delete order?',
      description: `Order ${o.code ?? `#${o.id}`} for "${o.customerName}" and its line items will be removed.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(o.id, {
      onSuccess: () => toast.success('Order deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Orders</h2>
          <p className="text-muted-foreground text-sm">View, modify and track sales orders.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ColumnSettings
            columns={cols.orderedReorderable}
            hidden={cols.hidden}
            onReorder={cols.moveBefore}
            onMove={cols.move}
            onToggle={cols.toggle}
            onReset={cols.reset}
            dateFormat={{ value: format, options: DATE_FORMATS, onChange: setFormat }}
          />
          {can('order:create') && (
            <Button size="sm" onClick={() => navigate('/orders/new')}>
              <Plus /> New order
            </Button>
          )}
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          placeholder="Search order #, customer or agent…"
          className="pl-9"
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setSearch(e.target.value.trim());
            setPage(1);
          }}
        />
      </div>

      <DataTable
        columns={cols.visibleColumns}
        rows={items}
        rowKey={(o) => o.id}
        isLoading={isLoading}
        emptyText="No orders yet — create one."
        onRowClick={can('order:update') ? (o) => navigate(`/orders/${o.id}/edit`) : undefined}
        actions={(o) =>
          can('order:print') || can('order:delete') ? (
            <div className="flex justify-end gap-1">
              {can('order:print') && (
                <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate(`/orders/${o.id}/bill`)} aria-label="Bill / Invoice" title="Bill / Invoice">
                  <Printer className="size-4" />
                </Button>
              )}
              {can('order:delete') && (
                <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => handleDelete(o)} aria-label="Delete">
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ) : null
        }
      />

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {data?.total ?? 0} order(s) · page {data?.page ?? page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <ChevronLeft /> Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
