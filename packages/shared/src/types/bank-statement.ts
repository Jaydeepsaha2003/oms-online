/**
 * Bank Statement reconciliation.
 *
 * Answers one question: for a given date range, do the CREDITS on our bank
 * statement agree, party by party, with the receipts recorded in OMS?
 *
 * Only the credit side is read. A debit is money going out — it is never a
 * customer receipt, so it has no counterpart to reconcile against and is
 * dropped at parse time rather than carried through the whole pipeline as noise.
 *
 * The comparison is deliberately made BOTH ways, because real payments do not
 * arrive one-per-invoice:
 *   • line by line — a credit paired with a receipt of the same amount, within
 *     a few days either side (a cheque clears when it clears);
 *   • in total     — the party's credits for the range against their receipts
 *     for the range, so one transfer covering four receipts, or four transfers
 *     making up one, still reconcile.
 *
 * Nothing reaches the ledger until Process. Up to that point a run is a saved
 * working: every parsed line and every assignment the user makes is persisted
 * as it happens, so closing the tab loses nothing.
 */
import type { Paginated } from './common';

/* ── Column mapping ───────────────────────────────────────────────────────── */

/**
 * Which column of the uploaded sheet holds what.
 *
 * Banks disagree on everything — header wording, column order, whether debit
 * and credit share one signed column — and they change it between exports. So
 * the layout is stated once by the user rather than guessed, and remembered
 * against the bank account for next time.
 */
export interface BankStatementColumnMap {
  /** Transaction date. */
  date: string;
  /** Description / narration / particulars — whatever names the payer. */
  narration: string;
  /** Money IN. The only amount column that matters here. */
  credit: string;
  /**
   * Money OUT, when the sheet has one.
   *
   * Only ever used to REJECT a row: some exports put a value in both columns,
   * and some use one signed column mapped to `credit`, where a debit shows up
   * as a negative. Either way a row with a debit is not a receipt.
   */
  debit?: string | null;
  /** Cheque / UTR / reference number, when the sheet carries one. */
  ref?: string | null;
}

/** A sheet as first read, before any mapping — enough to choose columns from. */
export interface BankStatementPreview {
  /** Column headers exactly as the file spells them. */
  columns: string[];
  /** The first handful of rows, for eyeballing the mapping. */
  sample: Record<string, string>[];
  totalRows: number;
  /** A previously saved mapping for this bank account, when there is one. */
  savedMap: BankStatementColumnMap | null;
  /** Columns the server guessed, to pre-fill the form. Never applied silently. */
  guess: Partial<BankStatementColumnMap>;
}

/* ── Rows ─────────────────────────────────────────────────────────────────── */

export const BANK_ROW_STATUSES = ['MATCHED', 'PARTIAL', 'UNMATCHED', 'NO_PARTY', 'IGNORED', 'POSTED'] as const;
export type BankRowStatus = (typeof BANK_ROW_STATUSES)[number];

/** How this line's party was decided — shown so an automatic guess is never
 *  mistaken for something a human confirmed. */
export const BANK_PARTY_SOURCES = ['RECEIPT', 'ALIAS', 'NARRATION', 'MANUAL'] as const;
export type BankPartySource = (typeof BANK_PARTY_SOURCES)[number];

export interface BankStatementRowDto {
  id: number;
  runId: number;
  /** 1-based line number in the uploaded sheet, so a row can be found again. */
  rowNo: number;
  txnDate: string;
  narration: string;
  refNo: string | null;
  /** The credit amount. Always positive. */
  amount: number;
  customerId: number | null;
  customerName: string | null;
  partySource: BankPartySource | null;
  status: BankRowStatus;
  /** OMS receipt REF IDs this line was paired with, when it matched. */
  matchedRefs: string[];
  /** How much of `amount` those receipts account for. */
  matchedAmount: number;
  note: string | null;
  /** The receipt Process created from this line. */
  postedRef: string | null;
  postedAt: string | null;
}

/* ── Runs ─────────────────────────────────────────────────────────────────── */

export const BANK_RUN_STATUSES = ['DRAFT', 'PROCESSED'] as const;
export type BankRunStatus = (typeof BANK_RUN_STATUSES)[number];

export interface BankStatementRunDto {
  id: number;
  fileName: string;
  /** Our receiving bank account, as named in Bank Accounts. */
  bankName: string | null;
  fromDate: string;
  toDate: string;
  uploadedAt: string;
  userName: string | null;
  status: BankRunStatus;
  processedAt: string | null;
  /** Credit lines kept after filtering to the range. */
  rowCount: number;
  creditTotal: number;
  matchedCount: number;
  partialCount: number;
  unmatchedCount: number;
  noPartyCount: number;
  postedCount: number;
  ignoredCount: number;
}

