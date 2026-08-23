import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
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
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type { PartyBalanceSummary, PromiseState } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RowCheckbox } from '@/components/common/row-checkbox';
import { Chip, initials } from './crm-shared';
import { usePartyBalance, usePartyBalances } from './use-crm';

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

const promiseChip = (s: PromiseState) => {
  switch (s) {
    case 'broken': return <Chip tone="rose"><AlertTriangle className="size-3" /> Promise broken</Chip>;
    case 'due today': return <Chip tone="amber">Promise due today</Chip>;
    case 'upcoming': return <Chip tone="sky">Promised</Chip>;
    default: return null;
  }
};

const ageTone = (days: number) => (days >= 60 ? 'rose' : days >= 30 ? 'amber' : days > 0 ? 'sky' : 'slate');

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

/* ── Money KPIs ────────────────────────────────────────────────────────────── */

const KPI_TONE: Record<string, { grad: string; ring: string; bar: string }> = {
  rose: { grad: 'from-rose-500 to-red-600', ring: 'ring-rose-100 dark:ring-rose-500/20', bar: 'bg-rose-500' },
  amber: { grad: 'from-amber-500 to-orange-600', ring: 'ring-amber-100 dark:ring-amber-500/20', bar: 'bg-amber-500' },
  sky: { grad: 'from-sky-500 to-blue-600', ring: 'ring-sky-100 dark:ring-sky-500/20', bar: 'bg-sky-500' },
  violet: { grad: 'from-violet-500 to-purple-600', ring: 'ring-violet-100 dark:ring-violet-500/20', bar: 'bg-violet-500' },
  slate: { grad: 'from-slate-500 to-slate-700', ring: 'ring-slate-100 dark:ring-slate-500/20', bar: 'bg-slate-400' },
};

function MoneyKpi({ label, value, title, hint, icon, tone, index }: { label: string; value: string; title?: string; hint?: string; icon: React.ReactNode; tone: keyof typeof KPI_TONE; index: number }) {
  const t = KPI_TONE[tone];
  return (
    <div
      className="paydesk-row-in bg-card group relative overflow-hidden rounded-xl border p-3 shadow-sm transition-shadow duration-200 hover:shadow-md"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <span className={cn('absolute inset-x-0 top-0 h-[3px]', t.bar)} aria-hidden />
      <div className="flex items-center gap-3">
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-sm ring-4 transition-transform duration-200 group-hover:scale-105', t.grad, t.ring)}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-xl font-bold tabular-nums leading-none" title={title}>{value}</div>
          <div className="text-muted-foreground mt-1 truncate text-xs font-medium">{label}</div>
          {hint && <div className="text-muted-foreground/80 mt-0.5 text-[11px]">{hint}</div>}
        </div>
      </div>
    </div>
  );
}

/** The money-at-a-glance strip for the recovery desk, plus a book-health bar
 *  (overdue vs. total outstanding) so the state of the whole book reads at a glance. */
