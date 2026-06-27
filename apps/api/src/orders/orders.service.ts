import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type OrderDto, type OrderLookups, type Paginated } from '@oms/shared';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { toNum, toStr, uc } from '../common/coerce';
import { readCategoryFields } from '../common/category-fields';
import { CreateOrderDto, OrderQueryDto, UpdateOrderDto } from './dto/order.dto';

const INCLUDE = { items: true } as const;
type Row = Prisma.OrderGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

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
        select: { id: true, partyName: true, agentName: true, category: true },
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
      .map((c) => ({ id: c.id, name: c.partyName!, agentName: c.agentName, category: c.category }));

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
      categoryFields: await readCategoryFields(this.prisma),
    };
  }

  /** Render the Sales Order bill for an order as a downloadable PDF. */
  async salesOrderPdf(id: number): Promise<{ buffer: Buffer; filename: string }> {
    const order = await this.findOne(id);
    const buffer = await this.pdf.render(this.buildSalesOrderDoc(order));
    return { buffer, filename: `${order.code ?? `order-${id}`}-sales-order.pdf` };
  }

  private buildSalesOrderDoc(order: OrderDto): TDocumentDefinitions {
    const BLUE = '#156082';
    const ORANGE = '#F99A0F';
    const AMBER = '#F59E0B';
    const BLACK = '#111111';
    const q = (v?: number | null) => (v ? v.toLocaleString('en-IN') : '');
    const d = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
    const code = order.code ?? `#${order.id}`;
    const t = order.items.reduce(
      (a, it) => ({ bags: a.bags + (it.bags ?? 0), pcs: a.pcs + (it.pcs ?? 0), kgs: a.kgs + (it.gram ?? 0), box: a.box + (it.box ?? 0) }),
      { bags: 0, pcs: 0, kgs: 0, box: 0 },
    );

    const head = ['#', 'Item Name', 'Bags', 'PCs', 'KGs', 'Box', 'Rate', 'Comment'].map((text, i) => ({
      text,
      bold: true,
      color: BLACK,
      alignment: i === 0 ? 'center' : i >= 2 && i <= 6 ? 'right' : 'left',
    }));
    const itemRows = order.items.map((it, idx) => [
      { text: String(idx + 1), alignment: 'center' },
      { text: it.productName || it.product || '', bold: true },
      { text: q(it.bags), alignment: 'right' },
      { text: q(it.pcs), alignment: 'right' },
      { text: q(it.gram), alignment: 'right' },
      { text: q(it.box), alignment: 'right' },
      { text: q(it.rate), alignment: 'right', bold: true },
      { text: it.comment || '' },
    ]);
    const totalRow = [
      { text: 'Total', bold: true, alignment: 'right', colSpan: 2 },
      {},
      { text: q(t.bags), bold: true, alignment: 'right' },
      { text: q(t.pcs), bold: true, alignment: 'right' },
      { text: q(t.kgs), bold: true, alignment: 'right' },
      { text: q(t.box), bold: true, alignment: 'right' },
      { text: '' },
      { text: '' },
    ];

    const doc = {
      pageSize: 'A4',
      pageMargins: [28, 28, 28, 36],
      defaultStyle: { font: 'Helvetica', fontSize: 10, color: BLACK },
      content: [
        {
          table: {
            widths: ['*', 'auto'],
            body: [[
              { text: 'SALES ORDER', color: '#ffffff', bold: true, fontSize: 18 },
              { text: code, color: '#ffffff', bold: true, fontSize: 13, alignment: 'right', margin: [0, 4, 0, 0] },
            ]],
          },
          layout: { fillColor: () => BLUE, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 8, paddingBottom: () => 8 },
        },
        { canvas: [{ type: 'rect', x: 0, y: 0, w: 539, h: 4, color: AMBER }], margin: [0, 0, 0, 16] },
        {
          columns: [
            { width: '*', stack: [{ text: 'BILL TO,', color: BLUE, bold: true, fontSize: 8 }, { text: order.customerName, bold: true, fontSize: 14, margin: [0, 1, 0, 0] }] },
            {
              width: 'auto',
              table: {
                body: [
                  [{ text: 'Order No :', color: BLUE, bold: true }, { text: code, bold: true, alignment: 'right' }],
                  [{ text: 'Order Date :', color: BLUE, bold: true }, { text: d(order.orderDate), bold: true, alignment: 'right' }],
                  [{ text: 'Due Date :', color: BLUE, bold: true }, { text: d(order.completionDate), bold: true, alignment: 'right' }],
                ],
              },
              layout: 'noBorders',
            },
          ],
          margin: [0, 0, 0, 14],
        },
        {
          table: { headerRows: 1, widths: [18, '*', 38, 38, 38, 38, 50, 96], body: [head, ...itemRows, totalRow] },
          layout: {
            fillColor: (rowIndex: number, node: { table: { body: unknown[] } }) => {
              const last = node.table.body.length - 1;
              if (rowIndex === 0 || rowIndex === last) return ORANGE;
              return rowIndex % 2 === 0 ? '#F5F7FA' : null;
            },
            hLineColor: () => '#C9D2DC',
            vLineColor: () => '#C9D2DC',
            hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === 1 || i === node.table.body.length - 1 || i === node.table.body.length ? 0.8 : 0.5),
            vLineWidth: () => 0.5,
            paddingLeft: () => 7,
            paddingRight: () => 7,
            paddingTop: () => 6,
            paddingBottom: () => 6,
          },
        },
      ],
      footer: () => ({
        columns: [
          { text: new Date().toLocaleString('en-GB'), fontSize: 7, color: '#888888', margin: [28, 0, 0, 0] },
          { text: '**This is a computer-generated sales order**', fontSize: 7, color: '#888888', alignment: 'right', margin: [0, 0, 28, 0] },
        ],
      }),
    };
    return doc as unknown as TDocumentDefinitions;
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
      poNumber: uc(dto.poNumber) ?? null,
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
      poNumber: r.poNumber,
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
      totalAmount: items.reduce((s, it) => s + (it.rate ?? 0) * (it.calField === 'PCS' ? (it.pcs ?? 0) : (it.gram ?? 0)), 0),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
