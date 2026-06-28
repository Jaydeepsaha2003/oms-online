import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, ChevronRight, Pencil, Printer, ScrollText, Search, Trash2, X, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { ChallanDto } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { openPdf } from '@/lib/pdf';
import { usePermissions } from '@/hooks/use-permissions';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChallans, useChallanSummary, useDeleteChallan, useUpdateChallanStatus } from './use-challans';
import { PRESETS, presetRange } from './date-presets';

const PAGE_SIZE = 50;
const money = (v: number | null) => `₹ ${(v ?? 0).toLocaleString('en-IN')}`;

/** Days-to-due text from the due date (the legacy PAID state needs the accounting
 *  module, so this shows only DUE / OVER DUE relative to today). */
function dueInfo(due: string | null): { text: string; over: boolean } {
  if (!due) return { text: '—', over: false };
  const d = new Date(due);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { text: `${Math.abs(days)} over`, over: true };
  return { text: `${days} left`, over: false };
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-md border p-3 shadow-sm">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function ChallansListPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canUpdate = can('challan:update');
  const canDelete = can('challan:delete');
  const canPrint = can('challan:print');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [preset, setPreset] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    status: status || undefined,
  };
  const { data, isLoading } = useChallans(query);
  const { data: summary } = useChallanSummary(query);
  const updateStatus = useUpdateChallanStatus();
  const del = useDeleteChallan();

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

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
    setStatus('');
    setPage(1);
  };

  const setRowStatus = (c: ChallanDto, next: 'CONFIRMED' | 'CANCELLED') =>
    updateStatus.mutate(
      { id: c.id, challanStatus: next },
      { onSuccess: () => toast.success(`${c.code} marked ${next}`), onError: () => toast.error('Failed to update status') },
    );
  const remove = (c: ChallanDto) => {
    if (!window.confirm(`Delete challan ${c.code}? This frees its dispatches back to Pending and cannot be undone.`)) return;
    del.mutate(c.id, { onSuccess: () => toast.success(`${c.code} deleted`), onError: () => toast.error('Failed to delete') });
  };

  const columns: DataColumn<ChallanDto>[] = useMemo(
    () => [
      { id: 'date', label: 'Date', sortValue: (r) => r.invDate, cell: (r) => <span className="whitespace-nowrap">{formatDate(r.invDate)}</span> },
      { id: 'code', label: 'Challan No', sortValue: (r) => r.code, cell: (r) => <span className="font-mono text-xs font-medium">{r.code}</span> },
      { id: 'party', label: 'Party', sortValue: (r) => r.customerName, cell: (r) => <span className="font-medium">{r.customerName}</span> },
      { id: 'total', label: 'Total', align: 'right', sortValue: (r) => r.total ?? 0, cell: (r) => <span className="tabular-nums font-semibold">{money(r.total)}</span> },
      { id: 'b', label: 'B', align: 'right', sortValue: (r) => r.b ?? 0, cell: (r) => <span className="tabular-nums">{money(r.b)}</span> },
      { id: 'c', label: 'C', align: 'right', sortValue: (r) => r.c ?? 0, cell: (r) => <span className="tabular-nums">{money(r.c)}</span> },
      { id: 'gst', label: 'GST', align: 'right', sortValue: (r) => r.tax ?? 0, cell: (r) => <span className="tabular-nums">{money(r.tax)}</span> },
      {
        id: 'tds',
        label: 'TDS',
        align: 'right',
        sortValue: (r) => r.tds ?? 0,
        cell: (r) => (r.tds ? <span className="tabular-nums text-amber-700">{money(r.tds)}</span> : <span className="text-muted-foreground">—</span>),
      },
      {
        id: 'due',
        label: 'Due',
        cell: (r) => {
          const di = dueInfo(r.dueDate);
          return <span className={cn('text-xs', di.over && 'font-semibold text-red-600')}>{di.text}</span>;
        },
      },
      {
        id: 'status',
        label: 'Status',
        sortValue: (r) => r.challanStatus,
        cell: (r) => (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
              r.challanStatus === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200',
            )}
          >
            {r.challanStatus}
          </span>
        ),
      },
      {
        id: 'actions',
        label: '',
        fixed: true,
        cell: (r) => (
          <div className="flex items-center justify-end gap-1.5">
            {canPrint && (
              <button onClick={() => openPdf(`/challans/${r.id}/challan.pdf`)} className="text-muted-foreground hover:text-foreground" title="Print / PDF">
                <Printer className="size-4" />
              </button>
            )}
            {canUpdate && (
              <button onClick={() => navigate(`/challans/${r.id}/edit`)} className="text-muted-foreground hover:text-foreground" title="Edit">
                <Pencil className="size-4" />
              </button>
            )}
            {canUpdate &&
              (r.challanStatus === 'CONFIRMED' ? (
                <button onClick={() => setRowStatus(r, 'CANCELLED')} className="text-muted-foreground hover:text-rose-600" title="Mark Cancelled">
                  <XCircle className="size-4" />
                </button>
              ) : (
                <button onClick={() => setRowStatus(r, 'CONFIRMED')} className="text-muted-foreground hover:text-emerald-600" title="Mark Confirmed">
                  <CheckCircle2 className="size-4" />
                </button>
              ))}
            {canDelete && (
              <button onClick={() => remove(r)} className="text-muted-foreground hover:text-destructive" title="Delete">
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canPrint, canUpdate, canDelete],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <ScrollText className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Challans</h2>
          <p className="text-muted-foreground text-sm">{data?.total ?? 0} saved challan(s) · view, print, change status or delete</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Total Sales" value={money(summary?.totalSales ?? 0)} />
        <Kpi label="Total B" value={money(summary?.totalB ?? 0)} />
        <Kpi label="Total C" value={money(summary?.totalC ?? 0)} />
        <Kpi label="Total TDS" value={money(summary?.totalTds ?? 0)} />
        <Kpi label="Challans" value={(summary?.count ?? 0).toLocaleString('en-IN')} />
      </div>

      {/* Filters */}
      <div className="bg-card flex flex-wrap items-end gap-2 rounded-md border p-3 shadow-sm">
        <div className="relative w-full sm:w-56">
          <Label className="text-xs">Search</Label>
          <Search className="text-muted-foreground pointer-events-none absolute top-[30px] left-3 size-4" />
          <Input className="pl-9" placeholder="Challan no or party…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
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
        <div className="w-44 space-y-1">
          <Label className="text-xs">Status</Label>
          <NativeSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={['', 'CONFIRMED', 'CANCELLED']} placeholder="All statuses" />
        </div>
        {(search || dateFrom || dateTo || preset || status) && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clearAll}>
            <X /> Clear
          </Button>
        )}
      </div>

      <DataTable columns={columns} rows={items} rowKey={(r) => r.id} isLoading={isLoading} dense hideRowView emptyText="No challans yet — create one from Pending Challan." />

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

export default ChallansListPage;
