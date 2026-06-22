import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GstRateBulkInput,
  GstRateDto,
  GstRateInput,
  GstRateList,
  GstRateLookups,
  GstRateQuery,
  RateHistoryEntry,
} from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

const KEY = ['gst-rates'] as const;

export function useGstRates(query: GstRateQuery) {
  return useQuery({
    queryKey: [...KEY, 'list', query],
    queryFn: () => http.get<GstRateList>('/gst-rates', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useGstLookups() {
  return useQuery({
    queryKey: [...KEY, 'lookups'],
    queryFn: () => http.get<GstRateLookups>('/gst-rates/lookups'),
    staleTime: 60_000,
  });
}

export function useGstRateHistory(customerName: string, category: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'history', customerName, category],
    queryFn: () =>
      http.get<RateHistoryEntry[]>('/gst-rates/history', { params: { customerName, category } }),
    enabled: enabled && customerName.trim().length > 0,
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

/** Blank fill-in sheet: every customer × category, rates pre-filled where set. */
export function downloadGstTemplate() {
  return downloadFile('/gst-rates/template', 'customer-gst-rates-template.xlsx');
}
