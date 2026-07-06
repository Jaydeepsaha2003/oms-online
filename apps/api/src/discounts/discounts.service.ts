import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DiscountDto, DiscountInvoiceRow, Paginated, SaveDiscountResult } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DiscountHistoryQueryDto, DiscountInvoiceQueryDto, SaveDiscountDto } from './dto/discount.dto';

const r2 = (x: number) => Math.round(x * 100) / 100;
const EPS = 0.005;
/** BANK and CHEQUE receipts settle the bank bucket; CASH settles the cash bucket. */
const BANK_RECEIPT_MODES = ['BANK', 'CHEQUE'];
type Db = Prisma.TransactionClient;

function parseDay(s: string | undefined, label: string): Date {
  const d = s ? new Date(s) : new Date();
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} is not valid.`);
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class DiscountsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pending-invoice grid (legacy LoadInvoiceGrid_Advanced). For every CONFIRMED
   * challan: bank side (b) and cash side (c), each with its discount, received and
   * balance = amount − discount − received. Rows fully settled on the filtered side
   * are hidden, exactly like the legacy form.
   */
  async invoices(q: DiscountInvoiceQueryDto): Promise<DiscountInvoiceRow[]> {
    const mode = (q.mode ?? '').trim().toUpperCase();
    const where: Prisma.ChallanWhereInput = { challanStatus: 'CONFIRMED' };
    if (q.customerId != null) where.customerId = q.customerId;
    const challans = await this.prisma.challan.findMany({
      where,
      orderBy: [{ invDate: 'desc' }, { id: 'desc' }],
      select: { code: true, invDate: true, customerId: true, customerName: true, b: true, c: true },
    });
    if (!challans.length) return [];
    const codes = challans.map((c) => c.code);

    const [recs, discs] = await Promise.all([
      this.prisma.acctPaymentReceipt.groupBy({ by: ['invNo', 'payMode'], where: { invNo: { in: codes } }, _sum: { recAmt: true } }),
      this.prisma.acctPartyDiscount.groupBy({ by: ['invNo', 'billType'], where: { invNo: { in: codes } }, _sum: { disAmt: true } }),
    ]);
    const bankRec = new Map<string, number>();
    const cashRec = new Map<string, number>();
    for (const r of recs) {
      const m = BANK_RECEIPT_MODES.includes(r.payMode) ? bankRec : cashRec;
      m.set(r.invNo, r2((m.get(r.invNo) ?? 0) + (r._sum.recAmt ?? 0)));
    }
    const bankDisc = new Map<string, number>();
    const cashDisc = new Map<string, number>();
    for (const d of discs) {
      const m = d.billType === 'BANK' ? bankDisc : cashDisc;
      m.set(d.invNo, r2((m.get(d.invNo) ?? 0) + (d._sum.disAmt ?? 0)));
    }

    const search = (q.search ?? '').trim().toLowerCase();
    const rows: DiscountInvoiceRow[] = [];
    for (const c of challans) {
      const billAmt = r2(c.b ?? 0);
      const cashAmt = r2(c.c ?? 0);
      const bd = bankDisc.get(c.code) ?? 0;
      const br = bankRec.get(c.code) ?? 0;
      const cd = cashDisc.get(c.code) ?? 0;
      const cr = cashRec.get(c.code) ?? 0;
      const billBal = r2(billAmt - bd - br);
      const cashBal = r2(cashAmt - cd - cr);
      if (mode === 'BANK' && billBal <= EPS) continue;
      if (mode === 'CASH' && cashBal <= EPS) continue;
      if (!mode && billBal <= EPS && cashBal <= EPS) continue;
      if (search && !`${c.code} ${c.customerName} ${billAmt} ${cashAmt}`.toLowerCase().includes(search)) continue;
      rows.push({
        invNo: c.code,
        invDate: c.invDate.toISOString(),
        customerId: c.customerId ?? 0,
        customerName: c.customerName,
        billAmt,
        billDisc: bd,
        billRec: br,
        billBal: Math.max(0, billBal),
        cashAmt,
        cashDisc: cd,
        cashRec: cr,
        cashBal: Math.max(0, cashBal),
      });
    }
    return rows;
  }

  /** Saved discounts for one invoice (per-invoice history, latest first). */
  async history(q: DiscountHistoryQueryDto): Promise<Paginated<DiscountDto>> {
    const where = { invNo: q.invNo };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.acctPartyDiscount.findMany({ where, orderBy: [{ disDate: 'desc' }, { id: 'desc' }], skip: q.skip, take: q.pageSize }),
      this.prisma.acctPartyDiscount.count({ where }),
    ]);
    return { items: rows.map((r) => this.map(r)), total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  async create(dto: SaveDiscountDto, userName?: string | null): Promise<SaveDiscountResult> {
    const { billType, disAmt, disDate } = this.validate(dto);
    return this.prisma.$transaction(async (tx) => {
      const challan = await this.requireChallan(tx, dto.invNo);
      const { invAmt, max } = await this.maxAllowed(tx, dto.invNo, billType, challan, 0);
      this.assertWithin(disAmt, max);

      const disc = await tx.acctPartyDiscount.create({
        data: {
          disDate,
          invNo: dto.invNo,
          customerName: challan.customerName,
          custId: challan.customerId ?? dto.customerId,
          invAmt,
          disAmt,
          billType,
          userName: userName ?? null,
        },
      });
      const voucherNo = `SD/${String(disc.id).padStart(4, '0')}`;
      await tx.acctPartyDiscount.update({ where: { id: disc.id }, data: { voucherNo } });
      await this.upsertLedger(tx, voucherNo, disDate, challan.customerName, challan.customerId ?? dto.customerId, dto.invNo, billType, disAmt, userName);
      return { id: disc.id, voucherNo, disAmt, billType, invNo: dto.invNo };
    });
  }

  async update(id: number, dto: SaveDiscountDto, userName?: string | null): Promise<SaveDiscountResult> {
    const { billType, disAmt, disDate } = this.validate(dto);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.acctPartyDiscount.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Discount not found.');
      const challan = await this.requireChallan(tx, dto.invNo);
      // Exclude THIS discount from the "other discounts" so editing up to the true
      // pending is allowed.
      const { invAmt, max } = await this.maxAllowed(tx, dto.invNo, billType, challan, id);
      this.assertWithin(disAmt, max);

      await tx.acctPartyDiscount.update({
        where: { id },
        data: { disDate, invNo: dto.invNo, customerName: challan.customerName, custId: challan.customerId ?? dto.customerId, invAmt, disAmt, billType },
      });
      const voucherNo = existing.voucherNo ?? `SD/${String(id).padStart(4, '0')}`;
      if (!existing.voucherNo) await tx.acctPartyDiscount.update({ where: { id }, data: { voucherNo } });
      await this.upsertLedger(tx, voucherNo, disDate, challan.customerName, challan.customerId ?? dto.customerId, dto.invNo, billType, disAmt, userName);
      return { id, voucherNo, disAmt, billType, invNo: dto.invNo };
    });
  }

  async remove(id: number): Promise<{ id: number }> {
    return this.prisma.$transaction(async (tx) => {
      const disc = await tx.acctPartyDiscount.findUnique({ where: { id } });
      if (!disc) throw new NotFoundException('Discount not found.');
      if (disc.voucherNo) await tx.acctLedger.deleteMany({ where: { voucherNo: disc.voucherNo, voucherType: 'SALES DISCOUNT' } });
      await tx.acctPartyDiscount.delete({ where: { id } });
      return { id };
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private validate(dto: SaveDiscountDto): { billType: string; disAmt: number; disDate: Date } {
    const billType = (dto.billType ?? '').trim().toUpperCase();
    if (billType !== 'BANK' && billType !== 'CASH') throw new BadRequestException('Select a valid Discount Mode (BANK / CASH).');
    const disAmt = r2(dto.disAmt);
    if (!Number.isFinite(disAmt) || disAmt <= 0) throw new BadRequestException('Discount Amount must be greater than zero.');
    const disDate = parseDay(dto.disDate, 'Discount date');
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (disDate.getTime() > today.getTime()) throw new BadRequestException('Discount date cannot be in the future.');
    return { billType, disAmt, disDate };
  }

  private async requireChallan(db: Db, invNo: string) {
    const challan = await db.challan.findUnique({ where: { code: invNo }, select: { customerName: true, customerId: true, b: true, c: true } });
    if (!challan) throw new NotFoundException('Invoice not found.');
    return challan;
  }

  /** Max discount allowed on the bucket = amount − Σ receipts − Σ other discounts. */
  private async maxAllowed(
    db: Db,
    invNo: string,
    billType: string,
    challan: { b: number | null; c: number | null },
    excludeId: number,
  ): Promise<{ invAmt: number; max: number }> {
    const invAmt = r2((billType === 'BANK' ? challan.b : challan.c) ?? 0);
    const recModes = billType === 'BANK' ? BANK_RECEIPT_MODES : ['CASH'];
    const recAgg = await db.acctPaymentReceipt.aggregate({ where: { invNo, payMode: { in: recModes } }, _sum: { recAmt: true } });
    const discWhere: Prisma.AcctPartyDiscountWhereInput = { invNo, billType };
    if (excludeId > 0) discWhere.id = { not: excludeId };
    const discAgg = await db.acctPartyDiscount.aggregate({ where: discWhere, _sum: { disAmt: true } });
    const max = r2(invAmt - (recAgg._sum.recAmt ?? 0) - (discAgg._sum.disAmt ?? 0));
    return { invAmt, max: Math.max(0, max) };
  }

  private assertWithin(disAmt: number, max: number): void {
    if (max <= EPS) throw new BadRequestException('This invoice is fully paid/settled. No discount can be applied.');
    if (disAmt > max + EPS) throw new BadRequestException(`Discount cannot exceed the pending amount (₹${max.toFixed(2)}).`);
  }

  /** Insert or update the SALES DISCOUNT ledger voucher (credit on the mode's bucket). */
  private async upsertLedger(
    db: Db,
    voucherNo: string,
    transDate: Date,
    customerName: string,
    custId: number,
    invNo: string,
    billType: string,
    disAmt: number,
    userName?: string | null,
  ): Promise<void> {
    const data = {
      transDate,
      customerName,
      custId,
      particulars: `DISCOUNT AGST INV NO: ${invNo}`,
      transMode: billType,
      bankCredit: billType === 'BANK' ? disAmt : 0,
      cashCredit: billType === 'CASH' ? disAmt : 0,
    };
    const updated = await db.acctLedger.updateMany({ where: { voucherNo, voucherType: 'SALES DISCOUNT' }, data });
    if (updated.count === 0) {
      await db.acctLedger.create({ data: { voucherNo, voucherType: 'SALES DISCOUNT', bankDebit: 0, cashDebit: 0, userName: userName ?? null, ...data } });
    }
  }

  private map(r: {
    id: number;
    disDate: Date;
    invNo: string;
    customerName: string;
    custId: number;
    invAmt: number;
    disAmt: number;
    billType: string;
    voucherNo: string | null;
  }): DiscountDto {
    return {
      id: r.id,
      disDate: r.disDate.toISOString(),
      invNo: r.invNo,
      customerName: r.customerName,
      customerId: r.custId,
      invAmt: r.invAmt,
      disAmt: r.disAmt,
      billType: r.billType,
      voucherNo: r.voucherNo,
    };
  }
}
