import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentDto, AgentInput, AgentList, AgentQuery } from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

const KEY = ['agents'] as const;

export function useAgents(query: AgentQuery) {
  return useQuery({
    queryKey: [...KEY, query],
    queryFn: () => http.get<AgentList>('/agents', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentInput) => http.post<AgentDto>('/agents', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateAgent(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentInput) => http.patch<AgentDto>(`/agents/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/agents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useImportAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]) => http.post<ImportResult>('/agents/import', { rows }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function exportAgents(query: AgentQuery) {
  const qs = query.search ? `?search=${encodeURIComponent(query.search)}` : '';
  return downloadFile(`/agents/export${qs}`, 'agents.xlsx');
}
