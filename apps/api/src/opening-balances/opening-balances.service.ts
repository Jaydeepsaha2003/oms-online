import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type DrCr, type OpeningBalanceDto, type Paginated } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOpeningBalanceDto, OpeningBalanceQueryDto, UpdateOpeningBalanceDto } from './dto/opening-balance.dto';

type Row = Prisma.AcctOpeningTransGetPayload<object>;

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
    return this.toDto(row);
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
