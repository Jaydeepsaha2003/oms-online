import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, Copy, Loader2, Share2, X } from 'lucide-react';
import { toast } from 'sonner';
import { billAgeDays, demandStats, dueWithin, type CompanyProfileDto } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { waitForPaintable } from '@/lib/pdf';
import { useCompany } from '@/features/settings/use-settings';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { usePaymentContext } from '@/features/account/use-account';
import { useCustomer } from '@/features/customers/use-customers';

/** Money as the demand reads it out: a space after the sign, "₹ 7,74,803". */
const rupees = (n: number) => inrFull(Math.round(n)).replace('₹', '₹ ');
const rupeesShort = (n: number) => inrCompact(n).replace('₹', '₹ ');

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

  const setAll = (rows: { code: string }[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const b of rows) {
        if (on) next.add(b.code);
        else next.delete(b.code);
      }
      return next;
    });

  const chosen = bills.filter((b) => picked.has(b.code));
  const { total, avgAge } = demandStats(chosen);
  const overdue = bills.filter((b) => b.age > creditDays);
  /** Each side's open total, for the Bank / Cash switch — the bills carry both. */
  const sideTotal = (s: 'B' | 'C') =>
    (data?.invoices ?? []).filter((i) => i.customerId === customerId).reduce((n, i) => n + Math.max(0, s === 'B' ? i.bankBal : i.cashBal), 0);
  /** The day a bill reaches the credit period. */
  const dueOn = (b: { date: string }) => {
    const d = new Date(b.date);
    d.setDate(d.getDate() + creditDays);
    return d;
  };
  // Not overdue yet, but will be within the look-ahead.
  const soon = dueWithin(bills, creditDays, ahead).filter((b) => b.age <= creditDays);
  const sum = (rows: { balance: number }[]) => rows.reduce((n, b) => n + b.balance, 0);
  const groups = [
    { key: 'over', title: 'Overdue now', hint: `Past the ${creditDays}-day credit period.`, dot: 'bg-rose-500', rows: overdue },
    { key: 'soon', title: `Upcoming due in ${ahead} days`, hint: 'Asked for in the same call, rather than chased again next week.', dot: 'bg-amber-500', rows: soon },
    { key: 'later', title: 'Not due yet', hint: 'Left out of the demand unless ticked.', dot: 'bg-slate-400', rows: bills.filter((b) => b.age <= creditDays && !soon.includes(b)) },
  ].filter((g) => g.rows.length);
  /** Where a bill stands against the credit period. */
  const standing = (b: { date: string; age: number }) =>
    b.age > creditDays
      ? { text: `${b.age - creditDays} days over`, tone: 'text-rose-700 dark:text-rose-400' }
      : b.age === creditDays
        ? { text: 'due today', tone: 'text-amber-700 dark:text-amber-400' }
        : { text: `due in ${creditDays - b.age} days`, tone: creditDays - b.age <= ahead ? 'text-amber-700 dark:text-amber-400' : 'cs-muted' };
  const copy = () => navigator.clipboard.writeText(text).then(() => toast.success('Copied.'), () => toast.error('Could not copy.'));
  const text =
    `${partyName} — payment request (${side === 'B' ? 'bank' : 'cash'}) as on ${formatDate(asOf)}\n` +
    chosen.map((b) => `${b.code}  ${formatDate(b.date)}  ₹ ${Math.round(b.balance).toLocaleString('en-IN')}`).join('\n') +
    `\nTotal ₹ ${Math.round(total).toLocaleString('en-IN')}`;
  /** The message that travels with the picture. */
  const blurb =
    `Payment request — ${partyName}\n` +
    `₹ ${Math.round(total).toLocaleString('en-IN')} due on ${chosen.length} bill${chosen.length === 1 ? '' : 's'} as on ${formatDate(asOf)}. Kindly arrange the payment.` +
    (company?.name && side === 'B' ? `\n— ${company.name}` : '');
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
        // Carry the page's CSS rules into the copy html2canvas draws from, so the
        // picture never waits on a stylesheet loading there — on a phone it drew
        // before the app's CSS arrived and came out as bare, unstyled text.
        onclone: async (doc) => {
          const style = doc.createElement('style');
          style.textContent = [...document.styleSheets]
            .flatMap((s) => {
              try {
                return [...s.cssRules].map((r) => r.cssText);
              } catch {
                return [];
              }
            })
            .join('\n');
          doc.head.appendChild(style);
          // Lay out once so the fonts start loading, then wait for them: text
          // measured in a fallback font drew with the spaces between words lost.
          void doc.body.offsetHeight;
          await doc.fonts.ready;
        },
      });
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
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
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="cs-overlay" />
        <DialogPrimitive.Content className="cs-sheet cs-wide" aria-describedby={undefined}>
          {/* ── The party, the side, and what the plan is made of ── */}
          <div className="cs-hero">
            <div className="flex items-center gap-2.5">
              <span className="cs-kicker">Demand plan</span>
              <DialogPrimitive.Close className="cs-x" aria-label="Close">
                <X className="size-[18px]" />
              </DialogPrimitive.Close>
            </div>
            <DialogPrimitive.Title className="mt-1.5 truncate text-lg leading-tight font-extrabold">{partyName}</DialogPrimitive.Title>
            <span className="block truncate text-[12.5px] text-white/80">
              As on {formatDate(asOf)} · {creditDays}-day credit period
            </span>
            <div className="cs-seg" role="group" aria-label="Plan the">
              {(['B', 'C'] as const).map((s) => (
                <button key={s} type="button" className="cs-seg-btn" aria-pressed={side === s} onClick={() => setSide(s)}>
                  <span className="cs-seg-label">{s === 'B' ? 'Bank bills' : 'Cash bills'}</span>
                  <span className="cs-seg-value">{data ? rupeesShort(sideTotal(s)) : '—'}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { label: 'Overdue', value: rupeesShort(sum(overdue)), sub: `${overdue.length} bill${overdue.length === 1 ? '' : 's'}` },
                { label: 'Upcoming due', value: rupeesShort(sum(soon)), sub: `${soon.length} bill${soon.length === 1 ? '' : 's'} in ${ahead}d` },
                { label: 'Oldest Inv.', value: bills.length ? `${bills[0].age}d` : '—', sub: bills.length ? `Inv. ${formatDate(bills[0].date)}` : 'nothing open' },
              ].map((t) => (
                <div key={t.label} className="cs-stat min-w-0">
                  <div className="cs-stat-label truncate">{t.label}</div>
                  <div className="cs-stat-value truncate">{t.value}</div>
                  <div className="truncate text-[11px] text-white/75">{t.sub}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="cs-body">
            {/* ── The three knobs of the plan ── */}
            <section className="cs-card grid grid-cols-2 gap-3 p-3.5 sm:grid-cols-[1fr_1fr_1.7fr]">
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="cs-caption">As on</span>
                <input type="date" className="pls-input" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
              </label>
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="cs-caption">Credit period</span>
                <span className="relative">
                  <input type="number" min={0} className="pls-input pr-12" value={creditDays} onChange={(e) => setTerm(Math.max(0, Number(e.target.value) || 0))} />
                  <span className="pls-unit">days</span>
                </span>
              </label>
              <div className="col-span-2 flex min-w-0 flex-col gap-1.5 sm:col-span-1">
                <span className="cs-caption">Also ask for bills due within</span>
                <div className="flex gap-1.5">
                  {AHEAD_PRESETS.map((d) => (
                    <button key={d} type="button" className="cs-quick cs-quick-blue min-w-0 flex-1 px-0" aria-pressed={ahead === d} onClick={() => setAhead(d)}>
                      {d}d
                    </button>
                  ))}
                  <span className="relative w-[78px] shrink-0">
                    <input
                      type="number"
                      min={0}
                      aria-label="Days ahead"
                      className="pls-input pr-7"
                      value={ahead}
                      onChange={(e) => setAhead(Math.max(0, Number(e.target.value) || 0))}
                    />
                    <span className="pls-unit">d</span>
                  </span>
                </div>
              </div>
            </section>

            {/* ── The bills, by where they stand; ticked ones make the demand ── */}
            {!bills.length ? (
              <section className="cs-card cs-muted flex items-center justify-center gap-2 px-4 py-10 text-[13.5px] font-semibold">
                {isFetching ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Loading bills…
                  </>
                ) : (
                  `No open ${side === 'B' ? 'bank' : 'cash'} bills as on ${formatDate(asOf)}.`
                )}
              </section>
            ) : (
              groups.map((g) => {
                const allOn = g.rows.every((b) => picked.has(b.code));
                return (
                  <section key={g.key} className="cs-card">
                    <div className="flex items-center gap-2 px-3.5 pt-3">
                      <span className={cn('size-2 shrink-0 rounded-full', g.dot)} />
                      <span className="cs-caption truncate">{g.title}</span>
                      <span className="cs-muted shrink-0 text-xs font-semibold tabular-nums">
                        {g.rows.length} · {rupees(Math.round(sum(g.rows)))}
                      </span>
                      <button type="button" className="ml-auto shrink-0 cursor-pointer text-[12.5px] font-extrabold text-[#3b4fd8] dark:text-indigo-300" onClick={() => setAll(g.rows, !allOn)}>
                        {allOn ? 'Clear' : 'Select all'}
                      </button>
                    </div>
                    <p className="cs-muted px-3.5 pt-0.5 pb-2 text-[11.5px]">{g.hint}</p>
                    <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
                      {g.rows.map((b) => {
                        const on = picked.has(b.code);
                        const st = standing(b);
                        return (
                          <button key={b.code} type="button" className="cs-inv" aria-pressed={on} onClick={() => toggle(b.code)}>
                            <span className="cs-box" aria-hidden>
                              {on && <Check className="size-3.5" strokeWidth={3.5} />}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate font-mono text-[13px] font-bold">{b.code}</span>
                              <span className="cs-muted truncate text-xs">
                                Inv. {formatDate(b.date)} · Due {formatDate(dueOn(b))} · {b.age} days old
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end">
                              <span className="text-[14.5px] font-extrabold tabular-nums">{rupees(Math.round(b.balance))}</span>
                              <span className={cn('text-[11.5px] font-bold', st.tone)}>{st.text}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            )}
          </div>

          {/* ── The demand, and what to do with it ── */}
          <div className="cs-foot flex-wrap items-center">
            <div className="mr-auto flex min-w-0 flex-col">
              <span className="cs-caption">Demand</span>
              <span className="text-[22px] leading-tight font-extrabold tabular-nums">{rupees(Math.round(total))}</span>
              <span className="cs-muted text-xs font-semibold">
                {chosen.length} bill{chosen.length === 1 ? '' : 's'}
                {avgAge != null && ` · average ${avgAge.toFixed(1)} days old`}
              </span>
            </div>
            <div className="flex gap-2 max-sm:w-full">
              <button type="button" className="cs-cancel inline-flex items-center justify-center px-3.5 disabled:opacity-50" disabled={!chosen.length} onClick={copy} aria-label="Copy as text" title="Copy as text">
                <Copy className="size-4" />
              </button>
              {/* A picture of the demand plus a short message — WhatsApp and the
                  rest are targets in the sheet. */}
              <button
                type="button"
                className={cn(onUse ? 'cs-cancel max-sm:flex-1' : 'cs-log px-6', 'inline-flex items-center justify-center gap-2 disabled:opacity-50')}
                disabled={!chosen.length || busy}
                onClick={() => void share()}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />} Share
              </button>
              {onUse && (
                <button
                  type="button"
                  className="cs-log px-5"
                  disabled={!chosen.length}
                  onClick={() => (onUse(Math.round(total), `${rupees(Math.round(total))} demand plan (${chosen.length} bills)`), onOpenChange(false))}
                >
                  Use this amount
                </button>
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
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * The demand as a picture for the party — what Share attaches. A statement in
 * three reads: the amount, how it splits (overdue / upcoming), and each bill's
 * age against the credit period on its own track. Fixed colours throughout
 * (hex and rgba, never the theme's tokens), so it looks the same whatever
 * theme the sender works in; one line a bill so a chat app's resize keeps the
 * figures readable.
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
  const sum = (rows: { balance: number }[]) => Math.round(rows.reduce((n, b) => n + b.balance, 0));
  // A cash demand goes out unbranded: no logo, no company name.
  const brand = side === 'B' ? company : undefined;
  const dueOn = (b: { date: string }) => {
    const d = new Date(b.date);
    d.setDate(d.getDate() + creditDays);
    return d;
  };
  const over = bills.filter((b) => b.age > creditDays);
  const upcoming = bills.filter((b) => b.age <= creditDays);
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const overShare = total > 0 ? (sum(over) / total) * 100 : 0;
  // Every track shares one scale, so the credit-period tick lines up down the list.
  const scale = Math.max(creditDays * 1.35, ...bills.map((b) => b.age)) || 1;
  const pct = (days: number) => `${Math.min(100, (days / scale) * 100)}%`;
  const INK = '#0f1426';
  const MUTED = '#6a7288';
  const RED = '#e5484d';
  const AMBER = '#f5a524';

  return (
    <div ref={cardRef} className="w-[720px] bg-[#f3f4f8] p-5" style={{ fontFamily: 'var(--font-jakarta)', color: INK }}>
      <div className="overflow-hidden rounded-[26px] bg-[#ffffff]" style={{ boxShadow: '0 1px 2px rgba(15,20,38,0.06), 0 12px 32px rgba(15,20,38,0.08)' }}>
        {/* ── Hero: who asks, who owes, how much ── */}
        <div className="relative overflow-hidden px-8 pt-7 pb-8 text-[#ffffff]" style={{ background: 'linear-gradient(150deg, #151a33 0%, #1d2350 55%, #2a2f7a 100%)' }}>
          <div className="absolute -top-32 -right-24 size-[360px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(124,108,255,0.55), rgba(124,108,255,0) 68%)' }} />
          <div className="absolute -bottom-40 -left-20 size-[320px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.28), rgba(56,189,248,0) 70%)' }} />

          <div className="relative flex items-center gap-3">
            {brand?.logo && (
              <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-[#ffffff] p-1.5">
                <img src={brand.logo} alt="" className="max-h-full max-w-full object-contain" />
              </span>
            )}
            <div className="min-w-0 flex-1 text-[17px] leading-tight font-extrabold">{brand?.name}</div>
            <div className="text-right">
              <div className="text-[10.5px] font-bold tracking-[0.18em] text-[rgba(255,255,255,0.6)] uppercase">Payment request</div>
              <div className="mt-0.5 text-[13px] font-bold">{formatDate(asOf)}</div>
            </div>
          </div>

          <div className="relative mt-8 text-[11px] font-bold tracking-[0.16em] text-[rgba(255,255,255,0.6)] uppercase">Amount due</div>
          <div className="relative mt-1.5 text-[52px] leading-none font-extrabold">{rupees(Math.round(total))}</div>
          <div className="relative mt-4 text-[22px] leading-tight font-extrabold">{partyName}</div>

          <div className="relative mt-4 flex flex-wrap gap-2">
            {[
              `${side === 'B' ? 'Bank' : 'Cash'} bills`,
              `${creditDays}-day credit`,
              plural(bills.length, 'bill'),
              ...(avgAge != null ? [`avg ${Math.round(avgAge)} days old`] : []),
            ].map((c) => (
              <span key={c} className="rounded-full border border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.08)] px-3 py-1 text-[12px] font-semibold text-[rgba(255,255,255,0.9)]">
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* ── How the amount splits ── */}
        <div className="px-8 pt-7">
          <div className="flex h-[12px] overflow-hidden rounded-full bg-[#eceef4]">
            {over.length > 0 && <div style={{ width: `${overShare}%`, background: RED }} />}
            {upcoming.length > 0 && <div style={{ width: `${100 - overShare}%`, background: AMBER }} />}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4">
            {[
              { label: 'Overdue', value: rupees(sum(over)), sub: plural(over.length, 'bill'), dot: RED },
              { label: 'Upcoming due', value: rupees(sum(upcoming)), sub: plural(upcoming.length, 'bill'), dot: AMBER },
              { label: 'Oldest Inv.', value: bills.length ? `${bills[0].age} days` : '—', sub: bills.length ? formatDate(bills[0].date) : '', dot: '#5b5bd6' },
            ].map((t) => (
              <div key={t.label}>
                <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.12em] uppercase" style={{ color: MUTED }}>
                  <span className="size-2 rounded-full" style={{ background: t.dot }} />
                  {t.label}
                </div>
                <div className="mt-1 text-[20px] leading-tight font-extrabold">{t.value}</div>
                <div className="text-[12px] font-semibold" style={{ color: MUTED }}>{t.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Every bill, oldest first, on a common age track ── */}
        <div className="px-8 pt-7">
          <div className="flex items-center gap-3 border-b border-[#eceef4] pb-2 text-[10.5px] font-bold tracking-[0.14em] uppercase" style={{ color: MUTED }}>
            <span className="w-[140px] shrink-0">Inv.</span>
            <span className="flex-1">Age vs {creditDays}-day credit</span>
            <span className="w-[118px] shrink-0 text-right">Status</span>
            <span className="w-[96px] shrink-0 text-right">Amount</span>
          </div>
          {bills.map((b, i) => {
            const late = b.age > creditDays;
            const tone = late ? RED : AMBER;
            return (
              <div key={b.code} className="flex items-center gap-3 py-2.5" style={{ borderBottom: i === bills.length - 1 ? 'none' : '1px solid #f1f2f6' }}>
                <div className="w-[140px] shrink-0">
                  <div className="text-[13.5px] leading-tight font-extrabold">{b.code}</div>
                  <div className="text-[11.5px] font-semibold" style={{ color: MUTED }}>Inv. {formatDate(b.date)}</div>
                  <div className="text-[11.5px] font-bold" style={{ color: late ? '#c62f35' : '#b26b00' }}>Due {formatDate(dueOn(b))}</div>
                </div>
                <div className="relative h-[8px] flex-1 rounded-full bg-[#eef0f5]">
                  <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(b.age), background: tone, opacity: late ? 1 : 0.85 }} />
                  {/* the credit-period line */}
                  <div className="absolute -top-[5px] h-[18px] w-[2px] rounded-full bg-[#0f1426]" style={{ left: pct(creditDays) }} />
                  {/* …and its term, above the line */}
                  <div className="absolute -top-[20px] text-[10.5px] font-extrabold whitespace-nowrap" style={{ left: pct(creditDays), transform: 'translateX(-50%)', color: INK }}>
                    {creditDays}d
                  </div>
                  <div className="absolute top-[12px] text-[10.5px] font-bold whitespace-nowrap" style={{ left: pct(b.age), transform: 'translateX(-50%)', color: tone }}>
                    {b.age}d
                  </div>
                </div>
                <div className="w-[118px] shrink-0 text-right">
                  <span className="inline-block rounded-full px-2.5 py-[3px] text-[11.5px] font-bold" style={late ? { background: '#fdecec', color: '#c62f35' } : { background: '#fff4e0', color: '#b26b00' }}>
                    {late ? `${b.age - creditDays}d overdue` : b.age === creditDays ? 'due today' : `due in ${creditDays - b.age}d`}
                  </span>
                </div>
                <div className="w-[96px] shrink-0 text-right text-[15px] font-extrabold">{rupees(Math.round(b.balance))}</div>
              </div>
            );
          })}
        </div>

        {/* ── The sum ── */}
        <div className="mx-8 mt-6 flex items-center justify-between gap-4 rounded-[18px] px-6 py-4 text-[#ffffff]" style={{ background: 'linear-gradient(120deg, #151a33 0%, #2a2f7a 100%)' }}>
          <div>
            <div className="text-[11px] font-bold tracking-[0.16em] text-[rgba(255,255,255,0.65)] uppercase">Total payable</div>
            <div className="mt-0.5 text-[12.5px] font-semibold text-[rgba(255,255,255,0.8)]">
              {plural(bills.length, 'bill')} · as on {formatDate(asOf)}
            </div>
          </div>
          <div className="text-[32px] font-extrabold">{rupees(Math.round(total))}</div>
        </div>

        <div className="px-8 pt-6 pb-7">
          <p className="text-[14px] leading-relaxed" style={{ color: '#3b4258' }}>
            Kindly arrange the payment at the earliest.
          </p>
          <div className="mt-4 flex items-end justify-between gap-4">
            <div className="text-[12.5px]" style={{ color: MUTED }}>
              {brand?.name && (
                <>
                  Regards,
                  <div className="text-[15px] font-extrabold" style={{ color: INK }}>{brand.name}</div>
                </>
              )}
            </div>
            <div className="text-[11px] font-semibold" style={{ color: '#9aa1b5' }}>Sent {formatDate(new Date())}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
