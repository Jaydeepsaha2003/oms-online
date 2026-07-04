import { useState } from 'react';
import { ChevronLeft, ChevronRight, History, Search, TrendingDown, TrendingUp } from 'lucide-react';
import type { RateChangeEntry, RateHistoryKind } from '@oms/shared';
import { formatDateTime } from '@/lib/utils';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/common/combo';
import { usePriceHistory } from './use-bookings';

const PAGE_SIZE = 50;

const KIND_STYLE: Record<RateHistoryKind, string> = {
  PRODUCT: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  DESIGN: 'bg-violet-50 text-violet-700 ring-violet-200',
  CUSTOMER: 'bg-sky-50 text-sky-700 ring-sky-200',
};
const KIND_LABEL: Record<RateHistoryKind, string> = { PRODUCT: 'Product', DESIGN: 'Design', CUSTOMER: 'Special rate' };
const rateStr = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-IN'));

const COLUMNS: DataColumn<RateChangeEntry>[] = [
  {
    id: 'kind',
    label: 'Type',
    fixed: true,
    cell: (r) => <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ${KIND_STYLE[r.kind]}`}>{KIND_LABEL[r.kind]}</span>,
  },
  {
    id: 'name',
    label: 'Item / Customer',
    cell: (r) => (
      <div className="min-w-0">
        <div className="truncate font-medium">{r.name}</div>
        <div className="text-muted-foreground truncate text-xs">
          {[r.category, r.subCategory].filter(Boolean).join(' · ')}
          {r.kind === 'CUSTOMER' && r.rateKind ? ` · ${r.rateKind}${r.target ? ` · ${r.target}` : ''} (${(r.scope ?? '').toLowerCase()})` : ''}
        </div>
      </div>
    ),
  },
  { id: 'old', label: 'Old ₹', align: 'right', cell: (r) => <span className="tabular-nums text-muted-foreground">{rateStr(r.oldRate)}</span> },
  {
    id: 'new',
    label: 'New ₹',
    align: 'right',
    cell: (r) => {
      const up = (r.newRate ?? 0) > (r.oldRate ?? 0);
      const down = (r.newRate ?? 0) < (r.oldRate ?? 0);
      return (
        <span className={`inline-flex items-center justify-end gap-1 font-semibold tabular-nums ${up ? 'text-rose-600' : down ? 'text-emerald-600' : ''}`}>
          {up && <TrendingUp className="size-3.5" />}
          {down && <TrendingDown className="size-3.5" />}
          {rateStr(r.newRate)}
        </span>
      );
    },
  },
  { id: 'by', label: 'Changed by', cell: (r) => r.changedByName ?? '—' },
  {
    id: 'when',
    label: 'When',
    cell: (r) => <span className="text-muted-foreground whitespace-nowrap font-mono text-xs">{formatDateTime(r.changedAt)}</span>,
  },
];

export function PriceHistoryPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePriceHistory({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    kind: (kind || undefined) as RateHistoryKind | undefined,
  });

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <History className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Price History</h2>
          <p className="text-muted-foreground text-sm">Every product, design &amp; special-rate change — the audit trail behind booking-date pricing.</p>
        </div>
      </div>

      <div className="bg-background/85 sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-md px-1 py-1.5 backdrop-blur">
        <div className="relative w-full sm:w-80">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search item, customer or category…"
            className="pl-9"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setSearch(e.target.value.trim());
              setPage(1);
            }}
          />
        </div>
        <div className="w-52">
          <NativeSelect
            value={kind}
            onChange={(v) => { setKind(v); setPage(1); }}
            options={['', 'PRODUCT', 'DESIGN', 'CUSTOMER']}
            placeholder="All types"
            renderOption={(v) => (v ? KIND_LABEL[v as RateHistoryKind] : 'All types')}
          />
        </div>
      </div>

      <DataTable
        columns={COLUMNS}
        rows={items}
        rowKey={(r) => `${r.kind}-${r.id}`}
        isLoading={isLoading}
        emptyText="No price changes recorded yet."
      />

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {data?.total ?? 0} change(s) · page {data?.page ?? page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <ChevronLeft /> Prev
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default PriceHistoryPage;
