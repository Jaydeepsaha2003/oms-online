import { useQuery } from '@tanstack/react-query';
import type { BusinessOverview, CollectionsReport, FulfilmentReport, PartyIntelReport, PatternsReport, ProductReport, ReportFilters, ReportMeasure, SalesReport, SummaryAnalysisReport } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['reports'] as const;
const opts = { staleTime: 60_000 } as const;

/** Drop empty/undefined filter params so the query key stays stable. */
function params(f: ReportFilters, extra?: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = { ...extra };
  for (const [k, v] of Object.entries(f)) if (v != null && v !== '') p[k] = v;
  return p;
}

export function useSummaryAnalysis(f: ReportFilters = {}) {
  return useQuery({ queryKey: [...KEY, 'summary-analysis', f], queryFn: () => http.get<SummaryAnalysisReport>('/reports/summary-analysis', { params: params(f) }), ...opts });
}

/** §8.5 — Business Overview. */
export function useBusinessOverview(f: ReportFilters = {}) {
  return useQuery({ queryKey: [...KEY, 'business-overview', f], queryFn: () => http.get<BusinessOverview>('/reports/business-overview', { params: params(f) }), ...opts });
}
/** §8.6 — Sales & Revenue. */
export function useSalesReport(months = 12, f: ReportFilters = {}) {
  return useQuery({ queryKey: [...KEY, 'sales', months, f], queryFn: () => http.get<SalesReport>('/reports/sales', { params: params(f, { months }) }), ...opts });
}
/** §8.2 — Collections & Recovery. */
export function useCollectionsReport(f: ReportFilters = {}) {
  return useQuery({ queryKey: [...KEY, 'collections', f], queryFn: () => http.get<CollectionsReport>('/reports/collections', { params: params(f) }), ...opts });
}
/** §8.7 — Party Intelligence. */
export function usePartyIntel(f: ReportFilters = {}) {
  return useQuery({ queryKey: [...KEY, 'party-intel', f], queryFn: () => http.get<PartyIntelReport>('/reports/party-intel', { params: params(f) }), ...opts });
}
/** §8.8 — Product & Design. */
export function useProductReport(f: ReportFilters = {}, measure: ReportMeasure = 'amount') {
  return useQuery({ queryKey: [...KEY, 'products', f, measure], queryFn: () => http.get<ProductReport>('/reports/products', { params: params(f, { measure }) }), ...opts });
}
/** §8.9 — Patterns & Insights. */
export function usePatterns(f: ReportFilters = {}) {
  return useQuery({ queryKey: [...KEY, 'patterns', f], queryFn: () => http.get<PatternsReport>('/reports/patterns', { params: params(f) }), ...opts });
}
/** §8.10 — Orders & Fulfilment. */
export function useFulfilment(f: ReportFilters = {}) {
  return useQuery({ queryKey: [...KEY, 'fulfilment', f], queryFn: () => http.get<FulfilmentReport>('/reports/fulfilment', { params: params(f) }), ...opts });
}
