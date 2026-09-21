import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_LEDGER_GROUP,
  ledgerNameKey,
  suggestCustomers,
  type AccountGroupDto,
  type CustomerAdditionDto,
  type TallyLedgerDetails,
  type GroupAllocMethod,
  type GroupLedgerDto,
  type TallyImportGroup,
  type TallyImportOther,
  type TallyImportParty,
  type TallyImportPreview,
  type TallyImportResult,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AddToListDto, CreateAccountGroupDto, MarkAddedDto, MoveLedgersDto, TallyImportApplyDto, UpdateAccountGroupDto } from './account-groups.dto';
import { parseTallyMaster, type TallyMaster } from './tally-master.parser';

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

  /* ── Tally master import ─────────────────────────────────────────────── */

  async tallyPreview(buf: Buffer, fileName: string): Promise<TallyImportPreview> {
    let master: TallyMaster;
    try {
      master = parseTallyMaster(buf);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const [omsGroups, customers, aliases, balances, queued, savedLedgers] = await Promise.all([
      this.prisma.accountGroup.findMany({ select: { id: true, name: true, parentId: true } }),
      this.prisma.customer.findMany({ where: { partyName: { not: null } }, select: { id: true, partyName: true, active: true, groupId: true }, orderBy: { partyName: 'asc' } }),
      this.prisma.tallyPartyAlias.findMany({ select: { tallyName: true, customerId: true } }),
      this.tallyBalances(),
      this.prisma.customerAddition.findMany({ where: { status: 'PENDING' }, select: { tallyName: true } }),
      this.prisma.tallyLedger.findMany({ select: { name: true, groupName: true } }),
    ]);

    const key = (s: string) => s.trim().toUpperCase();
    const inList = new Set(queued.map((q) => key(q.tallyName)));
    const omsById = new Map(omsGroups.map((g) => [g.id, g]));
    const omsByName = new Map(omsGroups.map((g) => [key(g.name), g]));
    const parentName = new Map<string, string | null>();
    for (const g of omsGroups) parentName.set(key(g.name), g.parentId != null ? (omsById.get(g.parentId)?.name ?? null) : null);
    for (const g of master.groups) parentName.set(key(g.name), g.parent);
    const chain = (group: string) => {
      const out: string[] = [];
      for (let g: string | null = group; g && out.length < 50; g = parentName.get(key(g)) ?? null) out.push(key(g));
      return out;
    };

    const groups: TallyImportGroup[] = master.groups.map((g) => {
      const oms = omsByName.get(key(g.name));
      const omsParent = oms?.parentId != null ? (omsById.get(oms.parentId)?.name ?? null) : null;
      const status = !oms ? 'NEW' : key(omsParent ?? '') === key(g.parent ?? '') ? 'SAME' : 'MOVE';
      return { name: g.name, parent: g.parent, status, omsParent };
    });

    const custIds = new Set(customers.map((c) => c.id));
    const aliasOf = new Map(aliases.filter((a) => custIds.has(a.customerId)).map((a) => [key(a.tallyName), a.customerId]));
    const byNameKey = new Map(customers.map((c) => [ledgerNameKey(c.partyName!), c.id]));
    const idByName = new Map(customers.map((c) => [c.partyName!, c.id]));
    const names = customers.map((c) => c.partyName!);
    const DEBTORS = key(DEFAULT_LEDGER_GROUP);
    const savedLedgerByName = new Map(savedLedgers.map((l) => [key(l.name), l]));

    // OMS parties that already have their own Tally ledger (same name or linked):
    // never auto-picked for a different ledger — only offered as a suggestion.
    const claimed = new Set<number>();
    for (const l of master.ledgers) {
      if (!chain(l.parent ?? 'Primary').includes(DEBTORS)) continue;
      const id = aliasOf.get(key(l.name)) ?? byNameKey.get(ledgerNameKey(l.name));
      if (id != null) claimed.add(id);
    }

    const parties: TallyImportParty[] = [];
    const others: TallyImportOther[] = [];
    for (const l of master.ledgers) {
      const tallyGroup = l.parent ?? 'Primary';
      const up = chain(tallyGroup);
      const linkedTo = aliasOf.get(key(l.name)) ?? null;
      if (up.includes(DEBTORS)) {
        const similar = suggestCustomers(l.name, names);
        const exact = byNameKey.get(ledgerNameKey(l.name));
        const guess = similar.find((s) => s.sure && !claimed.has(idByName.get(s.name)!));
        const match = linkedTo
          ? { customerId: linkedTo, how: 'LINKED' as const }
          : exact
            ? { customerId: exact, how: 'SAME_NAME' as const }
            : guess
              ? { customerId: idByName.get(guess.name)!, how: 'LOOKS_LIKE' as const }
              : null;
        const suggestions = similar.map((s) => idByName.get(s.name)!).filter((id) => id !== match?.customerId);
        const bal = balances?.map.get(key(l.name));
        parties.push({
          tallyName: l.name,
          tallyGroup,
          match,
          suggestions,
          linkedTo,
          tallyOpening: bal?.opening ?? null,
          tallyClosing: bal?.closing ?? null,
          inList: inList.has(key(l.name)),
          previouslySkipped: match == null && savedLedgerByName.has(key(l.name)),
          details: l.details,
        });
      } else {
        const saved = savedLedgerByName.get(key(l.name));
        const status = !saved ? 'NEW' : key(saved.groupName) === key(tallyGroup) ? 'SAVED' : 'MOVE';
        others.push({ tallyName: l.name, tallyGroup, status, savedGroup: saved?.groupName ?? null });
      }
    }

    return {
      fileName,
      balanceFrom: balances?.from.toISOString() ?? null,
      balanceTo: balances?.to.toISOString() ?? null,
      groups,
      parties,
      others,
      customers: customers.map((c) => ({ id: c.id, name: c.partyName!, active: c.active, groupId: c.groupId })),
    };
  }

  async tallyApply(dto: TallyImportApplyDto, userName?: string | null): Promise<TallyImportResult> {
    const key = (s: string) => s.trim().toUpperCase();
    const groupRows = await this.prisma.accountGroup.findMany({ select: { id: true, name: true, parentId: true } });
    const known = new Map(groupRows.map((g) => [key(g.name), g]));
    const incoming = new Map(dto.groups.map((g) => [key(g.name), g]));

    const order: TallyImportApplyDto['groups'] = [];
    const visiting = new Set<string>();
    const visit = (k: string) => {
      const g = incoming.get(k);
      if (!g || order.includes(g)) return;
      if (visiting.has(k)) throw new BadRequestException(`Group "${g.name}" is under itself in the file.`);
      visiting.add(k);
      if (g.parent) visit(key(g.parent));
      order.push(g);
    };
    for (const k of incoming.keys()) visit(k);
    for (const g of order) {
      if (g.parent && !known.has(key(g.parent)) && !incoming.has(key(g.parent))) {
        throw new BadRequestException(`Group "${g.name}" is under "${g.parent}", which is neither in OMS nor ticked in this upload.`);
      }
    }

    const groupFor = new Map<number, string>();
    for (const p of dto.parties) {
      const prev = groupFor.get(p.customerId);
      if (prev && key(prev) !== key(p.groupName)) {
        throw new BadRequestException('Two Tally ledgers point to the same OMS party with different groups. Fix it in the review first.');
      }
      groupFor.set(p.customerId, p.groupName);
      if (!known.has(key(p.groupName)) && !incoming.has(key(p.groupName))) {
        throw new BadRequestException(`Group "${p.groupName}" for "${p.tallyName}" is neither in OMS nor ticked in this upload.`);
      }
    }
    const custIds = [...groupFor.keys()];
    const customers = await this.prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, partyName: true } });
    if (customers.length !== custIds.length) throw new BadRequestException('One of the chosen OMS parties no longer exists. Reload the file.');
    const custName = new Map(customers.map((c) => [c.id, c.partyName ?? '']));

    return this.prisma.$transaction(async (tx) => {
      const res: TallyImportResult = { groupsCreated: 0, groupsMoved: 0, partiesUpdated: 0, linksSaved: 0, ledgersSaved: 0 };
      for (const g of order) {
        const parentId = g.parent ? known.get(key(g.parent))!.id : null;
        const existing = known.get(key(g.name));
        if (existing) {
          if (existing.id === parentId) continue;
          if (existing.parentId !== parentId) {
            await tx.accountGroup.update({ where: { id: existing.id }, data: { parentId } });
            known.set(key(g.name), { ...existing, parentId });
            res.groupsMoved++;
          }
        } else {
          const created = await tx.accountGroup.create({ data: { name: g.name.trim(), parentId }, select: { id: true, name: true, parentId: true } });
          known.set(key(created.name), created);
          res.groupsCreated++;
        }
      }
      const parentOf = new Map([...known.values()].map((g) => [g.id, g.parentId]));
      for (const g of known.values()) {
        let steps = 0;
        for (let p = parentOf.get(g.id); p != null; p = parentOf.get(p)) {
          if (p === g.id || ++steps > 100) throw new BadRequestException(`Group "${g.name}" would end up under itself. Untick that group move.`);
        }
      }
      for (const [customerId, groupName] of groupFor) {
        await tx.customer.update({ where: { id: customerId }, data: { groupId: known.get(key(groupName))!.id } });
        res.partiesUpdated++;
      }
      for (const p of dto.parties) {
        const name = p.tallyName.trim();
        if (ledgerNameKey(name) === ledgerNameKey(custName.get(p.customerId) ?? '')) {
          await tx.tallyPartyAlias.deleteMany({ where: { tallyName: name, customerId: { not: p.customerId } } });
        } else {
          await tx.tallyPartyAlias.upsert({
            where: { tallyName: name },
            create: { tallyName: name, customerId: p.customerId, createdBy: userName ?? null },
            update: { customerId: p.customerId, createdBy: userName ?? null },
          });
          res.linksSaved++;
        }
      }
      for (const o of dto.ledgers) {
        const name = o.name.trim();
        const groupName = o.group.trim();
        await tx.tallyLedger.upsert({ where: { name }, create: { name, groupName }, update: { groupName } });
        res.ledgersSaved++;
      }
      return res;
    });
  }

  /* ── Addition list ───────────────────────────────────────────────────── */

  async additions(status?: string): Promise<CustomerAdditionDto[]> {
    const rows = await this.prisma.customerAddition.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: 'desc' }, { tallyName: 'asc' }],
    });
    return rows.map((r) => this.additionDto(r));
  }

  async addition(id: number): Promise<CustomerAdditionDto> {
    const r = await this.prisma.customerAddition.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('That party is no longer in the addition list.');
    return this.additionDto(r);
  }

  async addToList(dto: AddToListDto, userName?: string | null): Promise<CustomerAdditionDto[]> {
    const balances = await this.tallyBalances();
    const key = (s: string) => s.trim().toUpperCase();
    for (const item of dto.items) {
      const tallyName = item.tallyName.trim();
      const bal = balances?.map.get(key(tallyName));
      const data = {
        groupName: item.groupName.trim(),
        details: JSON.stringify(item.details ?? {}),
        tallyOpening: bal?.opening ?? null,
        tallyClosing: bal?.closing ?? null,
        balanceFrom: balances?.from ?? null,
        balanceTo: balances?.to ?? null,
      };
      const existing = await this.prisma.customerAddition.findUnique({ where: { tallyName } });
      if (existing?.status === 'ADDED') continue;
      await this.prisma.customerAddition.upsert({
        where: { tallyName },
        create: { tallyName, ...data, createdBy: userName ?? null },
        update: data,
      });
    }
    return this.additions('PENDING');
  }

  async removeFromList(id: number): Promise<void> {
    const r = await this.prisma.customerAddition.findUnique({ where: { id } });
    if (!r) return;
    if (r.status === 'ADDED') throw new BadRequestException('This party is already added to OMS.');
    await this.prisma.customerAddition.delete({ where: { id } });
  }

  /** Called after the New Customer form saves a party from the list. */
  async markAdded(id: number, dto: MarkAddedDto, userName?: string | null): Promise<CustomerAdditionDto> {
    const r = await this.prisma.customerAddition.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('That party is no longer in the addition list.');
    const c = await this.prisma.customer.findUnique({ where: { id: dto.customerId }, select: { id: true, partyName: true } });
    if (!c) throw new BadRequestException('Customer not found.');
    const updated = await this.prisma.$transaction(async (tx) => {
      if (ledgerNameKey(r.tallyName) !== ledgerNameKey(c.partyName ?? '')) {
        await tx.tallyPartyAlias.upsert({
          where: { tallyName: r.tallyName },
          create: { tallyName: r.tallyName, customerId: c.id, createdBy: userName ?? null },
          update: { customerId: c.id, createdBy: userName ?? null },
        });
      }
      return tx.customerAddition.update({ where: { id }, data: { status: 'ADDED', customerId: c.id, addedAt: new Date() } });
    });
    return this.additionDto(updated);
  }

  /** Opening and closing per Tally ledger, from the newest Tally Reconciliation register. */
  private async tallyBalances(): Promise<{ map: Map<string, { opening: number; closing: number }>; from: Date; to: Date } | null> {
    const run = await this.prisma.tallyReconRun.findFirst({ orderBy: { uploadedAt: 'desc' }, select: { id: true, fromDate: true, toDate: true } });
    if (!run) return null;
    const sums = await this.prisma.tallyReconRow.groupBy({
      by: ['ledgerName', 'vchType'],
      where: { runId: run.id, source: 'TALLY' },
      _sum: { dr: true, cr: true },
    });
    const map = new Map<string, { opening: number; closing: number }>();
    for (const s of sums) {
      const k = s.ledgerName.trim().toUpperCase();
      const net = (s._sum.dr ?? 0) - (s._sum.cr ?? 0);
      const cur = map.get(k) ?? { opening: 0, closing: 0 };
      if (s.vchType === 'OPENING') cur.opening += net;
      cur.closing += net;
      map.set(k, cur);
    }
    for (const v of map.values()) {
      v.opening = Math.round(v.opening * 100) / 100;
      v.closing = Math.round(v.closing * 100) / 100;
    }
    return { map, from: run.fromDate, to: run.toDate };
  }

  private additionDto(r: Prisma.CustomerAdditionGetPayload<object>): CustomerAdditionDto {
    let details: TallyLedgerDetails = {};
    try {
      details = r.details ? (JSON.parse(r.details) as TallyLedgerDetails) : {};
    } catch {
      details = {};
    }
    return {
      id: r.id,
      tallyName: r.tallyName,
      groupName: r.groupName,
      details,
      tallyOpening: r.tallyOpening,
      tallyClosing: r.tallyClosing,
      balanceFrom: r.balanceFrom?.toISOString() ?? null,
      balanceTo: r.balanceTo?.toISOString() ?? null,
      status: r.status as CustomerAdditionDto['status'],
      customerId: r.customerId,
      createdAt: r.createdAt.toISOString(),
    };
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
