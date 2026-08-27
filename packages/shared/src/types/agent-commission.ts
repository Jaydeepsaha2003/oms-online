/**
 * Agent commission, cheque bounce history and settlement.
 *
 * A self-contained subsystem. The one rule that shapes everything here: an
 * agent's money and a party's money never mix. When an agent personally covers
 * a defaulting party (see {@link AgentPartyCoverDto}) the party's outstanding is
 * deliberately left untouched, because the party still owes it — the agent has
 * merely fronted the cash, and gets it back if the party ever pays.
 */

import type { Paginated, PaginationQuery } from './common';

/* ── Rate master ─────────────────────────────────────────────────────────── */

/**
 * What an agent earns per unit of a given product category.
 *
 * The unit is the category's own: categories are priced by weight or by piece
 * (the KGS/PCS calc field the product master already carries), and commission
 * follows the same basis — ₹/kg on GLASS, ₹/pcs on GLASS (PCS). Charging a
 * per-piece category by weight would be meaningless.
 *
 * Date-effective rather than a single editable number: a settlement run in
 * August must price a April invoice at April's rate. Saving a new rate never
 * rewrites history, it supersedes from `effectiveFrom` onward.
 */
export interface AgentCommissionRateDto {
  id: number;
  agentId: number;
  agentName: string;
  /** Challan LINE category (e.g. "GLASS"), not the customer's own category. */
  pCategory: string;
  /** Whether `ratePerUnit` is ₹ per kg or ₹ per piece. */
  basis: CommissionBasis;
  ratePerUnit: number;
  effectiveFrom: string;
  note: string | null;
  /** True for the row currently in force for this agent + category. */
  current: boolean;
  /**
   * When true, this rate is ALSO added onto the product price the customer
   * pays (the order form folds it into Product ₹) — not just paid to the agent
   * out of margin at settlement. The agent's accrual and settlement are
   * unchanged either way.
   *
   * A base rate names no party, so this reaches EVERY party the agent sells to
   * in this category. A party-level Special Commission that matches a line
   * replaces this rate outright and brings its own flag, so the two never add
   * together.
   */
  addToRate: boolean;
  createdAt: string;
}

export interface AgentCommissionRateInput {
  agentId: number;
  pCategory: string;
  basis: CommissionBasis;
  ratePerUnit: number;
  effectiveFrom: string;
  note?: string | null;
  /** Defaults to false — see {@link AgentCommissionRateDto.addToRate}. */
  addToRate?: boolean;
}

/**
 * One agent × category square of the rate master, showing whether it is priced
 * AND whether the agent actually sells it.
 *
 * The pairing is the point: an un-priced category earns the agent nothing and
 * says nothing while doing it, so the only way to spot the omission is to put
 * what they sell next to what they're paid for.
 */
export interface AgentRateCoverageRow {
  agentId: number;
  agentName: string;
  pCategory: string;
  /** Confirmed invoices this agent's parties have taken in this category. */
  invoiceCount: number;
  kgs: number;
  pcs: number;
  /** The OLDEST confirmed invoice in this pairing — how far back an unpriced
   *  one reaches, i.e. since when it has been earning the agent nothing. */
  firstInvoiceDate: string | null;
  /** That invoice's number, so it can be looked up. */
  firstInvoiceNo: string | null;
  lastInvoiceDate: string | null;
  /** The rate in force today, or null when nothing is set. */
  ratePerUnit: number | null;
  basis: CommissionBasis | null;
  effectiveFrom: string | null;
  /** How the product master prices this category — the unit a rate should use. */
  suggestedBasis: CommissionBasis | null;
  /** Sells it but isn't paid for it: this invoicing earns nothing at all. */
  gap: boolean;
  /** True when the rate in force is charged through to customers — see
   *  {@link AgentCommissionRateDto.addToRate}. False when nothing is set. */
  addToRate: boolean;
}

/** Same two units the product category master already uses for pricing. */
export const COMMISSION_BASES = ['KGS', 'PCS'] as const;
export type CommissionBasis = (typeof COMMISSION_BASES)[number];

/** "kg" / "pcs" — for labelling a rate or a quantity in the UI. */
export const basisUnit = (basis: CommissionBasis): string => (basis === 'PCS' ? 'pcs' : 'kg');

