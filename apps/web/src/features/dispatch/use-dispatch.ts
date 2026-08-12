import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDispatchInput,
  DispatchFilterOptions,
  DispatchList,
  DispatchPhotoCheckDto,
  DispatchQuery,
  DraftPhotoCheckInput,
  DraftPhotoCheckResult,
  PendingList,
  PendingQuery,
  SubmitDispatchResult,
  UpdateDispatchInput,
  UpdateDispatchResult,
} from '@oms/shared';
import { downloadFile, getApiErrorMessage, http } from '@/lib/api';

const KEY = ['dispatch'] as const;

/** Download the current pending-dispatch list (with the active filters) as .xlsx.
 *  `columns`, if given, limits the sheet to those column ids (see
 *  `DISPATCH_EXPORT_COLUMNS`) — omitted means every column. */
export function exportPendingDispatch(
  query: Omit<PendingQuery, 'page' | 'pageSize' | 'columns'>,
  columns?: string[],
): Promise<void> {
  const full = { ...query, columns: columns?.length ? columns.join(',') : undefined };
  const entries = Object.entries(full).filter(([, v]) => v != null && v !== '') as [string, string][];
  const qs = new URLSearchParams(entries).toString();
  return downloadFile(`/dispatch/pending/export${qs ? `?${qs}` : ''}`, 'pending-dispatch.xlsx');
}

/** `autoRefresh`: poll every 2s to keep the shop-floor list live — pass `false`
 *  while the caller has a dispatch/edit sheet open on top of it, so a background
 *  refresh can never reset the qty someone is mid-typing (see the two pages'
 *  own `!sheetOpen` argument). Off by default for callers that don't opt in. */
export function usePendingOrders(query: PendingQuery, opts: { autoRefresh?: boolean } = {}) {
  return useQuery({
    queryKey: [...KEY, 'pending', query],
    queryFn: () => http.get<PendingList>('/dispatch/pending', { params: query }),
    // Keep the previous list on screen while a new filter loads (no flash), and
    // treat results as fresh for a short window so re-selecting a filter is instant.
    placeholderData: (prev) => prev,
    staleTime: 15_000,
    refetchInterval: opts.autoRefresh ? 2000 : false,
  });
}

export function useDispatches(query: DispatchQuery, opts: { autoRefresh?: boolean } = {}) {
  return useQuery({
    queryKey: [...KEY, 'list', query],
    queryFn: () => http.get<DispatchList>('/dispatch', { params: query }),
    placeholderData: (prev) => prev,
    refetchInterval: opts.autoRefresh ? 2000 : false,
  });
}

// Only the filter fields matter for the option lists — strip paging so the query
// key doesn't churn on page changes, and cascade off the other active filters.
const optionParams = (q: Record<string, unknown> = {}) => {
  const { page: _p, pageSize: _ps, ...rest } = q;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null && v !== ''));
};

