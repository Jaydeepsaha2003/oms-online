import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, PackageOpen, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { CreateBookingInput } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { NativeSelect } from '@/components/common/combo';
import { useOrderLookups } from '@/features/orders/use-orders';
import { useCreateBooking } from './use-bookings';

const today = () => new Date().toISOString().slice(0, 10);
const n = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));

export function BookingFormPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: lookups } = useOrderLookups();
  const create = useCreateBooking();
  const [saved, setSaved] = useState(false);

  const [customer, setCustomer] = useState('');
  const [agentName, setAgentName] = useState('');
  const [category, setCategory] = useState('SALES');
  const [bookingDate, setBookingDate] = useState(today());
  const [bags, setBags] = useState('');
  const [kgs, setKgs] = useState('');
  const [comment, setComment] = useState('');

  const customers = useMemo(() => (lookups?.customers ?? []).map((c) => c.name), [lookups]);

  const onCustomer = (name: string) => {
    setCustomer(name);
    const c = lookups?.customers.find((x) => x.name === name);
    if (c) {
      setAgentName(c.agentName ?? '');
      if (c.category) setCategory(c.category);
    }
  };

  const submitRef = useRef<() => void>(() => {});
  const submit = async () => {
    if (!customer.trim()) return toast.error('Please select a customer');
    const bagsN = n(bags) ?? 0;
    const kgsN = n(kgs) ?? 0;
    if (bagsN <= 0 && kgsN <= 0) return toast.error('Enter the booked bags and/or kgs');
    const ok = await confirm({
      title: 'Create this booking?',
      description: `${bagsN} bag(s) · ${kgsN} kg reserved for "${customer.trim()}". Rates are frozen as of ${bookingDate}.`,
      confirmText: 'Create booking',
    });
    if (!ok) return;
    const input: CreateBookingInput = {
      customerName: customer.trim(),
      agentName: agentName.trim() || null,
      category: category.trim() || null,
      bookingDate,
      bags: bagsN,
      kgs: kgsN,
      comment: comment.trim() || null,
    };
    create.mutate(input, {
      onSuccess: () => {
        setSaved(true);
        window.setTimeout(() => navigate('/bookings'), 850);
      },
      onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
    });
  };
  submitRef.current = submit;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        submitRef.current();
      } else if (e.key === 'Escape') {
        if (!document.querySelector('[data-slot="popover-content"], [role="dialog"], [role="alertdialog"]')) navigate('/bookings');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      {saved && (
        <div className="bg-background/70 fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm">
          <div className="animate-in fade-in zoom-in-50 flex flex-col items-center gap-3 duration-300">
            <div className="flex size-24 items-center justify-center rounded-full bg-emerald-500 shadow-xl shadow-emerald-500/30 ring-8 ring-emerald-500/15">
              <Check className="size-12 text-white" strokeWidth={3} />
            </div>
            <p className="text-sm font-semibold text-emerald-700">Booking created</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/bookings')} aria-label="Back">
          <ArrowLeft />
        </Button>
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <PackageOpen className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight">New Bag Booking</h2>
          <p className="text-muted-foreground text-xs">Reserve bags &amp; kgs — items are picked & priced later at these booking-date rates.</p>
        </div>
      </div>

      <Card className="border-l-4 border-l-primary py-0">
        <CardContent className="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-2">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-base">Customer <span className="text-rose-500">*</span></Label>
            <NativeSelect
              value={customer}
              onChange={onCustomer}
              options={customers}
              placeholder="Select customer…"
              onInvalidEntry={() => toast.error('Please select a correct customer')}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-base">Agent (auto)</Label>
            <Input value={agentName} readOnly tabIndex={-1} className="border-indigo-200/70 bg-indigo-50/60 font-medium text-indigo-700" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-base">Category (auto)</Label>
            <Input value={category} readOnly tabIndex={-1} className="border-indigo-200/70 bg-indigo-50/60 font-medium text-indigo-700" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-base">Booking date <span className="text-rose-500">*</span></Label>
            <DatePicker value={bookingDate} onChange={setBookingDate} clearable={false} />
            <p className="text-muted-foreground text-[11px]">Converted items will be charged at this date's chart rates.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-base">Bags</Label>
              <Input type="number" step="any" className="text-right tabular-nums" value={bags} onChange={(e) => setBags(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-base">Kgs</Label>
              <Input type="number" step="any" className="text-right tabular-nums" value={kgs} onChange={(e) => setKgs(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-base">Remarks</Label>
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional note about this booking…" />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2 border-t px-1 py-3">
        <Button type="button" variant="destructive" onClick={() => navigate('/bookings')} title="Cancel (Esc)">
          Cancel
        </Button>
        <Button onClick={submit} disabled={create.isPending} title="Create booking (Ctrl+S)">
          {create.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          Create booking
        </Button>
      </div>
    </div>
  );
}

export default BookingFormPage;
