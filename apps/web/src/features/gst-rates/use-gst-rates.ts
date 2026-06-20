import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GstRateBulkInput,
  GstRateDto,
  GstRateInput,
  GstRateLookups,
} from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

const KEY = ['gst-rates'] as const;

export function useGstLookups() {
  return useQuery({
    queryKey: [...KEY, 'lookups'],
    queryFn: () => http.get<GstRateLookups>('/gst-rates/lookups'),
    staleTime: 60_000,
  });
}

export function useGstRatesByCustomer(name: string) {
  return useQuery({
    queryKey: [...KEY, 'by-customer', name],
    queryFn: () => http.get<GstRateDto[]>('/gst-rates/by-customer', { params: { name } }),
    enabled: name.trim().length > 0,
  });
}

export function useUpsertGstRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GstRateInput) => http.post<GstRateDto>('/gst-rates', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useBulkGstRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GstRateBulkInput) => http.post<{ saved: number }>('/gst-rates/bulk', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteGstRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/gst-rates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useImportGstRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]) =>
      http.post<ImportResult>('/gst-rates/import', { rows }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function exportGstRates() {
  return downloadFile('/gst-rates/export', 'customer-gst-rates.xlsx');
}
