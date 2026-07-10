import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type CombinationDto, type Paginated } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { uc } from '../common/coerce';
import {
  CombinationQueryDto,
  CreateCombinationDto,
  ImportCombinationsDto,
  UpdateCombinationDto,
} from './dto/combination.dto';

const INCLUDE = { designLinks: { include: { design: true } } } as const;
type Row = Prisma.CombinationGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class CombinationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: CombinationQueryDto): Promise<Paginated<CombinationDto>> {
    const search = query.search?.trim();
    const and: Prisma.CombinationWhereInput[] = [];
    if (search) {
      and.push({
        OR: [
          { name: { contains: search } },
          { designLinks: { some: { design: { designType: { contains: search } } } } },
        ],
      });
    }
    // Exact-match dropdown filters (Combinations grid) — a combo matches when any
    // of its linked designs is in that category / sub-category.
    if (query.category?.trim()) {
      and.push({ designLinks: { some: { design: { category: query.category.trim() } } } });
    }
    if (query.subCategory?.trim()) {
      and.push({ designLinks: { some: { design: { subCategory: query.subCategory.trim() } } } });
    }
    const where: Prisma.CombinationWhereInput = and.length ? { AND: and } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.combination.findMany({
        where,
        include: INCLUDE,
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.combination.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOne(id: number): Promise<CombinationDto> {
    const row = await this.prisma.combination.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundException('Combination not found.');
    return this.toDto(row);
  }

  async create(dto: CreateCombinationDto): Promise<CombinationDto> {
    const designIds = await this.resolveDesignIds(dto.designIds);
    const name = await this.resolveName(dto.name, designIds);
    const created = await this.prisma.combination.create({
      data: { name, designLinks: { create: designIds.map((designId) => ({ designId })) } },
      include: INCLUDE,
    });
    return this.toDto(await this.ensureCode(created));
  }

  async update(id: number, dto: UpdateCombinationDto): Promise<CombinationDto> {
    await this.ensureExists(id);
    const designIds = dto.designIds ? await this.resolveDesignIds(dto.designIds) : undefined;
    const name =
      dto.name !== undefined || designIds
        ? await this.resolveName(dto.name, designIds ?? (await this.currentDesignIds(id)))
        : undefined;
    const row = await this.prisma.combination.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(designIds
          ? { designLinks: { deleteMany: {}, create: designIds.map((designId) => ({ designId })) } }
          : {}),
      },
      include: INCLUDE,
    });
    return this.toDto(await this.ensureCode(row));
  }

  async remove(id: number): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.combination.delete({ where: { id } });
  }

  /** Stable export column order. DESIGN CODES is the machine-readable link key
   * used on re-import; DESIGNS is the human-readable list. Cost/Rate are live sums. */
  exportHeaders(): string[] {
    return ['CODE', 'NAME', 'CATEGORY', 'SUB CATEGORY', 'DESIGNS', 'DESIGN CODES', 'COST', 'RATE'];
  }

  async exportRows(query: CombinationQueryDto): Promise<Record<string, unknown>[]> {
    const { items } = await this.findMany({ ...query, page: 1, pageSize: 100_000 } as CombinationQueryDto);
    return items.map((c) => ({
      CODE: c.code ?? '',
      NAME: c.name,
      CATEGORY: c.category,
      'SUB CATEGORY': c.subCategory,
      DESIGNS: c.designs.map((d) => d.designType).join(' + '),
      'DESIGN CODES': c.designs.map((d) => d.code ?? '').join(' + '),
      COST: c.cost,
      RATE: c.rate,
    }));
  }

  /**
   * Import combinations from spreadsheet rows. A row identifies its component
   * designs one of two ways:
   *   1. a `DESIGN CODES` column — design codes separated by + , or ; , or
   *   2. `CATEGORY` + `SUB CATEGORY` + a `DESIGN TYPE` expression (component
   *      types joined by + , e.g. "FULL LASER+DL"), resolved within that
   *      category/sub-category.
   * Every referenced design must already exist — a row naming a missing design
   * is rejected (skipped with an error), never silently created. Cost/Rate are
   * always the live sum of the linked designs (any COST/RATE column is ignored).
   * A `CODE` (CMB-…) updates that combination in place; otherwise one is created.
   */
  async importRows(
    dto: ImportCombinationsDto,
  ): Promise<{ total: number; created: number; updated: number; errors: string[] }> {
    const result = { total: dto.rows.length, created: 0, updated: 0, errors: [] as string[] };
    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      const rowNo = i + 2;
      try {
        const resolved = await this.resolveRowDesigns(row);
        if (resolved.error) {
          result.errors.push(`Row ${rowNo}: ${resolved.error}`);
          continue;
        }
        const { designIds } = resolved;
        const nameSeed = uc(row['NAME']) ?? uc(row['DESIGN TYPE']) ?? uc(row['DESIGNS']);
        const name = await this.resolveName(nameSeed, designIds);
        const code = uc(row['CODE']);
        const existing = code ? await this.prisma.combination.findUnique({ where: { code } }) : null;
        if (existing) {
          await this.prisma.combination.update({
            where: { id: existing.id },
            data: { name, designLinks: { deleteMany: {}, create: designIds.map((designId) => ({ designId })) } },
          });
          result.updated++;
        } else {
          const created = await this.prisma.combination.create({
            data: { name, designLinks: { create: designIds.map((designId) => ({ designId })) } },
            include: INCLUDE,
          });
          await this.ensureCode(created);
          result.created++;
        }
      } catch (err) {
        result.errors.push(`Row ${rowNo}: ${(err as Error).message}`);
      }
    }
    return result;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /**
   * Resolve all the component designs for one import row, by codes when a
   * `DESIGN CODES` column is given, otherwise by category + sub-category + a
   * `+`-joined design-type expression. Returns an `error` string if any
   * referenced design is missing (the row must then be skipped).
   */
  private async resolveRowDesigns(
    row: Record<string, unknown>,
  ): Promise<{ designIds: number[]; error?: string }> {
    const ids: number[] = [];
    const bad: string[] = [];
    const codesRaw = String(row['DESIGN CODES'] ?? row['DESIGN_CODES'] ?? '').trim();

    if (codesRaw) {
      // Mode 1: explicit design codes (or unique design types).
      const tokens = codesRaw.split(/[\s,;+/]+/).filter(Boolean);
      for (const tok of tokens) {
        const ref = await this.resolveDesignRef(tok);
        if (ref.id != null) ids.push(ref.id);
        else bad.push(ref.error as string);
      }
    } else {
      // Mode 2: category + sub-category + "TYPE+TYPE" expression.
      const category = uc(row['CATEGORY']);
      const subCategory = uc(row['SUB CATEGORY']);
      const expr = uc(row['DESIGN TYPE']) ?? uc(row['DESIGNS']) ?? uc(row['NAME']);
      if (!category || !subCategory || !expr) {
        return {
          designIds: [],
          error: 'needs a DESIGN CODES column, or CATEGORY + SUB CATEGORY + DESIGN TYPE. Skipped.',
        };
      }
      const components = expr
        .split(/[+,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const comp of components) {
        const d = await this.prisma.design.findFirst({
          where: { category, subCategory, designType: comp },
          select: { id: true },
        });
        if (d) ids.push(d.id);
        else bad.push(`"${comp}" (no such design in ${category} / ${subCategory})`);
      }
    }

    if (ids.length === 0 && bad.length === 0) return { designIds: [], error: 'no designs listed. Skipped.' };
    if (bad.length) return { designIds: [], error: `design(s) not found: ${bad.join('; ')}. Skipped.` };
    return { designIds: [...new Set(ids)] };
  }

  /** Resolve one design reference (a DSG code, or a unique design type) to its id. */
  private async resolveDesignRef(token: string): Promise<{ id?: number; error?: string }> {
    const up = token.toUpperCase();
    const byCode = await this.prisma.design.findUnique({ where: { code: up }, select: { id: true } });
    if (byCode) return { id: byCode.id };
    if (/^DSG-\d+$/.test(up)) return { error: `${up} (no such design code)` };
    const byType = await this.prisma.design.findMany({
      where: { designType: up },
      select: { id: true },
      take: 2,
    });
    if (byType.length === 1) return { id: byType[0].id };
    if (byType.length === 0) return { error: `${token} (not found)` };
    return { error: `${token} (matches several designs — use the DSG code)` };
  }

  private async resolveDesignIds(ids: number[]): Promise<number[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) throw new BadRequestException('Select at least one design.');
    const found = await this.prisma.design.findMany({ where: { id: { in: unique } }, select: { id: true } });
    if (found.length !== unique.length) {
      throw new BadRequestException('One or more selected designs no longer exist.');
    }
    return unique;
  }

  /** Name = supplied (uppercased) or auto-built from the component design types. */
  private async resolveName(name: string | undefined | null, designIds: number[]): Promise<string> {
    const given = uc(name);
    if (given) return given;
    const designs = await this.prisma.design.findMany({
      where: { id: { in: designIds } },
      select: { designType: true },
      orderBy: { designType: 'asc' },
    });
    return designs.map((d) => d.designType).join(' + ') || 'COMBINATION';
  }

  private async currentDesignIds(id: number): Promise<number[]> {
    const links = await this.prisma.combinationDesign.findMany({
      where: { combinationId: id },
      select: { designId: true },
    });
    return links.map((l) => l.designId);
  }

  private codeFor(id: number): string {
    return `CMB-${String(id).padStart(5, '0')}`;
  }

  private async ensureCode(row: Row): Promise<Row> {
    if (row.code) return row;
    return this.prisma.combination.update({
      where: { id: row.id },
      data: { code: this.codeFor(row.id) },
      include: INCLUDE,
    });
  }

  private async ensureExists(id: number): Promise<void> {
    const c = await this.prisma.combination.count({ where: { id } });
    if (!c) throw new NotFoundException('Combination not found.');
  }

  private toDto(row: Row): CombinationDto {
    const designs = row.designLinks.map((l) => l.design);
    const cost = designs.reduce((sum, d) => sum + (d.cost ?? 0), 0);
    const rate = designs.reduce((sum, d) => sum + (d.rate ?? 0), 0);
    const distinct = (vals: string[]) => [...new Set(vals.filter(Boolean))].join(', ');
    return {
      id: row.id,
      code: row.code ?? this.codeFor(row.id),
      name: row.name,
      category: distinct(designs.map((d) => d.category)),
      subCategory: distinct(designs.map((d) => d.subCategory)),
      designs: designs.map((d) => ({
        id: d.id,
        code: d.code,
        category: d.category,
        subCategory: d.subCategory,
        designType: d.designType,
        cost: d.cost,
        rate: d.rate,
      })),
      cost,
      rate,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
