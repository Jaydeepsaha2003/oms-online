import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PartyListsConfig, PartyListsResult } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['crm', 'party-lists'] as const;

/** The saved list definitions (rule sets). */
export function usePartyListsConfig() {
  return useQuery({
    queryKey: [...KEY, 'config'],
    queryFn: () => http.get<PartyListsConfig>('/crm/party-lists/config'),
    staleTime: 60_000,
  });
}

/** Every party's live metrics + which lists they currently match. */
export function usePartyListsEvaluate() {
  return useQuery({
    queryKey: [...KEY, 'evaluate'],
    queryFn: () => http.get<PartyListsResult>('/crm/party-lists/evaluate'),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useSavePartyListsConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: PartyListsConfig) => http.put<PartyListsConfig>('/crm/party-lists/config', config),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
