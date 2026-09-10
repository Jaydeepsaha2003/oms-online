import type { BookingDto } from '@oms/shared';
import { Lock, PackageOpen } from 'lucide-react';
import { formatDate } from '@/lib/date-format';
import { NativeSelect } from '@/components/common/combo';
import { bookingOrderBalance, type BookingOrderLine } from './order-booking-balance';

export function OrderBookingSource({ source, onChange, bookings, booking, lines, saved, disabled, error }: {
  source: string;
  onChange: (value: string) => void;
  bookings: BookingDto[];
  booking?: BookingDto;
  lines: BookingOrderLine[];
  saved: BookingOrderLine[];
  disabled?: boolean;
  error?: string | null;
}) {
  const options = [...bookings];
  if (booking && !options.some((b) => b.id === booking.id)) options.push(booking);
  const balance = booking && bookingOrderBalance(booking, lines, saved);
  const qty = (bags: number, kgs: number) => [
    booking && booking.bags > 0 ? `${bags.toLocaleString('en-IN')} bags` : '',
    booking && booking.kgs > 0 ? `${kgs.toLocaleString('en-IN')} kg` : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className="space-y-2 rounded-md border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-800 dark:bg-sky-950/20" data-testid="order-booking-source">
      <div className="flex flex-wrap items-center gap-2">
        <PackageOpen className="size-4 text-sky-700" />
        <label htmlFor="order-booking" className="text-sm font-semibold">Item source</label>
        <NativeSelect id="order-booking" value={source} onChange={onChange} disabled={disabled}
          className="min-w-56 flex-1 sm:max-w-lg"
          options={[
            { value: '', label: 'Regular order — current rates' },
            { value: 'booking', label: 'Use bag booking — choose a booking' },
            ...options.map((b) => ({ value: String(b.id), label: `${b.code} · ${formatDate(b.bookingDate)} · ${b.remainingBags.toLocaleString('en-IN')} bags available` })),
            ...(source && source !== 'booking' && !options.some((b) => String(b.id) === source) ? [{ value: source, label: `Booking #${source} — loading details` }] : []),
          ]} />
        {booking && source && <span className="flex items-center gap-1 text-xs font-medium text-sky-800 dark:text-sky-200"><Lock className="size-3" /> Rates locked to {formatDate(booking.bookingDate)}</span>}
      </div>
      {balance && source && <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div><span className="text-muted-foreground">Available before this order</span><p className="mt-0.5 font-semibold tabular-nums">{qty(balance.before.bags, balance.before.kgs)}</p></div>
        <div><span className="text-muted-foreground">Used in this order</span><p className="mt-0.5 font-semibold tabular-nums">{qty(balance.used.bags, balance.used.kgs)}</p></div>
        <div><span className="text-muted-foreground">Remaining after saving</span><p className="mt-0.5 font-semibold tabular-nums">{qty(balance.after.bags, balance.after.kgs)}</p></div>
      </div>}
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      {source && !error && <p className="text-xs text-muted-foreground">Add and edit items below. This creates a separate order using its Order date.</p>}
    </div>
  );
}
