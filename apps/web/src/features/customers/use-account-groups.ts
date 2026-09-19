import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountGroupDto,
  AccountGroupInput,
  GroupLedgerDto,
  MoveLedgersInput,
  TallyImportApply,
  TallyImportPreview,
  TallyImportResult,
} from '@oms/shared';
import { api, http } from '@/lib/api';

const KEY = ['account-groups'] as const;

export function useAccountGroups() {
  return useQuery({ queryKey: KEY, queryFn: () => http.get<AccountGroupDto[]>('/account-groups') });
}

export function useGroupLedgers() {
  return useQuery({ queryKey: [...KEY, 'ledgers'], queryFn: () => http.get<GroupLedgerDto[]>('/account-groups/ledgers') });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: ['customers'] });
  };
}

export function useSaveAccountGroup() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, input }: { id?: number; input: AccountGroupInput }) =>
      id ? http.patch<AccountGroupDto>(`/account-groups/${id}`, input) : http.post<AccountGroupDto>('/account-groups', input),
    onSuccess: refresh,
  });
}

export function useDeleteAccountGroup() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: number) => http.delete(`/account-groups/${id}`), onSuccess: refresh });
}

export async function previewTallyMaster(file: File) {
  const body = new FormData();
  body.append('file', file);
  const res = await api.post<TallyImportPreview>('/account-groups/tally-import/preview', body);
  return res.data;
}

export function useApplyTallyImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TallyImportApply) => http.post<TallyImportResult>('/account-groups/tally-import/apply', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: ['tally-recon'] });
      void qc.invalidateQueries({ queryKey: ['party-ledger'] });
    },
  });
}

export function useMoveLedgers() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: MoveLedgersInput) => http.post<{ updated: number }>('/account-groups/ledgers/move', input),
    onSuccess: refresh,
  });
}
