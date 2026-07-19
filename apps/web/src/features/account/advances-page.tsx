import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Landmark, Search, Wallet, Wallet2 } from 'lucide-react';
import type { PartyAdvanceSummary } from '@oms/shared';
import { cn } from '@/lib/utils';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAllAdvances } from './use-account';

const money = (v: number | null | undefined) => `₹ ${(v ?? 0).toLocaleString('en-IN')}`;
const prettyDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

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
          <span className="font-medium">{r.customerName}</span>
          {r.takeAccOn === 'AGENT' && (
            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200">AGENT</span>
          )}
        </div>
      ),
    },
    { id: 'bank', label: 'Bank', align: 'right', sortValue: (r) => r.bankBal, cell: (r) => (r.bankBal > 0 ? <span className="tabular-nums">{money(r.bankBal)}</span> : <span className="text-muted-foreground">—</span>) },
    { id: 'cash', label: 'Cash', align: 'right', sortValue: (r) => r.cashBal, cell: (r) => (r.cashBal > 0 ? <span className="tabular-nums">{money(r.cashBal)}</span> : <span className="text-muted-foreground">—</span>) },
    { id: 'total', label: 'Total Advance', align: 'right', sortValue: (r) => r.total, cell: (r) => <span className="text-[17px] font-bold tabular-nums text-emerald-700">{money(r.total)}</span> },
    { id: 'vouchers', label: 'Vouchers', align: 'right', sortValue: (r) => r.refCount, cell: (r) => <span className="tabular-nums">{r.refCount}</span> },
    {
      id: 'since',
      label: 'Outstanding Since',
      sortValue: (r) => r.oldestDate,
      cell: (r) => (
        <span className="whitespace-nowrap">
          {prettyDate(r.oldestDate)} <span className="text-muted-foreground">· {daysSince(r.oldestDate)}d</span>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <Wallet className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Party Advances</h2>
          <p className="text-muted-foreground text-sm">
            {rows.length} part{rows.length === 1 ? 'y' : 'ies'} currently sitting on an unused advance — money already received, not yet applied to an invoice.
          </p>
        </div>
      </div>

      {/* KPI chips */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Kpi label="Total Outstanding Advance" amount={totals.total} tone="emerald" icon={Wallet2} />
        <Kpi label="Bank" amount={totals.bank} tone="blue" icon={Landmark} />
        <Kpi label="Cash" amount={totals.cash} tone="amber" icon={Wallet} />
      </div>

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input placeholder="Search party or agent…" className="pl-9" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => `${r.takeAccOn}-${r.customerId ?? r.customerName}`}
        isLoading={isLoading}
        emptyText="No party or agent has an outstanding advance right now."
        actions={(r) => (
          <Button variant="outline" size="sm" onClick={() => goToPayment(r)} title="Allocate this advance from Receive Payment">
            Go to Payment <ArrowRight className="size-3.5" />
          </Button>
        )}
        mobileCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate leading-tight font-medium">{r.customerName}</p>
                  {r.takeAccOn === 'AGENT' && (
                    <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200">AGENT</span>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  Since {prettyDate(r.oldestDate)} · {daysSince(r.oldestDate)}d · {r.refCount} voucher{r.refCount === 1 ? '' : 's'}
                </p>
              </div>
              <span className="shrink-0 font-semibold tabular-nums text-emerald-700">{money(r.total)}</span>
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
