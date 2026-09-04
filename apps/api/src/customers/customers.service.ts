import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
  resolveCommissionRate,
  DEFAULT_RATE_LIST_TITLE,
  type AgentRateList,
  type AgentRateListRow,
  type AgentSpecialCommissionDto,
  type CommissionBasis,
  PARTY_SOURCES,
  PAY_BYS,
  PAY_BUCKETS,
  type PayByModes,
  parsePayByModes,
  payByFor,
  BULK_CUSTOMER_COLUMNS,
  type BulkCustomerColumn,
  type BulkCustomerChange,
  type BulkCustomerBlocker,
  type BulkCustomerPlan,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { isValidEmail, isValidMobile } from '../common/validation';
import { BulkUpdateCustomersDto } from './dto/bulk-update-customers.dto';
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

/**
 * Excel header (legacy Access column) → CustomerDto field, or a derived value.
 *
 * PAY BY BANK / PAY BY CASH are derived rather than stored: the override lives
 * in one JSON column, but a spreadsheet wants a column per bucket. They export
 * the EFFECTIVE routing (override, else PAY BY), so what the sheet shows is what
 * Receive Payment will actually do.
 */
type ExcelColumn =
  | { header: string; key: keyof CustomerDto }
  | { header: string; value: (dto: CustomerDto) => unknown };
