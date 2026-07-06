import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { DesignNameDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { ExportButton, ImportButton } from '@/components/common/excel-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import {
  exportDesignNames,
  useCreateDesignName,
  useDeleteDesignName,
  useDesignNames,
  useImportDesignNames,
  useUpdateDesignName,
} from './use-design-names';

const PAGE_SIZE = 50;

export function DesignNamesPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DesignNameDto | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize: PAGE_SIZE, search: search || undefined };
  const { data, isLoading } = useDesignNames(query);
  const del = useDeleteDesignName();
  const importMut = useImportDesignNames();

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const columns: DataColumn<DesignNameDto>[] = [
    { id: 'designType', label: 'Design type', cell: (d) => <span className="font-medium">{d.designType}</span> },
    { id: 'designName', label: 'Design name', cell: (d) => d.designName },
    {
      id: 'updated',
      label: 'Last updated',
      sortValue: (d) => d.updatedAt,
      cell: (d) => (
        <span className="text-muted-foreground whitespace-nowrap font-mono text-xs" title={formatDateTime(d.updatedAt)}>
          {formatDateShort(d.updatedAt)}
        </span>
      ),
    },
  ];

  const handleDelete = async (d: DesignNameDto) => {
    const ok = await confirm({
      title: 'Delete design name?',
      description: `"${d.designType}" → "${d.designName}" will be removed.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(d.id, {
      onSuccess: () => toast.success('Design name deleted'),
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
          <h2 className="text-2xl font-semibold tracking-tight">Design Names</h2>
          <p className="text-muted-foreground text-sm">
            {data?.total ?? 0} records · maps a design-type code to a readable name
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('designname:export') && <ExportButton onClick={() => exportDesignNames(query)} />}
          {can('designname:import') && <ImportButton onFile={handleImport} pending={importMut.isPending} />}
          {can('designname:create') && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New design name
            </Button>
          )}
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          placeholder="Search design type or name…"
          className="pl-9"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(d) => d.id}
        isLoading={isLoading}
        onRowClick={(d) => can('designname:update') && setEditing(d)}
        emptyText="No design names yet."
        actions={(d) => (
          <div className="flex justify-end gap-1">
            {can('designname:update') && (
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(d)} aria-label="Edit">
                <Pencil className="size-4" />
              </Button>
            )}
            {can('designname:delete') && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                onClick={() => handleDelete(d)}
                aria-label="Delete"
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        )}
      />

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Page {data?.page ?? page} of {totalPages}
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

      {(creating || editing) && (
        <DesignNameDialog
          designName={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function DesignNameDialog({ designName, onClose }: { designName: DesignNameDto | null; onClose: () => void }) {
  const isEdit = !!designName;
  const create = useCreateDesignName();
  const update = useUpdateDesignName(designName?.id ?? 0);
  const saving = create.isPending || update.isPending;

  const [designType, setDesignType] = useState(designName?.designType ?? '');
  const [name, setName] = useState(designName?.designName ?? '');

  const submit = () => {
    if (!designType.trim() || !name.trim()) return toast.error('Design type and name are required');
    const input = { designType: designType.trim(), designName: name.trim() };
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'Design name updated' : 'Design name created');
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
          <DialogTitle>{isEdit ? `Edit design name #${designName!.id}` : 'New design name'}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4 [&_input]:uppercase"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label>Design type *</Label>
            <Input value={designType} onChange={(e) => setDesignType(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Design name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
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
