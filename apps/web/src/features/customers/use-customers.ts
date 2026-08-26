import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgentRateList,
  CustomerDto,
  CustomerInput,
  CustomerList,
  CustomerLookups,
  CustomerQuery,
  CustomerRateList,
  RateChangeEntry,
} from '@oms/shared';
import { downloadFile, http } from '@/lib/api';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

const KEY = ['customers'] as const;

export function useCustomers(query: CustomerQuery) {
  return useQuery({
    queryKey: [...KEY, query],
    queryFn: () => http.get<CustomerList>('/customers', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useCustomer(id: number | undefined) {
  return useQuery({
    queryKey: [...KEY, 'one', id],
    queryFn: () => http.get<CustomerDto>(`/customers/${id}`),
    enabled: id != null,
  });
}

/** This customer's special-rate change history (newest first) for the Rate List page. */
export function useCustomerRateHistory(id: number | undefined) {
  return useQuery({
    queryKey: [...KEY, 'rate-history', id],
    queryFn: () => http.get<RateChangeEntry[]>(`/customers/${id}/rate-history`),
    enabled: id != null,
    placeholderData: (prev) => prev,
  });
}

/** Fetch the customer's current effective rate list on demand (for the PDF/Excel download). */
export function fetchCustomerRateList(id: number): Promise<CustomerRateList> {
  return http.get<CustomerRateList>(`/customers/${id}/rate-list`);
}

/**
 * The chart rate list with no party attached — base rates, no adjustments.
 *
 * `label` is only what gets printed at the top of the sheet; it creates nothing.
 * Not a useQuery: this is fetched at the moment someone downloads, and caching
 * it under a free-text name would just fill the cache with one entry per name
 * anyone ever typed.
 */
export function fetchDefaultRateList(label?: string): Promise<CustomerRateList> {
  const name = (label ?? '').trim();
  return http.get<CustomerRateList>('/customers/rate-list/default', name ? { params: { name } } : undefined);
}

/**
 * The chart rate list, cached — so the download dialog can offer a category
 * picker for it and then export from the same payload.
 *
 * Fetched WITHOUT a name on purpose. The name is only printed at the top, so
 * keying the cache on it would refetch 650 lines on every keystroke in the name
 * box; the caller substitutes it locally instead (see DEFAULT_RATE_LIST_TITLE).
 */
export function useDefaultRateList(enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'rate-list', 'default'],
    queryFn: () => fetchDefaultRateList(),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * The agent rate list — product price beside the agent's commission.
 *
 * `customerId` is optional and is not just a filter: naming a party both prices
 * the products at that party's own rates AND lets party-specific commission
 * rules resolve, which cannot happen without one. It is therefore part of the
 * cache key, not a post-fetch filter.
 */
export function fetchAgentRateList(agentId: number, customerId?: number | null): Promise<AgentRateList> {
  return http.get<AgentRateList>('/customers/rate-list/agent', {
    params: { agentId, ...(customerId != null ? { customerId } : {}) },
  });
}

export function useAgentRateList(agentId: number | undefined, customerId?: number | null) {
  return useQuery({
    queryKey: [...KEY, 'rate-list', 'agent', agentId, customerId ?? null],
    queryFn: () => fetchAgentRateList(agentId!, customerId),
    enabled: agentId != null,
    staleTime: 30_000,
  });
}

/** The customer's current effective rate list, for the on-screen preview. */
export function useCustomerRateList(id: number | undefined) {
  return useQuery({
    queryKey: [...KEY, 'rate-list', id],
    queryFn: () => fetchCustomerRateList(id!),
    enabled: id != null,
    placeholderData: (prev) => prev,
  });
}

export function useCustomerLookups() {
  return useQuery({
    queryKey: [...KEY, 'lookups'],
    queryFn: () => http.get<CustomerLookups>('/customers/lookups'),
    staleTime: 60_000,
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerInput) => http.post<CustomerDto>('/customers', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateCustomer(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerInput) => http.patch<CustomerDto>(`/customers/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * Flip a customer's Active flag, and nothing else.
 *
 * Its own endpoint rather than a partial PATCH through `useUpdateCustomer`:
 * the customer update applies the DTO as a FULL overwrite, so sending
 * `{ active }` alone would blank the party's agent, city, transport and rates.
 */
export function useSetCustomerActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      http.patch<CustomerDto>(`/customers/${id}/active`, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/customers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useImportCustomers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]) =>
      http.post<ImportResult>('/customers/import', { rows }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function exportCustomers(query: CustomerQuery) {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.sortBy) params.set('sortBy', query.sortBy);
  if (query.sortOrder) params.set('sortOrder', query.sortOrder);
  const qs = params.toString();
  return downloadFile(`/customers/export${qs ? `?${qs}` : ''}`, 'customers.xlsx');
}
