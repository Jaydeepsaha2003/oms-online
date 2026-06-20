import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type CustomerDto,
  type CustomerLookups,
  type Paginated,
  PARTY_SOURCES,
  PAY_BYS,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

type CustomerRow = Prisma.CustomerGetPayload<object>;

// Columns allowed in ORDER BY (guards against arbitrary sort input).
const SORTABLE = new Set([
  'id',
  'partyName',
  'agentName',
  'category',
  'city',
  'state',
  'region',
  'billingRate',
  'createdAt',
]);

/** Excel header (legacy Access column) → CustomerDto field. */
const EXCEL_COLUMNS: { header: string; key: keyof CustomerDto }[] = [
  { header: 'ID', key: 'id' },
  { header: 'PARTY SOURCE', key: 'partySource' },
  { header: 'AGENT NAME', key: 'agentName' },
  { header: 'CATEGORY', key: 'category' },
  { header: 'PARTY NAME', key: 'partyName' },
  { header: 'BILLING RATE', key: 'billingRate' },
  { header: 'TID', key: 'transporterId' },
  { header: 'TRANSPORT NAME', key: 'transportName' },
  { header: 'BAG NAME', key: 'bagName' },
  { header: 'PACKING', key: 'packing' },
  { header: 'FREIGHT', key: 'freight' },
  { header: 'BOXRATE', key: 'boxRate' },
  { header: 'CREDIT PERIOD', key: 'creditPeriod' },
  { header: 'CITY', key: 'city' },
  { header: 'STATE', key: 'state' },
  { header: 'REGION', key: 'region' },
  { header: 'MOBILE', key: 'mobile' },
  { header: 'EMAIL', key: 'email' },
  { header: 'BRAND', key: 'brand' },
  { header: 'BILL RATE PC', key: 'billRatePc' },
  { header: 'PAY BY', key: 'payBy' },
];

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: string[];
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: CustomerQueryDto): Promise<Paginated<CustomerDto>> {
    const where = this.buildWhere(query);
    const sortBy = query.sortBy && SORTABLE.has(query.sortBy) ? query.sortBy : 'partyName';
    const sortOrder = query.sortOrder ?? 'asc';

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOne(id: number): Promise<CustomerDto> {
    const row = await this.prisma.customer.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Customer not found.');
    return this.toDto(row);
  }

  async create(dto: CreateCustomerDto): Promise<CustomerDto> {
    const transporter = await this.resolveTransporter(dto.transportName, dto.packing, dto.freight);
    const row = await this.prisma.customer.create({ data: this.toData(dto, transporter) });
    return this.toDto(row);
  }

  async update(id: number, dto: UpdateCustomerDto): Promise<CustomerDto> {
    await this.ensureExists(id);
    const transporter = await this.resolveTransporter(dto.transportName, dto.packing, dto.freight);
    const row = await this.prisma.customer.update({ where: { id }, data: this.toData(dto, transporter) });
    return this.toDto(row);
  }

  async remove(id: number): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.customer.delete({ where: { id } });
  }

  /** Distinct existing values + transporters, to populate the form's dropdowns. */
  async lookups(): Promise<CustomerLookups> {
    const distinct = async (field: keyof CustomerRow): Promise<string[]> => {
      const rows = await this.prisma.customer.findMany({
        where: { [field]: { not: null } },
        select: { [field]: true },
        distinct: [field],
        orderBy: { [field]: 'asc' },
      });
      return rows
        .map((r) => (r as Record<string, unknown>)[field])
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    };

    const [agents, categories, brands, cities, states, regions, transporters] = await Promise.all([
      distinct('agentName'),
      distinct('category'),
      distinct('brand'),
      distinct('city'),
      distinct('state'),
      distinct('region'),
      this.prisma.transporter.findMany({ orderBy: { name: 'asc' } }),
    ]);

    return {
      partySources: [...PARTY_SOURCES],
      payBys: [...PAY_BYS],
      agents,
      categories,
      brands,
      cities,
      states,
      regions,
      transporters: transporters.map((t) => ({
        id: t.id,
        name: t.name,
        packing: t.packing,
        freight: t.freight,
      })),
    };
  }

  /** All matching rows mapped to legacy Excel headers, for export. */
  async exportRows(query: CustomerQueryDto): Promise<Record<string, unknown>[]> {
    const where = this.buildWhere(query);
    const rows = await this.prisma.customer.findMany({
      where,
      orderBy: { partyName: 'asc' },
    });
    return rows.map((r) => {
      const dto = this.toDto(r);
      const out: Record<string, unknown> = {};
      for (const col of EXCEL_COLUMNS) out[col.header] = dto[col.key] ?? '';
      return out;
    });
  }

  /** Upsert rows from an uploaded spreadsheet (by ID), creating transporters as needed. */
  async importRows(rows: Record<string, unknown>[]): Promise<ImportResult> {
    const result: ImportResult = { total: rows.length, created: 0, updated: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const partyName = toStr(row['PARTY NAME']);
        if (!partyName) {
          result.errors.push(`Row ${i + 2}: PARTY NAME is required — skipped.`);
          continue;
        }
        const transportName = toStr(row['TRANSPORT NAME']);
        const packing = toNum(row['PACKING']);
        const freight = toNum(row['FREIGHT']);
        const transporter = await this.resolveTransporter(transportName, packing, freight);

        const data: Prisma.CustomerUncheckedCreateInput = {
          partySource: toStr(row['PARTY SOURCE']),
          agentName: uc(row['AGENT NAME']),
          category: uc(row['CATEGORY']),
          partyName,
          billingRate: toNum(row['BILLING RATE']),
          transporterId: transporter?.id ?? null,
          transportName: uc(transportName),
          bagName: toStr(row['BAG NAME']),
          packing: packing ?? transporter?.packing ?? null,
          freight: freight ?? transporter?.freight ?? null,
          boxRate: toInt(row['BOXRATE']),
          creditPeriod: toInt(row['CREDIT PERIOD']),
          city: toStr(row['CITY']),
          state: toStr(row['STATE']),
          region: toStr(row['REGION']),
          mobile: toStr(row['MOBILE']),
          email: toStr(row['EMAIL']),
          brand: uc(row['BRAND']),
          billRatePc: toNum(row['BILL RATE PC']),
          payBy: toStr(row['PAY BY']),
        };

        const id = toInt(row['ID']);
        if (id) {
          const exists = await this.prisma.customer.findUnique({ where: { id }, select: { id: true } });
          if (exists) {
            await this.prisma.customer.update({ where: { id }, data });
            result.updated++;
          } else {
            await this.prisma.customer.create({ data: { id, ...data } });
            result.created++;
          }
        } else {
          await this.prisma.customer.create({ data });
          result.created++;
        }
      } catch (err) {
        result.errors.push(`Row ${i + 2}: ${(err as Error).message}`);
      }
    }
    return result;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private buildWhere(query: CustomerQueryDto): Prisma.CustomerWhereInput {
    const search = query.search?.trim();
    return {
      ...(query.agentName ? { agentName: query.agentName } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(search
        ? {
            OR: [
              { partyName: { contains: search } },
              { mobile: { contains: search } },
              { email: { contains: search } },
              { agentName: { contains: search } },
              { transportName: { contains: search } },
              { city: { contains: search } },
            ],
          }
        : {}),
    };
  }

  /** Find or create the transporter by name; refresh its packing/freight if provided. */
  private async resolveTransporter(
    name?: string | null,
    packing?: number | null,
    freight?: number | null,
  ): Promise<{ id: number; packing: number | null; freight: number | null } | null> {
    const n = (name ?? '').trim().toUpperCase();
    if (!n) return null;

    const existing = await this.prisma.transporter.findUnique({ where: { name: n } });
    if (existing) {
      const needsUpdate =
        (packing != null && packing !== existing.packing) ||
        (freight != null && freight !== existing.freight);
      if (needsUpdate) {
        const updated = await this.prisma.transporter.update({
          where: { id: existing.id },
          data: { packing: packing ?? existing.packing, freight: freight ?? existing.freight },
        });
        return { id: updated.id, packing: updated.packing, freight: updated.freight };
      }
      return { id: existing.id, packing: existing.packing, freight: existing.freight };
    }

    const created = await this.prisma.transporter.create({
      data: { name: n, packing: packing ?? null, freight: freight ?? null },
    });
    return { id: created.id, packing: created.packing, freight: created.freight };
  }

  private toData(
    dto: CreateCustomerDto | UpdateCustomerDto,
    transporter: { id: number; packing: number | null; freight: number | null } | null,
  ): Prisma.CustomerUncheckedCreateInput {
    return {
      partySource: toStr(dto.partySource),
      agentName: uc(dto.agentName),
      category: uc(dto.category),
      partyName: (toStr(dto.partyName) ?? '') as string,
      billingRate: dto.billingRate ?? null,
      transporterId: transporter?.id ?? null,
      transportName: uc(dto.transportName),
      bagName: toStr(dto.bagName),
      packing: dto.packing ?? transporter?.packing ?? null,
      freight: dto.freight ?? transporter?.freight ?? null,
      boxRate: dto.boxRate ?? null,
      creditPeriod: dto.creditPeriod ?? null,
      city: toStr(dto.city),
      state: toStr(dto.state),
      region: toStr(dto.region),
      mobile: toStr(dto.mobile),
      email: toStr(dto.email),
      brand: uc(dto.brand),
      billRatePc: dto.billRatePc ?? null,
      payBy: toStr(dto.payBy),
    };
  }

  private async ensureExists(id: number): Promise<void> {
    const count = await this.prisma.customer.count({ where: { id } });
    if (!count) throw new NotFoundException('Customer not found.');
  }

  private toDto(r: CustomerRow): CustomerDto {
    return {
      id: r.id,
      partySource: r.partySource,
      agentName: r.agentName,
      category: r.category,
      partyName: r.partyName,
      billingRate: r.billingRate,
      transporterId: r.transporterId,
      transportName: r.transportName,
      bagName: r.bagName,
      packing: r.packing,
      freight: r.freight,
      boxRate: r.boxRate,
      creditPeriod: r.creditPeriod,
      city: r.city,
      state: r.state,
      region: r.region,
      mobile: r.mobile,
      email: r.email,
      brand: r.brand,
      billRatePc: r.billRatePc,
      payBy: r.payBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}

// ── value coercion ─────────────────────────────────────────────────────────

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function uc(v: unknown): string | null {
  const s = toStr(v);
  return s ? s.toUpperCase() : null;
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  const n = toNum(v);
  return n == null ? null : Math.round(n);
}
