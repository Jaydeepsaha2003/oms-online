import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Filter,
  IndianRupee,
  Layers,
  Loader2,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
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
import { Combo, NativeSelect } from '@/components/common/combo';
import { ColumnSettings } from '@/components/common/column-settings';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { RowCheckbox } from '@/components/common/row-checkbox';
import { ExportButton, ImportButton } from '@/components/common/excel-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  exportDesigns,
  useCreateDesign,
  useDeleteDesign,
  useDesignLookups,
  useDesigns,
  useImportDesigns,
  useSetDesignFlags,
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
const num = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-IN'));
/** Amount prefixed with the rupee symbol; dash when unknown. */
const money = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);
/** Margin = rate − cost; up/green for profit, down/red for loss, dash when unknown. */
const marginCell = (cost: number | null, rate: number | null) => {
  if (cost == null || rate == null) return <span className="text-muted-foreground">—</span>;
  const m = rate - cost;
  const Icon = m > 0 ? ArrowUp : m < 0 ? ArrowDown : Minus;
  const tone = m > 0 ? 'text-emerald-600' : m < 0 ? 'text-destructive' : 'text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center justify-end gap-1 font-medium tabular-nums', tone)}>
      ₹{m.toLocaleString('en-IN')}
      <Icon className="size-3.5 shrink-0" />
    </span>
  );
};

/** Inline active/inactive toggle for a design row. Stops row-click (which selects). */
function DesignActiveToggle({ design }: { design: DesignDto }) {
  const setFlags = useSetDesignFlags();
  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <Switch
        checked={design.active}
        disabled={setFlags.isPending}
        onCheckedChange={(v) =>
          setFlags.mutate(
            { id: design.id, active: v },
            {
              onSuccess: () => toast.success(v ? `${design.designType} activated` : `${design.designType} deactivated`),
              onError: (e) => toast.error(getApiErrorMessage(e, 'Update failed')),
            },
          )
        }
        aria-label={`Active — ${design.designType}`}
      />
    </span>
  );
}

/** Inline "show on rate list" checkbox for a design row. */
function DesignRateListCheckbox({ design }: { design: DesignDto }) {
  const setFlags = useSetDesignFlags();
  return (
    <RowCheckbox
      checked={design.showOnRateList}
      loading={setFlags.isPending}
      onChange={(v) =>
        setFlags.mutate(
          { id: design.id, showOnRateList: v },
          { onError: (er) => toast.error(getApiErrorMessage(er, 'Update failed')) },
        )
      }
      label={`Show ${design.designType} on rate list`}
    />
  );
}

