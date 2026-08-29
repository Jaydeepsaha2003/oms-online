import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { Prisma } from '@prisma/client';
import {
  type ChallanAnalytics,
  type TradingNoteRow,
  type TradingAccount,
  type ChallanDraft,
  type ChallanDraftItem,
  type ChallanDto,
  type ChallanItemHistoryRow,
  type ChallanSummary,
  type Paginated,
  type PendingChallanFilterOptions,
  type PendingChallanLine,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { formatDate } from '../common/date.util';
import { PdfService } from '../pdf/pdf.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { SettingsService } from '../settings/settings.service';
import { AgentCommissionService } from '../agent-commission/agent-commission.service';
import { CreateChallanDto, DraftChallanDto, ItemHistoryQueryDto, PendingChallanQueryDto, ChallanQueryDto } from './dto/challan.dto';

const PREFIX_KEY = 'CHALLAN_PREFIXES';
const FALLBACK_PREFIX = 'SSS';
const round5 = (x: number) => Math.round(x / 5) * 5;
/** Money to 2dp — keeps the trading statement's rows from carrying float dust. */
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const n = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : 0);
/** SCRAP parties are TCS-only — this guards against a stale client ever
 *  persisting a TDS deduction alongside it. */
const isScrapCategory = (category: string | null | undefined) => (category ?? '').toUpperCase() === 'SCRAP';

/** The customers of the agent being filtered on, or null when there is none. */
type AgentScope = { ids: number[]; names: string[] } | null;

