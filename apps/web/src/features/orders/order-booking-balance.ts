import type { BookingDto } from '@oms/shared';

export interface BookingOrderLine {
  bookingId?: number | null;
  category: string;
  bags: string;
  gram: string;
  status?: string | null;
}
type Reservation = Pick<BookingDto, 'id' | 'code' | 'bags' | 'kgs' | 'remainingBags' | 'remainingKgs' | 'items'>;
const norm = (s: string) => s.trim().toUpperCase();
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const live = (b: Reservation, lines: readonly BookingOrderLine[]) => lines.filter((l) => l.bookingId === b.id && l.status !== 'CANCELLED');
const sum = (lines: readonly BookingOrderLine[]) => lines.reduce((s, l) => ({ bags: round(s.bags + (Number(l.bags) || 0)), kgs: round(s.kgs + (Number(l.gram) || 0)) }), { bags: 0, kgs: 0 });

/** Add this saved order's allocation back before previewing its replacement. */
export function bookingOrderBalance(b: Reservation, lines: readonly BookingOrderLine[], saved: readonly BookingOrderLine[] = []) {
  const original = sum(live(b, saved));
  const before = { bags: round(b.remainingBags + original.bags), kgs: round(b.remainingKgs + original.kgs) };
  const used = sum(live(b, lines));
  return { before, used, after: { bags: round(before.bags - used.bags), kgs: round(before.kgs - used.kgs) } };
}

/** A booking may be drawn past what it has left (it then reads fully drawn);
 *  only a category it never reserved is refused. */
export function bookingCapacityError(b: Reservation, lines: readonly BookingOrderLine[], _saved: readonly BookingOrderLine[] = []): string | null {
  if (!b.items.length) return null; // Legacy reservation without category lines.
  const bucketFor = (l: BookingOrderLine) => b.items.find((i) => norm(i.pCategory) === norm(l.category)) ?? b.items.find((i) => !norm(i.pCategory));
  const unsupported = live(b, lines).find((l) => !bucketFor(l));
  if (unsupported) return `${b.code} has no reserved quantity for ${unsupported.category || 'this item category'}. Choose another booking or a regular order.`;
  return null;
}
