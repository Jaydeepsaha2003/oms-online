import { useQuery } from '@tanstack/react-query';
import type { BookingDto, BookingQuoteResult } from '@oms/shared';
import { http } from '@/lib/api';
import { useBooking } from '@/features/bookings/use-bookings';

interface PricingIdentity {
  product: string;
  itemName: string;
  category: string;
  subCategory: string;
  designType: string;
  designName: string;
  psize?: number | null;
}

/** Query identity isolates slow responses from a previously selected item or booking. */
export function useOrderBookingEntry(source: string, customer: string, entry: PricingIdentity, choices: BookingDto[]) {
  const bookingId = Number(source) || undefined;
  const detail = useBooking(bookingId);
  const booking = detail.data ?? choices.find((b) => b.id === bookingId);
  const owned = !!booking && booking.customerName.trim().toUpperCase() === customer.trim().toUpperCase();
  const line = {
    product: entry.product || null,
    productName: entry.itemName || null,
    pCategory: entry.category || null,
    subCategory: entry.subCategory || null,
    designType: entry.designType || null,
    design: entry.designName || null,
    psize: entry.psize ?? null,
  };
  const quote = useQuery({
    queryKey: ['bookings', 'entry-quote', bookingId, customer, line],
    enabled: !!bookingId && owned && !!entry.product.trim(),
    queryFn: async () => {
      const result = await http.post<BookingQuoteResult>(`/bookings/${bookingId}/quote`, { lines: [line] });
      const priced = result.lines[0];
      if (!priced || !Number.isFinite(priced.rate)) throw new Error('Booking price could not be calculated.');
      return priced;
    },
    staleTime: 30_000,
    // One automatic retry: a dropped request is far more common than a price
    // that genuinely cannot be worked out, and the operator has no way to tell
    // the two apart. A second failure is real — that is when Retry appears.
    retry: 1,
    retryDelay: 300,
  });
  return { booking, bookingId, owned, detail, quote, ready: owned && !!quote.data && !quote.isFetching && !quote.isError };
}
