/**
 * Reconciliation against a Tally ledger register (Sundry Debtors export).
 *
 * The register carries BANK entries only, so every comparison is made against
 * the OMS bank leg (`challan.b`, `acctLedger.bankDebit/bankCredit`) — never the
 * cash leg, which Tally simply doesn't know about.
 *
 * Voucher numbers only line up for sales invoices (Tally `SSS-13/26-27` is OMS
 * `SSS/26-27/13`). Receipts and notes are numbered independently in Tally
 * (bare serials `11`, `130`, `1`…), so those match on date + amount + party.
 */

/** What kind of line is being compared. */
export const RECON_VCH_TYPES = ['OPENING', 'SALES', 'RECEIPT', 'CREDIT NOTE', 'DEBIT NOTE', 'DISCOUNT', 'OTHER'] as const;
export type ReconVchType = (typeof RECON_VCH_TYPES)[number];

export const RECON_STATUSES = [
  /** Present on both sides and the figures agree. */
  'MATCHED',
  /** In the register, nothing corresponding in OMS. */
  'MISSING_IN_OMS',
  /** In OMS, the register never mentioned it. */
  'MISSING_IN_TALLY',
  /** Found on both sides but the amounts differ. */
  'AMOUNT_MISMATCH',
  /** Found on both sides, amounts agree, but the dates differ. */
  'DATE_MISMATCH',
  /** The register's ledger name maps to no OMS customer — nothing to compare to. */
  'UNMATCHED_PARTY',
  /** A voucher type OMS has no equivalent for (Purchase, TCS Payable…). */
  'NOT_APPLICABLE',
] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];

/** Statuses that represent something the user needs to act on. */
export const RECON_PROBLEM_STATUSES: ReconStatus[] = [
  'MISSING_IN_OMS',
  'MISSING_IN_TALLY',
  'AMOUNT_MISMATCH',
  'DATE_MISMATCH',
  'UNMATCHED_PARTY',
];

export interface ReconRow {
  id: number;
  source: 'TALLY' | 'OMS';
  ledgerName: string;
  customerId: number | null;
  customerName: string | null;
  txnDate: string;
  vchType: ReconVchType;
  vchNo: string;
  particulars: string | null;
  dr: number;
  cr: number;
  status: ReconStatus;
  /** The counterpart voucher this line matched, when it did. */
  omsRef: string | null;
  omsAmount: number | null;
  omsDate: string | null;
  note: string | null;
  /** Set once the user has created the missing entry from the report. */
  resolvedAt: string | null;
  resolvedRef: string | null;
}

export interface ReconRunSummary {
  id: number;
  fileName: string;
  fromDate: string;
  toDate: string;
  uploadedAt: string;
  userName: string | null;
  ledgerCount: number;
  voucherCount: number;
  matchedCount: number;
  missingInOms: number;
  missingInTally: number;
  mismatchCount: number;
  unmatchedParty: number;
}

export interface ReconRunResult extends ReconRunSummary {
  rows: ReconRow[];
  /** Ledger names in the register with no OMS customer, for the alias screen. */
  unmatchedLedgers: string[];
}

/** One saved Tally-name → OMS-customer pin. */
export interface TallyAliasDto {
  id: number;
  tallyName: string;
  customerId: number;
  customerName: string | null;
  createdAt: string;
}

export interface SaveTallyAliasInput {
  tallyName: string;
  customerId: number;
}

/** Create the OMS receipt a MISSING_IN_OMS receipt row describes. */
export interface ReconCreateReceiptInput {
  /** Recon row ids to post — each becomes one receipt. */
  rowIds: number[];
  /** Receiving bank account (display name). Falls back per-row to whatever the
   *  register's particulars mapped to when omitted. */
  bankName?: string | null;
  /** AUTOMATIC (waterfall) unless the caller says otherwise. */
  adjMode?: string;
}

export interface ReconCreateReceiptResult {
  created: { rowId: number; voucherNo: string; amount: number; customerName: string }[];
  failed: { rowId: number; reason: string }[];
}
