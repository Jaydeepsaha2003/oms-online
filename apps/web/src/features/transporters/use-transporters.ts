import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TransporterDto, TransporterInput, TransporterList, TransporterQuery } from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

const KEY = ['transporters'] as const;

export function useTransporters(query: TransporterQuery) {
  return useQuery({
    queryKey: [...KEY, query],
    queryFn: () => http.get<TransporterList>('/transporters', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useCreateTransporter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TransporterInput) => http.post<TransporterDto>('/transporters', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateTransporter(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TransporterInput) => http.patch<TransporterDto>(`/transporters/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteTransporter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/transporters/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useImportTransporters() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]) =>
      http.post<ImportResult>('/transporters/import', { rows }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function exportTransporters(query: TransporterQuery) {
  const qs = query.search ? `?search=${encodeURIComponent(query.search)}` : '';
  return downloadFile(`/transporters/export${qs}`, 'transporters.xlsx');
}
