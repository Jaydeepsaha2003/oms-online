import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type DesignNameDto, type Paginated } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { uc } from '../common/coerce';
import {
  CreateDesignNameDto,
  DesignNameQueryDto,
  ImportDesignNamesDto,
  UpdateDesignNameDto,
} from './dto/design-name.dto';

type Row = Prisma.DesignNameGetPayload<object>;

@Injectable()
export class DesignNamesService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: DesignNameQueryDto): Promise<Paginated<DesignNameDto>> {
    const search = query.search?.trim();
    const where: Prisma.DesignNameWhereInput = search
      ? { OR: [{ designType: { contains: search } }, { designName: { contains: search } }] }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.designName.findMany({
        where,
        orderBy: [{ designType: 'asc' }, { designName: 'asc' }],
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.designName.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOne(id: number): Promise<DesignNameDto> {
    const row = await this.prisma.designName.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Design name not found.');
    return this.toDto(row);
  }

  async create(dto: CreateDesignNameDto): Promise<DesignNameDto> {
    try {
      const row = await this.prisma.designName.create({
        data: { designType: uc(dto.designType)!, designName: uc(dto.designName)! },
      });
      return this.toDto(row);
    } catch (err) {
      throw this.conflictOr(err);
    }
  }

  async update(id: number, dto: UpdateDesignNameDto): Promise<DesignNameDto> {
    await this.ensureExists(id);
    try {
      const row = await this.prisma.designName.update({
        where: { id },
        data: {
          ...(dto.designType !== undefined ? { designType: uc(dto.designType)! } : {}),
          ...(dto.designName !== undefined ? { designName: uc(dto.designName)! } : {}),
        },
      });
      return this.toDto(row);
    } catch (err) {
      throw this.conflictOr(err);
    }
  }

  async remove(id: number): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.designName.delete({ where: { id } });
  }

  /** Stable export/import column order — also used as the empty-export template. */
  exportHeaders(): string[] {
    return ['ID', 'DESIGN TYPE L', 'DESIGN NAME'];
  }

  async exportRows(query: DesignNameQueryDto): Promise<Record<string, unknown>[]> {
    const where: Prisma.DesignNameWhereInput = query.search
      ? { OR: [{ designType: { contains: query.search.trim() } }, { designName: { contains: query.search.trim() } }] }
      : {};
    const rows = await this.prisma.designName.findMany({ where, orderBy: { designType: 'asc' } });
    return rows.map((r) => ({ ID: r.id, 'DESIGN TYPE L': r.designType, 'DESIGN NAME': r.designName }));
  }

  async importRows(
    dto: ImportDesignNamesDto,
  ): Promise<{ total: number; created: number; updated: number; errors: string[] }> {
    const result = { total: dto.rows.length, created: 0, updated: 0, errors: [] as string[] };
    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      try {
        const designType = uc(row['DESIGN TYPE L'] ?? row['DESIGN TYPE']);
        const designName = uc(row['DESIGN NAME']);
        if (!designType || !designName) {
          result.errors.push(`Row ${i + 2}: DESIGN TYPE L and DESIGN NAME required — skipped.`);
          continue;
        }
        // A code can have many names, so the identity is the (code, name) pair.
        // Existing pair -> already present (no-op); new pair -> create.
        const existing = await this.prisma.designName.findFirst({ where: { designType, designName } });
        if (existing) {
          result.updated++;
        } else {
          await this.prisma.designName.create({ data: { designType, designName } });
          result.created++;
        }
      } catch (err) {
        result.errors.push(`Row ${i + 2}: ${(err as Error).message}`);
      }
    }
    return result;
  }

  private async ensureExists(id: number): Promise<void> {
    const c = await this.prisma.designName.count({ where: { id } });
    if (!c) throw new NotFoundException('Design name not found.');
  }

  private conflictOr(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('That design type + design name pair already exists.');
    }
    return err;
  }

  private toDto(r: Row): DesignNameDto {
    return {
      id: r.id,
      designType: r.designType,
      designName: r.designName,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
