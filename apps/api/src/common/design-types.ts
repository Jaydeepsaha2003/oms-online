import type { PrismaClient } from '@prisma/client';

/**
 * The design master's own set of design TYPES, upper-cased.
 *
 * Needed wherever an order/challan line's design has to be read, because a line
 * stores the type in one of two columns depending on how it was created — see
 * `resolveLineDesignParts` in @oms/shared, which uses this set to tell a real
 * type from a design NAME sitting in the same column.
 *
 * Lives here rather than in one service because three screens now need it
 * (Design Track, Product Photos, commission pricing) and a private copy in each
 * is how their answers start to differ.
 */
export async function loadKnownDesignTypes(prisma: Pick<PrismaClient, 'design'>): Promise<ReadonlySet<string>> {
  const rows = await prisma.design.findMany({ select: { designType: true }, distinct: ['designType'] });
  return new Set(rows.map((r) => r.designType.trim().toUpperCase()).filter(Boolean));
}
