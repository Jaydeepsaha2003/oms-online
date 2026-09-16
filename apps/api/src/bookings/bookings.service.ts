import { serializeBookingDraw } from './booking-draw-lock';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  type BookingConversionDto,
  type BookingDispatchOptions,
  type BookingDrawOptionDto,
  type BookingDto,
  type BookingItemDto,
  type BookingQuoteLine,
  type BookingQuoteResult,
  type BookingRateDto,
  type BookingStatus,
  type CustomerLogoDto,
  type CustomerRateDto,
  type BookingLinkedOrderDto,
  type LinkableOrderItemDto,
  DRAWABLE_BOOKING_STATUSES as DRAWABLE_STATUSES,
  ORDER_UNCOMMITTED_STATUSES,
  type Paginated,
  RETURNED_DISPATCH_STATUS,
  type PriceHistoryList,
  type RateChangeEntry,
  type RateHistoryKind,
  resolveSpecialRates,
  withinBooked,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { toNum, toStr, uc } from '../common/coerce';
import {
  BookingQueryDto,
  CreateBookingRateDto,
  ConvertBookingDto,
  ConvertBookingLineDto,
  CreateBookingDto,
  CreateBookingItemDto,
  LinkableItemsQueryDto,
  LinkBookingItemsDto,
  PrecloseBookingDto,
  PriceHistoryQueryDto,
  UpdateBookingDto,
} from './dto/booking.dto';

const INCLUDE = {
  conversions: { orderBy: { convertedAt: 'asc' } },
  items: { orderBy: { id: 'asc' } },
  rates: { orderBy: { id: 'asc' } },
} as const;
type Row = Prisma.BookingGetPayload<{ include: typeof INCLUDE }>;

/** `CATEGORY|SUBCATEGORY` → the rate settled for that size class on a booking. */
type AgreedRates = Map<string, number>;

/** {@link BookingConversion.kind} — see the schema for what separates the two. */
const ORDER_LINE_KIND = 'ORDER_LINE';
const OVERAGE_KIND = 'DISPATCH_OVERAGE';
/** Statuses a booking can still be drawn from. CONVERTED is full, and
 *  CANCELLED/PRECLOSED are closed for good. */
/** Float slack — bags/kgs are Floats, so an exact `>=` on a difference lies. */
const EPS = 0.0001;

/** The customer special-rate rows snapshotted onto a booking at creation. */
interface RateSnapshot {
  rates: CustomerRateDto[];
  logos: CustomerLogoDto[];
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

  /* ── List / read ─────────────────────────────────────────────────────────── */

