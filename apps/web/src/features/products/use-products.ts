import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BulkRateChangeInput,
  BulkRateChangeResult,
  BulkRatePreview,
  BulkCatalogFlagsInput,
  BulkCatalogFlagsResult,
  CatalogFlagsInput,
  CategoryFieldDto,
  ProductDto,
  ProductInput,
  ProductList,
  ProductLookups,
  ProductQuery, ProductChangeEntry } from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

const KEY = ['products'] as const;

// A product's name/rate/category feeds the order item picker (composeOrderLookups
// → /orders/lookups), same as useSetProductFlags and useSaveCategoryFields below
// already account for — a plain create/update/delete/import needs the same reach.
//
// The customer Rate List is built from products too, and `showOnRateList` decides
// which appear on it. Without this the sheet kept serving its cached payload, so
// hiding a product left it on screen — and in the downloaded PDF/Excel, which are
// built from exactly that payload — until the page was reloaded.
const invalidateProducts = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ['orders', 'lookups'] });
  qc.invalidateQueries({ queryKey: ['customers', 'rate-list'] });
};

export function useProducts(query: ProductQuery) {
  return useQuery({
    queryKey: [...KEY, query],
    queryFn: () => http.get<ProductList>('/products', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useProductLookups() {
  return useQuery({
    queryKey: [...KEY, 'lookups'],
    queryFn: () => http.get<ProductLookups>('/products/lookups'),
    staleTime: 60_000,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInput) => http.post<ProductDto>('/products', input),
    onSuccess: () => invalidateProducts(qc),
  });
}

export function useUpdateProduct(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInput) => http.patch<ProductDto>(`/products/${id}`, input),
    onSuccess: () => invalidateProducts(qc),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/products/${id}`),
    onSuccess: () => invalidateProducts(qc),
  });
}

/** Inline toggle of a product's active / rate-list flags (doesn't touch other fields). */
export function useSetProductFlags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...flags }: CatalogFlagsInput & { id: number }) =>
      http.patch<ProductDto>(`/products/${id}/flags`, flags),
    // Order item pickers depend on `active`; the customer Rate List depends on
    // `showOnRateList` — the shared helper reaches both.
    onSuccess: () => invalidateProducts(qc),
  });
}

/** Bulk row-selection flag toggle — e.g. deactivating a batch of ticked products
 *  in one request instead of one PATCH per row. */
export function useBulkSetProductFlags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkCatalogFlagsInput) => http.patch<BulkCatalogFlagsResult>('/products/bulk-flags', input),
    onSuccess: () => invalidateProducts(qc),
  });
}

/**
 * Preview a bulk chart-rate adjustment. Read-only despite being a POST — it
 * carries a body, it does not write.
 *
 * `enabled` rather than a manual trigger: the preview IS the safety net for a
 * write that touches hundreds of rows at once, so it should already be on screen
 * by the time the user reaches for Apply, not something they must remember to
 * ask for.
 */
export function useBulkRatePreview(input: BulkRateChangeInput | null) {
  return useQuery({
    queryKey: [...KEY, 'bulk-rate-preview', input],
    queryFn: () => http.post<BulkRatePreview>('/products/bulk-rate/preview', input),
    enabled: !!input,
    // The catalogue can move under a long-open dialog; never serve a stale
    // preview for a write this wide.
    staleTime: 0,
    placeholderData: (prev) => prev,
  });
}

export function useBulkRateChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkRateChangeInput) => http.post<BulkRateChangeResult>('/products/bulk-rate', input),
    onSuccess: () => {
      invalidateProducts(qc);
      // The rate trail feeds the Recent-changes list and the rate-history views.
      qc.invalidateQueries({ queryKey: [...KEY, 'changes'] });
    },
  });
}

export function useImportProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]) => http.post<ImportResult>('/products/import', { rows }),
    onSuccess: () => invalidateProducts(qc),
  });
}

/** Replace the per-category price-calc field map; refreshes product & order lookups. */
export function useSaveCategoryFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: CategoryFieldDto[]) =>
      http.put<CategoryFieldDto[]>('/products/category-fields', { fields }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...KEY, 'lookups'] });
      qc.invalidateQueries({ queryKey: ['orders', 'lookups'] });
    },
  });
}

export function exportProducts(query: ProductQuery) {
  const qs = query.search ? `?search=${encodeURIComponent(query.search)}` : '';
  return downloadFile(`/products/export${qs}`, 'products.xlsx');
}

/**
 * Every product matching the current filters, across all pages — not just the
 * one on screen. Backs "Select all N matching" on the Products page, so a bulk
 * action (like deactivating) can act on the whole filtered set in one click
 * instead of paging through and ticking rows by hand. `MAX_PAGE_SIZE` (2000) on
 * the API comfortably covers any real filtered result.
 */
export async function fetchAllMatchingProducts(query: ProductQuery, total: number): Promise<ProductDto[]> {
  const res = await http.get<ProductList>('/products', { params: { ...query, page: 1, pageSize: Math.min(total, 2000) } });
  return res.items;
}

/** Recent product edits (§6.1) — loaded only when the panel is opened. */
export function useProductChanges(enabled: boolean, productId?: number) {
  return useQuery({
    queryKey: ['products', 'changes', productId ?? 'all'],
    queryFn: () =>
      http.get<ProductChangeEntry[]>('/products/changes', { params: productId ? { productId } : {} }),
    enabled,
  });
}