/** The quantity a category's commission is charged on. */
export const commissionQty = (basis: CommissionBasis, kgs: number, pcs: number): number =>
  basis === 'PCS' ? pcs : kgs;

/* ── Accrual & eligibility ───────────────────────────────────────────────── */

/**
 * One invoice's gross commission for an agent, per category.
 *
 * `amount` is the ENTITLEMENT (qty × rate). What is actually payable is that
 * figure scaled by how much of the invoice the party has really paid — see
 * `paidRatio`. Commission therefore grows on its own as collections come in,
 * with no re-run needed.
 */
export interface AgentCommissionAccrualDto {
  id: number;
  agentId: number;
  agentName: string;
  challanId: number;
  invNo: string;
  customerId: number | null;
  customerName: string;
  pCategory: string;
  /** Which unit this category is commissioned in. */
  basis: CommissionBasis;
  /** The quantity charged on — kilos or pieces, per `basis`. */
  qty: number;
  /** Both totals are kept whatever the basis, so the figure can be checked
   *  against the invoice without re-reading the challan lines. */
  kgs: number;
  pcs: number;
  ratePerUnit: number;
  /** qty × ratePerUnit — before any payment or owner adjustment. */
  amount: number;
  invDate: string;
  dueDate: string | null;
  /* ── live payment state, derived at read time ── */
  invoiceAmount: number;
  paidAmount: number;
  /** 0–1. Commission is pro-rata on this (0.6 = 60% collected → 60% earned). */
  paidRatio: number;
  /** amount × paidRatio — what this invoice is worth right now. */
  earnedAmount: number;
  /** Days past the party's due date, negative when still within terms. Drives
   *  the owner's discretion to pay a reduced rate on a badly delayed bill. */
  overdueDays: number | null;
  /** Nothing left to claim at the party's CURRENT payment level. Goes back to
   *  false on its own if the party pays more later. */
  settled: boolean;
  /** Share of this invoice already paid commission on (0–1). */
  settledRatio: number;
  /** Commission already handed over for it. */
  settledAmount: number;
  /** Share now claimable — the party has paid this much more since last time. */
  payableRatio: number;
  /** Which rule priced this — "Base rate", a special's label, or
   *  "blended (n rules)" when the invoice's lines in this category did not all
   *  price the same. Audit only. Null on rows accrued before it was tracked. */
  rateNote?: string | null;
}

/**
 * Which rows of the commission ledger to show.
 *
 * `CLAIMED` and `UNPAID` both mean "nothing claimable right now", but for
 * opposite reasons — the agent has already been paid for it, versus the party
 * has not paid at all. The old vocabulary had one value (`SETTLED`) covering
 * both, which reads as "this is dealt with" over invoices where nobody has paid
 * anybody. `UNSETTLED`/`SETTLED` are still accepted as aliases for CLAIMABLE and
 * "not claimable".
 */
export const ACCRUAL_STATES = ['CLAIMABLE', 'CLAIMED', 'UNPAID', 'ALL'] as const;
export type AccrualState = (typeof ACCRUAL_STATES)[number];

export type AgentCommissionQuery = PaginationQuery & {
  agentId?: number;
  customerId?: number;
  pCategory?: string;
  dateFrom?: string;
  dateTo?: string;
  /** CLAIMABLE (default) | CLAIMED | UNPAID | ALL — see {@link ACCRUAL_STATES}. */
  settledState?: AccrualState | string;
};
export type AgentCommissionAccrualList = Paginated<AgentCommissionAccrualDto>;

/* ── Agent covering a defaulting party ───────────────────────────────────── */

/** How the agent handed the money over, or asked for it to be handled. */
export const AGENT_COVER_MODES = ['CASH', 'BANK', 'COMMISSION_ADJUST'] as const;
export type AgentCoverMode = (typeof AGENT_COVER_MODES)[number];

export const AGENT_COVER_STATUSES = ['OPEN', 'RECOVERED', 'WRITTEN_OFF'] as const;
export type AgentCoverStatus = (typeof AGENT_COVER_STATUSES)[number];

/**
 * The agent personally covered an amount a party would not pay.
 *
 * This is NOT a party payment and must never be recorded as one: the party's
 * ledger keeps showing the money as receivable. If the party eventually pays,
 * the cover moves to RECOVERED and the agent is reimbursed — which is why the
 * party and invoice links are kept.
 */