@Injectable()
export class ChallansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly notifications: NotificationsGateway,
    private readonly settings: SettingsService,
    private readonly commission: AgentCommissionService,
  ) {}

  /** Dispatch lines still awaiting a challan (mirrors the legacy PendChallan query:
   *  a dispatch is pending until it appears in a non-cancelled challan). */
  // Dispatch ids already on a non-cancelled challan, expressed as a parameter-free
  // subquery. A plain `id NOT IN [..thousands of ids]` blows past SQLite's variable
  // limit once there are many challans, and Prisma cannot split a negated IN — so the
  // "un-challaned" condition is done in raw SQL.
  private static readonly NOT_CHALLANED =
    "d.id NOT IN (SELECT ci.dispatchId FROM challan_items ci JOIN challans c ON c.id = ci.challanId WHERE ci.dispatchId IS NOT NULL AND c.challanStatus <> 'CANCELLED')";

  /** Build the WHERE clause (+ bound params) for the pending-dispatch raw queries. */
  private pendingWhere(q: {
    customerName?: string;
    productName?: string;
    design?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }): { clause: string; params: unknown[] } {
    const clauses = [ChallansService.NOT_CHALLANED];
    const params: unknown[] = [];
    if (q.customerName?.trim()) {
      clauses.push('d.customerName = ?');
      params.push(q.customerName.trim());
    }
    // Exact match, like customerName: these come from the filter bar's dropdowns,
    // which are themselves built from the distinct values on pending lines.
    if (q.productName?.trim()) {
      clauses.push('d.productName = ?');
      params.push(q.productName.trim());
    }
    if (q.design?.trim()) {
      clauses.push('d.designType = ?');
      params.push(q.design.trim());
    }
    if (q.dateFrom) {
      const f = new Date(q.dateFrom);
      f.setHours(0, 0, 0, 0);
      clauses.push('d.dispatchDate >= ?');
      params.push(f);
    }
    if (q.dateTo) {
      const t = new Date(q.dateTo);
      t.setHours(23, 59, 59, 999);
      clauses.push('d.dispatchDate <= ?');
      params.push(t);
    }
    const search = q.search?.trim();
    if (search) {
      for (const tok of search.split(',').map((s) => s.trim()).filter(Boolean)) {
        clauses.push('(d.customerName LIKE ? OR d.productName LIKE ? OR d.designType LIKE ? OR d.calField LIKE ?)');
        const like = `%${tok}%`;
        params.push(like, like, like, like);
      }
    }
    return { clause: clauses.join(' AND '), params };
  }

  async pending(q: PendingChallanQueryDto): Promise<Paginated<PendingChallanLine>> {
    const { clause, params } = this.pendingWhere(q);
    const countRows = await this.prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT COUNT(*) AS c FROM dispatches d WHERE ${clause}`, ...params);
    const total = Number(countRows[0]?.c ?? 0);
    const idRows = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
      `SELECT d.id AS id FROM dispatches d WHERE ${clause} ORDER BY d.dispatchDate DESC, d.id DESC LIMIT ? OFFSET ?`,
      ...params,
      q.pageSize,
      q.skip,
    );
    const ids = idRows.map((r) => Number(r.id));
    // Hydrate the page with Prisma (proper types) then restore the id order.
    const rows = ids.length ? await this.prisma.dispatch.findMany({ where: { id: { in: ids } } }) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)).filter((d): d is (typeof rows)[number] => !!d);

    // Resolve the masters for this page so an unpriced line is flagged here,
    // before the operator has spent time building a challan around it.
    const rates = await this.rateMapsMulti(ordered.map((d) => d.customerName));

    return {
      items: ordered.map((d) => {
        const cat = (d.pCategory ?? '').toUpperCase();
        return {
          dispatchId: d.id,
          dispatchDate: d.dispatchDate.toISOString(),
          orderId: d.orderId,
          orderCode: d.orderCode,
          customerId: d.customerId,
          customerName: d.customerName,
          productName: d.productName,
          design: d.designType,
          bags: d.bags,
          kgs: d.gram,
          pcs: d.pcs,
          box: d.box,
          unit: d.calField,
          rate: d.rate,
          pCategory: d.pCategory,
          gstRate: rates.gstFor(d.customerName, cat),
          freightRate: rates.rateFor(d.customerName, cat, 'FREIGHT'),
          packingRate: rates.rateFor(d.customerName, cat, 'PACKING'),
        };
      }),
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  /**
   * Dropdown options for the Pending Challan filter bar: the distinct customers,
   * products and designs that still have un-challaned dispatch lines. Built from
   * the same NOT_CHALLANED pool as the list itself, so every option returns rows.
   */
  async pendingFilterOptions(): Promise<PendingChallanFilterOptions> {
    const { clause, params } = this.pendingWhere({});
    const distinct = async (column: string): Promise<string[]> => {
      const rows = await this.prisma.$queryRawUnsafe<{ v: string | null }[]>(
        `SELECT DISTINCT ${column} AS v FROM dispatches d WHERE ${clause} AND ${column} IS NOT NULL AND TRIM(${column}) <> '' ORDER BY v ASC LIMIT 1000`,
        ...params,
      );
      return rows.map((r) => r.v).filter((v): v is string => !!v);
    };
    const [customers, products, designs] = await Promise.all([
      distinct('d.customerName'),
      distinct('d.productName'),
      distinct('d.designType'),
    ]);
    return { customers, products, designs };
  }

  /** Distinct parties that still have un-challaned dispatch lines (standalone Create Challan picker). */
  async pendingCustomers(search?: string): Promise<string[]> {
    const { clause, params } = this.pendingWhere({ search });
    const rows = await this.prisma.$queryRawUnsafe<{ customerName: string }[]>(
      `SELECT DISTINCT d.customerName AS customerName FROM dispatches d WHERE ${clause} ORDER BY d.customerName ASC LIMIT 500`,
      ...params,
    );
    return rows.map((r) => r.customerName).filter(Boolean);
  }

  /** Every party in the Customer master, regardless of whether they currently
   *  have un-challaned dispatches — lets Create Challan pick any customer (the
   *  draft simply comes back with an empty pool if they have nothing pending). */
  async allCustomerNames(search?: string): Promise<string[]> {
    const s = search?.trim();
    const rows = await this.prisma.customer.findMany({
      where: { partyName: { not: null }, active: true, ...(s ? { partyName: { contains: s } } : {}) },
      select: { partyName: true },
      orderBy: { partyName: 'asc' },
      take: 2000,
    });
    return rows.map((r) => r.partyName).filter((n): n is string => !!n);
  }

  /** Form14 CreateGridList: resolve per-line freight/packing/GST rates for the
   *  selected dispatches and pre-compute the suggested charges + header. */
  async draft(dto: DraftChallanDto): Promise<ChallanDraft> {
    const customerName = dto.customerName.trim();
    const customer = await this.prisma.customer.findFirst({ where: { partyName: customerName } });

    // No explicit selection → offer the customer's entire un-challaned pool.
    let ids = dto.dispatchIds;
    if (!ids || ids.length === 0) {
      const { clause, params } = this.pendingWhere({ customerName });
      const pool = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
        `SELECT d.id AS id FROM dispatches d WHERE ${clause} ORDER BY d.dispatchDate DESC, d.id DESC`,
        ...params,
      );
      ids = pool.map((d) => Number(d.id));
    }

    const dispatches = await this.prisma.dispatch.findMany({ where: { id: { in: ids } } });
    const byId = new Map(dispatches.map((d) => [d.id, d]));
    const ordered = ids.map((id) => byId.get(id)).filter((d): d is (typeof dispatches)[number] => !!d);

    const transName = customer?.transportName ?? null;
    const { gstFor, rateFor } = await this.rateMaps(customerName, transName);

    const items = ordered.map((d) => {
      const cat = (d.pCategory ?? '').toUpperCase();
      const unit = (d.calField ?? '').toUpperCase();
      const price = n(d.rate);
      const qty = unit === 'KGS' || unit === 'KG' || unit === 'KGS.' ? n(d.gram) : n(d.pcs);
      return {
        dispatchId: d.id,
        orderItemId: d.orderItemId,
        orderId: d.orderId,
        orderCode: d.orderCode,
        productName: d.productName,
        design: d.designType,
        bags: d.bags,
        pcs: d.pcs,
        kgs: d.gram,
        box: d.box,
        unit: d.calField,
        price: d.rate,
        amount: Math.round(qty * price * 100) / 100,
        pCategory: d.pCategory,
        comment: d.comment,
        gstRate: gstFor(cat),
        freightRate: rateFor(cat, 'FREIGHT'),
        packingRate: rateFor(cat, 'PACKING'),
      };
    });

    const tBox = items.reduce((a, i) => a + n(i.box), 0);
    const freight = round5(items.reduce((a, i) => a + n(i.bags) * n(i.freightRate), 0));
    const packing = round5(items.reduce((a, i) => a + n(i.bags) * n(i.packingRate), 0));
    const pouch = Math.round(tBox * n(customer?.boxRate) * 100) / 100;
    const gst = Math.max(0, ...items.map((i) => n(i.gstRate)));
    const isScrap = (customer?.category ?? '').toUpperCase() === 'SCRAP';
    const { tcsPercent } = await this.settings.getTcsPercent();

    const billingAddress = [customer?.partyName, customer?.city, customer?.state, customer?.region]
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .join(', ');

    // Manual-line Product picker: every ACTIVE catalogue product, de-duplicated
    // by name. Sourced here (rather than from /products, which needs product:view)
    // so anyone who can build a challan gets the list. A SCRAP party sees its
    // SCRAP-category products first, and the first of those becomes the default —
    // so adding "S.S. SCRAP" to Products under the SCRAP category is all it takes
    // for it to appear here pre-selected.
    const productRows = await this.prisma.product.findMany({
      where: { active: true },
      select: { product: true, category: true },
      orderBy: [{ product: 'asc' }],
    });
    const scrapNames: string[] = [];
    const otherNames: string[] = [];
    const seenProduct = new Set<string>();
    for (const p of productRows) {
      const name = (p.product ?? '').trim();
      if (!name) continue;
      const key = name.toUpperCase();
      if (seenProduct.has(key)) continue;
      seenProduct.add(key);
      (isScrapCategory(p.category) ? scrapNames : otherNames).push(name);
    }
    const manualProducts = isScrap ? [...scrapNames, ...otherNames] : [...otherNames, ...scrapNames];
    // Until a SCRAP-category product exists in the catalogue, keep pre-filling the
    // name the form has always used — otherwise scrap parties would suddenly get a
    // blank Product box. The moment one is added it takes over automatically.
    const LEGACY_SCRAP_PRODUCT = 'S.S. SCRAP';
    const defaultManualProduct = isScrap ? (scrapNames[0] ?? LEGACY_SCRAP_PRODUCT) : null;
    if (isScrap && !scrapNames.length && !manualProducts.includes(LEGACY_SCRAP_PRODUCT)) {
      manualProducts.unshift(LEGACY_SCRAP_PRODUCT);
    }

    const prefixCfg = await this.getPrefixSettings();
    return {
      code: await this.nextCode(prefixCfg.default, new Date()),
      prefix: prefixCfg.default,
      prefixes: prefixCfg.prefixes,
      customerId: customer?.id ?? null,
      customerName,
      billingAddress,
      category: customer?.category ?? null,
      paymentTerm: customer?.creditPeriod ?? null,
      transName,
      billingRate: customer?.billingRate ?? null,
      boxRate: customer?.boxRate ?? null,
      gst,
      freight,
      packing,
      pouch,
      // SCRAP parties are TCS-only — never surface TDS as applicable for them,
      // even if the customer record separately carries tdsApplicable.
      tdsApplicable: isScrap ? false : (customer?.tdsApplicable ?? false),
      tdsPercent: customer?.tdsPercent ?? null,
      isScrap,
      scrapGstRate: isScrap ? gstFor('SCRAP') : null,
      tcsPercent,
      manualProducts,
      defaultManualProduct,
      items,
    };
  }

  async create(dto: CreateChallanDto): Promise<ChallanDto> {
    const scrap = isScrapCategory(dto.category);
    const { tcsPercent } = await this.settings.getTcsPercent();
    const invDate = dto.invDate ? new Date(dto.invDate) : new Date();
    const cfg = await this.getPrefixSettings();
    const wanted = dto.prefix?.trim().toUpperCase();
    const prefix = wanted && cfg.prefixes.includes(wanted) ? wanted : cfg.default;
    // Number defaults to the next PREFIX/FY serial, but an operator can override it
    // (Form14 InvNo is a free-editable textbox) — a manually-typed number can skip
    // ahead, which is exactly what the Missing Challan tool tracks.
    const manualCode = dto.code?.trim().toUpperCase();
    const code = manualCode || (await this.nextCode(prefix, invDate));
    if (manualCode) await this.assertCodeAvailable(manualCode);
    await this.assertNotDuplicate(dto);
    const paymentTerm = dto.paymentTerm ?? null;
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : paymentTerm != null ? new Date(invDate.getTime() + paymentTerm * 86_400_000) : null;

    const row = await this.prisma.challan.create({
      data: {
        code,
        prefix,
        invDate,
        customerId: dto.customerId ?? null,
        customerName: dto.customerName.trim(),
        billingAddress: dto.billingAddress ?? null,
        shippingAddress: dto.shippingAddress ?? null,
        category: dto.category ?? null,
        paymentTerm,
        dueDate,
        transName: dto.transName ?? null,
        packing: dto.packing ?? null,
        freight: dto.freight ?? null,
        pouch: dto.pouch ?? null,
        tcs: dto.tcs ?? null,
        tcsPercent: scrap ? tcsPercent : null,
        tds: scrap ? null : (dto.tds ?? null),
        tdsPercent: scrap ? null : (dto.tdsPercent ?? null),
        tax: dto.tax ?? null,
        total: dto.total ?? null,
        b: dto.b ?? null,
        c: dto.c ?? null,
        remarks: dto.remarks ?? null,
        gst: dto.gst ?? null,
        billingRate: dto.billingRate ?? null,
        noBill: dto.noBill ?? false,
        challanStatus: dto.challanStatus ?? 'CONFIRMED',
        transaction: 'SALES INVOICE',
        items: {
          create: dto.items.map((it) => ({
            dispatchId: it.dispatchId ?? null,
            productName: it.productName ?? null,
            design: it.design ?? null,
            bags: it.bags ?? null,
            pcs: it.pcs ?? null,
            kgs: it.kgs ?? null,
            box: it.box ?? null,
            unit: it.unit ?? null,
            price: it.price ?? null,
            amount: it.amount ?? null,
            pCategory: it.pCategory ?? null,
            comment: it.comment ?? null,
          })),
        },
      },
      include: { items: true },
    });

    // A new challan removes its dispatched lines from the un-challaned pool —
    // ping open clients so their Pending Challan view refreshes live.
    this.notifications.emitPendingChallansChanged();
    await this.priceCommission(row.id);
    return this.map(row);
  }

  async findMany(q: ChallanQueryDto): Promise<Paginated<ChallanDto>> {
    const where = this.listWhere(q, await this.agentScope(q));
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.challan.findMany({ where, orderBy: [{ invDate: 'desc' }, { id: 'desc' }], skip: q.skip, take: q.pageSize, include: { items: true } }),
      this.prisma.challan.count({ where }),
    ]);
    return { items: rows.map((r) => this.map(r)), total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  /** KPI roll-up over the same filters as the list (ViewChallan KPI cards). */
  async summary(q: ChallanQueryDto): Promise<ChallanSummary> {
    const where = this.listWhere(q, await this.agentScope(q));
    // Aggregate over the whole filtered set (listWhere is filter-only — no
    // pagination), so the KPI rail reflects every matching challan, not the page.
    const [agg, byStatus, agentRows] = await Promise.all([
      this.prisma.challan.aggregate({
        where,
        _count: { _all: true },
        _sum: { total: true, b: true, c: true, tax: true, tds: true },
      }),
      this.prisma.challan.groupBy({ by: ['challanStatus'], where, _count: { _all: true } }),
      // Unfiltered — see `agents` on ChallanSummary for why.
      this.prisma.customer.findMany({
        distinct: ['agentName'],
        select: { agentName: true },
        where: { agentName: { not: null } },
      }),
    ]);
    const confirmed = byStatus.find((g) => g.challanStatus === 'CONFIRMED')?._count._all ?? 0;
    return {
      count: agg._count._all,
      totalSales: agg._sum.total ?? 0,
      totalB: agg._sum.b ?? 0,
      totalC: agg._sum.c ?? 0,
      totalTax: agg._sum.tax ?? 0,
      totalTds: agg._sum.tds ?? 0,
      confirmed,
      // Anything not CONFIRMED (CANCELLED, plus any legacy state) counts as cancelled.
      cancelled: agg._count._all - confirmed,
      agents: agentRows
        .map((r) => (r.agentName ?? '').trim())
        .filter((x) => x.length > 0)
        .sort((x, y) => x.localeCompare(y)),
    };
  }

  /** Rich analytics roll-up for the "Show KPI" modal — honours the list filters
   *  (search / date range / status) plus an optional customer category. */
  async analytics(q: ChallanQueryDto): Promise<ChallanAnalytics> {
    const where = this.listWhere(q, await this.agentScope(q));

    const [agg, byStatusRows, byCategoryRows, topPartyRows, overdueAgg, catRows, bagRows] = await Promise.all([
      this.prisma.challan.aggregate({
        where,
        _count: { _all: true },
        _sum: { total: true, b: true, c: true, tax: true, tds: true, tcs: true, freight: true, packing: true },
      }),
      this.prisma.challan.groupBy({ by: ['challanStatus'], where, _count: { _all: true }, _sum: { total: true } }),
      // Charges are on the CHALLAN, so they group with it; bags are on the LINES
      // and are summed separately below.
      this.prisma.challan.groupBy({
        by: ['category'],
        where,
        _count: { _all: true },
        _sum: { total: true, b: true, c: true, freight: true, packing: true },
      }),
      this.prisma.challan.groupBy({
        by: ['customerName'],
        where,
        _count: { _all: true },
        _sum: { total: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 10,
      }),
      this.prisma.challan.aggregate({
        where: { AND: [where, { challanStatus: 'CONFIRMED' }, { dueDate: { lt: new Date() } }] },
        _count: { _all: true },
        _sum: { total: true },
      }),
      // All distinct categories in the master (unfiltered) so the dropdown is stable.
      this.prisma.challan.findMany({ distinct: ['category'], select: { category: true }, where: { category: { not: null } } }),
      /*
       * Bags, per category.
       *
       * `bags` lives on the challan LINES while `category` lives on the header,
       * so there is no single groupBy for it — the lines are fetched with their
       * parent's category and folded in memory. Cheap: one column from each line
       * over the same filtered set the rest of this roll-up already scans.
       */
      this.prisma.challanItem.findMany({
        where: { challan: where },
        select: { bags: true, challan: { select: { category: true } } },
      })
    ]);

    const count = agg._count._all;
    const totalSales = agg._sum.total ?? 0;

    const bagsByCategory = new Map<string, number>();
    let totalBags = 0;
    for (const row of bagRows) {
      const n = row.bags ?? 0;
      if (!n) continue;
      const key = (row.challan?.category ?? '—') || '—';
      bagsByCategory.set(key, (bagsByCategory.get(key) ?? 0) + n);
      totalBags += n;
    }
    // Bags are recorded to two decimals on some lines; a fractional bag total
    // reads as a data error rather than a quantity, so round the reported figure.
    totalBags = Math.round(totalBags);
    const statusOf = (s: string) => byStatusRows.find((r) => (r.challanStatus ?? '').toUpperCase() === s);
    const confirmed = statusOf('CONFIRMED');
    const cancelled = statusOf('CANCELLED');

    return {
      totals: {
        count,
        totalSales,
        totalB: agg._sum.b ?? 0,
        totalC: agg._sum.c ?? 0,
        totalGst: agg._sum.tax ?? 0,
        totalTds: agg._sum.tds ?? 0,
        totalTcs: agg._sum.tcs ?? 0,
        totalFreight: agg._sum.freight ?? 0,
        totalPacking: agg._sum.packing ?? 0,
        totalBags,
        avgValue: count > 0 ? Math.round(totalSales / count) : 0,
      },
      byStatus: {
        confirmed: { count: confirmed?._count._all ?? 0, total: confirmed?._sum.total ?? 0 },
        cancelled: { count: cancelled?._count._all ?? 0, total: cancelled?._sum.total ?? 0 },
      },
      byCategory: byCategoryRows
        .map((r) => {
          const category = r.category ?? '—';
          return {
            category,
            count: r._count._all,
            total: r._sum.total ?? 0,
            b: r._sum.b ?? 0,
            c: r._sum.c ?? 0,
            freight: r._sum.freight ?? 0,
            packing: r._sum.packing ?? 0,
            bags: Math.round(bagsByCategory.get(category) ?? 0),
          };
        })
        .sort((a, b) => b.total - a.total),
      topParties: topPartyRows.map((r) => ({ customerName: r.customerName, count: r._count._all, total: r._sum.total ?? 0 })),
      overdue: { count: overdueAgg._count._all, total: overdueAgg._sum.total ?? 0 },
      trading: await this.tradingAccount(q),
      categories: catRows
        .map((r) => (r.category ?? '').trim())
        .filter((c) => c.length > 0)
        .sort((a, b) => a.localeCompare(b)),
    };
  }

  /**
   * Trading-account statement over the same filters as the KPI modal.
   *
   * Sales and debit notes both live in `challans` (separated by `transaction`),
   * returns live in `credit_notes`. Sales figures are GOODS values — the sum of
   * each document's line amounts — because a document's `total` already carries
   * freight, packing, GST and TCS/TDS, which the statement lists on their own
   * rows. Summing totals into "sales" is what makes the plain KPI card overstate
   * the trade.
   *
   * The credit-note side takes the range / category / customer filters but NOT
   * the challan status filter: credit notes have no cancelled state, so there is
   * nothing to match it against.
   */
  private async tradingAccount(q: ChallanQueryDto): Promise<TradingAccount> {
    const scope = await this.agentScope(q);
    const where = this.listWhere(q, scope);
    const goodsOf = (rows: { items: { amount: number | null }[] }[]) =>
      rows.reduce((sum, r) => sum + r.items.reduce((s, i) => s + (i.amount ?? 0), 0), 0);

    /** One listed note: its identity plus the goods value that feeds the row it
     *  sits under, so the list adds up to the figure above it. */
    const toNoteRows = (
      rows: { id: number; code: string; customerName: string; invDate: Date; items: { amount: number | null }[] }[],
    ): TradingNoteRow[] =>
      rows.map((r) => ({
        id: r.id,
        code: r.code,
        customerName: r.customerName,
        amount: r2(r.items.reduce((sum, i) => sum + (i.amount ?? 0), 0)),
        date: r.invDate.toISOString(),
      }));

    // Credit notes share the challan filters except status (see doc comment).
    const cnWhere: Prisma.CreditNoteWhereInput = {};
    if (q.category?.trim()) cnWhere.category = q.category.trim();
    if (q.dateFrom) {
      const from = new Date(q.dateFrom);
      from.setHours(0, 0, 0, 0);
      cnWhere.invDate = { ...(cnWhere.invDate as object), gte: from };
    }
    if (q.dateTo) {
      const to = new Date(q.dateTo);
      to.setHours(23, 59, 59, 999);
      cnWhere.invDate = { ...(cnWhere.invDate as object), lte: to };
    }
    const search = q.search?.trim();
    if (search) cnWhere.OR = [{ code: { contains: search } }, { customerName: { contains: search } }];

    const isDebitNote: Prisma.ChallanWhereInput = { OR: [{ transaction: 'DEBIT NOTE' }, { prefix: { startsWith: 'DN' } }] };
    const salesWhere: Prisma.ChallanWhereInput = { AND: [where, { NOT: isDebitNote }] };
    const dnWhere: Prisma.ChallanWhereInput = { AND: [where, isDebitNote] };

    // Charge/tax columns come back with the items so each document's stored total
    // can be checked against its own components in the same pass (see
    // `documentsOutOfLine`) — an aggregate alone cannot see per-document drift.
    const docSelect = {
      freight: true,
      packing: true,
      pouch: true,
      tax: true,
      tcs: true,
      tds: true,
      total: true,
      items: { select: { amount: true } },
    } as const;
    /* Debit notes are listed, not just counted, so they carry their identity too
     * — and `id`, because the row links straight to the document. */
    const noteSelect = { id: true, code: true, customerName: true, invDate: true, items: { select: { amount: true } } } as const;
    const NOTE_CAP = 200;
    const [salesRows, dnRows, cnRows, dnDocs, cnDocs, challanAgg, cnAgg, cancelledAgg] = await Promise.all([
      this.prisma.challan.findMany({ where: salesWhere, select: docSelect }),
      this.prisma.challan.findMany({ where: dnWhere, select: docSelect }),
      this.prisma.creditNote.findMany({ where: cnWhere, select: { items: { select: { amount: true } } } }),
      this.prisma.challan.findMany({ where: dnWhere, select: noteSelect, orderBy: { invDate: 'desc' }, take: NOTE_CAP + 1 }),
      this.prisma.creditNote.findMany({ where: cnWhere, select: noteSelect, orderBy: { invDate: 'desc' }, take: NOTE_CAP + 1 }),
      this.prisma.challan.aggregate({ where, _sum: { freight: true, packing: true, pouch: true, tax: true, tcs: true, tds: true, total: true } }),
      this.prisma.creditNote.aggregate({ where: cnWhere, _sum: { freight: true, packing: true, pouch: true, tax: true, total: true } }),
      // Always measured, whatever the status filter is — the UI states plainly
      // whether cancelled documents are inside these figures or outside them.
      this.prisma.challan.aggregate({
        where: { AND: [this.listWhere({ ...q, status: undefined } as ChallanQueryDto, scope), { challanStatus: 'CANCELLED' }] },
        _count: { _all: true },
        _sum: { total: true },
      }),
    ]);

    const grossSales = r2(goodsOf(salesRows));
    const debitNotes = r2(goodsOf(dnRows));
    const salesReturns = r2(goodsOf(cnRows));
    const netSales = r2(grossSales + debitNotes - salesReturns);
    const freight = r2(n(challanAgg._sum.freight) - n(cnAgg._sum.freight));
    const packing = r2(n(challanAgg._sum.packing) - n(cnAgg._sum.packing));
    const pouch = r2(n(challanAgg._sum.pouch) - n(cnAgg._sum.pouch));
    const netRevenue = r2(netSales + freight + packing + pouch);
    const gst = r2(n(challanAgg._sum.tax) - n(cnAgg._sum.tax));
    const tcs = r2(n(challanAgg._sum.tcs));
    const tds = r2(n(challanAgg._sum.tds));

    const totalSales = r2(n(challanAgg._sum.total));
    const grossGst = r2(n(challanAgg._sum.tax));
    const grossCharges = r2(n(challanAgg._sum.freight) + n(challanAgg._sum.packing) + n(challanAgg._sum.pouch));
    const grossTcs = r2(n(challanAgg._sum.tcs));
    const goodsInvoiced = r2(grossSales + debitNotes);

    return {
      totalSales: { amount: totalSales, count: salesRows.length + dnRows.length },
      grossGst,
      grossCharges,
      grossTcs,
      goodsInvoiced,
      openingVariance: r2(totalSales - grossGst - grossCharges - grossTcs - goodsInvoiced),
      grossSales: { amount: grossSales, count: salesRows.length },
      debitNotes: { amount: debitNotes, count: dnRows.length },
      salesReturns: { amount: salesReturns, count: cnRows.length },
      debitNoteList: toNoteRows(dnDocs.slice(0, NOTE_CAP)),
      creditNoteList: toNoteRows(cnDocs.slice(0, NOTE_CAP)),
      debitNotesTruncated: dnDocs.length > NOTE_CAP,
      creditNotesTruncated: cnDocs.length > NOTE_CAP,
      netSales,
      freight,
      packing,
      pouch,
      netRevenue,
      gst,
      tcs,
      tds,
      totalInvoiced: r2(netRevenue + gst + tcs - tds),
      returnRatePercent: grossSales > 0 ? r2((salesReturns / grossSales) * 100) : 0,
      documentTotal: r2(n(challanAgg._sum.total) - n(cnAgg._sum.total)),
      documentsOutOfLine: [...salesRows, ...dnRows].filter((d) => {
        const goods = d.items.reduce((s, i) => s + (i.amount ?? 0), 0);
        return Math.abs(n(d.total) - (goods + n(d.freight) + n(d.packing) + n(d.pouch) + n(d.tax) + n(d.tcs) - n(d.tds))) > 1;
      }).length,
      statusScope: (q.status ?? '').toUpperCase(),
      cancelled: { amount: r2(n(cancelledAgg._sum.total)), count: cancelledAgg._count._all },
    };
  }

  /** Every challan (with line items) matching the list filters — no pagination.
   *  Feeds the client-side "Get Report by" Excel exports (Detailed / Summary). */
  async exportAll(q: ChallanQueryDto): Promise<{ items: ChallanDto[] }> {
    const rows = await this.prisma.challan.findMany({
      where: this.listWhere(q, await this.agentScope(q)),
      orderBy: [{ invDate: 'desc' }, { id: 'desc' }],
      include: { items: true },
    });
    return { items: rows.map((r) => this.map(r)) };
  }

  async findOne(id: number): Promise<ChallanDto> {
    const row = await this.prisma.challan.findUnique({ where: { id }, include: { items: true } });
    if (!row) throw new NotFoundException('Challan not found');
    return this.map(row);
  }

  /** By invoice number. Lets a screen holding only a Ref Inv (the Credit/Debit
   *  Note lines) pull up the sale it refers to without tracking its row id. */
  async findByCode(code: string): Promise<ChallanDto> {
    const row = await this.prisma.challan.findUnique({ where: { code }, include: { items: true } });
    if (!row) throw new NotFoundException('Challan not found');
    return this.map(row);
  }

  /** Customer GST-by-category + freight/packing rate resolver (Form14 grid subqueries). */
  /**
   * Rate resolvers for MANY parties at once.
   *
   * The pending list spans customers and is paginated, so calling
   * {@link rateMaps} per line would be an N+1. This stays three queries no
   * matter the page size. Resolution rules mirror `rateMaps` exactly — including
   * preferring the party's own transport for freight/packing.
   */
  private async rateMapsMulti(customerNames: string[]) {
    const names = [...new Set(customerNames.filter(Boolean))];
    const [gstRates, transRates, customers] = names.length
      ? await Promise.all([
          this.prisma.gstRate.findMany({ where: { customerName: { in: names } } }),
          this.prisma.transRate.findMany({ where: { customerName: { in: names }, type: { in: ['FREIGHT', 'PACKING'] } } }),
          this.prisma.customer.findMany({ where: { partyName: { in: names } }, select: { partyName: true, transportName: true } }),
        ])
      : [[], [], []];

    const transNameBy = new Map(customers.map((c) => [c.partyName, c.transportName ?? null]));
    const gstByCust = new Map<string, Map<string, number>>();
    for (const g of gstRates) {
      const m = gstByCust.get(g.customerName) ?? new Map<string, number>();
      m.set((g.category ?? '').toUpperCase(), n(g.rate));
      gstByCust.set(g.customerName, m);
    }
    const transByCust = new Map<string, typeof transRates>();
    for (const t of transRates) {
      const arr = transByCust.get(t.customerName) ?? [];
      arr.push(t);
      transByCust.set(t.customerName, arr);
    }

    return {
      gstFor: (cust: string, cat: string): number | null => {
        const m = gstByCust.get(cust);
        return m?.has(cat) ? m.get(cat)! : null;
      },
      rateFor: (cust: string, cat: string, type: string): number | null => {
        const transName = transNameBy.get(cust);
        const matches = (transByCust.get(cust) ?? []).filter((t) => (t.category ?? '').toUpperCase() === cat && t.type === type);
        const preferred = matches.find((t) => transName && t.transportName === transName) ?? matches[0];
        return preferred ? n(preferred.rate) : null;
      },
    };
  }

  private async rateMaps(customerName: string, transName: string | null) {
    const [gstRates, transRates] = await Promise.all([
      this.prisma.gstRate.findMany({ where: { customerName } }),
      this.prisma.transRate.findMany({ where: { customerName, type: { in: ['FREIGHT', 'PACKING'] } } }),
    ]);
    const gstByCat = new Map(gstRates.map((g) => [(g.category ?? '').toUpperCase(), n(g.rate)]));
    // null = no master row at all for this category (+ transport, for freight/packing)
    // — genuinely unconfigured, distinct from a configured rate of 0.
    const gstFor = (cat: string): number | null => (gstByCat.has(cat) ? gstByCat.get(cat)! : null);
    const rateFor = (cat: string, type: string): number | null => {
      const matches = transRates.filter((t) => (t.category ?? '').toUpperCase() === cat && t.type === type);
      const preferred = matches.find((t) => transName && t.transportName === transName) ?? matches[0];
      return preferred ? n(preferred.rate) : null;
    };
    return { gstByCat, gstFor, rateFor };
  }

  /** Everything the form needs to EDIT a saved challan: the stored challan, the
   *  customer's still-available pool (to add more), and the saved lines re-priced
   *  with per-line rates (Form14 SearchBtn load). */
  async editContext(id: number): Promise<{ challan: ChallanDto; draft: ChallanDraft; rows: ChallanDraftItem[] }> {
    const challan = await this.findOne(id);
    const draft = await this.draft({ customerName: challan.customerName });
    const customer = await this.prisma.customer.findFirst({ where: { partyName: challan.customerName } });
    const { gstFor, rateFor } = await this.rateMaps(challan.customerName, customer?.transportName ?? null);

    const dispIds = challan.items.map((i) => i.dispatchId).filter((x): x is number => x != null);
    const disp = dispIds.length ? await this.prisma.dispatch.findMany({ where: { id: { in: dispIds } }, select: { id: true, pCategory: true, orderItemId: true } }) : [];
    const catById = new Map(disp.map((d) => [d.id, d.pCategory ?? '']));
    // For the item-photos viewer on Modify Challan — a challan line only stores
    // its source dispatchId, so its order line is resolved via that dispatch.
    const orderItemIdById = new Map(disp.map((d) => [d.id, d.orderItemId]));

    const rows: ChallanDraftItem[] = challan.items.map((it) => {
      const cat = (it.pCategory || (it.dispatchId != null ? catById.get(it.dispatchId) : '') || '').toUpperCase();
      return {
        dispatchId: it.dispatchId,
        orderItemId: it.dispatchId != null ? (orderItemIdById.get(it.dispatchId) ?? null) : null,
        orderId: null,
        orderCode: null,
        productName: it.productName,
        design: it.design,
        bags: it.bags,
        pcs: it.pcs,
        kgs: it.kgs,
        box: it.box,
        unit: it.unit,
        price: it.price,
        amount: it.amount ?? 0,
        pCategory: it.pCategory,
        comment: it.comment,
        gstRate: gstFor(cat) ?? n(challan.gst),
        freightRate: rateFor(cat, 'FREIGHT'),
        packingRate: rateFor(cat, 'PACKING'),
      };
    });
    return { challan, draft, rows };
  }

  /** Replace a saved challan's header + lines (invoice no is preserved). */
  async update(id: number, dto: CreateChallanDto): Promise<ChallanDto> {
    const existing = await this.prisma.challan.findUnique({ where: { id }, select: { id: true, code: true } });
    if (!existing) throw new NotFoundException('Challan not found');
    const scrap = isScrapCategory(dto.category);
    const { tcsPercent } = await this.settings.getTcsPercent();
    const invDate = dto.invDate ? new Date(dto.invDate) : undefined;
    const paymentTerm = dto.paymentTerm ?? null;
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : paymentTerm != null && invDate ? new Date(invDate.getTime() + paymentTerm * 86_400_000) : null;

    // The invoice number stays editable after save too (matches the legacy
    // InvNo textbox) — renumbering an existing challan just needs the new
    // number to not already belong to a different one.
    const manualCode = dto.code?.trim().toUpperCase();
    const code = manualCode && manualCode !== existing.code ? manualCode : undefined;
    if (code) await this.assertCodeAvailable(code, id);
    // Exclude the challan being edited, or every save would flag itself.
    await this.assertNotDuplicate(dto, id);

    await this.prisma.$transaction([
      this.prisma.challanItem.deleteMany({ where: { challanId: id } }),
      this.prisma.challan.update({
        where: { id },
        data: {
          ...(code ? { code } : {}),
          ...(invDate ? { invDate } : {}),
          customerName: dto.customerName.trim(),
          billingAddress: dto.billingAddress ?? null,
          shippingAddress: dto.shippingAddress ?? null,
          category: dto.category ?? null,
          paymentTerm,
          dueDate,
          transName: dto.transName ?? null,
          packing: dto.packing ?? null,
          freight: dto.freight ?? null,
          pouch: dto.pouch ?? null,
          tcs: dto.tcs ?? null,
          tcsPercent: scrap ? tcsPercent : null,
          tds: scrap ? null : (dto.tds ?? null),
          tdsPercent: scrap ? null : (dto.tdsPercent ?? null),
          tax: dto.tax ?? null,
          total: dto.total ?? null,
          b: dto.b ?? null,
          c: dto.c ?? null,
          remarks: dto.remarks ?? null,
          gst: dto.gst ?? null,
          billingRate: dto.billingRate ?? null,
          noBill: dto.noBill ?? false,
          challanStatus: dto.challanStatus ?? 'CONFIRMED',
          items: {
            create: dto.items.map((it) => ({
              dispatchId: it.dispatchId ?? null,
              productName: it.productName ?? null,
              design: it.design ?? null,
              bags: it.bags ?? null,
              pcs: it.pcs ?? null,
              kgs: it.kgs ?? null,
              box: it.box ?? null,
              unit: it.unit ?? null,
              price: it.price ?? null,
              amount: it.amount ?? null,
              pCategory: it.pCategory ?? null,
              comment: it.comment ?? null,
            })),
          },
        },
      }),
    ]);
    // Edited lines may add/remove dispatches from the pool → refresh open views.
    this.notifications.emitPendingChallansChanged();
    // Editing the lines changes the quantities commission is calculated on.
    await this.priceCommission(id);
    return this.findOne(id);
  }

  async updateStatus(id: number, status: string): Promise<ChallanDto> {
    await this.findOne(id);
    const row = await this.prisma.challan.update({ where: { id }, data: { challanStatus: status.toUpperCase() }, include: { items: true } });
    // Cancelling/reinstating a challan moves its lines out of / back into the pool.
    this.notifications.emitPendingChallansChanged();
    // Only a CONFIRMED invoice earns commission, so cancelling must clear what
    // it accrued and reinstating must put it back. rebuildForChallan does both.
    await this.priceCommission(id);
    return this.map(row);
  }

  /**
   * Keep this invoice's agent commission in step with it.
   *
   * Commission is a consequence of the invoice, so it is derived here rather
   * than waiting for someone to press a "re-price" button — a button is a step
   * that can be skipped, and skipping it leaves settlements paying on
   * quantities the invoice no longer has.
   *
   * Deliberately swallowed on failure: commission is downstream bookkeeping, and
   * it must never be the reason a challan cannot be saved. A rate change
   * re-prices from the other direction anyway, so a miss here is self-healing.
   */
  private async priceCommission(challanId: number): Promise<void> {
    try {
      await this.commission.rebuildForChallan(challanId);
    } catch {
      /* the invoice is what matters here */
    }
  }

  async remove(id: number): Promise<{ id: number }> {
    await this.findOne(id);
    await this.prisma.challan.delete({ where: { id } }); // items cascade
    // Deleting a challan returns its dispatched lines to the un-challaned pool.
    this.notifications.emitPendingChallansChanged();
    return { id };
  }

  /** Distinct product names that appear on any challan line (ViewItemChallan sidebar). */
  async itemNames(search?: string): Promise<string[]> {
    const rows = await this.prisma.challanItem.findMany({
      where: { productName: { not: null }, ...(search?.trim() ? { productName: { contains: search.trim() } } : {}) },
      select: { productName: true },
      distinct: ['productName'],
      orderBy: { productName: 'asc' },
      take: 500,
    });
    return rows.map((r) => r.productName!).filter(Boolean);
  }

  /** Every challan line for a product, newest first (ViewItemChallan detail grid). */
  async itemHistory(q: ItemHistoryQueryDto): Promise<Paginated<ChallanItemHistoryRow>> {
    const product = q.product?.trim();
    if (!product) return { items: [], total: 0, page: q.page, pageSize: q.pageSize, totalPages: 1 };
    const where: Prisma.ChallanItemWhereInput = { productName: product };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.challanItem.findMany({
        where,
        orderBy: [{ challan: { invDate: 'desc' } }, { id: 'desc' }],
        skip: q.skip,
        take: q.pageSize,
        include: { challan: { select: { id: true, code: true, invDate: true, customerName: true } } },
      }),
      this.prisma.challanItem.count({ where }),
    ]);
    const items: ChallanItemHistoryRow[] = rows.map((r) => {
      const unit = (r.unit ?? '').toUpperCase();
      const qty = unit === 'KGS' || unit === 'KG' || unit === 'KGS.' ? n(r.kgs) : n(r.pcs);
      return {
        id: r.id,
        challanId: r.challan.id,
        code: r.challan.code,
        invDate: r.challan.invDate.toISOString(),
        customerName: r.challan.customerName,
        productName: r.productName,
        design: r.design,
        qty,
        unit: r.unit,
        price: r.price,
        amount: r.amount,
      };
    });
    return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  /**
   * The parties belonging to one agent, or null when no agent is being filtered.
   *
   * A challan records the party it was raised for, not that party's agent — the
   * agent lives on the customer master and can be reassigned — so filtering by
   * agent means resolving their customers first and matching the challan
   * against those. Read once per request and handed to `listWhere`, which stays
   * synchronous because it is called from inside transaction arrays.
   *
   * Matched on id OR name: `customerId` is nullable and older challans carry
   * only the name, so keying on either alone would quietly drop rows.
   */
  private async agentScope(q: ChallanQueryDto): Promise<AgentScope> {
    const agent = q.agent?.trim();
    if (!agent) return null;
    const rows = await this.prisma.customer.findMany({
      where: { agentName: agent },
      select: { id: true, partyName: true },
    });
    return {
      ids: rows.map((r) => r.id),
      names: rows.map((r) => r.partyName ?? '').filter(Boolean),
    };
  }

  private listWhere(q: ChallanQueryDto, scope: AgentScope = null): Prisma.ChallanWhereInput {
    const and: Prisma.ChallanWhereInput[] = [];
    if (q.status) and.push({ challanStatus: q.status.toUpperCase() });
    if (q.category?.trim()) and.push({ category: q.category.trim() });
    if (scope) {
      and.push({ OR: [{ customerId: { in: scope.ids } }, { customerName: { in: scope.names } }] });
    }
    if (q.dateFrom) {
      const from = new Date(q.dateFrom);
      from.setHours(0, 0, 0, 0);
      and.push({ invDate: { gte: from } });
    }
    if (q.dateTo) {
      const to = new Date(q.dateTo);
      to.setHours(23, 59, 59, 999);
      and.push({ invDate: { lte: to } });
    }
    const search = q.search?.trim();
    if (search) and.push({ OR: [{ code: { contains: search } }, { customerName: { contains: search } }] });
    return and.length ? { AND: and } : {};
  }

  async challanPdf(id: number): Promise<{ buffer: Buffer; filename: string }> {
    const challan = await this.findOne(id);
    const logoRow = await this.prisma.appConfig.findUnique({ where: { key: 'COMPANY_LOGO' } });
    const buffer = await this.pdf.render(this.buildChallanDoc(challan, logoRow?.value ?? null));
    return { buffer, filename: `${(challan.code || `challan-${id}`).replace(/[\\/:*?"<>|]/g, '-')}.pdf` };
  }

  async generateChallanBillPdf(id: number): Promise<{ buffer: Buffer; filename: string }> {
    const challan = await this.findOne(id);
    let companyName = 'KAVISH';
    let terms: string[] = [];
    let logo: string | null = null;

    try {
      const companyRow = await this.prisma.appConfig.findUnique({ where: { key: 'COMPANY_PROFILE' } });
      if (companyRow?.value) {
        const parsed = JSON.parse(companyRow.value);
        companyName = parsed.name || 'KAVISH';
      }
    } catch (e) {
      // Silently use default
    }

    try {
      const termsRow = await this.prisma.appConfig.findUnique({ where: { key: 'CHALLAN_TERMS' } });
      if (termsRow?.value) {
        const parsed = JSON.parse(termsRow.value);
        terms = parsed.terms || [];
      }
    } catch (e) {
      // Silently use default
    }

    try {
      const logoRow = await this.prisma.appConfig.findUnique({ where: { key: 'COMPANY_LOGO' } });
      logo = logoRow?.value ?? null;
    } catch (e) {
      // Silently use default
    }

    const buffer = await this.pdf.render(this.buildChallanBillDoc(challan, logo, companyName, terms));
    const stamp = new Date().toISOString().slice(0, 10);
    return { buffer, filename: `Challan_${(challan.code || `challan-${id}`).replace(/[\\/:*?"<>|]/g, '-')}_${stamp}.pdf` };
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Indian fiscal-year label for a date, e.g. 2026-06 → "26-27" (Apr–Mar). */
  private fyLabel(d: Date): string {
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`;
  }

  /** Next challan number for a prefix + date: PREFIX/FY/serial (e.g. SSS/26-27/1),
   *  serial = 1 + the max serial already used for that PREFIX/FY series. Old imported
   *  codes in other formats simply don't match the series, so the new run starts clean. */
  private async nextCode(prefix: string, date: Date): Promise<string> {
    const full = `${prefix.trim().toUpperCase()}/${this.fyLabel(date)}`;
    const rows = await this.prisma.challan.findMany({ where: { code: { startsWith: `${full}/` } }, select: { code: true } });
    let max = 0;
    for (const r of rows) {
      const n = parseInt((r.code ?? '').slice(full.length + 1), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `${full}/${max + 1}`;
  }

  /** Configured challan prefixes (Settings). Falls back to a single "SSS". */
  async getPrefixSettings(): Promise<{ prefixes: string[]; default: string }> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: PREFIX_KEY } });
    if (row?.value) {
      try {
        const p = JSON.parse(row.value);
        const prefixes = [...new Set((Array.isArray(p.prefixes) ? p.prefixes : []).map((x: unknown) => String(x).trim().toUpperCase()).filter(Boolean))] as string[];
        if (prefixes.length) {
          const def = typeof p.default === 'string' && prefixes.includes(p.default.toUpperCase()) ? p.default.toUpperCase() : prefixes[0];
          return { prefixes, default: def };
        }
      } catch {
        /* fall through to default */
      }
    }
    return { prefixes: [FALLBACK_PREFIX], default: FALLBACK_PREFIX };
  }

  async savePrefixSettings(input: { prefixes: string[]; default?: string }): Promise<{ prefixes: string[]; default: string }> {
    const prefixes = [...new Set((input.prefixes ?? []).map((p) => String(p).trim().toUpperCase()).filter((p) => /^[A-Z0-9]{1,10}$/.test(p)))];
    if (!prefixes.length) throw new BadRequestException('Add at least one prefix (letters/digits, up to 10 chars).');
    const def = input.default && prefixes.includes(input.default.trim().toUpperCase()) ? input.default.trim().toUpperCase() : prefixes[0];
    const value = JSON.stringify({ prefixes, default: def });
    await this.prisma.appConfig.upsert({ where: { key: PREFIX_KEY }, update: { value }, create: { key: PREFIX_KEY, value } });
    return { prefixes, default: def };
  }

  /** Preview the next number for a prefix + date (form invoice-no field). */
  async previewNextCode(prefix?: string, dateStr?: string): Promise<{ code: string }> {
    const { prefixes, default: def } = await this.getPrefixSettings();
    const p = prefix && prefixes.includes(prefix.trim().toUpperCase()) ? prefix.trim().toUpperCase() : def;
    const date = dateStr ? new Date(dateStr) : new Date();
    return { code: await this.nextCode(p, isNaN(date.getTime()) ? new Date() : date) };
  }

  /** Rejects a manually-typed invoice number that's already used by another challan. */
  private async assertCodeAvailable(code: string, excludeId?: number): Promise<void> {
    const dup = await this.prisma.challan.findUnique({ where: { code }, select: { id: true } });
    if (dup && dup.id !== excludeId) throw new BadRequestException(`Invoice number "${code}" is already used by another challan.`);
  }

  // ── Near-duplicate detection ────────────────────────────────────────────────
  // A lost response over the shop's VPN looks exactly like a failed save, so an
  // operator re-enters a challan that is already in the database. The invoice
  // number only catches it when typed by hand — an auto-assigned retry sails
  // through. So compare the CONTENT: same party, same invoice date, same lines,
  // same totals. Deliberately NOT keyed on the invoice number, which is the one
  // field a genuine re-entry is guaranteed to differ on.

  /** 2dp compare — totals are money, and float noise must not hide a match. */
  private static sameMoney(a: number | null | undefined, b: number | null | undefined): boolean {
    return Math.round(n(a) * 100) === Math.round(n(b) * 100);
  }

  /** True when a saved challan's lines and totals match the incoming payload.
   *  Lines are matched as a MULTISET — reordering the same goods is still the
   *  same challan, but a repeated line must be consumed only once. */
  private contentMatches(
    saved: { total: number | null; b: number | null; c: number | null; items: { productName: string | null; design: string | null; bags: number | null; pcs: number | null; kgs: number | null; box: number | null; price: number | null; amount: number | null }[] },
    dto: CreateChallanDto,
  ): boolean {
    const S = ChallansService;
    if (!S.sameMoney(saved.total, dto.total) || !S.sameMoney(saved.b, dto.b) || !S.sameMoney(saved.c, dto.c)) return false;
    const incoming = dto.items ?? [];
    if (saved.items.length !== incoming.length) return false;
    const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
    const unmatched = [...saved.items];
    for (const line of incoming) {
      const idx = unmatched.findIndex(
        (s) =>
          norm(s.productName) === norm(line.productName) &&
          norm(s.design) === norm(line.design) &&
          S.sameMoney(s.bags, line.bags) &&
          S.sameMoney(s.pcs, line.pcs) &&
          S.sameMoney(s.kgs, line.kgs) &&
          S.sameMoney(s.box, line.box) &&
          S.sameMoney(s.price, line.price) &&
          S.sameMoney(s.amount, line.amount),
      );
      if (idx === -1) return false;
      unmatched.splice(idx, 1);
    }
    return true;
  }

  /** The already-saved challan this payload duplicates, or null. Scoped to the
   *  same party and the same invoice DAY — accidental re-entry is always
   *  same-day, and a wider window would nag on regular repeat orders. */
  private async findDuplicate(dto: CreateChallanDto, excludeId?: number) {
    const customerName = dto.customerName?.trim();
    if (!customerName) return null;
    const day = dto.invDate ? new Date(dto.invDate) : new Date();
    if (Number.isNaN(day.getTime())) return null;
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const end = new Date(start.getTime() + 86_400_000);

    const candidates = await this.prisma.challan.findMany({
      where: {
        customerName: { equals: customerName },
        invDate: { gte: start, lt: end },
        // Re-entering after a cancellation is legitimate, not a duplicate.
        challanStatus: { not: 'CANCELLED' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      include: { items: true },
    });
    return candidates.find((c) => this.contentMatches(c, dto)) ?? null;
  }

  /** Throws 409 when this payload duplicates an existing challan, unless the
   *  operator already confirmed. Detection failing must never block invoicing,
   *  so any unexpected error here lets the save through. */
  private async assertNotDuplicate(dto: CreateChallanDto, excludeId?: number): Promise<void> {
    if (dto.confirmDuplicate) return;
    let match: Awaited<ReturnType<typeof this.findDuplicate>> = null;
    try {
      match = await this.findDuplicate(dto, excludeId);
    } catch {
      return; // fail open
    }
    if (!match) return;
    throw new ConflictException({
      message: `A matching challan already exists — ${match.code} for ${match.customerName}, same items and total.`,
      error: 'DUPLICATE_CHALLAN',
      duplicate: {
        id: match.id,
        code: match.code,
        customerName: match.customerName,
        invDate: match.invDate.toISOString(),
        total: n(match.total),
      },
    });
  }

  // ── Missing Challan (legacy MissingChallanForm) ─────────────────────────────
  // Free-editable invoice numbers can skip ahead, leaving gaps in a PREFIX/FY
  // series (e.g. #44 then #46, #45 never issued). This surfaces those gaps so
  // an operator can either notice a genuine mistake or "dismiss" an intentional
  // skip (e.g. voided by hand) — dismissals are reversible ("restore").

  /** Every FY that has a challan under this prefix, newest first, plus the current
   *  calendar FY (always offered even with nothing filed yet) and the FY of the most
   *  recently created ("last built") invoice — the sensible default series to check,
   *  since right after a fiscal-year rollover "today's FY" can still be empty while
   *  the previous year's series is the one that actually needs reviewing. */
  async missingChallanFys(prefix: string): Promise<{ fys: string[]; current: string; lastBuilt: string }> {
    const p = prefix.trim().toUpperCase();
    const current = this.fyLabel(new Date());
    const rows = await this.prisma.challan.findMany({
      where: { code: { startsWith: `${p}/` } },
      select: { code: true },
      orderBy: { createdAt: 'desc' },
    });
    const fys = new Set<string>([current]);
    let lastBuilt = current;
    let sawAny = false;
    for (const r of rows) {
      const m = /^([^/]+)\/([^/]+)\//.exec(r.code);
      if (!m) continue;
      fys.add(m[2]);
      if (!sawAny) {
        lastBuilt = m[2]; // rows are newest-created first, so the first match is the last built
        sawAny = true;
      }
    }
    return { fys: [...fys].sort().reverse(), current, lastBuilt };
  }

  /** Gap (or, in deletedOnly mode, dismissed-gap) invoice numbers for one PREFIX/FY series. */
  async missingChallanList(prefix: string, fy: string, deletedOnly: boolean): Promise<{ code: string; invNo: number; reason?: string | null }[]> {
    const p = prefix.trim().toUpperCase();
    const f = fy.trim();
    const full = `${p}/${f}`;

    const dismissed = await this.currentlyDismissedMap(p, f);

    if (deletedOnly) {
      return [...dismissed.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([invNo, info]) => ({ code: `${full}/${invNo}`, invNo, reason: info.reason }));
    }

    const rows = await this.prisma.challan.findMany({ where: { code: { startsWith: `${full}/` } }, select: { code: true } });
    const present = new Set<number>();
    for (const r of rows) {
      const n = parseInt(r.code.slice(full.length + 1), 10);
      if (Number.isFinite(n)) present.add(n);
    }
    if (present.size === 0) return [];
    const min = Math.min(...present);
    const max = Math.max(...present);
    const missing: { code: string; invNo: number }[] = [];
    for (let i = min; i <= max; i++) {
      if (!present.has(i) && !dismissed.has(i)) missing.push({ code: `${full}/${i}`, invNo: i });
    }
    return missing;
  }

  /** Acknowledge a gap so it stops showing on the missing list ("delete from list").
   *  A reason is required — kept on record so "Show Deleted Only" means something later. */
  async dismissMissingChallan(prefix: string, fy: string, invNo: number, reason?: string): Promise<void> {
    const trimmedReason = reason?.trim();
    if (!trimmedReason) throw new BadRequestException('A reason is required to dismiss a missing invoice number.');
    await this.prisma.challanMissingLog.create({
      data: { prefix: prefix.trim().toUpperCase(), fy: fy.trim(), invNo, deletedAt: new Date(), reason: trimmedReason },
    });
  }

  /** Undo a dismissal, bringing the gap back onto the missing list. */
  async restoreMissingChallan(prefix: string, fy: string, invNo: number): Promise<void> {
    const p = prefix.trim().toUpperCase();
    const f = fy.trim();
    const row = await this.prisma.challanMissingLog.findFirst({
      where: { prefix: p, fy: f, invNo, recycledAt: null },
      orderBy: { deletedAt: 'desc' },
    });
    if (!row) throw new BadRequestException('Nothing to restore — it may already be restored.');
    await this.prisma.challanMissingLog.update({ where: { id: row.id }, data: { recycledAt: new Date() } });
  }

  /** Numbers whose latest dismissal hasn't been restored yet, with the reason it was dismissed for. */
  private async currentlyDismissedMap(prefix: string, fy: string): Promise<Map<number, { reason: string | null }>> {
    const rows = await this.prisma.challanMissingLog.findMany({
      where: { prefix, fy },
      select: { invNo: true, deletedAt: true, recycledAt: true, reason: true },
      orderBy: { deletedAt: 'asc' },
    });
    const latest = new Map<number, { deletedAt: Date; recycledAt: Date | null; reason: string | null }>();
    for (const r of rows) {
      const prev = latest.get(r.invNo);
      if (!prev || r.deletedAt >= prev.deletedAt) latest.set(r.invNo, r);
    }
    const open = new Map<number, { reason: string | null }>();
    for (const [invNo, r] of latest) {
      if (!r.recycledAt || r.recycledAt < r.deletedAt) open.set(invNo, { reason: r.reason });
    }
    return open;
  }

  private map(row: Prisma.ChallanGetPayload<{ include: { items: true } }>): ChallanDto {
    return {
      id: row.id,
      code: row.code,
      prefix: row.prefix,
      invDate: row.invDate.toISOString(),
      customerId: row.customerId,
      customerName: row.customerName,
      billingAddress: row.billingAddress,
      shippingAddress: row.shippingAddress,
      category: row.category,
      paymentTerm: row.paymentTerm,
      dueDate: row.dueDate ? row.dueDate.toISOString() : null,
      transName: row.transName,
      packing: row.packing,
      freight: row.freight,
      pouch: row.pouch,
      tcs: row.tcs,
      tcsPercent: row.tcsPercent,
      tds: row.tds,
      tdsPercent: row.tdsPercent,
      tax: row.tax,
      total: row.total,
      b: row.b,
      c: row.c,
      remarks: row.remarks,
      gst: row.gst,
      billingRate: row.billingRate,
      noBill: row.noBill,
      transaction: row.transaction,
      challanStatus: (row.challanStatus as ChallanDto['challanStatus']) ?? 'CONFIRMED',
      userName: row.userName,
      items: row.items.map((it) => ({
        id: it.id,
        challanId: it.challanId,
        dispatchId: it.dispatchId,
        productName: it.productName,
        design: it.design,
        bags: it.bags,
        pcs: it.pcs,
        kgs: it.kgs,
        box: it.box,
        unit: it.unit,
        price: it.price,
        amount: it.amount,
        pCategory: it.pCategory,
        comment: it.comment,
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** `logo` is the uploaded Settings → "Company branding" image as a base64 data
   *  URL, or null if none has been uploaded yet. */
  private buildChallanBillDoc(c: ChallanDto, logo: string | null, companyName: string, terms: string[]): TDocumentDefinitions {
    // Simplified version for testing
    return {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 40],
      defaultStyle: { font: 'Helvetica', fontSize: 12 },
      content: [
        { text: 'SALES CHALLAN', bold: true, fontSize: 20 },
        { text: companyName, fontSize: 14, margin: [0, 10, 0, 0] },
        { text: `Challan: ${c.code}`, margin: [0, 20, 0, 0] },
        { text: `Customer: ${c.customerName}`, margin: [0, 10, 0, 0] },
        { text: `Items: ${c.items.length}`, margin: [0, 10, 0, 0] },
      ],
    } as TDocumentDefinitions;
  }

  private buildChallanBillDocFull(c: ChallanDto, logo: string | null, companyName: string, terms: string[]): TDocumentDefinitions {
    const NAVY = '#163E64';
    const ORANGE = '#E8A33D';
    const BLACK = '#111111';
    const BORDER = '#C9D2DC';
    const GREY = '#555555';
    const q = (v?: number | null) => (v ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '-');
    const money = (v?: number | null) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const d = (s?: string | null) => formatDate(s);

    const tcs = n(c.tcs);
    const tds = n(c.tds);
    const tax = n(c.tax);
    const total = n(c.total);
    const items = c.items;
    const subTotal = items.reduce((a, it) => a + n(it.amount), 0);

    // Normalize shipping address for comparison
    const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    const hasDifferentShippingAddress = !!c.shippingAddress?.trim() && norm(c.shippingAddress) !== norm(c.billingAddress);

    // Header with navy and orange sections
    const header = {
      columns: [
        {
          width: '*',
          stack: [
            { text: 'SALES CHALLAN', bold: true, fontSize: 24, color: BLACK, margin: [0, 0, 0, 8] },
            { text: companyName, bold: true, fontSize: 14, color: BLACK },
          ],
        },
        {
          width: 'auto',
          stack: [
            ...(logo ? [{ image: logo, fit: [80, 80] as [number, number], width: 80 }] : []),
          ],
        },
      ],
      fillColor: '#F8F9FA',
      margin: [24, 16, 24, 16],
    };

    // Meta information grid (6 columns: label, value, label, value, label, value)
    const metaBlocks = [
      { label: 'Challan No:', value: c.code || '—' },
      { label: 'Challan Date:', value: d(c.invDate) },
      { label: 'Due Date:', value: d(c.dueDate) },
      { label: 'Bill To:', value: c.customerName || '—' },
      { label: 'Address:', value: c.billingAddress || '—' },
      { label: 'Transporter:', value: c.transName || '—' },
    ];

    const metaTable = {
      table: {
        widths: ['15%', '35%', '15%', '35%'],
        body: [
          [
            { text: 'CHALLAN NO', bold: true, color: GREY, fontSize: 11 },
            { text: c.code || '—', bold: true, fontSize: 11 },
            { text: 'CHALLAN DATE', bold: true, color: GREY, fontSize: 11 },
            { text: d(c.invDate), bold: true, fontSize: 11 },
          ],
          [
            { text: 'DUE DATE', bold: true, color: GREY, fontSize: 11 },
            { text: d(c.dueDate), bold: true, fontSize: 11 },
            { text: 'BILL TO', bold: true, color: GREY, fontSize: 11 },
            { text: c.customerName || '—', bold: true, fontSize: 11 },
          ],
          [
            { text: 'ADDRESS', bold: true, color: GREY, fontSize: 11 },
            { text: c.billingAddress || '—', fontSize: 11 },
            { text: 'TRANSPORTER', bold: true, color: GREY, fontSize: 11 },
            { text: c.transName || '—', fontSize: 11 },
          ],
        ],
      },
      layout: 'noBorders',
      margin: [24, 0, 24, 16],
    };

    // Items table header
    const head = [
      { text: '#', bold: true, color: BLACK, alignment: 'center' as const, fontSize: 11 },
      { text: 'ITEM NAME', bold: true, color: BLACK, alignment: 'left' as const, fontSize: 11 },
      { text: 'BAGS', bold: true, color: BLACK, alignment: 'right' as const, fontSize: 11 },
      { text: 'PCS', bold: true, color: BLACK, alignment: 'right' as const, fontSize: 11 },
      { text: 'KGS', bold: true, color: BLACK, alignment: 'right' as const, fontSize: 11 },
      { text: 'BOX', bold: true, color: BLACK, alignment: 'right' as const, fontSize: 11 },
      { text: 'RATE', bold: true, color: BLACK, alignment: 'right' as const, fontSize: 11 },
      { text: 'COMMENTS', bold: true, color: BLACK, alignment: 'left' as const, fontSize: 11 },
    ];

    const rows = items.map((it, idx) => [
      { text: String(idx + 1), alignment: 'center' as const, fontSize: 11 },
      { text: it.productName || '—', fontSize: 11 },
      { text: q(it.bags), alignment: 'right' as const, fontSize: 11 },
      { text: q(it.pcs), alignment: 'right' as const, fontSize: 11 },
      { text: q(it.kgs), alignment: 'right' as const, fontSize: 11 },
      { text: q(it.box), alignment: 'right' as const, fontSize: 11 },
      { text: q(it.price), alignment: 'right' as const, fontSize: 11 },
      { text: it.design || '', fontSize: 11 },
    ]);

    const itemsTable = {
      table: {
        headerRows: 1,
        widths: ['5%', '24%', '9%', '9%', '9%', '9%', '10%', '25%'],
        body: [head, ...rows],
      },
      layout: {
        fillColor: (rowIndex: number) => (rowIndex === 0 ? ORANGE : null),
        hLineColor: () => BORDER,
        vLineColor: () => BORDER,
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        paddingLeft: () => 5,
        paddingRight: () => 5,
        paddingTop: () => 4,
        paddingBottom: () => 4,
      },
      margin: [24, 0, 24, 16],
    };

    // Charges section (70%/30% split)
    const chargesTable = {
      columns: [
        {
          width: '*',
          stack: [],
        },
        {
          width: 220,
          table: {
            widths: [130, 90],
            body: [
              [
                { text: 'SUBTOTAL', bold: true, fillColor: ORANGE, color: BLACK, fontSize: 11 },
                { text: money(subTotal), bold: true, fillColor: ORANGE, alignment: 'right' as const, fontSize: 11 },
              ],
              [
                { text: 'Packing', fontSize: 11 },
                { text: money(c.packing), alignment: 'right' as const, fontSize: 11 },
              ],
              [
                { text: 'Freight', fontSize: 11 },
                { text: c.freight ? money(c.freight) : '-', alignment: 'right' as const, fontSize: 11 },
              ],
              [
                { text: 'Box/Pouch', fontSize: 11 },
                { text: money(c.pouch), alignment: 'right' as const, fontSize: 11 },
              ],
              [
                { text: 'Tax', fontSize: 11 },
                { text: money(tax), alignment: 'right' as const, fontSize: 11 },
              ],
              [
                { text: 'TOTAL', bold: true, fillColor: ORANGE, color: BLACK, fontSize: 11 },
                { text: money(total), bold: true, fillColor: ORANGE, alignment: 'right' as const, fontSize: 11 },
              ],
            ],
          },
          layout: {
            hLineColor: () => BORDER,
            vLineColor: () => BORDER,
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 4,
            paddingBottom: () => 4,
          },
        },
      ],
      margin: [24, 0, 24, 16],
    };

    // Terms section
    const termsContent = terms.length
      ? [
          { text: 'TERMS & CONDITIONS', bold: true, color: GREY, fontSize: 11, margin: [24, 16, 24, 8] },
          ...terms.map((term, i) => ({ text: `${i + 1}. ${term}`, fontSize: 10, margin: [24, 2, 24, 2], color: GREY })),
        ]
      : [];

    // Shipping address (if different)
    const shippingContent = hasDifferentShippingAddress
      ? [{ text: `SHIPPING ADDRESS: ${c.shippingAddress}`, fontSize: 10, color: GREY, margin: [24, 16, 24, 0] }]
      : [];

    return {
      pageSize: 'A4',
      pageMargins: [0, 0, 0, 40],
      defaultStyle: { font: 'Helvetica', fontSize: 10, color: BLACK },
      content: [
        header,
        metaTable,
        itemsTable,
        chargesTable,
        ...shippingContent,
        ...termsContent,
      ],
      footer: (currentPage: number) => ({
        text: `Page ${currentPage}`,
        alignment: 'center' as const,
        fontSize: 9,
        color: '#999999',
        margin: [0, 16, 0, 0],
      }),
    } as unknown as TDocumentDefinitions;
  }

  private buildChallanDoc(c: ChallanDto, logo: string | null): TDocumentDefinitions {
    const NAVY = '#163E64';
    const ORANGE = '#E8A33D';
    const BLACK = '#111111';
    // "-" for a blank/zero per-line quantity (matches the reference format); the
    // Total row uses the plain form below so a genuine zero total still shows "0".
    const q = (v?: number | null) => (v ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '-');
    const qTotal = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const money = (v?: number | null) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const d = (s?: string | null) => formatDate(s);

    const tcs = n(c.tcs);
    const tds = n(c.tds);
    const tax = n(c.tax);
    const total = n(c.total);
    const items = c.items;
    const subTotal = items.reduce((a, it) => a + n(it.amount), 0);
    const isScrap = (c.category ?? '').toUpperCase() === 'SCRAP';

    const head = ['#', 'Item Name', 'BAGS', 'BOX', 'PCS', 'KGS', 'UNIT', 'RATE', 'AMOUNT'].map((text, i) => ({
      text,
      bold: true,
      color: BLACK,
      alignment: i === 0 ? 'center' : i === 1 ? 'left' : i === 6 ? 'center' : 'right',
    }));
    const rows = items.map((it, idx) => {
      // The item name combines size + product (e.g. "5.5 BREZZA CUP") — append the
      // design too when it's set and meaningful, mirroring how the reference lists
      // one combined "Item Name" rather than separate Product / Design columns.
      const name = [it.productName, it.design && it.design.toUpperCase() !== 'NA' ? it.design : null].filter(Boolean).join(' ');
      return [
        { text: String(idx + 1), alignment: 'center' },
        { text: name || '—' },
        { text: q(it.bags), alignment: 'right' },
        { text: q(it.box), alignment: 'right' },
        { text: q(it.pcs), alignment: 'right' },
        { text: q(it.kgs), alignment: 'right' },
        { text: it.unit || '-', alignment: 'center' },
        { text: q(it.price), alignment: 'right' },
        { text: money(it.amount), alignment: 'right', bold: true },
      ];
    });
    const colTotal = (key: 'bags' | 'box' | 'pcs' | 'kgs') => items.reduce((a, it) => a + n(it[key]), 0);

    const line = (label: string, value: string, opts: { emphasize?: boolean } = {}) => [
      { text: label, bold: true, color: BLACK, fillColor: ORANGE },
      { text: value, bold: true, alignment: 'right', fontSize: opts.emphasize ? 11 : 10 },
    ];
    const totalsBody: unknown[][] = [
      line('Sub Total Amount', money(subTotal)),
      line('Packing Charges', money(c.packing)),
      line('Freight Charges', c.freight ? money(c.freight) : '-'),
      line('Box/Pouch', money(c.pouch)),
      line('Tax Amount', money(tax)),
    ];
    if (isScrap || tcs) totalsBody.push(line(`TCS${c.tcsPercent ? ` @ ${c.tcsPercent}%` : ''}`, money(tcs)));
    if (tds) totalsBody.push(line(`Less: TDS${c.tdsPercent ? ` @ ${c.tdsPercent}%` : ''}`, `-${money(tds)}`));
    totalsBody.push(line(tds ? 'Net Receivable' : 'Grand Total Amount', money(tds ? total - tds : total), { emphasize: true }));

    // label/value pairs for a single 4-column [label, value, label, value] row —
    // keeps the invoice-no/date/pay-term/due-date grid from squeezing into two
    // separately-sized mini tables (which clipped the longer invoice-no value).
    const metaRow = (l1: string, v1: string, l2: string, v2: string) => [
      { text: l1, bold: true, color: NAVY, fontSize: 9 },
      { text: v1, bold: true, alignment: 'right' as const, fontSize: 9 },
      { text: l2, bold: true, color: NAVY, fontSize: 9 },
      { text: v2, bold: true, alignment: 'right' as const, fontSize: 9 },
    ];

    return {
      pageSize: 'A4',
      pageMargins: [28, 34, 28, 40],
      defaultStyle: { font: 'Helvetica', fontSize: 10, color: BLACK },
      content: [
        // Navy header bar with a small orange accent block — the letterhead strip.
        {
          canvas: [
            { type: 'rect', x: 0, y: 0, w: 539, h: 22, color: NAVY },
            { type: 'rect', x: 419, y: 0, w: 120, h: 22, color: ORANGE, r: 6 },
          ],
          margin: [0, 0, 0, 16],
        },
        {
          columns: [
            {
              width: '*',
              columns: [
                ...(logo ? [{ image: logo, fit: [42, 42] as [number, number], width: 42, margin: [0, 0, 8, 0] }] : []),
                {
                  width: '*',
                  stack: [
                    { text: 'SALES RECEIPT', bold: true, fontSize: 16 },
                    { text: 'Bill To', color: ORANGE, bold: true, fontSize: 10, margin: [0, 10, 0, 0] },
                    { text: c.customerName, bold: true, fontSize: 12, margin: [0, 1, 0, 0] },
                    { text: c.billingAddress || '', fontSize: 9, color: '#555555', margin: [0, 1, 0, 0] },
                  ],
                },
              ],
            },
            {
              width: 270,
              table: {
                widths: [48, 82, 60, 80],
                body: [
                  metaRow('INV NO :', c.code, 'INV DATE :', d(c.invDate)),
                  metaRow('B (Rs) :', money(c.b), 'PAY TERM :', c.paymentTerm ? `${c.paymentTerm} DAYS` : '—'),
                  metaRow('C (Rs) :', money(c.c), 'DUE DATE :', d(c.dueDate)),
                ],
              },
              layout: 'noBorders',
            },
          ],
          margin: [0, 0, 0, 10],
        },
        ...(c.transName ? [{ text: [{ text: 'TRANSPORTER : ', color: ORANGE, bold: true }, { text: c.transName, bold: true }], alignment: 'center' as const, fontSize: 10, margin: [0, 0, 0, 10] }] : []),
        {
          table: { headerRows: 1, widths: [16, '*', 40, 38, 40, 36, 36, 40, 56], body: [head, ...rows] },
          layout: {
            fillColor: (rowIndex: number) => (rowIndex === 0 ? ORANGE : rowIndex % 2 === 0 ? '#F5F7FA' : null),
            hLineColor: () => '#C9D2DC',
            vLineColor: () => '#C9D2DC',
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            paddingLeft: () => 5,
            paddingRight: () => 5,
            paddingTop: () => 5,
            paddingBottom: () => 5,
          },
        },
        // Quantity-total footer row for the item table, styled like the header.
        {
          table: {
            widths: [16, '*', 40, 38, 40, 36, 36, 40, 56],
            body: [[
              { text: '', fillColor: ORANGE },
              { text: 'Total', bold: true, fillColor: ORANGE },
              { text: qTotal(colTotal('bags')), alignment: 'right', bold: true, fillColor: ORANGE },
              { text: qTotal(colTotal('box')), alignment: 'right', bold: true, fillColor: ORANGE },
              { text: qTotal(colTotal('pcs')), alignment: 'right', bold: true, fillColor: ORANGE },
              { text: qTotal(colTotal('kgs')), alignment: 'right', bold: true, fillColor: ORANGE },
              { text: '', fillColor: ORANGE },
              { text: '', fillColor: ORANGE },
              { text: money(subTotal), alignment: 'right', bold: true, fillColor: ORANGE },
            ]],
          },
          layout: { hLineColor: () => '#C9D2DC', vLineColor: () => '#C9D2DC', hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 5, paddingBottom: () => 5 },
          margin: [0, 0, 0, 14],
        },
        {
          columns: [
            {
              width: '*',
              stack: [
                { text: 'TOTAL IN WORDS', color: ORANGE, bold: true, fontSize: 9 },
                { text: amountInWordsIndian(total), bold: true, fontSize: 10, margin: [0, 3, 12, 0] },
                { text: 'REMARKS', color: ORANGE, bold: true, fontSize: 9, margin: [0, 14, 0, 0] },
                { text: c.remarks || '—', fontSize: 9, color: '#555555', margin: [0, 3, 12, 0] },
              ],
            },
            {
              width: 220,
              table: { widths: [130, 90], body: totalsBody },
              layout: {
                hLineColor: () => '#C9D2DC',
                vLineColor: () => '#C9D2DC',
                hLineWidth: () => 0.5,
                vLineWidth: () => 0.5,
                paddingLeft: () => 6,
                paddingRight: () => 6,
                paddingTop: () => 4,
                paddingBottom: () => 4,
              },
            },
          ],
        },
      ],
      footer: (currentPage: number) => ({
        columns: [
          { text: new Date().toLocaleString('en-GB'), fontSize: 7, color: '#888888', margin: [28, 0, 0, 0] },
          { text: String(currentPage), fontSize: 8, color: '#888888', alignment: 'right', margin: [0, 0, 28, 0] },
        ],
      }),
    } as unknown as TDocumentDefinitions;
  }
}

/** Indian numbering amount-in-words (e.g. 1,05,588 → "RUPEES ONE LAKH FIVE THOUSAND FIVE HUNDRED AND EIGHTY EIGHT ONLY"). */
function amountInWordsIndian(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  const words = rupees === 0 ? 'Zero' : numToWords(rupees);
  const main = `Rupees ${words}`;
  const out = paise > 0 ? `${main} And ${numToWords(paise)} Paise Only` : `${main} Only`;
  return out.toUpperCase();
}

function numToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const below1000 = (x: number): string => {
    let s = '';
    if (x >= 100) {
      s += `${ones[Math.floor(x / 100)]} Hundred`;
      x %= 100;
      if (x) s += ' And ';
    }
    if (x >= 20) {
      s += tens[Math.floor(x / 10)];
      x %= 10;
      if (x) s += ` ${ones[x]}`;
    } else if (x > 0) {
      s += ones[x];
    }
    return s;
  };
  let words = '';
  const crore = Math.floor(num / 10_000_000);
  num %= 10_000_000;
  const lakh = Math.floor(num / 100_000);
  num %= 100_000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  if (crore) words += `${below1000(crore)} Crore `;
  if (lakh) words += `${below1000(lakh)} Lakh `;
  if (thousand) words += `${below1000(thousand)} Thousand `;
  if (num) words += below1000(num);
  return words.trim();
}
