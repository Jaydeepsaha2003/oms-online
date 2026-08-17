import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type AgentDto, type Paginated } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { uc } from '../common/coerce';
import { AgentQueryDto, CreateAgentDto, ImportAgentsDto, UpdateAgentDto } from './dto/agent.dto';

type Row = Prisma.AgentGetPayload<object>;

/**
 * "SELF" is not an agent — it is the sentinel a customer carries when the house
 * sold to them directly, with nobody in between. It shares the `agentName`
 * column with real agent names, which is what makes it look like one.
 *
 * It must never reach the agent master: an agent there is somebody commission
 * gets calculated for and settlements get paid to, and a SELF row invites both
 * against the 98 direct parties that answer to no agent at all. The customer
 * service has always skipped it when auto-creating agents from a party's
 * agentName; this closes the two doors that were left open — the Agents screen
 * and its Excel import.
 */
const SELF_SENTINEL = 'SELF';
const assertNotSelf = (name: string | null | undefined): void => {
  if ((name ?? '').trim().toUpperCase() !== SELF_SENTINEL) return;
  throw new BadRequestException(
    '"SELF" is not an agent — it marks a party the house sells to directly, with no agent involved. ' +
      'Leave those parties on party source SELF; they earn nobody commission.',
  );
};

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: AgentQueryDto): Promise<Paginated<AgentDto>> {
    const where: Prisma.AgentWhereInput = query.search
      ? { name: { contains: query.search.trim() } }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.agent.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.agent.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOne(id: number): Promise<AgentDto> {
    const row = await this.prisma.agent.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Agent not found.');
    return this.toDto(row);
  }

  async create(dto: CreateAgentDto): Promise<AgentDto> {
    assertNotSelf(dto.name);
    try {
      const row = await this.prisma.agent.create({
        data: { name: uc(dto.name)!, contactNo: uc(dto.contactNo), state: uc(dto.state), city: uc(dto.city) },
      });
      return this.toDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An agent with this name already exists.');
      }
      throw err;
    }
  }

  async update(id: number, dto: UpdateAgentDto): Promise<AgentDto> {
    await this.ensureExists(id);
    if (dto.name !== undefined) assertNotSelf(dto.name);
    try {
      const row = await this.prisma.agent.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: uc(dto.name)! } : {}),
          ...(dto.contactNo !== undefined ? { contactNo: uc(dto.contactNo) } : {}),
          ...(dto.state !== undefined ? { state: uc(dto.state) } : {}),
          ...(dto.city !== undefined ? { city: uc(dto.city) } : {}),
        },
      });
      return this.toDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An agent with this name already exists.');
      }
      throw err;
    }
  }

  async remove(id: number): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.agent.delete({ where: { id } });
  }

  /** Stable export/import column order — also used as the empty-export template. */
  exportHeaders(): string[] {
    return ['ID', 'AGENT NAME', 'CONTACT NO', 'STATE', 'CITY'];
  }

  async exportRows(query: AgentQueryDto): Promise<Record<string, unknown>[]> {
    const where: Prisma.AgentWhereInput = query.search
      ? { name: { contains: query.search.trim() } }
      : {};
    const rows = await this.prisma.agent.findMany({ where, orderBy: { name: 'asc' } });
    return rows.map((a) => ({
      ID: a.id,
      'AGENT NAME': a.name,
      'CONTACT NO': a.contactNo ?? '',
      STATE: a.state ?? '',
      CITY: a.city ?? '',
    }));
  }

  async importRows(
    dto: ImportAgentsDto,
  ): Promise<{ total: number; created: number; updated: number; errors: string[] }> {
    const result = { total: dto.rows.length, created: 0, updated: 0, errors: [] as string[] };
    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      try {
        const name = uc(row['AGENT NAME'] ?? row['NAME']);
        if (!name) {
          result.errors.push(`Row ${i + 2}: AGENT NAME required — skipped.`);
          continue;
        }
        if (name === SELF_SENTINEL) {
          // Reported rather than thrown: one bad row must not abandon the rest
          // of the sheet, and an export of the customer master is exactly the
          // kind of file that carries SELF in an agent-name column.
          result.errors.push(`Row ${i + 2}: "SELF" is the no-agent marker, not an agent — skipped.`);
          continue;
        }
        const data = {
          contactNo: uc(row['CONTACT NO']),
          state: uc(row['STATE']),
          city: uc(row['CITY']),
        };
        const existing = await this.prisma.agent.findUnique({ where: { name } });
        if (existing) {
          await this.prisma.agent.update({ where: { id: existing.id }, data });
          result.updated++;
        } else {
          await this.prisma.agent.create({ data: { name, ...data } });
          result.created++;
        }
      } catch (err) {
        result.errors.push(`Row ${i + 2}: ${(err as Error).message}`);
      }
    }
    return result;
  }

  private async ensureExists(id: number): Promise<void> {
    const c = await this.prisma.agent.count({ where: { id } });
    if (!c) throw new NotFoundException('Agent not found.');
  }

  private toDto(a: Row): AgentDto {
    return {
      id: a.id,
      name: a.name,
      contactNo: a.contactNo,
      state: a.state,
      city: a.city,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    };
  }
}
