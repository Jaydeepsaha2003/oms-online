import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Filter, History, Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { ACTIONS, RESOURCES, perm, type AuditLogDto } from '@oms/shared';
import { cn } from '@/lib/utils';
import { downloadFile, getApiErrorMessage } from '@/lib/api';
import { actionColor, actionLabel, fmtWhen, resourceLabel, statusColor } from '@/lib/audit-format';
import { usePermissions } from '@/hooks/use-permissions';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAuditActors, useAuditFacets, useAuditLog } from './use-audit-log';
import { PRESETS, presetRange } from './date-presets';

const PAGE_SIZE = 50;

// Persist filters so they survive navigating away and back.
const FILTER_KEY = 'oms:audit-log-filters';
interface AuditFilters {
  searchInput: string;
  dateFrom: string;
  dateTo: string;
  preset: string;
  userId: string;
  resource: string;
  action: string;
  page: number;
}
const loadFilters = (): Partial<AuditFilters> => {
  try {
    return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}') as Partial<AuditFilters>;
  } catch {
    return {};
  }
};

export function AuditLogPage() {
  const { can } = usePermissions();
  const canExport = can(perm(RESOURCES.AUDIT_LOG, ACTIONS.EXPORT));

  const [searchInput, setSearchInput] = useState(() => loadFilters().searchInput ?? '');
  const [search, setSearch] = useState(() => (loadFilters().searchInput ?? '').trim());
  const [dateFrom, setDateFrom] = useState(() => loadFilters().dateFrom ?? '');
  const [dateTo, setDateTo] = useState(() => loadFilters().dateTo ?? '');
  const [preset, setPreset] = useState(() => loadFilters().preset ?? '');
  const [userId, setUserId] = useState(() => loadFilters().userId ?? '');
  const [resource, setResource] = useState(() => loadFilters().resource ?? '');
  const [action, setAction] = useState(() => loadFilters().action ?? '');
  const [page, setPage] = useState(() => loadFilters().page ?? 1);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const activeFilterCount =
    (dateFrom || dateTo ? 1 : 0) + (userId ? 1 : 0) + (resource ? 1 : 0) + (action ? 1 : 0);
  const hasFilters = !!(search || dateFrom || dateTo || preset || userId || resource || action);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    sessionStorage.setItem(
      FILTER_KEY,
      JSON.stringify({ searchInput, dateFrom, dateTo, preset, userId, resource, action, page }),
    );
  }, [searchInput, dateFrom, dateTo, preset, userId, resource, action, page]);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    from: dateFrom || undefined,
    to: dateTo || undefined,
    userId: userId || undefined,
    resource: resource || undefined,
    action: action || undefined,
  };
  const { data, isLoading } = useAuditLog(query);
  const { data: facets } = useAuditFacets();
  const { data: actors } = useAuditActors();

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
    setUserId('');
    setResource('');
    setAction('');
    setPage(1);
    sessionStorage.removeItem(FILTER_KEY);
  };

  const runExport = async () => {
    setExporting(true);
    try {
      await downloadFile('/audit-logs/export', 'audit-log.xlsx', { params: query });
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Failed to export the activity log'));
    } finally {
      setExporting(false);
    }
  };

  const actorOptions = useMemo(() => (actors ?? []).map((a) => a.id), [actors]);
  const actorLabel = useMemo(() => {
    const m = new Map((actors ?? []).map((a) => [a.id, a.name || a.email || a.id]));
    return (id: string) => m.get(id) ?? id;
  }, [actors]);

  const columns: DataColumn<AuditLogDto>[] = useMemo(
    () => [
      { id: 'when', label: 'When', sortValue: (r) => r.createdAt, cell: (r) => <span className="whitespace-nowrap">{fmtWhen(r.createdAt)}</span> },
      {
        id: 'user',
        label: 'User',
        sortValue: (r) => r.userName || r.userEmail || '',
        cell: (r) => (
          <div className="leading-tight">
            <div className="font-medium">{r.userName || r.userEmail || 'System'}</div>
            {r.userName && r.userEmail && <div className="text-muted-foreground text-xs">{r.userEmail}</div>}
          </div>
        ),
      },
      {
        id: 'action',
        label: 'Action',
        sortValue: (r) => r.action,
        cell: (r) => (
          <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', actionColor(r.action))}>
            {actionLabel(r.action)}
          </span>
        ),
      },
      { id: 'resource', label: 'Resource', sortValue: (r) => r.resource, cell: (r) => <span className="font-medium">{resourceLabel(r.resource)}</span> },
      { id: 'record', label: 'Record', cell: (r) => (r.resourceId ? <span className="font-mono text-xs">#{r.resourceId}</span> : <span className="text-muted-foreground">—</span>) },
      { id: 'description', label: 'Description', cell: (r) => <span className="text-muted-foreground">{r.description || '—'}</span> },
      {
        id: 'status',
        label: 'Status',
        align: 'right',
        sortValue: (r) => r.statusCode ?? 0,
        cell: (r) => <span className={cn('tabular-nums', statusColor(r.statusCode))}>{r.statusCode ?? '—'}</span>,
      },
      { id: 'ip', label: 'IP', cell: (r) => <span className="text-muted-foreground font-mono text-xs">{r.ip || '—'}</span> },
    ],
    [],
  );

  const auditMobileCard = (r: AuditLogDto) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate leading-tight font-medium">{r.userName || r.userEmail || 'System'}</p>
          <p className="text-muted-foreground text-xs">{fmtWhen(r.createdAt)}</p>
        </div>
        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', actionColor(r.action))}>
          {actionLabel(r.action)}
        </span>
      </div>
      <div className="text-sm">
        <span className="font-medium">{resourceLabel(r.resource)}</span>
        {r.resourceId && <span className="text-muted-foreground font-mono text-xs"> #{r.resourceId}</span>}
      </div>
      {r.description && <p className="text-muted-foreground text-xs">{r.description}</p>}
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span className={statusColor(r.statusCode)}>{r.statusCode ?? '—'}</span>
        <span className="font-mono">{r.ip || '—'}</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
            <History className="size-5" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Activity Log</h2>
            <p className="text-muted-foreground text-sm">{data?.total ?? 0} event(s) — who did what, and when</p>
          </div>
        </div>
        {canExport && (
          <div className="sm:ml-auto">
            <Button variant="outline" size="sm" disabled={exporting} onClick={runExport} title="Export the filtered activity log to Excel">
              {exporting ? <Loader2 className="animate-spin" /> : <Download className="text-emerald-600" />} Export
            </Button>
          </div>
        )}
      </div>

      <div className="bg-card flex flex-wrap items-end gap-2 rounded-md border p-2.5 shadow-sm sm:p-3">
        <div className="relative w-full sm:w-56">
          <Label className="text-xs">Search</Label>
          <Search className="text-muted-foreground pointer-events-none absolute top-[30px] left-3 size-4" />
          <Input className="pl-9" placeholder="Description, email or record…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <Button
          variant="outline"
          size="icon"
          className="relative shrink-0 sm:hidden"
          onClick={() => setMobileFiltersOpen(true)}
          aria-label="Filters"
        >
          <Filter className="size-4" />
          {activeFilterCount > 0 && (
            <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-medium">
              {activeFilterCount}
            </span>
          )}
        </Button>
        <div className="hidden items-end gap-2 sm:flex sm:flex-wrap">
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
            <Label className="text-xs">User</Label>
            <NativeSelect
              value={userId}
              onChange={(v) => { setUserId(v); setPage(1); }}
              options={['', ...actorOptions]}
              placeholder="All users"
              renderOption={(v) => (v ? actorLabel(v) : 'All users')}
            />
          </div>
          <div className="w-40 space-y-1">
            <Label className="text-xs">Resource</Label>
            <NativeSelect
              value={resource}
              onChange={(v) => { setResource(v); setPage(1); }}
              options={['', ...(facets?.resources ?? [])]}
              placeholder="All"
              renderOption={(v) => (v ? resourceLabel(v) : 'All')}
            />
          </div>
          <div className="w-36 space-y-1">
            <Label className="text-xs">Action</Label>
            <NativeSelect
              value={action}
              onChange={(v) => { setAction(v); setPage(1); }}
              options={['', ...(facets?.actions ?? [])]}
              placeholder="All"
              renderOption={(v) => (v ? actionLabel(v) : 'All')}
            />
          </div>
          <Button variant="outline" size="sm" className="text-muted-foreground" onClick={clearAll} disabled={!hasFilters} title={hasFilters ? 'Clear all filters' : 'No filters applied'}>
            <X /> Reset filters
          </Button>
        </div>
      </div>

      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="sm:hidden">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>Filters</SheetTitle>
              <Button variant="ghost" size="sm" className="text-muted-foreground -mr-2 gap-1.5" onClick={clearAll} disabled={!hasFilters}>
                <X className="size-3.5" /> Reset
              </Button>
            </div>
          </SheetHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs font-medium uppercase">From</Label>
                <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs font-medium uppercase">To</Label>
                <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Quick range</Label>
              <NativeSelect value={preset} onChange={applyPreset} options={['', ...PRESETS]} placeholder="Range…" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">User</Label>
              <NativeSelect value={userId} onChange={(v) => { setUserId(v); setPage(1); }} options={['', ...actorOptions]} placeholder="All users" renderOption={(v) => (v ? actorLabel(v) : 'All users')} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Resource</Label>
              <NativeSelect value={resource} onChange={(v) => { setResource(v); setPage(1); }} options={['', ...(facets?.resources ?? [])]} placeholder="All" renderOption={(v) => (v ? resourceLabel(v) : 'All')} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs font-medium uppercase">Action</Label>
              <NativeSelect value={action} onChange={(v) => { setAction(v); setPage(1); }} options={['', ...(facets?.actions ?? [])]} placeholder="All" renderOption={(v) => (v ? actionLabel(v) : 'All')} />
            </div>
          </div>
          <SheetFooter>
            <Button className="w-full" onClick={() => setMobileFiltersOpen(false)}>
              Show {(data?.total ?? 0).toLocaleString('en-IN')} events
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        dense
        mobileCard={auditMobileCard}
        emptyText="No activity recorded for these filters."
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

export default AuditLogPage;
