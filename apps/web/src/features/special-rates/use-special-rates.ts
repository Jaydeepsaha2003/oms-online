import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgentCustomer,
  BulkSaveCustomerBagWeightInput,
  BulkSaveCustomerLogoInput,
  BulkSaveCustomerRateInput,
  CustomerBagWeightDto,
  CustomerLogoDto,
  CustomerRateDto,
  CustomerSpecialRates,
  SaveCustomerBagWeightInput,
  SaveCustomerLogoInput,
  SaveCustomerRateInput,
  SpecialRateLookups,
  SpecialRateMasterList,
  SpecialRateMasterQuery,
} from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['special-rates'] as const;

/** Catalog for the cascading category → sub-category → item dropdowns. */
export function useSpecialRateLookups() {
  return useQuery({
    queryKey: [...KEY, 'lookups'],
    queryFn: () => http.get<SpecialRateLookups>('/special-rates/lookups'),
    staleTime: 60_000,
  });
}

/** All rate overrides + logo restrictions for one customer. */
export function useCustomerSpecialRates(customerId: number | undefined) {
  return useQuery({
    queryKey: [...KEY, 'customer', customerId],
    queryFn: () => http.get<CustomerSpecialRates>('/special-rates', { params: { customerId } }),
    enabled: customerId != null,
    placeholderData: (prev) => prev,
  });
}

/** Master list — everyone's special rates + logo restrictions, with filters. */
export function useAllSpecialRates(query: SpecialRateMasterQuery) {
  return useQuery({
    queryKey: [...KEY, 'all', query],
    queryFn: () => http.get<SpecialRateMasterList>('/special-rates/all', { params: query }),
    placeholderData: (prev) => prev,
  });
}

/** Distinct agent names (with customers). */
export function useSpecialRateAgents() {
  return useQuery({
    queryKey: [...KEY, 'agents'],
    queryFn: () => http.get<string[]>('/special-rates/agents'),
    staleTime: 60_000,
  });
}

/** Customers under an agent, for the bulk-apply picker. */
export function useAgentCustomers(agentName: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'agent-customers', agentName],
    queryFn: () => http.get<AgentCustomer[]>('/special-rates/agent-customers', { params: { agentName } }),
    enabled: !!agentName,
  });
}

export function useBulkSaveCustomerRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkSaveCustomerRateInput) => http.post<{ applied: number }>('/special-rates/rate/bulk', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useBulkSaveCustomerLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkSaveCustomerLogoInput) => http.post<{ applied: number }>('/special-rates/logo/bulk', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSaveCustomerRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveCustomerRateInput) => http.post<CustomerRateDto>('/special-rates/rate', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteCustomerRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/special-rates/rate/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSaveCustomerLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveCustomerLogoInput) => http.post<CustomerLogoDto>('/special-rates/logo', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteCustomerLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/special-rates/logo/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSaveCustomerBagWeight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveCustomerBagWeightInput) => http.post<CustomerBagWeightDto>('/special-rates/bag-weight', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useBulkSaveCustomerBagWeight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkSaveCustomerBagWeightInput) => http.post<{ applied: number }>('/special-rates/bag-weight/bulk', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteCustomerBagWeight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/special-rates/bag-weight/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