const EXCEL_COLUMNS: ExcelColumn[] = [
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
  { header: 'PAY BY BANK', value: (d) => payByFor(d, 'bank') },
  { header: 'PAY BY CASH', value: (d) => payByFor(d, 'cash') },
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

  /**
   * Flip only the Active flag.
   *
   * Deliberately NOT routed through `update()`. Despite `UpdateCustomerDto`
   * being a PartialType, `toData()` rebuilds the ENTIRE record with `?? null`
   * fallbacks — so a PATCH carrying just `{ active }` would blank the party's
   * agent, city, transport, rates and credit period, and set partyName to ''.
   * The full edit form relies on that overwrite behaviour to clear fields, so
   * the fix is a narrow endpoint rather than changing what update() means.
   */
  async setActive(id: number, active: boolean): Promise<CustomerDto> {
    await this.ensureExists(id);
    const row = await this.prisma.customer.update({ where: { id }, data: { active } });
    return this.toDto(row);
  }

  /**
   * Place or release this party's dispatch hold.
   *
   * Narrow, for the same reason `setActive` is — see its comment; a PATCH
   * through `update()` would blank every field the caller never mentioned.
   *
   * Releasing CLEARS the reason and the who/when rather than keeping them. A
   * released hold's reason is not history, it is a stale sentence that would
   * reappear verbatim on the next hold placed in a hurry with no reason typed
   * — and it would read as the reason for THAT hold. Who released it and when
   * is on the audit trail, which is where that belongs.
   */
  async setDispatchHold(id: number, hold: boolean, reason: string | null, userName?: string): Promise<CustomerDto> {
    await this.ensureExists(id);
    const row = await this.prisma.customer.update({ where: { id }, data: this.holdData(hold, reason, userName) });
    return this.toDto(row);
  }

  /**
   * The same hold across a ticked set, in one write.
   *
   * Returns how many rows actually moved, not how many ids were sent: a
   * selection built up across pages goes stale, and reporting the id count as
   * the result would claim parties were held that no longer exist.
   */
  async bulkSetDispatchHold(
    ids: number[],
    hold: boolean,
    reason: string | null,
    userName?: string,
  ): Promise<{ updated: number; skipped: number; names: string[] }> {
    const unique = [...new Set(ids)];
    // Read first so the response can name the parties — the confirmation on
    // screen says "held 3 parties: A, B, C", which is the only way the user can
    // check the write matched what they ticked.
    const rows = await this.prisma.customer.findMany({
      where: { id: { in: unique } },
      select: { id: true, partyName: true },
      orderBy: { partyName: 'asc' },
    });
    if (!rows.length) return { updated: 0, skipped: unique.length, names: [] };
    const { count } = await this.prisma.customer.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: this.holdData(hold, reason, userName),
    });
    return {
      updated: count,
      skipped: unique.length - rows.length,
      names: rows.map((r) => r.partyName ?? `#${r.id}`),
    };
  }

  /** The four columns a hold owns, written the same way by both callers. */
  private holdData(hold: boolean, reason: string | null, userName?: string) {
    const clean = (reason ?? '').trim();
    return hold
      ? {
          dispatchHold: true,
          dispatchHoldReason: clean || null,
          dispatchHoldBy: userName ?? null,
          dispatchHoldAt: new Date(),
        }
      : { dispatchHold: false, dispatchHoldReason: null, dispatchHoldBy: null, dispatchHoldAt: null };
  }

  async remove(id: number): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.customer.delete({ where: { id } });
  }

  /* ── Bulk edit of the dropdown-backed columns ──────────────────────────────
   *
   * Preview and apply share one planner, so what the dialog shows is what gets
   * written — a second implementation for the preview is how the two drift.
   *
   * Like setActive, this deliberately avoids update()/toData(), which rebuild
   * the whole record with `?? null` fallbacks and would blank every column the
   * bulk edit never mentioned.
   */

  /** Work out every column that actually moves, and everything that blocks the write. */
  private async planBulkUpdate(dto: BulkUpdateCustomersDto): Promise<BulkCustomerPlan> {
    // Blank means "leave this column alone", never "clear it" — a bulk editor
    // that empties a column across 100 rows because a field was left untouched
    // is a footgun. Clearing a column stays a per-customer edit.
    const set = new Map<BulkCustomerColumn, string>();
    for (const col of BULK_CUSTOMER_COLUMNS) {
      const v = uc(dto.set[col]);
      if (v) set.set(col, v);
    }
    if (!set.size) throw new BadRequestException('Pick at least one column to change.');

    const rows = await this.prisma.customer.findMany({ where: { id: { in: dto.ids } }, orderBy: { partyName: 'asc' } });

    const changes: BulkCustomerChange[] = [];
    const blocked: BulkCustomerBlocker[] = [];
    for (const row of rows) {
      for (const [column, to] of set) {
        const from = (row as unknown as Record<string, string | null>)[column] ?? null;
        if (from === to) continue;
        changes.push({ id: row.id, partyName: row.partyName, column, from, to });
      }
      // Routing to AGENT is only collectible through a real agent: Receive
      // Payment blocks the party in Party mode for that bucket and finds it in
      // Agent mode only via customers.agentName. A party left on SELF (or
      // nothing) is reachable by neither, so it would quietly stop being
      // collectible at all.
      //
      // Judged on the state this change WOULD leave behind, per bucket — a bulk
      // edit sets payBy, but an existing per-bucket override can still be the
      // thing that routes the party to an agent it does not have.
      const after = { payBy: set.get('payBy') ?? row.payBy, payByModes: row.payByModes };
      const routed = PAY_BUCKETS.filter((b) => payByFor(after, b) === 'AGENT');
      if (routed.length) {
        const agent = uc(set.get('agentName') ?? row.agentName);
        if (!agent || agent === 'SELF') {
          blocked.push({
            id: row.id,
            partyName: row.partyName,
            reason: `Its ${routed.join(' and ')} would be collected by an agent, but this party's agent is ${agent ?? 'not set'}. Set the Agent column in the same change, or leave this party out.`,
          });
        }
      }
    }

    const warnings: string[] = [];
    if (set.get('payBy') === 'AGENT') {
      warnings.push('These parties can no longer be paid in Party mode on Receive Payment — every future receipt from them must go through their agent. Receipts already recorded stay editable.');
    }

    const affected = new Set(changes.map((c) => c.id)).size;
    return { matched: rows.length, affected, changes, blocked, warnings };
  }

  /** What the change would do. Writes nothing. */
  previewBulkUpdate(dto: BulkUpdateCustomersDto): Promise<BulkCustomerPlan> {
    return this.planBulkUpdate(dto);
  }

  /** Apply the plan. Refuses outright if anything is blocked — a bulk write that
   *  silently does 20 of 23 rows is worse than one that does none. */
  async bulkUpdate(dto: BulkUpdateCustomersDto): Promise<{ updated: number }> {
    const plan = await this.planBulkUpdate(dto);
    if (plan.blocked.length) {
      throw new BadRequestException(
        `${plan.blocked.length} part${plan.blocked.length === 1 ? 'y' : 'ies'} cannot take this change: ${plan.blocked.map((b) => b.partyName ?? `#${b.id}`).join(', ')}. ${plan.blocked[0].reason}`,
      );
    }
    if (!plan.affected) return { updated: 0 };

    // Same values for every row, so one statement — but only the columns the
    // plan actually carries, and only the rows one of them moves on.
    const data: Prisma.CustomerUpdateInput = {};
    for (const col of BULK_CUSTOMER_COLUMNS) {
      const v = uc(dto.set[col]);
      if (v) (data as Record<string, string>)[col] = v;
    }
    // Keeps the Agents master in step with what parties reference, exactly as
    // create()/update() do for a single customer.
    if (data.agentName) await this.resolveAgent(data.agentName as string);

    const affectedIds = [...new Set(plan.changes.map((c) => c.id))];
    const { count } = await this.prisma.customer.updateMany({ where: { id: { in: affectedIds } }, data });
    return { updated: count };
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
      for (const col of EXCEL_COLUMNS) out[col.header] = ('value' in col ? col.value(dto) : dto[col.key]) ?? '';
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
          // An older sheet has only PAY BY: both buckets follow it and no
          // override is written, so those files keep importing unchanged.
          payByModes: payByModesFromColumns(row['PAY BY BANK'], row['PAY BY CASH'], uc(row['PAY BY'])),
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
    /*
     * ON_HOLD deliberately does NOT also filter on `active`.
     *
     * It is the answer to "which parties are held", and a party that was held
     * and later set inactive is still held — dropping it from the one view
     * whose job is to list holds would hide exactly the row somebody is
     * looking for. The two flags are independent (see the schema), so the
     * filter for one does not imply anything about the other.
     */
    const activeFilter =
      status === 'ALL' ? {} : status === 'ON_HOLD' ? { dispatchHold: true } : { active: status !== 'INACTIVE' };
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
      payByModes: normalisePayByModes(dto.payByModes),
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
      payByModes: r.payByModes,
      tdsApplicable: r.tdsApplicable,
      tdsPercent: r.tdsPercent,
      active: r.active,
      dispatchHold: r.dispatchHold,
      dispatchHoldReason: r.dispatchHoldReason,
      dispatchHoldBy: r.dispatchHoldBy,
      dispatchHoldAt: r.dispatchHoldAt ? r.dispatchHoldAt.toISOString() : null,
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
    const rates = await this.prisma.customerRate.findMany({ where: { customerId: id } });
    return this.buildRateList(customer.id, customer.partyName ?? `#${customer.id}`, rates);
  }

  /**
   * The chart rate list — every rated item at its base rate, no party attached.
   *
   * For quoting a party that does not exist yet. Until now the sheet could only
   * be produced for a saved customer, so the only way to hand a new enquiry a
   * price list was to create a customer record for someone who might never
   * order, or to send a list built for a different party and hope nobody noticed
   * that party's discounts baked into it.
   *
   * `label` is what gets printed at the top. Optional: with nothing supplied the
   * sheet is headed "STANDARD RATE LIST", which is what it is. Anything supplied
   * is printed verbatim and stored nowhere — naming the sheet is not creating a
   * customer.
   *
   * `customerId: 0` marks it as party-less. Every rate here carries `delta: 0`
   * and `from: null` by construction (the snapshot is empty), so nothing on the
   * sheet can be marked as an adjustment.
   */
  async defaultRateList(label?: string | null): Promise<CustomerRateList> {
    const name = (label ?? '').trim();
    return this.buildRateList(0, name || DEFAULT_RATE_LIST_TITLE, []);
  }

  /**
   * The agent rate list: what the customer pays beside what the agent earns.
   *
   * Built here rather than in the commission module because the PRODUCT side of
   * it — which items are on the sheet, and at what rate for this party — is
   * exactly the rate list this service already produces. The commission side is
   * two lookups and the shared resolver, which is the same resolver invoice
   * pricing uses; a second implementation here would be a second answer to
   * "what does this agent earn", and one of the two would be wrong.
   *
   * `customerId` is optional and changes the sheet in two ways at once, both
   * reported on the payload:
   *   - the product rate becomes that party's effective rate (their special
   *     rates applied), not the plain chart rate;
   *   - party-scoped commission rules can resolve. Without a party they cannot,
   *     so an all-parties sheet shows base and non-party specials only.
   */
  async agentRateList(agentId: number, customerId?: number | null): Promise<AgentRateList> {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, name: true } });
    if (!agent) throw new NotFoundException('Agent not found');

    let customer: { id: number; partyName: string | null } | null = null;
    if (customerId != null) {
      customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, partyName: true } });
      if (!customer) throw new NotFoundException('Party not found');
    }

    // The product side, priced for the party when there is one.
    const list = customer ? await this.rateList(customer.id) : await this.defaultRateList();

    const now = new Date();
    const [baseRates, specialRows] = await Promise.all([
      // Newest-first so the first row per category is the one in force today.
      this.prisma.agentCommissionRate.findMany({
        where: { agentId: agent.id, effectiveFrom: { lte: now } },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.agentSpecialCommission.findMany({
        where: {
          agentId: agent.id,
          effectiveFrom: { lte: now },
          // A party-scoped rule is unresolvable without a party, and including
          // one would let it win over the base and overstate every line.
          ...(customer ? { OR: [{ customerId: null }, { customerId: customer.id }] } : { customerId: null }),
        },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
      }),
    ]);

    /** The base rate in force per category — first wins, the list is newest-first. */
    const baseByCategory = new Map<string, { ratePerUnit: number; basis: CommissionBasis }>();
    for (const r of baseRates) {
      const key = (r.pCategory ?? '').trim().toUpperCase();
      if (!key || baseByCategory.has(key)) continue;
      baseByCategory.set(key, { ratePerUnit: r.ratePerUnit, basis: (r.basis === 'PCS' ? 'PCS' : 'KGS') as CommissionBasis });
    }

    // The resolver wants DTOs, and `current` is not used by it — the date filter
    // above has already done that job.
    const rules: AgentSpecialCommissionDto[] = specialRows.map((r) => this.toSpecialCommissionDto(r, agent.name));

    const rows: AgentRateListRow[] = list.products.map((prod) => {
      const catKey = (prod.category ?? '').trim().toUpperCase();
      const base = baseByCategory.get(catKey) ?? null;
      const resolved = resolveCommissionRate(rules, base, {
        customerId: customer?.id ?? null,
        pCategory: prod.category,
        subCategory: prod.subCategory,
        product: prod.product,
        // A rate-list line is a product, not a design. Design commissions are
        // aimed at a design type, so they cannot apply to a product row —
        // passing a design here would match rules this line is not.
        designType: null,
      });
      const isSpecial = !!resolved && resolved.scope != null;
      return {
        category: prod.category,
        subCategory: prod.subCategory,
        product: prod.product,
        size: prod.size,
        pcs: prod.pcs,
        productRate: prod.rate,
        baseCommission: base?.ratePerUnit ?? null,
        specialCommission: isSpecial ? resolved!.ratePerUnit : null,
        effectiveCommission: resolved?.ratePerUnit ?? null,
        basis: resolved?.basis ?? base?.basis ?? 'KGS',
        source: !resolved ? 'NONE' : isSpecial ? 'SPECIAL' : 'BASE',
        specialScope: isSpecial ? resolved!.scope : null,
        specialLabel: isSpecial ? resolved!.label : null,
        partySpecific: resolved?.partySpecific ?? false,
      };
    });

    return {
      agentId: agent.id,
      agentName: agent.name,
      customerId: customer?.id ?? null,
      customerName: customer?.partyName ?? null,
      partyScoped: !!customer,
      generatedAt: new Date().toISOString(),
      rows,
      specialCount: rows.filter((r) => r.source === 'SPECIAL').length,
      noCommissionCount: rows.filter((r) => r.source === 'NONE').length,
    };
  }

  /** The special-rule shape {@link resolveCommissionRate} expects. Only the
   *  fields the resolver reads are filled; `current` is irrelevant here because
   *  the query already restricted to rules in force. */
  private toSpecialCommissionDto(
    r: {
      id: number;
      agentId: number;
      scope: string;
      customerId: number | null;
      customerName: string | null;
      pCategory: string | null;
      subCategory: string | null;
      product: string | null;
      designType: string | null;
      basis: string;
      ratePerUnit: number;
      effectiveFrom: Date;
      note: string | null;
      userName: string | null;
      addToRate: boolean;
      createdAt: Date;
      updatedAt: Date;
    },
    agentName: string,
  ): AgentSpecialCommissionDto {
    return {
      id: r.id,
      agentId: r.agentId,
      agentName,
      scope: r.scope as AgentSpecialCommissionDto['scope'],
      customerId: r.customerId,
      customerName: r.customerName,
      pCategory: r.pCategory,
      subCategory: r.subCategory,
      product: r.product,
      designType: r.designType,
      basis: (r.basis === 'PCS' ? 'PCS' : 'KGS') as CommissionBasis,
      ratePerUnit: r.ratePerUnit,
      effectiveFrom: r.effectiveFrom.toISOString(),
      note: r.note,
      userName: r.userName,
      current: true,
      addToRate: r.addToRate,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  /** Shared by both: the catalogue, priced through whatever special rates apply
   *  (none, for the default sheet). */
  private async buildRateList(
    customerId: number,
    customerName: string,
    rates: { id: number; customerId: number; kind: string; scope: string; category: string; subCategory: string; target: string; rate: number; createdAt: Date; updatedAt: Date }[],
  ): Promise<CustomerRateList> {

    // Active-only (spec 11/12/30): an INACTIVE product or design must never reach
    // the sheet, its PDF or its Excel, even with the rate-list flag still ticked.
    // Deactivating an item is the act of withdrawing it; making the user also
    // untick a second flag means the sheet keeps quoting a withdrawn item until
    // somebody notices.
    const [products, designs] = await Promise.all([
      this.prisma.product.findMany({ where: { showOnRateList: true, active: true }, orderBy: [{ category: 'asc' }, { subCategory: 'asc' }, { product: 'asc' }, { size: 'asc' }] }),
      this.prisma.design.findMany({ where: { showOnRateList: true, active: true }, orderBy: [{ category: 'asc' }, { subCategory: 'asc' }, { designType: 'asc' }] }),
    ]);

    // "MIX-<CATEGORY>" sub-categories (e.g. "MIX-CUP" → "MIX CUP SET") hold a
    // single SKU sold as a bundle of several individual designs/sizes — a
    // combination, not a rate any one design/size actually carries. The customer
    // rate sheet is only meaningful per distinct item, so these never belong on it
    // (SQLite's Prisma client has no case-insensitive `startsWith`, hence the
    // in-memory filter rather than a WHERE clause).
    const isCombination = (subCategory: string) => /^mix[\s-]?/i.test(subCategory.trim());
    const ratedProducts = products.filter((p) => !isCombination(p.subCategory));
    const ratedDesigns = designs.filter((d) => !isCombination(d.subCategory));

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

    const productLines: CustomerRateListProduct[] = ratedProducts.map((p) => {
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

    const designLines: CustomerRateListDesign[] = ratedDesigns.map((d) => {
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
      customerId,
      customerName,
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

/**
 * Canonicalise the per-bucket routing override before it is stored.
 *
 * Round-trips through the shared parser, so only the two known buckets and the
 * two known values survive — a hand-typed or stale payload cannot put a party
 * into a state Receive Payment does not understand. An override that says
 * nothing is stored as NULL rather than "{}", keeping "no override" a single
 * representation instead of two.
 */
function normalisePayByModes(v: unknown): string | null {
  if (v == null || v === '') return null;
  const clean: PayByModes = parsePayByModes(typeof v === 'string' ? v : JSON.stringify(v));
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

/** Build the override from two per-bucket spreadsheet cells. A cell that repeats
 *  the party's PAY BY is not an override, so it is left out entirely. */
function payByModesFromColumns(bank: unknown, cash: unknown, payBy: string | null): string | null {
  const fallback = (payBy ?? '').trim().toUpperCase() === 'AGENT' ? 'AGENT' : 'PARTY';
  const out: Record<string, string> = {};
  for (const [bucket, raw] of [['bank', bank], ['cash', cash]] as const) {
    const val = uc(raw);
    if (val && val !== fallback) out[bucket] = val;
  }
  return normalisePayByModes(Object.keys(out).length ? JSON.stringify(out) : null);
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
