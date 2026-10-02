import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import type { PendingProcessorInfoDto } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { buildPendingWorkbook, type Cell } from './pending-workbook';

/** The processor workbook's two lookup sheets, as stored. */
interface Lookups {
  fileName: string;
  loadedAt: string;
  loadedBy: string | null;
  shopKeywords: string[];
  /** Settings B → C: full customer name → short name. */
  shortNames: [string, string][];
  /** Vendor Details C, D, K, L. */
  vendors: { product: string; size: string; vendor: string; newSubCategory: string }[];
}

const KEY = 'pending-processor.lookups';
const str = (v: unknown) => (v == null ? '' : String(v)).trim();
const pad = (n: number) => String(n).padStart(2, '0');
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Pending Order Processor (V6.0 macro, moved online). Takes the lines still
 * pending dispatch — the old Access `PendOrder` table — adds the macro's
 * lookup columns, and returns its workbook (PenOrderData + four pivots).
 */
@Injectable()
export class PendingProcessorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: DispatchService,
  ) {}

  private async lookups(): Promise<Lookups | null> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: KEY } });
    return row ? (JSON.parse(row.value) as Lookups) : null;
  }

  async info(): Promise<PendingProcessorInfoDto> {
    const [l, lines] = await Promise.all([this.lookups(), this.dispatch.pendingPool()]);
    return {
      lookups: l && {
        fileName: l.fileName,
        loadedAt: l.loadedAt,
        loadedBy: l.loadedBy,
        shopKeywords: l.shopKeywords,
        shortNames: l.shortNames.length,
        vendors: l.vendors.length,
      },
      pendingLines: lines.length,
    };
  }

  /** Reads Settings and Vendor Details from the processor workbook (.xlsm or .xlsx). */
  async importLookups(file: Buffer, fileName: string, userName: string | null): Promise<PendingProcessorInfoDto> {
    const wb = XLSX.read(file, { type: 'buffer' });
    const sheet = (name: string) => {
      const ws = wb.Sheets[name];
      if (!ws) throw new BadRequestException(`"${fileName}" has no "${name}" sheet — upload the Pending Order Processor workbook.`);
      return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: true }).slice(1);
    };
    const settings = sheet('Settings');
    const vendorRows = sheet('Vendor Details');
    const lookups: Lookups = {
      fileName,
      loadedAt: new Date().toISOString(),
      loadedBy: userName,
      shopKeywords: settings.map((r) => str(r[0])).filter(Boolean),
      shortNames: settings.filter((r) => str(r[1])).map((r) => [str(r[1]), str(r[2]) || str(r[1])]),
      vendors: vendorRows
        .filter((r) => str(r[2]))
        .map((r) => ({ product: str(r[2]), size: str(r[3]), vendor: str(r[10]), newSubCategory: str(r[11]) })),
    };
    if (!lookups.shopKeywords.length || !lookups.vendors.length) {
      throw new BadRequestException('The Settings or Vendor Details sheet is empty — nothing was loaded.');
    }
    await this.prisma.appConfig.upsert({
      where: { key: KEY },
      update: { value: JSON.stringify(lookups) },
      create: { key: KEY, value: JSON.stringify(lookups) },
    });
    return this.info();
  }

  /** The workbook, and the macro's file name for it. */
  async build(): Promise<{ buffer: Buffer; fileName: string }> {
    const l = await this.lookups();
    if (!l) throw new BadRequestException('Load the Pending Order Processor workbook first (its Settings and Vendor Details sheets).');
    const lines = [...(await this.dispatch.pendingPool())].sort((a, b) => a.orderId - b.orderId || a.orderItemId - b.orderItemId);
    if (!lines.length) throw new BadRequestException('No pending orders to process.');

    // The line's design code (ORDERTBL.DESIGN) — the pool carries the display name.
    const [items, products] = await Promise.all([
      this.prisma.orderItem.findMany({ where: { id: { in: lines.map((x) => x.orderItemId) } }, select: { id: true, design: true, designType: true, productName: true } }),
      this.prisma.product.findMany({ select: { category: true, subCategory: true, product: true, size: true } }),
    ]);
    // Lines imported from Access hold the design code in `design` and its name
    // in `designType`; OMS lines the reverse. An Access line shows itself by its
    // product name ending with the code (dispatchDesign's rule) — or by having a
    // `design` but no `designType`, which an OMS line never has.
    const isNa = (v: string | null) => ['', 'NA', 'N/A'].includes(str(v).toUpperCase());
    const designOf = new Map(
      items.map((i) => {
        const d = str(i.design).toUpperCase();
        const legacy = !isNa(d) && (isNa(i.designType) || str(i.productName).toUpperCase().endsWith(` ${d}`));
        return [i.id, legacy ? { code: i.design, name: i.designType } : { code: i.designType, name: i.design }];
      }),
    );
    // Newer lines leave psize empty; the product master has it.
    const sizeOf = new Map<string, number | null>();
    for (const p of products) {
      const k = `${p.category}|${p.subCategory}|${p.product}`;
      if (!sizeOf.has(k)) sizeOf.set(k, p.size);
    }
    // VLOOKUP's exact match ignores case.
    const shortOf = new Map(l.shortNames.map(([full, short]) => [full.toUpperCase(), short]));
    const keywords = l.shopKeywords.map((k) => k.toLowerCase());

    const rows: Cell[][] = lines.map((x) => {
      const size = x.psize ?? sizeOf.get(`${x.pCategory}|${x.subCategory}|${x.product}`) ?? null;
      const d = designOf.get(x.orderItemId);
      const design = d && !isNa(d.code) ? str(d.code) : null;
      const shop = !!design && keywords.some((k) => design.toLowerCase().includes(k));
      const sizeText = size == null ? '' : String(size);
      const vendor = l.vendors.find((v) => v.size === sizeText && v.product === str(x.product));
      return [
        x.orderItemId,
        x.orderId,
        new Date(x.orderDate),
        x.dueType,
        x.dueDate ? new Date(x.dueDate) : null,
        x.agentName,
        x.customerName,
        x.productName,
        // Design Name: "NA" / "N/A" / blank become a space, as the macro wrote them.
        !d || isNa(d.name) ? ' ' : str(d.name),
        x.priority,
        round3(x.remBags),
        round3(x.remPcs),
        round3(x.remKgs),
        round3(x.remBox),
        str(x.comment) || ' ',
        x.calField,
        x.ordType,
        'Confirmed',
        x.subCategory,
        x.pCategory,
        size,
        x.product,
        design,
        shop ? 'ShopPenOrder' : 'VirarPenOrder',
        shortOf.get(x.customerName.toUpperCase()) ?? x.customerName,
        `${sizeText} ${str(x.product)}`.trim(),
        vendor?.newSubCategory || x.subCategory,
        vendor?.vendor || 'No Vendor',
      ];
    });

    const now = new Date();
    const stamp = `${pad(now.getDate())}_${pad(now.getMonth() + 1)}_${pad(now.getFullYear() % 100)}_${pad(now.getHours())}_${pad(now.getMinutes())}`;
    return { buffer: await buildPendingWorkbook(rows, now), fileName: `pen_order_process_${stamp}.xlsx` };
  }
}
