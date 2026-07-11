import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Filter, Loader2, Pencil, Plus, RotateCcw, Scale, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CategoryFieldDto, ProductDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { cn, formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { RowCheckbox } from '@/components/common/row-checkbox';
import { ExportButton, ImportButton } from '@/components/common/excel-actions';
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
  useProductLookups,
  useProducts,
  useSaveCategoryFields,
  useSetProductFlags,
  useUpdateProduct,
} from './use-products';

const PAGE_SIZE = 50;
const num = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-IN'));
/** Amount prefixed with the rupee symbol; dash when unknown. */
const money = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);

const COLUMNS: DataColumn<ProductDto>[] = [
  { id: 'category', label: 'Category', pin: 'left0', fixed: true, cell: (p) => <span className={cn('font-medium', !p.active && 'text-muted-foreground line-through')}>{p.category}</span> },
  { id: 'subCategory', label: 'Sub category', cell: (p) => <span className={cn('font-medium', !p.active && 'text-muted-foreground')}>{p.subCategory}</span> },
  { id: 'product', label: 'Product', cell: (p) => <span className={cn('font-medium', !p.active && 'text-muted-foreground line-through')}>{p.product}</span> },
  { id: 'size', label: 'Size', align: 'right', cell: (p) => num(p.size) },
  { id: 'weight', label: 'Weight', align: 'right', cell: (p) => num(p.weight) },
  { id: 'pcs', label: 'PCS', align: 'right', cell: (p) => num(p.pcs) },
  { id: 'rate', label: 'Rate', align: 'right', cell: (p) => <span className="text-[15px] font-bold">{money(p.rate)}</span> },
  {
    id: 'updated',
    label: 'Last updated',
    cell: (p) => (
      <span className="text-muted-foreground whitespace-nowrap font-mono text-xs" title={formatDateTime(p.updatedAt)}>{formatDateShort(p.updatedAt)}</span>
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
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ProductDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
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
    pageSize: PAGE_SIZE,
    search: search || undefined,
    category: category || undefined,
    subCategory: subCategory || undefined,
  };
  const { data, isLoading } = useProducts(query);
  const del = useDeleteProduct();
  const importMut = useImportProducts();
  const cols = useColumnOrder('products', COLUMNS);

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

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
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('leading-tight font-medium', !p.active && 'text-muted-foreground line-through')}>{p.product}</p>
          <p className="text-muted-foreground text-xs">
            {p.category} · <span className="font-montserrat">{p.subCategory}</span>
          </p>
        </div>
        <ProductActiveToggle product={p} />
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div>
          <p className="text-muted-foreground">Size</p>
          <p className="text-sm font-semibold tabular-nums">{num(p.size)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Weight</p>
          <p className="text-sm font-semibold tabular-nums">{num(p.weight)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">PCS</p>
          <p className="text-sm font-semibold tabular-nums">{num(p.pcs)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Rate</p>
          <p className="text-base font-bold tabular-nums">{money(p.rate)}</p>
        </div>
      </div>
      <div className="flex items-center justify-between border-t pt-2.5" onClick={(e) => e.stopPropagation()}>
        <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs font-medium">
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
    <div className="space-y-4">
      {/* One compact toolbar row: search → category/sub-category filters → live
          count → actions. (No page title — the topbar already says "Products".)
          On phones the dropdowns move behind a Filter icon (see the sheet below)
          so the row doesn't stack into a wall of controls above the cards. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search category, sub category, product…"
              className="pl-9"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
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
        <p className="text-muted-foreground shrink-0 text-sm tabular-nums">{(data?.total ?? 0).toLocaleString('en-IN')} records</p>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
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
          <Button variant="outline" size="sm" onClick={() => setShowFields(true)} title="Set the price field (KGS/PCS) per category">
            <Scale /> Price fields
          </Button>
          {can('product:create') && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New product
            </Button>
          )}
        </div>
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
              Show {(data?.total ?? 0).toLocaleString('en-IN')} products
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <DataTable
        columns={cols.visibleColumns}
        rows={items}
        rowKey={(p) => p.id}
        isLoading={isLoading}
        emptyText="No products yet."
        onRowClick={(p) => can('product:update') && setEditing(p)}
        mobileCard={productMobileCard}
        actions={(p) => (
          <div className="flex items-center justify-end gap-2">
            <ProductRateListCheckbox product={p} />
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
