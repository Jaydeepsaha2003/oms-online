/**
 * Account → Payment (receipt allocation), ported from legacy PaymentForm.vb.
 *
 * A receipt is taken from a PARTY (one customer) or an AGENT (all of the agent's
 * customers), by BANK / CHEQUE / CASH, and adjusted AUTOMATIC (waterfall),
 * ADVANCE (straight to on-account) or AGST REF (only the ticked invoices).
 *
 * Pending is always DERIVED, never stored:
 *  - invoice pending  = challan.b/c − Σ allocated receipts for that invoice
 *  - advance pending  = advance.bankAmt/cashAmt − Σ receipts funded from it
 *  - opening pending  = Σ OPENING DEBIT − Σ CLEARANCE (per customer)
 */
import type { Paginated, PaginationQuery } from './common';

export const PAY_MODES = ['BANK', 'CHEQUE', 'CASH'] as const;
export type PayMode = (typeof PAY_MODES)[number];

export const ADJ_MODES = ['AUTOMATIC', 'ADVANCE', 'AGST REF'] as const;
export type AdjMode = (typeof ADJ_MODES)[number];

export const TAKE_ACC_ON = ['PARTY', 'AGENT'] as const;

/* ── Pending context (what the form shows before saving) ─────────────────── */

export const DUE_TYPES = ['NORMAL', 'PAST DUE', 'OVERDUE'] as const;
export type DueType = (typeof DUE_TYPES)[number];

/** One CONFIRMED challan with money still to receive (InvPendingSummary row). */
export interface PendingInvoiceRow {
  invNo: string;
  invDate: string;
  dueDate: string | null;
  transaction: string;
  customerId: number;
  customerName: string;
  /** challan.b minus bank/cheque receipts allocated to it. */
  bankBal: number;
  /** challan.c minus cash receipts allocated to it. */
  cashBal: number;
  /** Legacy traffic-light: >50% of the credit term left = NORMAL, ≤50% = PAST DUE,
   *  due date crossed = OVERDUE. */
  dueType: DueType;
  /** "12 LEFT" / "TODAY" / "5 OVER" (legacy DUE DAYS text). */
  dueDays: string;
}

/** A CLEARED cheque of the party with un-received balance (CHEQUE pay mode picker). */
export interface ChequeOptionRow {
  chequeNo: string;
  bankName: string | null;
  /** Cheque amount minus receipts already recorded against this cheque no. */
  balance: number;
  comments: string | null;
}

/** One advance (on-account) row with remaining balance (AdvPendingSummary row). */
export interface PendingAdvanceRow {
  refId: string;
  recDate: string;
  customerId: number;
  customerName: string;
  bankBal: number;
  cashBal: number;
  takeAccOn: string | null;
}

/** One party's (or agent's) total outstanding advance across every open advance
 *  voucher they have — the "who's sitting on an advance right now" view. */
export interface PartyAdvanceSummary {
  /** Null for an AGENT-level advance (not tied to one customer). */
  customerId: number | null;
  /** Party name, or the agent's name when takeAccOn === 'AGENT'. */
  customerName: string;
  agentName: string | null;
  /** 'PARTY' | 'AGENT' — who the advance is parked against. */
  takeAccOn: string | null;
  bankBal: number;
  cashBal: number;
  total: number;
  /** Receipt date of the oldest still-outstanding advance voucher (ISO). */
  oldestDate: string;
  /** How many separate advance vouchers are still open. */
  refCount: number;
}

/** A customer's opening pending (OpeningBalSummary row). */
export interface OpeningPendingRow {
  customerId: number;
  customerName: string;
  pendingBank: number;
  pendingCash: number;
}

/** Everything the Payment form needs for one party (or one agent's customers). */
export interface PaymentContext {
  /** PARTY: exactly one entry. AGENT: one per customer of the agent. */
  customers: { customerId: number; customerName: string }[];
  invoices: PendingInvoiceRow[];
  advances: PendingAdvanceRow[];
  openings: OpeningPendingRow[];
  totals: {
    invoiceBank: number;
    invoiceCash: number;
    advanceBank: number;
    advanceCash: number;
    openingBank: number;
    openingCash: number;
  };
}

/* ── Save ─────────────────────────────────────────────────────────────────── */

export interface SavePaymentInput {
  /** PARTY (single customer) or AGENT (loop the agent's customers). */
  takeAccOn: string;
  customerId?: number | null;
  agentName?: string | null;
  payMode: string;
  /** BANK/CHEQUE: our receiving bank account display name. */
  bankName?: string | null;
  /** CHEQUE only. */
  chequeNo?: string | null;
  /** CASH only. */
  cashTransLocation?: string | null;
  cashRecBy?: string | null;
  adjMode: string;
  /** AGST REF: allocate ONLY to these invoice numbers (in the given order). */
  selectedInvNos?: string[];
  /** Receipt amount (goes to the bank bucket for BANK/CHEQUE, cash for CASH). */
  receiptAmt: number;
  /** Receipt / deposit date (yyyy-mm-dd, not in the future). */
  recDate: string;
  remarks?: string | null;
}

/** One allocation the engine performed (for the result summary + audit). */
export interface PaymentAllocation {
  kind: 'OPENING' | 'INVOICE' | 'ADVANCE_SPILL';
  customerName: string;
  /** Invoice no for INVOICE rows. */
  invNo?: string;
  /** Where the money came from: the fresh voucher or an old advance REF ID. */
  fundedBy: string;
  modeOfAdj: string;
  amount: number;
}

export interface SavePaymentResult {
  voucherNo: string;
  receiptRefId: string;
  /** REF ID of the spill-over advance row, when one was created. */
  advanceRefId: string | null;
  allocations: PaymentAllocation[];
  /** Portion cleared against openings / invoices / left on account. */
  openingCleared: number;
  invoicesCleared: number;
  advanceParked: number;
}

/* ── Ledger listing (voucher history) ─────────────────────────────────────── */

export interface LedgerEntryDto {
  id: number;
  voucherNo: string;
  transDate: string;
  customerName: string;
  customerId: number;
  agentName: string | null;
  particulars: string | null;
  voucherType: string;
  transMode: string;
  bankCredit: number;
  cashCredit: number;
  transRemarks: string | null;
  userName: string | null;
  createdAt: string;
}

export type LedgerQuery = PaginationQuery & {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};
export type LedgerList = Paginated<LedgerEntryDto>;
