import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BankAccountDto,
  BankAccountInput,
  BankAccountList,
  BankAccountQuery,
  ChequeDto,
  ChequeList,
  ChequeOptionRow,
  ChequeQuery,
  ChequeSummary,
  CreateChequeInput,
  DepositChequeInput,
  DiscountDto,
  DiscountHistoryList,
  DiscountInvoiceList,
  DiscountInvoiceQuery,
  LedgerList,
  OpeningBalanceDto,
  OpeningBalanceInput,
  OpeningBalanceList,
  OpeningBalanceQuery,
  PaymentContext,
  SaveDiscountInput,
  SaveDiscountResult,
  SavePaymentInput,
  SavePaymentResult,
  SettleChequeInput,
} from '@oms/shared';
import { http } from '@/lib/api';

/* ── Bank accounts ────────────────────────────────────────────────────────── */

const BANK_KEY = ['bank-accounts'] as const;

export function useBankAccounts(query: BankAccountQuery) {
  return useQuery({
    queryKey: [...BANK_KEY, query],
    queryFn: () => http.get<BankAccountList>('/bank-accounts', { params: query }),
    placeholderData: (prev) => prev,
  });
}

/** Active accounts for the cheque form's deposit-bank picker. */
export function useActiveBankAccounts() {
  return useQuery({
    queryKey: [...BANK_KEY, 'active'],
    queryFn: () => http.get<BankAccountDto[]>('/bank-accounts/active'),
    staleTime: 60_000,
  });
}

export function useCreateBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BankAccountInput) => http.post<BankAccountDto>('/bank-accounts', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: BANK_KEY }),
  });
}

export function useUpdateBankAccount(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BankAccountInput) => http.patch<BankAccountDto>(`/bank-accounts/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: BANK_KEY }),
  });
}

export function useDeleteBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/bank-accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: BANK_KEY }),
  });
}

/* ── Cheques ──────────────────────────────────────────────────────────────── */

const CHEQUE_KEY = ['cheques'] as const;

export function useCheques(query: ChequeQuery) {
  return useQuery({
    queryKey: [...CHEQUE_KEY, 'list', query],
    queryFn: () => http.get<ChequeList>('/cheques', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useChequeSummary() {
  return useQuery({
    queryKey: [...CHEQUE_KEY, 'summary'],
    queryFn: () => http.get<ChequeSummary>('/cheques/summary'),
    placeholderData: (prev) => prev,
  });
}

/** PENDING cheques, soonest-due first — the reminder cards. */
export function useChequeReminders() {
  return useQuery({
    queryKey: [...CHEQUE_KEY, 'reminders'],
    queryFn: () => http.get<ChequeDto[]>('/cheques/reminders'),
    placeholderData: (prev) => prev,
  });
}

/** DEPOSITED cheques — the clear/bounce picker. */
export function useDepositedCheques() {
  return useQuery({
    queryKey: [...CHEQUE_KEY, 'deposited'],
    queryFn: () => http.get<ChequeDto[]>('/cheques/deposited'),
    placeholderData: (prev) => prev,
  });
}

/** Invalidate everything cheque-related after a mutation. */
function useInvalidateCheques() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: CHEQUE_KEY });
}

export function useCreateCheque() {
  const invalidate = useInvalidateCheques();
  return useMutation({
    mutationFn: (input: CreateChequeInput) => http.post<ChequeDto>('/cheques', input),
    onSuccess: invalidate,
  });
}

export function useDepositCheque() {
  const invalidate = useInvalidateCheques();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: DepositChequeInput }) => http.post<ChequeDto>(`/cheques/${id}/deposit`, input),
    onSuccess: invalidate,
  });
}

export function useSettleCheque() {
  const invalidate = useInvalidateCheques();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: SettleChequeInput }) => http.post<ChequeDto>(`/cheques/${id}/settle`, input),
    onSuccess: invalidate,
  });
}

export function useDeleteCheque() {
  const invalidate = useInvalidateCheques();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/cheques/${id}`),
    onSuccess: invalidate,
  });
}

/* ── Opening balances ─────────────────────────────────────────────────────── */

const OPENING_KEY = ['opening-balances'] as const;

