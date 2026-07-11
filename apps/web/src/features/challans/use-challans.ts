import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChallanAnalytics,
  ChallanDraft,
  ChallanDto,
  ChallanEditContext,
  ChallanPrefixSettings,
  ChallanItemHistoryList,
  ChallanList,
  ChallanQuery,
  ChallanSummary,
  CreateChallanInput,
  DismissMissingChallanInput,
  DraftChallanInput,
  MissingChallanEntry,
  MissingChallanFysDto,
  MissingChallanQuery,
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

/** Configured challan-number prefixes (Settings + Create form dropdown). */
export function useChallanPrefixSettings() {
  return useQuery({
    queryKey: [...KEY, 'prefix-settings'],
    queryFn: () => http.get<ChallanPrefixSettings>('/challans/settings'),
  });
}

export function useSaveChallanPrefixSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ChallanPrefixSettings) => http.put<ChallanPrefixSettings>('/challans/settings', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Preview the next challan number for a prefix + date. */
export function useChallanNextCode(prefix: string | undefined, date: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'next-code', prefix, date],
    queryFn: () => http.get<{ code: string }>('/challans/next-code', { params: { prefix, date } }),
    enabled: enabled && !!prefix,
    staleTime: 30_000,
  });
}

/** Parties that still have un-challaned dispatch lines (Pending Challan list filter). */
export function usePendingChallanCustomers(search: string) {
  return useQuery({
    queryKey: [...KEY, 'pending-customers', search],
    queryFn: () => http.get<string[]>('/challans/pending-customers', { params: { search: search || undefined } }),
    placeholderData: (prev) => prev,
  });
}

/** Every party in the Customer master (Create Challan picker) — not just parties
 *  that currently have un-challaned dispatches; picking one with nothing pending
 *  still opens the form so a manual line can be added. */
export function useAllChallanCustomers(search = '') {
  return useQuery({
    queryKey: [...KEY, 'customer-names', search],
    queryFn: () => http.get<string[]>('/challans/customer-names', { params: { search: search || undefined } }),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
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

/** Rich analytics roll-up for the "Show KPI" modal (enabled while the modal is open). */
export function useChallanAnalytics(query: ChallanQuery, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'analytics', query],
    queryFn: () => http.get<ChallanAnalytics>('/challans/analytics', { params: query }),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/** Fetch the full filtered set (with line items) for a "Get Report by" export. */
export function fetchAllChallans(query: ChallanQuery): Promise<{ items: ChallanDto[] }> {
  return http.get<{ items: ChallanDto[] }>('/challans/export', { params: query });
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

/* ── Missing Challan (legacy MissingChallanForm) ──────────────────────────────── */

/** FYs on record for a prefix, plus the current FY (for the FY dropdown). */
export function useMissingChallanFys(prefix: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'missing-fys', prefix],
    queryFn: () => http.get<MissingChallanFysDto>('/challans/missing/fys', { params: { prefix } }),
    enabled: enabled && !!prefix,
  });
}

/** Gap (or dismissed-gap) invoice numbers for one prefix/FY series. */
export function useMissingChallanList(query: MissingChallanQuery | null) {
  return useQuery({
    queryKey: [...KEY, 'missing-list', query],
    queryFn: () => http.get<MissingChallanEntry[]>('/challans/missing', { params: query! }),
    enabled: !!query?.prefix && !!query?.fy,
  });
}

export function useDismissMissingChallan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DismissMissingChallanInput) => http.post('/challans/missing/dismiss', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'missing-list'] }),
  });
}

export function useRestoreMissingChallan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DismissMissingChallanInput) => http.post('/challans/missing/restore', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'missing-list'] }),
  });
}
