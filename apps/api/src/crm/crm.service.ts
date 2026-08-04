import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Followup, FollowupLog, Prisma } from '@prisma/client';
import {
  DEFAULT_CRM_SETTINGS,
  computeFollowupState,
  type CrmReminderSettings,
  type FollowupChecklistItemDto,
  type FollowupDto,
  type FollowupItemDto,
  type FollowupItemInput,
  type FollowupKind,
  type FollowupLogDto,
  type FollowupPartyGroup,
  type FollowupPriority,
  type FollowupStatus,
  type FollowupSummary,
  type Paginated,
  type PartyBalanceDetail,
  type PartyBalanceSummary,
  type PromiseState,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toNum, toStr, uc } from '../common/coerce';
import { AddFollowupLogDto, CreateFollowupDto, CrmSettingsDto, FollowupQueryDto } from './dto/crm.dto';

const SETTINGS_KEY = 'CRM_REMINDER_DEFAULTS';
const INCLUDE = {
  logs: { orderBy: { createdAt: 'asc' } },
  checklist: { orderBy: { sortOrder: 'asc' } },
  items: { orderBy: { sortOrder: 'asc' } },
} as const;
type Row = Prisma.FollowupGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  /* ── Settings ───────────────────────────────────────────────────────────── */

  async getSettings(): Promise<CrmReminderSettings> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: SETTINGS_KEY } });
    if (!row?.value) return { ...DEFAULT_CRM_SETTINGS };
    try {
      return { ...DEFAULT_CRM_SETTINGS, ...JSON.parse(row.value) };
    } catch {
      return { ...DEFAULT_CRM_SETTINGS };
    }
  }

  async saveSettings(dto: CrmSettingsDto): Promise<CrmReminderSettings> {
    const merged = { ...(await this.getSettings()), ...dto };
    if (merged.workEndHour <= merged.workStartHour) throw new BadRequestException('Work end hour must be after the start hour.');
    const value = JSON.stringify(merged);
    await this.prisma.appConfig.upsert({ where: { key: SETTINGS_KEY }, update: { value }, create: { key: SETTINGS_KEY, value } });
    return merged;
  }

  /* ── Create / update ────────────────────────────────────────────────────── */

  async create(dto: CreateFollowupDto, userName?: string): Promise<FollowupDto> {
    const partyName = (dto.partyName ?? '').trim();
    if (!partyName) throw new BadRequestException('Party name is required.');
    if (!dto.title?.trim()) throw new BadRequestException('A short title is required.');

    const row = await this.prisma.followup.create({
      data: {
        kind: uc(dto.kind) === 'PAYMENT' ? 'PAYMENT' : 'DELIVERY',
        customerId: dto.customerId ?? null,
        partyName,
        orderId: dto.orderId ?? null,
        orderCode: toStr(dto.orderCode),
        orderItemId: dto.orderItemId ?? null,
        itemText: toStr(dto.itemText),
        title: dto.title.trim(),
        detail: toStr(dto.detail),
        stage: uc(dto.stage),
        priority: uc(dto.priority) === 'URGENT' ? 'URGENT' : 'NORMAL',
        status: 'OPEN',
        promisedAt: dto.promisedAt ? new Date(dto.promisedAt) : null,
        promisedAmount: dto.promisedAmount ?? null,
        reminderIntervalMins: dto.reminderIntervalMins ?? null,
        maxRemindersPerDay: dto.maxRemindersPerDay ?? null,
        createdByName: userName ?? null,
        ...(dto.checklist?.length
          ? {
              checklist: {
                create: dto.checklist
                  .map((it, i) => ({ text: (it.text ?? '').trim(), source: it.source === 'VOICE' ? 'VOICE' : 'MANUAL', sortOrder: i }))
                  .filter((it) => it.text),
              },
            }
          : {}),
        ...(dto.items?.length ? { items: { create: this.itemsCreate(dto.items) } } : {}),
      },
      include: INCLUDE,
    });
    return this.toDto(row);
  }

  /** Normalised nested-create rows for a follow-up's item lines (used by both
   *  create and update — on update the existing set is deleted first). */
  private itemsCreate(items?: FollowupItemInput[]) {
    return (items ?? []).map((it, i) => ({
      orderItemId: it.orderItemId ?? null,
      orderCode: toStr(it.orderCode),
      productName: toStr(it.productName),
      bags: it.bags ?? null,
      pcs: it.pcs ?? null,
      kgs: it.kgs ?? null,
      box: it.box ?? null,
      sortOrder: i,
    }));
  }

  async update(id: number, dto: CreateFollowupDto): Promise<FollowupDto> {
    await this.ensure(id);
    const row = await this.prisma.followup.update({
      where: { id },
      data: {
        ...(dto.kind ? { kind: uc(dto.kind) === 'PAYMENT' ? 'PAYMENT' : 'DELIVERY' } : {}),
        ...(dto.customerId !== undefined ? { customerId: dto.customerId ?? null } : {}),
        ...(dto.partyName !== undefined ? { partyName: dto.partyName.trim() } : {}),
        ...(dto.orderId !== undefined ? { orderId: dto.orderId ?? null } : {}),
        ...(dto.orderCode !== undefined ? { orderCode: toStr(dto.orderCode) } : {}),
        ...(dto.orderItemId !== undefined ? { orderItemId: dto.orderItemId ?? null } : {}),
        ...(dto.itemText !== undefined ? { itemText: toStr(dto.itemText) } : {}),
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.detail !== undefined ? { detail: toStr(dto.detail) } : {}),
        ...(dto.stage !== undefined ? { stage: uc(dto.stage) } : {}),
        ...(dto.priority !== undefined ? { priority: uc(dto.priority) === 'URGENT' ? 'URGENT' : 'NORMAL' } : {}),
        ...(dto.promisedAt !== undefined ? { promisedAt: dto.promisedAt ? new Date(dto.promisedAt) : null } : {}),
        ...(dto.promisedAmount !== undefined ? { promisedAmount: dto.promisedAmount } : {}),
        ...(dto.reminderIntervalMins !== undefined ? { reminderIntervalMins: dto.reminderIntervalMins ?? null } : {}),
        ...(dto.maxRemindersPerDay !== undefined ? { maxRemindersPerDay: dto.maxRemindersPerDay ?? null } : {}),
        // Items are replace-on-save when the field is present: drop the old set,
        // recreate from the payload (mirrors how the form always sends the full list).
        ...(dto.items !== undefined ? { items: { deleteMany: {}, create: this.itemsCreate(dto.items) } } : {}),
      },
      include: INCLUDE,
    });
    return this.toDto(row);
  }

  /* ── Timeline / reminder actions ────────────────────────────────────────── */

  /** Add a status update to the timeline; can also re-promise a new date. Updating
   *  keeps the follow-up OPEN and, if a new date is given, re-arms the loop. */
  async addLog(id: number, dto: AddFollowupLogDto, userName?: string): Promise<FollowupDto> {
    const cur = await this.ensure(id);
    const newPromised = dto.newPromisedAt ? new Date(dto.newPromisedAt) : null;
    await this.prisma.$transaction([
      this.prisma.followupLog.create({
        data: {
          followupId: id,
          kind: newPromised ? 'PROMISE' : 'NOTE',
          note: toStr(dto.note),
          stage: uc(dto.stage),
          newPromisedAt: newPromised,
          userName: userName ?? null,
        },
      }),
      this.prisma.followup.update({
        where: { id },
        data: {
          ...(dto.stage !== undefined && dto.stage !== null ? { stage: uc(dto.stage) } : {}),
          ...(newPromised ? { promisedAt: newPromised, nextRemindAt: null, pushSentAt: null } : {}), // re-promise re-opens the window
          ...(dto.newPromisedAmount != null ? { promisedAmount: dto.newPromisedAmount } : {}),
        },
      }),
    ]);
    void cur;
    return this.findOne(id);
  }

  /** Acknowledge without resolving — re-arms the reminder after the interval
   *  (clamped to working hours) and counts against the daily cap. */
  async snooze(id: number, userName?: string): Promise<FollowupDto> {
    const f = await this.ensure(id);
    if (f.status !== 'OPEN') throw new BadRequestException('Only an open follow-up can be snoozed.');
    const settings = await this.getSettings();
    const now = new Date();
    const intervalMins = f.reminderIntervalMins ?? settings.intervalMins;
    const next = this.clampToWorkHours(new Date(now.getTime() + intervalMins * 60_000), settings);
    const todayStr = this.dayStr(now);
    const remindersToday = (f.remindersDate === todayStr ? f.remindersToday : 0) + 1;

    await this.prisma.$transaction([
      this.prisma.followupLog.create({ data: { followupId: id, kind: 'SNOOZE', note: `Snoozed ${intervalMins} min`, userName: userName ?? null } }),
      this.prisma.followup.update({
        where: { id },
        data: { nextRemindAt: next, lastRemindedAt: now, remindersToday, remindersDate: todayStr, pushSentAt: null },
      }),
    ]);
    return this.findOne(id);
  }

  /** Mark a follow-up done. `note` is the optional closing comment the user types
   *  when completing it (how it was settled, what was collected, …) — it's kept on
   *  the timeline so the Completed view can show WHY it closed, not just that it did. */
  async resolve(id: number, userName?: string, note?: string): Promise<FollowupDto> {
    await this.ensure(id);
    const comment = (note ?? '').trim();
    await this.prisma.$transaction([
      this.prisma.followupLog.create({
        data: { followupId: id, kind: 'STATUS', note: comment ? `Resolved — ${comment}` : 'Resolved', userName: userName ?? null },
      }),
      this.prisma.followup.update({ where: { id }, data: { status: 'DONE', resolvedAt: new Date(), resolvedByName: userName ?? null } }),
    ]);
    return this.findOne(id);
  }

  async reopen(id: number, userName?: string): Promise<FollowupDto> {
    await this.ensure(id);
    await this.prisma.$transaction([
      this.prisma.followupLog.create({ data: { followupId: id, kind: 'STATUS', note: 'Reopened', userName: userName ?? null } }),
      this.prisma.followup.update({ where: { id }, data: { status: 'OPEN', resolvedAt: null, resolvedByName: null, nextRemindAt: null, pushSentAt: null } }),
    ]);
    return this.findOne(id);
  }

  async remove(id: number): Promise<{ id: number }> {
    await this.ensure(id);
    await this.prisma.followup.delete({ where: { id } }); // logs cascade
    return { id };
  }

  /* ── Reads ──────────────────────────────────────────────────────────────── */

  async findOne(id: number): Promise<FollowupDto> {
    const row = await this.prisma.followup.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundException('Follow-up not found.');
    return this.toDto(row);
  }

  async findMany(q: FollowupQueryDto): Promise<Paginated<FollowupDto>> {
    const where = this.listWhere(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.followup.findMany({ where, include: INCLUDE, orderBy: this.listOrder(), skip: q.skip, take: q.pageSize }),
      this.prisma.followup.count({ where }),
    ]);
    const items = rows.map((r) => this.toDto(r)).filter((f) => this.matchesBucket(f, q.bucket));
    return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  /**
   * Party-wise board. Defaults to OPEN work; pass `status: 'DONE'` to review what
   * has already been completed (the Completed tab). The urgency buckets describe
   * outstanding work — "overdue", "due today" — so they're only applied to OPEN;
   * a resolved follow-up has no urgency left to filter on.
   *
   * Resolving a follow-up used to put it beyond reach of every screen — the
   * board was OPEN-only and no filter could ask for anything else — so one
   * stray "Done" was indistinguishable from the follow-up being deleted. The
   * Completed view passes `status=DONE` here to get them back.
   */
  async board(q: FollowupQueryDto): Promise<FollowupPartyGroup[]> {
    const status = uc(q.status) || 'OPEN';
    const isOpen = status === 'OPEN';
    const where: Prisma.FollowupWhereInput = { status, ...(q.kind ? { kind: uc(q.kind)! } : {}), ...(q.party ? { partyName: q.party } : {}) };
    const rows = await this.prisma.followup.findMany({ where, include: INCLUDE, orderBy: this.listOrder() });
    const now = new Date();
    const settings = await this.getSettings();
    const groups = new Map<string, FollowupPartyGroup>();
    for (const r of rows) {
      const dto = this.toDto(r);
      if (isOpen && !this.matchesBucket(dto, q.bucket)) continue;
      const key = dto.partyName;
      const g = groups.get(key) ?? { partyName: key, customerId: dto.customerId, openCount: 0, overdueCount: 0, activeNudges: 0, nextPromiseAt: null, items: [] };
      const st = computeFollowupState(dto, now, settings.leadDays);
      g.openCount += 1;
      if (isOpen && st.urgency === 'OVERDUE') g.overdueCount += 1;
      if (isOpen && st.isActiveNudge) g.activeNudges += 1;
      if (dto.promisedAt && (!g.nextPromiseAt || dto.promisedAt < g.nextPromiseAt)) g.nextPromiseAt = dto.promisedAt;
      g.items.push(dto);
      groups.set(key, g);
    }
    const out = [...groups.values()];
    // Completed work reads best newest-first (what was just finished); open work
    // leads with whoever is most overdue / actively nudging.
    if (!isOpen) {
      const done = (g: FollowupPartyGroup) => g.items.reduce((max, i) => (i.resolvedAt && i.resolvedAt > max ? i.resolvedAt : max), '');
      return out.sort((a, b) => (done(b) < done(a) ? -1 : 1));
    }
    // Sort: parties with overdue / active first, then by soonest promise.
    return out.sort(
      (a, b) => b.overdueCount - a.overdueCount || b.activeNudges - a.activeNudges || (a.nextPromiseAt ?? '9999') < (b.nextPromiseAt ?? '9999') ? -1 : 1,
    );
  }

  async summary(kind?: string): Promise<FollowupSummary> {
    const rows = await this.prisma.followup.findMany({ where: { status: 'OPEN', ...(kind ? { kind: uc(kind)! } : {}) }, include: { logs: false } });
    const settings = await this.getSettings();
    const now = new Date();
    const s: FollowupSummary = { overdue: 0, dueToday: 0, upcoming: 0, activeNudges: 0, openTotal: rows.length };
    for (const r of rows) {
      const st = computeFollowupState(this.stateInput(r), now, settings.leadDays);
      if (st.urgency === 'OVERDUE') s.overdue += 1;
      else if (st.urgency === 'DUE_TODAY') s.dueToday += 1;
      else if (st.urgency === 'UPCOMING') s.upcoming += 1;
      if (st.isActiveNudge) s.activeNudges += 1;
    }
    return s;
  }

  /** The active nudges the client polls for the intrusive reminder. */
  async due(kind?: string): Promise<FollowupDto[]> {
    const rows = await this.prisma.followup.findMany({
      where: { status: 'OPEN', ...(kind ? { kind: uc(kind)! } : {}) },
      include: INCLUDE,
      orderBy: [{ promisedAt: 'asc' }],
    });
    const settings = await this.getSettings();
    const now = new Date();
    return rows.map((r) => this.toDto(r)).filter((f) => computeFollowupState(f, now, settings.leadDays).isActiveNudge);
  }

  /** Same as due(), but only followups that haven't had a push sent for this cycle yet. */
  async dueUnpushed(): Promise<FollowupDto[]> {
    const rows = await this.prisma.followup.findMany({
      where: { status: 'OPEN', pushSentAt: null },
      include: INCLUDE,
      orderBy: [{ promisedAt: 'asc' }],
    });
    const settings = await this.getSettings();
    const now = new Date();
    return rows.map((r) => this.toDto(r)).filter((f) => computeFollowupState(f, now, settings.leadDays).isActiveNudge);
  }

  /** Marks a followup as pushed for its current due-cycle. */
  async markPushed(id: number): Promise<void> {
    await this.prisma.followup.update({ where: { id }, data: { pushSentAt: new Date() } });
  }

  /* ── Suggest helpers (new-followup form) ────────────────────────────────── */

  async partySuggest(qStr?: string): Promise<{ id: number | null; partyName: string }[]> {
    const s = qStr?.trim();
    const customers = await this.prisma.customer.findMany({
      where: { partyName: { not: null }, active: true, ...(s ? { partyName: { contains: s } } : {}) },
      select: { id: true, partyName: true },
      orderBy: { partyName: 'asc' },
      take: 30,
    });
    return customers.filter((c) => c.partyName).map((c) => ({ id: c.id, partyName: c.partyName! }));
  }

  /** OPEN orders to link a follow-up to: CONFIRMED and with at least one active
   *  line not yet fully dispatched. With `party` set it lists that party's open
   *  orders straight away (no typing needed in the form). */
  async orderSuggest(qStr?: string, party?: string): Promise<{ id: number; code: string; customerName: string; customerId: number | null; orderDate: string; pendingLines: number }[]> {
    const s = qStr?.trim();
    const p = party?.trim();
    const rows = await this.prisma.order.findMany({
      where: {
        status: 'CONFIRMED',
        ...(p ? { customerName: p } : {}),
        ...(s ? { OR: [{ code: { contains: s } }, { customerName: { contains: s } }] } : {}),
      },
      select: { id: true, code: true, customerName: true, customerId: true, orderDate: true, items: { select: { id: true, status: true } } },
      orderBy: { id: 'desc' },
      take: 60,
    });
    const itemIds = rows.flatMap((r) => r.items.filter((i) => i.status !== 'CANCELLED').map((i) => i.id));
    const fully = new Set(
      (itemIds.length
        ? await this.prisma.dispatch.findMany({ where: { orderItemId: { in: itemIds }, dispatchStatus: 'FULLY DISPATCH' }, select: { orderItemId: true } })
        : []
      ).map((d) => d.orderItemId),
    );
    return rows
      .map((r) => {
        const active = r.items.filter((i) => i.status !== 'CANCELLED');
        return {
          id: r.id,
          code: r.code ?? `ORD-${String(r.id).padStart(5, '0')}`,
          customerName: r.customerName,
          customerId: r.customerId,
          orderDate: r.orderDate.toISOString(),
          pendingLines: active.filter((i) => !fully.has(i.id)).length,
        };
      })
      .filter((r) => r.pendingLines > 0)
      .slice(0, 25);
  }

  /** A party's OPEN order line items — the item-level version of orderSuggest(),
   *  so the follow-up form can link to a specific product/quantity instead of
   *  free-typed item text. Prefers `customerId` (exact); falls back to matching
   *  `party` against the order's snapshotted customerName for off-system parties. */
  async orderItemSuggest(
    customerId?: number,
    party?: string,
  ): Promise<
    {
      orderItemId: number;
      orderId: number;
      orderCode: string;
      orderDate: string;
      productName: string | null;
      design: string | null;
      pCategory: string | null;
      remBags: number;
      remPcs: number;
      remGram: number;
      remBox: number;
    }[]
  > {
    const p = party?.trim();
    if (!customerId && !p) return [];
    const items = await this.prisma.orderItem.findMany({
      where: {
        status: { not: 'CANCELLED' },
        order: {
          status: 'CONFIRMED',
          ...(customerId ? { customerId } : { customerName: p }),
        },
      },
      select: {
        id: true,
        orderId: true,
        productName: true,
        design: true,
        pCategory: true,
        bags: true,
        pcs: true,
        gram: true,
        box: true,
        order: { select: { code: true, orderDate: true } },
        dispatches: { select: { bags: true, pcs: true, gram: true, box: true } },
      },
      orderBy: { id: 'desc' },
      take: 100,
    });
    return items
      .map((it) => {
        const sum = (k: 'bags' | 'pcs' | 'gram' | 'box') => it.dispatches.reduce((s, d) => s + (d[k] ?? 0), 0);
        // Ordered minus dispatched in binary floating point leaves artefacts
        // (80.5 - 18.2 = 62.30000000000001), which reach the picker as a wall of
        // decimals. Quantities are never finer than 3 places, so settle the
        // subtraction here rather than papering over it at each display site.
        const rem = (ordered: number | null, dispatched: number) => Math.max(0, Math.round(((ordered ?? 0) - dispatched) * 1000) / 1000);
        return {
          orderItemId: it.id,
          orderId: it.orderId,
          orderCode: it.order.code ?? `ORD-${String(it.orderId).padStart(5, '0')}`,
          orderDate: it.order.orderDate.toISOString(),
          productName: it.productName,
          design: it.design,
          pCategory: it.pCategory,
          remBags: rem(it.bags, sum('bags')),
          remPcs: rem(it.pcs, sum('pcs')),
          remGram: rem(it.gram, sum('gram')),
          remBox: rem(it.box, sum('box')),
        };
      })
      .filter((it) => it.remBags > 0 || it.remPcs > 0 || it.remGram > 0 || it.remBox > 0)
      .slice(0, 40);
  }

  /* ── Party payment balances (Recovery Desk) ─────────────────────────────────
   * A collector needs to SEE what a party owes before working a payment
   * follow-up. These read live confirmed-sales exposure (billed − received),
   * fused with the party's PAYMENT-follow-up promise state. Balances are
   * all-time — an open invoice is open regardless of any date window. */

  /** Every owing party at a glance, ranked overdue-first. Optional `search`
   *  filters by party name or agent. */
  async partyBalances(search?: string): Promise<PartyBalanceSummary[]> {
    const all = await this.computeBalances();
    const s = search?.trim().toLowerCase();
    const list = s ? all.filter((p) => p.partyName.toLowerCase().includes(s) || (p.agent ?? '').toLowerCase().includes(s)) : all;
    return list.map(({ invoices: _invoices, ...rest }) => rest);
  }

  /** One party's balance with its open-invoice breakdown. Returns a zeroed
   *  detail (not null) for a known party with nothing outstanding, so the form
   *  can always show "cleared". */
  async partyBalance(customerId?: number, party?: string): Promise<PartyBalanceDetail | null> {
    const all = await this.computeBalances();
    if (customerId != null) {
      const hit = all.find((p) => p.customerId === customerId);
      if (hit) return hit;
    }
    const p = party?.trim();
    if (p) {
      const key = p.toUpperCase();
      const hit = all.find((x) => x.partyName.trim().toUpperCase() === key);
      if (hit) return hit;
      // Known/typed party with no open exposure → cleared shell (still carry CRM state).
      const cust = customerId != null ? await this.prisma.customer.findUnique({ where: { id: customerId }, select: { agentName: true } }) : null;
      const crm = await this.crmOverlayFor(customerId ?? null, p);
      return {
        customerId: customerId ?? null, partyName: p, agent: cust?.agentName ?? null,
        outstanding: 0, overdue: 0, dueSoon: 0, oldestDays: 0, invoiceCount: 0, lastReceiptAt: null, advanceHeld: 0,
        ...crm, invoices: [],
      };
    }
    return null;
  }

  private startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  /** Shared engine: build every owing party's balance + CRM overlay. */
  private async computeBalances(): Promise<PartyBalanceDetail[]> {
    const now = new Date();
    const today = this.startOfDay(now);
    const DAY = 86_400_000;
    const SALES = new Set(['SALES INVOICE', 'DEBIT NOTE']);
    const r0 = (x: number) => Math.round(x);
    const num = (v: unknown) => toNum(v) ?? 0;
    const [challans, custRows, receipts, discounts, advances, payFollowups] = await Promise.all([
      this.prisma.challan.findMany({ where: { challanStatus: 'CONFIRMED' }, select: { code: true, total: true, invDate: true, dueDate: true, customerId: true, customerName: true, transaction: true } }),
      this.prisma.customer.findMany({ select: { id: true, agentName: true } }),
      this.prisma.acctPaymentReceipt.findMany({ select: { custId: true, invNo: true, recAmt: true, recDate: true } }),
      // Sales Discounts settle an invoice just as truly as cash does (Account →
      // Sales Discount). Without them a written-off remainder is never cleared
      // here, so the invoice ages forever and the party can't be taken off the
      // recovery worklist from the UI at all.
      this.prisma.acctPartyDiscount.findMany({ select: { invNo: true, disAmt: true } }),
      this.prisma.acctPartyAdvance.findMany({ select: { custId: true, bankAmt: true, cashAmt: true } }),
      this.prisma.followup.findMany({ where: { kind: 'PAYMENT' }, select: { customerId: true, partyName: true, status: true, promisedAt: true, promisedAmount: true, updatedAt: true } }),
    ]);
    const recvByInv = new Map<string, number>();
    const lastRecByCust = new Map<number, Date>();
    for (const r of receipts) {
      recvByInv.set(r.invNo, (recvByInv.get(r.invNo) ?? 0) + num(r.recAmt));
      const c = lastRecByCust.get(r.custId);
      if (!c || r.recDate > c) lastRecByCust.set(r.custId, r.recDate);
    }
    const discByInv = new Map<string, number>();
    for (const d of discounts) discByInv.set(d.invNo, (discByInv.get(d.invNo) ?? 0) + num(d.disAmt));
    const advByCust = new Map<number, number>();
    for (const a of advances) advByCust.set(a.custId, (advByCust.get(a.custId) ?? 0) + num(a.bankAmt) + num(a.cashAmt));
    const custMap = new Map(custRows.map((c) => [c.id, c]));

    const map = new Map<string, PartyBalanceDetail>();
    for (const c of challans) {
      if (!SALES.has((c.transaction ?? '').trim().toUpperCase())) continue;
      const received = recvByInv.get(c.code) ?? 0;
      // Settled = money received + anything written off as a Sales Discount.
      const bal = Math.max(0, num(c.total) - received - (discByInv.get(c.code) ?? 0));
      if (bal <= 0) continue;
      const key = c.customerName || '—';
      let p = map.get(key);
      if (!p) {
        p = {
          customerId: c.customerId ?? null, partyName: key,
          agent: (c.customerId != null ? custMap.get(c.customerId)?.agentName : null) ?? null,
          outstanding: 0, overdue: 0, dueSoon: 0, oldestDays: 0, invoiceCount: 0, lastReceiptAt: null, advanceHeld: 0,
          openFollowups: 0, nextPromiseAt: null, nextPromiseAmount: null, promiseState: 'none', hasFollowup: false, invoices: [],
        };
        map.set(key, p);
      }
      p.outstanding += bal;
      p.invoiceCount += 1;
      let overdueDays = 0;
      if (c.dueDate) {
        const days = Math.floor((today.getTime() - this.startOfDay(c.dueDate).getTime()) / DAY);
        if (days > 0) { p.overdue += bal; p.oldestDays = Math.max(p.oldestDays, days); overdueDays = days; }
        else if (days >= -15) p.dueSoon += bal;
      }
      p.invoices.push({ code: c.code, invDate: c.invDate.toISOString(), dueDate: c.dueDate ? c.dueDate.toISOString() : null, total: r0(num(c.total)), received: r0(received), balance: r0(bal), overdueDays });
    }

    // CRM overlay (party PAYMENT follow-ups → promise state).
    const crm = this.buildCrmOverlay(payFollowups, today, DAY);
    for (const p of map.values()) {
      if (p.customerId != null) {
        p.advanceHeld = r0(advByCust.get(p.customerId) ?? 0);
        const lr = lastRecByCust.get(p.customerId);
        p.lastReceiptAt = lr ? lr.toISOString() : null;
      }
      p.outstanding = r0(p.outstanding);
      p.overdue = r0(p.overdue);
      p.dueSoon = r0(p.dueSoon);
      p.invoices.sort((a, b) => b.overdueDays - a.overdueDays || (a.dueDate ?? a.invDate).localeCompare(b.dueDate ?? b.invDate));
      const c = crm.get(p.customerId != null ? `c:${p.customerId}` : `n:${p.partyName.trim().toUpperCase()}`) ?? (p.customerId != null ? crm.get(`n:${p.partyName.trim().toUpperCase()}`) : undefined);
      const o = this.crmToOverlay(c);
      p.openFollowups = o.openFollowups; p.nextPromiseAt = o.nextPromiseAt; p.nextPromiseAmount = o.nextPromiseAmount; p.promiseState = o.promiseState; p.hasFollowup = o.hasFollowup;
    }
    return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding);
  }

  /* ── CRM overlay helpers (shared by balances + single-party lookup) ──────── */

  private buildCrmOverlay(
    followups: { customerId: number | null; partyName: string; status: string; promisedAt: Date | null; promisedAmount: number | null; updatedAt: Date }[],
    today: Date,
    DAY: number,
  ) {
    interface Crm { open: number; nextPromise: Date | null; nextAmount: number | null; broken: boolean; dueToday: boolean; any: boolean }
    const crm = new Map<string, Crm>();
    const nk = (name: string) => `n:${name.trim().toUpperCase()}`;
    for (const fu of followups) {
      const k = fu.customerId != null ? `c:${fu.customerId}` : nk(fu.partyName);
      let c = crm.get(k);
      if (!c) { c = { open: 0, nextPromise: null, nextAmount: null, broken: false, dueToday: false, any: false }; crm.set(k, c); }
      c.any = true;
      if (fu.status === 'OPEN') {
        c.open += 1;
        if (fu.promisedAt) {
          if (!c.nextPromise || fu.promisedAt < c.nextPromise) { c.nextPromise = fu.promisedAt; c.nextAmount = fu.promisedAmount ?? null; }
          const days = Math.floor((today.getTime() - this.startOfDay(fu.promisedAt).getTime()) / DAY);
          if (days > 0) c.broken = true;
          else if (days === 0) c.dueToday = true;
        }
      }
    }
    return crm;
  }

  private crmToOverlay(c?: { open: number; nextPromise: Date | null; nextAmount: number | null; broken: boolean; dueToday: boolean; any: boolean }): {
    openFollowups: number; nextPromiseAt: string | null; nextPromiseAmount: number | null; promiseState: PromiseState; hasFollowup: boolean;
  } {
    if (!c) return { openFollowups: 0, nextPromiseAt: null, nextPromiseAmount: null, promiseState: 'none', hasFollowup: false };
    const promiseState: PromiseState = c.broken ? 'broken' : c.dueToday ? 'due today' : c.nextPromise ? 'upcoming' : 'none';
    return { openFollowups: c.open, nextPromiseAt: c.nextPromise ? c.nextPromise.toISOString() : null, nextPromiseAmount: c.nextAmount, promiseState, hasFollowup: c.any };
  }

  /** Single-party CRM overlay (used by the cleared-party shell). */
  private async crmOverlayFor(customerId: number | null, party: string) {
    const DAY = 86_400_000;
    const today = this.startOfDay(new Date());
    const rows = await this.prisma.followup.findMany({
      where: { kind: 'PAYMENT', ...(customerId != null ? { customerId } : { partyName: party }) },
      select: { customerId: true, partyName: true, status: true, promisedAt: true, promisedAmount: true, updatedAt: true },
    });
    const crm = this.buildCrmOverlay(rows, today, DAY);
    const c = crm.get(customerId != null ? `c:${customerId}` : `n:${party.trim().toUpperCase()}`);
    return this.crmToOverlay(c);
  }

  /* ── helpers ────────────────────────────────────────────────────────────── */

  private listWhere(q: FollowupQueryDto): Prisma.FollowupWhereInput {
    const search = q.search?.trim();
    return {
      ...(q.kind ? { kind: uc(q.kind)! } : {}),
      ...(q.status ? { status: uc(q.status)! } : {}),
      ...(q.party ? { partyName: q.party } : {}),
      ...(search ? { OR: [{ partyName: { contains: search } }, { title: { contains: search } }, { orderCode: { contains: search } }, { itemText: { contains: search } }] } : {}),
    };
  }

  private listOrder(): Prisma.FollowupOrderByWithRelationInput[] {
    // Urgent first, then soonest promise, then newest.
    return [{ priority: 'desc' }, { promisedAt: 'asc' }, { id: 'desc' }];
  }

  private matchesBucket(f: FollowupDto, bucket?: string): boolean {
    if (!bucket) return true;
    const st = computeFollowupState(f, new Date());
    if (bucket === 'attention') return st.needsAttention && f.status === 'OPEN';
    if (bucket === 'overdue') return st.urgency === 'OVERDUE';
    if (bucket === 'today') return st.urgency === 'DUE_TODAY';
    if (bucket === 'upcoming') return st.urgency === 'UPCOMING';
    if (bucket === 'active') return st.isActiveNudge;
    return true;
  }

  private stateInput(f: Followup) {
    const todayStr = this.dayStr(new Date());
    return {
      status: f.status,
      promisedAt: f.promisedAt ? f.promisedAt.toISOString() : null,
      nextRemindAt: f.nextRemindAt ? f.nextRemindAt.toISOString() : null,
      remindersToday: f.remindersDate === todayStr ? f.remindersToday : 0,
      maxRemindersPerDay: f.maxRemindersPerDay,
    };
  }

  private dayStr(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /** Push a reminder time into the working-hours window (never nudge at night). */
  private clampToWorkHours(d: Date, s: CrmReminderSettings): Date {
    const out = new Date(d);
    const h = out.getHours();
    if (h < s.workStartHour) {
      out.setHours(s.workStartHour, 0, 0, 0);
    } else if (h >= s.workEndHour) {
      out.setDate(out.getDate() + 1);
      out.setHours(s.workStartHour, 0, 0, 0);
    }
    return out;
  }

  private async ensure(id: number): Promise<Followup> {
    const row = await this.prisma.followup.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Follow-up not found.');
    return row;
  }

  private toDto(r: Row): FollowupDto {
    const todayStr = this.dayStr(new Date());
    return {
      id: r.id,
      kind: r.kind as FollowupKind,
      customerId: r.customerId,
      partyName: r.partyName,
      orderId: r.orderId,
      orderCode: r.orderCode,
      orderItemId: r.orderItemId,
      itemText: r.itemText,
      title: r.title,
      detail: r.detail,
      stage: r.stage,
      priority: r.priority as FollowupPriority,
      status: r.status as FollowupStatus,
      promisedAt: r.promisedAt ? r.promisedAt.toISOString() : null,
      promisedAmount: r.promisedAmount ?? null,
      reminderIntervalMins: r.reminderIntervalMins,
      maxRemindersPerDay: r.maxRemindersPerDay,
      remindersToday: r.remindersDate === todayStr ? r.remindersToday : 0,
      nextRemindAt: r.nextRemindAt ? r.nextRemindAt.toISOString() : null,
      lastRemindedAt: r.lastRemindedAt ? r.lastRemindedAt.toISOString() : null,
      createdByName: r.createdByName,
      resolvedByName: r.resolvedByName,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      logs: (r.logs ?? []).map((l: FollowupLog): FollowupLogDto => ({
        id: l.id,
        followupId: l.followupId,
        kind: l.kind as FollowupLogDto['kind'],
        note: l.note,
        stage: l.stage,
        newPromisedAt: l.newPromisedAt ? l.newPromisedAt.toISOString() : null,
        userName: l.userName,
        createdAt: l.createdAt.toISOString(),
      })),
      checklist: (r.checklist ?? []).map((c): FollowupChecklistItemDto => ({
        id: c.id,
        followupId: c.followupId,
        text: c.text,
        done: c.done,
        sortOrder: c.sortOrder,
        source: (c.source as 'MANUAL' | 'VOICE') ?? 'MANUAL',
        createdAt: c.createdAt.toISOString(),
      })),
      items: (r.items ?? []).map((it): FollowupItemDto => ({
        id: it.id,
        followupId: it.followupId,
        orderItemId: it.orderItemId,
        orderCode: it.orderCode,
        productName: it.productName,
        bags: it.bags,
        pcs: it.pcs,
        kgs: it.kgs,
        box: it.box,
      })),
    };
  }

  /* ── Checklist items ────────────────────────────────────────────────────── */

  async addChecklistItems(id: number, items: { text: string; source?: 'MANUAL' | 'VOICE' }[]): Promise<FollowupDto> {
    await this.ensure(id);
    const max = await this.prisma.followupChecklistItem.aggregate({ where: { followupId: id }, _max: { sortOrder: true } });
    let order = (max._max.sortOrder ?? -1) + 1;
    const clean = items.map((it) => ({ text: it.text.trim(), source: it.source })).filter((it) => it.text);
    if (clean.length) {
      await this.prisma.followupChecklistItem.createMany({
        data: clean.map((it) => ({ followupId: id, text: it.text, source: it.source === 'VOICE' ? 'VOICE' : 'MANUAL', sortOrder: order++ })),
      });
    }
    return this.findOne(id);
  }

  async updateChecklistItem(itemId: number, data: { done?: boolean; text?: string }): Promise<FollowupDto> {
    const item = await this.prisma.followupChecklistItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Checklist item not found.');
    await this.prisma.followupChecklistItem.update({
      where: { id: itemId },
      data: { ...(data.done !== undefined ? { done: data.done } : {}), ...(data.text !== undefined ? { text: data.text.trim() } : {}) },
    });
    return this.findOne(item.followupId);
  }

  async removeChecklistItem(itemId: number): Promise<FollowupDto> {
    const item = await this.prisma.followupChecklistItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Checklist item not found.');
    await this.prisma.followupChecklistItem.delete({ where: { id: itemId } });
    return this.findOne(item.followupId);
  }
}
