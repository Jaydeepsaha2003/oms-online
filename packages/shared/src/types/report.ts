/**
 * Reports module — read-only business-intelligence shapes.
 *
 * These power the Reports section (Business Overview, Sales & Revenue, Collections,
 * Party Intelligence, Product & Design, Patterns, Orders & Fulfilment). Every money
 * figure is plain rupees. Revenue is CONFIRMED challan value (SALES INVOICE / DEBIT
 * NOTE); collections are receipt amounts; outstanding is billed − collected.
 *
 * Period comparisons reuse {@link PeriodMetric} from analytics (current vs the same
 * elapsed slice of the prior period).
 */

import type { PeriodMetric } from './analytics';

/** Filters every report accepts. All optional — omitted means "no restriction".
 *  `from`/`to` scope the natural date column (invoice date, receipt date, order
 *  date); `customerId`/`agent`/`region` scope the party population. */
export interface ReportFilters {
  from?: string | null; // YYYY-MM-DD inclusive
  to?: string | null; // YYYY-MM-DD inclusive
  customerId?: number | null;
  agent?: string | null;
  region?: string | null;
}

/** Options for the report filter bar. */
export interface ReportFilterOptions {
  agents: string[];
  regions: string[];
  customers: { id: number; name: string }[];
}

/** A labelled money/quantity slice — the row shape for every ranked list & pie.
 *  `bank`/`cash` are the same figure split by mode (Bank absorbs Cheque, matching
 *  the rest of the app's own `isBankMode` convention) — present whenever the
 *  underlying figure is real money with a mode (billed via `Challan.b`/`c`, or
 *  collected via `AcctPaymentReceipt.payMode`). Absent for non-money slices
 *  (party/order counts, physical quantities, ratios) where a split has no
 *  meaning; `value` stays the one number to read in that case. */
export interface ReportSlice {
  name: string;
  value: number;
  bank?: number;
  cash?: number;
  /** Optional secondary value (e.g. count behind the money), when useful. */
  count?: number;
}

/** One month bucket of billed vs collected money, each split by mode. */
export interface ReportMonthPoint {
  month: string; // yyyy-mm
  label: string; // "Jul 25"
  billed: number;
  billedBank: number;
  billedCash: number;
  collected: number;
  collectedBank: number;
  collectedCash: number;
}

/** §8.5 — the business in one screen. */
export interface BusinessOverview {
  /** Revenue this FY-to-date vs last FY to the same point. */
  revenue: PeriodMetric;
  /** Collections (receipts) this FY-to-date vs last FY. */
  collections: PeriodMetric;
  /** Orders booked this FY vs last FY (count). */
  orders: PeriodMetric;
  /** Challans raised this FY vs last FY (count). */
  challans: PeriodMetric;
  /** Net receivable: all-time confirmed billed − all-time receipts, floored at 0. */
  outstanding: number;
  /** Collection efficiency this FY = collections ÷ revenue (0–1, may exceed 1). */
  collectionRate: number | null;
  /** Days Sales Outstanding = outstanding ÷ FY revenue × elapsed FY days. */
  dsoDays: number | null;
  /** ₹ value of dispatched lines not yet on a challan (point-in-time). */
  backlogValue: number;
  /** Last 12 months, billed vs collected. */
  trend: ReportMonthPoint[];
  /** Revenue split by product category (CONFIRMED challans, this FY). */
  categoryMix: ReportSlice[];
  /** Top parties by revenue this FY (capped). */
  topParties: ReportSlice[];
  /** Revenue by cleaned region this FY. */
  byRegion: ReportSlice[];
  /** Revenue by agent this FY ("SELF" when a party has no agent). */
  byAgent: ReportSlice[];
  /** Average invoice value this FY (revenue ÷ challans). */
  avgInvoiceValue: number;
  /** Distinct parties billed this FY. */
  activeParties: number;
  /** Parties with an unpaid invoice balance (point-in-time). */
  owingParties: number;
  /** Owing parties that were not billed in the selected period. */
  olderOwingParties: number;
  /** Collections this FY split by mode (Bank / Cash / Cheque). */
  collectionModes: ReportSlice[];
  asOf: string;
}

