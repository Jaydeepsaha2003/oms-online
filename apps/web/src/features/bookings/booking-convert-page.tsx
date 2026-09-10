import { Navigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getApiErrorMessage } from '@/lib/api';
import { useBooking } from './use-bookings';

/** Keep bookmarked conversion links pointed at the shared New Order editor. */
export function BookingConvertPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const validId = Number.isSafeInteger(id) && id > 0;
  const { data: booking, isLoading, error, refetch } = useBooking(validId ? id : undefined);

  if (!validId) return <Navigate to="/bookings" replace />;
  if (isLoading) return <div className="flex items-center gap-2 p-6"><Loader2 className="size-4 animate-spin" /> Loading booking…</div>;
  if (error || !booking) return (
    <div role="alert" className="space-y-3 p-6">
      <p>{getApiErrorMessage(error, 'Could not load this booking.')}</p>
      <Button variant="outline" onClick={() => void refetch()}>Retry</Button>
    </div>
  );

  return <Navigate to="/orders/new" replace state={{ customerName: booking.customerName, bookingId: booking.id, openBookingDraw: true }} />;
}

export default BookingConvertPage;