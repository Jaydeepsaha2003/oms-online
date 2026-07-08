import { useQuery } from '@tanstack/react-query';
import type { LedgerReceiptLine, PartyLedgerLookups, PartyLedgerQuery, PartyLedgerResult } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['party-ledger'] as const;

export function usePartyLedgerLookups() {
  return useQuery({
    queryKey: [...KEY, 'lookups'],
    queryFn: () => http.get<PartyLedgerLookups>('/party-ledger/lookups'),
    staleTime: 60_000,
  });
}

/** The ledger. `enabled` gates the fetch until the user hits Search. */
export function usePartyLedger(query: PartyLedgerQuery | null) {
  return useQuery({
    queryKey: [...KEY, 'ledger', query],
    queryFn: () => http.get<PartyLedgerResult>('/party-ledger', { params: query! }),
    enabled: query != null,
    placeholderData: (prev) => prev,
  });
}

export function fetchLedgerReceipts(invNo: string): Promise<LedgerReceiptLine[]> {
  return http.get<LedgerReceiptLine[]>('/party-ledger/receipts', { params: { invNo } });
}
