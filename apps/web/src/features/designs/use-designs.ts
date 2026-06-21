import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DesignDto, DesignInput, DesignList, DesignQuery } from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

const KEY = ['designs'] as const;

// A design's cost/rate feeds every combination it belongs to, so changes must
// refresh the (live-computed) combinations list too.
function invalidateDesignsAndCombos(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ['combinations'] });
}

export function useDesigns(query: DesignQuery) {
  return useQuery({
    queryKey: [...KEY, query],
    queryFn: () => http.get<DesignList>('/designs', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useCreateDesign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DesignInput) => http.post<DesignDto>('/designs', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateDesign(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DesignInput) => http.patch<DesignDto>(`/designs/${id}`, input),
    onSuccess: () => invalidateDesignsAndCombos(qc),
  });
}

export function useDeleteDesign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/designs/${id}`),
    onSuccess: () => invalidateDesignsAndCombos(qc),
  });
}

export function useImportDesigns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]) => http.post<ImportResult>('/designs/import', { rows }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function exportDesigns(query: DesignQuery) {
  const qs = query.search ? `?search=${encodeURIComponent(query.search)}` : '';
  return downloadFile(`/designs/export${qs}`, 'designs.xlsx');
}
