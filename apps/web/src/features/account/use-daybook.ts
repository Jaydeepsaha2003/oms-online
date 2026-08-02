import { useQuery } from '@tanstack/react-query';
import type { DaybookQuery, DaybookResult } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['daybook'] as const;

/** The daybook refreshes whenever a filter changes. */
export function useDaybook(query: DaybookQuery | null) {
  return useQuery({
    queryKey: [...KEY, query],
    queryFn: () => http.get<DaybookResult>('/daybook', { params: query! }),
    enabled: query != null,
    placeholderData: (prev) => prev,
  });
}
