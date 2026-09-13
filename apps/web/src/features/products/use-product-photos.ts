import { useQuery } from '@tanstack/react-query';
import type { ProductPhotoFilterOptions, ProductPhotoGalleryDto, ProductPhotoQuery } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['product-photos'] as const;

/** Shared by the hook and the page's background prefetch, so both hit the same
 *  cache entry. `staleTime` is what makes flipping By party ⇄ By item instant:
 *  a view already loaded is shown from cache instead of being fetched again. */
export const productPhotosQuery = (query: ProductPhotoQuery) => ({
  queryKey: [...KEY, query],
  queryFn: () => http.get<ProductPhotoGalleryDto>('/products/photos', { params: query }),
  staleTime: 60_000,
});

/** The gallery, paged by SECTION (party or item), newest upload first. */
export function useProductPhotos(query: ProductPhotoQuery) {
  return useQuery({ ...productPhotosQuery(query), placeholderData: (prev) => prev });
}

/** Filter values, cascaded off the other active filters. Paging is stripped so
 *  turning a page doesn't churn the query key. */
export function useProductPhotoFilterOptions(query: Partial<ProductPhotoQuery> = {}) {
  const { page: _page, pageSize: _pageSize, groupBy: _groupBy, ...filters } = query;
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null && v !== ''));
  return useQuery({
    queryKey: [...KEY, 'filter-options', params],
    queryFn: () => http.get<ProductPhotoFilterOptions>('/products/photos/filter-options', { params }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
