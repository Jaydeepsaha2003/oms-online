import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  HandCoins,
  Loader2,
  Phone,
  Receipt,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TrendingDown,
  Wallet,
  X,
} from 'lucide-react';
import type { PartyBalanceSummary, PartyOpenInvoice, PromiseState } from '@oms/shared';
import { cn } from '@/lib/utils';
import { MoneyCard, SKIN_TONE } from '@/components/common/mobile-skin';
import { formatDate } from '@/lib/date-format';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RowCheckbox } from '@/components/common/row-checkbox';
import { Chip, initials, urgencyMeta } from './crm-shared';
import { useFollowupList, usePartyBalance, usePartyBalances } from './use-crm';

/** What a "Collect" action hands back to the page to pre-fill the form. */
export interface CollectPrefill {
  party: string;
  customerId: number | null;
  amount: number;
  itemText: string;
}

/**
 * Never let a money field the server did not send reach a formatter — a browser
 * running ahead of the API would otherwise print "₹NaN".
 *
 * `outstanding` is already the NET balance: the party's own advance has been
 * applied to their oldest invoices first, server-side. `gross` is carried
 * alongside purely so the hover text can show the breakdown.
 */
const money = (v: number | undefined) => (Number.isFinite(v) ? (v as number) : 0);

/** The form pre-fill for collecting `amount` from a party — naming the invoices
 *  when specific ones were picked, else the balance and how many bills it spans. */
const prefillFor = (p: PartyBalanceSummary, amount: number, codes: string[] = []): CollectPrefill => ({
  party: p.partyName,
  customerId: p.customerId,
  amount,
  itemText: codes.length
    ? `${inrFull(amount)} for ${codes.join(', ')}`
    : `${inrFull(amount)} balance · ${p.invoiceCount} invoice${p.invoiceCount === 1 ? '' : 's'}`,
});

const PILL = 'px-[9px] py-[3px] text-[11.5px] font-bold';
const promiseChip = (s: PromiseState, className?: string) => {
  switch (s) {
    case 'broken': return <Chip tone="rose" className={className}><AlertTriangle className="size-3" /> Promise broken</Chip>;
    case 'due today': return <Chip tone="amber" className={className}>Promise due today</Chip>;
    case 'upcoming': return <Chip tone="sky" className={className}>Promised</Chip>;
    default: return null;
  }
};
/** Where the conversation with a party stands, as one chip. */
const statusChip = (p: PartyBalanceSummary, className?: string) =>
  promiseChip(p.promiseState, className) ?? <Chip tone="slate" className={className}>{p.hasFollowup ? 'In progress' : 'Not contacted'}</Chip>;

// Any overdue day is red, same as Receive Payment's OVERDUE — a 17-day-late bill
// in blue read as "fine" next to the same bill flagged red on the other screen.
const ageTone = (days: number) => (days > 0 ? 'rose' : 'slate');

/**
 * The age badge sits next to the overdue AMOUNT, which makes it read as "all of
 * this has been overdue that long". It isn't — it's the age of the single OLDEST
 * unpaid invoice, and a tiny leftover balance on one old bill (a short payment, a
 * rounding remainder) will age a party whose real debt is weeks old. Spell that
 * out on hover so the number can't be misread.
 */
const agingHint = (days: number) =>
  `Oldest unpaid invoice is ${days} day${days === 1 ? '' : 's'} past due. This is the age of that ONE invoice — even a small leftover balance on an old bill shows here, so newer invoices may make up most of the overdue amount. Tap Collect and open the invoice list to see the ageing bill by bill.`;

// A party row's overall priority, worst-first — drives the left accent rail,
// the quick-filter chips, and the sort order (highest-risk parties surface
// first so a collector always works the worst debt first).
type Priority = 'critical' | 'watch' | 'soon' | 'clear';
const RAIL_TONE: Record<Priority, string> = {
  critical: 'bg-rose-500',
  watch: 'bg-amber-500',
  soon: 'bg-sky-500',
  clear: 'bg-slate-300 dark:bg-slate-600',
};
/** The same four priorities as a skin tone, for the phone's rail and avatar. */
const PRIORITY_SKIN: Record<Priority, keyof typeof SKIN_TONE> = {
  critical: 'rose', watch: 'amber', soon: 'sky', clear: 'emerald',
};
/** …and as the desktop mockup paints them: a two-stop rail and a tinted avatar.
 *  These are Tailwind's own scales, which is what the mockup used. */
const DESK_RAIL: Record<Priority, string> = {
  critical: 'from-rose-400 to-rose-600',
  watch: 'from-amber-300 to-amber-500',
  soon: 'from-sky-300 to-sky-500',
  clear: 'from-emerald-300 to-emerald-500',
};
const DESK_AV: Record<Priority, string> = {
  critical: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  watch: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  soon: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  clear: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
};
function priorityOf(p: PartyBalanceSummary): Priority {
  if (p.promiseState === 'broken' || p.oldestDays >= 60) return 'critical';
  if (p.overdue > 0) return 'watch';
  if (p.dueSoon > 0 && !p.hasFollowup) return 'soon';
  return 'clear';
}

// Staggered fade+rise for the worklist rows/cards — same timing/easing as the
// Dispatch Order cards, so the two "worklist" screens in the app feel like one
// family. Reduced-motion safe.
const PAYDESK_CSS = `
.paydesk-row-in { animation: paydeskRowIn .32s cubic-bezier(.22,1,.36,1) both; }
@keyframes paydeskRowIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .paydesk-row-in { animation: none; } }
`;

