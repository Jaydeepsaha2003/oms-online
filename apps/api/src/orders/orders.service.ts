import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type OrderDto, type OrderFilterOptions, type OrderItemPhotoDto, type OrderLookupsWire, type OrderTimeline, type OrderTimelineChallanRef, type Paginated } from '@oms/shared';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { BookingsService } from '../bookings/bookings.service';
import { toNum, toStr, uc } from '../common/coerce';
import { readCategoryFields } from '../common/category-fields';
import { UPLOADS_DIR } from '../uploads/uploads.constants';
import { AddOrderItemPhotoDto, CreateOrderDto, OrderQueryDto, UpdateOrderDto } from './dto/order.dto';

const INCLUDE = { items: { include: { photos: { orderBy: { id: 'asc' } } } } } as const;
type Row = Prisma.OrderGetPayload<{ include: typeof INCLUDE }>;
type PhotoRow = Prisma.OrderItemPhotoGetPayload<object>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly bookings: BookingsService,
  ) {}

  async findMany(query: OrderQueryDto): Promise<Paginated<OrderDto>> {
    const search = query.search?.trim();
    // Product / design filters keep an order when ANY of its lines matches.
    const lineFilters: Prisma.OrderWhereInput[] = [];
    if (query.product) lineFilters.push({ items: { some: { OR: [{ productName: query.product }, { product: query.product }] } } });
    if (query.design) lineFilters.push({ items: { some: { designType: query.design } } });
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: uc(query.status)! } : {}),
      ...(lineFilters.length ? { AND: lineFilters } : {}),
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

    // Dispatch roll-up for the page's orders: FULL = every active line has a
    // "FULLY DISPATCH" record, PARTIAL = some dispatches exist, NONE = untouched.
    const itemIds = rows.flatMap((r) => r.items.map((it) => it.id));
    const dispatches = itemIds.length
      ? await this.prisma.dispatch.findMany({
          where: { orderItemId: { in: itemIds } },
          select: { orderItemId: true, dispatchStatus: true },
        })
      : [];
    const hasDispatch = new Set<number>();
    const hasFull = new Set<number>();
    for (const d of dispatches) {
      hasDispatch.add(d.orderItemId);
      if (d.dispatchStatus === 'FULLY DISPATCH') hasFull.add(d.orderItemId);
    }
    const stateOf = (r: Row): OrderDto['dispatchState'] => {
      const active = r.items.filter((it) => it.status !== 'CANCELLED');
      if (!active.length) return 'NONE';
      if (active.every((it) => hasFull.has(it.id))) return 'FULL';
      if (active.some((it) => hasDispatch.has(it.id))) return 'PARTIAL';
      return 'NONE';
    };

    return {
      items: rows.map((r) => this.toDto(r, stateOf(r), hasDispatch)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOne(id: number): Promise<OrderDto> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundException('Order not found.');
    const dispatched = row.items.length
      ? await this.prisma.dispatch.findMany({ where: { orderItemId: { in: row.items.map((it) => it.id) } }, select: { orderItemId: true } })
      : [];
    const dto = this.toDto(row, null, new Set(dispatched.map((d) => d.orderItemId)));
    // Only the single-order fetch needs this (the printable bill's "Bill To"
    // address line) — skipped in findMany's list rows to avoid an extra join per row.
    const customer = row.customerId
      ? await this.prisma.customer.findUnique({ where: { id: row.customerId } })
      : await this.prisma.customer.findFirst({ where: { partyName: row.customerName } });
    dto.billingAddress = [customer?.city, customer?.state, customer?.region]
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .join(', ');
    return dto;
  }

  async create(dto: CreateOrderDto): Promise<OrderDto> {
    const data = await this.toHeaderData(dto);
    // Booking-sourced lines are re-priced at their booking's frozen date rates and
    // checked against what's left on the booking before anything is written.
    await this.applyBookingPricing(dto.items ?? []);
    await this.assertBookingCapacity(dto.items ?? []);
    const row = await this.prisma.order.create({
      data: {
        ...data,
        items: { create: (dto.items ?? []).map((it) => ({ ...this.toItemData(it), ...this.photoCreateNested(it) })) },
      },
      include: INCLUDE,
    });
    await this.recomputeBookings(this.bookingIdsOf(row.items));
    return this.toDto(await this.ensureCode(row));
  }

  async update(id: number, dto: UpdateOrderDto): Promise<OrderDto> {
    await this.ensureExists(id);
    const data = await this.toHeaderData(dto as CreateOrderDto);
    // Bookings that were already drawn into this order — they may lose lines (which
    // frees their quantity) so they must be recomputed even if no line references
    // them any more.
    const bookingsBefore = await this.prisma.orderItem.findMany({
      where: { orderId: id, bookingId: { not: null } },
      select: { bookingId: true },
    });

    if (!dto.items) {
      await this.prisma.order.update({ where: { id }, data });
    } else {
      // Re-price + capacity-check booking-sourced lines before writing (this order's
      // own current draw is excluded so its kept lines don't count against itself).
      await this.applyBookingPricing(dto.items);
      await this.assertBookingCapacity(dto.items, id);
      // Reconcile line items BY ID so existing lines keep their identity — and
      // therefore their dispatch history. A blanket deleteMany+create would give
      // every line a new id and cascade-delete its dispatches (Dispatch.orderItem
      // is onDelete: Cascade), making already-dispatched lines reappear as pending.
      const existing = await this.prisma.orderItem.findMany({
        where: { orderId: id },
        select: {
          id: true,
          product: true,
          productName: true,
          designType: true,
          psize: true,
          bags: true,
          pcs: true,
          gram: true,
          box: true,
          productRate: true,
          designRate: true,
          rate: true,
          calField: true,
          _count: { select: { dispatches: true } },
        },
      });
      const existingById = new Map(existing.map((e) => [e.id, e]));
      const existingIds = new Set(existing.map((e) => e.id));
      const kept = new Set<number>();
      const toUpdate: { where: { id: number }; data: Prisma.OrderItemUpdateWithoutOrderInput }[] = [];
      const toCreate: Prisma.OrderItemCreateWithoutOrderInput[] = [];
      for (const it of dto.items) {
        const itemId = toNum(it.id);
        if (itemId && existingIds.has(itemId)) {
          kept.add(itemId);
          const current = existingById.get(itemId)!;
          const incoming = this.toItemData(it);
          // A dispatched line's quantity/rate/product details are frozen — the
          // dispatch already reflects what shipped. Only status (e.g. Cancel) and
          // comment may still change; anything else must become a new line instead
          // (see OrdersController's client-side "add as new item" recommendation).
          if (current._count.dispatches > 0) {
            const changed =
              current.product !== incoming.product ||
              current.designType !== incoming.designType ||
              current.psize !== incoming.psize ||
              current.bags !== incoming.bags ||
              current.pcs !== incoming.pcs ||
              current.gram !== incoming.gram ||
              current.box !== incoming.box ||
              current.productRate !== incoming.productRate ||
              current.designRate !== incoming.designRate ||
              current.rate !== incoming.rate ||
              current.calField !== incoming.calField;
            if (changed) {
              throw new BadRequestException(
                `"${current.productName || current.product || 'This item'}" has already been dispatched — its details can't be edited. Add the change as a new line instead.`,
              );
            }
          }
          toUpdate.push({ where: { id: itemId }, data: { ...this.toItemData(it), ...this.photoUpdateNested(it) } });
        } else {
          toCreate.push({ ...this.toItemData(it), ...this.photoCreateNested(it) });
        }
      }
      const removed = existing.filter((e) => !kept.has(e.id));
      // Removing a line would cascade-delete its dispatches — refuse it and steer
      // the user to Cancel the line (which keeps the record) instead.
      if (removed.some((e) => e._count.dispatches > 0)) {
        throw new BadRequestException(
          'Cannot remove an order line that already has dispatches. Mark it Cancelled instead.',
        );
      }
      const toDelete = removed.map((e) => e.id);
      await this.prisma.order.update({
        where: { id },
        data: {
          ...data,
          items: {
            ...(toDelete.length ? { deleteMany: { id: { in: toDelete } } } : {}),
            ...(toUpdate.length ? { update: toUpdate } : {}),
            ...(toCreate.length ? { create: toCreate } : {}),
          },
        },
      });
    }

    const row = await this.prisma.order.findUnique({ where: { id }, include: INCLUDE });
    // Recompute every booking this order touched — before and after the change.
    await this.recomputeBookings([
      ...this.bookingIdsOf(row!.items),
      ...bookingsBefore.map((b) => b.bookingId!),
    ]);
    return this.toDto(await this.ensureCode(row!));
  }

  async remove(id: number): Promise<void> {
    await this.ensureExists(id);
    const bookingLines = await this.prisma.orderItem.findMany({
      where: { orderId: id, bookingId: { not: null } },
      select: { bookingId: true },
    });
    await this.prisma.order.delete({ where: { id } });
    // Deleting the order frees any booking quantity its lines had drawn.
    await this.recomputeBookings(bookingLines.map((b) => b.bookingId!));
  }

  /** Cancel / restore an order. Cancelling is only allowed while the order is
   *  untouched — once any line has a dispatch, the order can no longer be
   *  cancelled (the record must stay consistent with the dispatch history). */
  async updateStatus(id: number, status: 'CONFIRMED' | 'CANCELLED'): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({ where: { id }, select: { id: true, items: { select: { id: true } } } });
    if (!order) throw new NotFoundException('Order not found.');
    if (status === 'CANCELLED' && order.items.length) {
      const dispatched = await this.prisma.dispatch.count({ where: { orderItemId: { in: order.items.map((i) => i.id) } } });
      if (dispatched > 0) {
        throw new BadRequestException('This order already has dispatches — it can no longer be cancelled.');
      }
    }
    const row = await this.prisma.order.update({ where: { id }, data: { status }, include: INCLUDE });
    // Cancelling/restoring the order changes whether its booking lines count as
    // drawn — recompute any booking it references.
    await this.recomputeBookings(this.bookingIdsOf(row.items));
    return this.toDto(row, status === 'CANCELLED' ? 'NONE' : null);
  }

  /** Order journey: ordered → dispatched (per line) → challaned, for the
   *  View Orders timeline modal. Each dispatch carries the (non-cancelled)
   *  challan it was billed on, if any. */
  async timeline(id: number): Promise<OrderTimeline> {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new NotFoundException('Order not found.');

    const dispatches = await this.prisma.dispatch.findMany({
      where: { orderId: id },
      orderBy: [{ dispatchDate: 'asc' }, { id: 'asc' }],
    });
    const dIds = dispatches.map((d) => d.id);
    const chItems = dIds.length
      ? await this.prisma.challanItem.findMany({
          where: { dispatchId: { in: dIds } },
          include: { challan: { select: { id: true, code: true, invDate: true, challanStatus: true } } },
        })
      : [];
    // Dispatch → its challan (prefer a non-cancelled one when re-challaned).
    const chByDispatch = new Map<number, OrderTimelineChallanRef>();
    for (const ci of chItems) {
      if (ci.dispatchId == null || !ci.challan) continue;
      const cur = chByDispatch.get(ci.dispatchId);
      if (cur && cur.challanStatus !== 'CANCELLED') continue;
      chByDispatch.set(ci.dispatchId, {
        id: ci.challan.id,
        code: ci.challan.code,
        invDate: ci.challan.invDate.toISOString(),
        challanStatus: ci.challan.challanStatus,
      });
    }

    const byLine = new Map<number, typeof dispatches>();
    for (const d of dispatches) {
      const list = byLine.get(d.orderItemId) ?? [];
      list.push(d);
      if (!byLine.has(d.orderItemId)) byLine.set(d.orderItemId, list);
    }

    return {
      orderId: order.id,
      code: order.code ?? this.codeFor(order.id),
      customerName: order.customerName,
      orderDate: order.orderDate.toISOString(),
      completionDate: order.completionDate ? order.completionDate.toISOString() : null,
      status: order.status,
      lines: order.items.map((it) => {
        const ds = byLine.get(it.id) ?? [];
        return {
          orderItemId: it.id,
          productName: it.productName,
          designType: it.designType,
          status: it.status ?? 'CONFIRMED',
          bags: it.bags,
          pcs: it.pcs,
          kgs: it.gram,
          box: it.box,
          calField: it.calField,
          fullyDispatched: ds.some((d) => d.dispatchStatus === 'FULLY DISPATCH'),
          dispatches: ds.map((d) => ({
            id: d.id,
            code: d.code,
            dispatchDate: d.dispatchDate.toISOString(),
            bags: d.bags,
            pcs: d.pcs,
            kgs: d.gram,
            box: d.box,
            dispatchStatus: d.dispatchStatus,
            challan: chByDispatch.get(d.id) ?? null,
          })),
        };
      }),
    };
  }

  /** Distinct product / design values present on order lines, for the Orders
   *  page filter dropdowns (only values that can actually match something). */
  async filterOptions(): Promise<OrderFilterOptions> {
    const rows = await this.prisma.orderItem.findMany({
      select: { productName: true, product: true, designType: true },
    });
    const products = new Set<string>();
    const designs = new Set<string>();
    for (const r of rows) {
      const p = r.productName || r.product;
      if (p) products.add(p);
      if (r.designType && r.designType.toUpperCase() !== 'NA') designs.add(r.designType);
    }
    const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    return { products: sorted(products), designs: sorted(designs) };
  }

  async lookups(): Promise<OrderLookupsWire> {
    const [customers, prodCats, subCats, products, designs, allProducts, designNames] = await Promise.all([
      this.prisma.customer.findMany({
        where: { partyName: { not: null }, active: true },
        select: { id: true, partyName: true, agentName: true, category: true },
        orderBy: { partyName: 'asc' },
      }),
      this.prisma.product.findMany({ where: { category: { not: '' } }, select: { category: true }, distinct: ['category'], orderBy: { category: 'asc' } }),
      this.prisma.product.findMany({ where: { subCategory: { not: '' } }, select: { subCategory: true }, distinct: ['subCategory'], orderBy: { subCategory: 'asc' } }),
      this.prisma.product.findMany({
        where: { product: { not: '' }, active: true },
        select: { product: true, category: true, subCategory: true, rate: true },
        distinct: ['product'],
        orderBy: { product: 'asc' },
      }),
      this.prisma.design.findMany({
        where: { active: true },
        select: { category: true, subCategory: true, designType: true, rate: true },
        distinct: ['category', 'subCategory', 'designType'],
        orderBy: [{ category: 'asc' }, { designType: 'asc' }],
      }),
      // Every ACTIVE product row (incl. size variants) for the composite item-name list.
      this.prisma.product.findMany({
        where: { product: { not: '' }, active: true },
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

    // The legacy-style item list (each product on its own, plus the product
    // paired with every design type in its category + sub-category) is NOT
    // composed here anymore: multiplied out it was ~6,600 rows / 94% of a
    // 1.3 MB payload. The client rebuilds it from the raw rows below
    // (composeOrderLookups in apps/web/src/features/orders/use-orders.ts).
    return {
      customers: custList,
      categories: prodCats.map((c) => c.category).filter(Boolean),
      subCategories: subCats.map((c) => c.subCategory).filter(Boolean),
      products: products.map((p) => ({ product: p.product, category: p.category, subCategory: p.subCategory, rate: p.rate })),
      designs: designs.map((d) => ({ category: d.category, subCategory: d.subCategory, designType: d.designType, designName: nameOf(d.designType), rate: d.rate })),
      productRows: allProducts.map((p) => ({ product: p.product, category: p.category, subCategory: p.subCategory, size: p.size, pcs: p.pcs, weight: p.weight, rate: p.rate })),
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

  async generateOrderBillPdf(id: number, isQuotation: boolean): Promise<{ buffer: Buffer; filename: string }> {
    const order = await this.findOne(id);
    let companyName = 'KAVISH';
    let terms: string[] = [];
    let footerLines: string[] = [];
    const docType = isQuotation ? 'QUOTATION' : 'SALES ORDER';

    try {
      const companyRow = await this.prisma.appConfig.findUnique({ where: { key: 'COMPANY_PROFILE' } });
      if (companyRow?.value) {
        const parsed = JSON.parse(companyRow.value);
        companyName = parsed.name || 'KAVISH';
      }
    } catch (e) {
      // Silently use default
    }

    try {
      const termsRow = await this.prisma.appConfig.findUnique({ where: { key: 'ORDER_TERMS' } });
      if (termsRow?.value) {
        const parsed = JSON.parse(termsRow.value);
        terms = parsed.terms || [];
      }
    } catch (e) {
      // Silently use default
    }

    try {
      const footerRow = await this.prisma.appConfig.findUnique({ where: { key: 'ORDER_FOOTER' } });
      if (footerRow?.value) {
        const parsed = JSON.parse(footerRow.value);
        const lines = parsed.lines || [];
        footerLines = lines.map((l: string) => l.replaceAll('{DOC_TYPE}', docType));
      }
    } catch (e) {
      // Silently use default
    }

    const buffer = await this.pdf.render(this.buildOrderBillDoc(order, companyName, terms, footerLines, isQuotation));
    const stamp = new Date().toISOString().slice(0, 10);
    const prefix = isQuotation ? 'Quotation' : 'Order';
    return { buffer, filename: `${prefix}_${(order.code || `${prefix.toLowerCase()}-${id}`).replace(/[\\/:*?"<>|]/g, '-')}_${stamp}.pdf` };
  }

  private buildOrderBillDoc(order: OrderDto, companyName: string, terms: string[], footerLines: string[], isQuotation: boolean): TDocumentDefinitions {
    // Simplified version for testing
    const docType = isQuotation ? 'QUOTATION' : 'SALES ORDER';
    return {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 40],
      defaultStyle: { font: 'Helvetica', fontSize: 12 },
      content: [
        { text: docType, bold: true, fontSize: 20 },
        { text: companyName, fontSize: 14, margin: [0, 10, 0, 0] },
        { text: `Order: ${order.code}`, margin: [0, 20, 0, 0] },
        { text: `Customer: ${order.customerName}`, margin: [0, 10, 0, 0] },
        { text: `Items: ${order.items.filter(it => it.status !== 'CANCELLED').length}`, margin: [0, 10, 0, 0] },
      ],
    } as TDocumentDefinitions;
  }

  private buildOrderBillDocFull(order: OrderDto, companyName: string, terms: string[], footerLines: string[], isQuotation: boolean): TDocumentDefinitions {
    const NAVY = '#163E64';
    const ORANGE = '#E8A33D';
    const BLACK = '#111111';
    const BORDER = '#C9D2DC';
    const GREY = '#555555';
    const q = (v?: number | null) => (v ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '-');
    const money = (v?: number | null) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const d = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

    const docTitle = isQuotation ? 'QUOTATION' : 'SALES ORDER';
    const printItems = order.items.filter((it) => it.status !== 'CANCELLED');
    // Orders don't have pre-calculated amounts like challans do
    const subTotal = 0;

    // Items table header
    const head = [
      { text: '#', bold: true, color: BLACK, alignment: 'center' as const, fontSize: 11 },
      { text: 'ITEM NAME', bold: true, color: BLACK, alignment: 'left' as const, fontSize: 11 },
      { text: 'BAGS', bold: true, color: BLACK, alignment: 'right' as const, fontSize: 11 },
      { text: 'PCS', bold: true, color: BLACK, alignment: 'right' as const, fontSize: 11 },
      { text: 'KGS', bold: true, color: BLACK, alignment: 'right' as const, fontSize: 11 },
      { text: 'BOX', bold: true, color: BLACK, alignment: 'right' as const, fontSize: 11 },
      { text: 'RATE', bold: true, color: BLACK, alignment: 'right' as const, fontSize: 11 },
      { text: 'COMMENTS', bold: true, color: BLACK, alignment: 'left' as const, fontSize: 11 },
    ];

    const rows = printItems.map((it, idx) => [
      { text: String(idx + 1), alignment: 'center' as const, fontSize: 11 },
      { text: it.productName || '—', fontSize: 11 },
      { text: q(it.bags), alignment: 'right' as const, fontSize: 11 },
      { text: q(it.pcs), alignment: 'right' as const, fontSize: 11 },
      { text: q(it.gram), alignment: 'right' as const, fontSize: 11 },
      { text: q(it.box), alignment: 'right' as const, fontSize: 11 },
      { text: q(it.rate), alignment: 'right' as const, fontSize: 11 },
      { text: it.comment || '', fontSize: 11 },
    ]);

    const itemsTable = {
      table: {
        headerRows: 1,
        widths: ['5%', '24%', '9%', '9%', '9%', '9%', '10%', '25%'],
        body: [head, ...rows],
      },
      layout: {
        fillColor: (rowIndex: number) => (rowIndex === 0 ? ORANGE : null),
        hLineColor: () => BORDER,
        vLineColor: () => BORDER,
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        paddingLeft: () => 5,
        paddingRight: () => 5,
        paddingTop: () => 4,
        paddingBottom: () => 4,
      },
      margin: [24, 0, 24, 16],
    };

    // Charges section (70%/30% split)
    const chargesTable = {
      columns: [
        {
          width: '*',
          stack: [],
        },
        {
          width: 220,
          table: {
            widths: [130, 90],
            body: [
              [
                { text: 'SUBTOTAL', bold: true, fillColor: ORANGE, color: BLACK, fontSize: 11 },
                { text: money(subTotal), bold: true, fillColor: ORANGE, alignment: 'right' as const, fontSize: 11 },
              ],
              [
                { text: 'TOTAL', bold: true, fillColor: ORANGE, color: BLACK, fontSize: 11 },
                { text: money(subTotal), bold: true, fillColor: ORANGE, alignment: 'right' as const, fontSize: 11 },
              ],
            ],
          },
          layout: {
            hLineColor: () => BORDER,
            vLineColor: () => BORDER,
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 4,
            paddingBottom: () => 4,
          },
        },
      ],
      margin: [24, 0, 24, 16],
    };

    // Terms section
    const termsContent = terms.length
      ? [
          { text: 'TERMS & CONDITIONS', bold: true, color: GREY, fontSize: 11, margin: [24, 16, 24, 8] },
          ...terms.map((term, i) => ({ text: `${i + 1}. ${term}`, fontSize: 10, margin: [24, 2, 24, 2], color: GREY })),
        ]
      : [];

    // Footer content
    const footerContent = footerLines.length
      ? [{ text: footerLines.join('\n'), alignment: 'center' as const, fontSize: 11, bold: true, margin: [24, 16, 24, 0] }]
      : [];

    return {
      pageSize: 'A4',
      pageMargins: [0, 0, 0, 40],
      defaultStyle: { font: 'Helvetica', fontSize: 10, color: BLACK },
      content: [
        // Header
        {
          columns: [
            {
              width: '*',
              stack: [
                { text: docTitle, bold: true, fontSize: 24, color: BLACK, margin: [0, 0, 0, 8] },
                { text: companyName, bold: true, fontSize: 14, color: BLACK },
              ],
            },
          ],
          fillColor: '#F8F9FA',
          margin: [24, 16, 24, 16],
        },
        // Meta information grid
        {
          table: {
            widths: ['15%', '35%', '15%', '35%'],
            body: [
              [
                { text: isQuotation ? 'QUOTATION ID' : 'ORDER ID', bold: true, color: GREY, fontSize: 11 },
                { text: `#${order.code || order.id}`, bold: true, fontSize: 11 },
                { text: isQuotation ? 'QUOTATION DATE' : 'ORDER DATE', bold: true, color: GREY, fontSize: 11 },
                { text: d(order.orderDate), bold: true, fontSize: 11 },
              ],
              [
                { text: 'DUE DATE', bold: true, color: GREY, fontSize: 11 },
                { text: d(order.completionDate), bold: true, fontSize: 11 },
                { text: isQuotation ? 'QUOTE TO' : 'BILL TO', bold: true, color: GREY, fontSize: 11 },
                { text: order.customerName || '—', bold: true, fontSize: 11 },
              ],
              [
                { text: 'ADDRESS', bold: true, color: GREY, fontSize: 11 },
                { text: order.billingAddress || '—', fontSize: 11 },
                { text: '', fontSize: 11 },
                { text: '', fontSize: 11 },
              ],
            ],
          },
          layout: 'noBorders',
          margin: [24, 0, 24, 16],
        },
        itemsTable,
        chargesTable,
        ...termsContent,
        ...footerContent,
      ],
      footer: (currentPage: number) => ({
        text: `Page ${currentPage}`,
        alignment: 'center' as const,
        fontSize: 9,
        color: '#999999',
        margin: [0, 16, 0, 0],
      }),
    } as unknown as TDocumentDefinitions;
  }

  private buildSalesOrderDoc(order: OrderDto): TDocumentDefinitions {
    const BLUE = '#156082';
    const ORANGE = '#F99A0F';
    const AMBER = '#F59E0B';
    const BLACK = '#111111';
    const q = (v?: number | null) => (v ? v.toLocaleString('en-IN') : '');
    const d = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
    const code = order.code ?? `#${order.id}`;
    // Cancelled lines are omitted from the printed sales order.
    const printItems = order.items.filter((it) => it.status !== 'CANCELLED');
    const t = printItems.reduce(
      (a, it) => ({ bags: a.bags + (it.bags ?? 0), pcs: a.pcs + (it.pcs ?? 0), kgs: a.kgs + (it.gram ?? 0), box: a.box + (it.box ?? 0) }),
      { bags: 0, pcs: 0, kgs: 0, box: 0 },
    );

    const head = ['#', 'Item Name', 'Bags', 'PCs', 'KGs', 'Box', 'Rate', 'Comment'].map((text, i) => ({
      text,
      bold: true,
      color: BLACK,
      alignment: i === 0 ? 'center' : i >= 2 && i <= 6 ? 'right' : 'left',
    }));
    const itemRows = printItems.map((it, idx) => [
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
      status: uc(it.status) === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED',
      comment: toStr(it.comment),
      bookingId: toNum(it.bookingId),
    };
  }

  // ── Order-line photos ────────────────────────────────────────────────────────

  /** New (not-yet-saved) photo rows from a line input — the ones with a `path`
   *  but no `id` (freshly uploaded via POST /files/upload). */
  private newPhotoRows(it: Record<string, unknown>): Prisma.OrderItemPhotoCreateWithoutOrderItemInput[] {
    const photos = Array.isArray(it.photos) ? (it.photos as Record<string, unknown>[]) : [];
    return photos
      .filter((p) => !toNum(p.id) && toStr(p.path) && toStr(p.url))
      .map((p) => ({
        path: toStr(p.path)!,
        url: toStr(p.url)!,
        filename: toStr(p.filename),
        mimeType: toStr(p.mimeType),
        size: toNum(p.size),
      }));
  }

  /** Nested `create` clause for a brand-new line's photos (empty when none). */
  private photoCreateNested(it: Record<string, unknown>): Prisma.OrderItemCreateWithoutOrderInput {
    const create = this.newPhotoRows(it);
    return create.length ? { photos: { create } } : {};
  }

  /** Nested photo reconcile for an existing line. Only touches photos when the
   *  input actually carries a `photos` array — so callers that don't manage
   *  photos (e.g. Order Modify's line save) leave them untouched. Photos present
   *  by `id` are kept; any others on the line are removed; new uploads are added. */
  private photoUpdateNested(it: Record<string, unknown>): Prisma.OrderItemUpdateWithoutOrderInput {
    if (!Array.isArray(it.photos)) return {};
    const keptIds = (it.photos as Record<string, unknown>[])
      .map((p) => toNum(p.id))
      .filter((v): v is number => v != null);
    const create = this.newPhotoRows(it);
    return {
      photos: {
        // deleteMany:{} (empty filter) removes every photo of this line — correct
        // when the user cleared them all; otherwise keep the ones still referenced.
        deleteMany: keptIds.length ? { id: { notIn: keptIds } } : {},
        ...(create.length ? { create } : {}),
      },
    };
  }

  private toPhotoDto(ph: PhotoRow): OrderItemPhotoDto {
    return {
      id: ph.id,
      path: ph.path,
      url: ph.url,
      filename: ph.filename,
      mimeType: ph.mimeType,
      size: ph.size,
      uploadedBy: ph.uploadedBy,
      createdAt: ph.createdAt.toISOString(),
    };
  }

  /** List an order line's photos (used by the Dispatch & Order-Modify sheets). */
  async listPhotos(orderItemId: number): Promise<OrderItemPhotoDto[]> {
    await this.ensureItemExists(orderItemId);
    const rows = await this.prisma.orderItemPhoto.findMany({ where: { orderItemId }, orderBy: { id: 'asc' } });
    return rows.map((r) => this.toPhotoDto(r));
  }

  /** Attach an already-uploaded file to an order line. */
  async addPhoto(orderItemId: number, dto: AddOrderItemPhotoDto, uploadedBy?: string | null): Promise<OrderItemPhotoDto> {
    await this.ensureItemExists(orderItemId);
    const row = await this.prisma.orderItemPhoto.create({
      data: {
        orderItemId,
        path: dto.path,
        url: dto.url,
        filename: dto.filename ?? null,
        mimeType: dto.mimeType ?? null,
        size: dto.size ?? null,
        uploadedBy: uploadedBy ?? null,
      },
    });
    return this.toPhotoDto(row);
  }

  /** Detach a photo and best-effort delete its file from /uploads. */
  async deletePhoto(photoId: number): Promise<void> {
    const row = await this.prisma.orderItemPhoto.findUnique({ where: { id: photoId } });
    if (!row) throw new NotFoundException('Photo not found.');
    await this.prisma.orderItemPhoto.delete({ where: { id: photoId } });
    try {
      await unlink(join(UPLOADS_DIR, row.path));
    } catch {
      /* file already gone — nothing to clean up */
    }
  }

  private async ensureItemExists(orderItemId: number): Promise<void> {
    const c = await this.prisma.orderItem.count({ where: { id: orderItemId } });
    if (!c) throw new NotFoundException('Order line not found.');
  }

  // ── Bag-booking draw-down (order lines sourced from a booking) ───────────────

  /** Distinct booking ids referenced by a set of order-item rows. */
  private bookingIdsOf(items: { bookingId: number | null }[]): number[] {
    return [...new Set(items.map((it) => it.bookingId).filter((v): v is number => v != null))];
  }

  private async recomputeBookings(ids: number[]): Promise<void> {
    for (const bid of new Set(ids)) await this.bookings.recompute(bid);
  }

  /** Re-price every booking-sourced line at its booking's frozen date rates so the
   *  stored rate can't drift from (or be tampered against) the booking-date value. */
  private async applyBookingPricing(items: Record<string, unknown>[]): Promise<void> {
    for (const it of items) {
      const bookingId = toNum(it.bookingId);
      if (!bookingId) continue;
      const priced = await this.bookings.priceOrderLine(bookingId, {
        pCategory: toStr(it.pCategory),
        subCategory: toStr(it.subCategory),
        product: toStr(it.product),
        productName: toStr(it.productName),
        designType: toStr(it.designType),
        design: toStr(it.design),
        psize: toNum(it.psize),
      });
      if (!priced) throw new BadRequestException('The booking for a drawn line no longer exists.');
      it.productRate = priced.productRate + priced.productDelta;
      it.designRate = priced.designRate + priced.designDelta;
      it.rate = priced.rate;
    }
  }

  /** Reject a save that would draw more bags/kgs than a booking has left. When
   *  updating, `excludeOrderId` drops this order's own current draw from the tally
   *  so its kept lines aren't counted against it. */
  private async assertBookingCapacity(items: Record<string, unknown>[], excludeOrderId?: number): Promise<void> {
    const byBooking = new Map<number, { bags: number; kgs: number }>();
    for (const it of items) {
      const bookingId = toNum(it.bookingId);
      if (!bookingId || uc(it.status) === 'CANCELLED') continue;
      const acc = byBooking.get(bookingId) ?? { bags: 0, kgs: 0 };
      acc.bags += toNum(it.bags) ?? 0;
      acc.kgs += toNum(it.gram) ?? 0;
      byBooking.set(bookingId, acc);
    }
    for (const [bookingId, sum] of byBooking) {
      const info = await this.bookings.remainingFor(bookingId, excludeOrderId);
      if (!info) throw new BadRequestException('A drawn booking no longer exists.');
      if (info.booking.status === 'CANCELLED') throw new BadRequestException(`Booking ${info.booking.code ?? bookingId} is cancelled and can't be drawn.`);
      if (sum.bags - info.remBags > 0.001) throw new BadRequestException(`Drawing ${sum.bags} bags exceeds the ${info.remBags} left on booking ${info.booking.code ?? bookingId}.`);
      if (sum.kgs - info.remKgs > 0.001) throw new BadRequestException(`Drawing ${sum.kgs} kgs exceeds the ${info.remKgs} left on booking ${info.booking.code ?? bookingId}.`);
    }
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

  private toDto(r: Row, dispatchState: OrderDto['dispatchState'] = null, dispatchedItemIds?: Set<number>): OrderDto {
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
      status: it.status ?? 'CONFIRMED',
      comment: it.comment,
      dispatched: dispatchedItemIds?.has(it.id) ?? false,
      bookingId: it.bookingId ?? null,
      // Booking codes use the fixed BKG-##### format (see BookingsService), so the
      // source code can be derived without another query.
      bookingCode: it.bookingId != null ? `BKG-${String(it.bookingId).padStart(5, '0')}` : null,
      photos: (it.photos ?? []).map((ph) => this.toPhotoDto(ph)),
    }));
    // Cancelled lines are kept for the record but excluded from the order's totals.
    const active = items.filter((it) => it.status !== 'CANCELLED');
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
      itemCount: active.length,
      totalRate: active.reduce((s, it) => s + (it.rate ?? 0), 0),
      totalAmount: active.reduce((s, it) => s + (it.rate ?? 0) * (it.calField === 'PCS' ? (it.pcs ?? 0) : (it.gram ?? 0)), 0),
      dispatchState,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
