import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BankPartyPreview,
  BankStatementAssignInput,
  BankStatementColumnMap,
  BankStatementCreateInput,
  BankStatementCreateResponse,
  BankStatementProcessResult,
  BankStatementRunList,
  BankStatementRunResult,
} from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['bank-statement'] as const;

/** The column layout last used for this bank account, to pre-fill the mapping. */
export function useColumnPreset(bankName: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'preset', bankName ?? ''],
    queryFn: () => http.get<{ map: BankStatementColumnMap | null }>('/bank-statement/column-preset', { params: { bankName: bankName ?? '' } }),
    staleTime: 0,
  });
}

/** Saved workings, newest first. */
export function useBankRuns(page = 1, pageSize = 25) {
  return useQuery({
    queryKey: [...KEY, 'runs', page, pageSize],
    queryFn: () => http.get<BankStatementRunList>('/bank-statement/runs', { params: { page, pageSize } }),
  });
}

/** One working, with its lines. */
export function useBankRun(id: number | undefined) {
  return useQuery({
    queryKey: [...KEY, 'run', id],
    queryFn: () => http.get<BankStatementRunResult>(`/bank-statement/runs/${id}`),
    enabled: id != null,
  });
}

/** The selected party's before/after. */
export function useBankParty(runId: number | undefined, customerId: number | undefined) {
  return useQuery({
    queryKey: [...KEY, 'party', runId, customerId],
    queryFn: () => http.get<BankPartyPreview>(`/bank-statement/runs/${runId}/party/${customerId}`),
    enabled: runId != null && customerId != null,
  });
}

export function useCreateBankRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BankStatementCreateInput) => http.post<BankStatementCreateResponse>('/bank-statement/runs', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * Assigning a party IS the auto-save: the server writes it to the row and hands
 * back the whole re-matched working, so the screen never holds an edit that
 * isn't already persisted.
 */
export function useAssignBankRows(runId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BankStatementAssignInput) => http.post<BankStatementRunResult>(`/bank-statement/runs/${runId}/assign`, input),
    onSuccess: (res) => {
      qc.setQueryData([...KEY, 'run', runId], res);
      qc.invalidateQueries({ queryKey: [...KEY, 'party'] });
      qc.invalidateQueries({ queryKey: [...KEY, 'runs'] });
    },
  });
}

export function useIgnoreBankRows(runId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { rowIds: number[]; ignored: boolean }) => http.post<BankStatementRunResult>(`/bank-statement/runs/${runId}/ignore`, input),
    onSuccess: (res) => {
      qc.setQueryData([...KEY, 'run', runId], res);
      qc.invalidateQueries({ queryKey: [...KEY, 'party'] });
      qc.invalidateQueries({ queryKey: [...KEY, 'runs'] });
    },
  });
}

/** The one call that reaches the ledger. */
export function useProcessBankRun(runId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http.post<BankStatementProcessResult>(`/bank-statement/runs/${runId}/process`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      // Receipts were created, so anything that reads the ledger is now stale.
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['party-ledger'] });
    },
  });
}

export function useDeleteBankRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete<{ ok: boolean }>(`/bank-statement/runs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
