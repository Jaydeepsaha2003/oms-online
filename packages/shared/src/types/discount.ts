/**
 * Account → Sales Discount, ported from legacy SalesDiscount.vb.
 *
 * A discount is granted against a pending invoice's BANK (challan.b) or CASH
 * (challan.c) bucket. It reduces the outstanding exactly like a receipt:
 *   pending = amount − Σ(receipts) − Σ(discounts)
 * and each save posts a SALES DISCOUNT voucher (SD/<id>) to the ledger, so the
 * Payment screen and the Sales Discount screen always reconcile.
 */
import type { Paginated } from './common';

export const DISCOUNT_MODES = ['BANK', 'CASH'] as const;
export type DiscountMode = (typeof DISCOUNT_MODES)[number];

/** One invoice with both buckets: amount, discount, received and balance. */
export interface DiscountInvoiceRow {
  invNo: string;
  invDate: string;
  customerId: number;
  customerName: string;
  /** BANK side (challan.b). */
  billAmt: number;
  billDisc: number;
  billRec: number;
  /** billAmt − billDisc − billRec (≤ 0 means fully settled on the bank side). */
  billBal: number;
  /** CASH side (challan.c). */
  cashAmt: number;
  cashDisc: number;
  cashRec: number;
  cashBal: number;
}

export type DiscountInvoiceQuery = {
  /** Restrict to one party. */
  customerId?: number;
  /** BANK / CASH — only rows with a positive balance on that side. */
  mode?: string;
  /** Free text over inv no / customer / amounts. */
  search?: string;
};

/** One saved discount (ACCT PARTY DISCOUNT row) — for the per-invoice history. */
export interface DiscountDto {
  id: number;
  disDate: string;
  invNo: string;
  customerName: string;
  customerId: number;
  invAmt: number;
  disAmt: number;
  billType: string;
  voucherNo: string | null;
}

export interface SaveDiscountInput {
  invNo: string;
  customerId: number;
  /** BANK | CASH — which bucket the discount settles. */
  billType: string;
  disAmt: number;
  /** yyyy-mm-dd, not in the future. */
  disDate: string;
}

export interface SaveDiscountResult {
  id: number;
  voucherNo: string;
  disAmt: number;
  billType: string;
  invNo: string;
}

export type DiscountInvoiceList = DiscountInvoiceRow[];
export type DiscountHistoryList = Paginated<DiscountDto>;
