import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  RateHistoryEntry,
  TransRateBulkInput,
  TransRateDto,
  TransRateInput,
  TransRateList,
  TransRateLookups,
  TransRateQuery,
} from '@oms/shared';
import { downloadFile, http } from '@/lib/api';
import { invalidateChallanRateDependants } from '@/features/challans/use-challans';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

const KEY = ['trans-rates'] as const;

// The challan screens embed the freight/packing rate resolved from this master
// (to flag unpriced lines), so a rate change has to refresh those too —
// otherwise Pending Challan keeps flagging a party that now has rates.
const invalidateTransRates = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY });
  invalidateChallanRateDependants(qc);
};

export function useTransRates(query: TransRateQuery) {
  return useQuery({
    queryKey: [...KEY, 'list', query],
    queryFn: () => http.get<TransRateList>('/transport-rates', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useTransLookups() {
  return useQuery({
    queryKey: [...KEY, 'lookups'],
    queryFn: () => http.get<TransRateLookups>('/transport-rates/lookups'),
    staleTime: 60_000,
  });
}

export function useTransRateHistory(customerName: string, category: string, type: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'history', customerName, category, type],
    queryFn: () =>
      http.get<RateHistoryEntry[]>('/transport-rates/history', { params: { customerName, category, type } }),
    enabled: enabled && customerName.trim().length > 0,
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
    onSuccess: () => invalidateTransRates(qc),
  });
}

export function useBulkTransRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TransRateBulkInput) => http.post<{ saved: number }>('/transport-rates/bulk', input),
    onSuccess: () => invalidateTransRates(qc),
  });
}

export function useDeleteTransRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/transport-rates/${id}`),
    onSuccess: () => invalidateTransRates(qc),
  });
}

export function useImportTransRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]) =>
      http.post<ImportResult>('/transport-rates/import', { rows }),
    onSuccess: () => invalidateTransRates(qc),
  });
}

export function exportTransRates() {
  return downloadFile('/transport-rates/export', 'customer-transport-rates.xlsx');
}

/** Blank fill-in sheet: every customer × category × type, pre-filled where set. */
export function downloadTransTemplate() {
  return downloadFile('/transport-rates/template', 'customer-transport-rates-template.xlsx');
}
