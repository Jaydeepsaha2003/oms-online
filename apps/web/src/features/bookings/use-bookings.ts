import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BookingDto,
  BookingList,
  BookingQuery,
  BookingQuoteInput,
  BookingQuoteResult,
  ConvertBookingInput,
  CreateBookingInput,
  PriceHistoryList,
  PriceHistoryQuery,
  UpdateBookingInput,
} from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['bookings'] as const;

/** Bag bookings list, with status + search filters. */
export function useBookings(query: BookingQuery) {
  return useQuery({
    queryKey: [...KEY, 'list', query],
    queryFn: () => http.get<BookingList>('/bookings', { params: query }),
    placeholderData: (prev) => prev,
  });
}

/** The customer's drawable bookings (open / partially converted, quantity left) —
 *  drives the "Draw from Bag Booking" button on the order form. */
export function useActiveCustomerBookings(customerName: string) {
  return useQuery({
    queryKey: [...KEY, 'active-for', customerName],
    queryFn: () => http.get<BookingList>('/bookings', { params: { page: 1, pageSize: 200, customer: customerName } }),
    enabled: !!customerName,
    select: (list) =>
      list.items.filter(
        (b) => (b.status === 'OPEN' || b.status === 'PARTIALLY_CONVERTED') && (b.remainingBags > 0 || b.remainingKgs > 0),
      ),
    staleTime: 30_000,
  });
}

export function useBooking(id?: number) {
  return useQuery({
    queryKey: [...KEY, id],
    queryFn: () => http.get<BookingDto>(`/bookings/${id}`),
    enabled: id != null,
  });
}

export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBookingInput) => http.post<BookingDto>('/bookings', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateBooking(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateBookingInput) => http.patch<BookingDto>(`/bookings/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Preview the frozen (booking-date) rates for a set of convertible lines. */
export function useBookingQuote() {
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & BookingQuoteInput) =>
      http.post<BookingQuoteResult>(`/bookings/${id}/quote`, input),
  });
}

/** Convert part of a booking into real order lines at frozen rates. */
export function useConvertBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & ConvertBookingInput) =>
      http.post<BookingDto>(`/bookings/${id}/convert`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCancelBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.post<BookingDto>(`/bookings/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete<{ ok: true }>(`/bookings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Unified product / design / special-rate price-change history. */
export function usePriceHistory(query: PriceHistoryQuery) {
  return useQuery({
    queryKey: [...KEY, 'price-history', query],
    queryFn: () => http.get<PriceHistoryList>('/bookings/price-history', { params: query }),
    placeholderData: (prev) => prev,
  });
}
