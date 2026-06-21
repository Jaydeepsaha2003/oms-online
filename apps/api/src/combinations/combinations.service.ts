import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type CombinationDto, type Paginated } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { uc } from '../common/coerce';
import { CombinationQueryDto, CreateCombinationDto, UpdateCombinationDto } from './dto/combination.dto';

const INCLUDE = { designLinks: { include: { design: true } } } as const;
type Row = Prisma.CombinationGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class CombinationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: CombinationQueryDto): Promise<Paginated<CombinationDto>> {
    const search = query.search?.trim();
    const where: Prisma.CombinationWhereInput = search
      ? {
          OR: [
            { name: { contains: search } },
            { designLinks: { some: { design: { designType: { contains: search } } } } },
          ],
        }
      : {};
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

  /** Stable export column order. Cost/Rate are the live sums. */
  exportHeaders(): string[] {
    return ['CODE', 'NAME', 'DESIGNS', 'COST', 'RATE'];
  }

  async exportRows(query: CombinationQueryDto): Promise<Record<string, unknown>[]> {
    const { items } = await this.findMany({ ...query, page: 1, pageSize: 100_000 } as CombinationQueryDto);
    return items.map((c) => ({
      CODE: c.code ?? '',
      NAME: c.name,
      DESIGNS: c.designs.map((d) => d.designType).join(' + '),
      COST: c.cost,
      RATE: c.rate,
    }));
  }

  // ── helpers ────────────────────────────────────────────────────────────────

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
    return {
      id: row.id,
      code: row.code ?? this.codeFor(row.id),
      name: row.name,
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
