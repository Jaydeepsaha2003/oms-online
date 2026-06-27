import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type OrderDto, type QuotationDto, type QuotationStatus, type Paginated } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toNum, toStr, uc } from '../common/coerce';
import { OrdersService } from '../orders/orders.service';
import { CreateOrderDto } from '../orders/dto/order.dto';
import { CancelQuotationDto, CreateQuotationDto, QuotationQueryDto, UpdateQuotationDto } from './dto/quotation.dto';

const INCLUDE = { items: true, convertedOrder: { select: { code: true } } } as const;
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
    return this.toDto(row);
  }

  async create(dto: CreateQuotationDto): Promise<QuotationDto> {
    const data = await this.toHeaderData(dto);
    const row = await this.prisma.quotation.create({
      data: { ...data, items: { create: (dto.items ?? []).map((it) => this.toItemData(it)) } },
      include: INCLUDE,
    });
    return this.toDto(await this.ensureCode(row));
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
    await this.ensureExists(id);
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

  /** Convert a quotation into a real order and mark it CONVERTED. */
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
    const order = await this.orders.create(orderDto);
    await this.prisma.quotation.update({
      where: { id },
      data: { status: 'CONVERTED', convertedOrderId: order.id, convertedAt: new Date(), convertMode: mode },
    });
    return order;
  }

  /** Cancel a quotation, recording why (for analysis). */
  async cancel(id: number, dto: CancelQuotationDto, byName?: string): Promise<QuotationDto> {
    const q = await this.prisma.quotation.findUnique({ where: { id } });
    if (!q) throw new NotFoundException('Quotation not found.');
    if (q.status === 'CONVERTED') throw new BadRequestException('A converted quotation cannot be cancelled.');
    if (q.status === 'CANCELLED') throw new BadRequestException('This quotation is already cancelled.');
    const row = await this.prisma.quotation.update({
      where: { id },
      data: {
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

  private async ensureExists(id: number): Promise<void> {
    const c = await this.prisma.quotation.count({ where: { id } });
    if (!c) throw new NotFoundException('Quotation not found.');
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
      comment: it.comment,
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
      cancelReason: r.cancelReason,
      cancelNote: r.cancelNote,
      cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
      cancelledByName: r.cancelledByName,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
