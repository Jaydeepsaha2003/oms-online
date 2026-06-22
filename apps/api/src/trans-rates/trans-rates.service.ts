import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Paginated, type RateHistoryEntry, type TransRateDto, type TransRateLookups } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toInt, toStr, uc } from '../common/coerce';
import {
  BulkTransRateDto,
  ImportTransRatesDto,
  TransRateQueryDto,
  UpsertTransRateDto,
} from './dto/trans-rate.dto';

type Row = Prisma.TransRateGetPayload<object>;

/** A transport rate always has these two components; they are the fixed "types". */
const BASE_TYPES = ['PACKING', 'FREIGHT'];

@Injectable()
export class TransRatesService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: TransRateQueryDto): Promise<Paginated<TransRateDto>> {
    const where: Prisma.TransRateWhereInput = {
      ...(query.customerName ? { customerName: uc(query.customerName)! } : {}),
      ...(query.search
        ? {
            OR: [
              { customerName: { contains: query.search.trim() } },
              { category: { contains: query.search.trim() } },
              { type: { contains: query.search.trim() } },
              { transportName: { contains: query.search.trim() } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transRate.findMany({
        where,
        orderBy: [{ customerName: 'asc' }, { category: 'asc' }, { type: 'asc' }],
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.transRate.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async byCustomer(name: string): Promise<TransRateDto[]> {
    const customerName = uc(name);
    if (!customerName) return [];
    const rows = await this.prisma.transRate.findMany({
      where: { customerName },
      orderBy: [{ category: 'asc' }, { type: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async upsertOne(dto: UpsertTransRateDto): Promise<TransRateDto> {
    return this.toDto(await this.upsert(dto));
  }

  /**
   * Save a whole category×type grid for one customer. Each row is upserted by
   * (customerName, category, type) — so editing a row's transporter/rate updates
   * the same record instead of leaving an orphan. Rows with a blank category/type
   * are skipped.
   */
  async bulkUpsert(dto: BulkTransRateDto): Promise<{ saved: number }> {
    const customerName = uc(dto.customerName)!;
    if (!customerName) return { saved: 0 };
    const customer = await this.prisma.customer.findFirst({ where: { partyName: customerName } });
    const customerId = customer?.id ?? null;
    const customerCode = customer?.code ?? null;
    let saved = 0;
    for (const r of dto.rates ?? []) {
      const category = uc(r.category);
      const type = uc(r.type);
      if (!category || !type) continue;
      const rate = toInt(r.rate);
      const transporter = await this.resolveTransporter(r.transportName ?? null);
      const transporterId = transporter?.id ?? null;
      const transportName = transporter?.name ?? null;
      const existing = await this.prisma.transRate.findFirst({ where: { customerName, category, type } });
      if (existing) {
        await this.prisma.transRate.update({
          where: { id: existing.id },
          data: { customerId, customerCode, transporterId, transportName, rate },
        });
      } else {
        await this.prisma.transRate.create({
          data: { customerId, customerCode, customerName, category, type, transporterId, transportName, rate },
        });
      }
      await this.recordHistory(customerName, category, type, transportName, existing?.rate ?? null, rate);
      saved++;
    }
    return { saved };
  }

  async remove(id: number): Promise<void> {
    const c = await this.prisma.transRate.count({ where: { id } });
    if (!c) throw new NotFoundException('Transport rate not found.');
    await this.prisma.transRate.delete({ where: { id } });
  }

  async lookups(): Promise<TransRateLookups> {
    const [customers, prodCats, trCats, types, transporters] = await Promise.all([
      this.prisma.customer.findMany({
        where: { partyName: { not: null } },
        select: { partyName: true },
        distinct: ['partyName'],
        orderBy: { partyName: 'asc' },
      }),
      // Category here = PRODUCT category (transport rate can change per product category).
      this.prisma.product.findMany({
        where: { category: { not: '' } },
        select: { category: true },
        distinct: ['category'],
        orderBy: { category: 'asc' },
      }),
      this.prisma.transRate.findMany({ select: { category: true }, distinct: ['category'] }),
      this.prisma.transRate.findMany({
        where: { type: { not: '' } },
        select: { type: true },
        distinct: ['type'],
        orderBy: { type: 'asc' },
      }),
      this.prisma.transporter.findMany({ orderBy: { name: 'asc' } }),
    ]);
    const categories = Array.from(
      new Set([...prodCats.map((c) => c.category), ...trCats.map((c) => c.category)].filter(Boolean)),
    ).sort();
    // PACKING / FREIGHT are the canonical types; keep any extra ones already saved.
    const allTypes = Array.from(new Set([...BASE_TYPES, ...types.map((t) => t.type).filter(Boolean)]));
    return {
      customers: customers.map((c) => c.partyName!).filter(Boolean),
      categories,
      types: allTypes,
      transporters: transporters.map((t) => ({ id: t.id, name: t.name, packing: t.packing, freight: t.freight })),
    };
  }

  /** Stable export/import column order — also used as the empty-export template. */
  exportHeaders(): string[] {
    return ['REC ID', 'CUS ID', 'CUSTOMER CODE', 'CUSTOMER', 'CATEGORY', 'TYPE', 'TID', 'TRANSPORT NAME', 'RATE'];
  }

  async exportRows(query: TransRateQueryDto): Promise<Record<string, unknown>[]> {
    const { items } = await this.findMany({ ...query, page: 1, pageSize: 100_000 } as TransRateQueryDto);
    return items.map((r) => ({
      'REC ID': r.id,
      'CUS ID': r.customerId ?? '',
      'CUSTOMER CODE': r.customerCode ?? '',
      CUSTOMER: r.customerName,
      CATEGORY: r.category,
      TYPE: r.type,
      TID: r.transporterId ?? '',
      'TRANSPORT NAME': r.transportName ?? '',
      RATE: r.rate ?? '',
    }));
  }

  /** Columns for the fill-in template (also the columns the importer reads). */
  templateHeaders(): string[] {
    return ['CUSTOMER', 'CATEGORY', 'TYPE', 'TRANSPORT NAME', 'RATE'];
  }

  /**
   * A fill-in sheet: one row per customer × product category × type
   * (type = PACKING / FREIGHT), with the transporter + rate pre-filled where a
   * rate already exists, blank otherwise.
   */
  async templateRows(): Promise<Record<string, unknown>[]> {
    const [customers, prodCats, typeRows, existing] = await Promise.all([
      this.prisma.customer.findMany({
        where: { partyName: { not: null } },
        select: { partyName: true },
        distinct: ['partyName'],
        orderBy: { partyName: 'asc' },
      }),
      this.prisma.product.findMany({
        where: { category: { not: '' } },
        select: { category: true },
        distinct: ['category'],
        orderBy: { category: 'asc' },
      }),
      this.prisma.transRate.findMany({
        where: { type: { not: '' } },
        select: { type: true },
        distinct: ['type'],
        orderBy: { type: 'asc' },
      }),
      this.prisma.transRate.findMany({
        select: { customerName: true, category: true, type: true, transportName: true, rate: true },
      }),
    ]);
    const types = Array.from(new Set([...BASE_TYPES, ...typeRows.map((t) => t.type).filter(Boolean)]));
    const byKey = new Map(
      existing.map((r) => [`${r.customerName.toUpperCase()}|${r.category.toUpperCase()}|${r.type.toUpperCase()}`, r]),
    );
    const rows: Record<string, unknown>[] = [];
    for (const c of customers) {
      const name = c.partyName!;
      for (const pc of prodCats) {
        for (const tp of types) {
          const ex = byKey.get(`${name.toUpperCase()}|${pc.category.toUpperCase()}|${tp.toUpperCase()}`);
          rows.push({
            CUSTOMER: name,
            CATEGORY: pc.category,
            TYPE: tp,
            'TRANSPORT NAME': ex?.transportName ?? '',
            RATE: ex?.rate ?? '',
          });
        }
      }
    }
    return rows;
  }

  async importRows(dto: ImportTransRatesDto): Promise<{ total: number; created: number; updated: number; errors: string[] }> {
    const result = { total: dto.rows.length, created: 0, updated: 0, errors: [] as string[] };
    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      try {
        const customerName = toStr(row['CUSTOMER']);
        const category = toStr(row['CATEGORY']);
        const type = toStr(row['TYPE']);
        if (!customerName || !category || !type) {
          result.errors.push(`Row ${i + 2}: CUSTOMER, CATEGORY and TYPE required — skipped.`);
          continue;
        }
        // Blank rate = a template row left unfilled — skip (don't create a null rate).
        const rateRaw = row['RATE'];
        if (rateRaw === undefined || rateRaw === null || String(rateRaw).trim() === '') continue;
        const before = await this.prisma.transRate.findFirst({
          where: {
            customerName: uc(customerName)!,
            category: uc(category)!,
            type: uc(type)!,
            transporterId: (await this.resolveTransporter(toStr(row['TRANSPORT NAME'])))?.id ?? null,
          },
        });
        await this.upsert({
          customerName,
          category,
          type,
          transportName: toStr(row['TRANSPORT NAME']) ?? undefined,
          rate: toInt(row['RATE']) ?? undefined,
        });
        if (before) result.updated++;
        else result.created++;
      } catch (err) {
        result.errors.push(`Row ${i + 2}: ${(err as Error).message}`);
      }
    }
    return result;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async resolveTransporter(name?: string | null): Promise<{ id: number; name: string } | null> {
    const n = uc(name);
    if (!n) return null;
    const existing = await this.prisma.transporter.findUnique({ where: { name: n } });
    if (existing) return { id: existing.id, name: existing.name };
    const created = await this.prisma.transporter.create({ data: { name: n } });
    return { id: created.id, name: created.name };
  }

  private async upsert(input: UpsertTransRateDto): Promise<Row> {
    const customerName = uc(input.customerName)!;
    const category = uc(input.category)!;
    const type = uc(input.type)!;
    const rate = toInt(input.rate);
    const customer = await this.prisma.customer.findFirst({ where: { partyName: customerName } });
    const customerId = customer?.id ?? null;
    const customerCode = customer?.code ?? null;
    const transporter = await this.resolveTransporter(input.transportName);
    const transporterId = transporter?.id ?? null;
    const transportName = transporter?.name ?? null;

    const existing = await this.prisma.transRate.findFirst({
      where: { customerName, category, type, transporterId },
    });
    await this.recordHistory(customerName, category, type, transportName, existing?.rate ?? null, rate);
    if (existing) {
      return this.prisma.transRate.update({
        where: { id: existing.id },
        data: { customerId, customerCode, transportName, rate },
      });
    }
    return this.prisma.transRate.create({
      data: { customerId, customerCode, customerName, category, type, transporterId, transportName, rate },
    });
  }

  /** Record a history row when a transport rate actually changes. */
  private async recordHistory(
    customerName: string,
    category: string,
    type: string,
    transportName: string | null,
    oldRate: number | null,
    newRate: number | null,
  ): Promise<void> {
    if ((oldRate ?? null) === (newRate ?? null)) return;
    await this.prisma.rateHistory.create({
      data: { kind: 'TRANS', customerName, category, type, transportName, oldRate, newRate: newRate ?? null },
    });
  }

  /** Most recent transport-rate changes (newest first), filtered by customer/category/type. */
  async history(query: {
    customerName?: string;
    category?: string;
    type?: string;
  }): Promise<RateHistoryEntry[]> {
    const where: Prisma.RateHistoryWhereInput = { kind: 'TRANS' };
    const c = uc(query.customerName);
    const cat = uc(query.category);
    const tp = uc(query.type);
    if (c) where.customerName = c;
    if (cat) where.category = cat;
    if (tp) where.type = tp;
    const rows = await this.prisma.rateHistory.findMany({ where, orderBy: { changedAt: 'desc' }, take: 500 });
    return rows.map((h) => ({
      id: h.id,
      kind: 'TRANS',
      customerName: h.customerName,
      category: h.category,
      type: h.type,
      transportName: h.transportName,
      oldRate: h.oldRate,
      newRate: h.newRate,
      changedByName: h.changedByName,
      changedAt: h.changedAt.toISOString(),
    }));
  }

  private toDto(r: Row): TransRateDto {
    return {
      id: r.id,
      customerId: r.customerId,
      customerCode: r.customerCode,
      customerName: r.customerName,
      category: r.category,
      type: r.type,
      transporterId: r.transporterId,
      transportName: r.transportName,
      rate: r.rate,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