export interface AgentPartyCoverDto {
  id: number;
  agentId: number;
  agentName: string;
  customerId: number | null;
  customerName: string;
  invNo: string | null;
  amount: number;
  mode: AgentCoverMode;
  coveredAt: string;
  remarks: string | null;
  status: AgentCoverStatus;
  recoveredAt: string | null;
  recoveredVia: string | null;
  /** Live: what the party still owes on the covered invoice. Once this reaches
   *  zero the party has paid and the agent is due a refund. */
  partyStillOwes: number | null;
  createdAt: string;
}

export interface AgentPartyCoverInput {
  agentId: number;
  customerId?: number | null;
  customerName: string;
  invNo?: string | null;
  amount: number;
  mode: AgentCoverMode;
  coveredAt: string;
  remarks?: string | null;
}

export type AgentPartyCoverList = Paginated<AgentPartyCoverDto>;

/* ── Cheque bounce ───────────────────────────────────────────────────────── */

/**
 * One bank bounce. A cheque can be deposited and bounce any number of times,
 * and each attempt earns its own charge — so these are separate records, never
 * a running total on the cheque.
 */
export interface ChequeBounceEventDto {
  id: number;
  chequeId: number;
  chequeNo: string;
  partyName: string;
  /** Null when the party handed the cheque over directly. */
  agentId: number | null;
  agentName: string | null;
  bounceDate: string;
  bankName: string | null;
  charge: number;
  gstPercent: number;
  /** charge + GST, frozen at the time — a later change to the bank's configured
   *  rate must not rewrite what was actually charged. */
  totalCharge: number;
  reason: string | null;
  /** Photo of the bank's bounce memo — the proof when an agent disputes it. */
  receiptUrl: string | null;
  /** Already deducted on a PAID settlement. */
  recovered: boolean;
  createdAt: string;
}

export interface ChequeBounceEventInput {
  chequeId: number;
  bounceDate: string;
  bankName?: string | null;
  /** Omit to take the bank's configured charge + GST. */
  charge?: number;
  gstPercent?: number;
  reason?: string | null;
  receiptUrl?: string | null;
  receiptPath?: string | null;
}

/** Bank-wise bounce charge, e.g. Axis ₹100 + 18% GST = ₹118. */
export interface BankBounceChargeDto {
  id: number;
  bankName: string;
  charge: number;
  gstPercent: number;
  /** charge × (1 + gst/100) — what a bounce on this bank will cost. */
  total: number;
  updatedAt: string;
}

export interface BankBounceChargeInput {
  bankName: string;
  charge: number;
  gstPercent: number;
}

/* ── Cheque timing analysis ──────────────────────────────────────────────── */

/**
 * Is the cheque the agent brought dated later than the party was due to pay?
 * Purely derived — surfaced when the cheque is entered so the owner can push
 * back on the spot and ask for an NEFT/RTGS instead.
 */
export interface ChequeTimingDto {
  /** 0 while the cheque is still being typed and hasn't been saved yet. */
  chequeId: number;
  chequeNo: string;
  chequeDate: string;
  chequeAmount: number;
  partyName: string;
  agentName: string | null;
  /** Earliest due date among the invoices this cheque is tagged against. */
  expectedDueDate: string | null;
  /** Positive = the cheque is dated this many days beyond the due date. */
  delayDays: number | null;
  /** What the party actually owes right now. */
  partyOutstanding: number;
  invoiceNos: string[];
  /** The party's configured credit period, shown so the owner can see the terms
   *  the expected date was derived from. */
  creditPeriodDays: number | null;
  /** Where `expectedDueDate` came from, so the screen can say it plainly:
   *  the invoice carried its own due date, or it was derived from the party's
   *  credit period, or there was nothing outstanding to date it against. */
  dueBasis: ChequeDueBasis;
  /** The oldest unpaid invoice's date — the clock the credit period runs from. */
  oldestInvoiceDate: string | null;
  /** True when the cheque is for less than the party currently owes. */
  coversOutstanding: boolean;
}

export const CHEQUE_DUE_BASES = ['INVOICE_DUE_DATE', 'CREDIT_PERIOD', 'NONE'] as const;
export type ChequeDueBasis = (typeof CHEQUE_DUE_BASES)[number];

/** How late is late enough to say something. Below this the cheque is treated
 *  as on-time — a day or two either way is not worth an argument. */
