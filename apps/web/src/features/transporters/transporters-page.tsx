import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { TransporterDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
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

const num = (n: number | null) => (n == null ? '—' : n.toLocaleString());

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

  const query = { page, pageSize: 20, search: search || undefined };
  const { data, isLoading } = useTransporters(query);
  const del = useDeleteTransporter();
  const importMut = useImportTransporters();
  const fileRef = useRef<HTMLInputElement>(null);

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

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseExcelFile(file);
      const res = await importMut.mutateAsync(rows);
      toast.success(`Imported: ${res.created} created, ${res.updated} updated`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Import failed'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
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
          {can('transporter:export') && (
            <Button variant="outline" size="sm" onClick={() => exportTransporters(query)}>
              <Download /> Export
            </Button>
          )}
          {can('transporter:import') && (
            <>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={importMut.isPending}>
                {importMut.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Import
              </Button>
            </>
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

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">TID</TableHead>
              <TableHead>Transport name</TableHead>
              <TableHead className="text-right">Packing</TableHead>
              <TableHead className="text-right">Freight</TableHead>
              <TableHead className="text-right">Customers</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No transporters yet.
                </TableCell>
              </TableRow>
            ) : (
              items.map((t) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer"
                  onClick={() => can('transporter:update') && setEditing(t)}
                >
                  <TableCell className="text-muted-foreground tabular-nums">{t.id}</TableCell>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(t.packing)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(t.freight)}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.customerCount ?? 0}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
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
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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
          <div className="space-y-2">
            <Label>Transport name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
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
