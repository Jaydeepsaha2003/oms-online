import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type DrCr, type NewPartyOpeningDto, type OpeningBalanceDto, type Paginated } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOpeningBalanceDto, OpeningBalanceQueryDto, UpdateOpeningBalanceDto } from './dto/opening-balance.dto';

type Row = Prisma.AcctOpeningTransGetPayload<object>;

/** Parties created in OMS within this many days count as new. */
const NEW_PARTY_DAYS = 30;

function parseDate(s: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Transaction date is not valid.');
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class OpeningBalancesService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(q: OpeningBalanceQueryDto): Promise<Paginated<OpeningBalanceDto>> {
    const search = q.search?.trim();
    const where: Prisma.AcctOpeningTransWhereInput = {
      kind: 'OPENING',
      ...(q.drCr ? { drCr: q.drCr } : {}),
      ...(search ? { customerName: { contains: search } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.acctOpeningTrans.findMany({ where, orderBy: [{ transDate: 'desc' }, { id: 'desc' }], skip: q.skip, take: q.pageSize }),
      this.prisma.acctOpeningTrans.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  async findOne(id: number): Promise<OpeningBalanceDto> {
    const row = await this.getOpening(id);
    return this.toDto(row);
  }

  async create(dto: CreateOpeningBalanceDto, userName?: string | null): Promise<OpeningBalanceDto> {
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId }, select: { partyName: true } });
    if (!customer) throw new NotFoundException('Customer not found.');
    const bankAmt = dto.bankAmt ?? 0;
    const cashAmt = dto.cashAmt ?? 0;
    if (bankAmt <= 0 && cashAmt <= 0) throw new BadRequestException('Enter a bank and/or cash opening amount.');

    const row = await this.prisma.acctOpeningTrans.create({
      data: {
        kind: 'OPENING',
        custId: dto.customerId,
        customerName: customer.partyName ?? `#${dto.customerId}`,
        transDate: parseDate(dto.transDate),
        bankAmt,
        cashAmt,
        drCr: dto.drCr,
        remarks: dto.remarks?.trim() || null,
        userName: userName ?? null,
      },
    });
    await this.prisma.customerAddition.updateMany({ where: { customerId: dto.customerId }, data: { openingSettled: true } });
    return this.toDto(row);
  }

  /** Parties added from Tally, or created in OMS recently, that have no opening balance yet. */
  async newParties(): Promise<NewPartyOpeningDto[]> {
    const since = new Date(Date.now() - NEW_PARTY_DAYS * 86_400_000);
    const [withOpening, fromTally, recent] = await Promise.all([
      this.prisma.acctOpeningTrans.findMany({ where: { kind: 'OPENING' }, select: { custId: true }, distinct: ['custId'] }),
      this.prisma.customerAddition.findMany({ where: { status: 'ADDED', openingSettled: false, customerId: { not: null } } }),
      this.prisma.customer.findMany({ where: { createdAt: { gte: since }, partyName: { not: null } }, select: { id: true, partyName: true, createdAt: true } }),
    ]);
    const has = new Set(withOpening.map((o) => o.custId));
    const tallyIds = fromTally.map((a) => a.customerId!).filter((id) => !has.has(id));
    const tallyCust = await this.prisma.customer.findMany({ where: { id: { in: tallyIds } }, select: { id: true, partyName: true, createdAt: true } });
    const byId = new Map(tallyCust.map((c) => [c.id, c]));
    const out: NewPartyOpeningDto[] = [];
    for (const a of fromTally) {
      const c = byId.get(a.customerId!);
      if (!c) continue;
      out.push({
        customerId: c.id,
        name: c.partyName ?? `#${c.id}`,
        source: 'TALLY',
        createdAt: c.createdAt.toISOString(),
        additionId: a.id,
        tallyOpening: a.tallyOpening,
        openingDate: a.balanceFrom?.toISOString() ?? null,
      });
    }
    const listed = new Set(out.map((o) => o.customerId));
    const settled = new Set(
      (await this.prisma.customerAddition.findMany({ where: { openingSettled: true, customerId: { not: null } }, select: { customerId: true } })).map((a) => a.customerId),
    );
    for (const c of recent) {
      if (has.has(c.id) || listed.has(c.id) || settled.has(c.id)) continue;
      out.push({ customerId: c.id, name: c.partyName!, source: 'OMS', createdAt: c.createdAt.toISOString(), additionId: null, tallyOpening: null, openingDate: null });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** "No opening needed" — hides a party from the new-parties panel. */
  async settle(customerId: number, userName?: string | null): Promise<void> {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { partyName: true } });
    if (!c) throw new NotFoundException('Customer not found.');
    const { count } = await this.prisma.customerAddition.updateMany({ where: { customerId }, data: { openingSettled: true } });
    if (!count) {
      await this.prisma.customerAddition.create({
        data: { tallyName: `OMS#${customerId}`, groupName: '', status: 'ADDED', customerId, openingSettled: true, createdBy: userName ?? null, addedAt: new Date() },
      });
    }
  }

  async update(id: number, dto: UpdateOpeningBalanceDto): Promise<OpeningBalanceDto> {
    await this.getOpening(id);
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId }, select: { partyName: true } });
    if (!customer) throw new NotFoundException('Customer not found.');
    const bankAmt = dto.bankAmt ?? 0;
    const cashAmt = dto.cashAmt ?? 0;
    if (bankAmt <= 0 && cashAmt <= 0) throw new BadRequestException('Enter a bank and/or cash opening amount.');

    const row = await this.prisma.acctOpeningTrans.update({
      where: { id },
      data: {
        custId: dto.customerId,
        customerName: customer.partyName ?? `#${dto.customerId}`,
        transDate: parseDate(dto.transDate),
        bankAmt,
        cashAmt,
        drCr: dto.drCr,
        remarks: dto.remarks?.trim() || null,
      },
    });
    return this.toDto(row);
  }

  async remove(id: number): Promise<void> {
    await this.getOpening(id);
    await this.prisma.acctOpeningTrans.delete({ where: { id } });
  }

  /** Load a row and ensure it is an OPENING entry (not a payment CLEARANCE). */
  private async getOpening(id: number): Promise<Row> {
    const row = await this.prisma.acctOpeningTrans.findUnique({ where: { id } });
    if (!row || row.kind !== 'OPENING') throw new NotFoundException('Opening balance not found.');
    return row;
  }

  private toDto(r: Row): OpeningBalanceDto {
    return {
      id: r.id,
      customerId: r.custId,
      customerName: r.customerName,
      transDate: r.transDate.toISOString(),
      bankAmt: r.bankAmt,
      cashAmt: r.cashAmt,
      drCr: (r.drCr as DrCr) ?? 'DEBIT',
      remarks: r.remarks,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
