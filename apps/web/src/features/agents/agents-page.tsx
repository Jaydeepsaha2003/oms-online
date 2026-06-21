import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AgentDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { cn, formatDateTime } from '@/lib/utils';
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
  exportAgents,
  useAgents,
  useCreateAgent,
  useDeleteAgent,
  useImportAgents,
  useUpdateAgent,
} from './use-agents';

const PAGE_SIZE = 50;

const dt = (s: string) => (
  <span className="text-muted-foreground whitespace-nowrap text-sm">{formatDateTime(s)}</span>
);
const COLUMNS: DataColumn<AgentDto>[] = [
  { id: 'name', label: 'Agent name', pin: 'left0', fixed: true, cell: (a) => <span className="font-medium">{a.name}</span> },
  { id: 'contact', label: 'Contact No', cell: (a) => a.contactNo ?? '—' },
  { id: 'state', label: 'State', cell: (a) => a.state ?? '—' },
  { id: 'city', label: 'City', cell: (a) => a.city ?? '—' },
  { id: 'added', label: 'Added on', cell: (a) => dt(a.createdAt) },
  { id: 'updated', label: 'Last updated', cell: (a) => dt(a.updatedAt) },
];

export function AgentsPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AgentDto | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize: PAGE_SIZE, search: search || undefined };
  const { data, isLoading } = useAgents(query);
  const del = useDeleteAgent();
  const importMut = useImportAgents();
  const cols = useColumnOrder('agents', COLUMNS);

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const handleDelete = async (a: AgentDto) => {
    const ok = await confirm({
      title: 'Delete agent?',
      description: `"${a.name}" will be removed from the agent master.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(a.id, {
      onSuccess: () => toast.success('Agent deleted'),
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
          <h2 className="text-2xl font-semibold tracking-tight">Agents</h2>
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
          {can('agent:export') && <ExportButton onClick={() => exportAgents(query)} />}
          {can('agent:import') && <ImportButton onFile={handleImport} pending={importMut.isPending} />}
          {can('agent:create') && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New agent
            </Button>
          )}
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          placeholder="Search agent name…"
          className="pl-9"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <DataTable
        columns={cols.visibleColumns}
        rows={items}
        rowKey={(a) => a.id}
        isLoading={isLoading}
        emptyText="No agents yet."
        onRowClick={(a) => can('agent:update') && setEditing(a)}
        actions={(a) => (
          <div className="flex justify-end gap-1">
            {can('agent:update') && (
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(a)} aria-label="Edit">
                <Pencil className="size-4" />
              </Button>
            )}
            {can('agent:delete') && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                onClick={() => handleDelete(a)}
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

      {(creating || editing) && (
        <AgentDialog
          agent={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AgentDialog({ agent, onClose }: { agent: AgentDto | null; onClose: () => void }) {
  const isEdit = !!agent;
  const create = useCreateAgent();
  const update = useUpdateAgent(agent?.id ?? 0);
  const saving = create.isPending || update.isPending;
  const [name, setName] = useState(agent?.name ?? '');
  const [contactNo, setContactNo] = useState(agent?.contactNo ?? '');
  const [state, setState] = useState(agent?.state ?? '');
  const [city, setCity] = useState(agent?.city ?? '');

  const submit = () => {
    if (!name.trim()) return toast.error('Agent name is required');
    if (contactNo.trim() && !/^\+?[0-9][0-9\s\-()]{6,18}$/.test(contactNo.trim())) {
      return toast.error('Enter a valid contact number');
    }
    const input = {
      name: name.trim(),
      contactNo: contactNo.trim() || null,
      state: state.trim() || null,
      city: city.trim() || null,
    };
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'Agent updated' : 'Agent created');
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
          <DialogTitle>{isEdit ? `Edit agent #${agent!.id}` : 'New agent'}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4 [&_input]:uppercase"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label>Agent name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Contact No</Label>
            <Input value={contactNo} onChange={(e) => setContactNo(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>State</Label>
              <Input value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
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
