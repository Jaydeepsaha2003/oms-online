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
  /** Outstanding amount for the selected Bank/Cash print mode. */
  pendingAmount: number;
  /** Which leg the outstanding sits on when only ONE of them still carries a
   *  balance — 'B' bank, 'C' cash. null when both legs are still open (or
   *  neither is), because then naming a side would be a half-truth. */
  pendingSide: 'B' | 'C' | null;
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
  /**
   * Opening and closing are `null` while a voucher-type filter is active.
   *
   * The opening balance always spans EVERY voucher type, so adding it to a
   * Current Total that holds only (say) receipts reports a closing balance the
   * party never owed. Rather than publish that figure the server withholds both,
   * leaving Current Total — the only line the filter doesn't invalidate.
   */
  opening: LedgerBalanceRow | null;
  current: LedgerBalanceRow;
  closing: LedgerBalanceRow | null;
  /** Signed nets (+ = Debit / party owes us, − = Credit); null alongside the rows above. */
  openingBankNet: number | null;
  openingCashNet: number | null;
  closingBankNet: number | null;
  closingCashNet: number | null;
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
   * The same invoice as structured facts, so the screen can explain itself.
   *
   * `invDueFrom` deliberately looks past the date filter — an unpaid bill from
   * before the window must not hide behind it. The cost is that the KPI can name
   * a document that is nowhere in the table below, which reads as though the
   * invoice does not exist. `inRange` is what lets the UI say "raised before this
   * date range" instead of leaving the user hunting for it.
   */
  invDueFromDetail: {
    code: string;
    /** The date the KPI is measured from — due date, or invoice date if none. */
    dueDate: string;
    invDate: string;
    party: string;
    /** Is its voucher actually inside the range currently on screen? */
    inRange: boolean;
  } | null;
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
  /** Customer location shown in the PDF ledger heading for single-party reports. */
  customerAddress: string | null;
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
  /** Which side of the invoice this line settled: 'B' bank, 'C' cash.
   *  An invoice usually has both, and the ledger can be filtered to one — a line
   *  has to say which side it belongs to or it reads as a stray payment. */
  bucket: 'B' | 'C';
}

/** One invoice a receipt voucher settled, and where the money for it came from. */
export interface LedgerClearedLine {
  invNo: string;
  /** The party whose invoice this is — NOT necessarily the party the voucher is
   *  booked against. An agent receipt is booked to the agent but clears his
   *  parties' invoices, which is exactly what this view exists to show. */
  customerName: string;
  amount: number;
  /** RECEIPT = funded by this voucher's own money; ADVANCE = funded by money the
   *  party already had on account, so it is not a second payment. */
  kind: 'RECEIPT' | 'ADVANCE';
  /** The voucher or ADV- reference the money came from. */
  fundedBy: string;
}

/**
 * What one receipt voucher did with its money.
 *
 * The identity that must hold is `fromReceipt + parked === voucherTotal`: this
 * voucher's own money either came off an invoice or went on account.
 *
 * `fromAdvance` is deliberately OUTSIDE that sum. A voucher can settle more than
 * it carried by also spending money the party had already paid in earlier, and
 * counting that against this voucher's total would make a correct receipt look
 * over-applied. It is reported separately so the extra clearing is visible
 * without being double-counted.
 */
export interface LedgerClearedResult {
  voucherNo: string;
  /** Who the voucher itself is booked against (a party, or an agent). */
  bookedTo: string;
  voucherTotal: number;
  lines: LedgerClearedLine[];
  /** Total put on invoices — from this receipt AND from older advances. */
  cleared: number;
  /** The part of `cleared` funded by this voucher's own money. */
  fromReceipt: number;
  /** The part of `cleared` funded by money already on account. */
  fromAdvance: number;
  /** Money left on account by this voucher, if any. */
  parked: { refId: string; amount: number } | null;
}

export interface PartyLedgerLookups {
  customers: { id: number; name: string }[];
  agents: string[];
}
