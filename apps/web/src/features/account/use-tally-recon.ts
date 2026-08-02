import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ReconCreateReceiptInput,
  ReconCreateReceiptResult,
  ReconRunResult,
  ReconRunSummary,
  SaveTallyAliasInput,
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
