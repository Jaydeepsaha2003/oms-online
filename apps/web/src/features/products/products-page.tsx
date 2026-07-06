import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Scale, Search, Trash2 } from 'lucide-react';
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
import { ExportButton, ImportButton } from '@/components/common/excel-actions';
import { Combo, NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  exportProducts,
  useCreateProduct,
  useDeleteProduct,
  useImportProducts,
  useProductLookups,
  useProducts,
  useSaveCategoryFields,
  useUpdateProduct,
} from './use-products';

const PAGE_SIZE = 50;
const num = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-IN'));
/** Amount prefixed with the rupee symbol; dash when unknown. */
const money = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);

const COLUMNS: DataColumn<ProductDto>[] = [
  { id: 'category', label: 'Category', pin: 'left0', fixed: true, cell: (p) => <span className="font-medium">{p.category}</span> },
  { id: 'subCategory', label: 'Sub category', cell: (p) => p.subCategory },
  { id: 'product', label: 'Product', cell: (p) => <span className="font-medium">{p.product}</span> },
  { id: 'size', label: 'Size', align: 'right', cell: (p) => num(p.size) },
  { id: 'weight', label: 'Weight', align: 'right', cell: (p) => num(p.weight) },
  { id: 'pcs', label: 'PCS', align: 'right', cell: (p) => num(p.pcs) },
  { id: 'rate', label: 'Rate', align: 'right', cell: (p) => money(p.rate) },
  {
    id: 'updated',
    label: 'Last updated',
    cell: (p) => (
      <span className="text-muted-foreground whitespace-nowrap font-mono text-xs" title={formatDateTime(p.updatedAt)}>{formatDateShort(p.updatedAt)}</span>
    ),
  },
];

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

  return (
    <div className="space-y-4">
      {/* One compact toolbar row: search → category/sub-category filters → live
          count → actions. (No page title — the topbar already says "Products".) */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search category, sub category, product…"
            className="pl-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="w-44">
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
        <div className="w-48">
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

      <DataTable
        columns={cols.visibleColumns}
        rows={items}
        rowKey={(p) => p.id}
        isLoading={isLoading}
        // Compact single-row header above → give the reclaimed space to the table.
        maxBodyHeight="max-h-[calc(100dvh_-_12rem)]"
        emptyText="No products yet."
        onRowClick={(p) => can('product:update') && setEditing(p)}
        actions={(p) => (
          <div className="flex justify-end gap-1">
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
