import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CombinationCheckResult,
  EffectiveRateListConfig,
  PartyRateListConfigInput,
  RateListCategoryItems,
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

/**
 * Item/design names in one category, for the Available-override target picker.
 *
 * Enabled only once a category is actually being edited, so opening the settings
 * screen fetches nothing. Cached per category — the catalogue does not move
 * while somebody is configuring a sheet.
 */
export function useRateListCategoryItems(category: string | null) {
  return useQuery({
    queryKey: [...KEY, 'items', category],
    queryFn: () => http.get<RateListCategoryItems>('/customers/rate-list-config/items', { params: { category } }),
    enabled: !!category,
    staleTime: 60_000,
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
