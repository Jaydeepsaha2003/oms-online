import { useMemo, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import { basisUnit, type AgentCommissionAccrualDto } from '@oms/shared';
import { cn } from '@/lib/utils';
import { useDateFormat } from '@/lib/date-format';
import { usePageSize } from '@/hooks/use-page-size';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAgents } from '@/features/agents/use-agents';
import { useOrderLookups } from '@/features/orders/use-orders';
import { useCommissionAccruals } from './use-agent-commission';

const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const TH = 'bg-gradient-to-b from-blue-800 to-indigo-800 px-2 py-1.5 text-[11px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap';
const TD = 'px-2 py-1 text-[12.5px]';

/**
 * The states a ledger row can be in.
 *
 * "Fully claimed" and "Party has not paid" are both "nothing claimable", and
 * separating them is the point: the first is settled business, the second is
 * money still to be collected, and one heading over both is what makes people
 * think commission has gone missing.
 */
const STATES = [
  { value: 'CLAIMABLE', label: 'Still claimable' },
  { value: 'CLAIMED', label: 'Fully claimed' },
  { value: 'UNPAID', label: 'Party has not paid' },
  { value: 'ALL', label: 'Everything' },
] as const;

/**
 * Agent → Commission Ledger
 * -------------------------
 * Every invoice that earned an agent commission, and exactly where it stands:
 * what it accrued, how much the party has paid, how much has already been
 * settled, and what is claimable right now.
 *
 * The Settlement screen shows only the claimable slice for one agent over one
 * period, which cannot answer the questions that come up in an argument — "why
 * is this invoice not on my statement?" — because the row it needs to show is
 * precisely the one that screen filters out. This is the whole book.
 *
 * Read-only. Nothing here is typed: every figure is derived from the invoice, the
 * receipts against it and the settlements that claimed it. The way to change a
 * number here is to fix the rate on Commission Rates — saving it re-prices the
 * invoices it reaches, so this screen follows on its own.
 */
