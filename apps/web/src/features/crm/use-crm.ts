import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddFollowupLogInput,
  CrmReminderSettings,
  FollowupDto,
  FollowupList,
  FollowupPartyGroup,
  FollowupQuery,
  FollowupSummary,
  SaveFollowupInput,
} from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['crm'] as const;

export function useFollowupBoard(query: FollowupQuery = {}) {
  return useQuery({
    queryKey: [...KEY, 'board', query],
    queryFn: () => http.get<FollowupPartyGroup[]>('/crm/followups/board', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useFollowupList(query: FollowupQuery) {
  return useQuery({
    queryKey: [...KEY, 'list', query],
    queryFn: () => http.get<FollowupList>('/crm/followups', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useFollowupSummary(kind?: string) {
  return useQuery({
    queryKey: [...KEY, 'summary', kind ?? null],
    queryFn: () => http.get<FollowupSummary>('/crm/followups/summary', { params: kind ? { kind } : undefined }),
    refetchInterval: 60_000,
  });
}

/** Active nudges — polled for the intrusive reminder + the live badge count. */
export function useFollowupDue(kind?: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'due', kind ?? null],
    queryFn: () => http.get<FollowupDto[]>('/crm/followups/due', { params: kind ? { kind } : undefined }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function useFollowup(id?: number) {
  return useQuery({
    queryKey: [...KEY, 'one', id],
    queryFn: () => http.get<FollowupDto>(`/crm/followups/${id}`),
    enabled: id != null,
  });
}

export function useCrmSettings() {
  return useQuery({
    queryKey: [...KEY, 'settings'],
    queryFn: () => http.get<CrmReminderSettings>('/crm/followups/settings'),
    staleTime: 60_000,
  });
}

export function usePartySuggest(q: string) {
  return useQuery({
    queryKey: [...KEY, 'party-suggest', q],
    queryFn: () => http.get<{ id: number | null; partyName: string }[]>('/crm/followups/party-suggest', { params: q ? { q } : undefined }),
    staleTime: 30_000,
  });
}

/** OPEN orders (confirmed, lines still pending dispatch) — with `party` set it
 *  lists that party's open order ids without any typing. */
export function useOrderSuggest(q: string, party?: string) {
  return useQuery({
    queryKey: [...KEY, 'order-suggest', q, party ?? null],
    queryFn: () =>
      http.get<{ id: number; code: string; customerName: string; customerId: number | null; orderDate: string; pendingLines: number }[]>(
        '/crm/followups/order-suggest',
        { params: { ...(q ? { q } : {}), ...(party ? { party } : {}) } },
      ),
    enabled: q.trim().length > 0 || !!party,
    staleTime: 30_000,
  });
}

/* ── Mutations ───────────────────────────────────────────────────────────────── */

const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: KEY });

export function useCreateFollowup() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: SaveFollowupInput) => http.post<FollowupDto>('/crm/followups', input), onSuccess: () => invalidate(qc) });
}
export function useUpdateFollowup() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, input }: { id: number; input: Partial<SaveFollowupInput> }) => http.patch<FollowupDto>(`/crm/followups/${id}`, input), onSuccess: () => invalidate(qc) });
}
export function useAddFollowupLog() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, input }: { id: number; input: AddFollowupLogInput }) => http.post<FollowupDto>(`/crm/followups/${id}/log`, input), onSuccess: () => invalidate(qc) });
}
export function useSnoozeFollowup() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: number) => http.post<FollowupDto>(`/crm/followups/${id}/snooze`, {}), onSuccess: () => invalidate(qc) });
}
export function useResolveFollowup() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: number) => http.post<FollowupDto>(`/crm/followups/${id}/resolve`, {}), onSuccess: () => invalidate(qc) });
}
export function useReopenFollowup() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: number) => http.post<FollowupDto>(`/crm/followups/${id}/reopen`, {}), onSuccess: () => invalidate(qc) });
}
export function useDeleteFollowup() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: number) => http.delete(`/crm/followups/${id}`), onSuccess: () => invalidate(qc) });
}
export function useSaveCrmSettings() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: Partial<CrmReminderSettings>) => http.put<CrmReminderSettings>('/crm/followups/settings', input), onSuccess: () => invalidate(qc) });
}
