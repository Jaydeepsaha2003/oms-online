import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  resolveLineDesignParts,
  type BulkRateChangeResult,
  type BulkRatePreview,
  type CategoryFieldDto,
  type Paginated,
  type PhotoGroupBy,
  type ProductDto,
  type ProductLookups,
  type ProductPhotoDto,
  type ProductPhotoFilterOptions,
  type ProductPhotoGalleryDto,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toNum, uc } from '../common/coerce';
import { readCategoryFields, writeCategoryFields } from '../common/category-fields';
import { loadKnownDesignTypes } from '../common/design-types';
import { BulkRateChangeDto, CreateProductDto, ImportProductsDto, ProductQueryDto, SetProductFlagsDto, UpdateProductDto } from './dto/product.dto';
import { ProductPhotoQueryDto } from './dto/product-photo.dto';

type Row = Prisma.ProductGetPayload<object>;

/**
 * Exactly the columns the gallery captions from — never `include`.
 *
 * `include: { orderItem: { include: { order: true } } }` reads every column of
 * both tables, which couples this screen to columns it has no interest in: it
 * broke outright against a book whose `order_items` predates a pending
 * migration, because Prisma selected a column that did not exist there yet.
 * A narrow select cannot fail that way, and moves a fraction of the bytes.
 */
const PHOTO_SELECT = {
  id: true,
  url: true,
  filename: true,
  mimeType: true,
  size: true,
  uploadedBy: true,
  createdAt: true,
  orderItem: {
    select: {
      id: true,
      product: true,
      productName: true,
      designType: true,
      design: true,
      order: { select: { id: true, code: true, orderDate: true, customerId: true, customerName: true } },
    },
  },
} as const satisfies Prisma.OrderItemPhotoSelect;

type PhotoRow = Prisma.OrderItemPhotoGetPayload<{ select: typeof PHOTO_SELECT }>;

/**
 * How many photo rows one gallery pass will group.
 *
 * Grouping has to see the whole filtered set before it knows where the section
 * boundaries are, so it cannot be pushed into SQL's LIMIT. The book holds a few
 * dozen photos today; the cap exists so that stays true if it ever holds a
 * hundred thousand, and `truncated` tells the user when it bites instead of the
 * screen quietly lying about the total.
 */
const PHOTO_SCAN_CAP = 4000;

/**
 * Local midnight at the start / end of a yyyy-mm-dd day.
 *
 * Built from the parts rather than `new Date(iso)`, which parses a bare date as
 * UTC — in IST that lands at 05:30 on the day itself, so a "from" filter would
 * silently drop everything uploaded that morning.
 */
