import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Filter, ListX, Loader2, Pencil, Plus, PowerOff, RotateCcw, Scale, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { CategoryFieldDto, ProductDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { cn, formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { usePageSize } from '@/hooks/use-page-size';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { RowCheckbox } from '@/components/common/row-checkbox';
import { ExportButton, ImportButton } from '@/components/common/excel-actions';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { Combo, NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  exportProducts,
  useCreateProduct,
  useDeleteProduct,
  useImportProducts,
  fetchAllMatchingProducts,
  useBulkSetProductFlags,
  useProductLookups,
  useProducts,
  useSaveCategoryFields,
  useSetProductFlags,
  useUpdateProduct,
} from './use-products';

const num = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-IN'));
/** Amount prefixed with the rupee symbol; dash when unknown. */
const money = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);

/** Matches the Orders / Challans / Dispatch grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

/** Columns that never depend on component state — the selection column is built
 *  separately inside the page (its cell needs `selected`/`toggle`) and prepended. */
const BASE_COLUMNS: DataColumn<ProductDto>[] = [
  { id: 'category', label: 'Category', pin: 'left0', fixed: true, cell: (p) => <span className={cn(TEXT_CELL, !p.active && 'text-muted-foreground line-through')}>{p.category}</span> },
  { id: 'subCategory', label: 'Sub category', cell: (p) => <span className={cn(TEXT_CELL, !p.active && 'text-muted-foreground')}>{p.subCategory}</span> },
  { id: 'product', label: 'Product', cell: (p) => <span className={cn(TEXT_CELL, !p.active && 'text-muted-foreground line-through')}>{p.product}</span> },
  { id: 'size', label: 'Size', align: 'right', cell: (p) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{num(p.size)}</span> },
  { id: 'weight', label: 'Weight', align: 'right', cell: (p) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{num(p.weight)}</span> },
  { id: 'pcs', label: 'PCS', align: 'right', cell: (p) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{num(p.pcs)}</span> },
  { id: 'rate', label: 'Rate', align: 'right', cell: (p) => <span className="text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(p.rate)}</span> },
  {
    id: 'updated',
    label: 'Last updated',
    cell: (p) => (
      <span className="text-muted-foreground whitespace-nowrap text-[12px] font-medium tabular-nums" title={formatDateTime(p.updatedAt)}>{formatDateShort(p.updatedAt)}</span>
    ),
  },
  // Kept as the LAST scrollable column (right before the sticky Actions column) so
  // it lands in the visible strip next to Actions on mobile, instead of scrolling
  // past and ending up hidden underneath the sticky column.
  { id: 'active', label: 'Active', sortValue: (p) => (p.active ? 1 : 0), cell: (p) => <div className="flex justify-center"><ProductActiveToggle product={p} /></div> },
];

/** Inline active/inactive toggle for a product row. Stops row-click (which opens edit). */
function ProductActiveToggle({ product }: { product: ProductDto }) {
  const setFlags = useSetProductFlags();
  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <Switch
        checked={product.active}
        disabled={setFlags.isPending}
        onCheckedChange={(v) =>
          setFlags.mutate(
            { id: product.id, active: v },
            {
              onSuccess: () => toast.success(v ? `${product.product} activated` : `${product.product} deactivated`),
              onError: (e) => toast.error(getApiErrorMessage(e, 'Update failed')),
            },
          )
        }
        aria-label={`Active — ${product.product}`}
      />
    </span>
  );
}

/** Inline "show on rate list" checkbox for a product row. */
function ProductRateListCheckbox({ product }: { product: ProductDto }) {
  const setFlags = useSetProductFlags();
  return (
    <RowCheckbox
      checked={product.showOnRateList}
      loading={setFlags.isPending}
      onChange={(v) =>
        setFlags.mutate(
          { id: product.id, showOnRateList: v },
          { onError: (er) => toast.error(getApiErrorMessage(er, 'Update failed')) },
        )
      }
      label={`Show ${product.product} on rate list`}
    />
  );
}

export function ProductsPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const { page, setPage, pageSize, setPageSize } = usePageSize('products');
  const [editing, setEditing] = useState<ProductDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // Bulk row selection — kept across page turns / filter changes so the user can
  // build up a set spanning more than one page before acting on it.
  const [selected, setSelected] = useState<Map<number, ProductDto>>(new Map());
  const toggleSelect = (p: ProductDto) =>
    setSelected((m) => {
      const n = new Map(m);
      if (n.has(p.id)) n.delete(p.id);
      else n.set(p.id, p);
      return n;
    });
  const activeFilterCount = (category ? 1 : 0) + (subCategory ? 1 : 0);
  const resetFilters = () => {
    setCategory('');
    setSubCategory('');
    setPage(1);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Dropdown filter options (distinct categories / sub-categories from the master).
  const { data: lookups } = useProductLookups();

  const query = {
    page,
    pageSize,
    search: search || undefined,
    category: category || undefined,
    subCategory: subCategory || undefined,
  };
  const { data, isLoading } = useProducts(query);
  const del = useDeleteProduct();
  const importMut = useImportProducts();
  const bulkSetFlags = useBulkSetProductFlags();

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  // The header checkbox selects/deselects every row on THIS page; "Select all N
  // matching" (below, next to the record count) reaches across every page the
  // current search/filters match, fetched on demand rather than kept loaded.
  const allOnPageSelected = items.length > 0 && items.every((p) => selected.has(p.id));
  const toggleSelectPage = (checked: boolean) =>
    setSelected((m) => {
      const n = new Map(m);
      for (const p of items) {
        if (checked) n.set(p.id, p);
        else n.delete(p.id);
      }
      return n;
    });
  const [selectingAll, setSelectingAll] = useState(false);
  const selectAllMatching = async () => {
    if (!data || selectingAll) return;
    setSelectingAll(true);
    try {
      const all = await fetchAllMatchingProducts(query, data.total);
      setSelected((m) => {
        const n = new Map(m);
        for (const p of all) n.set(p.id, p);
        return n;
      });
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Could not select all matching products'));
    } finally {
      setSelectingAll(false);
    }
  };

  // The 'sel' cell reads `selected`, so it's built per-render alongside the rest
  // of the (otherwise static) column set — same pattern as the Designs page.
  const columns = useMemo<DataColumn<ProductDto>[]>(
    () => [
      {
        id: 'sel',
        label: '',
        header: (
          <span onClick={(e) => e.stopPropagation()}>
            <RowCheckbox checked={allOnPageSelected} onChange={toggleSelectPage} label="Select all on this page" />
          </span>
        ),
        fixed: true,
        noSort: true,
        cell: (p) => (
          <span onClick={(e) => e.stopPropagation()}>
            <RowCheckbox checked={selected.has(p.id)} onChange={() => toggleSelect(p)} label={`Select ${p.product}`} />
          </span>
        ),
      },
      ...BASE_COLUMNS,
    ],
    [selected, items, allOnPageSelected],
  );
  const cols = useColumnOrder('products', columns);

  const handleDelete = async (p: ProductDto) => {
    const ok = await confirm({
      title: 'Delete product?',
      description: `"${p.product}" will be permanently removed.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(p.id, {
      onSuccess: () => toast.success('Product deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  const handleBulkDeactivate = async () => {
    const ids = [...selected.keys()];
    if (!ids.length) return;
    const ok = await confirm({
      title: `Deactivate ${ids.length} product${ids.length === 1 ? '' : 's'}?`,
      description: 'They stay in the catalog but drop out of order item pickers until switched active again.',
      confirmText: 'Deactivate',
      destructive: true,
    });
    if (!ok) return;
    bulkSetFlags.mutate(
      { ids, active: false },
      {
        onSuccess: (res) => {
          toast.success(`Deactivated ${res.updated} product${res.updated === 1 ? '' : 's'}`);
          setSelected(new Map());
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Bulk update failed')),
      },
    );
  };

  /** Turns off "show on rate list" for every selected product — the same flag
   *  the per-row RowCheckbox toggles, just applied in bulk. Unlike deactivating,
   *  this leaves the product fully active and orderable; it only stops it from
   *  appearing on the customer-facing Rate List. */
  const handleBulkRemoveFromRateList = async () => {
    const ids = [...selected.keys()];
    if (!ids.length) return;
    const ok = await confirm({
      title: `Remove ${ids.length} product${ids.length === 1 ? '' : 's'} from the rate list?`,
      description: 'They stay active and orderable — they just stop appearing on the customer Rate List.',
      confirmText: 'Remove',
    });
    if (!ok) return;
    bulkSetFlags.mutate(
      { ids, showOnRateList: false },
      {
        onSuccess: (res) => {
          toast.success(`Removed ${res.updated} product${res.updated === 1 ? '' : 's'} from the rate list`);
          setSelected(new Map());
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Bulk update failed')),
      },
    );
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

  // Phones: one stacked card per product instead of a horizontally-scrolling table.
  const productMobileCard = (p: ProductDto) => (
    <div className={cn('-m-3 space-y-2 border-l-4 p-3 transition-colors', selected.has(p.id) ? 'border-l-primary bg-primary/5' : 'border-l-transparent')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <RowCheckbox checked={selected.has(p.id)} onChange={() => toggleSelect(p)} label={`Select ${p.product}`} />
          </span>
          <div className="min-w-0">
            <p className={cn('truncate text-[14px] leading-tight font-bold text-slate-900 dark:text-slate-100', !p.active && 'text-muted-foreground line-through')}>{p.product}</p>
            <p className="text-muted-foreground truncate text-[11.5px] font-medium">
              {p.category} · {p.subCategory}
            </p>
          </div>
        </div>
        <ProductActiveToggle product={p} />
      </div>
      <div className="grid grid-cols-4 gap-2 text-[12px]">
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Size</p>
          <p className="font-bold tabular-nums text-slate-800 dark:text-slate-200">{num(p.size)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Weight</p>
          <p className="font-bold tabular-nums text-slate-800 dark:text-slate-200">{num(p.weight)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">PCS</p>
          <p className="font-bold tabular-nums text-slate-800 dark:text-slate-200">{num(p.pcs)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">Rate</p>
          <p className="text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(p.rate)}</p>
        </div>
      </div>
      <div className="flex items-center justify-between border-t pt-2" onClick={(e) => e.stopPropagation()}>
        <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-[11.5px] font-medium">
          <ProductRateListCheckbox product={p} />
          Rate list
        </label>
        <div className="flex items-center gap-1">
          {can('product:update') && (
            <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(p)} aria-label="Edit">
              <Pencil className="size-4" />
            </Button>
          )}
          {can('product:delete') && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:text-destructive"
              onClick={() => handleDelete(p)}
              aria-label="Delete"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    // Fills the viewport: toolbar pinned on top, footer pinned at the bottom, only
    // the grid scrolls. `/products` is a flush route (app-shell), so the page owns
    // its own padding.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      {/* ── Toolbar: search + filters on the left, actions on the right, one card. */}
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <div className="relative w-full sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search category, sub category, product…"
              className={cn(CONTROL, 'pl-8 font-medium', searchInput && CONTROL_ON)}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
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
              options={['', ...(lookups?.subCategories ?? [])]}
              placeholder="All sub categories"
              className={cn(CONTROL, 'font-medium', subCategory && CONTROL_ON)}
            />
          </div>
          <p className="text-muted-foreground shrink-0 text-[12px] font-medium tabular-nums">
            <span className="font-bold text-foreground">{(data?.total ?? 0).toLocaleString('en-IN')}</span> records
          </p>

          {/* Ticks every row on this page individually; when the filter spans more
              than one page, this reaches the rest without paging through by hand. */}
          {!!data && data.total > items.length && (
            <button
              type="button"
              onClick={() => void selectAllMatching()}
              disabled={selectingAll}
              className="text-primary shrink-0 cursor-pointer text-[12px] font-semibold whitespace-nowrap hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selectingAll ? 'Selecting…' : `Select all ${data.total.toLocaleString('en-IN')} matching`}
            </button>
          )}

          {selected.size > 0 && (
            <div className="flex items-center gap-2 rounded-[4px] bg-sky-50 px-3 py-1.5 text-[12.5px] font-semibold text-sky-700 ring-1 ring-sky-200 ring-inset dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/25">
              <span className="tabular-nums">{selected.size} selected</span>
              {can('product:update') && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-[4px] border-sky-300 bg-white text-[12px] font-bold text-sky-700 hover:bg-sky-100 dark:border-sky-400/40 dark:bg-transparent dark:text-sky-300"
                  onClick={() => void handleBulkRemoveFromRateList()}
                  disabled={bulkSetFlags.isPending}
                  title="Stops these appearing on the customer Rate List — they stay active and orderable"
                >
                  <ListX className="size-3.5" /> Remove from rate list
                </Button>
              )}
              {can('product:update') && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 rounded-[4px] text-[12px] font-bold"
                  onClick={() => void handleBulkDeactivate()}
                  disabled={bulkSetFlags.isPending}
                >
                  <PowerOff className="size-3.5" /> Deactivate selected
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
              columns={cols.orderedReorderable}
              hidden={cols.hidden}
              onReorder={cols.moveBefore}
              onMove={cols.move}
              onToggle={cols.toggle}
              onReset={cols.reset}
            />
            {can('product:export') && <ExportButton onClick={() => exportProducts(query)} />}
            {can('product:import') && <ImportButton onFile={handleImport} pending={importMut.isPending} />}
            <Button variant="outline" size="sm" className="h-9 rounded-[4px] text-[12.5px] font-semibold" onClick={() => setShowFields(true)} title="Set the price field (KGS/PCS) per category">
              <Scale /> Price fields
            </Button>
            {can('product:create') && (
              <Button size="sm" className="h-9 rounded-[4px] text-[12.5px] font-bold" onClick={() => setCreating(true)}>
                <Plus /> New product
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
                options={['', ...(lookups?.subCategories ?? [])]}
                placeholder="All sub categories"
              />
            </div>
          </div>
          <SheetFooter>
            <Button className="w-full font-bold" onClick={() => setMobileFiltersOpen(false)}>
              Show {(data?.total ?? 0).toLocaleString('en-IN')} products
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

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
          rowKey={(p) => p.id}
          isLoading={isLoading}
          dense
          fill
          hideSortIcon
          emptyText="No products yet."
          onRowClick={(p) => can('product:update') && setEditing(p)}
          mobileCard={productMobileCard}
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
          actions={(p) => (
            <div className="flex items-center justify-end gap-2">
              <ProductRateListCheckbox product={p} />
              {can('product:update') && (
                <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(p)} aria-label="Edit">
                  <Pencil className="size-4" />
                </Button>
              )}
              {can('product:delete') && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(p)}
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

      {(creating || editing) && (
        <ProductDialog
          product={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {showFields && <CategoryFieldsDialog canEdit={can('product:update')} onClose={() => setShowFields(false)} />}
    </div>
  );
}

/** Manage the per-category price-calc field (KGS / PCS). Used to set each order line's calc field. */
function CategoryFieldsDialog({ canEdit, onClose }: { canEdit: boolean; onClose: () => void }) {
  const { data: lookups } = useProductLookups();
  const save = useSaveCategoryFields();
  const [rows, setRows] = useState<CategoryFieldDto[]>([]);

  useEffect(() => {
    if (lookups) setRows(lookups.categoryFields);
  }, [lookups]);

  const setRow = (i: number, patch: Partial<CategoryFieldDto>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { category: '', field: 'KGS' }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const submit = () => {
    // Upper-case, drop blanks, de-dupe by category (last wins).
    const map = new Map<string, CategoryFieldDto['field']>();
    for (const r of rows) {
      const c = r.category.trim().toUpperCase();
      if (c) map.set(c, r.field === 'PCS' ? 'PCS' : 'KGS');
    }
    const list = [...map.entries()].map(([category, field]) => ({ category, field }));
    save.mutate(list, {
      onSuccess: () => {
        toast.success('Price fields saved');
        onClose();
      },
      onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
    });
  };

  useSaveShortcut(submit);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Category price fields</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          Choose how each category is priced — by <b>KGS</b> or <b>PCS</b>. New order lines pick this up automatically from the product's category.
        </p>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {rows.length === 0 && <p className="text-muted-foreground text-sm">No mappings yet — add one below.</p>}
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <Combo value={r.category} onChange={(v) => setRow(i, { category: v })} options={lookups?.categories ?? []} placeholder="Category" disabled={!canEdit} />
              </div>
              <div className="w-28">
                <NativeSelect value={r.field} onChange={(v) => setRow(i, { field: v === 'PCS' ? 'PCS' : 'KGS' })} options={['KGS', 'PCS']} disabled={!canEdit} />
              </div>
              {canEdit && (
                <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => removeRow(i)} aria-label="Remove">
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" className="w-fit" onClick={addRow}>
            <Plus /> Add category
          </Button>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {canEdit && (
            <Button onClick={submit} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null} Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductDialog({ product, onClose }: { product: ProductDto | null; onClose: () => void }) {
  const isEdit = !!product;
  const create = useCreateProduct();
  const update = useUpdateProduct(product?.id ?? 0);
  const { data: lookups } = useProductLookups();
  const saving = create.isPending || update.isPending;

  const [form, setForm] = useState({
    category: product?.category ?? '',
    subCategory: product?.subCategory ?? '',
    product: product?.product ?? '',
    size: product?.size?.toString() ?? '',
    weight: product?.weight?.toString() ?? '',
    pcs: product?.pcs?.toString() ?? '',
    rate: product?.rate?.toString() ?? '',
    active: product?.active ?? true,
    showOnRateList: product?.showOnRateList ?? true,
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const numOrNull = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));

  const submit = () => {
    if (!form.category.trim() || !form.subCategory.trim() || !form.product.trim()) {
      return toast.error('Category, Sub category and Product are required');
    }
    const input = {
      category: form.category.trim(),
      subCategory: form.subCategory.trim(),
      product: form.product.trim(),
      size: numOrNull(form.size),
      weight: numOrNull(form.weight),
      pcs: numOrNull(form.pcs),
      rate: numOrNull(form.rate),
      active: form.active,
      showOnRateList: form.showOnRateList,
    };
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'Product updated' : 'Product created');
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit product ${product!.code ?? `#${product!.id}`}` : 'New product'}</DialogTitle>
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
              <Combo
                value={form.category}
                onChange={(v) => set('category', v)}
                options={lookups?.categories ?? []}
                placeholder="Select or type a new one…"
              />
            </div>
            <div className="space-y-2">
              <Label>Sub category *</Label>
              <Combo
                value={form.subCategory}
                onChange={(v) => set('subCategory', v)}
                options={lookups?.subCategories ?? []}
                placeholder="Select or type a new one…"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Product *</Label>
            <Input value={form.product} onChange={(e) => set('product', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-2">
              <Label>Size</Label>
              <Input type="number" step="any" value={form.size} onChange={(e) => set('size', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Weight</Label>
              <Input type="number" step="any" value={form.weight} onChange={(e) => set('weight', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>PCS</Label>
              <Input type="number" step="any" value={form.pcs} onChange={(e) => set('pcs', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Rate</Label>
              <Input type="number" step="any" value={form.rate} onChange={(e) => set('rate', e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6 rounded-lg border bg-muted/40 px-3 py-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
              Active <span className="text-muted-foreground font-normal">(shown in order pickers)</span>
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
