import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DesignNameDto, DesignNameInput, DesignNameList, DesignNameQuery } from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

const KEY = ['design-names'] as const;

export function useDesignNames(query: DesignNameQuery) {
  return useQuery({
    queryKey: [...KEY, query],
    queryFn: () => http.get<DesignNameList>('/design-names', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useCreateDesignName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DesignNameInput) => http.post<DesignNameDto>('/design-names', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateDesignName(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DesignNameInput) => http.patch<DesignNameDto>(`/design-names/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteDesignName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/design-names/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useImportDesignNames() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]) =>
      http.post<ImportResult>('/design-names/import', { rows }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function exportDesignNames(query: DesignNameQuery) {
  const qs = query.search ? `?search=${encodeURIComponent(query.search)}` : '';
  return downloadFile(`/design-names/export${qs}`, 'design-names.xlsx');
}
