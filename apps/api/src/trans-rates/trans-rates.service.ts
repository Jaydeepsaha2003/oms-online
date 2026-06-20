import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Paginated, type TransRateDto, type TransRateLookups } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toInt, toStr, uc } from '../common/coerce';
import { ImportTransRatesDto, TransRateQueryDto, UpsertTransRateDto } from './dto/trans-rate.dto';

type Row = Prisma.TransRateGetPayload<object>;

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

  async remove(id: number): Promise<void> {
    const c = await this.prisma.transRate.count({ where: { id } });
    if (!c) throw new NotFoundException('Transport rate not found.');
    await this.prisma.transRate.delete({ where: { id } });
  }

  async lookups(): Promise<TransRateLookups> {
    const [customers, trCats, custCats, types, transporters] = await Promise.all([
      this.prisma.customer.findMany({
        where: { partyName: { not: null } },
        select: { partyName: true },
        distinct: ['partyName'],
        orderBy: { partyName: 'asc' },
      }),
      this.prisma.transRate.findMany({ select: { category: true }, distinct: ['category'] }),
      this.prisma.customer.findMany({
        where: { category: { not: null } },
        select: { category: true },
        distinct: ['category'],
      }),
      this.prisma.transRate.findMany({
        where: { type: { not: '' } },
        select: { type: true },
        distinct: ['type'],
        orderBy: { type: 'asc' },
      }),
      this.prisma.transporter.findMany({ orderBy: { name: 'asc' } }),
    ]);
    const categories = Array.from(
      new Set([...trCats.map((c) => c.category), ...custCats.map((c) => c.category!)].filter(Boolean)),
    ).sort();
    return {
      customers: customers.map((c) => c.partyName!).filter(Boolean),
      categories,
      types: types.map((t) => t.type).filter(Boolean),
      transporters: transporters.map((t) => ({ id: t.id, name: t.name, packing: t.packing, freight: t.freight })),
    };
  }

  async exportRows(query: TransRateQueryDto): Promise<Record<string, unknown>[]> {
    const { items } = await this.findMany({ ...query, page: 1, pageSize: 100_000 } as TransRateQueryDto);
    return items.map((r) => ({
      'REC ID': r.id,
      'CUS ID': r.customerId ?? '',
      CUSTOMER: r.customerName,
      CATEGORY: r.category,
      TYPE: r.type,
      TID: r.transporterId ?? '',
      'TRANSPORT NAME': r.transportName ?? '',
      RATE: r.rate ?? '',
    }));
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
    const customer = await this.prisma.customer.findFirst({ where: { partyName: toStr(input.customerName)! } });
    const customerId = customer?.id ?? null;
    const transporter = await this.resolveTransporter(input.transportName);
    const transporterId = transporter?.id ?? null;
    const transportName = transporter?.name ?? null;

    const existing = await this.prisma.transRate.findFirst({
      where: { customerName, category, type, transporterId },
    });
    if (existing) {
      return this.prisma.transRate.update({
        where: { id: existing.id },
        data: { customerId, transportName, rate },
      });
    }
    return this.prisma.transRate.create({
      data: { customerId, customerName, category, type, transporterId, transportName, rate },
    });
  }

  private toDto(r: Row): TransRateDto {
    return {
      id: r.id,
      customerId: r.customerId,
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
