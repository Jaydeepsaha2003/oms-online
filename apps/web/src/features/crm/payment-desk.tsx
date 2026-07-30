import { useMemo, useState } from 'react';
import { AlertTriangle, Banknote, CalendarClock, HandCoins, Loader2, Phone, Receipt, Search, TrendingDown, Users, Wallet } from 'lucide-react';
import type { PartyBalanceSummary, PromiseState } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Chip, initials } from './crm-shared';
import { usePartyBalance, usePartyBalances } from './use-crm';

/** What a "Collect" action hands back to the page to pre-fill the form. */
export interface CollectPrefill {
  party: string;
  customerId: number | null;
  amount: number;
  itemText: string;
}

const promiseChip = (s: PromiseState) => {
  switch (s) {
    case 'broken': return <Chip tone="rose"><AlertTriangle className="size-3" /> Promise broken</Chip>;
    case 'due today': return <Chip tone="amber">Promise due today</Chip>;
    case 'upcoming': return <Chip tone="sky">Promised</Chip>;
    default: return null;
  }
};

const ageTone = (days: number) => (days >= 60 ? 'rose' : days >= 30 ? 'amber' : days > 0 ? 'sky' : 'slate');

/* ── Money KPIs ────────────────────────────────────────────────────────────── */

function MoneyKpi({ label, value, title, hint, icon, tone }: { label: string; value: string; title?: string; hint?: string; icon: React.ReactNode; tone: string }) {
  const tones: Record<string, string> = {
    rose: 'from-rose-500 to-red-600', amber: 'from-amber-500 to-orange-600', violet: 'from-violet-500 to-purple-600', emerald: 'from-emerald-500 to-green-600', sky: 'from-sky-500 to-blue-600',
  };
  return (
    <div className="bg-card flex items-center gap-3 rounded-xl border p-3 shadow-sm">
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm', tones[tone])}>{icon}</span>
      <div className="min-w-0">
        <div className="text-xl font-bold tabular-nums leading-none" title={title}>{value}</div>
        <div className="text-muted-foreground mt-1 truncate text-xs font-medium">{label}</div>
        {hint && <div className="text-muted-foreground/80 text-[11px]">{hint}</div>}
      </div>
    </div>
  );
}

/** The money-at-a-glance strip for the recovery desk. */
export function RecoveryMoneyStrip({ balances }: { balances: PartyBalanceSummary[] }) {
  const totals = useMemo(() => {
    let outstanding = 0, overdue = 0, promised = 0, promisedBroken = 0, dueToday = 0, contacted = 0;
    for (const p of balances) {
      outstanding += p.outstanding; overdue += p.overdue;
      if (p.promiseState === 'broken') promisedBroken += p.nextPromiseAmount ?? 0;
      else if (p.nextPromiseAmount) promised += p.nextPromiseAmount;
      if (p.promiseState === 'due today') dueToday += 1;
      if (p.hasFollowup) contacted += 1;
    }
    return { outstanding, overdue, promised, promisedBroken, dueToday, parties: balances.length, contacted };
  }, [balances]);
  const notContacted = totals.parties - totals.contacted;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MoneyKpi label="Total outstanding" value={inrCompact(totals.outstanding)} title={inrFull(totals.outstanding)} hint={`${totals.parties} owing parties`} icon={<Wallet className="size-5" />} tone="rose" />
      <MoneyKpi label="Overdue" value={inrCompact(totals.overdue)} title={inrFull(totals.overdue)} hint={totals.outstanding > 0 ? `${Math.round((totals.overdue / totals.outstanding) * 100)}% of book` : undefined} icon={<TrendingDown className="size-5" />} tone="amber" />
      <MoneyKpi label="Promised to pay" value={inrCompact(totals.promised)} title={inrFull(totals.promised)} hint={totals.dueToday > 0 ? `${totals.dueToday} due today` : 'expected in'} icon={<HandCoins className="size-5" />} tone="violet" />
      <MoneyKpi label="Not yet contacted" value={String(notContacted)} hint={totals.promisedBroken > 0 ? `${inrCompact(totals.promisedBroken)} broken promises` : 'start working them'} icon={<Users className="size-5" />} tone="sky" />
    </div>
  );
}

/* ── Owing-parties worklist ────────────────────────────────────────────────── */

/** The heart of the desk: a searchable, ranked list of who owes what, with a
 *  one-tap "Collect" that opens a pre-filled payment follow-up. Any collector
 *  can pick up any party and start working immediately. */
