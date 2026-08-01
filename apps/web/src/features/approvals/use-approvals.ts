import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApprovalDecisionInput, ApprovalListResult, ApprovalQuery, ApprovalRequestDto } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['approvals'] as const;

export function useApprovals(query: ApprovalQuery) {
  return useQuery({
    queryKey: [...KEY, 'list', query],
    queryFn: () => http.get<ApprovalListResult>('/approvals', { params: query }),
    placeholderData: (prev) => prev,
  });
}

/** Pending badge count — cheap enough for the sidebar to poll. */
export function usePendingApprovalCount(enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'count'],
    queryFn: () => http.get<{ pending: number }>('/approvals/count'),
    enabled,
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

const invalidateApprovals = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY });
  // Approving a dispatch back-entry creates real Dispatch/Order/Challan data.
  qc.invalidateQueries({ queryKey: ['dispatch'] });
  qc.invalidateQueries({ queryKey: ['orders'] });
  qc.invalidateQueries({ queryKey: ['challans'] });
};

export function useApproveRequest(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApprovalDecisionInput) => http.post<ApprovalRequestDto>(`/approvals/${id}/approve`, input),
    onSuccess: () => invalidateApprovals(qc),
  });
}

export function useRejectRequest(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApprovalDecisionInput) => http.post<ApprovalRequestDto>(`/approvals/${id}/reject`, input),
    onSuccess: () => invalidateApprovals(qc),
  });
}

export function useDeleteApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/approvals/${id}`),
    onSuccess: () => invalidateApprovals(qc),
  });
}
