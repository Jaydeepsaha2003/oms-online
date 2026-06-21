import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CombinationDto, CombinationInput, CombinationList, CombinationQuery } from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

const KEY = ['combinations'] as const;

export function useCombinations(query: CombinationQuery) {
  return useQuery({
    queryKey: [...KEY, query],
    queryFn: () => http.get<CombinationList>('/combinations', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useCreateCombination() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CombinationInput) => http.post<CombinationDto>('/combinations', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateCombination(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CombinationInput) => http.patch<CombinationDto>(`/combinations/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteCombination() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/combinations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useImportCombinations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]) => http.post<ImportResult>('/combinations/import', { rows }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function exportCombinations(query: CombinationQuery) {
  const qs = query.search ? `?search=${encodeURIComponent(query.search)}` : '';
  return downloadFile(`/combinations/export${qs}`, 'combinations.xlsx');
}
