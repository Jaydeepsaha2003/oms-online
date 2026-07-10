import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type CustomerDto,
  type CustomerLookups,
  type CustomerRateList,
  type CustomerRateListDesign,
  type CustomerRateListProduct,
  type CustomerRateDto,
  type Paginated,
  type RateChangeEntry,
  type RateHistoryKind,
  resolveSpecialRates,
  PARTY_SOURCES,
  PAY_BYS,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { isValidEmail, isValidMobile } from '../common/validation';
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
  { header: 'CODE', key: 'code' },
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
    await this.assertNameOk(dto.partyName, dto.transportName);
    await this.resolveAgent(dto.agentName);
    const transporter = await this.resolveTransporter(dto.transportName, dto.packing, dto.freight);
    const row = await this.prisma.customer.create({ data: this.toData(dto, transporter) });
    return this.toDto(await this.ensureCode(row));
  }

  async update(id: number, dto: UpdateCustomerDto): Promise<CustomerDto> {
    await this.ensureExists(id);
    await this.assertNameOk(dto.partyName, dto.transportName);
    await this.resolveAgent(dto.agentName);
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
      this.prisma.agent
        .findMany({ orderBy: { name: 'asc' }, select: { name: true } })
        .then((rows) => rows.map((r) => r.name)),
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

  /** Stable export/import column order — also used as the empty-export template. */
  exportHeaders(): string[] {
    return EXCEL_COLUMNS.map((c) => c.header);
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
        // Customer and transporter names must be distinct.
        if (transportName && uc(partyName) === uc(transportName)) {
          result.errors.push(
            `Row ${i + 2}: PARTY NAME and TRANSPORT NAME are the same ("${partyName}") — they must differ. Skipped.`,
          );
          continue;
        }
        const nameClash = await this.prisma.transporter.findUnique({
          where: { name: uc(partyName)! },
          select: { id: true },
        });
        if (nameClash) {
          result.errors.push(
            `Row ${i + 2}: "${partyName}" is already a transporter name — customer and transporter names must differ. Skipped.`,
          );
          continue;
        }
        const packing = toNum(row['PACKING']);
        const freight = toNum(row['FREIGHT']);
        const transporter = await this.resolveTransporter(transportName, packing, freight);

        // Validate mobile / email (same rules as the form). Uppercase no-op for mobile.
        const mobile = uc(row['MOBILE']);
        const email = uc(row['EMAIL']);
        if (mobile && !isValidMobile(mobile)) {
          result.errors.push(`Row ${i + 2}: invalid MOBILE "${mobile}" — skipped.`);
          continue;
        }
        if (email && !isValidEmail(email)) {
          result.errors.push(`Row ${i + 2}: invalid EMAIL "${email}" — skipped.`);
          continue;
        }

        // All text fields are stored UPPERCASE.
        const data: Prisma.CustomerUncheckedCreateInput = {
          partySource: uc(row['PARTY SOURCE']),
          agentName: uc(row['AGENT NAME']),
          category: uc(row['CATEGORY']),
          partyName: uc(partyName)!,
          billingRate: toNum(row['BILLING RATE']),
          transporterId: transporter?.id ?? null,
          transportName: uc(transportName),
          bagName: uc(row['BAG NAME']),
          packing: packing ?? transporter?.packing ?? null,
          freight: freight ?? transporter?.freight ?? null,
          boxRate: toInt(row['BOXRATE']),
          creditPeriod: toInt(row['CREDIT PERIOD']),
          city: uc(row['CITY']),
          state: uc(row['STATE']),
          region: uc(row['REGION']),
          mobile,
          email,
          brand: uc(row['BRAND']),
          billRatePc: toNum(row['BILL RATE PC']),
          payBy: uc(row['PAY BY']),
        };

        // Add the agent to the master list if it's new.
        await this.resolveAgent(data.agentName);

        // CODE is auto-generated server-side and intentionally NOT read from the
        // upload — uploads never need to supply it.
        const id = toInt(row['ID']);
        if (id) {
          const exists = await this.prisma.customer.findUnique({ where: { id }, select: { id: true } });
          if (exists) {
            const updated = await this.prisma.customer.update({ where: { id }, data });
            await this.ensureCode(updated);
            result.updated++;
          } else {
            const createdRow = await this.prisma.customer.create({ data: { id, ...data } });
            await this.ensureCode(createdRow);
            result.created++;
          }
        } else {
          const createdRow = await this.prisma.customer.create({ data });
          await this.ensureCode(createdRow);
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
    // Default (no status) = active-only, so every picker that hits /customers shows
    // only active parties. The Customers master passes ALL / INACTIVE explicitly.
    const status = (query.status ?? 'ACTIVE').toUpperCase();
    const activeFilter = status === 'ALL' ? {} : { active: status !== 'INACTIVE' };
    return {
      ...activeFilter,
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

  /**
   * Add an agent to the master list if it doesn't exist yet, so agents typed in
   * the customer form are persisted (with timestamps). 'SELF' is a sentinel for
   * partySource = SELF and is never stored as an agent.
   */
  private async resolveAgent(name?: string | null): Promise<void> {
    const n = uc(name);
    if (!n || n === 'SELF') return;
    await this.prisma.agent.upsert({ where: { name: n }, update: {}, create: { name: n } });
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
    // All text fields are stored UPPERCASE for consistent search/matching.
    return {
      partySource: uc(dto.partySource),
      agentName: uc(dto.agentName),
      category: uc(dto.category),
      partyName: (uc(dto.partyName) ?? '') as string,
      billingRate: dto.billingRate ?? null,
      transporterId: transporter?.id ?? null,
      transportName: uc(dto.transportName),
      bagName: uc(dto.bagName),
      packing: dto.packing ?? transporter?.packing ?? null,
      freight: dto.freight ?? transporter?.freight ?? null,
      boxRate: dto.boxRate ?? null,
      creditPeriod: dto.creditPeriod ?? null,
      city: uc(dto.city),
      state: uc(dto.state),
      region: uc(dto.region),
      mobile: uc(dto.mobile),
      email: uc(dto.email),
      brand: uc(dto.brand),
      billRatePc: dto.billRatePc ?? null,
      payBy: uc(dto.payBy),
      tdsApplicable: dto.tdsApplicable ?? false,
      tdsPercent: dto.tdsApplicable ? (dto.tdsPercent ?? null) : null,
      // Pass-through: undefined ⇒ Prisma default (true) on create, unchanged on update.
      active: dto.active,
    };
  }

  private async ensureExists(id: number): Promise<void> {
    const count = await this.prisma.customer.count({ where: { id } });
    if (!count) throw new NotFoundException('Customer not found.');
  }

  /**
   * Enforce that a customer's name is distinct from transporter names — it may
   * not equal its own transport name, nor any existing transporter's name.
   */
  private async assertNameOk(partyName?: string | null, transportName?: string | null): Promise<void> {
    const p = uc(partyName);
    if (!p) return;
    const t = uc(transportName);
    if (t && p === t) {
      throw new ConflictException('Customer name and transport name cannot be the same.');
    }
    const clash = await this.prisma.transporter.findUnique({ where: { name: p }, select: { id: true } });
    if (clash) {
      throw new ConflictException(
        'A transporter already exists with this name. Customer and transporter names must be different.',
      );
    }
  }

  /** Stable, human-readable code derived from the row id (e.g. CUST-00001). */
  private codeFor(id: number): string {
    return `CUST-${String(id).padStart(5, '0')}`;
  }

  /** Assign the auto-generated code if the row doesn't have one yet. */
  private async ensureCode(row: CustomerRow): Promise<CustomerRow> {
    if (row.code) return row;
    return this.prisma.customer.update({
      where: { id: row.id },
      data: { code: this.codeFor(row.id) },
    });
  }

  private toDto(r: CustomerRow): CustomerDto {
    return {
      id: r.id,
      code: r.code ?? this.codeFor(r.id),
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
      tdsApplicable: r.tdsApplicable,
      tdsPercent: r.tdsPercent,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  /* ── Rate List (Customers → Rate List) ───────────────────────────────────── */

  /** This customer's own special-rate change history (old→new, when, by whom),
   *  newest first — the on-screen "versions grouped by date/time". */
  async rateHistory(id: number): Promise<RateChangeEntry[]> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    const rows = await this.prisma.customerRateHistory.findMany({
      where: { customerId: id },
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      kind: 'CUSTOMER' as RateHistoryKind,
      name: r.customerName ?? customer.partyName ?? `#${r.customerId}`,
      category: r.category,
      subCategory: r.subCategory,
      rateKind: r.kind,
      scope: r.scope,
      target: r.target,
      oldRate: r.oldRate,
      newRate: r.newRate,
      changedByName: r.changedByName,
      changedAt: r.changedAt.toISOString(),
    }));
  }

  /** The customer's CURRENT effective rate list: every product/design at its base
   *  chart rate + this customer's special-rate adjustment (resolved cascade). Feeds
   *  the PDF/Excel download. */
  async rateList(id: number): Promise<CustomerRateList> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');

    const [products, designs, rates] = await Promise.all([
      this.prisma.product.findMany({ where: { showOnRateList: true }, orderBy: [{ category: 'asc' }, { subCategory: 'asc' }, { product: 'asc' }, { size: 'asc' }] }),
      this.prisma.design.findMany({ where: { showOnRateList: true }, orderBy: [{ category: 'asc' }, { subCategory: 'asc' }, { designType: 'asc' }] }),
      this.prisma.customerRate.findMany({ where: { customerId: id } }),
    ]);

    // Snapshot the customer's special rates in the shape resolveSpecialRates expects.
    const snapshot = {
      rates: rates.map<CustomerRateDto>((r) => ({
        id: r.id,
        customerId: r.customerId,
        kind: r.kind as CustomerRateDto['kind'],
        scope: r.scope as CustomerRateDto['scope'],
        category: r.category,
        subCategory: r.subCategory,
        target: r.target,
        rate: r.rate,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      logos: [],
    };

    const productLines: CustomerRateListProduct[] = products.map((p) => {
      const res = resolveSpecialRates(snapshot, { category: p.category, subCategory: p.subCategory, product: p.product, designType: null });
      const base = p.rate ?? 0;
      return {
        category: p.category,
        subCategory: p.subCategory,
        product: p.product,
        size: p.size,
        pcs: p.pcs,
        weight: p.weight,
        baseRate: base,
        delta: res.productDelta,
        rate: Math.round((base + res.productDelta) * 100) / 100,
        from: res.productFrom,
      };
    });

    const designLines: CustomerRateListDesign[] = designs.map((d) => {
      const res = resolveSpecialRates(snapshot, { category: d.category, subCategory: d.subCategory, designType: d.designType });
      const base = d.rate ?? 0;
      return {
        category: d.category,
        subCategory: d.subCategory,
        designType: d.designType,
        baseRate: base,
        delta: res.designDelta,
        rate: Math.round((base + res.designDelta) * 100) / 100,
        from: res.designFrom,
      };
    });

    return {
      customerId: customer.id,
      customerName: customer.partyName ?? `#${customer.id}`,
      generatedAt: new Date().toISOString(),
      products: productLines,
      designs: designLines,
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
