import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderDto, OrderFilterOptions, OrderInput, OrderItemPhotoDto, OrderList, OrderLookups, OrderQuery, OrderTimeline, UploadedFileDto } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['orders'] as const;
const photoKey = (itemId: number) => [...KEY, 'item-photos', itemId] as const;

export function useOrders(query: OrderQuery) {
  return useQuery({
    queryKey: [...KEY, 'list', query],
    queryFn: () => http.get<OrderList>('/orders', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useOrder(id?: number) {
  return useQuery({
    queryKey: [...KEY, id],
    queryFn: () => http.get<OrderDto>(`/orders/${id}`),
    enabled: id != null,
  });
}

/** Distinct product/design values on order lines, for the Orders page filters. */
export function useOrderFilterOptions() {
  return useQuery({
    queryKey: [...KEY, 'filter-options'],
    queryFn: () => http.get<OrderFilterOptions>('/orders/filter-options'),
    staleTime: 60_000,
  });
}

/** Order journey (ordered → dispatched → challaned) for the timeline modal. */
export function useOrderTimeline(id?: number) {
  return useQuery({
    queryKey: [...KEY, 'timeline', id],
    queryFn: () => http.get<OrderTimeline>(`/orders/${id}/timeline`),
    enabled: id != null,
  });
}

export function useOrderLookups() {
  return useQuery({
    queryKey: [...KEY, 'lookups'],
    queryFn: () => http.get<OrderLookups>('/orders/lookups'),
    staleTime: 60_000,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderInput) => http.post<OrderDto>('/orders', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateOrder(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderInput) => http.patch<OrderDto>(`/orders/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Save any order by id (used by Order Modify, which edits lines across many orders). */
export function useSaveOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: OrderInput }) => http.patch<OrderDto>(`/orders/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Cancel an order (kept for records; server refuses once any line is dispatched). */
export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.patch<OrderDto>(`/orders/${id}/status`, { status: 'CANCELLED' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/orders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

// ── Order-line photos (live mode: Order Modify & Dispatch, where the line exists) ──

/** An existing order line's photos, fetched on demand (e.g. when a sheet opens). */
export function useOrderItemPhotos(itemId?: number) {
  return useQuery({
    queryKey: itemId != null ? photoKey(itemId) : [...KEY, 'item-photos', 'none'],
    queryFn: () => http.get<OrderItemPhotoDto[]>(`/orders/items/${itemId}/photos`),
    enabled: itemId != null,
  });
}

/** Attach an already-uploaded file to an order line. */
export function useAddOrderItemPhoto(itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: UploadedFileDto) =>
      http.post<OrderItemPhotoDto>(`/orders/items/${itemId}/photos`, {
        path: file.path,
        url: file.url,
        filename: file.filename ?? undefined,
        mimeType: file.mimeType ?? undefined,
        size: file.size ?? undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: photoKey(itemId) });
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

/** Detach a photo from an order line (also deletes its file). */
export function useDeleteOrderItemPhoto(itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: number) => http.delete(`/orders/photos/${photoId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: photoKey(itemId) });
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
