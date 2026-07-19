import { useQuery } from '@tanstack/react-query';
import type { AuditActorDto, AuditLogFacets, AuditLogList, AuditLogQuery } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['audit-log'] as const;

export function useAuditLog(query: AuditLogQuery) {
  return useQuery({
    queryKey: [...KEY, 'list', query],
    queryFn: () => http.get<AuditLogList>('/audit-logs', { params: query }),
    placeholderData: (prev) => prev,
  });
}

/** Distinct resource/action values actually present — for filter dropdowns. */
export function useAuditFacets() {
  return useQuery({
    queryKey: [...KEY, 'facets'],
    queryFn: () => http.get<AuditLogFacets>('/audit-logs/facets'),
    staleTime: 60_000,
  });
}

/** Users who have at least one audit log entry — for the "User" filter dropdown. */
export function useAuditActors() {
  return useQuery({
    queryKey: [...KEY, 'actors'],
    queryFn: () => http.get<AuditActorDto[]>('/audit-logs/actors'),
    staleTime: 60_000,
  });
}
