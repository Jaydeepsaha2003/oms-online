import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BulkSpecialCommissionInput,
  BulkSpecialCommissionResult,
  AgentCommissionAccrualList,
  AgentCommissionRateDto,
  AgentCommissionRateInput,
  AgentPartyCoverDto,
  AgentPartyCoverInput,
  AgentRateCoverageRow,
  AgentSettlementDto,
  AgentSettlementInput,
  AgentSettlementPreview,
  BankBounceChargeDto,
  BankBounceChargeInput,
  ChequeBounceEventDto,
  ChequeBounceEventInput,
  ChequeTimingDto,
  AgentSpecialCommissionDto,
  AgentSpecialCommissionInput,
  ResolvedCommissionRate,
  RepriceResult,
} from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['agent-commission'] as const;

/* ── Rate master ────────────────────────────────────────────────────────── */

export function useCommissionRates(agentId?: number) {
  return useQuery({
    queryKey: [...KEY, 'rates', agentId ?? 'all'],
    queryFn: () => http.get<AgentCommissionRateDto[]>('/agent-commission/rates', { params: { agentId } }),
    staleTime: 30_000,
  });
}

/** The agent × category grid, including the categories nobody has priced. */
export function useRateCoverage() {
  return useQuery({
    queryKey: [...KEY, 'rates', 'coverage'],
    queryFn: () => http.get<AgentRateCoverageRow[]>('/agent-commission/rates/coverage'),
    staleTime: 30_000,
  });
}

