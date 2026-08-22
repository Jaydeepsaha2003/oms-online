import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CombinationCheckResult,
  EffectiveRateListConfig,
  PartyRateListConfigInput,
  RateListConfigBundle,
  RateListConfigInput,
} from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['rate-list-config'] as const;

/** The default configuration, every party override, and the catalogue values to
 *  choose from — one round trip, because the screen needs all three at once. */
export function useRateListConfigBundle() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => http.get<RateListConfigBundle>('/customers/rate-list-config'),
    staleTime: 30_000,
  });
}

/** What actually applies to one party: the default with that party's overrides
 *  folded in, and which level supplied each field. This is what the rate list
 *  itself will call when a party is selected (§10, §29). */
export function useEffectiveRateListConfig(customerId?: number) {
  return useQuery({
    queryKey: [...KEY, 'effective', customerId],
    queryFn: () => http.get<EffectiveRateListConfig>(`/customers/${customerId}/rate-list-config`),
    enabled: customerId != null,
  });
}

export function useSaveRateListDefault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RateListConfigInput) => http.put<RateListConfigInput>('/customers/rate-list-config', input),
    // A default change reaches every party that has not overridden the field, so
    // no cached effective config can be trusted afterwards.
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSavePartyRateListConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, ...input }: PartyRateListConfigInput) =>
      http.put<PartyRateListConfigInput>(`/customers/${customerId}/rate-list-config`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useClearPartyRateListConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (customerId: number) => http.delete<{ ok: true }>(`/customers/${customerId}/rate-list-config`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * "May these sub-categories share one price column?" (§8)
 *
 * Answered by the server against live rates — never re-implemented here. A
 * client-side copy of the rule would eventually disagree with the one that
 * guards the save, and the disagreement would surface as a combination that
 * looked fine until it was rejected.
 */
export function useCheckCombination() {
  return useMutation({
    mutationFn: (input: { category: string; subCategories: string[]; kind?: 'PRODUCT' | 'DESIGN' }) =>
      http.post<CombinationCheckResult>('/customers/rate-list-config/check-combination', input),
  });
}
