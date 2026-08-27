import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BulkCombinationInput,
  BulkCombinationResult,
  CombinationDto,
  CombinationInput,
  CombinationList,
  CombinationQuery,
} from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

const KEY = ['combinations'] as const;

function invalidateCombinations(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ['orders', 'lookups'] });
}

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
    onSuccess: () => invalidateCombinations(qc),
  });
}

/** Several combinations in one request — the Designs screen's "which
 *  combinations?" step. Already-existing design sets come back in `skipped`. */
export function useCreateCombinationBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkCombinationInput) => http.post<BulkCombinationResult>('/combinations/bulk', input),
    onSuccess: () => invalidateCombinations(qc),
  });
}

export function useUpdateCombination(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CombinationInput) => http.patch<CombinationDto>(`/combinations/${id}`, input),
    onSuccess: () => invalidateCombinations(qc),
  });
}

export function useDeleteCombination() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/combinations/${id}`),
    onSuccess: () => invalidateCombinations(qc),
  });
}

export function useImportCombinations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]) => http.post<ImportResult>('/combinations/import', { rows }),
    onSuccess: () => invalidateCombinations(qc),
  });
}

export function exportCombinations(query: CombinationQuery) {
  const qs = query.search ? `?search=${encodeURIComponent(query.search)}` : '';
  return downloadFile(`/combinations/export${qs}`, 'combinations.xlsx');
}
