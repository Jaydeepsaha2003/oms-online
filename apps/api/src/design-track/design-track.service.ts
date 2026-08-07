import { Injectable } from '@nestjs/common';
import {
  resolveLineDesignType,
  type DesignTrackFilterOptions,
  type DesignTrackList,
  type DesignTrackRow,
  type DesignTrackTypesDto,
  type PendingLineDto,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { SettingsService } from '../settings/settings.service';
import { DesignTrackQueryDto } from './dto/design-track.dto';

/** A pending line paired with its hand-entered Kalwat, ready to become a row. */
type Tracked = { line: PendingLineDto; kalwat: number | null };

const r2 = (v: number) => Math.round(v * 100) / 100;

@Injectable()
export class DesignTrackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: DispatchService,
    private readonly settings: SettingsService,
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

    const lines = (await this.dispatch.pendingPool()).filter((l) => {
      const type = resolveLineDesignType(l, knownTypes);
      return type != null && tracked.has(type);
    });
    if (!lines.length) return [];

    const entries: { orderItemId: number; kalwat: number | null }[] = await this.prisma.designTrackEntry.findMany({
      where: { orderItemId: { in: lines.map((l) => l.orderItemId) } },
      select: { orderItemId: true, kalwat: true },
    });
    const kalwatBy = new Map<number, number | null>(entries.map((e) => [e.orderItemId, e.kalwat]));
    return lines.map((line) => ({ line, kalwat: kalwatBy.get(line.orderItemId) ?? null }));
  }

  private toRow({ line, kalwat }: Tracked): DesignTrackRow {
    return {
      orderItemId: line.orderItemId,
      orderId: line.orderId,
      orderCode: line.orderCode,
      orderDate: line.orderDate,
      customerName: line.customerName,
      productName: line.productName,
      designType: line.designType,
      bags: line.bags,
      comment: line.comment,
      kalwat,
      // Ordered bags minus what's been processed. Derived every read so an edit
      // to the order's bags is reflected without touching the Kalwat entry.
      remaining: r2(line.bags - (kalwat ?? 0)),
    };
  }

  private applyFilters(pool: Tracked[], query: DesignTrackQueryDto): Tracked[] {
    let out = pool;
    const search = query.search?.trim().toLowerCase();
    if (search) {
      out = out.filter((t) =>
        [t.line.customerName, t.line.productName, t.line.designType, t.line.comment].some((v) =>
          (v ?? '').toLowerCase().includes(search),
        ),
      );
    }
    if (query.customer) out = out.filter((t) => t.line.customerName === query.customer);
    if (query.product) out = out.filter((t) => (t.line.productName ?? '') === query.product);
    if (query.design) out = out.filter((t) => t.line.designType === query.design);
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
    return {
      items: rows.slice(query.skip, query.skip + query.pageSize).map((t) => this.toRow(t)),
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
    return rows.map((t) => this.toRow(t));
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
      products: distinct(poolFor('product'), (t) => t.line.productName),
      designs: distinct(poolFor('design'), (t) => t.line.designType),
    };
  }

  /**
   * Save (or clear) one line's Kalwat. Upsert because a line has no row until it
   * is first typed into — the absence of a row is what means "not started",
   * which a 0 could not express.
   */
  async setKalwat(orderItemId: number, kalwat: number | null, userName?: string | null): Promise<DesignTrackRow> {
    await this.prisma.designTrackEntry.upsert({
      where: { orderItemId },
      update: { kalwat, updatedBy: userName ?? null },
      create: { orderItemId, kalwat, updatedBy: userName ?? null },
    });
    // Echo the recomputed row so the grid's Remaining updates from the server's
    // own arithmetic rather than the client repeating the formula.
    const line = (await this.dispatch.pendingPool()).find((l) => l.orderItemId === orderItemId);
    if (!line) {
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
        bags: 0,
        comment: null,
        kalwat,
        remaining: r2(-(kalwat ?? 0)),
      };
    }
    return this.toRow({ line, kalwat });
  }

  /** Selected + available design types, for the Settings picker. */
  async trackedTypes(): Promise<DesignTrackTypesDto> {
    return this.settings.getDesignTrackTypes();
  }
}
