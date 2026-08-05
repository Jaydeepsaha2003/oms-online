import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDispatchInput,
  DispatchFilterOptions,
  DispatchList,
  DispatchPhotoCheckDto,
  DispatchQuery,
  PendingList,
  PendingQuery,
  SubmitDispatchResult,
  UpdateDispatchInput,
  UpdateDispatchResult,
} from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

const KEY = ['dispatch'] as const;

/** Download the current pending-dispatch list (with the active filters) as .xlsx.
 *  `columns`, if given, limits the sheet to those column ids (see
 *  `DISPATCH_EXPORT_COLUMNS`) — omitted means every column. */
export function exportPendingDispatch(
  query: Omit<PendingQuery, 'page' | 'pageSize' | 'columns'>,
  columns?: string[],
): Promise<void> {
  const full = { ...query, columns: columns?.length ? columns.join(',') : undefined };
  const entries = Object.entries(full).filter(([, v]) => v != null && v !== '') as [string, string][];
  const qs = new URLSearchParams(entries).toString();
  return downloadFile(`/dispatch/pending/export${qs ? `?${qs}` : ''}`, 'pending-dispatch.xlsx');
}

export function usePendingOrders(query: PendingQuery) {
  return useQuery({
    queryKey: [...KEY, 'pending', query],
    queryFn: () => http.get<PendingList>('/dispatch/pending', { params: query }),
    // Keep the previous list on screen while a new filter loads (no flash), and
    // treat results as fresh for a short window so re-selecting a filter is instant.
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  });
}

export function useDispatches(query: DispatchQuery) {
  return useQuery({
    queryKey: [...KEY, 'list', query],
    queryFn: () => http.get<DispatchList>('/dispatch', { params: query }),
    placeholderData: (prev) => prev,
  });
}

// Only the filter fields matter for the option lists — strip paging so the query
// key doesn't churn on page changes, and cascade off the other active filters.
const optionParams = (q: Record<string, unknown> = {}) => {
  const { page: _p, pageSize: _ps, ...rest } = q;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null && v !== ''));
};

export function useDispatchFilterOptions(query: Partial<DispatchQuery> = {}) {
  const params = optionParams(query);
  return useQuery({
    queryKey: [...KEY, 'filter-options', params],
    queryFn: () => http.get<DispatchFilterOptions>('/dispatch/filter-options', { params }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

/** Has this party + item + design ever been documented with a reference photo?
 *  Gates the Dispatch form's Save — see DispatchService.photoCheck. */
export function useDispatchPhotoCheck(orderItemId?: number) {
  return useQuery({
    queryKey: [...KEY, 'photo-check', orderItemId],
    queryFn: () => http.get<DispatchPhotoCheckDto>(`/dispatch/photo-check/${orderItemId}`),
    enabled: orderItemId != null,
  });
}

/** Distinct customer/agent/product/design values among lines still pending dispatch. */
export function usePendingFilterOptions(query: Partial<PendingQuery> = {}) {
  const params = optionParams(query);
  return useQuery({
    queryKey: [...KEY, 'pending-filter-options', params],
    queryFn: () => http.get<DispatchFilterOptions>('/dispatch/pending-filter-options', { params }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

// Any dispatch change alters what a challan will contain, so also refresh the
// challans caches (the pending list + the staleTime:Infinity challan draft) —
// otherwise an edited/removed quantity reappears from a stale draft. It also
// moves the order's own dispatchState/timeline ('ordered → dispatched →
// challaned'), which the Orders list renders as a badge — so that needs a
// refresh too.
const invalidateDispatch = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ['challans'] });
  qc.invalidateQueries({ queryKey: ['orders'] });
};

/** Either creates the dispatch (dated today, or the user can approve back-dates)
 *  or parks it in the Approvals inbox — see {@link SubmitDispatchResult}. */
export function useCreateDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDispatchInput) => http.post<SubmitDispatchResult>('/dispatch', input),
    onSuccess: (res) => {
      // A parked request doesn't touch Dispatch/Orders/Challans data, so only
      // invalidate when something actually changed.
      if (res.status === 'CREATED') invalidateDispatch(qc);
      else qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}

/** Create & Dispatch: fully dispatch every pending line of a just-created order. */
export function useFulfillOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number) =>
      http.post<{ dispatched: number; skipped: number }>(`/dispatch/fulfill-order/${orderId}`, {}),
    onSuccess: () => invalidateDispatch(qc),
  });
}

/** The edit always applies; see {@link UpdateDispatchResult} for the date-move gate. */
export function useUpdateDispatch(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDispatchInput) => http.patch<UpdateDispatchResult>(`/dispatch/${id}`, input),
    onSuccess: (res) => {
      invalidateDispatch(qc);
      if (res.dateApprovalCode) qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}

export function useDeleteDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/dispatch/${id}`),
    onSuccess: () => invalidateDispatch(qc),
  });
}
