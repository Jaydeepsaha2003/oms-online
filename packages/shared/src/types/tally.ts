/** Where OMS finds TallyPrime, and the one company it is allowed to talk to. */
export interface TallyConfig {
  /** Tally's XML port, e.g. http://192.168.0.245:9000 */
  url: string;
  /** GUID of the company OMS is locked to; null until an admin locks one. */
  companyGuid: string | null;
}

/**
 * OK            — Tally answered and the locked company is open.
 * OFFLINE       — no answer (PC off, Tally closed, port off, or Tally stuck on a dialog).
 * NO_COMPANY    — Tally answered but has no company open.
 * WRONG_COMPANY — companies are open, but not the locked one.
 * NOT_LOCKED    — Tally answered, but no company has been locked yet.
 */
export type TallyState = 'OK' | 'OFFLINE' | 'NO_COMPANY' | 'WRONG_COMPANY' | 'NOT_LOCKED';

export interface TallyCompany {
  name: string;
  guid: string;
  /** Company's GST state — decides CGST+SGST (same state) vs IGST. */
  state: string | null;
  /** Tally's last voucher change counter: any voucher saved, altered or cancelled raises it. */
  altVchId: number | null;
}

/** One stock line of a Sales voucher. */
export interface TallyVoucherLine {
  item: string;
  unit: 'KGS' | 'PCS';
  qty: number;
  rate: number;
  amount: number;
}

/** What OMS would send to Tally for one invoice — nothing is written. */
export interface TallyPreview {
  challanId: number;
  code: string;
  customerName: string;
  /** Set for a billing-rate invoice; C is reported separately from this voucher. */
  billingRate: number | null;
  gaushalaAmount: number | null;
  /** Why this invoice cannot be posted; empty when it can. */
  blocks: string[];
  voucher: {
    vchNo: string;
    date: string;
    party: string;
    lines: TallyVoucherLine[];
    ledgers: { name: string; amount: number }[];
    total: number;
    shippedBy: string | null;
    deliveryNote: string | null;
  } | null;
  /** When the bill is already in Tally: every way the preview differs from it (empty = identical). */
  differences: string[] | null;
}

/**
 * Post status of one OMS invoice:
 * NOT_POSTED → POSTING (sending now) → POSTED (verified in Tally)
 *                                    → FAILED (Tally refused; nothing created — safe to retry)
 *                                    → UNKNOWN (no clear answer — OMS checks Tally before anything else)
 */
export type TallyPostStatus = 'NOT_POSTED' | 'POSTING' | 'POSTED' | 'FAILED' | 'UNKNOWN';

/** An invoice of this year not yet in Tally. */
export interface TallyQueueRow {
  challanId: number;
  code: string;
  date: string;
  customerName: string;
  amount: number | null;
  status: TallyPostStatus;
  lastError: string | null;
  /** Why it cannot be posted; empty = ready. */
  blocks: string[];
}

export interface TallyPostResult {
  status: TallyPostStatus;
  /** What happened, in words. */
  message: string;
  vchNo: string | null;
  /** Things to look at in Tally before making the e-invoice. */
  warnings: string[];
}

/** The builder run over every bill of this year already in Tally. */
export interface TallyPreviewTest {
  /** Linked bills the builder would post (full bills with a mapped party). */
  tested: number;
  identical: number;
  /** Linked bills OMS would not post, and why (grouped). */
  skipped: { reason: string; count: number }[];
  /** Bills where the builder's voucher differs from Tally's. */
  mismatches: TallyPreview[];
}

/** A Sundry Debtors ledger as Tally has it right now. */
export interface TallyLedger {
  guid: string;
  name: string;
  gstin: string | null;
  state: string | null;
  registrationType: string | null;
  /** Mailing address lines and PIN — copied onto the invoice, which the e-invoice needs. */
  address: string[];
  pincode: string | null;
}

/**
 * OK            — mapped; the ledger exists and its GSTIN is what was confirmed.
 * GSTIN_CHANGED — the ledger's GSTIN changed in Tally since it was confirmed.
 * MISSING       — the mapped ledger is gone from Tally (deleted, or a different company).
 * UNMAPPED      — no ledger chosen yet.
 */
export type TallyMappingStatus = 'OK' | 'GSTIN_CHANGED' | 'MISSING' | 'UNMAPPED';

/** Why a ledger is suggested: the owner's own Tally XML upload mapping (alias or
 *  same name, as Customers → Tally upload links them), or what the last Tally
 *  bill for this party used. */
export type TallySuggestionSource = 'UPLOAD' | 'LAST_BILL';

export interface TallyPartyMapping {
  customerId: number;
  customerName: string;
  agentName: string | null;
  city: string | null;
  status: TallyMappingStatus;
  /** The mapped ledger as it is in Tally now (null when unmapped or missing). */
  ledger: TallyLedger | null;
  /** Name and GSTIN as confirmed, to show what changed. */
  savedName: string | null;
  savedGstin: string | null;
  /** Offered when the party is unmapped or its ledger is missing. */
  suggestion: (TallyLedger & { source: TallySuggestionSource }) | null;
  /** Set when the upload mapping and the last Tally bill disagree: the upload's
   *  ledger (the suggestion is the last bill's). Needs a human choice. */
  uploadLedgerName: string | null;
}

export interface TallyMappingList {
  ledgers: TallyLedger[];
  rows: TallyPartyMapping[];
}

export interface SaveTallyMappingInput {
  /** ledgerGuid null clears the mapping. */
  items: { customerId: number; ledgerGuid: string | null }[];
}

/** How an OMS invoice and its Tally voucher compare. */
export type TallyRecon =
  | 'OK'
  | 'MISSING_IN_TALLY'
  | 'CANCELLED_IN_TALLY'
  | 'CANCELLED_IN_OMS'
  | 'AMOUNT_MISMATCH'
  | 'PARTY_MISMATCH'
  | 'DATE_MISMATCH'
  | 'TALLY_ONLY';

export interface TallyReconRow {
  id: number;
  recon: TallyRecon;
  /** Every difference found, in words. */
  note: string | null;
  /** A human accepted this exact difference (and Tally hasn't changed since). */
  accepted: boolean;
  acceptedNote: string | null;
  acceptedBy: string | null;
  oms: { challanId: number; code: string; date: string; customerName: string; amount: number | null; status: string } | null;
  tally: { vchNo: string | null; date: string | null; party: string | null; amount: number | null; cancelled: boolean; irn: boolean } | null;
}

export interface TallyReconResult {
  /** When the last check ran; null if never. */
  checkedAt: string | null;
  /** OMS invoices linked to a Tally voucher. */
  linked: number;
  ok: number;
  /** Every row that is not OK, accepted or not. */
  rows: TallyReconRow[];
}

export interface TallyStatus {
  config: TallyConfig;
  state: TallyState;
  /** Round-trip time of the check, null when Tally did not answer. */
  ms: number | null;
  /** Companies currently open in Tally. */
  companies: TallyCompany[];
  /** Plain-language reason when state is OFFLINE. */
  error: string | null;
  checkedAt: string;
}
