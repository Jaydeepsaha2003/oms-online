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
import { isBaseDesignType, type CombinationDto, type DesignDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { cn, formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { usePageSize } from '@/hooks/use-page-size';
import { useConfirm } from '@/components/common/confirm';
import { Combo, NativeSelect } from '@/components/common/combo';
import { ColumnSettings } from '@/components/common/column-settings';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { RowCheckbox } from '@/components/common/row-checkbox';
import { PageSizeSelect } from '@/components/common/page-size-select';
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
  useCreateDesignBulk,
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
  useCreateCombinationBulk,
  useDeleteCombination,
  useImportCombinations,
} from '../combinations/use-combinations';

const num = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-IN'));
/** Amount prefixed with the rupee symbol; dash when unknown. */
const money = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);

/** Matches the Products / Orders / Challans grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

const COMBINATION_STATUS_OPTIONS = [
  { value: '', label: 'All designs' },
  { value: 'standalone', label: 'Standalone only' },
  { value: 'combined', label: 'Combined only' },
];

/** Margin = rate − cost; up/green for profit, down/red for loss, dash when unknown. */
const marginCell = (cost: number | null, rate: number | null) => {
  if (cost == null || rate == null) return <span className="text-muted-foreground text-[13px]">—</span>;
  const m = rate - cost;
  const Icon = m > 0 ? ArrowUp : m < 0 ? ArrowDown : Minus;
  const tone = m > 0 ? 'text-emerald-600 dark:text-emerald-400' : m < 0 ? 'text-destructive' : 'text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center justify-end gap-1 text-[13px] font-bold tabular-nums', tone)}>
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

/** Standalone vs. combined indicator for a design row — chips list the
 *  combination(s) it's a component of, or a plain "Standalone" pill. */
