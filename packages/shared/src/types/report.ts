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

/** A labelled money/quantity slice — the row shape for every ranked list & pie. */
export interface ReportSlice {
  name: string;
  value: number;
  /** Optional secondary value (e.g. count behind the money), when useful. */
  count?: number;
}

/** One month bucket of billed vs collected money. */
export interface ReportMonthPoint {
  month: string; // yyyy-mm
  label: string; // "Jul 25"
  billed: number;
  collected: number;
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
  /** Collections this FY split by mode (Bank / Cash / Cheque). */
  collectionModes: ReportSlice[];
  asOf: string;
}

/** §8.6 — Sales & Revenue detail. */
export interface SalesReport {
  /** Monthly billed revenue for the last `months` months. */
  monthly: ReportMonthPoint[];
  /** This financial year vs last, aligned by calendar month (Apr→Mar). */
  yoy: { label: string; thisYear: number; lastYear: number }[];
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
  /** Collection efficiency this FY = collected ÷ billed (0–1). */
  collectionRate: number | null;
  /** Days Sales Outstanding. */
  dsoDays: number | null;
  /** Receipts this FY split by mode (Bank / Cash / Cheque). */
  collectedModes: ReportSlice[];
  /** Parties with the most overdue exposure (capped). */
  topOverdueParties: ReportSlice[];
  /** Overdue value by ageing bucket. */
  aging: { key: string; label: string; value: number; parties: number }[];
  /** Monthly collected trend (last 12 months). */
  collectionTrend: { month: string; label: string; collected: number }[];
  /** Recovery KPIs from the CRM follow-up layer. */
  recoveryKpis: {
    promisesDueToday: number;
    promisesOverdue: number;
    neverContacted: number;
    inProgress: number;
    resolvedThisMonth: number;
    promisedParties: number;
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
