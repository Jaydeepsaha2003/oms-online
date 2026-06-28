import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChallanDraft,
  ChallanDto,
  ChallanEditContext,
  ChallanItemHistoryList,
  ChallanList,
  ChallanQuery,
  ChallanSummary,
  CreateChallanInput,
  DraftChallanInput,
  PendingChallanList,
  PendingChallanQuery,
  UpdateChallanStatusInput,
} from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['challans'] as const;

/** Dispatch lines still awaiting a challan, with search + date-range filters. */
export function usePendingChallans(query: PendingChallanQuery) {
  return useQuery({
    queryKey: [...KEY, 'pending', query],
    queryFn: () => http.get<PendingChallanList>('/challans/pending', { params: query }),
    placeholderData: (prev) => prev,
  });
}

/** Parties that still have un-challaned dispatch lines (standalone Create Challan picker). */
export function usePendingChallanCustomers(search: string) {
  return useQuery({
    queryKey: [...KEY, 'pending-customers', search],
    queryFn: () => http.get<string[]>('/challans/pending-customers', { params: { search: search || undefined } }),
    placeholderData: (prev) => prev,
  });
}

/** Build a priced challan draft from the selected dispatch lines (one customer). */
export function useChallanDraft(input: DraftChallanInput | null) {
  return useQuery({
    queryKey: [...KEY, 'draft', input?.customerName, input?.dispatchIds],
    queryFn: () => http.post<ChallanDraft>('/challans/draft', input),
    enabled: !!input?.customerName,
    staleTime: Infinity,
  });
}

/** Persist the challan (header totals + items). */
export function useCreateChallan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChallanInput) => http.post<ChallanDto>('/challans', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Load a saved challan for editing (stored header + lines + the customer's add-more pool). */
export function useChallanEdit(id: number | null) {
  return useQuery({
    queryKey: [...KEY, 'edit', id],
    queryFn: () => http.get<ChallanEditContext>(`/challans/${id}/edit`),
    enabled: id != null,
    staleTime: Infinity,
  });
}

/** Replace a saved challan (invoice no preserved). */
export function useUpdateChallan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & CreateChallanInput) => http.put<ChallanDto>(`/challans/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Saved challans list (ViewChallan) with filters. */
export function useChallans(query: ChallanQuery) {
  return useQuery({
    queryKey: [...KEY, 'list', query],
    queryFn: () => http.get<ChallanList>('/challans', { params: query }),
    placeholderData: (prev) => prev,
  });
}

/** KPI roll-up over the same filters. */
export function useChallanSummary(query: ChallanQuery) {
  return useQuery({
    queryKey: [...KEY, 'summary', query],
    queryFn: () => http.get<ChallanSummary>('/challans/summary', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useUpdateChallanStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & UpdateChallanStatusInput) => http.patch<ChallanDto>(`/challans/${id}/status`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteChallan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete<{ id: number }>(`/challans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Distinct product names that appear on challans (ViewItemChallan sidebar). */
export function useChallanItemNames(search: string) {
  return useQuery({
    queryKey: [...KEY, 'item-names', search],
    queryFn: () => http.get<string[]>('/challans/item-names', { params: { search: search || undefined } }),
    placeholderData: (prev) => prev,
  });
}

/** Every challan line for a product (ViewItemChallan detail grid). */
export function useChallanItemHistory(product: string | null) {
  return useQuery({
    queryKey: [...KEY, 'item-history', product],
    queryFn: () => http.get<ChallanItemHistoryList>('/challans/item-history', { params: { product, pageSize: 200 } }),
    enabled: !!product,
    placeholderData: (prev) => prev,
  });
}