export function useOpeningBalances(query: OpeningBalanceQuery) {
  return useQuery({
    queryKey: [...OPENING_KEY, query],
    queryFn: () => http.get<OpeningBalanceList>('/opening-balances', { params: query }),
    placeholderData: (prev) => prev,
  });
}

export function useCreateOpeningBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OpeningBalanceInput) => http.post<OpeningBalanceDto>('/opening-balances', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: OPENING_KEY }),
  });
}

export function useUpdateOpeningBalance(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OpeningBalanceInput) => http.patch<OpeningBalanceDto>(`/opening-balances/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: OPENING_KEY }),
  });
}

export function useDeleteOpeningBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/opening-balances/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: OPENING_KEY }),
  });
}

/* ── Payments (receipt allocation) ────────────────────────────────────────── */

const PAYMENT_KEY = ['payments'] as const;

/** Pending invoices + advances + openings for the chosen party or agent. */
export function usePaymentContext(q: { customerId?: number; agentName?: string; recDate?: string }, enabled = true) {
  return useQuery({
    queryKey: [...PAYMENT_KEY, 'context', q],
    queryFn: () => http.get<PaymentContext>('/payments/context', { params: q }),
    enabled: enabled && (q.customerId != null || !!q.agentName),
    placeholderData: (prev) => prev,
    retry: false,
  });
}

/** CLEARED cheques of the party with un-received balance (CHEQUE mode picker). */
export function useChequeOptions(customerId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: [...PAYMENT_KEY, 'cheque-options', customerId],
    queryFn: () => http.get<ChequeOptionRow[]>('/payments/cheque-options', { params: { customerId } }),
    enabled: enabled && customerId != null,
  });
}

/** Receipt Ledger browser (voucher history for a party / agent). */
export function usePaymentLedger(q: { customerId?: number; agentName?: string; dateFrom?: string; dateTo?: string; page: number; pageSize: number }, enabled = true) {
  return useQuery({
    queryKey: [...PAYMENT_KEY, 'ledger', q],
    queryFn: () => http.get<LedgerList>('/payments/ledger', { params: q }),
    enabled: enabled && (q.customerId != null || !!q.agentName),
    placeholderData: (prev) => prev,
  });
}

export function useSavePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SavePaymentInput) => http.post<SavePaymentResult>('/payments', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: PAYMENT_KEY }),
  });
}

/* ── Sales discount ───────────────────────────────────────────────────────── */

const DISCOUNT_KEY = ['discounts'] as const;

/** Pending-invoice grid (bank & cash amount / discount / received / balance). */
export function useDiscountInvoices(q: DiscountInvoiceQuery) {
  return useQuery({
    queryKey: [...DISCOUNT_KEY, 'invoices', q],
    queryFn: () => http.get<DiscountInvoiceList>('/discounts/invoices', { params: q }),
    placeholderData: (prev) => prev,
  });
}

/** Saved discounts for one invoice (per-invoice history). */
export function useDiscountHistory(invNo: string | null) {
  return useQuery({
    queryKey: [...DISCOUNT_KEY, 'history', invNo],
    queryFn: () => http.get<DiscountHistoryList>('/discounts/history', { params: { invNo, pageSize: 100 } }),
    enabled: !!invNo,
    placeholderData: (prev) => prev,
  });
}

/** After any discount change, refresh both discount + payment caches (pending shifts). */
function useInvalidateDiscounts() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: DISCOUNT_KEY });
    qc.invalidateQueries({ queryKey: PAYMENT_KEY });
  };
}

export function useSaveDiscount() {
  const invalidate = useInvalidateDiscounts();
  return useMutation({
    mutationFn: (input: SaveDiscountInput) => http.post<SaveDiscountResult>('/discounts', input),
    onSuccess: invalidate,
  });
}

export function useUpdateDiscount() {
  const invalidate = useInvalidateDiscounts();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & SaveDiscountInput) => http.put<SaveDiscountResult>(`/discounts/${id}`, input),
    onSuccess: invalidate,
  });
}

export function useDeleteDiscount() {
  const invalidate = useInvalidateDiscounts();
  return useMutation({
    mutationFn: (id: number) => http.delete<{ id: number }>(`/discounts/${id}`),
    onSuccess: invalidate,
  });
}

export type { DiscountDto };