export function OwingPartiesWorklist({ onCollect, onOpenParty }: { onCollect: (p: CollectPrefill) => void; onOpenParty: (party: string) => void }) {
  const [search, setSearch] = useState('');
  const { data: balances = [], isLoading, isFetching } = usePartyBalances(search);

  const collectFrom = (p: PartyBalanceSummary) =>
    onCollect({ party: p.partyName, customerId: p.customerId, amount: p.overdue > 0 ? p.overdue : p.outstanding, itemText: `${inrFull(p.overdue > 0 ? p.overdue : p.outstanding)} balance · ${p.invoiceCount} invoice${p.invoiceCount === 1 ? '' : 's'}` });

  return (
    <section className="bg-card overflow-hidden rounded-xl border shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b bg-gradient-to-r from-slate-50 to-transparent px-3 py-2.5">
        <HandCoins className="text-primary size-4 shrink-0" />
        <h3 className="mr-auto text-sm font-semibold">Who owes money — pick one to collect</h3>
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input placeholder="Search party or agent…" className="h-9 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          {isFetching && <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-3.5 -translate-y-1/2 animate-spin" />}
        </div>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm"><Loader2 className="size-4 animate-spin" /> Loading balances…</div>
      ) : balances.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-sm">{search ? 'No matching party.' : 'No outstanding balances — everyone has paid. 🎉'}</div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs uppercase tracking-wide">
                  <th className="py-2 pl-3 pr-3 font-semibold">Party</th>
                  <th className="py-2 pr-3 text-right font-semibold">Outstanding</th>
                  <th className="py-2 pr-3 text-right font-semibold">Overdue</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold">Last receipt</th>
                  <th className="py-2 pr-3 text-right font-semibold">Collect</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((p) => (
                  <tr key={p.partyName} className="border-b last:border-0 hover:bg-slate-50/60">
                    <td className="py-2 pl-3 pr-3">
                      <button type="button" onClick={() => onOpenParty(p.partyName)} className="flex items-center gap-2 text-left">
                        <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">{initials(p.partyName)}</span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium hover:underline">{p.partyName}</span>
                          <span className="text-muted-foreground block truncate text-xs">{p.agent || 'No agent'} · {p.invoiceCount} inv{p.openFollowups > 0 ? ` · ${p.openFollowups} open` : ''}</span>
                        </span>
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums" title={inrFull(p.outstanding)}>{inrCompact(p.outstanding)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {p.overdue > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-rose-600" title={inrFull(p.overdue)}>{inrCompact(p.overdue)}</span>
                          <Chip tone={ageTone(p.oldestDays)}>{p.oldestDays}d</Chip>
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2 pr-3">
                      {promiseChip(p.promiseState) ?? (p.hasFollowup ? <Chip tone="slate">In progress</Chip> : <Chip tone="slate">Not contacted</Chip>)}
                      {p.nextPromiseAt && <div className="text-muted-foreground mt-0.5 text-[11px]">{formatDate(p.nextPromiseAt)}{p.nextPromiseAmount ? ` · ${inrCompact(p.nextPromiseAmount)}` : ''}</div>}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground text-xs">{p.lastReceiptAt ? formatDate(p.lastReceiptAt) : 'never'}</td>
                    <td className="py-2 pr-3 text-right">
                      <Button size="sm" className="h-8 gap-1 px-2.5 text-xs" onClick={() => collectFrom(p)}><Phone className="size-3.5" /> Collect</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="divide-y md:hidden">
            {balances.map((p) => (
              <div key={p.partyName} className="p-3">
                <div className="flex items-start gap-2">
                  <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">{initials(p.partyName)}</span>
                  <button type="button" onClick={() => onOpenParty(p.partyName)} className="min-w-0 flex-1 text-left">
                    <div className="truncate font-medium">{p.partyName}</div>
                    <div className="text-muted-foreground truncate text-xs">{p.agent || 'No agent'} · {p.invoiceCount} inv</div>
                  </button>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums" title={inrFull(p.outstanding)}>{inrCompact(p.outstanding)}</div>
                    {p.overdue > 0 && <div className="text-rose-600 text-xs tabular-nums">{inrCompact(p.overdue)} · {p.oldestDays}d</div>}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex flex-1 flex-wrap items-center gap-1.5">
                    {promiseChip(p.promiseState) ?? (p.hasFollowup ? <Chip tone="slate">In progress</Chip> : <Chip tone="slate">Not contacted</Chip>)}
                    {p.lastReceiptAt && <span className="text-muted-foreground text-[11px]">paid {formatDate(p.lastReceiptAt)}</span>}
                  </div>
                  <Button size="sm" className="h-8 gap-1 px-3 text-xs" onClick={() => collectFrom(p)}><Phone className="size-3.5" /> Collect</Button>
                </div>
              </div>
            ))}
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

  if (!enabled) return null;
  if (isLoading) {
    return <div className="text-muted-foreground flex items-center gap-2 rounded-xl border bg-slate-50/60 p-3 text-sm"><Loader2 className="size-4 animate-spin" /> Fetching balance…</div>;
  }
  if (!data || data.outstanding <= 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-700">
        <Banknote className="size-4" /> No outstanding balance for <strong>{data?.partyName || party}</strong> — account is clear.
      </div>
    );
  }

  const fullLabel = `${inrFull(data.outstanding)} full balance`;
  return (
    <div className="overflow-hidden rounded-xl border border-indigo-200 bg-indigo-50/50">
      <div className="grid grid-cols-2 gap-px bg-indigo-200/60 sm:grid-cols-4">
        <Stat label="Outstanding" value={inrCompact(data.outstanding)} title={inrFull(data.outstanding)} strong />
        <Stat label="Overdue" value={data.overdue > 0 ? inrCompact(data.overdue) : '—'} title={inrFull(data.overdue)} tone={data.overdue > 0 ? 'rose' : undefined} />
        <Stat label="Oldest" value={data.oldestDays > 0 ? `${data.oldestDays}d` : '—'} />
        <Stat label="Last receipt" value={data.lastReceiptAt ? formatDate(data.lastReceiptAt) : 'never'} />
      </div>

      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <span className="text-muted-foreground text-xs font-medium">Promise:</span>
        {data.overdue > 0 && (
          <button type="button" onClick={() => onPickAmount(data.overdue, `${inrFull(data.overdue)} overdue`)} className="rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50">
            Overdue {inrCompact(data.overdue)}
          </button>
        )}
        <button type="button" onClick={() => onPickAmount(data.outstanding, fullLabel)} className="rounded-lg border border-indigo-300 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">
          Full {inrCompact(data.outstanding)}
        </button>
        {data.advanceHeld > 0 && <span className="text-emerald-700 text-xs">· {inrCompact(data.advanceHeld)} advance held</span>}
        {data.invoices.length > 0 && (
          <button type="button" onClick={() => setShowInvoices((v) => !v)} className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 text-xs font-medium">
            <Receipt className="size-3.5" /> {showInvoices ? 'Hide' : `${data.invoices.length} open invoice${data.invoices.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      {showInvoices && (
        <div className="max-h-52 overflow-y-auto border-t border-indigo-200 bg-white/70 px-2.5 py-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground text-left uppercase tracking-wide">
                <th className="py-1 pr-2 font-semibold">Invoice</th>
                <th className="py-1 pr-2 font-semibold">Due</th>
                <th className="py-1 pr-2 text-right font-semibold">Balance</th>
                <th className="py-1 text-right font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((inv) => (
                <tr key={inv.code} className="border-t border-slate-100">
                  <td className="py-1 pr-2 font-mono">{inv.code}</td>
                  <td className="py-1 pr-2">
                    {inv.dueDate ? formatDate(inv.dueDate) : '—'}
                    {inv.overdueDays > 0 && <Chip tone={ageTone(inv.overdueDays)} className="ml-1">{inv.overdueDays}d</Chip>}
                  </td>
                  <td className="py-1 pr-2 text-right font-semibold tabular-nums" title={inrFull(inv.balance)}>{inrCompact(inv.balance)}</td>
                  <td className="py-1 text-right">
                    {onPickInvoice && (
                      <button type="button" onClick={() => onPickInvoice(inv.code, inv.balance)} className="text-indigo-600 hover:underline">use</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, title, tone, strong }: { label: string; value: string; title?: string; tone?: string; strong?: boolean }) {
  return (
    <div className="bg-indigo-50/40 px-3 py-2">
      <div className={cn('tabular-nums', strong ? 'text-base font-bold' : 'text-sm font-semibold', tone === 'rose' && 'text-rose-600')} title={title}>{value}</div>
      <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide">
        {label === 'Last receipt' && <CalendarClock className="size-3" />}{label}
      </div>
    </div>
  );
}
