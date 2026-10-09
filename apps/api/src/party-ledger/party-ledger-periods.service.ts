import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PartyLedgerPeriodDto } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';

interface Row {
  id: number | bigint;
  customerId: number | bigint;
  fromDate: string;
  toDate: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string | Date | number;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const toDto = (r: Row): PartyLedgerPeriodDto => ({
  id: Number(r.id),
  customerId: Number(r.customerId),
  from: r.fromDate,
  to: r.toDate,
  note: r.note,
  createdBy: r.createdBy,
  createdAt: new Date(typeof r.createdAt === 'string' && !r.createdAt.includes('T') ? `${r.createdAt.replace(' ', 'T')}Z` : r.createdAt).toISOString(),
});

/**
 * Party Ledger "saved ranges": per party, the periods its ledger was checked /
 * settled for. The newest end date is where the ledger's date filter picks up
 * the next time that party is opened.
 *
 * Plain SQL rather than the Prisma model: the model exists (schema.prisma) but
 * the generated client is only rebuilt on a full restart, and these three
 * statements do not need it.
 */
@Injectable()
export class PartyLedgerPeriodsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(customerId: number): Promise<PartyLedgerPeriodDto[]> {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT * FROM party_ledger_periods WHERE customerId = ${customerId} ORDER BY toDate DESC, id DESC`;
    return rows.map(toDto);
  }

  async create(customerId: number, from: string, to: string, note: string | null, userName: string | null): Promise<PartyLedgerPeriodDto[]> {
    if (!YMD.test(from) || !YMD.test(to)) throw new BadRequestException('Pick a start and an end date.');
    if (from > to) throw new BadRequestException('The start date is after the end date.');
    if (!(await this.prisma.customer.count({ where: { id: customerId } }))) throw new NotFoundException('Party not found.');
    await this.prisma.$executeRaw`
      INSERT INTO party_ledger_periods (customerId, fromDate, toDate, note, createdBy)
      VALUES (${customerId}, ${from}, ${to}, ${note?.trim() || null}, ${userName})`;
    return this.list(customerId);
  }

  async remove(id: number): Promise<PartyLedgerPeriodDto[]> {
    const [row] = await this.prisma.$queryRaw<Row[]>`SELECT * FROM party_ledger_periods WHERE id = ${id}`;
    if (!row) throw new NotFoundException('Saved range not found.');
    await this.prisma.$executeRaw`DELETE FROM party_ledger_periods WHERE id = ${id}`;
    return this.list(Number(row.customerId));
  }
}
