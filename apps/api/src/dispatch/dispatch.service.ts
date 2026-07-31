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

// Cap quantities at 3 decimals. Subtracting/summing floats (e.g. ordered − dispatched)
// otherwise surfaces artifacts like 71.60000000000001 into the remaining qty, which
// then leaks into the dispatch form's pre-filled / MAX-filled inputs.
const round3 = (x: number) => Math.round(x * 1000) / 1000;

// Two dispatches on the SAME order line with identical quantities + status inside
// this window are treated as ONE — a double-tap, a client retry, or two users
// saving the same shipment at once. Real repeat dispatches of a line are minutes
// apart (goods have to be packed/weighed again), so this can't merge legitimate ones.
const DISPATCH_DEDUPE_WINDOW_MS = 15_000;

// The pending pool is a full scan of every order line + its dispatches, so
// recomputing it on every filter/search keystroke is what made the Dispatch Order
// page feel slow. Cache it briefly: back-to-back filter changes reuse the same
// snapshot, and any dispatch write clears it immediately so a just-shipped line
// vanishes at once (order edits/new orders still refresh within the TTL).
const PENDING_CACHE_TTL_MS = 10_000;

@Injectable()
export class DispatchService {
  constructor(private readonly prisma: PrismaService) {}

  private pendingCache: { at: number; lines: PendingLineDto[] } | null = null;
  private invalidatePendingCache(): void {
    this.pendingCache = null;
  }

  /* ── Pending order lines (ordered − dispatched) ─────────────────────────── */

