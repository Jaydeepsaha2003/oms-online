import type { BookingDto } from '@oms/shared';
import { Lock, PackageOpen, Loader2 } from 'lucide-react';
import { formatDate } from '@/lib/date-format';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { bookingOrderBalance, type BookingOrderLine } from './order-booking-balance';

export function OrderBookingSource({ source, onChange, bookings, booking, lines, saved, disabled, error, loading, onRetry, priceAtCurrent = false, onPriceAtCurrent }: {
  source: string;
  onChange: (value: string) => void;
  bookings: BookingDto[];
  booking?: BookingDto;
  lines: BookingOrderLine[];
  saved: BookingOrderLine[];
  disabled?: boolean;
  error?: string | null;
  loading?: boolean;
  onRetry?: () => void;
  /** Bags still come off the booking, but lines are priced at the CURRENT list. */
  priceAtCurrent?: boolean;
  /** Offered to System Administrators only — omit and the switch isn't shown. */
  onPriceAtCurrent?: (value: boolean) => void;
}) {
  const options = [...bookings];
  if (booking && !options.some((b) => b.id === booking.id)) options.push(booking);
  const balance = booking && bookingOrderBalance(booking, lines, saved);
  const qty = (bags: number, kgs: number, basis = booking) => [
    basis && basis.bags > 0 ? bags.toLocaleString('en-IN') + ' bags' : '',
    basis && basis.kgs > 0 ? kgs.toLocaleString('en-IN') + ' kg' : '',
  ].filter(Boolean).join(' / ');
  return (
    <div className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-800 dark:bg-sky-950/20" data-testid="order-booking-source">
      <div className="flex flex-wrap items-center gap-2">
        <PackageOpen className="size-4 text-sky-700" aria-hidden="true" />
        <label htmlFor="order-booking" className="text-sm font-semibold">Price from</label>
        <NativeSelect id="order-booking" value={source} onChange={onChange} disabled={disabled}
          className="w-full min-w-0 sm:w-auto sm:min-w-56 sm:max-w-lg sm:flex-1"
          options={[
            { value: '', label: 'Current price list' },
            ...options.map((b) => ({ value: String(b.id), label: `${b.code} · ${formatDate(b.bookingDate)} · ${qty(b.remainingBags, b.remainingKgs, b)} left` })),
            // The chosen booking before its details arrive (a restored draft, or
            // the shortcut from Bag Bookings). Replaced by the real row above the
            // moment it loads.
            ...(source && !options.some((b) => String(b.id) === source) ? [{ value: source, label: 'Loading booking…' }] : []),
          ]} />
        {booking && source && (priceAtCurrent
          ? <span className="flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-200">Bags from this booking · priced at the current list</span>
          : <span className="flex items-center gap-1 text-xs font-medium text-sky-800 dark:text-sky-200"><Lock className="size-3" /> Prices as booked on {formatDate(booking.bookingDate)}</span>)}
        {source && onPriceAtCurrent && (
          <div className="ml-auto flex items-center gap-1.5 text-xs" role="group" aria-label="Price booked lines at">
            <span className="text-muted-foreground font-medium">Price at</span>
            {([[false, 'Booking rate'], [true, 'Current rate']] as const).map(([value, label]) => (
              <button
                key={label}
                type="button"
                disabled={disabled}
                aria-pressed={priceAtCurrent === value}
                onClick={() => onPriceAtCurrent(value)}
                className={
                  priceAtCurrent === value
                    ? 'rounded-md border border-sky-600 bg-sky-600 px-2.5 py-1 font-semibold text-white'
                    : 'rounded-md border border-sky-200 bg-background px-2.5 py-1 font-semibold text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:text-sky-200 dark:hover:bg-sky-900/40'
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {balance && source && <div className="grid grid-cols-1 gap-2 rounded-md bg-background/70 p-2.5 text-xs sm:grid-cols-3">
        <div><span className="text-muted-foreground">Available for this order</span><p className="mt-1 font-semibold tabular-nums">{qty(balance.before.bags, balance.before.kgs)}</p></div>
        <div><span className="text-muted-foreground">Added to this order</span><p className="mt-1 font-semibold tabular-nums">{qty(balance.used.bags, balance.used.kgs)}</p></div>
        <div><span className="text-muted-foreground">Left after saving</span><p className="mt-1 font-semibold tabular-nums">{qty(balance.after.bags, balance.after.kgs)}</p></div>
      </div>}
      {error && <div className="flex flex-wrap items-center gap-2 text-sm" role={onRetry || !loading ? 'alert' : 'status'}>
        {loading && <Loader2 className="size-4 animate-spin text-sky-700" aria-hidden="true" />}
        <p className={loading ? 'text-muted-foreground' : 'text-rose-700 dark:text-rose-300'}>{error}</p>
        {onRetry && <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={loading}>Retry</Button>}
      </div>}
      {source && !error && <p className="text-xs text-muted-foreground">Use Order date for the day the customer requested these items. Each order stays linked to this booking.</p>}
    </div>
  );
}
