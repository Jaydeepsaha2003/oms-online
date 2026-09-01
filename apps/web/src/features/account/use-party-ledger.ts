import { useQuery } from '@tanstack/react-query';
import type {
  LedgerClearedResult, LedgerReceiptLine, PartyLedgerLookups, PartyLedgerQuery, PartyLedgerResult } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['party-ledger'] as const;

export function usePartyLedgerLookups() {
  return useQuery({
    queryKey: [...KEY, 'lookups'],
    queryFn: () => http.get<PartyLedgerLookups>('/party-ledger/lookups'),
    staleTime: 60_000,
  });
}

/** The ledger refreshes whenever a filter changes. */
export function usePartyLedger(query: PartyLedgerQuery | null) {
  return useQuery({
    queryKey: [...KEY, 'ledger', query],
    queryFn: () => http.get<PartyLedgerResult>('/party-ledger', { params: query! }),
    enabled: query != null,
    placeholderData: (prev) => prev,
  });
}

/** What a receipt voucher cleared: which parties' invoices, and what it parked. */
export function fetchLedgerCleared(voucherNo: string): Promise<LedgerClearedResult> {
  return http.get<LedgerClearedResult>('/party-ledger/cleared', { params: { voucherNo } });
}

/** `mode` mirrors the grid's Bank/Cash toggle so the dialog cannot show payments
 *  from the side the user is not looking at. */
export function fetchLedgerReceipts(invNo: string, mode?: string): Promise<LedgerReceiptLine[]> {
  return http.get<LedgerReceiptLine[]>('/party-ledger/receipts', { params: { invNo, mode } });
}
