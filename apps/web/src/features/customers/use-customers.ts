import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CustomerDto,
  CustomerInput,
  CustomerList,
  CustomerLookups,
  CustomerQuery,
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
  if (query.sortBy) params.set('sortBy', query.sortBy);
  if (query.sortOrder) params.set('sortOrder', query.sortOrder);
  const qs = params.toString();
  return downloadFile(`/customers/export${qs ? `?${qs}` : ''}`, 'customers.xlsx');
}