/** §8.6 — Sales & Revenue detail. */
export interface SalesReport {
  /** Monthly billed revenue for the last `months` months. */
  monthly: ReportMonthPoint[];
  /** This financial year vs last, aligned by calendar month (Apr→Mar), each split by mode. */
  yoy: { label: string; thisYear: number; thisYearBank: number; thisYearCash: number; lastYear: number; lastYearBank: number; lastYearCash: number }[];
  /** This-FY total vs last-FY total, and growth %. */
  yoyTotals: { thisYear: number; lastYear: number; growthPct: number | null };
  /** Seasonality index per calendar month (month avg ÷ overall month avg; 1 = average). */
  seasonality: { month: string; label: string; index: number }[];
  byAgent: ReportSlice[];
  byRegion: ReportSlice[];
  byState: ReportSlice[];
  topParties: ReportSlice[];
  categoryMix: ReportSlice[];
  asOf: string;
}

/** Where a party sits in the recovery workflow (derived from their PAYMENT follow-ups). */
export type RecoveryStage = 'Not contacted' | 'In progress' | 'Promised' | 'Promise broken' | 'Callback due' | 'Resolved';
/** State of a party's latest promise-to-pay. */
export type PromiseState = 'none' | 'upcoming' | 'due today' | 'broken';

/** One party in the recovery queue, fusing money exposure with CRM contact state. */
export interface RecoveryParty {
  customerId: number | null;
  party: string;
  agent: string | null;
  outstanding: number;
  overdue: number;
  oldestDays: number;
  lastReceipt: string | null;
  /** Priority flag + rank from the recovery brain (exposure × age). */
  flag: string;
  rank: number;
  // ── CRM signals (from PAYMENT follow-ups) ──
  stage: RecoveryStage;
  /** Most recent contact (latest PAYMENT follow-up activity). */
  lastContactAt: string | null;
  /** Days since last contact; null if never contacted. */
  daysSinceContact: number | null;
  /** Soonest open promised-payment date. */
  nextPromiseAt: string | null;
  /** ₹ amount promised for that soonest promise (promise-to-pay). */
  nextPromiseAmount: number | null;
  promiseState: PromiseState;
  /** Open PAYMENT follow-ups for this party. */
  openFollowups: number;
}

/** §8.2 — Collections & Recovery (Recovery Command Center). */
export interface CollectionsReport {
  totalOutstanding: number;
  overdue: number;
  dueSoon: number;
  advanceHeld: number;
  /** Parties with an unpaid invoice balance (point-in-time). */
  owingParties: number;
  /** Owing parties not billed during the selected period. */
  olderOwingParties: number;
  /** Collection efficiency this FY = collected ÷ billed (0–1). */
  collectionRate: number | null;
  /** Days Sales Outstanding. */
  dsoDays: number | null;
  /** Receipts this FY split by mode (Bank / Cash / Cheque). */
  collectedModes: ReportSlice[];
  /** Parties with the most overdue exposure (capped). */
  topOverdueParties: ReportSlice[];
  /** Overdue value by ageing bucket, split by mode. */
  aging: { key: string; label: string; value: number; bank: number; cash: number; parties: number }[];
  /** Monthly collected trend (last 12 months), split by mode. */
  collectionTrend: { month: string; label: string; collected: number; collectedBank: number; collectedCash: number }[];
  /** Recovery KPIs from the CRM follow-up layer. */
  recoveryKpis: {
    promisesDueToday: number;
    promisesOverdue: number;
    neverContacted: number;
    inProgress: number;
    resolvedThisMonth: number;
    promisedParties: number;
    /** ₹ still expected from live (non-broken) promises-to-pay. */
    promisedValue: number;
    /** ₹ tied up in broken (overdue) promises. */
    brokenPromiseValue: number;
  };
  /** Outstanding + party count by recovery stage (pipeline). */
  pipeline: { stage: RecoveryStage; parties: number; value: number }[];
  /** Parties to chase, ranked, enriched with CRM contact state. */
  recovery: RecoveryParty[];
  asOf: string;
}

