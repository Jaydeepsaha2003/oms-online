import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type OrderDto, type QuotationDto, type QuotationStatus, type Paginated } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toNum, toStr, uc } from '../common/coerce';
import { OrdersService } from '../orders/orders.service';
import { CreateOrderDto } from '../orders/dto/order.dto';
import { CancelQuotationDto, CreateQuotationDto, QuotationQueryDto, UpdateQuotationDto } from './dto/quotation.dto';

const INCLUDE = {
  items: true,
  convertedOrder: { select: { code: true } },
  sourceOrder: { select: { code: true } },
} as const;
type Row = Prisma.QuotationGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  async findMany(query: QuotationQueryDto): Promise<Paginated<QuotationDto>> {
    const search = query.search?.trim();
    const where: Prisma.QuotationWhereInput = {
      ...(query.status ? { status: uc(query.status)! } : {}),
      ...(search
        ? {
            OR: [
              { customerName: { contains: search } },
              { code: { contains: search } },
              { agentName: { contains: search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.quotation.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ quotationDate: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.quotation.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOne(id: number): Promise<QuotationDto> {
    const row = await this.prisma.quotation.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundException('Quotation not found.');
    const dto = this.toDto(row);
    const customer = row.customerId
      ? await this.prisma.customer.findUnique({ where: { id: row.customerId } })
      : await this.prisma.customer.findFirst({ where: { partyName: row.customerName } });
    dto.billingAddress = [customer?.city, customer?.state, customer?.region]
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .join(', ');
    return dto;
  }

  async create(dto: CreateQuotationDto): Promise<QuotationDto> {
    const data = await this.toHeaderData(dto);
    const row = await this.prisma.quotation.create({
      data: { ...data, items: { create: (dto.items ?? []).map((it) => this.toItemData(it)) } },
      include: INCLUDE,
    });
    return this.toDto(await this.ensureCode(row));
  }

  /**
   * Build a quotation out of an existing DRAFT order — the reverse of
   * {@link convert}, for "Save as Quotation" in View Orders. Only a DRAFT is
   * eligible: a confirmed order is a real commitment (and may already have
   * dispatches/challans behind it), so quoting it after the fact would be
   * backwards.
   *
   * PARK AND REUSE. The draft is neither left sitting in View Orders nor
   * deleted. It is PARKED — status QUOTED, which hides it from the order lists,
   * Order Modify, dispatch and bookings — and linked to the new quotation via
   * `sourceOrderId`. From then on the quotation is the live document; the order
   * is a reservation of its own number. {@link convert} revives that exact order
   * (same id, same Order #) with whatever the quotation ended up saying, so the
   * job never exists twice and never has to be renumbered.
   *
   * Nothing is destroyed by a mis-tap either: deleting or cancelling the
   * quotation puts the order straight back to DRAFT.
   */
  async createFromOrder(orderId: number, userName?: string | null): Promise<QuotationDto> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status !== 'DRAFT') {
      throw new BadRequestException('Only a draft order can be saved as a quotation.');
    }
    if (!order.items.length) throw new BadRequestException('This draft has no items to quote.');
    // sourceOrderId is @unique, so a second quotation off the same draft would
    // fail on the constraint — say why instead of surfacing a Prisma error.
    const already = await this.prisma.quotation.findUnique({
      where: { sourceOrderId: orderId },
      select: { code: true, id: true },
    });
    if (already) {
      throw new BadRequestException(`This order is already saved as quotation ${already.code ?? `#${already.id}`}.`);
    }

    const dto: CreateQuotationDto = {
      customerName: order.customerName,
      poNumber: order.poNumber ?? undefined,
      agentName: order.agentName ?? undefined,
      category: order.category ?? undefined,
      orderDate: order.orderDate.toISOString(),
      completionDate: order.completionDate ? order.completionDate.toISOString() : undefined,
      priority: order.priority ?? undefined,
      // A brand-new quotation always starts as a draft of its own — it hasn't
      // been sent to the customer just because the order it came from existed.
      status: 'DRAFT',
      comment: order.comment ?? undefined,
      items: order.items.map((it) => ({
        pCategory: it.pCategory,
        subCategory: it.subCategory,
        product: it.product,
        design: it.design,
        productName: it.productName,
        designType: it.designType,
        psize: it.psize,
        bags: it.bags,
        pcs: it.pcs,
        gram: it.gram,
        box: it.box,
        productRate: it.productRate,
        designRate: it.designRate,
        rate: it.rate,
        calField: it.calField,
        priority: it.priority,
        ordType: it.ordType,
        comment: it.comment,
      })),
    };
    const created = await this.create(dto);
    // Link the quotation to its source order and park that order, together —
    // a half-done pair would either show the job twice or lose the order's
    // number for good.
    await this.prisma.$transaction([
      this.prisma.quotation.update({
        where: { id: created.id },
        data: { sourceOrderId: orderId, ...(userName ? { userName } : {}) },
      }),
      this.prisma.order.update({ where: { id: orderId }, data: { status: 'QUOTED' } }),
    ]);
    return this.findOne(created.id);
  }

  async update(id: number, dto: UpdateQuotationDto): Promise<QuotationDto> {
    const current = await this.prisma.quotation.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Quotation not found.');
    if (current.status === 'CONVERTED') throw new BadRequestException('A converted quotation cannot be edited.');
    const data = await this.toHeaderData(dto as CreateQuotationDto);
    const row = await this.prisma.quotation.update({
      where: { id },
      data: {
        ...data,
        ...(dto.items
          ? { items: { deleteMany: {}, create: dto.items.map((it) => this.toItemData(it)) } }
          : {}),
      },
      include: INCLUDE,
    });
    return this.toDto(await this.ensureCode(row));
  }

  async remove(id: number): Promise<void> {
    const current = await this.prisma.quotation.findUnique({
      where: { id },
      include: { convertedOrder: { select: { code: true } } },
    });
    if (!current) throw new NotFoundException('Quotation not found.');
    // Once converted, a real order exists that came from these lines. Deleting
    // the quotation would erase what the order was quoted at — the same reason
    // update() refuses. Cancel is not an option either at that point, so a
    // converted quotation is simply permanent.
    if (current.status === 'CONVERTED') {
      throw new BadRequestException(
        `This quotation became order ${current.convertedOrder?.code ?? current.convertedOrderId ?? ''}`.trim() +
          ' — it cannot be deleted. Change or cancel the order instead.',
      );
    }
    // Give the parked order back before the link disappears with the row.
    await this.unparkOrder(current.sourceOrderId);
    await this.prisma.quotation.delete({ where: { id } });
  }

  /** Mark a quotation as sent to the customer (tracked). */
  async markSent(id: number, byName?: string): Promise<QuotationDto> {
    const q = await this.prisma.quotation.findUnique({ where: { id } });
    if (!q) throw new NotFoundException('Quotation not found.');
    if (q.status === 'CONVERTED' || q.status === 'CANCELLED') {
      throw new BadRequestException(`A ${q.status.toLowerCase()} quotation cannot be marked as sent.`);
    }
    const row = await this.prisma.quotation.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date(), sentByName: byName ?? null },
      include: INCLUDE,
    });
    return this.toDto(row);
  }

  /**
   * Convert a quotation into a real order and mark it CONVERTED.
   *
   * If the quotation came from a draft order ("Save as Quotation"), that order
   * was parked rather than duplicated — so this REVIVES it: the same row, the
   * same Order #, re-stated with whatever the quotation now says. That's the
   * whole point of parking; minting a fresh order here would leave the reserved
   * number stranded and the customer looking at a different one than they were
   * quoted against.
   *
   * A parked order that has since been deleted (`sourceOrderId` goes null with
   * the row) or somehow moved off QUOTED falls back to creating a new order, so
   * a conversion can never be blocked by the state of the order it came from.
   */
  async convert(id: number, mode: 'DIRECT' | 'EDITED' = 'DIRECT'): Promise<OrderDto> {
    const q = await this.prisma.quotation.findUnique({ where: { id }, include: { items: true } });
    if (!q) throw new NotFoundException('Quotation not found.');
    if (q.status === 'CONVERTED') throw new BadRequestException('This quotation has already been converted.');
    if (q.status === 'CANCELLED') throw new BadRequestException('A cancelled quotation cannot be converted.');

    const orderDto: CreateOrderDto = {
      customerName: q.customerName,
      poNumber: q.poNumber ?? undefined,
      agentName: q.agentName ?? undefined,
      category: q.category ?? undefined,
      orderDate: q.quotationDate.toISOString(),
      completionDate: q.completionDate ? q.completionDate.toISOString() : undefined,
      status: 'CONFIRMED',
      comment: q.comment ?? undefined,
      items: q.items.map((it) => ({
        // Links this order line back to the quotation line it came from, so a
        // later edit can be mirrored onto the quotation and shown in its history.
        quotationItemId: it.id,
        pCategory: it.pCategory,
        subCategory: it.subCategory,
        product: it.product,
        design: it.design,
        productName: it.productName,
        designType: it.designType,
        psize: it.psize,
        bags: it.bags,
        pcs: it.pcs,
        gram: it.gram,
        box: it.box,
        productRate: it.productRate,
        designRate: it.designRate,
        rate: it.rate,
        calField: it.calField,
        priority: it.priority,
        ordType: it.ordType,
        status: 'CONFIRMED',
        comment: it.comment,
      })),
    };
    const parked = await this.parkedOrderFor(q.sourceOrderId);
    // Revive in place, or create fresh when there's no parked order to revive.
    // update() keeps the lines' identities where they still match, and re-runs
    // booking pricing/capacity exactly as a normal edit would.
    const order = parked
      ? await this.orders.update(parked, orderDto, q.userName, { revivingQuotation: true })
      : await this.orders.create(orderDto);
    await this.prisma.quotation.update({
      where: { id },
      data: { status: 'CONVERTED', convertedOrderId: order.id, convertedAt: new Date(), convertMode: mode },
    });
    return order;
  }

  /** The id of this quotation's parked source order, if there still is one
   *  sitting at QUOTED and waiting to be revived. */
  private async parkedOrderFor(sourceOrderId: number | null): Promise<number | null> {
    if (sourceOrderId == null) return null;
    const order = await this.prisma.order.findUnique({
      where: { id: sourceOrderId },
      select: { id: true, status: true },
    });
    return order && order.status === 'QUOTED' ? order.id : null;
  }

  /** Hand a parked order back to whoever was drafting it. Called when the
   *  quotation that parked it is cancelled or deleted — without this the order
   *  would stay QUOTED forever, invisible in every list and unreachable. */
  private async unparkOrder(sourceOrderId: number | null): Promise<void> {
    const parked = await this.parkedOrderFor(sourceOrderId);
    if (parked != null) await this.prisma.order.update({ where: { id: parked }, data: { status: 'DRAFT' } });
  }

  /** Cancel a quotation, recording why (for analysis). */
  async cancel(id: number, dto: CancelQuotationDto, byName?: string): Promise<QuotationDto> {
    const q = await this.prisma.quotation.findUnique({ where: { id } });
    if (!q) throw new NotFoundException('Quotation not found.');
    if (q.status === 'CONVERTED') throw new BadRequestException('A converted quotation cannot be cancelled.');
    if (q.status === 'CANCELLED') throw new BadRequestException('This quotation is already cancelled.');
    // The quote is off, but the work that was drafted isn't necessarily — hand
    // the parked order back as a draft rather than burying it at QUOTED.
    await this.unparkOrder(q.sourceOrderId);
    const row = await this.prisma.quotation.update({
      where: { id },
      data: {
        // Release the claim on the order as well. sourceOrderId is @unique, so a
        // dead quotation still holding it would block that draft from ever being
        // quoted again — and it no longer holds anything: the order is a draft
        // once more, free for a fresh quote.
        sourceOrderId: null,
        status: 'CANCELLED',
        cancelReason: uc(dto.reason),
        cancelNote: toStr(dto.note),
        cancelledAt: new Date(),
        cancelledByName: byName ?? null,
      },
      include: INCLUDE,
    });
    return this.toDto(row);
  }

  /* ── helpers ─────────────────────────────────────────────────────────── */

  private async toHeaderData(dto: CreateQuotationDto): Promise<Prisma.QuotationUncheckedCreateInput> {
    const customerName = (uc(dto.customerName) ?? '') as string;
    const customer = customerName
      ? await this.prisma.customer.findFirst({ where: { partyName: customerName } })
      : null;
    const quotationDate = dto.orderDate ? new Date(dto.orderDate) : new Date();
    const completionDate = dto.completionDate ? new Date(dto.completionDate) : null;
    const completionDay =
      completionDate && !Number.isNaN(completionDate.getTime())
        ? Math.max(0, Math.round((completionDate.getTime() - quotationDate.getTime()) / 86_400_000))
        : null;
    return {
      customerId: customer?.id ?? null,
      customerName,
      poNumber: uc(dto.poNumber) ?? null,
      agentName: uc(dto.agentName) ?? customer?.agentName ?? null,
      category: uc(dto.category) ?? 'SALES',
      quotationDate,
      completionDate,
      completionDay,
      priority: uc(dto.priority) ?? 'NORMAL',
      status: uc(dto.status) ?? 'DRAFT',
      ordType: 'QUOTATION',
      comment: toStr(dto.comment),
    };
  }

  private toItemData(it: Record<string, unknown>): Prisma.QuotationItemCreateWithoutQuotationInput {
    const productRate = toNum(it.productRate);
    const designRate = toNum(it.designRate);
    const rate = toNum(it.rate) ?? (productRate ?? 0) + (designRate ?? 0);
    return {
      pCategory: uc(it.pCategory),
      subCategory: uc(it.subCategory),
      product: uc(it.product),
      design: uc(it.design),
      productName: uc(it.productName),
      designType: uc(it.designType),
      psize: toNum(it.psize),
      bags: toNum(it.bags),
      pcs: toNum(it.pcs),
      gram: toNum(it.gram),
      box: toNum(it.box),
      productRate,
      designRate,
      rate,
      calField: uc(it.calField),
      priority: uc(it.priority),
      ordType: uc(it.ordType),
      comment: toStr(it.comment),
    };
  }

  private codeFor(id: number): string {
    return `QUO-${String(id).padStart(5, '0')}`;
  }

  private async ensureCode(row: Row): Promise<Row> {
    if (row.code) return row;
    return this.prisma.quotation.update({
      where: { id: row.id },
      data: { code: this.codeFor(row.id) },
      include: INCLUDE,
    });
  }

  private toDto(r: Row): QuotationDto {
    const items = r.items.map((it) => ({
      id: it.id,
      pCategory: it.pCategory,
      subCategory: it.subCategory,
      product: it.product,
      design: it.design,
      productName: it.productName,
      designType: it.designType,
      psize: it.psize,
      bags: it.bags,
      pcs: it.pcs,
      gram: it.gram,
      box: it.box,
      productRate: it.productRate,
      designRate: it.designRate,
      rate: it.rate,
      calField: it.calField,
      priority: it.priority,
      ordType: it.ordType,
      status: 'CONFIRMED',
      comment: it.comment,
      bookingId: null,
    }));
    return {
      id: r.id,
      code: r.code ?? this.codeFor(r.id),
      poNumber: r.poNumber,
      customerId: r.customerId,
      customerName: r.customerName,
      agentName: r.agentName,
      category: r.category,
      orderDate: r.quotationDate.toISOString(),
      completionDate: r.completionDate ? r.completionDate.toISOString() : null,
      completionDay: r.completionDay,
      priority: r.priority,
      status: r.status as QuotationStatus,
      ordType: r.ordType,
      comment: r.comment,
      userName: r.userName,
      items,
      itemCount: items.length,
      totalRate: items.reduce((s, it) => s + (it.rate ?? 0), 0),
      totalAmount: items.reduce((s, it) => s + (it.rate ?? 0) * (it.calField === 'PCS' ? (it.pcs ?? 0) : (it.gram ?? 0)), 0),
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      sentByName: r.sentByName,
      convertedOrderId: r.convertedOrderId,
      convertedOrderCode: r.convertedOrder?.code ?? null,
      convertedAt: r.convertedAt ? r.convertedAt.toISOString() : null,
      convertMode: r.convertMode,
      sourceOrderId: r.sourceOrderId,
      sourceOrderCode: r.sourceOrder?.code ?? null,
      cancelReason: r.cancelReason,
      cancelNote: r.cancelNote,
      cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
      cancelledByName: r.cancelledByName,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
