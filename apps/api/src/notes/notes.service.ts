import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  computeNoteBreakup,
  type NoteDirectoryRow,
  type NoteDto,
  type NoteMode,
  type NextNoteNoResult,
  type Paginated,
  type RecentSoldRow,
  type SaveNoteResult,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { NoteDirectoryQueryDto, SaveNoteDto } from './dto/note.dto';

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const EPS = 0.005;
const BANK = 'BANK';
const CASH = 'CASH';
type Db = Prisma.TransactionClient;

/** transMode from the B/C split (GetTransModeFromBandC). */
function transModeOf(b: number, c: number): string {
  if (b > 0 && c > 0) return 'BOTH';
  if (c > 0) return CASH;
  if (b > 0) return BANK;
  return 'NONE';
}

function parseDay(s: string, label: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} is not valid.`);
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

  /* ── Product picker: this customer's last 12 months of sold items ──────────── */

  async recentSold(customerId: number): Promise<RecentSoldRow[]> {
    if (!customerId) return [];
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    cutoff.setHours(0, 0, 0, 0);
    // Real sales only — exclude Debit Notes (prefix DN) which live in the same table.
    const challans = await this.prisma.challan.findMany({
      where: {
        customerId,
        invDate: { gte: cutoff },
        transaction: { not: 'DEBIT NOTE' },
        NOT: { prefix: { startsWith: 'DN' } },
      },
      orderBy: [{ invDate: 'desc' }, { id: 'desc' }],
      include: { items: true },
    });
    const rows: RecentSoldRow[] = [];
    for (const ch of challans) {
      for (const it of ch.items) {
        rows.push({
          dispatchId: it.dispatchId ?? 0,
          invNo: ch.code,
          invDate: ch.invDate.toISOString(),
          productName: it.productName ?? '',
          design: it.design ?? '',
          bags: it.bags ?? 0,
          pcs: it.pcs ?? 0,
          kgs: it.kgs ?? 0,
          box: it.box ?? 0,
          price: it.price ?? 0,
          unit: it.unit ?? '',
          gstRate: ch.gst ?? 0,
          pCategory: it.pCategory ?? '',
        });
      }
    }
    return rows;
  }

  /* ── Numbering (DN/<n>, CN/<n>) ────────────────────────────────────────────── */

  async nextNo(mode: NoteMode): Promise<NextNoteNoResult> {
    return { mode, code: await this.computeNextNo(this.prisma, mode) };
  }

  private async computeNextNo(db: Db, mode: NoteMode): Promise<string> {
    const prefix = mode === 'CREDIT' ? 'CN' : 'DN';
    const codes =
      mode === 'CREDIT'
        ? (await db.creditNote.findMany({ where: { code: { startsWith: 'CN/' } }, select: { code: true } })).map((r) => r.code)
        : (await db.challan.findMany({ where: { code: { startsWith: 'DN/' } }, select: { code: true } })).map((r) => r.code);
    let max = 0;
    for (const code of codes) {
      const n = parseInt(code.slice(code.indexOf('/') + 1), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `${prefix}/${max + 1}`;
  }

  /* ── Directory (browser) ───────────────────────────────────────────────────── */

  async directory(q: NoteDirectoryQueryDto): Promise<Paginated<NoteDirectoryRow>> {
    const mode = q.mode as NoteMode;
    const from = q.fromDate ? parseDay(q.fromDate, 'From date') : null;
    const to = q.toDate ? parseDay(q.toDate, 'To date') : null;
    if (to) to.setDate(to.getDate() + 1); // inclusive
    const payMode = (q.payMode ?? 'ALL').toUpperCase();
    const search = q.search?.trim();

    const dateFilter: Prisma.DateTimeFilter = {};
    if (from) dateFilter.gte = from;
    if (to) dateFilter.lt = to;

    // Pay-mode filter mirrors the legacy grid: BANK = b>0 & c=0, CASH = c>0 & b=0, BOTH = both>0.
    const andPay: Record<string, unknown>[] = [];
    if (payMode === BANK) andPay.push({ b: { gt: 0 } }, { c: { equals: 0 } });
    else if (payMode === CASH) andPay.push({ c: { gt: 0 } }, { b: { equals: 0 } });
    else if (payMode === 'BOTH') andPay.push({ b: { gt: 0 } }, { c: { gt: 0 } });

    const commonWhere = {
      ...(from || to ? { invDate: dateFilter } : {}),
      ...(q.customerName?.trim() ? { customerName: q.customerName.trim() } : {}),
      ...(search ? { OR: [{ code: { contains: search } }, { customerName: { contains: search } }] } : {}),
      ...(andPay.length ? { AND: andPay } : {}),
    };

    let items: NoteDirectoryRow[];
    if (mode === 'CREDIT') {
      const rows = await this.prisma.creditNote.findMany({
        where: commonWhere as Prisma.CreditNoteWhereInput,
        orderBy: [{ invDate: 'desc' }, { id: 'desc' }],
      });
      items = rows.map((r) => ({ mode, id: r.id, code: r.code, invDate: r.invDate.toISOString(), customerName: r.customerName, b: r.b ?? 0, c: r.c ?? 0, total: r.total ?? 0 }));
    } else {
      const rows = await this.prisma.challan.findMany({
        where: { ...(commonWhere as Prisma.ChallanWhereInput), transaction: 'DEBIT NOTE' },
        orderBy: [{ invDate: 'desc' }, { id: 'desc' }],
      });
      items = rows.map((r) => ({ mode, id: r.id, code: r.code, invDate: r.invDate.toISOString(), customerName: r.customerName, b: r.b ?? 0, c: r.c ?? 0, total: r.total ?? 0 }));
    }
    return { items, total: items.length, page: 1, pageSize: items.length, totalPages: 1 };
  }

  /* ── Get one (for the editor) ──────────────────────────────────────────────── */

  async getOne(mode: NoteMode, code: string): Promise<NoteDto> {
    if (mode === 'CREDIT') {
      const cn = await this.prisma.creditNote.findUnique({ where: { code }, include: { items: { orderBy: { id: 'asc' } } } });
      if (!cn) throw new NotFoundException('Credit Note not found.');
      return {
        mode,
        id: cn.id,
        code: cn.code,
        prefix: cn.prefix,
        invDate: cn.invDate.toISOString(),
        invTime: cn.invTime,
        customerId: cn.customerId,
        customerName: cn.customerName,
        billingAddress: cn.billingAddress,
        shippingAddress: cn.shippingAddress,
        category: cn.category,
        paymentTerm: cn.paymentTerm,
        dueDate: cn.dueDate?.toISOString() ?? null,
        transName: cn.transName,
        packing: cn.packing,
        freight: cn.freight,
        pouch: cn.pouch,
        tcs: null,
        gst: cn.gst,
        freightRate: cn.freightRate,
        packingRate: cn.packingRate,
        billingRate: cn.billingRate,
        bpcRate: cn.bpcRate,
        tax: cn.tax,
        total: cn.total,
        b: cn.b,
        c: cn.c,
        remarks: cn.remarks,
        noBill: cn.noBill,
        challanStatus: null,
        status: cn.status,
        userName: cn.userName,
        items: cn.items.map((it) => ({
          id: it.id,
          dispatchId: it.dispatchId ?? undefined,
          refInvNo: it.refInvNo ?? undefined,
          productName: it.productName ?? '',
          design: it.design ?? undefined,
          bags: it.bags ?? undefined,
          pcs: it.pcs ?? undefined,
          kgs: it.kgs ?? undefined,
          box: it.box ?? undefined,
          unit: it.unit ?? undefined,
          price: it.price ?? undefined,
          amount: it.amount ?? undefined,
          pCategory: it.pCategory ?? undefined,
          comment: it.comment ?? undefined,
        })),
      };
    }
    const ch = await this.prisma.challan.findUnique({ where: { code }, include: { items: { orderBy: { id: 'asc' } } } });
    if (!ch || ch.transaction !== 'DEBIT NOTE') throw new NotFoundException('Debit Note not found.');
    return {
      mode,
      id: ch.id,
      code: ch.code,
      prefix: ch.prefix ?? 'DN',
      invDate: ch.invDate.toISOString(),
      invTime: ch.invTime,
      customerId: ch.customerId,
      customerName: ch.customerName,
      billingAddress: ch.billingAddress,
      shippingAddress: ch.shippingAddress,
      category: ch.category,
      paymentTerm: ch.paymentTerm,
      dueDate: ch.dueDate?.toISOString() ?? null,
      transName: ch.transName,
      packing: ch.packing,
      freight: ch.freight,
      pouch: ch.pouch,
      tcs: ch.tcs,
      gst: ch.gst,
      freightRate: ch.freightRate,
      packingRate: ch.packingRate,
      billingRate: ch.billingRate,
      bpcRate: ch.bpcRate,
      tax: ch.tax,
      total: ch.total,
      b: ch.b,
      c: ch.c,
      remarks: ch.remarks,
      noBill: ch.noBill,
      challanStatus: ch.challanStatus,
      status: ch.transaction,
      userName: ch.userName,
      items: ch.items.map((it) => ({
        id: it.id,
        dispatchId: it.dispatchId ?? undefined,
        refInvNo: undefined,
        productName: it.productName ?? '',
        design: it.design ?? undefined,
        bags: it.bags ?? undefined,
        pcs: it.pcs ?? undefined,
        kgs: it.kgs ?? undefined,
        box: it.box ?? undefined,
        unit: it.unit ?? undefined,
        price: it.price ?? undefined,
        amount: it.amount ?? undefined,
        pCategory: it.pCategory ?? undefined,
        comment: it.comment ?? undefined,
      })),
    };
  }

  /* ── Print (PDF) ───────────────────────────────────────────────────────────── */

  async notePdf(mode: NoteMode, code: string): Promise<{ buffer: Buffer; filename: string }> {
    const note = await this.getOne(mode, code);
    const buffer = await this.pdf.render(buildNoteDoc(note));
    return { buffer, filename: `${code.replace(/[\\/:*?"<>|]/g, '-')}.pdf` };
  }

  /* ── Save (create / re-save) ───────────────────────────────────────────────── */

  async save(dto: SaveNoteDto, userName?: string | null): Promise<SaveNoteResult> {
    const mode = dto.mode as NoteMode;
    if (!dto.items?.length) throw new BadRequestException('Add at least one item to the note.');
    if (!dto.customerId) throw new BadRequestException('Select a customer.');
    const invDate = parseDay(dto.invDate, 'Note date');

    // Authoritative pricing — never trust client totals.
    const breakup = computeNoteBreakup({
      items: dto.items.map((it) => ({ bags: it.bags, pcs: it.pcs, kgs: it.kgs, box: it.box, unit: it.unit, price: it.price, gstRate: it.gstRate })),
      packing: dto.packing,
      freight: dto.freight,
      pouch: dto.pouch,
      billingRate: dto.billingRate,
      noBill: dto.noBill,
      noBillWithoutGst: dto.noBillWithoutGst,
      manualTax: dto.manualTax ?? null,
    });
    const b = breakup.b;
    const c = breakup.c;
    const dueDate = new Date(invDate);
    dueDate.setDate(dueDate.getDate() + (dto.paymentTerm ?? 0));

    // 1) Header + items in one transaction (delete-then-recreate on re-save).
    const code =
      dto.code?.trim() ||
      (await this.prisma.$transaction(async (tx) => this.computeNextNo(tx, mode)));

    const itemData = dto.items.map((it, i) => ({
      dispatchId: it.dispatchId ?? null,
      productName: it.productName ?? null,
      design: it.design ?? null,
      bags: it.bags ?? null,
      pcs: it.pcs ?? null,
      kgs: it.kgs ?? null,
      box: it.box ?? null,
      unit: it.unit ?? null,
      price: it.price ?? null,
      amount: breakup.amounts[i],
      pCategory: it.pCategory ?? null,
      comment: it.comment ?? null,
      userName: userName ?? null,
    }));

    await this.prisma.$transaction(async (tx) => {
      if (mode === 'CREDIT') {
        await tx.creditNote.deleteMany({ where: { code } });
        await tx.creditNote.create({
          data: {
            code,
            prefix: 'CN',
            invDate,
            invTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            customerId: dto.customerId,
            customerName: dto.customerName,
            billingAddress: dto.billingAddress ?? null,
            shippingAddress: dto.shippingAddress ?? null,
            category: dto.category ?? null,
            paymentTerm: dto.paymentTerm ?? null,
            dueDate,
            transName: dto.transName ?? null,
            packing: dto.packing ?? null,
            freight: dto.freight ?? null,
            pouch: dto.pouch ?? null,
            tax: breakup.tax,
            total: breakup.total,
            b,
            c,
            remarks: dto.remarks ?? null,
            gst: breakup.gstPercent,
            freightRate: dto.freightRate ?? null,
            packingRate: dto.packingRate ?? null,
            billingRate: dto.billingRate ?? null,
            bpcRate: dto.bpcRate ?? null,
            noBill: dto.noBill ?? false,
            status: 'CREDIT NOTE',
            userName: userName ?? null,
            items: { create: itemData.map((d) => ({ ...d, refInvNo: null })) },
          },
        });
        // refInvNo per item.
        const created = await tx.creditNote.findUnique({ where: { code }, include: { items: { orderBy: { id: 'asc' } } } });
        if (created) {
          for (let i = 0; i < created.items.length; i++) {
            const ref = dto.items[i]?.refInvNo ?? null;
            if (ref) await tx.creditNoteItem.update({ where: { id: created.items[i].id }, data: { refInvNo: ref } });
          }
        }
      } else {
        await tx.challan.deleteMany({ where: { code } });
        await tx.challan.create({
          data: {
            code,
            prefix: 'DN',
            invDate,
            invTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            customerId: dto.customerId,
            customerName: dto.customerName,
            billingAddress: dto.billingAddress ?? null,
            shippingAddress: dto.shippingAddress ?? null,
            category: dto.category ?? null,
            paymentTerm: dto.paymentTerm ?? null,
            dueDate,
            transName: dto.transName ?? null,
            packing: dto.packing ?? null,
            freight: dto.freight ?? null,
            pouch: dto.pouch ?? null,
            tcs: dto.tcs ?? null,
            tax: breakup.tax,
            total: breakup.total,
            b,
            c,
            remarks: dto.remarks ?? null,
            gst: breakup.gstPercent,
            freightRate: dto.freightRate ?? null,
            packingRate: dto.packingRate ?? null,
            billingRate: dto.billingRate ?? null,
            bpcRate: dto.bpcRate ?? null,
            noBill: dto.noBill ?? false,
            transaction: 'DEBIT NOTE',
            challanStatus: dto.challanStatus?.trim() || 'CONFIRMED',
            userName: userName ?? null,
            items: { create: itemData },
          },
        });
      }
    });

    // 2) Accounting (each in its own transaction, mirroring the legacy post-commit calls).
    if (mode === 'CREDIT') {
      await this.reverseCreditNote(code);
      await this.applyCreditNote(code, invDate, dto.customerId, dto.customerName, b, c, dto.items, userName ?? null);
    } else {
      await this.insertDebitNoteLedger(code, invDate, dto.customerId, dto.customerName, b, c, dto.items, userName ?? null);
    }

    const saved = mode === 'CREDIT' ? await this.prisma.creditNote.findUnique({ where: { code } }) : await this.prisma.challan.findUnique({ where: { code } });
    return { mode, id: saved?.id ?? 0, code, total: breakup.total };
  }

  /* ── Delete (+ reverse all accounting) ─────────────────────────────────────── */

  async remove(mode: NoteMode, code: string): Promise<void> {
    if (mode === 'CREDIT') {
      const cn = await this.prisma.creditNote.findUnique({ where: { code } });
      if (!cn) throw new NotFoundException('Credit Note not found.');
      await this.reverseCreditNote(code);
      await this.prisma.creditNote.deleteMany({ where: { code } });
    } else {
      const ch = await this.prisma.challan.findUnique({ where: { code } });
      if (!ch || ch.transaction !== 'DEBIT NOTE') throw new NotFoundException('Debit Note not found.');
      // Reverse DN ledger + advance square-off receipts.
      await this.prisma.$transaction(async (tx) => {
        await tx.acctLedger.deleteMany({ where: { voucherNo: code, voucherType: 'DEBIT NOTE' } });
        await tx.acctPaymentReceipt.deleteMany({ where: { invNo: code, recType: 'ADVANCE' } });
      });
      await this.prisma.challan.deleteMany({ where: { code } });
    }
  }

  /* ── DEBIT NOTE posting ────────────────────────────────────────────────────── */

  private async insertDebitNoteLedger(
    code: string,
    dnDate: Date,
    custId: number,
    custName: string,
    bAmt: number,
    cAmt: number,
    items: SaveNoteDto['items'],
    userName: string | null,
  ): Promise<void> {
    if (bAmt <= 0 && cAmt <= 0) return;
    const { payBy, agentName } = await this.readPayBy(custId);
    const particulars = this.debitParticulars(items);
    const transMode = transModeOf(bAmt, cAmt);

    await this.prisma.$transaction(async (tx) => {
      // Clear any prior DN ledger + advance square-offs (re-save).
      await tx.acctLedger.deleteMany({ where: { voucherNo: code, voucherType: 'DEBIT NOTE' } });
      await tx.acctPaymentReceipt.deleteMany({ where: { invNo: code, recType: 'ADVANCE' } });

      await tx.acctLedger.create({
        data: {
          voucherNo: code,
          transDate: dnDate,
          customerName: custName,
          custId,
          agentName: payBy === 'AGENT' ? agentName : null,
          particulars,
          voucherType: 'DEBIT NOTE',
          transMode,
          bankDebit: bAmt,
          cashDebit: cAmt,
          bankCredit: 0,
          cashCredit: 0,
          userName,
        },
      });

      // Auto square-off from advances FIFO — BANK then CASH.
      let receiptId: string | null = null;
      const advs = payBy === 'AGENT' && agentName ? await this.agentAdvancePending(tx, agentName) : await this.advancePending(tx, custId);
      let bankNeed = r2(Math.max(0, bAmt));
      let cashNeed = r2(Math.max(0, cAmt));
      const nameForReceipt = payBy === 'AGENT' && agentName ? agentName : custName;
      const idForReceipt = payBy === 'AGENT' && agentName ? 0 : custId;

      for (const a of advs) {
        if (bankNeed <= EPS) break;
        if (a.bankBal <= EPS) continue;
        const use = r2(Math.min(bankNeed, a.bankBal));
        receiptId ??= await this.nextRefId(tx, 'REC', dnDate);
        await tx.acctPaymentReceipt.create({
          data: { refId: receiptId, recDate: a.recDate, invNo: code, customerName: nameForReceipt, custId: idForReceipt, recType: 'ADVANCE', recAmt: use, payMode: BANK, modeOfAdj: 'AUTOMATIC', refRecId: a.refId },
        });
        bankNeed = r2(bankNeed - use);
      }
      for (const a of advs) {
        if (cashNeed <= EPS) break;
        if (a.cashBal <= EPS) continue;
        const use = r2(Math.min(cashNeed, a.cashBal));
        receiptId ??= await this.nextRefId(tx, 'REC', dnDate);
        await tx.acctPaymentReceipt.create({
          data: { refId: receiptId, recDate: a.recDate, invNo: code, customerName: nameForReceipt, custId: idForReceipt, recType: 'ADVANCE', recAmt: use, payMode: CASH, modeOfAdj: 'AUTOMATIC', refRecId: a.refId },
        });
        cashNeed = r2(cashNeed - use);
      }
    });
  }

  private debitParticulars(items: SaveNoteDto['items']): string {
    const invs = Array.from(new Set(items.map((i) => (i.refInvNo ?? '').trim()).filter(Boolean)));
    if (invs.length === 0) return `DEBIT NOTE (${items.length} ITEMS)`;
    if (invs.length === 1) return `DEBIT NOTE AGST ${invs[0]}`;
    return `DEBIT NOTE AGST ${invs.join(', ')}`;
  }

  /* ── CREDIT NOTE posting ───────────────────────────────────────────────────── */

  private async reverseCreditNote(code: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.acctPaymentReceipt.deleteMany({ where: { refRecId: code } });
      await tx.acctPartyAdvance.deleteMany({ where: { refRecId: code } });
      await tx.acctLedger.deleteMany({ where: { voucherNo: code, voucherType: 'CREDIT NOTE' } });
      await tx.acctOpeningTrans.deleteMany({ where: { refRecId: code, kind: 'CLEARANCE' } });
    });
  }

  private async applyCreditNote(
    code: string,
    cnDate: Date,
    custId: number,
    custName: string,
    bAmt: number,
    cAmt: number,
    items: SaveNoteDto['items'],
    userName: string | null,
  ): Promise<void> {
    if (bAmt <= 0 && cAmt <= 0) return;
    const { payBy, agentName } = await this.readPayBy(custId);

    await this.prisma.$transaction(async (tx) => {
      // 1) Ledger: CREDIT NOTE = credit side (SALES RETURN).
      await tx.acctLedger.create({
        data: {
          voucherNo: code,
          transDate: cnDate,
          customerName: custName,
          custId,
          agentName: payBy === 'AGENT' ? agentName : null,
          particulars: `SALES RETURN (${items.length} ITEMS)`,
          voucherType: 'CREDIT NOTE',
          transMode: transModeOf(bAmt, cAmt),
          bankDebit: 0,
          cashDebit: 0,
          bankCredit: bAmt,
          cashCredit: cAmt,
          userName,
        },
      });

      let bankLeft = r2(Math.max(0, bAmt));
      let cashLeft = r2(Math.max(0, cAmt));

      // 2) Clear OPENING balance first (oldest dues).
      const openings = await this.openingPending(tx, custId, custName);
      for (const o of openings) {
        if (bankLeft <= EPS && cashLeft <= EPS) break;
        const bankApply = r2(Math.min(bankLeft, o.pendingBank));
        const cashApply = r2(Math.min(cashLeft, o.pendingCash));
        if (bankApply <= EPS && cashApply <= EPS) continue;
        await tx.acctOpeningTrans.create({
          data: { kind: 'CLEARANCE', customerName: o.customerName, custId: o.customerId, transDate: cnDate, bankAmt: Math.max(0, bankApply), cashAmt: Math.max(0, cashApply), refRecId: code, userName },
        });
        bankLeft = r2(bankLeft - Math.max(0, bankApply));
        cashLeft = r2(cashLeft - Math.max(0, cashApply));
      }

      // 3) Clear pending invoices FIFO.
      let receiptId: string | null = null;
      const pending = await this.invoicePending(tx, custId, custName, cnDate);
      for (const inv of pending) {
        if (bankLeft <= EPS && cashLeft <= EPS) break;
        if (bankLeft > EPS && inv.bankBal > EPS) {
          const use = r2(Math.min(bankLeft, inv.bankBal));
          receiptId ??= await this.nextRefId(tx, 'REC', cnDate);
          await tx.acctPaymentReceipt.create({
            data: { refId: receiptId, recDate: cnDate, invNo: inv.invNo, customerName: custName, custId, recType: 'CREDIT NOTE', recAmt: use, payMode: BANK, refRecId: code },
          });
          bankLeft = r2(bankLeft - use);
        }
        if (cashLeft > EPS && inv.cashBal > EPS) {
          const use = r2(Math.min(cashLeft, inv.cashBal));
          receiptId ??= await this.nextRefId(tx, 'REC', cnDate);
          await tx.acctPaymentReceipt.create({
            data: { refId: receiptId, recDate: cnDate, invNo: inv.invNo, customerName: custName, custId, recType: 'CREDIT NOTE', recAmt: use, payMode: CASH, refRecId: code },
          });
          cashLeft = r2(cashLeft - use);
        }
      }

      // 4) Spillover parks as a party (or agent) advance.
      if (bankLeft > EPS || cashLeft > EPS) {
        const advRefId = await this.nextRefId(tx, 'ADV', cnDate);
        const payMode = bankLeft > EPS && cashLeft > EPS ? 'BOTH' : bankLeft > EPS ? BANK : CASH;
        const isAgent = payBy === 'AGENT' && !!agentName;
        await tx.acctPartyAdvance.create({
          data: {
            refId: advRefId,
            recDate: cnDate,
            custId: isAgent ? 0 : custId,
            customerName: isAgent ? agentName! : custName,
            agentName: isAgent ? agentName : null,
            bankAmt: Math.max(0, bankLeft),
            cashAmt: Math.max(0, cashLeft),
            payMode,
            recType: 'CREDIT NOTE',
            refRecId: code,
            takeAccOn: isAgent ? 'AGENT' : 'PARTY',
          },
        });
      }
    });
  }

  /* ── Derivations (single-party variants of the payments engine) ────────────── */

  private async readPayBy(custId: number): Promise<{ payBy: string; agentName: string }> {
    const c = await this.prisma.customer.findUnique({ where: { id: custId }, select: { payBy: true, agentName: true } });
    return { payBy: (c?.payBy ?? 'PARTY').trim().toUpperCase() || 'PARTY', agentName: (c?.agentName ?? '').trim() };
  }

  /** InvPendingSummary for one party (pending = b/c − Σreceipts − Σdiscounts). */
  private async invoicePending(db: Db, custId: number, custName: string, onDate: Date): Promise<{ invNo: string; bankBal: number; cashBal: number }[]> {
    const end = new Date(onDate);
    end.setDate(end.getDate() + 1);
    const challans = await db.challan.findMany({
      where: { challanStatus: 'CONFIRMED', customerName: custName, invDate: { lt: end } },
      orderBy: [{ invDate: 'asc' }, { id: 'asc' }],
      select: { code: true, b: true, c: true },
    });
    if (!challans.length) return [];
    const codes = challans.map((c) => c.code);
    const [recs, discs] = await Promise.all([
      db.acctPaymentReceipt.groupBy({ by: ['invNo', 'payMode'], where: { invNo: { in: codes } }, _sum: { recAmt: true } }),
      db.acctPartyDiscount.groupBy({ by: ['invNo', 'billType'], where: { invNo: { in: codes } }, _sum: { disAmt: true } }),
    ]);
    const bankRec = new Map<string, number>();
    const cashRec = new Map<string, number>();
    for (const rr of recs) {
      const m = rr.payMode === BANK || rr.payMode === 'CHEQUE' ? bankRec : cashRec;
      m.set(rr.invNo, r2((m.get(rr.invNo) ?? 0) + (rr._sum.recAmt ?? 0)));
    }
    const bankDisc = new Map<string, number>();
    const cashDisc = new Map<string, number>();
    for (const d of discs) {
      const m = d.billType === BANK ? bankDisc : cashDisc;
      m.set(d.invNo, r2((m.get(d.invNo) ?? 0) + (d._sum.disAmt ?? 0)));
    }
    const rows: { invNo: string; bankBal: number; cashBal: number }[] = [];
    for (const c of challans) {
      const bankBal = r2((c.b ?? 0) - (bankRec.get(c.code) ?? 0) - (bankDisc.get(c.code) ?? 0));
      const cashBal = r2((c.c ?? 0) - (cashRec.get(c.code) ?? 0) - (cashDisc.get(c.code) ?? 0));
      if (bankBal <= EPS && cashBal <= EPS) continue;
      rows.push({ invNo: c.code, bankBal: Math.max(0, bankBal), cashBal: Math.max(0, cashBal) });
    }
    return rows;
  }

  /** AdvPendingSummary for one party (by custId), FIFO. */
  private async advancePending(db: Db, custId: number): Promise<{ refId: string; recDate: Date; bankBal: number; cashBal: number }[]> {
    const advs = await db.acctPartyAdvance.findMany({ where: { custId }, orderBy: [{ recDate: 'asc' }, { refId: 'asc' }] });
    return this.advanceBalances(db, advs);
  }

  /** Agent advances (takeAccOn = AGENT), FIFO. */
  private async agentAdvancePending(db: Db, agentName: string): Promise<{ refId: string; recDate: Date; bankBal: number; cashBal: number }[]> {
    const advs = await db.acctPartyAdvance.findMany({ where: { takeAccOn: 'AGENT', OR: [{ agentName }, { customerName: agentName }] }, orderBy: [{ recDate: 'asc' }, { refId: 'asc' }] });
    return this.advanceBalances(db, advs);
  }

  private async advanceBalances(
    db: Db,
    advs: { refId: string; recDate: Date; bankAmt: number; cashAmt: number }[],
  ): Promise<{ refId: string; recDate: Date; bankBal: number; cashBal: number }[]> {
    if (!advs.length) return [];
    const used = await db.acctPaymentReceipt.groupBy({ by: ['refRecId', 'payMode'], where: { refRecId: { in: advs.map((a) => a.refId) } }, _sum: { recAmt: true } });
    const usedBank = new Map<string, number>();
    const usedCash = new Map<string, number>();
    for (const u of used) {
      const m = u.payMode === BANK || u.payMode === 'CHEQUE' ? usedBank : usedCash;
      m.set(u.refRecId ?? '', r2((m.get(u.refRecId ?? '') ?? 0) + (u._sum.recAmt ?? 0)));
    }
    return advs
      .map((a) => ({ refId: a.refId, recDate: a.recDate, bankBal: Math.max(0, r2(a.bankAmt - (usedBank.get(a.refId) ?? 0))), cashBal: Math.max(0, r2(a.cashAmt - (usedCash.get(a.refId) ?? 0))) }))
      .filter((a) => a.bankBal > EPS || a.cashBal > EPS);
  }

  /** OpeningBalSummary for one party (Σ OPENING DEBIT − Σ CLEARANCE). */
  private async openingPending(db: Db, custId: number, custName: string): Promise<{ customerId: number; customerName: string; pendingBank: number; pendingCash: number }[]> {
    const rows = await db.acctOpeningTrans.findMany({ where: { custId } });
    let bank = 0;
    let cash = 0;
    for (const r of rows) {
      if (r.kind === 'OPENING' && r.drCr === 'DEBIT') {
        bank = r2(bank + r.bankAmt);
        cash = r2(cash + r.cashAmt);
      } else if (r.kind === 'CLEARANCE') {
        bank = r2(bank - r.bankAmt);
        cash = r2(cash - r.cashAmt);
      }
    }
    if (bank <= EPS && cash <= EPS) return [];
    return [{ customerId: custId, customerName: custName, pendingBank: Math.max(0, bank), pendingCash: Math.max(0, cash) }];
  }

  /** Legacy REF ID: <PREFIX>-<year>-<0000>. */
  private async nextRefId(db: Db, prefix: 'REC' | 'ADV', d: Date): Promise<string> {
    const year = d.getFullYear();
    const start = `${prefix}-${year}-`;
    const rows =
      prefix === 'REC'
        ? await db.acctPaymentReceipt.findMany({ where: { refId: { startsWith: start } }, select: { refId: true }, distinct: ['refId'] })
        : await db.acctPartyAdvance.findMany({ where: { refId: { startsWith: start } }, select: { refId: true } });
    let max = 0;
    for (const r of rows) {
      const n = parseInt(r.refId.slice(start.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `${start}${String(max + 1).padStart(4, '0')}`;
  }
}

/* ── PDF document (a note-flavoured copy of the challan invoice layout) ────────── */

function buildNoteDoc(c: NoteDto): TDocumentDefinitions {
  const isCredit = c.mode === 'CREDIT';
  const BLUE = isCredit ? '#7A1F1F' : '#1F4E78';
  const ACCENT = isCredit ? '#DC2626' : '#F99A0F';
  const AMBER = '#F59E0B';
  const BLACK = '#111111';
  const title = isCredit ? 'CREDIT NOTE' : 'DEBIT NOTE';
  const nn = (v?: number | null) => v ?? 0;
  const q = (v?: number | null) => (v ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '');
  const money = (v?: number | null) => `${(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const d = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

  const items = c.items;
  const tAmt = items.reduce((a, it) => a + nn(it.amount), 0);
  const total = nn(c.total);

  const head = ['#', 'Ref Inv', 'Product', 'Design', 'Bags', 'PCs', 'KGs', 'Box', 'Unit', 'Price', 'Amount'].map((text, i) => ({
    text,
    bold: true,
    color: BLACK,
    alignment: i === 0 ? 'center' : i >= 4 ? 'right' : 'left',
  }));
  const rows = items.map((it, idx) => [
    { text: String(idx + 1), alignment: 'center' },
    { text: it.refInvNo || '', fontSize: 8 },
    { text: it.productName || '', bold: true },
    { text: it.design || '' },
    { text: q(it.bags), alignment: 'right' },
    { text: q(it.pcs), alignment: 'right' },
    { text: q(it.kgs), alignment: 'right' },
    { text: q(it.box), alignment: 'right' },
    { text: it.unit || '', alignment: 'right' },
    { text: q(it.price), alignment: 'right' },
    { text: q(it.amount), alignment: 'right', bold: true },
  ]);

  const line = (label: string, value: string, opts: { bold?: boolean; color?: string } = {}) => [
    { text: label, alignment: 'right', bold: opts.bold, color: opts.color },
    { text: value, alignment: 'right', bold: opts.bold, color: opts.color },
  ];
  const totalsBody: unknown[][] = [
    line('Taxable Amount', money(tAmt)),
    line('Freight', money(c.freight)),
    line('Packing', money(c.packing)),
    line('Box / Pouch', money(c.pouch)),
    line(`GST${c.gst ? ` @ ${c.gst}%` : ''}`, money(c.tax)),
    line('TOTAL', money(total), { bold: true, color: BLUE }),
    line('B (Bank)', money(c.b), { color: '#1D4ED8' }),
    line('C (Cash)', money(c.c), { color: '#15803D' }),
  ];

  return {
    pageSize: 'A4',
    pageMargins: [28, 28, 28, 36],
    defaultStyle: { font: 'Helvetica', fontSize: 10, color: BLACK },
    content: [
      {
        table: {
          widths: ['*', 'auto'],
          body: [[
            { text: title, color: '#ffffff', bold: true, fontSize: 18 },
            { text: c.code, color: '#ffffff', bold: true, fontSize: 13, alignment: 'right', margin: [0, 4, 0, 0] },
          ]],
        },
        layout: { fillColor: () => BLUE, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 8, paddingBottom: () => 8 },
      },
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 539, h: 4, color: AMBER }], margin: [0, 0, 0, 16] },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'PARTY,', color: BLUE, bold: true, fontSize: 8 },
              { text: c.customerName, bold: true, fontSize: 14, margin: [0, 1, 0, 0] },
              { text: c.billingAddress || '', fontSize: 9, color: '#555555', margin: [0, 1, 0, 0] },
            ],
          },
          {
            width: 'auto',
            table: {
              body: [
                [{ text: `${title} No :`, color: BLUE, bold: true }, { text: c.code, bold: true, alignment: 'right' }],
                [{ text: 'Date :', color: BLUE, bold: true }, { text: d(c.invDate), bold: true, alignment: 'right' }],
                [{ text: 'Due Date :', color: BLUE, bold: true }, { text: d(c.dueDate), bold: true, alignment: 'right' }],
              ],
            },
            layout: 'noBorders',
          },
        ],
        margin: [0, 0, 0, 14],
      },
      {
        table: { headerRows: 1, widths: [14, 52, '*', 48, 28, 28, 34, 26, 30, 40, 50], body: [head, ...rows] },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? ACCENT : rowIndex % 2 === 0 ? '#F5F7FA' : null),
          hLineColor: () => '#C9D2DC',
          vLineColor: () => '#C9D2DC',
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
        margin: [0, 0, 0, 12],
      },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'Amount in words:', color: BLUE, bold: true, fontSize: 8 },
              { text: amountInWordsIndian(total), italics: true, fontSize: 10, margin: [0, 1, 0, 0] },
            ],
          },
          {
            width: 'auto',
            table: { widths: [130, 80], body: totalsBody },
            layout: {
              hLineColor: () => '#E2E8F0',
              vLineColor: () => '#E2E8F0',
              hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
              vLineWidth: () => 0,
              paddingTop: () => 3,
              paddingBottom: () => 3,
              paddingLeft: () => 8,
              paddingRight: () => 4,
            },
          },
        ],
      },
      ...(c.remarks ? [{ text: `Remarks: ${c.remarks}`, fontSize: 9, color: '#555555', margin: [0, 14, 0, 0] }] : []),
    ],
    footer: () => ({
      columns: [
        { text: new Date().toLocaleString('en-GB'), fontSize: 7, color: '#888888', margin: [28, 0, 0, 0] },
        { text: `**This is a computer-generated ${title.toLowerCase()}**`, fontSize: 7, color: '#888888', alignment: 'right', margin: [0, 0, 28, 0] },
      ],
    }),
  } as unknown as TDocumentDefinitions;
}

/** Indian numbering amount-in-words (e.g. 1,23,456 → "One Lakh Twenty Three Thousand …"). */
function amountInWordsIndian(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  const words = rupees === 0 ? 'Zero' : numToWords(rupees);
  const main = `${words} Rupees`;
  return paise > 0 ? `${main} and ${numToWords(paise)} Paise Only` : `${main} Only`;
}

function numToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const below1000 = (x: number): string => {
    let s = '';
    if (x >= 100) {
      s += `${ones[Math.floor(x / 100)]} Hundred`;
      x %= 100;
      if (x) s += ' ';
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
