import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Paginated, type TransporterDto } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toNum, uc } from '../common/coerce';
import {
  CreateTransporterDto,
  ImportTransportersDto,
  TransporterQueryDto,
  UpdateTransporterDto,
} from './dto/transporter.dto';

const INCLUDE = { _count: { select: { customers: true } } } satisfies Prisma.TransporterInclude;
type Row = Prisma.TransporterGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class TransportersService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: TransporterQueryDto): Promise<Paginated<TransporterDto>> {
    const where: Prisma.TransporterWhereInput = query.search
      ? { name: { contains: query.search.trim() } }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transporter.findMany({
        where,
        include: INCLUDE,
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.transporter.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOne(id: number): Promise<TransporterDto> {
    const row = await this.prisma.transporter.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundException('Transporter not found.');
    return this.toDto(row);
  }

  async create(dto: CreateTransporterDto): Promise<TransporterDto> {
    try {
      const row = await this.prisma.transporter.create({
        data: { name: uc(dto.name)!, packing: dto.packing ?? null, freight: dto.freight ?? null },
        include: INCLUDE,
      });
      return this.toDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A transporter with this name already exists.');
      }
      throw err;
    }
  }

  async update(id: number, dto: UpdateTransporterDto): Promise<TransporterDto> {
    await this.ensureExists(id);
    try {
      const row = await this.prisma.transporter.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: uc(dto.name)! } : {}),
          ...(dto.packing !== undefined ? { packing: dto.packing } : {}),
          ...(dto.freight !== undefined ? { freight: dto.freight } : {}),
        },
        include: INCLUDE,
      });
      return this.toDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A transporter with this name already exists.');
      }
      throw err;
    }
  }

  async remove(id: number): Promise<void> {
    await this.ensureExists(id);
    const used = await this.prisma.customer.count({ where: { transporterId: id } });
    if (used > 0) {
      throw new BadRequestException(
        `This transporter is used by ${used} customer(s). Reassign them before deleting.`,
      );
    }
    await this.prisma.transporter.delete({ where: { id } });
  }

  async exportRows(query: TransporterQueryDto): Promise<Record<string, unknown>[]> {
    const where: Prisma.TransporterWhereInput = query.search
      ? { name: { contains: query.search.trim() } }
      : {};
    const rows = await this.prisma.transporter.findMany({ where, orderBy: { name: 'asc' } });
    return rows.map((t) => ({
      TID: t.id,
      'TRANSPORT NAME': t.name,
      PACKING: t.packing ?? '',
      FREIGHT: t.freight ?? '',
    }));
  }

  async importRows(dto: ImportTransportersDto): Promise<{ total: number; created: number; updated: number; errors: string[] }> {
    const result = { total: dto.rows.length, created: 0, updated: 0, errors: [] as string[] };
    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      try {
        const name = uc(row['TRANSPORT NAME'] ?? row['NAME']);
        if (!name) {
          result.errors.push(`Row ${i + 2}: TRANSPORT NAME required — skipped.`);
          continue;
        }
        const data = { packing: toNum(row['PACKING']), freight: toNum(row['FREIGHT']) };
        const existing = await this.prisma.transporter.findUnique({ where: { name } });
        if (existing) {
          await this.prisma.transporter.update({ where: { id: existing.id }, data });
          result.updated++;
        } else {
          await this.prisma.transporter.create({ data: { name, ...data } });
          result.created++;
        }
      } catch (err) {
        result.errors.push(`Row ${i + 2}: ${(err as Error).message}`);
      }
    }
    return result;
  }

  private async ensureExists(id: number): Promise<void> {
    const c = await this.prisma.transporter.count({ where: { id } });
    if (!c) throw new NotFoundException('Transporter not found.');
  }

  private toDto(t: Row): TransporterDto {
    return {
      id: t.id,
      name: t.name,
      packing: t.packing,
      freight: t.freight,
      customerCount: t._count.customers,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }
}
