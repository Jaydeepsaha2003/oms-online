import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CatalogFlagsInput,
  CategoryFieldDto,
  ProductDto,
  ProductInput,
  ProductList,
  ProductLookups,
  ProductQuery,
} from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

const KEY = ['products'] as const;

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
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateProduct(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInput) => http.patch<ProductDto>(`/products/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/products/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Inline toggle of a product's active / rate-list flags (doesn't touch other fields). */
export function useSetProductFlags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...flags }: CatalogFlagsInput & { id: number }) =>
      http.patch<ProductDto>(`/products/${id}/flags`, flags),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      // Order item pickers depend on active; the rate list depends on showOnRateList.
      qc.invalidateQueries({ queryKey: ['orders', 'lookups'] });
    },
  });
}

export function useImportProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]) => http.post<ImportResult>('/products/import', { rows }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
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
