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
import { http } from '@/lib/api';

const KEY = ['dispatch'] as const;

export function usePendingOrders(query: PendingQuery) {
  return useQuery({
    queryKey: [...KEY, 'pending', query],
    queryFn: () => http.get<PendingList>('/dispatch/pending', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useDispatches(query: DispatchQuery) {
  return useQuery({
    queryKey: [...KEY, 'list', query],
    queryFn: () => http.get<DispatchList>('/dispatch', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useDispatchFilterOptions() {
  return useQuery({
    queryKey: [...KEY, 'filter-options'],
    queryFn: () => http.get<DispatchFilterOptions>('/dispatch/filter-options'),
    staleTime: 60_000,
  });
}

/** Distinct customer/product/design values among lines still pending dispatch. */
export function usePendingFilterOptions() {
  return useQuery({
    queryKey: [...KEY, 'pending-filter-options'],
    queryFn: () => http.get<DispatchFilterOptions>('/dispatch/pending-filter-options'),
    staleTime: 60_000,
  });
}

export function useCreateDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDispatchInput) => http.post<DispatchDto>('/dispatch', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateDispatch(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDispatchInput) => http.patch<DispatchDto>(`/dispatch/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/dispatch/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
