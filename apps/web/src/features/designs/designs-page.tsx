import { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Layers, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { CombinationDto, DesignDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { cn, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { ExportButton, ImportButton } from '@/components/common/excel-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  exportDesigns,
  useCreateDesign,
  useDeleteDesign,
  useDesigns,
  useImportDesigns,
  useUpdateDesign,
} from './use-designs';
import {
  exportCombinations,
  useCombinations,
  useCreateCombination,
  useDeleteCombination,
} from '../combinations/use-combinations';

const PAGE_SIZE = 50;
const num = (n: number | null) => (n == null ? '—' : n.toLocaleString());

export function DesignsPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();

  // ── Designs (top) ──────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DesignDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Map<number, DesignDto>>(new Map());
  const [combining, setCombining] = useState(false);

  const query = { page, pageSize: PAGE_SIZE, search: search || undefined };
  const { data, isLoading } = useDesigns(query);
  const del = useDeleteDesign();
  const importMut = useImportDesigns();

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const toggle = (d: DesignDto) =>
    setSelected((m) => {
      const n = new Map(m);
      if (n.has(d.id)) n.delete(d.id);
      else n.set(d.id, d);
      return n;
    });

  // ── Combinations (bottom) ──────────────────────────────────────────────────
  const { data: comboData, isLoading: combosLoading } = useCombinations({ page: 1, pageSize: 200 });
  const delCombo = useDeleteCombination();
  const combos = comboData?.items ?? [];

  const handleDelete = async (d: DesignDto) => {
    const ok = await confirm({
      title: 'Delete design?',
      description: `"${d.designType}" (${d.category}/${d.subCategory}) will be removed — and from any combinations that use it.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(d.id, {
      onSuccess: () => {
        setSelected((m) => {
          const n = new Map(m);
          n.delete(d.id);
          return n;
        });
        toast.success('Design deleted');
      },
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  const handleDeleteCombo = async (c: CombinationDto) => {
    const ok = await confirm({
      title: 'Delete combination?',
      description: `"${c.name}" will be removed.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    delCombo.mutate(c.id, {
      onSuccess: () => toast.success('Combination deleted'),
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

  const designColumns = useMemo<DataColumn<DesignDto>[]>(
    () => [
      {
        id: 'sel',
        label: '',
        cell: (d) => (
          <span
            className={cn(
              'flex size-4 items-center justify-center rounded border transition-colors',
              selected.has(d.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
            )}
          >
            {selected.has(d.id) && <Check className="size-3" />}
          </span>
        ),
      },
      { id: 'code', label: 'Code', cell: (d) => <span className="text-muted-foreground font-mono text-xs">{d.code ?? '—'}</span> },
      { id: 'category', label: 'Category', cell: (d) => d.category },
      { id: 'subCategory', label: 'Sub category', cell: (d) => d.subCategory },
      { id: 'designType', label: 'Design type', cell: (d) => <span className="font-medium">{d.designType}</span> },
      { id: 'cost', label: 'Cost', align: 'right', cell: (d) => num(d.cost) },
      { id: 'rate', label: 'Rate', align: 'right', cell: (d) => num(d.rate) },
    ],
    [selected],
  );

  const comboColumns: DataColumn<CombinationDto>[] = [
    { id: 'code', label: 'Code', cell: (c) => <span className="text-muted-foreground font-mono text-xs">{c.code ?? '—'}</span> },
    { id: 'name', label: 'Combination', cell: (c) => <span className="font-medium">{c.name}</span> },
    {
      id: 'designs',
      label: 'Designs',
      cell: (c) => (
        <div className="flex flex-wrap gap-1">
          {c.designs.map((d) => (
            <span key={d.id} className="bg-muted rounded px-1.5 py-0.5 text-xs">
              {d.designType}
            </span>
          ))}
        </div>
      ),
    },
    { id: 'cost', label: 'Cost', align: 'right', cell: (c) => <span className="font-semibold tabular-nums">{num(c.cost)}</span> },
    { id: 'rate', label: 'Rate', align: 'right', cell: (c) => num(c.rate) },
    {
      id: 'updated',
      label: 'Last updated',
      cell: (c) => <span className="text-muted-foreground whitespace-nowrap text-sm">{formatDateTime(c.updatedAt)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {/* ── Designs ─────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Designs</h2>
            <p className="text-muted-foreground text-sm">
              {data?.total ?? 0} designs · select rows to build a combination below
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {can('design:export') && <ExportButton onClick={() => exportDesigns(query)} />}
            {can('design:import') && <ImportButton onFile={handleImport} pending={importMut.isPending} />}
            {can('design:create') && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus /> New design
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search category, sub category, design type…"
              className="pl-9"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setSearch(e.target.value.trim());
                setPage(1);
              }}
            />
          </div>
          {selected.size > 0 && (
            <div className="bg-primary/5 ring-primary/15 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1">
              <span className="font-medium">{selected.size} selected</span>
              {can('combination:create') && (
                <Button size="sm" onClick={() => setCombining(true)}>
                  <Layers className="size-4" /> Create combination
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>
                <X className="size-4" /> Clear
              </Button>
            </div>
          )}
        </div>

        <DataTable
          maxBodyHeight="max-h-[40vh]"
          columns={designColumns}
          rows={items}
          rowKey={(d) => d.id}
          isLoading={isLoading}
          emptyText="No designs yet."
          onRowClick={(d) => toggle(d)}
          actions={(d) => (
            <div className="flex justify-end gap-1">
              {can('design:update') && (
                <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(d)} aria-label="Edit">
                  <Pencil className="size-4" />
                </Button>
              )}
              {can('design:delete') && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
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
      </section>

      {/* ── Combinations ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Layers className="text-primary size-5" /> Combinations
            </h2>
            <p className="text-muted-foreground text-sm">
              {comboData?.total ?? 0} combinations · cost = live sum of the linked designs
            </p>
          </div>
          {can('combination:export') && combos.length > 0 && (
            <ExportButton onClick={() => exportCombinations({ page: 1, pageSize: 200 })} />
          )}
        </div>

        <DataTable
          maxBodyHeight="max-h-[26vh]"
          columns={comboColumns}
          rows={combos}
          rowKey={(c) => c.id}
          isLoading={combosLoading}
          emptyText="No combinations yet — select designs above and click Create combination."
          actions={(c) =>
            can('combination:delete') ? (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => handleDeleteCombo(c)}
                  aria-label="Delete"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ) : null
          }
        />
      </section>

      {(creating || editing) && (
        <DesignDialog
          design={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {combining && (
        <CombinationDialog
          designs={[...selected.values()]}
          onClose={() => setCombining(false)}
          onCreated={() => {
            setCombining(false);
            setSelected(new Map());
          }}
        />
      )}
    </div>
  );
}

function DesignDialog({ design, onClose }: { design: DesignDto | null; onClose: () => void }) {
  const isEdit = !!design;
  const create = useCreateDesign();
  const update = useUpdateDesign(design?.id ?? 0);
  const saving = create.isPending || update.isPending;

  const [form, setForm] = useState({
    category: design?.category ?? '',
    subCategory: design?.subCategory ?? '',
    designType: design?.designType ?? '',
    cost: design?.cost?.toString() ?? '',
    rate: design?.rate?.toString() ?? '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const numOrNull = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));

  const submit = () => {
    if (!form.category.trim() || !form.subCategory.trim() || !form.designType.trim()) {
      return toast.error('Category, Sub category and Design type are required');
    }
    const input = {
      category: form.category.trim(),
      subCategory: form.subCategory.trim(),
      designType: form.designType.trim(),
      cost: numOrNull(form.cost),
      rate: numOrNull(form.rate),
    };
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'Design updated' : 'Design created');
        onClose();
      },
      onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed')),
    };
    if (isEdit) update.mutate(input, opts);
    else create.mutate(input, opts);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit design ${design!.code ?? `#${design!.id}`}` : 'New design'}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4 [&_input]:uppercase [&_input::placeholder]:normal-case"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Category *</Label>
              <Input value={form.category} onChange={(e) => set('category', e.target.value)} autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Sub category *</Label>
              <Input value={form.subCategory} onChange={(e) => set('subCategory', e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Design type *</Label>
            <Input value={form.designType} onChange={(e) => set('designType', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Cost</Label>
              <Input type="number" step="any" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Rate</Label>
              <Input type="number" step="any" value={form.rate} onChange={(e) => set('rate', e.target.value)} />
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

function CombinationDialog({
  designs,
  onClose,
  onCreated,
}: {
  designs: DesignDto[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const create = useCreateCombination();
  const autoName = designs.map((d) => d.designType).join(' + ');
  const [name, setName] = useState(autoName);
  const cost = designs.reduce((s, d) => s + (d.cost ?? 0), 0);
  const rate = designs.reduce((s, d) => s + (d.rate ?? 0), 0);

  const submit = () => {
    if (designs.length === 0) return toast.error('Select at least one design');
    create.mutate(
      { name: name.trim() || null, designIds: designs.map((d) => d.id) },
      {
        onSuccess: () => {
          toast.success('Combination created');
          onCreated();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Create failed')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New combination</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              className="uppercase"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={autoName}
            />
            <p className="text-muted-foreground text-xs">Auto-built from the selected design types — edit if you like.</p>
          </div>

          <div className="space-y-2">
            <Label>Designs ({designs.length})</Label>
            <div className="max-h-48 space-y-1 overflow-auto rounded-lg border p-2">
              {designs.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded px-2 py-1 text-sm">
                  <span className="truncate">
                    <span className="font-medium">{d.designType}</span>{' '}
                    <span className="text-muted-foreground text-xs">
                      {d.category}/{d.subCategory}
                    </span>
                  </span>
                  <span className="tabular-nums">{num(d.cost)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-muted/40 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
            <span className="font-medium">Combined cost / rate</span>
            <span className="tabular-nums font-semibold">
              {cost.toLocaleString()} / {rate.toLocaleString()}
            </span>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <Layers className="size-4" />}
              Create combination
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
