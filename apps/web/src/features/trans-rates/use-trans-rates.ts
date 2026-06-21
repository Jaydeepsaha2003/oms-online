import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TransRateBulkInput, TransRateDto, TransRateInput, TransRateLookups } from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

const KEY = ['trans-rates'] as const;

export function useTransLookups() {
  return useQuery({
    queryKey: [...KEY, 'lookups'],
    queryFn: () => http.get<TransRateLookups>('/transport-rates/lookups'),
    staleTime: 60_000,
  });
}

export function useTransRatesByCustomer(name: string) {
  return useQuery({
    queryKey: [...KEY, 'by-customer', name],
    queryFn: () => http.get<TransRateDto[]>('/transport-rates/by-customer', { params: { name } }),
    enabled: name.trim().length > 0,
  });
}

export function useUpsertTransRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TransRateInput) => http.post<TransRateDto>('/transport-rates', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useBulkTransRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TransRateBulkInput) => http.post<{ saved: number }>('/transport-rates/bulk', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteTransRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/transport-rates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useImportTransRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]) =>
      http.post<ImportResult>('/transport-rates/import', { rows }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function exportTransRates() {
  return downloadFile('/transport-rates/export', 'customer-transport-rates.xlsx');
}
