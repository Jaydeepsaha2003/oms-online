import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TransporterDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { cn, formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { ExportButton, ImportButton } from '@/components/common/excel-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  exportTransporters,
  useCreateTransporter,
  useDeleteTransporter,
  useImportTransporters,
  useTransporters,
  useUpdateTransporter,
} from './use-transporters';

/** Amount prefixed with the rupee symbol; dash when unknown. */
const money = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);

/** Matches the Products / Customers / Orders grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

const COLUMNS: DataColumn<TransporterDto>[] = [
  { id: 'name', label: 'Transport name', pin: 'left0', fixed: true, cell: (t) => <span className={cn(TEXT_CELL, 'text-indigo-700 dark:text-indigo-300')}>{t.name}</span> },
  { id: 'packing', label: 'Packing', align: 'right', cell: (t) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(t.packing)}</span> },
  { id: 'freight', label: 'Freight', align: 'right', cell: (t) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(t.freight)}</span> },
  { id: 'customers', label: 'Customers', align: 'right', cell: (t) => <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{t.customerCount ?? 0}</span> },
  {
    id: 'updated',
    label: 'Last updated',
    cell: (t) => (
      <span
        className="text-muted-foreground whitespace-nowrap text-[12px] font-medium tabular-nums"
        title={`Updated ${formatDateTime(t.updatedAt)} · Added ${formatDateTime(t.createdAt)}`}
      >
        {formatDateShort(t.updatedAt)}
      </span>
    ),
  },
];

export function TransportersPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<TransporterDto | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize: 50, search: search || undefined };
  const { data, isLoading, isFetching } = useTransporters(query);
  const totalPages = data?.totalPages ?? 1;
  const del = useDeleteTransporter();
  const importMut = useImportTransporters();
  const cols = useColumnOrder('transporters', COLUMNS);

  const items = data?.items ?? [];

  // Phones: one stacked card per transporter instead of a horizontally-scrolling table.
  const transporterMobileCard = (t: TransporterDto) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[14px] leading-tight font-bold text-slate-900 dark:text-slate-100">{t.name}</p>
        <span className="text-muted-foreground shrink-0 text-[11px] font-medium tabular-nums" title={`Updated ${formatDateTime(t.updatedAt)} · Added ${formatDateTime(t.createdAt)}`}>
          {formatDateShort(t.updatedAt)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Packing</p>
          <p className="font-bold tabular-nums text-slate-800 dark:text-slate-200">{money(t.packing)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Freight</p>
          <p className="font-bold tabular-nums text-slate-800 dark:text-slate-200">{money(t.freight)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Customers</p>
          <p className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{t.customerCount ?? 0}</p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 border-t pt-2" onClick={(e) => e.stopPropagation()}>
        {can('transporter:update') && (
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(t)} aria-label="Edit">
            <Pencil className="size-4" />
          </Button>
        )}
        {can('transporter:delete') && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-destructive hover:text-destructive"
            onClick={() => handleDelete(t)}
            aria-label="Delete"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );

  const handleDelete = async (t: TransporterDto) => {
    const ok = await confirm({
      title: 'Delete transporter?',
      description: `"${t.name}" will be permanently removed.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(t.id, {
      onSuccess: () => toast.success('Transporter deleted'),
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

  return (
    // Fills the viewport: toolbar pinned on top, grid scrolls, footer pinned at
    // the bottom — same three-band layout as Products/Customers.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      {/* ── Toolbar: search on the left, actions on the right, one card. */}
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <div className="relative w-full sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search transporter name…"
              className={cn(CONTROL, 'pl-8 font-medium', searchInput && CONTROL_ON)}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <p className="text-muted-foreground shrink-0 text-[12px] font-medium tabular-nums">
            <span className="font-bold text-foreground">{(data?.total ?? 0).toLocaleString('en-IN')}</span> record{(data?.total ?? 0) === 1 ? '' : 's'}
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
            {can('transporter:export') && <ExportButton onClick={() => exportTransporters(query)} />}
            {can('transporter:import') && (
              <ImportButton onFile={handleImport} pending={importMut.isPending} />
            )}
            {can('transporter:create') && (
              <Button size="sm" className="h-9 rounded-[4px] text-[12.5px] font-bold" onClick={() => setCreating(true)}>
                <Plus /> New transporter
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
          rowKey={(t) => t.id}
          isLoading={isLoading}
          dense
          fill
          hideSortIcon
          emptyText="No transporters yet."
          onRowClick={(t) => can('transporter:update') && setEditing(t)}
          mobileCard={transporterMobileCard}
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
          actions={(t) => (
            <div className="flex justify-end gap-1">
              {can('transporter:update') && (
                <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(t)} aria-label="Edit">
                  <Pencil className="size-4" />
                </Button>
              )}
              {can('transporter:delete') && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(t)}
                  aria-label="Delete"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
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

      {(creating || editing) && (
        <TransporterDialog
          transporter={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TransporterDialog({
  transporter,
  onClose,
}: {
  transporter: TransporterDto | null;
  onClose: () => void;
}) {
  const isEdit = !!transporter;
  const create = useCreateTransporter();
  const update = useUpdateTransporter(transporter?.id ?? 0);
  const saving = create.isPending || update.isPending;

  const [name, setName] = useState(transporter?.name ?? '');
  const [packing, setPacking] = useState(transporter?.packing?.toString() ?? '');
  const [freight, setFreight] = useState(transporter?.freight?.toString() ?? '');

  const numOrNull = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));

  const submit = () => {
    if (!name.trim()) return toast.error('Transporter name is required');
    const input = { name: name.trim(), packing: numOrNull(packing), freight: numOrNull(freight) };
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'Transporter updated' : 'Transporter created');
        onClose();
      },
      onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed')),
    };
    if (isEdit) update.mutate(input, opts);
    else create.mutate(input, opts);
  };

  useSaveShortcut(submit);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit transporter #${transporter!.id}` : 'New transporter'}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {isEdit && transporter!.code && (
            <div className="space-y-2">
              <Label>Code</Label>
              <Input
                value={transporter!.code}
                readOnly
                tabIndex={-1}
                aria-readonly
                className="bg-muted font-mono text-muted-foreground"
              />
              <p className="text-muted-foreground text-xs">Auto-generated · not editable</p>
            </div>
          )}
          <div className="space-y-2">
            <Label>Transport name *</Label>
            <Input
              className="uppercase"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Packing</Label>
              <Input type="number" step="any" value={packing} onChange={(e) => setPacking(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Freight</Label>
              <Input type="number" step="any" value={freight} onChange={(e) => setFreight(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              {isEdit ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
