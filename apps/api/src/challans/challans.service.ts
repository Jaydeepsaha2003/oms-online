import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { Prisma } from '@prisma/client';
import { type ChallanDraft, type ChallanDraftItem, type ChallanDto, type ChallanItemHistoryRow, type Paginated, type PendingChallanLine } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { CreateChallanDto, DraftChallanDto, ItemHistoryQueryDto, PendingChallanQueryDto, ChallanQueryDto } from './dto/challan.dto';

const PREFIX_KEY = 'CHALLAN_PREFIXES';
const FALLBACK_PREFIX = 'SSS';
const round5 = (x: number) => Math.round(x / 5) * 5;
const n = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : 0);

@Injectable()
export class ChallansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

  /** Dispatch lines still awaiting a challan (mirrors the legacy PendChallan query:
   *  a dispatch is pending until it appears in a non-cancelled challan). */
  // Dispatch ids already on a non-cancelled challan, expressed as a parameter-free
  // subquery. A plain `id NOT IN [..thousands of ids]` blows past SQLite's variable
  // limit once there are many challans, and Prisma cannot split a negated IN — so the
  // "un-challaned" condition is done in raw SQL.
  private static readonly NOT_CHALLANED =
    "d.id NOT IN (SELECT ci.dispatchId FROM challan_items ci JOIN challans c ON c.id = ci.challanId WHERE ci.dispatchId IS NOT NULL AND c.challanStatus <> 'CANCELLED')";

  /** Build the WHERE clause (+ bound params) for the pending-dispatch raw queries. */
  private pendingWhere(q: { customerName?: string; dateFrom?: string; dateTo?: string; search?: string }): { clause: string; params: unknown[] } {
    const clauses = [ChallansService.NOT_CHALLANED];
    const params: unknown[] = [];
    if (q.customerName?.trim()) {
      clauses.push('d.customerName = ?');
      params.push(q.customerName.trim());
    }
    if (q.dateFrom) {
      const f = new Date(q.dateFrom);
      f.setHours(0, 0, 0, 0);
      clauses.push('d.dispatchDate >= ?');
      params.push(f);
    }
    if (q.dateTo) {
      const t = new Date(q.dateTo);
      t.setHours(23, 59, 59, 999);
      clauses.push('d.dispatchDate <= ?');
      params.push(t);
    }
    const search = q.search?.trim();
    if (search) {
      for (const tok of search.split(',').map((s) => s.trim()).filter(Boolean)) {
        clauses.push('(d.customerName LIKE ? OR d.productName LIKE ? OR d.designType LIKE ? OR d.calField LIKE ?)');
        const like = `%${tok}%`;
        params.push(like, like, like, like);
      }
    }
    return { clause: clauses.join(' AND '), params };
  }

  async pending(q: PendingChallanQueryDto): Promise<Paginated<PendingChallanLine>> {
    const { clause, params } = this.pendingWhere(q);
    const countRows = await this.prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT COUNT(*) AS c FROM dispatches d WHERE ${clause}`, ...params);
    const total = Number(countRows[0]?.c ?? 0);
    const idRows = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
      `SELECT d.id AS id FROM dispatches d WHERE ${clause} ORDER BY d.dispatchDate DESC, d.id DESC LIMIT ? OFFSET ?`,
      ...params,
      q.pageSize,
      q.skip,
    );
    const ids = idRows.map((r) => Number(r.id));
    // Hydrate the page with Prisma (proper types) then restore the id order.
    const rows = ids.length ? await this.prisma.dispatch.findMany({ where: { id: { in: ids } } }) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)).filter((d): d is (typeof rows)[number] => !!d);

    return {
      items: ordered.map((d) => ({
        dispatchId: d.id,
        dispatchDate: d.dispatchDate.toISOString(),
        orderId: d.orderId,
        orderCode: d.orderCode,
        customerId: d.customerId,
        customerName: d.customerName,
        productName: d.productName,
        design: d.designType,
        bags: d.bags,
        kgs: d.gram,
        pcs: d.pcs,
        box: d.box,
        unit: d.calField,
        rate: d.rate,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  /** Distinct parties that still have un-challaned dispatch lines (standalone Create Challan picker). */
  async pendingCustomers(search?: string): Promise<string[]> {
    const { clause, params } = this.pendingWhere({ search });
    const rows = await this.prisma.$queryRawUnsafe<{ customerName: string }[]>(
      `SELECT DISTINCT d.customerName AS customerName FROM dispatches d WHERE ${clause} ORDER BY d.customerName ASC LIMIT 500`,
      ...params,
    );
    return rows.map((r) => r.customerName).filter(Boolean);
  }

  /** Every party in the Customer master, regardless of whether they currently
   *  have un-challaned dispatches — lets Create Challan pick any customer (the
   *  draft simply comes back with an empty pool if they have nothing pending). */
  async allCustomerNames(search?: string): Promise<string[]> {
    const s = search?.trim();
    const rows = await this.prisma.customer.findMany({
      where: { partyName: { not: null }, ...(s ? { partyName: { contains: s } } : {}) },
      select: { partyName: true },
      orderBy: { partyName: 'asc' },
      take: 2000,
    });
    return rows.map((r) => r.partyName).filter((n): n is string => !!n);
  }

  /** Form14 CreateGridList: resolve per-line freight/packing/GST rates for the
   *  selected dispatches and pre-compute the suggested charges + header. */
  async draft(dto: DraftChallanDto): Promise<ChallanDraft> {
    const customerName = dto.customerName.trim();
    const customer = await this.prisma.customer.findFirst({ where: { partyName: customerName } });

    // No explicit selection → offer the customer's entire un-challaned pool.
    let ids = dto.dispatchIds;
    if (!ids || ids.length === 0) {
      const { clause, params } = this.pendingWhere({ customerName });
      const pool = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
        `SELECT d.id AS id FROM dispatches d WHERE ${clause} ORDER BY d.dispatchDate DESC, d.id DESC`,
        ...params,
      );
      ids = pool.map((d) => Number(d.id));
    }

    const dispatches = await this.prisma.dispatch.findMany({ where: { id: { in: ids } } });
    const byId = new Map(dispatches.map((d) => [d.id, d]));
    const ordered = ids.map((id) => byId.get(id)).filter((d): d is (typeof dispatches)[number] => !!d);

    const transName = customer?.transportName ?? null;
    const { gstByCat, rateFor } = await this.rateMaps(customerName, transName);

    const items = ordered.map((d) => {
      const cat = (d.pCategory ?? '').toUpperCase();
      const unit = (d.calField ?? '').toUpperCase();
      const price = n(d.rate);
      const qty = unit === 'KGS' || unit === 'KG' || unit === 'KGS.' ? n(d.gram) : n(d.pcs);
      return {
        dispatchId: d.id,
        orderId: d.orderId,
        orderCode: d.orderCode,
        productName: d.productName,
        design: d.designType,
        bags: d.bags,
        pcs: d.pcs,
        kgs: d.gram,
        box: d.box,
        unit: d.calField,
        price: d.rate,
        amount: Math.round(qty * price * 100) / 100,
        pCategory: d.pCategory,
        comment: d.comment,
        gstRate: gstByCat.get(cat) ?? 0,
        freightRate: rateFor(cat, 'FREIGHT'),
        packingRate: rateFor(cat, 'PACKING'),
      };
    });

    const tBox = items.reduce((a, i) => a + n(i.box), 0);
    const freight = round5(items.reduce((a, i) => a + n(i.bags) * i.freightRate, 0));
    const packing = round5(items.reduce((a, i) => a + n(i.bags) * i.packingRate, 0));
    const pouch = Math.round(tBox * n(customer?.boxRate) * 100) / 100;
    const gst = Math.max(0, ...items.map((i) => i.gstRate));
    const isScrap = (customer?.category ?? '').toUpperCase() === 'SCRAP';

    const billingAddress = [customer?.partyName, customer?.city, customer?.state, customer?.region]
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .join(', ');

    const prefixCfg = await this.getPrefixSettings();
    return {
      code: await this.nextCode(prefixCfg.default, new Date()),
      prefix: prefixCfg.default,
      prefixes: prefixCfg.prefixes,
      customerId: customer?.id ?? null,
      customerName,
      billingAddress,
      category: customer?.category ?? null,
      paymentTerm: customer?.creditPeriod ?? null,
      transName,
      billingRate: customer?.billingRate ?? null,
      boxRate: customer?.boxRate ?? null,
      gst,
      freight,
      packing,
      pouch,
      tdsApplicable: customer?.tdsApplicable ?? false,
      tdsPercent: customer?.tdsPercent ?? null,
      isScrap,
      items,
    };
  }

  async create(dto: CreateChallanDto): Promise<ChallanDto> {
    const invDate = dto.invDate ? new Date(dto.invDate) : new Date();
    const cfg = await this.getPrefixSettings();
    const wanted = dto.prefix?.trim().toUpperCase();
    const prefix = wanted && cfg.prefixes.includes(wanted) ? wanted : cfg.default;
    // Number is always assigned server-side from the PREFIX/FY series (ignores any client code).
    const code = await this.nextCode(prefix, invDate);
    const paymentTerm = dto.paymentTerm ?? null;
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : paymentTerm != null ? new Date(invDate.getTime() + paymentTerm * 86_400_000) : null;

    const row = await this.prisma.challan.create({
      data: {
        code,
        prefix,
        invDate,
        customerId: dto.customerId ?? null,
        customerName: dto.customerName.trim(),
        billingAddress: dto.billingAddress ?? null,
        shippingAddress: dto.shippingAddress ?? null,
        category: dto.category ?? null,
        paymentTerm,
        dueDate,
        transName: dto.transName ?? null,
        packing: dto.packing ?? null,
        freight: dto.freight ?? null,
        pouch: dto.pouch ?? null,
        tcs: dto.tcs ?? null,
        tds: dto.tds ?? null,
        tdsPercent: dto.tdsPercent ?? null,
        tax: dto.tax ?? null,
        total: dto.total ?? null,
        b: dto.b ?? null,
        c: dto.c ?? null,
        remarks: dto.remarks ?? null,
        gst: dto.gst ?? null,
        billingRate: dto.billingRate ?? null,
        noBill: dto.noBill ?? false,
        challanStatus: dto.challanStatus ?? 'CONFIRMED',
        transaction: 'SALES INVOICE',
        items: {
          create: dto.items.map((it) => ({
            dispatchId: it.dispatchId ?? null,
            productName: it.productName ?? null,
            design: it.design ?? null,
            bags: it.bags ?? null,
            pcs: it.pcs ?? null,
            kgs: it.kgs ?? null,
            box: it.box ?? null,
            unit: it.unit ?? null,
            price: it.price ?? null,
            amount: it.amount ?? null,
            pCategory: it.pCategory ?? null,
            comment: it.comment ?? null,
          })),
        },
      },
      include: { items: true },
    });

    return this.map(row);
  }

  async findMany(q: ChallanQueryDto): Promise<Paginated<ChallanDto>> {
    const where = this.listWhere(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.challan.findMany({ where, orderBy: [{ invDate: 'desc' }, { id: 'desc' }], skip: q.skip, take: q.pageSize, include: { items: true } }),
      this.prisma.challan.count({ where }),
    ]);
    return { items: rows.map((r) => this.map(r)), total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  /** KPI roll-up over the same filters as the list (ViewChallan KPI cards). */
  async summary(q: ChallanQueryDto): Promise<{ count: number; totalSales: number; totalB: number; totalC: number; totalTds: number }> {
    const where = this.listWhere(q);
    const agg = await this.prisma.challan.aggregate({ where, _count: { _all: true }, _sum: { total: true, b: true, c: true, tds: true } });
    return {
      count: agg._count._all,
      totalSales: agg._sum.total ?? 0,
      totalB: agg._sum.b ?? 0,
      totalC: agg._sum.c ?? 0,
      totalTds: agg._sum.tds ?? 0,
    };
  }

  async findOne(id: number): Promise<ChallanDto> {
    const row = await this.prisma.challan.findUnique({ where: { id }, include: { items: true } });
    if (!row) throw new NotFoundException('Challan not found');
    return this.map(row);
  }

  /** Customer GST-by-category + freight/packing rate resolver (Form14 grid subqueries). */
  private async rateMaps(customerName: string, transName: string | null) {
    const [gstRates, transRates] = await Promise.all([
      this.prisma.gstRate.findMany({ where: { customerName } }),
      this.prisma.transRate.findMany({ where: { customerName, type: { in: ['FREIGHT', 'PACKING'] } } }),
    ]);
    const gstByCat = new Map(gstRates.map((g) => [(g.category ?? '').toUpperCase(), n(g.rate)]));
    const rateFor = (cat: string, type: string): number => {
      const matches = transRates.filter((t) => (t.category ?? '').toUpperCase() === cat && t.type === type);
      const preferred = matches.find((t) => transName && t.transportName === transName) ?? matches[0];
      return n(preferred?.rate);
    };
    return { gstByCat, rateFor };
  }

  /** Everything the form needs to EDIT a saved challan: the stored challan, the
   *  customer's still-available pool (to add more), and the saved lines re-priced
   *  with per-line rates (Form14 SearchBtn load). */
  async editContext(id: number): Promise<{ challan: ChallanDto; draft: ChallanDraft; rows: ChallanDraftItem[] }> {
    const challan = await this.findOne(id);
    const draft = await this.draft({ customerName: challan.customerName });
    const customer = await this.prisma.customer.findFirst({ where: { partyName: challan.customerName } });
    const { gstByCat, rateFor } = await this.rateMaps(challan.customerName, customer?.transportName ?? null);

    const dispIds = challan.items.map((i) => i.dispatchId).filter((x): x is number => x != null);
    const disp = dispIds.length ? await this.prisma.dispatch.findMany({ where: { id: { in: dispIds } }, select: { id: true, pCategory: true } }) : [];
    const catById = new Map(disp.map((d) => [d.id, d.pCategory ?? '']));

    const rows: ChallanDraftItem[] = challan.items.map((it) => {
      const cat = (it.pCategory || (it.dispatchId != null ? catById.get(it.dispatchId) : '') || '').toUpperCase();
      return {
        dispatchId: it.dispatchId,
        orderId: null,
        orderCode: null,
        productName: it.productName,
        design: it.design,
        bags: it.bags,
        pcs: it.pcs,
        kgs: it.kgs,
        box: it.box,
        unit: it.unit,
        price: it.price,
        amount: it.amount ?? 0,
        pCategory: it.pCategory,
        comment: it.comment,
        gstRate: gstByCat.get(cat) ?? n(challan.gst),
        freightRate: rateFor(cat, 'FREIGHT'),
        packingRate: rateFor(cat, 'PACKING'),
      };
    });
    return { challan, draft, rows };
  }

  /** Replace a saved challan's header + lines (invoice no is preserved). */
  async update(id: number, dto: CreateChallanDto): Promise<ChallanDto> {
    const existing = await this.prisma.challan.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Challan not found');
    const invDate = dto.invDate ? new Date(dto.invDate) : undefined;
    const paymentTerm = dto.paymentTerm ?? null;
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : paymentTerm != null && invDate ? new Date(invDate.getTime() + paymentTerm * 86_400_000) : null;

    await this.prisma.$transaction([
      this.prisma.challanItem.deleteMany({ where: { challanId: id } }),
      this.prisma.challan.update({
        where: { id },
        data: {
          ...(invDate ? { invDate } : {}),
          customerName: dto.customerName.trim(),
          billingAddress: dto.billingAddress ?? null,
          shippingAddress: dto.shippingAddress ?? null,
          category: dto.category ?? null,
          paymentTerm,
          dueDate,
          transName: dto.transName ?? null,
          packing: dto.packing ?? null,
          freight: dto.freight ?? null,
          pouch: dto.pouch ?? null,
          tcs: dto.tcs ?? null,
          tds: dto.tds ?? null,
          tdsPercent: dto.tdsPercent ?? null,
          tax: dto.tax ?? null,
          total: dto.total ?? null,
          b: dto.b ?? null,
          c: dto.c ?? null,
          remarks: dto.remarks ?? null,
          gst: dto.gst ?? null,
          billingRate: dto.billingRate ?? null,
          noBill: dto.noBill ?? false,
          challanStatus: dto.challanStatus ?? 'CONFIRMED',
          items: {
            create: dto.items.map((it) => ({
              dispatchId: it.dispatchId ?? null,
              productName: it.productName ?? null,
              design: it.design ?? null,
              bags: it.bags ?? null,
              pcs: it.pcs ?? null,
              kgs: it.kgs ?? null,
              box: it.box ?? null,
              unit: it.unit ?? null,
              price: it.price ?? null,
              amount: it.amount ?? null,
              pCategory: it.pCategory ?? null,
              comment: it.comment ?? null,
            })),
          },
        },
      }),
    ]);
    return this.findOne(id);
  }

  async updateStatus(id: number, status: string): Promise<ChallanDto> {
    await this.findOne(id);
    const row = await this.prisma.challan.update({ where: { id }, data: { challanStatus: status.toUpperCase() }, include: { items: true } });
    return this.map(row);
  }

  async remove(id: number): Promise<{ id: number }> {
    await this.findOne(id);
    await this.prisma.challan.delete({ where: { id } }); // items cascade
    return { id };
  }

  /** Distinct product names that appear on any challan line (ViewItemChallan sidebar). */
  async itemNames(search?: string): Promise<string[]> {
    const rows = await this.prisma.challanItem.findMany({
      where: { productName: { not: null }, ...(search?.trim() ? { productName: { contains: search.trim() } } : {}) },
      select: { productName: true },
      distinct: ['productName'],
      orderBy: { productName: 'asc' },
      take: 500,
    });
    return rows.map((r) => r.productName!).filter(Boolean);
  }

  /** Every challan line for a product, newest first (ViewItemChallan detail grid). */
  async itemHistory(q: ItemHistoryQueryDto): Promise<Paginated<ChallanItemHistoryRow>> {
    const product = q.product?.trim();
    if (!product) return { items: [], total: 0, page: q.page, pageSize: q.pageSize, totalPages: 1 };
    const where: Prisma.ChallanItemWhereInput = { productName: product };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.challanItem.findMany({
        where,
        orderBy: [{ challan: { invDate: 'desc' } }, { id: 'desc' }],
        skip: q.skip,
        take: q.pageSize,
        include: { challan: { select: { id: true, code: true, invDate: true, customerName: true } } },
      }),
      this.prisma.challanItem.count({ where }),
    ]);
    const items: ChallanItemHistoryRow[] = rows.map((r) => {
      const unit = (r.unit ?? '').toUpperCase();
      const qty = unit === 'KGS' || unit === 'KG' || unit === 'KGS.' ? n(r.kgs) : n(r.pcs);
      return {
        id: r.id,
        challanId: r.challan.id,
        code: r.challan.code,
        invDate: r.challan.invDate.toISOString(),
        customerName: r.challan.customerName,
        productName: r.productName,
        design: r.design,
        qty,
        unit: r.unit,
        price: r.price,
        amount: r.amount,
      };
    });
    return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  private listWhere(q: ChallanQueryDto): Prisma.ChallanWhereInput {
    const and: Prisma.ChallanWhereInput[] = [];
    if (q.status) and.push({ challanStatus: q.status.toUpperCase() });
    if (q.dateFrom) {
      const from = new Date(q.dateFrom);
      from.setHours(0, 0, 0, 0);
      and.push({ invDate: { gte: from } });
    }
    if (q.dateTo) {
      const to = new Date(q.dateTo);
      to.setHours(23, 59, 59, 999);
      and.push({ invDate: { lte: to } });
    }
    const search = q.search?.trim();
    if (search) and.push({ OR: [{ code: { contains: search } }, { customerName: { contains: search } }] });
    return and.length ? { AND: and } : {};
  }

  async challanPdf(id: number): Promise<{ buffer: Buffer; filename: string }> {
    const challan = await this.findOne(id);
    const buffer = await this.pdf.render(this.buildChallanDoc(challan));
    return { buffer, filename: `${(challan.code || `challan-${id}`).replace(/[\\/:*?"<>|]/g, '-')}.pdf` };
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Indian fiscal-year label for a date, e.g. 2026-06 → "26-27" (Apr–Mar). */
  private fyLabel(d: Date): string {
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`;
  }

  /** Next challan number for a prefix + date: PREFIX/FY/serial (e.g. SSS/26-27/1),
   *  serial = 1 + the max serial already used for that PREFIX/FY series. Old imported
   *  codes in other formats simply don't match the series, so the new run starts clean. */
  private async nextCode(prefix: string, date: Date): Promise<string> {
    const full = `${prefix.trim().toUpperCase()}/${this.fyLabel(date)}`;
    const rows = await this.prisma.challan.findMany({ where: { code: { startsWith: `${full}/` } }, select: { code: true } });
    let max = 0;
    for (const r of rows) {
      const n = parseInt((r.code ?? '').slice(full.length + 1), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `${full}/${max + 1}`;
  }

  /** Configured challan prefixes (Settings). Falls back to a single "SSS". */
  async getPrefixSettings(): Promise<{ prefixes: string[]; default: string }> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: PREFIX_KEY } });
    if (row?.value) {
      try {
        const p = JSON.parse(row.value);
        const prefixes = [...new Set((Array.isArray(p.prefixes) ? p.prefixes : []).map((x: unknown) => String(x).trim().toUpperCase()).filter(Boolean))] as string[];
        if (prefixes.length) {
          const def = typeof p.default === 'string' && prefixes.includes(p.default.toUpperCase()) ? p.default.toUpperCase() : prefixes[0];
          return { prefixes, default: def };
        }
      } catch {
        /* fall through to default */
      }
    }
    return { prefixes: [FALLBACK_PREFIX], default: FALLBACK_PREFIX };
  }

  async savePrefixSettings(input: { prefixes: string[]; default?: string }): Promise<{ prefixes: string[]; default: string }> {
    const prefixes = [...new Set((input.prefixes ?? []).map((p) => String(p).trim().toUpperCase()).filter((p) => /^[A-Z0-9]{1,10}$/.test(p)))];
    if (!prefixes.length) throw new BadRequestException('Add at least one prefix (letters/digits, up to 10 chars).');
    const def = input.default && prefixes.includes(input.default.trim().toUpperCase()) ? input.default.trim().toUpperCase() : prefixes[0];
    const value = JSON.stringify({ prefixes, default: def });
    await this.prisma.appConfig.upsert({ where: { key: PREFIX_KEY }, update: { value }, create: { key: PREFIX_KEY, value } });
    return { prefixes, default: def };
  }

  /** Preview the next number for a prefix + date (form invoice-no field). */
  async previewNextCode(prefix?: string, dateStr?: string): Promise<{ code: string }> {
    const { prefixes, default: def } = await this.getPrefixSettings();
    const p = prefix && prefixes.includes(prefix.trim().toUpperCase()) ? prefix.trim().toUpperCase() : def;
    const date = dateStr ? new Date(dateStr) : new Date();
    return { code: await this.nextCode(p, isNaN(date.getTime()) ? new Date() : date) };
  }

  private map(row: Prisma.ChallanGetPayload<{ include: { items: true } }>): ChallanDto {
    return {
      id: row.id,
      code: row.code,
      prefix: row.prefix,
      invDate: row.invDate.toISOString(),
      customerId: row.customerId,
      customerName: row.customerName,
      billingAddress: row.billingAddress,
      shippingAddress: row.shippingAddress,
      category: row.category,
      paymentTerm: row.paymentTerm,
      dueDate: row.dueDate ? row.dueDate.toISOString() : null,
      transName: row.transName,
      packing: row.packing,
      freight: row.freight,
      pouch: row.pouch,
      tcs: row.tcs,
      tds: row.tds,
      tdsPercent: row.tdsPercent,
      tax: row.tax,
      total: row.total,
      b: row.b,
      c: row.c,
      remarks: row.remarks,
      gst: row.gst,
      billingRate: row.billingRate,
      noBill: row.noBill,
      transaction: row.transaction,
      challanStatus: (row.challanStatus as ChallanDto['challanStatus']) ?? 'CONFIRMED',
      userName: row.userName,
      items: row.items.map((it) => ({
        id: it.id,
        challanId: it.challanId,
        dispatchId: it.dispatchId,
        productName: it.productName,
        design: it.design,
        bags: it.bags,
        pcs: it.pcs,
        kgs: it.kgs,
        box: it.box,
        unit: it.unit,
        price: it.price,
        amount: it.amount,
        pCategory: it.pCategory,
        comment: it.comment,
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private buildChallanDoc(c: ChallanDto): TDocumentDefinitions {
    const BLUE = '#1F4E78';
    const ORANGE = '#F99A0F';
    const AMBER = '#F59E0B';
    const BLACK = '#111111';
    const q = (v?: number | null) => (v ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '');
    const money = (v?: number | null) => `${(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const d = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

    const tcs = n(c.tcs);
    const tds = n(c.tds);
    const tax = n(c.tax);
    const total = n(c.total);
    const items = c.items;
    const tAmt = items.reduce((a, it) => a + n(it.amount), 0);
    const isScrap = (c.category ?? '').toUpperCase() === 'SCRAP';

    const head = ['#', 'Product', 'Design', 'Bags', 'PCs', 'KGs', 'Box', 'Unit', 'Price', 'Amount'].map((text, i) => ({
      text,
      bold: true,
      color: BLACK,
      alignment: i === 0 ? 'center' : i >= 3 ? 'right' : 'left',
    }));
    const rows = items.map((it, idx) => [
      { text: String(idx + 1), alignment: 'center' },
      { text: it.productName || '', bold: true },
      { text: it.design || '' },
      { text: q(it.bags), alignment: 'right' },
      { text: q(it.pcs), alignment: 'right' },
      { text: q(it.kgs), alignment: 'right' },
      { text: q(it.box), alignment: 'right' },
      { text: it.unit || '', alignment: 'right' },
      { text: q(it.price), alignment: 'right' },
      { text: q(it.amount), alignment: 'right', bold: true },
    ]);

    const line = (label: string, value: string, opts: { bold?: boolean; color?: string } = {}) => [
      { text: label, alignment: 'right', bold: opts.bold, color: opts.color },
      { text: value, alignment: 'right', bold: opts.bold, color: opts.color },
    ];
    const totalsBody: unknown[][] = [
      line('Taxable Amount', money(tAmt)),
      line('Freight', money(c.freight)),
      line('Packing', money(c.packing)),
      line('Box / Pouch', money(c.pouch)),
      line(`GST${c.gst ? ` @ ${c.gst}%` : ''}`, money(tax)),
    ];
    if (isScrap || tcs) totalsBody.push(line('TCS @ 1%', money(tcs)));
    totalsBody.push(line('TOTAL', money(total), { bold: true, color: BLUE }));
    if (tds) {
      totalsBody.push(line(`Less: TDS${c.tdsPercent ? ` @ ${c.tdsPercent}%` : ''}`, `- ${money(tds)}`, { color: '#B45309' }));
      totalsBody.push(line('Net Receivable', money(total - tds), { bold: true, color: '#15803D' }));
    }

    return {
      pageSize: 'A4',
      pageMargins: [28, 28, 28, 36],
      defaultStyle: { font: 'Helvetica', fontSize: 10, color: BLACK },
      content: [
        {
          table: {
            widths: ['*', 'auto'],
            body: [[
              { text: 'TAX INVOICE / CHALLAN', color: '#ffffff', bold: true, fontSize: 18 },
              { text: c.code, color: '#ffffff', bold: true, fontSize: 13, alignment: 'right', margin: [0, 4, 0, 0] },
            ]],
          },
          layout: { fillColor: () => BLUE, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 8, paddingBottom: () => 8 },
        },
        { canvas: [{ type: 'rect', x: 0, y: 0, w: 539, h: 4, color: AMBER }], margin: [0, 0, 0, 16] },
        {
          columns: [
            {
              width: '*',
              stack: [
                { text: 'BILL TO,', color: BLUE, bold: true, fontSize: 8 },
                { text: c.customerName, bold: true, fontSize: 14, margin: [0, 1, 0, 0] },
                { text: c.billingAddress || '', fontSize: 9, color: '#555555', margin: [0, 1, 0, 0] },
              ],
            },
            {
              width: 'auto',
              table: {
                body: [
                  [{ text: 'Invoice No :', color: BLUE, bold: true }, { text: c.code, bold: true, alignment: 'right' }],
                  [{ text: 'Invoice Date :', color: BLUE, bold: true }, { text: d(c.invDate), bold: true, alignment: 'right' }],
                  [{ text: 'Due Date :', color: BLUE, bold: true }, { text: d(c.dueDate), bold: true, alignment: 'right' }],
                  [{ text: 'Status :', color: BLUE, bold: true }, { text: c.challanStatus, bold: true, alignment: 'right' }],
                ],
              },
              layout: 'noBorders',
            },
          ],
          margin: [0, 0, 0, 14],
        },
        {
          table: { headerRows: 1, widths: [16, '*', 60, 32, 32, 38, 30, 34, 44, 56], body: [head, ...rows] },
          layout: {
            fillColor: (rowIndex: number) => (rowIndex === 0 ? ORANGE : rowIndex % 2 === 0 ? '#F5F7FA' : null),
            hLineColor: () => '#C9D2DC',
            vLineColor: () => '#C9D2DC',
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            paddingLeft: () => 5,
            paddingRight: () => 5,
            paddingTop: () => 5,
            paddingBottom: () => 5,
          },
          margin: [0, 0, 0, 12],
        },
        {
          columns: [
            {
              width: '*',
              stack: [
                { text: 'Amount in words:', color: BLUE, bold: true, fontSize: 8 },
                { text: amountInWordsIndian(total), italics: true, fontSize: 10, margin: [0, 1, 0, 0] },
              ],
            },
            {
              width: 'auto',
              table: { widths: [130, 80], body: totalsBody },
              layout: {
                hLineColor: () => '#E2E8F0',
                vLineColor: () => '#E2E8F0',
                hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
                vLineWidth: () => 0,
                paddingTop: () => 3,
                paddingBottom: () => 3,
                paddingLeft: () => 8,
                paddingRight: () => 4,
              },
            },
          ],
        },
        ...(c.remarks ? [{ text: `Remarks: ${c.remarks}`, fontSize: 9, color: '#555555', margin: [0, 14, 0, 0] }] : []),
      ],
      footer: () => ({
        columns: [
          { text: new Date().toLocaleString('en-GB'), fontSize: 7, color: '#888888', margin: [28, 0, 0, 0] },
          { text: '**This is a computer-generated tax invoice**', fontSize: 7, color: '#888888', alignment: 'right', margin: [0, 0, 28, 0] },
        ],
      }),
    } as unknown as TDocumentDefinitions;
  }
}

/** Indian numbering amount-in-words (e.g. 1,23,456 → "One Lakh Twenty Three Thousand …"). */
function amountInWordsIndian(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  const words = rupees === 0 ? 'Zero' : numToWords(rupees);
  const main = `${words} Rupees`;
  return paise > 0 ? `${main} and ${numToWords(paise)} Paise Only` : `${main} Only`;
}

function numToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const below1000 = (x: number): string => {
    let s = '';
    if (x >= 100) {
      s += `${ones[Math.floor(x / 100)]} Hundred`;
      x %= 100;
      if (x) s += ' ';
    }
    if (x >= 20) {
      s += tens[Math.floor(x / 10)];
      x %= 10;
      if (x) s += ` ${ones[x]}`;
    } else if (x > 0) {
      s += ones[x];
    }
    return s;
  };
  let words = '';
  const crore = Math.floor(num / 10_000_000);
  num %= 10_000_000;
  const lakh = Math.floor(num / 100_000);
  num %= 100_000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  if (crore) words += `${below1000(crore)} Crore `;
  if (lakh) words += `${below1000(lakh)} Lakh `;
  if (thousand) words += `${below1000(thousand)} Thousand `;
  if (num) words += below1000(num);
  return words.trim();
}
