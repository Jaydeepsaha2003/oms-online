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
    { key: 'soon', title: `Falling due in ${ahead} days`, hint: 'Asked for in the same call, rather than chased again next week.', dot: 'bg-amber-500', rows: soon },
    { key: 'later', title: 'Not due yet', hint: 'Left out of the demand unless ticked.', dot: 'bg-slate-400', rows: bills.filter((b) => b.age <= creditDays && !soon.includes(b)) },
  ].filter((g) => g.rows.length);
  /** Where a bill stands against the credit period. */
  const standing = (b: { date: string; age: number }) =>
    b.age > creditDays
      ? { text: `${b.age - creditDays} days over`, tone: 'text-rose-700 dark:text-rose-400' }
      : b.age === creditDays
        ? { text: 'due today', tone: 'text-amber-700 dark:text-amber-400' }
        : creditDays - b.age <= ahead
          ? { text: `due in ${creditDays - b.age} days · ${formatDate(dueOn(b))}`, tone: 'text-amber-700 dark:text-amber-400' }
          : { text: `due ${formatDate(dueOn(b))}`, tone: 'cs-muted' };
  const copy = () => navigator.clipboard.writeText(text).then(() => toast.success('Copied.'), () => toast.error('Could not copy.'));
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
                  <span className="cs-seg-value">{data ? inrCompact(sideTotal(s)) : '—'}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { label: 'Overdue', value: inrCompact(sum(overdue)), sub: `${overdue.length} bill${overdue.length === 1 ? '' : 's'}` },
                { label: `Due in ${ahead}d`, value: inrCompact(sum(soon)), sub: `${soon.length} bill${soon.length === 1 ? '' : 's'}` },
                { label: 'Oldest bill', value: bills.length ? `${bills[0].age}d` : '—', sub: bills.length ? `billed ${formatDate(bills[0].date)}` : 'nothing open' },
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
                        {g.rows.length} · {inrFull(Math.round(sum(g.rows)))}
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
                                Billed {formatDate(b.date)} · {b.age} days old
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end">
                              <span className="text-[14.5px] font-extrabold tabular-nums">{inrFull(Math.round(b.balance))}</span>
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
              <span className="text-[22px] leading-tight font-extrabold tabular-nums">{inrFull(Math.round(total))}</span>
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
                  onClick={() => (onUse(Math.round(total), `${inrFull(Math.round(total))} demand plan (${chosen.length} bills)`), onOpenChange(false))}
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
 * The demand as a picture for the party — what Share attaches. Fixed colours
 * throughout (hex and rgba, never the theme's tokens or the dark-mode remapped
 * utilities), so it looks the same whatever theme the sender works in.
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
  const dueOn = (b: { date: string }) => {
    const d = new Date(b.date);
    d.setDate(d.getDate() + creditDays);
    return d;
  };
  const over = bills.filter((b) => b.age > creditDays);
  const upcoming = bills.filter((b) => b.age <= creditDays);
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const groups = [
    { key: 'over', title: 'Overdue bills', dot: '#e11d48', rows: over },
    { key: 'up', title: 'Upcoming bills', dot: '#f59e0b', rows: upcoming },
  ].filter((g) => g.rows.length);
  const tiles = [
    { label: 'Overdue', value: inrFull(sum(over)), sub: plural(over.length, 'bill'), bar: '#e11d48', tint: '#fff1f2', ink: '#be123c' },
    { label: 'Upcoming', value: inrFull(sum(upcoming)), sub: plural(upcoming.length, 'bill'), bar: '#f59e0b', tint: '#fffbeb', ink: '#b45309' },
    { label: 'Oldest bill', value: bills.length ? `${bills[0].age} days` : '—', sub: bills.length ? `billed ${formatDate(bills[0].date)}` : '', bar: '#4f6ef7', tint: '#eef1ff', ink: '#2f3fb5' },
  ];
  return (
    <div ref={cardRef} className="w-[720px] bg-[#eef2f8] p-6 text-[#141a2b]" style={{ fontFamily: 'var(--font-jakarta)' }}>
      <div className="overflow-hidden rounded-[28px] border border-[#e3e8f2] bg-[#ffffff]">
        {/* ── Who asks, who owes, and how much ── */}
        <div className="relative overflow-hidden px-8 pt-7 pb-8 text-[#ffffff]" style={{ background: 'linear-gradient(135deg, #4f6ef7 0%, #3a4fd6 55%, #3140b8 100%)' }}>
          <div className="absolute -top-40 -right-28 size-[380px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.22), rgba(255,255,255,0) 65%)' }} />
          <div className="relative flex items-center gap-3.5">
            {company?.logo && (
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#ffffff] p-1.5">
                <img src={company.logo} alt="" className="max-h-full max-w-full object-contain" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[19px] leading-tight font-extrabold">{company?.name}</div>
              <div className="mt-0.5 text-[11.5px] font-bold tracking-[0.14em] text-[rgba(255,255,255,0.78)] uppercase">Payment request</div>
            </div>
            <span className="shrink-0 rounded-full border border-[rgba(255,255,255,0.35)] bg-[rgba(255,255,255,0.14)] px-3.5 py-1.5 text-[12px] font-bold">
              As on {formatDate(asOf)}
            </span>
          </div>

          <div className="relative mt-6 text-[11.5px] font-bold tracking-[0.12em] text-[rgba(255,255,255,0.75)] uppercase">Billed to</div>
          <div className="relative mt-1 text-[27px] leading-tight font-extrabold">{partyName}</div>
          <div className="relative mt-1 text-[13px] text-[rgba(255,255,255,0.8)]">
            {side === 'B' ? 'Bank' : 'Cash'} bills · {creditDays}-day credit period
          </div>

          <div className="relative mt-5 flex items-end justify-between gap-4 rounded-[20px] border border-[rgba(255,255,255,0.28)] bg-[rgba(255,255,255,0.13)] px-6 py-5">
            <div>
              <div className="text-[11.5px] font-bold tracking-[0.12em] text-[rgba(255,255,255,0.8)] uppercase">Amount due</div>
              <div className="mt-1.5 text-[42px] leading-none font-extrabold tracking-[-0.02em] tabular-nums">{inrFull(Math.round(total))}</div>
            </div>
            <div className="text-right text-[13.5px] leading-relaxed font-semibold text-[rgba(255,255,255,0.88)]">
              <div>{plural(bills.length, 'bill')}</div>
              {avgAge != null && <div>average {Math.round(avgAge)} days old</div>}
            </div>
          </div>
        </div>

        {/* ── The split at a glance ── */}
        <div className="grid grid-cols-3 gap-3 px-8 pt-6">
          {tiles.map((t) => (
            <div key={t.label} className="relative overflow-hidden rounded-[16px] border border-[#e8ecf4] px-4 pt-4 pb-3.5" style={{ background: t.tint }}>
              <div className="absolute inset-x-0 top-0 h-[4px]" style={{ background: t.bar }} />
              <div className="text-[11px] font-bold tracking-[0.1em] uppercase" style={{ color: t.ink }}>{t.label}</div>
              <div className="mt-1 text-[19px] leading-tight font-extrabold tabular-nums">{t.value}</div>
              <div className="mt-0.5 text-[12px] font-semibold text-[#6b7590]">{t.sub}</div>
            </div>
          ))}
        </div>

        {/* ── The bills, overdue first ── */}
        <div className="px-8 pt-6">
          {groups.map((g) => (
            <div key={g.key} className="mb-5">
              <div className="mb-2.5 flex items-center gap-2 px-1">
                <span className="size-2.5 rounded-full" style={{ background: g.dot }} />
                <span className="text-[12px] font-extrabold tracking-[0.1em] text-[#5b6479] uppercase">{g.title}</span>
                <span className="ml-auto text-[12.5px] font-bold text-[#6b7590] tabular-nums">
                  {plural(g.rows.length, 'bill')} · {inrFull(sum(g.rows))}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {g.rows.map((b) => {
                  const late = b.age > creditDays;
                  return (
                    // One line a bill: a long book stays short enough that a
                    // chat app's resize leaves the figures readable.
                    <div key={b.code} className="flex items-center gap-3 rounded-[12px] border border-[#e8ecf4] bg-[#fbfcfe] px-3.5 py-2.5">
                      <span className="h-7 w-[4px] shrink-0 rounded-full" style={{ background: g.dot }} />
                      <span className="w-[136px] shrink-0 font-mono text-[14px] font-bold break-all text-[#141a2b]">{b.code}</span>
                      <span className="min-w-0 flex-1 text-[12.5px] whitespace-nowrap text-[#6b7590]">
                        {formatDate(b.date)} · {b.age} days
                      </span>
                      <span
                        className="shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold"
                        style={late ? { background: '#fff1f2', color: '#be123c' } : { background: '#fffbeb', color: '#b45309' }}
                      >
                        {late ? `${b.age - creditDays} days overdue` : b.age === creditDays ? 'due today' : `due ${formatDate(dueOn(b))}`}
                      </span>
                      <span className="w-[104px] shrink-0 text-right text-[15px] font-extrabold tabular-nums">{inrFull(Math.round(b.balance))}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── The sum, and the ask ── */}
        <div className="mx-8 flex items-center justify-between gap-4 rounded-[18px] bg-[#141b33] px-6 py-4 text-[#ffffff]">
          <div>
            <div className="text-[11.5px] font-bold tracking-[0.12em] text-[rgba(255,255,255,0.7)] uppercase">Total due</div>
            <div className="mt-0.5 text-[13px] font-semibold text-[rgba(255,255,255,0.8)]">{plural(bills.length, 'bill')}</div>
          </div>
          <div className="text-[30px] font-extrabold tracking-[-0.02em] tabular-nums">{inrFull(Math.round(total))}</div>
        </div>

        <div className="px-8 pt-6 pb-7">
          <p className="text-[14.5px] leading-relaxed text-[#3a4256]">Kindly arrange the payment at the earliest. Thank you for your business.</p>
          <div className="mt-4 flex items-end justify-between gap-4 border-t border-[#e8ecf4] pt-4">
            <div className="text-[13px] text-[#6b7590]">
              Regards,
              {company?.name && <div className="mt-0.5 text-[15px] font-extrabold text-[#141a2b]">{company.name}</div>}
            </div>
            <div className="text-[11.5px] font-semibold text-[#98a2b8]">Sent {formatDate(new Date())}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
