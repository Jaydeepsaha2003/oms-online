/**
 * Party Ledger / Trial Balance — ported from legacy "Party Ledger Account.vb".
 *
 * A Tally/Busy-style running statement for one party (or an agent's parties, or
 * everyone). Rows are the UNION of sale invoices (Challan, excluding Debit Notes)
 * as debits and every AcctLedger voucher (RECEIPT / DEBIT NOTE / CREDIT NOTE /
 * SALES DISCOUNT) with its bank/cash debit & credit — ordered by date. The screen
 * also shows the opening balance as-of the From date, a running Current total and
 * the Closing balance, plus aging KPIs (Over / Past / Normal due, oldest unpaid,
 * and a Payment-behaviour grade).
 */

export const LEDGER_TXN_MODES = ['BOTH', 'B', 'C'] as const;
/** BOTH = bank+cash, B = bank only, C = cash only. */
export type LedgerTxnMode = (typeof LEDGER_TXN_MODES)[number];

/** Per-invoice settlement status shown as a one-letter chip. */
export type LedgerRowStatus = '' | 'D' | 'P' | 'F'; // Due / Partial / Fully paid

export interface PartyLedgerRow {
  txnDate: string; // ISO
  particulars: string;
  customerName: string;
  voucherType: string; // SALES INVOICE | DEBIT NOTE | CREDIT NOTE | RECEIPT | SALES DISCOUNT
  voucherNo: string;
  /** The underlying Challan's id — set for SALES INVOICE / DEBIT NOTE rows (both are
   *  backed by a Challan record), so the UI can open/view the actual document. */
  challanId?: number | null;
  /** "12 Left" / "3 Over" / "Due Today" / "5 Early" / "On Time" / "2 Late" / "". */
  dueFrom: string;
  status: LedgerRowStatus;
  bankDr: number;
  bankCr: number;
  cashDr: number;
  cashCr: number;
  /** Due date (ISO) for invoice rows, else null. */
  dueDate: string | null;
}

/** One side of the footer (a Dr/Cr split of a net balance). */
export interface LedgerBalanceRow {
  bankDr: number;
  bankCr: number;
  cashDr: number;
  cashCr: number;
}

export interface PartyLedgerFooter {
  opening: LedgerBalanceRow;
  current: LedgerBalanceRow;
  closing: LedgerBalanceRow;
  /** Signed nets (+ = Debit / party owes us, − = Credit). */
  openingBankNet: number;
  openingCashNet: number;
  closingBankNet: number;
  closingCashNet: number;
}

/** A party's Party-Lists standing, as reported by the Payment DNA KPI. */
export type PartyListStanding = 'GREEN' | 'BLACK' | 'CUSTOM' | 'NONE';

/** An aging bucket — total amount + how many invoices. */
export interface LedgerDueBucket {
  amount: number;
  count: number;
}

export interface PartyLedgerKpis {
  /**
   * The party's oldest still-unpaid invoice — "dd-mm-yyyy (INV NO)", with the
   * party name appended when the ledger spans more than one party, or
   * "No Due Invoice". Computed from the whole open-invoice position, NOT just the
   * vouchers inside the selected period, so an older unpaid bill from a previous
   * year can't hide behind the date filter.
   */
  invDueFrom: string;
  /**
   * The party's standing on the CRM Party Lists (Green-listed = trusted payer,
   * Black-listed = payment risk). For a multi-party ledger this is a tally
   * ("3 Green · 2 Black"). Falls back to "Unlisted" when no list matches.
   */
  paymentDNA: string;
  /** Which bucket {@link paymentDNA} reports, so the UI can colour it. For a
   *  multi-party tally this is the dominant signal (BLACK outranks GREEN). */
  paymentDNAKind: PartyListStanding;
  /** Past the due date. */
  overDue: LedgerDueBucket;
  /** Due today or within 15 days. */
  pastDue: LedgerDueBucket;
  /** More than 15 days of credit left. */
  normal: LedgerDueBucket;
}

export interface PartyLedgerResult {
  rows: PartyLedgerRow[];
  footer: PartyLedgerFooter;
  kpis: PartyLedgerKpis;
  /** Distinct voucher types present (for the client-side filter dropdown). */
  voucherTypes: string[];
  scope: 'CUSTOMER' | 'AGENT' | 'ALL';
  customerName: string | null;
  agentName: string | null;
  from: string;
  to: string;
}

export interface PartyLedgerQuery {
  customerId?: number;
  agentName?: string;
  /** yyyy-mm-dd. */
  from: string;
  to: string;
  voucherType?: string;
  /** BOTH | B | C. */
  mode?: string;
}

/** One receipt / clearance against an invoice (row-click detail). */
export interface LedgerReceiptLine {
  recDate: string;
  refRecId: string;
  recType: string; // RECEIPT | CREDIT NOTE | ADVANCE
  recAmt: number;
}

export interface PartyLedgerLookups {
  customers: { id: number; name: string }[];
  agents: string[];
}