/** Which side of the book the desk is showing. */
export type LedgerView = 'ALL' | 'BANK' | 'CASH';

/**
 * The balances as seen from one side of the book. BANK / CASH swap each party's
 * money figures for that side's (worked out server-side, after the party's own
 * advance) and drop parties who owe nothing on it; ALL is the list unchanged.
 * Everything downstream — KPIs, priority, sorting, the Collect amount — reads
 * the swapped fields, so none of it needs to know a view exists.
 */
export function balancesInView(list: PartyBalanceSummary[], view: LedgerView): PartyBalanceSummary[] {
  if (view === 'ALL') return list;
  const key = view === 'BANK' ? 'bank' : 'cash';
  return list
    .filter((p) => (p[key]?.outstanding ?? 0) > 0)
    .map((p) => {
      const s = p[key];
      return { ...p, outstanding: s.outstanding, gross: s.outstanding, overdue: s.overdue, dueSoon: s.dueSoon, oldestDays: s.oldestDays, invoiceCount: s.invoiceCount };
    });
}

/** The book's headline figures. The phone's money rail and the desktop hero
 *  both read these, so the two can never show different totals. */
export function bookTotals(balances: PartyBalanceSummary[]) {
  let outstanding = 0, gross = 0, overdue = 0, dueSoon = 0, promised = 0, promisedBroken = 0, dueToday = 0, contacted = 0;
  for (const p of balances) {
    outstanding += money(p.outstanding); gross += money(p.gross); overdue += money(p.overdue); dueSoon += money(p.dueSoon);
    if (p.promiseState === 'broken') promisedBroken += p.nextPromiseAmount ?? 0;
    else if (p.nextPromiseAmount) promised += p.nextPromiseAmount;
    if (p.promiseState === 'due today') dueToday += 1;
    if (p.hasFollowup) contacted += 1;
  }
  // Real ratio, not a fabricated trend — how much of the book is already overdue.
  const overduePct = outstanding > 0 ? Math.round((overdue / outstanding) * 100) : 0;
  return { outstanding, gross, overdue, dueSoon, promised, promisedBroken, dueToday, parties: balances.length, notContacted: balances.length - contacted, overduePct };
}

/** The phone's money rail plus a book-health bar (overdue vs. outstanding). On
 *  desktop the same figures live in the page's hero, so this is phone-only. */
export function RecoveryMoneyStrip({ balances }: { balances: PartyBalanceSummary[] }) {
  const t = useMemo(() => bookTotals(balances), [balances]);
  const healthTone = t.overduePct >= 40 ? 'rose' : t.overduePct >= 15 ? 'amber' : 'emerald';
  const healthText: Record<string, string> = { rose: 'text-rose-600 dark:text-rose-400', amber: 'text-amber-600 dark:text-amber-400', emerald: 'text-emerald-600 dark:text-emerald-400' };
  const healthBar: Record<string, string> = { rose: 'bg-rose-500', amber: 'bg-amber-500', emerald: 'bg-emerald-500' };

  const cards = [
    { label: 'Total outstanding', value: inrCompact(t.outstanding), hint: `${t.parties} owing part${t.parties === 1 ? 'y' : 'ies'}`, tone: 'slate' as const },
    { label: 'Overdue', value: inrCompact(t.overdue), hint: t.outstanding > 0 ? `${t.overduePct}% of book` : undefined, tone: 'rose' as const },
    { label: 'Due soon (15d)', value: inrCompact(t.dueSoon), hint: 'not yet overdue', tone: 'sky' as const },
    { label: 'Promised to pay', value: inrCompact(t.promised), hint: t.dueToday > 0 ? `${t.dueToday} due today` : 'expected in', tone: 'violet' as const },
    { label: 'Not yet contacted', value: String(t.notContacted), hint: t.promisedBroken > 0 ? `${inrCompact(t.promisedBroken)} broken promises` : 'start working them', tone: 'amber' as const },
  ];

  return (
    <div className="space-y-2.5 sm:hidden">
      {/* One rail of glass cards that scrolls sideways, rather than a 2-up grid
          that pushes the worklist below the fold. */}
      <div className="rp-rail-scroll rp-noscroll">
        {cards.map((c, i) => <MoneyCard key={c.label} i={i} {...c} />)}
      </div>

      {/* Book-health bar — real overdue/outstanding ratio, not a decorative gauge. */}
      {t.outstanding > 0 && (
        <div className="bg-card rp-filterline flex items-center gap-3 rounded-2xl px-3 py-2">
          <ShieldCheck className={cn('size-4 shrink-0', healthText[healthTone])} />
          <div className="min-w-0 flex-1">
            <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
              <div className={cn('h-full rounded-full transition-[width] duration-500', healthBar[healthTone])} style={{ width: `${Math.min(100, t.overduePct)}%` }} />
            </div>
          </div>
          <span className={cn('shrink-0 text-xs font-semibold tabular-nums', healthText[healthTone])}>{t.overduePct}% overdue</span>
        </div>
      )}
    </div>
  );
}

/* ── Owing-parties worklist ────────────────────────────────────────────────── */

