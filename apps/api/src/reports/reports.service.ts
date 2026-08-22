import { Injectable } from '@nestjs/common';
import { RETURNED_DISPATCH_STATUS } from '@oms/shared';
import type {
  BusinessOverview,
  JourneyDispatch,
  JourneyEvent,
  JourneyOrder,
  JourneyStage,
  OrderJourneyReport,
  CollectionsReport,
  FulfilmentReport,
  PartyIntelReport,
  PatternsReport,
  PeriodMetric,
  ProductReport,
  ReportFilterOptions,
  ReportFilters,
  ReportMeasure,
  ReportMonthPoint,
  ReportSlice,
  SalesReport,
  SummaryAnalysisAction,
  SummaryAnalysisReport,
  TrendDirection,
} from '@oms/shared';
import { Prisma } from '@prisma/client';
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
/** Two-way split for chart series: Bank absorbs Cheque, same convention
 *  Payments/Party Ledger already use for bankBal vs cashBal. */
const isBankMode = (m: string | null | undefined) => payModeOf(m) !== 'Cash';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private static readonly NOT_CHALLANED =
    "d.id NOT IN (SELECT ci.dispatchId FROM challan_items ci JOIN challans c ON c.id = ci.challanId WHERE ci.dispatchId IS NOT NULL AND c.challanStatus <> 'CANCELLED')";

  // ── filter helpers ──────────────────────────────────────────────────────────
  /** Distinct agents / regions / customers for the report filter bar. */
  async filterOptions(): Promise<ReportFilterOptions> {
    const custs = await this.prisma.customer.findMany({ where: { active: true }, select: { id: true, partyName: true, agentName: true, region: true } });
    const agents = new Set<string>();
    const regions = new Set<string>();
    const customers: { id: number; name: string }[] = [];
    for (const c of custs) {
      if (c.agentName && c.agentName.trim()) agents.add(c.agentName.trim());
      const rg = (c.region ?? '').trim();
      if (rg) regions.add(rg.toUpperCase());
      if (c.partyName && c.partyName.trim()) customers.push({ id: c.id, name: c.partyName.trim() });
    }
    const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    customers.sort((a, b) => a.name.localeCompare(b.name));
    return { agents: sorted(agents), regions: sorted(regions), customers };
  }

  /** Resolve a filter into party + date predicates. When any party filter is set,
   *  builds the allowed customer-id set once; date predicate is inclusive. */
  private async resolveFilter(f: ReportFilters): Promise<{ custOk: (id: number | null | undefined) => boolean; dateOk: (d: Date) => boolean; from: Date | null; to: Date | null }> {
    const from = f.from ? this.startOfDay(new Date(f.from)) : null;
    const to = f.to ? this.endOfDay(new Date(f.to)) : null;
    const ag = (f.agent ?? '').trim().toUpperCase();
    const rg = (f.region ?? '').trim().toUpperCase();
    let allowed: Set<number> | null = null;
    if (f.customerId != null || ag || rg) {
      const custs = await this.prisma.customer.findMany({ select: { id: true, agentName: true, region: true } });
      allowed = new Set(
        custs
          .filter((c) => {
            if (f.customerId != null && c.id !== f.customerId) return false;
            if (ag && ((c.agentName ?? '').trim().toUpperCase() || 'SELF') !== ag) return false;
            if (rg && ((c.region ?? '').trim().toUpperCase() || 'UNKNOWN') !== rg) return false;
            return true;
          })
          .map((c) => c.id),
      );
    }
    return {
      custOk: (id) => allowed == null || (id != null && allowed.has(id)),
      dateOk: (d) => (!from || d >= from) && (!to || d <= to),
      from,
      to,
    };
  }

  /** Current + previous comparison window. A custom from/to → that window vs the
   *  equal-length window immediately before; otherwise this FY-to-date vs last FY. */
  private resolveWindow(f: ReportFilters, now: Date): { curStart: Date; curEnd: Date; prevStart: Date; prevEnd: Date } {
    if (f.from || f.to) {
      const curStart = f.from ? this.startOfDay(new Date(f.from)) : new Date(2000, 0, 1);
      const curEnd = f.to ? this.endOfDay(new Date(f.to)) : now;
      const len = Math.max(1, curEnd.getTime() - curStart.getTime());
      return { curStart, curEnd, prevStart: new Date(curStart.getTime() - len), prevEnd: curStart };
    }
    const fyStart = this.startOfFinYear(now);
    const lastFyStart = new Date(fyStart.getFullYear() - 1, 3, 1);
    const elapsed = now.getTime() - fyStart.getTime();
    return { curStart: fyStart, curEnd: now, prevStart: lastFyStart, prevEnd: new Date(lastFyStart.getTime() + elapsed) };
  }
  private windowMetric(rows: DatedAmount[], w: { curStart: Date; curEnd: Date; prevStart: Date; prevEnd: Date }): PeriodMetric {
    const current = this.sumBetween(rows, w.curStart, new Date(w.curEnd.getTime() + 1));
    const previous = this.sumBetween(rows, w.prevStart, w.prevEnd);
    return this.toMetric(current, previous);
  }
  private endOfDay(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  }

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
  /** `cash` is derived as `value − bank`, not summed independently — a handful
   *  of invoices have `b + c` below `total` (a debit note reduced them without
   *  touching `total`), and deriving keeps a stacked Bank/Cash bar always
   *  summing exactly to the headline figure instead of falling slightly short. */
  private topSlices(map: Map<string, { value: number; count: number; bank?: number }>, cap: number): ReportSlice[] {
    return [...map.entries()]
      .map(([name, v]) => ({
        name,
        value: r0(v.value),
        count: v.count,
        ...(v.bank !== undefined ? { bank: r0(v.bank), cash: r0(v.value - v.bank) } : {}),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, cap);
  }

  async businessOverview(f: ReportFilters = {}): Promise<BusinessOverview> {
    const now = new Date();
    const win = this.resolveWindow(f, now);
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 11, 1); // 12 months incl. current
    const fx = await this.resolveFilter(f);

    const [challans, receipts, orders, custRows, backlog, recvByInv] = await Promise.all([
      this.prisma.challan.findMany({ where: { challanStatus: 'CONFIRMED' }, select: { code: true, invDate: true, total: true, b: true, c: true, category: true, customerName: true, customerId: true, transaction: true } }),
      this.prisma.acctPaymentReceipt.findMany({ select: { recDate: true, recAmt: true, payMode: true, custId: true } }),
      this.prisma.order.findMany({ where: { status: { not: 'CANCELLED' } }, select: { orderDate: true, customerId: true } }),
      this.prisma.customer.findMany({ select: { id: true, region: true, agentName: true } }),
      this.prisma.$queryRawUnsafe<{ customerId: number | null; dispatchDate: Date; amt: number | null }[]>(
        `SELECT d.customerId, d.dispatchDate,
                COALESCE(d.rate,0) * (CASE WHEN UPPER(COALESCE(d.calField,'')) = 'PCS' THEN COALESCE(d.pcs,0) ELSE COALESCE(d.gram,0) END) AS amt
           FROM dispatches d WHERE ${ReportsService.NOT_CHALLANED}`,
      ),
      this.receivedByInvoice(),
    ]);

    const custMap = new Map(custRows.map((c) => [c.id, c]));
    // Party-scope every source set (date is applied per-metric via the window).
    const sales = challans.filter((c) => SALES_TX.has((c.transaction ?? '').trim().toUpperCase()) && fx.custOk(c.customerId));
    const recs = receipts.filter((r) => fx.custOk(r.custId));
    const ords = orders.filter((o) => fx.custOk(o.customerId));

    const revenue = this.windowMetric(sales.map((c) => ({ date: c.invDate, amount: n(c.total) })), win);
    const collections = this.windowMetric(recs.map((r) => ({ date: r.recDate, amount: n(r.recAmt) })), win);
    const ordersMetric = this.windowMetric(ords.map((o) => ({ date: o.orderDate, amount: 1 })), win);
    const challansMetric = this.windowMetric(sales.map((c) => ({ date: c.invDate, amount: 1 })), win);

    // 12-month billed vs collected trend (party-scoped), each split by mode —
    // billed via Challan.b (bank)/.c (cash), collected via receipt payMode.
    const buckets = new Map<string, ReportMonthPoint>();
    for (let i = 0; i < 12; i++) {
      const d = new Date(trendStart.getFullYear(), trendStart.getMonth() + i, 1);
      buckets.set(this.monthKey(d), { month: this.monthKey(d), label: this.monthLabel(d), billed: 0, billedBank: 0, billedCash: 0, collected: 0, collectedBank: 0, collectedCash: 0 });
    }
    for (const c of sales) {
      const b = buckets.get(this.monthKey(c.invDate));
      if (!b) continue;
      b.billed += n(c.total);
      b.billedBank += n(c.b);
    }
    for (const rc of recs) {
      const b = buckets.get(this.monthKey(rc.recDate));
      if (!b) continue;
      b.collected += n(rc.recAmt);
      if (isBankMode(rc.payMode)) b.collectedBank += n(rc.recAmt);
      else b.collectedCash += n(rc.recAmt);
    }
    // billedCash derives from billed − billedBank (not summed independently) —
    // see topSlices()'s comment for why.
    const trend = [...buckets.values()].map((p) => ({
      ...p,
      billed: r0(p.billed), billedBank: r0(p.billedBank), billedCash: r0(p.billed - p.billedBank),
      collected: r0(p.collected), collectedBank: r0(p.collectedBank), collectedCash: r0(p.collectedCash),
    }));

    // In-window slices (category / party / region / agent) + collection modes,
    // each carrying its own bank split (billed via Challan.b) — cash derives
    // from value − bank via topSlices().
    const inWin = (d: Date) => d >= win.curStart && d <= win.curEnd;
    const cat = new Map<string, { value: number; count: number; bank: number }>();
    const party = new Map<string, { value: number; count: number; bank: number }>();
    const region = new Map<string, { value: number; count: number; bank: number }>();
    const agent = new Map<string, { value: number; count: number; bank: number }>();
    const modeMap = new Map<string, { value: number; count: number }>();
    const add = (m: Map<string, { value: number; count: number; bank: number }>, key: string, v: number, bank: number) => {
      const cur = m.get(key);
      if (cur) { cur.value += v; cur.count += 1; cur.bank += bank; } else m.set(key, { value: v, count: 1, bank });
    };
    const addMode = (m: Map<string, { value: number; count: number }>, key: string, v: number) => {
      const cur = m.get(key);
      if (cur) { cur.value += v; cur.count += 1; } else m.set(key, { value: v, count: 1 });
    };
    for (const c of sales) {
      if (!inWin(c.invDate)) continue;
      const v = n(c.total);
      const bank = n(c.b);
      add(cat, (c.category ?? '').trim() || 'Uncategorised', v, bank);
      add(party, c.customerName || '—', v, bank);
      const cust = c.customerId != null ? custMap.get(c.customerId) : undefined;
      add(region, ((cust?.region ?? '').trim().toUpperCase()) || 'UNKNOWN', v, bank);
      add(agent, ((cust?.agentName ?? '').trim()) || 'SELF', v, bank);
    }
    for (const rc of recs) { if (inWin(rc.recDate)) addMode(modeMap, payModeOf(rc.payMode), n(rc.recAmt)); }
    const collectionModes = ['Bank', 'Cash', 'Cheque'].map((name) => ({ name, value: r0(modeMap.get(name)?.value ?? 0) })).filter((s) => s.value > 0);

    // Outstanding is a balance view: party-scoped, all-time (never date-scoped).
    let outstanding = 0;
    const owing = new Set<string>();
    const activeIds = new Set(sales.filter((c) => inWin(c.invDate)).map((c) => c.customerId != null ? `c:${c.customerId}` : `n:${c.customerName.trim().toUpperCase()}`));
    for (const c of sales) {
      // b + c (not the gross total) — a handful of invoices have b/c reduced
      // below the gross total to reflect a debit note issued against them,
      // and total − receipts alone would still show those as fully owed.
      const balance = Math.max(0, n(c.b) + n(c.c) - (recvByInv.get(c.code) ?? 0));
      if (balance <= 0) continue;
      outstanding += balance;
      owing.add(c.customerId != null ? `c:${c.customerId}` : `n:${c.customerName.trim().toUpperCase()}`);
    }
    outstanding = r0(outstanding);
    const winDays = Math.max(1, Math.round((win.curEnd.getTime() - win.curStart.getTime()) / 86_400_000));
    const dsoDays = revenue.current > 0 ? r0((outstanding / revenue.current) * winDays) : null;
    const collectionRate = revenue.current > 0 ? collections.current / revenue.current : null;

    return {
      revenue,
      collections,
      orders: ordersMetric,
      challans: challansMetric,
      outstanding,
      collectionRate,
      dsoDays,
      backlogValue: r0(backlog.filter((b) => fx.custOk(b.customerId) && fx.dateOk(b.dispatchDate)).reduce((s, b) => s + n(b.amt), 0)),
      trend,
      categoryMix: this.topSlices(cat, 10),
      topParties: this.topSlices(party, 12),
      byRegion: this.topSlices(region, 12),
      byAgent: this.topSlices(agent, 12),
      avgInvoiceValue: challansMetric.current > 0 ? r0(revenue.current / challansMetric.current) : 0,
      activeParties: party.size,
      owingParties: owing.size,
      olderOwingParties: [...owing].filter((key) => !activeIds.has(key)).length,
      collectionModes,
      asOf: now.toISOString(),
    };
  }

  private startOfDay(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /** Received + written-off amount per invoice number (challan code) — the
   *  collections join key. Discounts count as settled money same as a receipt
   *  (Party Ledger and Payments both already treat them that way); without
   *  this, a discount-cleared invoice reads as still fully owed here. */
  private async receivedByInvoice(): Promise<Map<string, number>> {
    const [receipts, discounts] = await Promise.all([
      this.prisma.acctPaymentReceipt.findMany({ select: { invNo: true, recAmt: true } }),
      this.prisma.acctPartyDiscount.findMany({ select: { invNo: true, disAmt: true } }),
    ]);
    const m = new Map<string, number>();
    for (const r of receipts) m.set(r.invNo, (m.get(r.invNo) ?? 0) + n(r.recAmt));
    for (const d of discounts) m.set(d.invNo, (m.get(d.invNo) ?? 0) + n(d.disAmt));
    return m;
  }

  /** Same as {@link receivedByInvoice}, split by mode (Bank absorbs Cheque) —
   *  for charts that need a bank/cash breakdown of outstanding money. */
  private async receivedByInvoiceSplit(): Promise<Map<string, { bank: number; cash: number }>> {
    const [receipts, discounts] = await Promise.all([
      this.prisma.acctPaymentReceipt.findMany({ select: { invNo: true, recAmt: true, payMode: true } }),
      this.prisma.acctPartyDiscount.findMany({ select: { invNo: true, disAmt: true, billType: true } }),
    ]);
    const m = new Map<string, { bank: number; cash: number }>();
    const bump = (invNo: string, bank: number, cash: number) => {
      const cur = m.get(invNo) ?? { bank: 0, cash: 0 };
      cur.bank += bank;
      cur.cash += cash;
      m.set(invNo, cur);
    };
    for (const r of receipts) bump(r.invNo, isBankMode(r.payMode) ? n(r.recAmt) : 0, isBankMode(r.payMode) ? 0 : n(r.recAmt));
    for (const d of discounts) bump(d.invNo, d.billType === 'BANK' ? n(d.disAmt) : 0, d.billType === 'BANK' ? 0 : n(d.disAmt));
    return m;
  }

  // ── §8.6 Sales & Revenue ────────────────────────────────────────────────────
  async salesReport(months = 12, f: ReportFilters = {}): Promise<SalesReport> {
    const now = new Date();
    const span = Math.min(Math.max(Math.trunc(months) || 12, 1), 36);
    const first = new Date(now.getFullYear(), now.getMonth() - (span - 1), 1);
    const fx = await this.resolveFilter(f);
    const [challans, custRows] = await Promise.all([
      this.prisma.challan.findMany({ where: { challanStatus: 'CONFIRMED' }, select: { invDate: true, total: true, b: true, c: true, category: true, customerName: true, customerId: true, transaction: true } }),
      this.prisma.customer.findMany({ select: { id: true, region: true, agentName: true, state: true } }),
    ]);
    const custMap = new Map(custRows.map((c) => [c.id, c]));
    const partySales = challans.filter((c) => SALES_TX.has((c.transaction ?? '').trim().toUpperCase()) && fx.custOk(c.customerId));
    const sales = partySales.filter((c) => fx.dateOk(c.invDate));

    const buckets = new Map<string, ReportMonthPoint>();
    for (let i = 0; i < span; i++) {
      const d = new Date(first.getFullYear(), first.getMonth() + i, 1);
      buckets.set(this.monthKey(d), { month: this.monthKey(d), label: this.monthLabel(d), billed: 0, billedBank: 0, billedCash: 0, collected: 0, collectedBank: 0, collectedCash: 0 });
    }
    const agent = new Map<string, { value: number; count: number; bank: number }>();
    const region = new Map<string, { value: number; count: number; bank: number }>();
    const state = new Map<string, { value: number; count: number; bank: number }>();
    const party = new Map<string, { value: number; count: number; bank: number }>();
    const cat = new Map<string, { value: number; count: number; bank: number }>();
    const add = (m: Map<string, { value: number; count: number; bank: number }>, k: string, v: number, bank: number) => {
      const cur = m.get(k);
      if (cur) { cur.value += v; cur.count += 1; cur.bank += bank; } else m.set(k, { value: v, count: 1, bank });
    };
    for (const c of sales) {
      const v = n(c.total);
      const bank = n(c.b);
      const b = buckets.get(this.monthKey(c.invDate));
      if (b) { b.billed += v; b.billedBank += bank; }
      const cu = c.customerId != null ? custMap.get(c.customerId) : undefined;
      add(agent, (cu?.agentName ?? '').trim() || 'SELF', v, bank);
      add(region, (cu?.region ?? '').trim().toUpperCase() || 'UNKNOWN', v, bank);
      add(state, (cu?.state ?? '').trim().toUpperCase() || 'UNKNOWN', v, bank);
      add(party, c.customerName || '—', v, bank);
      add(cat, (c.category ?? '').trim() || 'Uncategorised', v, bank);
    }
    const historyByMonth = new Array(12).fill(0);
    const historyPeriods = new Array(12).fill(0).map(() => new Set<string>());
    for (const c of partySales) {
      const month = c.invDate.getMonth();
      historyByMonth[month] += n(c.total);
      historyPeriods[month].add(this.monthKey(c.invDate));
    }
    const monthAverages = historyByMonth.map((v, i) => v / Math.max(1, historyPeriods[i].size));
    const meanMonth = monthAverages.reduce((s, v) => s + v, 0) / 12 || 1;
    const seasonality = monthAverages.map((v, i) => ({ month: String(i + 1).padStart(2, '0'), label: MON[i], index: Math.round((v / meanMonth) * 100) / 100 }));

    // Year-over-year, aligned to the Indian FY (Apr→Mar), each split by mode.
    const fyStart = this.startOfFinYear(now);
    const lastFyStart = new Date(fyStart.getFullYear() - 1, 3, 1);
    const fyEnd = new Date(fyStart.getFullYear() + 1, 3, 1);
    const yoyThis = new Array(12).fill(0);
    const yoyThisBank = new Array(12).fill(0);
    const yoyLast = new Array(12).fill(0);
    const yoyLastBank = new Array(12).fill(0);
    for (const c of partySales) {
      const t = c.invDate;
      const idx = (t.getMonth() - 3 + 12) % 12; // Apr=0 … Mar=11
      if (t >= fyStart && t < fyEnd && t <= now) { yoyThis[idx] += n(c.total); yoyThisBank[idx] += n(c.b); }
      else if (t >= lastFyStart && t < fyStart) { yoyLast[idx] += n(c.total); yoyLastBank[idx] += n(c.b); }
    }
    const FYMON = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
    // Cash derives from the year total minus bank — see topSlices()'s comment.
    const yoy = FYMON.map((label, i) => ({
      label,
      thisYear: r0(yoyThis[i]), thisYearBank: r0(yoyThisBank[i]), thisYearCash: r0(yoyThis[i] - yoyThisBank[i]),
      lastYear: r0(yoyLast[i]), lastYearBank: r0(yoyLastBank[i]), lastYearCash: r0(yoyLast[i] - yoyLastBank[i]),
    }));
    // Like-for-like growth: this FY-to-date vs last FY over the SAME elapsed months
    // (comparing 4 months against a full 12 would be misleading).
    const tThis = yoyThis.reduce((s, v) => s + v, 0);
    const lastCutoff = new Date(lastFyStart.getTime() + (now.getTime() - fyStart.getTime()));
    const tLast = partySales.filter((c) => c.invDate >= lastFyStart && c.invDate <= lastCutoff).reduce((s, c) => s + n(c.total), 0);

    return {
      monthly: [...buckets.values()].map((p) => ({ ...p, billed: r0(p.billed), billedBank: r0(p.billedBank), billedCash: r0(p.billed - p.billedBank) })),
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
  async collectionsReport(f: ReportFilters = {}): Promise<CollectionsReport> {
    const now = new Date();
    const today = this.startOfDay(now);
    const DAY = 86_400_000;
    const fx = await this.resolveFilter(f);
    const [challans, custRows, advances, recvByInv, lastRec, payFollowups] = await Promise.all([
      this.prisma.challan.findMany({ where: { challanStatus: 'CONFIRMED' }, select: { code: true, total: true, b: true, c: true, invDate: true, dueDate: true, customerId: true, customerName: true, transaction: true } }),
      this.prisma.customer.findMany({ select: { id: true, partyName: true, agentName: true } }),
      this.prisma.acctPartyAdvance.findMany({ select: { custId: true, bankAmt: true, cashAmt: true } }),
      this.receivedByInvoiceSplit(),
      this.prisma.acctPaymentReceipt.findMany({ select: { custId: true, recDate: true, recAmt: true, payMode: true } }),
      // The live recovery CRM: payment follow-ups drive the contact/promise signals.
      this.prisma.followup.findMany({ where: { kind: 'PAYMENT' }, select: { customerId: true, partyName: true, status: true, promisedAt: true, promisedAmount: true, updatedAt: true, resolvedAt: true } }),
    ]);
    const custMap = new Map(custRows.map((c) => [c.id, c]));
    const allowedNames = new Set(custRows.filter((c) => fx.custOk(c.id)).map((c) => (c.partyName ?? '').trim().toUpperCase()));
    const fyStart = this.startOfFinYear(now);
    const lastRecByCust = new Map<number, Date>();
    const modeMap = new Map<string, { value: number; count: number }>();
    const addMode = (k: string, v: number) => { const cur = modeMap.get(k); if (cur) { cur.value += v; cur.count += 1; } else modeMap.set(k, { value: v, count: 1 }); };
    // Mode split honours party + date; the FY floor still applies when no range set.
    const modeFrom = fx.from ?? fyStart;
    for (const r of lastRec) {
      const cur = lastRecByCust.get(r.custId);
      if (!cur || r.recDate > cur) lastRecByCust.set(r.custId, r.recDate);
      if (fx.custOk(r.custId) && r.recDate >= modeFrom && (!fx.to || r.recDate <= fx.to)) addMode(payModeOf(r.payMode), n(r.recAmt));
    }
    const collectedModes = ['Bank', 'Cash', 'Cheque'].map((name) => ({ name, value: r0(modeMap.get(name)?.value ?? 0) })).filter((s) => s.value > 0);
    // Balance views are party-scoped but never date-scoped (an open invoice is open
    // regardless of the window).
    const sales = challans.filter((c) => SALES_TX.has((c.transaction ?? '').trim().toUpperCase()) && fx.custOk(c.customerId));

    const AGING = [
      { key: '1-30', label: '1–30 days', lo: 1, hi: 30 },
      { key: '31-60', label: '31–60 days', lo: 31, hi: 60 },
      { key: '61-90', label: '61–90 days', lo: 61, hi: 90 },
      { key: '90+', label: '90+ days', lo: 91, hi: Infinity },
    ];
    const aging = AGING.map((a) => ({ key: a.key, label: a.label, value: 0, bank: 0, cash: 0, parties: 0 }));
    const agingParties: Set<string>[] = AGING.map(() => new Set());

    interface P { custId: number | null; party: string; agent: string | null; outstanding: number; overdue: number; overdueBank: number; overdueCash: number; oldestDays: number }
    const parties = new Map<string, P>();
    let totalOutstanding = 0;
    let overdue = 0;
    let dueSoon = 0;
    for (const c of sales) {
      const split = recvByInv.get(c.code) ?? { bank: 0, cash: 0 };
      const bankBal = Math.max(0, n(c.b) - split.bank);
      const cashBal = Math.max(0, n(c.c) - split.cash);
      const bal = bankBal + cashBal;
      if (bal <= 0) continue;
      totalOutstanding += bal;
      const key = c.customerName || '—';
      let p = parties.get(key);
      if (!p) { p = { custId: c.customerId ?? null, party: key, agent: (c.customerId != null ? custMap.get(c.customerId)?.agentName : null) ?? null, outstanding: 0, overdue: 0, overdueBank: 0, overdueCash: 0, oldestDays: 0 }; parties.set(key, p); }
      p.outstanding += bal;
      if (c.dueDate) {
        const days = Math.floor((today.getTime() - this.startOfDay(c.dueDate).getTime()) / DAY);
        if (days > 0) {
          overdue += bal;
          p.overdue += bal;
          p.overdueBank += bankBal;
          p.overdueCash += cashBal;
          p.oldestDays = Math.max(p.oldestDays, days);
          const bi = AGING.findIndex((a) => days >= a.lo && days <= a.hi);
          if (bi >= 0) { aging[bi].value += bal; aging[bi].bank += bankBal; aging[bi].cash += cashBal; agingParties[bi].add(key); }
        } else if (days >= -15) {
          dueSoon += bal;
        }
      }
    }
    aging.forEach((a, i) => { a.value = r0(a.value); a.bank = r0(a.bank); a.cash = r0(a.cash); a.parties = agingParties[i].size; });
    const advanceHeld = r0(advances.filter((a) => fx.custOk(a.custId)).reduce((s, a) => s + n(a.bankAmt) + n(a.cashAmt), 0));

    // ── CRM recovery signals (from PAYMENT follow-ups) ──
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    interface Crm { lastContact: Date | null; nextPromise: Date | null; nextAmount: number | null; open: number; broken: boolean; dueToday: boolean; promisedValue: number; brokenValue: number }
    const crmByKey = new Map<string, Crm>();
    const nameKey = (name: string) => `n:${name.trim().toUpperCase()}`;
    let resolvedThisMonth = 0;
    for (const fu of payFollowups) {
      if (!(fx.custOk(fu.customerId) || (fu.customerId == null && allowedNames.has(fu.partyName.trim().toUpperCase())))) continue;
      if (fu.resolvedAt && fu.resolvedAt >= monthStart) resolvedThisMonth += 1;
      const key = fu.customerId != null ? `c:${fu.customerId}` : nameKey(fu.partyName);
      let c = crmByKey.get(key);
      if (!c) { c = { lastContact: null, nextPromise: null, nextAmount: null, open: 0, broken: false, dueToday: false, promisedValue: 0, brokenValue: 0 }; crmByKey.set(key, c); }
      if (!c.lastContact || fu.updatedAt > c.lastContact) c.lastContact = fu.updatedAt;
      if (fu.status === 'OPEN') {
        c.open += 1;
        if (fu.promisedAt) {
          if (!c.nextPromise || fu.promisedAt < c.nextPromise) { c.nextPromise = fu.promisedAt; c.nextAmount = fu.promisedAmount ?? null; }
          const days = Math.floor((today.getTime() - this.startOfDay(fu.promisedAt).getTime()) / DAY);
          if (days > 0) { c.broken = true; c.brokenValue += n(fu.promisedAmount); }
          else { if (days === 0) c.dueToday = true; c.promisedValue += n(fu.promisedAmount); }
        }
      }
    }
    const crmFor = (custId: number | null, party: string): Crm | undefined => crmByKey.get(custId != null ? `c:${custId}` : nameKey(party)) ?? (custId != null ? crmByKey.get(nameKey(party)) : undefined);
    const stageOf = (c: Crm | undefined): { stage: 'Not contacted' | 'In progress' | 'Promised' | 'Promise broken' | 'Callback due' | 'Resolved'; promiseState: 'none' | 'upcoming' | 'due today' | 'broken' } => {
      if (!c || (c.open === 0 && !c.lastContact)) return { stage: 'Not contacted', promiseState: 'none' };
      if (c.open === 0) return { stage: 'Resolved', promiseState: 'none' };
      if (c.broken) return { stage: 'Promise broken', promiseState: 'broken' };
      if (c.dueToday) return { stage: 'Callback due', promiseState: 'due today' };
      if (c.nextPromise) return { stage: 'Promised', promiseState: 'upcoming' };
      return { stage: 'In progress', promiseState: 'none' };
    };

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
        const c = crmFor(p.custId, p.party);
        const { stage, promiseState } = stageOf(c);
        // A broken promise or a due callback is the most urgent — it outranks age.
        const crmBoost = stage === 'Promise broken' ? -0.5 : stage === 'Callback due' ? -0.25 : 0;
        const score = p.outstanding * (1 + p.oldestDays / 30);
        const lr = p.custId != null ? lastRecByCust.get(p.custId) : undefined;
        const daysSince = c?.lastContact ? Math.floor((today.getTime() - this.startOfDay(c.lastContact).getTime()) / DAY) : null;
        return {
          customerId: p.custId, party: p.party, agent: p.agent,
          outstanding: r0(p.outstanding), overdue: r0(p.overdue), oldestDays: p.oldestDays,
          lastReceipt: lr ? lr.toISOString() : null, flag, rank: rank + crmBoost,
          stage, lastContactAt: c?.lastContact ? c.lastContact.toISOString() : null, daysSinceContact: daysSince,
          nextPromiseAt: c?.nextPromise ? c.nextPromise.toISOString() : null, nextPromiseAmount: c?.nextAmount ?? null, promiseState, openFollowups: c?.open ?? 0,
          score,
        };
      })
      .sort((a, b) => a.rank - b.rank || b.score - a.score)
      .slice(0, 150)
      .map(({ score: _score, rank, ...r }) => ({ ...r, rank: Math.round(rank) }));

    const topOverdueParties = [...parties.values()]
      .filter((p) => p.overdue > 0)
      .map((p) => ({ name: p.party, value: r0(p.overdue), bank: r0(p.overdueBank), cash: r0(p.overdueCash) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);

    // Recovery KPIs + pipeline over all owing parties.
    const owing = [...parties.values()].filter((p) => p.outstanding > 0);
    const stageVal = new Map<string, { parties: number; value: number }>();
    let promisesDueToday = 0;
    let promisesOverdue = 0;
    let neverContacted = 0;
    let inProgress = 0;
    let promisedParties = 0;
    let promisedValue = 0;
    let brokenPromiseValue = 0;
    for (const p of owing) {
      const c = crmFor(p.custId, p.party);
      const { stage } = stageOf(c);
      const sv = stageVal.get(stage) ?? { parties: 0, value: 0 };
      sv.parties += 1; sv.value += p.outstanding; stageVal.set(stage, sv);
      if (stage === 'Not contacted') neverContacted += 1;
      if (c && c.open > 0) inProgress += 1;
      if (c?.dueToday) promisesDueToday += 1;
      if (c?.broken) promisesOverdue += 1;
      if (c?.nextPromise && !c.broken) promisedParties += 1;
      if (c) { promisedValue += c.promisedValue; brokenPromiseValue += c.brokenValue; }
    }
    const STAGE_ORDER = ['Promise broken', 'Callback due', 'Not contacted', 'In progress', 'Promised', 'Resolved'];
    const pipeline = [...stageVal.entries()]
      .map(([stage, v]) => ({ stage: stage as 'Not contacted' | 'In progress' | 'Promised' | 'Promise broken' | 'Callback due' | 'Resolved', parties: v.parties, value: r0(v.value) }))
      .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));

    // Collection trend (last 12 months collected) + efficiency.
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const tb = new Map<string, { month: string; label: string; collected: number; collectedBank: number; collectedCash: number }>();
    for (let i = 0; i < 12; i++) { const d = new Date(trendStart.getFullYear(), trendStart.getMonth() + i, 1); tb.set(this.monthKey(d), { month: this.monthKey(d), label: this.monthLabel(d), collected: 0, collectedBank: 0, collectedCash: 0 }); }
    for (const r of lastRec) {
      if (!fx.custOk(r.custId)) continue;
      const b = tb.get(this.monthKey(r.recDate));
      if (!b) continue;
      b.collected += n(r.recAmt);
      if (isBankMode(r.payMode)) b.collectedBank += n(r.recAmt);
      else b.collectedCash += n(r.recAmt);
    }
    const collectionTrend = [...tb.values()].map((p) => ({ ...p, collected: r0(p.collected), collectedBank: r0(p.collectedBank), collectedCash: r0(p.collectedCash) }));

    const periodStart = fx.from ?? this.startOfFinYear(now);
    const periodEnd = fx.to ?? now;
    const periodBilled = sales.filter((c) => c.invDate >= periodStart && c.invDate <= periodEnd).reduce((s, c) => s + n(c.total), 0);
    const periodCollected = lastRec.filter((r) => fx.custOk(r.custId) && r.recDate >= periodStart && r.recDate <= periodEnd).reduce((s, r) => s + n(r.recAmt), 0);
    const collectionRate = periodBilled > 0 ? periodCollected / periodBilled : null;
    const periodDays = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / DAY));
    const dsoDays = periodBilled > 0 ? r0((totalOutstanding / periodBilled) * periodDays) : null;

    const activeKeys = new Set(
      sales
        .filter((c) => fx.dateOk(c.invDate))
        .map((c) => c.customerId != null ? `c:${c.customerId}` : nameKey(c.customerName)),
    );
    const owingKeys = owing.map((p) => p.custId != null ? `c:${p.custId}` : nameKey(p.party));

    return {
      totalOutstanding: r0(totalOutstanding), overdue: r0(overdue), dueSoon: r0(dueSoon), advanceHeld,
      owingParties: owing.length,
      olderOwingParties: owingKeys.filter((key) => !activeKeys.has(key)).length,
      collectionRate, dsoDays, collectedModes, topOverdueParties, aging, collectionTrend,
      recoveryKpis: { promisesDueToday, promisesOverdue, neverContacted, inProgress, resolvedThisMonth, promisedParties, promisedValue: r0(promisedValue), brokenPromiseValue: r0(brokenPromiseValue) },
      pipeline, recovery, asOf: now.toISOString(),
    };
  }

  // ── §8.7 Party Intelligence ─────────────────────────────────────────────────
  async partyIntel(f: ReportFilters = {}): Promise<PartyIntelReport> {
    const now = new Date();
    const DAY = 86_400_000;
    const fx = await this.resolveFilter(f);
    const [custs, challans, orders, recvByInv] = await Promise.all([
      this.prisma.customer.findMany({ where: { active: true }, select: { id: true, partyName: true, agentName: true } }),
      this.prisma.challan.findMany({ where: { challanStatus: 'CONFIRMED' }, select: { customerId: true, customerName: true, total: true, b: true, c: true, code: true, invDate: true, transaction: true } }),
      this.prisma.order.findMany({ where: { status: { not: 'CANCELLED' } }, select: { customerId: true, customerName: true, orderDate: true } }),
      this.receivedByInvoice(),
    ]);
    const allSales = challans.filter((c) => SALES_TX.has((c.transaction ?? '').trim().toUpperCase()) && fx.custOk(c.customerId));
    const sales = allSales.filter((c) => fx.dateOk(c.invDate));

    const asOfDate = fx.to ?? now;
    interface Agg { custId: number | null; party: string; agent: string | null; revenue: number; revenueBank: number; invoices: number; lifeRevenue: number; lifeInvoices: number; lastOrder: Date | null; outstanding: number }
    const map = new Map<string, Agg>();
    const keyOf = (name: string) => name.trim().toUpperCase();
    const custByName = new Map(custs.map((c) => [keyOf(c.partyName ?? ''), c]));
    const get = (name: string, custId: number | null): Agg => {
      const k = keyOf(name);
      let a = map.get(k);
      if (!a) { const cu = custByName.get(k); a = { custId: custId ?? cu?.id ?? null, party: name, agent: cu?.agentName ?? null, revenue: 0, revenueBank: 0, invoices: 0, lifeRevenue: 0, lifeInvoices: 0, lastOrder: null, outstanding: 0 }; map.set(k, a); }
      return a;
    };
    for (const c of custs) if (fx.custOk(c.id) && c.partyName?.trim()) get(c.partyName, c.id);
    for (const c of sales) {
      const a = get(c.customerName, c.customerId ?? null);
      a.revenue += n(c.total);
      a.revenueBank += n(c.b);
      a.invoices += 1;
    }
    for (const c of allSales) {
      const a = get(c.customerName, c.customerId ?? null);
      if (c.invDate <= asOfDate) { a.lifeRevenue += n(c.total); a.lifeInvoices += 1; }
      // b + c (not the gross total) — see receivedByInvoice()'s comment.
      a.outstanding += Math.max(0, n(c.b) + n(c.c) - (recvByInv.get(c.code) ?? 0));
    }
    for (const o of orders) {
      if (!fx.custOk(o.customerId) || o.orderDate > asOfDate) continue;
      const a = get(o.customerName, o.customerId ?? null);
      if (!a.lastOrder || o.orderDate > a.lastOrder) a.lastOrder = o.orderDate;
    }

    const revenues = [...map.values()].map((a) => a.lifeRevenue).filter((v) => v > 0).sort((x, y) => x - y);
    const pct = (arr: number[], p: number) => (arr.length === 0 ? 0 : arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]);
    const vip = pct(revenues, 0.75);
    const median = pct(revenues, 0.5);

    const segmentOf = (a: Agg): string => {
      const days = a.lastOrder ? Math.floor((asOfDate.getTime() - a.lastOrder.getTime()) / DAY) : null;
      if (a.lifeInvoices === 0 && a.lastOrder == null) return 'No orders';
      if (days != null && days >= 120) return a.lifeRevenue >= vip ? 'Win-back' : 'Dormant';
      if (days != null && days >= 90) return 'At-risk';
      if (a.lifeRevenue >= vip) return 'VIP';
      if (a.lifeInvoices <= 1) return 'One-time';
      if (a.lifeRevenue >= median && a.lifeInvoices >= 2) return 'Loyal';
      return 'Active';
    };

    const segCount = new Map<string, number>();
    const segRev = new Map<string, { value: number; bank: number }>();
    const parties = [...map.values()].map((a) => {
      const seg = segmentOf(a);
      segCount.set(seg, (segCount.get(seg) ?? 0) + 1);
      const sr = segRev.get(seg) ?? { value: 0, bank: 0 };
      sr.value += a.revenue; sr.bank += a.revenueBank;
      segRev.set(seg, sr);
      const days = a.lastOrder ? Math.floor((asOfDate.getTime() - a.lastOrder.getTime()) / DAY) : null;
      return { customerId: a.custId, party: a.party, agent: a.agent, revenue: r0(a.revenue), invoices: a.invoices, lastOrder: a.lastOrder ? a.lastOrder.toISOString() : null, daysSince: days, segment: seg, outstanding: r0(a.outstanding) };
    }).sort((x, y) => y.revenue - x.revenue).slice(0, 300);

    const SEG_ORDER = ['VIP', 'Loyal', 'Active', 'One-time', 'At-risk', 'Dormant', 'Win-back', 'No orders'];
    const segments = [...segCount.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => SEG_ORDER.indexOf(a.name) - SEG_ORDER.indexOf(b.name));
    // Cash derives from value − bank — see topSlices()'s comment.
    const segmentRevenue = [...segRev.entries()]
      .map(([name, v]) => ({ name, value: r0(v.value), bank: r0(v.bank), cash: r0(v.value - v.bank) }))
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
  async productReport(f: ReportFilters = {}, measure: ReportMeasure = 'amount'): Promise<ProductReport> {
    const now = new Date();
    const fx = await this.resolveFilter(f);
    const [rawItems, designs] = await Promise.all([
      this.prisma.challanItem.findMany({ select: { productName: true, amount: true, bags: true, pcs: true, kgs: true, box: true, pCategory: true, design: true, challan: { select: { invDate: true, customerId: true, challanStatus: true, transaction: true, total: true, b: true, c: true } } } }),
      this.prisma.design.findMany({ where: { active: true }, select: { designType: true, category: true, cost: true, rate: true } }),
    ]);
    // Only lines from live challans, party + date scoped.
    const items = rawItems.filter((it) => it.challan && it.challan.challanStatus === 'CONFIRMED' && SALES_TX.has((it.challan.transaction ?? '').trim().toUpperCase()) && fx.custOk(it.challan.customerId) && fx.dateOk(it.challan.invDate));
    // Slice by the chosen measure: money (amount) or a physical unit.
    const measureOf = (it: (typeof items)[number]): number =>
      measure === 'bags' ? n(it.bags) : measure === 'pcs' ? n(it.pcs) : measure === 'kgs' ? n(it.kgs) : measure === 'box' ? n(it.box) : n(it.amount);
    // A line has no bank/cash of its own — only its parent invoice does. For the
    // money measure, attribute each line's bank share pro-rata to the invoice's
    // own b ÷ total ratio (cash then derives as value − bank via topSlices()); a
    // physical quantity (bags/pcs/kgs/box) has no payment mode at all, so it
    // isn't split — bank/cash simply aren't set on those slices.
    const bankShareOf = (it: (typeof items)[number]): number | null => {
      if (measure !== 'amount' || !it.challan) return null;
      const total = n(it.challan.total);
      if (total <= 0) return 0;
      return n(it.challan.b) * (n(it.amount) / total);
    };
    const prod = new Map<string, { value: number; count: number; bank?: number }>();
    const cat = new Map<string, { value: number; count: number; bank?: number }>();
    const dsg = new Map<string, { value: number; count: number; bank?: number }>();
    const bump = (m: Map<string, { value: number; count: number; bank?: number }>, key: string, v: number, bank: number | null) => {
      const cur = m.get(key);
      if (cur) {
        cur.value += v; cur.count += 1;
        if (bank != null) cur.bank = (cur.bank ?? 0) + bank;
      } else {
        m.set(key, { value: v, count: 1, ...(bank != null ? { bank } : {}) });
      }
    };
    for (const it of items) {
      const v = measureOf(it);
      if (v <= 0) continue;
      const bank = bankShareOf(it);
      const name = (it.productName ?? '').trim() || '—';
      bump(prod, name, v, bank);
      const c = (it.pCategory ?? '').trim() || 'Uncategorised';
      bump(cat, c, v, bank);
      const d = (it.design ?? '').trim();
      if (d && !['NA', 'N/A', 'NONE', '-', 'NIL'].includes(d.toUpperCase())) bump(dsg, d, v, bank);
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

    return { measure, topProducts: this.topSlices(prod, 15), topDesigns: this.topSlices(dsg, 12), categoryMix: this.topSlices(cat, 10), designMargin, marginByCategory, asOf: now.toISOString() };
  }

  // ── §8.9 Patterns & Insights ────────────────────────────────────────────────
  async patterns(f: ReportFilters = {}): Promise<PatternsReport> {
    const now = new Date();
    const DAY = 86_400_000;
    const fx = await this.resolveFilter(f);
    const [rawItems, challans] = await Promise.all([
      this.prisma.orderItem.findMany({ where: { status: 'CONFIRMED', order: { status: { not: 'CANCELLED' } } }, select: { productName: true, pCategory: true, order: { select: { id: true, customerName: true, customerId: true, orderDate: true } } } }),
      this.prisma.challan.findMany({ where: { challanStatus: 'CONFIRMED' }, select: { customerName: true, customerId: true, invDate: true, transaction: true } }),
    ]);
    const orderItems = rawItems.filter((oi) => fx.custOk(oi.order.customerId) && fx.dateOk(oi.order.orderDate));

    // Per party: distinct orders + dates. Product-party pairs → distinct order count.
    const partyOrders = new Map<string, { orders: Set<number>; orderDates: Map<number, Date>; cats: Set<string> }>();
    const pairOrders = new Map<string, Set<number>>(); // `${party}|${product}` → orderIds
    const catPref = new Map<string, { value: number; count: number }>();
    const categoryOrders = new Set<string>();
    for (const oi of orderItems) {
      const party = oi.order.customerName || '—';
      const oid = oi.order.id;
      let po = partyOrders.get(party);
      if (!po) { po = { orders: new Set(), orderDates: new Map(), cats: new Set() }; partyOrders.set(party, po); }
      po.orders.add(oid);
      po.orderDates.set(oid, oi.order.orderDate);
      const cat = (oi.pCategory ?? '').trim() || 'Uncategorised';
      po.cats.add(cat);
      const categoryOrderKey = JSON.stringify([cat, oid]);
      if (!categoryOrders.has(categoryOrderKey)) {
        categoryOrders.add(categoryOrderKey);
        const c = catPref.get(cat); if (c) c.value += 1; else catPref.set(cat, { value: 1, count: 1 });
      }
      const prod = (oi.productName ?? '').trim();
      if (prod) {
        const pk = JSON.stringify([party, prod]);
        let s = pairOrders.get(pk); if (!s) { s = new Set(); pairOrders.set(pk, s); } s.add(oid);
      }
    }

    let reorderedPairs = 0;
    const reorderProducts = new Map<string, { value: number; count: number }>();
    for (const [pk, orders] of pairOrders) {
      if (orders.size >= 2) {
        reorderedPairs += 1;
        const prod = (JSON.parse(pk) as [string, string])[1];
        const rp = reorderProducts.get(prod); if (rp) rp.value += 1; else reorderProducts.set(prod, { value: 1, count: 1 });
      }
    }
    const reorderRate = pairOrders.size > 0 ? reorderedPairs / pairOrders.size : null;

    // Avg order gap across repeat parties.
    const gaps: number[] = [];
    const loyal: { party: string; orders: number; avgGapDays: number | null; categories: number }[] = [];
    for (const [party, po] of partyOrders) {
      const uniqDates = [...po.orderDates.values()].map((d) => d.getTime()).sort((a, b) => a - b);
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
    const sales = challans.filter((c) => SALES_TX.has((c.transaction ?? '').trim().toUpperCase()) && fx.custOk(c.customerId) && fx.dateOk(c.invDate));
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
  /**
   * Order Journey — one party's goods followed end to end.
   *
   * Orders → Dispatched → Challan → Returns, measured on the SAME quantities so
   * the drop between stages is meaningful rather than four unrelated counts.
   *
   * Everything is scoped to the orders PLACED in the window; a dispatch or a
   * challan is counted because it belongs to one of those orders, not because it
   * happens to fall in the same dates. Scoping each stage by its own date would
   * compare this month's orders against last month's shipments, and every
   * percentage on the page would be a lie.
   */
  /**
   * Customer ids the journey may include, or null for "no party restriction".
   *
   * Same rule {@link resolveFilter} applies, but returned as ids so it can go
   * into the WHERE clause instead of filtering a full table scan afterwards.
   */
  private async journeyCustomerIds(f: ReportFilters): Promise<number[] | null> {
    if (f.customerId != null) return [f.customerId];
    const ag = (f.agent ?? '').trim().toUpperCase();
    const rg = (f.region ?? '').trim().toUpperCase();
    if (!ag && !rg) return null;
    const custs = await this.prisma.customer.findMany({ select: { id: true, agentName: true, region: true } });
    return custs
      .filter((c) => {
        if (ag && ((c.agentName ?? '').trim().toUpperCase() || 'SELF') !== ag) return false;
        if (rg && ((c.region ?? '').trim().toUpperCase() || 'UNKNOWN') !== rg) return false;
        return true;
      })
      .map((c) => c.id);
  }

  async orderJourney(f: ReportFilters = {}): Promise<OrderJourneyReport> {
    const fx = await this.resolveFilter(f);
    const n = (v: number | null | undefined) => v ?? 0;
    const r2 = (v: number) => Math.round(v * 100) / 100;

    /*
     * Scope in the DATABASE, not in memory.
     *
     * Fetching every order with its items and dispatches and then filtering the
     * array is not merely slow — SQLite refuses it outright ("query parameter
     * limit exceeded... negation filters prevent the query from being split"),
     * because the nested include explodes past the driver's variable cap. The
     * report is always read for one party over one window, so the query should
     * ask for exactly that.
     */
    const allowedIds = await this.journeyCustomerIds(f);
    const orderWhere: Prisma.OrderWhereInput = {
      status: { not: 'CANCELLED' },
      ...(allowedIds ? { customerId: { in: allowedIds } } : {}),
      ...(fx.from || fx.to
        ? { orderDate: { ...(fx.from ? { gte: fx.from } : {}), ...(fx.to ? { lte: fx.to } : {}) } }
        : {}),
    };

    const orders = await this.prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        code: true,
        customerId: true,
        customerName: true,
        orderDate: true,
        completionDate: true,
        priority: true,
        items: {
          where: { status: { not: 'CANCELLED' } },
          select: {
            id: true,
            bags: true,
            pcs: true,
            gram: true,
            rate: true,
            calField: true,
            dispatches: { select: { id: true, code: true, bags: true, pcs: true, gram: true, box: true, dispatchStatus: true, dispatchDate: true } },
          },
        },
      },
      orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
    });
    // The WHERE above already did this; kept as a cheap guard so a future change
    // to either side can't silently widen the scope.
    const scoped = orders.filter((o) => fx.custOk(o.customerId) && fx.dateOk(o.orderDate));

    // Challans billing any of these orders' dispatches.
    const dispatchIds = scoped.flatMap((o) => o.items.flatMap((it) => it.dispatches.map((d) => d.id)));
    const challanItems = dispatchIds.length
      ? await this.prisma.challanItem.findMany({
          where: { dispatchId: { in: dispatchIds } },
          select: { dispatchId: true, challan: { select: { id: true, code: true, invDate: true, total: true, challanStatus: true } } },
        })
      : [];
    const challanByDispatch = new Map<number, (typeof challanItems)[number]['challan']>();
    for (const ci of challanItems) if (ci.dispatchId != null) challanByDispatch.set(ci.dispatchId, ci.challan);

    // Returns: credit-note lines that gave quantity back to one of these dispatches.
    const returnLinks = dispatchIds.length
      ? await this.prisma.creditNoteItem.findMany({
          // No `not: null` here: combined with a large `in`, a negation stops
          // Prisma splitting the query and SQLite rejects it. Filtered below.
          where: { dispatchId: { in: dispatchIds } },
          select: {
            dispatchId: true,
            returnDispatchId: true,
            amount: true,
            creditNote: { select: { code: true, invDate: true } },
          },
        })
      : [];
    const returnsByDispatch = new Map<number, typeof returnLinks>();
    for (const r of returnLinks) {
      if (r.dispatchId == null || r.returnDispatchId == null) continue;
      returnsByDispatch.set(r.dispatchId, [...(returnsByDispatch.get(r.dispatchId) ?? []), r]);
    }

    const lineValue = (it: { rate: number | null; calField: string | null; pcs: number | null; gram: number | null }) =>
      n(it.rate) * ((it.calField ?? '').trim().toUpperCase() === 'PCS' ? n(it.pcs) : n(it.gram));

    const tot = { docs: 0, lines: 0, bags: 0, pcs: 0, kgs: 0, amount: 0 };
    const disp = { docs: 0, bags: 0, pcs: 0, kgs: 0 };
    const ret = { docs: 0, lines: 0, bags: 0, pcs: 0, kgs: 0, amount: 0 };
    let billedAmountAll = 0;
    let billedLines = 0;
    const billedChallans = new Set<number>();
    const returnNotes = new Set<string>();
    const events: JourneyEvent[] = [];
    const journeyOrders: JourneyOrder[] = [];

    for (const o of scoped) {
      const oq = { bags: 0, pcs: 0, kgs: 0, amount: 0 };
      const dq = { bags: 0, pcs: 0, kgs: 0 };
      const rq = { bags: 0, pcs: 0, kgs: 0 };
      let dispatchCount = 0;
      let returnCount = 0;
      let orderBilled = 0;
      const codes = new Set<string>();
      const orderCode = o.code ?? `ORD-${o.id}`;
      const dispatchList: JourneyDispatch[] = [];

      for (const it of o.items) {
        oq.bags += n(it.bags);
        oq.pcs += n(it.pcs);
        oq.kgs += n(it.gram);
        oq.amount += lineValue(it);

        for (const d of it.dispatches) {
          if (d.dispatchStatus === RETURNED_DISPATCH_STATUS) {
            // Reversal rows carry NEGATIVE quantities — that is what puts stock
            // back. Counted here as the return they represent.
            rq.bags += Math.abs(n(d.bags));
            rq.pcs += Math.abs(n(d.pcs));
            rq.kgs += Math.abs(n(d.gram));
            returnCount += 1;
            dispatchList.push({
              id: d.id,
              code: d.code,
              date: d.dispatchDate.toISOString(),
              bags: d.bags,
              pcs: d.pcs,
              kgs: d.gram,
              box: d.box,
              status: d.dispatchStatus,
              isReturn: true,
              challanCode: null,
              challanDate: null,
              creditNoteCode: (returnsByDispatch.get(d.id) ?? [])[0]?.creditNote.code ?? null,
            });
            continue;
          }
          dq.bags += n(d.bags);
          dq.pcs += n(d.pcs);
          dq.kgs += n(d.gram);
          dispatchCount += 1;

          const ch = challanByDispatch.get(d.id);
          const billedHere = ch && (ch.challanStatus ?? 'CONFIRMED') !== 'CANCELLED' ? ch : null;
          dispatchList.push({
            id: d.id,
            code: d.code,
            date: d.dispatchDate.toISOString(),
            bags: d.bags,
            pcs: d.pcs,
            kgs: d.gram,
            box: d.box,
            status: d.dispatchStatus,
            isReturn: false,
            challanCode: billedHere?.code ?? null,
            challanDate: billedHere ? billedHere.invDate.toISOString() : null,
            creditNoteCode: null,
          });
          if (ch && (ch.challanStatus ?? 'CONFIRMED') !== 'CANCELLED') {
            billedLines += 1;
            codes.add(ch.code);
            // A challan bills several dispatches; its total must be counted once.
            if (!billedChallans.has(ch.id)) {
              billedChallans.add(ch.id);
              billedAmountAll += n(ch.total);
              orderBilled += n(ch.total);
              events.push({
                date: ch.invDate.toISOString(),
                kind: 'CHALLAN',
                title: ch.code,
                detail: `Billed against ${orderCode}`,
                amount: Math.round(n(ch.total)),
              });
            }
          }

          for (const r of returnsByDispatch.get(d.id) ?? []) {
            ret.amount += n(r.amount);
            ret.lines += 1;
            if (!returnNotes.has(r.creditNote.code)) {
              returnNotes.add(r.creditNote.code);
              events.push({
                date: r.creditNote.invDate.toISOString(),
                kind: 'RETURN',
                title: r.creditNote.code,
                detail: `Return against ${orderCode}`,
                amount: Math.round(n(r.amount)),
              });
            }
          }
        }
      }

      tot.docs += 1;
      tot.lines += o.items.length;
      tot.bags += oq.bags;
      tot.pcs += oq.pcs;
      tot.kgs += oq.kgs;
      tot.amount += oq.amount;
      disp.docs += dispatchCount;
      disp.bags += dq.bags;
      disp.pcs += dq.pcs;
      disp.kgs += dq.kgs;
      ret.bags += rq.bags;
      ret.pcs += rq.pcs;
      ret.kgs += rq.kgs;

      // Progress on whichever unit this order is actually measured in — a
      // pcs-priced order has no meaningful kgs to divide by.
      const base = oq.kgs > 0 ? oq.kgs : oq.pcs > 0 ? oq.pcs : oq.bags;
      const done = oq.kgs > 0 ? dq.kgs : oq.pcs > 0 ? dq.pcs : dq.bags;
      const progress = base > 0 ? Math.max(0, Math.min(1, done / base)) : 0;
      const stage: JourneyOrder['stage'] =
        returnCount > 0
          ? 'RETURNED'
          : codes.size > 0
            ? 'BILLED'
            : progress >= 0.999
              ? 'DISPATCHED'
              : progress > 0
                ? 'PARTIAL'
                : 'PENDING';

      events.push({
        date: o.orderDate.toISOString(),
        kind: 'ORDER',
        title: orderCode,
        detail: `${o.items.length} line${o.items.length === 1 ? '' : 's'}`,
        amount: Math.round(oq.amount),
      });

      journeyOrders.push({
        orderId: o.id,
        orderCode: o.code,
        orderDate: o.orderDate.toISOString(),
        dueDate: o.completionDate ? o.completionDate.toISOString() : null,
        priority: o.priority,
        lines: o.items.length,
        bags: r2(oq.bags),
        pcs: r2(oq.pcs),
        kgs: r2(oq.kgs),
        amount: Math.round(oq.amount),
        dispBags: r2(dq.bags),
        dispPcs: r2(dq.pcs),
        dispKgs: r2(dq.kgs),
        dispatches: dispatchCount,
        challanCodes: [...codes],
        billedAmount: Math.round(orderBilled),
        returnedBags: r2(rq.bags),
        returnedPcs: r2(rq.pcs),
        returnedKgs: r2(rq.kgs),
        returns: returnCount,
        progress,
        stage,
        dispatchList: dispatchList.sort((a, b) => b.date.localeCompare(a.date)),
      });
    }

    ret.docs = returnNotes.size;

    // The funnel is read on ONE unit — whichever the party actually orders in —
    // so the four bars are comparable instead of mixing kgs with pcs.
    const first = tot.kgs > 0 ? tot.kgs : tot.pcs > 0 ? tot.pcs : tot.bags;
    const pick = (o: { bags: number; pcs: number; kgs: number }) => (tot.kgs > 0 ? o.kgs : tot.pcs > 0 ? o.pcs : o.bags);
    const share = (v: number) => (first > 0 ? Math.max(0, Math.min(1, v / first)) : null);

    const stages: JourneyStage[] = [
      { key: 'ORDERS', label: 'Ordered', docs: tot.docs, lines: tot.lines, bags: r2(tot.bags), pcs: r2(tot.pcs), kgs: r2(tot.kgs), amount: Math.round(tot.amount), ofFirst: null },
      { key: 'DISPATCHED', label: 'Dispatched', docs: disp.docs, lines: disp.docs, bags: r2(disp.bags), pcs: r2(disp.pcs), kgs: r2(disp.kgs), amount: 0, ofFirst: share(pick(disp)) },
      { key: 'CHALLAN', label: 'Billed', docs: billedChallans.size, lines: billedLines, bags: 0, pcs: 0, kgs: 0, amount: Math.round(billedAmountAll), ofFirst: null },
      { key: 'RETURNS', label: 'Returned', docs: ret.docs, lines: ret.lines, bags: r2(ret.bags), pcs: r2(ret.pcs), kgs: r2(ret.kgs), amount: Math.round(ret.amount), ofFirst: share(pick(ret)) },
    ];

    events.sort((a, b) => b.date.localeCompare(a.date));

    const unit = tot.kgs > 0 ? 'kgs' : tot.pcs > 0 ? 'pcs' : 'bags';
    const waiting = journeyOrders.filter((o) => o.stage === 'PENDING' || o.stage === 'PARTIAL').length;
    const insights: string[] = [];
    if (!scoped.length) {
      insights.push('No orders in this window.');
    } else {
      const shipped = stages[1].ofFirst;
      if (shipped != null) insights.push(`${Math.round(shipped * 100)}% of the ${unit} ordered has been dispatched.`);
      if (billedChallans.size) insights.push(`${billedChallans.size} challan${billedChallans.size === 1 ? '' : 's'} raised against these orders.`);
      if (waiting) insights.push(`${waiting} order${waiting === 1 ? '' : 's'} still waiting on dispatch.`);
      insights.push(
        ret.docs
          ? `${ret.docs} credit note${ret.docs === 1 ? '' : 's'} put ${r2(pick(ret))} ${unit} back into stock.`
          : 'Nothing came back — no returns in this window.',
      );
    }

    return {
      customerId: f.customerId ?? null,
      customerName: scoped[0]?.customerName ?? (f.customerId ? 'Selected party' : 'All parties'),
      from: f.from ?? null,
      to: f.to ?? null,
      stages,
      // Bounded: the page renders every row with its own animation, and a party
      // with thousands of orders would stutter rather than impress.
      orders: journeyOrders.slice(0, 200),
      events: events.slice(0, 60),
      insights,
    };
  }

  async fulfilment(f: ReportFilters = {}): Promise<FulfilmentReport> {
    const now = new Date();
    const DAY = 86_400_000;
    const fx = await this.resolveFilter(f);
    const [rawOrders, rawDispatches, backlogRows, funnelOrderItems, funnelChallans] = await Promise.all([
      this.prisma.order.findMany({ select: { status: true, customerId: true, customerName: true, orderDate: true, completionDay: true } }),
      this.prisma.dispatch.findMany({ select: { dispatchStatus: true, customerId: true, dispatchDate: true, rate: true, calField: true, pcs: true, gram: true } }),
      // Open orders (undispatched, not yet billed) with age + urgent flag.
      this.prisma.$queryRawUnsafe<{ orderId: number; customerId: number | null; orderDate: Date; priority: string | null; rate: number | null; unit: string | null; oPcs: number; oGram: number; dPcs: number; dGram: number }[]>(
        `SELECT o.id AS orderId, o.customerId AS customerId, o.orderDate AS orderDate, COALESCE(NULLIF(oi.priority,''), o.priority) AS priority,
                COALESCE(oi.rate,0) AS rate, UPPER(COALESCE(oi.calField,'')) AS unit,
                COALESCE(oi.pcs,0) AS oPcs, COALESCE(oi.gram,0) AS oGram,
                COALESCE(d.dPcs,0) AS dPcs, COALESCE(d.dGram,0) AS dGram
           FROM order_items oi JOIN orders o ON o.id = oi.orderId
           LEFT JOIN (SELECT orderItemId, SUM(COALESCE(pcs,0)) AS dPcs, SUM(COALESCE(gram,0)) AS dGram FROM dispatches GROUP BY orderItemId) d ON d.orderItemId = oi.id
          WHERE oi.status = 'CONFIRMED' AND o.status <> 'CANCELLED'`,
      ),
      // Value funnel: ordered → dispatched → billed.
      this.prisma.orderItem.findMany({
        where: { status: 'CONFIRMED', order: { status: { not: 'CANCELLED' } } },
        select: { rate: true, calField: true, pcs: true, gram: true, order: { select: { customerId: true, orderDate: true } } },
      }),
      this.prisma.challan.findMany({
        where: { challanStatus: 'CONFIRMED' },
        select: { total: true, customerId: true, invDate: true, transaction: true },
      }),
    ]);

    // Party + date scope the order-level metrics.
    const orders = rawOrders.filter((o) => fx.custOk(o.customerId) && fx.dateOk(o.orderDate));
    const totalOrders = orders.length;
    const cancelledOrders = orders.filter((o) => o.status === 'CANCELLED').length;
    const leadVals = orders.filter((o) => o.status !== 'CANCELLED' && (o.completionDay ?? -1) >= 0).map((o) => o.completionDay as number);
    const avgLeadDays = leadVals.length ? Math.round(leadVals.reduce((s, v) => s + v, 0) / leadVals.length) : null;
    const cancelMap = new Map<string, number>();
    for (const o of orders) if (o.status === 'CANCELLED') cancelMap.set(o.customerName || '—', (cancelMap.get(o.customerName || '—') ?? 0) + 1);
    const cancellationByParty = [...cancelMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
    const dispatches = rawDispatches.filter((d) => fx.custOk(d.customerId) && fx.dateOk(d.dispatchDate));
    const dispatchRows = dispatches.length;
    const partialRows = dispatches.filter((d) => (d.dispatchStatus ?? '').trim().toUpperCase().startsWith('PARTIAL')).length;

    const BANDS = [
      { key: '0-7', label: '0–7 days', lo: 0, hi: 7 },
      { key: '8-15', label: '8–15 days', lo: 8, hi: 15 },
      { key: '16-30', label: '16–30 days', lo: 16, hi: 30 },
      { key: '30+', label: '30+ days', lo: 31, hi: Infinity },
    ];
    const aging = BANDS.map((b) => ({ key: b.key, label: b.label, orders: 0, value: 0 }));
    const openOrders = new Map<number, { value: number; age: number; urgent: boolean }>();
    for (const r of backlogRows) {
      if (!fx.custOk(r.customerId) || !fx.dateOk(r.orderDate)) continue;
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

    const quantityValue = (row: { rate: number | null; calField: string | null; pcs: number | null; gram: number | null }) =>
      n(row.rate) * ((row.calField ?? '').trim().toUpperCase() === 'PCS' ? n(row.pcs) : n(row.gram));
    const orderedValue = funnelOrderItems
      .filter((it) => fx.custOk(it.order.customerId) && fx.dateOk(it.order.orderDate))
      .reduce((sum, it) => sum + quantityValue(it), 0);
    const dispatchedValue = dispatches.reduce((sum, d) => sum + quantityValue(d), 0);
    const billedValue = funnelChallans
      .filter((c) => SALES_TX.has((c.transaction ?? '').trim().toUpperCase()) && fx.custOk(c.customerId) && fx.dateOk(c.invDate))
      .reduce((sum, c) => sum + n(c.total), 0);

    return {
      totalOrders,
      cancelledOrders,
      cancellationRate: totalOrders > 0 ? cancelledOrders / totalOrders : null,
      dispatchRows,
      partialRows,
      partialRate: dispatchRows > 0 ? partialRows / dispatchRows : null,
      avgLeadDays,
      urgentOpen,
      pendingOrders: openOrders.size,
      aging,
      funnel: [
        { stage: 'Ordered', value: r0(orderedValue) },
        { stage: 'Dispatched', value: r0(dispatchedValue) },
        { stage: 'Billed', value: r0(billedValue) },
      ],
      cancellationByParty,
      asOf: now.toISOString(),
    };
  }

  async summaryAnalysis(f: ReportFilters = {}): Promise<SummaryAnalysisReport> {
    const [overview, collections, sales, parties, products, patterns, fulfilment] = await Promise.all([
      this.businessOverview(f),
      this.collectionsReport(f),
      this.salesReport(12, f),
      this.partyIntel(f),
      this.productReport(f, 'amount'),
      this.patterns(f),
      this.fulfilment(f),
    ]);

    const money = (value: number) => `Rs ${r0(value).toLocaleString('en-IN')}`;
    const pct = (value: number | null) => value == null ? 'not available' : `${Math.round(value * 100)}%`;
    const seg = (name: string) => parties.segments.find((s) => s.name === name)?.value ?? 0;
    const recentMonths = sales.monthly.filter((m) => m.billed > 0).slice(-3);
    const next30DayRevenue = recentMonths.length ? r0(recentMonths.reduce((sum, m) => sum + m.billed, 0) / recentMonths.length) : 0;
    const collectible30Days = r0(Math.min(collections.totalOutstanding, collections.overdue * 0.35 + collections.dueSoon * 0.75 + collections.recoveryKpis.promisedValue));
    const periodStart = f.from ? this.startOfDay(new Date(f.from)) : this.startOfFinYear(new Date());
    const periodEnd = f.to ? this.endOfDay(new Date(f.to)) : new Date();
    const periodDays = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000));
    const cashUnlockFromTenDsoDays = r0((overview.revenue.current / periodDays) * 10);
    const actions: SummaryAnalysisAction[] = [];
    const add = (action: SummaryAnalysisAction) => actions.push(action);

    add({ id: 'overdue', category: 'Cash', priority: 'Do today', title: 'Start with overdue money', detail: 'Call the largest overdue parties first. Ask for a clear payment date and amount.', evidence: `${money(collections.overdue)} is overdue across ${collections.aging.reduce((s, a) => s + a.parties, 0)} ageing entries.`, impact: `A 10% recovery can bring about ${money(collections.overdue * 0.1)}.`, route: '/reports/collections' });
    add({ id: 'never-contacted', category: 'Cash', priority: 'Do today', title: 'Call parties with no payment follow-up', detail: 'Create a payment follow-up for every owing party that has not been contacted.', evidence: `${collections.recoveryKpis.neverContacted} owing parties have no payment follow-up.`, impact: 'This gives every blocked payment an owner and next date.', route: '/crm/payments' });
    add({ id: 'older-debtors', category: 'Cash', priority: 'Do today', title: 'Separate old debtors from current buyers', detail: 'Do not wait for a new order. Chase old invoices as a separate recovery list.', evidence: `${collections.olderOwingParties} owing parties were not billed in the selected period.`, impact: 'Old debt can be collected without adding more production or stock.', route: '/reports/collections' });
    add({ id: 'due-soon', category: 'Cash', priority: 'This week', title: 'Call before the due date', detail: 'Confirm payment one week before it becomes overdue.', evidence: `${money(collections.dueSoon)} falls due in the next 15 days.`, impact: `Protect up to ${money(collections.dueSoon)} from becoming late.`, route: '/reports/collections' });
    add({ id: 'promises', category: 'Cash', priority: collections.recoveryKpis.promisesOverdue > 0 ? 'Do today' : 'Watch', title: 'Track every payment promise', detail: 'Record promised amount and date. Call again on the same day if the promise is missed.', evidence: `${collections.recoveryKpis.promisesOverdue} promises are broken and ${collections.recoveryKpis.promisesDueToday} are due today.`, impact: 'Short follow-up gaps improve payment conversion.', route: '/crm/payments' });
    add({ id: 'advances', category: 'Cash', priority: 'This week', title: 'Use advances before asking for full payment', detail: 'Adjust available advances against open bills and show the true balance to the party.', evidence: `${money(collections.advanceHeld)} is held as party advances.`, impact: 'Cleaner balances make collection calls faster and reduce disputes.', route: '/account/advances' });
    add({ id: 'dso', category: 'Cash', priority: 'This week', title: 'Reduce DSO by 10 days', detail: 'Set a first target of collecting ten sales-days faster.', evidence: `Current DSO is about ${collections.dsoDays ?? 0} days.`, impact: `Ten fewer DSO days can release about ${money(cashUnlockFromTenDsoDays)}.`, route: '/reports/collections' });
    add({ id: 'collection-gap', category: 'Cash', priority: 'Do today', title: 'Close the billing and collection gap', detail: 'Do not grow low-margin sales unless collection speed also improves.', evidence: `Collected ${pct(collections.collectionRate)} of billed value in the current FY.`, impact: `${money(Math.max(0, overview.revenue.current - overview.collections.current))} of period billing is not matched by period collections.`, route: '/reports/overview' });
    add({ id: 'top-overdue', category: 'Cash', priority: 'Do today', title: `Call ${collections.topOverdueParties[0]?.name ?? 'the top overdue party'}`, detail: 'The largest overdue account should be the first recovery call of the day.', evidence: `${money(collections.topOverdueParties[0]?.value ?? 0)} is overdue from this party.`, impact: 'One successful large-party call can move cash faster than many small calls.', route: '/reports/collections' });

    add({ id: 'revenue-trend', category: 'Sales', priority: overview.revenue.direction === 'down' ? 'This week' : 'Watch', title: overview.revenue.direction === 'down' ? 'Recover the sales slowdown' : 'Protect the current sales pace', detail: 'Use the best parties and fastest-moving utensils for the next sales calls.', evidence: `Period billing is ${money(overview.revenue.current)}, ${Math.abs(overview.revenue.deltaPct ?? 0).toFixed(0)}% ${overview.revenue.direction} versus the previous equal period.`, impact: `Recent run rate suggests about ${money(next30DayRevenue)} billing in the next 30 days.`, route: '/reports/sales' });
    add({ id: 'top-party', category: 'Sales', priority: 'This week', title: 'Protect the biggest revenue party', detail: 'Confirm its next requirement, payment plan and production slot before stock is made.', evidence: `${overview.topParties[0]?.name ?? 'The top party'} billed ${money(overview.topParties[0]?.value ?? 0)} in the period.`, impact: 'Protects a large part of near-term revenue with fewer selling hours.', route: '/reports/parties' });
    add({ id: 'active-parties', category: 'Sales', priority: 'This week', title: 'Increase orders from current buyers', detail: 'Ask active buyers for one extra fast-moving item instead of only finding new parties.', evidence: `${overview.activeParties} parties were billed; average invoice was ${money(overview.avgInvoiceValue)}.`, impact: `One average invoice from 10% of active parties is about ${money(overview.activeParties * 0.1 * overview.avgInvoiceValue)}.`, route: '/reports/overview' });
    add({ id: 'top-product', category: 'Sales', priority: 'This week', title: `Push ${products.topProducts[0]?.name ?? 'the top product'}`, detail: 'Keep the top steel utensil ready and offer it first to repeat buyers.', evidence: `It produced ${money(products.topProducts[0]?.value ?? 0)} of item value in the period.`, impact: 'Fast movers turn steel and labour into invoices sooner.', route: '/reports/products' });
    add({ id: 'top-category', category: 'Sales', priority: 'Watch', title: `Build the next offer around ${products.categoryMix[0]?.name ?? 'the top category'}`, detail: 'Bundle one related cup, glass, loti or utensil item with the leading category.', evidence: `${money(products.categoryMix[0]?.value ?? 0)} came from this category.`, impact: 'A focused offer can increase basket size without a long sales cycle.', route: '/reports/products' });

    const lossDesigns = products.designMargin.filter((d) => d.flag === 'loss');
    const thinDesigns = products.designMargin.filter((d) => d.flag === 'thin');
    add({ id: 'loss-designs', category: 'Margin', priority: lossDesigns.length ? 'Do today' : 'Watch', title: 'Stop loss-making design rates', detail: 'Block or reprice designs where listed rate is not above cost.', evidence: `${lossDesigns.length} active designs are at zero or negative list margin.`, impact: 'Prevents sales that increase cash pressure instead of profit.', route: '/reports/products' });
    add({ id: 'thin-designs', category: 'Margin', priority: thinDesigns.length ? 'This week' : 'Watch', title: 'Review thin-margin designs', detail: 'Add labour, packing and wastage before approving a thin rate.', evidence: `${thinDesigns.length} active designs have less than 15% list margin.`, impact: 'A small price correction protects profit on high-volume items.', route: '/reports/products' });
    add({ id: 'margin-category', category: 'Margin', priority: 'This week', title: 'Sell volume only with a margin check', detail: 'Compare the best-selling category with its design margin before accepting a large order.', evidence: `${products.marginByCategory.at(-1)?.name ?? 'The lowest category'} has the lowest average listed margin at ${products.marginByCategory.at(-1)?.value ?? 0}%.`, impact: 'Avoids locking cash in busy but weak-margin production.', route: '/reports/products' });

    add({ id: 'repeat-party', category: 'Customers', priority: 'This week', title: 'Turn first buyers into repeat buyers', detail: 'Call after delivery and ask what should be repeated or changed.', evidence: `${pct(patterns.repeatPartyRate)} of billed parties bought at least twice in the period.`, impact: 'Repeat orders cost less time to win and are easier to plan.', route: '/reports/patterns' });
    add({ id: 'product-reorder', category: 'Customers', priority: 'This week', title: 'Use product reorder dates', detail: 'Call near the normal reorder gap with the same product and latest rate.', evidence: `${pct(patterns.reorderRate)} of party-product pairs were reordered; average order gap is ${patterns.avgOrderGapDays ?? 0} days.`, impact: 'Timed calls can bring the next invoice forward.', route: '/reports/patterns' });
    add({ id: 'dormant', category: 'Customers', priority: 'This week', title: 'Win back dormant parties carefully', detail: 'Offer only proven fast movers and ask for a short payment term.', evidence: `${seg('Dormant') + seg('Win-back')} parties are dormant or ready for win-back in this period view.`, impact: 'Reactivates revenue without giving fresh long credit.', route: '/reports/parties' });
    add({ id: 'at-risk', category: 'Customers', priority: 'This week', title: 'Call at-risk parties before they go quiet', detail: 'Ask about quality, rate, delivery and the next buying date.', evidence: `${seg('At-risk')} parties are marked at risk.`, impact: 'Saves existing revenue before spending time on new leads.', route: '/reports/parties' });

    add({ id: 'pending-orders', category: 'Operations', priority: 'Do today', title: 'Clear old pending orders', detail: 'Finish, dispatch or close the oldest open order before starting slow new work.', evidence: `${fulfilment.pendingOrders} orders are open; ${money(fulfilment.aging.at(-1)?.value ?? 0)} is in the oldest band.`, impact: 'Finished orders become invoices and cash sooner.', route: '/reports/fulfilment' });
    add({ id: 'urgent-orders', category: 'Operations', priority: fulfilment.urgentOpen ? 'Do today' : 'Watch', title: 'Give every urgent order one owner', detail: 'Confirm material, production and dispatch time for each urgent order.', evidence: `${fulfilment.urgentOpen} open orders are marked urgent.`, impact: 'Reduces delayed billing and customer follow-up time.', route: '/reports/fulfilment' });
    add({ id: 'partial-dispatch', category: 'Operations', priority: 'This week', title: 'Reduce partial dispatch work', detail: 'Group production and packing so more order lines leave complete.', evidence: `${pct(fulfilment.partialRate)} of selected dispatch rows are partial; cancellation rate is ${pct(fulfilment.cancellationRate)}.`, impact: 'Fewer partial loads reduce packing, freight and billing effort.', route: '/reports/fulfilment' });
    add({ id: 'unbilled-dispatch', category: 'Operations', priority: overview.backlogValue > 0 ? 'Do today' : 'Watch', title: 'Bill dispatched goods quickly', detail: 'Create the challan on the same day after dispatch is checked.', evidence: `${money(overview.backlogValue)} is dispatched but not billed in the selected period.`, impact: 'Billing earlier starts the payment clock earlier.', route: '/challans/pending' });

    return {
      headline: { revenue: overview.revenue.current, collections: overview.collections.current, outstanding: collections.totalOutstanding, overdue: collections.overdue, backlog: overview.backlogValue, activeParties: overview.activeParties, owingParties: collections.owingParties },
      forecast: { next30DayRevenue, collectible30Days, cashUnlockFromTenDsoDays, confidence: recentMonths.length >= 3 ? 'Medium' : 'Low' },
      actions,
      asOf: new Date().toISOString(),
    };
  }
}
