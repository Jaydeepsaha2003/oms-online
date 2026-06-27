import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type CompanyProfileDto, type OrderOptionDto } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { uc } from '../common/coerce';
import { CreateOrderOptionDto } from './dto/order-option.dto';
import { UpdateCompanyDto } from './dto/company.dto';

type Row = Prisma.OrderOptionGetPayload<object>;

const COMPANY_NAME = 'COMPANY_NAME';
const COMPANY_LOGO = 'COMPANY_LOGO';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<OrderOptionDto[]> {
    const rows = await this.prisma.orderOption.findMany({
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }, { value: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(dto: CreateOrderOptionDto): Promise<OrderOptionDto> {
    const group = uc(dto.group)!;
    const value = uc(dto.value)!;
    const max = await this.prisma.orderOption.aggregate({ where: { group }, _max: { sortOrder: true } });
    try {
      const row = await this.prisma.orderOption.create({
        data: { group, value, sortOrder: (max._max.sortOrder ?? -1) + 1 },
      });
      return this.toDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('That option already exists.');
      }
      throw err;
    }
  }

  async remove(id: number): Promise<void> {
    const count = await this.prisma.orderOption.count({ where: { id } });
    if (!count) throw new NotFoundException('Option not found.');
    await this.prisma.orderOption.delete({ where: { id } });
  }

  private toDto(r: Row): OrderOptionDto {
    return { id: r.id, group: r.group, value: r.value, sortOrder: r.sortOrder };
  }

  /* ── Company branding (for printed documents) ───────────────────────────── */

  async getCompany(): Promise<CompanyProfileDto> {
    const rows = await this.prisma.appConfig.findMany({ where: { key: { in: [COMPANY_NAME, COMPANY_LOGO] } } });
    const by = (k: string) => rows.find((r) => r.key === k)?.value || null;
    return { name: by(COMPANY_NAME), logo: by(COMPANY_LOGO) };
  }

  /** Upsert the provided fields; pass an empty string / null to clear one. */
  async updateCompany(dto: UpdateCompanyDto): Promise<CompanyProfileDto> {
    const setKey = async (key: string, value: string | null | undefined) => {
      if (value === undefined) return; // field not provided → leave as-is
      const v = (value ?? '').trim();
      if (!v) {
        await this.prisma.appConfig.deleteMany({ where: { key } });
      } else {
        await this.prisma.appConfig.upsert({ where: { key }, update: { value: v }, create: { key, value: v } });
      }
    };
    await setKey(COMPANY_NAME, dto.name);
    await setKey(COMPANY_LOGO, dto.logo);
    return this.getCompany();
  }
}
