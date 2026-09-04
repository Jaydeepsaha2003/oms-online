import type { ReconStatus, ReconVchType } from '@oms/shared';
import { omsCodeCandidates, reconVchType, type ParsedLedger, type ParsedVoucher } from './tally-register.parser';

/**
 * Pairs a parsed Tally register against OMS books, one party at a time.
 *
 * The register carries the BANK leg of the account, so every comparison is made
 * against the OMS bank columns. A cash-only OMS document is therefore *not* a
 * discrepancy — Tally was never going to mention it — and is skipped rather than
 * flagged. The one exception is a Tally receipt whose particulars literally read
 * "Cash": those few rows are compared against the OMS cash leg instead, so they
 * don't read as missing.
 *
 * Matching strategy differs by voucher type because only sales invoices share a
 * document number across the two systems:
 *
 *   SALES        — by normalised invoice code (`SSS-13/26-27` ↔ `SSS/26-27/13`),
 *                  falling back to amount + date when the code is absent.
 *   RECEIPT      — amount + date, nearest date wins (cheque clearing drifts).
 *   NOTES        — amount + date + voucher type, as the user asked for.
 *   DISCOUNT     — amount + date against OMS SALES DISCOUNT.
 *   OPENING      — the party's signed bank opening as of the period start.
 *   OTHER        — Purchase / TCS Payable have no OMS counterpart: NOT_APPLICABLE.
 */

/** Rupee tolerance — Tally and OMS round GST at different points. */
const AMOUNT_TOL = 1.0;
/** Days a same-amount voucher may drift before it counts as a date mismatch. */
const DATE_TOL_DAYS = 7;
const DAY_MS = 86_400_000;

export interface OmsInvoice {
  code: string;
  invDate: Date;
  bank: number;
  cash: number;
}

export interface OmsVoucher {
  voucherNo: string;
  transDate: Date;
  /** Normalised OMS voucher type: RECEIPT | CREDIT NOTE | DEBIT NOTE | SALES DISCOUNT. */
  voucherType: string;
  particulars: string | null;
  bankDr: number;
  bankCr: number;
  cashDr: number;
  cashCr: number;
}

export interface OmsParty {
  customerId: number;
  customerName: string;
  /** Signed bank opening as of the period start: + = Dr. */
  openingBankNet: number;
  openingCashNet: number;
  /** Whether OMS holds any opening row at all for this party. */
  hasOpening: boolean;
  invoices: OmsInvoice[];
  vouchers: OmsVoucher[];
}

/** A reconciliation line, before it is persisted. */
export interface MatchRow {
  source: 'TALLY' | 'OMS';
  ledgerName: string;
  customerId: number | null;
  customerName: string | null;
  txnDate: Date;
  vchType: ReconVchType;
  vchNo: string;
  particulars: string | null;
  dr: number;
  cr: number;
  status: ReconStatus;
  omsRef: string | null;
  omsAmount: number | null;
  omsDate: Date | null;
  /** The bank OMS booked the match to — the other half of a BANK_MISMATCH,
   *  whose Tally side is already in `particulars`. */
  omsBank: string | null;
  note: string | null;
}

/* ── name normalisation ───────────────────────────────────────────────────── */

/** Words that carry no identity and differ freely between the two systems. */
const NOISE = /\b(PVT|PVTLTD|PRIVATE|LTD|LIMITED|LLP|CO|COMPANY|THE|AND|OLD|NEW)\b/g;

/** Aggressive key for fuzzy party matching: letters and digits only. */
export function nameKey(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, '');
}

/** Looser key kept separately so an exact hit is always preferred over this. */
export function exactKey(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, ' ').trim();
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

const near = (a: number, b: number) => Math.abs(a - b) <= AMOUNT_TOL;
const dayGap = (a: Date, b: Date) => Math.round(Math.abs(a.getTime() - b.getTime()) / DAY_MS);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The signed value a Tally row carries, Dr positive. */
const tallyNet = (v: ParsedVoucher) => r2(v.debit - v.credit);

