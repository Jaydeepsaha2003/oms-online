/**
 * Dashboard analytics shapes — the KPI roll-ups and the monthly
 * "Order value vs Challan value" chart series shown on the dashboard.
 *
 * All money figures are plain numbers (rupees). Period metrics compare the
 * current period-to-date against the SAME elapsed slice of the previous period
 * (e.g. today-so-far vs yesterday up to the same time, month-to-date vs the
 * same day of last month) so the red/green delta is a fair like-for-like signal
 * rather than a partial-vs-full-period comparison.
 */

export type TrendDirection = 'up' | 'down' | 'flat';

/** One value + its comparison to the previous equivalent period. */
export interface PeriodMetric {
  /** Current period-to-date total. */
  current: number;
  /** Previous equivalent period, same elapsed portion. */
  previous: number;
  /**
   * Signed percentage change ((current - previous) / previous × 100).
   * `null` when `previous` is 0 (no baseline to compare against).
   */
  deltaPct: number | null;
  direction: TrendDirection;
}

/** Headline order value across four rolling periods, each vs the prior one. */
export interface OrderValueByPeriod {
  /** Today so far vs yesterday up to the same time. */
  today: PeriodMetric;
  /** This week-to-date (Mon start) vs last week to the same point. */
  week: PeriodMetric;
  /** This month-to-date vs last month to the same day. */
  month: PeriodMetric;
  /** This financial-year-to-date (1 Apr–31 Mar) vs last FY to the same point. */
  year: PeriodMetric;
}

export interface DashboardKpis {
  /** Order value (booked) across today / week / month / year. */
  orderValue: OrderValueByPeriod;
  /** Challan / invoiced value, this month-to-date vs last month. */
  challanValueMonth: PeriodMetric;
  /** Orders placed this month-to-date vs last month. */
  ordersCountMonth: PeriodMetric;
  /** Value of dispatched lines not yet on a challan (point-in-time backlog). */
  toChallanBacklog: number;
  /** Number of dispatched-but-not-challaned lines behind that backlog. */
  toChallanLines: number;
  /** Orders that still have outstanding (undispatched) quantity (point-in-time). */
  openOrders: number;
  /** Server clock (ISO) the figures were computed at. */
  asOf: string;
}

/** One month bucket in the order-vs-challan chart. */
export interface MonthlyOrderVsChallanPoint {
  /** Bucket key, `yyyy-mm`. */
  month: string;
  /** Short display label, e.g. "Jul 25". */
  label: string;
  /** Total order value booked in the month. */
  orderValue: number;
  /** Total challan / invoiced value created in the month. */
  challanValue: number;
}

export interface OrderVsChallanSeries {
  points: MonthlyOrderVsChallanPoint[];
}

/** One age band of the open-order backlog (bucketed by order date). */
export interface AgingBucket {
  /** Stable key, e.g. '0-7'. */
  key: string;
  /** Display label, e.g. '0–7 days'. */
  label: string;
  /** Distinct open orders whose order date falls in this band. */
  orders: number;
  /** ₹ value of undispatched quantity in this band. */
  value: number;
}

/**
 * Order fulfilment backlog — everything ordered but not yet dispatched, so the
 * user can see what's outstanding and act. "Pending" = ordered − dispatched.
 */
export interface OrderBacklog {
  /** Distinct non-cancelled orders with at least one under-dispatched line. */
  openOrders: number;
  /** Under-dispatched order lines behind those orders. */
  openLines: number;
  /** ₹ value of the undispatched quantity (rate × pending qty). */
  openValue: number;
  /** Physical backlog still to ship. */
  pendingBags: number;
  pendingKgs: number;
  /** Orders flagged URGENT that still have undispatched quantity. */
  urgentOrders: number;
  urgentValue: number;
  /** Age (days) of the oldest open order — the worst offender. */
  oldestDays: number;
  /** Value-weighted age bands (0–7 / 8–15 / 16–30 / 30+ days). */
  aging: AgingBucket[];
}
