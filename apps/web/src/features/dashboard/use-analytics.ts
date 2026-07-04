import { useQuery } from '@tanstack/react-query';
import type { DashboardKpis, OrderBacklog, OrderVsChallanSeries } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['analytics'] as const;

/** Dashboard KPI roll-up (order value by period, challan value, backlog, open orders). */
export function useDashboardKpis() {
  return useQuery({
    queryKey: [...KEY, 'dashboard'],
    queryFn: () => http.get<DashboardKpis>('/analytics/dashboard'),
    staleTime: 60_000,
  });
}

/** Monthly order value vs challan value for the last `months` months. */
export function useOrderVsChallan(months = 12) {
  return useQuery({
    queryKey: [...KEY, 'order-vs-challan', months],
    queryFn: () => http.get<OrderVsChallanSeries>('/analytics/order-vs-challan', { params: { months } }),
    staleTime: 60_000,
  });
}

/** Open-order fulfilment backlog (value, physical qty, urgent load, age bands). */
export function useBacklog() {
  return useQuery({
    queryKey: [...KEY, 'backlog'],
    queryFn: () => http.get<OrderBacklog>('/analytics/backlog'),
    staleTime: 60_000,
  });
}
