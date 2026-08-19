/** Daybook — every voucher of every type, across every party, in chronological
 *  order (legacy Tally Day Book). Unlike Party Ledger (one party, split into
 *  Bank/Cash legs) this spans everyone and collapses straight to a single Dr/Cr
 *  pair per voucher, grouped by date with a running/day total — the classic
 *  Tally daybook read. */

import type { LedgerTxnMode } from './party-ledger';

export interface DaybookQuery {
  from: string;
  to: string;
  voucherType?: string;
  /** Restrict to one party — omit for every party's vouchers. */
  customerId?: number;
  /** Which leg of each voucher to report: BOTH (bank+cash, the default), B or C.
   *  Same vocabulary as Party Ledger. A voucher with nothing on the chosen leg
   *  drops out of the day entirely, so Bank reads as a pure bank daybook. */
  mode?: LedgerTxnMode;
}

export interface DaybookRow {
  txnDate: string;
  particulars: string;
  customerName: string;
  voucherType: string;
  voucherNo: string;
  /** Set only for SALES INVOICE / DEBIT NOTE rows — lets the UI link to the challan. */
  challanId?: number | null;
  dr: number;
  cr: number;
}

export interface DaybookDayGroup {
  /** ISO date (midnight) for this day's rows. */
  date: string;
  rows: DaybookRow[];
  totalDr: number;
  totalCr: number;
}

export interface DaybookResult {
  groups: DaybookDayGroup[];
  /** Every voucher type present in the UNFILTERED range, for the type dropdown —
   *  derived before the `voucherType` filter so picking one doesn't collapse the
   *  option list down to itself. */
  voucherTypes: string[];
  totalDr: number;
  totalCr: number;
  from: string;
  to: string;
}
