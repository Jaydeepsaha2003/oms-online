import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CancelQuotationInput,
  OrderDto,
  QuotationDto,
  QuotationInput,
  QuotationList,
  QuotationQuery,
} from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['quotations'] as const;

export function useQuotations(query: QuotationQuery) {
  return useQuery({
    queryKey: [...KEY, 'list', query],
    queryFn: () => http.get<QuotationList>('/quotations', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useQuotation(id?: number) {
  return useQuery({
    queryKey: [...KEY, id],
    queryFn: () => http.get<QuotationDto>(`/quotations/${id}`),
    enabled: id != null,
  });
}

export function useCreateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuotationInput) => http.post<QuotationDto>('/quotations', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateQuotation(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuotationInput) => http.patch<QuotationDto>(`/quotations/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/quotations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useConvertQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mode }: { id: number; mode?: 'DIRECT' | 'EDITED' }) =>
      http.post<OrderDto>(`/quotations/${id}/convert`, { mode }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useMarkQuotationSent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.post<QuotationDto>(`/quotations/${id}/sent`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCancelQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: CancelQuotationInput }) =>
      http.post<QuotationDto>(`/quotations/${id}/cancel`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
