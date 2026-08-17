import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AGENT_TDS_PERCENT,
  basisUnit,
  bounceTotal,
  claimableRatio,
  commissionQty,
  daysBetween,
  RATIO_EPSILON,
  earnedCommission,
  expectedPaymentDate,
  settlementNet,
  type AgentCommissionAccrualDto,
  type AgentCommissionRateDto,
  type AgentPartyCoverDto,
  type AgentRateCoverageRow,
  type AgentPayMode,
  type BankBounceChargeDto,
  type ChequeBounceEventDto,
  type CommissionBasis,
  type ChequeDueBasis,
  type ChequeTimingDto,
  type Paginated,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { formatDate } from '../common/date.util';
import { readCategoryFields } from '../common/category-fields';
import {
  AgentCommissionQueryDto,
  CreateBankBounceChargeDto,
  CreateBounceEventDto,
  CreateCoverDto,
  CreateRateDto,
  CreateSettlementDto,
  PaySettlementDto,
} from './dto/agent-commission.dto';

type Db = Prisma.TransactionClient;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const EPS = 0.005;
/** A share as a percentage, for messages the owner has to act on. */
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
/** Anything that isn't explicitly PCS is weight — the safer default. */
const normBasis = (v: string | null | undefined): CommissionBasis =>
  (v ?? '').trim().toUpperCase() === 'PCS' ? 'PCS' : 'KGS';

/** How much of one invoice+category the agent has already been paid for. */
interface SettledShare {
  /** 0–1, summed across every PAID line for that invoice. */
  ratio: number;
  amount: number;
  /** The rate last applied, so an owner's rate cut carries into the balance. */
  lastRatePerUnit: number | null;
}

