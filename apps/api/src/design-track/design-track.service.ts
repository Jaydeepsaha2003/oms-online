import { Injectable } from '@nestjs/common';
import {
  isRealDesign,
  resolveLineDesignParts,
  type DesignTrackFilterOptions,
  type DesignTrackList,
  type DesignTrackRow,
  type DesignTrackTypesDto,
  type PendingLineDto,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { SettingsService } from '../settings/settings.service';
import { ActivityNotifier } from '../notifications/activity-notifier.service';
import { DesignTrackQueryDto } from './dto/design-track.dto';

/** A pending line paired with its hand-entered Kalwat, ready to become a row. */
/**
 * A pending line, its Kalwat, and the line's REAL design type.
 *
 * `designType` is carried separately because `line.designType` is not the type —
 * it is the Dispatch screens' display string (see `dispatchDesign`), which
 * prefers the human-readable design NAME and falls back to "NA". Matching
 * tracked designs against that made every combination line ("WL+TOOL") arrive as
 * "NA" and drop out, which emptied this grid entirely.
 */
type Tracked = {
  line: PendingLineDto;
  kalwat: number | null;
  /** The design TYPE (parent, e.g. "DL+TOOL") — what tracking matches on. */
  designType: string;
  /** The design NAME (child, e.g. "ZEBRA"), or null when the line has none. */
  designName: string | null;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

@Injectable()
export class DesignTrackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: DispatchService,
    private readonly settings: SettingsService,
    private readonly notifier: ActivityNotifier,
  ) {}

  /**
   * Pending lines whose design type is one the business is tracking, joined to
   * their Kalwat entries.
   *
   * Nothing selected in Settings means nothing is tracked, so the pool is empty
   * — deliberately, rather than falling back to "show every design", which would
   * bury the handful of designs actually being worked in ~850 rows.
   */
  private async pool(): Promise<Tracked[]> {
    const { selected, available } = await this.settings.getDesignTrackTypes();
    if (!selected.length) return [];
    const tracked = new Set(selected.map((d) => d.trim().toUpperCase()));
    // The master's own type set, so a line's `design` column is only read as a
    // type when it really is one — see resolveLineDesignType.
    const knownTypes = new Set(available);
    // A combination type ("DL+WL") tracks automatically once any of its
    // component designs is picked — the Settings picker only ever offers plain
    // designs (see settings.service.ts), so this is the only place combinations
    // get matched at all.
    const matchesTracked = (type: string) =>
      tracked.has(type) || (type.includes('+') && type.split('+').some((part) => tracked.has(part.trim())));

    const pending = await this.dispatch.pendingPool();
    if (!pending.length) return [];

    // Resolve the design type from the ORDER LINE's own columns, not from
    // `line.designType` — that field holds the Dispatch screens' display string,
    // which is the design NAME (or "NA") on natively-entered rows and therefore
    // never matches a tracked type. Scoped to the pending ids, so this is one
    // small lookup rather than a scan.
    const raw = await this.prisma.orderItem.findMany({
      where: { id: { in: pending.map((l) => l.orderItemId) } },
      select: { id: true, design: true, designType: true, productName: true },
    });
    const typeById = new Map<number, string>();
    for (const r of raw) {
      const type = this.designTypeOf(r, knownTypes);
      if (type != null) typeById.set(r.id, type);
    }

    const lines = pending.filter((l) => {
      const type = typeById.get(l.orderItemId);
      return type != null && matchesTracked(type);
    });
    if (!lines.length) return [];

    const entries: { orderItemId: number; kalwat: number | null }[] = await this.prisma.designTrackEntry.findMany({
      where: { orderItemId: { in: lines.map((l) => l.orderItemId) } },
      select: { orderItemId: true, kalwat: true },
    });
    const kalwatBy = new Map<number, number | null>(entries.map((e) => [e.orderItemId, e.kalwat]));
    return lines.map((line) => {
      const type = typeById.get(line.orderItemId)!;
      // `line.designType` is the Dispatch screens' display string (dispatchDesign),
      // which resolves to the design NAME across all three column shapes — the
      // same value Dispatch Order prints as "ZEBRA". "NA" means none was chosen.
      const name = (line.designType ?? '').trim();
      return {
        line,
        kalwat: kalwatBy.get(line.orderItemId) ?? null,
        designType: type,
        // Never let the name echo the type: on imported lines dispatchDesign
        // falls back to the type itself, which would just duplicate the column.
        designName: isRealDesign(name) && name.toUpperCase() !== type.toUpperCase() ? name : null,
      };
    });
  }

  /**
   * The design TYPE (parent) for a line — "DL+TOOL", never the name "ZEBRA".
   *
   * The three-shape problem this untangles now lives in `resolveLineDesignParts`
   * (@oms/shared), so Product Photos decides a line's design the same way this
   * screen does. Two copies of the rule meant the same line could be filed under
   * "GUCCI" on one screen and "FULL LASER+DL+LOGO" on the other.
   */
  private designTypeOf(
    line: { design: string | null; designType: string | null; productName: string | null },
    knownTypes: ReadonlySet<string>,
  ): string | null {
    return resolveLineDesignParts(line, knownTypes).type;
  }

  private async resolvePhotosForItems(pageItems: Tracked[]): Promise<Map<number, { id?: number; url: string; filename?: string | null; title?: string | null; fromHistory?: boolean }[]>> {
    const photoMap = new Map<number, { id?: number; url: string; filename?: string | null; title?: string | null; fromHistory?: boolean }[]>();
    if (!pageItems.length) return photoMap;

    const itemIds = pageItems.map((t) => t.line.orderItemId);
    const directPhotos = await this.prisma.orderItemPhoto.findMany({
      where: { orderItemId: { in: itemIds } },
      select: {
        id: true,
        orderItemId: true,
        url: true,
        filename: true,
        orderItem: {
          select: {
            productName: true,
            design: true,
            designType: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    // Map item by orderItemId to get item details for title
    const itemMap = new Map<number, Tracked>(pageItems.map((t) => [t.line.orderItemId, t]));

    for (const p of directPhotos) {
      if (!photoMap.has(p.orderItemId)) photoMap.set(p.orderItemId, []);
      const item = itemMap.get(p.orderItemId);
      const parts = [
        item?.line.productName || p.orderItem.productName,
        item?.designName || item?.designType || p.orderItem.designType || p.orderItem.design,
      ].filter(Boolean);
      const title = parts.join(' · ');
      photoMap.get(p.orderItemId)!.push({ id: p.id, url: p.url, filename: p.filename, title: title || p.filename, fromHistory: false });
    }

    const missingPhotoItems = pageItems.filter((t) => !photoMap.has(t.line.orderItemId) && t.line.customerId);
    if (missingPhotoItems.length) {
      const customerIds = [...new Set(missingPhotoItems.map((t) => t.line.customerId!).filter(Boolean))];
      const historyPhotos = await this.prisma.orderItemPhoto.findMany({
        where: {
          orderItem: {
            order: { customerId: { in: customerIds } },
          },
        },
        select: {
          id: true,
          url: true,
          filename: true,
          orderItem: {
            select: {
              product: true,
              productName: true,
              design: true,
              designType: true,
              order: { select: { customerId: true } },
            },
          },
        },
        orderBy: { id: 'desc' },
        take: 200,
      });

      for (const t of missingPhotoItems) {
        const cId = t.line.customerId!;
        const targetType = (t.designType ?? '').trim().toUpperCase();
        const targetDesign = (t.designName ?? '').trim().toUpperCase();
        const targetProdName = (t.line.productName ?? '').trim().toUpperCase();
        const targetProd = (t.line.product ?? '').trim().toUpperCase();

        const matched = historyPhotos.filter((hp) => {
          if (hp.orderItem.order.customerId !== cId) return false;
          const hpProdName = (hp.orderItem.productName ?? '').trim().toUpperCase();
          const hpProd = (hp.orderItem.product ?? '').trim().toUpperCase();
          const prodMatches = (targetProdName && hpProdName === targetProdName) || (targetProd && hpProd === targetProd);
          if (!prodMatches) return false;

          const hpType = (hp.orderItem.designType ?? '').trim().toUpperCase();
          const hpDesign = (hp.orderItem.design ?? '').trim().toUpperCase();

          // Match design type or design name
          if (targetType && targetType !== 'NA' && targetType !== 'N/A') {
            if (hpType === targetType || hpDesign === targetType) return true;
          }
          if (targetDesign && targetDesign !== 'NA' && targetDesign !== 'N/A') {
            if (hpDesign === targetDesign || hpType === targetDesign) return true;
          }
          return false;
        });

        if (matched.length) {
          const hPhotos = matched.slice(0, 5).map((hp) => {
            const parts = [
              hp.orderItem.productName || t.line.productName,
              t.designName || t.designType || hp.orderItem.designType || hp.orderItem.design,
            ].filter(Boolean);
            const title = parts.join(' · ');
            return { id: hp.id, url: hp.url, filename: hp.filename, title: title || hp.filename, fromHistory: true };
          });
          photoMap.set(t.line.orderItemId, hPhotos);
        }
      }
    }

    return photoMap;
  }

  private toRow({ line, kalwat, designType, designName }: Tracked, photoList?: { id?: number; url: string; filename?: string | null; title?: string | null; fromHistory?: boolean }[]): DesignTrackRow {
    const dispatchedBags = r2(Math.max(0, line.bags - line.remBags));
    const photos = photoList ?? [];
    return {
      orderItemId: line.orderItemId,
      orderId: line.orderId,
      orderCode: line.orderCode,
      orderDate: line.orderDate,
      customerName: line.customerName,
      productName: line.productName,
      priority: line.priority,
      // The parent type ("WL+TOOL") and its child name ("ZEBRA") as separate
      // columns — never the dispatch display string, which reads "NA" here.
      designType,
      designName,
      // The total bags originally ordered on the line.
      bags: line.bags,
      comment: line.comment,
      kalwat,
      dispatchedBags,
      // Bags still to PROCESS: ordered minus what has been Kalwat-ed. This is the
      // whole point of the Kalwat column — it read `line.remBags` (bags left to
      // DISPATCH), so typing a Kalwat changed nothing on screen and the figure
      // contradicted the contract on DesignTrackRow.remaining. Dispatched bags are
      // reported separately as `dispatchedBags`.
      remaining: r2(line.bags - (kalwat ?? 0)),
      photos,
      photoCount: photos.length,
      sampleUrl: photos[0]?.url ?? null,
    };
  }

  private baseProductName(full: string | null | undefined, product: string | null | undefined): string {
    const name = (full ?? '').trim();
    const prod = (product ?? '').trim();
    if (!prod) return name;
    const idx = name.toUpperCase().indexOf(prod.toUpperCase());
    if (idx === -1) return name;
    return name.slice(0, idx + prod.length).trim();
  }

  private applyFilters(pool: Tracked[], query: DesignTrackQueryDto): Tracked[] {
    let out = pool;
    const search = query.search?.trim().toLowerCase();
    if (search) {
      out = out.filter((t) =>
        [t.line.customerName, t.line.productName, t.designType, t.designName, t.line.comment].some((v) =>
          (v ?? '').toLowerCase().includes(search),
        ),
      );
    }
    if (query.customer) out = out.filter((t) => t.line.customerName === query.customer);
    if (query.product) {
      const qProd = query.product.trim().toLowerCase();
      out = out.filter((t) => {
        const full = (t.line.productName ?? '').trim().toLowerCase();
        const base = this.baseProductName(t.line.productName || t.line.product, t.line.product).trim().toLowerCase();
        const rawProd = (t.line.product ?? '').trim().toLowerCase();
        return base === qProd || full === qProd || rawProd === qProd;
      });
    }
    // Filters on the TYPE — the thing being tracked, not the name.
    if (query.design) out = out.filter((t) => t.designType === query.design);
    return out;
  }

  async findMany(query: DesignTrackQueryDto): Promise<DesignTrackList> {
    const rows = this.applyFilters(await this.pool(), query);
    // Product name, then oldest order first — the same reading order as the
    // screen's default sort, so page 2 continues where page 1 stopped.
    rows.sort(
      (a, b) =>
        (a.line.productName ?? '').localeCompare(b.line.productName ?? '') ||
        a.line.orderDate.localeCompare(b.line.orderDate),
    );
    const total = rows.length;
    const pageItems = rows.slice(query.skip, query.skip + query.pageSize);
    const photoMap = await this.resolvePhotosForItems(pageItems);
    return {
      items: pageItems.map((t) => this.toRow(t, photoMap.get(t.line.orderItemId))),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /** Every row matching the filters, unpaginated — backs the Excel export. */
  async findAll(query: DesignTrackQueryDto): Promise<DesignTrackRow[]> {
    const rows = this.applyFilters(await this.pool(), query);
    rows.sort(
      (a, b) =>
        (a.line.productName ?? '').localeCompare(b.line.productName ?? '') ||
        a.line.orderDate.localeCompare(b.line.orderDate),
    );
    const photoMap = await this.resolvePhotosForItems(rows);
    return rows.map((t) => this.toRow(t, photoMap.get(t.line.orderItemId)));
  }

  /** Filter dropdowns, each cascaded off the OTHER active filters (same idiom as
   *  Modify Dispatch, so a dropdown never offers a value that returns nothing). */
  async filterOptions(query: DesignTrackQueryDto): Promise<DesignTrackFilterOptions> {
    const pool = await this.pool();
    const poolFor = (exclude: keyof DesignTrackQueryDto) =>
      this.applyFilters(pool, { ...query, [exclude]: undefined } as DesignTrackQueryDto);
    const distinct = (list: Tracked[], pick: (t: Tracked) => string | null | undefined) => {
      const s = new Set<string>();
      for (const t of list) {
        const v = pick(t);
        if (v) s.add(v);
      }
      return [...s].sort((a, b) => a.localeCompare(b));
    };
    return {
      customers: distinct(poolFor('customer'), (t) => t.line.customerName),
      products: distinct(poolFor('product'), (t) => this.baseProductName(t.line.productName || t.line.product, t.line.product)),
      designs: distinct(poolFor('design'), (t) => t.designType),
    };
  }

  /**
   * Save (or clear) one line's Kalwat. Upsert because a line has no row until it
   * is first typed into — the absence of a row is what means "not started",
   * which a 0 could not express.
   */
  async setKalwat(
    orderItemId: number,
    kalwat: number | null,
    userName?: string | null,
    actorId?: string | null,
  ): Promise<DesignTrackRow> {
    await this.prisma.designTrackEntry.upsert({
      where: { orderItemId },
      update: { kalwat, updatedBy: userName ?? null },
      create: { orderItemId, kalwat, updatedBy: userName ?? null },
    });
    // Echo the recomputed row so the grid's Remaining updates from the server's
    // own arithmetic rather than the client repeating the formula.
    // Via pool() rather than pendingPool(), so the echoed row carries the same
    // resolved design type the grid shows — and comes back through one code path.
    const tracked = (await this.pool()).find((t) => t.line.orderItemId === orderItemId);
    if (!tracked) {
      // The line left the pending pool (fully dispatched meanwhile). The entry is
      // still saved; report what we can so the caller isn't left guessing.
      return {
        orderItemId,
        orderId: 0,
        orderCode: null,
        orderDate: new Date().toISOString(),
        customerName: '',
        productName: null,
        designType: null,
        designName: null,
        bags: 0,
        comment: null,
        kalwat,
        dispatchedBags: 0,
        remaining: 0,
      };
    }
    const row = this.toRow(tracked);
    this.notifier.designTrackUpdated({
      actorId,
      userName,
      orderItemId,
      customerName: row.customerName,
      productName: row.productName,
      designType: row.designType,
      kalwat,
    });
    return row;
  }

  /** Selected + available design types, for the Settings picker. */
  async trackedTypes(): Promise<DesignTrackTypesDto> {
    return this.settings.getDesignTrackTypes();
  }
}
