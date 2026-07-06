import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type BankAccountDto, type Paginated, bankAccountDisplay } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BankAccountQueryDto, CreateBankAccountDto, UpdateBankAccountDto } from './dto/bank-account.dto';

type Row = Prisma.BankAccountGetPayload<object>;

@Injectable()
export class BankAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: BankAccountQueryDto): Promise<Paginated<BankAccountDto>> {
    const search = query.search?.trim();
    const where: Prisma.BankAccountWhereInput = {
      ...(query.activeOnly ? { isActive: true } : {}),
      ...(search
        ? { OR: [{ bankName: { contains: search } }, { acNo: { contains: search } }, { branch: { contains: search } }, { ifsc: { contains: search } }] }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.bankAccount.findMany({ where, orderBy: [{ isActive: 'desc' }, { bankName: 'asc' }], skip: query.skip, take: query.pageSize }),
      this.prisma.bankAccount.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /** All active accounts (unpaginated) for the cheque form's deposit-bank picker. */
  async active(): Promise<BankAccountDto[]> {
    const rows = await this.prisma.bankAccount.findMany({ where: { isActive: true }, orderBy: { bankName: 'asc' } });
    return rows.map((r) => this.toDto(r));
  }

  async findOne(id: number): Promise<BankAccountDto> {
    const row = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Bank account not found.');
    return this.toDto(row);
  }

  async create(dto: CreateBankAccountDto): Promise<BankAccountDto> {
    try {
      const row = await this.prisma.bankAccount.create({ data: this.toData(dto) });
      return this.toDto(row);
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async update(id: number, dto: UpdateBankAccountDto): Promise<BankAccountDto> {
    await this.ensureExists(id);
    try {
      const row = await this.prisma.bankAccount.update({ where: { id }, data: this.toData(dto) });
      return this.toDto(row);
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async remove(id: number): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.bankAccount.delete({ where: { id } });
  }

  private async ensureExists(id: number): Promise<void> {
    if (!(await this.prisma.bankAccount.count({ where: { id } }))) throw new NotFoundException('Bank account not found.');
  }

  private toData(dto: CreateBankAccountDto | UpdateBankAccountDto): Prisma.BankAccountUncheckedCreateInput {
    return {
      bankName: dto.bankName.trim().toUpperCase(),
      acNo: dto.acNo.trim(),
      ifsc: dto.ifsc?.trim().toUpperCase() || null,
      branch: dto.branch?.trim().toUpperCase() || null,
      isActive: dto.isActive ?? true,
    };
  }

  private mapError(e: unknown): Error {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException('A bank account with this name and account number already exists.');
    }
    return e as Error;
  }

  private toDto(r: Row): BankAccountDto {
    return {
      id: r.id,
      bankName: r.bankName,
      acNo: r.acNo,
      ifsc: r.ifsc,
      branch: r.branch,
      isActive: r.isActive,
      display: bankAccountDisplay(r.bankName, r.acNo),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
