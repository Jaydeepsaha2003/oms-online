import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderOptionDto, OrderOptionInput } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['settings'] as const;

export function useSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => http.get<OrderOptionDto[]>('/settings'),
    staleTime: 60_000,
  });
}

/** Convenience: the values for one setting group, in display order. */
export function settingValues(all: OrderOptionDto[] | undefined, group: string): string[] {
  return (all ?? [])
    .filter((o) => o.group === group)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((o) => o.value);
}

export function useCreateOrderOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderOptionInput) => http.post<OrderOptionDto>('/settings', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteOrderOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/settings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