  /** The full pool of order lines still awaiting dispatch (ordered − dispatched > 0),
   *  before any dropdown/search filtering. Shared by the list and its filter options.
   *  Cached for {@link PENDING_CACHE_TTL_MS} (see note above). */
  private async computePendingLines(): Promise<PendingLineDto[]> {
    if (this.pendingCache && Date.now() - this.pendingCache.at < PENDING_CACHE_TTL_MS) {
      return this.pendingCache.lines;
    }
    const items = await this.prisma.orderItem.findMany({
      // Cancelled lines (and cancelled/draft orders) are not dispatchable.
      where: { status: { not: 'CANCELLED' }, order: { status: { notIn: ['CANCELLED', 'DRAFT'] } } },
      include: { order: true, dispatches: true },
      // Oldest order first (ascending) so the earliest ORD# sits at the top of the
      // pending list and the newest at the bottom — the shop-floor picking order.
      orderBy: [{ orderId: 'asc' }, { id: 'asc' }],
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lines: PendingLineDto[] = [];
    for (const it of items) {
      if (it.dispatches.some((d) => d.dispatchStatus === 'FULLY DISPATCH')) continue;
      const sum = it.dispatches.reduce(
        (a, d) => ({ bags: a.bags + (d.bags ?? 0), pcs: a.pcs + (d.pcs ?? 0), gram: a.gram + (d.gram ?? 0), box: a.box + (d.box ?? 0) }),
        { bags: 0, pcs: 0, gram: 0, box: 0 },
      );
      const remBags = round3(Math.max(0, (it.bags ?? 0) - sum.bags));
      const remPcs = round3(Math.max(0, (it.pcs ?? 0) - sum.pcs));
      const remKgs = round3(Math.max(0, (it.gram ?? 0) - sum.gram));
      const remBox = round3(Math.max(0, (it.box ?? 0) - sum.box));
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
    this.pendingCache = { at: Date.now(), lines };
    return lines;
  }

  /** The base product — "{size} {product}" with any trailing design / handle /
   *  logo suffix dropped — e.g. "10 RDX WL+TOOL+LOGO" (product "RDX") → "10 RDX",
   *  and "7 DECENT TOOL" (product "DECENT") → "7 DECENT". This is the legacy
   *  Form13 SelectProduct value; the base-name picker (ALL off) groups every
   *  design variant of a product under it.
   *
   *  We cut the name right after the product word rather than stripping the
   *  `designType` token: on this data designType is almost always "NA"/null even
   *  when the name carries a design suffix, so a design-based strip left the
   *  suffix on and the "base" list still showed full, design-laden names. */
  private static baseProductName(full: string | null | undefined, product: string | null | undefined): string {
    const name = (full ?? '').trim();
    const prod = (product ?? '').trim();
    if (!prod) return name;
    const idx = name.toUpperCase().indexOf(prod.toUpperCase());
    if (idx === -1) return name; // product word not found in the name → leave as-is
    return name.slice(0, idx + prod.length).trim();
  }

  /** Distinct customer / agent / product / design values present in the *pending*
   *  pool, used to populate the Dispatch Order page's filter dropdowns. Cascading:
   *  each field's option list reflects the OTHER active filters (but not itself),
   *  so a dropdown only ever offers values that would actually return rows. */
  async pendingFilterOptions(query: PendingQueryDto = {} as PendingQueryDto): Promise<DispatchFilterOptions> {
    const all = await this.computePendingLines();
    // Options for one field = the pool filtered by every OTHER active filter.
    const poolFor = (exclude: keyof PendingQueryDto) => this.applyPendingFilters(all, { ...query, [exclude]: undefined } as PendingQueryDto);
    const distinct = (lines: PendingLineDto[], pick: (l: PendingLineDto) => string | null | undefined) => {
      const s = new Set<string>();
      for (const l of lines) { const v = pick(l); if (v) s.add(v); }
      return [...s].sort((a, b) => a.localeCompare(b));
    };
    const productPool = poolFor('product');
    return {
      customers: distinct(poolFor('customer'), (l) => l.customerName),
      agents: distinct(poolFor('agent'), (l) => l.agentName),
      products: distinct(productPool, (l) => l.productName || l.product),
      productBases: distinct(productPool, (l) => DispatchService.baseProductName(l.productName || l.product, l.product)),
      designs: distinct(poolFor('design'), (l) => (l.designType && l.designType.toUpperCase() !== 'NA' ? l.designType : null)),
      subCategories: distinct(poolFor('subCategory'), (l) => l.subCategory),
    };
  }

  /** Apply the Dispatch Order page's search + dropdown filters to the pending pool. */
  private applyPendingFilters(lines: PendingLineDto[], query: PendingQueryDto): PendingLineDto[] {
    const search = query.search?.trim().toLowerCase();
    if (search) {
      lines = lines.filter((l) =>
        [l.customerName, l.productName, l.orderCode, l.agentName].some((v) => (v ?? '').toLowerCase().includes(search)),
      );
    }
    if (query.dueType) lines = lines.filter((l) => l.dueType === query.dueType);
    if (query.customer) lines = lines.filter((l) => l.customerName === query.customer);
    if (query.agent) lines = lines.filter((l) => l.agentName === query.agent);
    if (query.product) {
      const target = query.product;
      if (query.all) {
        // "ALL" on → the picker lists every design variant (full names); match the
        // exact item picked.
        lines = lines.filter((l) => (l.productName || l.product) === target);
      } else {
        // Default → the picker lists base names only (short list). A base pick
        // matches the base itself and all its design variants: "10 RDX" brings in
        // "10 RDX DL", "10 RDX LOGO", etc. via a whole-word prefix.
        lines = lines.filter((l) => {
          const full = l.productName || l.product || '';
          return full === target || full.startsWith(`${target} `);
        });
      }
    }
    if (query.design) lines = lines.filter((l) => l.designType === query.design);
    if (query.subCategory) lines = lines.filter((l) => l.subCategory === query.subCategory);
    if (query.unit) {
      const u = query.unit.toUpperCase();
      lines = lines.filter((l) =>
        u === 'BAGS' ? l.remBags > 0 : u === 'PCS' ? l.remPcs > 0 : u === 'KGS' ? l.remKgs > 0 : u === 'BOX' ? l.remBox > 0 : true,
      );
    }
    return lines;
  }

  async pending(query: PendingQueryDto): Promise<Paginated<PendingLineDto>> {
    const lines = this.applyPendingFilters(await this.computePendingLines(), query);
    const total = lines.length;
    const page = lines.slice(query.skip, query.skip + query.pageSize);
    return { items: page, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }

  /** All pending lines matching the filters (no pagination) — for the Excel export. */
  async pendingExport(query: PendingQueryDto): Promise<PendingLineDto[]> {
    return this.applyPendingFilters(await this.computePendingLines(), query);
  }

  /* ── Dispatch records ───────────────────────────────────────────────────── */

  async findMany(query: DispatchQueryDto): Promise<Paginated<DispatchDto>> {
    const search = query.search?.trim();
    // Build with AND so the dropdown filters and the search box compose (each can
    // contribute its own OR without clobbering the others).
    const and: Prisma.DispatchWhereInput[] = [];
    if (query.status) and.push({ dispatchStatus: uc(query.status)! });
    if (query.customer) and.push({ customerName: query.customer });
    if (query.agent) and.push({ agentName: query.agent });
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
  async filterOptions(query: DispatchQueryDto = {} as DispatchQueryDto): Promise<DispatchFilterOptions> {
    const rows = await this.prisma.dispatch.findMany({
      select: { customerName: true, agentName: true, productName: true, product: true, designType: true, dispatchStatus: true },
    });
    type Row = (typeof rows)[number];
    // Cascading: each field's options reflect the OTHER active filters (not itself),
    // so a dropdown only offers values that would actually return rows.
    const apply = (list: Row[], q: DispatchQueryDto) => {
      let out = list;
      if (q.status) out = out.filter((r) => r.dispatchStatus === q.status);
      if (q.customer) out = out.filter((r) => r.customerName === q.customer);
      if (q.agent) out = out.filter((r) => r.agentName === q.agent);
      if (q.product) out = out.filter((r) => (r.productName || r.product) === q.product);
      if (q.design) out = out.filter((r) => r.designType === q.design);
      return out;
    };
    const poolFor = (exclude: keyof DispatchQueryDto) => apply(rows, { ...query, [exclude]: undefined } as DispatchQueryDto);
    const distinct = (list: Row[], pick: (r: Row) => string | null | undefined) => {
      const s = new Set<string>();
      for (const r of list) { const v = pick(r); if (v) s.add(v); }
      return [...s].sort((a, b) => a.localeCompare(b));
    };
    return {
      customers: distinct(poolFor('customer'), (r) => r.customerName),
      agents: distinct(poolFor('agent'), (r) => r.agentName),
      products: distinct(poolFor('product'), (r) => r.productName || r.product),
      designs: distinct(poolFor('design'), (r) => r.designType),
    };
  }

  async findOne(id: number): Promise<DispatchDto> {
    const row = await this.prisma.dispatch.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Dispatch not found.');
    return this.toDto(row);
  }

  async create(dto: CreateDispatchDto, userName?: string): Promise<DispatchDto> {
    const bags = toNum(dto.bags) ?? 0;
    const pcs = toNum(dto.pcs) ?? 0;
    const gram = toNum(dto.gram) ?? 0;
    const box = toNum(dto.box) ?? 0;

    // The whole read → validate → insert runs in one transaction. SQLite serializes
    // write transactions, so two concurrent dispatches on the same line can't
    // interleave: the second only reads AFTER the first has committed, so it sees
    // the first's row (both the "already fully dispatched" guard and the duplicate
    // guard below then catch it) instead of silently inserting a copy.
    const row = await this.prisma.$transaction(async (tx) => {
      const it = await tx.orderItem.findUnique({
        where: { id: dto.orderItemId },
        include: { order: true, dispatches: true },
      });
      if (!it) throw new NotFoundException('Order line not found.');
      if (it.order.status === 'CANCELLED' || it.order.status === 'DRAFT') {
        throw new BadRequestException('This order is not available for dispatch.');
      }
      if (it.status === 'CANCELLED') {
        throw new BadRequestException('This line has been cancelled and cannot be dispatched.');
      }
      if (it.dispatches.some((d) => d.dispatchStatus === 'FULLY DISPATCH')) {
        throw new BadRequestException('This line has already been fully dispatched.');
      }

      // Idempotency guard against duplicate submissions (see DISPATCH_DEDUPE_WINDOW_MS):
      // an identical dispatch on this line recorded moments ago is a duplicate, not a
      // second real shipment — return the existing row instead of inserting a copy.
      const dup = it.dispatches.find(
        (d) =>
          (d.bags ?? 0) === bags &&
          (d.pcs ?? 0) === pcs &&
          (d.gram ?? 0) === gram &&
          (d.box ?? 0) === box &&
          d.dispatchStatus === dto.dispatchStatus &&
          Date.now() - d.createdAt.getTime() < DISPATCH_DEDUPE_WINDOW_MS,
      );
      if (dup) return dup;

      const rem = this.remaining(it, it.dispatches);
      this.validateQty({ bags, pcs, gram, box }, rem, dto.dispatchStatus, it.calField);

      return tx.dispatch.create({
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
    });
    this.invalidatePendingCache(); // a new dispatch changes what's still pending
    return this.toDto(await this.ensureCode(row));
  }

  /**
   * Fully dispatch every still-pending line of an order in one shot — powers the
   * New Order form's "Create & Dispatch" (take the order and ship it all at once).
   * Each eligible line gets a FULLY DISPATCH record for its remaining (= full, on a
   * brand-new order) quantity. Cancelled/draft orders are rejected; cancelled lines,
   * already fully-dispatched lines, and zero-quantity lines are skipped. Runs in one
   * transaction so it's all-or-nothing.
   */
  async dispatchOrderFully(orderId: number, userName?: string): Promise<{ dispatched: number; skipped: number }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { dispatches: true } } },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status === 'CANCELLED' || order.status === 'DRAFT') {
      throw new BadRequestException('This order is not available for dispatch.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let dispatched = 0;
      let skipped = 0;
      for (const it of order.items) {
        if (it.status === 'CANCELLED' || it.dispatches.some((d) => d.dispatchStatus === 'FULLY DISPATCH')) {
          skipped++;
          continue;
        }
        const rem = this.remaining(it, it.dispatches);
        if (rem.bags <= EPS && rem.pcs <= EPS && rem.gram <= EPS && rem.box <= EPS) {
          skipped++;
          continue;
        }
        const row = await tx.dispatch.create({
          data: {
            orderItemId: it.id,
            orderId: it.orderId,
            orderCode: order.code ?? this.orderCodeFor(it.orderId),
            customerId: order.customerId,
            customerName: order.customerName,
            agentName: order.agentName,
            category: order.category,
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
            bags: rem.bags,
            pcs: rem.pcs,
            gram: rem.gram,
            box: rem.box,
            dispatchStatus: 'FULLY DISPATCH',
            dispatchDate: new Date(),
            userName: userName ?? null,
          },
        });
        await tx.dispatch.update({ where: { id: row.id }, data: { code: this.codeFor(row.id) } });
        dispatched++;
      }
      return { dispatched, skipped };
    });

    if (result.dispatched > 0) this.invalidatePendingCache();
    return result;
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
    this.invalidatePendingCache(); // edited quantities change remaining-to-dispatch
    return this.toDto(row);
  }

  async remove(id: number): Promise<void> {
    const c = await this.prisma.dispatch.count({ where: { id } });
    if (!c) throw new NotFoundException('Dispatch not found.');
    await this.prisma.dispatch.delete({ where: { id } });
    this.invalidatePendingCache(); // a deleted dispatch puts its qty back in the pool
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
      bags: round3(Math.max(0, (line.bags ?? 0) - sum.bags)),
      pcs: round3(Math.max(0, (line.pcs ?? 0) - sum.pcs)),
      gram: round3(Math.max(0, (line.gram ?? 0) - sum.gram)),
      box: round3(Math.max(0, (line.box ?? 0) - sum.box)),
    };
  }

  private validateQty(
    q: { bags: number; pcs: number; gram: number; box: number },
    rem: { bags: number; pcs: number; gram: number; box: number },
    status: string,
    calField?: string | null,
  ) {
    // No quantity may be negative — a negative on a non-mandatory unit would
    // otherwise slip past the mandatory + upper-bound checks and corrupt totals.
    if (q.bags < -EPS || q.pcs < -EPS || q.gram < -EPS || q.box < -EPS) {
      throw new BadRequestException('Dispatch quantities cannot be negative.');
    }
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
    // Dispatching more than what's left on the line is allowed (real-world
    // packing/weighing variance means the shipped qty doesn't always match the
    // order exactly) — the web app gates it behind an explicit confirmation
    // before it ever reaches here; this endpoint itself no longer blocks it.
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