const dayStart = (iso?: string): Date | undefined => {
  const parts = (iso ?? '').trim().split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return undefined;
  return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
};
const dayEnd = (iso?: string): Date | undefined => {
  const d = dayStart(iso);
  if (d) d.setHours(23, 59, 59, 999);
  return d;
};

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: ProductQueryDto): Promise<Paginated<ProductDto>> {
    const search = query.search?.trim();
    const and: Prisma.ProductWhereInput[] = [];
    if (search) {
      and.push({
        OR: [
          { category: { contains: search } },
          { subCategory: { contains: search } },
          { product: { contains: search } },
        ],
      });
    }
    // Exact-match dropdown filters (Products page).
    if (query.category?.trim()) and.push({ category: query.category.trim() });
    if (query.subCategory?.trim()) and.push({ subCategory: query.subCategory.trim() });
    const where: Prisma.ProductWhereInput = and.length ? { AND: and } : {};
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

  /** Distinct existing categories & (category, sub-category) pairs for the
   *  form's cascading dropdowns — pairs so a chosen category can filter which
   *  sub-categories are offered, instead of showing every sub-category ever seen. */
  async lookups(): Promise<ProductLookups> {
    const [cats, pairs, categoryFields] = await Promise.all([
      this.prisma.product.findMany({
        where: { category: { not: '' } },
        select: { category: true },
        distinct: ['category'],
        orderBy: { category: 'asc' },
      }),
      this.prisma.product.findMany({
        where: { category: { not: '' }, subCategory: { not: '' } },
        select: { category: true, subCategory: true },
        distinct: ['category', 'subCategory'],
        orderBy: [{ category: 'asc' }, { subCategory: 'asc' }],
      }),
      readCategoryFields(this.prisma),
    ]);
    return {
      categories: cats.map((c) => c.category).filter(Boolean),
      subCategories: pairs.map((p) => ({ category: p.category, subCategory: p.subCategory })),
      categoryFields,
    };
  }

  /** Read / replace the per-category price-calc field map. */
  getCategoryFields(): Promise<CategoryFieldDto[]> {
    return readCategoryFields(this.prisma);
  }

  setCategoryFields(fields: { category?: string; field?: string }[]): Promise<CategoryFieldDto[]> {
    return writeCategoryFields(this.prisma, fields ?? []);
  }

  async create(dto: CreateProductDto): Promise<ProductDto> {
    try {
      const row = await this.prisma.product.create({ data: this.toData(dto) });
      return this.toDto(await this.ensureCode(row));
    } catch (err) {
      throw this.conflictOr(err);
    }
  }

  async update(id: number, dto: UpdateProductDto, changedByName?: string | null): Promise<ProductDto> {
    const before = await this.prisma.product.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Product not found.');
    try {
      const row = await this.prisma.product.update({ where: { id }, data: this.toUpdateData(dto) });
      await this.logRateChange(before, row, changedByName);
      await this.logFieldChanges(before, row, changedByName);
      return this.toDto(await this.ensureCode(row));
    } catch (err) {
      throw this.conflictOr(err);
    }
  }

  /**
   * Record every OTHER field a user changed — name, category, sub-category, the
   * quantities and flags (spec §6.1).
   *
   * Kept apart from {@link logRateChange}: that trail is load-bearing (booking
   * conversion reprices from it) and is keyed to the rate alone. This one is
   * plain "who edited what", one row per field, so the Products screen can list
   * recent edits without the rate trail having to carry a shape it does not want.
   *
   * Failures are swallowed: an edit must not fail because its audit row did.
   */
  private async logFieldChanges(before: Row, after: Row, changedByName?: string | null): Promise<void> {
    const FIELDS: { key: keyof Row; label: string }[] = [
      { key: 'product', label: 'Product name' },
      { key: 'category', label: 'Category' },
      { key: 'subCategory', label: 'Sub-category' },
      { key: 'size', label: 'Size' },
      { key: 'pcs', label: 'Pcs' },
      { key: 'weight', label: 'Weight' },
      { key: 'active', label: 'Active' },
      { key: 'showOnRateList', label: 'Show on rate list' },
    ];
    const rows = FIELDS.flatMap(({ key, label }) => {
      const a = before[key] ?? null;
      const b = after[key] ?? null;
      if (a === b) return [];
      return [{
        productId: after.id,
        productName: after.product,
        kind: 'UPDATED',
        field: label,
        oldValue: a === null ? '' : String(a),
        newValue: b === null ? '' : String(b),
        changedByName: changedByName ?? null,
      }];
    });
    if (!rows.length) return;
    await this.prisma.productChange.createMany({ data: rows }).catch(() => null);
  }

  /** Recent product edits, newest first — what the Products screen lists (§6.1). */
  async recentChanges(productId?: number, limit = 300) {
    const rows = await this.prisma.productChange.findMany({
      where: productId ? { productId } : {},
      orderBy: { changedAt: 'desc' },
      take: Math.min(limit, 1000),
    });
    return rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.productName,
      kind: r.kind,
      field: r.field,
      oldValue: r.oldValue,
      newValue: r.newValue,
      changedByName: r.changedByName,
      changedAt: r.changedAt.toISOString(),
    }));
  }

  /** Record an old→new chart-rate change so bag-booking conversion can reprice
   *  as of any past date, and the price trail stays auditable. No-op when the
   *  rate is unchanged. */
  private async logRateChange(before: Row, after: Row, changedByName?: string | null): Promise<void> {
    if ((before.rate ?? null) === (after.rate ?? null)) return;
    await this.prisma.productRateHistory.create({
      data: {
        productId: after.id,
        productName: after.product,
        category: after.category,
        subCategory: after.subCategory,
        size: after.size,
        oldRate: before.rate,
        newRate: after.rate,
        changedByName: changedByName ?? null,
      },
    });
  }

  /** Inline toggle: flip active / rate-list flags without touching other fields. */
  async setFlags(id: number, dto: SetProductFlagsDto): Promise<ProductDto> {
    await this.ensureExists(id);
    const row = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.showOnRateList !== undefined ? { showOnRateList: dto.showOnRateList } : {}),
      },
    });
    return this.toDto(row);
  }

  /** Same flip, applied to every id in one statement — the Products page's bulk
   *  row-selection actions (e.g. deactivating a batch of discontinued items). */
  async bulkSetFlags(ids: number[], dto: SetProductFlagsDto): Promise<{ updated: number }> {
    if (dto.active === undefined && dto.showOnRateList === undefined) return { updated: 0 };
    const { count } = await this.prisma.product.updateMany({
      where: { id: { in: ids } },
      data: {
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.showOnRateList !== undefined ? { showOnRateList: dto.showOnRateList } : {}),
      },
    });
    return { updated: count };
  }

  /* ── Bulk chart-rate adjustment ──────────────────────────────────────────
   *
   * "Every GLASS rate up ₹5", "2.5% off 10-PCS-FG". Preview and apply share one
   * planner so what you are shown is what gets written — a second
   * implementation for the preview is how the two drift apart.
   */

  /**
   * Work out the new rate for every product in scope, and why some get none.
   *
   * Three reasons a product in scope is left alone, all reported rather than
   * silently dropped:
   *
   *  - NO RATE. A product with no chart rate is not "₹0": adding ₹5 to it would
   *    invent a price out of nothing, and a percentage of nothing is nothing.
   *  - NEGATIVE. A reduction bigger than the rate would write a negative price.
   *    Clamping to zero would be worse than skipping — it silently sets a real,
   *    wrong number that then prints on a rate list.
   *  - UNCHANGED. Rounding can swallow a small adjustment (+0.4 rounded to the
   *    rupee). Writing it anyway would stamp a rate-history row recording a
   *    change that did not happen, and that trail reprices old bookings.
   */
  private async planRateChange(dto: BulkRateChangeDto) {
    const category = (dto.category ?? '').trim();
    if (!category) throw new BadRequestException('Pick a category.');
    const subCategory = (dto.subCategory ?? '').trim();
    const activeOnly = dto.activeOnly !== false;

    const products = await this.prisma.product.findMany({
      where: {
        category,
        ...(subCategory ? { subCategory } : {}),
        ...(activeOnly ? { active: true } : {}),
      },
      orderBy: [{ subCategory: 'asc' }, { product: 'asc' }, { size: 'asc' }],
    });

    let skippedNoRate = 0;
    let skippedNegative = 0;
    let skippedUnchanged = 0;
    const changes: { row: (typeof products)[number]; oldRate: number; newRate: number }[] = [];

    for (const row of products) {
      if (row.rate == null) {
        skippedNoRate += 1;
        continue;
      }
      const raw = dto.mode === 'PERCENT' ? row.rate * (1 + dto.value / 100) : row.rate + dto.value;
      // Round BEFORE the negative check, so a result that rounds to 0 is treated
      // as the zero it will be stored as rather than as a small positive.
      const newRate = dto.roundToRupee ? Math.round(raw) : Math.round(raw * 100) / 100;
      if (newRate < 0) {
        skippedNegative += 1;
        continue;
      }
      if (newRate === row.rate) {
        skippedUnchanged += 1;
        continue;
      }
      changes.push({ row, oldRate: row.rate, newRate });
    }

    return { matched: products.length, changes, skippedNoRate, skippedNegative, skippedUnchanged };
  }

  /** What {@link bulkRateChange} would do, without doing it. */
  async previewRateChange(dto: BulkRateChangeDto): Promise<BulkRatePreview> {
    const plan = await this.planRateChange(dto);
    const CAP = 200;
    return {
      matched: plan.matched,
      willChange: plan.changes.length,
      skippedNoRate: plan.skippedNoRate,
      skippedNegative: plan.skippedNegative,
      skippedUnchanged: plan.skippedUnchanged,
      rows: plan.changes.slice(0, CAP).map((c) => ({
        id: c.row.id,
        product: c.row.product,
        subCategory: c.row.subCategory,
        size: c.row.size,
        oldRate: c.oldRate,
        newRate: c.newRate,
      })),
      truncated: plan.changes.length > CAP,
    };
  }

  /**
   * Apply the adjustment.
   *
   * Re-planned from the CURRENT rates rather than from whatever the preview
   * showed: the instruction is "move these by ₹5", not "set them to these exact
   * numbers". If somebody edited a rate between the preview and the apply, the
   * relative move is still right, where replaying the preview's figures would
   * quietly undo their edit.
   *
   * One transaction, and each product's rate-history row written beside its
   * update — that trail is load-bearing (booking conversion and the order-date
   * repricing both read it), so a rate that moved without a history row would
   * silently reprice past orders. All-or-nothing means a failure halfway cannot
   * leave the two out of step.
   */
  async bulkRateChange(dto: BulkRateChangeDto, changedByName?: string | null): Promise<BulkRateChangeResult> {
    const plan = await this.planRateChange(dto);
    if (!plan.changes.length) return { updated: 0 };

    const ops = plan.changes.flatMap((c) => [
      this.prisma.product.update({ where: { id: c.row.id }, data: { rate: c.newRate } }),
      this.prisma.productRateHistory.create({
        data: {
          productId: c.row.id,
          productName: c.row.product,
          category: c.row.category,
          subCategory: c.row.subCategory,
          size: c.row.size,
          oldRate: c.oldRate,
          newRate: c.newRate,
          changedByName: changedByName ?? null,
        },
      }),
    ]);
    await this.prisma.$transaction(ops);
    return { updated: plan.changes.length };
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
          const updated = await this.prisma.product.update({ where: { id: existing.id }, data });
          await this.logRateChange(existing, updated, 'Import');
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
      active: dto.active ?? true,
      showOnRateList: dto.showOnRateList ?? true,
    };
  }

  /**
   * Only the fields the caller actually sent.
   *
   * `toData` fills in a default for everything, which is right for a create and
   * destructive for a PATCH: `{ rate: 350 }` would go in and come back out as a
   * product whose category, sub-category and name had been blanked and whose
   * size, weight and pcs had been cleared. Reads the KEYS present rather than
   * their values, so `rate: null` clears the rate and an absent `rate` leaves
   * it alone.
   */
  private toUpdateData(dto: UpdateProductDto): Prisma.ProductUncheckedUpdateInput {
    const data: Prisma.ProductUncheckedUpdateInput = {};
    if ('category' in dto) data.category = (uc(dto.category) ?? '') as string;
    if ('subCategory' in dto) data.subCategory = (uc(dto.subCategory) ?? '') as string;
    if ('product' in dto) data.product = (uc(dto.product) ?? '') as string;
    if ('size' in dto) data.size = dto.size ?? null;
    if ('weight' in dto) data.weight = dto.weight ?? null;
    if ('pcs' in dto) data.pcs = dto.pcs ?? null;
    if ('rate' in dto) data.rate = dto.rate ?? null;
    if ('active' in dto) data.active = dto.active ?? true;
    if ('showOnRateList' in dto) data.showOnRateList = dto.showOnRateList ?? true;
    return data;
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

  /* ── Photo gallery (Products → Product Photos) ─────────────────────────── */

  /**
   * Every uploaded order-line photo, grouped by party or by item.
   *
   * Read-only by design: the photos belong to order lines, and the screens that
   * own those lines own uploading and deleting them. A gallery that could
   * delete would be able to strip the reference photo a dispatch depends on
   * from a screen that shows no dispatch context at all.
   *
   * Pages count SECTIONS rather than photos, so a party is never split across
   * two pages — the whole point of the screen is seeing one party's work
   * together.
   */
  async photoGallery(query: ProductPhotoQueryDto): Promise<ProductPhotoGalleryDto> {
    const groupBy: PhotoGroupBy = query.groupBy ?? 'PARTY';
    const rows = await this.photoRows(query);
    // One row over the cap is the signal that the filters matched more than a
    // single grouping pass covers; the extra row is dropped and the flag says so
    // rather than presenting a subset as the whole answer.
    const truncated = rows.length > PHOTO_SCAN_CAP;
    const scanned = truncated ? rows.slice(0, PHOTO_SCAN_CAP) : rows;
    const knownTypes = await this.knownDesignTypes();
    const photos = scanned.map((r) => this.toPhotoDto(r, knownTypes));

    // Sections in order of first appearance, which — because the rows arrive
    // newest-upload-first — puts the most recently photographed party or item at
    // the top. That is the one you are most likely to be looking for.
    const buckets = new Map<string, { label: string; photos: ProductPhotoDto[] }>();
    for (const p of photos) {
      const label = (groupBy === 'PARTY' ? p.customerName : p.productName || p.product || '—').trim() || '—';
      const key = label.toUpperCase();
      const bucket = buckets.get(key);
      if (bucket) bucket.photos.push(p);
      else buckets.set(key, { label, photos: [p] });
    }

    const all = [...buckets.entries()].map(([key, b]) => {
      // The cross-reference: a party section counts its items, an item section
      // counts the parties it was made for. Each is the question you ask next.
      const others = new Set(
        b.photos.map((p) =>
          groupBy === 'PARTY' ? (p.productName || p.product || '—').toUpperCase() : p.customerName.toUpperCase(),
        ),
      );
      const noun = groupBy === 'PARTY' ? 'item' : 'party';
      const plural = groupBy === 'PARTY' ? 'items' : 'parties';
      return {
        key,
        label: b.label,
        subLabel: `${b.photos.length} photo${b.photos.length === 1 ? '' : 's'} · ${others.size} ${others.size === 1 ? noun : plural}`,
        photos: b.photos,
      };
    });

    const totalPages = Math.max(1, Math.ceil(all.length / query.pageSize));
    return {
      groups: all.slice(query.skip, query.skip + query.pageSize),
      totalPhotos: photos.length,
      totalGroups: all.length,
      page: query.page,
      pageSize: query.pageSize,
      totalPages,
      truncated,
    };
  }

  /** Dropdown values, each cascaded off the OTHER active filters. */
  async photoFilterOptions(query: ProductPhotoQueryDto): Promise<ProductPhotoFilterOptions> {
    const knownTypes = await this.knownDesignTypes();
    const without = async (drop: 'customer' | 'product' | 'designType') => {
      const rows = await this.photoRows({ ...query, [drop]: undefined } as ProductPhotoQueryDto);
      return rows.slice(0, PHOTO_SCAN_CAP).map((r) => this.toPhotoDto(r, knownTypes));
    };
    const distinct = (list: ProductPhotoDto[], pick: (p: ProductPhotoDto) => string | null) => {
      const s = new Set<string>();
      for (const p of list) {
        const v = pick(p)?.trim();
        if (v) s.add(v);
      }
      return [...s].sort((a, b) => a.localeCompare(b));
    };
    const [byCustomer, byProduct, byDesign] = await Promise.all([
      without('customer'),
      without('product'),
      without('designType'),
    ]);
    return {
      customers: distinct(byCustomer, (p) => p.customerName),
      // The BARE product, so one entry covers every size of it — "BREZZA", not
      // "10 BREZZA WL+LOGO" and eleven near-identical neighbours.
      products: distinct(byProduct, (p) => p.product),
      designTypes: distinct(byDesign, (p) => p.designType),
    };
  }

  /** The filtered photo rows, newest upload first, with their line and order. */
  private async photoRows(query: ProductPhotoQueryDto): Promise<PhotoRow[]> {
    const and: Prisma.OrderItemPhotoWhereInput[] = [];
    const search = query.search?.trim();
    if (search) {
      and.push({
        OR: [
          { filename: { contains: search } },
          { uploadedBy: { contains: search } },
          { orderItem: { product: { contains: search } } },
          { orderItem: { productName: { contains: search } } },
          { orderItem: { designType: { contains: search } } },
          { orderItem: { design: { contains: search } } },
          { orderItem: { order: { customerName: { contains: search } } } },
          { orderItem: { order: { code: { contains: search } } } },
        ],
      });
    }
    if (query.customer?.trim()) and.push({ orderItem: { order: { customerName: query.customer.trim() } } });
    // Bare product, matching what the dropdown offers.
    if (query.product?.trim()) and.push({ orderItem: { product: query.product.trim() } });
    // The design filter cannot go in the query: which column holds the TYPE
    // varies row by row (see `toPhotoDto`), so it is applied after resolution.
    const from = dayStart(query.from);
    const to = dayEnd(query.to);
    if (from || to) {
      and.push({ createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
    }

    const rows = await this.prisma.orderItemPhoto.findMany({
      where: and.length ? { AND: and } : {},
      select: PHOTO_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One past the cap, so `photoGallery` can tell "exactly full" from "more
      // than we scanned" without a second count query.
      take: PHOTO_SCAN_CAP + 1,
    });

    const design = query.designType?.trim().toUpperCase();
    if (!design) return rows;
    const knownTypes = await this.knownDesignTypes();
    return rows.filter((r) => resolveLineDesignParts(r.orderItem, knownTypes).type === design);
  }

  private toPhotoDto(row: PhotoRow, knownTypes: ReadonlySet<string>): ProductPhotoDto {
    const line = row.orderItem;
    const order = line.order;
    const design = resolveLineDesignParts(line, knownTypes);
    return {
      id: row.id,
      url: row.url,
      filename: row.filename,
      mimeType: row.mimeType,
      size: row.size,
      uploadedBy: row.uploadedBy,
      uploadedAt: row.createdAt.toISOString(),
      orderItemId: line.id,
      orderId: order.id,
      orderCode: order.code,
      orderDate: order.orderDate.toISOString(),
      customerId: order.customerId,
      customerName: order.customerName,
      productName: line.productName,
      product: line.product,
      designType: design.type,
      designName: design.name,
    };
  }

  /** The design master's own type set — what lets a line's `design` column be
   *  read as a type only when it really is one (see `resolveLineDesignParts`). */
  private knownDesignTypes(): Promise<ReadonlySet<string>> {
    return loadKnownDesignTypes(this.prisma);
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
      active: r.active,
      showOnRateList: r.showOnRateList,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
