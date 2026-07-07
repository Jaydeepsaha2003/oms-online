import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Followup, FollowupLog, Prisma } from '@prisma/client';
import {
  DEFAULT_CRM_SETTINGS,
  computeFollowupState,
  type CrmReminderSettings,
  type FollowupChecklistItemDto,
  type FollowupDto,
  type FollowupKind,
  type FollowupLogDto,
  type FollowupPartyGroup,
  type FollowupPriority,
  type FollowupStatus,
  type FollowupSummary,
  type Paginated,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toNum, toStr, uc } from '../common/coerce';
import { AddFollowupLogDto, CreateFollowupDto, CrmSettingsDto, FollowupQueryDto } from './dto/crm.dto';

const SETTINGS_KEY = 'CRM_REMINDER_DEFAULTS';
const INCLUDE = { logs: { orderBy: { createdAt: 'asc' } }, checklist: { orderBy: { sortOrder: 'asc' } } } as const;
type Row = Prisma.FollowupGetPayload<{ include: typeof INCLUDE }>;

/* ── Fuzzy name matching (voice → customer list) ──────────────────────────────
 * Spoken names arrive with honorifics ("Ratna ji") and transliteration wobble
 * ("Raatna" vs "Ratna"), so a plain substring search misses them. These helpers
 * fold spelling variants and compare token-by-token with a small edit-distance
 * tolerance. Used only by the voice matcher, not the typeahead. */

// Words to drop from a spoken party name — honorifics + generic company suffixes.
const NAME_STOPWORDS = new Set([
  'ji', 'jee', 'sahab', 'saheb', 'sahib', 'bhai', 'seth', 'shri', 'sri', 'shree',
  'mr', 'mrs', 'ms', 'and', 'the', 'ka', 'ki', 'ko', 'ke',
]);

/** Lowercase, strip punctuation, and fold common transliteration variants so
 *  "Raatna", "Ratnaa" and "Ratna" all collapse to the same key. */
function foldName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/ph/g, 'f')
    .replace(/w/g, 'v')
    .replace(/(.)\1+/g, '$1') // collapse doubled letters: raatna → ratna
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(s: string): string[] {
  return foldName(s)
    .split(' ')
    .filter((t) => t.length >= 2 && !NAME_STOPWORDS.has(t));
}

