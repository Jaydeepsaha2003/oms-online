import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  isUncommittedOrder,
  ORDER_UNCOMMITTED_STATUSES,
  type OrderDto,
  type OrderFilterOptions,
  type OrderItemPhotoDto,
  type OrderLookupsWire,
  type OrderTimeline,
  type OrderTimelineChallanRef,
  type Paginated,
} from '@oms/shared';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { PrismaService } from '../prisma/prisma.service';
import { formatDate } from '../common/date.util';
import { PdfService } from '../pdf/pdf.service';
import { BookingsService } from '../bookings/bookings.service';
import { toNum, toStr, uc } from '../common/coerce';
import { readCategoryFields } from '../common/category-fields';
import { UPLOADS_DIR } from '../uploads/uploads.constants';
import { AddOrderItemPhotoDto, CreateOrderDto, OrderQueryDto, PriceAsOfDto, UpdateOrderDto } from './dto/order.dto';

const INCLUDE = { items: { include: { photos: { orderBy: { id: 'asc' } } } } } as const;
type Row = Prisma.OrderGetPayload<{ include: typeof INCLUDE }>;
type PhotoRow = Prisma.OrderItemPhotoGetPayload<object>;

/** One flattened order-line row for the Order Modify Excel export. */
export interface OrderLineExportRow {
  orderId: number;
  orderCode: string | null;
  orderDate: Date;
  dueDate: Date | null;
  customerName: string;
  productName: string;
  designType: string;
  priority: string;
  bags: number | null;
  pcs: number | null;
  gram: number | null;
  box: number | null;
  rate: number | null;
  comment: string;
  status: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly bookings: BookingsService,
  ) {}

  /**
   * The filters that describe a LINE rather than an order.
   *
   * Order Modify is a line grid, so these have to be applied to the lines
   * themselves. Constraining only the parent order (`items: { some: … }`) keeps
   * the right orders but then hands back ALL of their lines — which is why
   * filtering to product "10 ROYAL SPECIAL" also returned "5 RAMPATRA": a
   * different line of the same order. Used twice: to pick the orders worth
   * fetching, and again to prune each one's lines to the matching ones.
   *
   * Note this is a single `some` over the whole conjunction, not a `some` per
   * filter. Product X AND design Y now means "one line has both", where before
   * an order with X on one line and Y on another would qualify with neither
   * line actually matching.
   */
  private lineWhere(query: OrderQueryDto): Prisma.OrderItemWhereInput | undefined {
    const and: Prisma.OrderItemWhereInput[] = [];
    if (query.product) and.push({ OR: [{ productName: query.product }, { product: query.product }] });
    if (query.design) and.push({ designType: query.design });
    if (query.priority) and.push({ priority: query.priority });
    return and.length ? { AND: and } : undefined;
  }

  /** Shared where-builder for the order list and the Order Modify export —
   *  every exact-match / search filter both screens offer. */
  private buildWhere(query: OrderQueryDto): Prisma.OrderWhereInput {
    const search = query.search?.trim();
    const lineWhere = this.lineWhere(query);
    return {
      ...(query.status ? { status: uc(query.status)! } : {}),
      ...(query.customer ? { customerName: query.customer } : {}),
      ...(query.agent ? { agentName: query.agent } : {}),
      ...(query.orderId ? { id: query.orderId } : {}),
      // Skip orders with no matching line at all, so a filtered page isn't
      // padded out with orders that contribute zero rows once pruned.
      ...(lineWhere ? { items: { some: lineWhere } } : {}),
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
  }

  /** {@link INCLUDE}, with each order's lines pruned to those matching the
   *  line-level filters — so the caller only ever sees rows it asked for. */
  private includeFor(query: OrderQueryDto) {
    return { items: { where: this.lineWhere(query), include: INCLUDE.items.include } };
  }

  async findMany(query: OrderQueryDto): Promise<Paginated<OrderDto>> {
    // A QUOTED order is parked: it was saved as a quotation, so the quotation is
    // the document people work with and this row must not show up as an order —
    // otherwise the same job appears twice, once in each list. Drafts DO show
    // here (that's the point of saving one). Skipped when an explicit status
    // filter is in play, since QUOTED is never one of the choices anyway.
    const where: Prisma.OrderWhereInput = {
      ...this.buildWhere(query),
      ...(query.status ? {} : { status: { not: 'QUOTED' } }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: this.includeFor(query),
        // Newest order first, by Order # (id) rather than order date.
        orderBy: [{ id: 'desc' }],
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
      items: rows.map((r) => this.toDto(r, stateOf(r), hasDispatch, hasFull)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /**
   * Every order LINE matching Order Modify's current filters, flattened —
   * mirrors exactly what that screen shows (drafts excluded, same as its own
   * client-side filter). Line-level filters are pruned by `includeFor`, the same
   * way the list does it, so the sheet and the screen can't disagree.
   */
  async exportLines(query: OrderQueryDto): Promise<OrderLineExportRow[]> {
    const where: Prisma.OrderWhereInput = {
      ...this.buildWhere(query),
      status: { notIn: [...ORDER_UNCOMMITTED_STATUSES] },
    };
    const rows = await this.prisma.order.findMany({ where, include: this.includeFor(query), orderBy: [{ id: 'desc' }] });
    const out: OrderLineExportRow[] = [];
    for (const o of rows) {
      for (const it of o.items) {
        out.push({
          orderId: o.id,
          orderCode: o.code,
          orderDate: o.orderDate,
          dueDate: o.completionDate,
          customerName: o.customerName,
          productName: it.productName || it.product || '',
          designType: it.designType && it.designType.toUpperCase() !== 'NA' ? it.designType : '',
          priority: it.priority ?? '',
          bags: it.bags,
          pcs: it.pcs,
          gram: it.gram,
          box: it.box,
          rate: it.rate,
          comment: it.comment ?? '',
          status: it.status === 'CANCELLED' ? 'CANCELLED' : o.status,
        });
      }
    }
    return out;
  }

  async findOne(id: number): Promise<OrderDto> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundException('Order not found.');
    const dispatched = row.items.length
      ? await this.prisma.dispatch.findMany({
          where: { orderItemId: { in: row.items.map((it) => it.id) } },
          select: { orderItemId: true, dispatchStatus: true },
        })
      : [];
    const dto = this.toDto(
      row,
      null,
      new Set(dispatched.map((d) => d.orderItemId)),
      new Set(dispatched.filter((d) => d.dispatchStatus === 'FULLY DISPATCH').map((d) => d.orderItemId)),
    );
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

  /** Order Modify's item-change rate check — delegates to the same as-of-date
   *  pricing Bag Bookings already uses, anchored on this order's own date
   *  instead of a booking date. See {@link BookingsService.priceAsOf}. */
  async priceAsOf(dto: PriceAsOfDto) {
    const asOfDate = new Date(dto.asOfDate);
    if (Number.isNaN(asOfDate.getTime())) throw new BadRequestException('Invalid date.');
    return this.bookings.priceAsOf(dto.customerId ?? null, asOfDate, {
      pCategory: dto.pCategory ?? null,
      subCategory: dto.subCategory ?? null,
      product: dto.product ?? null,
      designType: dto.designType ?? null,
      psize: dto.psize ?? null,
    });
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

  /**
   * @param opts.revivingQuotation set only by QuotationsService.convert(), which
   *   is the one caller allowed to write a QUOTED (parked) order — that IS the
   *   revive. Everything else must be turned away, or edits made here would be
   *   silently overwritten by the quotation's lines the moment it converts.
   */
  async update(
    id: number,
    dto: UpdateOrderDto,
    actorName?: string | null,
    opts?: { revivingQuotation?: boolean; isSuperAdmin?: boolean },
  ): Promise<OrderDto> {
    const current = await this.prisma.order.findUnique({
      where: { id },
      select: { status: true, completionDate: true, quotationSource: { select: { code: true } } },
    });
    if (!current) throw new NotFoundException('Order not found.');
    if (current.status === 'QUOTED' && !opts?.revivingQuotation) {
      throw new BadRequestException(
        `This order is parked as quotation ${current.quotationSource?.code ?? ''}`.trim() +
          ' — edit the quotation instead. Converting it brings this order back.',
      );
    }
    const data = await this.toHeaderData(dto as CreateOrderDto);
    await this.assertMayRescheduleAfterDispatch(id, current.completionDate, data.completionDate ?? null, opts?.isSuperAdmin ?? false);
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
      const quotation = await this.prisma.quotation.findFirst({
        where: { OR: [{ convertedOrderId: id }, { sourceOrderId: id }] },
        select: { id: true },
      });
      const quotationId = quotation?.id ?? null;

      const existing = await this.prisma.orderItem.findMany({
        where: { orderId: id },
        select: {
          id: true,
          product: true,
          productName: true,
          design: true,
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
          status: true,
          comment: true,
          priority: true,
          quotationItemId: true,
          // The dispatch rows themselves, not just a count: the quantity guard
          // below needs how much has actually shipped, per field.
          dispatches: { select: { bags: true, pcs: true, gram: true, box: true, dispatchStatus: true } },
        },
      });
      const existingById = new Map(existing.map((e) => [e.id, e]));
      const existingIds = new Set(existing.map((e) => e.id));
      const kept = new Set<number>();
      const toUpdate: { where: { id: number }; data: Prisma.OrderItemUpdateWithoutOrderInput }[] = [];
      const toCreate: Prisma.OrderItemCreateWithoutOrderInput[] = [];
      const changesToRecord: Prisma.OrderItemChangeCreateManyInput[] = [];

      for (const it of dto.items) {
        const itemId = toNum(it.id);
        if (itemId && existingIds.has(itemId)) {
          kept.add(itemId);
          const current = existingById.get(itemId)!;
          const incoming = this.toItemData(it);
          if (current.dispatches.length > 0) {
            const label = current.productName || current.product || 'This item';
            // WHAT was shipped, and at what price, is settled by the dispatch —
            // changing the product, design, size or rate would rewrite history.
            const identityChanged =
              current.product !== incoming.product ||
              current.designType !== incoming.designType ||
              current.psize !== incoming.psize ||
              current.productRate !== incoming.productRate ||
              current.designRate !== incoming.designRate ||
              current.rate !== incoming.rate ||
              current.calField !== incoming.calField;
            if (identityChanged) {
              throw new BadRequestException(
                `"${label}" has already been dispatched — its product, design and rate can't be edited. Add the change as a new line instead.`,
              );
            }
            // HOW MUCH was ordered may still move on a part-shipped line. Ordering
            // 1.5 bags / 170 kgs, shipping 1.5 bags / 97 kgs and then finding the
            // remaining 73 kgs needs another bag is ordinary; forcing that onto a
            // second line splits one physical item in two on every report. Two
            // limits keep the books straight — see each throw.
            const qtyChanged =
              current.bags !== incoming.bags ||
              current.pcs !== incoming.pcs ||
              current.gram !== incoming.gram ||
              current.box !== incoming.box;
            if (qtyChanged) {
              // A fully-dispatched line is skipped by the pending pool, so raising
              // it here would never reach the shop floor — it would just look edited.
              if (current.dispatches.some((d) => d.dispatchStatus === 'FULLY DISPATCH')) {
                throw new BadRequestException(
                  `"${label}" is fully dispatched, so changing its quantity would have no effect on what still ships. Add the extra quantity as a new line instead.`,
                );
              }
              const shipped = current.dispatches.reduce(
                (a, d) => ({ bags: a.bags + (d.bags ?? 0), pcs: a.pcs + (d.pcs ?? 0), gram: a.gram + (d.gram ?? 0), box: a.box + (d.box ?? 0) }),
                { bags: 0, pcs: 0, gram: 0, box: 0 },
              );
              // Dropping below what has already gone out would make the dispatch
              // exceed the order and show a negative pending quantity.
              const short = ([
                ['Bags', incoming.bags, shipped.bags],
                ['Pcs', incoming.pcs, shipped.pcs],
                ['Kgs', incoming.gram, shipped.gram],
                ['Box', incoming.box, shipped.box],
              ] as const).find(([, want, sent]) => (want ?? 0) + 0.0001 < sent);
              if (short) {
                throw new BadRequestException(
                  `"${label}" already has ${short[2]} ${short[0]} dispatched, so the order line can't be set to ${short[1] ?? 0}. Correct or delete that dispatch first.`,
                );
              }
            }
          }

          // Diff fields to log change history & update QuotationItem
          const fieldsToDiff: Array<{ key: keyof typeof incoming; label: string }> = [
            { key: 'productName', label: 'Product Name' },
            { key: 'product', label: 'Product' },
            { key: 'design', label: 'Design' },
            { key: 'designType', label: 'Design Type' },
            { key: 'psize', label: 'Size' },
            { key: 'bags', label: 'Bags' },
            { key: 'pcs', label: 'Pcs' },
            { key: 'gram', label: 'Kgs' },
            { key: 'box', label: 'Box' },
            { key: 'productRate', label: 'Product Rate' },
            { key: 'designRate', label: 'Design Rate' },
            { key: 'rate', label: 'Rate' },
            { key: 'calField', label: 'Calc Unit' },
            { key: 'status', label: 'Status' },
            { key: 'comment', label: 'Comment' },
          ];

          for (const f of fieldsToDiff) {
            const oldV = current[f.key as keyof typeof current];
            const newV = incoming[f.key];
            if (oldV !== newV && (oldV != null || newV != null)) {
              changesToRecord.push({
                orderId: id,
                orderItemId: itemId,
                quotationId,
                quotationItemId: current.quotationItemId ?? null,
                kind: 'UPDATED',
                field: f.label,
                oldValue: oldV != null ? String(oldV) : '',
                newValue: newV != null ? String(newV) : '',
                itemLabel: (incoming.productName || incoming.product || current.productName || current.product || 'Line item') as string,
                changedByName: actorName ?? 'User',
              });
            }
          }

          if (current.quotationItemId) {
            await this.prisma.quotationItem.update({
              where: { id: current.quotationItemId },
              data: {
                pCategory: incoming.pCategory,
                subCategory: incoming.subCategory,
                product: incoming.product,
                design: incoming.design,
                productName: incoming.productName,
                designType: incoming.designType,
                psize: incoming.psize,
                bags: incoming.bags,
                pcs: incoming.pcs,
                gram: incoming.gram,
                box: incoming.box,
                productRate: incoming.productRate,
                designRate: incoming.designRate,
                rate: incoming.rate,
                calField: incoming.calField,
                priority: incoming.priority,
                ordType: incoming.ordType,
                comment: incoming.comment,
              },
            }).catch(() => null);
          }

          toUpdate.push({ where: { id: itemId }, data: { ...incoming, ...this.photoUpdateNested(it) } });
        } else {
          const incoming = this.toItemData(it);
          const label = (incoming.productName || incoming.product || 'New item') as string;
          changesToRecord.push({
            orderId: id,
            orderItemId: null,
            quotationId,
            quotationItemId: null,
            kind: 'ADDED',
            field: '',
            oldValue: null,
            newValue: label,
            itemLabel: label,
            changedByName: actorName ?? 'User',
          });

          if (quotationId) {
            const newQuoItem = await this.prisma.quotationItem.create({
              data: {
                quotationId,
                pCategory: incoming.pCategory,
                subCategory: incoming.subCategory,
                product: incoming.product,
                design: incoming.design,
                productName: incoming.productName,
                designType: incoming.designType,
                psize: incoming.psize,
                bags: incoming.bags,
                pcs: incoming.pcs,
                gram: incoming.gram,
                box: incoming.box,
                productRate: incoming.productRate,
                designRate: incoming.designRate,
                rate: incoming.rate,
                calField: incoming.calField,
                priority: incoming.priority,
                ordType: incoming.ordType,
                comment: incoming.comment,
              },
            }).catch(() => null);

            if (newQuoItem) {
              incoming.quotationItemId = newQuoItem.id;
            }
          }

          toCreate.push({ ...incoming, ...this.photoCreateNested(it) });
        }
      }
      const removed = existing.filter((e) => !kept.has(e.id));
      // Removing a line would cascade-delete its dispatches — refuse it and steer
      // the user to Cancel the line (which keeps the record) instead.
      if (removed.some((e) => e.dispatches.length > 0)) {
        throw new BadRequestException(
          'Cannot remove an order line that already has dispatches. Mark it Cancelled instead.',
        );
      }
      for (const rem of removed) {
        const label = (rem.productName || rem.product || 'Line item') as string;
        changesToRecord.push({
          orderId: id,
          orderItemId: rem.id,
          quotationId,
          quotationItemId: rem.quotationItemId ?? null,
          kind: 'REMOVED',
          field: '',
          oldValue: label,
          newValue: null,
          itemLabel: label,
          changedByName: actorName ?? 'User',
        });

        // Preserve photos: if rem had photos, re-assign them to a matching item in the order
        const remPhotos = await this.prisma.orderItemPhoto.findMany({ where: { orderItemId: rem.id } });
        if (remPhotos.length > 0) {
          const matchingItem = await this.prisma.orderItem.findFirst({
            where: {
              orderId: id,
              id: { notIn: removed.map((r) => r.id) },
              OR: [{ productName: rem.productName }, { product: rem.product }],
            },
          });
          if (matchingItem) {
            await this.prisma.orderItemPhoto.updateMany({
              where: { orderItemId: rem.id },
              data: { orderItemId: matchingItem.id },
            });
          }
        }

        if (rem.quotationItemId) {
          await this.prisma.quotationItem.delete({ where: { id: rem.quotationItemId } }).catch(() => null);
        }
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

      if (changesToRecord.length > 0) {
        await this.prisma.orderItemChange.createMany({ data: changesToRecord }).catch(() => null);
      }
    }

    const row = await this.prisma.order.findUnique({ where: { id }, include: INCLUDE });
    // Recompute every booking this order touched — before and after the change.
    await this.recomputeBookings(
      [...this.bookingIdsOf(row!.items), ...bookingsBefore.map((b) => b.bookingId!)],
      actorName,
    );
    return this.toDto(await this.ensureCode(row!));
  }

  async remove(id: number, actorName?: string | null): Promise<void> {
    await this.ensureExists(id);
    const bookingLines = await this.prisma.orderItem.findMany({
      where: { orderId: id, bookingId: { not: null } },
      select: { bookingId: true },
    });
    await this.prisma.order.delete({ where: { id } });
    // Deleting the order frees any booking quantity its lines had drawn.
    await this.recomputeBookings(bookingLines.map((b) => b.bookingId!), actorName);
  }

  /** Cancel / restore an order. Cancelling is only allowed while the order is
   *  untouched — once any line has a dispatch, the order can no longer be
   *  cancelled (the record must stay consistent with the dispatch history). */
  async updateStatus(
    id: number,
    status: 'CONFIRMED' | 'CANCELLED',
    reason?: string,
    note?: string,
    actorName?: string | null,
  ): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({ where: { id }, select: { id: true, items: { select: { id: true } } } });
    if (!order) throw new NotFoundException('Order not found.');
    if (status === 'CANCELLED' && order.items.length) {
      const dispatched = await this.prisma.dispatch.count({ where: { orderItemId: { in: order.items.map((i) => i.id) } } });
      if (dispatched > 0) {
        throw new BadRequestException('This order already has dispatches — it can no longer be cancelled.');
      }
    }
    // Record why on cancel; clear it when the order is restored to CONFIRMED.
    const cancelData =
      status === 'CANCELLED'
        ? { cancelReason: reason?.trim() || null, cancelNote: note?.trim() || null }
        : { cancelReason: null, cancelNote: null };
    const row = await this.prisma.order.update({ where: { id }, data: { status, ...cancelData }, include: INCLUDE });
    // Cancelling/restoring the order changes whether its booking lines count as
    // drawn — recompute any booking it references.
    await this.recomputeBookings(this.bookingIdsOf(row.items), actorName);
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

  /**
   * Values for the Order Modify filter dropdowns.
   *
   * Cascading, the same way Modify Dispatch does it: each dropdown's options are
   * computed against the OTHER active filters but not its own, so picking a
   * customer narrows the product list to that customer's products while leaving
   * the customer list itself intact (otherwise selecting one would collapse its
   * own dropdown to a single entry and you could never switch). One flat scan of
   * order lines backs all of them — the filters are simple equality, so doing
   * the narrowing in memory beats five more round trips.
   */
  async filterOptions(query: OrderQueryDto = {} as OrderQueryDto): Promise<OrderFilterOptions> {
    const lines = await this.prisma.orderItem.findMany({
      select: {
        productName: true,
        product: true,
        designType: true,
        priority: true,
        order: { select: { id: true, code: true, status: true, customerName: true, agentName: true } },
      },
    });
    type Line = (typeof lines)[number];
    const productOf = (l: Line) => l.productName || l.product;
    const designOf = (l: Line) => (l.designType && l.designType.toUpperCase() !== 'NA' ? l.designType : null);

    const apply = (list: Line[], q: OrderQueryDto) => {
      let out = list;
      if (q.customer) out = out.filter((l) => l.order.customerName === q.customer);
      if (q.agent) out = out.filter((l) => l.order.agentName === q.agent);
      if (q.product) out = out.filter((l) => productOf(l) === q.product);
      if (q.design) out = out.filter((l) => designOf(l) === q.design);
      if (q.priority) out = out.filter((l) => (l.priority ?? '') === q.priority);
      if (q.orderId) out = out.filter((l) => l.order.id === q.orderId);
      return out;
    };
    /** The pool a given dropdown should offer: every other filter applied, its own ignored. */
    const poolFor = (exclude: keyof OrderQueryDto) => apply(lines, { ...query, [exclude]: undefined } as OrderQueryDto);

    const distinct = (list: Line[], pick: (l: Line) => string | null | undefined) => {
      const s = new Set<string>();
      for (const l of list) {
        const v = pick(l);
        if (v) s.add(v);
      }
      return [...s].sort((a, b) => a.localeCompare(b));
    };

    // Drafts and quotation-parked orders never show on Order Modify (see the
    // client's own filter), so the Order ID picker excludes them too — picking
    // one would otherwise land on an id the visible list can never match.
    const orderPool = poolFor('orderId').filter((l) => !isUncommittedOrder(l.order.status));
    const byId = new Map<number, { id: number; code: string | null }>();
    for (const l of orderPool) if (!byId.has(l.order.id)) byId.set(l.order.id, { id: l.order.id, code: l.order.code });

    return {
      customers: distinct(poolFor('customer'), (l) => l.order.customerName),
      agents: distinct(poolFor('agent'), (l) => l.order.agentName),
      products: distinct(poolFor('product'), productOf),
      designs: distinct(poolFor('design'), designOf),
      orders: [...byId.values()].sort((a, b) => b.id - a.id),
    };
  }

  async lookups(): Promise<OrderLookupsWire> {
    const [customers, prodCats, subCats, products, designs, combinations, allProducts, designNames] = await Promise.all([
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
      this.prisma.combination.findMany({
        include: { designLinks: { include: { design: true } } },
        orderBy: { name: 'asc' },
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
    const orderDesigns = designs.map((d) => ({
      category: d.category,
      subCategory: d.subCategory,
      designType: d.designType,
      designName: nameOf(d.designType),
      rate: d.rate,
      componentDesignTypes: [d.designType],
    }));
    for (const combination of combinations) {
      const members = combination.designLinks.map((link) => link.design);
      if (!members.length || members.some((design) => !design.active)) continue;
      const category = members[0].category;
      const subCategory = members[0].subCategory;
      // An order item has one category/sub-category. Mixed-scope combinations
      // cannot be paired with a product unambiguously, so keep those in the
      // Combination master but omit them from the item picker.
      if (members.some((design) => design.category !== category || design.subCategory !== subCategory)) continue;
      orderDesigns.push({
        category,
        subCategory,
        designType: combination.name,
        designName: combination.name,
        rate: members.reduce((sum, design) => sum + (design.rate ?? 0), 0),
        componentDesignTypes: members.map((design) => design.designType),
      });
    }
    orderDesigns.sort((a, b) =>
      a.category.localeCompare(b.category) ||
      a.subCategory.localeCompare(b.subCategory) ||
      a.designType.localeCompare(b.designType),
    );

    return {
      customers: custList,
      categories: prodCats.map((c) => c.category).filter(Boolean),
      subCategories: subCats.map((c) => c.subCategory).filter(Boolean),
      products: products.map((p) => ({ product: p.product, category: p.category, subCategory: p.subCategory, rate: p.rate })),
      designs: orderDesigns,
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
    const d = (s?: string | null) => formatDate(s);

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
    const d = (s?: string | null) => formatDate(s);
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

  /**
   * Moving the completion (due) date once an order has started shipping is
   * restricted to a super admin.
   *
   * The due date is not just a label: Pending Dispatch buckets lines as
   * Due / Past Due / Over Due against it (see `dueStatusOf`), and the party
   * ledger ages invoices by it. Pushing it out after goods have gone makes a
   * late order read as on-time for everyone looking at those screens, so it is
   * a deliberate, auditable act rather than an ordinary edit. Nothing changes
   * before the first dispatch, or when the date is left alone.
   */
  private async assertMayRescheduleAfterDispatch(
    orderId: number,
    currentDate: Date | null,
    // Prisma's input type widens this to `string | Date | null`, so accept both.
    incomingDate: string | Date | null,
    isSuperAdmin: boolean,
  ): Promise<void> {
    if (isSuperAdmin) return;
    // Compare the calendar day, not the instant — the incoming value is parsed
    // from a 'YYYY-MM-DD' string and needn't match the stored time exactly.
    const day = (v: string | Date | null) => {
      if (!v) return '';
      const d = typeof v === 'string' ? new Date(v) : v;
      return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };
    if (day(currentDate) === day(incomingDate)) return;
    const dispatched = await this.prisma.dispatch.count({ where: { orderItem: { orderId } } });
    if (!dispatched) return;
    throw new ForbiddenException(
      'This order has already been dispatched, so its completion date is locked — only a System Administrator can change it now. Every other detail is still editable.',
    );
  }

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
      // Carried through so a converted line keeps pointing at the quotation line
      // it came from. A line added later has none, which is what keeps
      // post-conversion additions out of the quotation.
      quotationItemId: toNum(it.quotationItemId),
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
    const photosArr = it.photos as Record<string, unknown>[];
    const keptIds = photosArr
      .map((p) => toNum(p.id))
      .filter((v): v is number => v != null);
    const create = this.newPhotoRows(it);

    if (photosArr.length === 0 && !create.length && !it._photosManaged) {
      return {};
    }

    return {
      photos: {
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

  /** Detach a photo and best-effort delete its file from /uploads. Once a
   *  challan has been raised against this line's dispatch, its photos are
   *  evidence of what actually shipped and can no longer be removed — mirrors
   *  {@link DispatchService.assertNotBilled}, checked here too since a photo
   *  can be deleted straight from Order Modify, not only from Modify Dispatch. */
  async deletePhoto(photoId: number): Promise<void> {
    const row = await this.prisma.orderItemPhoto.findUnique({ where: { id: photoId } });
    if (!row) throw new NotFoundException('Photo not found.');

    const dispatches = await this.prisma.dispatch.findMany({
      where: { orderItemId: row.orderItemId },
      select: { id: true },
    });
    if (dispatches.length) {
      const billed = await this.prisma.challanItem.findFirst({
        where: { dispatchId: { in: dispatches.map((d) => d.id) }, challan: { challanStatus: { not: 'CANCELLED' } } },
        select: { challan: { select: { code: true } } },
      });
      if (billed) {
        throw new BadRequestException(
          `This line is billed on challan ${billed.challan?.code ?? ''} — its photos can no longer be deleted.`,
        );
      }
    }

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

  /** `actorName` attributes a removal to whoever's edit/delete/cancel caused it
   *  — pass it only from a call that might actually remove a line (update,
   *  remove, updateStatus); omit it from create/convert/link, which only add. */
  private async recomputeBookings(ids: number[], actorName?: string | null): Promise<void> {
    for (const bid of new Set(ids)) await this.bookings.recompute(bid, actorName);
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
      if (info.booking.status === 'CANCELLED' || info.booking.status === 'PRECLOSED') {
        throw new BadRequestException(`Booking ${info.booking.code ?? bookingId} is ${info.booking.status.toLowerCase()} and can't be drawn.`);
      }
      if (sum.bags - info.remBags > 0.001) throw new BadRequestException(`Drawing ${sum.bags} bags exceeds the ${info.remBags} left on booking ${info.booking.code ?? bookingId}.`);
      if (sum.kgs - info.remKgs > 0.001) throw new BadRequestException(`Drawing ${sum.kgs} kgs exceeds the ${info.remKgs} left on booking ${info.booking.code ?? bookingId}.`);
    }
  }

  private codeFor(id: number): string {
    return `ORD-${id}`;
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

  private toDto(
    r: Row,
    dispatchState: OrderDto['dispatchState'] = null,
    dispatchedItemIds?: Set<number>,
    fullyDispatchedItemIds?: Set<number>,
  ): OrderDto {
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
      // Per-line shipping state. `hasFull`/`hasDispatch` are already computed for
      // the order-level rollup, so this costs no extra query — it was simply
      // never surfaced per line, which is why Order Modify couldn't show
      // "Dispatched" vs "Fully dispatched" against an individual item.
      dispatchState: fullyDispatchedItemIds?.has(it.id)
        ? ('FULL' as const)
        : (dispatchedItemIds?.has(it.id) ?? false)
          ? ('PARTIAL' as const)
          : ('NONE' as const),
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
      cancelReason: r.cancelReason ?? null,
      cancelNote: r.cancelNote ?? null,
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
