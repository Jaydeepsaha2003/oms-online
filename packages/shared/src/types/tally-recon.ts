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
  /**
   * Found on both sides and the figures agree, but the money went through a
   * different BANK in each.
   *
   * Its own status rather than a note on a MATCHED row, for the same reason
   * AMOUNT_MISMATCH and DATE_MISMATCH are: those are also "found on both
   * sides", and a discrepancy filed under Matched is a discrepancy nobody
   * looks at. A receipt banked to the wrong account reconciles on paper and
   * still leaves two bank books wrong.
   */
  'BANK_MISMATCH',
  /** The register's ledger name maps to no OMS customer — nothing to compare to. */
  'UNMATCHED_PARTY',
  /** A voucher type OMS has no equivalent for (Purchase, TCS Payable…). */
  'NOT_APPLICABLE',
] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];

/**
 * The user's own verdict on a flagged line, tracked separately from `status`.
 *
 * `status` is what the comparison found; `review` is what the user has done
 * about it. A mark never suppresses the row — a SOLVED discrepancy still counts
 * as a discrepancy — so the report can't quietly hide a real difference behind
 * someone having ticked it off.
 */
export const RECON_REVIEWS = ['OPEN', 'PENDING', 'SOLVED'] as const;
export type ReconReview = (typeof RECON_REVIEWS)[number];

/** Statuses that represent something the user needs to act on. */
export const RECON_PROBLEM_STATUSES: ReconStatus[] = [
  'MISSING_IN_OMS',
  'MISSING_IN_TALLY',
  'AMOUNT_MISMATCH',
  'DATE_MISMATCH',
  'BANK_MISMATCH',
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
  /**
   * The bank OMS recorded the matched voucher against, when it names one.
   *
   * `particulars` already carries the register's own bank, so the two sit side
   * by side and a BANK_MISMATCH can be read off the row without opening the
   * note. Null on rows that matched nothing, or where OMS named no bank.
   */
  omsBank: string | null;
  note: string | null;
  /** Set once the user has created the missing entry from the report. */
  resolvedAt: string | null;
  resolvedRef: string | null;

  /** The user's mark. OPEN until they say otherwise. */
  review: ReconReview;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  /** True when this mark was inherited from an earlier upload of the same issue. */
  reviewCarried: boolean;
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
  /** How many flagged lines the user has marked, of each kind. */
  pendingCount: number;
  solvedCount: number;
  /** Parties whose closing balance disagrees with the register, and how many were
   *  comparable at all (an unmapped ledger can't be). */
  balanceMismatchCount: number;
  balanceCheckedCount: number;
  /** Receipts that agree on figures but went through different banks. */
  bankMismatchCount: number;
  /**
   * Can this run be re-reconciled in place, without the workbook?
   *
   * True once the run has the parsed register stored on it. False for runs
   * uploaded before that was kept, which can only be re-checked by uploading
   * the file again — the screen has to be able to say which it is rather than
   * offering a button that would fail.
   */
  canRerun: boolean;
}

/**
 * Whether one party's *balance* agrees with the register, and where it stopped
 * agreeing.
 *
 * The row report tells you which vouchers differ; this tells you whether the
 * party's bottom line differs — and pins the divergence against the last receipt
 * you recorded, because if both sides still agree at that point then everything
 * that went wrong happened after it.
 */
export interface ReconPartyBalance {
  id: number;
  ledgerName: string;
  customerId: number | null;
  customerName: string | null;
  /** Signed, Dr positive. Bank leg only. */
  tallyOpening: number;
  omsOpening: number;
  tallyClosing: number;
  omsClosing: number;
  /** tallyClosing − omsClosing. */
  difference: number;
  matched: boolean;
  /** Latest OMS receipt inside the period, and both balances as at that date. */
  lastReceiptDate: string | null;
  lastReceiptRef: string | null;
  tallyAtLastReceipt: number | null;
  omsAtLastReceipt: number | null;
  agreedAtLastReceipt: boolean | null;
  /** First date the running balances part company. Null when they never do. */
  firstDivergenceOn: string | null;
  /** The divergence begins only after the last recorded receipt. */
  divergedAfterLastReceipt: boolean;
  /**
   * Set only when this ONE balance combines two or more Tally ledger names
   * (a party renamed in Tally — GST/address change — with both the old and
   * new name in the register, both mapped to the same OMS customer). Null for
   * the ordinary one-ledger-per-party case. `ledgerName` above is just the
   * more recently active of the group for display; this is every name that
   * actually went into `tallyOpening`/`tallyClosing`, so "jump to this
   * party's rows" can filter the Vouchers tab by all of them at once — those
   * rows are still filed under their own original ledger names.
   */
  sourceLedgerNames: string[] | null;
}

export interface ReconRunResult extends ReconRunSummary {
  rows: ReconRow[];
  /**
   * Ledger names in the register with no OMS customer, split by how the user
   * has filed them:
   *   party   — still needs a customer mapping (what "needs attention" counts).
   *   expense — filed as an expense head (TallyLedgerCategory 'EXPENSE').
   *   other   — filed as some other non-party head ('OTHER') — a bank account,
   *             a tax ledger, Suspense, P&L, and the like.
   * expense/other are never dropped once filed — they stay here (not just
   * removed from the report) so the filing itself stays visible and reversible,
   * not a one-way action the user can't see the effect of.
   */
  unmatchedLedgers: UnmappedLedgers;
  /** Per-party balance verdicts, worst difference first. */
  balances: ReconPartyBalance[];
}

/** A Tally ledger classified as NOT a customer — see TallyLedgerCategory. */
export const TALLY_LEDGER_CATEGORIES = ['EXPENSE', 'OTHER'] as const;
export type TallyLedgerCategory = (typeof TALLY_LEDGER_CATEGORIES)[number];

/**
 * What to set a ledger's filing to. 'PARTY' is not a stored category — it's the
 * instruction to CLEAR one, the same idiom `ReconReview`'s 'OPEN' already uses
 * to mean "no mark" rather than storing an explicit "unmarked" value.
 */
export const TALLY_LEDGER_CATEGORY_INPUTS = ['PARTY', ...TALLY_LEDGER_CATEGORIES] as const;
export type TallyLedgerCategoryInput = (typeof TALLY_LEDGER_CATEGORY_INPUTS)[number];

export interface UnmappedLedgers {
  party: string[];
  expense: string[];
  other: string[];
}

/**
 * Files one or more ledgers at once, so triaging a batch (tick several,
 * "File as Expense") costs exactly one save — and, separately, exactly one
 * report recheck — instead of one of each per ledger. Filing itself is a
 * plain upsert either way (a few ms); it's the RECHECK that's expensive
 * (a full re-comparison of the register, ~1s on a large one), which is why
 * the API no longer reruns automatically on every save — see
 * TallyReconService.setLedgerCategories.
 */
export interface SetTallyLedgerCategoryInput {
  tallyNames: string[];
  category: TallyLedgerCategoryInput;
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

/** Mark (or clear) the user's review on a set of report lines. */
export interface MarkReconRowsInput {
  rowIds: number[];
  /** OPEN clears the mark entirely rather than storing it. */
  review: ReconReview;
  note?: string | null;
}

export interface MarkReconRowsResult {
  updated: number;
}
