import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type ChequeDto, type ChequeStatus, type ChequeSummary, type Paginated } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ChequeQueryDto, CreateChequeDto, DepositChequeDto, SettleChequeDto, UpdateChequeDto } from './dto/cheque.dto';

type Row = Prisma.ChequeGetPayload<object>;

/** Parse a yyyy-mm-dd (or ISO) string to a midnight Date; throws on invalid. */
function parseDate(s: string, field: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} is not a valid date.`);
  d.setHours(0, 0, 0, 0);
  return d;
}
const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

@Injectable()
export class ChequesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Reads ────────────────────────────────────────────────────────────────

  async findMany(q: ChequeQueryDto): Promise<Paginated<ChequeDto>> {
    const where = this.listWhere(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.cheque.findMany({ where, orderBy: [{ recDate: 'desc' }, { id: 'desc' }], skip: q.skip, take: q.pageSize }),
      this.prisma.cheque.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  /** PENDING cheques, soonest-due first — feeds the "Upcoming Reminder" cards. */
  async reminders(): Promise<ChequeDto[]> {
    const rows = await this.prisma.cheque.findMany({ where: { status: 'PENDING' }, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }] });
    return rows.map((r) => this.toDto(r));
  }

  /** DEPOSITED cheques (for the clear/bounce picker), by cheque no. */
  async deposited(): Promise<ChequeDto[]> {
    const rows = await this.prisma.cheque.findMany({ where: { status: 'DEPOSITED' }, orderBy: [{ chequeNo: 'asc' }] });
    return rows.map((r) => this.toDto(r));
  }

  async findOne(id: number): Promise<ChequeDto> {
    const row = await this.prisma.cheque.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Cheque not found.');
    return this.toDto(row);
  }

  async summary(): Promise<ChequeSummary> {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const [byStatus, overdue] = await Promise.all([
      this.prisma.cheque.groupBy({ by: ['status'], _count: { _all: true }, _sum: { chequeAmt: true } }),
      this.prisma.cheque.aggregate({ where: { status: 'PENDING', dueDate: { lte: endOfToday } }, _count: { _all: true }, _sum: { chequeAmt: true } }),
    ]);
    const pick = (s: ChequeStatus) => {
      const r = byStatus.find((x) => (x.status ?? '').toUpperCase() === s);
      return { count: r?._count._all ?? 0, amount: r?._sum.chequeAmt ?? 0 };
    };
    return {
      pending: pick('PENDING'),
      deposited: pick('DEPOSITED'),
      cleared: pick('CLEARED'),
      bounced: pick('BOUNCED'),
      overdue: { count: overdue._count._all, amount: overdue._sum.chequeAmt ?? 0 },
    };
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  /** Add a cheque (starts PENDING). */
  async create(dto: CreateChequeDto, userName?: string | null): Promise<ChequeDto> {
    const recDate = parseDate(dto.recDate, 'Receipt date');
    const dueDate = parseDate(dto.dueDate, 'Due date');

    const row = await this.prisma.cheque.create({
      data: {
        customerId: dto.customerId,
        partyName: dto.partyName.trim(),
        chequeNo: dto.chequeNo.trim(),
        chequeAmt: dto.chequeAmt,
        payeeBank: dto.payeeBank?.trim() || null,
        drawerBank: dto.drawerBank.trim(),
        recDate,
        dueDate,
        comments: dto.comments?.trim() || null,
        invoiceNos: dto.invoiceNos?.length ? JSON.stringify(dto.invoiceNos) : null,
        status: 'PENDING',
        userName: userName ?? null,
      },
    });
    return this.toDto(row);
  }

  /** Edit a still-PENDING cheque (deposited/settled cheques are locked). */
  async update(id: number, dto: UpdateChequeDto): Promise<ChequeDto> {
    const existing = await this.prisma.cheque.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Cheque not found.');
    if (existing.status !== 'PENDING') {
      throw new BadRequestException('Only a pending cheque can be edited; deposited/cleared/bounced cheques are locked.');
    }
    const data: Prisma.ChequeUncheckedUpdateInput = {};
    if (dto.partyName !== undefined) data.partyName = dto.partyName.trim();
    if (dto.customerId !== undefined) data.customerId = dto.customerId;
    if (dto.chequeNo !== undefined) data.chequeNo = dto.chequeNo.trim();
    if (dto.chequeAmt !== undefined) data.chequeAmt = dto.chequeAmt;
    if (dto.payeeBank !== undefined) data.payeeBank = dto.payeeBank?.trim() || null;
    if (dto.drawerBank !== undefined) data.drawerBank = dto.drawerBank.trim();
    if (dto.recDate !== undefined) data.recDate = parseDate(dto.recDate, 'Receipt date');
    if (dto.dueDate !== undefined) data.dueDate = parseDate(dto.dueDate, 'Due date');
    if (dto.comments !== undefined) data.comments = dto.comments?.trim() || null;
    if (dto.invoiceNos !== undefined) data.invoiceNos = dto.invoiceNos?.length ? JSON.stringify(dto.invoiceNos) : null;

    const row = await this.prisma.cheque.update({ where: { id }, data });
    return this.toDto(row);
  }

  /**
   * Deposit a cheque. Rules (from the legacy deposit modal):
   *  - only a PENDING cheque can be deposited,
   *  - the deposit date must be on/after the due date.
   */
  async deposit(id: number, dto: DepositChequeDto): Promise<ChequeDto> {
    const cheque = await this.prisma.cheque.findUnique({ where: { id } });
    if (!cheque) throw new NotFoundException('Cheque not found.');
    if (cheque.status !== 'PENDING') throw new BadRequestException('Only a pending cheque can be deposited.');

    const depositDate = parseDate(dto.depositDate, 'Deposit date');
    const dueDate = new Date(cheque.dueDate);
    dueDate.setHours(0, 0, 0, 0);
    if (depositDate.getTime() < dueDate.getTime()) {
      throw new BadRequestException(`You can deposit this cheque only on/after ${fmt(dueDate)}.`);
    }

    const row = await this.prisma.cheque.update({ where: { id }, data: { depositDate, status: 'DEPOSITED' } });
    return this.toDto(row);
  }

  /**
   * Settle a deposited cheque as CLEARED or BOUNCED (legacy bottom panel):
   *  - only a DEPOSITED cheque can be settled,
   *  - CLEARED clears out all bounce fields,
   *  - BOUNCED keeps bounce charges / paid-by / represent (re-deposit) flag.
   */
  async settle(id: number, dto: SettleChequeDto): Promise<ChequeDto> {
    const cheque = await this.prisma.cheque.findUnique({ where: { id } });
    if (!cheque) throw new NotFoundException('Cheque not found.');
    if (cheque.status !== 'DEPOSITED') {
      throw new BadRequestException('Only a deposited cheque can be marked cleared or bounced.');
    }
    const acctTransDate = parseDate(dto.acctTransDate, 'Clear/Bounce date');

    const bounced = dto.status === 'BOUNCED';
    const row = await this.prisma.cheque.update({
      where: { id },
      data: {
        status: dto.status,
        acctTransDate,
        bounceCharges: bounced ? (dto.bounceCharges ?? null) : null,
        chargesPaidBy: bounced ? (dto.chargesPaidBy ?? null) : null,
        isRepresent: bounced ? (dto.isRepresent ?? false) : false,
      },
    });
    return this.toDto(row);
  }

  async remove(id: number): Promise<void> {
    if (!(await this.prisma.cheque.count({ where: { id } }))) throw new NotFoundException('Cheque not found.');
    await this.prisma.cheque.delete({ where: { id } });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private listWhere(q: ChequeQueryDto): Prisma.ChequeWhereInput {
    const and: Prisma.ChequeWhereInput[] = [];
    if (q.status?.trim()) and.push({ status: q.status.trim().toUpperCase() });
    if (q.dateFrom) {
      const from = parseDate(q.dateFrom, 'From date');
      and.push({ recDate: { gte: from } });
    }
    if (q.dateTo) {
      const to = new Date(q.dateTo);
      to.setHours(23, 59, 59, 999);
      and.push({ recDate: { lte: to } });
    }
    const search = q.search?.trim();
    if (search) {
      and.push({
        OR: [
          { chequeNo: { contains: search } },
          { partyName: { contains: search } },
          { payeeBank: { contains: search } },
          { drawerBank: { contains: search } },
        ],
      });
    }
    return and.length ? { AND: and } : {};
  }

  private toDto(r: Row): ChequeDto {
    return {
      id: r.id,
      customerId: r.customerId,
      partyName: r.partyName,
      chequeNo: r.chequeNo,
      chequeAmt: r.chequeAmt,
      payeeBank: r.payeeBank,
      drawerBank: r.drawerBank,
      recDate: r.recDate.toISOString(),
      dueDate: r.dueDate.toISOString(),
      depositDate: r.depositDate ? r.depositDate.toISOString() : null,
      acctTransDate: r.acctTransDate ? r.acctTransDate.toISOString() : null,
      bounceCharges: r.bounceCharges,
      chargesPaidBy: r.chargesPaidBy,
      isRepresent: r.isRepresent,
      comments: r.comments,
      invoiceNos: r.invoiceNos ? (JSON.parse(r.invoiceNos) as string[]) : [],
      status: (r.status as ChequeStatus) ?? 'PENDING',
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
