import { Injectable } from '@nestjs/common';
import type {
  AgingBucket,
  DashboardKpis,
  MonthlyOrderVsChallanPoint,
  OrderBacklog,
  OrderVsChallanSeries,
  PeriodMetric,
  TrendDirection,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';

/** A dated money row, reduced from an order line or a challan. */
interface DatedAmount {
  date: Date;
  amount: number;
}

const n = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : 0);

/** Line quantity in its pricing unit: PCS lines bill on pcs, everything else on kgs (gram). */
const qtyOf = (calField: string | null | undefined, pcs: number | null, gram: number | null) =>
  (calField ?? '').toUpperCase() === 'PCS' ? n(pcs) : n(gram);

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Dispatch ids already on a non-cancelled challan (mirrors ChallansService.NOT_CHALLANED). */
  private static readonly NOT_CHALLANED =
    "d.id NOT IN (SELECT ci.dispatchId FROM challan_items ci JOIN challans c ON c.id = ci.challanId WHERE ci.dispatchId IS NOT NULL AND c.challanStatus <> 'CANCELLED')";

  /** Sum the amounts of rows whose date falls in [start, end). */
  private sumBetween(rows: DatedAmount[], start: Date, end: Date): number {
    const s = start.getTime();
    const e = end.getTime();
    let total = 0;
    for (const r of rows) {
      const t = r.date.getTime();
      if (t >= s && t < e) total += r.amount;
    }
    return total;
  }

  /**
   * Compare a period-to-date against the same elapsed slice of the previous
   * period. `curStart` is when the current period began; `prevStart` when the
   * previous one did. Both windows run for the SAME duration (now − curStart).
   */
  private periodMetric(rows: DatedAmount[], now: Date, curStart: Date, prevStart: Date): PeriodMetric {
    const elapsed = now.getTime() - curStart.getTime();
    const current = this.sumBetween(rows, curStart, now);
    const previous = this.sumBetween(rows, prevStart, new Date(prevStart.getTime() + elapsed));
    return this.toMetric(current, previous);
  }

  private toMetric(current: number, previous: number): PeriodMetric {
    const direction: TrendDirection = current > previous ? 'up' : current < previous ? 'down' : 'flat';
    const deltaPct = previous === 0 ? null : ((current - previous) / previous) * 100;
    return { current, previous, deltaPct, direction };
  }

  // ── Period boundaries (server-local time) ─────────────────────────────────
  private startOfDay(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  /** Monday-based start of the week containing `d`. */
  private startOfWeek(d: Date) {
    const s = this.startOfDay(d);
    const dow = (s.getDay() + 6) % 7; // 0 = Monday … 6 = Sunday
    s.setDate(s.getDate() - dow);
    return s;
  }
  private startOfMonth(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  /** Start of the Indian financial year (1 April) containing `d`. Jan–Mar belong to the FY that began the previous April. */
  private startOfFinYear(d: Date) {
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return new Date(y, 3, 1);
  }

  /** KPI roll-up for the dashboard. */
  async dashboard(): Promise<DashboardKpis> {
    const now = new Date();
    const todayStart = this.startOfDay(now);
    const yesterdayStart = new Date(todayStart.getTime());
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = this.startOfWeek(now);
    const lastWeekStart = new Date(weekStart.getTime());
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const monthStart = this.startOfMonth(now);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    // "This year" follows the Indian financial year (1 Apr – 31 Mar).
    const yearStart = this.startOfFinYear(now);
    const lastYearStart = new Date(yearStart.getFullYear() - 1, 3, 1);

    // Widest window needed by any period metric is [lastYearStart, now].
    const rangeStart = lastYearStart;

    const [orderRows, challanRows, orderHeaders, backlog, openOrders] = await Promise.all([
      this.orderAmounts(rangeStart),
      this.challanAmounts(rangeStart),
      this.orderDates(rangeStart),
      this.toChallanBacklog(),
      this.openOrdersCount(),
    ]);

    const orderValue = {
      today: this.periodMetric(orderRows, now, todayStart, yesterdayStart),
      week: this.periodMetric(orderRows, now, weekStart, lastWeekStart),
      month: this.periodMetric(orderRows, now, monthStart, lastMonthStart),
      year: this.periodMetric(orderRows, now, yearStart, lastYearStart),
    };

    const challanValueMonth = this.periodMetric(challanRows, now, monthStart, lastMonthStart);
    const ordersCountMonth = this.periodMetric(orderHeaders, now, monthStart, lastMonthStart);

    return {
      orderValue,
      challanValueMonth,
      ordersCountMonth,
      toChallanBacklog: backlog.amount,
      toChallanLines: backlog.lines,
      openOrders,
      asOf: now.toISOString(),
    };
  }

  /** The last `months` months (inclusive of the current one) of order vs challan value. */
  async orderVsChallan(months: number): Promise<OrderVsChallanSeries> {
    const span = Math.min(Math.max(Math.trunc(months) || 12, 1), 36);
    const now = new Date();
    const firstMonth = new Date(now.getFullYear(), now.getMonth() - (span - 1), 1);

    const [orderRows, challanRows] = await Promise.all([
      this.orderAmounts(firstMonth),
      this.challanAmounts(firstMonth),
    ]);

    // Seed an ordered bucket per month so gaps render as zero, not missing bars.
    const buckets = new Map<string, MonthlyOrderVsChallanPoint>();
    for (let i = 0; i < span; i++) {
      const d = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + i, 1);
      const key = this.monthKey(d);
      buckets.set(key, { month: key, label: this.monthLabel(d), orderValue: 0, challanValue: 0 });
    }
    for (const r of orderRows) {
      const b = buckets.get(this.monthKey(r.date));
      if (b) b.orderValue += r.amount;
    }
    for (const r of challanRows) {
      const b = buckets.get(this.monthKey(r.date));
      if (b) b.challanValue += r.amount;
    }
    return { points: [...buckets.values()] };
  }

  // ── Data fetchers ─────────────────────────────────────────────────────────

  /** Confirmed order lines (excluding cancelled orders) since `from`, as dated amounts. */
  private async orderAmounts(from: Date): Promise<DatedAmount[]> {
    const rows = await this.prisma.orderItem.findMany({
      where: { status: 'CONFIRMED', order: { status: { not: 'CANCELLED' }, orderDate: { gte: from } } },
      select: { rate: true, calField: true, pcs: true, gram: true, order: { select: { orderDate: true } } },
    });
    return rows.map((r) => ({ date: r.order.orderDate, amount: n(r.rate) * qtyOf(r.calField, r.pcs, r.gram) }));
  }

  /** One dated row per non-cancelled order header since `from` (for order counts). */
  private async orderDates(from: Date): Promise<DatedAmount[]> {
    const rows = await this.prisma.order.findMany({
      where: { status: { not: 'CANCELLED' }, orderDate: { gte: from } },
      select: { orderDate: true },
    });
    return rows.map((r) => ({ date: r.orderDate, amount: 1 }));
  }

  /** Confirmed challans since `from`, as dated invoice totals. */
  private async challanAmounts(from: Date): Promise<DatedAmount[]> {
    const rows = await this.prisma.challan.findMany({
      where: { challanStatus: 'CONFIRMED', invDate: { gte: from } },
      select: { invDate: true, total: true },
    });
    return rows.map((r) => ({ date: r.invDate, amount: n(r.total) }));
  }

  /** ₹ value + line count of dispatched lines not yet on a (non-cancelled) challan. */
  private async toChallanBacklog(): Promise<{ amount: number; lines: number }> {
    const rows = await this.prisma.$queryRawUnsafe<{ amt: number | null; cnt: bigint }[]>(
      `SELECT SUM(COALESCE(d.rate,0) * (CASE WHEN UPPER(COALESCE(d.calField,'')) = 'PCS' THEN COALESCE(d.pcs,0) ELSE COALESCE(d.gram,0) END)) AS amt,
              COUNT(*) AS cnt
         FROM dispatches d
        WHERE ${AnalyticsService.NOT_CHALLANED}`,
    );
    return { amount: n(rows[0]?.amt), lines: Number(rows[0]?.cnt ?? 0) };
  }

  /** Count of non-cancelled orders that still have at least one under-dispatched line. */
  private async openOrdersCount(): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT COUNT(DISTINCT o.id) AS c
         FROM orders o
         JOIN order_items oi ON oi.orderId = o.id AND oi.status = 'CONFIRMED'
        WHERE o.status <> 'CANCELLED'
          AND (CASE WHEN UPPER(COALESCE(oi.calField,'')) = 'PCS' THEN COALESCE(oi.pcs,0) ELSE COALESCE(oi.gram,0) END)
              - COALESCE((SELECT SUM(CASE WHEN UPPER(COALESCE(d.calField,'')) = 'PCS' THEN COALESCE(d.pcs,0) ELSE COALESCE(d.gram,0) END)
                            FROM dispatches d WHERE d.orderItemId = oi.id), 0) > 0.0001`,
    );
    return Number(rows[0]?.c ?? 0);
  }

  /**
   * Order fulfilment backlog: every confirmed line of a non-cancelled order that
   * still has undispatched quantity (ordered − Σ dispatched > 0), rolled up into
   * value, physical qty, urgent load and order-date age bands.
   */
  async backlog(): Promise<OrderBacklog> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        orderId: number;
        orderDate: Date;
        priority: string | null;
        rate: number | null;
        unit: string | null;
        oPcs: number;
        oGram: number;
        oBags: number;
        dPcs: number;
        dGram: number;
        dBags: number;
      }[]
    >(
      `SELECT o.id AS orderId, o.orderDate AS orderDate,
              COALESCE(NULLIF(oi.priority,''), o.priority) AS priority,
              COALESCE(oi.rate,0) AS rate, UPPER(COALESCE(oi.calField,'')) AS unit,
              COALESCE(oi.pcs,0) AS oPcs, COALESCE(oi.gram,0) AS oGram, COALESCE(oi.bags,0) AS oBags,
              COALESCE(d.dPcs,0) AS dPcs, COALESCE(d.dGram,0) AS dGram, COALESCE(d.dBags,0) AS dBags
         FROM order_items oi
         JOIN orders o ON o.id = oi.orderId
         LEFT JOIN (
           SELECT orderItemId,
                  SUM(COALESCE(pcs,0)) AS dPcs, SUM(COALESCE(gram,0)) AS dGram, SUM(COALESCE(bags,0)) AS dBags
             FROM dispatches GROUP BY orderItemId
         ) d ON d.orderItemId = oi.id
        WHERE oi.status = 'CONFIRMED' AND o.status <> 'CANCELLED'`,
    );

    const now = Date.now();
    const DAY = 86_400_000;
    // Roll lines up to their order so the aging bands count distinct orders.
    const orders = new Map<number, { value: number; ageDays: number; urgent: boolean }>();
    let openLines = 0;
    let openValue = 0;
    let pendingBags = 0;
    let pendingKgs = 0;
    let urgentValue = 0;
    const urgentOrders = new Set<number>();

    for (const r of rows) {
      const pendingUnit = (r.unit === 'PCS' ? r.oPcs - r.dPcs : r.oGram - r.dGram);
      if (pendingUnit <= 0.0001) continue; // fully dispatched line
      const value = n(r.rate) * pendingUnit;
      openLines += 1;
      openValue += value;
      pendingBags += Math.max(0, r.oBags - r.dBags);
      pendingKgs += Math.max(0, r.oGram - r.dGram);
      const urgent = (r.priority ?? '').toUpperCase() === 'URGENT';
      if (urgent) {
        urgentValue += value;
        urgentOrders.add(r.orderId);
      }
      const ageDays = Math.floor((now - new Date(r.orderDate).getTime()) / DAY);
      const cur = orders.get(r.orderId);
      if (cur) {
        cur.value += value;
        cur.ageDays = Math.max(cur.ageDays, ageDays);
        cur.urgent = cur.urgent || urgent;
      } else {
        orders.set(r.orderId, { value, ageDays, urgent });
      }
    }

    const bands: { key: string; label: string; test: (d: number) => boolean }[] = [
      { key: '0-7', label: '0–7 days', test: (d) => d <= 7 },
      { key: '8-15', label: '8–15 days', test: (d) => d > 7 && d <= 15 },
      { key: '16-30', label: '16–30 days', test: (d) => d > 15 && d <= 30 },
      { key: '30+', label: '30+ days', test: (d) => d > 30 },
    ];
    const aging: AgingBucket[] = bands.map((b) => ({ key: b.key, label: b.label, orders: 0, value: 0 }));
    let oldestDays = 0;
    for (const o of orders.values()) {
      oldestDays = Math.max(oldestDays, o.ageDays);
      const idx = bands.findIndex((b) => b.test(o.ageDays));
      if (idx >= 0) {
        aging[idx].orders += 1;
        aging[idx].value += o.value;
      }
    }

    return {
      openOrders: orders.size,
      openLines,
      openValue,
      pendingBags,
      pendingKgs,
      urgentOrders: urgentOrders.size,
      urgentValue,
      oldestDays,
      aging,
    };
  }

  // ── Month helpers ─────────────────────────────────────────────────────────
  private monthKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  private monthLabel(d: Date) {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  }
}