/** Is this Tally receipt against the cash book rather than a bank? */
const isCashReceipt = (v: ParsedVoucher) => /^cash$/i.test((v.particulars ?? '').trim());

/**
 * Picks the best unconsumed candidate by amount then date proximity.
 * Returns the index into `pool`, or -1.
 */
function pickByAmountDate<T>(
  pool: T[],
  used: Set<number>,
  amount: number,
  date: Date,
  amountOf: (t: T) => number,
  dateOf: (t: T) => Date,
): number {
  let best = -1;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pool.length; i += 1) {
    if (used.has(i)) continue;
    if (!near(amountOf(pool[i]), amount)) continue;
    const gap = dayGap(dateOf(pool[i]), date);
    if (gap < bestGap) {
      best = i;
      bestGap = gap;
    }
  }
  return best;
}

/*
 * Which BANK a name refers to, ignoring how each side happens to spell it.
 *
 * The two sides never spell it the same way. Tally names the ledger — "AXIS
 * BANK LTD", "ICICI BANK" — while OMS names the account — "AXIS BANK-0884",
 * "AXIS BANK-7DAA", "ICICI BANK-1389". Comparing the raw strings would report
 * every matched receipt as a bank mismatch, which is worse than not checking
 * at all.
 *
 * So each side is reduced to its identifying word: AXIS, ICICI, PNB. Account
 * tails go (any token carrying a digit — "0884", "7DAA"), and so do the words
 * every bank name shares, which therefore identify nothing.
 *
 * One cost is accepted deliberately: two different accounts at the SAME bank
 * read as equal, because Tally's side carries no account number at all and
 * there is nothing to tell them apart on. Silent beats confidently wrong.
 */
const BANK_NOISE = new Set([
  'BANK', 'LTD', 'LIMITED', 'PVT', 'PRIVATE', 'CO', 'COMPANY', 'THE', 'OF', 'AC', 'ACC',
  'CURRENT', 'CA', 'CC', 'OD', 'SAVING', 'SAVINGS', 'INDIA', 'BRANCH', 'BR',
]);

function bankIdentity(name: string | null | undefined): string {
  return (name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w && !/[0-9]/.test(w) && !BANK_NOISE.has(w))
    .join(' ');
}

/** MATCHED unless the dates drifted further than tolerance allows. */
function dateVerdict(a: Date, b: Date): { status: ReconStatus; note: string | null } {
  const gap = dayGap(a, b);
  if (gap === 0) return { status: 'MATCHED', note: null };
  if (gap <= DATE_TOL_DAYS) return { status: 'MATCHED', note: `Dates differ by ${gap} day${gap === 1 ? '' : 's'}.` };
  return { status: 'DATE_MISMATCH', note: `Dates differ by ${gap} days.` };
}

const fmtDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`;

/* ── the per-party reconciliation ─────────────────────────────────────────── */

/**
 * @param ledger  one party's block from the register
 * @param oms     the same party's OMS books over the register's period, or null
 *                when no OMS customer could be resolved
 */
export function reconcileParty(ledger: ParsedLedger, oms: OmsParty | null, periodFrom: Date): MatchRow[] {
  const out: MatchRow[] = [];
  const base = {
    ledgerName: ledger.ledgerName,
    customerId: oms?.customerId ?? null,
    customerName: oms?.customerName ?? null,
  };

  // ── unresolved party: report the register's rows so the total still ties, but
  //    there is nothing to compare them against.
  if (!oms) {
    if (ledger.openingNet != null) {
      out.push({
        ...base,
        source: 'TALLY',
        txnDate: ledger.openingDate ?? periodFrom,
        vchType: 'OPENING',
        vchNo: 'Opening Balance',
        particulars: 'Opening Balance',
        omsBank: null,
        dr: ledger.openingNet > 0 ? r2(ledger.openingNet) : 0,
        cr: ledger.openingNet < 0 ? r2(-ledger.openingNet) : 0,
        status: 'UNMATCHED_PARTY',
        omsRef: null,
        omsAmount: null,
        omsDate: null,
        note: 'No OMS customer is mapped to this Tally ledger name.',
      });
    }
    for (const v of ledger.vouchers) {
      out.push({
        ...base,
        source: 'TALLY',
        txnDate: v.txnDate,
        omsBank: null,
        vchType: reconVchType(v.vchType, v.particulars) as ReconVchType,
        vchNo: v.vchNo,
        particulars: v.particulars,
        dr: r2(v.debit),
        cr: r2(v.credit),
        status: 'UNMATCHED_PARTY',
        omsRef: null,
        omsAmount: null,
        omsDate: null,
        note: 'No OMS customer is mapped to this Tally ledger name.',
      });
    }
    return out;
  }

  /* ── 1) opening balance ─────────────────────────────────────────────────── */
  const tOpen = r2(ledger.openingNet ?? 0);
  // A party that starts at nil on both sides has nothing to reconcile — reporting
  // "0.00 vs 0.00" as a discrepancy is pure noise in a 800-row report.
  const openingWorthReporting =
    (ledger.openingNet != null || oms.hasOpening) && !(Math.abs(tOpen) <= 0.004 && Math.abs(oms.openingBankNet) <= 0.004);
  if (openingWorthReporting) {
    const t = tOpen;
    const o = r2(oms.openingBankNet);
    const row: MatchRow = {
      ...base,
      source: 'TALLY',
      txnDate: ledger.openingDate ?? periodFrom,
      vchType: 'OPENING',
      vchNo: 'Opening Balance',
      particulars: 'Opening Balance',
      omsBank: null,
      dr: t > 0 ? t : 0,
      cr: t < 0 ? -t : 0,
      status: 'MATCHED',
      omsRef: 'Opening Balance',
      omsAmount: o,
      omsDate: null,
      note: null,
    };
    if (ledger.openingNet == null) {
      row.status = 'MISSING_IN_TALLY';
      row.source = 'OMS';
      row.note = `OMS carries a bank opening of ${o.toFixed(2)}; the register shows none.`;
    } else if (!oms.hasOpening) {
      row.status = 'MISSING_IN_OMS';
      row.note = 'The register has an opening balance; OMS has no opening row for this party.';
    } else if (!near(t, o)) {
      row.status = 'AMOUNT_MISMATCH';
      row.note = `Tally ${t.toFixed(2)} vs OMS ${o.toFixed(2)} — difference ${r2(t - o).toFixed(2)}.`;
    }
    out.push(row);
  }

  /* ── 2) sales invoices, by document number ──────────────────────────────── */
  // Only bank-leg invoices are comparable; a pure-cash sale is invisible to Tally.
  const bankInvoices = oms.invoices.filter((i) => Math.abs(i.bank) > 0.004);
  const invByCode = new Map<string, number>();
  bankInvoices.forEach((i, idx) => invByCode.set(i.code.toUpperCase(), idx));
  const invUsed = new Set<number>();

  const tallySales = ledger.vouchers.filter((v) => reconVchType(v.vchType, v.particulars) === 'SALES');
  for (const v of tallySales) {
    const amt = tallyNet(v);
    let idx = -1;
    for (const cand of omsCodeCandidates(v.vchNo)) {
      const hit = invByCode.get(cand);
      if (hit !== undefined && !invUsed.has(hit)) {
        idx = hit;
        break;
      }
    }
    let note: string | null = null;
    if (idx < 0) {
      // The number didn't line up — fall back to amount + date so a differently
      // numbered but genuinely present invoice isn't reported as missing.
      idx = pickByAmountDate(bankInvoices, invUsed, amt, v.txnDate, (i) => i.bank, (i) => i.invDate);
      if (idx >= 0) note = `Matched on amount and date; invoice number differs (OMS ${bankInvoices[idx].code}).`;
    }
    const row: MatchRow = {
      ...base,
      source: 'TALLY',
      txnDate: v.txnDate,
      vchType: 'SALES',
      vchNo: v.vchNo,
      particulars: v.particulars,
      dr: r2(v.debit),
      cr: r2(v.credit),
      status: 'MISSING_IN_OMS',
      omsRef: null,
      omsAmount: null,
      omsDate: null,
      omsBank: null,
      note: 'No matching confirmed sales invoice in OMS.',
    };
    if (idx >= 0) {
      invUsed.add(idx);
      const inv = bankInvoices[idx];
      row.omsRef = inv.code;
      row.omsAmount = r2(inv.bank);
      row.omsDate = inv.invDate;
      if (!near(amt, inv.bank)) {
        row.status = 'AMOUNT_MISMATCH';
        row.note = `Tally ${amt.toFixed(2)} vs OMS ${r2(inv.bank).toFixed(2)} — difference ${r2(amt - inv.bank).toFixed(2)}.`;
      } else {
        const verdict = dateVerdict(v.txnDate, inv.invDate);
        row.status = verdict.status;
        row.note = note ?? verdict.note;
        if (note && verdict.note) row.note = `${note} ${verdict.note}`;
      }
    }
    out.push(row);
  }

  // OMS invoices the register never mentioned.
  bankInvoices.forEach((inv, idx) => {
    if (invUsed.has(idx)) return;
    out.push({
      ...base,
      source: 'OMS',
      txnDate: inv.invDate,
      vchType: 'SALES',
      vchNo: inv.code,
      particulars: 'Sales invoice present in OMS only',
      omsBank: null,
      dr: r2(inv.bank),
      cr: 0,
      status: 'MISSING_IN_TALLY',
      omsRef: inv.code,
      omsAmount: r2(inv.bank),
      omsDate: inv.invDate,
      note: `Not present in the register for ${fmtDate(inv.invDate)}.`,
    });
  });

  /* ── 3) receipts, notes and discounts, by amount + date + type ──────────── */
  // OMS voucher type → the recon vocabulary, so a Tally CREDIT NOTE is only ever
  // considered against an OMS credit note.
  const omsTypeOf = (v: OmsVoucher): ReconVchType => {
    const t = v.voucherType.trim().toUpperCase();
    if (t === 'RECEIPT') return 'RECEIPT';
    if (t === 'CREDIT NOTE') return 'CREDIT NOTE';
    if (t === 'DEBIT NOTE') return 'DEBIT NOTE';
    if (t.includes('DISCOUNT')) return 'DISCOUNT';
    return 'OTHER';
  };

  // The absolute bank value a voucher moves; notes and receipts sit on opposite
  // sides, so compare magnitudes and let the type carry the direction.
  const bankMag = (v: OmsVoucher) => r2(Math.abs(v.bankDr - v.bankCr));
  const cashMag = (v: OmsVoucher) => r2(Math.abs(v.cashDr - v.cashCr));

  const vchUsed = new Set<number>();
  const MATCHABLE: ReconVchType[] = ['RECEIPT', 'CREDIT NOTE', 'DEBIT NOTE', 'DISCOUNT'];

  for (const v of ledger.vouchers) {
    const type = reconVchType(v.vchType, v.particulars) as ReconVchType;
    if (type === 'SALES') continue;
    const amtSigned = tallyNet(v);
    const amt = Math.abs(amtSigned);

    const row: MatchRow = {
      ...base,
      source: 'TALLY',
      txnDate: v.txnDate,
      vchType: type,
      vchNo: v.vchNo,
      particulars: v.particulars,
      dr: r2(v.debit),
      cr: r2(v.credit),
      status: 'MISSING_IN_OMS',
      omsRef: null,
      omsAmount: null,
      omsDate: null,
      omsBank: null,
      note: null,
    };

    if (!MATCHABLE.includes(type)) {
      // Purchase, TCS Payable and friends: OMS has no such voucher by design.
      row.status = 'NOT_APPLICABLE';
      row.note = `${v.vchType} has no OMS counterpart — informational only.`;
      out.push(row);
      continue;
    }

    const cash = type === 'RECEIPT' && isCashReceipt(v);
    const magOf = cash ? cashMag : bankMag;
    // Candidate pool: unconsumed OMS vouchers of the same recon type.
    const pool = oms.vouchers;
    let idx = -1;
    let bestGap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pool.length; i += 1) {
      if (vchUsed.has(i) || omsTypeOf(pool[i]) !== type) continue;
      if (!near(magOf(pool[i]), amt)) continue;
      const gap = dayGap(pool[i].transDate, v.txnDate);
      if (gap < bestGap) {
        idx = i;
        bestGap = gap;
      }
    }

    if (idx < 0) {
      row.note =
        type === 'RECEIPT'
          ? `No OMS receipt of ${amt.toFixed(2)} near ${fmtDate(v.txnDate)} — can be entered from this report.`
          : `No OMS ${type.toLowerCase()} of ${amt.toFixed(2)} near ${fmtDate(v.txnDate)}.`;
      if (cash) row.note = `${row.note} (Register shows this against Cash, not a bank.)`;
      out.push(row);
      continue;
    }

    vchUsed.add(idx);
    const m = pool[idx];
    row.omsRef = m.voucherNo;
    row.omsAmount = magOf(m);
    row.omsDate = m.transDate;
    const verdict = dateVerdict(v.txnDate, m.transDate);
    row.status = verdict.status;
    row.note = cash ? `Matched against the OMS cash leg. ${verdict.note ?? ''}`.trim() : verdict.note;

    /*
     * Same party, same figures, same date — different bank.
     *
     * That reconciles on paper and still leaves two bank books wrong, so it is
     * reported rather than passed as MATCHED.
     *
     * Only where BOTH sides actually name a bank. Skipped for the cash leg (the
     * register said "Cash", so there is no bank to disagree about) and where the
     * OMS voucher moved no bank money — its `particulars` is then a cash
     * narration like "CASH RECEIPT BY BANK / SHADAB", which is not a bank name
     * and would produce a nonsense mismatch. Skipped too when either side
     * reduces to nothing identifying, rather than guessing.
     */
    if (!cash && bankMag(m) > 0.004) {
      row.omsBank = m.particulars;
      const tallyBank = bankIdentity(v.particulars);
      const omsBankId = bankIdentity(m.particulars);
      if (tallyBank && omsBankId && tallyBank !== omsBankId) {
        const remark = `Tally banked this to ${(v.particulars ?? '').trim()}; OMS recorded ${(m.particulars ?? '').trim()}.`;
        // A wrong amount or a wrong date is the bigger fault and keeps the
        // status; the bank remark is appended so it is not lost behind it.
        if (row.status === 'MATCHED') row.status = 'BANK_MISMATCH';
        row.note = [row.note, remark].filter(Boolean).join(' ');
      }
    }
    out.push(row);
  }

  // OMS vouchers the register never mentioned — bank leg only.
  oms.vouchers.forEach((m, idx) => {
    if (vchUsed.has(idx)) return;
    const type = omsTypeOf(m);
    if (!MATCHABLE.includes(type)) return;
    const mag = bankMag(m);
    // A cash-only voucher was never going to appear in a bank register.
    if (mag <= 0.004) return;
    out.push({
      ...base,
      source: 'OMS',
      txnDate: m.transDate,
      vchType: type,
      vchNo: m.voucherNo,
      particulars: m.particulars ?? `${type} present in OMS only`,
      dr: r2(m.bankDr),
      cr: r2(m.bankCr),
      status: 'MISSING_IN_TALLY',
      omsRef: m.voucherNo,
      omsAmount: mag,
      omsDate: m.transDate,
      // The bank OMS used, so a MISSING_IN_TALLY line says which book it is in.
      omsBank: m.particulars,
      note: `Not present in the register for ${fmtDate(m.transDate)}.`,
    });
  });

  return out;
}
