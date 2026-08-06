import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DesignTrackFilterOptions,
  DesignTrackList,
  DesignTrackQuery,
  DesignTrackRow,
  DesignTrackTypesDto,
  DesignTrackTypesInput,
} from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

const KEY = ['design-track'] as const;
const TYPES_KEY = ['design-track-types'] as const;

export function useDesignTrack(query: DesignTrackQuery) {
  return useQuery({
    queryKey: [...KEY, query],
    queryFn: () => http.get<DesignTrackList>('/design-track', { params: query }),
    placeholderData: (prev) => prev,
  });
}

/** Filter values, cascaded off the other active filters. Paging is stripped so
 *  turning a page doesn't churn the query key. */
export function useDesignTrackFilterOptions(query: Partial<DesignTrackQuery> = {}) {
  const { page: _page, pageSize: _pageSize, ...filters } = query;
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null && v !== ''));
  return useQuery({
    queryKey: [...KEY, 'filter-options', params],
    queryFn: () => http.get<DesignTrackFilterOptions>('/design-track/filter-options', { params }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

/**
 * Save one line's Kalwat. The server returns the recomputed row (including
 * Remaining), so the grid takes its arithmetic from one place rather than the
 * client re-deriving the same formula.
 */
export function useSetKalwat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderItemId, kalwat }: { orderItemId: number; kalwat: number | null }) =>
      http.put<DesignTrackRow>(`/design-track/${orderItemId}/kalwat`, { kalwat }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** The tracked design types (selected + the full available list) from Settings. */
export function useDesignTrackTypes() {
  return useQuery({
    queryKey: TYPES_KEY,
    queryFn: () => http.get<DesignTrackTypesDto>('/settings/design-track-types'),
    staleTime: 60_000,
  });
}

export function useUpdateDesignTrackTypes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DesignTrackTypesInput) => http.put<DesignTrackTypesDto>('/settings/design-track-types', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TYPES_KEY });
      // Changing what's tracked changes the whole grid.
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function exportDesignTrack(query: Partial<DesignTrackQuery>) {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]),
  ).toString();
  return downloadFile(`/design-track/export${params ? `?${params}` : ''}`, 'design-track.xlsx');
}
