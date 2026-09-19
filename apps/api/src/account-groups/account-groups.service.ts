import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_LEDGER_GROUP, type AccountGroupDto, type GroupAllocMethod, type GroupLedgerDto } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountGroupDto, MoveLedgersDto, UpdateAccountGroupDto } from './account-groups.dto';

const INCLUDE = {
  parent: { select: { name: true } },
  _count: { select: { customers: true } },
} satisfies Prisma.AccountGroupInclude;
type Row = Prisma.AccountGroupGetPayload<{ include: typeof INCLUDE }>;

const clean = (s?: string | null) => (s ?? '').trim().replace(/\s+/g, ' ') || null;

@Injectable()
export class AccountGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<AccountGroupDto[]> {
    const rows = await this.prisma.accountGroup.findMany({ include: INCLUDE, orderBy: { name: 'asc' } });
    return rows.map((r) => this.toDto(r));
  }

  async create(dto: CreateAccountGroupDto): Promise<AccountGroupDto> {
    const name = clean(dto.name);
    if (!name) throw new BadRequestException('Group name is required.');
    if (dto.parentId != null) await this.ensureExists(dto.parentId);
    try {
      const row = await this.prisma.accountGroup.create({
        data: {
          name,
          alias: clean(dto.alias),
          parentId: dto.parentId ?? null,
          isSubLedger: dto.isSubLedger ?? false,
          nettBalances: dto.nettBalances ?? false,
          usedForCalc: dto.usedForCalc ?? false,
          allocMethod: dto.allocMethod ?? 'NOT_APPLICABLE',
        },
        include: INCLUDE,
      });
      return this.toDto(row);
    } catch (err) {
      throw this.dupe(err);
    }
  }

  async update(id: number, dto: UpdateAccountGroupDto): Promise<AccountGroupDto> {
    await this.ensureExists(id);
    if (dto.parentId != null) await this.assertNoCycle(id, dto.parentId);
    const name = dto.name !== undefined ? clean(dto.name) : undefined;
    if (name === null) throw new BadRequestException('Group name is required.');
    try {
      const row = await this.prisma.accountGroup.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(dto.alias !== undefined ? { alias: clean(dto.alias) } : {}),
          ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
          ...(dto.isSubLedger !== undefined ? { isSubLedger: dto.isSubLedger } : {}),
          ...(dto.nettBalances !== undefined ? { nettBalances: dto.nettBalances } : {}),
          ...(dto.usedForCalc !== undefined ? { usedForCalc: dto.usedForCalc } : {}),
          ...(dto.allocMethod !== undefined ? { allocMethod: dto.allocMethod } : {}),
        },
        include: INCLUDE,
      });
      return this.toDto(row);
    } catch (err) {
      throw this.dupe(err);
    }
  }

  async remove(id: number): Promise<void> {
    const g = await this.prisma.accountGroup.findUnique({ where: { id }, include: { _count: { select: { customers: true, children: true } } } });
    if (!g) throw new NotFoundException('Group not found.');
    if (g.isSystem) throw new BadRequestException(`"${g.name}" is a Tally group and cannot be deleted.`);
    if (g._count.customers) throw new BadRequestException(`${g._count.customers} ledger(s) are under "${g.name}". Move them first.`);
    if (g._count.children) throw new BadRequestException(`"${g.name}" has sub-groups. Move or delete them first.`);
    await this.prisma.accountGroup.delete({ where: { id } });
  }

  async ledgers(): Promise<GroupLedgerDto[]> {
    const rows = await this.prisma.customer.findMany({
      where: { partyName: { not: null } },
      select: { id: true, partyName: true, category: true, active: true, groupId: true },
      orderBy: { partyName: 'asc' },
    });
    return rows.map((r) => ({ ...r, partyName: r.partyName! }));
  }

  async moveLedgers(dto: MoveLedgersDto): Promise<{ updated: number }> {
    await this.ensureExists(dto.groupId);
    const { count } = await this.prisma.customer.updateMany({ where: { id: { in: dto.customerIds } }, data: { groupId: dto.groupId } });
    return { updated: count };
  }

  /** Id of the group new customers go under by default. */
  async defaultGroupId(): Promise<number | null> {
    const g = await this.prisma.accountGroup.findUnique({ where: { name: DEFAULT_LEDGER_GROUP }, select: { id: true } });
    return g?.id ?? null;
  }

  private async ensureExists(id: number): Promise<void> {
    if (!(await this.prisma.accountGroup.count({ where: { id } }))) throw new NotFoundException('Group not found.');
  }

  /** A group cannot sit under itself or any of its own sub-groups. */
  private async assertNoCycle(id: number, parentId: number): Promise<void> {
    await this.ensureExists(parentId);
    const all = await this.prisma.accountGroup.findMany({ select: { id: true, parentId: true } });
    const parentOf = new Map(all.map((g) => [g.id, g.parentId]));
    for (let p: number | null | undefined = parentId; p != null; p = parentOf.get(p)) {
      if (p === id) throw new BadRequestException('A group cannot be under itself or one of its sub-groups.');
    }
  }

  private dupe(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('A group with this name already exists.');
    }
    return err;
  }

  private toDto(r: Row): AccountGroupDto {
    return {
      id: r.id,
      name: r.name,
      alias: r.alias,
      parentId: r.parentId,
      parentName: r.parent?.name ?? null,
      isSubLedger: r.isSubLedger,
      nettBalances: r.nettBalances,
      usedForCalc: r.usedForCalc,
      allocMethod: r.allocMethod as GroupAllocMethod,
      isSystem: r.isSystem,
      ledgerCount: r._count.customers,
    };
  }
}
