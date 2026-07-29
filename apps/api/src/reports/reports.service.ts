import { Injectable } from '@nestjs/common';
import type {
  BusinessOverview,
  CollectionsReport,
  FulfilmentReport,
  PartyIntelReport,
  PatternsReport,
  PeriodMetric,
  ProductReport,
  ReportMonthPoint,
  ReportSlice,
  SalesReport,
  TrendDirection,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';

const n = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : 0);
const r0 = (v: number) => Math.round(v);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface DatedAmount {
  date: Date;
  amount: number;
}

/** Revenue counts only real sales lines (mirrors the spec's sales filter). */
const SALES_TX = new Set(['SALES INVOICE', 'DEBIT NOTE']);

/** Normalise a receipt pay mode to Bank / Cash / Cheque. */
const payModeOf = (m: string | null | undefined): 'Bank' | 'Cash' | 'Cheque' => {
  const u = (m ?? '').trim().toUpperCase();
  if (u === 'CASH') return 'Cash';
  if (u === 'CHEQUE' || u === 'CHQ') return 'Cheque';
  return 'Bank';
};

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private static readonly NOT_CHALLANED =
    "d.id NOT IN (SELECT ci.dispatchId FROM challan_items ci JOIN challans c ON c.id = ci.challanId WHERE ci.dispatchId IS NOT NULL AND c.challanStatus <> 'CANCELLED')";

  // ── period helpers ─────────────────────────────────────────────────────────
  private startOfFinYear(d: Date) {
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return new Date(y, 3, 1);
  }
  private sumBetween(rows: DatedAmount[], start: Date, end: Date): number {
    const s = start.getTime();
    const e = end.getTime();
    let total = 0;
    for (const row of rows) {
      const t = row.date.getTime();
      if (t >= s && t < e) total += row.amount;
    }
    return total;
  }
  private toMetric(current: number, previous: number): PeriodMetric {
    const direction: TrendDirection = current > previous ? 'up' : current < previous ? 'down' : 'flat';
    const deltaPct = previous === 0 ? null : ((current - previous) / previous) * 100;
    return { current: r0(current), previous: r0(previous), deltaPct, direction };
  }
  private fyMetric(rows: DatedAmount[], now: Date, fyStart: Date, lastFyStart: Date): PeriodMetric {
    const elapsed = now.getTime() - fyStart.getTime();
    const current = this.sumBetween(rows, fyStart, now);
    const previous = this.sumBetween(rows, lastFyStart, new Date(lastFyStart.getTime() + elapsed));
    return this.toMetric(current, previous);
  }
  private monthKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  private monthLabel(d: Date) {
    return `${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  }

  /** Roll a list of slices to the top `cap`, others folded into the tail total is dropped. */
  private topSlices(map: Map<string, { value: number; count: number }>, cap: number): ReportSlice[] {
    return [...map.entries()]
      .map(([name, v]) => ({ name, value: r0(v.value), count: v.count }))
      .sort((a, b) => b.value - a.value)
      .slice(0, cap);
  }

  async businessOverview(): Promise<BusinessOverview> {
    const now = new Date();
    const fyStart = this.startOfFinYear(now);
    const lastFyStart = new Date(fyStart.getFullYear() - 1, 3, 1);
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 11, 1); // 12 months incl. current

    // Widest window we read: from last FY start (covers FY-vs-lastFY and the 12-mo trend).
    const rangeStart = lastFyStart < trendStart ? lastFyStart : trendStart;

    const [challans, receipts, orders, custRows, billedAgg, receiptAgg, backlog] = await Promise.all([
      this.prisma.challan.findMany({
        where: { challanStatus: 'CONFIRMED', invDate: { gte: rangeStart } },
        select: { invDate: true, total: true, category: true, customerName: true, customerId: true, transaction: true },
      }),
      this.prisma.acctPaymentReceipt.findMany({
        where: { recDate: { gte: rangeStart } },
        select: { recDate: true, recAmt: true, payMode: true },
      }),
      this.prisma.order.findMany({
        where: { status: { not: 'CANCELLED' }, orderDate: { gte: rangeStart } },
        select: { orderDate: true },
      }),
      this.prisma.customer.findMany({ select: { id: true, region: true, agentName: true } }),
      // All-time billed (sales/debit only) and all-time receipts → net outstanding.
      this.prisma.$queryRawUnsafe<{ t: number | null }[]>(
        `SELECT SUM(COALESCE(total,0)) AS t FROM challans WHERE challanStatus = 'CONFIRMED' AND UPPER(TRIM(COALESCE("transaction",''))) IN ('SALES INVOICE','DEBIT NOTE')`,
      ),
      this.prisma.$queryRawUnsafe<{ t: number | null }[]>('SELECT SUM(COALESCE(recAmt,0)) AS t FROM acct_payment_receipt'),
      this.prisma.$queryRawUnsafe<{ amt: number | null }[]>(
        `SELECT SUM(COALESCE(d.rate,0) * (CASE WHEN UPPER(COALESCE(d.calField,'')) = 'PCS' THEN COALESCE(d.pcs,0) ELSE COALESCE(d.gram,0) END)) AS amt
           FROM dispatches d WHERE ${ReportsService.NOT_CHALLANED}`,
      ),
    ]);

    const custMap = new Map(custRows.map((c) => [c.id, c]));
    const sales = challans.filter((c) => SALES_TX.has((c.transaction ?? '').trim().toUpperCase()));

    // Dated rows for the FY-vs-lastFY period metrics.
    const revRows: DatedAmount[] = sales.map((c) => ({ date: c.invDate, amount: n(c.total) }));
    const colRows: DatedAmount[] = receipts.map((c) => ({ date: c.recDate, amount: n(c.recAmt) }));
    const orderRows: DatedAmount[] = orders.map((o) => ({ date: o.orderDate, amount: 1 }));
    const challanRows: DatedAmount[] = sales.map((c) => ({ date: c.invDate, amount: 1 }));

    const revenue = this.fyMetric(revRows, now, fyStart, lastFyStart);
    const collections = this.fyMetric(colRows, now, fyStart, lastFyStart);
    const ordersMetric = this.fyMetric(orderRows, now, fyStart, lastFyStart);
    const challansMetric = this.fyMetric(challanRows, now, fyStart, lastFyStart);

    // 12-month billed vs collected trend (seeded so gaps render as zero).
    const buckets = new Map<string, ReportMonthPoint>();
    for (let i = 0; i < 12; i++) {
      const d = new Date(trendStart.getFullYear(), trendStart.getMonth() + i, 1);
      buckets.set(this.monthKey(d), { month: this.monthKey(d), label: this.monthLabel(d), billed: 0, collected: 0 });
    }
    for (const c of sales) {
      const b = buckets.get(this.monthKey(c.invDate));
      if (b) b.billed += n(c.total);
    }
    for (const rc of receipts) {
      const b = buckets.get(this.monthKey(rc.recDate));
      if (b) b.collected += n(rc.recAmt);
    }
    const trend = [...buckets.values()].map((p) => ({ ...p, billed: r0(p.billed), collected: r0(p.collected) }));

    // This-FY-only slices (category / party / region / agent).
    const fyStartMs = fyStart.getTime();
    const cat = new Map<string, { value: number; count: number }>();
    const party = new Map<string, { value: number; count: number }>();
    const region = new Map<string, { value: number; count: number }>();
    const agent = new Map<string, { value: number; count: number }>();
    const add = (m: Map<string, { value: number; count: number }>, key: string, v: number) => {
      const cur = m.get(key);
      if (cur) { cur.value += v; cur.count += 1; } else m.set(key, { value: v, count: 1 });
    };
    for (const c of sales) {
      if (c.invDate.getTime() < fyStartMs) continue;
      const v = n(c.total);
      add(cat, (c.category ?? '').trim() || 'Uncategorised', v);
      add(party, c.customerName || '—', v);
      const cust = c.customerId != null ? custMap.get(c.customerId) : undefined;
      add(region, ((cust?.region ?? '').trim().toUpperCase()) || 'UNKNOWN', v);
      add(agent, ((cust?.agentName ?? '').trim()) || 'SELF', v);
    }

    // Collections this FY split by mode.
    const modeMap = new Map<string, { value: number; count: number }>();
    for (const rc of receipts) {
      if (rc.recDate.getTime() < fyStartMs) continue;
      add(modeMap, payModeOf(rc.payMode), n(rc.recAmt));
    }
    const collectionModes = ['Bank', 'Cash', 'Cheque'].map((name) => ({ name, value: r0(modeMap.get(name)?.value ?? 0) })).filter((s) => s.value > 0);

    const billed = n(billedAgg[0]?.t);
    const collected = n(receiptAgg[0]?.t);
    const outstanding = Math.max(0, billed - collected);
    const elapsedFyDays = Math.max(1, Math.round((now.getTime() - fyStart.getTime()) / 86_400_000));
    const dsoDays = revenue.current > 0 ? r0((outstanding / revenue.current) * elapsedFyDays) : null;
    const collectionRate = revenue.current > 0 ? collections.current / revenue.current : null;

    return {
      revenue,
      collections,
      orders: ordersMetric,
      challans: challansMetric,
      outstanding,
      collectionRate,
      dsoDays,
      backlogValue: r0(n(backlog[0]?.amt)),
      trend,
      categoryMix: this.topSlices(cat, 10),
      topParties: this.topSlices(party, 12),
      byRegion: this.topSlices(region, 12),
      byAgent: this.topSlices(agent, 12),
      avgInvoiceValue: challansMetric.current > 0 ? r0(revenue.current / challansMetric.current) : 0,
      activeParties: party.size,
      collectionModes,
      asOf: now.toISOString(),
    };
  }

  private startOfDay(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /** Received amount per invoice number (challan code) — the collections join key. */
  private async receivedByInvoice(): Promise<Map<string, number>> {
    const receipts = await this.prisma.acctPaymentReceipt.findMany({ select: { invNo: true, recAmt: true } });
    const m = new Map<string, number>();
    for (const r of receipts) m.set(r.invNo, (m.get(r.invNo) ?? 0) + n(r.recAmt));
    return m;
  }

  // ── §8.6 Sales & Revenue ────────────────────────────────────────────────────
  async salesReport(months = 12): Promise<SalesReport> {
    const now = new Date();
    const span = Math.min(Math.max(Math.trunc(months) || 12, 1), 36);
    const first = new Date(now.getFullYear(), now.getMonth() - (span - 1), 1);
    const [challans, custRows] = await Promise.all([
      this.prisma.challan.findMany({ where: { challanStatus: 'CONFIRMED' }, select: { invDate: true, total: true, category: true, customerName: true, customerId: true, transaction: true } }),
      this.prisma.customer.findMany({ select: { id: true, region: true, agentName: true, state: true } }),
    ]);
    const custMap = new Map(custRows.map((c) => [c.id, c]));
    const sales = challans.filter((c) => SALES_TX.has((c.transaction ?? '').trim().toUpperCase()));

    const buckets = new Map<string, ReportMonthPoint>();
    for (let i = 0; i < span; i++) {
      const d = new Date(first.getFullYear(), first.getMonth() + i, 1);
      buckets.set(this.monthKey(d), { month: this.monthKey(d), label: this.monthLabel(d), billed: 0, collected: 0 });
    }
    const byMonthCal = new Array(12).fill(0);
    const agent = new Map<string, { value: number; count: number }>();
    const region = new Map<string, { value: number; count: number }>();
    const state = new Map<string, { value: number; count: number }>();
    const party = new Map<string, { value: number; count: number }>();
    const cat = new Map<string, { value: number; count: number }>();
    const add = (m: Map<string, { value: number; count: number }>, k: string, v: number) => {
      const cur = m.get(k);
      if (cur) { cur.value += v; cur.count += 1; } else m.set(k, { value: v, count: 1 });
    };
    for (const c of sales) {
      const v = n(c.total);
      const b = buckets.get(this.monthKey(c.invDate));
      if (b) b.billed += v;
      byMonthCal[c.invDate.getMonth()] += v;
      const cu = c.customerId != null ? custMap.get(c.customerId) : undefined;
      add(agent, (cu?.agentName ?? '').trim() || 'SELF', v);
      add(region, (cu?.region ?? '').trim().toUpperCase() || 'UNKNOWN', v);
      add(state, (cu?.state ?? '').trim().toUpperCase() || 'UNKNOWN', v);
      add(party, c.customerName || '—', v);
      add(cat, (c.category ?? '').trim() || 'Uncategorised', v);
    }
    const meanMonth = byMonthCal.reduce((s, v) => s + v, 0) / 12 || 1;
    const seasonality = byMonthCal.map((v, i) => ({ month: String(i + 1).padStart(2, '0'), label: MON[i], index: Math.round((v / meanMonth) * 100) / 100 }));

    // Year-over-year, aligned to the Indian FY (Apr→Mar).
    const fyStart = this.startOfFinYear(now);
    const lastFyStart = new Date(fyStart.getFullYear() - 1, 3, 1);
    const fyEnd = new Date(fyStart.getFullYear() + 1, 3, 1);
    const yoyThis = new Array(12).fill(0);
    const yoyLast = new Array(12).fill(0);
    for (const c of sales) {
      const t = c.invDate;
      const idx = (t.getMonth() - 3 + 12) % 12; // Apr=0 … Mar=11
      if (t >= fyStart && t < fyEnd) yoyThis[idx] += n(c.total);
      else if (t >= lastFyStart && t < fyStart) yoyLast[idx] += n(c.total);
    }
    const FYMON = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
    const yoy = FYMON.map((label, i) => ({ label, thisYear: r0(yoyThis[i]), lastYear: r0(yoyLast[i]) }));
    // Like-for-like growth: this FY-to-date vs last FY over the SAME elapsed months
    // (comparing 4 months against a full 12 would be misleading).
    const fyMonthIdx = (now.getMonth() - 3 + 12) % 12; // Apr=0 … current month
    const tThis = yoyThis.reduce((s, v) => s + v, 0);
    const tLast = yoyLast.slice(0, fyMonthIdx + 1).reduce((s, v) => s + v, 0);

    return {
      monthly: [...buckets.values()].map((p) => ({ ...p, billed: r0(p.billed) })),
      yoy,
      yoyTotals: { thisYear: r0(tThis), lastYear: r0(tLast), growthPct: tLast > 0 ? ((tThis - tLast) / tLast) * 100 : null },
      seasonality,
      byAgent: this.topSlices(agent, 12),
      byRegion: this.topSlices(region, 12),
      byState: this.topSlices(state, 12),
      topParties: this.topSlices(party, 12),
      categoryMix: this.topSlices(cat, 10),
      asOf: now.toISOString(),
    };
  }

  // ── §8.2 Collections & Recovery ─────────────────────────────────────────────
  async collectionsReport(): Promise<CollectionsReport> {
    const now = new Date();
    const today = this.startOfDay(now);
    const DAY = 86_400_000;
    const [challans, custRows, advances, recvByInv, lastRec] = await Promise.all([
      this.prisma.challan.findMany({ where: { challanStatus: 'CONFIRMED' }, select: { code: true, total: true, dueDate: true, customerId: true, customerName: true, transaction: true } }),
      this.prisma.customer.findMany({ select: { id: true, agentName: true } }),
      this.prisma.acctPartyAdvance.findMany({ select: { bankAmt: true, cashAmt: true } }),
      this.receivedByInvoice(),
      this.prisma.acctPaymentReceipt.findMany({ select: { custId: true, recDate: true, recAmt: true, payMode: true } }),
    ]);
    const custMap = new Map(custRows.map((c) => [c.id, c]));
    const fyStart = this.startOfFinYear(now);
    const lastRecByCust = new Map<number, Date>();
    const modeMap = new Map<string, { value: number; count: number }>();
    const addMode = (k: string, v: number) => { const cur = modeMap.get(k); if (cur) { cur.value += v; cur.count += 1; } else modeMap.set(k, { value: v, count: 1 }); };
    for (const r of lastRec) {
      const cur = lastRecByCust.get(r.custId);
      if (!cur || r.recDate > cur) lastRecByCust.set(r.custId, r.recDate);
      if (r.recDate >= fyStart) addMode(payModeOf(r.payMode), n(r.recAmt));
    }
    const collectedModes = ['Bank', 'Cash', 'Cheque'].map((name) => ({ name, value: r0(modeMap.get(name)?.value ?? 0) })).filter((s) => s.value > 0);
    const sales = challans.filter((c) => SALES_TX.has((c.transaction ?? '').trim().toUpperCase()));

    const AGING = [
      { key: '1-30', label: '1–30 days', lo: 1, hi: 30 },
      { key: '31-60', label: '31–60 days', lo: 31, hi: 60 },
      { key: '61-90', label: '61–90 days', lo: 61, hi: 90 },
      { key: '90+', label: '90+ days', lo: 91, hi: Infinity },
    ];
    const aging = AGING.map((a) => ({ key: a.key, label: a.label, value: 0, parties: 0 }));
    const agingParties: Set<string>[] = AGING.map(() => new Set());

    interface P { custId: number | null; party: string; agent: string | null; outstanding: number; overdue: number; oldestDays: number }
    const parties = new Map<string, P>();
    let totalOutstanding = 0;
    let overdue = 0;
    let dueSoon = 0;
    for (const c of sales) {
      const bal = Math.max(0, n(c.total) - (recvByInv.get(c.code) ?? 0));
      if (bal <= 0) continue;
      totalOutstanding += bal;
      const key = c.customerName || '—';
      let p = parties.get(key);
      if (!p) { p = { custId: c.customerId ?? null, party: key, agent: (c.customerId != null ? custMap.get(c.customerId)?.agentName : null) ?? null, outstanding: 0, overdue: 0, oldestDays: 0 }; parties.set(key, p); }
      p.outstanding += bal;
      if (c.dueDate) {
        const days = Math.floor((today.getTime() - this.startOfDay(c.dueDate).getTime()) / DAY);
        if (days > 0) {
          overdue += bal;
          p.overdue += bal;
          p.oldestDays = Math.max(p.oldestDays, days);
          const bi = AGING.findIndex((a) => days >= a.lo && days <= a.hi);
          if (bi >= 0) { aging[bi].value += bal; agingParties[bi].add(key); }
        } else if (days >= -15) {
          dueSoon += bal;
        }
      }
    }
    aging.forEach((a, i) => { a.value = r0(a.value); a.parties = agingParties[i].size; });
    const advanceHeld = r0(advances.reduce((s, a) => s + n(a.bankAmt) + n(a.cashAmt), 0));

    const flagOf = (p: P): { flag: string; rank: number } => {
      if (p.overdue > 0 && p.oldestDays >= 60) return { flag: 'CALL NOW · 60+ days', rank: 1 };
      if (p.overdue > 0 && p.oldestDays >= 30) return { flag: 'CALL NOW · 30–59 days', rank: 2 };
      if (p.overdue > 0) return { flag: 'CALL · overdue', rank: 3 };
      if (p.outstanding > 0) return { flag: 'WATCH', rank: 5 };
      return { flag: 'CLEAR', rank: 7 };
    };
    const recovery = [...parties.values()]
      .map((p) => {
        const { flag, rank } = flagOf(p);
        const score = p.outstanding * (1 + p.oldestDays / 30);
        const lr = p.custId != null ? lastRecByCust.get(p.custId) : undefined;
        return { customerId: p.custId, party: p.party, agent: p.agent, outstanding: r0(p.outstanding), overdue: r0(p.overdue), oldestDays: p.oldestDays, lastReceipt: lr ? lr.toISOString() : null, flag, rank, score };
      })
      .sort((a, b) => a.rank - b.rank || b.score - a.score)
      .slice(0, 100)
      .map(({ score: _score, ...r }) => r);

    const topOverdueParties = [...parties.values()]
      .filter((p) => p.overdue > 0)
      .map((p) => ({ name: p.party, value: r0(p.overdue) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);

    return { totalOutstanding: r0(totalOutstanding), overdue: r0(overdue), dueSoon: r0(dueSoon), advanceHeld, collectedModes, topOverdueParties, aging, recovery, asOf: now.toISOString() };
  }

  // ── §8.7 Party Intelligence ─────────────────────────────────────────────────
  async partyIntel(): Promise<PartyIntelReport> {
    const now = new Date();
    const DAY = 86_400_000;
    const [custs, challans, orders, recvByInv] = await Promise.all([
      this.prisma.customer.findMany({ where: { active: true }, select: { id: true, partyName: true, agentName: true } }),
      this.prisma.challan.findMany({ where: { challanStatus: 'CONFIRMED' }, select: { customerId: true, customerName: true, total: true, code: true, transaction: true } }),
      this.prisma.order.findMany({ where: { status: { not: 'CANCELLED' } }, select: { customerId: true, customerName: true, orderDate: true } }),
      this.receivedByInvoice(),
    ]);
    const sales = challans.filter((c) => SALES_TX.has((c.transaction ?? '').trim().toUpperCase()));

    interface Agg { custId: number | null; party: string; agent: string | null; revenue: number; invoices: number; lastOrder: Date | null; outstanding: number }
    const map = new Map<string, Agg>();
    const keyOf = (name: string) => name.trim().toUpperCase();
    const custByName = new Map(custs.map((c) => [keyOf(c.partyName ?? ''), c]));
    const get = (name: string, custId: number | null): Agg => {
      const k = keyOf(name);
      let a = map.get(k);
      if (!a) { const cu = custByName.get(k); a = { custId: custId ?? cu?.id ?? null, party: name, agent: cu?.agentName ?? null, revenue: 0, invoices: 0, lastOrder: null, outstanding: 0 }; map.set(k, a); }
      return a;
    };
    for (const c of sales) {
      const a = get(c.customerName, c.customerId ?? null);
      a.revenue += n(c.total);
      a.invoices += 1;
      a.outstanding += Math.max(0, n(c.total) - (recvByInv.get(c.code) ?? 0));
    }
    for (const o of orders) {
      const a = get(o.customerName, o.customerId ?? null);
      if (!a.lastOrder || o.orderDate > a.lastOrder) a.lastOrder = o.orderDate;
    }

    const revenues = [...map.values()].map((a) => a.revenue).filter((v) => v > 0).sort((x, y) => x - y);
    const pct = (arr: number[], p: number) => (arr.length === 0 ? 0 : arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]);
    const vip = pct(revenues, 0.75);
    const median = pct(revenues, 0.5);

    const segmentOf = (a: Agg): string => {
      const days = a.lastOrder ? Math.floor((now.getTime() - a.lastOrder.getTime()) / DAY) : null;
      if (a.invoices === 0 && a.lastOrder == null) return 'No orders';
      if (days != null && days >= 120) return a.revenue >= vip ? 'Win-back' : 'Dormant';
      if (days != null && days >= 90) return 'At-risk';
      if (a.revenue >= vip) return 'VIP';
      if (a.invoices <= 1) return 'One-time';
      if (a.revenue >= median && a.invoices >= 2) return 'Loyal';
      return 'Active';
    };

    const segCount = new Map<string, number>();
    const segRev = new Map<string, number>();
    const parties = [...map.values()].map((a) => {
      const seg = segmentOf(a);
      segCount.set(seg, (segCount.get(seg) ?? 0) + 1);
      segRev.set(seg, (segRev.get(seg) ?? 0) + a.revenue);
      const days = a.lastOrder ? Math.floor((now.getTime() - a.lastOrder.getTime()) / DAY) : null;
      return { customerId: a.custId, party: a.party, agent: a.agent, revenue: r0(a.revenue), invoices: a.invoices, lastOrder: a.lastOrder ? a.lastOrder.toISOString() : null, daysSince: days, segment: seg, outstanding: r0(a.outstanding) };
    }).sort((x, y) => y.revenue - x.revenue).slice(0, 300);

    const SEG_ORDER = ['VIP', 'Loyal', 'Active', 'One-time', 'At-risk', 'Dormant', 'Win-back', 'No orders'];
    const segments = [...segCount.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => SEG_ORDER.indexOf(a.name) - SEG_ORDER.indexOf(b.name));
    const segmentRevenue = [...segRev.entries()]
      .map(([name, value]) => ({ name, value: r0(value) }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);

    // Revenue concentration: the top decile of revenue-earning parties + their share.
    const revSorted = [...map.values()].map((a) => a.revenue).filter((v) => v > 0).sort((x, y) => y - x);
    const totalRev = revSorted.reduce((s, v) => s + v, 0);
    const topCount = Math.max(1, Math.ceil(revSorted.length * 0.1));
    const topRev = revSorted.slice(0, topCount).reduce((s, v) => s + v, 0);
    const concentration = { topParties: topCount, totalParties: revSorted.length, topShare: totalRev > 0 ? topRev / totalRev : null };

    return { segments, segmentRevenue, concentration, parties, asOf: now.toISOString() };
  }

  // ── §8.8 Product & Design ───────────────────────────────────────────────────
  async productReport(): Promise<ProductReport> {
    const now = new Date();
    const [items, designs] = await Promise.all([
      this.prisma.challanItem.findMany({ select: { productName: true, amount: true, pCategory: true, design: true } }),
      this.prisma.design.findMany({ where: { active: true }, select: { designType: true, category: true, cost: true, rate: true } }),
    ]);
    const prod = new Map<string, { value: number; count: number }>();
    const cat = new Map<string, { value: number; count: number }>();
    const dsg = new Map<string, { value: number; count: number }>();
    for (const it of items) {
      const v = n(it.amount);
      if (v <= 0) continue;
      const name = (it.productName ?? '').trim() || '—';
      const p = prod.get(name); if (p) { p.value += v; p.count += 1; } else prod.set(name, { value: v, count: 1 });
      const c = (it.pCategory ?? '').trim() || 'Uncategorised';
      const cc = cat.get(c); if (cc) { cc.value += v; cc.count += 1; } else cat.set(c, { value: v, count: 1 });
      const d = (it.design ?? '').trim();
      if (d && !['NA', 'N/A', 'NONE', '-', 'NIL'].includes(d.toUpperCase())) { const dd = dsg.get(d); if (dd) { dd.value += v; dd.count += 1; } else dsg.set(d, { value: v, count: 1 }); }
    }

    const catMargin = new Map<string, { sum: number; count: number }>();
    const designMargin = designs
      .filter((d) => d.rate != null && d.rate > 0)
      .map((d) => {
        const rate = n(d.rate);
        const cost = n(d.cost);
        const unitMargin = rate - cost;
        const marginPct = rate > 0 ? (unitMargin / rate) * 100 : null;
        const flag: 'loss' | 'thin' | 'ok' = unitMargin <= 0 ? 'loss' : marginPct != null && marginPct < 15 ? 'thin' : 'ok';
        const cm = catMargin.get(d.category); if (cm && marginPct != null) { cm.sum += marginPct; cm.count += 1; } else if (marginPct != null) catMargin.set(d.category, { sum: marginPct, count: 1 });
        return { design: d.designType, category: d.category, cost: r0(cost), rate: r0(rate), unitMargin: Math.round(unitMargin * 100) / 100, marginPct: marginPct != null ? Math.round(marginPct * 10) / 10 : null, flag };
      })
      .sort((a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0))
      .slice(0, 80);

    const marginByCategory = [...catMargin.entries()].map(([name, v]) => ({ name, value: Math.round((v.sum / v.count) * 10) / 10 })).sort((a, b) => b.value - a.value);

    return { topProducts: this.topSlices(prod, 15), topDesigns: this.topSlices(dsg, 12), categoryMix: this.topSlices(cat, 10), designMargin, marginByCategory, asOf: now.toISOString() };
  }

  // ── §8.9 Patterns & Insights ────────────────────────────────────────────────
  async patterns(): Promise<PatternsReport> {
    const now = new Date();
    const DAY = 86_400_000;
    const [orderItems, challans] = await Promise.all([
      this.prisma.orderItem.findMany({ where: { status: 'CONFIRMED', order: { status: { not: 'CANCELLED' } } }, select: { productName: true, pCategory: true, order: { select: { id: true, customerName: true, orderDate: true } } } }),
      this.prisma.challan.findMany({ where: { challanStatus: 'CONFIRMED' }, select: { customerName: true, transaction: true } }),
    ]);

    // Per party: distinct orders + dates. Product-party pairs → distinct order count.
    const partyOrders = new Map<string, { orders: Set<number>; dates: Date[]; cats: Set<string> }>();
    const pairOrders = new Map<string, Set<number>>(); // `${party}|${product}` → orderIds
    const catPref = new Map<string, { value: number; count: number }>();
    for (const oi of orderItems) {
      const party = oi.order.customerName || '—';
      const oid = oi.order.id;
      let po = partyOrders.get(party);
      if (!po) { po = { orders: new Set(), dates: [], cats: new Set() }; partyOrders.set(party, po); }
      po.orders.add(oid);
      po.dates.push(oi.order.orderDate);
      const cat = (oi.pCategory ?? '').trim() || 'Uncategorised';
      po.cats.add(cat);
      const c = catPref.get(cat); if (c) c.value += 1; else catPref.set(cat, { value: 1, count: 1 });
      const prod = (oi.productName ?? '').trim();
      if (prod) {
        const pk = `${party}|${prod}`;
        let s = pairOrders.get(pk); if (!s) { s = new Set(); pairOrders.set(pk, s); } s.add(oid);
      }
    }

    let reorderedPairs = 0;
    const reorderProducts = new Map<string, { value: number; count: number }>();
    for (const [pk, orders] of pairOrders) {
      if (orders.size >= 2) {
        reorderedPairs += 1;
        const prod = pk.split('|')[1];
        const rp = reorderProducts.get(prod); if (rp) rp.value += 1; else reorderProducts.set(prod, { value: 1, count: 1 });
      }
    }
    const reorderRate = pairOrders.size > 0 ? reorderedPairs / pairOrders.size : null;

    // Avg order gap across repeat parties.
    const gaps: number[] = [];
    const loyal: { party: string; orders: number; avgGapDays: number | null; categories: number }[] = [];
    for (const [party, po] of partyOrders) {
      const uniqDates = [...new Set(po.dates.map((d) => this.startOfDay(d).getTime()))].sort((a, b) => a - b);
      let avgGap: number | null = null;
      if (uniqDates.length >= 2) {
        let sum = 0;
        for (let i = 1; i < uniqDates.length; i++) sum += (uniqDates[i] - uniqDates[i - 1]) / DAY;
        avgGap = Math.round(sum / (uniqDates.length - 1));
        gaps.push(avgGap);
      }
      loyal.push({ party, orders: po.orders.size, avgGapDays: avgGap, categories: po.cats.size });
    }
    loyal.sort((a, b) => b.orders - a.orders);

    // Repeat-party rate from invoices.
    const sales = challans.filter((c) => SALES_TX.has((c.transaction ?? '').trim().toUpperCase()));
    const invByParty = new Map<string, number>();
    for (const c of sales) invByParty.set(c.customerName, (invByParty.get(c.customerName) ?? 0) + 1);
    const withInv = [...invByParty.values()].filter((v) => v >= 1).length;
    const repeat = [...invByParty.values()].filter((v) => v >= 2).length;

    // Basket size = line-items ÷ distinct orders. Order-frequency distribution.
    let distinctOrders = 0;
    const freq = { '1 order': 0, '2–3 orders': 0, '4–6 orders': 0, '7+ orders': 0 };
    for (const po of partyOrders.values()) {
      distinctOrders += po.orders.size;
      const c = po.orders.size;
      if (c <= 1) freq['1 order'] += 1;
      else if (c <= 3) freq['2–3 orders'] += 1;
      else if (c <= 6) freq['4–6 orders'] += 1;
      else freq['7+ orders'] += 1;
    }
    const orderFrequency = Object.entries(freq).map(([name, value]) => ({ name, value })).filter((s) => s.value > 0);

    return {
      reorderRate,
      repeatPartyRate: withInv > 0 ? repeat / withInv : null,
      avgOrderGapDays: gaps.length ? Math.round(gaps.reduce((s, v) => s + v, 0) / gaps.length) : null,
      avgBasketItems: distinctOrders > 0 ? Math.round((orderItems.length / distinctOrders) * 10) / 10 : null,
      orderFrequency,
      categoryPreference: this.topSlices(catPref, 10),
      topReorderProducts: this.topSlices(reorderProducts, 12),
      loyalParties: loyal.slice(0, 25),
      asOf: now.toISOString(),
    };
  }

  // ── §8.10 Orders & Fulfilment ───────────────────────────────────────────────
  async fulfilment(): Promise<FulfilmentReport> {
    const now = new Date();
    const DAY = 86_400_000;
    const [orders, dispatchAgg, leadAgg, backlogRows, cancelParties, funnelAgg] = await Promise.all([
      this.prisma.order.findMany({ select: { status: true } }),
      this.prisma.$queryRawUnsafe<{ total: bigint; partial: bigint }[]>(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN UPPER(COALESCE(dispatchStatus,'')) LIKE 'PARTIAL%' THEN 1 ELSE 0 END) AS partial FROM dispatches",
      ),
      this.prisma.$queryRawUnsafe<{ avg: number | null }[]>("SELECT AVG(completionDay) AS avg FROM orders WHERE completionDay >= 0 AND status <> 'CANCELLED'"),
      // Open orders (undispatched, not yet billed) with age + urgent flag.
      this.prisma.$queryRawUnsafe<{ orderId: number; orderDate: Date; priority: string | null; rate: number | null; unit: string | null; oPcs: number; oGram: number; dPcs: number; dGram: number; billed: number | bigint }[]>(
        `SELECT o.id AS orderId, o.orderDate AS orderDate, COALESCE(NULLIF(oi.priority,''), o.priority) AS priority,
                COALESCE(oi.rate,0) AS rate, UPPER(COALESCE(oi.calField,'')) AS unit,
                COALESCE(oi.pcs,0) AS oPcs, COALESCE(oi.gram,0) AS oGram,
                COALESCE(d.dPcs,0) AS dPcs, COALESCE(d.dGram,0) AS dGram,
                EXISTS (SELECT 1 FROM dispatches dd JOIN challan_items ci ON ci.dispatchId = dd.id JOIN challans ch ON ch.id = ci.challanId AND ch.challanStatus <> 'CANCELLED' WHERE dd.orderItemId = oi.id) AS billed
           FROM order_items oi JOIN orders o ON o.id = oi.orderId
           LEFT JOIN (SELECT orderItemId, SUM(COALESCE(pcs,0)) AS dPcs, SUM(COALESCE(gram,0)) AS dGram FROM dispatches GROUP BY orderItemId) d ON d.orderItemId = oi.id
          WHERE oi.status = 'CONFIRMED' AND o.status <> 'CANCELLED'`,
      ),
      this.prisma.$queryRawUnsafe<{ name: string; c: bigint }[]>("SELECT customerName AS name, COUNT(*) AS c FROM orders WHERE status = 'CANCELLED' GROUP BY customerName ORDER BY c DESC LIMIT 10"),
      // Value funnel: ordered → dispatched → billed.
      this.prisma.$queryRawUnsafe<{ ordered: number | null; dispatched: number | null; billed: number | null }[]>(
        `SELECT
           (SELECT SUM(COALESCE(oi.rate,0) * (CASE WHEN UPPER(COALESCE(oi.calField,'')) = 'PCS' THEN COALESCE(oi.pcs,0) ELSE COALESCE(oi.gram,0) END))
              FROM order_items oi JOIN orders o ON o.id = oi.orderId WHERE oi.status = 'CONFIRMED' AND o.status <> 'CANCELLED') AS ordered,
           (SELECT SUM(COALESCE(d.rate,0) * (CASE WHEN UPPER(COALESCE(d.calField,'')) = 'PCS' THEN COALESCE(d.pcs,0) ELSE COALESCE(d.gram,0) END)) FROM dispatches d) AS dispatched,
           (SELECT SUM(COALESCE(total,0)) FROM challans WHERE challanStatus = 'CONFIRMED' AND UPPER(TRIM(COALESCE("transaction",''))) IN ('SALES INVOICE','DEBIT NOTE')) AS billed`,
      ),
    ]);

    const totalOrders = orders.length;
    const cancelledOrders = orders.filter((o) => o.status === 'CANCELLED').length;
    const dRow = dispatchAgg[0];
    const dispatchRows = Number(dRow?.total ?? 0);
    const partialRows = Number(dRow?.partial ?? 0);

    const BANDS = [
      { key: '0-7', label: '0–7 days', lo: 0, hi: 7 },
      { key: '8-15', label: '8–15 days', lo: 8, hi: 15 },
      { key: '16-30', label: '16–30 days', lo: 16, hi: 30 },
      { key: '30+', label: '30+ days', lo: 31, hi: Infinity },
    ];
    const aging = BANDS.map((b) => ({ key: b.key, label: b.label, orders: 0, value: 0 }));
    const openOrders = new Map<number, { value: number; age: number; urgent: boolean }>();
    for (const r of backlogRows) {
      if (Number(r.billed) > 0) continue;
      const ordered = r.unit === 'PCS' ? r.oPcs : r.oGram;
      const pending = ordered - (r.unit === 'PCS' ? r.dPcs : r.dGram);
      if (pending <= Math.max(0.5, ordered * 0.01)) continue;
      const value = n(r.rate) * pending;
      const urgent = (r.priority ?? '').toUpperCase() === 'URGENT';
      const age = Math.floor((now.getTime() - new Date(r.orderDate).getTime()) / DAY);
      const cur = openOrders.get(r.orderId);
      if (cur) { cur.value += value; cur.age = Math.max(cur.age, age); cur.urgent = cur.urgent || urgent; } else openOrders.set(r.orderId, { value, age, urgent });
    }
    let urgentOpen = 0;
    for (const o of openOrders.values()) {
      if (o.urgent) urgentOpen += 1;
      const bi = BANDS.findIndex((b) => o.age >= b.lo && o.age <= b.hi);
      if (bi >= 0) { aging[bi].orders += 1; aging[bi].value += o.value; }
    }
    aging.forEach((a) => (a.value = r0(a.value)));

    return {
      totalOrders,
      cancelledOrders,
      cancellationRate: totalOrders > 0 ? cancelledOrders / totalOrders : null,
      dispatchRows,
      partialRows,
      partialRate: dispatchRows > 0 ? partialRows / dispatchRows : null,
      avgLeadDays: leadAgg[0]?.avg != null ? Math.round(leadAgg[0].avg) : null,
      urgentOpen,
      pendingOrders: openOrders.size,
      aging,
      funnel: [
        { stage: 'Ordered', value: r0(n(funnelAgg[0]?.ordered)) },
        { stage: 'Dispatched', value: r0(n(funnelAgg[0]?.dispatched)) },
        { stage: 'Billed', value: r0(n(funnelAgg[0]?.billed)) },
      ],
      cancellationByParty: cancelParties.map((r) => ({ name: r.name || '—', value: Number(r.c) })),
      asOf: now.toISOString(),
    };
  }
}
