import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type BookingConversionDto,
  type BookingDto,
  type BookingQuoteLine,
  type BookingQuoteResult,
  type BookingStatus,
  type CustomerLogoDto,
  type CustomerRateDto,
  type Paginated,
  type PriceHistoryList,
  type RateChangeEntry,
  type RateHistoryKind,
  resolveSpecialRates,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toNum, toStr, uc } from '../common/coerce';
import {
  BookingQueryDto,
  ConvertBookingDto,
  ConvertBookingLineDto,
  CreateBookingDto,
  PriceHistoryQueryDto,
  UpdateBookingDto,
} from './dto/booking.dto';

const INCLUDE = { conversions: { orderBy: { convertedAt: 'asc' } } } as const;
type Row = Prisma.BookingGetPayload<{ include: typeof INCLUDE }>;

/** The customer special-rate rows snapshotted onto a booking at creation. */
interface RateSnapshot {
  rates: CustomerRateDto[];
  logos: CustomerLogoDto[];
}

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

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

    const bags = toNum(dto.bags) ?? 0;
    const kgs = toNum(dto.kgs) ?? 0;
    if (bags <= 0 && kgs <= 0) throw new BadRequestException('Enter the booked bags and/or kgs.');

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
      },
      include: INCLUDE,
    });
    return this.toDto(await this.ensureCode(row), new Map());
  }

  async update(id: number, dto: UpdateBookingDto): Promise<BookingDto> {
    const existing = await this.prisma.booking.findUnique({ where: { id } });
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
    // Booked quantities can only grow to at least what has already been converted.
    if (dto.bags !== undefined) {
      const bags = toNum(dto.bags) ?? 0;
      if (bags < existing.convertedBags) throw new BadRequestException(`Bags cannot be less than the ${existing.convertedBags} already converted.`);
      data.bags = bags;
    }
    if (dto.kgs !== undefined) {
      const kgs = toNum(dto.kgs) ?? 0;
      if (kgs < existing.convertedKgs) throw new BadRequestException(`Kgs cannot be less than the ${existing.convertedKgs} already converted.`);
      data.kgs = kgs;
    }

    await this.prisma.booking.update({ where: { id }, data });
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

  /* ── Quote (price convertible lines as of the booking date) ──────────────── */

  async quote(id: number, dto: ConvertBookingDto): Promise<BookingQuoteResult> {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found.');
    const snapshot = this.parseSnapshot(booking.rateSnapshot);
    const lines: BookingQuoteLine[] = [];
    for (const line of dto.lines ?? []) {
      lines.push(await this.priceLine(line, booking.bookingDate, snapshot));
    }
    return { bookingDate: booking.bookingDate.toISOString(), lines };
  }

  /* ── Convert (draw down bags/kgs into real order lines) ──────────────────── */

  async convert(id: number, dto: ConvertBookingDto, userName?: string | null): Promise<BookingDto> {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
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
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
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
    const status = booking.status === 'CANCELLED' ? 'CANCELLED' : this.statusFor(booking.bags, booking.kgs, convertedBags, convertedKgs);

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
    return {
      booking,
      remBags: round2(booking.bags - drawnBags),
      remKgs: round2(booking.kgs - drawnKgs),
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

  /** Base product chart rate as of a date, reconstructed from the change log:
   *  the oldRate of the earliest change AFTER the date, else the current rate. */
  private async productRateAsOf(line: ConvertBookingLineDto, asOf: Date): Promise<number> {
    const product = uc(line.product) ?? uc(line.productName);
    const category = uc(line.pCategory);
    const subCategory = uc(line.subCategory);
    if (!product) return 0;
    const row = await this.prisma.product.findFirst({
      where: {
        product,
        ...(category ? { category } : {}),
        ...(subCategory ? { subCategory } : {}),
        ...(line.psize != null ? { size: toNum(line.psize) } : {}),
      },
    });
    if (!row) return 0;
    const hist = await this.prisma.productRateHistory.findFirst({
      where: { productId: row.id, changedAt: { gt: asOf } },
      orderBy: { changedAt: 'asc' },
    });
    return (hist ? hist.oldRate : row.rate) ?? 0;
  }

  /** Base design rate as of a date (same reconstruction as products). */
  private async designRateAsOf(line: ConvertBookingLineDto, asOf: Date): Promise<number> {
    const designType = uc(line.designType) ?? uc(line.design);
    if (!designType || designType === 'NA') return 0;
    const category = uc(line.pCategory);
    const subCategory = uc(line.subCategory);
    const row = await this.prisma.design.findFirst({
      where: { designType, ...(category ? { category } : {}), ...(subCategory ? { subCategory } : {}) },
    });
    if (!row) return 0;
    const hist = await this.prisma.designRateHistory.findFirst({
      where: { designId: row.id, changedAt: { gt: asOf } },
      orderBy: { changedAt: 'asc' },
    });
    return (hist ? hist.oldRate : row.rate) ?? 0;
  }

  /** Price one line at the booking-date rates + the customer's snapshotted deltas. */
  private async priceLine(line: ConvertBookingLineDto, asOf: Date, snapshot: RateSnapshot): Promise<BookingQuoteLine> {
    const productRate = await this.productRateAsOf(line, asOf);
    const designRate = await this.designRateAsOf(line, asOf);
    const resolution = resolveSpecialRates(snapshot, {
      category: uc(line.pCategory) ?? '',
      subCategory: uc(line.subCategory) ?? '',
      product: uc(line.product) ?? uc(line.productName),
      designType: uc(line.designType) ?? uc(line.design),
    });
    const rate = round2(productRate + designRate + resolution.productDelta + resolution.designDelta);
    return {
      productName: uc(line.productName) ?? uc(line.product) ?? null,
      designType: uc(line.designType) ?? null,
      productRate,
      designRate,
      productDelta: resolution.productDelta,
      designDelta: resolution.designDelta,
      rate,
      productFrom: resolution.productFrom,
      designFrom: resolution.designFrom,
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
    const remainingBags = Math.max(0, round2(r.bags - r.convertedBags));
    const remainingKgs = Math.max(0, round2(r.kgs - r.convertedKgs));
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
      conversions: r.conversions.map((c) => this.toConversionDto(c)),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
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
