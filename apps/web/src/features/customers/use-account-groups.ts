import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountGroupDto,
  AccountGroupInput,
  CustomerAdditionDto,
  NewPartyOpeningDto,
  TallyLedgerDetails,
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

const ADDITIONS = [...KEY, 'additions'] as const;

export function useAdditions() {
  return useQuery({ queryKey: ADDITIONS, queryFn: () => http.get<CustomerAdditionDto[]>('/account-groups/additions', { params: { status: 'PENDING' } }) });
}

export function useAddition(id: number | null) {
  return useQuery({ queryKey: [...ADDITIONS, id], queryFn: () => http.get<CustomerAdditionDto>(`/account-groups/additions/${id}`), enabled: id != null });
}

export function useAddToList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: { tallyName: string; groupName: string; details?: TallyLedgerDetails }[]) =>
      http.post<CustomerAdditionDto[]>('/account-groups/additions', { items }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADDITIONS }),
  });
}

export function useRemoveFromList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/account-groups/additions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADDITIONS }),
  });
}

export function useMarkAdded() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, customerId }: { id: number; customerId: number }) =>
      http.post<CustomerAdditionDto>(`/account-groups/additions/${id}/added`, { customerId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ADDITIONS });
      void qc.invalidateQueries({ queryKey: NEW_PARTIES });
    },
  });
}

const NEW_PARTIES = ['opening-balances', 'new-parties'] as const;

export function useNewParties() {
  return useQuery({ queryKey: NEW_PARTIES, queryFn: () => http.get<NewPartyOpeningDto[]>('/opening-balances/new-parties') });
}

export function useSettleOpening() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (customerId: number) => http.post(`/opening-balances/new-parties/${customerId}/settle`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: NEW_PARTIES }),
  });
}
