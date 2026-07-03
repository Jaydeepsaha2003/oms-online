import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ClipboardList, ScrollText, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import type { PendingChallanLine } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePendingChallans } from './use-challans';
import { PRESETS, presetRange } from './date-presets';

const PAGE_SIZE = 50;
const num = (v: number | null) => (v ? v.toLocaleString('en-IN') : '—');

export function PendingChallanPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canCreate = can('challan:create');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [preset, setPreset] = useState('');
  const [page, setPage] = useState(1);
  // Selection preserves insertion order (= the order rows were ticked).
  const [selected, setSelected] = useState<Map<number, PendingChallanLine>>(new Map());

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize: PAGE_SIZE, search: search || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined };
  const { data, isLoading } = usePendingChallans(query);
  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const toggle = (r: PendingChallanLine) =>
    setSelected((m) => {
      const n = new Map(m);
      if (n.has(r.dispatchId)) n.delete(r.dispatchId);
      else n.set(r.dispatchId, r);
      return n;
    });

  const applyPreset = (p: string) => {
    setPreset(p);
    const r = presetRange(p);
    if (r) {
      setDateFrom(r.from);
      setDateTo(r.to);
      setPage(1);
    }
  };
  const clearAll = () => {
    setSearchInput('');
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setPreset('');
    setPage(1);
  };

  const createChallan = () => {
    const lines = [...selected.values()];
    if (lines.length === 0) return toast.error('Please select one or more rows.');
    const parties = [...new Set(lines.map((l) => l.customerName.trim()).filter(Boolean))];
    if (parties.length !== 1) {
      return toast.error(
        parties.length === 0 ? 'Selected rows are missing the customer name.' : `Select rows for the SAME customer. Found: ${parties.join(', ')}`,
      );
    }
    navigate('/challans/new', { state: { customerName: parties[0], lines } });
  };

  const columns: DataColumn<PendingChallanLine>[] = [
    {
      id: 'sel',
      label: '',
      fixed: true,
      cell: (r) => (
        <span className={cn('flex size-4 items-center justify-center rounded border transition-colors', selected.has(r.dispatchId) ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
          {selected.has(r.dispatchId) && <span className="text-[10px] leading-none">✓</span>}
        </span>
      ),
    },
    { id: 'order', label: 'Order #', sortValue: (r) => r.orderId ?? 0, cell: (r) => <span className="font-mono text-xs">{r.orderCode ?? (r.orderId != null ? `#${r.orderId}` : '—')}</span> },
    { id: 'date', label: 'D-Date', sortValue: (r) => r.dispatchDate, cell: (r) => <span className="whitespace-nowrap">{formatDate(r.dispatchDate)}</span> },
    { id: 'customer', label: 'Customer', sortValue: (r) => r.customerName, cell: (r) => <span className="font-medium">{r.customerName}</span> },
    { id: 'product', label: 'Product', sortValue: (r) => r.productName ?? '', cell: (r) => r.productName || '—' },
    { id: 'design', label: 'Design', sortValue: (r) => r.design ?? '', cell: (r) => r.design || '—' },
    { id: 'bags', label: 'Bags', align: 'right', sortValue: (r) => r.bags ?? 0, cell: (r) => <span className="tabular-nums">{num(r.bags)}</span> },
    { id: 'kgs', label: 'Kgs', align: 'right', sortValue: (r) => r.kgs ?? 0, cell: (r) => <span className="tabular-nums">{num(r.kgs)}</span> },
    { id: 'pcs', label: 'Pcs', align: 'right', sortValue: (r) => r.pcs ?? 0, cell: (r) => <span className="tabular-nums">{num(r.pcs)}</span> },
    { id: 'box', label: 'Box', align: 'right', sortValue: (r) => r.box ?? 0, cell: (r) => <span className="tabular-nums">{num(r.box)}</span> },
    { id: 'unit', label: 'Unit', sortValue: (r) => r.unit ?? '', cell: (r) => r.unit || '—' },
    { id: 'rate', label: 'Rate', align: 'right', sortValue: (r) => r.rate ?? 0, cell: (r) => <span className="tabular-nums">{num(r.rate)}</span> },
  ];

  const selectedCount = selected.size;
  const selectedParties = useMemo(() => [...new Set([...selected.values()].map((l) => l.customerName.trim()))], [selected]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <ScrollText className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Pending Challan</h2>
          <p className="text-muted-foreground text-sm">{data?.total ?? 0} dispatched line(s) awaiting a challan · tick rows for one customer, then Create Challan</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card flex flex-wrap items-end gap-2 rounded-md border p-3 shadow-sm">
        <div className="relative w-full sm:w-64">
          <Label className="text-xs">Search</Label>
          <Search className="text-muted-foreground pointer-events-none absolute top-[30px] left-3 size-4" />
          <Input className="pl-9" placeholder="Customer, product, design… (comma = multi)" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" className="w-40" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" className="w-40" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        </div>
        <div className="w-40 space-y-1">
          <Label className="text-xs">Quick range</Label>
          <NativeSelect value={preset} onChange={applyPreset} options={['', ...PRESETS]} placeholder="Range…" />
        </div>
        {(search || dateFrom || dateTo || preset) && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clearAll}>
            <X /> Clear
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {selectedCount > 0 && (
            <span className={cn('rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset', selectedParties.length === 1 ? 'bg-sky-50 text-sky-700 ring-sky-200' : 'bg-amber-50 text-amber-700 ring-amber-200')}>
              {selectedCount} selected{selectedParties.length > 1 ? ' · mixed customers' : selectedParties[0] ? ` · ${selectedParties[0]}` : ''}
            </span>
          )}
          {canCreate && (
            <Button onClick={createChallan} disabled={selectedCount === 0} title="Create a challan from the selected lines (one customer)">
              <ClipboardList /> Create Challan
            </Button>
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(r) => r.dispatchId}
        isLoading={isLoading}
        dense
        hideRowView
        emptyText="No pending challan lines — everything dispatched has been challaned."
        onRowClick={(r) => toggle(r)}
      />

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">Page {data?.page ?? page} of {totalPages}</p>
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

export default PendingChallanPage;
