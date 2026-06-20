import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import type { CustomerDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  exportCustomers,
  useCustomers,
  useDeleteCustomer,
  useImportCustomers,
} from './use-customers';

const PAGE_SIZE = 20;
const num = (n: number | null) => (n == null ? '—' : n.toLocaleString());
const txt = (s: string | null) => (s && s.trim() !== '' ? s : '—');

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
  const fileRef = useRef<HTMLInputElement>(null);

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

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseExcelFile(file);
      const res = await importMut.mutateAsync(rows);
      const skipped = res.errors.length ? `, ${res.errors.length} skipped` : '';
      toast.success(`Imported: ${res.created} created, ${res.updated} updated${skipped}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Import failed'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
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
          {can('customer:export') && (
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download /> Export
            </Button>
          )}
          {can('customer:import') && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleImport}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={importMut.isPending}
              >
                {importMut.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Import
              </Button>
            </>
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

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">ID</TableHead>
              <TableHead>Party name</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>City</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead className="text-right">Billing rate</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                  No customers found.
                </TableCell>
              </TableRow>
            ) : (
              items.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => can('customer:update') && navigate(`/customers/${c.id}/edit`)}
                >
                  <TableCell className="text-muted-foreground tabular-nums">{c.id}</TableCell>
                  <TableCell className="font-medium">{txt(c.partyName)}</TableCell>
                  <TableCell>{txt(c.agentName)}</TableCell>
                  <TableCell>{txt(c.category)}</TableCell>
                  <TableCell>{txt(c.city)}</TableCell>
                  <TableCell>{txt(c.state)}</TableCell>
                  <TableCell>{txt(c.mobile)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(c.billingRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(c.creditPeriod)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
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
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