export function useCreateCommissionRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentCommissionRateInput) =>
      http.post<AgentCommissionRateDto & { repriced: RepriceResult }>('/agent-commission/rates', input),
    // A new rate changes what invoices are worth, so the accrual/preview views
    // must not keep showing figures priced on the old one.
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteCommissionRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete<{ repriced: RepriceResult }>(`/agent-commission/rates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/* ── Accruals ───────────────────────────────────────────────────────────── */

export function useCommissionAccruals(q: {
  agentId?: number;
  customerId?: number;
  pCategory?: string;
  dateFrom?: string;
  dateTo?: string;
  settledState?: string;
  page: number;
  pageSize: number;
}) {
  return useQuery({
    queryKey: [...KEY, 'accruals', q],
    queryFn: () => http.get<AgentCommissionAccrualList>('/agent-commission/accruals', { params: q }),
    placeholderData: (prev) => prev,
  });
}

/** Re-price every confirmed invoice. Needed once after the rate master is first
 *  filled in, since invoices raised before it existed never accrued. */
export function useBackfillAccruals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { dateFrom?: string; dateTo?: string }) =>
      http.post<{ challans: number; accruals: number }>('/agent-commission/accruals/backfill', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/* ── Covers ─────────────────────────────────────────────────────────────── */

export function useAgentCovers(agentId?: number, status?: string) {
  return useQuery({
    queryKey: [...KEY, 'covers', agentId ?? 'all', status ?? 'all'],
    queryFn: () => http.get<AgentPartyCoverDto[]>('/agent-commission/covers', { params: { agentId, status } }),
  });
}

export function useCreateCover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentPartyCoverInput) => http.post<AgentPartyCoverDto>('/agent-commission/covers', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRecoverCover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, via }: { id: number; via?: string }) =>
      http.post<AgentPartyCoverDto>(`/agent-commission/covers/${id}/recover`, { via }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/* ── Cheque bounce ──────────────────────────────────────────────────────── */

export function useBankBounceCharges() {
  return useQuery({
    queryKey: [...KEY, 'bank-charges'],
    queryFn: () => http.get<BankBounceChargeDto[]>('/agent-commission/bank-charges'),
    staleTime: 60_000,
  });
}

export function useSaveBankBounceCharge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BankBounceChargeInput) => http.post<BankBounceChargeDto>('/agent-commission/bank-charges', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useChequeBounces(chequeId?: number, agentId?: number) {
  return useQuery({
    queryKey: [...KEY, 'bounces', chequeId ?? 'all', agentId ?? 'all'],
    queryFn: () => http.get<ChequeBounceEventDto[]>('/agent-commission/bounces', { params: { chequeId, agentId } }),
    enabled: chequeId != null || agentId != null,
  });
}

export function useCreateBounce() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ChequeBounceEventInput) => http.post<ChequeBounceEventDto>('/agent-commission/bounces', input),
    // A bounce flips the cheque's status too, so the cheque screens must refetch.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['cheques'] });
    },
  });
}

export function useDeleteBounce() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete<void>(`/agent-commission/bounces/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/* ── Settlement ─────────────────────────────────────────────────────────── */

/** What the settlement would be — computed live, nothing written. */
/* ── Cheque timing (§7) ─────────────────────────────────────────────────── */

/**
 * Is a cheque dated later than the party's money was due? Asked while the
 * cheque is still being typed, so `chequeId` is 0 and nothing is saved.
 * Debounce is handled by the caller passing a settled date/amount.
 */
export function useChequeTiming(
  q: { customerId?: number; partyName?: string; chequeDate: string; chequeAmount: number; invoiceNos?: string[]; agentName?: string | null },
  enabled = true,
) {
  return useQuery({
    queryKey: [...KEY, 'cheque-timing', q.customerId ?? q.partyName ?? '', q.chequeDate, q.chequeAmount, (q.invoiceNos ?? []).join(',')],
    queryFn: () =>
      http.get<ChequeTimingDto>('/agent-commission/cheque-timing', {
        params: {
          customerId: q.customerId,
          partyName: q.customerId ? undefined : q.partyName,
          chequeDate: q.chequeDate,
          chequeAmount: q.chequeAmount,
          agentName: q.agentName || undefined,
          invoiceNos: q.invoiceNos?.length ? q.invoiceNos : undefined,
        },
      }),
    enabled: enabled && !!(q.customerId || q.partyName) && !!q.chequeDate && q.chequeAmount > 0,
    staleTime: 30_000,
  });
}

/** The same analysis for a cheque already on file. */
export function useChequeTimingFor(chequeId?: number) {
  return useQuery({
    queryKey: [...KEY, 'cheque-timing', 'saved', chequeId],
    queryFn: () => http.get<ChequeTimingDto>(`/agent-commission/cheque-timing/${chequeId}`),
    enabled: !!chequeId,
    staleTime: 30_000,
  });
}

export function useSettlementPreview(agentId: number | undefined, periodFrom: string, periodTo: string) {
  return useQuery({
    queryKey: [...KEY, 'preview', agentId, periodFrom, periodTo],
    queryFn: () =>
      http.get<AgentSettlementPreview>('/agent-commission/settlements/preview', {
        params: { agentId, periodFrom, periodTo },
      }),
    enabled: agentId != null && !!periodFrom && !!periodTo,
  });
}

export function useSettlements(agentId?: number, status?: string) {
  return useQuery({
    queryKey: [...KEY, 'settlements', agentId ?? 'all', status ?? 'all'],
    queryFn: () => http.get<AgentSettlementDto[]>('/agent-commission/settlements', { params: { agentId, status } }),
  });
}

export function useSettlement(id?: number) {
  return useQuery({
    queryKey: [...KEY, 'settlement', id],
    queryFn: () => http.get<AgentSettlementDto>(`/agent-commission/settlements/${id}`),
    enabled: id != null,
  });
}

export function useCreateSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentSettlementInput) => http.post<AgentSettlementDto>('/agent-commission/settlements', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function usePaySettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payMode, tdsPercent, paidAt, remarks }: { id: number; payMode: string; tdsPercent?: number; paidAt?: string; remarks?: string }) =>
      http.post<AgentSettlementDto>(`/agent-commission/settlements/${id}/pay`, { payMode, tdsPercent, paidAt, remarks }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCancelSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.post<void>(`/agent-commission/settlements/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/* ── Special Commission (per party / category / product / design) ────────── */

export function useSpecialCommissions(agentId?: number) {
  return useQuery({
    queryKey: [...KEY, 'specials', agentId ?? 'all'],
    queryFn: () => http.get<AgentSpecialCommissionDto[]>('/agent-commission/rates/special', { params: { agentId } }),
    staleTime: 30_000,
  });
}

export function useCreateSpecialCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentSpecialCommissionInput) =>
      http.post<AgentSpecialCommissionDto & { repriced: RepriceResult }>('/agent-commission/rates/special', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** The same special rule for several parties — one request, one re-price. */
export function useCreateSpecialCommissionBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkSpecialCommissionInput) =>
      http.post<BulkSpecialCommissionResult>('/agent-commission/rates/special/bulk', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteSpecialCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete<{ repriced: RepriceResult }>(`/agent-commission/rates/special/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * "What rate would apply here?" — answered by the server's own resolver, never
 * re-implemented here. A tester that disagreed with the money would be worse
 * than no tester.
 */
export function useTestCommissionRate(q: {
  agentId?: number;
  customerId?: number | null;
  pCategory?: string | null;
  subCategory?: string | null;
  product?: string | null;
  designType?: string | null;
}) {
  const enabled = q.agentId != null;
  return useQuery({
    queryKey: [...KEY, 'rate-test', q],
    queryFn: () =>
      http.get<ResolvedCommissionRate | null>('/agent-commission/rates/special/test', {
        params: Object.fromEntries(Object.entries(q).filter(([, v]) => v != null && v !== '')),
      }),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/**
 * How many invoices a rate dated X would price, and how many older ones it
 * would leave alone. Drives the dialog's "prices N invoices" line and the
 * sensible default date for a first rate.
 */
export function useRateImpact(q: { agentId?: number; pCategory?: string; effectiveFrom?: string }) {
  const enabled = q.agentId != null && !!q.pCategory;
  return useQuery({
    queryKey: [...KEY, 'rate-impact', q],
    queryFn: () =>
      http.get<{ onOrAfter: number; before: number; earliestInvDate: string | null }>('/agent-commission/rates/impact', {
        params: Object.fromEntries(Object.entries(q).filter(([, v]) => v != null && v !== '')),
      }),
    enabled,
    staleTime: 30_000,
  });
}
