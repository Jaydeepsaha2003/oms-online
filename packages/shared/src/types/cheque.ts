/**
 * Account → Manage Cheques.
 *
 * Ports the legacy "Cheque Management System" (ACCT MANAGE CHEQUE). A cheque moves
 * through a fixed lifecycle:
 *
 *   PENDING → (deposit on/after due date) → DEPOSITED → (settle) → CLEARED | BOUNCED
 *
 * A bounced cheque can be re-deposited (represented). Deposit is only allowed on or
 * after the DUE DATE — that rule is enforced on both the client and the server.
 */
import type { Paginated, PaginationQuery } from './common';

export const CHEQUE_STATUSES = ['PENDING', 'DEPOSITED', 'CLEARED', 'BOUNCED'] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];

/** Who bears the bounce charges. */
export const CHARGES_PAID_BY = ['SELF', 'PARTY'] as const;
export type ChargesPaidBy = (typeof CHARGES_PAID_BY)[number];

/** One cheque row (matches the legacy ACCT MANAGE CHEQUE record). */
export interface ChequeDto {
  id: number;
  /** FK to the customer (legacy CUS ID); null for a free-typed party. */
  customerId: number | null;
  partyName: string;
  chequeNo: string;
  chequeAmt: number;
  /** The party's / payer's bank (free text). */
  payeeBank: string | null;
  /** Our deposit bank account ("BANK NAME-1234"); legacy DRAWER BANK. */
  drawerBank: string | null;
  /** Receipt date (ISO). */
  recDate: string;
  /** Due date — earliest the cheque may be deposited (ISO). */
  dueDate: string;
  /** When it was actually deposited (ISO), or null while PENDING. */
  depositDate: string | null;
  /** Clear/bounce (account transaction) date (ISO), or null until settled. */
  acctTransDate: string | null;
  /** Bounce charges (only meaningful when BOUNCED). */
  bounceCharges: number | null;
  /** Who paid the bounce charges (SELF/PARTY), only when BOUNCED. */
  chargesPaidBy: string | null;
  /** Whether a bounced cheque is being re-deposited (represented). */
  isRepresent: boolean;
  comments: string | null;
  status: ChequeStatus;
  createdAt: string;
  updatedAt: string;
}

/** Create a new (PENDING) cheque — mirrors the legacy "ADD CHEQUE" form. */
export interface CreateChequeInput {
  partyName: string;
  customerId?: number | null;
  chequeNo: string;
  chequeAmt: number;
  payeeBank?: string | null;
  drawerBank: string;
  recDate: string;
  dueDate: string;
  comments?: string | null;
}

/** Deposit a PENDING cheque (sets deposit date + status = DEPOSITED). */
export interface DepositChequeInput {
  depositDate: string;
}

/** Settle a DEPOSITED cheque as CLEARED or BOUNCED (legacy bottom-panel SAVE). */
export interface SettleChequeInput {
  status: 'CLEARED' | 'BOUNCED';
  /** Clear date or bounce date. */
  acctTransDate: string;
  /** BOUNCED only — bounce charges amount. */
  bounceCharges?: number | null;
  /** BOUNCED only — SELF or PARTY. */
  chargesPaidBy?: string | null;
  /** BOUNCED only — is the cheque being re-deposited (represented). */
  isRepresent?: boolean;
}

export type ChequeQuery = PaginationQuery & {
  status?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};
export type ChequeList = Paginated<ChequeDto>;

/** KPI roll-up for the cheque dashboard. */
export interface ChequeSummary {
  pending: { count: number; amount: number };
  deposited: { count: number; amount: number };
  cleared: { count: number; amount: number };
  bounced: { count: number; amount: number };
  /** PENDING cheques whose due date is today or past. */
  overdue: { count: number; amount: number };
}
