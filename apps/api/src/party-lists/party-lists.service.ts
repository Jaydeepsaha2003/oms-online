import { Injectable } from '@nestjs/common';
import {
  DEFAULT_PARTY_LISTS,
  type PartyClassRow,
  type PartyCondition,
  type PartyListDef,
  type PartyListsConfig,
  type PartyListsResult,
  type PartyMetrics,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toNum } from '../common/coerce';

const CONFIG_KEY = 'PARTY_LISTS';
const SALES = new Set(['SALES INVOICE', 'DEBIT NOTE']);
const DAY = 86_400_000;
const num = (v: unknown) => toNum(v) ?? 0;

@Injectable()
export class PartyListsService {
  constructor(private readonly prisma: PrismaService) {}

  /* ── Definitions (stored as JSON in AppConfig) ──────────────────────────── */

  async getConfig(): Promise<PartyListsConfig> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: CONFIG_KEY } });
    if (!row?.value) return { lists: DEFAULT_PARTY_LISTS };
    try {
      const parsed = JSON.parse(row.value) as PartyListsConfig;
      if (!parsed || !Array.isArray(parsed.lists)) return { lists: DEFAULT_PARTY_LISTS };
      return parsed;
    } catch {
      return { lists: DEFAULT_PARTY_LISTS };
    }
  }

  async saveConfig(config: PartyListsConfig): Promise<PartyListsConfig> {
    const clean: PartyListsConfig = { lists: (config.lists ?? []).map(this.normalizeList) };
    const value = JSON.stringify(clean);
    await this.prisma.appConfig.upsert({ where: { key: CONFIG_KEY }, update: { value }, create: { key: CONFIG_KEY, value } });
    return clean;
  }

  private normalizeList = (l: PartyListDef): PartyListDef => ({
    id: l.id || `list-${Math.random().toString(36).slice(2, 9)}`,
    name: (l.name ?? '').trim() || 'Untitled list',
    kind: l.kind === 'GREEN' || l.kind === 'BLACK' ? l.kind : 'CUSTOM',
    color: l.color ?? null,
    description: l.description ?? null,
    match: l.match === 'ANY' ? 'ANY' : 'ALL',
    enabled: l.enabled !== false,
    conditions: (l.conditions ?? []).filter((c) => c && c.field && c.op).map((c) => ({ field: c.field, op: c.op, value: c.value })),
  });

  /* ── Evaluation ─────────────────────────────────────────────────────────── */

  /** Compute every party's metrics and evaluate them against the saved lists. */
  async evaluate(): Promise<PartyListsResult> {
    const [{ lists }, parties] = await Promise.all([this.getConfig(), this.computeMetrics()]);
    const active = lists.filter((l) => l.enabled);
    for (const p of parties) {
      p.matched = active.filter((l) => this.matchList(l, p.metrics)).map((l) => l.id);
    }
    // Most "interesting" first: matched lists, then biggest exposure.
    parties.sort((a, b) => b.matched.length - a.matched.length || b.metrics.outstanding - a.metrics.outstanding || b.metrics.lifetimeRevenue - a.metrics.lifetimeRevenue);
    return { lists, parties, asOf: new Date().toISOString() };
  }

  private matchList(list: PartyListDef, m: PartyMetrics): boolean {
    if (!list.conditions.length) return false;
    const results = list.conditions.map((c) => this.matchCond(c, m));
    return list.match === 'ANY' ? results.some(Boolean) : results.every(Boolean);
  }

  private matchCond(c: PartyCondition, m: PartyMetrics): boolean {
    const raw = (m as unknown as Record<string, unknown>)[c.field];
    // Text metrics.
    if (typeof raw === 'string' || (c.op === 'contains' || c.op === 'notContains')) {
      const a = String(raw ?? '').toLowerCase();
      const b = String(c.value ?? '').toLowerCase();
      switch (c.op) {
        case 'contains': return a.includes(b);
        case 'notContains': return !a.includes(b);
        case '==': return a === b;
        case '!=': return a !== b;
        default: return false;
      }
    }
    // Boolean metrics.
    if (typeof raw === 'boolean') {
      const b = c.value === 'true' || c.value === 1 || c.value === '1';
      return c.op === '!=' ? raw !== b : raw === b;
    }
    // Numeric metrics — a null metric (e.g. no receipts yet) never matches.
    if (raw == null) return false;
    const a = Number(raw);
    const b = Number(c.value);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    switch (c.op) {
      case '>=': return a >= b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '<': return a < b;
      case '==': return a === b;
      case '!=': return a !== b;
      default: return false;
    }
  }

  /* ── Per-party metrics ──────────────────────────────────────────────────── */

  private async computeMetrics(): Promise<PartyClassRow[]> {
    const now = new Date();
    const today = this.startOfDay(now);
    const fyStart = this.startOfFinYear(now);
    const [challans, custRows, receipts, advances, orders, payFollowups] = await Promise.all([
      this.prisma.challan.findMany({ where: { challanStatus: 'CONFIRMED' }, select: { code: true, total: true, invDate: true, dueDate: true, customerId: true, customerName: true, transaction: true } }),
      this.prisma.customer.findMany({ select: { id: true, partyName: true, agentName: true, region: true, state: true, active: true } }),
      this.prisma.acctPaymentReceipt.findMany({ select: { custId: true, invNo: true, recAmt: true, recDate: true } }),
      this.prisma.acctPartyAdvance.findMany({ select: { custId: true, bankAmt: true, cashAmt: true } }),
      this.prisma.order.findMany({ where: { status: 'CONFIRMED' }, select: { customerId: true, customerName: true, orderDate: true } }),
      this.prisma.followup.findMany({ where: { kind: 'PAYMENT', status: 'OPEN' }, select: { customerId: true, partyName: true, promisedAt: true } }),
    ]);

    const custById = new Map(custRows.map((c) => [c.id, c]));
    const invDateByCode = new Map<string, Date>();
    const recvByInv = new Map<string, number>();
    const lastRecByCust = new Map<number, Date>();
    for (const c of challans) invDateByCode.set(c.code, c.invDate);
    for (const r of receipts) {
      recvByInv.set(r.invNo, (recvByInv.get(r.invNo) ?? 0) + num(r.recAmt));
      const cur = lastRecByCust.get(r.custId);
      if (!cur || r.recDate > cur) lastRecByCust.set(r.custId, r.recDate);
    }
    const advByCust = new Map<number, number>();
    for (const a of advances) advByCust.set(a.custId, (advByCust.get(a.custId) ?? 0) + num(a.bankAmt) + num(a.cashAmt));

    // avg payment days: per receipt, days between its invoice date and receipt date.
    const payDaysSum = new Map<number, { sum: number; n: number }>();
    for (const r of receipts) {
      const inv = invDateByCode.get(r.invNo);
      if (!inv) continue;
      const d = Math.max(0, Math.round((this.startOfDay(r.recDate).getTime() - this.startOfDay(inv).getTime()) / DAY));
      const cur = payDaysSum.get(r.custId) ?? { sum: 0, n: 0 };
      cur.sum += d; cur.n += 1; payDaysSum.set(r.custId, cur);
    }

    interface Acc {
      customerId: number | null; party: string;
      outstanding: number; overdue: number; oldestOverdueDays: number;
      lifetimeRevenue: number; fyRevenue: number; invoiceCount: number; openInvoices: number; billed: number; received: number;
    }
    const byKey = new Map<string, Acc>();
    const keyOf = (name: string) => (name || '—').trim().toUpperCase();
    for (const c of challans) {
      if (!SALES.has((c.transaction ?? '').trim().toUpperCase())) continue;
      const key = keyOf(c.customerName);
      let a = byKey.get(key);
      if (!a) { a = { customerId: c.customerId ?? null, party: c.customerName || '—', outstanding: 0, overdue: 0, oldestOverdueDays: 0, lifetimeRevenue: 0, fyRevenue: 0, invoiceCount: 0, openInvoices: 0, billed: 0, received: 0 }; byKey.set(key, a); }
      if (a.customerId == null && c.customerId != null) a.customerId = c.customerId;
      const total = num(c.total);
      const received = recvByInv.get(c.code) ?? 0;
      const bal = Math.max(0, total - received);
      a.lifetimeRevenue += total;
      if (c.invDate >= fyStart) a.fyRevenue += total;
      a.invoiceCount += 1;
      a.billed += total;
      a.received += Math.min(received, total);
      if (bal > 0) {
        a.outstanding += bal;
        a.openInvoices += 1;
        if (c.dueDate) {
          const days = Math.floor((today.getTime() - this.startOfDay(c.dueDate).getTime()) / DAY);
          if (days > 0) { a.overdue += bal; a.oldestOverdueDays = Math.max(a.oldestOverdueDays, days); }
        }
      }
    }

    // Order recency / count + broken promises, keyed the same way.
    const orderAgg = new Map<string, { count: number; last: Date | null }>();
    for (const o of orders) {
      const key = keyOf(o.customerName);
      const cur = orderAgg.get(key) ?? { count: 0, last: null };
      cur.count += 1;
      if (!cur.last || o.orderDate > cur.last) cur.last = o.orderDate;
      orderAgg.set(key, cur);
    }
    const brokenByKey = new Map<string, number>();
    for (const fu of payFollowups) {
      if (!fu.promisedAt) continue;
      const days = Math.floor((today.getTime() - this.startOfDay(fu.promisedAt).getTime()) / DAY);
      if (days <= 0) continue;
      const key = keyOf(fu.partyName);
      brokenByKey.set(key, (brokenByKey.get(key) ?? 0) + 1);
    }

    const r0 = (x: number) => Math.round(x);
    const rows: PartyClassRow[] = [];
    for (const a of byKey.values()) {
      const cust = a.customerId != null ? custById.get(a.customerId) : undefined;
      const oa = orderAgg.get(keyOf(a.party));
      const lastRec = a.customerId != null ? lastRecByCust.get(a.customerId) : undefined;
      const pd = a.customerId != null ? payDaysSum.get(a.customerId) : undefined;
      const metrics: PartyMetrics = {
        outstanding: r0(a.outstanding),
        overdue: r0(a.overdue),
        overduePct: a.outstanding > 0 ? r0((a.overdue / a.outstanding) * 100) : a.overdue > 0 ? 100 : 0,
        oldestOverdueDays: a.oldestOverdueDays,
        lifetimeRevenue: r0(a.lifetimeRevenue),
        fyRevenue: r0(a.fyRevenue),
        invoiceCount: a.invoiceCount,
        openInvoices: a.openInvoices,
        collectionRate: a.billed > 0 ? r0((a.received / a.billed) * 100) : null,
        avgPaymentDays: pd && pd.n > 0 ? r0(pd.sum / pd.n) : null,
        lastReceiptDaysAgo: lastRec ? Math.floor((today.getTime() - this.startOfDay(lastRec).getTime()) / DAY) : null,
        lastOrderDaysAgo: oa?.last ? Math.floor((today.getTime() - this.startOfDay(oa.last).getTime()) / DAY) : null,
        orderCount: oa?.count ?? 0,
        brokenPromises: brokenByKey.get(keyOf(a.party)) ?? 0,
        advanceHeld: a.customerId != null ? r0(advByCust.get(a.customerId) ?? 0) : 0,
        region: cust?.region ?? null,
        agent: cust?.agentName ?? null,
        state: cust?.state ?? null,
        active: cust?.active ?? true,
      };
      rows.push({ customerId: a.customerId, party: a.party, metrics, matched: [] });
    }
    return rows;
  }

  private startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  private startOfFinYear(now: Date): Date {
    const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return new Date(y, 3, 1);
  }
}
