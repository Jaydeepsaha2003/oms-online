import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, EllipsisVertical, Loader2, Pencil, Plus, Power, PowerOff, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomerDto, CustomerStatus } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useColumnOrder } from '@/hooks/use-column-order';
import { usePageSize } from '@/hooks/use-page-size';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { ExportButton, ImportButton } from '@/components/common/excel-actions';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  exportCustomers,
  useCustomers,
  useDeleteCustomer,
  useImportCustomers,
  useSetCustomerActive,
} from './use-customers';

const num = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-IN'));
/** Amount prefixed with the rupee symbol; dash when unknown. */
const money = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);
const txt = (s: string | null) => (s && s.trim() !== '' ? s : '—');

/** Matches the Products / Orders / Challans grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

/** A status pill with a coloured dot — carries the state alongside the word. */
function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-[11.5px] font-bold ring-1 ring-inset',
        active
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25'
          : 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25',
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-emerald-500' : 'bg-rose-500')} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

/** Every customer column. The most-used ones come first; Code + Customer name
 * are frozen to the left so identity stays visible while scrolling the wide row. */
const COLUMNS: DataColumn<CustomerDto>[] = [
  { id: 'name', label: 'Customer name', pin: 'left0', fixed: true, cell: (c) => <span className={cn(TEXT_CELL, 'text-indigo-700 dark:text-indigo-300')}>{txt(c.partyName)}</span> },
  { id: 'status', label: 'Status', sortValue: (c) => (c.active ? 1 : 0), cell: (c) => <StatusPill active={c.active} /> },
  { id: 'agent', label: 'Agent', cell: (c) => <span className={TEXT_CELL}>{txt(c.agentName)}</span> },
  { id: 'category', label: 'Category', cell: (c) => <span className={TEXT_CELL}>{txt(c.category)}</span> },
  { id: 'city', label: 'City', cell: (c) => <span className={TEXT_CELL}>{txt(c.city)}</span> },
  { id: 'transport', label: 'Transport', cell: (c) => <span className={TEXT_CELL}>{txt(c.transportName)}</span> },
  { id: 'billingRate', label: 'Billing Rate/KGS', align: 'right', cell: (c) => <span className="text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(c.billingRate)}</span> },
  { id: 'creditPeriod', label: 'Credit period', align: 'right', cell: (c) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{num(c.creditPeriod)}</span> },
  { id: 'tds', label: 'TDS %', align: 'right', cell: (c) => (c.tdsApplicable && c.tdsPercent != null ? <span className={cn(TEXT_CELL, 'tabular-nums')}>{c.tdsPercent}%</span> : <span className="text-muted-foreground text-[13px]">—</span>) },
  { id: 'state', label: 'State', cell: (c) => <span className={TEXT_CELL}>{txt(c.state)}</span> },
  { id: 'region', label: 'Region', cell: (c) => <span className={TEXT_CELL}>{txt(c.region)}</span> },
  { id: 'mobile', label: 'Mobile', cell: (c) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{txt(c.mobile)}</span> },
  { id: 'email', label: 'Email', cell: (c) => <span className={TEXT_CELL}>{txt(c.email)}</span> },
  { id: 'brand', label: 'Brand', cell: (c) => <span className={TEXT_CELL}>{txt(c.brand)}</span> },
  { id: 'bag', label: 'Bag', cell: (c) => <span className={TEXT_CELL}>{txt(c.bagName)}</span> },
  { id: 'packing', label: 'Packing', align: 'right', cell: (c) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(c.packing)}</span> },
  { id: 'freight', label: 'Freight', align: 'right', cell: (c) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(c.freight)}</span> },
  { id: 'boxRate', label: 'Box rate', align: 'right', cell: (c) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(c.boxRate)}</span> },
  { id: 'billRatePc', label: 'Billing Rate/Pcs', align: 'right', cell: (c) => <span className="text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(c.billRatePc)}</span> },
  { id: 'payBy', label: 'Pay by', cell: (c) => <span className={TEXT_CELL}>{txt(c.payBy)}</span> },
  { id: 'partySource', label: 'Party source', cell: (c) => <span className={TEXT_CELL}>{txt(c.partySource)}</span> },
];

/**
 * The row's actions, behind one 3-dot menu.
 *
 * Two loose icons became three actions the moment Active/Inactive could be
 * flipped from here, and three icons in a table column is the point at which
 * they stop being recognisable and start being a row of small targets. One
 * trigger, a named list, and Delete behind a separator — the same shape used on
 * Dispatch and the CRM cards.
 */
