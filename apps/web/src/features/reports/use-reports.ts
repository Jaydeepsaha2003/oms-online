import { useQuery } from '@tanstack/react-query';
import type { BusinessOverview, CollectionsReport, FulfilmentReport, PartyIntelReport, PatternsReport, ProductReport, SalesReport } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['reports'] as const;
const opts = { staleTime: 60_000 } as const;

/** §8.5 — Business Overview. */
export function useBusinessOverview() {
  return useQuery({ queryKey: [...KEY, 'business-overview'], queryFn: () => http.get<BusinessOverview>('/reports/business-overview'), ...opts });
}
/** §8.6 — Sales & Revenue. */
export function useSalesReport(months = 12) {
  return useQuery({ queryKey: [...KEY, 'sales', months], queryFn: () => http.get<SalesReport>('/reports/sales', { params: { months } }), ...opts });
}
/** §8.2 — Collections & Recovery. */
export function useCollectionsReport() {
  return useQuery({ queryKey: [...KEY, 'collections'], queryFn: () => http.get<CollectionsReport>('/reports/collections'), ...opts });
}
/** §8.7 — Party Intelligence. */
export function usePartyIntel() {
  return useQuery({ queryKey: [...KEY, 'party-intel'], queryFn: () => http.get<PartyIntelReport>('/reports/party-intel'), ...opts });
}
/** §8.8 — Product & Design. */
export function useProductReport() {
  return useQuery({ queryKey: [...KEY, 'products'], queryFn: () => http.get<ProductReport>('/reports/products'), ...opts });
}
/** §8.9 — Patterns & Insights. */
export function usePatterns() {
  return useQuery({ queryKey: [...KEY, 'patterns'], queryFn: () => http.get<PatternsReport>('/reports/patterns'), ...opts });
}
/** §8.10 — Orders & Fulfilment. */
export function useFulfilment() {
  return useQuery({ queryKey: [...KEY, 'fulfilment'], queryFn: () => http.get<FulfilmentReport>('/reports/fulfilment'), ...opts });
}