const PRIORITY_FILTERS: { key: Priority | ''; label: string; dot: string }[] = [
  { key: '', label: 'All', dot: 'bg-slate-400' },
  { key: 'critical', label: 'Critical', dot: 'bg-rose-600' },
  { key: 'watch', label: 'Overdue', dot: 'bg-amber-500' },
  { key: 'soon', label: 'Due soon', dot: 'bg-sky-500' },
  { key: 'clear', label: 'On track', dot: 'bg-emerald-500' },
];

function SkeletonRows() {
  return (
    <>
      <div className="hidden divide-y md:block">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4 px-3 py-3">
            <div className="bg-muted h-7 w-7 shrink-0 animate-pulse rounded-full" />
            <div className="bg-muted h-3.5 w-40 animate-pulse rounded" />
            <div className="bg-muted ml-auto h-3.5 w-16 animate-pulse rounded" />
            <div className="bg-muted h-3.5 w-16 animate-pulse rounded" />
            <div className="bg-muted h-5 w-20 animate-pulse rounded-full" />
            <div className="bg-muted h-8 w-20 animate-pulse rounded-md" />
          </div>
        ))}
      </div>
      <div className="space-y-2.5 p-2.5 md:hidden">
        {[0, 1, 2].map((i) => <div key={i} className="bg-muted/40 h-24 animate-pulse rounded-xl border" />)}
      </div>
    </>
  );
}

/** Bank / Cash view switch — each side in its own colour on the phone so the
 *  view you are in reads at a glance; desktop draws the mockup's segmented
 *  control. Drives the figures above as well as this list. */
