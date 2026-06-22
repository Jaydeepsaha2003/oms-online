import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomerDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { ExportButton, ImportButton } from '@/components/common/excel-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  exportCustomers,
  useCustomers,
  useDeleteCustomer,
  useImportCustomers,
} from './use-customers';

const PAGE_SIZE = 50;
const num = (n: number | null) => (n == null ? '—' : n.toLocaleString());
/** Amount prefixed with the rupee symbol; dash when unknown. */
const money = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString()}`);
const txt = (s: string | null) => (s && s.trim() !== '' ? s : '—');

/** Every customer column. The most-used ones come first; Code + Customer name
 * are frozen to the left so identity stays visible while scrolling the wide row. */
const COLUMNS: DataColumn<CustomerDto>[] = [
  { id: 'name', label: 'Customer name', pin: 'left0', fixed: true, cell: (c) => <span className="font-semibold">{txt(c.partyName)}</span> },
  { id: 'agent', label: 'Agent', cell: (c) => txt(c.agentName) },
  { id: 'category', label: 'Category', cell: (c) => txt(c.category) },
  { id: 'city', label: 'City', cell: (c) => txt(c.city) },
  { id: 'transport', label: 'Transport', cell: (c) => txt(c.transportName) },
  { id: 'billingRate', label: 'Billing Rate/KGS', align: 'right', cell: (c) => money(c.billingRate) },
  { id: 'creditPeriod', label: 'Credit period', align: 'right', cell: (c) => num(c.creditPeriod) },
  { id: 'tds', label: 'TDS %', align: 'right', cell: (c) => (c.tdsApplicable && c.tdsPercent != null ? <span className="tabular-nums">{c.tdsPercent}%</span> : '—') },
  { id: 'state', label: 'State', cell: (c) => txt(c.state) },
  { id: 'region', label: 'Region', cell: (c) => txt(c.region) },
  { id: 'mobile', label: 'Mobile', cell: (c) => txt(c.mobile) },
  { id: 'email', label: 'Email', cell: (c) => txt(c.email) },
  { id: 'brand', label: 'Brand', cell: (c) => txt(c.brand) },
  { id: 'bag', label: 'Bag', cell: (c) => txt(c.bagName) },
  { id: 'packing', label: 'Packing', align: 'right', cell: (c) => money(c.packing) },
  { id: 'freight', label: 'Freight', align: 'right', cell: (c) => money(c.freight) },
  { id: 'boxRate', label: 'Box rate', align: 'right', cell: (c) => money(c.boxRate) },
  { id: 'billRatePc', label: 'Billing Rate/Pcs', align: 'right', cell: (c) => money(c.billRatePc) },
  { id: 'payBy', label: 'Pay by', cell: (c) => txt(c.payBy) },
  { id: 'partySource', label: 'Party source', cell: (c) => txt(c.partySource) },
];

export function CustomersPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const confirm = useConfirm();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize: PAGE_SIZE, search: search || undefined };
  const { data, isLoading, isFetching } = useCustomers(query);
  const del = useDeleteCustomer();
  const importMut = useImportCustomers();
  const cols = useColumnOrder('customers', COLUMNS);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const handleDelete = async (c: CustomerDto) => {
    const ok = await confirm({
      title: 'Delete customer?',
      description: `"${c.partyName ?? c.id}" will be permanently removed. This cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(c.id, {
      onSuccess: () => toast.success('Customer deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  const handleImport = async (file: File) => {
    try {
      const rows = await parseExcelFile(file);
      const res = await importMut.mutateAsync(rows);
      const skipped = res.errors.length ? `, ${res.errors.length} skipped` : '';
      toast.success(`Imported: ${res.created} created, ${res.updated} updated${skipped}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Import failed'));
    }
  };

  const handleExport = () => {
    exportCustomers(query).catch((e) => toast.error(getApiErrorMessage(e, 'Export failed')));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Customers</h2>
          <p className="text-muted-foreground text-sm">{total} record{total === 1 ? '' : 's'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ColumnSettings
            columns={cols.orderedReorderable}
            hidden={cols.hidden}
            onReorder={cols.moveBefore}
            onMove={cols.move}
            onToggle={cols.toggle}
            onReset={cols.reset}
          />
          {can('customer:export') && <ExportButton onClick={handleExport} />}
          {can('customer:import') && (
            <ImportButton onFile={handleImport} pending={importMut.isPending} />
          )}
          {can('customer:create') && (
            <Button size="sm" onClick={() => navigate('/customers/new')}>
              <Plus /> New customer
            </Button>
          )}
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          placeholder="Search name, agent, city, mobile, email…"
          className="pl-9"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <DataTable
        columns={cols.visibleColumns}
        rows={items}
        rowKey={(c) => c.id}
        isLoading={isLoading}
        emptyText="No customers found."
        onRowClick={(c) => can('customer:update') && navigate(`/customers/${c.id}/edit`)}
        actions={(c) => (
          <div className="flex justify-end gap-1">
            {can('customer:update') && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => navigate(`/customers/${c.id}/edit`)}
                aria-label="Edit"
              >
                <Pencil className="size-4" />
              </Button>
            )}
            {can('customer:delete') && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                onClick={() => handleDelete(c)}
                aria-label="Delete"
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        )}
      />

      <div className="flex items-center justify-between">
        <p className={cn('text-muted-foreground text-sm', isFetching && 'opacity-100')}>
          Page {data?.page ?? page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
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
