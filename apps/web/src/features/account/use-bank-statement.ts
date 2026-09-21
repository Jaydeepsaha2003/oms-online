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
  BankStatementRecheckResult,
} from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['bank-statement'] as const;

/**
 * The column layout to pre-fill the mapping with: what this bank used last
 * time, or failing that what any statement with THESE columns used last time.
 *
 * The headers are sent raw and pipe-joined; the server decides what counts as
 * the same layout, so that rule lives in one place next to what stores it.
 * Disabled until a file has actually been read — asking with no columns could
 * only ever answer on the bank name, which is the case this exists to cover.
 */
export function useColumnPreset(bankName: string | undefined, columns: readonly string[] = []) {
  const joined = columns.join('|');
  return useQuery({
    queryKey: [...KEY, 'preset', bankName ?? '', joined],
    queryFn: () =>
      http.get<{ map: BankStatementColumnMap | null; from: 'bank' | 'columns' | null }>('/bank-statement/column-preset', {
        params: { bankName: bankName ?? '', columns: joined || undefined },
      }),
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

/**
 * Undo an assignment. Unlike `assign` this also unlearns the narration when
 * asked, so the party does not simply come back on the next statement — and it
 * returns which fragments were forgotten, because that is shared state worth
 * naming to the user rather than doing quietly.
 */
export function useClearBankParty(runId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { rowIds: number[]; forgetAlias: boolean }) =>
      http.post<{ result: BankStatementRunResult; forgotten: string[] }>(`/bank-statement/runs/${runId}/clear-party`, input),
    onSuccess: (res) => {
      qc.setQueryData([...KEY, 'run', runId], res.result);
      qc.invalidateQueries({ queryKey: [...KEY, 'party'] });
      qc.invalidateQueries({ queryKey: [...KEY, 'runs'] });
    },
  });
}

/**
 * Reverse the receipt a returned cheque created. Touches the LEDGER, so it is
 * gated on the payments delete permission server-side — a refusal here is a
 * real answer, not a glitch, and the caller shows it verbatim.
 */
export function useReverseReturned(runId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { rowId: number }) =>
      http.post<{ voucherNo: string; replayedCount: number }>(`/bank-statement/runs/${runId}/reverse-returned`, input),
    onSuccess: () => {
      // The ledger moved underneath several screens, not just this one.
      qc.invalidateQueries({ queryKey: [...KEY] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['party-ledger'] });
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
/**
 * Re-check a run against the ledger as it stands now.
 *
 * Fired when a run is opened, not from a button: a line whose receipt was
 * deleted in Receive Payment sat there claiming POSTED with nothing behind it,
 * and nobody would think to press a button about a problem the screen was not
 * showing them. Idempotent — a run with nothing wrong is left untouched.
 */
export function useRecheckBankRun(runId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http.post<BankStatementRecheckResult>(`/bank-statement/runs/${runId}/recheck`, {}),
    onSuccess: () => {
      // Matching may change coverage in this working and overlapping ones,
      // even when no posted voucher disappeared.
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useProcessBankRun(runId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    // `rowIds` posts only the ticked lines; omitted posts every unmatched one,
    // which is the default this screen has always had.
    mutationFn: (rowIds?: number[]) =>
      http.post<BankStatementProcessResult>(`/bank-statement/runs/${runId}/process`, rowIds?.length ? { rowIds } : {}),
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
