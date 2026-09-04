import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MarkReconRowsInput,
  MarkReconRowsResult,
  ReconCreateReceiptInput,
  ReconCreateReceiptResult,
  ReconRunResult,
  ReconRunSummary,
  SaveTallyAliasInput,
  SetTallyLedgerCategoryInput,
  TallyAliasDto,
} from '@oms/shared';
import { api, http } from '@/lib/api';

const KEY = ['tally-recon'] as const;
const RUNS = [...KEY, 'runs'] as const;
const ALIASES = [...KEY, 'aliases'] as const;

/** Past reconciliations, newest first. */
export function useReconRuns() {
  return useQuery({
    queryKey: RUNS,
    queryFn: () => http.get<ReconRunSummary[]>('/tally-recon/runs'),
  });
}

/** One reconciliation's full row set. */
export function useReconRun(id: number | null) {
  return useQuery({
    queryKey: [...RUNS, id],
    queryFn: () => http.get<ReconRunResult>(`/tally-recon/runs/${id}`),
    enabled: id != null,
    placeholderData: (prev) => prev,
  });
}

/**
 * Uploads a register and reconciles it. Progress is reported so a large workbook
 * doesn't look like a hung button.
 */
export function useRunRecon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, onProgress }: { file: File; onProgress?: (pct: number) => void }) => {
      const body = new FormData();
      body.append('file', file);
      const res = await api.post<ReconRunResult>('/tally-recon/runs', body, {
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RUNS });
    },
  });
}

/**
 * Re-reconciles a run in place from the register stored on it.
 *
 * The run keeps its id, so the screen stays on the report the user was reading
 * and simply refetches it. Also invalidates the runs LIST, whose headline
 * counters for this run have just changed.
 */
export function useRerunRecon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.post<ReconRunResult>(`/tally-recon/runs/${id}/rerun`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RUNS });
    },
  });
}

export function useDeleteReconRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete<{ ok: boolean }>(`/tally-recon/runs/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RUNS });
    },
  });
}

export function useTallyAliases() {
  return useQuery({
    queryKey: ALIASES,
    queryFn: () => http.get<TallyAliasDto[]>('/tally-recon/aliases'),
  });
}

export function useSaveTallyAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveTallyAliasInput) => http.post<TallyAliasDto>('/tally-recon/aliases', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ALIASES });
    },
  });
}

/**
 * Files one or more unmapped ledgers as Party / Expense / Other in one request
 * (see SetTallyLedgerCategoryInput) — a whole ticked batch, one save. No cache
 * to invalidate here: unlike an alias there's no separate "list" query for
 * categories, and the RUN's Party/Expense/Other buckets are re-derived from
 * this table fresh on every read regardless, so a plain `refetch()` of the
 * active run (the caller's job — see onSetCategory in tally-recon-page.tsx) is
 * all that's needed to show the new filing. The run's stored KPI counters are
 * a separate snapshot and need an explicit recheck — deliberately NOT done
 * here or automatically: a recheck re-runs the whole comparison (~1s on a
 * large register), and doing that after every save is what made filing 100+
 * ledgers feel slow in the first place.
 */
export function useSetLedgerCategory() {
  return useMutation({
    mutationFn: (input: SetTallyLedgerCategoryInput) => http.post<{ ok: boolean }>('/tally-recon/ledger-category', input),
  });
}

/**
 * Posts the receipts a set of flagged rows describes. The run is refetched
 * afterwards so the rows that were entered flip to matched in place.
 */
export function useCreateReconReceipts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReconCreateReceiptInput) => http.post<ReconCreateReceiptResult>('/tally-recon/receipts', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RUNS });
      // A posted receipt moves the ledgers these screens read from.
      void qc.invalidateQueries({ queryKey: ['party-ledger'] });
      void qc.invalidateQueries({ queryKey: ['payments'] });
      void qc.invalidateQueries({ queryKey: ['daybook'] });
    },
  });
}

/**
 * Marks flagged lines as pending or solved (or clears the mark).
 *
 * Only the run is refetched: a mark annotates the report and posts nothing, so
 * no ledger or payment cache is affected.
 */
export function useMarkReconRows() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MarkReconRowsInput) => http.post<MarkReconRowsResult>('/tally-recon/rows/mark', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RUNS });
    },
  });
}
