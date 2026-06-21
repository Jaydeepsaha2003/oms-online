import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TransporterDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { cn, formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
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
const money = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString()}`);

const COLUMNS: DataColumn<TransporterDto>[] = [
  { id: 'code', label: 'Code', pin: 'left0', fixed: true, cell: (t) => <span className="text-muted-foreground font-mono text-xs">{t.code ?? '—'}</span> },
  { id: 'name', label: 'Transport name', pin: 'left1', fixed: true, cell: (t) => <span className="font-medium">{t.name}</span> },
  { id: 'packing', label: 'Packing', align: 'right', cell: (t) => money(t.packing) },
  { id: 'freight', label: 'Freight', align: 'right', cell: (t) => money(t.freight) },
  { id: 'customers', label: 'Customers', align: 'right', cell: (t) => t.customerCount ?? 0 },
  {
    id: 'updated',
    label: 'Last updated',
    cell: (t) => (
      <span
        className="text-muted-foreground whitespace-nowrap font-mono text-xs"
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
  const { data, isLoading } = useTransporters(query);
  const del = useDeleteTransporter();
  const importMut = useImportTransporters();
  const cols = useColumnOrder('transporters', COLUMNS);

  const items = data?.items ?? [];

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
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Transporters</h2>
          <p className="text-muted-foreground text-sm">{data?.total ?? 0} records</p>
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
          {can('transporter:export') && <ExportButton onClick={() => exportTransporters(query)} />}
          {can('transporter:import') && (
            <ImportButton onFile={handleImport} pending={importMut.isPending} />
          )}
          {can('transporter:create') && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New transporter
            </Button>
          )}
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          placeholder="Search transporter name…"
          className="pl-9"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <DataTable
        columns={cols.visibleColumns}
        rows={items}
        rowKey={(t) => t.id}
        isLoading={isLoading}
        emptyText="No transporters yet."
        onRowClick={(t) => can('transporter:update') && setEditing(t)}
        actions={(t) => (
          <div className="flex justify-end gap-1">
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
        )}
      />

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
