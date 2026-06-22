import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type GstRateDto, type GstRateLookups, type Paginated, type RateHistoryEntry } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toInt, toStr, uc } from '../common/coerce';
import { BulkGstRateDto, GstRateQueryDto, ImportGstRatesDto, UpsertGstRateDto } from './dto/gst-rate.dto';

type Row = Prisma.GstRateGetPayload<object>;

@Injectable()
export class GstRatesService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: GstRateQueryDto): Promise<Paginated<GstRateDto>> {
    const where: Prisma.GstRateWhereInput = {
      ...(query.customerName ? { customerName: uc(query.customerName)! } : {}),
      ...(query.search
        ? {
            OR: [
              { customerName: { contains: query.search.trim() } },
              { category: { contains: query.search.trim() } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.gstRate.findMany({
        where,
        orderBy: [{ customerName: 'asc' }, { category: 'asc' }],
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.gstRate.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /** Existing GST rates for one customer (for the per-customer editor). */
  async byCustomer(name: string): Promise<GstRateDto[]> {
    const customerName = uc(name);
    if (!customerName) return [];
    const rows = await this.prisma.gstRate.findMany({
      where: { customerName },
      orderBy: { category: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async upsertOne(dto: UpsertGstRateDto): Promise<GstRateDto> {
    const row = await this.upsert(dto.customerName, dto.category, toInt(dto.rate));
    return this.toDto(row);
  }

  async bulkUpsert(dto: BulkGstRateDto): Promise<{ saved: number }> {
    let saved = 0;
    for (const r of dto.rates ?? []) {
      const category = uc(r?.category);
      if (!category) continue;
      await this.upsert(dto.customerName, category, toInt(r?.rate));
      saved++;
    }
    return { saved };
  }

  async remove(id: number): Promise<void> {
    const c = await this.prisma.gstRate.count({ where: { id } });
    if (!c) throw new NotFoundException('GST rate not found.');
    await this.prisma.gstRate.delete({ where: { id } });
  }

  async lookups(): Promise<GstRateLookups> {
    const [customers, prodCats, gstCats] = await Promise.all([
      this.prisma.customer.findMany({
        where: { partyName: { not: null } },
        select: { partyName: true },
        distinct: ['partyName'],
        orderBy: { partyName: 'asc' },
      }),
      // Category here = PRODUCT category (rates can change per product category).
      this.prisma.product.findMany({
        where: { category: { not: '' } },
        select: { category: true },
        distinct: ['category'],
        orderBy: { category: 'asc' },
      }),
      this.prisma.gstRate.findMany({ select: { category: true }, distinct: ['category'], orderBy: { category: 'asc' } }),
    ]);
    const categories = Array.from(
      new Set([...prodCats.map((c) => c.category), ...gstCats.map((c) => c.category)].filter(Boolean)),
    ).sort();
    return {
      customers: customers.map((c) => c.partyName!).filter(Boolean),
      categories,
    };
  }

  /** Stable export/import column order — also used as the empty-export template. */
  exportHeaders(): string[] {
    return ['ID', 'CUSTOMER CODE', 'CUSTOMER NAME', 'PCATEGORY', 'RATE'];
  }

  async exportRows(query: GstRateQueryDto): Promise<Record<string, unknown>[]> {
    const { items } = await this.findMany({ ...query, page: 1, pageSize: 100_000 } as GstRateQueryDto);
    return items.map((r) => ({
      ID: r.id,
      'CUSTOMER CODE': r.customerCode ?? '',
      'CUSTOMER NAME': r.customerName,
      PCATEGORY: r.category,
      RATE: r.rate ?? '',
    }));
  }

  /** Columns for the fill-in template (also the columns the importer reads). */
  templateHeaders(): string[] {
    return ['CUSTOMER NAME', 'PCATEGORY', 'RATE'];
  }

  /**
   * A fill-in sheet: one row per customer × product category, with the RATE
   * pre-filled where it already exists and left blank otherwise. Re-importable
   * as-is — blank rates are skipped on import.
   */
  async templateRows(): Promise<Record<string, unknown>[]> {
    const [customers, prodCats, existing] = await Promise.all([
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
      this.prisma.gstRate.findMany({ select: { customerName: true, category: true, rate: true } }),
    ]);
    const byKey = new Map(
      existing.map((r) => [`${r.customerName.toUpperCase()}|${r.category.toUpperCase()}`, r.rate]),
    );
    const rows: Record<string, unknown>[] = [];
    for (const c of customers) {
      const name = c.partyName!;
      for (const pc of prodCats) {
        const rate = byKey.get(`${name.toUpperCase()}|${pc.category.toUpperCase()}`);
        rows.push({ 'CUSTOMER NAME': name, PCATEGORY: pc.category, RATE: rate ?? '' });
      }
    }
    return rows;
  }

  async importRows(dto: ImportGstRatesDto): Promise<{ total: number; created: number; updated: number; errors: string[] }> {
    const result = { total: dto.rows.length, created: 0, updated: 0, errors: [] as string[] };
    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      try {
        const name = toStr(row['CUSTOMER NAME'] ?? row['CUSTOMER']);
        const category = uc(row['PCATEGORY'] ?? row['CATEGORY']);
        if (!name || !category) {
          result.errors.push(`Row ${i + 2}: CUSTOMER NAME and PCATEGORY required — skipped.`);
          continue;
        }
        // Blank rate = a template row left unfilled — leave it alone (don't create a null rate).
        const rateRaw = row['RATE'];
        if (rateRaw === undefined || rateRaw === null || String(rateRaw).trim() === '') continue;
        const customerName = uc(name)!;
        const existing = await this.prisma.gstRate.findUnique({
          where: { customerName_category: { customerName, category } },
        });
        await this.upsert(name, category, toInt(row['RATE']));
        if (existing) result.updated++;
        else result.created++;
      } catch (err) {
        result.errors.push(`Row ${i + 2}: ${(err as Error).message}`);
      }
    }
    return result;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Most recent rate changes (newest first), filtered by customer/category. */
  async history(query: { customerName?: string; category?: string }): Promise<RateHistoryEntry[]> {
    const where: Prisma.RateHistoryWhereInput = { kind: 'GST' };
    const c = uc(query.customerName);
    const cat = uc(query.category);
    if (c) where.customerName = c;
    if (cat) where.category = cat;
    const rows = await this.prisma.rateHistory.findMany({
      where,
      orderBy: { changedAt: 'desc' },
      take: 500,
    });
    return rows.map((h) => ({
      id: h.id,
      kind: 'GST',
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

  /** Upsert by (customerName, category), both stored uppercase; links customerId best-effort.
   *  Records a history row whenever the rate actually changes. */
  private async upsert(name: string, category: string, rate: number | null): Promise<Row> {
    const customerName = uc(name)!;
    const cat = uc(category)!;
    const customer = await this.prisma.customer.findFirst({ where: { partyName: customerName } });
    const customerId = customer?.id ?? null;
    const customerCode = customer?.code ?? null;
    const before = await this.prisma.gstRate.findUnique({
      where: { customerName_category: { customerName, category: cat } },
      select: { rate: true },
    });
    const row = await this.prisma.gstRate.upsert({
      where: { customerName_category: { customerName, category: cat } },
      create: { customerName, category: cat, rate, customerId, customerCode },
      update: { rate, customerId, customerCode },
    });
    const oldRate = before?.rate ?? null;
    if (oldRate !== (rate ?? null)) {
      await this.prisma.rateHistory.create({
        data: { kind: 'GST', customerName, category: cat, oldRate, newRate: rate ?? null },
      });
    }
    return row;
  }

  private toDto(r: Row): GstRateDto {
    return {
      id: r.id,
      customerId: r.customerId,
      customerCode: r.customerCode,
      customerName: r.customerName,
      category: r.category,
      rate: r.rate,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
