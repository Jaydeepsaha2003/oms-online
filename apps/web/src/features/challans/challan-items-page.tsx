import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, Layers, Printer, Search, Wallet, X } from 'lucide-react';
import type { ChallanItemHistoryRow } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useChallanItemNames, useChallanItemHistory } from './use-challans';

const num = (v: number | null) => (v ? v.toLocaleString('en-IN') : '—');
const money = (v: number | null) => (v ? `₹ ${v.toLocaleString('en-IN')}` : '—');

/** Matches the other challan grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other challan screens. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

export function ChallanItemsPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canPrint = can('challan:print');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data: names = [], isLoading: namesLoading } = useChallanItemNames(search);
  const { data: history, isLoading: histLoading } = useChallanItemHistory(selected);
  const rows = history?.items ?? [];

  const totals = rows.reduce((a, r) => ({ qty: a.qty + (r.qty ?? 0), amt: a.amt + (r.amount ?? 0) }), { qty: 0, amt: 0 });

  const columns: DataColumn<ChallanItemHistoryRow>[] = [
    { id: 'date', label: 'Date', sortValue: (r) => r.invDate, cell: (r) => <span className={cn(TEXT_CELL, 'whitespace-nowrap tabular-nums')}>{formatDate(r.invDate)}</span> },
    { id: 'code', label: 'Challan No', sortValue: (r) => r.code, cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums text-indigo-700 dark:text-indigo-300')}>{r.code}</span> },
    { id: 'party', label: 'Party', sortValue: (r) => r.customerName, cell: (r) => <span className={TEXT_CELL}>{r.customerName}</span> },
    { id: 'design', label: 'Design', sortValue: (r) => r.design ?? '', cell: (r) => <span className={TEXT_CELL}>{r.design || '—'}</span> },
    { id: 'qty', label: 'Qty', align: 'right', sortValue: (r) => r.qty, cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{num(r.qty)}</span> },
    { id: 'unit', label: 'Unit', cell: (r) => <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{r.unit || '—'}</span> },
    { id: 'price', label: 'Price', align: 'right', sortValue: (r) => r.price ?? 0, cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(r.price)}</span> },
    { id: 'amount', label: 'Amount', align: 'right', sortValue: (r) => r.amount ?? 0, cell: (r) => <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(r.amount)}</span> },
    ...(canPrint
      ? [
          {
            id: 'actions',
            label: '',
            fixed: true,
            noSort: true,
            cell: (r: ChallanItemHistoryRow) => (
              <button
                onClick={() => navigate(`/challans/${r.challanId}/bill`)}
                className="cursor-pointer rounded-[4px] p-1 text-slate-400 transition-colors hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-400/10"
                title="Print challan"
              >
                <Printer className="size-4" />
              </button>
            ),
          } as DataColumn<ChallanItemHistoryRow>,
        ]
      : []),
  ];

  // Phones: one card per challan line (mirrors the rest of the Challans mobile lists).
  const itemMobileCard = (r: ChallanItemHistoryRow) => (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{r.code}</p>
          <p className="truncate text-[14px] leading-tight font-bold text-slate-900 dark:text-slate-100">{r.customerName}</p>
          <p className="text-muted-foreground truncate text-[11px] font-medium">{formatDate(r.invDate)}{r.design ? ` · ${r.design}` : ''}</p>
        </div>
        {canPrint && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/challans/${r.challanId}/bill`);
            }}
            aria-label="Print challan"
          >
            <Printer className="size-4" />
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between text-[12px] font-medium">
        <span className="text-muted-foreground">{num(r.qty)} {r.unit || ''} @ {money(r.price)}</span>
        <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(r.amount)}</span>
      </div>
    </div>
  );

  return (
    // Fills the viewport: no separate page header (the topbar already shows
    // "Item-wise"), so the two panels get the whole height. `/challans/items` is a
    // flush route (app-shell), so the page owns its own padding.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      <div className="grid min-h-0 flex-1 gap-2 sm:gap-2.5 lg:grid-cols-[280px_1fr]">
        {/* Product sidebar — desktop/tablet: an always-visible searchable list panel,
            filling the column's full height. */}
        <div className="bg-card font-poppins hidden min-h-0 flex-col rounded-[4px] border shadow-sm sm:flex">
          <div className="relative border-b p-2">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2" />
            <Input
              className={cn(CONTROL, 'pl-8 font-medium', search && CONTROL_ON)}
              placeholder="Search products…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {namesLoading && <p className="text-muted-foreground p-4 text-[12.5px]">Loading…</p>}
            {!namesLoading && names.length === 0 && <p className="text-muted-foreground p-4 text-[12.5px]">No products on challans yet.</p>}
            {names.map((name) => (
              <button
                key={name}
                onClick={() => setSelected(name)}
                className={cn(
                  'block w-full cursor-pointer truncate border-b border-slate-100 px-3 py-1.5 text-left text-[13px] font-semibold text-slate-700 last:border-0 hover:bg-amber-50/60 dark:border-white/5 dark:text-slate-300 dark:hover:bg-amber-400/10',
                  selected === name && 'bg-primary/10 text-primary dark:bg-primary/15',
                )}
                title={name}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Phones: pick the product from a searchable dropdown instead of a
            separate scrolling list panel — type to filter, tap to pick. */}
        <div className="sm:hidden">
          <NativeSelect
            value={selected ?? ''}
            onChange={setSelected}
            onType={setSearch}
            options={names}
            placeholder={namesLoading ? 'Loading…' : 'Search products…'}
            className={cn(CONTROL, 'h-10 font-medium', selected && CONTROL_ON)}
          />
        </div>

        {/* Detail */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 sm:gap-2.5">
          {selected ? (
            <>
              {/* Selected product + a compact stat strip (lines / qty / amount). */}
              <div className="bg-card flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[4px] border px-3 py-2 shadow-sm">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Boxes className="text-primary size-4 shrink-0" />
                  <h3 className="truncate text-[14px] font-bold text-slate-900 dark:text-slate-100">{selected}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-[11.5px] font-semibold transition-colors"
                  title="Clear selection"
                >
                  <X className="size-3" /> Clear
                </button>
                <div className="ml-auto flex items-center gap-3">
                  <span className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground">
                    <Layers className="size-3.5" /> <span className="font-bold tabular-nums text-foreground">{rows.length}</span> line(s)
                  </span>
                  <span className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground">
                    Qty <span className="font-bold tabular-nums text-foreground">{num(totals.qty)}</span>
                  </span>
                  <span className="flex items-center gap-1 text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
                    <Wallet className="size-3.5" /> {money(totals.amt)}
                  </span>
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
                  rows={rows}
                  rowKey={(r) => r.id}
                  isLoading={histLoading}
                  dense
                  fill
                  hideRowView
                  hideSortIcon
                  mobileCard={itemMobileCard}
                  emptyText="No challan lines for this product."
                  className={[
                    'font-sans text-[13px]',
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
                />
              </div>
            </>
          ) : (
            <div className="bg-card text-muted-foreground flex flex-1 items-center justify-center rounded-[4px] border text-[13px] font-medium">
              <span className="flex items-center gap-2">
                <Boxes className="size-5 opacity-40" /> Select a product to see its history.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChallanItemsPage;