/** Levenshtein edit distance (small strings, so the simple DP is plenty fast). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** How well a spoken name matches a candidate party name (higher = better, 0 = no match). */
function nameMatchScore(spoken: string, candidate: string): number {
  const sTokens = nameTokens(spoken);
  const cTokens = nameTokens(candidate);
  if (!sTokens.length || !cTokens.length) return 0;
  let score = 0;
  for (const st of sTokens) {
    let best = 0;
    for (const ct of cTokens) {
      if (st === ct) best = Math.max(best, 3);
      else if (ct.startsWith(st) || st.startsWith(ct)) best = Math.max(best, 2);
      else {
        const dist = editDistance(st, ct);
        const tol = Math.max(st.length, ct.length) <= 4 ? 1 : 2;
        if (dist <= tol) best = Math.max(best, 1.5);
      }
    }
    score += best;
  }
  // Small bonus when the whole spoken phrase is a substring of the candidate.
  if (foldName(candidate).includes(foldName(spoken))) score += 1;
  return score;
}

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
      },
      include: INCLUDE,
    });
    return this.toDto(row);
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
        ...(dto.reminderIntervalMins !== undefined ? { reminderIntervalMins: dto.reminderIntervalMins ?? null } : {}),
        ...(dto.maxRemindersPerDay !== undefined ? { maxRemindersPerDay: dto.maxRemindersPerDay ?? null } : {}),
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
          ...(newPromised ? { promisedAt: newPromised, nextRemindAt: null } : {}), // re-promise re-opens the window
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
        data: { nextRemindAt: next, lastRemindedAt: now, remindersToday, remindersDate: todayStr },
      }),
    ]);
    return this.findOne(id);
  }

  async resolve(id: number, userName?: string): Promise<FollowupDto> {
    await this.ensure(id);
    await this.prisma.$transaction([
      this.prisma.followupLog.create({ data: { followupId: id, kind: 'STATUS', note: 'Resolved', userName: userName ?? null } }),
      this.prisma.followup.update({ where: { id }, data: { status: 'DONE', resolvedAt: new Date(), resolvedByName: userName ?? null } }),
    ]);
    return this.findOne(id);
  }

  async reopen(id: number, userName?: string): Promise<FollowupDto> {
    await this.ensure(id);
    await this.prisma.$transaction([
      this.prisma.followupLog.create({ data: { followupId: id, kind: 'STATUS', note: 'Reopened', userName: userName ?? null } }),
      this.prisma.followup.update({ where: { id }, data: { status: 'OPEN', resolvedAt: null, resolvedByName: null, nextRemindAt: null } }),
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

  /** Party-wise board of OPEN follow-ups. */
  async board(q: FollowupQueryDto): Promise<FollowupPartyGroup[]> {
    const where: Prisma.FollowupWhereInput = { status: 'OPEN', ...(q.kind ? { kind: uc(q.kind)! } : {}), ...(q.party ? { partyName: q.party } : {}) };
    const rows = await this.prisma.followup.findMany({ where, include: INCLUDE, orderBy: this.listOrder() });
    const now = new Date();
    const settings = await this.getSettings();
    const groups = new Map<string, FollowupPartyGroup>();
    for (const r of rows) {
      const dto = this.toDto(r);
      if (!this.matchesBucket(dto, q.bucket)) continue;
      const key = dto.partyName;
      const g = groups.get(key) ?? { partyName: key, customerId: dto.customerId, openCount: 0, overdueCount: 0, activeNudges: 0, nextPromiseAt: null, items: [] };
      const st = computeFollowupState(dto, now, settings.leadDays);
      g.openCount += 1;
      if (st.urgency === 'OVERDUE') g.overdueCount += 1;
      if (st.isActiveNudge) g.activeNudges += 1;
      if (dto.promisedAt && (!g.nextPromiseAt || dto.promisedAt < g.nextPromiseAt)) g.nextPromiseAt = dto.promisedAt;
      g.items.push(dto);
      groups.set(key, g);
    }
    // Sort: parties with overdue / active first, then by soonest promise.
    return [...groups.values()].sort(
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

  /** Loose voice-name matcher: given a spoken party name (with honorifics /
   *  spelling wobble), rank the whole customer list by fuzzy score. Only strong
   *  enough matches are returned so a mishear yields an empty list (→ treated as
   *  a new party) rather than a wrong auto-select. */
  async partyMatch(qStr?: string): Promise<{ id: number | null; partyName: string }[]> {
    const s = qStr?.trim();
    if (!s) return [];
    const customers = await this.prisma.customer.findMany({
      where: { partyName: { not: null }, active: true },
      select: { id: true, partyName: true },
    });
    return customers
      .map((c) => ({ id: c.id, partyName: c.partyName!, score: nameMatchScore(s, c.partyName!) }))
      .filter((x) => x.score >= 1.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ id, partyName }) => ({ id, partyName }));
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

  /** Item-catalog lookup for the voice form: match a spoken item ("royal glass",
   *  "50 steel thali") against the Product catalog so we can offer the real
   *  catalogue name. De-duplicated by product+category (sizes make duplicates). */
  async productSuggest(qStr?: string): Promise<{ id: number; name: string; category: string; subCategory: string }[]> {
    const s = qStr?.trim();
    if (!s) return [];
    // Drop a leading quantity/units the model may include ("50 ", "10 pcs").
    const core = s.replace(/^\s*\d+\s*(pcs|pc|pieces|nos|no|x|\*)?\s*/i, '').trim() || s;
    const tokens = core.split(/\s+/).filter((t) => t.length >= 2);
    const rows = await this.prisma.product.findMany({
      where: {
        OR: [
          { product: { contains: core } },
          { category: { contains: core } },
          ...tokens.map((t) => ({ product: { contains: t } })),
          ...tokens.map((t) => ({ category: { contains: t } })),
        ],
      },
      select: { id: true, product: true, category: true, subCategory: true },
      orderBy: [{ category: 'asc' }, { product: 'asc' }],
      take: 20,
    });
    const seen = new Set<string>();
    const out: { id: number; name: string; category: string; subCategory: string }[] = [];
    for (const r of rows) {
      const key = `${r.product}|${r.category}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: r.id, name: r.product, category: r.category, subCategory: r.subCategory });
      if (out.length >= 8) break;
    }
    return out;
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
