import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Why a party takes nothing new, or null when it is free.
 *
 * A party on hold gets no order — draft or confirmed — no quotation, no
 * booking, and no order out of a quotation or a booking. Every service that
 * can start one of those asks here, so no route is left open.
 */
export async function partyHoldMessage(
  db: Pick<Prisma.TransactionClient, 'customer'>,
  party: { id?: number | null; name?: string | null },
): Promise<string | null> {
  const where = party.id != null ? { id: party.id } : party.name ? { partyName: party.name } : null;
  if (!where) return null;
  const c = await db.customer.findFirst({ where: { ...where, dispatchHold: true }, select: { partyName: true, dispatchHoldReason: true } });
  if (!c) return null;
  const why = c.dispatchHoldReason?.trim();
  return (
    `${c.partyName || 'This party'} is on hold${why ? ` — ${why}` : ''}. ` +
    'No orders, drafts, quotations or bookings can be made for it; release the hold on the Party On Hold page first.'
  );
}

export async function assertPartyNotOnHold(
  db: Pick<Prisma.TransactionClient, 'customer'>,
  party: { id?: number | null; name?: string | null },
): Promise<void> {
  const msg = await partyHoldMessage(db, party);
  if (msg) throw new BadRequestException(msg);
}