export function RecoveryMoneyStrip({ balances }: { balances: PartyBalanceSummary[] }) {
  const totals = useMemo(() => {
    let outstanding = 0, gross = 0, overdue = 0, dueSoon = 0, promised = 0, promisedBroken = 0, dueToday = 0, contacted = 0;
    for (const p of balances) {
      outstanding += money(p.outstanding); gross += money(p.gross); overdue += money(p.overdue); dueSoon += money(p.dueSoon);
      if (p.promiseState === 'broken') promisedBroken += p.nextPromiseAmount ?? 0;
      else if (p.nextPromiseAmount) promised += p.nextPromiseAmount;
      if (p.promiseState === 'due today') dueToday += 1;
      if (p.hasFollowup) contacted += 1;
    }
    return { outstanding, gross, overdue, dueSoon, promised, promisedBroken, dueToday, parties: balances.length, contacted };
  }, [balances]);
  const notContacted = totals.parties - totals.contacted;
  // Real ratio, not a fabricated trend — how much of the book is already overdue.
  const overduePct = totals.outstanding > 0 ? Math.round((totals.overdue / totals.outstanding) * 100) : 0;
  const healthTone = overduePct >= 40 ? 'rose' : overduePct >= 15 ? 'amber' : 'emerald';
  const healthText: Record<string, string> = { rose: 'text-rose-600 dark:text-rose-400', amber: 'text-amber-600 dark:text-amber-400', emerald: 'text-emerald-600 dark:text-emerald-400' };
  const healthBar: Record<string, string> = { rose: 'bg-rose-500', amber: 'bg-amber-500', emerald: 'bg-emerald-500' };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {/* Net, so this agrees with the Party Ledger and the Collections report.
            The gross invoice total is on hover, not on the card. */}
        <MoneyKpi
          index={0}
          label="Total outstanding"
          value={inrCompact(totals.outstanding)}
          title={totals.gross > totals.outstanding ? `${inrFull(totals.outstanding)} owed — ${inrFull(totals.gross)} invoiced, less party advances` : inrFull(totals.outstanding)}
          hint={`${totals.parties} owing part${totals.parties === 1 ? 'y' : 'ies'}`}
          icon={<Wallet className="size-5" />}
          tone="slate"
        />
        <MoneyKpi index={1} label="Overdue" value={inrCompact(totals.overdue)} title={inrFull(totals.overdue)} hint={totals.outstanding > 0 ? `${overduePct}% of book` : undefined} icon={<TrendingDown className="size-5" />} tone="rose" />
        <MoneyKpi index={2} label="Due soon (15d)" value={inrCompact(totals.dueSoon)} title={inrFull(totals.dueSoon)} hint="not yet overdue" icon={<Clock3 className="size-5" />} tone="sky" />
        <MoneyKpi index={3} label="Promised to pay" value={inrCompact(totals.promised)} title={inrFull(totals.promised)} hint={totals.dueToday > 0 ? `${totals.dueToday} due today` : 'expected in'} icon={<HandCoins className="size-5" />} tone="violet" />
        <MoneyKpi index={4} label="Not yet contacted" value={String(notContacted)} hint={totals.promisedBroken > 0 ? `${inrCompact(totals.promisedBroken)} broken promises` : 'start working them'} icon={<Users className="size-5" />} tone="amber" />
      </div>

      {/* Book-health bar — real overdue/outstanding ratio, not a decorative gauge. */}
      {totals.outstanding > 0 && (
        <div className="bg-card flex items-center gap-3 rounded-lg border px-3 py-2">
          <ShieldCheck className={cn('size-4 shrink-0', healthText[healthTone])} />
          <div className="min-w-0 flex-1">
            <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
              <div className={cn('h-full rounded-full transition-[width] duration-500', healthBar[healthTone])} style={{ width: `${Math.min(100, overduePct)}%` }} />
            </div>
          </div>
          <span className={cn('shrink-0 text-xs font-semibold tabular-nums', healthText[healthTone])}>{overduePct}% overdue</span>
        </div>
      )}
    </div>
  );
}

/* ── Owing-parties worklist ────────────────────────────────────────────────── */

const PRIORITY_FILTERS: { key: Priority | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'watch', label: 'Overdue' },
  { key: 'soon', label: 'Due soon' },
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

/** The heart of the desk: a searchable, priority-ranked list of who owes what,
 *  with a one-tap "Collect" that opens a pre-filled payment follow-up. Any
 *  collector can pick up any party and start working immediately. */
