import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderDto, OrderInput, OrderList, OrderLookups, OrderQuery } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['orders'] as const;

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

export function useDeleteOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/orders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