export function CommissionLedgerPage() {
  const { formatDate } = useDateFormat();
  const { page, setPage, pageSize, setPageSize } = usePageSize('commission-ledger');

  const { data: agents } = useAgents({ page: 1, pageSize: 500 });
  const { data: lookups } = useOrderLookups();
  const [agentName, setAgentName] = useState('');
  const agentId = useMemo(() => (agents?.items ?? []).find((a) => a.name === agentName)?.id, [agents, agentName]);
  const [pCategory, setPCategory] = useState('');
  const [settledState, setSettledState] = useState<string>('CLAIMABLE');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const it of lookups?.items ?? []) if (it.category) s.add(it.category.toUpperCase());
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [lookups]);

  const { data, isLoading, isFetching } = useCommissionAccruals({
    agentId,
    pCategory: pCategory || undefined,
    settledState,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    pageSize,
  });

  const rows = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const hasFilters = !!(agentName || pCategory || dateFrom || dateTo || settledState !== 'CLAIMABLE');
  const reset = () => {
    setAgentName('');
    setPCategory('');
    setSettledState('CLAIMABLE');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  // Page totals, so the figures can be sanity-checked without a calculator.
  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          accrued: a.accrued + r.amount,
          earned: a.earned + r.earnedAmount,
          settled: a.settled + r.settledAmount,
          claimable: a.claimable + claimableAmount(r),
        }),
        { accrued: 0, earned: 0, settled: 0, claimable: 0 },
      ),
    [rows],
  );

  return (
    <div className="space-y-3 p-2.5 font-sans sm:p-3">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="bg-gradient-brand flex size-9 items-center justify-center rounded-[4px] text-white shadow-md shadow-blue-600/20 ring-1 ring-white/20">
          <BookOpen className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-[17px] leading-tight font-bold tracking-tight">Commission Ledger</h2>
          <p className="text-muted-foreground truncate text-[11.5px] font-medium">
            Every invoice that earned commission, and where it stands
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-muted-foreground rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums dark:bg-white/10">
            {data?.total ?? 0}
          </span>
          {isFetching && <Loader2 className="text-muted-foreground size-3.5 animate-spin" />}
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="bg-card grid grid-cols-2 items-end gap-2 rounded-[4px] border p-2.5 shadow-sm sm:flex sm:flex-wrap sm:gap-3">
        <div className="col-span-2 w-full min-w-0 space-y-1 sm:w-56">
          <Label className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">Agent</Label>
          <NativeSelect
            value={agentName}
            onChange={change(setAgentName)}
            options={['', ...(agents?.items ?? []).map((a) => a.name)]}
            placeholder="All agents"
          />
        </div>
        <div className="w-full min-w-0 space-y-1 sm:w-44">
          <Label className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">Category</Label>
          <NativeSelect value={pCategory} onChange={change(setPCategory)} options={['', ...categories]} placeholder="All categories" />
        </div>
        <div className="w-full min-w-0 space-y-1 sm:w-44">
          <Label className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">Show</Label>
          {/* Defaults to "Still claimable" — the state anyone opening this screen
              is almost always asking about. */}
          <NativeSelect
            value={settledState}
            onChange={change(setSettledState)}
            options={STATES.map((s) => ({ value: s.value, label: s.label }))}
          />
        </div>
        <div className="col-span-2 flex w-full items-center gap-1.5 sm:w-auto">
          <span className="text-muted-foreground shrink-0 text-[11px] font-bold tracking-wide uppercase">Invoiced</span>
          <Input
            type="date"
            className="h-9 min-w-0 flex-1 tabular-nums sm:w-36 sm:flex-none"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => change(setDateFrom)(e.target.value)}
          />
          <span className="text-muted-foreground shrink-0 text-[11px]">to</span>
          <Input
            type="date"
            className="h-9 min-w-0 flex-1 tabular-nums sm:w-36 sm:flex-none"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => change(setDateTo)(e.target.value)}
          />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="col-span-2 h-9 w-full sm:w-auto" onClick={reset}>
            <RotateCcw /> Reset
          </Button>
        )}
      </div>

      {/* ── Desktop table ───────────────────────────────────────────────────── */}
      <div className="bg-card hidden max-h-[min(70vh,44rem)] overflow-auto rounded-[4px] border shadow-sm sm:block">
        <table className="w-full min-w-[62rem] border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={TH}>Invoice</th>
              <th className={TH}>Date</th>
              <th className={TH}>Agent</th>
              <th className={TH}>Party</th>
              <th className={TH}>Category</th>
              <th className={cn(TH, 'text-right')}>Qty</th>
              <th className={cn(TH, 'text-right')}>Rate</th>
              <th className={cn(TH, 'text-right')}>Accrued</th>
              <th className={cn(TH, 'text-right')}>Collected</th>
              <th className={cn(TH, 'text-right')}>Earned</th>
              <th className={cn(TH, 'text-right')}>Already paid</th>
              <th className={cn(TH, 'text-right')}>Claimable</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={12} className="py-10 text-center">
                  <Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" />
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={12} className="p-0">
                  <EmptyState filtered={hasFilters} />
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className={cn('border-b', r.settled && 'bg-slate-50/70 dark:bg-white/[0.03]')}>
                  <td className={cn(TD, 'font-mono font-bold whitespace-nowrap')}>{r.invNo}</td>
                  <td className={cn(TD, 'whitespace-nowrap tabular-nums')}>{formatDate(r.invDate)}</td>
                  <td className={cn(TD, 'font-medium')}>{r.agentName}</td>
                  <td className={cn(TD, 'font-semibold')}>{r.customerName}</td>
                  <td className={TD}>{r.pCategory}</td>
                  <td className={cn(TD, 'text-right tabular-nums')}>
                    {r.qty.toLocaleString('en-IN')}
                    <span className="text-muted-foreground ml-0.5 text-[10px]">{basisUnit(r.basis)}</span>
                  </td>
                  <td className={cn(TD, 'text-right tabular-nums')}>
                    ₹{r.ratePerUnit}
                    {/* Which rule set it. Only when it was NOT the plain base
                        rate — printing "Base rate" on every row would bury the
                        handful priced by a special, which are the ones anyone
                        querying a figure is actually asking about. */}
                    {r.rateNote && r.rateNote !== 'Base rate' && (
                      <span className="block text-[9.5px] font-semibold text-indigo-700 dark:text-indigo-300">{r.rateNote}</span>
                    )}
                  </td>
                  <td className={cn(TD, 'text-right tabular-nums')}>{inr(r.amount)}</td>
                  <td className={cn(TD, 'text-right tabular-nums')}>
                    <CollectedCell row={r} />
                  </td>
                  <td className={cn(TD, 'text-right tabular-nums')}>{inr(r.earnedAmount)}</td>
                  <td className={cn(TD, 'text-right tabular-nums')}>{r.settledAmount ? inr(r.settledAmount) : '—'}</td>
                  <td className={cn(TD, 'text-right font-bold tabular-nums')}>
                    <ClaimableCell row={r} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="[&_td]:sticky [&_td]:bottom-0 [&_td]:border-t-2 [&_td]:border-slate-300 [&_td]:bg-slate-100 [&_td]:px-2 [&_td]:py-1.5 [&_td]:font-bold dark:[&_td]:border-white/20 dark:[&_td]:bg-slate-800">
                <td colSpan={7} className="text-[11px] tracking-wide uppercase">
                  Page total
                </td>
                <td className="text-right tabular-nums">{inr(totals.accrued)}</td>
                <td />
                <td className="text-right tabular-nums">{inr(totals.earned)}</td>
                <td className="text-right tabular-nums">{inr(totals.settled)}</td>
                <td className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{inr(totals.claimable)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Phones: one card per invoice ────────────────────────────────────── */}
      <div className="sm:hidden">
        {isLoading ? (
          <div className="text-muted-foreground flex h-24 items-center justify-center rounded-2xl border">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : !rows.length ? (
          <div className="rounded-2xl border">
            <EmptyState filtered={hasFilters} />
          </div>
        ) : (
          <div className="space-y-2.5">
            {rows.map((r) => {
              const claim = claimableAmount(r);
              return (
                <div key={r.id} className="bg-card relative overflow-hidden rounded-2xl border shadow-sm ring-1 ring-black/[0.02]">
                  <span
                    className={cn('absolute inset-y-0 left-0 w-1.5', claim > 0.005 ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-white/15')}
                    aria-hidden
                  />
                  <div className="space-y-2 py-2.5 pr-3 pl-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-[13px] font-bold">{r.invNo}</p>
                        <p className="text-[13.5px] leading-tight font-extrabold break-words">{r.customerName}</p>
                      </div>
                      <span className="text-muted-foreground shrink-0 text-[11px] font-semibold tabular-nums">
                        {formatDate(r.invDate)}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-[11.5px] font-medium">
                      {r.agentName} · {r.pCategory} · {r.qty.toLocaleString('en-IN')}
                      {basisUnit(r.basis)} × ₹{r.ratePerUnit}
                    </p>
                    {r.rateNote && r.rateNote !== 'Base rate' && (
                      <p className="text-[10.5px] font-semibold text-indigo-700 dark:text-indigo-300">{r.rateNote}</p>
                    )}
                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-white/[0.04]">
                      <Metric label="Accrued" value={inr(r.amount)} />
                      <Metric label="Earned" value={inr(r.earnedAmount)} />
                      <Metric label="Paid" value={r.settledAmount ? inr(r.settledAmount) : '—'} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px]">
                        <CollectedCell row={r} />
                      </span>
                      <span className="text-[15px] font-extrabold tabular-nums">
                        <ClaimableCell row={r} />
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {rows.length > 0 && (
          <div className="bg-card mt-2.5 space-y-1 rounded-xl border px-2.5 py-1.5 shadow-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              {(
                [
                  ['Accrued', inr(totals.accrued)],
                  ['Earned', inr(totals.earned)],
                  ['Paid', inr(totals.settled)],
                  ['Claimable', inr(totals.claimable)],
                ] as const
              ).map(([label, value]) => (
                <span key={label} className="flex items-baseline gap-1">
                  <span className="text-muted-foreground text-[9px] font-bold tracking-widest uppercase">{label}</span>
                  <span className="text-[12px] font-bold tabular-nums">{value}</span>
                </span>
              ))}
            </div>
            <Pager page={data?.page ?? page} totalPages={totalPages} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="bg-card hidden rounded-[4px] border px-2.5 py-1.5 shadow-sm sm:block">
          <Pager page={data?.page ?? page} totalPages={totalPages} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
        </div>
      )}

      <p className="text-muted-foreground text-[11px]">
        Commission is earned in proportion to what the party has actually paid — <span className="font-semibold">Earned</span> is
        the accrual × collected share, and <span className="font-semibold">Claimable</span> is what is left after the
        settlements that already claimed it. A row can become claimable again when the party pays more.
      </p>
    </div>
  );
}

/**
 * What this invoice could go on a settlement for right now.
 *
 * Derived from `payableRatio`, which the server calculates as collected-minus-
 * already-settled — never from `earnedAmount − settledAmount`, which drifts the
 * moment a settlement paid a rate the owner had cut.
 */
const claimableAmount = (r: AgentCommissionAccrualDto): number => Math.round(r.amount * r.payableRatio * 100) / 100;

function CollectedCell({ row: r }: { row: AgentCommissionAccrualDto }) {
  const full = r.paidRatio >= 0.999;
  return (
    <>
      <span className={cn('font-semibold', full ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>
        {(r.paidRatio * 100).toFixed(0)}%
      </span>
      <span className="text-muted-foreground ml-1 text-[11px]">{inr(r.paidAmount)}</span>
      {/* Only when it IS late. A negative "days overdue" is within terms and
          means nothing to the reader. */}
      {(r.overdueDays ?? 0) > 0 && <span className="ml-1 text-[10px] font-bold text-rose-600">{r.overdueDays}d late</span>}
    </>
  );
}

function ClaimableCell({ row: r }: { row: AgentCommissionAccrualDto }) {
  const claim = claimableAmount(r);
  if (claim > 0.005) {
    return <span className="text-emerald-700 dark:text-emerald-400">{inr(claim)}</span>;
  }
  // Nothing claimable has two very different causes, and conflating them is what
  // makes people think commission has gone missing.
  return (
    <span className="text-muted-foreground text-[11px] font-medium">
      {r.settledRatio > 0.001 ? 'fully claimed' : 'party has not paid'}
    </span>
  );
}

/** Why the ledger is empty — the two real causes, not a shrug. */
function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-muted-foreground text-[13px] font-medium">
        {filtered ? 'No invoices match these filters.' : 'No commission has accrued yet.'}
      </p>
      {!filtered && (
        <div className="mx-auto mt-3 flex max-w-xl items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left text-[12px] text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            An invoice only earns commission when a rate exists for that agent and product category. Set the rates in{' '}
            <span className="font-semibold">Agent → Commission Rates</span> — saving one prices every invoice it reaches
            straight away, including invoices raised before the rate existed, so this list fills in by itself.
          </span>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-[9px] font-bold tracking-widest uppercase">{label}</p>
      <p className="text-[13px] font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Pager({
  page,
  totalPages,
  setPage,
  pageSize,
  setPageSize,
}: {
  page: number;
  totalPages: number;
  setPage: (fn: (p: number) => number) => void;
  pageSize: number;
  setPageSize: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-[11.5px] font-medium">
        Page <span className="text-foreground font-bold tabular-nums">{page}</span> of{' '}
        <span className="text-foreground font-bold tabular-nums">{totalPages}</span>
      </span>
      <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
        <PageSizeSelect value={pageSize} onChange={setPageSize} hideLabel />
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="size-8 rounded-[4px]"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8 rounded-[4px]"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default CommissionLedgerPage;