export const CHEQUE_DELAY_TOLERANCE_DAYS = 3;

export type ChequeTimingVerdict = 'ON_TIME' | 'LATE' | 'UNKNOWN';

export function chequeTimingVerdict(delayDays: number | null): ChequeTimingVerdict {
  if (delayDays == null) return 'UNKNOWN';
  return delayDays > CHEQUE_DELAY_TOLERANCE_DAYS ? 'LATE' : 'ON_TIME';
}

/**
 * The expected date a party's money should arrive: the invoice's own due date
 * when it carries one, otherwise its date plus the party's credit period.
 * Returns null when neither is known.
 */
export function expectedPaymentDate(invoiceDate: Date | string | null, invoiceDueDate: Date | string | null, creditPeriodDays: number | null): Date | null {
  if (invoiceDueDate) return new Date(invoiceDueDate);
  if (!invoiceDate || creditPeriodDays == null) return null;
  const d = new Date(invoiceDate);
  d.setDate(d.getDate() + creditPeriodDays);
  return d;
}

/** Whole days from `from` to `to` — positive when `to` is later. */
export function daysBetween(from: Date | string, to: Date | string): number {
  const a = new Date(from);
  const b = new Date(to);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/* ── Settlement ──────────────────────────────────────────────────────────── */

/**
 * How many invoices a rate change re-priced, reported back so the screen can say
 * what actually happened instead of "saved".
 *
 * Pricing is a consequence of the rate change itself — there is no separate
 * "re-price" step to remember, and nothing to forget.
 */
export interface RepriceResult {
  /** Invoices re-examined. */
  challans: number;
  /** Commission rows written across them. */
  accruals: number;
}

export const AGENT_SETTLEMENT_STATUSES = ['DRAFT', 'PAID', 'CANCELLED'] as const;
export type AgentSettlementStatus = (typeof AGENT_SETTLEMENT_STATUSES)[number];

/** TDS is deducted on bank transfers only — cash settlements carry none. */
export const AGENT_PAY_MODES = ['CASH', 'BANK'] as const;
export type AgentPayMode = (typeof AGENT_PAY_MODES)[number];

/** Default TDS on a bank commission payout. */
export const AGENT_TDS_PERCENT = 2;

/**
 * One line of a settlement: an invoice, and what the owner decided it's worth.
 *
 * Both rates are kept. `baseRatePerKg` is what the master says; `appliedRatePerKg`
 * is what was actually paid — the owner may cut ₹40/kg to ₹20 or ₹0 on a badly
 * delayed bill. Keeping the pair plus `reason` is what makes that decision
 * defensible months later.
 */
export interface AgentSettlementLineDto {
  id: number;
  challanId: number | null;
  invNo: string;
  customerName: string;
  pCategory: string;
  /** Whether the quantity and rates below are in kilos or pieces. */
  basis: CommissionBasis;
  qty: number;
  baseRatePerUnit: number;
  appliedRatePerUnit: number;
  /**
   * The SHARE OF THE INVOICE THIS LINE PAYS FOR — not the invoice's running
   * total. On a first settlement the two are the same; on a top-up this is only
   * the extra the party has paid since. Summing this across paid lines is how
   * the engine knows what's left to claim.
   */
  paidRatio: number;
  invoiceAmount: number;
  paidAmount: number;
  /** qty × appliedRatePerUnit × paidRatio. */
  amount: number;
  reason: string | null;
  overdueDays: number | null;
  /** This line is the balance on an invoice already part-settled (§2 top-up). */
  isTopUp?: boolean;
  /** How much of the invoice had already been paid commission on before this. */
  previouslySettledRatio?: number;
  /** And what the agent already received for it. */
  previouslySettledAmount?: number;
}

/**
 * The share of an invoice still claimable: what the party has paid, less what
 * the agent has already been paid commission on. Never negative — a reversed
 * receipt can leave the settled share ahead of the collected one.
 */
export function claimableRatio(paidRatio: number, settledRatio: number): number {
  const paid = Math.max(0, Math.min(1, paidRatio));
  const done = Math.max(0, Math.min(1, settledRatio));
  return Math.max(0, Math.round((paid - done) * 10000) / 10000);
}

/** Ratios are carried at 4 dp, so anything under half a basis point is noise. */
export const RATIO_EPSILON = 0.00005;

export const AGENT_DEDUCTION_KINDS = ['BOUNCE', 'COVER', 'MANUAL'] as const;
export type AgentDeductionKind = (typeof AGENT_DEDUCTION_KINDS)[number];

/** One deduction, traceable to the bounce or cover it came from. */
export interface AgentSettlementDeductionDto {
  id: number;
  kind: AgentDeductionKind;
  bounceEventId: number | null;
  coverId: number | null;
  chequeNo: string | null;
  bankName: string | null;
  refDate: string | null;
  amount: number;
  note: string | null;
}

export interface AgentSettlementDto {
  id: number;
  code: string | null;
  agentId: number;
  agentName: string;
  periodFrom: string;
  periodTo: string;
  grossCommission: number;
  bounceDeduction: number;
  coverDeduction: number;
  otherDeduction: number;
  payMode: AgentPayMode | null;
  tdsPercent: number;
  tdsAmount: number;
  /** gross − deductions − TDS. */
  netPayable: number;
  status: AgentSettlementStatus;
  paidAt: string | null;
  remarks: string | null;
  lines: AgentSettlementLineDto[];
  deductions: AgentSettlementDeductionDto[];
  createdAt: string;
  updatedAt: string;
}

/** What a settlement WOULD look like — computed live, nothing written. Lets the
 *  owner adjust rates and deductions before committing to a draft. */
export interface AgentSettlementPreview {
  agentId: number;
  agentName: string;
  periodFrom: string;
  periodTo: string;
  lines: AgentSettlementLineDto[];
  /** Bounce charges on cheques this agent brought in, not yet recovered. */
  bounceCandidates: ChequeBounceEventDto[];
  /** Still-open covers that could be recouped here. */
  coverCandidates: AgentPartyCoverDto[];
  grossCommission: number;
}

export interface AgentSettlementInput {
  agentId: number;
  periodFrom: string;
  periodTo: string;
  payMode?: AgentPayMode | null;
  tdsPercent?: number;
  remarks?: string | null;
  lines: {
    challanId?: number | null;
    invNo: string;
    customerName: string;
    pCategory: string;
    basis: CommissionBasis;
    qty: number;
    baseRatePerUnit: number;
    appliedRatePerUnit: number;
    paidRatio: number;
    invoiceAmount: number;
    paidAmount: number;
    amount: number;
    reason?: string | null;
    isTopUp?: boolean;
    previouslySettledRatio?: number;
  }[];
  deductions: {
    kind: AgentDeductionKind;
    bounceEventId?: number | null;
    coverId?: number | null;
    chequeNo?: string | null;
    bankName?: string | null;
    refDate?: string | null;
    amount: number;
    note?: string | null;
  }[];
}

export type AgentSettlementQuery = PaginationQuery & {
  agentId?: number;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
};
export type AgentSettlementList = Paginated<AgentSettlementDto>;

/* ── Shared maths, so API and UI can never disagree ──────────────────────── */

/** Commission actually earned on one invoice line. `qty` is kilos or pieces
 *  depending on the category's basis — the rate is per that same unit. */
export const earnedCommission = (qty: number, ratePerUnit: number, paidRatio: number): number =>
  Math.round(qty * ratePerUnit * Math.max(0, Math.min(1, paidRatio)) * 100) / 100;

/** A bank's total bounce charge, GST included. */
export const bounceTotal = (charge: number, gstPercent: number): number =>
  Math.round(charge * (1 + gstPercent / 100) * 100) / 100;

/** Net payable to the agent: gross, less deductions, less TDS (bank only). */
export function settlementNet(input: {
  grossCommission: number;
  bounceDeduction: number;
  coverDeduction: number;
  otherDeduction: number;
  payMode: AgentPayMode | null;
  tdsPercent: number;
}): { taxable: number; tdsAmount: number; netPayable: number } {
  const afterDeductions =
    input.grossCommission - input.bounceDeduction - input.coverDeduction - input.otherDeduction;
  const taxable = Math.max(0, Math.round(afterDeductions * 100) / 100);
  // Cash settlements carry no TDS, per the process doc.
  const tdsAmount = input.payMode === 'BANK' ? Math.round(taxable * (input.tdsPercent / 100) * 100) / 100 : 0;
  return { taxable, tdsAmount, netPayable: Math.round((taxable - tdsAmount) * 100) / 100 };
}
