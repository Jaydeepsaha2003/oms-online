import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type OrderDto, type OrderLookups, type Paginated } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toNum, toStr, uc } from '../common/coerce';
import { CreateOrderDto, OrderQueryDto, UpdateOrderDto } from './dto/order.dto';

const INCLUDE = { items: true } as const;
type Row = Prisma.OrderGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: OrderQueryDto): Promise<Paginated<OrderDto>> {
    const search = query.search?.trim();
    const where: Prisma.OrderWhereInput = {
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
      this.prisma.order.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOne(id: number): Promise<OrderDto> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundException('Order not found.');
    return this.toDto(row);
  }

  async create(dto: CreateOrderDto): Promise<OrderDto> {
    const data = await this.toHeaderData(dto);
    const row = await this.prisma.order.create({
      data: { ...data, items: { create: (dto.items ?? []).map((it) => this.toItemData(it)) } },
      include: INCLUDE,
    });
    return this.toDto(await this.ensureCode(row));
  }

  async update(id: number, dto: UpdateOrderDto): Promise<OrderDto> {
    await this.ensureExists(id);
    const data = await this.toHeaderData(dto as CreateOrderDto);
    const row = await this.prisma.order.update({
      where: { id },
      data: {
        ...data,
        // Replace the whole line-item set with what the form submitted.
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
    await this.prisma.order.delete({ where: { id } });
  }

  async lookups(): Promise<OrderLookups> {
    const [customers, prodCats, subCats, products, designs, allProducts, designNames] = await Promise.all([
      this.prisma.customer.findMany({
        where: { partyName: { not: null } },
        select: { partyName: true, agentName: true, category: true },
        orderBy: { partyName: 'asc' },
      }),
      this.prisma.product.findMany({ where: { category: { not: '' } }, select: { category: true }, distinct: ['category'], orderBy: { category: 'asc' } }),
      this.prisma.product.findMany({ where: { subCategory: { not: '' } }, select: { subCategory: true }, distinct: ['subCategory'], orderBy: { subCategory: 'asc' } }),
      this.prisma.product.findMany({
        where: { product: { not: '' } },
        select: { product: true, category: true, subCategory: true, rate: true },
        distinct: ['product'],
        orderBy: { product: 'asc' },
      }),
      this.prisma.design.findMany({
        select: { category: true, subCategory: true, designType: true, rate: true },
        distinct: ['category', 'subCategory', 'designType'],
        orderBy: [{ category: 'asc' }, { designType: 'asc' }],
      }),
      // Every product row (incl. size variants) for the composite item-name list.
      this.prisma.product.findMany({
        where: { product: { not: '' } },
        select: { product: true, category: true, subCategory: true, size: true, pcs: true, weight: true, rate: true },
        orderBy: [{ subCategory: 'asc' }, { product: 'asc' }],
      }),
      // Human-readable design names from the Design Names master (a code may have several).
      this.prisma.designName.findMany({
        select: { designType: true, designName: true },
        orderBy: [{ designType: 'asc' }, { designName: 'asc' }],
      }),
    ]);
    const seen = new Set<string>();
    const custList = customers
      .filter((c) => c.partyName && !seen.has(c.partyName) && seen.add(c.partyName))
      .map((c) => ({ name: c.partyName!, agentName: c.agentName, category: c.category }));

    // designType code -> its first design name (fall back to the code itself).
    const nameByCode = new Map<string, string>();
    for (const dn of designNames) {
      const k = dn.designType.toUpperCase();
      if (!nameByCode.has(k)) nameByCode.set(k, dn.designName);
    }
    const nameOf = (designType: string) => nameByCode.get(designType.toUpperCase()) ?? designType;

    // Build the legacy-style item list: each product on its own, plus the product
    // paired with every design type available in its category + sub-category.
    const key = (c: string, s: string) => `${c.toUpperCase()}|${s.toUpperCase()}`;
    const designsByKey = new Map<string, { designType: string; rate: number | null }[]>();
    for (const d of designs) {
      const k = key(d.category, d.subCategory);
      const bucket = designsByKey.get(k) ?? [];
      bucket.push({ designType: d.designType, rate: d.rate });
      if (!designsByKey.has(k)) designsByKey.set(k, bucket);
    }
    const items: OrderLookups['items'] = [];
    for (const p of allProducts) {
      const base = { product: p.product, category: p.category, subCategory: p.subCategory, size: p.size, pcs: p.pcs, weight: p.weight, productRate: p.rate };
      items.push({ ...base, designType: null, designName: null, designRate: null });
      for (const d of designsByKey.get(key(p.category, p.subCategory)) ?? []) {
        items.push({ ...base, designType: d.designType, designName: nameOf(d.designType), designRate: d.rate });
      }
    }

    return {
      customers: custList,
      categories: prodCats.map((c) => c.category).filter(Boolean),
      subCategories: subCats.map((c) => c.subCategory).filter(Boolean),
      products: products.map((p) => ({ product: p.product, category: p.category, subCategory: p.subCategory, rate: p.rate })),
      designs: designs.map((d) => ({ category: d.category, subCategory: d.subCategory, designType: d.designType, designName: nameOf(d.designType), rate: d.rate })),
      items,
      designNames: designNames.map((dn) => ({ designType: dn.designType, designName: dn.designName })),
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async toHeaderData(dto: CreateOrderDto): Promise<Prisma.OrderUncheckedCreateInput> {
    const customerName = (uc(dto.customerName) ?? '') as string;
    const customer = customerName
      ? await this.prisma.customer.findFirst({ where: { partyName: customerName } })
      : null;
    const orderDate = dto.orderDate ? new Date(dto.orderDate) : new Date();
    const completionDate = dto.completionDate ? new Date(dto.completionDate) : null;
    const completionDay =
      completionDate && !Number.isNaN(completionDate.getTime())
        ? Math.max(0, Math.round((completionDate.getTime() - orderDate.getTime()) / 86_400_000))
        : null;
    return {
      customerId: customer?.id ?? null,
      customerName,
      agentName: uc(dto.agentName) ?? customer?.agentName ?? null,
      category: uc(dto.category) ?? 'SALES',
      orderDate,
      completionDate,
      completionDay,
      priority: uc(dto.priority) ?? 'NORMAL',
      status: uc(dto.status) ?? 'PENDING',
      ordType: 'SALES ORDER',
      comment: toStr(dto.comment),
    };
  }

  private toItemData(it: Record<string, unknown>): Prisma.OrderItemCreateWithoutOrderInput {
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
    return `ORD-${String(id).padStart(5, '0')}`;
  }

  private async ensureCode(row: Row): Promise<Row> {
    if (row.code) return row;
    return this.prisma.order.update({
      where: { id: row.id },
      data: { code: this.codeFor(row.id) },
      include: INCLUDE,
    });
  }

  private async ensureExists(id: number): Promise<void> {
    const c = await this.prisma.order.count({ where: { id } });
    if (!c) throw new NotFoundException('Order not found.');
  }

  private toDto(r: Row): OrderDto {
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
      customerId: r.customerId,
      customerName: r.customerName,
      agentName: r.agentName,
      category: r.category,
      orderDate: r.orderDate.toISOString(),
      completionDate: r.completionDate ? r.completionDate.toISOString() : null,
      completionDay: r.completionDay,
      priority: r.priority,
      status: r.status,
      ordType: r.ordType,
      comment: r.comment,
      userName: r.userName,
      items,
      itemCount: items.length,
      totalRate: items.reduce((s, it) => s + (it.rate ?? 0), 0),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
