import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, HandCoins, Landmark, Search, Wallet, Wallet2, X } from 'lucide-react';
import type { PartyAdvanceSummary } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAllAdvances } from './use-account';

/** Matches the Pending Challan / Challans / Orders grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';
const money = (v: number | null | undefined) => `₹ ${(v ?? 0).toLocaleString('en-IN')}`;
// Delegates to the shared formatter so this page follows the system-wide date format.
const prettyDate = (iso: string | null) => formatDate(iso);

/** Days between an ISO date and today (always ≥ 0 for a past date). */
function daysSince(iso: string): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - d.getTime()) / 86_400_000));
}

/**
 * Account → Party Advances. Every party (or agent) currently sitting on an
 * outstanding advance, across the whole book — the "who's paid me in advance"
 * quick-glance list. Advances are a byproduct of Receive Payment (an
 * over-payment or an explicit ADVANCE receipt parks the leftover here); this
 * page is read-only — to actually use up an advance, go allocate a receipt
 * against that party from Account → Receive Payment.
 */
export function AdvancesPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useAllAdvances();
  const [searchInput, setSearchInput] = useState('');

  const rows = data ?? [];
  const search = searchInput.trim().toLowerCase();
  const filtered = useMemo(
    () => (search ? rows.filter((r) => r.customerName.toLowerCase().includes(search)) : rows),
    [rows, search],
  );

  const totals = useMemo(
    () => ({
      bank: filtered.reduce((a, r) => a + r.bankBal, 0),
      cash: filtered.reduce((a, r) => a + r.cashBal, 0),
      total: filtered.reduce((a, r) => a + r.total, 0),
    }),
    [filtered],
  );

  const goToPayment = (r: PartyAdvanceSummary) => {
    if (r.takeAccOn === 'AGENT') navigate('/account/payment', { state: { agent: r.customerName } });
    else navigate('/account/payment', { state: { party: r.customerName } });
  };

  const columns: DataColumn<PartyAdvanceSummary>[] = [
    {
      id: 'party',
      label: 'Party / Agent',
      cell: (r) => (
        <div className="flex items-center gap-2">
          <span className={TEXT_CELL}>{r.customerName}</span>
          {r.takeAccOn === 'AGENT' && (
            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/25">AGENT</span>
          )}
        </div>
      ),
    },
    { id: 'bank', label: 'Bank', align: 'right', sortValue: (r) => r.bankBal, cell: (r) => (r.bankBal > 0 ? <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(r.bankBal)}</span> : <span className="text-muted-foreground text-[13px]">—</span>) },
    { id: 'cash', label: 'Cash', align: 'right', sortValue: (r) => r.cashBal, cell: (r) => (r.cashBal > 0 ? <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(r.cashBal)}</span> : <span className="text-muted-foreground text-[13px]">—</span>) },
    { id: 'total', label: 'Total Advance', align: 'right', sortValue: (r) => r.total, cell: (r) => <span className="text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(r.total)}</span> },
    { id: 'vouchers', label: 'Vouchers', align: 'right', sortValue: (r) => r.refCount, cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{r.refCount}</span> },
    {
      id: 'since',
      label: 'Outstanding Since',
      sortValue: (r) => r.oldestDate,
      cell: (r) => (
        <span className={cn(TEXT_CELL, 'whitespace-nowrap tabular-nums')}>
          {prettyDate(r.oldestDate)} <span className="text-muted-foreground font-medium">· {daysSince(r.oldestDate)}d</span>
        </span>
      ),
    },
  ];

  return (
    // Fills the viewport: toolbar pinned on top, only the grid scrolls.
    // `/account/advances` is a flush route (app-shell), so the page owns its own
    // padding. Read-only list — no create/edit dialog, no server pagination (the
    // whole book is fetched once via useAllAdvances and filtered client-side).
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      {/* KPI chips */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Kpi label="Total Outstanding Advance" amount={totals.total} tone="emerald" icon={Wallet2} />
        <Kpi label="Bank" amount={totals.bank} tone="blue" icon={Landmark} />
        <Kpi label="Cash" amount={totals.cash} tone="amber" icon={Wallet} />
      </div>

      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <div className="relative w-full sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search party or agent…"
              className={cn(CONTROL, 'pl-8 font-medium', searchInput && CONTROL_ON)}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          {!!searchInput && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 rounded-[4px] text-[12.5px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-400/10"
              onClick={() => setSearchInput('')}
            >
              <X className="size-3.5" /> Reset
            </Button>
          )}
          <p className="text-muted-foreground ml-auto shrink-0 text-[12px] font-medium">
            {rows.length} part{rows.length === 1 ? 'y' : 'ies'} on an unused advance
          </p>
        </div>
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          '[&_[data-slot=table-container]]:overscroll-x-contain',
          '[&_[data-slot=table-container]]:[scrollbar-width:thin]',
          '[&_[data-slot=table-container]]:[scrollbar-color:var(--color-slate-400)_var(--color-slate-100)]',
        )}
      >
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => `${r.takeAccOn}-${r.customerId ?? r.customerName}`}
          isLoading={isLoading}
          dense
          fill
          hideSortIcon
          emptyText="No party or agent has an outstanding advance right now."
          className={[
            'font-sans text-[13px]',
            '[&_tbody]:select-none',
            '[&_thead_th]:text-[13.5px] [&_thead_th]:font-extrabold [&_thead_th]:uppercase [&_thead_th]:tracking-wide [&_thead_th]:py-1.5',
            '[&_thead_th_button]:cursor-pointer',
            '[&_thead_th:hover]:from-blue-900 [&_thead_th:hover]:to-indigo-900',
            '[&_td]:py-1 [&_td]:px-3 [&_th]:px-3',
            '[&_tbody_button:not([role=switch]):not([role=checkbox])]:size-7',
            '[&_tbody_tr]:border-b [&_tbody_tr]:border-slate-200 dark:[&_tbody_tr]:border-white/10',
            '[&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0',
            '[&_tbody_tr:nth-child(even)_td]:bg-slate-100/80 dark:[&_tbody_tr:nth-child(even)_td]:bg-white/[0.04]',
            '[&_tbody_tr:hover:hover_td]:bg-amber-100/70 dark:[&_tbody_tr:hover:hover_td]:bg-amber-400/10',
          ].join(' ')}
          actions={(r) => (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="border-emerald-200 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-400/30 dark:text-emerald-300 dark:hover:bg-emerald-400/10"
                  onClick={() => goToPayment(r)}
                  aria-label={`Allocate advance for ${r.customerName}`}
                >
                  <HandCoins className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Go to payment</TooltipContent>
            </Tooltip>
          )}
          mobileCard={(r) => (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate leading-tight font-medium">{r.customerName}</p>
                    {r.takeAccOn === 'AGENT' && (
                      <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/25">AGENT</span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Since {prettyDate(r.oldestDate)} · {daysSince(r.oldestDate)}d · {r.refCount} voucher{r.refCount === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{money(r.total)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Bank</p>
                  <p className="font-medium tabular-nums">{r.bankBal > 0 ? money(r.bankBal) : '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cash</p>
                  <p className="font-medium tabular-nums">{r.cashBal > 0 ? money(r.cashBal) : '—'}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="w-full" onClick={() => goToPayment(r)}>
                Go to Payment <ArrowRight className="size-3.5" />
              </Button>
            </div>
          )}
        />
      </div>
    </div>
  );
}

function Kpi({
  label,
  amount,
  tone,
  icon: Icon,
}: {
  label: string;
  amount: number;
  tone: 'blue' | 'amber' | 'emerald';
  icon: typeof Wallet;
}) {
  const toneCls = {
    blue: 'border-blue-200 bg-blue-50/60 text-blue-700',
    amber: 'border-amber-200 bg-amber-50/60 text-amber-700',
    emerald: 'border-emerald-200 bg-emerald-50/60 text-emerald-700',
  }[tone];
  return (
    <div className={cn('flex items-center gap-3 rounded-lg border p-3 shadow-sm', toneCls)}>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/70">
        <Icon className="size-4.5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-wide uppercase opacity-80">{label}</p>
        <p className="mt-0.5 text-xl font-bold tabular-nums">{money(amount)}</p>
      </div>
    </div>
  );
}

export default AdvancesPage;
