import { BadRequestException, Injectable } from '@nestjs/common';
import type { DaybookDayGroup, DaybookQuery, DaybookResult, DaybookRow } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';

const r0 = (x: number) => Math.round(x);
const DAY = 86_400_000;
/** Debit Notes live in Challan (prefix DN) but reach the ledger via AcctLedger,
 *  so they're excluded here to avoid double-counting — same rule Party Ledger uses. */
const isDebitNoteChallan = (prefix: string | null, transaction: string) =>
  (prefix ?? '').trim().toUpperCase() === 'DN' || transaction.trim().toUpperCase() === 'DEBIT NOTE';

function parseDay(s: string, label: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} is not valid.`);
  d.setHours(0, 0, 0, 0);
  return d;
}

interface RawRow {
  txnDate: Date;
  particulars: string;
  customerName: string;
  voucherType: string;
  voucherNo: string;
  challanId?: number | null;
  dr: number;
  cr: number;
  sortRank: number; // invoices, then opening entries, then ledger vouchers, same-day
}

/**
 * The Daybook: every voucher of every type, across every party, for a date
 * range — a single Dr/Cr pair per voucher (not split into Bank/Cash legs the
 * way Party Ledger is, since a daybook spans everyone at once), grouped by day
 * with a day subtotal. Reuses Party Ledger's same two core sources (Challan
 * sale invoices + AcctLedger vouchers) unfiltered by customer, plus opening
 * balance entries — which Party Ledger only ever folds into a pre-aggregated
 * opening figure, never lists individually — surfaced here as their own dated
 * rows the way Tally's Day Book actually shows them.
 */
@Injectable()
export class DaybookService {
  constructor(private readonly prisma: PrismaService) {}

  async daybook(q: DaybookQuery): Promise<DaybookResult> {
    const from = parseDay(q.from, 'From date');
    const to = parseDay(q.to, 'To date');
    if (to < from) throw new BadRequestException('To date is before From date.');
    const toExclusive = new Date(to.getTime() + DAY);

    const raw = await this.collectRows(from, toExclusive, q.customerId ?? null);

    const voucherTypes = [...new Set(raw.map((r) => r.voucherType).filter(Boolean))].sort();
    const filtered = q.voucherType ? raw.filter((r) => r.voucherType.toUpperCase() === q.voucherType!.toUpperCase()) : raw;

    const byDate = new Map<string, DaybookRow[]>();
    for (const r of filtered) {
      const key = r.txnDate.toISOString();
      const row: DaybookRow = {
        txnDate: r.txnDate.toISOString(),
        particulars: r.particulars,
        customerName: r.customerName,
        voucherType: r.voucherType,
        voucherNo: r.voucherNo,
        challanId: r.challanId ?? null,
        dr: r.dr,
        cr: r.cr,
      };
      const list = byDate.get(key);
      if (list) list.push(row);
      else byDate.set(key, [row]);
    }

    const groups: DaybookDayGroup[] = [...byDate.entries()]
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .map(([date, rows]) => ({
        date,
        rows,
        totalDr: r0(rows.reduce((a, r) => a + r.dr, 0)),
        totalCr: r0(rows.reduce((a, r) => a + r.cr, 0)),
      }));

    return {
      groups,
      voucherTypes,
      totalDr: r0(groups.reduce((a, g) => a + g.totalDr, 0)),
      totalCr: r0(groups.reduce((a, g) => a + g.totalCr, 0)),
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  private async collectRows(from: Date, toExclusive: Date, customerId: number | null): Promise<RawRow[]> {
    const [challans, ledger, openings] = await Promise.all([
      this.prisma.challan.findMany({
        where: { challanStatus: 'CONFIRMED', invDate: { gte: from, lt: toExclusive }, ...(customerId ? { customerId } : {}) },
        select: { id: true, code: true, invDate: true, prefix: true, transaction: true, customerName: true, b: true, c: true },
      }),
      this.prisma.acctLedger.findMany({
        where: { transDate: { gte: from, lt: toExclusive }, ...(customerId ? { custId: customerId } : {}) },
        select: { voucherNo: true, transDate: true, customerName: true, particulars: true, voucherType: true, bankDebit: true, cashDebit: true, bankCredit: true, cashCredit: true },
      }),
      this.prisma.acctOpeningTrans.findMany({
        where: { kind: 'OPENING', transDate: { gte: from, lt: toExclusive }, ...(customerId ? { custId: customerId } : {}) },
        select: { customerName: true, transDate: true, bankAmt: true, cashAmt: true, drCr: true },
      }),
    ]);

    const raw: RawRow[] = [];
    for (const c of challans) {
      if (isDebitNoteChallan(c.prefix, c.transaction)) continue;
      const dr = r0((c.b ?? 0) + (c.c ?? 0));
      if (dr === 0) continue;
      raw.push({
        txnDate: c.invDate,
        particulars: c.customerName,
        customerName: c.customerName,
        voucherType: c.transaction || 'SALES INVOICE',
        voucherNo: c.code,
        challanId: c.id,
        dr,
        cr: 0,
        sortRank: 1,
      });
    }
    for (const o of openings) {
      const amt = r0((o.bankAmt ?? 0) + (o.cashAmt ?? 0));
      if (amt === 0) continue;
      const debit = (o.drCr ?? '').trim().toUpperCase() !== 'CREDIT';
      raw.push({
        txnDate: o.transDate,
        particulars: `${o.customerName} (Opening Balance)`,
        customerName: o.customerName,
        voucherType: 'OPENING BALANCE',
        voucherNo: '-',
        dr: debit ? amt : 0,
        cr: debit ? 0 : amt,
        sortRank: 2,
      });
    }
    for (const l of ledger) {
      let particulars = l.particulars ?? '';
      if ((l.voucherType ?? '').trim().toUpperCase() === 'DEBIT NOTE' && l.customerName) {
        const up = particulars.toUpperCase();
        if (up.startsWith('DEBIT NOTE')) {
          const after = particulars.slice('DEBIT NOTE'.length).trim();
          particulars = after ? `${l.customerName} (${after})` : l.customerName;
        }
      }
      const dr = r0((l.bankDebit ?? 0) + (l.cashDebit ?? 0));
      const cr = r0((l.bankCredit ?? 0) + (l.cashCredit ?? 0));
      if (dr === 0 && cr === 0) continue;
      raw.push({
        txnDate: l.transDate,
        particulars,
        customerName: l.customerName,
        voucherType: l.voucherType || 'RECEIPT',
        voucherNo: l.voucherNo,
        dr,
        cr,
        sortRank: 5,
      });
    }
    raw.sort((a, b) => a.txnDate.getTime() - b.txnDate.getTime() || a.sortRank - b.sortRank || a.voucherNo.localeCompare(b.voucherNo));
    return raw;
  }
}
