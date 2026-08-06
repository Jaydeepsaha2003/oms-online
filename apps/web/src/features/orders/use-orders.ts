import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderDto, OrderFilterOptions, OrderInput, OrderItemOption, OrderItemPhotoDto, OrderList, OrderLookups, OrderLookupsWire, OrderQuery, OrderTimeline, UploadedFileDto } from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

const KEY = ['orders'] as const;

// An order appearing/disappearing changes what Dispatch's pending list and CRM's
// order-item suggest can offer — both already carry a short staleTime (15-30s) so
// this mostly tightens the window, but a just-cancelled/deleted order showing up
// as pickable for even a few seconds is still wrong.
const invalidateOrderAvailability = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ['dispatch'] });
  qc.invalidateQueries({ queryKey: ['crm'] });
};
const photoKey = (itemId: number) => [...KEY, 'item-photos', itemId] as const;

export function useOrders(query: OrderQuery) {
  return useQuery({
    queryKey: [...KEY, 'list', query],
    queryFn: () => http.get<OrderList>('/orders', { params: query }),
    placeholderData: (prev) => prev,
  });
}

/** Download every order line matching Order Modify's current filters as .xlsx.
 *  `columns`, if given, limits the sheet to those column ids (see
 *  `ORDER_LINE_EXPORT_COLUMNS`) — omitted means every column. */
export function exportOrderLines(
  query: Omit<OrderQuery, 'page' | 'pageSize'> & { priority?: string },
  columns?: string[],
): Promise<void> {
  const full = { ...query, columns: columns?.length ? columns.join(',') : undefined };
  const entries = Object.entries(full).filter(([, v]) => v != null && v !== '') as [string, string][];
  const qs = new URLSearchParams(entries).toString();
  return downloadFile(`/orders/export/lines${qs ? `?${qs}` : ''}`, 'order-lines.xlsx');
}

export function useOrder(id?: number) {
  return useQuery({
    queryKey: [...KEY, id],
    queryFn: () => http.get<OrderDto>(`/orders/${id}`),
    enabled: id != null,
  });
}

/**
 * Values for the Order Modify filter dropdowns, cascaded off whatever is already
 * selected — so picking a customer narrows the product list to that customer's
 * products. Paging is stripped so the query key doesn't churn when the user
 * simply turns a page.
 */
export function useOrderFilterOptions(query: Partial<OrderQuery> = {}) {
  const { page: _page, pageSize: _pageSize, ...filters } = query;
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null && v !== ''));
  return useQuery({
    queryKey: [...KEY, 'filter-options', params],
    queryFn: () => http.get<OrderFilterOptions>('/orders/filter-options', { params }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
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

/** Rebuild the legacy-style composite item list (each product on its own, plus
 *  the product × every design type in its category + sub-category) from the
 *  compact wire payload. Composing on the client keeps ~1.2 MB of multiplied
 *  rows off the network AND out of the persisted query cache — react-query
 *  caches the raw wire shape and memoizes this transform per fetch. */
function composeOrderLookups(wire: OrderLookupsWire): OrderLookups {
  const key = (c: string, s: string) => `${c.toUpperCase()}|${s.toUpperCase()}`;
  const designsByKey = new Map<string, { designType: string; designName: string; rate: number | null }[]>();
  for (const d of wire.designs) {
    const k = key(d.category, d.subCategory);
    const bucket = designsByKey.get(k) ?? [];
    bucket.push({ designType: d.designType, designName: d.designName, rate: d.rate });
    if (!designsByKey.has(k)) designsByKey.set(k, bucket);
  }
  const items: OrderItemOption[] = [];
  for (const p of wire.productRows) {
    const base = { product: p.product, category: p.category, subCategory: p.subCategory, size: p.size, pcs: p.pcs, weight: p.weight, productRate: p.rate };
    items.push({ ...base, designType: null, designName: null, designRate: null });
    for (const d of designsByKey.get(key(p.category, p.subCategory)) ?? []) {
      items.push({ ...base, designType: d.designType, designName: d.designName, designRate: d.rate });
    }
  }
  const { productRows: _rows, ...rest } = wire;
  return { ...rest, items };
}

export function useOrderLookups() {
  return useQuery({
    queryKey: [...KEY, 'lookups'],
    queryFn: () => http.get<OrderLookupsWire>('/orders/lookups'),
    select: composeOrderLookups,
    staleTime: 60_000,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderInput) => http.post<OrderDto>('/orders', input),
    onSuccess: () => invalidateOrderAvailability(qc),
  });
}

export function useUpdateOrder(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderInput) => http.patch<OrderDto>(`/orders/${id}`, input),
    onSuccess: () => invalidateOrderAvailability(qc),
  });
}

/** Save any order by id (used by Order Modify, which edits lines across many orders). */
export function useSaveOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: OrderInput }) => http.patch<OrderDto>(`/orders/${id}`, input),
    onSuccess: () => invalidateOrderAvailability(qc),
  });
}

/** Cancel an order (kept for records; server refuses once any line is dispatched). */
export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason, note }: { id: number; reason?: string | null; note?: string | null }) =>
      http.patch<OrderDto>(`/orders/${id}/status`, { status: 'CANCELLED', reason: reason ?? undefined, note: note ?? undefined }),
    onSuccess: () => invalidateOrderAvailability(qc),
  });
}

export function useDeleteOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/orders/${id}`),
    onSuccess: () => invalidateOrderAvailability(qc),
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
