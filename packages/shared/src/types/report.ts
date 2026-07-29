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

/** §8.2 — Collections & Recovery. */
export interface CollectionsReport {
  totalOutstanding: number;
  overdue: number;
  dueSoon: number;
  advanceHeld: number;
  /** Receipts this FY split by mode (Bank / Cash / Cheque). */
  collectedModes: ReportSlice[];
  /** Parties with the most overdue exposure (capped). */
  topOverdueParties: ReportSlice[];
  /** Overdue value by ageing bucket. */
  aging: { key: string; label: string; value: number; parties: number }[];
  /** Parties to chase, ranked by exposure × age. */
  recovery: {
    customerId: number | null;
    party: string;
    agent: string | null;
    outstanding: number;
    overdue: number;
    oldestDays: number;
    lastReceipt: string | null;
    flag: string;
    rank: number;
  }[];
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

/** §8.8 — Product & Design (top products + design margin). */
export interface ProductReport {
  topProducts: ReportSlice[];
  /** Top designs by billed value (from challan lines). */
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
