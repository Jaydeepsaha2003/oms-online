import { BadRequestException, ConflictException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { Dispatch, Prisma } from '@prisma/client';
import {
  isRealDesign,
  isUncommittedOrder,
  ORDER_UNCOMMITTED_STATUSES,
  lineNeedsReferencePhoto,
  type DispatchBackdatePayload,
  type DispatchDateChangePayload,
  type DispatchDto,
  type DispatchFilterOptions,
  type DispatchPhotoCheckDto,
  type DraftPhotoCheckInput,
  type DraftPhotoCheckResult,
  type DispatchStatus,
  RETURNED_DISPATCH_STATUS,
  type DispatchReturnRef,
  type PendingLineDto,
  type Paginated,
  type SubmitDispatchResult,
  type UpdateDispatchResult,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { baseProductName, matchesProductName, productNameWhere } from '../common/product-name';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { BookingsService } from '../bookings/bookings.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { formatDate } from '../common/date.util';
import { toNum, toStr, uc } from '../common/coerce';
import { CreateDispatchDto, DispatchQueryDto, PendingQueryDto, UpdateDispatchDto } from './dto/dispatch.dto';
import { DispatchNotifier } from './dispatch-notifier.service';
import { qtyText } from './qty-text.util';

const EPS = 1e-6;

/** Who performed an action, for the audit trail. `id` is a User cuid. */
interface Actor {
  id?: string | null;
  name?: string | null;
}

// Cap quantities at 3 decimals. Subtracting/summing floats (e.g. ordered − dispatched)
// otherwise surfaces artifacts like 71.60000000000001 into the remaining qty, which
// then leaks into the dispatch form's pre-filled / MAX-filled inputs.
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const DAY_MS = 86_400_000;

/**
 * A line's due status, on a percentage-of-completion-window basis rather than
 * a flat "past the date or not" check: for an order given N days to complete
 * (order date → due date), the first half of that window is `Due`, the second
 * half is `Past Due`, and anything past the actual due date is `Over Due`.
 * E.g. a 30-day window: 0-15 days elapsed = Due, 15-30 = Past Due, 30+ = Over Due.
 * No due date at all keeps the line as `Due` (nothing to measure against).
 */
function dueBucket(orderDate: Date, due: Date | null, today: Date): 'Due' | 'Past Due' | 'Over Due' {
  if (!due) return 'Due';
  if (due < today) return 'Over Due';
  const completionDays = Math.max(1, Math.round((due.getTime() - orderDate.getTime()) / DAY_MS));
  const elapsedDays = Math.max(0, Math.round((today.getTime() - orderDate.getTime()) / DAY_MS));
  return elapsedDays / completionDays >= 0.5 ? 'Past Due' : 'Due';
}

// Dispatch and challan screens label this snapshot simply as "Design". Prefer
// the human-readable name chosen on the order line, falling back for older rows.
const dispatchDesign = (line: { design?: string | null; designType?: string | null; productName?: string | null }) => {
  if (line.design === undefined) return toStr(line.designType);
  const name = toStr(line.design);
  const type = toStr(line.designType);
  const productName = toStr(line.productName);
  const legacyTypeInName =
    !!name && name.toUpperCase() !== 'NA' && productName?.toUpperCase().endsWith(` ${name.toUpperCase()}`);
  if (legacyTypeInName) return type && type.toUpperCase() !== 'NA' ? type : 'NA';
  return name ?? 'NA';
};

/*
 * Two dispatches on the SAME order line with identical quantities + status
 * inside this window are one event — a double-tap, or two users saving the same
 * shipment at once.
 *
 * It no longer SWALLOWS the second one. It used to return the existing row and
 * report success, which was a lie the screen repeated: dispatch a line, submit
 * the identical line again within 15s (the form keeps its values, so that is two
 * clicks), and you were told it saved while nothing had been written. A third
 * attempt past the window then hit the duplicate guard and was correctly
 * refused — "allowed, then didn't save, then blocked", exactly as reported.
 *
 * Both paths now raise the same conflict, so the answer is the same whether the
 * repeat comes one second later or one hour later. Nothing auto-retries a write
 * (see the api.ts interceptor: reads only), so a second POST is always a person.
 *
 * The window still earns its keep for one case the duplicate guard cannot see:
 * a RETURN being double-tapped. That guard ignores RETURNED rows on purpose —
 * a return legitimately repeats a quantity already dispatched.
 */
const DISPATCH_DEDUPE_WINDOW_MS = 15_000;

// The pending pool is a full scan of every order line + its dispatches, so
// recomputing it on every filter/search keystroke is what made the Dispatch Order
// page feel slow. Cache it briefly: back-to-back filter changes reuse the same
// snapshot, and any dispatch write clears it immediately so a just-shipped line
// vanishes at once (order edits/new orders still refresh within the TTL).
const PENDING_CACHE_TTL_MS = 10_000;

@Injectable()
export class DispatchService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly notifier: DispatchNotifier,
    private readonly gateway: NotificationsGateway,
    private readonly bookings: BookingsService,
  ) {}

  /* ── Editing locks: "someone else has this line open" ──────────────────────
   * A soft, in-memory lock keyed by orderItemId — the entity both the Dispatch
   * form (new dispatch on a pending line) and Modify Dispatch's edit dialog
   * (an existing dispatch, which also carries orderItemId) revolve around, so
   * one lock space covers a collision between either screen on the same line.
   * TTL-based rather than release-guaranteed: a crashed tab/lost connection
   * can't leave a line permanently stuck, it just expires. Single-process,
   * in-memory by design — this app runs as one Windows service against one
   * SQLite file, so there's no second instance to coordinate with. */
  private readonly lineLocks = new Map<number, { userId: string | null; userName: string; acquiredAt: number }>();
  private static readonly LOCK_TTL_MS = 90_000;

  /** Claim (or renew) the lock on an order line. Fails only when someone ELSE
   *  holds a still-live lock — the same user calling again (a heartbeat while
   *  their sheet stays open) always succeeds and just refreshes the timer. */
  acquireLock(orderItemId: number, user: { id?: string | null; name?: string | null }): { ok: true } {
    const now = Date.now();
    const existing = this.lineLocks.get(orderItemId);
    const mine = (existing?.userId ?? null) === (user.id ?? null);
    const wasLive = !!existing && now - existing.acquiredAt < DispatchService.LOCK_TTL_MS;
    if (existing && !mine && wasLive) {
      throw new ConflictException(`${existing.userName} is currently working on this item — try again in a moment.`);
    }
    // One line at a time per person. A user can only have one sheet open, so any
    // OTHER line still showing their name is a leftover: the release never fired
    // because the tab was closed, the phone slept, or the signal dropped, and it
    // would otherwise sit there looking like they're on two lines at once until
    // the 90s TTL expired. Claiming a new line is proof they've left the old one.
    if (user.id != null) {
      for (const [otherId, lock] of this.lineLocks) {
        if (otherId !== orderItemId && lock.userId === user.id) this.lineLocks.delete(otherId);
      }
    }
    this.lineLocks.set(orderItemId, { userId: user.id ?? null, userName: user.name ?? 'Another user', acquiredAt: now });
    // Only a genuinely new/newly-live lock changes what other users' pending
    // lists should show — a heartbeat renewal (same user, still live) doesn't,
    // so it skips the broadcast rather than pinging every open tab every 30s.
    if (!(mine && wasLive)) this.gateway.emitDispatchLockChanged();
    return { ok: true };
  }

  /** Release the lock — a no-op if it's already gone or held by someone else
   *  (so a stale/duplicate release call can never steal another user's lock). */
  releaseLock(orderItemId: number, user: { id?: string | null }): void {
    const existing = this.lineLocks.get(orderItemId);
    if (existing && (existing.userId ?? null) === (user.id ?? null)) {
      this.lineLocks.delete(orderItemId);
      this.gateway.emitDispatchLockChanged();
    }
  }

  /** Live (non-expired) locks right now, keyed by orderItemId — folded into the
   *  pending pool so other users see a line is taken before they try to open it.
   *  Public: ChallansService reads the same map so Pending Challan can warn that
   *  a dispatch's order line is mid-dispatch elsewhere (see `pending()` there). */
  activeLockNames(): Map<number, string> {
    const now = Date.now();
    const out = new Map<number, string>();
    for (const [orderItemId, lock] of this.lineLocks) {
      if (now - lock.acquiredAt < DispatchService.LOCK_TTL_MS) out.set(orderItemId, lock.userName);
    }
    return out;
  }

  /**
   * Record one entry against a specific dispatch, so it shows up in that
   * dispatch's own Activity History panel (which queries resource=dispatch +
   * resourceId=<that dispatch's id>).
   */
  private logDispatch(input: {
    dispatchId: number;
    action: string;
    description: string;
    actor?: Actor;
    metadata?: Record<string, unknown>;
  }): void {
    void this.audit.record({
      userId: input.actor?.id ?? null,
      action: input.action,
      resource: 'dispatch',
      resourceId: String(input.dispatchId),
      description: input.description,
      statusCode: 200,
      metadata: input.metadata ?? null,
    });
  }

  /**
   * Teach the approvals inbox how to apply an approved back-dated dispatch: replay
   * the saved payload through the normal create path with the approval already
   * granted, so it goes through every quantity/duplicate guard exactly as if the
   * requester had held `dispatch:approve` all along.
   */
  onModuleInit(): void {
    this.approvals.registerHandler('DISPATCH_BACKDATE', async (payload, approverName, approver) => {
      const p = payload as unknown as DispatchBackdatePayload;
      const row = await this.create(
        {
          orderItemId: p.orderItemId,
          dispatchStatus: p.dispatchStatus as CreateDispatchDto['dispatchStatus'],
          bags: p.bags ?? undefined,
          pcs: p.pcs ?? undefined,
          gram: p.gram ?? undefined,
          box: p.box ?? undefined,
          comment: p.comment ?? undefined,
          supItem: p.supItem ?? undefined,
          dispatchDate: p.dispatchDate,
        },
        // Keep the ORIGINAL requester on the record — the approver's name belongs
        // on the approval row, not on the dispatch they merely signed off.
        p.requestedByName ?? approverName,
        undefined,
        // ApprovalsService.approve() writes the combined audit entry, and the
        // alert below says "approved" rather than the plain "dispatched" one
        // create() would have raised.
        { skipAudit: true, skipNotify: true },
      );
      this.notifier.backdateApproved({
        // The approver is excluded — they just decided this and know about it.
        actorId: approver?.id ?? null,
        dispatchId: row.id,
        dispatchCode: row.code ?? this.codeFor(row.id),
        // The payload's snapshot fields are optional on the type. submit() always
        // fills customerName in, but an older parked request predating that could
        // not, and an approval can sit in the inbox indefinitely.
        customerName: p.customerName ?? 'Unknown party',
        productName: p.productName,
        orderCode: p.orderCode,
        dispatchDate: p.dispatchDate,
        requestedByName: p.requestedByName ?? null,
        approverName,
        bags: p.bags,
        pcs: p.pcs,
        gram: p.gram,
        box: p.box,
      });
      return row.id;
    });

    // Moving an existing dispatch to another date — same gate, applied in place.
    this.approvals.registerHandler('DISPATCH_DATE_CHANGE', async (payload) => {
      const p = payload as unknown as DispatchDateChangePayload;
      const exists = await this.prisma.dispatch.count({ where: { id: p.dispatchId } });
      if (!exists) {
        throw new BadRequestException('That dispatch no longer exists, so this date change cannot be applied.');
      }
      await this.prisma.dispatch.update({
        where: { id: p.dispatchId },
        data: { dispatchDate: new Date(p.dispatchDate) },
      });
      this.invalidatePendingCache();
      return p.dispatchId;
    });

    // Both approval types land their decision inside the DISPATCH's own Activity
    // History, not just the generic approvals log — see ApprovalAuditTarget.
    this.approvals.registerAuditTarget('DISPATCH_BACKDATE', {
      resource: 'dispatch',
      label: 'back-dated dispatch',
      describe: (payload) => {
        const p = payload as unknown as DispatchBackdatePayload;
        return `${qtyText({ bags: p.bags, pcs: p.pcs, gram: p.gram, box: p.box })} · dated ${formatDate(p.dispatchDate)}`;
      },
      // Nothing exists until approved, so a REJECTION has no record to attach to.
      existingResourceId: () => null,
    });
    this.approvals.registerAuditTarget('DISPATCH_DATE_CHANGE', {
      resource: 'dispatch',
      label: 'dispatch date change',
      describe: (payload) => {
        const p = payload as unknown as DispatchDateChangePayload;
        return `${formatDate(p.currentDate)} → ${formatDate(p.dispatchDate)}`;
      },
      // The dispatch already exists — a rejection is meaningful history on it too.
      existingResourceId: (payload) => (payload as unknown as DispatchDateChangePayload).dispatchId,
    });
  }

  /**
   * Is this dispatch date "today"? Compared on the calendar day in server-local
   * time, which is the day the shop is working in. Anything else is a back-date
   * (or a forward-date) and needs `dispatch:approve`.
   */
  private isToday(iso?: string | null): boolean {
    if (!iso) return true; // omitted → the service stamps now()
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return true;
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
    );
  }

  private pendingCache: { at: number; lines: PendingLineDto[] } | null = null;
  /**
   * Every dispatch write funnels through here, so this is also where the rest of
   * the building gets told.
   *
   * A dispatch moves TWO pools: what is still awaiting dispatch, and what is
   * awaiting a challan. The challan side was only ever broadcast by
   * ChallansService, so creating or editing a dispatch changed the un-challaned
   * pool silently — an open Pending Challan view on another device (the office PC
   * while someone dispatches from a phone) kept showing the old list until it was
   * reloaded by hand. Since this is already the one place every write passes, the
   * ping belongs here rather than repeated across submit/update/remove.
   */
  private invalidatePendingCache(): void {
    this.pendingCache = null;
    this.gateway.emitPendingChallansChanged();
  }

  /* ── Pending order lines (ordered − dispatched) ─────────────────────────── */

  /** The full pool of order lines still awaiting dispatch (ordered − dispatched > 0),
   *  before any dropdown/search filtering. Shared by the list and its filter options.
   *  Cached for {@link PENDING_CACHE_TTL_MS} (see note above). */
  /**
   * The pending-line pool, for other modules that must work from exactly the
   * same lines this screen shows — currently Design Track. Deliberately a thin
   * wrapper rather than making the computation public: callers share the same
   * short-lived cache and cannot bypass it with their own query, so the two
   * screens can never disagree about what "pending" means.
   */
  async pendingPool(): Promise<PendingLineDto[]> {
    return this.computePendingLines();
  }

  private async computePendingLines(): Promise<PendingLineDto[]> {
    if (this.pendingCache && Date.now() - this.pendingCache.at < PENDING_CACHE_TTL_MS) {
      return this.pendingCache.lines;
    }
    const items = await this.prisma.orderItem.findMany({
      // Cancelled lines are not dispatchable, nor are lines on an order that is
      // cancelled, still a draft, or parked as a quotation.
      where: { status: { not: 'CANCELLED' }, order: { status: { notIn: ['CANCELLED', ...ORDER_UNCOMMITTED_STATUSES] } } },
      include: { order: true, dispatches: true },
      // Fetched in ORD# order; the list is re-sorted below (URGENT first, then by
      // due severity) — this orderBy only decides the tiebreak within a bucket.
      orderBy: [{ orderId: 'asc' }, { id: 'asc' }],
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lines: PendingLineDto[] = [];
    for (const it of items) {
      // "FULLY DISPATCH" is a shortcut for "this line is closed". A credit note
      // saved as Undispatched adds a RETURNED row carrying negative quantity —
      // at which point the line is NOT closed any more, however it was marked.
      // Without this the returned goods would net out correctly below and still
      // never appear, because the shortcut would have skipped the line first.
      const hasReturn = it.dispatches.some((d) => d.dispatchStatus === RETURNED_DISPATCH_STATUS);
      if (!hasReturn && it.dispatches.some((d) => d.dispatchStatus === 'FULLY DISPATCH')) continue;
      const sum = it.dispatches.reduce(
        (a, d) => ({ bags: a.bags + (d.bags ?? 0), pcs: a.pcs + (d.pcs ?? 0), gram: a.gram + (d.gram ?? 0), box: a.box + (d.box ?? 0) }),
        { bags: 0, pcs: 0, gram: 0, box: 0 },
      );
      const remBags = round3(Math.max(0, (it.bags ?? 0) - sum.bags));
      const remPcs = round3(Math.max(0, (it.pcs ?? 0) - sum.pcs));
      const remKgs = round3(Math.max(0, (it.gram ?? 0) - sum.gram));
      const remBox = round3(Math.max(0, (it.box ?? 0) - sum.box));
      if (remBags <= EPS && remPcs <= EPS && remKgs <= EPS && remBox <= EPS) continue;
      const due = it.order.completionDate;
      lines.push({
        orderItemId: it.id,
        orderId: it.orderId,
        orderCode: it.order.code ?? this.orderCodeFor(it.orderId),
        orderDate: it.order.orderDate.toISOString(),
        dueDate: due ? due.toISOString() : null,
        dueType: dueBucket(it.order.orderDate, due, today),
        customerId: it.order.customerId,
        customerName: it.order.customerName,
        agentName: it.order.agentName,
        category: it.order.category,
        pCategory: it.pCategory,
        subCategory: it.subCategory,
        product: it.product,
        productName: it.productName,
        designType: dispatchDesign(it),
        psize: it.psize,
        priority: it.priority,
        calField: it.calField,
        ordType: it.ordType,
        productRate: it.productRate,
        designRate: it.designRate,
        rate: it.rate,
        comment: it.comment,
        bags: it.bags ?? 0,
        pcs: it.pcs ?? 0,
        kgs: it.gram ?? 0,
        box: it.box ?? 0,
        remBags,
        remPcs,
        remKgs,
        remBox,
      });
    }
    // URGENT lines first, then NORMAL; within each, worst due-severity first
    // (Over Due, then Past Due, then Due) — the shop floor should see what
    // needs attention soonest at the top of both groups. Ties keep the
    // fetch order (ORD# ascending) so the list stays stable page to page.
    const priorityRank = (p: string | null) => (p === 'URGENT' ? 0 : 1);
    const dueRank: Record<string, number> = { 'Over Due': 0, 'Past Due': 1, Due: 2 };
    lines.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (dueRank[a.dueType] ?? 2) - (dueRank[b.dueType] ?? 2));
    this.pendingCache = { at: Date.now(), lines };
    return lines;
  }

  /** Distinct customer / agent / product / design values present in the *pending*
   *  pool, used to populate the Dispatch Order page's filter dropdowns. Cascading:
   *  each field's option list reflects the OTHER active filters (but not itself),
   *  so a dropdown only ever offers values that would actually return rows. */
  async pendingFilterOptions(query: PendingQueryDto = {} as PendingQueryDto): Promise<DispatchFilterOptions> {
    const all = await this.computePendingLines();
    // Options for one field = the pool filtered by every OTHER active filter.
    const poolFor = (exclude: keyof PendingQueryDto) => this.applyPendingFilters(all, { ...query, [exclude]: undefined } as PendingQueryDto);
    const distinct = (lines: PendingLineDto[], pick: (l: PendingLineDto) => string | null | undefined) => {
      const s = new Set<string>();
      for (const l of lines) { const v = pick(l); if (v) s.add(v); }
      return [...s].sort((a, b) => a.localeCompare(b));
    };
    const productPool = poolFor('product');
    return {
      customers: distinct(poolFor('customer'), (l) => l.customerName),
      agents: distinct(poolFor('agent'), (l) => l.agentName),
      products: distinct(productPool, (l) => l.productName || l.product),
      productBases: distinct(productPool, (l) => baseProductName(l.productName || l.product, l.product)),
      designs: distinct(poolFor('design'), (l) => (l.designType && l.designType.toUpperCase() !== 'NA' ? l.designType : null)),
      categories: distinct(poolFor('category'), (l) => l.pCategory),
      subCategories: distinct(poolFor('subCategory'), (l) => l.subCategory),
    };
  }

  /** Apply the Dispatch Order page's search + dropdown filters to the pending pool. */
  private applyPendingFilters(lines: PendingLineDto[], query: PendingQueryDto): PendingLineDto[] {
    const search = query.search?.trim().toLowerCase();
    if (search) {
      lines = lines.filter((l) =>
        [l.customerName, l.productName, l.orderCode, l.agentName].some((v) => (v ?? '').toLowerCase().includes(search)),
      );
    }
    if (query.dueType) lines = lines.filter((l) => l.dueType === query.dueType);
    if (query.customer) lines = lines.filter((l) => l.customerName === query.customer);
    if (query.agent) lines = lines.filter((l) => l.agentName === query.agent);
    if (query.product) {
      // "ALL" on → the picker listed every design variant (full names), so match
      // the exact item picked. Off (default) → it listed base names, so a pick
      // also brings in that base's design variants. See matchesProductName.
      const target = query.product;
      lines = lines.filter((l) => matchesProductName(l.productName || l.product, target, !query.all));
    }
    if (query.design) lines = lines.filter((l) => l.designType === query.design);
    // Product category, not the order-level `category` — the Dispatch Order page
    // filters the product pool (GLASS / CUP / LOTI / …), which is `pCategory`.
    if (query.category) lines = lines.filter((l) => l.pCategory === query.category);
    if (query.subCategory) lines = lines.filter((l) => l.subCategory === query.subCategory);
    if (query.unit) {
      const u = query.unit.toUpperCase();
      lines = lines.filter((l) =>
        u === 'BAGS' ? l.remBags > 0 : u === 'PCS' ? l.remPcs > 0 : u === 'KGS' ? l.remKgs > 0 : u === 'BOX' ? l.remBox > 0 : true,
      );
    }
    return lines;
  }

  async pending(query: PendingQueryDto): Promise<Paginated<PendingLineDto>> {
    const lines = this.applyPendingFilters(await this.computePendingLines(), query);
    const total = lines.length;
    const page = lines.slice(query.skip, query.skip + query.pageSize);
    const pendingIds = await this.pendingApprovalOrderItemIds();
    const locks = this.activeLockNames();
    // One grouped count for the whole PAGE, not a query per row: the mobile
    // cards each want to show "this line has N photos" and fetching that per
    // card meant 25+ parallel requests on every scroll.
    const photoCounts = new Map<number, number>();
    const pageItemIds = page.map((l) => l.orderItemId);
    if (pageItemIds.length) {
      const grouped = await this.prisma.orderItemPhoto.groupBy({
        by: ['orderItemId'],
        where: { orderItemId: { in: pageItemIds } },
        _count: { id: true },
      });
      for (const g of grouped) photoCounts.set(g.orderItemId, g._count.id);
    }
    /*
     * Which of these lines are already billed, and on what.
     *
     * A line can be part-dispatched and part-billed and still be pending, and
     * its photos are then locked: OrdersService.deletePhoto refuses to remove
     * them. Resolved for the whole page in two queries, the same way the photo
     * counts above avoid one request per card. `dispatchId` on a challan item is
     * a plain int with no relation, so the dispatches come first and the challan
     * items are matched against their ids — exactly what deletePhoto does.
     */
    const billedOn = new Map<number, string>();
    if (pageItemIds.length) {
      const disps = await this.prisma.dispatch.findMany({
        where: { orderItemId: { in: pageItemIds } },
        select: { id: true, orderItemId: true },
      });
      if (disps.length) {
        const billed = await this.prisma.challanItem.findMany({
          where: {
            dispatchId: { in: disps.map((d) => d.id) },
            challan: { challanStatus: { not: 'CANCELLED' } },
          },
          select: { dispatchId: true, challan: { select: { code: true } } },
        });
        const itemOf = new Map(disps.map((d) => [d.id, d.orderItemId]));
        for (const b of billed) {
          const itemId = b.dispatchId == null ? undefined : itemOf.get(b.dispatchId);
          if (itemId != null && !billedOn.has(itemId)) billedOn.set(itemId, b.challan?.code ?? '');
        }
      }
    }
    const items = page.map((l) => ({
      ...l,
      ...(pendingIds.has(l.orderItemId) ? { hasPendingApproval: true } : {}),
      lockedByName: locks.get(l.orderItemId) ?? null,
      photoCount: photoCounts.get(l.orderItemId) ?? 0,
      billedChallanCode: billedOn.get(l.orderItemId) ?? null,
    }));
    return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }

  /**
   * The Dispatch Order screen's bulk row-selection action: mark a batch of
   * ticked pending lines URGENT (or back to NORMAL) in one write, instead of
   * opening each line's own edit form to change one field.
   *
   * Only applied to ids that are STILL in the current pending pool. A
   * selection can go stale between the page loading and the click — another
   * user finishes dispatching or cancels a line in the meantime — and writing
   * straight from the client's id list would happily re-priority a line that
   * isn't pending any more (or doesn't exist). `skipped` reports the
   * difference so the screen can say so instead of silently under-counting.
   */
  async bulkSetPendingPriority(orderItemIds: number[], priority: 'URGENT' | 'NORMAL'): Promise<{ updated: number; skipped: number }> {
    const pendingIds = new Set((await this.computePendingLines()).map((l) => l.orderItemId));
    const eligible = orderItemIds.filter((id) => pendingIds.has(id));
    if (!eligible.length) return { updated: 0, skipped: orderItemIds.length };
    const { count } = await this.prisma.orderItem.updateMany({ where: { id: { in: eligible } }, data: { priority } });
    this.invalidatePendingCache();
    return { updated: count, skipped: orderItemIds.length - eligible.length };
  }

  /** Order lines that already have an open back-date approval request awaiting
   *  a decision — so the pending pool can flag them instead of looking untouched
   *  after a non-approver submits and refreshes the page. */
  private async pendingApprovalOrderItemIds(): Promise<Set<number>> {
    const rows = await this.prisma.approvalRequest.findMany({
      where: { type: 'DISPATCH_BACKDATE', status: 'PENDING' },
      select: { payload: true },
    });
    const ids = new Set<number>();
    for (const r of rows) {
      try {
        const payload = JSON.parse(r.payload) as { orderItemId?: number };
        if (typeof payload.orderItemId === 'number') ids.add(payload.orderItemId);
      } catch {
        /* malformed payload — skip */
      }
    }
    return ids;
  }

  /** All pending lines matching the filters (no pagination) — for the Excel export. */
  async pendingExport(query: PendingQueryDto): Promise<PendingLineDto[]> {
    return this.applyPendingFilters(await this.computePendingLines(), query);
  }

  /* ── Dispatch records ───────────────────────────────────────────────────── */

  async findMany(query: DispatchQueryDto): Promise<Paginated<DispatchDto>> {
    const search = query.search?.trim();
    // Build with AND so the dropdown filters and the search box compose (each can
    // contribute its own OR without clobbering the others).
    const and: Prisma.DispatchWhereInput[] = [];
    if (query.status) and.push({ dispatchStatus: uc(query.status)! });
    if (query.customer) and.push({ customerName: query.customer });
    if (query.agent) and.push({ agentName: query.agent });
    // `pCategory` (the PRODUCT's category) rather than the order-level `category`
    // column — same field Dispatch Order filters the pending pool by, so the two
    // pages agree on what "GLASS" means.
    if (query.category) and.push({ pCategory: query.category });
    // Modify Dispatch's item picker lists BASE names (like Dispatch Order), so a
    // pick also brings in that base's design variants. ALL on → exact item only.
    if (query.product) and.push(productNameWhere(query.product, !query.all));
    if (query.design) {
      and.push({ OR: [{ orderItem: { design: query.design } }, { designType: query.design }] });
    }
    if (query.dateFrom) and.push({ dispatchDate: { gte: new Date(query.dateFrom) } });
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setHours(23, 59, 59, 999);
      and.push({ dispatchDate: { lte: end } });
    }
    if (search) {
      and.push({
        OR: [
          { customerName: { contains: search } },
          { code: { contains: search } },
          { productName: { contains: search } },
          { orderCode: { contains: search } },
          { designType: { contains: search } },
          { orderItem: { design: { contains: search } } },
          { comment: { contains: search } },
        ],
      });
    }
    const where: Prisma.DispatchWhereInput = and.length ? { AND: and } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.dispatch.findMany({
        where,
        include: { orderItem: { select: { design: true, designType: true, productName: true } } },
        orderBy: [{ dispatchDate: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.dispatch.count({ where }),
    ]);
    const challans = await this.challanByDispatch(rows.map((r) => r.id));
    const refs = await this.returnRefs(rows.map((r) => r.id));
    return {
      items: rows.map((r) => this.toDto(r, challans.get(r.id), refs)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /**
   * Return history for a page of dispatch rows, both directions in one pass:
   *  - a RETURNED row → the credit note that created it and what it reverses;
   *  - an outward row → every return since made against it.
   *
   * Read from `credit_note_items`, which is where the link lives: `dispatchId`
   * is the outward dispatch and `returnDispatchId` the reversal it produced.
   */
  private async returnRefs(ids: number[]): Promise<{
    byReturnRow: Map<number, DispatchReturnRef>;
    byOutward: Map<number, DispatchReturnRef[]>;
  }> {
    const byReturnRow = new Map<number, DispatchReturnRef>();
    const byOutward = new Map<number, DispatchReturnRef[]>();
    if (!ids.length) return { byReturnRow, byOutward };
    const links = await this.prisma.creditNoteItem.findMany({
      where: { OR: [{ returnDispatchId: { in: ids } }, { dispatchId: { in: ids }, returnDispatchId: { not: null } }] },
      select: {
        dispatchId: true,
        returnDispatchId: true,
        bags: true,
        pcs: true,
        kgs: true,
        box: true,
        creditNote: { select: { code: true, invDate: true } },
      },
    });
    for (const l of links) {
      if (l.returnDispatchId == null) continue;
      const ref: DispatchReturnRef = {
        returnDispatchId: l.returnDispatchId,
        dispatchId: l.dispatchId,
        creditNoteCode: l.creditNote.code,
        creditNoteDate: l.creditNote.invDate.toISOString(),
        bags: l.bags,
        pcs: l.pcs,
        kgs: l.kgs,
        box: l.box,
      };
      byReturnRow.set(l.returnDispatchId, ref);
      if (l.dispatchId != null) byOutward.set(l.dispatchId, [...(byOutward.get(l.dispatchId) ?? []), ref]);
    }
    return { byReturnRow, byOutward };
  }

  /** Distinct customer / product / design values present in dispatch records,
   *  used to populate the Modify Dispatch dropdown filters. */
  async filterOptions(query: DispatchQueryDto = {} as DispatchQueryDto): Promise<DispatchFilterOptions> {
    const rows = await this.prisma.dispatch.findMany({
      select: {
        customerName: true,
        agentName: true,
        productName: true,
        product: true,
        pCategory: true,
        designType: true,
        dispatchStatus: true,
        orderItem: { select: { design: true, designType: true, productName: true } },
      },
    });
    type Row = (typeof rows)[number];
    const designNameOf = (row: Row) => dispatchDesign(row.orderItem) ?? dispatchDesign(row);
    // Cascading: each field's options reflect the OTHER active filters (not itself),
    // so a dropdown only offers values that would actually return rows.
    const apply = (list: Row[], q: DispatchQueryDto) => {
      let out = list;
      if (q.status) out = out.filter((r) => r.dispatchStatus === q.status);
      if (q.customer) out = out.filter((r) => r.customerName === q.customer);
      if (q.agent) out = out.filter((r) => r.agentName === q.agent);
      if (q.category) out = out.filter((r) => r.pCategory === q.category);
      if (q.product) out = out.filter((r) => matchesProductName(r.productName || r.product, q.product!, !q.all));
      if (q.design) out = out.filter((r) => designNameOf(r) === q.design);
      return out;
    };
    const poolFor = (exclude: keyof DispatchQueryDto) => apply(rows, { ...query, [exclude]: undefined } as DispatchQueryDto);
    const distinct = (list: Row[], pick: (r: Row) => string | null | undefined) => {
      const s = new Set<string>();
      for (const r of list) { const v = pick(r); if (v) s.add(v); }
      return [...s].sort((a, b) => a.localeCompare(b));
    };
    const productPool = poolFor('product');
    return {
      customers: distinct(poolFor('customer'), (r) => r.customerName),
      agents: distinct(poolFor('agent'), (r) => r.agentName),
      categories: distinct(poolFor('category'), (r) => r.pCategory),
      products: distinct(productPool, (r) => r.productName || r.product),
      productBases: distinct(productPool, (r) => baseProductName(r.productName || r.product, r.product)),
      designs: distinct(poolFor('design'), designNameOf),
    };
  }

  /**
   * Has this party + item (product + SIZE) + design TYPE + design NAME ever been
   * documented with a photo? Checked before the Dispatch form allows Save. Two rules:
   *  - No design at all → nothing to document; always passes. Only items that
   *    actually carry a design need a reference photo.
   *  - Otherwise, "documented" means either this exact line already has a photo
   *    attached, or an earlier line for the SAME customer + product + psize +
   *    design type + design name that has actually been dispatched does. `psize`
   *    matters because "7 RDX" and "7.5 RDX" are the same product but different
   *    items — e.g. a photo of one says nothing about the other.
   *
   * The design half is matched on BOTH columns together (see {@link designKeyOf}),
   * not on {@link resolveLineDesign}'s single collapsed value. That helper returns
   * the type OR the name, whichever is present, so two lines sharing the type
   * "DL+LOGO" but carrying different design NAMES — "ZEBRA" vs "GUCCI" — resolved
   * identically, and a photo of the zebra one silently satisfied the gucci one.
   * They are visibly different designs, so each needs its own reference photo.
   *
   * "Has a design" still goes through {@link resolveLineDesign}, NOT the raw
   * `designType` column. Reading that column alone silently exempted every
   * imported line, which stores its design in `design` and leaves `designType`
   * as "NA" — so e.g. "5 RAMPATRA DL+LOGO" dispatched with no photo at all.
   */
  async photoCheck(orderItemId: number): Promise<DispatchPhotoCheckDto> {
    const it = await this.prisma.orderItem.findUnique({
      where: { id: orderItemId },
      select: {
        product: true,
        design: true,
        designType: true,
        psize: true,
        order: { select: { customerId: true } },
        photos: { select: { url: true }, take: 1, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!it) throw new NotFoundException('Order line not found.');

    // Logo-only designs are exempt — see lineNeedsReferencePhoto. There is
    // nothing to document on a piece whose only "design" is the party's own
    // logo stamped on it, so asking for a photo was pure friction.
    if (!lineNeedsReferencePhoto(it)) {
      return { hasPhoto: true, fromHistory: false, sampleUrl: null, needsPhoto: false };
    }
    if (it.photos.length) {
      return { hasPhoto: true, fromHistory: false, sampleUrl: it.photos[0].url, needsPhoto: true };
    }
    if (!it.order.customerId) return { hasPhoto: false, fromHistory: false, sampleUrl: null, needsPhoto: true };

    // Candidates share the customer + product + size; the design is matched in
    // JS afterwards because it can live in either column. Filtering on the raw
    // `designType` here instead would match every imported line against every
    // other (they all read "NA"), and a DL+LOGO photo would wrongly satisfy a
    // CARVING line on the same product.
    const candidates = await this.prisma.orderItemPhoto.findMany({
      where: {
        orderItem: {
          id: { not: orderItemId },
          product: it.product,
          psize: it.psize,
          order: { customerId: it.order.customerId },
          dispatches: { some: {} },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { url: true, orderItem: { select: { design: true, designType: true } } },
    });
    const wanted = this.designKeyOf(it);
    const historic = candidates.find((p) => this.designKeyOf(p.orderItem) === wanted);
    return historic
      ? { hasPhoto: true, fromHistory: true, sampleUrl: historic.url, needsPhoto: true }
      : { hasPhoto: false, fromHistory: false, sampleUrl: null, needsPhoto: true };
  }

  /**
   * {@link photoCheck} for lines that don't exist yet — the New Order form's
   * "Create & Dispatch", which creates and ships in one go and so has to answer
   * the photo question BEFORE anything is written.
   *
   * Same rules, same design matching; the only difference is that the lines
   * arrive as values rather than rows, and there is no "this line's own photos"
   * step (a draft line's photos are still on the client). Answered in one round
   * trip: the candidate pool is fetched once for every distinct product+size on
   * the form instead of once per line.
   */
  async photoCheckDraft(input: DraftPhotoCheckInput): Promise<DraftPhotoCheckResult> {
    const out: DraftPhotoCheckResult = {};
    const NO_DESIGN = { hasPhoto: true, fromHistory: false, sampleUrl: null, needsPhoto: false } as const;
    const MISSING = { hasPhoto: false, fromHistory: false, sampleUrl: null, needsPhoto: true } as const;

    // Only designed lines fall under the rule at all.
    const designed = input.lines.filter((l) => {
      if (!lineNeedsReferencePhoto(l)) {
        out[l.key] = { ...NO_DESIGN };
        return false;
      }
      return true;
    });
    if (!designed.length) return out;
    if (input.customerId == null) {
      for (const l of designed) out[l.key] = { ...MISSING };
      return out;
    }

    // One query for the whole form. `product`/`psize` narrow it in SQL; the
    // design is matched in JS below for the reason photoCheck explains — it can
    // live in either column, so filtering on designType here would match every
    // imported line ("NA") against every other.
    // psize is only constrained when the caller actually knows it. The order
    // form derives it from the item name's leading number and can legitimately
    // come up empty; pinning the query to psize = NULL in that case would hide
    // every historic photo instead of matching more loosely, which is the wrong
    // way to be wrong — it would wave through a line that IS documented.
    const candidates = await this.prisma.orderItemPhoto.findMany({
      where: {
        orderItem: {
          OR: designed.map((l) => ({ product: l.product, ...(l.psize != null ? { psize: l.psize } : {}) })),
          order: { customerId: input.customerId },
          dispatches: { some: {} },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        url: true,
        orderItem: { select: { product: true, psize: true, design: true, designType: true } },
      },
    });

    for (const l of designed) {
      const wanted = this.designKeyOf(l);
      const hit = candidates.find(
        (p) =>
          p.orderItem.product === l.product &&
          (l.psize == null || p.orderItem.psize === l.psize) &&
          this.designKeyOf(p.orderItem) === wanted,
      );
      out[l.key] = hit
        ? { hasPhoto: true, fromHistory: true, sampleUrl: hit.url, needsPhoto: true }
        : { ...MISSING };
    }
    return out;
  }

  /**
   * A line's design identity for photo-matching: design TYPE and design NAME
   * together, so a photo only counts for a line carrying the same both.
   *
   * Each half is normalised independently and a placeholder ("NA", "N/A",
   * "NONE", "-", …) collapses to empty, so a row that genuinely has no name only
   * ever matches another row that equally has none — rather than matching
   * everything, which is what folding the two columns into one value did.
   */
  private designKeyOf(row: { design?: string | null; designType?: string | null }): string {
    const part = (v: string | null | undefined) => {
      const t = (v ?? '').trim().toUpperCase();
      return isRealDesign(t) ? t : '';
    };
    return `${part(row.designType)}|${part(row.design)}`;
  }

  /** Server-side twin of {@link photoCheck} — a hard, unconditional block (no
   *  override permission) so the rule holds even against a direct API call,
   *  not just the Dispatch form's own gating. The "dispatch entire order"
   *  shortcut enforces the same rule inline (see {@link dispatchOrderFully}),
   *  batching its checks so it can name every undocumented item at once. */
  private async assertPhotoDocumented(orderItemId: number): Promise<void> {
    const status = await this.photoCheck(orderItemId);
    if (!status.hasPhoto) {
      throw new BadRequestException(
        'This item + design has never been documented with a reference photo for this party. Attach a photo before dispatching.',
      );
    }
  }

  async findOne(id: number): Promise<DispatchDto> {
    const row = await this.prisma.dispatch.findUnique({
      where: { id },
      include: { orderItem: { select: { design: true, designType: true, productName: true } } },
    });
    if (!row) throw new NotFoundException('Dispatch not found.');
    return this.toDto(row, (await this.challanByDispatch([row.id])).get(row.id));
  }

  /**
   * The entry point the Dispatch form calls.
   *
   * A dispatch dated today is created immediately. A dispatch dated anything else
   * is a back-entry: allowed straight through for a user with `dispatch:approve`,
   * otherwise parked in the approvals inbox and NOT created — so it stays out of
   * Pending Challan, order fulfilment maths and stock until an admin signs it off.
   */
  async submit(
    dto: CreateDispatchDto,
    user: { id?: string | null; name?: string | null; canApprove: boolean; canOverrideThreshold: boolean },
  ): Promise<SubmitDispatchResult> {
    if (!user.canOverrideThreshold) await this.assertBagThreshold(dto.orderItemId, toNum(dto.bags) ?? 0);
    await this.assertPhotoDocumented(dto.orderItemId);

    if (this.isToday(dto.dispatchDate) || user.canApprove) {
      return { status: 'CREATED', dispatch: await this.create(dto, user.name ?? undefined, user) };
    }

    // Validate the line BEFORE parking the request, so an impossible dispatch is
    // rejected now rather than after an admin has already approved it.
    const it = await this.prisma.orderItem.findUnique({
      where: { id: dto.orderItemId },
      include: { order: true, dispatches: true },
    });
    if (!it) throw new NotFoundException('Order line not found.');
    if (it.order.status === 'CANCELLED' || isUncommittedOrder(it.order.status)) {
      throw new BadRequestException('This order is not available for dispatch.');
    }
    if (it.status === 'CANCELLED') {
      throw new BadRequestException('This line has been cancelled and cannot be dispatched.');
    }
    if (it.dispatches.some((d) => d.dispatchStatus === 'FULLY DISPATCH')) {
      throw new BadRequestException('This line has already been fully dispatched.');
    }
    const qty = {
      bags: toNum(dto.bags) ?? 0,
      pcs: toNum(dto.pcs) ?? 0,
      gram: toNum(dto.gram) ?? 0,
      box: toNum(dto.box) ?? 0,
    };
    this.validateQty(qty, this.remaining(it, it.dispatches), dto.dispatchStatus, it.calField);

    const payload: DispatchBackdatePayload & { requestedByName?: string | null } = {
      orderItemId: dto.orderItemId,
      dispatchStatus: dto.dispatchStatus,
      bags: qty.bags,
      pcs: qty.pcs,
      gram: qty.gram,
      box: qty.box,
      comment: dto.comment ?? null,
      supItem: dto.supItem ?? null,
      dispatchDate: dto.dispatchDate!,
      customerName: it.order.customerName,
      orderCode: it.order.code ?? null,
      productName: it.productName ?? it.product ?? null,
      requestedByName: user.name ?? null,
    };

    const req = await this.approvals.request({
      type: 'DISPATCH_BACKDATE',
      title: `Back-dated dispatch — ${it.order.customerName}`,
      summary: `${formatDate(dto.dispatchDate)} · ${payload.productName ?? 'item'} · ${dto.dispatchStatus}${
        payload.orderCode ? ` · order ${payload.orderCode}` : ''
      }`,
      payload: payload as unknown as Record<string, unknown>,
      entity: 'Order',
      entityId: it.orderId,
      requestedById: user.id ?? null,
      requestedByName: user.name ?? null,
    });

    return { status: 'PENDING_APPROVAL', approvalCode: req.code ?? `APR-${req.id}` };
  }

  /**
   * Creates the row unconditionally — the back-date gate lives in {@link submit}.
   * `skipAudit` is set when this runs as an approval replay: ApprovalsService
   * writes its OWN combined "approved — created X" entry in that case, so a
   * plain "created" entry here would just be a confusing duplicate sitting next
   * to it in the dispatch's history.
   */
  async create(
    dto: CreateDispatchDto,
    userName?: string,
    actor?: Actor,
    opts?: { skipAudit?: boolean; skipNotify?: boolean },
  ): Promise<DispatchDto> {
    const bags = toNum(dto.bags) ?? 0;
    const pcs = toNum(dto.pcs) ?? 0;
    const gram = toNum(dto.gram) ?? 0;
    const box = toNum(dto.box) ?? 0;

    // The whole read → validate → insert runs in one transaction. SQLite serializes
    // write transactions, so two concurrent dispatches on the same line can't
    // interleave: the second only reads AFTER the first has committed, so it sees
    // the first's row (both the "already fully dispatched" guard and the duplicate
    // guard below then catch it) instead of silently inserting a copy.
    const { row, drawnFromBookingId } = await this.prisma.$transaction(async (tx) => {
      const it = await tx.orderItem.findUnique({
        where: { id: dto.orderItemId },
        include: { order: true, dispatches: true },
      });
      if (!it) throw new NotFoundException('Order line not found.');
      if (it.order.status === 'CANCELLED' || isUncommittedOrder(it.order.status)) {
        throw new BadRequestException('This order is not available for dispatch.');
      }
      if (it.status === 'CANCELLED') {
        throw new BadRequestException('This line has been cancelled and cannot be dispatched.');
      }
      if (it.dispatches.some((d) => d.dispatchStatus === 'FULLY DISPATCH')) {
        throw new BadRequestException('This line has already been fully dispatched.');
      }

      // Idempotency guard against duplicate submissions (see DISPATCH_DEDUPE_WINDOW_MS):
      // an identical dispatch on this line recorded moments ago is a duplicate, not a
      // second real shipment — return the existing row instead of inserting a copy.
      const effectiveDate = dto.dispatchDate ? new Date(dto.dispatchDate) : new Date();
      const sameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

      const dup = it.dispatches.find(
        (d) =>
          (d.bags ?? 0) === bags &&
          (d.pcs ?? 0) === pcs &&
          (d.gram ?? 0) === gram &&
          (d.box ?? 0) === box &&
          d.dispatchStatus === dto.dispatchStatus &&
          // Must be for the SAME day too. Without this, recording a backdated
          // shipment moments after an identical one for today silently returned
          // today's row and the backdated entry was never created at all.
          sameDay(d.dispatchDate, effectiveDate) &&
          Date.now() - d.createdAt.getTime() < DISPATCH_DEDUPE_WINDOW_MS,
      );

      /*
       * Same line, same quantities, same DAY — refuse it.
       *
       * Past the idempotency window above, a repeat is no longer a double-tap;
       * it is somebody dispatching a shipment that was already recorded, and
       * silently accepting it doubles the quantity that has left the building.
       * The message names the existing row so it can be found and corrected
       * rather than leaving the user to guess what happened.
       *
       * Matched per ORDER LINE, not per order: one order can legitimately carry
       * two different lines of the same quantity going out the same day, and
       * blocking that would refuse real work.
       *
       * Compared on the DISPATCH date, not the clock — a backdated entry is
       * checked against the day it claims, which is the day that matters.
       */
      const already =
        it.dispatches.find(
          (d) =>
            d.dispatchStatus !== RETURNED_DISPATCH_STATUS &&
            (d.bags ?? 0) === bags &&
            (d.pcs ?? 0) === pcs &&
            (d.gram ?? 0) === gram &&
            (d.box ?? 0) === box &&
            sameDay(d.dispatchDate, effectiveDate),
        ) ??
        // …or the just-created twin of a double-tap, which the guard above skips
        // when it is a RETURN. Same refusal either way.
        dup;
      if (already) {
        const what = qtyText({ bags: already.bags, pcs: already.pcs, gram: already.gram, box: already.box }) || 'the same quantity';
        // 409, not 400: nothing about the request is malformed — it collides with
        // something that already exists. The matched row travels with the error so
        // the screen can name it instead of asking the user to go and look.
        throw new ConflictException({
          error: 'DUPLICATE_DISPATCH',
          message: `Already dispatched today — ${already.code ?? `#${already.id}`} recorded ${what}.`,
          duplicateDispatch: {
            id: already.id,
            code: already.code ?? `#${already.id}`,
            customerName: it.order.customerName,
            orderCode: it.order.code ?? this.orderCodeFor(it.orderId),
            productName: it.productName ?? it.product ?? 'this item',
            qtyText: what,
            dispatchedAt: already.dispatchDate.toISOString(),
          },
        });
      }

      const rem = this.remaining(it, it.dispatches);
      this.validateQty({ bags, pcs, gram, box }, rem, dto.dispatchStatus, it.calField);

      const created = await tx.dispatch.create({
        data: {
          orderItemId: it.id,
          orderId: it.orderId,
          orderCode: it.order.code ?? this.orderCodeFor(it.orderId),
          customerId: it.order.customerId,
          customerName: it.order.customerName,
          agentName: it.order.agentName,
          category: it.order.category,
          pCategory: it.pCategory,
          subCategory: it.subCategory,
          product: it.product,
          productName: it.productName,
          designType: dispatchDesign(it),
          psize: it.psize,
          priority: it.priority,
          calField: it.calField,
          ordType: it.ordType,
          productRate: it.productRate,
          designRate: it.designRate,
          rate: it.rate,
          bags,
          pcs,
          gram,
          box,
          dispatchStatus: dto.dispatchStatus,
          dispatchDate: dto.dispatchDate ? new Date(dto.dispatchDate) : new Date(),
          comment: toStr(dto.comment),
          supItem: toStr(dto.supItem),
          userName: userName ?? null,
        },
      });

      /*
       * The extra that went out beyond what this line had pending, withdrawn
       * from a bag booking because the operator said to.
       *
       * `rem` is the pending qty as of BEFORE this dispatch, so the extra is
       * simply what overshoots it. Worked out here rather than taken from the
       * request: how much comes off a booking is not the client's to declare.
       *
       * Inside the transaction on purpose — if the booking cannot cover it, the
       * dispatch does not get recorded either. The alternative (ship it anyway,
       * report the draw failed) leaves exactly the unaccounted bag this is for.
       */
      let drawnFromBookingId: number | null = null;
      if (dto.bookingDrawId != null) {
        const extraBags = round3(Math.max(0, bags - rem.bags));
        const extraKgs = round3(Math.max(0, gram - rem.gram));
        if (extraBags > EPS || extraKgs > EPS) {
          const code = created.code ?? this.codeFor(created.id);
          await this.bookings.drawOverage(
            {
              bookingId: dto.bookingDrawId,
              dispatchId: created.id,
              bags: extraBags,
              kgs: extraKgs,
              pCategory: it.pCategory,
              productName: it.productName,
              designType: dispatchDesign(it),
              at: created.dispatchDate,
              note:
                `Dispatch overage withdrawn — ${code} sent ${qtyText({ bags, gram })} of ` +
                `${it.productName ?? it.product ?? 'this item'}` +
                `${it.order.code ? ` on order ${it.order.code}` : ''} against ` +
                `${qtyText({ bags: rem.bags, gram: rem.gram })} pending, so ` +
                `${qtyText({ bags: extraBags, gram: extraKgs })} came off this booking.`,
              userName: userName ?? actor?.name ?? null,
            },
            tx,
          );
          drawnFromBookingId = dto.bookingDrawId;
        }
      }
      return { row: created, drawnFromBookingId };
    });

    // Roll the booking up now the withdrawal has committed — see drawOverage.
    if (drawnFromBookingId != null) await this.bookings.recompute(drawnFromBookingId);

    const dispatch = await this.ensureCode(row);
    if (!opts?.skipAudit) {
      this.logDispatch({
        dispatchId: dispatch.id,
        action: 'create',
        description: `Dispatched ${qtyText({ bags, pcs, gram, box })} · ${dto.dispatchStatus} · dated ${formatDate(
          dispatch.dispatchDate.toISOString(),
        )}${dispatch.productName ? ` · ${dispatch.productName}` : ''}`,
        actor: actor ?? { name: userName ?? null },
        metadata: { bags, pcs, gram, box, dispatchStatus: dto.dispatchStatus, dispatchDate: dispatch.dispatchDate.toISOString() },
      });
    }
    // Alert AFTER the transaction has committed. Every row reaching here is a
    // real insert now — a repeat is refused above rather than returned as a
    // success. `skipNotify` is the approval replay, which raises its own,
    // differently-worded alert instead.
    if (!opts?.skipNotify) {
      this.notifier.dispatchCreated({
        actorId: actor?.id ?? null,
        userName: userName ?? actor?.name ?? null,
        dispatchId: dispatch.id,
        dispatchCode: dispatch.code ?? this.codeFor(dispatch.id),
        customerName: dispatch.customerName,
        productName: dispatch.productName,
        designType: dispatch.designType,
        orderCode: dispatch.orderCode,
        dispatchStatus: dto.dispatchStatus,
        bags,
        pcs,
        gram,
        box,
      });
    }
    this.invalidatePendingCache(); // a new dispatch changes what's still pending
    return this.toDto(dispatch);
  }

  /**
   * Fully dispatch every still-pending line of an order in one shot — powers the
   * New Order form's "Create & Dispatch" (take the order and ship it all at once).
   * Each eligible line gets a FULLY DISPATCH record for its remaining (= full, on a
   * brand-new order) quantity. Cancelled/draft orders are rejected; cancelled lines,
   * already fully-dispatched lines, and zero-quantity lines are skipped. Runs in one
   * transaction so it's all-or-nothing.
   *
   * The reference-photo rule applies here too. This shortcut used to bypass it
   * entirely, which meant an order full of design items could be shipped with no
   * documentation at all — the very thing the rule exists to prevent. Every line
   * about to be dispatched is checked up front so the error can name what's
   * missing, rather than failing halfway through.
   */
  async dispatchOrderFully(orderId: number, actor?: Actor): Promise<{ dispatched: number; skipped: number }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { dispatches: true } } },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status === 'CANCELLED' || isUncommittedOrder(order.status)) {
      throw new BadRequestException('This order is not available for dispatch.');
    }

    /** Lines this run would actually create a dispatch for. */
    const eligible = order.items.filter((it) => {
      if (it.status === 'CANCELLED' || it.dispatches.some((d) => d.dispatchStatus === 'FULLY DISPATCH')) return false;
      const rem = this.remaining(it, it.dispatches);
      return rem.bags > EPS || rem.pcs > EPS || rem.gram > EPS || rem.box > EPS;
    });

    const undocumented: string[] = [];
    for (const it of eligible) {
      if (!lineNeedsReferencePhoto(it)) continue; // no design, or logo only → nothing to document
      const status = await this.photoCheck(it.id);
      if (!status.hasPhoto) undocumented.push(it.productName || it.product || `line #${it.id}`);
    }
    if (undocumented.length) {
      throw new BadRequestException(
        `These design items have no reference photo on file for this party — attach one before dispatching: ${undocumented.join(', ')}.`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let dispatched = 0;
      let skipped = 0;
      for (const it of order.items) {
        if (it.status === 'CANCELLED' || it.dispatches.some((d) => d.dispatchStatus === 'FULLY DISPATCH')) {
          skipped++;
          continue;
        }
        const rem = this.remaining(it, it.dispatches);
        if (rem.bags <= EPS && rem.pcs <= EPS && rem.gram <= EPS && rem.box <= EPS) {
          skipped++;
          continue;
        }
        const row = await tx.dispatch.create({
          data: {
            orderItemId: it.id,
            orderId: it.orderId,
            orderCode: order.code ?? this.orderCodeFor(it.orderId),
            customerId: order.customerId,
            customerName: order.customerName,
            agentName: order.agentName,
            category: order.category,
            pCategory: it.pCategory,
            subCategory: it.subCategory,
            product: it.product,
            productName: it.productName,
            designType: dispatchDesign(it),
            psize: it.psize,
            priority: it.priority,
            calField: it.calField,
            ordType: it.ordType,
            productRate: it.productRate,
            designRate: it.designRate,
            rate: it.rate,
            bags: rem.bags,
            pcs: rem.pcs,
            gram: rem.gram,
            box: rem.box,
            dispatchStatus: 'FULLY DISPATCH',
            dispatchDate: new Date(),
            userName: actor?.name ?? null,
          },
        });
        await tx.dispatch.update({ where: { id: row.id }, data: { code: this.codeFor(row.id) } });
        dispatched++;
      }
      return { dispatched, skipped };
    });

    if (result.dispatched > 0) {
      this.invalidatePendingCache();
      // ONE alert for the whole order. This shortcut has no approval gate of any
      // kind (see the controller — it needs only dispatch:create), so it is the
      // path where an alert matters most.
      this.notifier.orderFullyDispatched({
        actorId: actor?.id ?? null,
        userName: actor?.name ?? null,
        orderId: order.id,
        orderCode: order.code ?? this.orderCodeFor(order.id),
        customerName: order.customerName,
        itemCount: result.dispatched,
      });
    }
    return result;
  }

  /**
   * Edit a dispatch. Quantities and notes are always the user's own to change; the
   * DATE follows the same rule as the Dispatch form — free for `dispatch:approve`,
   * otherwise parked as an approval. Everything else in the edit still saves
   * immediately, so a pending date change never blocks a quantity correction.
   */
  async updateAsUser(
    id: number,
    dto: UpdateDispatchDto,
    user: { id?: string | null; name?: string | null; canApprove: boolean },
  ): Promise<UpdateDispatchResult> {
    const cur = await this.prisma.dispatch.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Dispatch not found.');

    const wantsDateMove =
      !!dto.dispatchDate && !this.sameDay(dto.dispatchDate, cur.dispatchDate) && !this.isToday(dto.dispatchDate);

    if (!wantsDateMove || user.canApprove) {
      return { dispatch: await this.update(id, dto, user) };
    }

    // Save everything except the date now, and raise an approval for the move.
    const { dispatchDate, ...rest } = dto;
    void dispatchDate;
    const dispatch = await this.update(id, rest, user);
    const payload: DispatchDateChangePayload = {
      dispatchId: id,
      dispatchDate: dto.dispatchDate!,
      currentDate: cur.dispatchDate.toISOString(),
      customerName: cur.customerName,
      dispatchCode: cur.code ?? null,
      productName: cur.productName ?? cur.product ?? null,
      requestedByName: user.name ?? null,
    };
    const req = await this.approvals.request({
      type: 'DISPATCH_DATE_CHANGE',
      title: `Dispatch date change — ${cur.customerName}`,
      summary: `${cur.code ?? `#${id}`} · ${formatDate(cur.dispatchDate.toISOString())} → ${formatDate(dto.dispatchDate)}`,
      payload: payload as unknown as Record<string, unknown>,
      entity: 'Dispatch',
      entityId: id,
      requestedById: user.id ?? null,
      requestedByName: user.name ?? null,
    });
    return { dispatch, dateApprovalCode: req.code ?? `APR-${req.id}` };
  }

  /** Same calendar day in server-local time? */
  private sameDay(iso: string, other: Date): boolean {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return true;
    return d.getFullYear() === other.getFullYear() && d.getMonth() === other.getMonth() && d.getDate() === other.getDate();
  }

  async update(id: number, dto: UpdateDispatchDto, actor?: Actor): Promise<DispatchDto> {
    const cur = await this.prisma.dispatch.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Dispatch not found.');

    // A billed dispatch may still have its status corrected (Partial ↔ Full) and
    // its photos managed — those two operations don't change any invoiced quantity.
    // Everything else (qty, date, remarks) is still guarded by assertNotBilled so the
    // challan and the dispatch always agree on what was shipped.
    const wantsQtyOrDateOrComment =
      dto.bags !== undefined ||
      dto.pcs !== undefined ||
      dto.gram !== undefined ||
      dto.box !== undefined ||
      dto.comment !== undefined ||
      dto.dispatchDate !== undefined;
    if (wantsQtyOrDateOrComment) await this.assertNotBilled(id);

    // For a billed dispatch that sent only a status change, keep all other fields
    // locked to their current values so we never accidentally touch the billed qty.
    const isBilled = await this.isBilledDispatch(id);
    const it = await this.prisma.orderItem.findUnique({ where: { id: cur.orderItemId }, include: { dispatches: true } });
    if (!it) throw new NotFoundException('Order line not found.');

    // Remaining excludes the dispatch being edited (so its own qty can be changed).
    const others = it.dispatches.filter((d) => d.id !== id);
    const rem = this.remaining(it, others);
    const bags = !isBilled && dto.bags !== undefined ? toNum(dto.bags) ?? 0 : cur.bags ?? 0;
    const pcs = !isBilled && dto.pcs !== undefined ? toNum(dto.pcs) ?? 0 : cur.pcs ?? 0;
    const gram = !isBilled && dto.gram !== undefined ? toNum(dto.gram) ?? 0 : cur.gram ?? 0;
    const box = !isBilled && dto.box !== undefined ? toNum(dto.box) ?? 0 : cur.box ?? 0;
    const status = (dto.dispatchStatus ?? cur.dispatchStatus) as DispatchStatus;
    this.validateQty({ bags, pcs, gram, box }, rem, status, it.calField);

    const row = await this.prisma.dispatch.update({
      where: { id },
      data: {
        bags,
        pcs,
        gram,
        box,
        dispatchStatus: status,
        ...(!isBilled && dto.comment !== undefined ? { comment: toStr(dto.comment) } : {}),
        ...(!isBilled && dto.supItem !== undefined ? { supItem: toStr(dto.supItem) } : {}),
        ...(!isBilled && dto.dispatchDate ? { dispatchDate: new Date(dto.dispatchDate) } : {}),
      },
    });

    // Keep any booking withdrawal in step with the edited quantity — a dispatch
    // corrected from 2 bags back to 1 must hand the borrowed bag back. No-ops
    // unless this dispatch already had a withdrawal (see resyncOverageDraw).
    await this.bookings.resyncOverageDraw(id, {
      bags: round3(Math.max(0, bags - rem.bags)),
      kgs: round3(Math.max(0, gram - rem.gram)),
      at: row.dispatchDate,
      userName: actor?.name ?? null,
    });

    // Spell out WHAT actually changed, field by field, so the history answers
    // "what was edited" instead of just "edited".
    const changes: string[] = [];
    const qtyBefore = { bags: cur.bags, pcs: cur.pcs, gram: cur.gram, box: cur.box };
    const qtyAfter = { bags, pcs, gram, box };
    if (
      (cur.bags ?? 0) !== bags ||
      (cur.pcs ?? 0) !== pcs ||
      (cur.gram ?? 0) !== gram ||
      (cur.box ?? 0) !== box
    ) {
      changes.push(`qty ${qtyText(qtyBefore)} → ${qtyText(qtyAfter)}`);
    }
    if (cur.dispatchStatus !== status) changes.push(`status ${cur.dispatchStatus} → ${status}`);
    if (!this.sameDay(row.dispatchDate.toISOString(), cur.dispatchDate)) {
      changes.push(
        `date ${formatDate(cur.dispatchDate.toISOString())} → ${formatDate(row.dispatchDate.toISOString())}`,
      );
    }
    if (dto.comment !== undefined && (cur.comment ?? '') !== (toStr(dto.comment) ?? '')) {
      changes.push(`remark "${cur.comment ?? ''}" → "${toStr(dto.comment) ?? ''}"`);
    }
    if (changes.length) {
      this.logDispatch({
        dispatchId: id,
        action: 'update',
        description: `Edited: ${changes.join('; ')}`,
        actor,
        metadata: { before: { ...qtyBefore, dispatchStatus: cur.dispatchStatus, dispatchDate: cur.dispatchDate.toISOString() }, after: { ...qtyAfter, dispatchStatus: status, dispatchDate: row.dispatchDate.toISOString() } },
      });
      this.notifier.dispatchUpdated({
        actorId: actor?.id ?? null,
        userName: actor?.name ?? null,
        dispatchId: id,
        dispatchCode: cur.code ?? this.codeFor(id),
        customerName: cur.customerName,
        // The very same text the dispatch's Activity History shows.
        changes: changes.join('; '),
      });
    }
    this.invalidatePendingCache(); // edited quantities change remaining-to-dispatch
    return this.toDto(row);
  }

  /** Returns true when this dispatch is billed on a non-cancelled challan. */
  private async isBilledDispatch(id: number): Promise<boolean> {
    const billed = await this.prisma.challanItem.findFirst({
      where: { dispatchId: id, challan: { challanStatus: { not: 'CANCELLED' } } },
      select: { id: true },
    });
    return !!billed;
  }

  async remove(id: number, actor?: Actor): Promise<void> {
    // Read the row before deleting it: the alert has to name the party, item and
    // quantities that are about to stop existing.
    const row = await this.prisma.dispatch.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Dispatch not found.');
    await this.assertNotBilled(id);
    await this.prisma.dispatch.delete({ where: { id } });
    // Whatever this dispatch withdrew from a bag booking goes back: the shipment
    // it paid for no longer exists, and leaving the bag drawn would quietly eat
    // a booking the party still holds.
    await this.bookings.releaseOverageDraw(id, 'DISPATCH_DELETED', actor?.name ?? null);
    this.invalidatePendingCache(); // a deleted dispatch puts its qty back in the pool
    this.notifier.dispatchDeleted({
      actorId: actor?.id ?? null,
      userName: actor?.name ?? null,
      dispatchCode: row.code ?? this.codeFor(id),
      customerName: row.customerName,
      productName: row.productName,
      bags: row.bags,
      pcs: row.pcs,
      gram: row.gram,
      box: row.box,
    });
  }

  /** Blocks edit/delete once a dispatch has been billed onto a live challan — the
   *  challan already carries this line's qty as an invoiced fact, so changing or
   *  removing the dispatch underneath it would silently desync the two. A
   *  CANCELLED challan doesn't count: cancelling puts the dispatch back in the
   *  pending pool, exactly like {@link challanByDispatch} treats it elsewhere. */
  private async assertNotBilled(id: number): Promise<void> {
    const billed = await this.prisma.challanItem.findFirst({
      where: { dispatchId: id, challan: { challanStatus: { not: 'CANCELLED' } } },
      select: { challan: { select: { code: true } } },
    });
    if (billed) {
      throw new BadRequestException(
        `This dispatch is already billed on challan ${billed.challan?.code ?? ''} and can no longer be edited or deleted.`,
      );
    }
  }

  /**
   * Hard-blocks a single dispatch line's Bags from exceeding a configured
   * threshold — the party's own (Special Rates → Bag weight, per customer +
   * category) if set, else the global default (Settings), else no limit.
   * Skipped entirely for a user with dispatch:override.
   */
  private async assertBagThreshold(orderItemId: number, bags: number): Promise<void> {
    if (!(bags > 0)) return; // nothing to check on a Kgs/Pcs-only line
    const it = await this.prisma.orderItem.findUnique({
      where: { id: orderItemId },
      select: { pCategory: true, order: { select: { customerId: true, customerName: true } } },
    });
    if (!it?.order.customerId) return; // no customer to key a party threshold on

    const category = (it.pCategory ?? '').trim().toUpperCase();
    let threshold: number | null = null;
    if (category) {
      const rows = await this.prisma.customerBagWeight.findMany({
        where: { customerId: it.order.customerId },
        select: { category: true, maxBagsPerDispatch: true },
      });
      threshold = rows.find((r) => r.category.trim().toUpperCase() === category)?.maxBagsPerDispatch ?? null;
    }
    if (threshold == null) {
      const def = await this.prisma.appConfig.findUnique({ where: { key: 'DISPATCH_BAG_THRESHOLD' } });
      const parsed = def?.value != null ? Number(def.value) : NaN;
      threshold = Number.isFinite(parsed) ? parsed : null;
    }
    if (threshold != null && bags > threshold + EPS) {
      throw new BadRequestException(
        `${bags} bags exceeds the dispatch threshold of ${threshold} for ${it.order.customerName} — lower the quantity or ask an admin to override.`,
      );
    }
  }

  /* ── helpers ─────────────────────────────────────────────────────────────── */

  private remaining(
    line: { bags: number | null; pcs: number | null; gram: number | null; box: number | null },
    dispatches: { bags: number | null; pcs: number | null; gram: number | null; box: number | null }[],
  ) {
    const sum = dispatches.reduce(
      (a: { bags: number; pcs: number; gram: number; box: number }, d) => ({
        bags: a.bags + (d.bags ?? 0),
        pcs: a.pcs + (d.pcs ?? 0),
        gram: a.gram + (d.gram ?? 0),
        box: a.box + (d.box ?? 0),
      }),
      { bags: 0, pcs: 0, gram: 0, box: 0 },
    );
    return {
      bags: round3(Math.max(0, (line.bags ?? 0) - sum.bags)),
      pcs: round3(Math.max(0, (line.pcs ?? 0) - sum.pcs)),
      gram: round3(Math.max(0, (line.gram ?? 0) - sum.gram)),
      box: round3(Math.max(0, (line.box ?? 0) - sum.box)),
    };
  }

  private validateQty(
    q: { bags: number; pcs: number; gram: number; box: number },
    rem: { bags: number; pcs: number; gram: number; box: number },
    status: string,
    calField?: string | null,
  ) {
    // No quantity may be negative — a negative on a non-mandatory unit would
    // otherwise slip past the mandatory + upper-bound checks and corrupt totals.
    if (q.bags < -EPS || q.pcs < -EPS || q.gram < -EPS || q.box < -EPS) {
      throw new BadRequestException('Dispatch quantities cannot be negative.');
    }
    // The priced quantity is mandatory: PCS-priced lines need Pcs, KGS-priced
    // lines need Kgs (mirrors the legacy "PC/KG is Mandatory" checks).
    const cf = (calField ?? '').toUpperCase();
    if (cf === 'PCS') {
      if (q.pcs <= EPS) throw new BadRequestException('Pcs is required — this item is priced by PCS.');
    } else if (cf === 'KGS') {
      if (q.gram <= EPS) throw new BadRequestException('Kgs is required to dispatch this item.');
    } else if (q.bags <= EPS && q.pcs <= EPS && q.gram <= EPS && q.box <= EPS) {
      throw new BadRequestException('Enter at least one quantity to dispatch.');
    }
    // Dispatching more than what's left on the line is allowed (real-world
    // packing/weighing variance means the shipped qty doesn't always match the
    // order exactly) — the web app gates it behind an explicit confirmation
    // before it ever reaches here; this endpoint itself no longer blocks it.
    const consumesAll =
      rem.bags - q.bags <= EPS && rem.pcs - q.pcs <= EPS && rem.gram - q.gram <= EPS && rem.box - q.box <= EPS;
    if (consumesAll && status !== 'FULLY DISPATCH') {
      throw new BadRequestException('This dispatches everything remaining — mark it as Fully Dispatched.');
    }
  }

  private orderCodeFor(id: number): string {
    return `ORD-${id}`;
  }
  private codeFor(id: number): string {
    return `DSP-${String(id).padStart(5, '0')}`;
  }

  private async ensureCode(row: Dispatch): Promise<Dispatch> {
    if (row.code) return row;
    return this.prisma.dispatch.update({ where: { id: row.id }, data: { code: this.codeFor(row.id) } });
  }

  /**
   * Which challan each of these dispatches has been billed on.
   *
   * `ChallanItem.dispatchId` is a plain int with no relation (see schema), so this
   * is one keyed lookup per page rather than a join. A dispatch can appear on more
   * than one challan — the original invoice plus a later debit note against the
   * same shipment — so the lowest challan id wins, which is the invoice. Cancelled
   * challans are ignored: they no longer bill anything, and the dispatch is back in
   * the pending pool (same rule as the Pending Challan query).
   */
  private async challanByDispatch(
    dispatchIds: number[],
  ): Promise<Map<number, { id: number; code: string; challanStatus: string | null }>> {
    const out = new Map<number, { id: number; code: string; challanStatus: string | null }>();
    if (!dispatchIds.length) return out;
    const rows = await this.prisma.challanItem.findMany({
      where: { dispatchId: { in: dispatchIds }, challan: { challanStatus: { not: 'CANCELLED' } } },
      select: { dispatchId: true, challan: { select: { id: true, code: true, challanStatus: true } } },
      orderBy: { challanId: 'asc' },
    });
    for (const r of rows) {
      if (r.dispatchId == null || !r.challan) continue;
      if (!out.has(r.dispatchId)) out.set(r.dispatchId, r.challan); // asc order => invoice before debit note
    }
    return out;
  }

  private toDto(
    r: Dispatch & { orderItem?: { design: string | null; designType: string | null; productName: string | null } },
    challan?: { id: number; code: string; challanStatus: string | null } | null,
    refs?: { byReturnRow: Map<number, DispatchReturnRef>; byOutward: Map<number, DispatchReturnRef[]> },
  ): DispatchDto {
    return {
      id: r.id,
      code: r.code ?? this.codeFor(r.id),
      orderItemId: r.orderItemId,
      orderId: r.orderId,
      orderCode: r.orderCode,
      customerId: r.customerId,
      customerName: r.customerName,
      agentName: r.agentName,
      category: r.category,
      pCategory: r.pCategory,
      subCategory: r.subCategory,
      product: r.product,
      productName: r.productName,
      designType: dispatchDesign(r.orderItem ?? r),
      psize: r.psize,
      priority: r.priority,
      calField: r.calField,
      ordType: r.ordType,
      productRate: r.productRate,
      designRate: r.designRate,
      rate: r.rate,
      bags: r.bags,
      pcs: r.pcs,
      gram: r.gram,
      box: r.box,
      dispatchStatus: r.dispatchStatus as DispatchStatus,
      dispatchDate: r.dispatchDate.toISOString(),
      comment: r.comment,
      supItem: r.supItem,
      userName: r.userName,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      challanId: challan?.id ?? null,
      challanCode: challan?.code ?? null,
      challanStatus: challan?.challanStatus ?? null,
      ...(refs
        ? {
            returnOf: refs.byReturnRow.get(r.id) ?? null,
            returns: refs.byOutward.get(r.id) ?? [],
          }
        : {}),
    };
  }
}
