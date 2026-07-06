/**
 * Company bank accounts (legacy SETTING_BANK_NAME). Used by Account → Manage
 * Cheques as the "deposit bank" picker: the display is "BANK NAME-<last 4 of A/C>".
 */
import type { Paginated, PaginationQuery } from './common';

export interface BankAccountDto {
  id: number;
  bankName: string;
  acNo: string;
  ifsc: string | null;
  branch: string | null;
  isActive: boolean;
  /** "BANK NAME-1234" — what the cheque form's deposit-bank picker shows. */
  display: string;
  createdAt: string;
  updatedAt: string;
}

export interface BankAccountInput {
  bankName: string;
  acNo: string;
  ifsc?: string | null;
  branch?: string | null;
  isActive?: boolean;
}

export type BankAccountQuery = PaginationQuery & {
  search?: string;
  activeOnly?: boolean;
};
export type BankAccountList = Paginated<BankAccountDto>;

/** "BANK NAME-1234" from a bank name + account number (last 4 digits). */
export function bankAccountDisplay(bankName: string, acNo: string): string {
  const digits = (acNo ?? '').replace(/\s+/g, '');
  const last4 = digits.length >= 4 ? digits.slice(-4) : digits;
  return `${bankName}-${last4}`;
}
