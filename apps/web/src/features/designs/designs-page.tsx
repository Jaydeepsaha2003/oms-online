import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  IndianRupee,
  Layers,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Search,
  Shapes,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { CombinationDto, DesignDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { cn, formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useConfirm } from '@/components/common/confirm';
import { Combo } from '@/components/common/combo';
import { ColumnSettings } from '@/components/common/column-settings';
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
  useDesignLookups,
  useDesigns,
  useImportDesigns,
  useUpdateDesign,
} from './use-designs';
import {
  exportCombinations,
  useCombinations,
  useCreateCombination,
  useDeleteCombination,
  useImportCombinations,
} from '../combinations/use-combinations';

const PAGE_SIZE = 50;
const num = (n: number | null) => (n == null ? '—' : n.toLocaleString());
/** Amount prefixed with the rupee symbol; dash when unknown. */
const money = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString()}`);
/** Right-aligned header label with a static ▲▼ glyph after it. */
const costHeader = (
  <span className="inline-flex items-center gap-1">
    Cost <ChevronsUpDown className="size-3 opacity-60" />
  </span>
);

/** Margin = rate − cost; up/green for profit, down/red for loss, dash when unknown. */
const marginCell = (cost: number | null, rate: number | null) => {
  if (cost == null || rate == null) return <span className="text-muted-foreground">—</span>;
  const m = rate - cost;
  const Icon = m > 0 ? ArrowUp : m < 0 ? ArrowDown : Minus;
  const tone = m > 0 ? 'text-emerald-600' : m < 0 ? 'text-destructive' : 'text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center justify-end gap-1 font-medium tabular-nums', tone)}>
      ₹{m.toLocaleString()}
      <Icon className="size-3.5 shrink-0" />
    </span>
  );
};

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
  const importComboMut = useImportCombinations();
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

  const handleImportCombo = async (file: File) => {
    try {
      const rows = await parseExcelFile(file);
      const res = await importComboMut.mutateAsync(rows);
      const skipped = res.errors.length ? `, ${res.errors.length} skipped` : '';
      toast.success(`Imported: ${res.created} created, ${res.updated} updated${skipped}`);
      // Surface why rows were rejected (e.g. a design code that doesn't exist).
      if (res.errors.length) toast.warning(res.errors[0], { description: res.errors.length > 1 ? `+${res.errors.length - 1} more` : undefined });
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Import failed'));
    }
  };

  const designColumns = useMemo<DataColumn<DesignDto>[]>(
    () => [
      {
        id: 'sel',
        label: '',
        fixed: true,
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
      { id: 'category', label: 'Category', cell: (d) => d.category },
      { id: 'subCategory', label: 'Sub category', cell: (d) => d.subCategory },
      { id: 'designType', label: 'Design type', cell: (d) => <span className="font-medium">{d.designType}</span> },
      { id: 'cost', label: 'Cost', header: costHeader, align: 'right', cell: (d) => money(d.cost) },
      { id: 'rate', label: 'Rate', align: 'right', cell: (d) => money(d.rate) },
      { id: 'margin', label: 'Margin', align: 'right', cell: (d) => marginCell(d.cost, d.rate) },
    ],
    [selected],
  );

  const comboColumns = useMemo<DataColumn<CombinationDto>[]>(
    () => [
    { id: 'category', label: 'Category', cell: (c) => c.category || '—' },
    { id: 'subCategory', label: 'Sub category', cell: (c) => c.subCategory || '—' },
    { id: 'name', label: 'Design type', cell: (c) => <span className="font-medium">{c.name}</span> },
    { id: 'cost', label: 'Cost', header: costHeader, align: 'right', cell: (c) => <span className="font-semibold tabular-nums">{money(c.cost)}</span> },
    { id: 'rate', label: 'Rate', align: 'right', cell: (c) => money(c.rate) },
    { id: 'margin', label: 'Margin', align: 'right', cell: (c) => marginCell(c.cost, c.rate) },
    {
      id: 'updated',
      label: 'Last updated',
      cell: (c) => <span className="text-muted-foreground whitespace-nowrap font-mono text-xs" title={formatDateTime(c.updatedAt)}>{formatDateShort(c.updatedAt)}</span>,
    },
    ],
    [],
  );

  // Fresh keys (the merged page has a different column set than the old standalone
  // Designs/Combinations pages, whose saved order would otherwise scramble these).
  const designCols = useColumnOrder('designs-merged', designColumns);
  const comboCols = useColumnOrder('combinations-merged-v2', comboColumns);

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
            <ColumnSettings
              columns={designCols.orderedReorderable}
              hidden={designCols.hidden}
              onReorder={designCols.moveBefore}
              onMove={designCols.move}
              onToggle={designCols.toggle}
              onReset={designCols.reset}
            />
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
          columns={designCols.visibleColumns}
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
          <div className="flex flex-wrap items-center gap-2">
            <ColumnSettings
              columns={comboCols.orderedReorderable}
              hidden={comboCols.hidden}
              onReorder={comboCols.moveBefore}
              onMove={comboCols.move}
              onToggle={comboCols.toggle}
              onReset={comboCols.reset}
            />
            {can('combination:export') && combos.length > 0 && (
              <ExportButton onClick={() => exportCombinations({ page: 1, pageSize: 200 })} />
            )}
            {can('combination:import') && (
              <ImportButton onFile={handleImportCombo} pending={importComboMut.isPending} />
            )}
          </div>
        </div>

        <DataTable
          maxBodyHeight="max-h-[26vh]"
          columns={comboCols.visibleColumns}
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

/** A compact labelled field: small uppercase label tight above its control. */
function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground flex items-center gap-1 text-[11px] font-medium tracking-wide uppercase">
        {label}
        {required && <span className="text-primary">*</span>}
        {hint && <span className="text-muted-foreground/70 normal-case">· {hint}</span>}
      </Label>
      {children}
    </div>
  );
}

/** Number input with a leading ₹ adornment. */
function MoneyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <IndianRupee className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
      <Input
        type="number"
        step="any"
        inputMode="decimal"
        className="pl-8 tabular-nums"
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function DesignDialog({ design, onClose }: { design: DesignDto | null; onClose: () => void }) {
  const isEdit = !!design;
  const create = useCreateDesign();
  const update = useUpdateDesign(design?.id ?? 0);
  const { data: lookups } = useDesignLookups();
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

  // Live margin readout — only meaningful once both cost and rate are entered.
  const costN = numOrNull(form.cost);
  const rateN = numOrNull(form.rate);
  const margin = costN != null && rateN != null ? rateN - costN : null;
  const marginPct = margin != null && rateN ? (margin / rateN) * 100 : null;

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
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        {/* Header band */}
        <DialogHeader className="border-b bg-muted/40 px-5 py-3.5 text-left">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary ring-primary/15 flex size-9 items-center justify-center rounded-lg ring-1">
              <Shapes className="size-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base leading-tight">{isEdit ? 'Edit design' : 'New design'}</DialogTitle>
              <p className="text-muted-foreground truncate text-xs">
                {isEdit ? (
                  <>
                    Code <span className="text-foreground font-medium">{design!.code ?? `#${design!.id}`}</span> · update
                    its details
                  </>
                ) : (
                  'Classify the design and set its pricing'
                )}
              </p>
            </div>
          </div>
        </DialogHeader>

        <form
          className="grid gap-3.5 px-5 py-4 [&_input]:uppercase [&_input::placeholder]:normal-case"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" required>
              <Combo
                value={form.category}
                onChange={(v) => set('category', v)}
                options={lookups?.categories ?? []}
                placeholder="Select or add…"
              />
            </Field>
            <Field label="Sub category" required>
              <Combo
                value={form.subCategory}
                onChange={(v) => set('subCategory', v)}
                options={lookups?.subCategories ?? []}
                placeholder="Select or add…"
              />
            </Field>
          </div>

          <Field label="Design type" required>
            <Input value={form.designType} onChange={(e) => set('designType', e.target.value)} autoFocus />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Cost">
              <MoneyInput value={form.cost} onChange={(v) => set('cost', v)} />
            </Field>
            <Field label="Rate">
              <MoneyInput value={form.rate} onChange={(v) => set('rate', v)} />
            </Field>
          </div>

          {/* Live margin strip — appears only once both cost and rate are set. */}
          {margin != null && (
            <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <TrendingUp className="size-3.5" /> Margin (rate − cost)
              </span>
              <span
                className={cn(
                  'text-sm font-semibold tabular-nums',
                  margin < 0 ? 'text-destructive' : 'text-emerald-600',
                )}
              >
                ₹{margin.toLocaleString()}
                {marginPct != null && (
                  <span className="text-muted-foreground ml-1 text-xs font-normal">({marginPct.toFixed(1)}%)</span>
                )}
              </span>
            </div>
          )}

          <DialogFooter className="mt-1 gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Check className="size-4" />}
              {isEdit ? 'Save changes' : 'Create design'}
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
