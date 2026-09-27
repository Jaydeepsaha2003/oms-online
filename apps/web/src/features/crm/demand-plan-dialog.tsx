import { useEffect, useMemo, useState } from 'react';
import { Loader2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { billAgeDays, demandStats, planDemand } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { inrFull } from '@/features/dashboard/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePaymentContext } from '@/features/account/use-account';
import { useCustomer } from '@/features/customers/use-customers';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/**
 * How much to ask a party for: its open bills, oldest first, up to where their
 * amount-weighted average age is nearest the credit period plus an allowance
 * (+5 days by default). Every bill can be ticked in or out; the total and the
 * average follow. Bank and cash are planned separately — they are paid apart.
 */
export function DemandPlanDialog({ open, onOpenChange, customerId, partyName, defaultSide = 'B', onUse }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: number;
  partyName: string;
  defaultSide?: 'B' | 'C';
  /** Offered as "Use this amount" when given (the follow-up promise). */
  onUse?: (amount: number, label: string) => void;
}) {
  const [side, setSide] = useState<'B' | 'C'>(defaultSide);
  const [asOf, setAsOf] = useState(ymd(new Date()));
  const [allowance, setAllowance] = useState(5);
  const { data: customer } = useCustomer(open ? customerId : undefined);
  const [term, setTerm] = useState<number | null>(null);
  const creditDays = term ?? customer?.creditPeriod ?? 60;
  const target = creditDays + allowance;

  const { data, isFetching } = usePaymentContext({ customerId, recDate: asOf, payMode: side === 'B' ? 'BANK' : 'CASH' }, open);
  const bills = useMemo(() => {
    const day = fromYmd(asOf);
    return (data?.invoices ?? [])
      .filter((i) => i.customerId === customerId)
      .map((i) => ({ code: i.invNo, date: i.invDate, balance: side === 'B' ? i.bankBal : i.cashBal, age: billAgeDays(i.invDate, day) }))
      .filter((b) => b.balance > 0.5)
      .sort((a, b) => b.age - a.age || a.code.localeCompare(b.code));
  }, [data, asOf, side, customerId]);

  // A change of side, date or target re-plans; the owner's ticks then refine it.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => setPicked(new Set(planDemand(bills, target))), [bills, target]);
  const toggle = (code: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const chosen = bills.filter((b) => picked.has(b.code));
  const { total, avgAge } = demandStats(chosen);
  const overdue = bills.filter((b) => b.age > creditDays);
  const text =
    `${partyName} — payment request (${side === 'B' ? 'bank' : 'cash'}) as on ${formatDate(asOf)}\n` +
    chosen.map((b) => `${b.code}  ${formatDate(b.date)}  ₹${Math.round(b.balance).toLocaleString('en-IN')}`).join('\n') +
    `\nTotal ₹${Math.round(total).toLocaleString('en-IN')}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-3xl">
        <DialogHeader>
          <DialogTitle>Demand plan — {partyName}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3 text-sm">
          <div className="flex overflow-hidden rounded-md border">
            {(['B', 'C'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSide(s)} className={cn('px-3 py-1.5 font-semibold', side === s ? 'bg-primary text-primary-foreground' : 'bg-card')}>
                {s === 'B' ? 'Bank' : 'Cash'}
              </button>
            ))}
          </div>
          <label className="space-y-1">
            <span className="text-muted-foreground block text-xs">As on</span>
            <Input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="h-9 w-40" />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground block text-xs">Credit days</span>
            <Input type="number" value={creditDays} onChange={(e) => setTerm(Number(e.target.value) || 0)} className="h-9 w-20" />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground block text-xs">Allowance ± days</span>
            <Input type="number" value={allowance} onChange={(e) => setAllowance(Number(e.target.value) || 0)} className="h-9 w-20" />
          </label>
          <p className="text-muted-foreground pb-2 text-xs">
            Target average <strong className="text-foreground">{target} days</strong>
          </p>
        </div>

        <div className="max-h-[50vh] overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0 text-xs uppercase">
              <tr>
                <th className="w-8 p-2" />
                <th className="p-2 text-left">Bill</th>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-right">Age</th>
                <th className="p-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.code} onClick={() => toggle(b.code)} className={cn('cursor-pointer border-t', picked.has(b.code) && 'bg-emerald-50 dark:bg-emerald-500/10')}>
                  <td className="p-2 text-center">
                    <input type="checkbox" checked={picked.has(b.code)} readOnly aria-label={`Ask for ${b.code}`} />
                  </td>
                  <td className="p-2 font-semibold">{b.code}</td>
                  <td className="p-2">{formatDate(b.date)}</td>
                  <td className={cn('p-2 text-right tabular-nums', b.age > creditDays && 'font-bold text-rose-700 dark:text-rose-300')}>{b.age}d</td>
                  <td className="p-2 text-right tabular-nums">{inrFull(Math.round(b.balance))}</td>
                </tr>
              ))}
              {!bills.length && (
                <tr>
                  <td colSpan={5} className="text-muted-foreground p-6 text-center">
                    {isFetching ? <Loader2 className="mx-auto size-5 animate-spin" /> : `No open ${side === 'B' ? 'bank' : 'cash'} bills.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span>
            Demand <strong className="text-base tabular-nums">{inrFull(Math.round(total))}</strong> · {chosen.length} bills
          </span>
          <span>
            Average age <strong className="tabular-nums">{avgAge == null ? '—' : `${avgAge.toFixed(1)} days`}</strong>
          </span>
          <span className="text-muted-foreground text-xs">
            Overdue alone: {inrFull(Math.round(demandStats(overdue).total))} · {overdue.length} bills
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!chosen.length}
              onClick={() => navigator.clipboard.writeText(text).then(() => toast.success('Copied.'), () => toast.error('Could not copy.'))}
            >
              Copy
            </Button>
            {/* The request is text, so Share carries the text — WhatsApp and the
                rest are targets in the sheet. Copy covers a browser without one. */}
            {'share' in navigator && (
              <Button variant="outline" size="sm" disabled={!chosen.length} onClick={() => void navigator.share({ text }).catch(() => {})}>
                <Share2 /> Share
              </Button>
            )}
            {onUse && (
              <Button size="sm" disabled={!chosen.length} onClick={() => (onUse(Math.round(total), `${inrFull(Math.round(total))} demand plan (${chosen.length} bills)`), onOpenChange(false))}>
                Use this amount
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