  async findMany(query: BookingQueryDto): Promise<Paginated<BookingDto>> {
    const search = query.search?.trim();
    const where: Prisma.BookingWhereInput = {
      ...(query.status ? { status: query.status.toUpperCase() } : {}),
      ...(query.customer ? { customerName: query.customer } : {}),
      ...(search
        ? { OR: [{ customerName: { contains: search } }, { code: { contains: search } }, { agentName: { contains: search } }] }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({ where, include: INCLUDE, orderBy: [{ bookingDate: 'desc' }, { id: 'desc' }], skip: query.skip, take: query.pageSize }),
      this.prisma.booking.count({ where }),
    ]);
    const linkedOrders = await this.linkedOrderMap(rows);
    return {
      items: rows.map((r) => this.toDto(r, linkedOrders)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOne(id: number): Promise<BookingDto> {
    const row = await this.prisma.booking.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundException('Booking not found.');
    const linkedOrders = await this.linkedOrderMap([row]);
    return this.toDto(row, linkedOrders);
  }

  /* ── Create / update ─────────────────────────────────────────────────────── */

  async create(dto: CreateBookingDto, userName?: string | null): Promise<BookingDto> {
    const customerName = (uc(dto.customerName) ?? '') as string;
    if (!customerName) throw new BadRequestException('Customer is required.');
    const customer = await this.prisma.customer.findFirst({ where: { partyName: customerName } });

    const bookingDate = dto.bookingDate ? new Date(dto.bookingDate) : new Date();
    if (Number.isNaN(bookingDate.getTime())) throw new BadRequestException('Invalid booking date.');

    const items = this.normalizeItems(dto.items);
    const bags = round2(items.reduce((s, it) => s + it.bags, 0));
    const kgs = round2(items.reduce((s, it) => s + it.kgs, 0));

    // Snapshot the customer's special-rate rows so the exact cascade can be
    // reproduced at conversion, even if the overrides change afterwards.
    const snapshot = customer ? await this.snapshotSpecialRates(customer.id) : { rates: [], logos: [] };

    const row = await this.prisma.booking.create({
      data: {
        customerId: customer?.id ?? null,
        customerName,
        agentName: uc(dto.agentName) ?? customer?.agentName ?? null,
        category: uc(dto.category) ?? customer?.category ?? 'SALES',
        bookingDate,
        bags,
        kgs,
        status: 'OPEN',
        comment: toStr(dto.comment),
        rateSnapshot: JSON.stringify(snapshot),
        userName: userName ?? null,
        // `pCategory ?? ''` — the column is non-null, and an omitted category is
        // stored as the empty string. That is what makes it match nothing in the
        // per-category conversion check, so only the booking total binds.
        items: { create: items.map((it) => ({ pCategory: it.pCategory ?? '', bags: it.bags, kgs: it.kgs })) },
        rates: { create: this.normalizeRates(dto.rates).map((r) => ({ ...r, userName: userName ?? null })) },
      },
      include: INCLUDE,
    });
    return this.toDto(await this.ensureCode(row), new Map());
  }

  async update(id: number, dto: UpdateBookingDto): Promise<BookingDto> {
    const existing = await this.prisma.booking.findUnique({ where: { id }, include: { items: true } });
    if (!existing) throw new NotFoundException('Booking not found.');
    if (existing.status === 'CANCELLED') throw new BadRequestException('A cancelled booking cannot be edited.');

    const data: Prisma.BookingUpdateInput = {};
    if (dto.customerName !== undefined) data.customerName = (uc(dto.customerName) ?? '') as string;
    if (dto.agentName !== undefined) data.agentName = uc(dto.agentName);
    if (dto.category !== undefined) data.category = uc(dto.category);
    if (dto.comment !== undefined) data.comment = toStr(dto.comment);
    if (dto.bookingDate !== undefined && dto.bookingDate) {
      const d = new Date(dto.bookingDate);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid booking date.');
      data.bookingDate = d;
    }

    let itemsChanged = false;
    if (dto.items !== undefined) {
      const items = this.normalizeItems(dto.items);
      // A category line can't shrink below what's already converted for it.
      for (const existingItem of existing.items) {
        const match = items.find((it) => it.pCategory === existingItem.pCategory);
        if ((match?.bags ?? 0) < existingItem.convertedBags) {
          throw new BadRequestException(`${existingItem.pCategory}: bags cannot be less than the ${existingItem.convertedBags} already converted.`);
        }
        if ((match?.kgs ?? 0) < existingItem.convertedKgs) {
          throw new BadRequestException(`${existingItem.pCategory}: kgs cannot be less than the ${existingItem.convertedKgs} already converted.`);
        }
      }
      data.bags = round2(items.reduce((s, it) => s + it.bags, 0));
      data.kgs = round2(items.reduce((s, it) => s + it.kgs, 0));
      data.items = { deleteMany: {}, create: items.map((it) => ({ pCategory: it.pCategory ?? '', bags: it.bags, kgs: it.kgs })) };
      itemsChanged = true;
    }

    /*
     * Settled rates are replaced wholesale when sent, and left alone when not.
     *
     * Editing them only changes what is priced FROM NOW ON: lines already drawn
     * carry their own frozen `rate`, exactly as they do when a chart rate moves
     * under a booking. Nothing re-prices retroactively.
     */
    if (dto.rates !== undefined) {
      data.rates = { deleteMany: {}, create: this.normalizeRates(dto.rates) };
    }

    await this.prisma.booking.update({ where: { id }, data });
    // Repopulate the fresh items' convertedBags/Kgs (deleteMany+create above reset them to 0).
    if (itemsChanged) await this.recompute(id);
    return this.findOne(id);
  }

  /**
   * Cancel a booking that has at least one bag/kg already converted — the
   * counterpart to {@link remove}, which handles the opposite case. Once real
   * OrderItems exist against a booking, hard-deleting its header would leave
   * them pointing at nothing, so the only way to stop it is a soft, reversible
   * status flip instead. An untouched booking has nothing to preserve, so it's
   * routed to Delete instead — hence the two actions never overlap: exactly one
   * is ever valid for a given booking.
   */
  async cancel(id: number): Promise<BookingDto> {
    const booking = await this.prisma.booking.findUnique({ where: { id }, select: { id: true, status: true, convertedBags: true, convertedKgs: true } });
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'CANCELLED') throw new BadRequestException('This booking is already cancelled.');
    if (booking.status === 'PRECLOSED') throw new BadRequestException('This booking is preclosed — there is nothing left to cancel.');
    if (booking.convertedBags <= 0 && booking.convertedKgs <= 0) {
      throw new BadRequestException('Nothing has been converted from this booking yet — delete it instead.');
    }
    await this.prisma.booking.update({ where: { id }, data: { status: 'CANCELLED' } });
    return this.findOne(id);
  }

  /** Delete a booking outright. Only allowed while nothing has been converted
   *  yet — see {@link cancel} for the case once bags/kgs have been drawn. */
  async remove(id: number): Promise<void> {
    const booking = await this.prisma.booking.findUnique({ where: { id }, select: { convertedBags: true, convertedKgs: true } });
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.convertedBags > 0 || booking.convertedKgs > 0) {
      throw new BadRequestException('This booking already has conversions — it cannot be deleted. Cancel it instead.');
    }
    await this.prisma.booking.delete({ where: { id } });
  }

  /* ── PDF (order-wise sales detail for one booking) ───────────────────────── */

  /**
   * A Tally-style black & white statement for one bag booking: the booking's
   * own booked/converted/remaining figures, then every real order line drawn
   * from it, grouped by the Order it actually landed on. A booking can span
   * more than one Order (see {@link linkItems}), so this reads straight off
   * `OrderItem.bookingId` rather than the single `booking.orderId` pointer.
   */
  async generateBookingPdf(id: number): Promise<{ buffer: Buffer; filename: string }> {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found.');

    const orderItems = await this.prisma.orderItem.findMany({
      where: { bookingId: id },
      include: { order: { select: { id: true, code: true, orderDate: true, status: true } } },
      orderBy: [{ orderId: 'asc' }, { id: 'asc' }],
    });

    // The durable audit trail (see recompute()) — gives every non-live line
    // (cancelled OR hard-deleted) its "removed" attribution, and is the ONLY
    // remaining trace of a line whose OrderItem row no longer exists at all.
    const conversions = await this.prisma.bookingConversion.findMany({ where: { bookingId: id } });
    const conversionByItemId = new Map(conversions.map((c) => [c.orderItemId, c]));
    const liveItemIds = new Set(orderItems.map((it) => it.id));
    // A line can only be hard-deleted while it has never been dispatched (see
    // OrdersService.update()'s "Mark it Cancelled instead" guard), so a ghost
    // line never needs a dispatch/challan lookup — it simply never had one.
    const ghostConversions = conversions.filter((c) => c.orderItemId != null && !liveItemIds.has(c.orderItemId) && c.removedReason === 'LINE_DELETED');

    // Dispatch + Challan, per line — a two-hop lookup since ChallanItem only
    // carries dispatchId, not orderItemId (mirrors OrdersService.timeline()).
    const orderItemIds = orderItems.map((it) => it.id);
    const dispatches = orderItemIds.length
      ? await this.prisma.dispatch.findMany({
          where: { orderItemId: { in: orderItemIds } },
          select: {
            id: true,
            orderItemId: true,
            bags: true,
            pcs: true,
            gram: true,
            box: true,
            dispatchStatus: true,
            // For the dispatch register on the last page. The snapshots
            // (orderCode / productName / designType) are what the dispatch was
            // actually made against, so they stay right even if the line was
            // edited afterwards; the order relation supplies the order's date.
            dispatchDate: true,
            comment: true,
            orderCode: true,
            productName: true,
            designType: true,
            order: { select: { code: true, orderDate: true } },
          },
          orderBy: [{ orderItemId: 'asc' }, { id: 'asc' }],
        })
      : [];
    const dispatchIds = dispatches.map((d) => d.id);
    const challanItems = dispatchIds.length
      ? await this.prisma.challanItem.findMany({
          where: { dispatchId: { in: dispatchIds } },
          include: { challan: { select: { code: true, challanStatus: true } } },
        })
      : [];
    // Dispatch -> its challan (prefer a non-cancelled one when re-challaned).
    const challanByDispatch = new Map<number, { code: string; challanStatus: string }>();
    for (const ci of challanItems) {
      if (ci.dispatchId == null || !ci.challan) continue;
      const cur = challanByDispatch.get(ci.dispatchId);
      if (cur && cur.challanStatus !== 'CANCELLED') continue;
      challanByDispatch.set(ci.dispatchId, ci.challan);
    }
    const dispatchesByItem = new Map<number, typeof dispatches>();
    for (const d of dispatches) {
      const list = dispatchesByItem.get(d.orderItemId) ?? [];
      list.push(d);
      dispatchesByItem.set(d.orderItemId, list);
    }

    /*
     * The dispatch register: one row per dispatch made against this booking,
     * oldest first.
     *
     * The statement above answers "what was ordered and how much of it went",
     * per line. This answers the other question people bring to a booking —
     * "when did each lot actually leave, and on what". Ordered by dispatch date
     * rather than by order, because that is the sequence being reconstructed.
     *
     * RETURNED rows carry NEGATIVE quantities (see DispatchService — saving a
     * dispatch as Undispatched writes the reversal as its own row), so they are
     * listed like any other and the column totals come out net without any
     * special arithmetic.
     */
    const itemById = new Map(orderItems.map((it) => [it.id, it]));
    const dispatchRows: BookingPdfDispatchRow[] = dispatches
      .map((d) => {
        const it = itemById.get(d.orderItemId);
        const design = d.designType ?? it?.designType ?? null;
        return {
          orderCode: d.orderCode ?? d.order?.code ?? (it ? (it.order.code ?? `ORD-${it.order.id}`) : '—'),
          orderDate: d.order?.orderDate ?? it?.order.orderDate ?? null,
          dispatchDate: d.dispatchDate,
          productName: d.productName ?? it?.productName ?? null,
          designType: design && design.toUpperCase() !== 'NA' ? design : null,
          bags: d.bags,
          kgs: d.gram,
          pcs: d.pcs,
          box: d.box,
          returned: d.dispatchStatus === RETURNED_DISPATCH_STATUS,
          remarks: d.comment,
        };
      })
      .sort((a, b) => a.dispatchDate.getTime() - b.dispatchDate.getTime());

    const groups = new Map<number, BookingPdfOrderGroup>();
    for (const it of orderItems) {
      let group = groups.get(it.order.id);
      if (!group) {
        group = {
          orderCode: it.order.code ?? `ORD-${it.order.id}`,
          orderDate: it.order.orderDate,
          orderStatus: it.order.status,
          lines: [],
        };
        groups.set(it.order.id, group);
      }
      const qty = it.calField === 'PCS' ? (it.pcs ?? 0) : (it.gram ?? 0);
      const itemDispatches = dispatchesByItem.get(it.id) ?? [];
      const fullyDispatched = itemDispatches.some((d) => d.dispatchStatus === 'FULLY DISPATCH');
      const challanCodes = [...new Set(itemDispatches.map((d) => challanByDispatch.get(d.id)?.code).filter((c): c is string => !!c))];
      const removal = conversionByItemId.get(it.id);
      group.lines.push({
        productName: it.productName,
        designType: it.designType && it.designType.toUpperCase() !== 'NA' ? it.designType : null,
        bags: it.bags,
        kgs: it.gram,
        pcs: it.pcs,
        rate: it.rate,
        amount: round2((it.rate ?? 0) * qty),
        status: it.status,
        dispatchStatus: fullyDispatched ? 'FULL' : itemDispatches.length ? 'PARTIAL' : 'PENDING',
        dispatchedBags: round2(itemDispatches.reduce((s, d) => s + (d.bags ?? 0), 0)),
        dispatchedKgs: round2(itemDispatches.reduce((s, d) => s + (d.gram ?? 0), 0)),
        dispatchedPcs: round2(itemDispatches.reduce((s, d) => s + (d.pcs ?? 0), 0)),
        challanCodes,
        removedAt: removal?.removedAt ?? null,
        removedReason: removal?.removedReason ?? null,
        removedByName: removal?.removedByName ?? null,
      });
    }

    // Ghost lines: the OrderItem row is gone entirely, so this snapshot from
    // recompute() is the only surviving trace of it. Grouped under its
    // snapshotted order — the SAME order group as any of that order's still-
    // existing lines, if there are any, so a partially-deleted order doesn't
    // print as two separate blocks.
    for (const c of ghostConversions) {
      const orderKey = c.orderId ?? -c.id; // never collides with a real order id
      let group = groups.get(orderKey);
      if (!group) {
        group = {
          orderCode: c.orderCode ?? (c.orderId ? `ORD-${c.orderId}` : 'Deleted order'),
          orderDate: c.orderDate ?? c.convertedAt,
          orderStatus: 'DELETED',
          lines: [],
        };
        groups.set(orderKey, group);
      }
      const qty = c.pcs && !c.kgs ? c.pcs : (c.kgs ?? 0);
      group.lines.push({
        productName: c.productName,
        designType: c.designType && c.designType.toUpperCase() !== 'NA' ? c.designType : null,
        bags: c.bags,
        kgs: c.kgs,
        pcs: c.pcs,
        rate: c.frozenRate,
        amount: round2(c.amount ?? (c.frozenRate ?? 0) * qty),
        status: 'CANCELLED', // reuses the existing italic "line no longer active" styling
        dispatchStatus: 'PENDING',
        dispatchedBags: 0,
        dispatchedKgs: 0,
        dispatchedPcs: 0,
        challanCodes: [],
        removedAt: c.removedAt,
        removedReason: c.removedReason,
        removedByName: c.removedByName,
      });
    }
    /*
     * Dispatch-overage withdrawals, as their own block.
     *
     * These belong to no order — they are extra bags that went out against a
     * line that had already run out, taken off this booking instead (see
     * DispatchService.create). They still count toward what the booking has
     * been drawn down by, so a booking whose remaining had dropped with no
     * order to explain it would otherwise look like an arithmetic error.
     */
    const overageDraws = conversions.filter((c) => c.kind === 'DISPATCH_OVERAGE');
    const overageGroups: BookingPdfOrderGroup[] = overageDraws.length
      ? [
          {
            heading: 'Withdrawn at dispatch   ·   not against any order line',
            orderCode: '—',
            orderDate: booking.bookingDate,
            orderStatus: 'OVERAGE',
            lines: overageDraws.map((c) => ({
              productName: c.productName,
              designType: c.designType && c.designType.toUpperCase() !== 'NA' ? c.designType : null,
              bags: c.bags,
              kgs: c.kgs,
              pcs: c.pcs,
              rate: c.frozenRate,
              amount: round2(c.amount ?? 0),
              status: 'CONFIRMED',
              // It shipped — that is the whole reason this draw exists.
              dispatchStatus: 'FULL' as const,
              dispatchedBags: c.bags ?? 0,
              dispatchedKgs: c.kgs ?? 0,
              dispatchedPcs: c.pcs ?? 0,
              challanCodes: [],
              caption: c.note ?? null,
              removedAt: c.removedAt,
              removedReason: c.removedReason,
              removedByName: c.removedByName,
            })),
          },
        ]
      : [];

    const buffer = await this.pdf.render(
      buildBookingPdfDoc({
        code: booking.code ?? this.codeFor(booking.id),
        customerName: booking.customerName,
        agentName: booking.agentName,
        category: booking.category,
        bookingDate: booking.bookingDate,
        bags: booking.bags,
        kgs: booking.kgs,
        convertedBags: booking.convertedBags,
        convertedKgs: booking.convertedKgs,
        remainingBags: Math.max(0, round2(booking.bags - booking.convertedBags - (booking.precloseBags ?? 0))),
        remainingKgs: Math.max(0, round2(booking.kgs - booking.convertedKgs - (booking.precloseKgs ?? 0))),
        status: booking.status as BookingStatus,
        comment: booking.comment,
        precloseBags: booking.precloseBags,
        precloseKgs: booking.precloseKgs,
        precloseComment: booking.precloseComment,
        precloseByName: booking.precloseByName,
        precloseAt: booking.precloseAt,
        groups: [...groups.values(), ...overageGroups],
        dispatches: dispatchRows,
      }),
    );
    const stamp = booking.code ?? this.codeFor(booking.id);
    const safeCustomer = booking.customerName.replace(/[\\/:*?"<>|]/g, '-').trim();
    return { buffer, filename: `${safeCustomer}_${stamp}.pdf` };
  }

  /**
   * Preclose a PARTIALLY_CONVERTED booking: write off exactly what's still
   * pending right now and close it for good, so a booking that will never be
   * fully drawn doesn't sit "partial" forever.
   *
   * Only valid from PARTIALLY_CONVERTED — OPEN has nothing converted yet (that's
   * what Cancel is for) and CONVERTED/CANCELLED/PRECLOSED already have nothing
   * left to write off. The written-off amount is always the CURRENT remaining
   * figure, not a caller-supplied one — letting the caller type an arbitrary
   * number would leave the booking in an ambiguous state (still partly open?
   * closed anyway?) which defeats the point of a terminal status.
   */
  async preclose(id: number, dto: PrecloseBookingDto, userName?: string | null): Promise<BookingDto> {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status !== 'PARTIALLY_CONVERTED') {
      throw new BadRequestException('Only a partially converted booking (something converted, something still pending) can be preclosed.');
    }
    const remBags = round2(Math.max(0, booking.bags - booking.convertedBags));
    const remKgs = round2(Math.max(0, booking.kgs - booking.convertedKgs));
    await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'PRECLOSED',
        precloseBags: remBags,
        precloseKgs: remKgs,
        precloseComment: toStr(dto.comment),
        precloseByName: userName ?? null,
        precloseAt: new Date(),
      },
    });
    return this.findOne(id);
  }

  /**
   * Existing OrderItems not currently linked to ANY booking, for this booking's
   * customer — candidates for "Assign old order(s)": retroactively attaching a
   * pre-existing order line to this booking so its converted qty reflects an
   * order that was created without going through the normal draw-down flow.
   */
  async linkableItems(id: number, query: LinkableItemsQueryDto): Promise<LinkableOrderItemDto[]> {
    const booking = await this.prisma.booking.findUnique({ where: { id }, select: { customerName: true } });
    if (!booking) throw new NotFoundException('Booking not found.');
    const search = query.search?.trim();
    const rows = await this.prisma.orderItem.findMany({
      where: {
        bookingId: null,
        status: { not: 'CANCELLED' },
        order: { customerName: booking.customerName, status: { notIn: ['CANCELLED', ...ORDER_UNCOMMITTED_STATUSES] } },
        ...(search ? { OR: [{ productName: { contains: search } }, { order: { code: { contains: search } } }] } : {}),
      },
      include: { order: { select: { id: true, code: true, orderDate: true } } },
      orderBy: { order: { orderDate: 'desc' } },
      take: 200,
    });
    return rows.map((it) => ({
      orderItemId: it.id,
      orderId: it.order.id,
      orderCode: it.order.code ?? `ORD-${it.order.id}`,
      orderDate: it.order.orderDate.toISOString(),
      pCategory: it.pCategory,
      productName: it.productName,
      designType: it.designType && it.designType.toUpperCase() !== 'NA' ? it.designType : null,
      bags: it.bags,
      pcs: it.pcs,
      gram: it.gram,
      box: it.box,
      rate: it.rate,
      priority: it.priority,
    }));
  }

  /**
   * Attach existing, currently-unlinked OrderItems to this booking — the
   * "Assign old order(s)" correction tool. Reuses `recompute()` afterwards so
   * the linked lines are picked up exactly like a normal conversion: they
   * appear in `convertedBags/Kgs`, per-category draw-down, and rebuild the
   * `BookingConversion` audit rows (tracked there via `convertedByName`, which
   * is the order's own creator; WHO did the linking is recorded separately by
   * the controller's audit-log entry on this route).
   */
  async linkItems(id: number, dto: LinkBookingItemsDto): Promise<BookingDto> {
    const booking = await this.prisma.booking.findUnique({ where: { id }, include: { items: true } });
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'CANCELLED' || booking.status === 'PRECLOSED') {
      throw new BadRequestException(`A ${booking.status.toLowerCase()} booking can't have items assigned to it.`);
    }

    const items = await this.prisma.orderItem.findMany({
      where: { id: { in: dto.orderItemIds } },
      include: { order: { select: { customerName: true, status: true, code: true } } },
    });
    if (items.length !== dto.orderItemIds.length) throw new BadRequestException('One or more selected order lines no longer exist.');
    for (const it of items) {
      if (it.bookingId != null) throw new BadRequestException(`${it.productName ?? `line #${it.id}`} is already linked to a booking.`);
      if (it.status === 'CANCELLED') throw new BadRequestException(`${it.productName ?? `line #${it.id}`} is a cancelled line.`);
      if (it.order.status === 'CANCELLED') throw new BadRequestException(`Order ${it.order.code ?? ''} is cancelled.`);
      if (uc(it.order.customerName) !== uc(booking.customerName)) {
        throw new BadRequestException(`${it.productName ?? `line #${it.id}`} belongs to a different customer than this booking.`);
      }
    }

    // Same overall-capacity guard as convert() — this is a manual correction, but
    // the booking's totals still have to stay honest. Per-category enforcement is
    // intentionally skipped here (unlike convert()): an old order predates the
    // booking's category split and forcing it to match would just block valid
    // corrections on a technicality.
    const addBags = round2(items.reduce((s, it) => s + (it.bags ?? 0), 0));
    const addKgs = round2(items.reduce((s, it) => s + (it.gram ?? 0), 0));
    const remBags = round2(booking.bags - booking.convertedBags);
    const remKgs = round2(booking.kgs - booking.convertedKgs);
    if (!withinBooked(addBags, remBags, booking.bags)) throw new BadRequestException(`Assigning ${addBags} bags exceeds the ${remBags} remaining on this booking.`);
    if (!withinBooked(addKgs, remKgs, booking.kgs)) throw new BadRequestException(`Assigning ${addKgs} kgs exceeds the ${remKgs} remaining on this booking.`);

    await this.prisma.orderItem.updateMany({ where: { id: { in: dto.orderItemIds } }, data: { bookingId: booking.id } });
    await this.recompute(booking.id);
    return this.findOne(id);
  }

  /* ── Quote (price convertible lines as of the booking date) ──────────────── */

  async quote(id: number, dto: ConvertBookingDto): Promise<BookingQuoteResult> {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found.');
    const snapshot = this.parseSnapshot(booking.rateSnapshot);
    // The customer's CURRENT special rates (may differ from the frozen snapshot if
    // rates were added/changed after the booking) — drives the "new price" prompt.
    const customer = await this.prisma.customer.findFirst({ where: { partyName: booking.customerName } });
    const currentSnapshot = customer ? await this.snapshotSpecialRates(customer.id) : snapshot;
    const agreed = await this.agreedRatesFor(booking.id);
    const lines: BookingQuoteLine[] = [];
    for (const line of dto.lines ?? []) {
      lines.push(await this.priceLine(line, booking.bookingDate, snapshot, currentSnapshot, agreed));
    }
    return { bookingDate: booking.bookingDate.toISOString(), lines };
  }

  /* ── Convert (draw down bags/kgs into real order lines) ──────────────────── */

  async convert(id: number, dto: ConvertBookingDto, userName?: string | null): Promise<BookingDto> {
    return serializeBookingDraw(true, () => this.convertWithinDraw(id, dto, userName));
  }

  /**
   * Convert, and hand back the OrderItem ids that were created.
   *
   * The dispatch-from-booking flow has to dispatch the very lines it just made,
   * and — if a dispatch then fails — delete exactly those and no others. The
   * public {@link convert} returns the whole booking, which cannot identify
   * them: a booking may already hold lines for the same product from an earlier
   * draw, so matching by product afterwards would pick the wrong row.
   */
  async convertReturningItems(id: number, dto: ConvertBookingDto, userName?: string | null): Promise<number[]> {
    const created: number[] = [];
    await serializeBookingDraw(true, () => this.convertWithinDraw(id, dto, userName, created));
    return created;
  }

  /**
   * Undo a conversion this request made, when a later step in the same request
   * failed — so a cup dispatch that cannot be written does not leave order
   * lines drawn off the booking behind it.
   *
   * Hard-deletes rather than cancels: these lines existed for a few hundred
   * milliseconds, were never dispatched, and cancelling would leave the booking
   * PDF showing a phantom "cancelled" line nobody ever entered. The recompute
   * puts the booking's drawn figures back where they were.
   */
  async rollbackConvertedItems(bookingId: number, orderItemIds: number[]): Promise<void> {
    if (!orderItemIds.length) return;
    await this.prisma.orderItem.deleteMany({ where: { id: { in: orderItemIds }, bookingId } });
    // The audit rows for lines that never really existed would otherwise be
    // swept into "deleted" history by the recompute below.
    await this.prisma.bookingConversion.deleteMany({ where: { bookingId, orderItemId: { in: orderItemIds } } });
    await this.recompute(bookingId);
  }

  /**
   * Everything the cup dispatch form needs for one party and category, in one
   * call: the party's bag weight, their drawable bookings, the rates settled on
   * those bookings, and the sellable items with the figures the arithmetic
   * needs.
   */
  async dispatchOptions(customerName: string | null, pCategory: string | null): Promise<BookingDispatchOptions> {
    const name = uc(customerName) ?? '';
    const category = uc(pCategory) ?? '';
    if (!name || !category) return { kgsPerBag: null, bookings: [], rates: [], items: [] };

    const customer = await this.prisma.customer.findFirst({ where: { partyName: name } });
    const bookings = await this.drawableFor(name, category);
    const [bagWeight, rates, products] = await Promise.all([
      customer ? this.prisma.customerBagWeight.findFirst({ where: { customerId: customer.id, category } }) : null,
      bookings.length
        ? this.prisma.bookingRate.findMany({ where: { bookingId: { in: bookings.map((b) => b.id) } }, orderBy: { id: 'asc' } })
        : [],
      this.prisma.product.findMany({
        where: { category, active: true },
        select: { product: true, subCategory: true, size: true, pcs: true, weight: true, rate: true },
        orderBy: [{ size: 'asc' }, { subCategory: 'asc' }, { product: 'asc' }],
      }),
    ]);

    return {
      kgsPerBag: bagWeight?.kgsPerBag ?? null,
      bookings,
      rates: rates.map((r) => ({
        id: r.id,
        bookingId: r.bookingId,
        pCategory: r.pCategory,
        subCategory: r.subCategory,
        rate: r.rate,
        userName: r.userName,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      items: products.map((p) => ({
        product: p.product,
        subCategory: p.subCategory,
        size: p.size,
        pcs: p.pcs,
        weight: p.weight,
        rate: p.rate,
      })),
    };
  }

  private async convertWithinDraw(
    id: number,
    dto: ConvertBookingDto,
    userName?: string | null,
    /** Filled with every OrderItem id created, for callers that must be able to
     *  address exactly these lines afterwards. */
    createdInto?: number[],
  ): Promise<BookingDto> {
    const booking = await this.prisma.booking.findUnique({ where: { id }, include: { items: true } });
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'CANCELLED') throw new BadRequestException('A cancelled booking cannot be converted.');

    const lines = (dto.lines ?? []).filter((l) => (l.productName || l.product));
    if (!lines.length) throw new BadRequestException('Add at least one item to convert.');

    // Ownership, drawable status, total and per-category limits — the same gate
    // the normal order save goes through, so the two routes can't drift apart.
    await this.assertDrawable(
      id,
      booking.customerName,
      lines.map((l) => ({ pCategory: l.pCategory, bags: toNum(l.bags), kgs: toNum(l.gram) })),
    );

    const snapshot = this.parseSnapshot(booking.rateSnapshot);
    const agreed = await this.agreedRatesFor(booking.id);

    // Ensure the booking's order exists (created lazily on first conversion), then
    // append the priced lines to it. Rates are frozen as of the booking date.
    const orderId = await this.ensureOrder(booking);

    for (const line of lines) {
      const priced = await this.priceLine(line, booking.bookingDate, snapshot, snapshot, agreed);
      const createdItem = await this.prisma.orderItem.create({
        data: {
          orderId,
          bookingId: booking.id,
          pCategory: uc(line.pCategory),
          subCategory: uc(line.subCategory),
          product: uc(line.product),
          design: uc(line.design),
          productName: uc(line.productName),
          designType: uc(line.designType),
          psize: toNum(line.psize),
          bags: toNum(line.bags),
          pcs: toNum(line.pcs),
          gram: toNum(line.gram),
          box: toNum(line.box),
          productRate: priced.productRate + priced.productDelta,
          designRate: priced.designRate + priced.designDelta,
          rate: priced.rate,
          calField: uc(line.calField),
          // The order form always sends a priority; this path had no form, so the
          // line landed with priority NULL and read as missing data in Order Modify.
          priority: 'NORMAL',
          status: 'CONFIRMED',
          comment: toStr(line.comment),
        },
      });
      createdInto?.push(createdItem.id);
    }

    // The draw-down (converted bags/kgs + the audit rows) is always derived from
    // the OrderItems that carry this bookingId — one source of truth for every
    // path (standalone convert AND drawing a booking into an order form line).
    await this.recompute(booking.id);
    return this.findOne(id);
  }

  /**
   * Recompute a booking's draw-down from the real OrderItems that reference it.
   * `convertedBags/Kgs` + `status` are the sum over every LIVE line (not
   * cancelled, on a not-cancelled order) with this bookingId.
   *
   * `BookingConversion` is upserted (by `orderItemId`, not deleted/recreated) so
   * it can double as a durable audit trail: once a line stops being live —
   * cancelled, its order cancelled, or the OrderItem row hard-deleted outright —
   * its row is marked `removedAt`/`removedReason`/`removedByName` instead of
   * disappearing, freezing exactly how that qty was used right before it
   * stopped counting. `generateBookingPdf` reads this to show that history,
   * including for a line so thoroughly deleted that OrderItem no longer has a
   * row for it at all — the `orderId`/`orderCode`/`orderDate` snapshot is what
   * lets THAT case still render as part of the right order group.
   *
   * `actorName` attributes a removal that happens as a side effect of THIS
   * call (e.g. the order edit that just cancelled/deleted the line) — omit it
   * for recomputes that only add/adjust lines (convert, linkItems), where
   * nothing is being removed. Idempotent — safe to call after any change.
   */
  async recompute(bookingId: number, actorName?: string | null): Promise<void> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { items: true } });
    if (!booking) return;
    // Every OrderItem still linked to this booking, LIVE OR NOT — a cancelled
    // line's snapshot must still be captured, only a genuinely deleted row is
    // absent here (see the sweep below for that case).
    const linked = await this.prisma.orderItem.findMany({
      where: { bookingId },
      include: { order: { select: { id: true, code: true, orderDate: true, status: true, userName: true } } },
      orderBy: { id: 'asc' },
    });
    const live = linked.filter((it) => it.status !== 'CANCELLED' && it.order.status !== 'CANCELLED');

    /*
     * Dispatch-overage withdrawals also draw this booking down.
     *
     * These have no OrderItem to sum — the extra bags went out against the
     * booking itself, not against an ordered line (see DispatchService.create).
     * They are counted here so the booking's remaining reflects everything that
     * has actually been taken out of it, whichever door the stock left by.
     */
    const draws = await this.prisma.bookingConversion.findMany({
      where: { bookingId, kind: OVERAGE_KIND, removedAt: null },
    });

    // Link the booking to the (first) order its live lines live on — this is the
    // order the standalone-convert path created, or the order it was drawn into
    // via the order form. Falls back to null once every drawn line is gone.
    const orderId = live[0]?.orderId ?? null;
    const convertedBags = round2(
      live.reduce((s, it) => s + (it.bags ?? 0), 0) + draws.reduce((s, d) => s + (d.bags ?? 0), 0),
    );
    const convertedKgs = round2(
      live.reduce((s, it) => s + (it.gram ?? 0), 0) + draws.reduce((s, d) => s + (d.kgs ?? 0), 0),
    );
    // CANCELLED and PRECLOSED are manual, terminal calls — a booking's own qty
    // math must never silently promote it back to OPEN/PARTIAL/CONVERTED just
    // because an order tied to it changed. (Linking an item to a PRECLOSED
    // booking is refused up front in linkItems(), so this really only matters
    // for e.g. an order-item edit/delete triggering a routine recompute.)
    const status =
      booking.status === 'CANCELLED' || booking.status === 'PRECLOSED'
        ? booking.status
        : this.statusFor(booking.bags, booking.kgs, convertedBags, convertedKgs);

    // Per-category draw-down — matched by pCategory against the real order lines
    // that reference this booking, so each booked line's own remaining tracks
    // independently of the others (e.g. GLASS's 1 bag vs CUP's 1 bag).
    let absorbedBags = 0;
    let absorbedKgs = 0;
    for (const bookingItem of booking.items) {
      if (!bookingItem.pCategory) continue; // the unspecified bucket is settled below
      const matching = live.filter((it) => (uc(it.pCategory) ?? '') === bookingItem.pCategory);
      // An overage draw carries its own pCategory (it has no OrderItem to read
      // one off), so the extra bag comes out of the category it actually was.
      const matchingDraws = draws.filter((d) => (uc(d.pCategory) ?? '') === bookingItem.pCategory);
      const itemConvertedBags = round2(
        matching.reduce((s, it) => s + (it.bags ?? 0), 0) + matchingDraws.reduce((s, d) => s + (d.bags ?? 0), 0),
      );
      const itemConvertedKgs = round2(
        matching.reduce((s, it) => s + (it.gram ?? 0), 0) + matchingDraws.reduce((s, d) => s + (d.kgs ?? 0), 0),
      );
      absorbedBags = round2(absorbedBags + itemConvertedBags);
      absorbedKgs = round2(absorbedKgs + itemConvertedKgs);
      if (itemConvertedBags !== bookingItem.convertedBags || itemConvertedKgs !== bookingItem.convertedKgs) {
        await this.prisma.bookingItem.update({ where: { id: bookingItem.id }, data: { convertedBags: itemConvertedBags, convertedKgs: itemConvertedKgs } });
      }
    }

    /*
     * The line booked WITHOUT a category takes whatever the named ones did not.
     *
     * It cannot be matched by name — that is the whole point of it — so the
     * name-matching above would never draw it down at all: a booking of "81
     * bags, category not decided", fully converted into GLASS, would show its
     * header as CONVERTED while the line underneath still read "81 remaining".
     *
     * Taking the remainder keeps the two consistent by construction: the item
     * totals always add up to the booking's own converted figure, whichever
     * categories the order eventually turned out to be.
     */
    const openItem = booking.items.find((it) => !it.pCategory);
    if (openItem) {
      const rest = { bags: Math.max(0, round2(convertedBags - absorbedBags)), kgs: Math.max(0, round2(convertedKgs - absorbedKgs)) };
      if (rest.bags !== openItem.convertedBags || rest.kgs !== openItem.convertedKgs) {
        await this.prisma.bookingItem.update({ where: { id: openItem.id }, data: { convertedBags: rest.bags, convertedKgs: rest.kgs } });
      }
    }

    // Fetch existing rows first so a removal already frozen at some earlier
    // moment is never pushed forward by this (possibly unrelated) recompute.
    const existingByItemId = new Map(
      (await this.prisma.bookingConversion.findMany({ where: { bookingId, kind: ORDER_LINE_KIND } })).map((c) => [
        c.orderItemId,
        c,
      ]),
    );
    for (const it of linked) {
      const isLive = it.status !== 'CANCELLED' && it.order.status !== 'CANCELLED';
      const existing = existingByItemId.get(it.id);
      const qty = it.calField === 'PCS' ? it.pcs ?? 0 : it.gram ?? 0;
      const removedReason: string | null = isLive ? null : it.status === 'CANCELLED' ? 'LINE_CANCELLED' : 'ORDER_CANCELLED';
      const data = {
        productName: it.productName,
        designType: it.designType,
        bags: it.bags,
        kgs: it.gram,
        pcs: it.pcs,
        box: it.box,
        frozenRate: it.rate,
        amount: (it.rate ?? 0) * qty,
        convertedByName: it.order.userName ?? null,
        orderId: it.order.id,
        orderCode: it.order.code,
        orderDate: it.order.orderDate,
        removedAt: isLive ? null : (existing?.removedAt ?? new Date()),
        removedReason: isLive ? null : removedReason,
        removedByName: isLive ? null : (existing?.removedByName ?? actorName ?? null),
      };
      await this.prisma.bookingConversion.upsert({
        where: { orderItemId: it.id },
        create: { bookingId, orderItemId: it.id, convertedAt: it.createdAt, kind: ORDER_LINE_KIND, ...data },
        update: data,
      });
    }
    // Lines that have vanished entirely since the last recompute (the OrderItem
    // row itself was hard-deleted) keep their previously-captured snapshot —
    // this sweep is what flips them to removed, since the loop above can only
    // see rows that still exist.
    //
    // Scoped to ORDER_LINE draws, and that scope is load-bearing: an overage
    // draw has no orderItemId, so with `linkedIds` empty the where collapsed to
    // "every live row on this booking" and a routine recompute would have
    // written off every overage withdrawal the booking had.
    const linkedIds = linked.map((it) => it.id);
    await this.prisma.bookingConversion.updateMany({
      where: {
        bookingId,
        kind: ORDER_LINE_KIND,
        removedAt: null,
        ...(linkedIds.length ? { orderItemId: { notIn: linkedIds } } : {}),
      },
      data: { removedAt: new Date(), removedReason: 'LINE_DELETED', removedByName: actorName ?? null },
    });

    await this.prisma.booking.update({ where: { id: bookingId }, data: { convertedBags, convertedKgs, status, orderId } });
  }

  /* ── Dispatch-overage withdrawals ────────────────────────────────────────── */

  /**
   * This party's bookings that a dispatch overage could be withdrawn from,
   * most-recent first.
   *
   * `pCategory` is the category the extra bags actually are. A booking is only
   * offered when it has room in THAT category: a party holding 1 bag of CUP
   * cannot cover an extra bag of GLASS, and offering it would let the operator
   * draw a bag the party never booked. Bookings with no line for the category
   * at all are therefore left out, as are ones whose category line is used up.
   *
   * Returns [] rather than throwing for an unknown party or no category — "no
   * booking to draw from" is a normal answer, and the caller's next move (just
   * dispatch it, don't ask) is the same either way.
   */
  async drawableFor(customerName: string | null, pCategory: string | null): Promise<BookingDrawOptionDto[]> {
    const party = uc(customerName);
    const category = uc(pCategory);
    if (!party || !category) return [];

    const rows = await this.prisma.booking.findMany({
      where: { customerName: party, status: { in: [...DRAWABLE_STATUSES] } },
      include: INCLUDE,
      orderBy: [{ bookingDate: 'desc' }, { id: 'desc' }],
    });

    const out: BookingDrawOptionDto[] = [];
    for (const b of rows) {
      const item = b.items.find((i) => uc(i.pCategory) === category);
      if (!item) continue; // nothing of this category booked here
      const catBags = round2(item.bags - item.convertedBags);
      const catKgs = round2(item.kgs - item.convertedKgs);
      if (catBags <= EPS && catKgs <= EPS) continue; // that category is used up
      out.push({
        id: b.id,
        code: b.code ?? this.codeFor(b.id),
        bookingDate: b.bookingDate.toISOString(),
        pCategory: item.pCategory,
        remainingBags: Math.max(0, catBags),
        remainingKgs: Math.max(0, catKgs),
      });
    }
    return out;
  }

  /**
   * Withdraw a dispatch's extra qty from a booking, or re-sync an existing
   * withdrawal after the dispatch is edited.
   *
   * Upserted by `dispatchId` rather than inserted, because a dispatch can be
   * edited: saving it again must move the existing draw to the new extra, not
   * stack a second withdrawal on top of the first. Passing 0/negative extra
   * releases the draw instead — that is the dispatch having been corrected back
   * to within its line, at which point the booking should get its bag back.
   *
   * The category is checked, not just the total: see {@link drawableFor}.
   * Over-drawing is refused outright — a booking cannot go below zero, and
   * silently clamping would tell the operator a bag was covered when it wasn't.
   */
  async drawOverage(
    input: {
      bookingId: number;
      dispatchId: number;
      bags: number;
      kgs: number;
      pCategory: string | null;
      productName: string | null;
      designType: string | null;
      at: Date;
      note: string;
      userName?: string | null;
    },
    /**
     * Run the check + write on a caller's transaction, so the withdrawal and
     * whatever it pays for (the dispatch) commit or fail together — a dispatch
     * recorded with its booking untouched is the unaccounted bag this feature
     * exists to prevent. The caller then calls {@link recompute} itself once
     * the transaction has committed (rollup reads must not see uncommitted
     * rows, and recompute is a long chain of its own queries).
     */
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const { bookingId, dispatchId, bags, kgs, pCategory } = input;
    if (bags <= EPS && kgs <= EPS) return this.releaseOverageDraw(dispatchId, 'OVERAGE_GONE', input.userName, tx);

    const booking = await db.booking.findUnique({ where: { id: bookingId }, include: { items: true } });
    if (!booking) throw new NotFoundException('Bag booking not found.');
    if (!DRAWABLE_STATUSES.includes(booking.status)) {
      throw new BadRequestException(`Booking ${booking.code ?? bookingId} is ${booking.status} and cannot be drawn from.`);
    }

    const category = uc(pCategory);
    const item = booking.items.find((i) => uc(i.pCategory) === category);
    if (!item) {
      throw new BadRequestException(
        `Booking ${booking.code ?? bookingId} has nothing booked under ${category ?? 'this category'}.`,
      );
    }

    // What this dispatch's own existing draw already accounts for — excluded
    // from the used-up total, or re-saving an unchanged dispatch would look
    // like a second withdrawal and refuse itself.
    const mine = await db.bookingConversion.findUnique({ where: { dispatchId } });
    const minesBags = mine && mine.removedAt == null && mine.bookingId === bookingId ? (mine.bags ?? 0) : 0;
    const minesKgs = mine && mine.removedAt == null && mine.bookingId === bookingId ? (mine.kgs ?? 0) : 0;
    const freeBags = round2(item.bags - item.convertedBags + minesBags);
    const freeKgs = round2(item.kgs - item.convertedKgs + minesKgs);
    if (bags - freeBags > EPS || kgs - freeKgs > EPS) {
      throw new BadRequestException(
        `Booking ${booking.code ?? bookingId} has only ${freeBags} bags / ${freeKgs} kgs left under ${item.pCategory} — ` +
          `not enough to cover the extra ${bags} bags / ${kgs} kgs.`,
      );
    }

    const data = {
      bookingId,
      kind: OVERAGE_KIND,
      pCategory: item.pCategory,
      productName: input.productName,
      designType: input.designType,
      bags,
      kgs,
      note: input.note,
      convertedByName: input.userName ?? null,
      // "Booked on this date" — the draw is dated by the DISPATCH, not by the
      // clock, so a backdated shipment draws the booking down on the day the
      // stock actually left.
      convertedAt: input.at,
      // A re-draw after a release must clear the removal, or the row would stay
      // written off and the qty would silently stop counting.
      removedAt: null,
      removedReason: null,
      removedByName: null,
    };
    await db.bookingConversion.upsert({ where: { dispatchId }, create: { dispatchId, ...data }, update: data });
    // On a caller's transaction the rollup is theirs to trigger after commit.
    if (!tx) await this.recompute(bookingId);
  }

  /**
   * Move an EXISTING withdrawal to a dispatch's new extra, after that dispatch
   * was edited.
   *
   * A no-op when the dispatch never had a draw: nobody was asked to withdraw
   * anything for it, and quietly starting to eat a booking because a quantity
   * was corrected upward is not this method's call to make. Where a draw does
   * exist it is kept honest — down to the smaller extra, or released entirely
   * once the dispatch no longer overshoots its line.
   */
  async resyncOverageDraw(
    dispatchId: number,
    next: { bags: number; kgs: number; at: Date; userName?: string | null },
  ): Promise<void> {
    const existing = await this.prisma.bookingConversion.findUnique({ where: { dispatchId } });
    if (!existing || existing.kind !== OVERAGE_KIND || existing.removedAt != null) return;
    if (next.bags <= EPS && next.kgs <= EPS) {
      return this.releaseOverageDraw(dispatchId, 'OVERAGE_GONE', next.userName);
    }
    await this.drawOverage({
      bookingId: existing.bookingId,
      dispatchId,
      bags: next.bags,
      kgs: next.kgs,
      pCategory: existing.pCategory,
      productName: existing.productName,
      designType: existing.designType,
      at: next.at,
      note: existing.note ?? '',
      userName: next.userName ?? existing.convertedByName,
    });
  }

  /**
   * Stop an overage draw counting — the dispatch was deleted, or edited back to
   * within its line.
   *
   * Marked removed rather than deleted, for the same reason a cancelled order
   * line's draw is: the booking PDF has to be able to show that this qty was
   * once taken out and why it stopped counting. A no-op when there is no draw.
   */
  async releaseOverageDraw(
    dispatchId: number,
    reason: string,
    userName?: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const existing = await db.bookingConversion.findUnique({ where: { dispatchId } });
    if (!existing || existing.removedAt != null) return;
    await db.bookingConversion.update({
      where: { dispatchId },
      data: { removedAt: new Date(), removedReason: reason, removedByName: userName ?? null },
    });
    if (!tx) await this.recompute(existing.bookingId);
  }

  /** Remaining bags/kgs on a booking, optionally excluding one order's draw
   *  (used when re-saving that order so its own lines don't count twice). */
  async remainingFor(bookingId: number, excludeOrderId?: number) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { items: true } });
    if (!booking) return null;
    const items = await this.prisma.orderItem.findMany({
      where: {
        bookingId,
        status: { not: 'CANCELLED' },
        order: { status: { not: 'CANCELLED' }, ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}) },
      },
      select: { bags: true, gram: true, pCategory: true },
    });
    // Overage withdrawals are drawn too — qty already taken out of the booking
    // at a dispatch cannot also be available for an order to draw.
    const draws = await this.prisma.bookingConversion.findMany({
      where: { bookingId, kind: OVERAGE_KIND, removedAt: null },
      select: { bags: true, kgs: true, pCategory: true },
    });
    const drawn = [
      ...items.map((it) => ({ pCategory: it.pCategory, bags: it.bags, kgs: it.gram })),
      ...draws.map((d) => ({ pCategory: d.pCategory, bags: d.bags, kgs: d.kgs })),
    ];
    const drawnBags = round2(drawn.reduce((s, d) => s + (d.bags ?? 0), 0));
    const drawnKgs = round2(drawn.reduce((s, d) => s + (d.kgs ?? 0), 0));

    // Per-category remaining, drawn down the same way recompute() does it: a named
    // bucket takes what matches its category, and the bucket booked WITHOUT a
    // category absorbs everything the named ones did not claim. Preclose is a
    // booking-level write-off and is only applied to the total above.
    const named = booking.items.filter((i) => i.pCategory);
    const open = booking.items.find((i) => !i.pCategory) ?? null;
    const bucketOf = (pCategory: string | null) =>
      named.find((i) => i.pCategory === (uc(pCategory) ?? '')) ?? open;
    const buckets = booking.items.map((item) => {
      const mine = drawn.filter((d) => bucketOf(d.pCategory) === item);
      return {
        item,
        remBags: round2(item.bags - mine.reduce((s, d) => s + (d.bags ?? 0), 0)),
        remKgs: round2(item.kgs - mine.reduce((s, d) => s + (d.kgs ?? 0), 0)),
      };
    });

    // Written-off qty (if preclosed) counts against remaining too — belt-and-
    // braces alongside assertBookingCapacity's own PRECLOSED check, since this is
    // also called for the on-screen remainingBags/Kgs display.
    return {
      booking,
      remBags: round2(booking.bags - drawnBags - (booking.precloseBags ?? 0)),
      remKgs: round2(booking.kgs - drawnKgs - (booking.precloseKgs ?? 0)),
      buckets,
      bucketOf,
    };
  }

  /**
   * The single gate for taking order quantity out of a booking: ownership,
   * drawable status, total capacity and per-category capacity.
   *
   * Both the normal order save and the standalone convert route go through this,
   * so the two can't drift apart again. `withinBooked` is used throughout so a
   * reservation that named only bags is not rejected for the kg its lines derive
   * (and vice versa) — an unreserved dimension is simply not a limit.
   */
  async assertDrawable(
    bookingId: number,
    customerName: string | null,
    lines: readonly { pCategory?: string | null; bags?: number | null; kgs?: number | null }[],
    excludeOrderId?: number,
  ): Promise<void> {
    const info = await this.remainingFor(bookingId, excludeOrderId);
    if (!info) throw new BadRequestException('A drawn booking no longer exists.');
    const { booking } = info;
    const label = booking.code ?? `#${bookingId}`;

    if (customerName && uc(booking.customerName) !== uc(customerName)) {
      throw new BadRequestException(`Booking ${label} belongs to ${booking.customerName} — it cannot be drawn for another party.`);
    }
    if (!DRAWABLE_STATUSES.includes(booking.status)) {
      // CONVERTED is derived from quantity, not a manual decision: an order that
      // already drew this booking must still be editable (that is how you reduce
      // or correct the draw that filled it). Anything else — including a NEW draw
      // on a converted booking, and the manual CANCELLED/PRECLOSED calls — stops
      // here; the quantity checks below still govern the edit itself.
      const editingOwnDraw =
        booking.status === 'CONVERTED' &&
        excludeOrderId != null &&
        (await this.prisma.orderItem.count({
          where: { bookingId, orderId: excludeOrderId, status: { not: 'CANCELLED' } },
        })) > 0;
      if (!editingOwnDraw) {
        throw new BadRequestException(`Booking ${label} is ${booking.status.toLowerCase().replace(/_/g, ' ')} and can't be drawn.`);
      }
    }
    for (const l of lines) {
      if ((l.bags ?? 0) < 0 || (l.kgs ?? 0) < 0) {
        throw new BadRequestException(`Booking ${label}: negative bags or kgs cannot be drawn.`);
      }
    }

    const addBags = round2(lines.reduce((s, l) => s + (l.bags ?? 0), 0));
    const addKgs = round2(lines.reduce((s, l) => s + (l.kgs ?? 0), 0));
    if (!withinBooked(addBags, info.remBags, booking.bags)) {
      throw new BadRequestException(`Drawing ${addBags} bags exceeds the ${info.remBags} left on booking ${label}.`);
    }
    if (!withinBooked(addKgs, info.remKgs, booking.kgs)) {
      throw new BadRequestException(`Drawing ${addKgs} kgs exceeds the ${info.remKgs} left on booking ${label}.`);
    }
    if (!booking.items.length) return; // Legacy reservation with no category lines.

    // A line whose category was never reserved — and with no uncategorised bucket
    // to fall back on — has no quantity to draw at all.
    const orphan = lines.find((l) => !info.bucketOf(l.pCategory ?? null));
    if (orphan) {
      throw new BadRequestException(`Booking ${label} has no reserved quantity for ${uc(orphan.pCategory) || 'this item category'}.`);
    }
    for (const bucket of info.buckets) {
      const mine = lines.filter((l) => info.bucketOf(l.pCategory ?? null) === bucket.item);
      if (!mine.length) continue;
      const bags = round2(mine.reduce((s, l) => s + (l.bags ?? 0), 0));
      const kgs = round2(mine.reduce((s, l) => s + (l.kgs ?? 0), 0));
      const name = bucket.item.pCategory || 'uncategorised';
      if (!withinBooked(bags, bucket.remBags, bucket.item.bags)) {
        throw new BadRequestException(`Only ${bucket.remBags} bags are left booked for ${name} on ${label}.`);
      }
      if (!withinBooked(kgs, bucket.remKgs, bucket.item.kgs)) {
        throw new BadRequestException(`Only ${bucket.remKgs} kgs are left booked for ${name} on ${label}.`);
      }
    }
  }

  /** Price one order line at a booking's frozen (booking-date) rates. Returns the
   *  effective productRate/designRate (incl. the snapshotted special deltas) + total. */
  async priceOrderLine(bookingId: number, line: ConvertBookingLineDto): Promise<BookingQuoteLine | null> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return null;
    const snapshot = this.parseSnapshot(booking.rateSnapshot);
    return this.priceLine(line, booking.bookingDate, snapshot, snapshot, await this.agreedRatesFor(booking.id));
  }

  /**
   * Price one line's chart rate AS OF an arbitrary date — for Order Modify's
   * "the item was changed to something with a different rate" check, which has
   * no booking (and therefore no frozen rate snapshot) to lean on. Both the
   * as-of and current sides resolve the customer's CURRENT special rates (a
   * plain order never snapshots them the way a booking does), so `priceChanged`
   * here reports purely a BASE chart-rate change since `asOfDate` — exactly the
   * signal "would this line have priced differently back then" needs.
   */
  async priceAsOf(customerId: number | null, asOfDate: Date, line: ConvertBookingLineDto): Promise<BookingQuoteLine> {
    const snapshot = customerId ? await this.snapshotSpecialRates(customerId) : { rates: [], logos: [] };
    return this.priceLine(line, asOfDate, snapshot);
  }

  /* ── Price-change history (unified products / designs / special rates) ───── */

  async priceHistory(query: PriceHistoryQueryDto): Promise<PriceHistoryList> {
    const search = query.search?.trim().toLowerCase();
    const kind = query.kind;

    const [products, designs, customers] = await Promise.all([
      !kind || kind === 'PRODUCT' ? this.prisma.productRateHistory.findMany({ orderBy: { changedAt: 'desc' } }) : Promise.resolve([]),
      !kind || kind === 'DESIGN' ? this.prisma.designRateHistory.findMany({ orderBy: { changedAt: 'desc' } }) : Promise.resolve([]),
      !kind || kind === 'CUSTOMER' ? this.prisma.customerRateHistory.findMany({ orderBy: { changedAt: 'desc' } }) : Promise.resolve([]),
    ]);

    let rows: RateChangeEntry[] = [
      ...products.map((r) => ({
        id: r.id,
        kind: 'PRODUCT' as RateHistoryKind,
        name: r.productName,
        category: r.category,
        subCategory: r.subCategory,
        rateKind: null,
        scope: null,
        target: null,
        oldRate: r.oldRate,
        newRate: r.newRate,
        changedByName: r.changedByName,
        changedAt: r.changedAt.toISOString(),
      })),
      ...designs.map((r) => ({
        id: r.id,
        kind: 'DESIGN' as RateHistoryKind,
        name: r.designType,
        category: r.category,
        subCategory: r.subCategory,
        rateKind: null,
        scope: null,
        target: null,
        oldRate: r.oldRate,
        newRate: r.newRate,
        changedByName: r.changedByName,
        changedAt: r.changedAt.toISOString(),
      })),
      ...customers.map((r) => ({
        id: r.id,
        kind: 'CUSTOMER' as RateHistoryKind,
        name: r.customerName ?? `#${r.customerId}`,
        category: r.category,
        subCategory: r.subCategory,
        rateKind: r.kind,
        scope: r.scope,
        target: r.target,
        oldRate: r.oldRate,
        newRate: r.newRate,
        changedByName: r.changedByName,
        changedAt: r.changedAt.toISOString(),
      })),
    ];

    if (search) rows = rows.filter((r) => [r.name, r.category, r.subCategory, r.target].some((v) => (v ?? '').toLowerCase().includes(search)));
    rows.sort((a, b) => b.changedAt.localeCompare(a.changedAt) || b.id - a.id);

    const total = rows.length;
    const items = rows.slice(query.skip, query.skip + query.pageSize);
    return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Base product chart rate both AS OF a date (oldRate of the earliest change
   *  after the date, else current) AND the latest/current rate — so callers can
   *  tell whether the price has changed since the booking. */
  private async productRates(line: ConvertBookingLineDto, asOf: Date): Promise<{ asOf: number; current: number }> {
    const product = uc(line.product) ?? uc(line.productName);
    const category = uc(line.pCategory);
    const subCategory = uc(line.subCategory);
    if (!product) return { asOf: 0, current: 0 };
    const row = await this.prisma.product.findFirst({
      where: {
        product,
        ...(category ? { category } : {}),
        ...(subCategory ? { subCategory } : {}),
        ...(line.psize != null ? { size: toNum(line.psize) } : {}),
      },
    });
    if (!row) return { asOf: 0, current: 0 };
    const current = row.rate ?? 0;
    const hist = await this.prisma.productRateHistory.findFirst({
      where: { productId: row.id, changedAt: { gt: asOf } },
      orderBy: { changedAt: 'asc' },
    });
    return { asOf: (hist ? hist.oldRate : row.rate) ?? 0, current };
  }

  /** Base design rate as of a date + current (same reconstruction as products). */
  private async designRates(line: ConvertBookingLineDto, asOf: Date): Promise<{ asOf: number; current: number }> {
    const designType = uc(line.designType) ?? uc(line.design);
    if (!designType || designType === 'NA') return { asOf: 0, current: 0 };
    const category = uc(line.pCategory);
    const subCategory = uc(line.subCategory);
    const row = await this.prisma.design.findFirst({
      where: { designType, ...(category ? { category } : {}), ...(subCategory ? { subCategory } : {}) },
    });
    // The item picker also offers named combinations (for example WL+LOGO).
    // Reconstruct each member's booking-date rate, then sum them just as the
    // current-price catalogue does. A legacy single design still takes priority.
    let members = row ? [row] : [];
    if (!row) {
      const combination = await this.prisma.combination.findFirst({
        where: {
          name: designType,
          designLinks: {
            some: {},
            every: { design: {
              ...(category ? { category } : {}),
              ...(subCategory ? { subCategory } : {}),
            } },
          },
        },
        include: { designLinks: { include: { design: true } } },
      });
      members = combination?.designLinks.map((link) => link.design) ?? [];
    }
    const rates = await Promise.all(members.map(async (design) => {
      const hist = await this.prisma.designRateHistory.findFirst({
        where: { designId: design.id, changedAt: { gt: asOf } },
        orderBy: { changedAt: 'asc' },
      });
      return { asOf: (hist ? hist.oldRate : design.rate) ?? 0, current: design.rate ?? 0 };
    }));
    return {
      asOf: round2(rates.reduce((sum, rate) => sum + rate.asOf, 0)),
      current: round2(rates.reduce((sum, rate) => sum + rate.current, 0)),
    };
  }

  /** Price one line at the booking-date rates + the customer's snapshotted deltas.
   *  Also exposes the current (latest) price — using the customer's CURRENT special
   *  rates when `currentSnapshot` is supplied — so the draw sheet can offer old-vs-new.
   *  A "new price" can come from a base chart-rate change OR a special-rate change. */
  private async priceLine(
    line: ConvertBookingLineDto,
    asOf: Date,
    snapshot: RateSnapshot,
    currentSnapshot: RateSnapshot = snapshot,
    /** This booking's settled size-class rates, keyed `CATEGORY|SUBCATEGORY`.
     *  Empty for any caller without a booking (e.g. `priceAsOf`). */
    agreed: AgreedRates = new Map(),
  ): Promise<BookingQuoteLine> {
    const p = await this.productRates(line, asOf);
    const d = await this.designRates(line, asOf);
    const key = {
      category: uc(line.pCategory) ?? '',
      subCategory: uc(line.subCategory) ?? '',
      product: uc(line.product) ?? uc(line.productName),
      designType: uc(line.designType) ?? uc(line.design),
    };
    const frozen = resolveSpecialRates(snapshot, key);
    const current = resolveSpecialRates(currentSnapshot, key);

    /*
     * A rate settled on the booking REPLACES the product side outright — the
     * chart rate and the party's own delta both step aside.
     *
     * Adding the delta on top would discount a number that was already the
     * negotiated one, so "6.5 cups at 62" would bill at 65 for a party holding
     * a standing +3 on that size. The design rate still applies: it prices work
     * done to the item, which is a separate agreement (and is absent on cups —
     * 509 of 511 cup lines carry no design).
     */
    const settled = agreed.get(`${key.category}|${key.subCategory}`) ?? null;
    const productBase = settled ?? p.asOf;
    const productDelta = settled != null ? 0 : frozen.productDelta;
    const rate = round2(productBase + d.asOf + productDelta + frozen.designDelta);
    /*
     * The "current" side deliberately uses the SAME settled rate.
     *
     * `priceChanged` exists to warn that the chart moved under a booking. A
     * settled rate is immune to that by definition, so reporting it as changed
     * would ask the operator to re-approve a price nothing can alter.
     */
    const currentProductBase = settled ?? p.current;
    const currentProductDelta = settled != null ? 0 : current.productDelta;
    const currentRate = round2(currentProductBase + d.current + currentProductDelta + current.designDelta);
    return {
      productName: uc(line.productName) ?? uc(line.product) ?? null,
      designType: uc(line.designType) ?? null,
      productRate: productBase,
      designRate: d.asOf,
      productDelta,
      designDelta: frozen.designDelta,
      rate,
      bookingRate: settled,
      currentProductRate: currentProductBase,
      currentDesignRate: d.current,
      currentProductDelta,
      currentDesignDelta: current.designDelta,
      currentRate,
      priceChanged: Math.abs(currentRate - rate) > 0.001,
      productFrom: frozen.productFrom,
      designFrom: frozen.designFrom,
    };
  }

  /** `CATEGORY|SUBCATEGORY` → the rate settled for it on this booking. */
  private async agreedRatesFor(bookingId: number): Promise<AgreedRates> {
    const rows = await this.prisma.bookingRate.findMany({ where: { bookingId } });
    return new Map(rows.map((r) => [`${r.pCategory}|${r.subCategory}`, r.rate]));
  }

  /** Lazily create (once) the real Order that holds a booking's converted lines. */
  private async ensureOrder(booking: Prisma.BookingGetPayload<object>): Promise<number> {
    if (booking.orderId) return booking.orderId;
    const order = await this.prisma.order.create({
      data: {
        customerId: booking.customerId,
        customerName: booking.customerName,
        agentName: booking.agentName,
        category: booking.category ?? 'SALES',
        orderDate: booking.bookingDate,
        priority: 'NORMAL',
        status: 'CONFIRMED',
        ordType: 'BOOKING',
        comment: `Converted from booking ${booking.code ?? `#${booking.id}`}`,
        userName: booking.userName,
      },
    });
    const code = order.code ?? `ORD-${order.id}`;
    if (!order.code) await this.prisma.order.update({ where: { id: order.id }, data: { code } });
    await this.prisma.booking.update({ where: { id: booking.id }, data: { orderId: order.id } });
    return order.id;
  }

  private async snapshotSpecialRates(customerId: number): Promise<RateSnapshot> {
    const [rates, logos] = await Promise.all([
      this.prisma.customerRate.findMany({ where: { customerId } }),
      this.prisma.customerLogoRestriction.findMany({ where: { customerId } }),
    ]);
    return {
      rates: rates.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        kind: r.kind as CustomerRateDto['kind'],
        scope: r.scope as CustomerRateDto['scope'],
        category: r.category,
        subCategory: r.subCategory,
        target: r.target,
        rate: r.rate,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      logos: logos.map((l) => ({
        id: l.id,
        customerId: l.customerId,
        scope: l.scope as CustomerLogoDto['scope'],
        category: l.category,
        subCategory: l.subCategory,
        createdAt: l.createdAt.toISOString(),
        updatedAt: l.updatedAt.toISOString(),
      })),
    };
  }

  private parseSnapshot(json: string | null): RateSnapshot {
    if (!json) return { rates: [], logos: [] };
    try {
      const parsed = JSON.parse(json) as Partial<RateSnapshot>;
      return { rates: parsed.rates ?? [], logos: parsed.logos ?? [] };
    } catch {
      return { rates: [], logos: [] };
    }
  }

  private statusFor(bags: number, kgs: number, convBags: number, convKgs: number): BookingStatus {
    const bagsDone = bags <= 0 || convBags >= bags - 0.001;
    const kgsDone = kgs <= 0 || convKgs >= kgs - 0.001;
    if (convBags <= 0 && convKgs <= 0) return 'OPEN';
    return bagsDone && kgsDone ? 'CONVERTED' : 'PARTIALLY_CONVERTED';
  }

  private codeFor(id: number): string {
    return `BKG-${String(id).padStart(5, '0')}`;
  }

  private async ensureCode(row: Row): Promise<Row> {
    if (row.code) return row;
    return this.prisma.booking.update({ where: { id: row.id }, data: { code: this.codeFor(row.id) }, include: INCLUDE });
  }

  /** Map booking.orderId → order code, for the DTO. */
  /**
   * Every order each booking's lines landed on, keyed by booking id.
   *
   * Read off `OrderItem.bookingId` — the same link the history and the PDF use —
   * because a booking is drawn down by as many dated orders as the customer
   * asks for. `Booking.orderId` is only the first of them.
   */
  private async linkedOrderMap(rows: { id: number }[]): Promise<Map<number, BookingLinkedOrderDto[]>> {
    const out = new Map<number, BookingLinkedOrderDto[]>();
    const ids = rows.map((r) => r.id);
    if (!ids.length) return out;
    const items = await this.prisma.orderItem.findMany({
      where: { bookingId: { in: ids } },
      select: { bookingId: true, order: { select: { id: true, code: true, orderDate: true, status: true } } },
      orderBy: [{ orderId: 'asc' }],
    });
    for (const it of items) {
      if (it.bookingId == null) continue;
      const list = out.get(it.bookingId) ?? [];
      if (list.some((o) => o.id === it.order.id)) continue; // one entry per order, not per line
      list.push({
        id: it.order.id,
        code: it.order.code ?? `ORD-${it.order.id}`,
        orderDate: it.order.orderDate.toISOString(),
        status: it.order.status,
      });
      out.set(it.bookingId, list);
    }
    return out;
  }

  private toDto(r: Row, linkedOrders: Map<number, BookingLinkedOrderDto[]>): BookingDto {
    const orders = linkedOrders.get(r.id) ?? [];
    const remainingBags = Math.max(0, round2(r.bags - r.convertedBags - (r.precloseBags ?? 0)));
    const remainingKgs = Math.max(0, round2(r.kgs - r.convertedKgs - (r.precloseKgs ?? 0)));
    return {
      id: r.id,
      code: r.code ?? this.codeFor(r.id),
      customerId: r.customerId,
      customerName: r.customerName,
      agentName: r.agentName,
      category: r.category,
      bookingDate: r.bookingDate.toISOString(),
      bags: r.bags,
      kgs: r.kgs,
      convertedBags: r.convertedBags,
      convertedKgs: r.convertedKgs,
      remainingBags,
      remainingKgs,
      status: r.status as BookingStatus,
      comment: r.comment,
      orderId: r.orderId,
      // The legacy single pointer, kept in step with the list it came from.
      orderCode: orders.find((o) => o.id === r.orderId)?.code ?? orders[0]?.code ?? null,
      orders,
      userName: r.userName,
      precloseBags: r.precloseBags,
      precloseKgs: r.precloseKgs,
      precloseComment: r.precloseComment,
      precloseByName: r.precloseByName,
      precloseAt: r.precloseAt ? r.precloseAt.toISOString() : null,
      items: r.items.map((it) => this.toItemDto(it)),
      rates: r.rates.map((rt) => this.toRateDto(rt)),
      conversions: r.conversions.map((c) => this.toConversionDto(c)),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toRateDto(r: Row['rates'][number]): BookingRateDto {
    return {
      id: r.id,
      bookingId: r.bookingId,
      pCategory: r.pCategory,
      subCategory: r.subCategory,
      rate: r.rate,
      userName: r.userName,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toItemDto(it: Row['items'][number]): BookingItemDto {
    return {
      id: it.id,
      bookingId: it.bookingId,
      pCategory: it.pCategory,
      bags: it.bags,
      kgs: it.kgs,
      convertedBags: it.convertedBags,
      convertedKgs: it.convertedKgs,
      remainingBags: Math.max(0, round2(it.bags - it.convertedBags)),
      remainingKgs: Math.max(0, round2(it.kgs - it.convertedKgs)),
      createdAt: it.createdAt.toISOString(),
      updatedAt: it.updatedAt.toISOString(),
    };
  }

  /** Clean + validate the create/update item lines: uppercase category, coerce
   *  numbers, drop rows with no quantity, require at least one usable line. */
  /**
   * Clean the settled rates: upper-cased keys, last-one-wins on a duplicated
   * size class, and anything without a positive rate dropped.
   *
   * A blank rate box is "no deal on this size", not "this size is free" — and
   * the unique index would reject the duplicate anyway, with a 500 rather than
   * something the operator could act on.
   */
  private normalizeRates(rates: CreateBookingRateDto[] | undefined): { pCategory: string; subCategory: string; rate: number }[] {
    const out = new Map<string, { pCategory: string; subCategory: string; rate: number }>();
    for (const r of rates ?? []) {
      const pCategory = uc(r.pCategory) ?? '';
      const subCategory = uc(r.subCategory) ?? '';
      const rate = toNum(r.rate) ?? 0;
      if (!pCategory || !subCategory || rate <= 0) continue;
      out.set(`${pCategory}|${subCategory}`, { pCategory, subCategory, rate: round2(rate) });
    }
    return [...out.values()];
  }

  private normalizeItems(items: CreateBookingItemDto[]): { pCategory: string; bags: number; kgs: number }[] {
    const cleaned = (items ?? [])
      .map((it) => ({ pCategory: (uc(it.pCategory) ?? '') as string, bags: toNum(it.bags) ?? 0, kgs: toNum(it.kgs) ?? 0 }))
      // A line earns its place by carrying a QUANTITY, not a category. The
      // category is optional — a party can reserve capacity before deciding what
      // to make of it — and requiring one here silently discarded exactly those
      // lines, so a booking of "81 bags, category not decided" arrived at the
      // server as an empty list and was refused as if nothing had been entered.
      .filter((it) => it.bags > 0 || it.kgs > 0);
    if (!cleaned.length) throw new BadRequestException('Add at least one line with bags and/or kgs.');
    const seen = new Set<string>();
    let blank = 0;
    for (const it of cleaned) {
      // Blank categories are all the same "not decided yet" bucket, so more than
      // one just splits a number with no reason to be split — but they must not
      // be reported as a duplicate of each other by name, which would read as
      // "' ' is listed more than once".
      if (!it.pCategory) {
        blank += 1;
        if (blank > 1) {
          throw new BadRequestException('Only one line can be left without a category — combine them into one.');
        }
        continue;
      }
      if (seen.has(it.pCategory)) throw new BadRequestException(`${it.pCategory} is listed more than once — combine it into one line.`);
      seen.add(it.pCategory);
    }
    return cleaned;
  }

  private toConversionDto(c: Row['conversions'][number]): BookingConversionDto {
    return {
      id: c.id,
      bookingId: c.bookingId,
      orderItemId: c.orderItemId,
      productName: c.productName,
      designType: c.designType,
      bags: c.bags,
      kgs: c.kgs,
      pcs: c.pcs,
      box: c.box,
      frozenRate: c.frozenRate,
      amount: c.amount,
      convertedByName: c.convertedByName,
      convertedAt: c.convertedAt.toISOString(),
      orderId: c.orderId,
      orderCode: c.orderCode,
      orderDate: c.orderDate ? c.orderDate.toISOString() : null,
      removedAt: c.removedAt ? c.removedAt.toISOString() : null,
      removedReason: c.removedReason as BookingConversionDto['removedReason'],
      removedByName: c.removedByName,
    };
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* ── Booking PDF document (Tally-style black & white) ────────────────────── */

interface BookingPdfLine {
  productName: string | null;
  designType: string | null;
  bags: number | null;
  kgs: number | null;
  pcs: number | null;
  rate: number | null;
  amount: number;
  status: string;
  /** PENDING = nothing shipped yet, PARTIAL = some shipped, FULL = a "FULLY
   *  DISPATCH" record exists — mirrors the same status Dispatch Order uses. */
  dispatchStatus: 'PENDING' | 'PARTIAL' | 'FULL';
  dispatchedBags: number;
  dispatchedKgs: number;
  dispatchedPcs: number;
  /** Invoice(s) this line's dispatch(es) were billed on, if any. */
  challanCodes: string[];
  /** Set once this line stopped counting toward the booking's converted qty —
   *  cancelled, its order cancelled, or (for a ghost line) hard-deleted
   *  outright. Null for a still-live line. */
  removedAt: Date | null;
  /** Extra detail to print under the product name on a LIVE line — carries the
   *  "why" on a dispatch-overage withdrawal, which has no order to explain it.
   *  A removed line prints its removal caption instead. */
  caption?: string | null;
  removedReason: string | null;
  removedByName: string | null;
}

/** One line of the dispatch register printed after the booking statement. */
interface BookingPdfDispatchRow {
  orderCode: string;
  orderDate: Date | null;
  dispatchDate: Date;
  productName: string | null;
  designType: string | null;
  bags: number | null;
  kgs: number | null;
  pcs: number | null;
  box: number | null;
  /** A reversal (quantities are negative) rather than an outward movement. */
  returned: boolean;
  remarks: string | null;
}

interface BookingPdfOrderGroup {
  orderCode: string;
  orderDate: Date;
  /** Replaces the whole "Order X · date · status" block heading. Used by the
   *  dispatch-overage group, which is not an order at all. */
  heading?: string;
  /** 'DELETED' for a ghost group whose order no longer exists at all — not a
   *  real Order.status value. */
  orderStatus: string;
  lines: BookingPdfLine[];
}

interface BookingPdfData {
  code: string;
  customerName: string;
  agentName: string | null;
  category: string | null;
  bookingDate: Date;
  bags: number;
  kgs: number;
  convertedBags: number;
  convertedKgs: number;
  remainingBags: number;
  remainingKgs: number;
  status: string;
  comment: string | null;
  precloseBags: number | null;
  precloseKgs: number | null;
  precloseComment: string | null;
  precloseByName: string | null;
  precloseAt: Date | null;
  groups: BookingPdfOrderGroup[];
  dispatches: BookingPdfDispatchRow[];
}

const PDF_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** Compact d-MMM-yy date, matching the Party Ledger PDF's convention. */
const pdfDate = (value: Date | string | null): string => {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()}-${PDF_MONTHS[date.getMonth()]}-${String(date.getFullYear()).slice(-2)}`;
};
/** Tally convention: two decimals, zero cell left blank. */
const amt2 = (v: number | null | undefined) => (v ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
/** Same, but zero prints as 0.00 (used in the summary strip, never blank). */
const amt2z = (v: number | null | undefined) => (v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BOOKING_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  PARTIALLY_CONVERTED: 'Partially Converted',
  CONVERTED: 'Fully Converted',
  CANCELLED: 'Cancelled',
  PRECLOSED: 'Preclosed',
};

/**
 * A Tally "statement" for one bag booking: plain black on white with no fills
 * or accent colour, a centred masthead, and every order-item this booking ever
 * drew down grouped under the Order it landed on — mirroring the Party Ledger
 * PDF's grammar (see `party-ledger.service.ts`'s `buildLedgerDoc`) so every
 * printed document in the app reads as one consistent house style.
 */
function buildBookingPdfDoc(b: BookingPdfData): TDocumentDefinitions {
  const BLACK = '#000000';
  const pageWidth = 595 - 36;
  const BODY = 9;
  type Cell = Record<string, unknown>;
  const txt = (text: string, extra: Cell = {}): Cell => ({ text, fontSize: BODY, lineHeight: 1.12, color: BLACK, ...extra });
  const num = (text: string, extra: Cell = {}): Cell => ({ text, fontSize: BODY, alignment: 'right', noWrap: true, color: BLACK, ...extra });
  const head = (text: string, extra: Cell = {}): Cell => ({ text, fontSize: BODY + 0.5, bold: true, characterSpacing: 0.3, color: BLACK, ...extra });

  const COLS = 8; // Product, Design, Bags, Kgs, Pcs, Rate, Amount, Dispatch
  /*
   * Fixed widths, in points, for everything except Product (which takes the
   * slack). Sized to the widest value each column really carries at 9pt: Pcs
   * was 26pt while printing figures like "1,200.00" (~40pt), so the number ran
   * out of its cell — and Bags/Kgs were only a little better, with the Order
   * Total row pushing "4,400.00" through a 32pt column.
   */
  //                     Product Design Bags Kgs Pcs Rate Amount Dispatch
  const COL_WIDTHS = ['*', 48, 38, 46, 46, 38, 62, 92];
  const colRow: Cell[] = [
    head('Product'),
    head('Design'),
    head('Bags', { alignment: 'right' }),
    head('Kgs', { alignment: 'right' }),
    head('Pcs', { alignment: 'right' }),
    head('Rate', { alignment: 'right' }),
    head('Amount', { alignment: 'right' }),
    head('Dispatch / Challan'),
  ];
  const spanRow = (cell: Cell): Cell[] => [{ ...cell, colSpan: COLS }, ...Array.from({ length: COLS - 1 }, () => ({ text: '' }))];

  const DISPATCH_LABEL: Record<BookingPdfLine['dispatchStatus'], string> = {
    PENDING: 'Pending',
    PARTIAL: 'Partial Dispatch',
    FULL: 'Full Dispatch',
  };
  const dispatchCell = (l: BookingPdfLine, style: Cell): Cell => {
    // Spelled out rather than "5.00b 354.60k": the single-letter suffixes were
    // this table's own shorthand, and nothing on the page explained them.
    const qtyBits = [
      l.dispatchedBags ? `${amt2(l.dispatchedBags)} Bags` : null,
      l.dispatchedKgs ? `${amt2(l.dispatchedKgs)} Kgs` : null,
      l.dispatchedPcs ? `${amt2(l.dispatchedPcs)} Pcs` : null,
    ].filter(Boolean);
    return {
      stack: [
        { text: DISPATCH_LABEL[l.dispatchStatus], fontSize: BODY, bold: l.dispatchStatus === 'FULL', ...style },
        // Raised from BODY-2 (7pt). This column carries the answer to "was it
        // sent, how much, and on which bill" — it was set two points smaller
        // than everything around it, which made the one part of the row someone
        // squints at the hardest part to read.
        ...(qtyBits.length ? [{ text: qtyBits.join(' / '), fontSize: BODY - 0.5, ...style }] : []),
        // One challan per LINE, not comma-run. Several bills wrapped mid-code
        // ("SSS/26-27/564," then "SSS/26-27/568, SSS/26-27/597"), so the break
        // fell wherever the column ran out rather than between two numbers.
        // A line each makes them countable at a glance.
        ...(l.challanCodes.length
          ? [{ stack: l.challanCodes.map((code) => ({ text: code, fontSize: BODY - 0.5, ...style })) }]
          : []),
      ],
    };
  };

  const REMOVED_LABEL: Record<string, string> = {
    LINE_CANCELLED: 'Cancelled',
    ORDER_CANCELLED: 'Order cancelled',
    LINE_DELETED: 'Deleted',
  };

  const lineRow = (l: BookingPdfLine): Cell[] => {
    // Ground truth is `removedAt`, not `status` — a line whose own status is
    // still CONFIRMED but whose PARENT ORDER was cancelled no longer counts
    // either, and this is the only check that catches that case too.
    const removed = !!l.removedAt;
    const style = removed ? { italics: true } : {};
    const label = l.removedReason ? (REMOVED_LABEL[l.removedReason] ?? 'Removed') : null;
    const suffix = label ? `  (${label})` : '';
    // The whole point of this feature: exactly how this qty was used, and
    // when/by whom it stopped counting — printed right under the line so
    // there's no need to cross-reference anything else to see it.
    const caption = removed
      ? [label, l.removedByName ? `by ${l.removedByName}` : null, l.removedAt ? pdfDate(l.removedAt) : null].filter(Boolean).join(' · ')
      : (l.caption ?? null);
    const productCell: Cell = caption
      ? { stack: [{ text: `${l.productName ?? '—'}${suffix}`, fontSize: BODY, lineHeight: 1.12, color: BLACK, ...style }, { text: caption, fontSize: BODY - 2.5, italics: true, color: '#555555' }] }
      : txt(`${l.productName ?? '—'}${suffix}`, style);
    return [
      productCell,
      txt(l.designType ?? '—', style),
      num(amt2(l.bags), style),
      num(amt2(l.kgs), style),
      num(amt2(l.pcs), style),
      num(amt2(l.rate), style),
      num(amt2(l.amount), style),
      dispatchCell(l, style),
    ];
  };

  const subtotalRow = (g: BookingPdfOrderGroup): Cell[] => {
    const active = g.lines.filter((l) => !l.removedAt);
    const bags = round2(active.reduce((s, l) => s + (l.bags ?? 0), 0));
    const kgs = round2(active.reduce((s, l) => s + (l.kgs ?? 0), 0));
    const amount = round2(active.reduce((s, l) => s + l.amount, 0));
    return [
      txt(''),
      txt('Order Total', { bold: true, fontSize: BODY - 0.5 }),
      num(amt2z(bags), { bold: true }),
      num(amt2z(kgs), { bold: true }),
      txt(''),
      txt(''),
      num(amt2z(amount), { bold: true }),
      txt(''),
    ];
  };

  // Each order is its own boxed block — a bordered table of its own, under its
  // own bold "Order …" label — rather than one continuous table for the whole
  // booking. Deliberately NOT `unbreakable`: pdfmake silently drops an
  // unbreakable block entirely once it's taller than one page (confirmed on a
  // booking with 40+ lines under one order — the whole table vanished), so a
  // large order is instead left free to paginate normally, repeating its own
  // header row (`headerRows: 1`) on the next page like any other long table.
  const orderBlocks = b.groups.map((g) => {
    const rows: Cell[][] = [colRow, ...g.lines.map(lineRow), subtotalRow(g)];
    const totalsAt = rows.length - 1;
    return {
      stack: [
        { text: g.heading ?? `Order ${g.orderCode}   ·   ${pdfDate(g.orderDate)}   ·   ${g.orderStatus}`, bold: true, fontSize: BODY + 0.5, margin: [1, 0, 0, 3] },
        {
          table: { headerRows: 1, dontBreakRows: true, widths: COL_WIDTHS, body: rows },
          layout: {
            hLineWidth: (i: number) => (i === 0 || i === 1 || i === totalsAt || i === rows.length ? 1 : 0.4),
            vLineWidth: () => 0.8,
            hLineColor: () => BLACK,
            vLineColor: () => BLACK,
            paddingLeft: () => 3,
            paddingRight: () => 3,
            paddingTop: () => 4,
            paddingBottom: () => 4,
          },
        },
      ],
      margin: [0, 0, 0, 12],
    };
  });

  const active = b.groups.flatMap((g) => g.lines.filter((l) => !l.removedAt));
  const grandTotalRow: Cell[] = [
    txt(''),
    txt('Grand Total', { bold: true, fontSize: BODY + 0.5 }),
    num(amt2z(round2(active.reduce((s, l) => s + (l.bags ?? 0), 0))), { bold: true, fontSize: BODY + 0.5 }),
    num(amt2z(round2(active.reduce((s, l) => s + (l.kgs ?? 0), 0))), { bold: true, fontSize: BODY + 0.5 }),
    txt(''),
    txt(''),
    num(amt2z(round2(active.reduce((s, l) => s + l.amount, 0))), { bold: true, fontSize: BODY + 0.5 }),
    txt(''),
  ];
  const grandTotalBlock = {
    unbreakable: true,
    table: { widths: COL_WIDTHS, body: [grandTotalRow] },
    layout: {
      hLineWidth: () => 1.5,
      vLineWidth: () => 0.8,
      hLineColor: () => BLACK,
      vLineColor: () => BLACK,
      paddingLeft: () => 3,
      paddingRight: () => 3,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
  };

  /*
   * ── Dispatch register ───────────────────────────────────────────────────
   *
   * Its own page, in the same grammar as the order blocks above: same rule
   * weights, same 9pt body, same right-aligned figures — so it reads as the
   * second half of one document rather than something bolted on.
   *
   * Printed ONLY when there is at least one dispatch. A booking that has not
   * shipped anything yet would otherwise get a whole blank page carrying one
   * line of apology.
   */
  //                    Order   OrdDate DspDate Item Design Bags Kgs Pcs Box Remarks
  const D_WIDTHS = [50, 54, 54, '*', 44, 34, 44, 40, 30, 76];
  /*
   * The two dates are set a point above the rest of the row.
   *
   * They are what this page is read FOR — when each lot was ordered and when it
   * actually left — and at body size they sat level with the codes and figures
   * around them. `noWrap` because the extra point is enough to break
   * "18-Aug-26" across two lines, which is what the wider columns above pay for.
   */
  const dateCell = (value: Date | null, style: Cell): Cell => ({
    text: pdfDate(value),
    fontSize: BODY + 1,
    noWrap: true,
    color: BLACK,
    ...style,
  });
  const dispatchHeadRow: Cell[] = [
    head('Order ID'),
    head('Order Date'),
    head('Dispatch Date'),
    head('Item Name'),
    head('Design'),
    head('Bags', { alignment: 'right' }),
    head('Kgs', { alignment: 'right' }),
    head('Pcs', { alignment: 'right' }),
    head('Box', { alignment: 'right' }),
    head('Remarks'),
  ];
  const dispatchRow = (d: BookingPdfDispatchRow): Cell[] => {
    // A return is set in italics and says so in Remarks. Its figures are
    // already negative, so it reads as the reversal it is without the reader
    // having to know that.
    const style = d.returned ? { italics: true } : {};
    const remarks = [d.returned ? 'Returned' : null, d.remarks].filter(Boolean).join(' · ');
    return [
      txt(d.orderCode, style),
      dateCell(d.orderDate, style),
      dateCell(d.dispatchDate, style),
      txt(d.productName ?? '—', style),
      txt(d.designType ?? '—', style),
      num(amt2(d.bags), style),
      num(amt2(d.kgs), style),
      num(amt2(d.pcs), style),
      num(amt2(d.box), style),
      { ...txt(remarks || '', style), fontSize: BODY - 1 },
    ];
  };
  const dSum = (pick: (d: BookingPdfDispatchRow) => number | null) =>
    round2(b.dispatches.reduce((acc, d) => acc + (pick(d) ?? 0), 0));
  const dispatchTotalRow: Cell[] = [
    txt(''),
    txt(''),
    txt(''),
    txt('Total dispatched', { bold: true }),
    txt(''),
    num(amt2z(dSum((d) => d.bags)), { bold: true }),
    num(amt2z(dSum((d) => d.kgs)), { bold: true }),
    num(amt2z(dSum((d) => d.pcs)), { bold: true }),
    num(amt2z(dSum((d) => d.box)), { bold: true }),
    txt(''),
  ];
  const dispatchRows: Cell[][] = [dispatchHeadRow, ...b.dispatches.map(dispatchRow), dispatchTotalRow];
  const dTotalsAt = dispatchRows.length - 1;
  const hasReturns = b.dispatches.some((d) => d.returned);
  const dispatchBlocks: Cell[] = b.dispatches.length
    ? [
        {
          pageBreak: 'before',
          stack: [
            { text: 'Dispatch Details', bold: true, fontSize: 13, alignment: 'center' },
            {
              text: `${b.customerName.toUpperCase()}   ·   Booking ${b.code}`,
              fontSize: 9.5,
              alignment: 'center',
              margin: [0, 2, 0, 0],
            },
            {
              text: 'Every dispatch made against this booking, oldest first.',
              fontSize: 8.5,
              italics: true,
              alignment: 'center',
              margin: [0, 2, 0, 0],
            },
          ],
          margin: [0, 0, 0, 5],
        },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: pageWidth, y2: 0, lineWidth: 1, lineColor: BLACK }], margin: [0, 0, 0, 6] },
        {
          // `headerRows: 1` so a long register repeats its own column heads on
          // each page — the same reason the order blocks do.
          table: { headerRows: 1, dontBreakRows: true, widths: D_WIDTHS, body: dispatchRows },
          layout: {
            hLineWidth: (i: number) => (i === 0 || i === 1 || i === dTotalsAt || i === dispatchRows.length ? 1 : 0.4),
            vLineWidth: () => 0.8,
            hLineColor: () => BLACK,
            vLineColor: () => BLACK,
            paddingLeft: () => 3,
            paddingRight: () => 3,
            paddingTop: () => 4,
            paddingBottom: () => 4,
          },
        },
        ...(hasReturns
          ? [
              {
                text: 'Returned rows carry negative quantities and are included in the totals above.',
                fontSize: 8,
                italics: true,
                margin: [0, 4, 0, 0],
              } as Cell,
            ]
          : []),
      ]
    : [];
  const summaryCell = (label: string, bags: number, kgs: number): Cell => ({
    stack: [
      { text: label, fontSize: 9, bold: true, characterSpacing: 0.4 },
      { text: `${amt2z(bags)} bags`, fontSize: 12, bold: true, margin: [0, 2, 0, 0] },
      { text: `${amt2z(kgs)} kgs`, fontSize: 9.5, margin: [0, 1, 0, 0] },
    ],
    margin: [8, 5, 8, 5],
  });
  const preclosed = b.status === 'PRECLOSED';
  const summaryCells: Cell[] = [
    summaryCell('BOOKED', b.bags, b.kgs),
    summaryCell('CONVERTED', b.convertedBags, b.convertedKgs),
    summaryCell(preclosed ? 'STILL PENDING' : 'REMAINING', b.remainingBags, b.remainingKgs),
    ...(preclosed ? [summaryCell('WRITTEN OFF', b.precloseBags ?? 0, b.precloseKgs ?? 0)] : []),
  ];

  return {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [18, 22, 18, 32],
    defaultStyle: { font: 'Calibri', fontSize: BODY, color: BLACK },
    content: [
      {
        stack: [
          { text: b.customerName.toUpperCase(), bold: true, fontSize: 15, alignment: 'center' },
          { text: 'Bag Booking Statement', fontSize: 11.5, alignment: 'center', margin: [0, 1, 0, 0] },
          {
            text: `Booking ${b.code}${b.agentName ? `   ·   Agent: ${b.agentName}` : ''}   ·   ${b.category ?? 'SALES'}`,
            fontSize: 10,
            alignment: 'center',
            margin: [0, 3, 0, 0],
          },
          { text: `Booking date: ${pdfDate(b.bookingDate)}`, fontSize: 10.5, bold: true, alignment: 'center', margin: [0, 6, 0, 0] },
          {
            text: `Status: ${BOOKING_STATUS_LABEL[b.status] ?? b.status}   ·   Amounts in INR`,
            fontSize: 9,
            alignment: 'center',
            margin: [0, 2, 0, 0],
          },
        ],
        margin: [0, 0, 0, 5],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: pageWidth, y2: 0, lineWidth: 1, lineColor: BLACK }], margin: [0, 0, 0, 6] },

      {
        unbreakable: true,
        table: { widths: summaryCells.map(() => '*'), body: [summaryCells] },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => BLACK,
          vLineColor: () => BLACK,
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0,
        },
        margin: [0, 0, 0, preclosed ? 4 : 10],
      },
      ...(preclosed
        ? [
            {
              text: `Preclosed ${pdfDate(b.precloseAt)}${b.precloseByName ? ` by ${b.precloseByName}` : ''}${b.precloseComment ? ` — ${b.precloseComment}` : ''}`,
              fontSize: 8.5,
              italics: true,
              margin: [0, 0, 0, 10],
            },
          ]
        : []),

      ...(orderBlocks.length
        ? [...orderBlocks, grandTotalBlock]
        : [{ text: 'Nothing converted from this booking yet.', italics: true, alignment: 'center', margin: [0, 8, 0, 8] }]),

      ...(b.comment ? [{ text: `Comment: ${b.comment}`, fontSize: 9, italics: true, margin: [0, 10, 0, 0] }] : []),

      // ── Page 2 onwards: the dispatch register ──────────────────────────────
      ...dispatchBlocks,
    ],
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `Generated ${new Date().toLocaleString('en-GB')}`, fontSize: 8, color: BLACK, margin: [24, 0, 0, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, bold: true, color: BLACK, alignment: 'right', margin: [0, 0, 24, 0] },
      ],
      margin: [0, 6, 0, 0],
    }),
  } as unknown as TDocumentDefinitions;
}
