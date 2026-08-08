import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  type BookingConversionDto,
  type BookingDto,
  type BookingItemDto,
  type BookingQuoteLine,
  type BookingQuoteResult,
  type BookingStatus,
  type CustomerLogoDto,
  type CustomerRateDto,
  type LinkableOrderItemDto,
  type Paginated,
  type PriceHistoryList,
  type RateChangeEntry,
  type RateHistoryKind,
  resolveSpecialRates,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { toNum, toStr, uc } from '../common/coerce';
import {
  BookingQueryDto,
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

const INCLUDE = { conversions: { orderBy: { convertedAt: 'asc' } }, items: { orderBy: { id: 'asc' } } } as const;
type Row = Prisma.BookingGetPayload<{ include: typeof INCLUDE }>;

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
    const orderCodes = await this.orderCodeMap(rows);
    return {
      items: rows.map((r) => this.toDto(r, orderCodes)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOne(id: number): Promise<BookingDto> {
    const row = await this.prisma.booking.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundException('Booking not found.');
    const orderCodes = await this.orderCodeMap([row]);
    return this.toDto(row, orderCodes);
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
        items: { create: items.map((it) => ({ pCategory: it.pCategory, bags: it.bags, kgs: it.kgs })) },
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
      data.items = { deleteMany: {}, create: items.map((it) => ({ pCategory: it.pCategory, bags: it.bags, kgs: it.kgs })) };
      itemsChanged = true;
    }

    await this.prisma.booking.update({ where: { id }, data });
    // Repopulate the fresh items' convertedBags/Kgs (deleteMany+create above reset them to 0).
    if (itemsChanged) await this.recompute(id);
    return this.findOne(id);
  }

  /** Cancel a booking. Only allowed while nothing has been converted yet. */
  async cancel(id: number): Promise<BookingDto> {
    const booking = await this.prisma.booking.findUnique({ where: { id }, select: { id: true, convertedBags: true, convertedKgs: true } });
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.convertedBags > 0 || booking.convertedKgs > 0) {
      throw new BadRequestException('This booking already has conversions — it can no longer be cancelled.');
    }
    await this.prisma.booking.update({ where: { id }, data: { status: 'CANCELLED' } });
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    const booking = await this.prisma.booking.findUnique({ where: { id }, select: { convertedBags: true, convertedKgs: true } });
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.convertedBags > 0 || booking.convertedKgs > 0) {
      throw new BadRequestException('This booking already has conversions — it cannot be deleted.');
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

    // Dispatch + Challan, per line — a two-hop lookup since ChallanItem only
    // carries dispatchId, not orderItemId (mirrors OrdersService.timeline()).
    const orderItemIds = orderItems.map((it) => it.id);
    const dispatches = orderItemIds.length
      ? await this.prisma.dispatch.findMany({
          where: { orderItemId: { in: orderItemIds } },
          select: { id: true, orderItemId: true, bags: true, pcs: true, gram: true, dispatchStatus: true },
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

    const groups = new Map<number, BookingPdfOrderGroup>();
    for (const it of orderItems) {
      let group = groups.get(it.order.id);
      if (!group) {
        group = {
          orderCode: it.order.code ?? `ORD-${String(it.order.id).padStart(5, '0')}`,
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
      });
    }

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
        groups: [...groups.values()],
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
        order: { customerName: booking.customerName, status: { notIn: ['CANCELLED', 'DRAFT'] } },
        ...(search ? { OR: [{ productName: { contains: search } }, { order: { code: { contains: search } } }] } : {}),
      },
      include: { order: { select: { id: true, code: true, orderDate: true } } },
      orderBy: { order: { orderDate: 'desc' } },
      take: 200,
    });
    return rows.map((it) => ({
      orderItemId: it.id,
      orderId: it.order.id,
      orderCode: it.order.code ?? `ORD-${String(it.order.id).padStart(5, '0')}`,
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
    if (addBags - remBags > 0.001) throw new BadRequestException(`Assigning ${addBags} bags exceeds the ${remBags} remaining on this booking.`);
    if (addKgs - remKgs > 0.001) throw new BadRequestException(`Assigning ${addKgs} kgs exceeds the ${remKgs} remaining on this booking.`);

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
    const lines: BookingQuoteLine[] = [];
    for (const line of dto.lines ?? []) {
      lines.push(await this.priceLine(line, booking.bookingDate, snapshot, currentSnapshot));
    }
    return { bookingDate: booking.bookingDate.toISOString(), lines };
  }

  /* ── Convert (draw down bags/kgs into real order lines) ──────────────────── */

  async convert(id: number, dto: ConvertBookingDto, userName?: string | null): Promise<BookingDto> {
    const booking = await this.prisma.booking.findUnique({ where: { id }, include: { items: true } });
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'CANCELLED') throw new BadRequestException('A cancelled booking cannot be converted.');

    const lines = (dto.lines ?? []).filter((l) => (l.productName || l.product));
    if (!lines.length) throw new BadRequestException('Add at least one item to convert.');

    const addBags = lines.reduce((s, l) => s + (toNum(l.bags) ?? 0), 0);
    const addKgs = lines.reduce((s, l) => s + (toNum(l.gram) ?? 0), 0);
    const remBags = round2(booking.bags - booking.convertedBags);
    const remKgs = round2(booking.kgs - booking.convertedKgs);
    if (addBags - remBags > 0.001) throw new BadRequestException(`Converting ${addBags} bags exceeds the ${remBags} remaining on this booking.`);
    if (addKgs - remKgs > 0.001) throw new BadRequestException(`Converting ${addKgs} kgs exceeds the ${remKgs} remaining on this booking.`);

    // Per-category remaining check — best-effort: only enforced for a line whose
    // pCategory matches a category actually booked. A line with no match (or no
    // pCategory) is still bound by the overall remaining check above.
    const addByCategory = new Map<string, { bags: number; kgs: number }>();
    for (const l of lines) {
      const cat = uc(l.pCategory);
      if (!cat) continue;
      const acc = addByCategory.get(cat) ?? { bags: 0, kgs: 0 };
      acc.bags += toNum(l.bags) ?? 0;
      acc.kgs += toNum(l.gram) ?? 0;
      addByCategory.set(cat, acc);
    }
    for (const [cat, add] of addByCategory) {
      const item = booking.items.find((it) => it.pCategory === cat);
      if (!item) continue;
      const remBagsCat = round2(item.bags - item.convertedBags);
      const remKgsCat = round2(item.kgs - item.convertedKgs);
      if (add.bags - remBagsCat > 0.001) throw new BadRequestException(`Converting ${add.bags} bags of ${cat} exceeds the ${remBagsCat} remaining booked for ${cat}.`);
      if (add.kgs - remKgsCat > 0.001) throw new BadRequestException(`Converting ${add.kgs} kgs of ${cat} exceeds the ${remKgsCat} remaining booked for ${cat}.`);
    }

    const snapshot = this.parseSnapshot(booking.rateSnapshot);

    // Ensure the booking's order exists (created lazily on first conversion), then
    // append the priced lines to it. Rates are frozen as of the booking date.
    const orderId = await this.ensureOrder(booking);

    for (const line of lines) {
      const priced = await this.priceLine(line, booking.bookingDate, snapshot);
      await this.prisma.orderItem.create({
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
          status: 'CONFIRMED',
          comment: toStr(line.comment),
        },
      });
    }

    // The draw-down (converted bags/kgs + the audit rows) is always derived from
    // the OrderItems that carry this bookingId — one source of truth for every
    // path (standalone convert AND drawing a booking into an order form line).
    await this.recompute(booking.id);
    return this.findOne(id);
  }

  /**
   * Recompute a booking's draw-down from the real OrderItems that reference it.
   * `convertedBags/Kgs` + `status` are the sum over every non-cancelled line (on a
   * non-cancelled order) with this bookingId, and the `BookingConversion` audit
   * rows are rebuilt to mirror them. Idempotent — safe to call after any change.
   */
  async recompute(bookingId: number): Promise<void> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { items: true } });
    if (!booking) return;
    const items = await this.prisma.orderItem.findMany({
      where: { bookingId, status: { not: 'CANCELLED' }, order: { status: { not: 'CANCELLED' } } },
      include: { order: { select: { userName: true } } },
      orderBy: { id: 'asc' },
    });
    // Link the booking to the (first) order its lines live on — this is the order
    // the standalone-convert path created, or the order it was drawn into via the
    // order form. Falls back to null once every drawn line is gone.
    const orderId = items[0]?.orderId ?? null;
    const convertedBags = round2(items.reduce((s, it) => s + (it.bags ?? 0), 0));
    const convertedKgs = round2(items.reduce((s, it) => s + (it.gram ?? 0), 0));
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
    for (const bookingItem of booking.items) {
      const matching = items.filter((it) => (uc(it.pCategory) ?? '') === bookingItem.pCategory);
      const itemConvertedBags = round2(matching.reduce((s, it) => s + (it.bags ?? 0), 0));
      const itemConvertedKgs = round2(matching.reduce((s, it) => s + (it.gram ?? 0), 0));
      if (itemConvertedBags !== bookingItem.convertedBags || itemConvertedKgs !== bookingItem.convertedKgs) {
        await this.prisma.bookingItem.update({ where: { id: bookingItem.id }, data: { convertedBags: itemConvertedBags, convertedKgs: itemConvertedKgs } });
      }
    }

    await this.prisma.bookingConversion.deleteMany({ where: { bookingId } });
    if (items.length) {
      await this.prisma.bookingConversion.createMany({
        data: items.map((it) => {
          const qty = it.calField === 'PCS' ? it.pcs ?? 0 : it.gram ?? 0;
          return {
            bookingId,
            orderItemId: it.id,
            productName: it.productName,
            designType: it.designType,
            bags: it.bags,
            kgs: it.gram,
            pcs: it.pcs,
            box: it.box,
            frozenRate: it.rate,
            amount: (it.rate ?? 0) * qty,
            convertedByName: it.order?.userName ?? null,
            convertedAt: it.createdAt,
          };
        }),
      });
    }
    await this.prisma.booking.update({ where: { id: bookingId }, data: { convertedBags, convertedKgs, status, orderId } });
  }

  /** Remaining bags/kgs on a booking, optionally excluding one order's draw
   *  (used when re-saving that order so its own lines don't count twice). */
  async remainingFor(bookingId: number, excludeOrderId?: number) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return null;
    const items = await this.prisma.orderItem.findMany({
      where: {
        bookingId,
        status: { not: 'CANCELLED' },
        order: { status: { not: 'CANCELLED' }, ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}) },
      },
      select: { bags: true, gram: true },
    });
    const drawnBags = round2(items.reduce((s, it) => s + (it.bags ?? 0), 0));
    const drawnKgs = round2(items.reduce((s, it) => s + (it.gram ?? 0), 0));
    // Written-off qty (if preclosed) counts against remaining too — belt-and-
    // braces alongside assertBookingCapacity's own PRECLOSED check, since this is
    // also called for the on-screen remainingBags/Kgs display.
    return {
      booking,
      remBags: round2(booking.bags - drawnBags - (booking.precloseBags ?? 0)),
      remKgs: round2(booking.kgs - drawnKgs - (booking.precloseKgs ?? 0)),
    };
  }

  /** Price one order line at a booking's frozen (booking-date) rates. Returns the
   *  effective productRate/designRate (incl. the snapshotted special deltas) + total. */
  async priceOrderLine(bookingId: number, line: ConvertBookingLineDto): Promise<BookingQuoteLine | null> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return null;
    return this.priceLine(line, booking.bookingDate, this.parseSnapshot(booking.rateSnapshot));
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
    if (!row) return { asOf: 0, current: 0 };
    const current = row.rate ?? 0;
    const hist = await this.prisma.designRateHistory.findFirst({
      where: { designId: row.id, changedAt: { gt: asOf } },
      orderBy: { changedAt: 'asc' },
    });
    return { asOf: (hist ? hist.oldRate : row.rate) ?? 0, current };
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
    const rate = round2(p.asOf + d.asOf + frozen.productDelta + frozen.designDelta);
    const currentRate = round2(p.current + d.current + current.productDelta + current.designDelta);
    return {
      productName: uc(line.productName) ?? uc(line.product) ?? null,
      designType: uc(line.designType) ?? null,
      productRate: p.asOf,
      designRate: d.asOf,
      productDelta: frozen.productDelta,
      designDelta: frozen.designDelta,
      rate,
      currentProductRate: p.current,
      currentDesignRate: d.current,
      currentProductDelta: current.productDelta,
      currentDesignDelta: current.designDelta,
      currentRate,
      priceChanged: Math.abs(currentRate - rate) > 0.001,
      productFrom: frozen.productFrom,
      designFrom: frozen.designFrom,
    };
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
    const code = order.code ?? `ORD-${String(order.id).padStart(5, '0')}`;
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
  private async orderCodeMap(rows: { orderId: number | null }[]): Promise<Map<number, string>> {
    const ids = rows.map((r) => r.orderId).filter((v): v is number => v != null);
    if (!ids.length) return new Map();
    const orders = await this.prisma.order.findMany({ where: { id: { in: ids } }, select: { id: true, code: true } });
    return new Map(orders.map((o) => [o.id, o.code ?? `ORD-${String(o.id).padStart(5, '0')}`]));
  }

  private toDto(r: Row, orderCodes: Map<number, string>): BookingDto {
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
      orderCode: r.orderId ? orderCodes.get(r.orderId) ?? null : null,
      userName: r.userName,
      precloseBags: r.precloseBags,
      precloseKgs: r.precloseKgs,
      precloseComment: r.precloseComment,
      precloseByName: r.precloseByName,
      precloseAt: r.precloseAt ? r.precloseAt.toISOString() : null,
      items: r.items.map((it) => this.toItemDto(it)),
      conversions: r.conversions.map((c) => this.toConversionDto(c)),
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
   *  numbers, drop blank rows, require at least one usable line. */
  private normalizeItems(items: CreateBookingItemDto[]): { pCategory: string; bags: number; kgs: number }[] {
    const cleaned = (items ?? [])
      .map((it) => ({ pCategory: (uc(it.pCategory) ?? '') as string, bags: toNum(it.bags) ?? 0, kgs: toNum(it.kgs) ?? 0 }))
      .filter((it) => it.pCategory && (it.bags > 0 || it.kgs > 0));
    if (!cleaned.length) throw new BadRequestException('Add at least one category line with bags and/or kgs.');
    const seen = new Set<string>();
    for (const it of cleaned) {
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
}

interface BookingPdfOrderGroup {
  orderCode: string;
  orderDate: Date;
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
  const COL_WIDTHS = ['*', 52, 32, 32, 26, 40, 52, 88];
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

  const DISPATCH_LABEL: Record<BookingPdfLine['dispatchStatus'], string> = { PENDING: 'Pending', PARTIAL: 'Partial', FULL: 'Full' };
  const dispatchCell = (l: BookingPdfLine, style: Cell): Cell => {
    const qtyBits = [l.dispatchedBags ? `${amt2(l.dispatchedBags)}b` : null, l.dispatchedKgs ? `${amt2(l.dispatchedKgs)}k` : null, l.dispatchedPcs ? `${amt2(l.dispatchedPcs)}p` : null].filter(Boolean);
    return {
      stack: [
        { text: DISPATCH_LABEL[l.dispatchStatus], fontSize: BODY - 0.5, bold: l.dispatchStatus === 'FULL', ...style },
        ...(qtyBits.length ? [{ text: qtyBits.join(' '), fontSize: BODY - 2, ...style }] : []),
        ...(l.challanCodes.length ? [{ text: l.challanCodes.join(', '), fontSize: BODY - 2, ...style }] : []),
      ],
    };
  };

  const lineRow = (l: BookingPdfLine): Cell[] => {
    const cancelled = l.status === 'CANCELLED';
    const style = cancelled ? { italics: true } : {};
    return [
      txt(`${l.productName ?? '—'}${cancelled ? '  (Cancelled)' : ''}`, style),
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
    const active = g.lines.filter((l) => l.status !== 'CANCELLED');
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

  // Each order is its own boxed, unbreakable block — never split across a page
  // and never runs into the next order's rows — rather than one continuous
  // table for the whole booking.
  const orderBlocks = b.groups.map((g) => {
    const rows: Cell[][] = [colRow, ...g.lines.map(lineRow), subtotalRow(g)];
    const totalsAt = rows.length - 1;
    return {
      unbreakable: true,
      stack: [
        { text: `Order ${g.orderCode}   ·   ${pdfDate(g.orderDate)}   ·   ${g.orderStatus}`, bold: true, fontSize: BODY + 0.5, margin: [1, 0, 0, 3] },
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

  const active = b.groups.flatMap((g) => g.lines.filter((l) => l.status !== 'CANCELLED'));
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
