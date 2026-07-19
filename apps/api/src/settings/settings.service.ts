import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type ChallanTermsDto, type CompanyProfileDto, type OrderFooterDto, type OrderOptionDto, type OrderTermsDto } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { uc } from '../common/coerce';
import { CreateOrderOptionDto } from './dto/order-option.dto';
import { UpdateCompanyDto } from './dto/company.dto';
import { UpdateOrderTermsDto } from './dto/order-terms.dto';
import { UpdateOrderFooterDto } from './dto/order-footer.dto';
import { UpdateChallanTermsDto } from './dto/challan-terms.dto';

type Row = Prisma.OrderOptionGetPayload<object>;

const COMPANY_NAME = 'COMPANY_NAME';
const COMPANY_LOGO = 'COMPANY_LOGO';
const ORDER_TERMS = 'ORDER_TERMS';
const ORDER_FOOTER = 'ORDER_FOOTER';
const CHALLAN_TERMS = 'CHALLAN_TERMS';
// Shown until the business saves their own list from Settings.
const DEFAULT_ORDER_TERMS = [
  'Payment Should Be Made Within 30 Days',
  'If Payment Defaulted 18% Interest Will Be Applicable',
  'Order Cannot Be Cancelled Once Placed/Confirmed',
  'Any Type Of Defect/Design Issue Should Be Reported Within 15 days After Goods Recived.',
];
// "{DOC_TYPE}" is replaced with "SALES ORDER" or "QUOTATION" at print time.
const DEFAULT_ORDER_FOOTER = ['***THIS IS COMPUTER GENRATED {DOC_TYPE}***'];
// Unlike Order Terms, the Challan bill prints no Terms & Conditions until the
// business explicitly adds some from Settings.
const DEFAULT_CHALLAN_TERMS: string[] = [];

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

  /* ── Sales Order / Quotation "Terms & Conditions" ────────────────────────── */

  async getOrderTerms(): Promise<OrderTermsDto> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: ORDER_TERMS } });
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed) && parsed.length) {
          return { terms: parsed.map((t) => String(t)) };
        }
      } catch {
        /* fall through to default */
      }
    }
    return { terms: DEFAULT_ORDER_TERMS };
  }

  async updateOrderTerms(dto: UpdateOrderTermsDto): Promise<OrderTermsDto> {
    const terms = dto.terms.map((t) => t.trim()).filter(Boolean);
    if (!terms.length) throw new BadRequestException('Add at least one term.');
    const value = JSON.stringify(terms);
    await this.prisma.appConfig.upsert({ where: { key: ORDER_TERMS }, update: { value }, create: { key: ORDER_TERMS, value } });
    return { terms };
  }

  /* ── Sales Order / Quotation bill footer ─────────────────────────────────── */

  async getOrderFooter(): Promise<OrderFooterDto> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: ORDER_FOOTER } });
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed) && parsed.length) {
          return { lines: parsed.map((t) => String(t)) };
        }
      } catch {
        /* fall through to default */
      }
    }
    return { lines: DEFAULT_ORDER_FOOTER };
  }

  async updateOrderFooter(dto: UpdateOrderFooterDto): Promise<OrderFooterDto> {
    const lines = dto.lines.map((t) => t.trim()).filter(Boolean);
    if (!lines.length) throw new BadRequestException('Add at least one footer line.');
    const value = JSON.stringify(lines);
    await this.prisma.appConfig.upsert({ where: { key: ORDER_FOOTER }, update: { value }, create: { key: ORDER_FOOTER, value } });
    return { lines };
  }

  /* ── Challan / Tax Invoice "Terms & Conditions" ──────────────────────────── */

  async getChallanTerms(): Promise<ChallanTermsDto> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: CHALLAN_TERMS } });
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed)) return { terms: parsed.map((t) => String(t)) };
      } catch {
        /* fall through to default */
      }
    }
    return { terms: DEFAULT_CHALLAN_TERMS };
  }

  async updateChallanTerms(dto: UpdateChallanTermsDto): Promise<ChallanTermsDto> {
    const terms = dto.terms.map((t) => t.trim()).filter(Boolean);
    const value = JSON.stringify(terms);
    await this.prisma.appConfig.upsert({ where: { key: CHALLAN_TERMS }, update: { value }, create: { key: CHALLAN_TERMS, value } });
    return { terms };
  }
}
