import { useState } from 'react';
import { Boxes, Printer, Search } from 'lucide-react';
import type { ChallanItemHistoryRow } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { openPdf } from '@/lib/pdf';
import { usePermissions } from '@/hooks/use-permissions';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Input } from '@/components/ui/input';
import { useChallanItemNames, useChallanItemHistory } from './use-challans';

const num = (v: number | null) => (v ? v.toLocaleString('en-IN') : '—');
const money = (v: number | null) => (v ? `₹ ${v.toLocaleString('en-IN')}` : '—');

export function ChallanItemsPage() {
  const { can } = usePermissions();
  const canPrint = can('challan:print');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data: names = [], isLoading: namesLoading } = useChallanItemNames(search);
  const { data: history, isLoading: histLoading } = useChallanItemHistory(selected);
  const rows = history?.items ?? [];

  const totals = rows.reduce((a, r) => ({ qty: a.qty + (r.qty ?? 0), amt: a.amt + (r.amount ?? 0) }), { qty: 0, amt: 0 });

  const columns: DataColumn<ChallanItemHistoryRow>[] = [
    { id: 'date', label: 'Date', sortValue: (r) => r.invDate, cell: (r) => <span className="whitespace-nowrap">{formatDate(r.invDate)}</span> },
    { id: 'code', label: 'Challan No', sortValue: (r) => r.code, cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { id: 'party', label: 'Party', sortValue: (r) => r.customerName, cell: (r) => <span className="font-medium">{r.customerName}</span> },
    { id: 'design', label: 'Design', sortValue: (r) => r.design ?? '', cell: (r) => r.design || '—' },
    { id: 'qty', label: 'Qty', align: 'right', sortValue: (r) => r.qty, cell: (r) => <span className="tabular-nums">{num(r.qty)}</span> },
    { id: 'unit', label: 'Unit', cell: (r) => r.unit || '—' },
    { id: 'price', label: 'Price', align: 'right', sortValue: (r) => r.price ?? 0, cell: (r) => <span className="tabular-nums">{money(r.price)}</span> },
    { id: 'amount', label: 'Amount', align: 'right', sortValue: (r) => r.amount ?? 0, cell: (r) => <span className="tabular-nums font-semibold">{money(r.amount)}</span> },
    ...(canPrint
      ? [
          {
            id: 'actions',
            label: '',
            fixed: true,
            cell: (r: ChallanItemHistoryRow) => (
              <button onClick={() => openPdf(`/challans/${r.challanId}/challan.pdf`)} className="text-muted-foreground hover:text-foreground" title="Print challan">
                <Printer className="size-4" />
              </button>
            ),
          } as DataColumn<ChallanItemHistoryRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <Boxes className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Item-wise Challans</h2>
          <p className="text-muted-foreground text-sm">Pick a product to see every challan line it appears on</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Product sidebar */}
        <div className="bg-card flex max-h-[70vh] flex-col rounded-md border shadow-sm">
          <div className="relative border-b p-2">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2" />
            <Input className="pl-9" placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="overflow-y-auto">
            {namesLoading && <p className="text-muted-foreground p-4 text-sm">Loading…</p>}
            {!namesLoading && names.length === 0 && <p className="text-muted-foreground p-4 text-sm">No products on challans yet.</p>}
            {names.map((name) => (
              <button
                key={name}
                onClick={() => setSelected(name)}
                className={cn(
                  'block w-full truncate border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-accent',
                  selected === name && 'bg-primary/10 text-primary font-medium',
                )}
                title={name}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="space-y-3">
          {selected ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold">{selected}</h3>
                <p className="text-muted-foreground text-sm">
                  {rows.length} line(s) · Qty {num(totals.qty)} · Amount {money(totals.amt)}
                </p>
              </div>
              <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} isLoading={histLoading} dense hideRowView emptyText="No challan lines for this product." />
            </>
          ) : (
            <div className="bg-card text-muted-foreground flex h-64 items-center justify-center rounded-md border text-sm">Select a product from the left.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChallanItemsPage;
