import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type GstRateDto, type GstRateLookups, type Paginated } from '@oms/shared';
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
    const [customers, gstCats, custCats] = await Promise.all([
      this.prisma.customer.findMany({
        where: { partyName: { not: null } },
        select: { partyName: true },
        distinct: ['partyName'],
        orderBy: { partyName: 'asc' },
      }),
      this.prisma.gstRate.findMany({ select: { category: true }, distinct: ['category'], orderBy: { category: 'asc' } }),
      this.prisma.customer.findMany({
        where: { category: { not: null } },
        select: { category: true },
        distinct: ['category'],
        orderBy: { category: 'asc' },
      }),
    ]);
    const categories = Array.from(
      new Set([...gstCats.map((c) => c.category), ...custCats.map((c) => c.category!)].filter(Boolean)),
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

  /** Upsert by (customerName, category), both stored uppercase; links customerId best-effort. */
  private async upsert(name: string, category: string, rate: number | null): Promise<Row> {
    const customerName = uc(name)!;
    const cat = uc(category)!;
    const customer = await this.prisma.customer.findFirst({ where: { partyName: customerName } });
    const customerId = customer?.id ?? null;
    const customerCode = customer?.code ?? null;
    return this.prisma.gstRate.upsert({
      where: { customerName_category: { customerName, category: cat } },
      create: { customerName, category: cat, rate, customerId, customerCode },
      update: { rate, customerId, customerCode },
    });
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
