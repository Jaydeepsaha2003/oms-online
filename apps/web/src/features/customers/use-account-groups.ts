import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountGroupDto, AccountGroupInput, GroupLedgerDto, MoveLedgersInput } from '@oms/shared';
import { http } from '@/lib/api';

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

export function useMoveLedgers() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: MoveLedgersInput) => http.post<{ updated: number }>('/account-groups/ledgers/move', input),
    onSuccess: refresh,
  });
}