export type BankStatementRunList = Paginated<BankStatementRunDto>;

/** A run with its lines — what the review screen renders. */
export interface BankStatementRunResult {
  run: BankStatementRunDto;
  rows: BankStatementRowDto[];
  /** Every party the run touches, for the dropdown. */
  parties: { customerId: number; customerName: string; lines: number; total: number }[];
}

/* ── Per-party before / after ─────────────────────────────────────────────── */

/** One side of the comparison for a party. */
export interface BankPartyBalance {
  /** Receipts recorded in OMS inside the run's date range. */
  receiptCount: number;
  receiptTotal: number;
  /** The party's outstanding, bank and cash legs. */
  pendingBank: number;
  pendingCash: number;
  /**
   * Money held on account.
   *
   * Stated because a receipt bigger than what the party owes does not vanish —
   * the payments engine parks the excess here. Showing outstanding fall to zero
   * without saying where the rest went would hide half of what Process does.
   */
  advance: number;
}

/**
 * What Process would do to ONE party, stated as before and after.
 *
 * `after` is a projection, not a second set of books: it is `before` with the
 * unmatched credits applied. It exists so the decision is made on the outcome
 * rather than on a list of line items.
 */
export interface BankPartyPreview {
  customerId: number;
  customerName: string;
  /** The run's statement lines assigned to this party. */
  rows: BankStatementRowDto[];
  statementTotal: number;
  /** Statement credits that already pair with a receipt. */
  matchedTotal: number;
  /** Statement credits with no receipt behind them — what Process would create. */
  shortfall: number;
  /** Receipts in OMS with no statement credit behind them, which is the other
   *  half of the story: money recorded that the bank never showed. */
  unbackedReceiptTotal: number;
  before: BankPartyBalance;
  after: BankPartyBalance;
}

/* ── Inputs ───────────────────────────────────────────────────────────────── */

export interface BankStatementCreateInput {
  fileName: string;
  bankName?: string | null;
  fromDate: string;
  toDate: string;
  map: BankStatementColumnMap;
  /** Every data row of the sheet, as `{ column: cell }`. Filtering to credits
   *  inside the range happens on the server so the rule lives in one place. */
  rows: Record<string, string | null>[];
}

export interface BankStatementAssignInput {
  rowIds: number[];
  customerId: number | null;
  /** Remember this narration for the party, so the next upload assigns it. */
  rememberAlias?: boolean;
}

export interface BankStatementProcessResult {
  runId: number;
  created: { rowId: number; voucherNo: string; amount: number; customerName: string }[];
  failed: { rowId: number; reason: string }[];
}

/* ── Helpers shared by both sides ─────────────────────────────────────────── */

/** Rupee tolerance when pairing a credit with a receipt. */
export const BANK_AMOUNT_TOL = 1;
/** Days a same-amount receipt may sit either side of the bank date. */
export const BANK_DATE_TOL_DAYS = 7;

/**
 * The words in a narration worth matching a party on.
 *
 * Bank narrations are mostly routing noise ("NEFT", "IMPS", an IFSC, a UTR),
 * and matching on those pairs every party with every line. Only tokens that
 * could be part of a name survive: letters, at least three of them, and not a
 * banking term.
 */
const NARRATION_NOISE = new Set([
  'NEFT', 'RTGS', 'IMPS', 'UPI', 'CHQ', 'CHEQUE', 'CLG', 'CMS', 'TRF', 'TRANSFER', 'DEP', 'DEPOSIT',
  'CASH', 'BY', 'TO', 'FROM', 'REF', 'PAYMENT', 'PAYMT', 'RECEIPT', 'CR', 'DR', 'INB', 'MB', 'ATM',
  'BANK', 'LTD', 'LIMITED', 'PVT', 'PRIVATE', 'THE', 'AND', 'FOR', 'INDIA', 'BRANCH', 'ACCOUNT', 'AC',
]);

export function narrationTokens(narration: string): string[] {
  return [...new Set(
    (narration ?? '')
      .toUpperCase()
      .split(/[^A-Z]+/)
      .filter((w) => w.length >= 3 && !NARRATION_NOISE.has(w)),
  )];
}

/**
 * Industry words that name a trade rather than a party.
 *
 * Dozens of parties share them, so a match resting only on one of these is not
 * evidence of anything: "JE STEEL" would otherwise claim every narration that
 * happens to say SANCHETI STEEL HOUSE.
 */
const GENERIC_PARTY_WORDS = new Set([
  'STEEL', 'METAL', 'METALS', 'TRADERS', 'TRADING', 'ENTERPRISE', 'ENTERPRISES', 'INDUSTRIES', 'INDUSTRY',
  'AGENCIES', 'AGENCY', 'MARKETING', 'STORES', 'STORE', 'SALES', 'CORPORATION', 'COMPANY', 'TRADERSS',
  'HOUSE', 'CENTRE', 'CENTER', 'UDYOG', 'KITCHEN', 'KITCHENWARE', 'HARDWARE', 'VESSELS', 'STAINLESS',
]);