export function OwingPartiesWorklist({ onCollect, onOpenParty }: { onCollect: (p: CollectPrefill) => void; onOpenParty: (party: string) => void }) {
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const { data: raw = [], isLoading, isFetching } = usePartyBalances(search);

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

  const collectFrom = (p: PartyBalanceSummary) => {
    // Prefill with what they actually owe. Asking for the gross invoice figure
    // when their own advance is already sitting with us is the wrong ask.
    const ask = p.overdue > 0 ? p.overdue : money(p.outstanding);
    onCollect({ party: p.partyName, customerId: p.customerId, amount: ask, itemText: `${inrFull(ask)} balance · ${p.invoiceCount} invoice${p.invoiceCount === 1 ? '' : 's'}` });
  };

  return (
    <section className="bg-card overflow-hidden rounded-xl border shadow-sm">
      <style>{PAYDESK_CSS}</style>
      <div className="from-primary/[0.06] flex flex-wrap items-center gap-2 border-b bg-gradient-to-r via-transparent to-transparent px-3 py-2.5">
        <HandCoins className="text-primary size-4 shrink-0" />
        <h3 className="mr-auto text-sm font-semibold">Who owes money — pick one to collect</h3>
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input placeholder="Search party or agent…" className="h-9 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          {isFetching && !isLoading && <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-3.5 -translate-y-1/2 animate-spin" />}
        </div>
      </div>

      {/* Priority quick-filter — client-side over the same fetched list, so
          switching it is instant (no extra round-trip). */}
      {!isLoading && raw.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b bg-slate-50/60 px-3 py-2 dark:bg-white/[0.02]">
          <SlidersHorizontal className="text-muted-foreground size-3.5 shrink-0" />
          {PRIORITY_FILTERS.map((f) => {
            const n = f.key === '' ? raw.length : counts[f.key];
            const active = priority === f.key;
            return (
              <button
                key={f.key || 'all'}
                type="button"
                onClick={() => setPriority(f.key)}
                disabled={f.key !== '' && n === 0}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted border-border',
                )}
              >
                {f.label}
                <span className={cn('tabular-nums', active ? 'opacity-90' : 'opacity-60')}>{n}</span>
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
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b bg-slate-50/80 text-left text-xs uppercase tracking-wide dark:bg-white/[0.03]">
                  <th className="py-2 pr-3 pl-4 font-semibold">Party</th>
                  <th className="py-2 pr-3 text-right font-semibold">Outstanding</th>
                  <th className="py-2 pr-3 text-right font-semibold">Overdue</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold">Last receipt</th>
                  <th className="py-2 pr-4 text-right font-semibold">Collect</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((p, i) => {
                  const pr = priorityOf(p);
                  return (
                    <tr key={p.partyName} className="paydesk-row-in group border-b last:border-0 hover:bg-slate-50/70 dark:hover:bg-white/[0.03]" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                      <td className="relative py-2.5 pr-3 pl-4">
                        <span className={cn('absolute inset-y-1.5 left-0 w-[3px] rounded-r-full', RAIL_TONE[pr])} aria-hidden />
                        <button type="button" onClick={() => onOpenParty(p.partyName)} className="flex cursor-pointer items-center gap-2 text-left">
                          <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">{initials(p.partyName)}</span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium group-hover:underline">{p.partyName}</span>
                            <span className="text-muted-foreground block truncate text-xs">{p.agent || 'No agent'} · {p.invoiceCount} inv{p.openFollowups > 0 ? ` · ${p.openFollowups} open` : ''}</span>
                          </span>
                        </button>
                      </td>
                      <td
                        className="py-2.5 pr-3 text-right font-semibold tabular-nums"
                        title={p.advanceHeld > 0 ? `${inrFull(money(p.outstanding))} owed — ${inrFull(money(p.gross))} invoiced, less ${inrFull(money(p.advanceHeld))} advance` : inrFull(money(p.outstanding))}
                      >
                        {inrCompact(money(p.outstanding))}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {p.overdue > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="text-rose-600 dark:text-rose-400" title={inrFull(p.overdue)}>{inrCompact(p.overdue)}</span>
                            <Chip tone={ageTone(p.oldestDays)} title={agingHint(p.oldestDays)}>{p.oldestDays}d</Chip>
                          </span>
                        ) : p.dueSoon > 0 ? (
                          <span className="text-sky-600 dark:text-sky-400 text-xs font-medium">{inrCompact(p.dueSoon)} soon</span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2.5 pr-3">
                        {promiseChip(p.promiseState) ?? (p.hasFollowup ? <Chip tone="slate">In progress</Chip> : <Chip tone="slate">Not contacted</Chip>)}
                        {p.nextPromiseAt && <div className="text-muted-foreground mt-0.5 text-[11px]">{formatDate(p.nextPromiseAt)}{p.nextPromiseAmount ? ` · ${inrCompact(p.nextPromiseAmount)}` : ''}</div>}
                      </td>
                      <td className="text-muted-foreground py-2.5 pr-3 text-xs">{p.lastReceiptAt ? formatDate(p.lastReceiptAt) : 'never'}</td>
                      <td className="py-2.5 pr-4 text-right">
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 rounded-full px-3 text-xs font-semibold shadow-sm transition-transform active:scale-95"
                          onClick={() => collectFrom(p)}
                          title={`Collect from ${p.partyName}`}
                        >
                          <Phone className="size-3.5" /> Collect
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 divide-y-0 p-2 md:hidden">
            {balances.map((p, i) => {
              const pr = priorityOf(p);
              return (
                <div key={p.partyName} className="paydesk-row-in bg-card relative overflow-hidden rounded-xl border p-3 shadow-sm" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
                  <span className={cn('absolute inset-y-0 left-0 w-1', RAIL_TONE[pr])} aria-hidden />
                  <div className="flex items-start gap-2 pl-1.5">
                    <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">{initials(p.partyName)}</span>
                    <button type="button" onClick={() => onOpenParty(p.partyName)} className="min-w-0 flex-1 cursor-pointer text-left">
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
                  <div className="mt-2.5 flex items-center gap-2 pl-1.5">
                    <div className="flex flex-1 flex-wrap items-center gap-1.5">
                      {promiseChip(p.promiseState) ?? (p.hasFollowup ? <Chip tone="slate">In progress</Chip> : <Chip tone="slate">Not contacted</Chip>)}
                      {p.lastReceiptAt && <span className="text-muted-foreground text-[11px]">paid {formatDate(p.lastReceiptAt)}</span>}
                    </div>
                    <Button size="sm" className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-xs font-semibold shadow-sm transition-transform active:scale-95" onClick={() => collectFrom(p)}>
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
          <div className="max-h-52 overflow-y-auto px-2.5 py-1.5">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10px] font-bold tracking-[0.08em] text-slate-500 uppercase dark:border-white/10 dark:text-slate-400">
                  {onPickInvoice && <th className="w-6 py-1" />}
                  <th className="py-1 pr-2 font-semibold">Invoice</th>
                  <th className="py-1 pr-2 font-semibold">Due</th>
                  {/* How it was billed. Most invoices here are split across both,
                      and a collector needs to know which part they are chasing. */}
                  <th className="py-1 pr-2 text-right font-semibold" title="Billed on the bank side">B / Bank</th>
                  <th className="py-1 pr-2 text-right font-semibold" title="Billed in cash">C / Cash</th>
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
                      <td className="py-1 pr-2">
                        {inv.dueDate ? formatDate(inv.dueDate) : '\u2014'}
                        {inv.overdueDays > 0 && <Chip tone={ageTone(inv.overdueDays)} className="ml-1">{inv.overdueDays}d</Chip>}
                      </td>
                      <td
                        className={cn(
                          'py-1 pr-2 text-right tabular-nums',
                          inv.bank > 0 ? 'font-semibold text-blue-700 dark:text-blue-400' : 'text-muted-foreground/40',
                        )}
                        title={inv.bank > 0 ? inrFull(inv.bank) : 'Nothing billed on the bank side'}
                      >
                        {inv.bank > 0 ? inrCompact(inv.bank) : '\u2014'}
                      </td>
                      <td
                        className={cn(
                          'py-1 pr-2 text-right tabular-nums',
                          inv.cash > 0 ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground/40',
                        )}
                        title={inv.cash > 0 ? inrFull(inv.cash) : 'Nothing billed in cash'}
                      >
                        {inv.cash > 0 ? inrCompact(inv.cash) : '\u2014'}
                      </td>
                      <td className="py-1 pr-2 text-right font-semibold tabular-nums" title={inrFull(inv.balance)}>
                        {inrCompact(inv.balance)}
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
                B {inrCompact(pickedTotals.bank)} · C {inrCompact(pickedTotals.cash)}
              </span>
              <span className="ml-auto font-bold tabular-nums" title={inrFull(pickedTotals.balance)}>
                {inrCompact(pickedTotals.balance)}
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
