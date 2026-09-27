import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { billAgeDays, demandStats, dueWithin, type CompanyProfileDto } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { waitForPaintable } from '@/lib/pdf';
import { useCompany } from '@/features/settings/use-settings';
import { inrFull } from '@/features/dashboard/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePaymentContext } from '@/features/account/use-account';
import { useCustomer } from '@/features/customers/use-customers';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Quick picks for the look-ahead. */
const AHEAD_PRESETS = [7, 10, 15, 30];
const fromYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/**
 * How much to ask a party for: every bill overdue now, plus those that fall
 * overdue within the next X days (7 by default) — collected in the same call
 * rather than chased again next week. Every bill can be ticked in or out; the
 * total and the average age follow. Bank and cash are planned separately.
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
  const [ahead, setAhead] = useState(7);
  const { data: customer } = useCustomer(open ? customerId : undefined);
  const [term, setTerm] = useState<number | null>(null);
  const creditDays = term ?? customer?.creditPeriod ?? 60;

  const { data, isFetching } = usePaymentContext({ customerId, recDate: asOf, payMode: side === 'B' ? 'BANK' : 'CASH' }, open);
  const { data: company } = useCompany();
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  /** A picture made but not sent — an iPhone lets the share sheet open only
   *  within a moment of the tap, which drawing the picture can outlast. */
  const [shot, setShot] = useState<{ key: string; file: File } | null>(null);
  // Loaded while the plan is read, so the first Share draws at once.
  useEffect(() => {
    if (open) void import('html2canvas-pro');
  }, [open]);
  const bills = useMemo(() => {
    const day = fromYmd(asOf);
    return (data?.invoices ?? [])
      .filter((i) => i.customerId === customerId)
      .map((i) => ({ code: i.invNo, date: i.invDate, balance: side === 'B' ? i.bankBal : i.cashBal, age: billAgeDays(i.invDate, day) }))
      .filter((b) => b.balance > 0.5)
      .sort((a, b) => b.age - a.age || a.code.localeCompare(b.code));
  }, [data, asOf, side, customerId]);

  // A change of side, date or days re-plans; the owner's ticks then refine it.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => setPicked(new Set(dueWithin(bills, creditDays, ahead).map((b) => b.code))), [bills, creditDays, ahead]);
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
  /** The day a bill reaches the credit period. */
  const dueOn = (b: { date: string }) => {
    const d = new Date(b.date);
    d.setDate(d.getDate() + creditDays);
    return d;
  };
  // Not overdue yet, but will be within the look-ahead.
  const soon = dueWithin(bills, creditDays, ahead).filter((b) => b.age <= creditDays);
  const text =
    `${partyName} — payment request (${side === 'B' ? 'bank' : 'cash'}) as on ${formatDate(asOf)}\n` +
    chosen.map((b) => `${b.code}  ${formatDate(b.date)}  ₹${Math.round(b.balance).toLocaleString('en-IN')}`).join('\n') +
    `\nTotal ₹${Math.round(total).toLocaleString('en-IN')}`;
  /** The message that travels with the picture. */
  const blurb =
    `Payment request — ${partyName}\n` +
    `₹${Math.round(total).toLocaleString('en-IN')} due on ${chosen.length} bill${chosen.length === 1 ? '' : 's'} as on ${formatDate(asOf)}. Kindly arrange the payment.` +
    (company?.name ? `\n— ${company.name}` : '');
  const planKey = `${side}|${asOf}|${creditDays}|${chosen.map((b) => b.code).join(',')}`;

  /** The share sheet with the picture and the message; where a browser cannot
   *  share files, the picture is saved and the message copied instead. */
  const deliver = async (file: File) => {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (!nav.canShare?.({ files: [file] })) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      await navigator.clipboard?.writeText(blurb).catch(() => {});
      toast.success('Image saved — the message is copied to paste beside it.');
      return;
    }
    try {
      await nav.share({ files: [file], text: blurb });
      setShot(null);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setShot({ key: planKey, file });
      toast.info('Image ready — tap Share again to send it.');
    }
  };

  const share = async () => {
    if (shot?.key === planKey) return deliver(shot.file);
    const node = cardRef.current;
    if (!node) return;
    setBusy(true);
    try {
      const { default: html2canvas } = await import('html2canvas-pro');
      await waitForPaintable(node);
      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: '#ffffff',
        // Copy only the card (and the styles): the ledger behind the dialog is
        // thousands of nodes, and cloning it made the picture ~6x slower to draw.
        ignoreElements: (el) => !el.contains(node) && !node.contains(el) && !el.closest('head'),
      });
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Canvas capture failed');
      const name = `Payment-request_${partyName.replace(/[\\/:*?"<>|\s]+/g, '-')}_${asOf}.jpg`;
      await deliver(new File([blob], name, { type: 'image/jpeg' }));
    } catch {
      toast.error('Could not make the image.');
    } finally {
      setBusy(false);
    }
  };

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
            <span className="text-muted-foreground block text-xs">Upcoming overdue in (days)</span>
            <Input type="number" min={0} value={ahead} onChange={(e) => setAhead(Math.max(0, Number(e.target.value) || 0))} className="h-9 w-20" />
          </label>
          <div className="flex gap-1 pb-0.5">
            {AHEAD_PRESETS.map((d) => (
              <Button key={d} type="button" size="sm" variant={ahead === d ? 'default' : 'outline'} className="h-8 px-2.5" onClick={() => setAhead(d)}>
                {d}d
              </Button>
            ))}
          </div>
        </div>

        <div className="max-h-[50vh] overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0 text-xs uppercase">
              <tr>
                <th className="w-8 p-2" />
                <th className="p-2 text-left">Bill</th>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-right">Age</th>
                <th className="p-2 text-right">Reaches {creditDays}d</th>
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
                  <td className={cn('p-2 text-right tabular-nums', b.age <= creditDays && creditDays - b.age <= ahead && 'font-bold text-amber-700 dark:text-amber-300')}>
                    {b.age > creditDays ? `${b.age - creditDays}d over` : b.age === creditDays ? 'today' : `in ${creditDays - b.age}d · ${formatDate(dueOn(b))}`}
                  </td>
                  <td className="p-2 text-right tabular-nums">{inrFull(Math.round(b.balance))}</td>
                </tr>
              ))}
              {!bills.length && (
                <tr>
                  <td colSpan={6} className="text-muted-foreground p-6 text-center">
                    {isFetching ? <Loader2 className="mx-auto size-5 animate-spin" /> : `No open ${side === 'B' ? 'bank' : 'cash'} bills.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {soon.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
            <span className="font-semibold">Falling overdue in the next {ahead} days:</span>
            {soon.map((b) => (
              <span key={b.code}>
                {b.code} ({formatDate(b.date)}) on {formatDate(dueOn(b))} · {inrFull(Math.round(b.balance))}
              </span>
            ))}
            <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => setPicked((prev) => new Set([...prev, ...soon.map((b) => b.code)]))}>
              Add to demand
            </Button>
          </div>
        )}

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
            {/* A picture of the demand plus a short message — WhatsApp and the
                rest are targets in the sheet. */}
            <Button variant="outline" size="sm" disabled={!chosen.length || busy} onClick={() => void share()}>
              {busy ? <Loader2 className="animate-spin" /> : <Share2 />} Share
            </Button>
            {onUse && (
              <Button size="sm" disabled={!chosen.length} onClick={() => (onUse(Math.round(total), `${inrFull(Math.round(total))} demand plan (${chosen.length} bills)`), onOpenChange(false))}>
                Use this amount
              </Button>
            )}
          </div>
        </div>
        {chosen.length > 0 &&
          createPortal(
            // Off screen but laid out — a `display:none` node would capture as nothing.
            <div aria-hidden style={{ position: 'fixed', left: -10000, top: 0 }}>
              <DemandCard cardRef={cardRef} company={company} partyName={partyName} side={side} asOf={asOf} bills={chosen} total={total} avgAge={avgAge} creditDays={creditDays} />
            </div>,
            document.body,
          )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The demand as a picture for the party — what Share attaches. Fixed light
 * colours, so it looks the same whatever theme the sender works in.
 */
function DemandCard({ cardRef, company, partyName, side, asOf, bills, total, avgAge, creditDays }: {
  cardRef: React.Ref<HTMLDivElement>;
  company: CompanyProfileDto | undefined;
  partyName: string;
  side: 'B' | 'C';
  asOf: string;
  bills: { code: string; date: string; balance: number; age: number }[];
  total: number;
  avgAge: number | null;
  creditDays: number;
}) {
  const late = bills.some((b) => b.age > creditDays);
  return (
    <div ref={cardRef} className="w-[640px] bg-[#ffffff] text-[#141a2b]" style={{ fontFamily: 'var(--font-jakarta)' }}>
      <div className="flex items-center gap-3 px-7 py-5 text-white" style={{ background: 'linear-gradient(135deg, #4f6ef7 0%, #3a4fd6 55%, #3140b8 100%)' }}>
        {company?.logo && <img src={company.logo} alt="" className="size-11 rounded-xl bg-[#ffffff] object-contain p-1" />}
        <span className="min-w-0 flex-1 text-[20px] leading-tight font-extrabold">{company?.name}</span>
        <span className="shrink-0 rounded-full bg-[#ffffff] px-3 py-1 text-[11.5px] font-extrabold tracking-[0.06em] text-[#2f3fb5] uppercase">Payment request</span>
      </div>

      <div className="px-7 pt-5">
        <div className="text-[11.5px] font-bold tracking-[0.08em] text-[#7a849c] uppercase">To</div>
        <div className="mt-0.5 text-[22px] leading-tight font-extrabold">{partyName}</div>
        <div className="mt-1 text-[13px] text-[#5b6479]">
          As on {formatDate(asOf)} · {side === 'B' ? 'Bank' : 'Cash'} bills
        </div>
        <div className="mt-4 flex items-end justify-between gap-4 rounded-2xl bg-[#eef1ff] px-5 py-4">
          <div>
            <div className="text-[11.5px] font-bold tracking-[0.08em] text-[#3140b8] uppercase">Amount due</div>
            <div className="mt-1 text-[34px] leading-none font-extrabold text-[#2f3fb5] tabular-nums">{inrFull(Math.round(total))}</div>
          </div>
          <div className="text-right text-[13px] leading-snug font-semibold text-[#3a4256]">
            {bills.length} bill{bills.length === 1 ? '' : 's'}
            {avgAge != null && <div>average {Math.round(avgAge)} days old</div>}
          </div>
        </div>
      </div>

      <div className="px-7 pt-4">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="bg-[#141b33] text-left text-[11.5px] tracking-[0.06em] text-white uppercase">
              <th className="px-3 py-2">Bill no.</th>
              <th className="px-3 py-2">Bill date</th>
              <th className="px-3 py-2 text-right">Days</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b, i) => (
              <tr key={b.code} className={i % 2 ? 'bg-[#f6f8fc]' : ''}>
                <td className="px-3 py-2 font-bold">{b.code}</td>
                <td className="px-3 py-2">{formatDate(b.date)}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', b.age > creditDays && 'font-bold text-[#be123c]')}>{b.age}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{inrFull(Math.round(b.balance))}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-[#141b33] text-[14.5px] font-extrabold">
              <td className="px-3 py-2.5" colSpan={3}>Total</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{inrFull(Math.round(total))}</td>
            </tr>
          </tbody>
        </table>
        {late && <p className="mt-2 text-[12px] text-[#7a849c]">Days in red are past the {creditDays}-day credit period.</p>}
      </div>

      <div className="mt-5 border-t border-[#e8ecf4] px-7 py-4 text-[13.5px] text-[#3a4256]">
        Kindly arrange the payment at the earliest. Thank you.
        {company?.name && <div className="mt-1 font-extrabold text-[#141a2b]">{company.name}</div>}
      </div>
    </div>
  );
}