export function DesignsPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();

  // Shared category / sub-category dropdown options for both filter rows below.
  const { data: lookups } = useDesignLookups();

  // ── Designs (top) ──────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DesignDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Map<number, DesignDto>>(new Map());
  const [combining, setCombining] = useState(false);
  // After a new design is created, offer to combine it with same-category designs.
  const [combineWith, setCombineWith] = useState<DesignDto | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const activeFilterCount = (category ? 1 : 0) + (subCategory ? 1 : 0);
  const resetFilters = () => {
    setCategory('');
    setSubCategory('');
    setPage(1);
  };

  const query = {
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    category: category || undefined,
    subCategory: subCategory || undefined,
  };
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
  const [comboSearchInput, setComboSearchInput] = useState('');
  const [comboSearch, setComboSearch] = useState('');
  const [comboCategory, setComboCategory] = useState('');
  const [comboSubCategory, setComboSubCategory] = useState('');
  const [comboPage, setComboPage] = useState(1);
  const [comboMobileFiltersOpen, setComboMobileFiltersOpen] = useState(false);
  const comboActiveFilterCount = (comboCategory ? 1 : 0) + (comboSubCategory ? 1 : 0);
  const resetComboFilters = () => {
    setComboCategory('');
    setComboSubCategory('');
    setComboPage(1);
  };
  const comboQuery = {
    page: comboPage,
    pageSize: PAGE_SIZE,
    search: comboSearch || undefined,
    category: comboCategory || undefined,
    subCategory: comboSubCategory || undefined,
  };
  const { data: comboData, isLoading: combosLoading } = useCombinations(comboQuery);
  const delCombo = useDeleteCombination();
  const importComboMut = useImportCombinations();
  const combos = comboData?.items ?? [];
  const comboTotalPages = comboData?.totalPages ?? 1;

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
      { id: 'category', label: 'Category', sortValue: (d) => d.category, cell: (d) => <span className={cn(!d.active && 'text-muted-foreground')}>{d.category}</span> },
      { id: 'subCategory', label: 'Sub category', sortValue: (d) => d.subCategory, cell: (d) => <span className={cn(!d.active && 'text-muted-foreground')}>{d.subCategory}</span> },
      { id: 'designType', label: 'Design type', sortValue: (d) => d.designType, cell: (d) => <span className={cn('font-medium', !d.active && 'text-muted-foreground line-through')}>{d.designType}</span> },
      { id: 'cost', label: 'Cost', align: 'right', sortValue: (d) => d.cost, cell: (d) => money(d.cost) },
      { id: 'rate', label: 'Rate', align: 'right', sortValue: (d) => d.rate, cell: (d) => money(d.rate) },
      { id: 'margin', label: 'Margin', align: 'right', sortValue: (d) => (d.cost != null && d.rate != null ? d.rate - d.cost : null), cell: (d) => marginCell(d.cost, d.rate) },
      { id: 'active', label: 'Active', sortValue: (d) => (d.active ? 1 : 0), cell: (d) => <div className="flex justify-center"><DesignActiveToggle design={d} /></div> },
    ],
    [selected],
  );

  const comboColumns = useMemo<DataColumn<CombinationDto>[]>(
    () => [
    { id: 'category', label: 'Category', sortValue: (c) => c.category, cell: (c) => c.category || '—' },
    { id: 'subCategory', label: 'Sub category', sortValue: (c) => c.subCategory, cell: (c) => c.subCategory || '—' },
    { id: 'name', label: 'Design type', sortValue: (c) => c.name, cell: (c) => <span className="font-medium">{c.name}</span> },
    { id: 'cost', label: 'Cost', align: 'right', sortValue: (c) => c.cost, cell: (c) => <span className="font-semibold tabular-nums">{money(c.cost)}</span> },
    { id: 'rate', label: 'Rate', align: 'right', sortValue: (c) => c.rate, cell: (c) => money(c.rate) },
    { id: 'margin', label: 'Margin', align: 'right', sortValue: (c) => (c.cost != null && c.rate != null ? c.rate - c.cost : null), cell: (c) => marginCell(c.cost, c.rate) },
    {
      id: 'updated',
      label: 'Last updated',
      sortValue: (c) => c.updatedAt,
      cell: (c) => <span className="text-muted-foreground whitespace-nowrap font-mono text-xs" title={formatDateTime(c.updatedAt)}>{formatDateShort(c.updatedAt)}</span>,
    },
    ],
    [],
  );

  // Fresh keys (the merged page has a different column set than the old standalone
  // Designs/Combinations pages, whose saved order would otherwise scramble these).
  const designCols = useColumnOrder('designs-merged', designColumns);
  const comboCols = useColumnOrder('combinations-merged-v2', comboColumns);

  // Phones: one stacked card per design instead of a horizontally-scrolling table.
  // Selection (for building a combination) uses a ROUND indicator + a full
  // left-edge accent stripe — deliberately not another small SQUARE checkbox,
  // which would look like a near-duplicate of the square Rate list checkbox
  // below and the two get mixed up. The circle always shows (even unselected)
  // so it's clear the card is tappable.
  const designMobileCard = (d: DesignDto) => (
    <div
      className={cn(
        '-m-3 space-y-2.5 border-l-4 p-3 transition-colors',
        selected.has(d.id) ? 'border-l-primary bg-primary/5' : 'border-l-transparent',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span
            className={cn(
              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
              selected.has(d.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/30',
            )}
          >
            {selected.has(d.id) && <Check className="size-2.5" strokeWidth={3} />}
          </span>
          <div className="min-w-0">
            <p className={cn('leading-tight font-medium', !d.active && 'text-muted-foreground line-through')}>{d.designType}</p>
            <p className="text-muted-foreground text-xs">
              {d.category} · {d.subCategory}
            </p>
          </div>
        </div>
        <DesignActiveToggle design={d} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-muted-foreground">Cost</p>
          <p className="font-medium tabular-nums">{money(d.cost)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Rate</p>
          <p className="font-medium tabular-nums">{money(d.rate)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Margin</p>
          <p className="font-medium">{marginCell(d.cost, d.rate)}</p>
        </div>
      </div>
      <div className="flex items-center justify-between border-t pt-2.5" onClick={(e) => e.stopPropagation()}>
        <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs font-medium">
          <DesignRateListCheckbox design={d} />
          Rate list
        </label>
        <div className="flex items-center gap-1">
          {can('design:update') && (
            <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(d)} aria-label="Edit">
              <Pencil className="size-4" />
            </Button>
          )}
          {can('design:delete') && (
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
      </div>
    </div>
  );

  // Phones: one stacked card per combination instead of a horizontally-scrolling table.
  const comboMobileCard = (c: CombinationDto) => (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="leading-tight font-medium">{c.name}</p>
          <p className="text-muted-foreground text-xs">
            {c.category || '—'} · {c.subCategory || '—'}
          </p>
        </div>
        <span className="text-muted-foreground shrink-0 font-mono text-[11px]" title={formatDateTime(c.updatedAt)}>
          {formatDateShort(c.updatedAt)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-muted-foreground">Cost</p>
          <p className="font-medium tabular-nums">{money(c.cost)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Rate</p>
          <p className="font-medium tabular-nums">{money(c.rate)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Margin</p>
          <p className="font-medium">{marginCell(c.cost, c.rate)}</p>
        </div>
      </div>
      {can('combination:delete') && (
        <div className="flex justify-end border-t pt-2.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-destructive hover:text-destructive"
            onClick={() => handleDeleteCombo(c)}
            aria-label="Delete"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );

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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
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
            <Button
              variant="outline"
              size="icon"
              className="relative shrink-0 lg:hidden"
              onClick={() => setMobileFiltersOpen(true)}
              aria-label="Filters"
            >
              <Filter className="size-4" />
              {activeFilterCount > 0 && (
                <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-medium">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>
          <div className="hidden w-44 lg:block">
            <NativeSelect
              value={category}
              onChange={(v) => {
                setCategory(v);
                setSubCategory(''); // a sub from another category would return nothing
                setPage(1);
              }}
              options={['', ...(lookups?.categories ?? [])]}
              placeholder="All categories"
            />
          </div>
          <div className="hidden w-48 lg:block">
            <NativeSelect
              value={subCategory}
              onChange={(v) => {
                setSubCategory(v);
                setPage(1);
              }}
              options={['', ...(lookups?.subCategories ?? [])]}
              placeholder="All sub categories"
            />
          </div>
          {selected.size > 0 && (
            <div className="bg-primary/5 ring-primary/15 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1 sm:ml-auto">
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

        {/* Phones only: Category / Sub category live behind the Filter icon above. */}
        <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
          <SheetContent side="bottom" className="lg:hidden">
            <SheetHeader>
              <div className="flex items-center justify-between">
                <SheetTitle>Filters</SheetTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground -mr-2 gap-1.5"
                  onClick={resetFilters}
                  disabled={activeFilterCount === 0}
                >
                  <RotateCcw className="size-3.5" /> Reset
                </Button>
              </div>
            </SheetHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs font-medium uppercase">Category</Label>
                <NativeSelect
                  value={category}
                  onChange={(v) => {
                    setCategory(v);
                    setSubCategory('');
                    setPage(1);
                  }}
                  options={['', ...(lookups?.categories ?? [])]}
                  placeholder="All categories"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs font-medium uppercase">Sub category</Label>
                <NativeSelect
                  value={subCategory}
                  onChange={(v) => {
                    setSubCategory(v);
                    setPage(1);
                  }}
                  options={['', ...(lookups?.subCategories ?? [])]}
                  placeholder="All sub categories"
                />
              </div>
            </div>
            <SheetFooter>
              <Button className="w-full" onClick={() => setMobileFiltersOpen(false)}>
                Show {(data?.total ?? 0).toLocaleString('en-IN')} designs
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <DataTable
          dense
          hideRowView
          columns={designCols.visibleColumns}
          rows={items}
          rowKey={(d) => d.id}
          isLoading={isLoading}
          emptyText="No designs yet."
          onRowClick={(d) => toggle(d)}
          mobileCard={designMobileCard}
          actions={(d) => (
            <div className="flex items-center justify-end gap-2">
              <DesignRateListCheckbox design={d} />
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

        {totalPages > 1 && (
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
        )}
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
              <ExportButton onClick={() => exportCombinations(comboQuery)} />
            )}
            {can('combination:import') && (
              <ImportButton onFile={handleImportCombo} pending={importComboMut.isPending} />
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <div className="relative max-w-sm flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                placeholder="Search combination name, design type…"
                className="pl-9"
                value={comboSearchInput}
                onChange={(e) => {
                  setComboSearchInput(e.target.value);
                  setComboSearch(e.target.value.trim());
                  setComboPage(1);
                }}
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              className="relative shrink-0 lg:hidden"
              onClick={() => setComboMobileFiltersOpen(true)}
              aria-label="Filters"
            >
              <Filter className="size-4" />
              {comboActiveFilterCount > 0 && (
                <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-medium">
                  {comboActiveFilterCount}
                </span>
              )}
            </Button>
          </div>
          <div className="hidden w-44 lg:block">
            <NativeSelect
              value={comboCategory}
              onChange={(v) => {
                setComboCategory(v);
                setComboSubCategory(''); // a sub from another category would return nothing
                setComboPage(1);
              }}
              options={['', ...(lookups?.categories ?? [])]}
              placeholder="All categories"
            />
          </div>
          <div className="hidden w-48 lg:block">
            <NativeSelect
              value={comboSubCategory}
              onChange={(v) => {
                setComboSubCategory(v);
                setComboPage(1);
              }}
              options={['', ...(lookups?.subCategories ?? [])]}
              placeholder="All sub categories"
            />
          </div>
        </div>

        {/* Phones only: Category / Sub category live behind the Filter icon above. */}
        <Sheet open={comboMobileFiltersOpen} onOpenChange={setComboMobileFiltersOpen}>
          <SheetContent side="bottom" className="lg:hidden">
            <SheetHeader>
              <div className="flex items-center justify-between">
                <SheetTitle>Filters</SheetTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground -mr-2 gap-1.5"
                  onClick={resetComboFilters}
                  disabled={comboActiveFilterCount === 0}
                >
                  <RotateCcw className="size-3.5" /> Reset
                </Button>
              </div>
            </SheetHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs font-medium uppercase">Category</Label>
                <NativeSelect
                  value={comboCategory}
                  onChange={(v) => {
                    setComboCategory(v);
                    setComboSubCategory('');
                    setComboPage(1);
                  }}
                  options={['', ...(lookups?.categories ?? [])]}
                  placeholder="All categories"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs font-medium uppercase">Sub category</Label>
                <NativeSelect
                  value={comboSubCategory}
                  onChange={(v) => {
                    setComboSubCategory(v);
                    setComboPage(1);
                  }}
                  options={['', ...(lookups?.subCategories ?? [])]}
                  placeholder="All sub categories"
                />
              </div>
            </div>
            <SheetFooter>
              <Button className="w-full" onClick={() => setComboMobileFiltersOpen(false)}>
                Show {(comboData?.total ?? 0).toLocaleString('en-IN')} combinations
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <DataTable
          columns={comboCols.visibleColumns}
          rows={combos}
          rowKey={(c) => c.id}
          isLoading={combosLoading}
          emptyText="No combinations yet — select designs above and click Create combination."
          mobileCard={comboMobileCard}
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

        {comboTotalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">
              Page {comboData?.page ?? comboPage} of {comboTotalPages}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setComboPage((p) => Math.max(1, p - 1))} disabled={comboPage <= 1}>
                <ChevronLeft /> Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setComboPage((p) => Math.min(comboTotalPages, p + 1))}
                disabled={comboPage >= comboTotalPages}
              >
                Next <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </section>

      {(creating || editing) && (
        <DesignDialog
          design={editing}
          onCreated={can('combination:create') ? (d) => setCombineWith(d) : undefined}
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
      {combineWith && <CombineWithDesignDialog base={combineWith} onClose={() => setCombineWith(null)} />}
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

function DesignDialog({ design, onClose, onCreated }: { design: DesignDto | null; onClose: () => void; onCreated?: (d: DesignDto) => void }) {
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
    active: design?.active ?? true,
    showOnRateList: design?.showOnRateList ?? true,
  });
  const set = (k: 'category' | 'subCategory' | 'designType' | 'cost' | 'rate', v: string) => setForm((f) => ({ ...f, [k]: v }));
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
      active: form.active,
      showOnRateList: form.showOnRateList,
    };
    if (isEdit) {
      update.mutate(input, {
        onSuccess: () => {
          toast.success('Design updated');
          onClose();
        },
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed')),
      });
    } else {
      create.mutate(input, {
        onSuccess: (d) => {
          toast.success('Design created');
          onClose();
          onCreated?.(d); // offer to build a combination with this new design
        },
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed')),
      });
    }
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

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/40 px-3 py-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium normal-case">
              <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
              Active <span className="text-muted-foreground font-normal">(order pickers)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium normal-case">
              <RowCheckbox
                checked={form.showOnRateList}
                onChange={(v) => setForm((f) => ({ ...f, showOnRateList: v }))}
                label="Show on rate list"
              />
              Show on rate list
            </label>
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
                ₹{margin.toLocaleString('en-IN')}
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
              {cost.toLocaleString('en-IN')} / {rate.toLocaleString('en-IN')}
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

/**
 * Shown right after a NEW design is created: offers to build a combination with
 * it by ticking other designs in the SAME category + sub-category.
 */
function CombineWithDesignDialog({ base, onClose }: { base: DesignDto; onClose: () => void }) {
  const create = useCreateCombination();
  // Pull all designs once and narrow to the same category + sub-category.
  const { data, isLoading } = useDesigns({ page: 1, pageSize: 1000 });
  const candidates = useMemo(
    () =>
      (data?.items ?? [])
        .filter((d) => d.id !== base.id && d.category === base.category && d.subCategory === base.subCategory)
        .sort((a, b) => a.designType.localeCompare(b.designType)),
    [data, base],
  );

  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setPicked((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const filtered = candidates.filter((d) => !search.trim() || d.designType.toLowerCase().includes(search.toLowerCase()));
  const chosen = candidates.filter((d) => picked.has(d.id));
  const all = [base, ...chosen];
  const autoName = all.map((d) => d.designType).join(' + ');
  const cost = all.reduce((s, d) => s + (d.cost ?? 0), 0);
  const rate = all.reduce((s, d) => s + (d.rate ?? 0), 0);

  const submit = () => {
    if (picked.size === 0) return toast.error('Tick at least one design to combine with');
    create.mutate(
      { name: autoName || null, designIds: all.map((d) => d.id) },
      {
        onSuccess: () => {
          toast.success('Combination created');
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Create failed')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="text-primary size-5" /> Create a combination with “{base.designType}”?
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <p className="text-muted-foreground text-sm">
            Tick other designs in <span className="text-foreground font-medium">{base.category} / {base.subCategory}</span> to
            combine with the new design — or skip for now.
          </p>

          {candidates.length > 8 && (
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input className="pl-9" placeholder="Filter design types…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          )}

          <div className="max-h-64 space-y-0.5 overflow-auto rounded-md border p-1.5">
            {isLoading ? (
              <div className="text-muted-foreground flex h-20 items-center justify-center text-sm">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-muted-foreground px-2 py-6 text-center text-sm">
                No other designs in this category / sub-category yet.
              </p>
            ) : (
              filtered.map((d) => (
                <label key={d.id} className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm">
                  <RowCheckbox checked={picked.has(d.id)} onChange={() => toggle(d.id)} label={`Include ${d.designType}`} />
                  <span className="font-medium">{d.designType}</span>
                  <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                    cost {num(d.cost)} · rate {num(d.rate)}
                  </span>
                </label>
              ))
            )}
          </div>

          {picked.size > 0 && (
            <div className="bg-muted/40 space-y-1 rounded-md px-3 py-2 text-sm">
              <div className="truncate">
                <span className="text-muted-foreground">Name: </span>
                <span className="font-medium uppercase">{autoName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{all.length} designs · combined cost / rate</span>
                <span className="font-semibold tabular-nums">{cost.toLocaleString('en-IN')} / {rate.toLocaleString('en-IN')}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Not now
          </Button>
          <Button type="button" onClick={submit} disabled={create.isPending || picked.size === 0}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Layers className="size-4" />}
            Create combination
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
