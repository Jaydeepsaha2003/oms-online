import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { cn, formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useColumnOrder } from '@/hooks/use-column-order';
import { useConfirm } from '@/components/common/confirm';
import { ColumnSettings } from '@/components/common/column-settings';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { ExportButton, ImportButton } from '@/components/common/excel-actions';
import { Combo } from '@/components/common/combo';
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
  useUpdateProduct,
} from './use-products';

const PAGE_SIZE = 50;
const num = (n: number | null) => (n == null ? '—' : n.toLocaleString());
/** Amount prefixed with the rupee symbol; dash when unknown. */
const money = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString()}`);

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
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ProductDto | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize: PAGE_SIZE, search: search || undefined };
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Products</h2>
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
          {can('product:export') && <ExportButton onClick={() => exportProducts(query)} />}
          {can('product:import') && <ImportButton onFile={handleImport} pending={importMut.isPending} />}
          {can('product:create') && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New product
            </Button>
          )}
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          placeholder="Search category, sub category, product…"
          className="pl-9"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <DataTable
        columns={cols.visibleColumns}
        rows={items}
        rowKey={(p) => p.id}
        isLoading={isLoading}
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
    </div>
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