/** §8.7 — Party Intelligence (RFM-style segmentation). */
export interface PartyIntelReport {
  segments: ReportSlice[]; // count per segment
  /** Lifetime revenue contributed by each segment. */
  segmentRevenue: ReportSlice[];
  /** Revenue concentration: the top decile of parties and their share of revenue. */
  concentration: { topParties: number; totalParties: number; topShare: number | null };
  parties: {
    customerId: number | null;
    party: string;
    agent: string | null;
    revenue: number;
    invoices: number;
    lastOrder: string | null;
    daysSince: number | null;
    segment: string;
    outstanding: number;
  }[];
  asOf: string;
}

/** How product/order volume is measured (spec §7.2). */
export type ReportMeasure = 'amount' | 'bags' | 'pcs' | 'kgs' | 'box';
export const REPORT_MEASURES: ReportMeasure[] = ['amount', 'bags', 'pcs', 'kgs', 'box'];

/** §8.8 — Product & Design (top products + design margin). */
export interface ProductReport {
  /** Which measure the top-lists are expressed in. */
  measure: ReportMeasure;
  topProducts: ReportSlice[];
  /** Top designs by the selected measure (from challan lines). */
  topDesigns: ReportSlice[];
  categoryMix: ReportSlice[];
  designMargin: {
    design: string;
    category: string | null;
    cost: number;
    rate: number;
    unitMargin: number;
    marginPct: number | null;
    flag: 'loss' | 'thin' | 'ok';
  }[];
  marginByCategory: ReportSlice[];
  asOf: string;
}

/** §8.9 — Patterns & Insights. */
export interface PatternsReport {
  /** Products bought in ≥2 distinct orders by a party, over all product-party pairs (0–1). */
  reorderRate: number | null;
  /** Parties with ≥2 invoices, over parties with any invoice (0–1). */
  repeatPartyRate: number | null;
  /** Average gap (days) between consecutive orders, across repeat parties. */
  avgOrderGapDays: number | null;
  /** Average line-items per order (basket size). */
  avgBasketItems: number | null;
  /** Distribution of parties by lifetime order count (1 / 2–3 / 4–6 / 7+). */
  orderFrequency: ReportSlice[];
  /** Orders by category (preference). */
  categoryPreference: ReportSlice[];
  /** Products with the most distinct repeat buyers. */
  topReorderProducts: ReportSlice[];
  /** Most loyal parties by order count. */
  loyalParties: { party: string; orders: number; avgGapDays: number | null; categories: number }[];
  asOf: string;
}

/** §8.10 — Orders & Fulfilment. */
export interface FulfilmentReport {
  totalOrders: number;
  cancelledOrders: number;
  cancellationRate: number | null;
  dispatchRows: number;
  partialRows: number;
  partialRate: number | null;
  avgLeadDays: number | null;
  urgentOpen: number;
  pendingOrders: number;
  aging: { key: string; label: string; orders: number; value: number }[];
  /** Value funnel: ordered → dispatched → billed (leakage between stages). */
  funnel: { stage: string; value: number }[];
  cancellationByParty: ReportSlice[];
  asOf: string;
}

export type SummaryActionCategory = 'Cash' | 'Sales' | 'Margin' | 'Customers' | 'Operations';
export type SummaryActionPriority = 'Do today' | 'This week' | 'Watch';

/** One plain-English action generated from the currently filtered report data. */
export interface SummaryAnalysisAction {
  id: string;
  category: SummaryActionCategory;
  priority: SummaryActionPriority;
  title: string;
  detail: string;
  evidence: string;
  impact: string;
  route: string;
}

