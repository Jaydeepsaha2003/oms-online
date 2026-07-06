/**
 * Account → Opening Balance. Per-customer opening bank/cash amounts entered as a
 * DEBIT (customer owes us — cleared by receipts, like an invoice) or CREDIT (we owe
 * them). Stored as `AcctOpeningTrans` rows with kind = OPENING; the Payment engine
 * nets these against opening CLEARANCE rows to get each customer's opening pending.
 */
import type { Paginated, PaginationQuery } from './common';

export const DR_CR = ['DEBIT', 'CREDIT'] as const;
export type DrCr = (typeof DR_CR)[number];

export interface OpeningBalanceDto {
  id: number;
  customerId: number;
  customerName: string;
  transDate: string;
  bankAmt: number;
  cashAmt: number;
  drCr: DrCr;
  remarks: string | null;
  createdAt: string;
}

export interface OpeningBalanceInput {
  customerId: number;
  transDate: string;
  bankAmt?: number;
  cashAmt?: number;
  drCr: string;
  remarks?: string | null;
}

export type OpeningBalanceQuery = PaginationQuery & {
  search?: string;
  drCr?: string;
};
export type OpeningBalanceList = Paginated<OpeningBalanceDto>;