const day = (v: string | Date | undefined, label: string): Date => {
  const d = v ? new Date(v) : new Date();
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} is not a valid date.`);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Money a party has actually paid against an invoice, and what was collectible. */
interface InvoicePayState {
  /** The invoice's bank + cash legs — what the party was billed. */
  invoiceAmount: number;
  /** Receipts only. A discount is NOT money received, so it never counts here. */
  paidAmount: number;
  /** Written off via Sales Discount — removed from the denominator, since the
   *  agent can't collect what was given away. */
  discountAmount: number;
  /** paidAmount ÷ collectible, clamped to 0–1. */
  paidRatio: number;
}

@Injectable()
export class AgentCommissionService {
  constructor(private readonly prisma: PrismaService) {}

  /* ── Rate master ──────────────────────────────────────────────────────── */

  /**
   * The rate in force for an agent + category on a given date.
   *
   * Date-effective by design: an invoice raised in April must price at April's
   * rate even when it is settled in August, so this never simply reads "the
   * agent's current rate".
   */
  /** The rate in force for a category on a date, with the unit it is charged in. */
  private async rateFor(
    db: Db,
    agentId: number,
    pCategory: string,
    on: Date,
  ): Promise<{ ratePerUnit: number; basis: CommissionBasis } | null> {
    const row = await db.agentCommissionRate.findFirst({
      where: { agentId, pCategory, effectiveFrom: { lte: on } },
      orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
      select: { ratePerUnit: true, basis: true },
    });
    return row ? { ratePerUnit: row.ratePerUnit, basis: normBasis(row.basis) } : null;
  }

  async listRates(agentId?: number): Promise<AgentCommissionRateDto[]> {
    const rows = await this.prisma.agentCommissionRate.findMany({
      where: agentId ? { agentId } : {},
      orderBy: [{ agentName: 'asc' }, { pCategory: 'asc' }, { effectiveFrom: 'desc' }],
    });
    // "Current" = the newest row not in the future, per agent+category.
    const now = new Date();
    const seen = new Set<string>();
    return rows.map((r) => {
      const key = `${r.agentId}|${r.pCategory}`;
      const current = r.effectiveFrom <= now && !seen.has(key);
      if (current) seen.add(key);
      return {
        id: r.id,
        agentId: r.agentId,
        agentName: r.agentName,
        pCategory: r.pCategory,
        basis: normBasis(r.basis),
        ratePerUnit: r.ratePerUnit,
        effectiveFrom: r.effectiveFrom.toISOString(),
        note: r.note,
        current,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /**
   * Every agent × category the business actually invoices, with the rate in
   * force beside it.
   *
   * Built from the goods rather than from the rate master, so a category an
   * agent sells but is not paid for shows up as a gap instead of simply being
   * absent — that omission is invisible everywhere else in the system and
   * silently pays the agent nothing.
   */
  async rateCoverage(): Promise<AgentRateCoverageRow[]> {
    const sold = await this.prisma.$queryRaw<
      { agentName: string; pCategory: string; invoiceCount: bigint | number; kgs: bigint | number | null; pcs: bigint | number | null; lastInvoiceDate: Date | string | null }[]
    >`
      SELECT c.agentName          AS agentName,
             UPPER(TRIM(ci.pCategory)) AS pCategory,
             COUNT(DISTINCT ch.id) AS invoiceCount,
             SUM(COALESCE(ci.kgs, 0)) AS kgs,
             SUM(COALESCE(ci.pcs, 0)) AS pcs,
             MAX(ch.invDate)      AS lastInvoiceDate
      FROM challan_items ci
      JOIN challans ch  ON ch.id = ci.challanId AND ch.challanStatus = 'CONFIRMED'
      JOIN customers c  ON c.id = ch.customerId
      WHERE c.agentName IS NOT NULL AND TRIM(c.agentName) <> ''
        AND ci.pCategory IS NOT NULL AND TRIM(ci.pCategory) <> ''
      GROUP BY c.agentName, UPPER(TRIM(ci.pCategory))
    `;

    const [agents, rates, categoryFields] = await Promise.all([
      this.prisma.agent.findMany({ select: { id: true, name: true } }),
      this.listRates(),
      readCategoryFields(this.prisma),
    ]);
    const agentByName = new Map(agents.map((a) => [a.name.trim().toUpperCase(), a]));
    const current = new Map(rates.filter((r) => r.current).map((r) => [`${r.agentId}|${r.pCategory}`, r]));
    const suggested = new Map(categoryFields.map((f) => [f.category.trim().toUpperCase(), (f.field === 'PCS' ? 'PCS' : 'KGS') as CommissionBasis]));

    const out: AgentRateCoverageRow[] = [];
    const seen = new Set<string>();
    for (const s of sold) {
      const agent = agentByName.get((s.agentName ?? '').trim().toUpperCase());
      if (!agent) continue; // a party tagged with an agent who no longer exists
      const key = `${agent.id}|${s.pCategory}`;
      seen.add(key);
      const rate = current.get(key);
      out.push({
        agentId: agent.id,
        agentName: agent.name,
        pCategory: s.pCategory,
        // SQLite hands back INTEGER aggregates as BigInt, which explodes on any
        // arithmetic — coerce before touching them.
        invoiceCount: Number(s.invoiceCount ?? 0),
        kgs: r2(Number(s.kgs ?? 0)),
        pcs: r2(Number(s.pcs ?? 0)),
        // MAX() over a DATETIME comes back as a raw epoch, and SQLite types it
        // as INTEGER — so it arrives as a BigInt that `new Date` refuses.
        lastInvoiceDate: s.lastInvoiceDate ? new Date(typeof s.lastInvoiceDate === 'object' ? s.lastInvoiceDate : Number(s.lastInvoiceDate)).toISOString() : null,
        ratePerUnit: rate?.ratePerUnit ?? null,
        basis: rate?.basis ?? null,
        effectiveFrom: rate?.effectiveFrom ?? null,
        suggestedBasis: suggested.get(s.pCategory) ?? null,
        gap: !rate,
      });
    }

    // Rates set for something the agent has never actually invoiced still belong
    // on the grid — otherwise editing or deleting them would be impossible here.
    for (const r of rates.filter((x) => x.current)) {
      const key = `${r.agentId}|${r.pCategory}`;
      if (seen.has(key)) continue;
      out.push({
        agentId: r.agentId, agentName: r.agentName, pCategory: r.pCategory,
        invoiceCount: 0, kgs: 0, pcs: 0, lastInvoiceDate: null,
        ratePerUnit: r.ratePerUnit, basis: r.basis, effectiveFrom: r.effectiveFrom,
        suggestedBasis: suggested.get(r.pCategory) ?? null,
        gap: false,
      });
    }

    return out.sort((a, b) => a.agentName.localeCompare(b.agentName) || a.pCategory.localeCompare(b.pCategory));
  }

  async createRate(dto: CreateRateDto, userName?: string | null): Promise<AgentCommissionRateDto> {
    const agent = await this.prisma.agent.findUnique({ where: { id: dto.agentId } });
    if (!agent) throw new NotFoundException('Agent not found.');
    const pCategory = dto.pCategory.trim().toUpperCase();
    if (!pCategory) throw new BadRequestException('Category is required.');
    if (!Number.isFinite(dto.ratePerUnit) || dto.ratePerUnit < 0) throw new BadRequestException('Rate cannot be negative.');
    const basis = normBasis(dto.basis);
    const effectiveFrom = day(dto.effectiveFrom, 'Effective from');

    // A category nobody sells can never earn anything, so it is a typo rather
    // than a rate. Checked against the categories actually on challan lines.
    const known = await this.prisma.challanItem.findFirst({ where: { pCategory }, select: { id: true } });
    if (!known) {
      const real = await this.prisma.challanItem.findMany({ select: { pCategory: true }, distinct: ['pCategory'], take: 40 });
      const list = real.map((r) => r.pCategory).filter(Boolean).sort().slice(0, 12).join(', ');
      throw new BadRequestException(`No goods have ever been invoiced under "${pCategory}", so a rate on it would never pay out. Categories in use: ${list}.`);
    }

    // Two rates for the same agent, category and date make "the rate in force"
    // ambiguous — whichever was keyed last would silently win.
    const clash = await this.prisma.agentCommissionRate.findFirst({
      where: { agentId: agent.id, pCategory, effectiveFrom },
    });
    if (clash) {
      throw new BadRequestException(
        `${agent.name} already has a ${pCategory} rate effective ${formatDate(effectiveFrom)} (₹${clash.ratePerUnit}/${basisUnit(normBasis(clash.basis))}). ` +
          'Delete that one first, or set this rate from a different date.',
      );
    }

    // Changing the unit under invoices already priced the old way would make a
    // settlement compare pieces against kilos.
    const priorBasis = await this.prisma.agentCommissionRate.findFirst({
      where: { agentId: agent.id, pCategory },
      orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
    });
    if (priorBasis && normBasis(priorBasis.basis) !== basis) {
      const paid = await this.prisma.agentSettlementLine.count({
        where: { invNo: { not: '' }, pCategory, settlement: { agentId: agent.id, status: 'PAID' } },
      });
      if (paid) {
        throw new BadRequestException(
          `${pCategory} commission has already been PAID to ${agent.name} on ${paid} invoice line${paid === 1 ? '' : 's'} charged per ` +
            `${basisUnit(normBasis(priorBasis.basis))}. Switching it to per ${basisUnit(basis)} now would make those settlements incomparable. ` +
            'Settle the current basis first, or raise this under a new category.',
        );
      }
    }

    // A rate far above anything ever used is almost always a slipped decimal.
    const HIGH = basis === 'PCS' ? 500 : 5000;
    if (dto.ratePerUnit > HIGH) {
      throw new BadRequestException(`₹${dto.ratePerUnit} per ${basisUnit(basis)} looks like a typo — the highest sensible rate is ₹${HIGH}. Check the decimal point.`);
    }

    const row = await this.prisma.agentCommissionRate.create({
      data: {
        agentId: agent.id,
        agentName: agent.name,
        pCategory,
        basis,
        ratePerUnit: dto.ratePerUnit,
        effectiveFrom,
        note: dto.note?.trim() || null,
        userName: userName ?? null,
      },
    });
    return (await this.listRates(agent.id)).find((r) => r.id === row.id)!;
  }

  async deleteRate(id: number): Promise<void> {
    const rate = await this.prisma.agentCommissionRate.findUnique({ where: { id } });
    if (!rate) throw new NotFoundException('Rate not found.');

    // Money already paid on this rate has to stay explainable.
    const paid = await this.prisma.agentSettlementLine.count({
      where: { pCategory: rate.pCategory, settlement: { agentId: rate.agentId, status: 'PAID' } },
    });
    if (paid) {
      throw new BadRequestException(
        `${rate.agentName} has already been paid commission on ${paid} ${rate.pCategory} invoice line${paid === 1 ? '' : 's'}. ` +
          'Deleting the rate they were priced on would leave those settlements unexplainable — supersede it with a new dated rate instead.',
      );
    }
    await this.prisma.agentCommissionRate.delete({ where: { id } });
  }

  /* ── Accrual engine ───────────────────────────────────────────────────── */

  /**
   * Recompute what one invoice earned its agent.
   *
   * Deliberately idempotent — it deletes and re-derives the invoice's accruals
   * every time, so editing a challan's lines (or fixing a rate that was wrong
   * when it was raised) simply produces the right answer on the next run rather
   * than leaving a stale row behind.
   *
   * Nothing accrues when: the challan isn't CONFIRMED, the party has no agent,
   * or no rate is configured for that agent + category on the invoice date. The
   * last case is silent on purpose — a business may only pay commission on some
   * categories, and an un-rated one is simply not commissionable.
   */
  async rebuildForChallan(challanId: number): Promise<number> {
    const challan = await this.prisma.challan.findUnique({
      where: { id: challanId },
      include: { items: true },
    });
    if (!challan) return 0;

    await this.prisma.agentCommissionAccrual.deleteMany({ where: { challanId } });
    if (challan.challanStatus !== 'CONFIRMED') return 0;

    // The party's agent, resolved through the customer master (a challan has no
    // agent of its own).
    const customer = challan.customerId
      ? await this.prisma.customer.findUnique({ where: { id: challan.customerId } })
      : await this.prisma.customer.findFirst({ where: { partyName: challan.customerName } });
    const agentName = customer?.agentName?.trim();
    if (!agentName) return 0;
    // "SELF" in that column means the house sold to this party directly — it is
    // the ABSENCE of an agent, spelled in the same field as a name. Checked here
    // and not only at the agent master, because this is where the money starts:
    // if a SELF row ever exists in `agents` (it did), every direct party would
    // silently start accruing commission payable to nobody.
    if (agentName.toUpperCase() === 'SELF') return 0;
    const agent = await this.prisma.agent.findFirst({ where: { name: agentName } });
    if (!agent) return 0;

    // Commission is per unit of the LINE's product category (§1) — "Ashwin ji /
    // Glass / ₹40" is about the goods, not the customer's own category. Both
    // totals are collected because whether the category is charged by weight or
    // by piece is the rate's decision, not the line's.
    const byCategory = new Map<string, { kgs: number; pcs: number }>();
    for (const it of challan.items) {
      const cat = (it.pCategory ?? '').trim().toUpperCase();
      const kgs = it.kgs ?? 0;
      const pcs = it.pcs ?? 0;
      if (!cat || (kgs <= 0 && pcs <= 0)) continue;
      const cur = byCategory.get(cat) ?? { kgs: 0, pcs: 0 };
      byCategory.set(cat, { kgs: r2(cur.kgs + kgs), pcs: r2(cur.pcs + pcs) });
    }
    if (!byCategory.size) return 0;

    let written = 0;
    for (const [pCategory, totals] of byCategory) {
      const rate = await this.rateFor(this.prisma, agent.id, pCategory, challan.invDate);
      if (rate == null) continue;
      const qty = commissionQty(rate.basis, totals.kgs, totals.pcs);
      // A PCS category on an invoice that recorded no pieces earns nothing —
      // better a zero than a number derived from the wrong measure.
      if (qty <= 0) continue;
      await this.prisma.agentCommissionAccrual.create({
        data: {
          agentId: agent.id,
          agentName: agent.name,
          challanId: challan.id,
          invNo: challan.code,
          customerId: challan.customerId,
          customerName: challan.customerName,
          pCategory,
          basis: rate.basis,
          qty,
          kgs: totals.kgs,
          pcs: totals.pcs,
          ratePerUnit: rate.ratePerUnit,
          amount: r2(qty * rate.ratePerUnit),
          invDate: challan.invDate,
          dueDate: challan.dueDate,
        },
      });
      written += 1;
    }
    return written;
  }

  /**
   * Rebuild every confirmed challan in a window. Used once after the rate master
   * is first filled in (existing invoices predate it and would otherwise never
   * accrue), and safe to re-run whenever rates are corrected.
   */
  async backfill(dateFrom?: string, dateTo?: string): Promise<{ challans: number; accruals: number }> {
    const where: Prisma.ChallanWhereInput = { challanStatus: 'CONFIRMED' };
    if (dateFrom || dateTo) {
      where.invDate = {
        ...(dateFrom ? { gte: day(dateFrom, 'From date') } : {}),
        ...(dateTo ? { lte: (() => { const d = day(dateTo, 'To date'); d.setHours(23, 59, 59, 999); return d; })() } : {}),
      };
    }
    const ids = await this.prisma.challan.findMany({ where, select: { id: true }, orderBy: { id: 'asc' } });
    let accruals = 0;
    for (const { id } of ids) accruals += await this.rebuildForChallan(id);
    return { challans: ids.length, accruals };
  }

  /* ── Eligibility: how much of each invoice actually came in ───────────── */

  /**
   * Per invoice: billed, received, and the resulting ratio.
   *
   * Only RECEIPTS count as paid — a Sales Discount is money forgiven, not money
   * collected. It comes off the DENOMINATOR instead, so discounting ₹100 of a
   * ₹10,000 bill and collecting the other ₹9,900 reads as fully collected
   * rather than stranding the invoice at 99% forever.
   */
  private async payStateFor(invNos: string[]): Promise<Map<string, InvoicePayState>> {
    const out = new Map<string, InvoicePayState>();
    if (!invNos.length) return out;
    const [challans, recs, discs] = await Promise.all([
      this.prisma.challan.findMany({ where: { code: { in: invNos } }, select: { code: true, b: true, c: true } }),
      this.prisma.acctPaymentReceipt.groupBy({ by: ['invNo'], where: { invNo: { in: invNos } }, _sum: { recAmt: true } }),
      this.prisma.acctPartyDiscount.groupBy({ by: ['invNo'], where: { invNo: { in: invNos } }, _sum: { disAmt: true } }),
    ]);
    const paidBy = new Map(recs.map((r) => [r.invNo ?? '', r2(r._sum.recAmt ?? 0)]));
    const discBy = new Map(discs.map((d) => [d.invNo ?? '', r2(d._sum.disAmt ?? 0)]));
    for (const c of challans) {
      const invoiceAmount = r2((c.b ?? 0) + (c.c ?? 0));
      const paidAmount = paidBy.get(c.code) ?? 0;
      const discountAmount = discBy.get(c.code) ?? 0;
      const collectible = Math.max(0, r2(invoiceAmount - discountAmount));
      const paidRatio = collectible <= EPS ? (paidAmount > EPS ? 1 : 0) : Math.max(0, Math.min(1, paidAmount / collectible));
      out.set(c.code, { invoiceAmount, paidAmount, discountAmount, paidRatio });
    }
    return out;
  }

  /** Invoice+category pairs already locked into a PAID settlement. */
  /**
   * What has already been paid out per invoice+category, as a SHARE of the
   * invoice rather than a yes/no.
   *
   * An invoice settled while the party had only part-paid is not finished with:
   * when the rest of the money comes in, the agent has earned the balance. So
   * the engine tracks how much of each invoice has been commissioned, and the
   * remainder stays claimable. Summing `paidRatio` works on rows written before
   * top-ups existed too, because back then a line always covered the whole of
   * what had been collected.
   */
  private async settledState(agentId?: number): Promise<Map<string, SettledShare>> {
    const lines = await this.prisma.agentSettlementLine.findMany({
      where: { settlement: { status: 'PAID', ...(agentId ? { agentId } : {}) } },
      select: { invNo: true, pCategory: true, paidRatio: true, amount: true, appliedRatePerUnit: true, id: true },
      orderBy: { id: 'asc' },
    });
    const out = new Map<string, SettledShare>();
    for (const l of lines) {
      const key = `${l.invNo}|${l.pCategory}`;
      const cur = out.get(key) ?? { ratio: 0, amount: 0, lastRatePerUnit: null };
      out.set(key, {
        ratio: Math.min(1, r4(cur.ratio + l.paidRatio)),
        amount: r2(cur.amount + l.amount),
        // The most recent rate carries forward: if the owner cut ₹40 to ₹20 on a
        // late invoice (§4), the balance shouldn't quietly go back to ₹40.
        lastRatePerUnit: l.appliedRatePerUnit,
      });
    }
    return out;
  }

  /** Days past due on the invoice date basis — negative while still in terms. */
  private overdueDays(dueDate: Date | null, asOf = new Date()): number | null {
    if (!dueDate) return null;
    return Math.round((asOf.getTime() - dueDate.getTime()) / 86_400_000);
  }

  /* ── §7 Cheque date vs party due date ─────────────────────────────────── */

  /**
   * Compare a cheque's date against when the party's money was actually due.
   *
   * Works on an unsaved cheque too (`chequeId: 0`), because the whole point is
   * to warn the owner WHILE the agent is still standing there — once the cheque
   * is filed the conversation has already been missed.
   *
   * The expected date is the earliest still-unpaid invoice's own due date, or,
   * when the invoice doesn't carry one, its date plus the party's credit period.
   * If the cheque names specific invoices, only those are considered.
   */
  async chequeTiming(input: {
    customerId?: number | null;
    partyName?: string | null;
    chequeDate: string;
    chequeAmount: number;
    invoiceNos?: string[];
    agentName?: string | null;
    chequeId?: number;
    chequeNo?: string | null;
  }): Promise<ChequeTimingDto> {
    const chequeDate = day(input.chequeDate, 'Cheque date');

    const customer = input.customerId
      ? await this.prisma.customer.findUnique({ where: { id: input.customerId } })
      : input.partyName
        ? await this.prisma.customer.findFirst({ where: { partyName: input.partyName.trim() } })
        : null;
    const partyName = customer?.partyName ?? input.partyName?.trim() ?? '';
    if (!partyName) throw new BadRequestException('A party is needed to check the cheque timing.');
    const creditPeriodDays = customer?.creditPeriod ?? null;

    // Every confirmed invoice for this party — narrowed to the tagged ones when
    // the cheque names invoices.
    const tagged = (input.invoiceNos ?? []).map((s) => s.trim()).filter(Boolean);
    const challans = await this.prisma.challan.findMany({
      where: {
        challanStatus: 'CONFIRMED',
        ...(tagged.length ? { code: { in: tagged } } : customer ? { customerId: customer.id } : { partyName }),
      },
      select: { code: true, invDate: true, dueDate: true },
      orderBy: [{ invDate: 'asc' }],
    });

    const pay = await this.payStateFor(challans.map((c) => c.code));
    const unpaid = challans
      .map((c) => {
        const p = pay.get(c.code);
        const owed = p ? r2(Math.max(0, p.invoiceAmount - p.discountAmount - p.paidAmount)) : 0;
        return { ...c, owed };
      })
      .filter((c) => c.owed > EPS);

    const partyOutstanding = r2(unpaid.reduce((s, c) => s + c.owed, 0));

    // The oldest unpaid invoice sets the expected date — that's the money that
    // should have arrived first, and the one the cheque is late against.
    const oldest = unpaid[0] ?? null;
    let expectedDue: Date | null = null;
    let dueBasis: ChequeDueBasis = 'NONE';
    if (oldest?.dueDate) {
      expectedDue = new Date(oldest.dueDate);
      dueBasis = 'INVOICE_DUE_DATE';
    } else if (oldest && creditPeriodDays != null) {
      expectedDue = expectedPaymentDate(oldest.invDate, null, creditPeriodDays);
      dueBasis = 'CREDIT_PERIOD';
    }

    return {
      chequeId: input.chequeId ?? 0,
      chequeNo: input.chequeNo?.trim() ?? '',
      chequeDate: chequeDate.toISOString(),
      chequeAmount: input.chequeAmount,
      partyName,
      agentName: input.agentName?.trim() || null,
      expectedDueDate: expectedDue ? expectedDue.toISOString() : null,
      delayDays: expectedDue ? daysBetween(expectedDue, chequeDate) : null,
      partyOutstanding,
      invoiceNos: unpaid.map((c) => c.code),
      creditPeriodDays,
      dueBasis,
      oldestInvoiceDate: oldest ? oldest.invDate.toISOString() : null,
      coversOutstanding: input.chequeAmount + EPS >= partyOutstanding,
    };
  }

  /** The same analysis for a cheque already on file. */
  async chequeTimingFor(chequeId: number): Promise<ChequeTimingDto> {
    const cheque = await this.prisma.cheque.findUnique({ where: { id: chequeId } });
    if (!cheque) throw new NotFoundException('Cheque not found.');
    return this.chequeTiming({
      customerId: cheque.customerId,
      partyName: cheque.partyName,
      // The cheque's DUE date is the date it can actually be banked — that, not
      // the day it was handed over, is when the money really arrives.
      chequeDate: cheque.dueDate.toISOString(),
      chequeAmount: cheque.chequeAmt,
      invoiceNos: cheque.invoiceNos ? (JSON.parse(cheque.invoiceNos) as string[]) : [],
      agentName: cheque.agentName,
      chequeId: cheque.id,
      chequeNo: cheque.chequeNo,
    });
  }

  async accruals(q: AgentCommissionQueryDto): Promise<Paginated<AgentCommissionAccrualDto>> {
    const where: Prisma.AgentCommissionAccrualWhereInput = {
      ...(q.agentId ? { agentId: q.agentId } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.pCategory ? { pCategory: q.pCategory.toUpperCase() } : {}),
      ...(q.dateFrom || q.dateTo
        ? {
            invDate: {
              ...(q.dateFrom ? { gte: day(q.dateFrom, 'From date') } : {}),
              ...(q.dateTo ? { lte: (() => { const d = day(q.dateTo, 'To date'); d.setHours(23, 59, 59, 999); return d; })() } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.agentCommissionAccrual.findMany({ where, orderBy: [{ invDate: 'desc' }, { id: 'desc' }], skip: q.skip, take: q.pageSize }),
      this.prisma.agentCommissionAccrual.count({ where }),
    ]);
    const pay = await this.payStateFor([...new Set(rows.map((r) => r.invNo))]);
    const settled = await this.settledState(q.agentId);

    let items = rows.map((r) => this.toAccrualDto(r, pay.get(r.invNo), settled));
    // Applied after mapping because "settled" isn't a column — it's a join.
    const state = (q.settledState ?? 'UNSETTLED').toUpperCase();
    if (state === 'UNSETTLED') items = items.filter((i) => !i.settled);
    else if (state === 'SETTLED') items = items.filter((i) => i.settled);

    return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  private toAccrualDto(
    r: Prisma.AgentCommissionAccrualGetPayload<object>,
    pay: InvoicePayState | undefined,
    settled: Map<string, SettledShare>,
  ): AgentCommissionAccrualDto {
    const p = pay ?? { invoiceAmount: 0, paidAmount: 0, discountAmount: 0, paidRatio: 0 };
    // Round the ratio ONCE and derive everything from that. The DTO used to
    // expose a 4-dp ratio while earning off the full-precision one, so the
    // settlement screen — which recomputes from what it was given — could land
    // a few paise away from the figure the accrual list showed for the same
    // invoice. Same input, same answer, on both sides.
    const paidRatio = Math.round(p.paidRatio * 10000) / 10000;
    const done = settled.get(`${r.invNo}|${r.pCategory}`) ?? { ratio: 0, amount: 0, lastRatePerUnit: null };
    return {
      id: r.id,
      agentId: r.agentId,
      agentName: r.agentName,
      challanId: r.challanId,
      invNo: r.invNo,
      customerId: r.customerId,
      customerName: r.customerName,
      pCategory: r.pCategory,
      basis: normBasis(r.basis),
      qty: r.qty,
      kgs: r.kgs,
      pcs: r.pcs,
      ratePerUnit: r.ratePerUnit,
      amount: r.amount,
      invDate: r.invDate.toISOString(),
      dueDate: r.dueDate?.toISOString() ?? null,
      invoiceAmount: p.invoiceAmount,
      paidAmount: p.paidAmount,
      paidRatio,
      earnedAmount: earnedCommission(r.qty, r.ratePerUnit, paidRatio),
      overdueDays: this.overdueDays(r.dueDate),
      // "Settled" is now a statement about the CURRENT payment level, not a
      // permanent flag: pay more on the invoice and the balance reopens.
      settled: claimableRatio(paidRatio, done.ratio) <= RATIO_EPSILON,
      settledRatio: done.ratio,
      settledAmount: done.amount,
      payableRatio: claimableRatio(paidRatio, done.ratio),
    };
  }

  /* ── Agent covering a defaulting party ────────────────────────────────── */

  async listCovers(agentId?: number, status?: string): Promise<AgentPartyCoverDto[]> {
    const rows = await this.prisma.agentPartyCover.findMany({
      where: { ...(agentId ? { agentId } : {}), ...(status ? { status: status.toUpperCase() } : {}) },
      orderBy: [{ coveredAt: 'desc' }, { id: 'desc' }],
    });
    // What the party still owes on each covered invoice — once it hits zero the
    // party has paid and the agent is due his money back.
    const pay = await this.payStateFor([...new Set(rows.map((r) => r.invNo).filter((x): x is string => !!x))]);
    return rows.map((r) => {
      const p = r.invNo ? pay.get(r.invNo) : undefined;
      return {
        id: r.id,
        agentId: r.agentId,
        agentName: r.agentName,
        customerId: r.customerId,
        customerName: r.customerName,
        invNo: r.invNo,
        amount: r.amount,
        mode: r.mode as AgentPartyCoverDto['mode'],
        coveredAt: r.coveredAt.toISOString(),
        remarks: r.remarks,
        status: r.status as AgentPartyCoverDto['status'],
        recoveredAt: r.recoveredAt?.toISOString() ?? null,
        recoveredVia: r.recoveredVia,
        partyStillOwes: p ? r2(Math.max(0, p.invoiceAmount - p.discountAmount - p.paidAmount)) : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async createCover(dto: CreateCoverDto, userName?: string | null): Promise<AgentPartyCoverDto> {
    const agent = await this.prisma.agent.findUnique({ where: { id: dto.agentId } });
    if (!agent) throw new NotFoundException('Agent not found.');
    if (!Number.isFinite(dto.amount) || dto.amount <= 0) throw new BadRequestException('Amount must be greater than zero.');

    const customerName = dto.customerName.trim();
    if (!customerName) throw new BadRequestException('Which party was covered?');
    const coveredAt = day(dto.coveredAt, 'Covered on');
    const today = day(undefined, 'today');
    if (coveredAt > today) throw new BadRequestException('A cover cannot be dated in the future — money has not changed hands yet.');

    const customer = dto.customerId
      ? await this.prisma.customer.findUnique({ where: { id: dto.customerId } })
      : await this.prisma.customer.findFirst({ where: { partyName: customerName } });

    const invNo = dto.invNo?.trim() || null;
    if (invNo) {
      const inv = await this.prisma.challan.findFirst({ where: { code: invNo } });
      if (!inv) throw new NotFoundException(`Invoice ${invNo} does not exist.`);
      // Covering party A's money against party B's invoice would corrupt the
      // refund trail when the party eventually pays.
      const belongs = customer ? inv.customerId === customer.id : inv.customerName.trim().toUpperCase() === customerName.toUpperCase();
      if (!belongs) {
        throw new BadRequestException(`Invoice ${invNo} belongs to ${inv.customerName}, not ${customerName}. Pick the right invoice for this party.`);
      }
      // Covering more than the party owes leaves an un-refundable excess.
      const owed = (await this.payStateFor([invNo])).get(invNo);
      const outstanding = owed ? r2(Math.max(0, owed.invoiceAmount - owed.discountAmount - owed.paidAmount)) : 0;
      if (outstanding <= EPS) {
        throw new BadRequestException(`${customerName} has already paid ${invNo} in full — there is nothing for ${agent.name} to cover.`);
      }
      const alreadyCovered = await this.prisma.agentPartyCover.aggregate({
        where: { invNo, status: 'OPEN' }, _sum: { amount: true },
      });
      const room = r2(outstanding - (alreadyCovered._sum.amount ?? 0));
      if (dto.amount > room + EPS) {
        throw new BadRequestException(
          `${invNo} has only ₹${room.toLocaleString('en-IN')} left uncovered (party owes ₹${outstanding.toLocaleString('en-IN')}` +
            `${alreadyCovered._sum.amount ? `, ₹${r2(alreadyCovered._sum.amount).toLocaleString('en-IN')} already covered` : ''}). ` +
            'Covering more than that could not be refunded when the party pays.',
        );
      }
    }

    const row = await this.prisma.agentPartyCover.create({
      data: {
        agentId: agent.id,
        agentName: agent.name,
        customerId: customer?.id ?? dto.customerId ?? null,
        customerName,
        invNo,
        amount: r2(dto.amount),
        mode: dto.mode,
        coveredAt,
        remarks: dto.remarks?.trim() || null,
        userName: userName ?? null,
      },
    });
    return (await this.listCovers(agent.id)).find((c) => c.id === row.id)!;
  }

  /**
   * Mark a cover repaid to the agent. Kept manual on purpose: the party paying
   * is the *trigger*, but whether the agent is refunded in cash or off his next
   * commission is an owner decision, not something to infer.
   */
  async recoverCover(id: number, via: string | undefined): Promise<AgentPartyCoverDto> {
    const row = await this.prisma.agentPartyCover.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Cover not found.');
    if (row.status !== 'OPEN') throw new BadRequestException('This cover is already closed.');
    await this.prisma.agentPartyCover.update({
      where: { id },
      data: { status: 'RECOVERED', recoveredAt: new Date(), recoveredVia: via?.trim() || null },
    });
    return (await this.listCovers(row.agentId)).find((c) => c.id === id)!;
  }

  /* ── Cheque bounce ────────────────────────────────────────────────────── */

  async bankCharges(): Promise<BankBounceChargeDto[]> {
    const rows = await this.prisma.bankBounceCharge.findMany({ orderBy: { bankName: 'asc' } });
    return rows.map((b) => ({
      id: b.id,
      bankName: b.bankName,
      charge: b.charge,
      gstPercent: b.gstPercent,
      total: bounceTotal(b.charge, b.gstPercent),
      updatedAt: b.updatedAt.toISOString(),
    }));
  }

  async upsertBankCharge(dto: CreateBankBounceChargeDto, userName?: string | null): Promise<BankBounceChargeDto> {
    const bankName = dto.bankName.trim();
    if (!bankName) throw new BadRequestException('Bank name is required.');
    if (!Number.isFinite(dto.charge) || dto.charge < 0) throw new BadRequestException('The bounce charge cannot be negative.');
    if (dto.gstPercent < 0 || dto.gstPercent > 100) throw new BadRequestException('GST must be between 0% and 100%.');
    // A four-figure bounce charge is a slipped decimal, not a bank fee.
    if (dto.charge > 2000) throw new BadRequestException(`₹${dto.charge} looks like a typo for a bounce charge — banks charge in the low hundreds.`);
    await this.prisma.bankBounceCharge.upsert({
      where: { bankName },
      update: { charge: dto.charge, gstPercent: dto.gstPercent, userName: userName ?? null },
      create: { bankName, charge: dto.charge, gstPercent: dto.gstPercent, userName: userName ?? null },
    });
    return (await this.bankCharges()).find((b) => b.bankName === bankName)!;
  }

  async listBounces(chequeId?: number, agentId?: number): Promise<ChequeBounceEventDto[]> {
    const rows = await this.prisma.chequeBounceEvent.findMany({
      where: { ...(chequeId ? { chequeId } : {}), ...(agentId ? { cheque: { agentId } } : {}) },
      include: { cheque: true },
      orderBy: [{ bounceDate: 'desc' }, { id: 'desc' }],
    });
    const recovered = new Set(
      (
        await this.prisma.agentSettlementDeduction.findMany({
          where: { kind: 'BOUNCE', settlement: { status: 'PAID' } },
          select: { bounceEventId: true },
        })
      )
        .map((d) => d.bounceEventId)
        .filter((x): x is number => x != null),
    );
    return rows.map((e) => ({
      id: e.id,
      chequeId: e.chequeId,
      chequeNo: e.cheque.chequeNo,
      partyName: e.cheque.partyName,
      agentId: e.cheque.agentId,
      agentName: e.cheque.agentName,
      bounceDate: e.bounceDate.toISOString(),
      bankName: e.bankName,
      charge: e.charge,
      gstPercent: e.gstPercent,
      totalCharge: e.totalCharge,
      reason: e.reason,
      receiptUrl: e.receiptUrl,
      recovered: recovered.has(e.id),
      createdAt: e.createdAt.toISOString(),
    }));
  }

  /**
   * Record a bounce. The charge defaults to the bank's configured rate (§10) but
   * stays editable, and whatever lands here is FROZEN — re-reading the setting
   * later must never rewrite what the bank actually took.
   */
  async createBounce(dto: CreateBounceEventDto, userName?: string | null): Promise<ChequeBounceEventDto> {
    const cheque = await this.prisma.cheque.findUnique({ where: { id: dto.chequeId } });
    if (!cheque) throw new NotFoundException('Cheque not found.');

    const bounceDate = day(dto.bounceDate, 'Bounce date');
    const today = day(undefined, 'today');
    if (bounceDate > today) throw new BadRequestException('A bounce cannot be dated in the future — the bank has not returned it yet.');
    const received = new Date(cheque.recDate);
    received.setHours(0, 0, 0, 0);
    if (bounceDate < received) {
      throw new BadRequestException(
        `Cheque ${cheque.chequeNo} was only received on ${formatDate(received)}, so it cannot have bounced on ${formatDate(bounceDate)}.`,
      );
    }
    // A cheque that cleared cannot also have bounced; this is nearly always the
    // wrong cheque picked from the list.
    if (cheque.status === 'CLEARED') {
      throw new BadRequestException(`Cheque ${cheque.chequeNo} is marked CLEARED — a cleared cheque has not bounced. Check you picked the right one.`);
    }
    // The same cheque bouncing twice on ONE day is a double submit, not two
    // deposits. Different days are legitimate and stay allowed (§9).
    const sameDay = await this.prisma.chequeBounceEvent.findFirst({ where: { chequeId: cheque.id, bounceDate } });
    if (sameDay) {
      throw new BadRequestException(
        `A bounce for cheque ${cheque.chequeNo} on ${formatDate(bounceDate)} is already recorded. ` +
          'A second deposit that bounced on a different day can still be added.',
      );
    }
    if (dto.charge != null && (!Number.isFinite(dto.charge) || dto.charge < 0)) throw new BadRequestException('The bounce charge cannot be negative.');
    if (dto.gstPercent != null && (dto.gstPercent < 0 || dto.gstPercent > 100)) throw new BadRequestException('GST must be between 0% and 100%.');

    const bankName = dto.bankName?.trim() || cheque.drawerBank || null;
    let charge = dto.charge;
    let gstPercent = dto.gstPercent;
    if ((charge == null || gstPercent == null) && bankName) {
      const cfg = await this.prisma.bankBounceCharge.findUnique({ where: { bankName } });
      charge ??= cfg?.charge ?? 0;
      gstPercent ??= cfg?.gstPercent ?? 0;
    }
    charge ??= 0;
    gstPercent ??= 0;
    const row = await this.prisma.chequeBounceEvent.create({
      data: {
        chequeId: cheque.id,
        bounceDate,
        bankName,
        charge,
        gstPercent,
        totalCharge: bounceTotal(charge, gstPercent),
        reason: dto.reason?.trim() || null,
        receiptUrl: dto.receiptUrl ?? null,
        receiptPath: dto.receiptPath ?? null,
        userName: userName ?? null,
      },
    });
    // Keep the cheque's own status honest — it has bounced at least once.
    await this.prisma.cheque.update({ where: { id: cheque.id }, data: { status: 'BOUNCED' } });
    return (await this.listBounces(cheque.id)).find((b) => b.id === row.id)!;
  }

  async deleteBounce(id: number): Promise<void> {
    const used = await this.prisma.agentSettlementDeduction.count({
      where: { bounceEventId: id, settlement: { status: 'PAID' } },
    });
    if (used) throw new BadRequestException('This bounce has already been deducted on a paid settlement.');
    await this.prisma.chequeBounceEvent.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Bounce event not found.');
    });
  }

  /* ── Settlement preview ───────────────────────────────────────────────── */

  /**
   * What a settlement would look like right now — computed, never written.
   *
   * The owner needs to see the numbers before committing: which invoices are
   * eligible, at what rate, and what could be deducted. Only when they save
   * does any of it become a draft.
   */
  async preview(agentId: number, periodFrom: string, periodTo: string) {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found.');
    const from = day(periodFrom, 'Period from');
    const to = day(periodTo, 'Period to');
    to.setHours(23, 59, 59, 999);

    const rows = await this.prisma.agentCommissionAccrual.findMany({
      where: { agentId, invDate: { gte: from, lte: to } },
      orderBy: [{ invDate: 'asc' }, { id: 'asc' }],
    });
    const pay = await this.payStateFor([...new Set(rows.map((r) => r.invNo))]);
    const settled = await this.settledState(agentId);

    // Only the share the party has actually paid for and the agent hasn't
    // already been paid on (§2). An invoice settled at 50% comes back here for
    // its balance once the rest of the money lands.
    const lines = rows
      .map((r) => this.toAccrualDto(r, pay.get(r.invNo), settled))
      .filter((a) => a.payableRatio > RATIO_EPSILON)
      .map((a) => {
        const done = settled.get(`${a.invNo}|${a.pCategory}`);
        // A rate the owner cut on the earlier settlement carries into the
        // balance, rather than reverting to the master rate behind their back.
        const rate = done?.lastRatePerUnit ?? a.ratePerUnit;
        return {
          challanId: a.challanId,
          invNo: a.invNo,
          customerName: a.customerName,
          pCategory: a.pCategory,
          basis: a.basis,
          qty: a.qty,
          baseRatePerUnit: rate,
          // Still fully editable per line (§4).
          appliedRatePerUnit: rate,
          // Only the NEW share — not the invoice's running total.
          paidRatio: a.payableRatio,
          invoiceAmount: a.invoiceAmount,
          paidAmount: a.paidAmount,
          amount: earnedCommission(a.qty, rate, a.payableRatio),
          reason: null,
          overdueDays: a.overdueDays,
          id: 0,
          isTopUp: a.settledRatio > RATIO_EPSILON,
          previouslySettledRatio: a.settledRatio,
          previouslySettledAmount: a.settledAmount,
        };
      })
      .filter((l) => l.amount > EPS);

    // Bounce charges only for cheques THIS agent brought in (§13 + the owner's
    // rule that a party's own cheque isn't the agent's problem).
    const bounceCandidates = (await this.listBounces(undefined, agentId)).filter((b) => !b.recovered);
    const coverCandidates = (await this.listCovers(agentId, 'OPEN')).filter((c) => c.mode === 'COMMISSION_ADJUST');

    return {
      agentId,
      agentName: agent.name,
      periodFrom: from.toISOString(),
      periodTo: to.toISOString(),
      lines,
      bounceCandidates,
      coverCandidates,
      grossCommission: r2(lines.reduce((s, l) => s + l.amount, 0)),
    };
  }

  /* -- Settlement records ------------------------------------------------ */

  async listSettlements(agentId?: number, status?: string) {
    const rows = await this.prisma.agentSettlement.findMany({
      where: { ...(agentId ? { agentId } : {}), ...(status ? { status: status.toUpperCase() } : {}) },
      include: { lines: true, deductions: true },
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((r) => this.toSettlementDto(r));
  }

  async getSettlement(id: number) {
    const row = await this.prisma.agentSettlement.findUnique({ where: { id }, include: { lines: true, deductions: true } });
    if (!row) throw new NotFoundException('Settlement not found.');
    return this.toSettlementDto(row);
  }

  /**
   * Save the owner's decisions as a DRAFT. Nothing is final until paySettlement.
   *
   * Every figure is RE-DERIVED here rather than taken from the payload. The
   * screen sends what it thinks the money is, but a stale tab, a double submit
   * or a hand-made request must never be able to decide what an agent is paid —
   * so the quantity, unit and entitlement come from the accrual, and each
   * deduction from the bounce or cover it names. The only thing the owner
   * genuinely decides is the rate, and that may only go DOWN (§4).
   */
  async createSettlement(dto: CreateSettlementDto, userName?: string | null) {
    const agent = await this.prisma.agent.findUnique({ where: { id: dto.agentId } });
    if (!agent) throw new NotFoundException('Agent not found.');
    if (!dto.lines.length) throw new BadRequestException('A settlement needs at least one commission line.');

    const from = day(dto.periodFrom, 'Period from');
    const to = day(dto.periodTo, 'Period to');
    if (from > to) throw new BadRequestException('The period starts after it ends — check the from and to dates.');

    const payMode = dto.payMode ?? null;
    const tdsPercent = dto.tdsPercent ?? (payMode === 'BANK' ? AGENT_TDS_PERCENT : 0);
    if (tdsPercent < 0 || tdsPercent > 100) throw new BadRequestException('TDS must be between 0% and 100%.');

    const lines = await this.verifyLines(agent.id, agent.name, dto.lines);
    const deductions = await this.verifyDeductions(agent.id, agent.name, dto.deductions);
    const t = this.totals(lines, deductions, payMode, tdsPercent);

    // Deductions bigger than the commission would mean paying a negative amount.
    // `settlementNet` floors the payout at zero, so the shortfall has to be
    // measured BEFORE that clamp — otherwise an over-deducted settlement looks
    // like a tidy ₹0 and the balance owed simply disappears.
    const ded = r2(t.bounceDeduction + t.coverDeduction + t.otherDeduction);
    if (ded > t.grossCommission + EPS) {
      const short = r2(ded - t.grossCommission);
      throw new BadRequestException(
        `Deductions of ₹${ded.toLocaleString('en-IN')} exceed the ₹${t.grossCommission.toLocaleString('en-IN')} commission on this settlement, ` +
          `leaving ₹${short.toLocaleString('en-IN')} that cannot be recovered from it. ` +
          'Remove some deductions and take the rest off the next settlement instead.',
      );
    }

    const created = await this.prisma.agentSettlement.create({
      data: {
        agentId: agent.id,
        agentName: agent.name,
        periodFrom: from,
        periodTo: to,
        grossCommission: t.grossCommission,
        bounceDeduction: t.bounceDeduction,
        coverDeduction: t.coverDeduction,
        otherDeduction: t.otherDeduction,
        payMode,
        tdsPercent,
        tdsAmount: t.tdsAmount,
        netPayable: t.netPayable,
        remarks: dto.remarks?.trim() || null,
        userName: userName ?? null,
        // Both sets are the VERIFIED rows, re-derived above — never the payload.
        lines: { create: lines },
        deductions: { create: deductions },
      },
      include: { lines: true, deductions: true },
    });
    // Human code, mirroring the app's other documents.
    const withCode = await this.prisma.agentSettlement.update({
      where: { id: created.id },
      data: { code: 'AGS-' + String(created.id).padStart(5, '0') },
      include: { lines: true, deductions: true },
    });
    return this.toSettlementDto(withCode);
  }

  /**
   * Pay a draft out. This is the point of no return: its invoices now read as
   * settled and cannot be claimed again, and every cover it recouped is closed.
   */
  async paySettlement(id: number, dto: PaySettlementDto, userName?: string | null) {
    const row = await this.prisma.agentSettlement.findUnique({ where: { id }, include: { lines: true, deductions: true } });
    if (!row) throw new NotFoundException('Settlement not found.');
    if (row.status !== 'DRAFT') throw new BadRequestException('Only a draft settlement can be paid.');

    const payMode = dto.payMode;
    const tdsPercent = dto.tdsPercent ?? (payMode === 'BANK' ? AGENT_TDS_PERCENT : 0);
    if (tdsPercent < 0 || tdsPercent > 100) throw new BadRequestException('TDS must be between 0% and 100%.');
    if (dto.paidAt) {
      const paidOn = day(dto.paidAt, 'Paid on');
      if (paidOn > day(undefined, 'today')) throw new BadRequestException('A settlement cannot be dated in the future — pay it on the day the money moves.');
    }
    const t = this.totals(row.lines, row.deductions, payMode, tdsPercent);

    // A draft is a snapshot. If the invoice behind a line has been edited since
    // — quantity changed, category re-priced — the draft would pay yesterday's
    // figure. Refuse rather than quietly overpay.
    const accruals = await this.prisma.agentCommissionAccrual.findMany({
      where: { agentId: row.agentId, invNo: { in: [...new Set(row.lines.map((l) => l.invNo))] } },
    });
    const accByKey = new Map(accruals.map((a) => [`${a.invNo}|${a.pCategory}`, a]));
    const stale = row.lines.filter((l) => {
      const a = accByKey.get(`${l.invNo}|${l.pCategory}`);
      return !a || Math.abs(a.qty - l.qty) > 0.005 || normBasis(a.basis) !== normBasis(l.basis);
    });
    if (stale.length) {
      const shown = stale.slice(0, 3).map((l) => `${l.invNo} (${l.pCategory})`).join(', ');
      throw new BadRequestException(
        `${stale.length === 1 ? 'An invoice on' : `${stale.length} invoices on`} this draft ${stale.length === 1 ? 'has' : 'have'} changed since it was prepared: ` +
          `${shown}${stale.length > 3 ? ' …' : ''}. Cancel it and build a fresh settlement so the agent is paid on the current figures.`,
      );
    }

    // A draft doesn't reserve its lines, so two drafts can be raised over the
    // same commission and both look payable. The preview only offers the share
    // that's still claimable, but nothing stopped a stale draft being paid on
    // top — so re-check here, in shares, against what the party has paid by now.
    //
    // This is a share comparison rather than a yes/no because a part-settled
    // invoice is legitimately claimable again for its balance; what must never
    // happen is the total claimed exceeding what the party has actually paid.
    const alreadyPaid = await this.settledState(row.agentId);
    const payNow = await this.payStateFor([...new Set(row.lines.map((l) => l.invNo))]);
    const claimed = new Map<string, number>();
    for (const l of row.lines) {
      const key = `${l.invNo}|${l.pCategory}`;
      claimed.set(key, r4((claimed.get(key) ?? 0) + l.paidRatio));
    }
    const over: string[] = [];
    for (const [key, want] of claimed) {
      const invNo = key.slice(0, key.lastIndexOf('|'));
      const collected = r4(Math.min(1, payNow.get(invNo)?.paidRatio ?? 0));
      const room = claimableRatio(collected, alreadyPaid.get(key)?.ratio ?? 0);
      if (want > room + RATIO_EPSILON) {
        over.push(
          `${invNo} (${key.slice(key.lastIndexOf('|') + 1)}) — claiming ${pct(want)} but only ${pct(room)} is unpaid-for` +
            `${room <= RATIO_EPSILON ? ' (already settled in full at the party’s current payment)' : ''}`,
        );
      }
    }
    if (over.length) {
      throw new BadRequestException(
        `This settlement claims more commission than ${row.agentName} is owed on ` +
          `${over.length === 1 ? 'an invoice' : `${over.length} invoices`}: ${over.slice(0, 5).join('; ')}` +
          `${over.length > 5 ? ' …' : ''}. Rebuild it from a fresh preview.`,
      );
    }
    // Likewise for bounce charges — recovering the same bounce on two
    // settlements would deduct it from the agent twice.
    const bounceIds = row.deductions.filter((d) => d.kind === 'BOUNCE' && d.bounceEventId).map((d) => d.bounceEventId as number);
    if (bounceIds.length) {
      const taken = await this.prisma.agentSettlementDeduction.findMany({
        where: { kind: 'BOUNCE', bounceEventId: { in: bounceIds }, settlement: { status: 'PAID' } },
        select: { bounceEventId: true },
      });
      if (taken.length) {
        throw new BadRequestException(
          `${taken.length === 1 ? 'A bounce charge on this settlement has' : `${taken.length} bounce charges on this settlement have`} already been recovered on an earlier settlement.`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Two people pressing Pay at the same moment both pass the DRAFT check
      // above. Claim the row first: whoever's UPDATE matches wins, the other
      // finds nothing to update and is told so rather than paying twice.
      const claimed = await tx.agentSettlement.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'PAID' } });
      if (claimed.count === 0) {
        throw new BadRequestException('This settlement was just paid or cancelled on another screen. Reload before trying again.');
      }

      // Close every cover this settlement recouped, so it can't be taken twice.
      const coverIds = row.deductions.filter((d) => d.kind === 'COVER' && d.coverId).map((d) => d.coverId as number);
      if (coverIds.length) {
        await tx.agentPartyCover.updateMany({
          where: { id: { in: coverIds }, status: 'OPEN' },
          data: { status: 'RECOVERED', recoveredAt: new Date(), recoveredVia: row.code ?? 'settlement ' + row.id },
        });
      }
      const paid = await tx.agentSettlement.update({
        where: { id },
        data: {
          status: 'PAID',
          payMode,
          tdsPercent,
          grossCommission: t.grossCommission,
          bounceDeduction: t.bounceDeduction,
          coverDeduction: t.coverDeduction,
          otherDeduction: t.otherDeduction,
          tdsAmount: t.tdsAmount,
          netPayable: t.netPayable,
          paidAt: dto.paidAt ? day(dto.paidAt, 'Paid on') : new Date(),
          remarks: dto.remarks?.trim() ?? row.remarks,
          userName: userName ?? row.userName,
        },
        include: { lines: true, deductions: true },
      });
      return this.toSettlementDto(paid);
    });
  }

  async cancelSettlement(id: number) {
    const row = await this.prisma.agentSettlement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Settlement not found.');
    if (row.status === 'PAID') {
      throw new BadRequestException('A paid settlement cannot be cancelled - reverse it with a fresh entry instead.');
    }
    await this.prisma.agentSettlement.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  private toSettlementDto(r: Prisma.AgentSettlementGetPayload<{ include: { lines: true; deductions: true } }>) {
    return {
      id: r.id,
      code: r.code,
      agentId: r.agentId,
      agentName: r.agentName,
      periodFrom: r.periodFrom.toISOString(),
      periodTo: r.periodTo.toISOString(),
      grossCommission: r.grossCommission,
      bounceDeduction: r.bounceDeduction,
      coverDeduction: r.coverDeduction,
      otherDeduction: r.otherDeduction,
      payMode: (r.payMode ?? null) as AgentPayMode | null,
      tdsPercent: r.tdsPercent,
      tdsAmount: r.tdsAmount,
      netPayable: r.netPayable,
      status: r.status as 'DRAFT' | 'PAID' | 'CANCELLED',
      paidAt: r.paidAt?.toISOString() ?? null,
      remarks: r.remarks,
      lines: r.lines.map((l) => ({
        id: l.id,
        challanId: l.challanId,
        invNo: l.invNo,
        customerName: l.customerName,
        pCategory: l.pCategory,
        basis: normBasis(l.basis),
        qty: l.qty,
        baseRatePerUnit: l.baseRatePerUnit,
        appliedRatePerUnit: l.appliedRatePerUnit,
        paidRatio: l.paidRatio,
        invoiceAmount: l.invoiceAmount,
        paidAmount: l.paidAmount,
        amount: l.amount,
        reason: l.reason,
        overdueDays: null,
        isTopUp: l.isTopUp,
        previouslySettledRatio: l.priorSettledRatio,
      })),
      deductions: r.deductions.map((d) => ({
        id: d.id,
        kind: d.kind as 'BOUNCE' | 'COVER' | 'MANUAL',
        bounceEventId: d.bounceEventId,
        coverId: d.coverId,
        chequeNo: d.chequeNo,
        bankName: d.bankName,
        refDate: d.refDate?.toISOString() ?? null,
        amount: d.amount,
        note: d.note,
      })),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  /** Shared by create + pay so the arithmetic exists in exactly one place. */
  /**
   * Re-derive each commission line from the accrual it claims to be about.
   *
   * The payload chooses WHICH invoice and WHAT RATE; everything else — the
   * quantity, the unit, the share claimable, and therefore the money — is read
   * back from the database. A line whose invoice isn't this agent's, or which
   * asks for more than the party has paid for, is refused rather than trimmed,
   * because silently paying less than the screen showed is its own bug.
   */
  private async verifyLines(agentId: number, agentName: string, input: CreateSettlementDto['lines']) {
    const settled = await this.settledState(agentId);
    const accruals = await this.prisma.agentCommissionAccrual.findMany({
      where: { agentId, invNo: { in: [...new Set(input.map((l) => l.invNo))] } },
    });
    const byKey = new Map(accruals.map((a) => [`${a.invNo}|${a.pCategory}`, a]));

    // Two lines for the same invoice+category would each look valid alone while
    // together claiming twice the share.
    const seen = new Set<string>();
    const out: {
      challanId: number | null; invNo: string; customerName: string; pCategory: string;
      basis: CommissionBasis; qty: number; baseRatePerUnit: number; appliedRatePerUnit: number;
      paidRatio: number; invoiceAmount: number; paidAmount: number; amount: number;
      isTopUp: boolean; priorSettledRatio: number; reason: string | null;
    }[] = [];

    for (const l of input) {
      const key = `${l.invNo}|${(l.pCategory ?? '').toUpperCase()}`;
      if (seen.has(key)) throw new BadRequestException(`${l.invNo} (${l.pCategory}) appears twice on this settlement — it can only be claimed once.`);
      seen.add(key);

      const acc = byKey.get(key);
      if (!acc) {
        throw new BadRequestException(
          `${l.invNo} (${l.pCategory}) has no commission recorded for ${agentName}. ` +
            'It may have been re-priced or the invoice changed — rebuild the settlement from a fresh preview.',
        );
      }

      const pay = (await this.payStateFor([acc.invNo])).get(acc.invNo);
      const paidRatio = r4(Math.min(1, pay?.paidRatio ?? 0));
      const already = settled.get(key)?.ratio ?? 0;
      const claimable = claimableRatio(paidRatio, already);
      if (claimable <= RATIO_EPSILON) {
        throw new BadRequestException(`${acc.invNo} (${acc.pCategory}) has no commission left to claim — ${pct(already)} of it is already settled.`);
      }
      // Claiming more than is available is refused; claiming LESS is allowed,
      // since an owner may deliberately settle part of a bill.
      const wanted = r4(l.paidRatio > 0 ? l.paidRatio : claimable);
      if (wanted > claimable + RATIO_EPSILON) {
        throw new BadRequestException(
          `${acc.invNo} (${acc.pCategory}) claims ${pct(wanted)} but only ${pct(claimable)} is unpaid-for. Rebuild from a fresh preview.`,
        );
      }

      const master = settled.get(key)?.lastRatePerUnit ?? acc.ratePerUnit;
      const applied = l.appliedRatePerUnit;
      if (!Number.isFinite(applied) || applied < 0) throw new BadRequestException(`The rate on ${acc.invNo} is not a valid number.`);
      // §4 lets the owner reduce a rate on a delayed bill. Paying ABOVE the
      // agreed rate is not a discretion anyone asked for, and is far more likely
      // a typo or a stale screen than an intention.
      if (applied > master + 0.0001) {
        throw new BadRequestException(
          `${acc.invNo} (${acc.pCategory}) is set to ₹${applied}/${basisUnit(normBasis(acc.basis))}, above the agreed ₹${master}. ` +
            'A rate can be reduced for a delayed bill, but not raised here — change the rate master instead.',
        );
      }

      out.push({
        challanId: acc.challanId,
        invNo: acc.invNo,
        customerName: acc.customerName,
        pCategory: acc.pCategory,
        basis: normBasis(acc.basis),
        qty: acc.qty,
        baseRatePerUnit: master,
        appliedRatePerUnit: applied,
        paidRatio: wanted,
        invoiceAmount: pay?.invoiceAmount ?? 0,
        paidAmount: pay?.paidAmount ?? 0,
        // The money, derived — never the number the client sent.
        amount: earnedCommission(acc.qty, applied, wanted),
        isTopUp: already > RATIO_EPSILON,
        priorSettledRatio: already,
        reason: l.reason?.trim() || null,
      });
    }
    return out;
  }

  /**
   * Re-derive each deduction from the bounce or cover it points at, and refuse
   * anything that isn't this agent's to deduct.
   */
  private async verifyDeductions(agentId: number, agentName: string, input: CreateSettlementDto['deductions']) {
    const out: { kind: string; bounceEventId: number | null; coverId: number | null; chequeNo: string | null; bankName: string | null; refDate: Date | null; amount: number; note: string | null }[] = [];
    const seenBounce = new Set<number>();
    const seenCover = new Set<number>();

    for (const d of input) {
      if (d.kind === 'BOUNCE') {
        if (!d.bounceEventId) throw new BadRequestException('A bounce deduction must say which bounce it recovers.');
        if (seenBounce.has(d.bounceEventId)) throw new BadRequestException('The same bounce charge is listed twice on this settlement.');
        seenBounce.add(d.bounceEventId);

        const ev = await this.prisma.chequeBounceEvent.findUnique({ where: { id: d.bounceEventId }, include: { cheque: true } });
        if (!ev) throw new NotFoundException('That cheque bounce no longer exists.');
        // Only cheques THIS agent brought in are his to answer for.
        if (ev.cheque.agentId !== agentId) {
          throw new BadRequestException(
            `Cheque ${ev.cheque.chequeNo} was not brought in by ${agentName}, so its bounce charge cannot be deducted from his commission.`,
          );
        }
        const taken = await this.prisma.agentSettlementDeduction.count({
          where: { kind: 'BOUNCE', bounceEventId: ev.id, settlement: { status: 'PAID' } },
        });
        if (taken) throw new BadRequestException(`The bounce on cheque ${ev.cheque.chequeNo} has already been recovered on an earlier settlement.`);

        out.push({
          kind: 'BOUNCE', bounceEventId: ev.id, coverId: null,
          chequeNo: ev.cheque.chequeNo, bankName: ev.bankName, refDate: ev.bounceDate,
          amount: ev.totalCharge, // the charge actually levied, not what was sent
          note: d.note?.trim() || null,
        });
      } else if (d.kind === 'COVER') {
        if (!d.coverId) throw new BadRequestException('A cover deduction must say which cover it recovers.');
        if (seenCover.has(d.coverId)) throw new BadRequestException('The same cover is listed twice on this settlement.');
        seenCover.add(d.coverId);

        const cov = await this.prisma.agentPartyCover.findUnique({ where: { id: d.coverId } });
        if (!cov) throw new NotFoundException('That cover no longer exists.');
        if (cov.agentId !== agentId) throw new BadRequestException(`That cover belongs to ${cov.agentName}, not ${agentName}.`);
        if (cov.status !== 'OPEN') throw new BadRequestException(`The cover for ${cov.customerName} is already ${cov.status.toLowerCase()} and cannot be deducted again.`);
        // Only a cover the agent asked to take out of commission belongs here;
        // one he paid in cash is settled already (§5).
        if (cov.mode !== 'COMMISSION_ADJUST') {
          throw new BadRequestException(
            `The ₹${cov.amount} cover for ${cov.customerName} was handed over in ${cov.mode.toLowerCase()}, not adjusted against commission, so it must not be deducted here.`,
          );
        }
        out.push({ kind: 'COVER', bounceEventId: null, coverId: cov.id, chequeNo: null, bankName: null, refDate: cov.coveredAt, amount: cov.amount, note: d.note?.trim() || null });
      } else {
        // MANUAL — the one figure the owner genuinely types. Still bounded.
        if (!Number.isFinite(d.amount) || d.amount <= 0) throw new BadRequestException('A manual deduction needs an amount above zero.');
        if (!d.note?.trim()) throw new BadRequestException('A manual deduction needs a note saying what it is for.');
        out.push({
          kind: 'MANUAL', bounceEventId: null, coverId: null, chequeNo: d.chequeNo?.trim() || null,
          bankName: d.bankName?.trim() || null, refDate: d.refDate ? day(d.refDate, 'Deduction date') : null,
          amount: r2(d.amount), note: d.note.trim(),
        });
      }
    }
    return out;
  }

  private totals(
    lines: { amount: number }[],
    deductions: { kind: string; amount: number }[],
    payMode: AgentPayMode | null,
    tdsPercent: number,
  ) {
    const grossCommission = r2(lines.reduce((s, l) => s + l.amount, 0));
    const sum = (k: string) => r2(deductions.filter((d) => d.kind === k).reduce((s, d) => s + d.amount, 0));
    const bounceDeduction = sum('BOUNCE');
    const coverDeduction = sum('COVER');
    const otherDeduction = sum('MANUAL');
    const net = settlementNet({ grossCommission, bounceDeduction, coverDeduction, otherDeduction, payMode, tdsPercent });
    return { grossCommission, bounceDeduction, coverDeduction, otherDeduction, ...net };
  }
}