/** Cross-report decision page for faster cash conversion in a low-margin business. */
export interface SummaryAnalysisReport {
  headline: {
    revenue: number;
    collections: number;
    outstanding: number;
    overdue: number;
    backlog: number;
    activeParties: number;
    owingParties: number;
  };
  forecast: {
    next30DayRevenue: number;
    collectible30Days: number;
    cashUnlockFromTenDsoDays: number;
    confidence: 'Low' | 'Medium';
  };
  actions: SummaryAnalysisAction[];
  asOf: string;
}

/* ── Order Journey (Reports → Order Journey) ─────────────────────────────────
   One party's goods followed all the way through: what they ORDERED, what was
   DISPATCHED against it, what was BILLED on a challan, and what came BACK as a
   return. Four stages of the same quantity, so the drop between them is the
   story the page tells. */

/** One stage of the journey, as a headline. */
export interface JourneyStage {
  key: 'ORDERS' | 'DISPATCHED' | 'CHALLAN' | 'RETURNS';
  label: string;
  /** Documents at this stage — orders, dispatch rows, challans, credit notes. */
  docs: number;
  /** Line items at this stage. */
  lines: number;
  bags: number;
  pcs: number;
  kgs: number;
  /** Rupee value where the stage has one (challans bill, returns credit). */
  amount: number;
  /**
   * Share of the FIRST stage this one represents, 0–1 — the number that makes
   * the funnel readable ("83% of what was ordered actually shipped"). Null on
   * the first stage, which is the base everything else is measured against.
   */
  ofFirst: number | null;
}

/**
 * One dispatch under an order — what physically moved, and when it was billed.
 * This is what the order row expands to show.
 */
export interface JourneyDispatch {
  id: number;
  code: string | null;
  date: string;
  bags: number | null;
  pcs: number | null;
  kgs: number | null;
  box: number | null;
  /** PARTIALLY DISPATCH / FULLY DISPATCH / RETURNED. */
  status: string;
  /** True when this row gave quantity BACK (a credit note return). */
  isReturn: boolean;
  /** The challan that billed it, when one has. */
  challanCode: string | null;
  challanDate: string | null;
  /** The credit note behind it, when this row is a return. */
  creditNoteCode: string | null;
}

/** One order, followed through the whole pipeline. */
export interface JourneyOrder {
  orderId: number;
  orderCode: string | null;
  orderDate: string;
  dueDate: string | null;
  priority: string | null;
  lines: number;
  /** Ordered quantity. */
  bags: number;
  pcs: number;
  kgs: number;
  amount: number;
  /** Dispatched against this order (net of returns — a return gives stock back). */
  dispBags: number;
  dispPcs: number;
  dispKgs: number;
  dispatches: number;
  /** Billed. */
  challanCodes: string[];
  billedAmount: number;
  /** Returned. */
  returnedBags: number;
  returnedPcs: number;
  returnedKgs: number;
  returns: number;
  /** 0–1 of the ordered quantity that has shipped, on the line's own unit. */
  progress: number;
  /** Where this order currently stands. */
  stage: 'PENDING' | 'PARTIAL' | 'DISPATCHED' | 'BILLED' | 'RETURNED';
  /** Every dispatch and return under this order, newest first — the detail the
   *  row reveals when it is opened. */
  dispatchList: JourneyDispatch[];
}

/** One dated event on the party's timeline. */
export interface JourneyEvent {
  date: string;
  kind: 'ORDER' | 'DISPATCH' | 'CHALLAN' | 'RETURN';
  /** Human title — the document code. */
  title: string;
  /** Supporting line, e.g. "4 lines · 120 kgs". */
  detail: string;
  amount: number | null;
}

export interface OrderJourneyReport {
  customerId: number | null;
  customerName: string;
  from: string | null;
  to: string | null;
  stages: JourneyStage[];
  orders: JourneyOrder[];
  events: JourneyEvent[];
  /** Headline read-outs the page states in words. */
  insights: string[];
}