/** How well a narration names one party. */
export interface NarrationMatch {
  /** Share of the party's own words found in the narration, 0–1. */
  score: number;
  /** How many of them — the specificity that separates two equal scores. */
  matched: number;
  /** False when every matched word was a generic trade word. */
  distinctive: boolean;
}

/**
 * Match a party's name against a narration.
 *
 * Words must match EXACTLY, or as a prefix when both are long enough to make a
 * prefix meaningful. Substring matching was the original mistake: it let the
 * five-letter "METAL" match "METALS" and hand a METRO METALS transfer to a
 * party called BK METAL.
 */
export function narrationMatch(narration: string, partyName: string): NarrationMatch {
  const words = narrationTokens(narration);
  const party = narrationTokens(partyName);
  if (!words.length || !party.length) return { score: 0, matched: 0, distinctive: false };

  const hits = party.filter((p) =>
    words.some((w) => w === p || (p.length >= 6 && w.length >= 6 && (w.startsWith(p) || p.startsWith(w)))),
  );
  return {
    score: hits.length / party.length,
    matched: hits.length,
    distinctive: hits.some((h) => !GENERIC_PARTY_WORDS.has(h)),
  };
}

/** Kept for callers that only want the number. */
export function narrationScore(narration: string, partyName: string): number {
  return narrationMatch(narration, partyName).score;
}

/** Below this share of the party's words, a narration does not name them. */
export const NARRATION_MATCH_MIN = 0.6;

/**
 * Words that describe a TRANSACTION rather than a payer.
 *
 * Long enough to survive the length filter and common enough to appear on
 * hundreds of lines, so any one of them would be a ruinous alias.
 */
const TXN_WORDS = new Set([
  'SETTLEMENT', 'CAPITALISED', 'CAPITALIZED', 'INTEREST', 'CHARGES', 'CHARGE', 'REVERSAL', 'REFUND',
  'CLEARING', 'COLLECTION', 'INWARD', 'OUTWARD', 'CREDIT', 'DEBIT', 'TRANSACTION', 'PAYMENT', 'AGAINST',
  'INVOICE', 'AMOUNT', 'AMT', 'AGST', 'MISC', 'OTHERS', 'ONLINE', 'FUND', 'FUNDS', 'BILL', 'BILLS',
]);

/**
 * The word to remember a payer by, or null when there is nothing safe to learn.
 *
 * Prefers a word the narration SHARES with the party being assigned — that is
 * the word that will identify them again, and it cannot be a coincidence.
 * Failing that (the payer's bank name differs from the party's, which is the
 * main reason aliases exist at all) it takes the longest distinctive word.
 *
 * NOT simply the first token: "CREDIT INTEREST CAPITALISED" would otherwise
 * teach the system that "CREDIT" means this party, and that then matches almost
 * every future narration. A bad alias is worse than none — it misfiles money
 * silently, on a screen whose whole job is to stop exactly that.
 */
export function aliasFragment(narration: string, partyName?: string): string | null {
  const words = narrationTokens(narration).filter((w) => w.length >= 5 && !GENERIC_PARTY_WORDS.has(w) && !TXN_WORDS.has(w));
  if (!words.length) return null;
  if (partyName) {
    const party = new Set(narrationTokens(partyName));
    const shared = words.filter((w) => party.has(w)).sort((a, b) => b.length - a.length);
    if (shared.length) return shared[0];
  }
  return [...words].sort((a, b) => b.length - a.length)[0];
}

/**
 * The one party a narration names, or null when it does not name exactly one.
 *
 * Ranked by score, then by how many words matched — the specific name beats the
 * generic one, so SANCHETI STEEL HOUSE wins over JE STEEL on a narration that
 * says all three words. A genuine tie is ambiguous and returns null rather than
 * guessing: an unassigned line costs someone a click, a wrongly assigned one
 * puts a customer's money against another customer's name.
 */
export function bestNarrationParty<T extends { id: number; name: string }>(
  narration: string,
  parties: T[],
): T | null {
  const scored = parties
    .map((p) => ({ party: p, ...narrationMatch(narration, p.name) }))
    .filter((r) => r.score >= NARRATION_MATCH_MIN && r.distinctive)
    .sort((a, b) => b.score - a.score || b.matched - a.matched);
  if (!scored.length) return null;
  const [best, next] = scored;
  if (next && next.party.id !== best.party.id && next.score === best.score && next.matched === best.matched) return null;
  return best.party;
}