function CombinationBadge({ names }: { names: string[] }) {
  if (names.length === 0) {
    return (
      <span className="text-muted-foreground inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold ring-1 ring-slate-200 ring-inset dark:bg-white/5 dark:ring-white/10">
        Standalone
      </span>
    );
  }
  return (
    <div className="flex max-w-xs flex-wrap gap-1">
      {names.map((n) => (
        <span
          key={n}
          className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200 ring-inset dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-indigo-400/25"
        >
          {n}
        </span>
      ))}
    </div>
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
  const [combinationStatus, setCombinationStatus] = useState<'' | 'standalone' | 'combined'>('');
  const { page, setPage, pageSize, setPageSize } = usePageSize('designs-merged');
  const [editing, setEditing] = useState<DesignDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Map<number, DesignDto>>(new Map());
  const [combining, setCombining] = useState(false);
  // After a new design is created, offer to combine it with same-category designs.
  // The rows just created, handed to the "which combinations?" step. An array
  // because Advanced mode writes one per sub-category.
  const [combineWith, setCombineWith] = useState<DesignDto[] | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const activeFilterCount = (category ? 1 : 0) + (subCategory ? 1 : 0) + (combinationStatus ? 1 : 0);
  const resetFilters = () => {
    setCategory('');
    setSubCategory('');
    setCombinationStatus('');
    setPage(1);
  };

  const query = {
    page,
    pageSize,
    search: search || undefined,
    category: category || undefined,
    subCategory: subCategory || undefined,
    combinationStatus: combinationStatus || undefined,
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
  const { page: comboPage, setPage: setComboPage, pageSize: comboPageSize, setPageSize: setComboPageSize } = usePageSize('combinations-merged-v2');
  const [comboMobileFiltersOpen, setComboMobileFiltersOpen] = useState(false);
  const comboActiveFilterCount = (comboCategory ? 1 : 0) + (comboSubCategory ? 1 : 0);
  const resetComboFilters = () => {
    setComboCategory('');
    setComboSubCategory('');
    setComboPage(1);
  };
  const comboQuery = {
    page: comboPage,
    pageSize: comboPageSize,
    search: comboSearch || undefined,
    category: comboCategory || undefined,
    subCategory: comboSubCategory || undefined,
  };
  // Sub-category options narrowed to the currently-selected category, for both
  // filter bars — otherwise picking a category still offered every sub-category
  // ever seen, most of which return zero rows once combined with that category.
  const subCategoryOptions = useMemo(
    () => [...new Set((lookups?.subCategories ?? []).filter((sc) => !category || sc.category === category).map((sc) => sc.subCategory))],
    [lookups, category],
  );
  const comboSubCategoryOptions = useMemo(
    () => [...new Set((lookups?.subCategories ?? []).filter((sc) => !comboCategory || sc.category === comboCategory).map((sc) => sc.subCategory))],
    [lookups, comboCategory],
  );

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
        noSort: true,
        cell: (d) => (
          <span
            className={cn(
              'flex size-4 items-center justify-center rounded-[3px] border-[1.5px] bg-white transition-colors',
              selected.has(d.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-500',
            )}
          >
            {selected.has(d.id) && <Check className="size-3" strokeWidth={3} />}
          </span>
        ),
      },
      { id: 'category', label: 'Category', sortValue: (d) => d.category, cell: (d) => <span className={cn(TEXT_CELL, !d.active && 'text-muted-foreground')}>{d.category}</span> },
      { id: 'subCategory', label: 'Sub category', sortValue: (d) => d.subCategory, cell: (d) => <span className={cn(TEXT_CELL, !d.active && 'text-muted-foreground')}>{d.subCategory}</span> },
      { id: 'designType', label: 'Design type', sortValue: (d) => d.designType, cell: (d) => <span className={cn(TEXT_CELL, !d.active && 'text-muted-foreground line-through')}>{d.designType}</span> },
      { id: 'cost', label: 'Cost', align: 'right', sortValue: (d) => d.cost, cell: (d) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(d.cost)}</span> },
      { id: 'rate', label: 'Rate', align: 'right', sortValue: (d) => d.rate, cell: (d) => <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(d.rate)}</span> },
      { id: 'margin', label: 'Margin', align: 'right', sortValue: (d) => (d.cost != null && d.rate != null ? d.rate - d.cost : null), cell: (d) => marginCell(d.cost, d.rate) },
      {
        id: 'combinations',
        label: 'Combinations',
        noSort: true,
        cell: (d) => <CombinationBadge names={d.combinationNames} />,
      },
      { id: 'active', label: 'Active', sortValue: (d) => (d.active ? 1 : 0), cell: (d) => <div className="flex justify-center"><DesignActiveToggle design={d} /></div> },
    ],
    [selected],
  );

  const comboColumns = useMemo<DataColumn<CombinationDto>[]>(
    () => [
    { id: 'category', label: 'Category', sortValue: (c) => c.category, cell: (c) => <span className={TEXT_CELL}>{c.category || '—'}</span> },
    { id: 'subCategory', label: 'Sub category', sortValue: (c) => c.subCategory, cell: (c) => <span className={TEXT_CELL}>{c.subCategory || '—'}</span> },
    { id: 'name', label: 'Design type', sortValue: (c) => c.name, cell: (c) => <span className={cn(TEXT_CELL, 'text-indigo-700 dark:text-indigo-300')}>{c.name}</span> },
    {
      id: 'designs',
      label: 'Designs',
      noSort: true,
      cell: (c) => (
        <div className="flex max-w-xs flex-wrap gap-1">
          {c.designs.map((d) => (
            <span
              key={d.id}
              className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200 ring-inset dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-indigo-400/25"
              title={`${d.category} / ${d.subCategory}`}
            >
              {d.designType}
            </span>
          ))}
        </div>
      ),
    },
    { id: 'cost', label: 'Cost', align: 'right', sortValue: (c) => c.cost, cell: (c) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(c.cost)}</span> },
    { id: 'rate', label: 'Rate', align: 'right', sortValue: (c) => c.rate, cell: (c) => <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(c.rate)}</span> },
    { id: 'margin', label: 'Margin', align: 'right', sortValue: (c) => (c.cost != null && c.rate != null ? c.rate - c.cost : null), cell: (c) => marginCell(c.cost, c.rate) },
    {
      id: 'updated',
      label: 'Last updated',
      sortValue: (c) => c.updatedAt,
      cell: (c) => <span className="text-muted-foreground whitespace-nowrap text-[12px] font-medium tabular-nums" title={formatDateTime(c.updatedAt)}>{formatDateShort(c.updatedAt)}</span>,
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
        '-m-3 space-y-2 border-l-4 p-3 transition-colors',
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
            <p className={cn('truncate text-[14px] leading-tight font-bold text-slate-900 dark:text-slate-100', !d.active && 'text-muted-foreground line-through')}>{d.designType}</p>
            <p className="text-muted-foreground truncate text-[11.5px] font-medium">
              {d.category} · {d.subCategory}
            </p>
            <div className="mt-1"><CombinationBadge names={d.combinationNames} /></div>
          </div>
        </div>
        <DesignActiveToggle design={d} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Cost</p>
          <p className="font-bold tabular-nums text-slate-800 dark:text-slate-200">{money(d.cost)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Rate</p>
          <p className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(d.rate)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Margin</p>
          <p className="font-bold">{marginCell(d.cost, d.rate)}</p>
        </div>
      </div>
      <div className="flex items-center justify-between border-t pt-2" onClick={(e) => e.stopPropagation()}>
        <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-[11.5px] font-medium">
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
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] leading-tight font-bold text-indigo-700 dark:text-indigo-300">{c.name}</p>
          <p className="text-muted-foreground truncate text-[11.5px] font-medium">
            {c.category || '—'} · {c.subCategory || '—'}
          </p>
        </div>
        <span className="text-muted-foreground shrink-0 text-[11px] font-medium tabular-nums" title={formatDateTime(c.updatedAt)}>
          {formatDateShort(c.updatedAt)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Cost</p>
          <p className="font-bold tabular-nums text-slate-800 dark:text-slate-200">{money(c.cost)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Rate</p>
          <p className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(c.rate)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Margin</p>
          <p className="font-bold">{marginCell(c.cost, c.rate)}</p>
        </div>
      </div>
      {can('combination:delete') && (
        <div className="flex justify-end border-t pt-2">
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
    <div className="flex flex-col gap-3 font-sans">
      {/* ── Designs ─────────────────────────────────────────────────────────── */}
      <section className="space-y-2.5">
        {/* Toolbar: search + filters on the left, actions on the right, one card.
            (No section title — the topbar already says "Designs".) */}
        <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
          <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
            <div className="relative w-full sm:w-64">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                placeholder="Search category, sub category, design type…"
                className={cn(CONTROL, 'pl-8 font-medium', searchInput && CONTROL_ON)}
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
              className={cn('relative size-9 shrink-0 rounded-[4px] border-amber-300 lg:hidden', activeFilterCount > 0 && CONTROL_ON)}
              onClick={() => setMobileFiltersOpen(true)}
              aria-label="Filters"
            >
              <Filter className="size-4" />
              {activeFilterCount > 0 && (
                <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-bold tabular-nums">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            <div className="hidden w-40 lg:block">
              <NativeSelect
                value={category}
                onChange={(v) => {
                  setCategory(v);
                  setSubCategory(''); // a sub from another category would return nothing
                  setPage(1);
                }}
                options={['', ...(lookups?.categories ?? [])]}
                placeholder="All categories"
                className={cn(CONTROL, 'font-medium', category && CONTROL_ON)}
              />
            </div>
            <div className="hidden w-44 lg:block">
              <NativeSelect
                value={subCategory}
                onChange={(v) => {
                  setSubCategory(v);
                  setPage(1);
                }}
                options={['', ...subCategoryOptions]}
                placeholder="All sub categories"
                className={cn(CONTROL, 'font-medium', subCategory && CONTROL_ON)}
              />
            </div>
            <div className="hidden w-44 lg:block">
              <NativeSelect
                value={combinationStatus}
                onChange={(v) => {
                  setCombinationStatus(v as '' | 'standalone' | 'combined');
                  setPage(1);
                }}
                options={COMBINATION_STATUS_OPTIONS}
                placeholder="All designs"
                className={cn(CONTROL, 'font-medium', combinationStatus && CONTROL_ON)}
              />
            </div>
            <p className="text-muted-foreground shrink-0 text-[12px] font-medium tabular-nums">
              <span className="font-bold text-foreground">{(data?.total ?? 0).toLocaleString('en-IN')}</span> designs
            </p>

            {selected.size > 0 && (
              <div className="flex items-center gap-2 rounded-[4px] bg-sky-50 px-3 py-1.5 text-[12.5px] font-semibold text-sky-700 ring-1 ring-sky-200 ring-inset dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/25">
                <span className="tabular-nums">{selected.size} selected</span>
                {can('combination:create') && (
                  <Button size="sm" className="h-7 rounded-[4px] text-[12px] font-bold" onClick={() => setCombining(true)}>
                    <Layers className="size-3.5" /> Create combination
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => setSelected(new Map())}
                  className="cursor-pointer text-sky-700/70 transition-colors hover:text-sky-900 dark:text-sky-300/70 dark:hover:text-sky-200"
                  title="Clear selection"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2">
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
                <Button size="sm" className="h-9 rounded-[4px] text-[12.5px] font-bold" onClick={() => setCreating(true)}>
                  <Plus /> New design
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Phones only: Category / Sub category live behind the Filter icon above. */}
        <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
          <SheetContent side="bottom" className="font-poppins lg:hidden">
            <SheetHeader>
              <div className="flex items-center justify-between">
                <SheetTitle>Filters</SheetTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground -mr-2 gap-1.5 font-semibold"
                  onClick={resetFilters}
                  disabled={activeFilterCount === 0}
                >
                  <RotateCcw className="size-3.5" /> Reset
                </Button>
              </div>
            </SheetHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Category</Label>
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
                <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Sub category</Label>
                <NativeSelect
                  value={subCategory}
                  onChange={(v) => {
                    setSubCategory(v);
                    setPage(1);
                  }}
                  options={['', ...subCategoryOptions]}
                  placeholder="All sub categories"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Combinations</Label>
                <NativeSelect
                  value={combinationStatus}
                  onChange={(v) => {
                    setCombinationStatus(v as '' | 'standalone' | 'combined');
                    setPage(1);
                  }}
                  options={COMBINATION_STATUS_OPTIONS}
                  placeholder="All designs"
                />
              </div>
            </div>
            <SheetFooter>
              <Button className="w-full font-bold" onClick={() => setMobileFiltersOpen(false)}>
                Show {(data?.total ?? 0).toLocaleString('en-IN')} designs
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <div
          className={cn(
            '[&_[data-slot=table-container]]:overscroll-x-contain',
            '[&_[data-slot=table-container]]:[scrollbar-width:thin]',
            '[&_[data-slot=table-container]]:[scrollbar-color:var(--color-slate-400)_var(--color-slate-100)]',
          )}
        >
          <DataTable
            dense
            hideRowView
            hideSortIcon
            columns={designCols.visibleColumns}
            rows={items}
            rowKey={(d) => d.id}
            isLoading={isLoading}
            emptyText="No designs yet."
            onRowClick={(d) => toggle(d)}
            mobileCard={designMobileCard}
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
        </div>

        {totalPages > 1 && (
          <div className="bg-card flex items-center justify-between gap-3 rounded-[4px] border px-3 py-2 shadow-sm">
            <p className="text-muted-foreground text-[12px] font-medium">
              Page <span className="font-bold tabular-nums text-foreground">{data?.page ?? page}</span> of{' '}
              <span className="font-bold tabular-nums text-foreground">{totalPages}</span>
            </p>
            <div className="flex items-center gap-3">
              <PageSizeSelect value={pageSize} onChange={setPageSize} />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
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
        )}
      </section>

      {/* ── Combinations ────────────────────────────────────────────────────── */}
      <section className="space-y-2.5">
        {/* This sub-section keeps its own header (unlike Designs above) — it's a
            distinct area the topbar doesn't name on its own. */}
        <div className="flex items-center gap-2">
          <Layers className="text-primary size-4" />
          <h2 className="text-[15px] font-bold tracking-tight">Combinations</h2>
          <p className="text-muted-foreground text-[12px] font-medium">
            <span className="font-bold text-foreground">{(comboData?.total ?? 0).toLocaleString('en-IN')}</span> combinations · cost = live sum of the linked designs
          </p>
        </div>

        <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
          <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
            <div className="relative w-full sm:w-64">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                placeholder="Search combination name, design type…"
                className={cn(CONTROL, 'pl-8 font-medium', comboSearchInput && CONTROL_ON)}
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
              className={cn('relative size-9 shrink-0 rounded-[4px] border-amber-300 lg:hidden', comboActiveFilterCount > 0 && CONTROL_ON)}
              onClick={() => setComboMobileFiltersOpen(true)}
              aria-label="Filters"
            >
              <Filter className="size-4" />
              {comboActiveFilterCount > 0 && (
                <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-bold tabular-nums">
                  {comboActiveFilterCount}
                </span>
              )}
            </Button>
            <div className="hidden w-40 lg:block">
              <NativeSelect
                value={comboCategory}
                onChange={(v) => {
                  setComboCategory(v);
                  setComboSubCategory(''); // a sub from another category would return nothing
                  setComboPage(1);
                }}
                options={['', ...(lookups?.categories ?? [])]}
                placeholder="All categories"
                className={cn(CONTROL, 'font-medium', comboCategory && CONTROL_ON)}
              />
            </div>
            <div className="hidden w-44 lg:block">
              <NativeSelect
                value={comboSubCategory}
                onChange={(v) => {
                  setComboSubCategory(v);
                  setComboPage(1);
                }}
                options={['', ...comboSubCategoryOptions]}
                placeholder="All sub categories"
                className={cn(CONTROL, 'font-medium', comboSubCategory && CONTROL_ON)}
              />
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
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
        </div>

        {/* Phones only: Category / Sub category live behind the Filter icon above. */}
        <Sheet open={comboMobileFiltersOpen} onOpenChange={setComboMobileFiltersOpen}>
          <SheetContent side="bottom" className="font-poppins lg:hidden">
            <SheetHeader>
              <div className="flex items-center justify-between">
                <SheetTitle>Filters</SheetTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground -mr-2 gap-1.5 font-semibold"
                  onClick={resetComboFilters}
                  disabled={comboActiveFilterCount === 0}
                >
                  <RotateCcw className="size-3.5" /> Reset
                </Button>
              </div>
            </SheetHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Category</Label>
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
                <Label className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Sub category</Label>
                <NativeSelect
                  value={comboSubCategory}
                  onChange={(v) => {
                    setComboSubCategory(v);
                    setComboPage(1);
                  }}
                  options={['', ...comboSubCategoryOptions]}
                  placeholder="All sub categories"
                />
              </div>
            </div>
            <SheetFooter>
              <Button className="w-full font-bold" onClick={() => setComboMobileFiltersOpen(false)}>
                Show {(comboData?.total ?? 0).toLocaleString('en-IN')} combinations
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <div
          className={cn(
            '[&_[data-slot=table-container]]:overscroll-x-contain',
            '[&_[data-slot=table-container]]:[scrollbar-width:thin]',
            '[&_[data-slot=table-container]]:[scrollbar-color:var(--color-slate-400)_var(--color-slate-100)]',
          )}
        >
          <DataTable
            dense
            hideSortIcon
            columns={comboCols.visibleColumns}
            rows={combos}
            rowKey={(c) => c.id}
            isLoading={combosLoading}
            emptyText="No combinations yet — select designs above and click Create combination."
            mobileCard={comboMobileCard}
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
        </div>

        {comboTotalPages > 1 && (
          <div className="bg-card flex items-center justify-between gap-3 rounded-[4px] border px-3 py-2 shadow-sm">
            <p className="text-muted-foreground text-[12px] font-medium">
              Page <span className="font-bold tabular-nums text-foreground">{comboData?.page ?? comboPage}</span> of{' '}
              <span className="font-bold tabular-nums text-foreground">{comboTotalPages}</span>
            </p>
            <div className="flex items-center gap-3">
              <PageSizeSelect value={comboPageSize} onChange={setComboPageSize} />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setComboPage((p) => Math.max(1, p - 1))} disabled={comboPage <= 1}>
                  <ChevronLeft /> Prev
                </Button>
                <Button
                  variant="outline"
                  className="rounded-[4px] font-semibold"
                  size="sm"
                  onClick={() => setComboPage((p) => Math.min(comboTotalPages, p + 1))}
                  disabled={comboPage >= comboTotalPages}
                >
                  Next <ChevronRight />
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      {(creating || editing) && (
        <DesignDialog
          design={editing}
          onCreated={can('combination:create') ? (created) => setCombineWith(created) : undefined}
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
      {combineWith && combineWith.length > 0 && (
        <CombineWithDesignDialog base={combineWith} onClose={() => setCombineWith(null)} />
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

function DesignDialog({ design, onClose, onCreated }: { design: DesignDto | null; onClose: () => void; onCreated?: (created: DesignDto[]) => void }) {
  const isEdit = !!design;
  const create = useCreateDesign();
  const createBulk = useCreateDesignBulk();
  const update = useUpdateDesign(design?.id ?? 0);
  const { data: lookups } = useDesignLookups();
  const saving = create.isPending || createBulk.isPending || update.isPending;

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
  const subCategoryOptions = useMemo(
    () => [...new Set((lookups?.subCategories ?? []).filter((sc) => !form.category || sc.category === form.category).map((sc) => sc.subCategory))],
    [lookups, form.category],
  );

  /*
   * Advanced: the same design type into MANY sub-categories at once.
   *
   * "AMBIENT" is normally sold in every sub-category of its category at the
   * same cost and rate, so entering it one sub-category at a time is this form
   * filled in a dozen times over. Editing stays single — an existing row is one
   * row, and a multi-target edit would silently rewrite designs nobody opened.
   */
  const [advanced, setAdvanced] = useState(false);
  const [subPicked, setSubPicked] = useState<Set<string>>(new Set());
  const [subSearch, setSubSearch] = useState('');
  const shownSubs = useMemo(
    () => subCategoryOptions.filter((sc) => !subSearch.trim() || sc.toLowerCase().includes(subSearch.trim().toLowerCase())),
    [subCategoryOptions, subSearch],
  );
  const allSubsPicked = subCategoryOptions.length > 0 && subPicked.size === subCategoryOptions.length;
  const toggleSub = (sc: string) =>
    setSubPicked((s) => {
      const n = new Set(s);
      if (n.has(sc)) n.delete(sc);
      else n.add(sc);
      return n;
    });

  // Live margin readout — only meaningful once both cost and rate are entered.
  const costN = numOrNull(form.cost);
  const rateN = numOrNull(form.rate);
  const margin = costN != null && rateN != null ? rateN - costN : null;
  const marginPct = margin != null && rateN ? (margin / rateN) * 100 : null;

  const bulkMode = advanced && !isEdit;

  const submit = () => {
    if (!form.category.trim() || !form.designType.trim()) {
      return toast.error('Category and Design type are required');
    }
    if (bulkMode ? subPicked.size === 0 : !form.subCategory.trim()) {
      return toast.error(bulkMode ? 'Tick at least one sub-category' : 'Sub category is required');
    }
    const common = {
      category: form.category.trim(),
      designType: form.designType.trim(),
      cost: numOrNull(form.cost),
      rate: numOrNull(form.rate),
      active: form.active,
      showOnRateList: form.showOnRateList,
    };
    const onError = (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed'));

    if (bulkMode) {
      createBulk.mutate(
        { ...common, subCategories: [...subPicked] },
        {
          onSuccess: (res) => {
            const n = res.created.length;
            toast.success(
              n
                ? `${form.designType.trim()} added to ${n} sub-categor${n === 1 ? 'y' : 'ies'}` +
                    (res.skipped.length ? ` — ${res.skipped.length} already had it` : '')
                : `Already in every sub-category picked — nothing to add`,
            );
            onClose();
            // Nothing was written, so there is nothing to combine with.
            if (n) onCreated?.(res.created);
          },
          onError,
        },
      );
      return;
    }

    const input = { ...common, subCategory: form.subCategory.trim() };
    if (isEdit) {
      update.mutate(input, {
        onSuccess: () => {
          toast.success('Design updated');
          onClose();
        },
        onError,
      });
    } else {
      create.mutate(input, {
        onSuccess: (d) => {
          toast.success('Design created');
          onClose();
          onCreated?.([d]); // offer to build combinations with this new design
        },
        onError,
      });
    }
  };

  useSaveShortcut(submit);

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
                onChange={(v) => { set('category', v); set('subCategory', ''); setSubPicked(new Set()); }}
                options={lookups?.categories ?? []}
                placeholder="Select or add…"
              />
            </Field>
            {!bulkMode && (
              <Field label="Sub category" required>
                <Combo
                  value={form.subCategory}
                  onChange={(v) => set('subCategory', v)}
                  options={subCategoryOptions}
                  placeholder="Select or add…"
                />
              </Field>
            )}
            {/* Simple / Advanced sits where the single sub-category box would be
                in Advanced mode, because that box IS what it replaces. New
                designs only — see the `advanced` state comment. */}
            {!isEdit && (
              <div className={cn('flex items-end', bulkMode && 'justify-start')}>
                <div role="group" aria-label="Sub-category mode" className="inline-flex h-9 overflow-hidden rounded-md border normal-case">
                  {([[false, 'Simple'], [true, 'Advanced']] as const).map(([v, label]) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={advanced === v}
                      onClick={() => setAdvanced(v)}
                      title={v ? 'Add this design to several sub-categories at once' : 'Add it to one sub-category'}
                      className={cn(
                        'px-3 text-[12.5px] font-semibold transition-colors',
                        advanced === v ? 'bg-slate-700 text-white' : 'text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Advanced: every sub-category of the chosen category, as a checklist.
              Ticking none is blocked on submit rather than silently meaning
              "all" — writing a dozen rows is not something to infer. */}
          {bulkMode && (
            <Field label={`Sub categories — ${subPicked.size} of ${subCategoryOptions.length} ticked`} required>
              <div className="overflow-hidden rounded-lg border normal-case">
                <div className="bg-muted/50 flex flex-wrap items-center gap-2 border-b px-2.5 py-1.5">
                  <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium">
                    <RowCheckbox
                      checked={allSubsPicked}
                      disabled={!subCategoryOptions.length}
                      onChange={() => setSubPicked(allSubsPicked ? new Set() : new Set(subCategoryOptions))}
                      label="All sub-categories"
                    />
                    All
                  </label>
                  {subCategoryOptions.length > 8 && (
                    <div className="relative ml-auto min-w-0 flex-1">
                      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
                      <Input
                        className="h-7 pl-7 text-[12.5px] normal-case"
                        placeholder="Filter…"
                        value={subSearch}
                        onChange={(e) => setSubSearch(e.target.value)}
                      />
                    </div>
                  )}
                </div>
                <div className="max-h-44 overflow-auto p-1.5">
                  {!form.category.trim() ? (
                    <p className="text-muted-foreground px-2 py-5 text-center text-[12.5px]">Pick a category first.</p>
                  ) : shownSubs.length === 0 ? (
                    <p className="text-muted-foreground px-2 py-5 text-center text-[12.5px]">
                      No sub-categories under {form.category}.
                    </p>
                  ) : (
                    shownSubs.map((sc) => (
                      <label key={sc} className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12.5px]">
                        <RowCheckbox checked={subPicked.has(sc)} onChange={() => toggleSub(sc)} label={`Add to ${sc}`} />
                        <span className="font-medium">{sc}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </Field>
          )}

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
              {isEdit
                ? 'Save changes'
                : bulkMode && subPicked.size > 0
                  ? `Create in ${subPicked.size} sub-categor${subPicked.size === 1 ? 'y' : 'ies'}`
                  : 'Create design'}
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

  useSaveShortcut(submit);

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
 * The "which combinations do you want?" step, shown right after new designs are
 * created.
 *
 * Two things make this usable that did not hold before:
 *
 * 1. Only BASE designs are offered. Design types are written as their parts
 *    joined with "+", so the design table itself holds both the parts and the
 *    composites — under GLASS / 10-PCS-FG-22G, 66 rows of which only 18 are
 *    real building blocks. Listing DL, LOGO *and* DL+LOGO side by side is what
 *    made the picker unreadable, and picking the composite would produce
 *    "DL + DL+LOGO", naming the same design twice. See `isBaseDesignType`.
 *
 * 2. Partners are chosen by design TYPE, not by row, and the work is repeated
 *    in every sub-category the new design landed in. Advanced mode can create
 *    AMBIENT across a dozen sub-categories; the combinations wanted are the
 *    same in each, and nobody wants to tick "LOGO" a dozen times. A partner
 *    that does not exist in one of those sub-categories is reported rather than
 *    silently dropped.
 */
function CombineWithDesignDialog({ base, onClose }: { base: DesignDto[]; onClose: () => void }) {
  const createBulk = useCreateCombinationBulk();
  const category = base[0]?.category ?? '';
  const newType = base[0]?.designType ?? '';
  /** The sub-categories the new design was just written into. */
  const targetSubs = useMemo(() => [...new Set(base.map((b) => b.subCategory))].sort(), [base]);

  // Only this category's designs — enough to resolve every partner row, and far
  // less than pulling the whole catalogue.
  const { data, isLoading } = useDesigns({ page: 1, pageSize: 2000, category });

  /** (subCategory → designType → row) for the category, base designs only. */
  const rowsBySub = useMemo(() => {
    const m = new Map<string, Map<string, DesignDto>>();
    for (const d of data?.items ?? []) {
      if (!isBaseDesignType(d.designType)) continue;
      if (!m.has(d.subCategory)) m.set(d.subCategory, new Map());
      m.get(d.subCategory)!.set(d.designType, d);
    }
    return m;
  }, [data]);

  /**
   * The partner design types on offer: every base type present in any of the
   * target sub-categories, minus the one just created. Deduped across
   * sub-categories, which is what makes this a list of DESIGNS rather than a
   * list of rows — "DL" appears once, not once per sub-category.
   */
  const partnerTypes = useMemo(() => {
    const set = new Set<string>();
    for (const sub of targetSubs) {
      for (const t of rowsBySub.get(sub)?.keys() ?? []) {
        if (t !== newType) set.add(t);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rowsBySub, targetSubs, newType]);

  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** 'each' → one combination per partner; 'all' → a single combination of the lot. */
  const [mode, setMode] = useState<'each' | 'all'>('each');
  const toggle = (t: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  const shown = partnerTypes.filter((t) => !search.trim() || t.toLowerCase().includes(search.trim().toLowerCase()));

  /**
   * Exactly what will be written, so the button is never a mystery.
   *
   * The name is set here rather than left to the server so the preview and the
   * stored row cannot disagree — both sort the component types and join them
   * with " + ".
   */
  const plan = useMemo(() => {
    const groups: { name: string; designIds: number[]; subCategory: string }[] = [];
    const missing: string[] = [];
    const chosen = [...picked];
    if (chosen.length === 0) return { groups, missing };

    for (const b of base) {
      const inSub = rowsBySub.get(b.subCategory);
      const nameOf = (types: string[]) => [...types].sort((x, y) => x.localeCompare(y)).join(' + ');
      if (mode === 'each') {
        for (const t of chosen) {
          const partner = inSub?.get(t);
          if (!partner) {
            missing.push(`${t} · ${b.subCategory}`);
            continue;
          }
          groups.push({ name: nameOf([b.designType, t]), designIds: [b.id, partner.id], subCategory: b.subCategory });
        }
      } else {
        const found = chosen.map((t) => ({ t, row: inSub?.get(t) }));
        for (const f of found) if (!f.row) missing.push(`${f.t} · ${b.subCategory}`);
        const ids = [b.id, ...found.filter((f) => f.row).map((f) => f.row!.id)];
        if (ids.length >= 2) {
          groups.push({
            name: nameOf([b.designType, ...found.filter((f) => f.row).map((f) => f.t)]),
            designIds: ids,
            subCategory: b.subCategory,
          });
        }
      }
    }
    return { groups, missing };
  }, [base, picked, mode, rowsBySub]);

  const submit = () => {
    if (picked.size === 0) return toast.error('Tick at least one design to combine with');
    if (plan.groups.length === 0) return toast.error('Nothing to create — those designs are not in these sub-categories');
    createBulk.mutate(
      { groups: plan.groups.map((g) => ({ name: g.name, designIds: g.designIds })) },
      {
        onSuccess: (res) => {
          toast.success(
            res.created
              ? `${res.created} combination${res.created === 1 ? '' : 's'} created` +
                  (res.skipped ? ` — ${res.skipped} already existed` : '')
              : 'Those combinations already exist',
          );
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Create failed')),
      },
    );
  };

  useSaveShortcut(submit);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="bg-muted/40 border-b px-5 py-3.5 text-left">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary ring-primary/15 flex size-9 items-center justify-center rounded-lg ring-1">
              <Layers className="size-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base leading-tight">Combine “{newType}” with…</DialogTitle>
              <p className="text-muted-foreground truncate text-xs">
                {category} ·{' '}
                {targetSubs.length === 1
                  ? targetSubs[0]
                  : `${targetSubs.length} sub-categories`}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-3 px-5 py-4">
          {/* Every created sub-category named, so "×N" is never a guess. */}
          {targetSubs.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {targetSubs.map((sc) => (
                <span key={sc} className="bg-muted rounded-full px-2 py-0.5 text-[11px] font-medium">
                  {sc}
                </span>
              ))}
            </div>
          )}

          <div role="group" aria-label="What to create" className="inline-flex h-9 self-start overflow-hidden rounded-md border">
            {(
              [
                ['each', 'One per design', `A combination for each ticked design — ${newType} + DL, ${newType} + LOGO, …`],
                ['all', 'One of all', `A single combination of ${newType} and everything ticked`],
              ] as const
            ).map(([v, label, title]) => (
              <button
                key={v}
                type="button"
                aria-pressed={mode === v}
                title={title}
                onClick={() => setMode(v)}
                className={cn(
                  'px-3 text-[12.5px] font-semibold transition-colors',
                  mode === v ? 'bg-slate-700 text-white' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {partnerTypes.length > 8 && (
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input className="pl-9" placeholder="Filter designs…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          )}

          <div className="max-h-56 space-y-0.5 overflow-auto rounded-md border p-1.5">
            {isLoading ? (
              <div className="text-muted-foreground flex h-20 items-center justify-center text-sm">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : shown.length === 0 ? (
              <p className="text-muted-foreground px-2 py-6 text-center text-sm">
                {partnerTypes.length === 0
                  ? 'No other base designs here yet — add one and this step will offer it.'
                  : 'Nothing matches that filter.'}
              </p>
            ) : (
              shown.map((t) => {
                // How many of the target sub-categories actually have this one.
                const have = targetSubs.filter((sub) => rowsBySub.get(sub)?.has(t)).length;
                return (
                  <label key={t} className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm">
                    <RowCheckbox checked={picked.has(t)} onChange={() => toggle(t)} label={`Combine with ${t}`} />
                    <span className="font-medium">{t}</span>
                    {targetSubs.length > 1 && (
                      <span
                        className={cn(
                          'ml-auto text-[11px] tabular-nums',
                          have === targetSubs.length ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400',
                        )}
                      >
                        in {have}/{targetSubs.length}
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>

          {/* The plan, spelled out. A count on the button with nothing behind it
              is how people end up surprised by what got written. */}
          {picked.size > 0 && (
            <div className="bg-muted/40 space-y-1 rounded-md px-3 py-2 text-[12.5px]">
              <p className="font-semibold">
                Will create {plan.groups.length} combination{plan.groups.length === 1 ? '' : 's'}
              </p>
              <div className="max-h-24 space-y-0.5 overflow-auto">
                {plan.groups.slice(0, 12).map((g, i) => (
                  <div key={`${g.name}-${g.subCategory}-${i}`} className="flex gap-2">
                    <span className="truncate font-medium">{g.name}</span>
                    {targetSubs.length > 1 && <span className="text-muted-foreground ml-auto shrink-0">{g.subCategory}</span>}
                  </div>
                ))}
                {plan.groups.length > 12 && (
                  <p className="text-muted-foreground">…and {plan.groups.length - 12} more</p>
                )}
              </div>
              {plan.missing.length > 0 && (
                <p className="text-amber-700 dark:text-amber-400">
                  {plan.missing.length} skipped — that design isn’t in the sub-category ({plan.missing.slice(0, 3).join(', ')}
                  {plan.missing.length > 3 ? ', …' : ''})
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="bg-muted/20 border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Not now
          </Button>
          <Button type="button" onClick={submit} disabled={createBulk.isPending || plan.groups.length === 0}>
            {createBulk.isPending ? <Loader2 className="animate-spin" /> : <Layers className="size-4" />}
            {plan.groups.length > 1 ? `Create ${plan.groups.length} combinations` : 'Create combination'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
