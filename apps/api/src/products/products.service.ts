import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Paginated, type ProductDto, type ProductLookups } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toNum, uc } from '../common/coerce';
import { CreateProductDto, ImportProductsDto, ProductQueryDto, UpdateProductDto } from './dto/product.dto';

type Row = Prisma.ProductGetPayload<object>;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: ProductQueryDto): Promise<Paginated<ProductDto>> {
    const search = query.search?.trim();
    const where: Prisma.ProductWhereInput = search
      ? {
          OR: [
            { category: { contains: search } },
            { subCategory: { contains: search } },
            { product: { contains: search } },
          ],
        }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: [{ product: 'asc' }],
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOne(id: number): Promise<ProductDto> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Product not found.');
    return this.toDto(row);
  }

  /** Distinct existing categories & sub-categories for the form's dropdowns. */
  async lookups(): Promise<ProductLookups> {
    const [cats, subs] = await Promise.all([
      this.prisma.product.findMany({
        where: { category: { not: '' } },
        select: { category: true },
        distinct: ['category'],
        orderBy: { category: 'asc' },
      }),
      this.prisma.product.findMany({
        where: { subCategory: { not: '' } },
        select: { subCategory: true },
        distinct: ['subCategory'],
        orderBy: { subCategory: 'asc' },
      }),
    ]);
    return {
      categories: cats.map((c) => c.category).filter(Boolean),
      subCategories: subs.map((s) => s.subCategory).filter(Boolean),
    };
  }

  async create(dto: CreateProductDto): Promise<ProductDto> {
    try {
      const row = await this.prisma.product.create({ data: this.toData(dto) });
      return this.toDto(await this.ensureCode(row));
    } catch (err) {
      throw this.conflictOr(err);
    }
  }

  async update(id: number, dto: UpdateProductDto): Promise<ProductDto> {
    await this.ensureExists(id);
    try {
      const row = await this.prisma.product.update({ where: { id }, data: this.toData(dto) });
      return this.toDto(await this.ensureCode(row));
    } catch (err) {
      throw this.conflictOr(err);
    }
  }

  async remove(id: number): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.product.delete({ where: { id } });
  }

  /** Stable export/import column order — also used as the empty-export template. */
  exportHeaders(): string[] {
    return ['ID', 'CODE', 'CATEGORY', 'SUB CATEGORY', 'PRODUCT', 'SIZE', 'WEIGHT', 'PCS', 'RATE'];
  }

  async exportRows(query: ProductQueryDto): Promise<Record<string, unknown>[]> {
    const { items } = await this.findMany({ ...query, page: 1, pageSize: 100_000 } as ProductQueryDto);
    return items.map((r) => ({
      ID: r.id,
      CODE: r.code ?? this.codeFor(r.id),
      CATEGORY: r.category,
      'SUB CATEGORY': r.subCategory,
      PRODUCT: r.product,
      SIZE: r.size ?? '',
      WEIGHT: r.weight ?? '',
      PCS: r.pcs ?? '',
      RATE: r.rate ?? '',
    }));
  }

  async importRows(
    dto: ImportProductsDto,
  ): Promise<{ total: number; created: number; updated: number; errors: string[] }> {
    const result = { total: dto.rows.length, created: 0, updated: 0, errors: [] as string[] };
    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      try {
        const category = uc(row['CATEGORY']);
        const subCategory = uc(row['SUB CATEGORY']);
        const product = uc(row['PRODUCT']);
        if (!category || !subCategory || !product) {
          result.errors.push(`Row ${i + 2}: CATEGORY, SUB CATEGORY and PRODUCT required — skipped.`);
          continue;
        }
        const data = {
          category,
          subCategory,
          product,
          size: toNum(row['SIZE']),
          weight: toNum(row['WEIGHT']),
          pcs: toNum(row['PCS']),
          rate: toNum(row['RATE']),
        };
        // Identity = category + sub-category + product + size (legacy upsert key).
        const existing = await this.prisma.product.findFirst({
          where: { category, subCategory, product, size: data.size },
        });
        if (existing) {
          await this.prisma.product.update({ where: { id: existing.id }, data });
          result.updated++;
        } else {
          const created = await this.prisma.product.create({ data });
          await this.ensureCode(created);
          result.created++;
        }
      } catch (err) {
        result.errors.push(`Row ${i + 2}: ${(err as Error).message}`);
      }
    }
    return result;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private toData(dto: CreateProductDto | UpdateProductDto): Prisma.ProductUncheckedCreateInput {
    return {
      category: (uc(dto.category) ?? '') as string,
      subCategory: (uc(dto.subCategory) ?? '') as string,
      product: (uc(dto.product) ?? '') as string,
      size: dto.size ?? null,
      weight: dto.weight ?? null,
      pcs: dto.pcs ?? null,
      rate: dto.rate ?? null,
    };
  }

  private codeFor(id: number): string {
    return `PRD-${String(id).padStart(5, '0')}`;
  }

  private async ensureCode(row: Row): Promise<Row> {
    if (row.code) return row;
    return this.prisma.product.update({ where: { id: row.id }, data: { code: this.codeFor(row.id) } });
  }

  private async ensureExists(id: number): Promise<void> {
    const c = await this.prisma.product.count({ where: { id } });
    if (!c) throw new NotFoundException('Product not found.');
  }

  private conflictOr(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('A product with this category, sub-category, product and size already exists.');
    }
    return err;
  }

  private toDto(r: Row): ProductDto {
    return {
      id: r.id,
      code: r.code ?? this.codeFor(r.id),
      category: r.category,
      subCategory: r.subCategory,
      product: r.product,
      size: r.size,
      weight: r.weight,
      pcs: r.pcs,
      rate: r.rate,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
