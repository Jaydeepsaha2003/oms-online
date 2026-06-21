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
    const name = uc(dto.name)!;
    await this.assertNotCustomerName(name);
    try {
      const created = await this.prisma.transporter.create({
        data: { name, packing: dto.packing ?? null, freight: dto.freight ?? null },
        include: INCLUDE,
      });
      return this.toDto(await this.ensureCode(created));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A transporter with this name already exists.');
      }
      throw err;
    }
  }

  async update(id: number, dto: UpdateTransporterDto): Promise<TransporterDto> {
    await this.ensureExists(id);
    if (dto.name !== undefined) await this.assertNotCustomerName(uc(dto.name)!);
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

  /** Stable export/import column order — also used as the empty-export template. */
  exportHeaders(): string[] {
    return ['TID', 'CODE', 'TRANSPORT NAME', 'PACKING', 'FREIGHT'];
  }

  async exportRows(query: TransporterQueryDto): Promise<Record<string, unknown>[]> {
    const where: Prisma.TransporterWhereInput = query.search
      ? { name: { contains: query.search.trim() } }
      : {};
    const rows = await this.prisma.transporter.findMany({ where, orderBy: { name: 'asc' } });
    return rows.map((t) => ({
      TID: t.id,
      CODE: t.code ?? this.codeFor(t.id),
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
        // Customer and transporter names must be distinct.
        if (await this.customerNameExists(name)) {
          result.errors.push(
            `Row ${i + 2}: "${name}" is already a customer name — transporter and customer names must differ. Skipped.`,
          );
          continue;
        }
        // CODE and TID are auto-managed: we match the existing transporter by
        // NAME (reusing its TID) or create a new one. Any CODE/TID columns in the
        // upload are ignored — uploads never need to supply them.
        const data = { packing: toNum(row['PACKING']), freight: toNum(row['FREIGHT']) };
        const existing = await this.prisma.transporter.findUnique({ where: { name } });
        if (existing) {
          await this.prisma.transporter.update({
            where: { id: existing.id },
            data: { ...data, ...(existing.code ? {} : { code: this.codeFor(existing.id) }) },
          });
          result.updated++;
        } else {
          const created = await this.prisma.transporter.create({ data: { name, ...data } });
          await this.prisma.transporter.update({
            where: { id: created.id },
            data: { code: this.codeFor(created.id) },
          });
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

  /**
   * True if a customer already uses this (already-uppercased) name. Customer
   * names are stored as entered, so compare case-insensitively — SQLite has no
   * Prisma `mode: 'insensitive'`, hence the raw UPPER() comparison.
   */
  private async customerNameExists(name: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ n: number | bigint }>>`
      SELECT COUNT(*) AS n FROM customers WHERE UPPER(partyName) = ${name}`;
    return Number(rows[0]?.n ?? 0) > 0;
  }

  private async assertNotCustomerName(name: string): Promise<void> {
    if (await this.customerNameExists(name)) {
      throw new ConflictException(
        'A customer already exists with this name. Customer and transporter names must be different.',
      );
    }
  }

  /** Stable, human-readable code derived from the row id (e.g. TRN-00001). */
  private codeFor(id: number): string {
    return `TRN-${String(id).padStart(5, '0')}`;
  }

  /** Assign the auto-generated code if the row doesn't have one yet. */
  private async ensureCode(row: Row): Promise<Row> {
    if (row.code) return row;
    return this.prisma.transporter.update({
      where: { id: row.id },
      data: { code: this.codeFor(row.id) },
      include: INCLUDE,
    });
  }

  private toDto(t: Row): TransporterDto {
    return {
      id: t.id,
      code: t.code ?? this.codeFor(t.id),
      name: t.name,
      packing: t.packing,
      freight: t.freight,
      customerCount: t._count.customers,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }
}