export function useDispatchFilterOptions(query: Partial<DispatchQuery> = {}) {
  const params = optionParams(query);
  return useQuery({
    queryKey: [...KEY, 'filter-options', params],
    queryFn: () => http.get<DispatchFilterOptions>('/dispatch/filter-options', { params }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

/** Claim/renew the editing lock on an order line — rejects (409) with who's
 *  holding it if someone else has the line open. Call on open and again every
 *  ~30s while the sheet/dialog stays open (see useLineLock below). */
export function useAcquireLineLock() {
  return useMutation({
    mutationFn: (orderItemId: number) => http.post<{ ok: true }>(`/dispatch/lock/${orderItemId}`, {}),
  });
}

export function useReleaseLineLock() {
  return useMutation({
    mutationFn: (orderItemId: number) => http.delete(`/dispatch/lock/${orderItemId}`),
  });
}

const LOCK_HEARTBEAT_MS = 30_000;

/**
 * Claims the editing lock on `orderItemId` for as long as the caller stays
 * mounted, renewing it every 30s, and releases it on unmount / when the id
 * changes away. Returns `null` while held (or before an id is given); a
 * message string the moment it's denied — the caller should close its own
 * sheet/dialog and surface that message (see DispatchSheet / EditDispatchDialog).
 * Only the FIRST acquire attempt can be denied — once held, only this same
 * user's own renewals happen, which always succeed.
 */
export function useLineLock(orderItemId: number | null | undefined): string | null {
  const acquire = useAcquireLineLock();
  const release = useReleaseLineLock();
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    if (orderItemId == null) return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    setDenied(null);
    acquire.mutate(orderItemId, {
      onSuccess: () => {
        if (cancelled) return;
        interval = setInterval(() => acquire.mutate(orderItemId), LOCK_HEARTBEAT_MS);
      },
      onError: (e) => {
        if (cancelled) return;
        setDenied(getApiErrorMessage(e, 'This item is being edited by someone else right now.'));
      },
    });
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      release.mutate(orderItemId);
    };
    // Only re-run when the id itself changes — acquire/release mutation objects
    // aren't stable references but their .mutate calls are what we need here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderItemId]);

  return denied;
}

/** Has this party + item + design ever been documented with a reference photo?
 *  Gates the Dispatch form's Save — see DispatchService.photoCheck. */
export function useDispatchPhotoCheck(orderItemId?: number) {
  return useQuery({
    queryKey: [...KEY, 'photo-check', orderItemId],
    queryFn: () => http.get<DispatchPhotoCheckDto>(`/dispatch/photo-check/${orderItemId}`),
    enabled: orderItemId != null,
  });
}

/**
 * The same check for lines that don't exist yet — the New Order form, where
 * "Create & Dispatch" ships them the moment the order is written.
 *
 * Keyed on the lines themselves so it re-runs as the form is built up, and
 * `placeholderData` keeps the previous answers on screen while a new set is in
 * flight — otherwise every keystroke that changes a line would blank the photo
 * indicators and make them flicker.
 */
export function useDraftPhotoCheck(input: DraftPhotoCheckInput, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'photo-check-draft', input],
    queryFn: () => http.post<DraftPhotoCheckResult>('/dispatch/photo-check/draft', input),
    enabled: enabled && input.lines.length > 0,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

/** Distinct customer/agent/product/design values among lines still pending dispatch. */
export function usePendingFilterOptions(query: Partial<PendingQuery> = {}) {
  const params = optionParams(query);
  return useQuery({
    queryKey: [...KEY, 'pending-filter-options', params],
    queryFn: () => http.get<DispatchFilterOptions>('/dispatch/pending-filter-options', { params }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

// Any dispatch change alters what a challan will contain, so also refresh the
// challans caches (the pending list + the staleTime:Infinity challan draft) —
// otherwise an edited/removed quantity reappears from a stale draft. It also
// moves the order's own dispatchState/timeline ('ordered → dispatched →
// challaned'), which the Orders list renders as a badge — so that needs a
// refresh too.
const invalidateDispatch = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ['challans'] });
  qc.invalidateQueries({ queryKey: ['orders'] });
};

/** Either creates the dispatch (dated today, or the user can approve back-dates)
 *  or parks it in the Approvals inbox — see {@link SubmitDispatchResult}. */
export function useCreateDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDispatchInput) => http.post<SubmitDispatchResult>('/dispatch', input),
    onSuccess: (res) => {
      // A parked request doesn't touch Dispatch/Orders/Challans data, so only
      // invalidate when something actually changed.
      if (res.status === 'CREATED') invalidateDispatch(qc);
      else qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}

/** Create & Dispatch: fully dispatch every pending line of a just-created order. */
export function useFulfillOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number) =>
      http.post<{ dispatched: number; skipped: number }>(`/dispatch/fulfill-order/${orderId}`, {}),
    onSuccess: () => invalidateDispatch(qc),
  });
}

/** The edit always applies; see {@link UpdateDispatchResult} for the date-move gate. */
export function useUpdateDispatch(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDispatchInput) => http.patch<UpdateDispatchResult>(`/dispatch/${id}`, input),
    onSuccess: (res) => {
      invalidateDispatch(qc);
      if (res.dateApprovalCode) qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}

export function useDeleteDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/dispatch/${id}`),
    onSuccess: () => invalidateDispatch(qc),
  });
}
