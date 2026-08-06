import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ACTIONS, DEFAULT_ORDER_QTY_LAYOUT, normalizeQtyOrder, RESOURCES, resolveLineDesign, type ChallanTermsDto, type CompanyProfileDto, type DesignTrackTypesDto, type DispatchBagThresholdDto, type OrderFooterDto, type OrderOptionDto, type OrderQtyLayout, type OrderTermsDto, type TcsSettingDto } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { uc } from '../common/coerce';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { CreateOrderOptionDto } from './dto/order-option.dto';
import { UpdateCompanyDto } from './dto/company.dto';
import { UpdateOrderTermsDto } from './dto/order-terms.dto';
import { UpdateOrderFooterDto } from './dto/order-footer.dto';
import { UpdateChallanTermsDto } from './dto/challan-terms.dto';
import { UpdateTcsSettingDto } from './dto/tcs-setting.dto';
import { UpdateDispatchBagThresholdDto } from './dto/dispatch-bag-threshold.dto';
import { UpdateDesignTrackTypesDto } from './dto/design-track-types.dto';

type Row = Prisma.OrderOptionGetPayload<object>;

const COMPANY_NAME = 'COMPANY_NAME';
const COMPANY_LOGO = 'COMPANY_LOGO';
const ORDER_TERMS = 'ORDER_TERMS';
const ORDER_FOOTER = 'ORDER_FOOTER';
const CHALLAN_TERMS = 'CHALLAN_TERMS';
const ORDER_QTY_LAYOUT = 'ORDER_QTY_LAYOUT';
const TCS_PERCENT = 'TCS_PERCENT';
const DESIGN_TRACK_TYPES = 'DESIGN_TRACK_TYPES';
const DISPATCH_BAG_THRESHOLD = 'DISPATCH_BAG_THRESHOLD';
// Matches the legacy Form14 rate, kept until the business saves its own %.
const DEFAULT_TCS_PERCENT = 1;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  /* ── SCRAP challans' TCS % ────────────────────────────────────────────────
   * Global, editable rate applied instead of TDS on SCRAP-category challans.
   * Changes are recorded manually (not via the generic @Audit interceptor) so
   * the entry states the actual old → new % rather than a generic "Updated". */

  async getTcsPercent(): Promise<TcsSettingDto> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: TCS_PERCENT } });
    const parsed = row?.value != null ? Number(row.value) : NaN;
    return { tcsPercent: Number.isFinite(parsed) ? parsed : DEFAULT_TCS_PERCENT };
  }

  async updateTcsPercent(dto: UpdateTcsSettingDto, actor?: AuthenticatedUser): Promise<TcsSettingDto> {
    const before = await this.getTcsPercent();
    const tcsPercent = dto.tcsPercent;
    await this.prisma.appConfig.upsert({
      where: { key: TCS_PERCENT },
      update: { value: String(tcsPercent) },
      create: { key: TCS_PERCENT, value: String(tcsPercent) },
    });
    void this.audit.record({
      userId: actor?.id ?? null,
      userEmail: actor?.email ?? null,
      action: ACTIONS.UPDATE,
      resource: RESOURCES.SETTING,
      resourceId: TCS_PERCENT,
      description: `Changed SCRAP TCS rate from ${before.tcsPercent}% to ${tcsPercent}%`,
      statusCode: 200,
      metadata: { before: before.tcsPercent, after: tcsPercent },
    });
    return { tcsPercent };
  }

  /* ── Default dispatch bag threshold (global fallback) ─────────────────────
   * Used when a party has no bag threshold of its own set in Special Rates.
   * Enforced against non-admins (no dispatch:override) in DispatchService. */

  async getDispatchBagThreshold(): Promise<DispatchBagThresholdDto> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: DISPATCH_BAG_THRESHOLD } });
    const parsed = row?.value != null ? Number(row.value) : NaN;
    return { maxBagsPerDispatch: Number.isFinite(parsed) ? parsed : null };
  }

  async updateDispatchBagThreshold(dto: UpdateDispatchBagThresholdDto, actor?: AuthenticatedUser): Promise<DispatchBagThresholdDto> {
    const before = await this.getDispatchBagThreshold();
    const maxBagsPerDispatch = dto.maxBagsPerDispatch;
    if (maxBagsPerDispatch == null) {
      await this.prisma.appConfig.deleteMany({ where: { key: DISPATCH_BAG_THRESHOLD } });
    } else {
      await this.prisma.appConfig.upsert({
        where: { key: DISPATCH_BAG_THRESHOLD },
        update: { value: String(maxBagsPerDispatch) },
        create: { key: DISPATCH_BAG_THRESHOLD, value: String(maxBagsPerDispatch) },
      });
    }
    void this.audit.record({
      userId: actor?.id ?? null,
      userEmail: actor?.email ?? null,
      action: ACTIONS.UPDATE,
      resource: RESOURCES.SETTING,
      resourceId: DISPATCH_BAG_THRESHOLD,
      description: `Changed default dispatch bag threshold from ${before.maxBagsPerDispatch ?? 'none'} to ${maxBagsPerDispatch ?? 'none'}`,
      statusCode: 200,
      metadata: { before: before.maxBagsPerDispatch, after: maxBagsPerDispatch },
    });
    return { maxBagsPerDispatch };
  }

  /* ── Design Track: which design types the grid may show ───────────────────
   * `available` is every DISTINCT design type currently sitting on an order line
   * — deduplicated, so a design used by 200 lines is offered once. Combination
   * names ("WL+LOGO") are real design types in this data and are listed as they
   * are; the "NA"-family placeholders are not designs and are excluded. */

  async getDesignTrackTypes(): Promise<DesignTrackTypesDto> {
    const [row, lines] = await Promise.all([
      this.prisma.appConfig.findUnique({ where: { key: DESIGN_TRACK_TYPES } }),
      this.prisma.orderItem.findMany({ select: { design: true, designType: true } }),
    ]);

    const available = [...new Set(lines.map(resolveLineDesign).filter((d): d is string => !!d))].sort((a, b) =>
      a.localeCompare(b),
    );

    let selected: string[] = [];
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed)) selected = parsed.map((t) => String(t));
      } catch {
        /* fall through to nothing selected */
      }
    }
    return { selected, available };
  }

  async updateDesignTrackTypes(dto: UpdateDesignTrackTypesDto): Promise<DesignTrackTypesDto> {
    // Store upper-cased and deduplicated — the grid matches case-insensitively,
    // so keeping two casings of one design would be a silent no-op difference.
    const selected = [...new Set(dto.selected.map((t) => t.trim().toUpperCase()).filter(Boolean))].sort();
    const value = JSON.stringify(selected);
    await this.prisma.appConfig.upsert({
      where: { key: DESIGN_TRACK_TYPES },
      update: { value },
      create: { key: DESIGN_TRACK_TYPES, value },
    });
    return this.getDesignTrackTypes();
  }

  /* ── Order quantity-field layout (per-category Bags/Pcs/Kgs/Box order) ────── */

  async getOrderQtyLayout(): Promise<OrderQtyLayout> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: ORDER_QTY_LAYOUT } });
    if (!row?.value) return { ...DEFAULT_ORDER_QTY_LAYOUT };
    try {
      return this.sanitizeLayout(JSON.parse(row.value));
    } catch {
      return { ...DEFAULT_ORDER_QTY_LAYOUT };
    }
  }

  async updateOrderQtyLayout(dto: OrderQtyLayout): Promise<OrderQtyLayout> {
    const clean = this.sanitizeLayout(dto);
    await this.prisma.appConfig.upsert({ where: { key: ORDER_QTY_LAYOUT }, update: { value: JSON.stringify(clean) }, create: { key: ORDER_QTY_LAYOUT, value: JSON.stringify(clean) } });
    return clean;
  }

  /** Coerce any stored/posted layout into a well-formed one: each list holds
   *  exactly the four fields, category keys are upper-cased, and only categories
   *  that actually differ from the default are kept. */
  private sanitizeLayout(raw: Partial<OrderQtyLayout> | null | undefined): OrderQtyLayout {
    const def = normalizeQtyOrder(raw?.default);
    const byCategory: OrderQtyLayout['byCategory'] = {};
    for (const [cat, order] of Object.entries(raw?.byCategory ?? {})) {
      const key = cat.trim().toUpperCase();
      if (!key) continue;
      const norm = normalizeQtyOrder(order);
      if (norm.join(',') !== def.join(',')) byCategory[key] = norm; // drop no-op overrides
    }
    return { default: def, byCategory };
  }
}
