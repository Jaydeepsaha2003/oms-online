import { DEFAULT_LEDGER_GROUP } from '@oms/shared';
import type { PrismaService } from '../prisma/prisma.service';

export interface LedgerGroups {
  /** Tally group of a ledger, from the last Tally master upload; null = unknown. */
  groupOf(ledgerName: string): string | null;
  /** True when the group is Sundry Debtors or sits anywhere under it. */
  isParty(groupName: string): boolean;
}

const key = (s: string) => s.trim().toUpperCase();

export async function loadLedgerGroups(prisma: PrismaService): Promise<LedgerGroups> {
  const [ledgers, groups] = await Promise.all([
    prisma.tallyLedger.findMany({ select: { name: true, groupName: true } }),
    prisma.accountGroup.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);
  const groupOf = new Map(ledgers.map((l) => [key(l.name), l.groupName]));
  const root = groups.find((g) => key(g.name) === key(DEFAULT_LEDGER_GROUP));
  const partyIds = new Set<number>(root ? [root.id] : []);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of groups) if (g.parentId != null && partyIds.has(g.parentId) && !partyIds.has(g.id)) (partyIds.add(g.id), (grew = true));
  }
  const partyNames = new Set(groups.filter((g) => partyIds.has(g.id)).map((g) => key(g.name)));
  return {
    groupOf: (name) => groupOf.get(key(name)) ?? null,
    isParty: (group) => partyNames.has(key(group)),
  };
}
