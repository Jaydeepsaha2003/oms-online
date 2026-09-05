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
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Which way round a file writes numeric dates - see `detectStatementDateOrder`. */
export type StatementDateOrder = 'dmy' | 'mdy';

/** A numeric d/m/y-shaped cell, in either order. */
const NUMERIC_DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/;

/**
 * Which way round a statement writes its numeric dates.
 *
 * Decided ONCE for the whole file, from every date cell in it, because a single
 * cell usually cannot say: "04/03/26" is a valid date read either way. What
 * settles it is a row where one part is too big to be a month — "4/21/26" can
 * only be mm/dd, "21/04/26" can only be dd/mm — so the column is scanned for
 * those and the majority wins.
 *
 * This exists because assuming dd/mm made an ICICI export (mm/dd/yy) parse
 * INCONSISTENTLY: "4/21/26" was rejected by the dd/mm rule and fell through to
 * `new Date()`, which reads US order and got it right, while "4/3/26" was
 * accepted and became 4 March instead of 3 April. Same file, two conventions,
 * no complaint — and since the server drops rows outside the range, receipts
 * were being banked into the wrong month.
 *
 * Falls back to dd/mm — what Indian banks write — when nothing proves either
 * way, or when the file contradicts itself.
 */
export function detectStatementDateOrder(values: Iterable<unknown>): StatementDateOrder {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    if (v == null) continue;
    const m = NUMERIC_DATE.exec(String(v).trim());
    if (!m) continue;
    const first = Number(m[1]);
    const second = Number(m[2]);
    // Only a part that cannot be a month proves anything.
    if (first > 12 && second <= 12) dmy += 1;
    else if (second > 12 && first <= 12) mdy += 1;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}

/**
 * A date out of a bank-statement cell, read in the file's own order.
 *
 * Statements are exported as text at least as often as dates, and a numeric
 * d/m/y string is parsed by hand rather than handed to `new Date()`, which
 * reads mm/dd whatever the bank meant and silently turns 06/07 into the wrong
 * month. `order` says which way round THIS file writes them; it defaults to
 * dd/mm, what Indian banks write.
 *
 * Shared deliberately: the server uses it to decide which rows fall inside the
 * range, and the page uses it to WORK OUT that range from the file. Two copies
 * of this rule would mean the dates offered and the dates honoured could differ
 * by a month and nothing would say so.
 */
export function parseStatementDate(v: unknown, order: StatementDateOrder = 'dmy'): Date | null {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const d = new Date(v);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const s = String(v).trim();
  if (!s) return null;
  const numeric = NUMERIC_DATE.exec(s);
  if (numeric) {
    const day = Number(order === 'mdy' ? numeric[2] : numeric[1]);
    const month = Number(order === 'mdy' ? numeric[1] : numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(year, month - 1, day);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    // Numeric but impossible in this file's order. Deliberately NOT passed to
    // `new Date()`: that reads mm/dd regardless, which is precisely how one
    // file ended up parsed both ways. Unreadable is the honest answer.
    return null;
  }
  // "01-Apr-2026", "1 Apr 2026", "01 APRIL 2026" — Kotak and SBI write the
  // month as a word, and `new Date()` will not take the hyphenated form.
  const named = /^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/](\d{2,4})/.exec(s);
  if (named) {
    const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase());
    if (month >= 0) {
      const day = Number(named[1]);
      let year = Number(named[3]);
      if (year < 100) year += year < 70 ? 2000 : 1900;
      if (day >= 1 && day <= 31) {
        const d = new Date(year, month, day);
        d.setHours(0, 0, 0, 0);
        return d;
      }
    }
  }
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