function CustomerActions({
  c,
  onEdit,
  onDelete,
}: {
  c: CustomerDto;
  onEdit: (c: CustomerDto) => void;
  onDelete: (c: CustomerDto) => void;
}) {
  const { can } = usePermissions();
  const setActive = useSetCustomerActive();
  const canUpdate = can('customer:update');
  const canDelete = can('customer:delete');
  if (!canUpdate && !canDelete) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 cursor-pointer"
          aria-label={`Actions for ${c.partyName}`}
          title="Edit, activate or delete this customer"
          onClick={(e) => e.stopPropagation()}
        >
          <EllipsisVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 font-sans">
        {canUpdate && (
          <>
            <DropdownMenuItem onSelect={() => onEdit(c)}>
              <Pencil /> Edit customer
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={setActive.isPending}
              onSelect={() =>
                setActive.mutate(
                  { id: c.id, active: !c.active },
                  {
                    onSuccess: () => toast.success(c.active ? `${c.partyName} set inactive` : `${c.partyName} set active`),
                    onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Could not change')),
                  },
                )
              }
            >
              {c.active ? (
                <>
                  <PowerOff className="text-amber-600" /> Set inactive
                </>
              ) : (
                <>
                  <Power className="text-emerald-600" /> Set active
                </>
              )}
            </DropdownMenuItem>
          </>
        )}
        {canDelete && (
          <>
            {canUpdate && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(c)}>
              <Trash2 /> Delete permanently
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CustomersPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const confirm = useConfirm();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CustomerStatus>('ALL');
  const { page, setPage, pageSize, setPageSize } = usePageSize('customers');

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize, search: search || undefined, status };
  const { data, isLoading, isFetching } = useCustomers(query);
  const del = useDeleteCustomer();
  const importMut = useImportCustomers();
  const cols = useColumnOrder('customers', COLUMNS);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  // Phones: one stacked card per customer instead of a horizontally-scrolling
  // table — surfaces the most-used fields only (full detail stays behind Edit).
  const customerMobileCard = (c: CustomerDto) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] leading-tight font-bold text-slate-900 dark:text-slate-100">{txt(c.partyName)}</p>
          <p className="text-muted-foreground truncate text-[11.5px] font-medium">
            {txt(c.agentName)} · {txt(c.city)}
          </p>
        </div>
        <StatusPill active={c.active} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Category</p>
          <p className="font-bold text-slate-800 dark:text-slate-200">{txt(c.category)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Mobile</p>
          <p className="font-bold tabular-nums text-slate-800 dark:text-slate-200">{txt(c.mobile)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Billing Rate/KGS</p>
          <p className="text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(c.billingRate)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Credit period</p>
          <p className="font-bold tabular-nums text-slate-800 dark:text-slate-200">{num(c.creditPeriod)}</p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 border-t pt-2" onClick={(e) => e.stopPropagation()}>
        <CustomerActions c={c} onEdit={(x) => navigate(`/customers/${x.id}/edit`)} onDelete={handleDelete} />
      </div>
    </div>
  );

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
    // Fills the viewport: toolbar pinned on top, footer pinned at the bottom, only
    // the grid scrolls. `/customers` is a flush route (app-shell), so the page
    // owns its own padding.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      {/* ── Toolbar: search + status filter on the left, actions on the right. */}
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <div className="relative w-full sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search name, agent, city, mobile, email…"
              className={cn(CONTROL, 'pl-8 font-medium', searchInput && CONTROL_ON)}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1 rounded-[4px] border border-amber-300 bg-amber-50/40 p-0.5 dark:border-amber-400/40">
            {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((s) => {
              const on = status === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setStatus(s);
                    setPage(1);
                  }}
                  aria-pressed={on}
                  className={cn(
                    'cursor-pointer rounded-[3px] px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap capitalize transition-colors duration-150',
                    on
                      ? s === 'ACTIVE'
                        ? 'bg-emerald-500 text-white shadow-sm'
                        : s === 'INACTIVE'
                          ? 'bg-rose-500 text-white shadow-sm'
                          : 'bg-slate-700 text-white shadow-sm'
                      : 'text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-200/70 dark:hover:bg-amber-400/10',
                  )}
                >
                  {s.toLowerCase()}
                </button>
              );
            })}
          </div>
          <p className="text-muted-foreground shrink-0 text-[12px] font-medium tabular-nums">
            <span className="font-bold text-foreground">{total.toLocaleString('en-IN')}</span> record{total === 1 ? '' : 's'}
            {isFetching && <Loader2 className="ml-1 inline size-3 animate-spin align-[-2px]" />}
          </p>
          <div className="ml-auto flex flex-wrap items-center gap-2">
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
              <Button size="sm" className="h-9 rounded-[4px] text-[12.5px] font-bold" onClick={() => navigate('/customers/new')}>
                <Plus /> New customer
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* The grid pans sideways when columns outgrow the screen; slim scrollbars
          make that discoverable. */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          '[&_[data-slot=table-container]]:overscroll-x-contain',
          '[&_[data-slot=table-container]]:[scrollbar-width:thin]',
          '[&_[data-slot=table-container]]:[scrollbar-color:var(--color-slate-400)_var(--color-slate-100)]',
        )}
      >
        <DataTable
          columns={cols.visibleColumns}
          rows={items}
          rowKey={(c) => c.id}
          isLoading={isLoading}
          dense
          fill
          hideSortIcon
          emptyText="No customers found."
          onRowClick={(c) => can('customer:update') && navigate(`/customers/${c.id}/edit`)}
          mobileCard={customerMobileCard}
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
          actions={(c) => (
            <div className="flex items-center justify-end">
              <CustomerActions c={c} onEdit={(x) => navigate(`/customers/${x.id}/edit`)} onDelete={handleDelete} />
            </div>
          )}
        />
      </div>

      {/* ── Footer: paging ─────────────────────────────────────────────────────── */}
      <div className="bg-card flex items-center justify-between rounded-[4px] border px-3 py-2 shadow-sm">
        <p className="text-muted-foreground text-[12px] font-medium">
          Page <span className="font-bold tabular-nums text-foreground">{data?.page ?? page}</span> of{' '}
          <span className="font-bold tabular-nums text-foreground">{totalPages}</span>
        </p>
        <div className="flex items-center gap-3">
          <PageSizeSelect value={pageSize} onChange={setPageSize} />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-[4px] font-semibold"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-[4px] font-semibold"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