const LEDGER_VIEWS: { v: LedgerView; label: string; on: string; off: string }[] = [
  { v: 'ALL', label: 'Bank + Cash', on: 'border-indigo-600 bg-indigo-600 text-white shadow-sm', off: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300' },
  { v: 'BANK', label: 'Bank', on: 'border-sky-600 bg-sky-600 text-white shadow-sm', off: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300' },
  { v: 'CASH', label: 'Cash', on: 'border-emerald-600 bg-emerald-600 text-white shadow-sm', off: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300' },
];

/**
 * The heart of the desk: a searchable, priority-ranked list of who owes what.
 *
 * On a phone, Collect opens a pre-filled payment follow-up straight away. On a
 * wide enough desktop there is room to see the party first, so a row (or its
 * Collect) opens it in the panel beside the list — invoices to pick, the amount
 * to ask for, and what was said last — and "Log promise" there opens the same
 * form. Without that room, a row opens the form directly, as on the phone.
 */
export function OwingPartiesWorklist({ onCollect, view = 'ALL', onViewChange }: { onCollect: (p: CollectPrefill) => void; view?: LedgerView; onViewChange?: (v: LedgerView) => void }) {
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [picked, setPicked] = useState('');
  const asideRef = useRef<HTMLElement>(null);
  const { data: fetched = [], isLoading, isFetching } = usePartyBalances(search);
  const raw = useMemo(() => balancesInView(fetched, view), [fetched, view]);

  const counts = useMemo(() => {
    const c: Record<Priority, number> = { critical: 0, watch: 0, soon: 0, clear: 0 };
    for (const p of raw) c[priorityOf(p)]++;
    return c;
  }, [raw]);

  // Worst-first: critical → watch → soon → clear, then by overdue amount.
  const balances = useMemo(() => {
    const filtered = priority ? raw.filter((p) => priorityOf(p) === priority) : raw;
    const rank: Record<Priority, number> = { critical: 0, watch: 1, soon: 2, clear: 3 };
    return [...filtered].sort((a, b) => rank[priorityOf(a)] - rank[priorityOf(b)] || b.overdue - a.overdue);
  }, [raw, priority]);

  // Prefill with what they actually owe. Asking for the gross invoice figure
  // when their own advance is already sitting with us is the wrong ask.
  const collectFrom = (p: PartyBalanceSummary) => onCollect(prefillFor(p, p.overdue > 0 ? p.overdue : money(p.outstanding)));

  // The worst party is open until another is picked. When the window is too
  // narrow for the panel (a container query hides it), there is nothing to
  // open it in, so the row goes straight to the form, as on a phone.
  const selected = balances.find((p) => p.partyName === picked) ?? balances[0];
  const openParty = (p: PartyBalanceSummary) => {
    if (!asideRef.current?.offsetParent) return collectFrom(p);
    setPicked(p.partyName);
  };

  return (
    <div className="pd-collect">
      <section className="bg-card rp-glass pd-card overflow-hidden rounded-xl border shadow-sm max-sm:rounded-[22px] max-sm:border-0 max-sm:shadow-none">
        <style>{PAYDESK_CSS}</style>
        <div className="pd-card-head from-primary/[0.06] flex flex-wrap items-center gap-2 border-b bg-gradient-to-r via-transparent to-transparent px-3 py-2.5">
          <HandCoins className="text-primary size-4 shrink-0 sm:hidden" />
          <h3 className="pd-card-title text-sm font-semibold">
            Who owes money<span className="sm:hidden"> — pick one to collect</span>
          </h3>
          {onViewChange && (
            <>
              <div role="group" aria-label="Show balances for" className="flex flex-wrap gap-1.5 sm:hidden">
                {LEDGER_VIEWS.map(({ v, label, on, off }) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => onViewChange(v)}
                    className={cn(
                      'inline-flex h-7 cursor-pointer items-center rounded-full border px-3 text-xs font-bold transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none',
                      view === v ? on : off,
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div role="group" aria-label="Show balances for" className="pd-seg max-sm:hidden">
                {LEDGER_VIEWS.map(({ v, label }) => (
                  <button key={v} type="button" className="pd-seg-btn" data-on={view === v} aria-pressed={view === v} onClick={() => onViewChange(v)}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          <span className="mr-auto" aria-hidden />
          <div className="relative w-full sm:w-60">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input placeholder="Search party or agent…" className="h-9 pl-9 sm:rounded-[10px] sm:bg-white dark:sm:bg-white/5" value={search} onChange={(e) => setSearch(e.target.value)} />
            {isFetching && !isLoading && <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-3.5 -translate-y-1/2 animate-spin" />}
          </div>
        </div>

        {/* Priority quick-filter — client-side over the same fetched list, so
            switching it is instant (no extra round-trip). */}
        {!isLoading && raw.length > 0 && (
          <div className="pd-chips flex flex-wrap items-center gap-1.5 border-b bg-slate-50/60 px-3 py-2 dark:bg-white/[0.02]">
            <SlidersHorizontal className="text-muted-foreground size-3.5 shrink-0 sm:hidden" />
            {PRIORITY_FILTERS.map((f) => {
              const n = f.key === '' ? raw.length : counts[f.key];
              const active = priority === f.key;
              return (
                <button
                  key={f.key || 'all'}
                  type="button"
                  onClick={() => setPriority(f.key)}
                  disabled={f.key !== '' && n === 0}
                  data-on={active}
                  className={cn(
                    'pd-chip inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted border-border',
                  )}
                >
                  <span className={cn('pd-dot hidden sm:inline-block', f.dot)} />
                  {f.label}
                  <span className={cn('pd-chip-n tabular-nums', active ? 'opacity-90' : 'opacity-60')}>{n}</span>
                </button>
              );
            })}
          </div>
        )}

        {isLoading ? (
          <SkeletonRows />
        ) : balances.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-14 text-center text-sm">
            <CheckCircle2 className="text-emerald-600 dark:text-emerald-400 size-9" />
            {search || priority ? 'No matching party.' : 'No outstanding balances — everyone has paid.'}
          </div>
        ) : (
          <>
            {/* Desktop: the mockup's grid. The whole row opens the party; the
                name is a real button so the keyboard can do the same, and Call
                and Collect simply let their click reach the row. */}
            <div className="hidden overflow-x-auto md:block">
              <div className="min-w-[740px]">
                <div className="pd-grid pd-thead">
                  <span>Party</span>
                  <span className="text-right">Outstanding</span>
                  <span className="text-right">Overdue</span>
                  <span className="pl-1">Status</span>
                  <span className="text-right">Action</span>
                </div>
                {balances.map((p, i) => {
                  const pr = priorityOf(p);
                  return (
                    <div
                      key={p.partyName}
                      className="pd-grid pd-row pd-rise"
                      data-on={selected?.partyName === p.partyName}
                      style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                      onClick={() => openParty(p)}
                    >
                      <span className={cn('pd-row-rail bg-gradient-to-b', DESK_RAIL[pr])} aria-hidden />
                      <button type="button" className="flex min-w-0 cursor-pointer items-center gap-[11px] text-left" aria-label={`Open ${p.partyName}`}>
                        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-[11.5px] font-extrabold', DESK_AV[pr])}>{initials(p.partyName)}</span>
                        <span className="flex min-w-0 flex-col">
                          <span className="pd-name">{p.partyName}</span>
                          <span className="pd-sub pd-muted">{p.agent || 'No agent'} · {p.lastReceiptAt ? `paid ${formatDate(p.lastReceiptAt)}` : 'never paid'}</span>
                        </span>
                      </button>
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="pd-num" title={p.advanceHeld > 0 ? `${inrFull(money(p.outstanding))} owed — ${inrFull(money(p.gross))} invoiced, less ${inrFull(money(p.advanceHeld))} advance` : inrFull(money(p.outstanding))}>
                          {inrCompact(money(p.outstanding))}
                        </span>
                        <span className="pd-num-sub pd-muted">{p.invoiceCount} invoice{p.invoiceCount === 1 ? '' : 's'}</span>
                      </div>
                      <div className="flex flex-col items-end gap-0.5">
                        {p.overdue > 0 ? (
                          <>
                            <span className="pd-num text-rose-700 dark:text-rose-400" title={inrFull(p.overdue)}>{inrCompact(p.overdue)}</span>
                            <span className={cn('pd-num-sub font-semibold', p.oldestDays >= 60 ? 'text-rose-700 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400')} title={agingHint(p.oldestDays)}>
                              {p.oldestDays} days late
                            </span>
                          </>
                        ) : p.dueSoon > 0 ? (
                          <>
                            <span className="pd-num text-sky-700 dark:text-sky-400" title={inrFull(p.dueSoon)}>{inrCompact(p.dueSoon)}</span>
                            <span className="pd-num-sub pd-muted font-semibold">due soon</span>
                          </>
                        ) : (
                          <>
                            <span className="pd-num text-slate-400">—</span>
                            <span className="pd-num-sub pd-muted font-semibold">nothing due</span>
                          </>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        {statusChip(p, PILL)}
                        {p.nextPromiseAt && (
                          <span className="pd-num-sub pd-muted pl-1 tabular-nums">
                            {formatDate(p.nextPromiseAt)}{p.nextPromiseAmount ? ` · ${inrCompact(p.nextPromiseAmount)}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-end gap-1.5">
                        {p.mobile ? (
                          <a href={`tel:${p.mobile}`} className="pd-btn pd-btn-call" title={`Call ${p.mobile}`}>Call</a>
                        ) : (
                          <button type="button" className="pd-btn pd-btn-call" disabled title="No mobile number on file">Call</button>
                        )}
                        <button type="button" className="pd-btn pd-btn-primary pd-btn-collect" title={`Collect from ${p.partyName}`}>Collect</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Mobile cards */}
            <div className="space-y-2 divide-y-0 p-2 md:hidden">
              {balances.map((p, i) => {
                const pr = priorityOf(p);
                return (
                  <div key={p.partyName} className="paydesk-row-in bg-card rp-party relative overflow-hidden rounded-xl border p-3 shadow-sm max-sm:rounded-[20px] max-sm:border-0 max-sm:pl-[17px] max-sm:shadow-none" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
                    <span className={cn('rp-rail absolute inset-y-0 left-0 w-1 max-sm:w-[5px]', RAIL_TONE[pr])} aria-hidden style={{ background: SKIN_TONE[PRIORITY_SKIN[pr]].grad }} />
                    <div className="flex items-start gap-2 pl-1.5 max-sm:pl-0">
                      <span className="bg-primary/10 text-primary rp-avatar flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold max-sm:size-[34px]" style={{ background: SKIN_TONE[PRIORITY_SKIN[pr]].bg, color: SKIN_TONE[PRIORITY_SKIN[pr]].fg }}>{initials(p.partyName)}</span>
                      <button type="button" onClick={() => collectFrom(p)} className="min-w-0 flex-1 cursor-pointer text-left" title={`Collect from ${p.partyName}`}>
                        <div className="truncate font-medium">{p.partyName}</div>
                        <div className="text-muted-foreground truncate text-xs">{p.agent || 'No agent'} · {p.invoiceCount} inv</div>
                      </button>
                      <div className="text-right">
                        <div className="font-semibold tabular-nums" title={p.advanceHeld > 0 ? `${inrFull(money(p.outstanding))} owed — ${inrFull(money(p.gross))} invoiced, less ${inrFull(money(p.advanceHeld))} advance` : inrFull(money(p.outstanding))}>
                          {inrCompact(money(p.outstanding))}
                        </div>
                        {p.overdue > 0 ? (
                          <div className="text-rose-600 dark:text-rose-400 text-xs tabular-nums" title={agingHint(p.oldestDays)}>{inrCompact(p.overdue)} · {p.oldestDays}d</div>
                        ) : p.dueSoon > 0 ? (
                          <div className="text-sky-600 dark:text-sky-400 text-xs tabular-nums">{inrCompact(p.dueSoon)} soon</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2 pl-1.5 max-sm:pl-0">
                      <div className="flex flex-1 flex-wrap items-center gap-1.5">
                        {statusChip(p)}
                        {p.lastReceiptAt && <span className="text-muted-foreground text-[11px]">paid {formatDate(p.lastReceiptAt)}</span>}
                      </div>
                      <Button size="sm" className="rp-act rp-act-primary h-8 shrink-0 gap-1.5 rounded-full px-3 text-xs font-semibold shadow-sm transition-transform active:scale-95 max-sm:rounded-xl" onClick={() => collectFrom(p)}>
                        <Phone className="size-3.5" /> Collect
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {!isLoading && selected && (
        <PartyDetailAside key={selected.partyName} p={selected} view={view} onCollect={onCollect} asideRef={asideRef} />
      )}
    </div>
  );
}

/* ── The party beside the worklist (desktop) ───────────────────────────────── */

/** An activity line's dot, by the follow-up's urgency tone. */
const DOT: Record<string, string> = {
  rose: 'bg-rose-600', amber: 'bg-amber-500', sky: 'bg-sky-500', slate: 'bg-slate-400', emerald: 'bg-emerald-500',
};

/**
 * One party, opened: the four figures that decide the call, their open
 * invoices to pick from, the amount to ask for, and the last few things that
 * happened. "Log promise" opens the ordinary payment follow-up form with all
 * of that filled in — this panel records nothing itself.
 *
 * Every figure follows the Bank / Cash view the list is in, invoices included,
 * so the amount it proposes is the amount the list says they owe.
 */
function PartyDetailAside({ p, view, onCollect, asideRef }: {
  p: PartyBalanceSummary;
  view: LedgerView;
  onCollect: (c: CollectPrefill) => void;
  asideRef: React.Ref<HTMLElement>;
}) {
  const { data } = usePartyBalance(p.customerId, p.partyName);
  const { data: history } = useFollowupList({ kind: 'PAYMENT', party: p.partyName, pageSize: 20 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState<number | null>(null);
  const pr = priorityOf(p);

  const side = (inv: PartyOpenInvoice) => (view === 'BANK' ? inv.bank : view === 'CASH' ? inv.cash : inv.balance);
  const invoices = (data?.invoices ?? []).filter((inv) => side(inv) > 0);
  const pickedCodes = invoices.filter((inv) => picked.has(inv.code)).map((inv) => inv.code);
  const pickedSum = invoices.filter((inv) => picked.has(inv.code)).reduce((n, inv) => n + side(inv), 0);
  // Picking invoices proposes their total; a quick button or typing overrides it.
  const ask = amount ?? (pickedCodes.length ? pickedSum : p.overdue || money(p.outstanding));
  const toggle = (code: string) => {
    setAmount(null);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };
  const quick = (v: number) => { setPicked(new Set()); setAmount(v); };

  const stats = [
    { label: 'Outstanding', value: inrCompact(money(p.outstanding)), tone: '' },
    { label: 'Overdue', value: p.overdue > 0 ? inrCompact(p.overdue) : '—', tone: p.overdue > 0 ? 'text-rose-700 dark:text-rose-400' : '' },
    { label: 'Oldest bill', value: p.oldestDays > 0 ? `${p.oldestDays} days` : '—', tone: '' },
    { label: 'Promise', value: p.nextPromiseAt ? formatDate(p.nextPromiseAt) : 'None', tone: p.promiseState === 'broken' ? 'text-rose-700 dark:text-rose-400' : '' },
  ];

  // Newest first. The list endpoint sorts for the board (urgent, soonest), so
  // the order that matters here is re-applied.
  const activity = [...(history?.items ?? [])]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3)
    .map((f) => {
      const m = urgencyMeta(f);
      return { key: f.id, text: f.title, meta: `${m.label} · ${formatDate(f.updatedAt)}${f.agentName ? ` · ${f.agentName}` : ''}`, dot: DOT[m.tone] };
    });
  if (p.lastReceiptAt) activity.push({ key: 0, text: 'Last payment received.', meta: formatDate(p.lastReceiptAt), dot: DOT.emerald });

  return (
    <aside ref={asideRef} className="pd-aside pd-rise hidden flex-col md:flex" aria-label={`${p.partyName} — details`}>
      <div className="relative shrink-0 px-4 pt-4 pb-3">
        <span className={cn('absolute inset-x-0 top-0 h-[5px] bg-gradient-to-r', DESK_RAIL[pr])} aria-hidden />
        <div className="flex items-center gap-3">
          <span className={cn('flex size-[46px] shrink-0 items-center justify-center rounded-full text-[15px] font-extrabold', DESK_AV[pr])}>{initials(p.partyName)}</span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[16.5px] font-extrabold" title={p.partyName}>{p.partyName}</span>
            <span className="pd-muted truncate text-[12.5px]">
              {p.agent || 'No agent'} · {p.lastReceiptAt ? `last paid ${formatDate(p.lastReceiptAt)}` : 'never paid'}
            </span>
          </div>
          {statusChip(p, 'px-2.5 py-1 text-[11.5px] font-extrabold')}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="pd-stat">
              <div className="pd-stat-label">{s.label}</div>
              <div className={cn('pd-stat-value', s.tone)}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-h-[150px] flex-col px-4 pb-3">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <span className="pd-caption">Open invoices</span>
          <span className="pd-muted text-xs tabular-nums">
            {pickedCodes.length ? `${pickedCodes.length} selected · ${inrFull(pickedSum)}` : data ? `${invoices.length} open` : ''}
          </span>
        </div>
        <div className="flex max-h-60 min-h-0 flex-col gap-1.5 overflow-auto">
          {!data ? (
            <div className="pd-muted flex items-center gap-2 py-3 text-xs"><Loader2 className="size-3.5 animate-spin" /> Loading invoices…</div>
          ) : invoices.length === 0 ? (
            <div className="pd-muted py-3 text-xs">No open invoices on this side of the book.</div>
          ) : (
            invoices.map((inv) => {
              const on = picked.has(inv.code);
              return (
                <button key={inv.code} type="button" className="pd-inv" aria-pressed={on} onClick={() => toggle(inv.code)}>
                  <span className="pd-inv-box" aria-hidden>{on && <Check className="size-3" strokeWidth={3.5} />}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-mono text-[12.5px]">{inv.code}</span>
                    <span className="pd-muted text-[11.5px]">Billed {formatDate(inv.invDate)}</span>
                  </span>
                  <span className="flex flex-col items-end">
                    <span className="text-[13.5px] font-extrabold tabular-nums">{inrFull(side(inv))}</span>
                    <span className={cn('text-[11px] font-bold', inv.overdueDays > 0 ? 'text-rose-700 dark:text-rose-400' : 'text-sky-700 dark:text-sky-400')}>
                      {inv.overdueDays > 0 ? `${inv.overdueDays}d overdue` : 'not due'}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="pd-foot">
        <div className="flex flex-wrap gap-2">
          {p.overdue > 0 && (
            <button type="button" className="pd-btn pd-quick-rose tabular-nums" aria-pressed={amount === p.overdue} onClick={() => quick(p.overdue)}>
              Overdue {inrCompact(p.overdue)}
            </button>
          )}
          <button type="button" className="pd-btn pd-quick-slate tabular-nums" aria-pressed={amount === money(p.outstanding)} onClick={() => quick(money(p.outstanding))}>
            Full {inrCompact(money(p.outstanding))}
          </button>
        </div>
        <div className="flex items-center gap-2.5">
          <label className="pd-amount">
            <span className="pd-muted text-[15px]">₹</span>
            <input
              inputMode="numeric"
              aria-label="Amount promised"
              value={ask.toLocaleString('en-IN')}
              onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, '')) || 0)}
            />
            <span className="pd-muted text-[11.5px]">promised</span>
          </label>
          <button type="button" className="pd-btn pd-btn-primary pd-btn-lg" disabled={ask <= 0} onClick={() => onCollect(prefillFor(p, ask, pickedCodes))}>
            Log promise
          </button>
        </div>
      </div>

      <div className="pd-section">
        <div className="pd-caption mb-2.5">Recent activity</div>
        {activity.length === 0 ? (
          <p className="pd-muted text-[13px]">Nothing logged for this party yet.</p>
        ) : (
          <div className="flex flex-col gap-[9px]">
            {activity.map((e) => (
              <div key={e.key} className="flex gap-2.5">
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', e.dot)} />
                <div className="flex min-w-0 flex-col">
                  <span className="text-[13px] leading-[1.45] text-pretty">{e.text}</span>
                  <span className="pd-muted text-[11.5px]">{e.meta}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

/* ── Party balance panel (shown inside the follow-up form) ──────────────────── */

/** Live money picture for the party being worked — outstanding, overdue, open
 *  invoices, and quick-fill buttons for the promised amount. */
export function PartyBalancePanel({ customerId, party, onPickAmount, onPickInvoice }: {
  customerId: number | null;
  party: string;
  onPickAmount: (amount: number, label: string) => void;
  onPickInvoice?: (code: string, balance: number) => void;
}) {
  const enabled = customerId != null || party.trim().length > 0;
  const { data, isLoading } = usePartyBalance(customerId, party, enabled);
  const [showInvoices, setShowInvoices] = useState(false);

  /*
   * Multi-select over the open invoices.
   *
   * "use" on a single row is kept — most collections are about one invoice and
   * that path should not get slower. Ticking rows is the addition: a party who
   * promises to clear three invoices at once now produces one promise for their
   * combined balance instead of three separate follow-ups.
   *
   * Keyed by invoice code (stable) rather than index, so the set survives the
   * list reordering underneath it.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleInvoice = (code: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const pickedTotals = useMemo(() => {
    const rows = (data?.invoices ?? []).filter((inv) => selected.has(inv.code));
    return {
      codes: rows.map((r) => r.code),
      balance: rows.reduce((n, r) => n + r.balance, 0),
      bank: rows.reduce((n, r) => n + r.bank, 0),
      cash: rows.reduce((n, r) => n + r.cash, 0),
    };
  }, [data, selected]);

  if (!enabled) return null;
  if (isLoading) {
    return <div className="text-muted-foreground flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-white/10 dark:bg-white/[0.03]"><Loader2 className="size-4 animate-spin" /> Fetching balance…</div>;
  }
  if (!data || money(data.outstanding) <= 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
        <Banknote className="size-4" /> No outstanding balance for <strong>{data?.partyName || party}</strong> — account is clear.
      </div>
    );
  }

  const fullLabel = `${inrFull(money(data.outstanding))} full balance`;
  return (
    <div className="bg-card overflow-hidden rounded-md border border-slate-300 dark:border-white/15">
      <div className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4 dark:bg-white/10">
        <Stat
          icon={Wallet}
          label="Outstanding"
          value={inrCompact(money(data.outstanding))}
          title={data.advanceHeld > 0 ? `${inrFull(money(data.outstanding))} owed — ${inrFull(money(data.gross))} invoiced, less ${inrFull(money(data.advanceHeld))} advance` : inrFull(money(data.outstanding))}
          strong
        />
        <Stat icon={TrendingDown} label="Overdue" value={data.overdue > 0 ? inrCompact(data.overdue) : '—'} title={inrFull(data.overdue)} tone={data.overdue > 0 ? 'rose' : undefined} />
        <Stat icon={Clock3} label="Oldest" value={data.oldestDays > 0 ? `${data.oldestDays}d` : '—'} title={data.oldestDays > 0 ? agingHint(data.oldestDays) : undefined} />
        <Stat icon={CalendarClock} label="Last receipt" value={data.lastReceiptAt ? formatDate(data.lastReceiptAt) : 'never'} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-2.5 py-2 dark:border-white/10">
        <span className="text-[10.5px] font-bold tracking-[0.09em] text-slate-500 uppercase dark:text-slate-400">Promise</span>
        {data.overdue > 0 && (
          <button type="button" onClick={() => onPickAmount(data.overdue, `${inrFull(data.overdue)} overdue`)} className="bg-card cursor-pointer rounded-md border border-rose-300 px-2.5 py-1 text-xs font-semibold tabular-nums text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10">
            Overdue {inrCompact(data.overdue)}
          </button>
        )}
        <button type="button" onClick={() => onPickAmount(money(data.outstanding), fullLabel)} className="bg-card cursor-pointer rounded-md border border-slate-400 px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-700 transition-colors hover:bg-slate-100 dark:border-white/25 dark:text-slate-200 dark:hover:bg-white/10">
          Full {inrCompact(money(data.outstanding))}
        </button>
        {data.advanceHeld > 0 && (
          <span className="text-emerald-700 dark:text-emerald-400 text-xs" title={`Invoices total ${inrFull(data.outstanding)}; ${inrFull(data.advanceHeld)} of their own money is already with us.`}>
            · {inrCompact(data.advanceHeld)} advance already applied
          </span>
        )}
        {data.invoices.length > 0 && (
          /* This is the way into the invoice list — the thing most collection
             calls actually need — so it is sized to be found. It was the
             quietest text on the row despite being the only action on it. */
          <button
            type="button"
            onClick={() => setShowInvoices((v) => !v)}
            className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-[13.5px] font-bold text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300"
          >
            <Receipt className="size-4" />
            {showInvoices ? (
              'Hide invoices'
            ) : (
              <>
                <span className="tabular-nums">{data.invoices.length}</span> open invoice{data.invoices.length === 1 ? '' : 's'}
              </>
            )}
          </button>
        )}
      </div>

      {showInvoices && (
        <div className="border-t border-slate-200 dark:border-white/10">
          <div className="max-h-52 overflow-auto px-2.5 py-1.5">
            <table className="w-full min-w-[700px] text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10px] font-bold tracking-[0.08em] text-slate-500 uppercase dark:border-white/10 dark:text-slate-400">
                  {onPickInvoice && <th className="w-6 py-1" />}
                  <th className="py-1 pr-2 font-semibold">Invoice</th>
                  <th className="py-1 pr-2 font-semibold">Bill date</th>
                  <th className="py-1 pr-2 font-semibold">Due date</th>
                  <th className="py-1 pr-2 text-right font-semibold text-blue-700 dark:text-blue-400" title="Exact amount still due on the bank side">B due</th>
                  <th className="py-1 pr-2 text-right font-semibold text-emerald-700 dark:text-emerald-400" title="Exact amount still due in cash">C due</th>
                  <th className="py-1 pr-2 text-right font-semibold">Balance</th>
                  <th className="py-1 text-right font-semibold" />
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((inv, i) => {
                  const picked = selected.has(inv.code);
                  return (
                    <tr
                      key={inv.code}
                      className={cn(
                        'border-t border-slate-100 dark:border-white/5',
                        i % 2 === 1 && 'bg-muted/30',
                        picked && 'bg-slate-100 dark:bg-white/10',
                      )}
                    >
                      {onPickInvoice && (
                        <td className="py-1">
                          <RowCheckbox
                            checked={picked}
                            onChange={() => toggleInvoice(inv.code)}
                            label={`Select invoice ${inv.code}`}
                          />
                        </td>
                      )}
                      <td className="py-1 pr-2 font-mono">{inv.code}</td>
                      <td className="py-1 pr-2 whitespace-nowrap tabular-nums">
                        {formatDate(inv.invDate)}
                      </td>
                      <td className="py-1 pr-2">
                        <span className="whitespace-nowrap tabular-nums">{inv.dueDate ? formatDate(inv.dueDate) : '\u2014'}</span>
                        {inv.overdueDays > 0 && <Chip tone={ageTone(inv.overdueDays)} className="ml-1">{inv.overdueDays}d</Chip>}
                      </td>
                      <td
                        className={cn(
                          'py-1 pr-2 text-right tabular-nums whitespace-nowrap',
                          inv.bank > 0 ? 'font-bold text-blue-800 dark:text-blue-300' : 'text-muted-foreground/40',
                        )}
                        title={inv.bank > 0 ? `Exact bank due: ${inrFull(inv.bank)}` : 'No bank-side amount due'}
                      >
                        {inv.bank > 0 ? <span className="inline-flex rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 dark:border-blue-500/30 dark:bg-blue-500/10">{inrFull(inv.bank)}</span> : '\u2014'}
                      </td>
                      <td
                        className={cn(
                          'py-1 pr-2 text-right tabular-nums whitespace-nowrap',
                          inv.cash > 0 ? 'font-bold text-emerald-800 dark:text-emerald-300' : 'text-muted-foreground/40',
                        )}
                        title={inv.cash > 0 ? `Exact cash due: ${inrFull(inv.cash)}` : 'No cash amount due'}
                      >
                        {inv.cash > 0 ? <span className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">{inrFull(inv.cash)}</span> : '\u2014'}
                      </td>
                      <td className="py-1 pr-2 text-right font-bold tabular-nums whitespace-nowrap" title={inrFull(inv.balance)}>
                        {inrFull(inv.balance)}
                      </td>
                      <td className="py-1 text-right">
                        {onPickInvoice && (
                          <button
                            type="button"
                            onClick={() => onPickInvoice(inv.code, inv.balance)}
                            className="cursor-pointer text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            use
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Only appears once something is ticked, so the panel is unchanged for
              anyone who just wants one invoice. */}
          {onPickInvoice && selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t-2 border-slate-300 bg-slate-100 px-2.5 py-2 text-xs dark:border-white/20 dark:bg-white/[0.07]">
              <span className="text-[10.5px] font-bold tracking-[0.09em] text-slate-600 uppercase dark:text-slate-300">
                {selected.size} selected
              </span>
              <span className="text-muted-foreground tabular-nums">
                B {inrFull(pickedTotals.bank)} · C {inrFull(pickedTotals.cash)}
              </span>
              <span className="ml-auto font-bold tabular-nums" title={inrFull(pickedTotals.balance)}>
                {inrFull(pickedTotals.balance)}
              </span>
              <Button
                type="button"
                size="sm"
                className="h-7 text-[11.5px]"
                onClick={() => {
                  onPickInvoice(pickedTotals.codes.join(', '), pickedTotals.balance);
                  setSelected(new Set());
                }}
              >
                Use selected
              </Button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
                title="Clear selection"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, title, tone, strong }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; title?: string; tone?: string; strong?: boolean }) {
  return (
    <div className="bg-card px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] font-bold tracking-[0.08em] text-slate-500 uppercase dark:text-slate-400">
        <Icon className="size-3" />
        {label}
      </div>
      <div
        className={cn(
          'mt-1 tabular-nums',
          strong ? 'text-[17px] font-bold' : 'text-[15px] font-semibold',
          tone === 'rose' && 'text-rose-600 dark:text-rose-400',
        )}
        title={title}
      >
        {value}
      </div>
    </div>
  );
}
