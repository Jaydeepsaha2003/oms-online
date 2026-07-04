import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type DesignDto, type DesignLookups, type Paginated } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toNum, uc } from '../common/coerce';
import { CreateDesignDto, DesignQueryDto, ImportDesignsDto, UpdateDesignDto } from './dto/design.dto';

type Row = Prisma.DesignGetPayload<object>;

@Injectable()
export class DesignsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: DesignQueryDto): Promise<Paginated<DesignDto>> {
    const search = query.search?.trim();
    const where: Prisma.DesignWhereInput = search
      ? {
          OR: [
            { category: { contains: search } },
            { subCategory: { contains: search } },
            { designType: { contains: search } },
          ],
        }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.design.findMany({
        where,
        orderBy: [{ category: 'asc' }, { designType: 'asc' }],
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.design.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOne(id: number): Promise<DesignDto> {
    const row = await this.prisma.design.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Design not found.');
    return this.toDto(row);
  }

  /** Distinct existing categories & sub-categories for the form's dropdowns. */
  async lookups(): Promise<DesignLookups> {
    const [cats, subs] = await Promise.all([
      this.prisma.design.findMany({
        where: { category: { not: '' } },
        select: { category: true },
        distinct: ['category'],
        orderBy: { category: 'asc' },
      }),
      this.prisma.design.findMany({
        where: { subCategory: { not: '' } },
        select: { subCategory: true },
        distinct: ['subCategory'],
        orderBy: { subCategory: 'asc' },
      }),
    ]);
    return {
      categories: cats.map((c) => c.category).filter(Boolean),
      subCategories: subs.map((s) => s.subCategory).filter(Boolean),
    };
  }

  async create(dto: CreateDesignDto): Promise<DesignDto> {
    try {
      const row = await this.prisma.design.create({ data: this.toData(dto) });
      return this.toDto(await this.ensureCode(row));
    } catch (err) {
      throw this.conflictOr(err);
    }
  }

  async update(id: number, dto: UpdateDesignDto, changedByName?: string | null): Promise<DesignDto> {
    const before = await this.prisma.design.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Design not found.');
    try {
      const row = await this.prisma.design.update({ where: { id }, data: this.toData(dto) });
      await this.logRateChange(before, row, changedByName);
      return this.toDto(await this.ensureCode(row));
    } catch (err) {
      throw this.conflictOr(err);
    }
  }

  /** Record an old→new design-rate change (for booking-date repricing + audit). */
  private async logRateChange(before: Row, after: Row, changedByName?: string | null): Promise<void> {
    if ((before.rate ?? null) === (after.rate ?? null)) return;
    await this.prisma.designRateHistory.create({
      data: {
        designId: after.id,
        designType: after.designType,
        category: after.category,
        subCategory: after.subCategory,
        oldRate: before.rate,
        newRate: after.rate,
        changedByName: changedByName ?? null,
      },
    });
  }

  async remove(id: number): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.design.delete({ where: { id } });
  }

  /** Stable export/import column order — also used as the empty-export template. */
  exportHeaders(): string[] {
    return ['ID', 'CODE', 'CATEGORY', 'SUB CATEGORY', 'DESIGN TYPE', 'COST', 'RATE'];
  }

  async exportRows(query: DesignQueryDto): Promise<Record<string, unknown>[]> {
    const { items } = await this.findMany({ ...query, page: 1, pageSize: 100_000 } as DesignQueryDto);
    return items.map((r) => ({
      ID: r.id,
      CODE: r.code ?? this.codeFor(r.id),
      CATEGORY: r.category,
      'SUB CATEGORY': r.subCategory,
      'DESIGN TYPE': r.designType,
      COST: r.cost ?? '',
      RATE: r.rate ?? '',
    }));
  }

  async importRows(
    dto: ImportDesignsDto,
  ): Promise<{ total: number; created: number; updated: number; errors: string[] }> {
    const result = { total: dto.rows.length, created: 0, updated: 0, errors: [] as string[] };
    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      try {
        const category = uc(row['CATEGORY']);
        const subCategory = uc(row['SUB CATEGORY']);
        const designType = uc(row['DESIGN TYPE']);
        if (!category || !subCategory || !designType) {
          result.errors.push(`Row ${i + 2}: CATEGORY, SUB CATEGORY and DESIGN TYPE required — skipped.`);
          continue;
        }
        const data = { category, subCategory, designType, cost: toNum(row['COST']), rate: toNum(row['RATE']) };
        // Match an existing design so the update keeps its id — and therefore every
        // combination link (and its code) — intact. Prefer the stable ID/CODE from an
        // exported sheet, then fall back to the category + sub + type identity.
        const id = toNum(row['ID']);
        const code = uc(row['CODE']);
        let existing = id != null ? await this.prisma.design.findUnique({ where: { id } }) : null;
        if (!existing && code) existing = await this.prisma.design.findUnique({ where: { code } });
        if (!existing) {
          existing = await this.prisma.design.findFirst({ where: { category, subCategory, designType } });
        }
        if (existing) {
          const updated = await this.prisma.design.update({ where: { id: existing.id }, data });
          await this.logRateChange(existing, updated, 'Import');
          result.updated++;
        } else {
          const created = await this.prisma.design.create({ data });
          await this.ensureCode(created);
          result.created++;
        }
      } catch (err) {
        result.errors.push(`Row ${i + 2}: ${(err as Error).message}`);
      }
    }
    return result;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private toData(dto: CreateDesignDto | UpdateDesignDto): Prisma.DesignUncheckedCreateInput {
    return {
      category: (uc(dto.category) ?? '') as string,
      subCategory: (uc(dto.subCategory) ?? '') as string,
      designType: (uc(dto.designType) ?? '') as string,
      cost: dto.cost ?? null,
      rate: dto.rate ?? null,
    };
  }

  private codeFor(id: number): string {
    return `DSG-${String(id).padStart(5, '0')}`;
  }

  private async ensureCode(row: Row): Promise<Row> {
    if (row.code) return row;
    return this.prisma.design.update({ where: { id: row.id }, data: { code: this.codeFor(row.id) } });
  }

  private async ensureExists(id: number): Promise<void> {
    const c = await this.prisma.design.count({ where: { id } });
    if (!c) throw new NotFoundException('Design not found.');
  }

  private conflictOr(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('A design with this category, sub-category and design type already exists.');
    }
    return err;
  }

  private toDto(r: Row): DesignDto {
    return {
      id: r.id,
      code: r.code ?? this.codeFor(r.id),
      category: r.category,
      subCategory: r.subCategory,
      designType: r.designType,
      cost: r.cost,
      rate: r.rate,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
