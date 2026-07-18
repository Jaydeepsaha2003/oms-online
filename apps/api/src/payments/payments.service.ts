import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type ChequeOptionRow,
  type DueType,
  type LedgerEntryDto,
  type Paginated,
  type PartyAdvanceSummary,
  type PaymentAllocation,
  type PaymentContext,
  type PendingAdvanceRow,
  type PendingInvoiceRow,
  type OpeningPendingRow,
  type SavePaymentResult,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerQueryDto, PaymentContextQueryDto, SavePaymentDto } from './dto/payment.dto';

const r2 = (x: number) => Math.round(x * 100) / 100;
const EPS = 0.005;
/** BANK and CHEQUE receipts settle the bank bucket; CASH settles the cash bucket. */
const isBankMode = (m: string) => m === 'BANK' || m === 'CHEQUE';
const BANK_MODES = ['BANK', 'CHEQUE'];

function parseDay(s: string | undefined, label: string): Date {
  const d = s ? new Date(s) : new Date();
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} is not valid.`);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Legacy DUE TYPE: due date crossed = OVERDUE; more than half the credit term
 *  left = NORMAL; otherwise PAST DUE. */
function dueTypeOf(invDate: Date, dueDate: Date | null, today: Date): { dueType: DueType; dueDays: string } {
  if (!dueDate) return { dueType: 'NORMAL', dueDays: '—' };
  const day = 86_400_000;
  const daysLeft = Math.round((dueDate.getTime() - today.getTime()) / day);
  const termDays = Math.round((dueDate.getTime() - invDate.getTime()) / day);
  const dueDays = daysLeft > 0 ? `${daysLeft} LEFT` : daysLeft === 0 ? 'TODAY' : `${Math.abs(daysLeft)} OVER`;
  if (daysLeft <= 0) return { dueType: 'OVERDUE', dueDays };
  if (termDays <= 0) return { dueType: 'NORMAL', dueDays };
  return { dueType: daysLeft / termDays > 0.5 ? 'NORMAL' : 'PAST DUE', dueDays };
}

/** The prisma delegate set usable both from the service root and inside $transaction. */
type Db = Prisma.TransactionClient;

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /* ── Pending context (grid + labels + KPI source) ─────────────────────────── */

  async context(q: PaymentContextQueryDto): Promise<PaymentContext> {
    const recDate = parseDay(q.recDate, 'Receipt date');
    const customers = await this.resolveCustomers(this.prisma, q.customerId ?? null, q.agentName ?? null);
    const [invoices, advances, openings] = await Promise.all([
      this.invoicePending(this.prisma, customers, recDate),
      this.advancePending(this.prisma, customers),
      this.openingPending(this.prisma, customers),
    ]);
    return {
      customers: customers.map((c) => ({ customerId: c.id, customerName: c.name })),
      invoices,
      advances,
      openings,
      totals: {
        invoiceBank: r2(invoices.reduce((a, i) => a + i.bankBal, 0)),
        invoiceCash: r2(invoices.reduce((a, i) => a + i.cashBal, 0)),
        advanceBank: r2(advances.reduce((a, i) => a + i.bankBal, 0)),
        advanceCash: r2(advances.reduce((a, i) => a + i.cashBal, 0)),
        openingBank: r2(openings.reduce((a, i) => a + i.pendingBank, 0)),
        openingCash: r2(openings.reduce((a, i) => a + i.pendingCash, 0)),
      },
    };
  }

  /**
   * Every party (or agent) currently sitting on an outstanding advance —
   * across the whole book, not scoped to one customer/agent like `context()`.
   * The "who's paid in advance" quick-glance view.
   */
  async allAdvances(): Promise<PartyAdvanceSummary[]> {
    const advs = await this.prisma.acctPartyAdvance.findMany({ orderBy: [{ recDate: 'asc' }, { refId: 'asc' }] });
    if (!advs.length) return [];
    const used = await this.prisma.acctPaymentReceipt.groupBy({
      by: ['refRecId', 'payMode'],
      where: { refRecId: { in: advs.map((a) => a.refId) } },
      _sum: { recAmt: true },
    });
    const usedBank = new Map<string, number>();
    const usedCash = new Map<string, number>();
    for (const u of used) {
      const m = BANK_MODES.includes(u.payMode) ? usedBank : usedCash;
      m.set(u.refRecId ?? '', r2((m.get(u.refRecId ?? '') ?? 0) + (u._sum.recAmt ?? 0)));
    }

    // Group by party (custId) or, for AGENT-level advances, by agent name —
    // AGENT advances all share custId = 0, so grouping on that alone would
    // wrongly merge every agent's advances together.
    const byKey = new Map<string, PartyAdvanceSummary>();
    for (const a of advs) {
      const bankBal = Math.max(0, r2(a.bankAmt - (usedBank.get(a.refId) ?? 0)));
      const cashBal = Math.max(0, r2(a.cashAmt - (usedCash.get(a.refId) ?? 0)));
      if (bankBal <= EPS && cashBal <= EPS) continue;
      const isAgent = a.takeAccOn === 'AGENT';
      const key = isAgent ? `agent:${a.customerName}` : `party:${a.custId}`;
      const recIso = a.recDate.toISOString();
      const cur = byKey.get(key);
      if (cur) {
        cur.bankBal = r2(cur.bankBal + bankBal);
        cur.cashBal = r2(cur.cashBal + cashBal);
        cur.total = r2(cur.total + bankBal + cashBal);
        cur.refCount += 1;
        if (recIso < cur.oldestDate) cur.oldestDate = recIso;
      } else {
        byKey.set(key, {
          customerId: isAgent ? null : a.custId,
          customerName: a.customerName,
          agentName: a.agentName,
          takeAccOn: a.takeAccOn,
          bankBal,
          cashBal,
          total: r2(bankBal + cashBal),
          oldestDate: recIso,
          refCount: 1,
        });
      }
    }
    return [...byKey.values()].sort((x, y) => y.total - x.total);
  }

  /** CLEARED cheques of the party with un-received balance (CHEQUE mode picker). */
  async chequeOptions(customerId: number): Promise<ChequeOptionRow[]> {
    const cheques = await this.prisma.cheque.findMany({
      where: { customerId, status: 'CLEARED' },
      orderBy: [{ acctTransDate: 'asc' }, { id: 'asc' }],
    });
    if (!cheques.length) return [];
    const used = await this.prisma.acctPaymentReceipt.groupBy({
      by: ['chequeNo'],
      where: { custId: customerId, chequeNo: { in: cheques.map((c) => c.chequeNo) } },
      _sum: { recAmt: true },
    });
    const usedBy = new Map(used.map((u) => [u.chequeNo ?? '', u._sum.recAmt ?? 0]));
    return cheques
      .map((c) => ({
        chequeNo: c.chequeNo,
        bankName: c.drawerBank,
        balance: r2(c.chequeAmt - (usedBy.get(c.chequeNo) ?? 0)),
        comments: c.comments,
      }))
      .filter((c) => c.balance > EPS);
  }

  /** Voucher history for the Receipt Ledger browser (party or agent). */
  async ledger(q: LedgerQueryDto): Promise<Paginated<LedgerEntryDto>> {
    const and: Prisma.AcctLedgerWhereInput[] = [];
    if (q.customerId != null) and.push({ custId: q.customerId });
    if (q.agentName?.trim()) and.push({ agentName: q.agentName.trim() });
    if (q.dateFrom) and.push({ transDate: { gte: parseDay(q.dateFrom, 'From date') } });
    if (q.dateTo) {
      const to = parseDay(q.dateTo, 'To date');
      to.setHours(23, 59, 59, 999);
      and.push({ transDate: { lte: to } });
    }
    const search = q.search?.trim();
    if (search) and.push({ OR: [{ voucherNo: { contains: search } }, { customerName: { contains: search } }, { particulars: { contains: search } }] });
    const where: Prisma.AcctLedgerWhereInput = and.length ? { AND: and } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.acctLedger.findMany({ where, orderBy: [{ transDate: 'desc' }, { id: 'desc' }], skip: q.skip, take: q.pageSize }),
      this.prisma.acctLedger.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        voucherNo: r.voucherNo,
        transDate: r.transDate.toISOString(),
        customerName: r.customerName,
        customerId: r.custId,
        agentName: r.agentName,
        particulars: r.particulars,
        voucherType: r.voucherType,
        transMode: r.transMode,
        bankCredit: r.bankCredit,
        cashCredit: r.cashCredit,
        transRemarks: r.transRemarks,
        userName: r.userName,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  /* ── Save (the legacy BtnSave waterfall, in one transaction) ──────────────── */

  async save(dto: SavePaymentDto, userName?: string | null): Promise<SavePaymentResult> {
    // Validation — mirrors the legacy ValidateBeforeSave messages, in order.
    const isAgent = dto.takeAccOn === 'AGENT';
    if (isAgent ? !dto.agentName?.trim() : dto.customerId == null) {
      throw new BadRequestException('Please select either Customer / Party Name or Agent Name.');
    }
    if (!['BANK', 'CHEQUE', 'CASH'].includes(dto.payMode)) throw new BadRequestException('Please select Payment Mode (BANK / CHEQUE / CASH).');
    const receiptAmt = r2(dto.receiptAmt);
    if (!Number.isFinite(receiptAmt) || receiptAmt <= 0) throw new BadRequestException('Receipt Amount must be greater than 0.');
    if (isBankMode(dto.payMode) && !dto.bankName?.trim()) throw new BadRequestException('Please select a Bank Name.');
    if (dto.payMode === 'CHEQUE' && !dto.chequeNo?.trim()) throw new BadRequestException('Please select / enter Cheque No.');
    if (dto.payMode === 'CASH' && !dto.cashTransLocation?.trim()) throw new BadRequestException('Please enter Cash Transfer Location.');
    if (dto.payMode === 'CASH' && !dto.cashRecBy?.trim()) throw new BadRequestException('Please enter Cash Received By.');
    if (dto.adjMode === 'AGST REF' && !(dto.selectedInvNos?.length ?? 0)) {
      throw new BadRequestException('AGST REF mode requires selecting at least one invoice.');
    }
    const recDate = parseDay(dto.recDate, 'Receipt date');
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (recDate.getTime() > today.getTime()) throw new BadRequestException('Receipt date cannot be in the future.');

    const bankish = isBankMode(dto.payMode);
    const bankName = dto.bankName?.trim().toUpperCase() || null;
    const chequeNo = dto.payMode === 'CHEQUE' ? dto.chequeNo?.trim().toUpperCase() || null : null;
    const cashLoc = dto.payMode === 'CASH' ? dto.cashTransLocation?.trim().toUpperCase() || null : null;
    const cashBy = dto.payMode === 'CASH' ? dto.cashRecBy?.trim().toUpperCase() || null : null;
    const remarks = dto.remarks?.trim().toUpperCase() || null;

    return this.prisma.$transaction(async (tx) => {
      const customers = await this.resolveCustomers(tx, isAgent ? null : (dto.customerId ?? null), isAgent ? (dto.agentName ?? null) : null);
      const agentName = isAgent ? dto.agentName!.trim() : null;
      const headName = isAgent ? agentName! : customers[0].name;
      const headId = isAgent ? 0 : customers[0].id;

      // 1) Ledger voucher (RN/<n>) — money in = CREDIT on the mode's bucket.
      const voucherNo = await this.nextVoucherNo(tx);
      const particulars =
        dto.payMode === 'BANK' ? (bankName ?? '') : dto.payMode === 'CHEQUE' ? `${bankName} ON CHEQUE: ${chequeNo}` : `CASH RECEIPT BY ${cashBy} / ${cashLoc}`;
      await tx.acctLedger.create({
        data: {
          voucherNo,
          transDate: recDate,
          customerName: headName,
          custId: headId,
          agentName,
          particulars,
          voucherType: 'RECEIPT',
          transMode: dto.payMode,
          bankCredit: bankish ? receiptAmt : 0,
          cashCredit: bankish ? 0 : receiptAmt,
          transRemarks: remarks,
          userName: userName ?? null,
        },
      });

      const allocations: PaymentAllocation[] = [];
      let remaining = receiptAmt;
      let openingCleared = 0;

      // 2) Clear opening balances first (mode bucket). Agent mode: per customer.
      const openings = await this.openingPending(tx, customers);
      for (const o of openings) {
        if (remaining <= EPS) break;
        const pend = bankish ? o.pendingBank : o.pendingCash;
        if (pend <= EPS) continue;
        const clear = r2(Math.min(pend, remaining));
        await tx.acctOpeningTrans.create({
          data: {
            kind: 'CLEARANCE',
            customerName: o.customerName,
            custId: o.customerId,
            transDate: recDate,
            bankAmt: bankish ? clear : 0,
            cashAmt: bankish ? 0 : clear,
            refRecId: voucherNo,
            userName: userName ?? null,
          },
        });
        allocations.push({ kind: 'OPENING', customerName: o.customerName, fundedBy: voucherNo, modeOfAdj: dto.adjMode, amount: clear });
        openingCleared = r2(openingCleared + clear);
        remaining = r2(remaining - clear);
      }

      // 3) Invoice allocation (skipped entirely in ADVANCE mode).
      let invoicesCleared = 0;
      let receiptRefId: string | null = null;
      if (dto.adjMode !== 'ADVANCE' && remaining > EPS) {
        let rows = (await this.invoicePending(tx, customers, recDate)).filter((r) => (bankish ? r.bankBal : r.cashBal) > EPS);
        if (dto.adjMode === 'AGST REF') {
          // Only the ticked invoices, in the user's tick order.
          const order = new Map(dto.selectedInvNos!.map((n, i) => [n, i]));
          rows = rows.filter((r) => order.has(r.invNo)).sort((a, b) => order.get(a.invNo)! - order.get(b.invNo)!);
          if (!rows.length) throw new BadRequestException('AGST REF mode requires selecting at least one invoice.');
        }

        // Party mode: fund each allocation from OLD advances FIFO first, then from
        // today's receipt (the legacy two-step). Agent mode uses only the receipt.
        const advRows = !isAgent
          ? (await this.advancePending(tx, customers)).filter((a) => (bankish ? a.bankBal : a.cashBal) > EPS)
          : [];
        let advIdx = 0;
        let advLeft = advRows.length ? (bankish ? advRows[0].bankBal : advRows[0].cashBal) : 0;

        // Legacy two-tracker behavior: allocations are SIZED by today's receipt
        // (`sizeLeft`), but only the receipt-funded portions consume the actual
        // cash (`remaining`) — receipt money freed by old-advance funding parks
        // as a NEW advance at the end, exactly like PaymentForm.vb.
        let sizeLeft = remaining;
        for (const inv of rows) {
          if (sizeLeft <= EPS) break;
          const pend = bankish ? inv.bankBal : inv.cashBal;
          let need = r2(Math.min(pend, sizeLeft));
          if (need <= EPS) continue;
          sizeLeft = r2(sizeLeft - need);
          invoicesCleared = r2(invoicesCleared + need);

          // Step 1: old advances FIFO.
          while (need > EPS && advIdx < advRows.length) {
            if (advLeft <= EPS) {
              advIdx += 1;
              advLeft = advIdx < advRows.length ? (bankish ? advRows[advIdx].bankBal : advRows[advIdx].cashBal) : 0;
              continue;
            }
            const use = r2(Math.min(need, advLeft));
            receiptRefId ??= await this.nextRefId(tx, 'REC', recDate);
            await tx.acctPaymentReceipt.create({
              data: {
                refId: receiptRefId,
                recDate,
                invNo: inv.invNo,
                customerName: inv.customerName,
                custId: inv.customerId,
                recType: 'RECEIPT',
                recAmt: use,
                payMode: dto.payMode,
                bankName,
                chequeNo,
                cashTransLocation: cashLoc,
                cashRecBy: cashBy,
                modeOfAdj: 'ADVANCE',
                refRecId: advRows[advIdx].refId,
              },
            });
            allocations.push({ kind: 'INVOICE', customerName: inv.customerName, invNo: inv.invNo, fundedBy: advRows[advIdx].refId, modeOfAdj: 'ADVANCE', amount: use });
            need = r2(need - use);
            advLeft = r2(advLeft - use);
          }
          // Step 2: today's receipt (this is the part that consumes actual cash).
          if (need > EPS) {
            receiptRefId ??= await this.nextRefId(tx, 'REC', recDate);
            await tx.acctPaymentReceipt.create({
              data: {
                refId: receiptRefId,
                recDate,
                invNo: inv.invNo,
                customerName: inv.customerName,
                custId: inv.customerId,
                recType: 'RECEIPT',
                recAmt: need,
                payMode: dto.payMode,
                bankName,
                chequeNo,
                cashTransLocation: cashLoc,
                cashRecBy: cashBy,
                modeOfAdj: dto.adjMode,
                refRecId: voucherNo,
              },
            });
            allocations.push({ kind: 'INVOICE', customerName: inv.customerName, invNo: inv.invNo, fundedBy: voucherNo, modeOfAdj: dto.adjMode, amount: need });
            remaining = r2(remaining - need);
          }
        }
      }

      // 4) Whatever's left parks on account (ACCT PARTY ADVANCE).
      let advanceRefId: string | null = null;
      if (remaining > EPS) {
        advanceRefId = await this.nextRefId(tx, 'ADV', recDate);
        await tx.acctPartyAdvance.create({
          data: {
            refId: advanceRefId,
            recDate,
            custId: headId,
            customerName: headName,
            agentName,
            bankAmt: bankish ? remaining : 0,
            cashAmt: bankish ? 0 : remaining,
            payMode: dto.payMode,
            bankName,
            chequeNo,
            cashTransLocation: cashLoc,
            cashRecBy: cashBy,
            recType: 'RECEIPT',
            refRecId: voucherNo,
            takeAccOn: isAgent ? 'AGENT' : 'PARTY',
          },
        });
        allocations.push({ kind: 'ADVANCE_SPILL', customerName: headName, fundedBy: voucherNo, modeOfAdj: dto.adjMode, amount: remaining });
      }

      return {
        voucherNo,
        receiptRefId: receiptRefId ?? '',
        advanceRefId,
        allocations,
        openingCleared,
        invoicesCleared,
        advanceParked: remaining > EPS ? remaining : 0,
      };
    });
  }

  /* ── Derivations (the legacy Access "…Summary" views) ─────────────────────── */

  /** PARTY: the one customer (blocked when payBy=AGENT). AGENT: the agent's customers. */
  private async resolveCustomers(
    db: Db,
    customerId: number | null,
    agentName: string | null,
  ): Promise<{ id: number; name: string; payBy: string | null }[]> {
    if (customerId != null) {
      const c = await db.customer.findUnique({ where: { id: customerId } });
      if (!c) throw new NotFoundException('Customer not found.');
      if ((c.payBy ?? '').trim().toUpperCase() === 'AGENT') {
        throw new BadRequestException('This party always makes payment through an Agent. Please use the Agent Name field to process this receipt.');
      }
      return [{ id: c.id, name: c.partyName ?? `#${c.id}`, payBy: c.payBy }];
    }
    const agent = agentName?.trim();
    if (!agent) throw new BadRequestException('Please select either Customer / Party Name or Agent Name.');
    const list = await db.customer.findMany({ where: { agentName: agent }, orderBy: { partyName: 'asc' } });
    const linked = list.filter((c) => (c.payBy ?? '').trim().toUpperCase() === 'AGENT');
    if (!linked.length) {
      throw new BadRequestException(
        `No parties are configured for Agent: ${agent}. Please ensure at least one party has 'PAY BY = AGENT' linked to this agent in the Customer master.`,
      );
    }
    return list.map((c) => ({ id: c.id, name: c.partyName ?? `#${c.id}`, payBy: c.payBy }));
  }

  /** InvPendingSummary: per CONFIRMED challan dated ≤ recDate, bank/cash pending. */
  private async invoicePending(db: Db, customers: { id: number; name: string }[], recDate: Date): Promise<PendingInvoiceRow[]> {
    const names = customers.map((c) => c.name);
    const idByName = new Map(customers.map((c) => [c.name, c.id]));
    const end = new Date(recDate);
    end.setDate(end.getDate() + 1);
    const challans = await db.challan.findMany({
      where: { challanStatus: 'CONFIRMED', customerName: { in: names }, invDate: { lt: end } },
      orderBy: [{ invDate: 'asc' }, { customerName: 'asc' }, { id: 'asc' }],
      select: { code: true, invDate: true, dueDate: true, transaction: true, customerName: true, b: true, c: true },
    });
    if (!challans.length) return [];
    const codes = challans.map((c) => c.code);
    // Pending = amount − Σ receipts − Σ discounts (Sales Discount reduces the
    // same bank/cash bucket, so both screens reconcile).
    const [recs, discs] = await Promise.all([
      db.acctPaymentReceipt.groupBy({ by: ['invNo', 'payMode'], where: { invNo: { in: codes } }, _sum: { recAmt: true } }),
      db.acctPartyDiscount.groupBy({ by: ['invNo', 'billType'], where: { invNo: { in: codes } }, _sum: { disAmt: true } }),
    ]);
    const bankRec = new Map<string, number>();
    const cashRec = new Map<string, number>();
    for (const r of recs) {
      const m = BANK_MODES.includes(r.payMode) ? bankRec : cashRec;
      m.set(r.invNo, r2((m.get(r.invNo) ?? 0) + (r._sum.recAmt ?? 0)));
    }
    const bankDisc = new Map<string, number>();
    const cashDisc = new Map<string, number>();
    for (const d of discs) {
      const m = d.billType === 'BANK' ? bankDisc : cashDisc;
      m.set(d.invNo, r2((m.get(d.invNo) ?? 0) + (d._sum.disAmt ?? 0)));
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows: PendingInvoiceRow[] = [];
    for (const c of challans) {
      const bankBal = r2((c.b ?? 0) - (bankRec.get(c.code) ?? 0) - (bankDisc.get(c.code) ?? 0));
      const cashBal = r2((c.c ?? 0) - (cashRec.get(c.code) ?? 0) - (cashDisc.get(c.code) ?? 0));
      if (bankBal <= EPS && cashBal <= EPS) continue;
      const dd = dueTypeOf(c.invDate, c.dueDate, today);
      rows.push({
        invNo: c.code,
        invDate: c.invDate.toISOString(),
        dueDate: c.dueDate?.toISOString() ?? null,
        transaction: c.transaction,
        customerId: idByName.get(c.customerName) ?? 0,
        customerName: c.customerName,
        bankBal: Math.max(0, bankBal),
        cashBal: Math.max(0, cashBal),
        dueType: dd.dueType,
        dueDays: dd.dueDays,
      });
    }
    return rows;
  }

  /** AdvPendingSummary: per advance REF ID, remaining bank/cash. FIFO by recDate. */
  private async advancePending(db: Db, customers: { id: number }[]): Promise<PendingAdvanceRow[]> {
    const ids = customers.map((c) => c.id);
    const advs = await db.acctPartyAdvance.findMany({
      where: { custId: { in: ids } },
      orderBy: [{ recDate: 'asc' }, { refId: 'asc' }],
    });
    if (!advs.length) return [];
    const used = await db.acctPaymentReceipt.groupBy({
      by: ['refRecId', 'payMode'],
      where: { refRecId: { in: advs.map((a) => a.refId) } },
      _sum: { recAmt: true },
    });
    const usedBank = new Map<string, number>();
    const usedCash = new Map<string, number>();
    for (const u of used) {
      const m = BANK_MODES.includes(u.payMode) ? usedBank : usedCash;
      m.set(u.refRecId ?? '', r2((m.get(u.refRecId ?? '') ?? 0) + (u._sum.recAmt ?? 0)));
    }
    return advs
      .map((a) => ({
        refId: a.refId,
        recDate: a.recDate.toISOString(),
        customerId: a.custId,
        customerName: a.customerName,
        bankBal: Math.max(0, r2(a.bankAmt - (usedBank.get(a.refId) ?? 0))),
        cashBal: Math.max(0, r2(a.cashAmt - (usedCash.get(a.refId) ?? 0))),
        takeAccOn: a.takeAccOn,
      }))
      .filter((a) => a.bankBal > EPS || a.cashBal > EPS);
  }

  /** OpeningBalSummary: Σ OPENING DEBIT − Σ CLEARANCE per customer (CREDITs excluded). */
  private async openingPending(db: Db, customers: { id: number; name: string }[]): Promise<OpeningPendingRow[]> {
    const ids = customers.map((c) => c.id);
    const rows = await db.acctOpeningTrans.findMany({ where: { custId: { in: ids } } });
    const byCust = new Map<number, { bank: number; cash: number }>();
    for (const r of rows) {
      const cur = byCust.get(r.custId) ?? { bank: 0, cash: 0 };
      if (r.kind === 'OPENING' && r.drCr === 'DEBIT') {
        cur.bank = r2(cur.bank + r.bankAmt);
        cur.cash = r2(cur.cash + r.cashAmt);
      } else if (r.kind === 'CLEARANCE') {
        cur.bank = r2(cur.bank - r.bankAmt);
        cur.cash = r2(cur.cash - r.cashAmt);
      }
      byCust.set(r.custId, cur);
    }
    // Preserve the customer ordering (agent mode clears in partyName order).
    return customers
      .map((c) => ({ customerId: c.id, customerName: c.name, pendingBank: Math.max(0, byCust.get(c.id)?.bank ?? 0), pendingCash: Math.max(0, byCust.get(c.id)?.cash ?? 0) }))
      .filter((c) => c.pendingBank > EPS || c.pendingCash > EPS);
  }

  /* ── Numbering ────────────────────────────────────────────────────────────── */

  /** Legacy voucher: RN/<max numeric suffix + 1>. */
  private async nextVoucherNo(db: Db): Promise<string> {
    const rows = await db.acctLedger.findMany({ where: { voucherNo: { startsWith: 'RN/' } }, select: { voucherNo: true } });
    let max = 0;
    for (const r of rows) {
      const n = parseInt(r.voucherNo.slice(3), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `RN/${max + 1}`;
  }

  /** Legacy REF ID: <PREFIX>-<year>-<0000>, serial per prefix+year. */
  private async nextRefId(db: Db, prefix: 'REC' | 'ADV', recDate: Date): Promise<string> {
    const year = recDate.getFullYear();
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
