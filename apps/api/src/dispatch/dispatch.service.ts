import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Dispatch, Prisma } from '@prisma/client';
import {
  type DispatchDto,
  type DispatchFilterOptions,
  type DispatchStatus,
  type PendingLineDto,
  type Paginated,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toNum, toStr, uc } from '../common/coerce';
import { CreateDispatchDto, DispatchQueryDto, PendingQueryDto, UpdateDispatchDto } from './dto/dispatch.dto';

const EPS = 1e-6;

@Injectable()
export class DispatchService {
  constructor(private readonly prisma: PrismaService) {}

  /* ── Pending order lines (ordered − dispatched) ─────────────────────────── */

  async pending(query: PendingQueryDto): Promise<Paginated<PendingLineDto>> {
    const items = await this.prisma.orderItem.findMany({
      where: { order: { status: { notIn: ['CANCELLED', 'DRAFT'] } } },
      include: { order: true, dispatches: true },
      orderBy: [{ orderId: 'desc' }, { id: 'asc' }],
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let lines: PendingLineDto[] = [];
    for (const it of items) {
      if (it.dispatches.some((d) => d.dispatchStatus === 'FULLY DISPATCH')) continue;
      const sum = it.dispatches.reduce(
        (a, d) => ({ bags: a.bags + (d.bags ?? 0), pcs: a.pcs + (d.pcs ?? 0), gram: a.gram + (d.gram ?? 0), box: a.box + (d.box ?? 0) }),
        { bags: 0, pcs: 0, gram: 0, box: 0 },
      );
      const remBags = Math.max(0, (it.bags ?? 0) - sum.bags);
      const remPcs = Math.max(0, (it.pcs ?? 0) - sum.pcs);
      const remKgs = Math.max(0, (it.gram ?? 0) - sum.gram);
      const remBox = Math.max(0, (it.box ?? 0) - sum.box);
      if (remBags <= EPS && remPcs <= EPS && remKgs <= EPS && remBox <= EPS) continue;
      const due = it.order.completionDate;
      lines.push({
        orderItemId: it.id,
        orderId: it.orderId,
        orderCode: it.order.code ?? this.orderCodeFor(it.orderId),
        orderDate: it.order.orderDate.toISOString(),
        dueDate: due ? due.toISOString() : null,
        dueType: due && due < today ? 'Over Due' : 'Due',
        customerId: it.order.customerId,
        customerName: it.order.customerName,
        agentName: it.order.agentName,
        category: it.order.category,
        pCategory: it.pCategory,
        subCategory: it.subCategory,
        product: it.product,
        productName: it.productName,
        designType: it.designType,
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

    const search = query.search?.trim().toLowerCase();
    if (search) {
      lines = lines.filter((l) =>
        [l.customerName, l.productName, l.orderCode, l.agentName].some((v) => (v ?? '').toLowerCase().includes(search)),
      );
    }
    if (query.dueType) lines = lines.filter((l) => l.dueType === query.dueType);
    if (query.unit) {
      const u = query.unit.toUpperCase();
      lines = lines.filter((l) =>
        u === 'BAGS' ? l.remBags > 0 : u === 'PCS' ? l.remPcs > 0 : u === 'KGS' ? l.remKgs > 0 : u === 'BOX' ? l.remBox > 0 : true,
      );
    }

    const total = lines.length;
    const page = lines.slice(query.skip, query.skip + query.pageSize);
    return { items: page, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }

  /* ── Dispatch records ───────────────────────────────────────────────────── */

  async findMany(query: DispatchQueryDto): Promise<Paginated<DispatchDto>> {
    const search = query.search?.trim();
    // Build with AND so the dropdown filters and the search box compose (each can
    // contribute its own OR without clobbering the others).
    const and: Prisma.DispatchWhereInput[] = [];
    if (query.status) and.push({ dispatchStatus: uc(query.status)! });
    if (query.customer) and.push({ customerName: query.customer });
    if (query.product) and.push({ OR: [{ productName: query.product }, { product: query.product }] });
    if (query.design) and.push({ designType: query.design });
    if (search) {
      and.push({
        OR: [
          { customerName: { contains: search } },
          { code: { contains: search } },
          { productName: { contains: search } },
          { orderCode: { contains: search } },
          { designType: { contains: search } },
          { comment: { contains: search } },
        ],
      });
    }
    const where: Prisma.DispatchWhereInput = and.length ? { AND: and } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.dispatch.findMany({ where, orderBy: [{ dispatchDate: 'desc' }, { id: 'desc' }], skip: query.skip, take: query.pageSize }),
      this.prisma.dispatch.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /** Distinct customer / product / design values present in dispatch records,
   *  used to populate the Modify Dispatch dropdown filters. */
  async filterOptions(): Promise<DispatchFilterOptions> {
    const rows = await this.prisma.dispatch.findMany({
      select: { customerName: true, productName: true, product: true, designType: true },
    });
    const customers = new Set<string>();
    const products = new Set<string>();
    const designs = new Set<string>();
    for (const r of rows) {
      if (r.customerName) customers.add(r.customerName);
      const p = r.productName || r.product;
      if (p) products.add(p);
      if (r.designType) designs.add(r.designType);
    }
    const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    return { customers: sorted(customers), products: sorted(products), designs: sorted(designs) };
  }

  async findOne(id: number): Promise<DispatchDto> {
    const row = await this.prisma.dispatch.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Dispatch not found.');
    return this.toDto(row);
  }

  async create(dto: CreateDispatchDto, userName?: string): Promise<DispatchDto> {
    const it = await this.prisma.orderItem.findUnique({
      where: { id: dto.orderItemId },
      include: { order: true, dispatches: true },
    });
    if (!it) throw new NotFoundException('Order line not found.');
    if (it.order.status === 'CANCELLED' || it.order.status === 'DRAFT') {
      throw new BadRequestException('This order is not available for dispatch.');
    }
    if (it.dispatches.some((d) => d.dispatchStatus === 'FULLY DISPATCH')) {
      throw new BadRequestException('This line has already been fully dispatched.');
    }

    const rem = this.remaining(it, it.dispatches);
    const bags = toNum(dto.bags) ?? 0;
    const pcs = toNum(dto.pcs) ?? 0;
    const gram = toNum(dto.gram) ?? 0;
    const box = toNum(dto.box) ?? 0;
    this.validateQty({ bags, pcs, gram, box }, rem, dto.dispatchStatus, it.calField);

    const row = await this.prisma.dispatch.create({
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
        designType: it.designType,
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
    return this.toDto(await this.ensureCode(row));
  }

  async update(id: number, dto: UpdateDispatchDto): Promise<DispatchDto> {
    const cur = await this.prisma.dispatch.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Dispatch not found.');
    const it = await this.prisma.orderItem.findUnique({ where: { id: cur.orderItemId }, include: { dispatches: true } });
    if (!it) throw new NotFoundException('Order line not found.');

    // Remaining excludes the dispatch being edited (so its own qty can be changed).
    const others = it.dispatches.filter((d) => d.id !== id);
    const rem = this.remaining(it, others);
    const bags = dto.bags !== undefined ? toNum(dto.bags) ?? 0 : cur.bags ?? 0;
    const pcs = dto.pcs !== undefined ? toNum(dto.pcs) ?? 0 : cur.pcs ?? 0;
    const gram = dto.gram !== undefined ? toNum(dto.gram) ?? 0 : cur.gram ?? 0;
    const box = dto.box !== undefined ? toNum(dto.box) ?? 0 : cur.box ?? 0;
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
        ...(dto.comment !== undefined ? { comment: toStr(dto.comment) } : {}),
        ...(dto.supItem !== undefined ? { supItem: toStr(dto.supItem) } : {}),
        ...(dto.dispatchDate ? { dispatchDate: new Date(dto.dispatchDate) } : {}),
      },
    });
    return this.toDto(row);
  }

  async remove(id: number): Promise<void> {
    const c = await this.prisma.dispatch.count({ where: { id } });
    if (!c) throw new NotFoundException('Dispatch not found.');
    await this.prisma.dispatch.delete({ where: { id } });
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
      bags: Math.max(0, (line.bags ?? 0) - sum.bags),
      pcs: Math.max(0, (line.pcs ?? 0) - sum.pcs),
      gram: Math.max(0, (line.gram ?? 0) - sum.gram),
      box: Math.max(0, (line.box ?? 0) - sum.box),
    };
  }

  private validateQty(
    q: { bags: number; pcs: number; gram: number; box: number },
    rem: { bags: number; pcs: number; gram: number; box: number },
    status: string,
    calField?: string | null,
  ) {
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
    if (q.bags > rem.bags + EPS || q.pcs > rem.pcs + EPS || q.gram > rem.gram + EPS || q.box > rem.box + EPS) {
      throw new BadRequestException('Dispatch quantity exceeds the remaining quantity for this line.');
    }
    const consumesAll =
      rem.bags - q.bags <= EPS && rem.pcs - q.pcs <= EPS && rem.gram - q.gram <= EPS && rem.box - q.box <= EPS;
    if (consumesAll && status !== 'FULLY DISPATCH') {
      throw new BadRequestException('This dispatches everything remaining — mark it as Fully Dispatched.');
    }
  }

  private orderCodeFor(id: number): string {
    return `ORD-${String(id).padStart(5, '0')}`;
  }
  private codeFor(id: number): string {
    return `DSP-${String(id).padStart(5, '0')}`;
  }

  private async ensureCode(row: Dispatch): Promise<Dispatch> {
    if (row.code) return row;
    return this.prisma.dispatch.update({ where: { id: row.id }, data: { code: this.codeFor(row.id) } });
  }

  private toDto(r: Dispatch): DispatchDto {
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
      designType: r.designType,
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
    };
  }
}