/** `parseStatementDate` as the 'YYYY-MM-DD' the date pickers and the API use. */
export function statementDateToYmd(v: unknown, order: StatementDateOrder = 'dmy'): string | null {
  const d = parseStatementDate(v, order);
  if (!d) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The date to SHOW in the statement grid: always dd/mm/yy, whichever way round
 * the bank wrote it. Raw cell text was displayed before, so an American export
 * put "4/3/26" on screen next to an Indian one meaning something else entirely.
 * Anything unreadable is handed back as-is rather than blanked, so a cell the
 * parser cannot take is still visible to the person checking the column.
 */
export function statementDateToDisplay(v: unknown, order: StatementDateOrder = 'dmy'): string {
  const d = parseStatementDate(v, order);
  if (!d) return v == null ? '' : String(v).trim();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
}


/** Either shape a statement writes a date in, for the period patterns below. */
const PERIOD_DATE = String.raw`\d{1,2}[-/.\s][A-Za-z0-9]{2,9}[-/.\s]\d{2,4}`;

/**
 * The period a statement says it covers, read out of the block above its column
 * titles.
 *
 * Every Indian bank prints this, and each prints it differently:
 *
 *   Axis   `for the period (From : 01-04-2026  To : 27-08-2026)`
 *   HDFC   `From : 01/04/2026   To : 27/08/2026`
 *   ICICI  `Period : 01-04-2026 to 27-08-2026`
 *   Kotak  `Statement Period : 01-Apr-2026 To 27-Aug-2026`
 *   SBI    `Account Statement from 1 Apr 2026 to 27 Aug 2026`
 *
 * So the bank is never named or matched — only the shape of the sentence is.
 * A statement from a bank nobody has seen is read the same way, provided it
 * says From/To or Period, which is the convention rather than the exception.
 *
 * Returns null rather than guessing. The caller falls back to the first and
 * last dates in the rows, which is always available and only slightly weaker:
 * it cannot know about a period whose opening days had no transactions.
 */
export function parseStatementPeriod(
  text: string,
  order: StatementDateOrder = 'dmy',
): { from: string; to: string } | null {
  if (!text) return null;
  const SEP = String.raw`(?:\bto\b|\btill\b|\buntil\b|[-–—])`;
  const patterns = [
    // "From : X To : Y" — the most common, and unambiguous about direction.
    new RegExp(String.raw`\bfrom\b\s*:?\s*(${PERIOD_DATE})\s*${SEP}\s*:?\s*(${PERIOD_DATE})`, 'i'),
    // "Period : X to Y" / "Statement Period X - Y"
    new RegExp(String.raw`\bperiod\b[^0-9A-Za-z]{0,12}(${PERIOD_DATE})\s*${SEP}\s*:?\s*(${PERIOD_DATE})`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const from = statementDateToYmd(m[1], order);
    const to = statementDateToYmd(m[2], order);
    if (!from || !to || from > to) continue; // a backwards pair is a mis-read, not a period
    // A statement covers days or months. Anything spanning years is something
    // else that happened to look like a date pair.
    const span = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
    if (span > 800) continue;
    return { from, to };
  }
  return null;
}

/**
 * A statement's rows, without the block of prose it signs off with.
 *
 * Banks append pages of it below the last transaction — Axis adds 28 lines of
 * legend, DICGC notice and "never share your password", each spilling across
 * the columns so it arrives looking like data. It is not data: it has no date,
 * no amount, and nothing to reconcile.
 *
 * The cut is the last row whose DATE column reads as a date. Everything after
 * it is the trailer by definition, since a transaction cannot follow the end of
 * the transactions. Undated rows BEFORE that point are kept — a blank separator
 * or a carried-over narration is still inside the table, and the caller (and
 * the server) already ignore rows they cannot date.
 *
 * With no date column chosen, or nothing in it that parses, the rows are
 * returned untouched: a mis-mapped column should show the user everything so
 * they can see the mistake, never silently empty the table.
 */
export function trimStatementTrailer<T extends Record<string, unknown>>(
  rows: T[],
  dateColumn: string | null | undefined,
): { rows: T[]; trimmed: number } {
  if (!dateColumn || !rows.length) return { rows, trimmed: 0 };
  let last = -1;
  // Deliberately order-AGNOSTIC: this only asks "where do the data rows end",
  // and it runs before the file's order is known. Testing one order would let a
  // strict miss ("4/21/26" is not a dd/mm date) read as the end of the data and
  // trim real rows off the bottom of the statement.
  const isDate = (v: unknown) => parseStatementDate(v, 'dmy') !== null || parseStatementDate(v, 'mdy') !== null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (isDate(rows[i][dateColumn])) {
      last = i;
      break;
    }
  }
  if (last < 0) return { rows, trimmed: 0 };
  return { rows: rows.slice(0, last + 1), trimmed: rows.length - 1 - last };
}

/**
 * What makes two statement lines THE SAME line.
 *
 * A bank re-issues the same transaction identically every time it is
 * downloaded, so the date, the amount and the narration together identify it.
 * The row number cannot: the same transaction sits on a different line of a
 * statement pulled over a different range. Nor can the UTR — plenty of lines
 * carry none.
 *
 * Narration is squashed to letters and digits because the same line comes back
 * with different padding between downloads ("SAVITA JAYANTIL      " vs
 * "SAVITA JAYANTIL"), and a space is not a difference worth calling a new
 * transaction.
 */
export function statementRowKey(txnDate: Date | string, amount: number, narration: string): string {
  const d = txnDate instanceof Date ? txnDate : new Date(txnDate);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const amt = (Math.round((amount + Number.EPSILON) * 100) / 100).toFixed(2);
  const text = (narration ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${day}|${amt}|${text}`;
}

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

/** One line the incoming statement shares with a working already on record. */
export interface BankStatementDuplicate {
  txnDate: string;
  amount: number;
  narration: string;
  /** How many of this exact line the file holds. */
  incoming: number;
  /** How many are already held for this bank account in the same date range. */
  onRecord: number;
  /** The workings holding them. */
  runIds: number[];
  /** True when one of those has already been posted to the ledger — importing
   *  this line again is how a receipt gets created twice. */
  posted: boolean;
}

/**
 * What to do about lines already on record.
 *
 * `ask` (the default) creates nothing and hands back the report, so the person
 * uploading decides. There is no safe automatic answer: skipping silently loses
 * a party's second identical payment of the day, and importing silently can
 * post a receipt twice.
 */
export type DuplicateAction = 'ask' | 'skip' | 'import';

/** The upload either made a working, or is waiting to be told what to do. */
export type BankStatementCreateResponse =
  | ({ outcome: 'created' } & BankStatementRunResult)
  | { outcome: 'duplicates'; duplicates: BankStatementDuplicate[]; totalIncoming: number; totalOnRecord: number };

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
  /** Lines left out of THIS run because an earlier run of the same bank account
   *  already holds them — only ever set on the response to an upload. */
  duplicateSkipped?: number;
  /** The runs those lines came from, so the message can name them. */
  duplicateOfRuns?: number[];
}

export type BankStatementRunList = Paginated<BankStatementRunDto>;

/** A run with its lines — what the review screen renders. */
export interface BankStatementRunResult {
  run: BankStatementRunDto;
  rows: BankStatementRowDto[];
  /** Every party the run touches, for the dropdown. */
  parties: { customerId: number; customerName: string; lines: number; total: number }[];
  /**
   * Receipt REF ID → the voucher number the Party Ledger prints for it.
   *
   * The reconciliation keys on the REF ID ("REC-2026-0291") because that is
   * what groups a receipt's per-invoice allocation rows. The ledger shows the
   * VOUCHER number ("RN/373"). Both name the same money, and quoting only the
   * first left the two screens impossible to line up against each other.
   */
  receiptVouchers: Record<string, string>;
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
  /** What to do about lines already held — omitted means `ask`. */
  onDuplicate?: DuplicateAction;
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

/**
 * What re-checking a run against the CURRENT ledger found.
 *
 * A run records the receipt it created for each line, but nothing stopped that
 * receipt being deleted afterwards in Receive Payment. When that happened the
 * line sat there saying POSTED for a receipt that no longer existed, and the
 * run — processed, therefore read-only — could not post it again. The money was
 * simply missing from the books with the statement still claiming it was in.
 *
 * `reopened` lists the lines whose receipt has gone; they are returned to the
 * pool so Process can create them again. Lines whose receipt still exists are
 * left POSTED and are NOT re-posted.
 */
export interface BankStatementRecheckResult {
  runId: number;
  /** Lines that were POSTED but whose receipt has since been deleted. */
  reopened: { rowId: number; rowNo: number; postedRef: string; amount: number; customerName: string }[];
  /** POSTED lines whose receipt is still there — left exactly as they are. */
  stillPosted: number;
  /** True when the run went back to DRAFT, so Process is available again. */
  reopenedRun: boolean;
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
  // Seen on real RTGS lines: "…/ICICI BANK LIMITED//SL/./BL/.//URGENT  //"
  'URGENT', 'NORMAL', 'PRIORITY', 'TRANSFER', 'REMITTANCE', 'SELFFT', 'TPFT',
  // Found by asking which fragments would point at two different parties:
  // "TOWARDS" was learnable off both ST ANTHONY and JALARAM MART.
  'TOWARDS', 'REMARK', 'REMARKS', 'DETAILS', 'DETAIL', 'INWARD', 'CLOSURE', 'MERCANTILE',
]);

/**
 * Anything in a narration that names a BANK rather than a payer.
 *
 * Nearly every one carries the word itself — "HDFC BANK", "STATE BANK OF INDIA",
 * "BANK OF MA" truncated. The rest are the eight-character forms IMPS uses
 * ("UNIONBAN", "ICICIBAN") and the lenders that do not say "bank" at all
 * ("UJJIVAN SMALL FINANC").
 */
const BANKISH = /BANK|FINANC|SAHAKARI|CO-?OP|NIDHI|MAHILA/i;
const BANK_SHORTHAND = new Set([
  'UNIONBAN', 'ICICIBAN', 'KOTAKMAH', 'HDFCBANK', 'AXISBANK', 'CANARABA', 'IDFCFIRS',
  'INDUSIND', 'YESBANK', 'IDBIBANK', 'FEDERALB', 'BANDHANB', 'UJJIVAN', 'KARURVYS',
  'SOUTHIND', 'CENTRALB', 'PUNJABNA', 'INDIANBA', 'SARASWAT', 'COSMOSBA', 'RBLBANK',
  'TAMILNAD', 'KARNATAK', 'JAMMUKAS', 'DHANLAXM', 'CITYUNIO', 'ESAFSMAL', 'EQUITASS',
]);

/**
 * The part of a narration that could name the payer.
 *
 * A NEFT/RTGS/IMPS narration is slash-delimited, and only one of those segments
 * is the person who paid. The others are the remitter's BANK and the UTR — and
 * both are poison for an alias: learn "MAHINDRA" off `KOTAK MAHINDRA BANK` and
 * every future Kotak transfer is attributed to whoever you assigned first;
 * learn "HDFCH" off the reference `HDFCH00909482619` and the same happens for
 * HDFC. Both were real outputs before this existed.
 *
 * So two kinds of segment are dropped: the bank-looking ones, and any segment
 * carrying a digit — a UTR, an account number, a date — because a payer's name
 * does not. What is left is the name, if the narration holds one at all.
 */
export function payerNarration(narration: string): string {
  return (narration ?? '')
    .split('/')
    .filter((seg) => {
      const t = seg.trim();
      if (!t) return false;
      if (/\d/.test(t)) return false; // UTR, account number, date
      if (BANKISH.test(t)) return false;
      if (BANK_SHORTHAND.has(t.toUpperCase().replace(/[^A-Z]/g, ''))) return false;
      return true;
    })
    .join('/');
}

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
  // Only the payer part: a bank name or a UTR reference in here is how an alias
  // ends up attributing a whole bank's transfers to one customer.
  const words = narrationTokens(payerNarration(narration)).filter(
    (w) => w.length >= 5 && !GENERIC_PARTY_WORDS.has(w) && !TXN_WORDS.has(w),
  );
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
