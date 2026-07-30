import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDispatchInput,
  DispatchDto,
  DispatchFilterOptions,
  DispatchList,
  DispatchQuery,
  PendingList,
  PendingQuery,
  UpdateDispatchInput,
} from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

const KEY = ['dispatch'] as const;

/** Download the current pending-dispatch list (with the active filters) as .xlsx. */
export function exportPendingDispatch(query: Omit<PendingQuery, 'page' | 'pageSize'>): Promise<void> {
  const entries = Object.entries(query).filter(([, v]) => v != null && v !== '') as [string, string][];
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
// otherwise an edited/removed quantity reappears from a stale draft.
const invalidateDispatch = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ['challans'] });
};

export function useCreateDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDispatchInput) => http.post<DispatchDto>('/dispatch', input),
    onSuccess: () => invalidateDispatch(qc),
  });
}

export function useUpdateDispatch(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDispatchInput) => http.patch<DispatchDto>(`/dispatch/${id}`, input),
    onSuccess: () => invalidateDispatch(qc),
  });
}

export function useDeleteDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/dispatch/${id}`),
    onSuccess: () => invalidateDispatch(qc),
  });
}
