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
  PendingChallanFilterOptions,
  PendingChallanList,
  PendingChallanQuery,
  UpdateChallanStatusInput,
} from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['challans'] as const;

// A challan create/edit/status-change/delete moves an order along the
// "ordered → dispatched → challaned" timeline (OrderTimeline / OrderDto.dispatchState),
// and the Orders list renders that state as a badge — so it needs to hear about
// this too, not just the challans caches. Mirrors invalidateDispatch's reasoning
// in use-dispatch.ts for the same kind of cross-feature effect.
const invalidateChallans = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ['orders'] });
};

/**
 * Dispatch lines still awaiting a challan, with search + date-range filters.
 *
 * Same "never trust a cached snapshot" contract as {@link useChallanDraft}, and
 * for the same reason: each row carries the GST/Freight/Packing rate resolved
 * from the master tables (that's what drives the unpriced-line badges), and
 * those masters can be edited at any time from another screen. On the global
 * 30s staleTime this page would open onto a snapshot taken before the edit and
 * still show "No GST rate" for a party that now has one — while Create Challan,
 * which already opts in here, showed the correct rate. Two screens disagreeing
 * about the same party is worse than a slightly slower load.
 *
 * `refetchOnMount: 'always'` also keeps this OUT of the persisted localStorage
 * cache (see `shouldDehydrateQuery` in lib/query.ts), so a cold reload can't
 * rehydrate stale badges either. `placeholderData` keeps the previous rows on
 * screen while the refetch runs, so landing here still paints instantly.
 */
export function usePendingChallans(query: PendingChallanQuery, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...KEY, 'pending', query],
    queryFn: () => http.get<PendingChallanList>('/challans/pending', { params: query }),
    placeholderData: (prev) => prev,
    enabled: opts?.enabled ?? true,
    staleTime: 0,
    refetchOnMount: 'always',
    // Belt and braces behind the live `challans:pending-changed` socket ping: a
    // phone that was asleep, or a PC whose socket dropped, misses the broadcast
    // entirely and would otherwise sit on a list that no longer exists. Coming
    // back to the tab or regaining the network re-fetches on its own.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/**
 * Refresh every challan cache that embeds master-rate data.
 *
 * Pending Challan and the Create/Edit draft carry the GST/Freight/Packing rate
 * resolved from the rate masters, so editing those masters must refresh these
 * too — otherwise Pending Challan keeps flagging a party that now has rates.
 *
 * Exported so the gst-rates / trans-rates features call one shared function
 * instead of each restating this dependency. Mirrors `invalidateDispatch`.
 */
export function invalidateChallanRateDependants(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: KEY });
  // Pending Challan is usually NOT mounted while rates are being edited, and a
  // plain invalidate only marks an inactive query stale rather than refetching
  // it. Pull it now (`type: 'all'` covers inactive queries) so the rows are
  // already correct the moment the user navigates over, instead of correcting
  // themselves a beat after the page paints.
  void qc.refetchQueries({ queryKey: [...KEY, 'pending'], type: 'all' });
}

/** Customer / product / design options for the Pending Challan filter bar. Only
 *  values that currently have un-challaned lines, so no choice returns nothing. */
export function usePendingChallanFilters() {
  return useQuery({
    queryKey: [...KEY, 'pending-filters'],
    queryFn: () => http.get<PendingChallanFilterOptions>('/challans/pending-filters'),
    staleTime: 60_000,
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

/**
 * Build a priced challan draft from the selected dispatch lines (one customer).
 *
 * `staleTime: Infinity` means this is never spontaneously refetched — it only
 * updates when something calls `invalidateQueries`. That's fine while the form
 * stays mounted, but "Create Challan" opens this fresh every time straight after
 * a dispatch was just recorded (Dispatch → Pending Challan → Create Challan, all
 * in a few seconds). If that dispatch also happened to touch a customer whose
 * draft was already sitting in the cache from earlier in the session — e.g. the
 * page cache the app persists to localStorage across reloads — this screen could
 * open onto that older snapshot instead of a real network round-trip, and only a
 * second visit (after the invalidation from the dispatch mutation had time to
 * mark it stale) would show the new item. `refetchOnMount: 'always'` removes the
 * ambiguity entirely: opening Create Challan ALWAYS hits the server, regardless
 * of anything already sitting in the cache.
 */
export function useChallanDraft(input: DraftChallanInput | null) {
  return useQuery({
    queryKey: [...KEY, 'draft', input?.customerName, input?.dispatchIds],
    queryFn: () => http.post<ChallanDraft>('/challans/draft', input),
    enabled: !!input?.customerName,
    staleTime: Infinity,
    refetchOnMount: 'always',
  });
}

/** Persist the challan (header totals + items). */
export function useCreateChallan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChallanInput) => http.post<ChallanDto>('/challans', input),
    onSuccess: () => invalidateChallans(qc),
  });
}

/** A single saved challan (Print / PDF bill page). */
export function useChallan(id?: number) {
  return useQuery({
    queryKey: [...KEY, id],
    queryFn: () => http.get<ChallanDto>(`/challans/${id}`),
    enabled: id != null,
  });
}

/** Load a saved challan for editing (stored header + lines + the customer's add-more pool).
 *  Same reasoning as {@link useChallanDraft}: opening an edit should always be a
 *  real fetch, not a possibly-stale cache hit. */
export function useChallanEdit(id: number | null) {
  return useQuery({
    queryKey: [...KEY, 'edit', id],
    queryFn: () => http.get<ChallanEditContext>(`/challans/${id}/edit`),
    enabled: id != null,
    staleTime: Infinity,
    refetchOnMount: 'always',
  });
}

/** Replace a saved challan (invoice no preserved). */
export function useUpdateChallan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & CreateChallanInput) => http.put<ChallanDto>(`/challans/${id}`, input),
    onSuccess: () => invalidateChallans(qc),
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
    onSuccess: () => invalidateChallans(qc),
  });
}

export function useDeleteChallan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete<{ id: number }>(`/challans/${id}`),
    onSuccess: () => invalidateChallans(qc),
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
