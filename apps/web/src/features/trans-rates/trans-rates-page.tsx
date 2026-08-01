import { useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  History,
  List,
  ListPlus,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { TransRateDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { parseExcelFile } from '@/lib/excel';
import { cn, formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { ExportButton, ImportButton, TemplateButton } from '@/components/common/excel-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Combo, NativeSelect } from '@/components/common/combo';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  downloadTransTemplate,
  exportTransRates,
  useBulkTransRates,
  useDeleteTransRate,
  useImportTransRates,
  useTransLookups,
  useTransRateHistory,
  useTransRates,
} from './use-trans-rates';
import { CustomerTransRates } from './customer-trans-rates';
import { RateHistoryDialog } from '@/components/common/rate-history-dialog';

const PAGE_SIZE = 50;
const num = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-IN'));

/** Matches the Products / Orders / Challans grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

export function TransRatesPage() {
  const { can } = usePermissions();
  const [mode, setMode] = useState<'list' | 'bulk'>('list');
  const importMut = useImportTransRates();

  const handleImport = async (file: File) => {
    try {
      const rows = await parseExcelFile(file);
      const res = await importMut.mutateAsync(rows);
      const skipped = res.errors.length ? `, ${res.errors.length} skipped` : '';
      toast.success(`Imported: ${res.created} created, ${res.updated} updated${skipped}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Import failed'));
    }
  };

  return (
    <div className="space-y-2.5 font-sans">
      {/* One compact toolbar: mode toggle → actions. (No page title — the topbar
          already says "Transport Rates".) */}
      <div className="bg-card font-poppins flex flex-wrap items-center gap-2 rounded-[4px] border p-2.5 shadow-sm sm:p-3">
        <div className="flex items-center gap-1 rounded-[4px] border border-amber-300 bg-amber-50/40 p-0.5 dark:border-amber-400/40">
          {(
            [
              { id: 'list' as const, label: 'All rates', icon: List },
              { id: 'bulk' as const, label: 'Fill by customer', icon: Users },
            ]
          ).map(({ id, label, icon: Icon }) => {
            const on = mode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                aria-pressed={on}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 rounded-[3px] px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors duration-150',
                  on
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-200/70 dark:hover:bg-amber-400/10',
                )}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground hidden text-[12px] font-medium sm:block">
          Rate per customer × product category × type (PACKING / FREIGHT).
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {can('transrate:export') && <TemplateButton onClick={() => downloadTransTemplate()} />}
          {can('transrate:export') && <ExportButton onClick={() => exportTransRates()} />}
          {can('transrate:import') && <ImportButton onFile={handleImport} pending={importMut.isPending} />}
        </div>
      </div>

      {mode === 'list' ? <RatesList /> : <BulkByCustomer />}
    </div>
  );
}

/** Master table of every transport rate, with add / edit / delete. */
function RatesList() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useTransRates({ page, pageSize: PAGE_SIZE, search: search || undefined });
  const del = useDeleteTransRate();
  const [editing, setEditing] = useState<TransRateDto | null>(null);
  const [historyFor, setHistoryFor] = useState<TransRateDto | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  // Phones: group rates by customer — one card per customer, its category/type
  // rows nested underneath, instead of repeating the customer name on every card.
  const groupedByCustomer = useMemo(() => {
    const order: string[] = [];
    const groups = new Map<string, TransRateDto[]>();
    for (const r of items) {
      if (!groups.has(r.customerName)) {
        groups.set(r.customerName, []);
        order.push(r.customerName);
      }
      groups.get(r.customerName)!.push(r);
    }
    return order.map((customerName) => ({ customerName, rates: groups.get(customerName)! }));
  }, [items]);

  const rateRowActions = (r: TransRateDto) => (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Button variant="ghost" size="icon" className="size-7" onClick={() => setHistoryFor(r)} aria-label="History">
        <History className="size-4" />
      </Button>
      {can('transrate:update') && (
        <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(r)} aria-label="Edit">
          <Pencil className="size-4" />
        </Button>
      )}
      {can('transrate:delete') && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-destructive hover:text-destructive"
          onClick={() => handleDelete(r)}
          aria-label="Delete"
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </div>
  );

  const handleDelete = async (r: TransRateDto) => {
    const ok = await confirm({
      title: 'Delete transport rate?',
      description: `Remove the rate for "${r.customerName} / ${r.category} / ${r.type}"?`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(r.id, {
      onSuccess: () => toast.success('Rate deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  const columns: DataColumn<TransRateDto>[] = [
    { id: 'customer', label: 'Customer', cell: (r) => <span className={cn(TEXT_CELL, 'text-indigo-700 dark:text-indigo-300')}>{r.customerName}</span> },
    { id: 'category', label: 'Category', cell: (r) => <span className={TEXT_CELL}>{r.category}</span> },
    { id: 'type', label: 'Type', cell: (r) => <span className={TEXT_CELL}>{r.type}</span> },
    { id: 'transporter', label: 'Transporter', cell: (r) => <span className={TEXT_CELL}>{r.transportName ?? '—'}</span> },
    { id: 'rate', label: 'Rate', align: 'right', cell: (r) => <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{num(r.rate)}</span> },
    {
      id: 'updated',
      label: 'Last updated',
      cell: (r) => (
        <span className="text-muted-foreground whitespace-nowrap text-[12px] font-medium tabular-nums" title={formatDateTime(r.updatedAt)}>
          {formatDateShort(r.updatedAt)}
        </span>
      ),
    },
  ];

  const totalRows = data?.total ?? 0;
  const from = totalRows === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, totalRows);

  return (
    <div className="space-y-2.5">
      {/* ── Toolbar: search on the left, the primary action on the right. */}
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <div className="relative w-full sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search customer, category, type…"
              className={cn(CONTROL, 'pl-8 font-medium', searchInput && CONTROL_ON)}
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setSearch(e.target.value.trim());
                setPage(1);
              }}
            />
          </div>
          <p className="text-muted-foreground shrink-0 text-[12px] font-medium tabular-nums">
            <span className="font-bold text-foreground">{totalRows.toLocaleString('en-IN')}</span> rate{totalRows === 1 ? '' : 's'}
          </p>
          {can('transrate:create') && (
            <Button size="sm" className="ml-auto h-9 rounded-[4px] text-[12.5px] font-bold" onClick={() => setBulkOpen(true)}>
              <ListPlus /> Bulk rate change
            </Button>
          )}
        </div>
      </div>

      <div
        className={cn(
          '[&_[data-slot=table-container]]:overscroll-x-contain',
          '[&_[data-slot=table-container]]:[scrollbar-width:thin]',
          '[&_[data-slot=table-container]]:[scrollbar-color:var(--color-slate-400)_var(--color-slate-100)]',
        )}
      >
        <DataTable
          dense
          hideSortIcon
          columns={columns}
          rows={items}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          emptyText="No transport rates yet — add one or import a sheet."
          onRowClick={can('transrate:update') ? (r) => setEditing(r) : undefined}
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
          actions={(r) => (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setHistoryFor(r)} aria-label="History">
                <History className="size-4" />
              </Button>
              {can('transrate:update') && (
                <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(r)} aria-label="Edit">
                  <Pencil className="size-4" />
                </Button>
              )}
              {can('transrate:delete') && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(r)}
                  aria-label="Delete"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          )}
        />
      </div>

      {/* Phones: one card per customer, its category/type rates grouped underneath. */}
      <div className="sm:hidden">
        {isLoading ? (
          <div className="text-muted-foreground flex h-24 items-center justify-center">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : groupedByCustomer.length === 0 ? (
          <div className="text-muted-foreground rounded-[4px] border px-4 py-10 text-center text-[13px] font-medium">
            No transport rates yet — add one or import a sheet.
          </div>
        ) : (
          <div className="space-y-2.5">
            {groupedByCustomer.map(({ customerName, rates }) => (
              <div key={customerName} className="bg-card overflow-hidden rounded-[4px] border shadow-sm">
                <div className="bg-muted/40 border-b px-3 py-1.5">
                  <p className="text-[13px] font-bold">{customerName}</p>
                  <p className="text-muted-foreground text-[11px] font-medium">
                    {rates.length} rate{rates.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="divide-y divide-slate-200 dark:divide-white/10">
                  {rates.map((r) => (
                    <div
                      key={r.id}
                      className={cn('px-3 py-2', can('transrate:update') && 'cursor-pointer active:bg-muted')}
                      onClick={can('transrate:update') ? () => setEditing(r) : undefined}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">
                          {r.category} · {r.type}
                        </p>
                        <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{num(r.rate)}</span>
                      </div>
                      <p className="text-muted-foreground text-[11px] font-medium">Transporter: {r.transportName ?? '—'}</p>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-muted-foreground text-[11px] font-medium tabular-nums" title={formatDateTime(r.updatedAt)}>
                          {formatDateShort(r.updatedAt)}
                        </span>
                        {rateRowActions(r)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer: range + paging ─────────────────────────────────────────────── */}
      <div className="bg-card flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[4px] border px-3 py-2 shadow-sm">
        <p className="text-muted-foreground text-[12px] font-medium">
          {totalRows === 0 ? (
            'No rates'
          ) : (
            <>
              Showing <span className="font-bold tabular-nums text-foreground">{from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')}</span> of{' '}
              <span className="font-bold tabular-nums text-foreground">{totalRows.toLocaleString('en-IN')}</span>
            </>
          )}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <p className="text-muted-foreground text-[12px] font-medium">
            Page <span className="font-bold tabular-nums text-foreground">{data?.page ?? page}</span> of{' '}
            <span className="font-bold tabular-nums text-foreground">{totalPages}</span>
          </p>
          <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <ChevronLeft /> Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-[4px] font-semibold"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next <ChevronRight />
          </Button>
        </div>
      </div>

      {editing && <TransRateDialog rate={editing} onClose={() => setEditing(null)} />}
      {historyFor && <TransHistoryDialog rate={historyFor} onClose={() => setHistoryFor(null)} />}
      {bulkOpen && <TransBulkRateDialog onClose={() => setBulkOpen(false)} />}
    </div>
  );
}

function TransHistoryDialog({ rate, onClose }: { rate: TransRateDto; onClose: () => void }) {
  const { data, isFetching } = useTransRateHistory(rate.customerName, rate.category, rate.type);
  return (
    <RateHistoryDialog
      subtitle={`${rate.customerName} · ${rate.category} · ${rate.type}`}
      entries={data ?? []}
      loading={isFetching}
      onClose={onClose}
    />
  );
}

interface BulkRow {
  key: string;
  customer: string;
  category: string;
  type: string;
  transportName: string;
  rate: string;
}

/** Add many customer × category × type rates at once: stack rows, then apply. */
function TransBulkRateDialog({ onClose }: { onClose: () => void }) {
  const { data: lookups } = useTransLookups();
  const bulk = useBulkTransRates();
  const keyer = useRef(0);
  const [rows, setRows] = useState<BulkRow[]>([
    { key: 'r0', customer: '', category: '', type: '', transportName: '', rate: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const transporterNames = (lookups?.transporters ?? []).map((t) => t.name);

  const setRow = (key: string, patch: Partial<BulkRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((rs) => [
      ...rs,
      { key: `r${++keyer.current}`, customer: '', category: '', type: '', transportName: '', rate: '' },
    ]);
  const removeRow = (key: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  const ready = rows.filter(
    (r) => r.customer.trim() && r.category.trim() && r.type.trim() && r.rate.trim() !== '',
  );

  const submit = async () => {
    if (ready.length === 0) return toast.error('Fill at least one full row (customer, category, type, rate)');
    const byCustomer = new Map<string, { category: string; type: string; transportName: string | null; rate: number }[]>();
    for (const r of ready) {
      const c = r.customer.trim();
      const arr = byCustomer.get(c) ?? [];
      arr.push({
        category: r.category.trim(),
        type: r.type.trim(),
        transportName: r.transportName.trim() || null,
        rate: Number(r.rate),
      });
      byCustomer.set(c, arr);
    }
    setSaving(true);
    try {
      let saved = 0;
      for (const [customerName, rates] of byCustomer) {
        const res = await bulk.mutateAsync({ customerName, rates });
        saved += res.saved;
      }
      toast.success(`Saved ${saved} rate(s) across ${byCustomer.size} customer(s)`);
      onClose();
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bulk rate change</DialogTitle>
          <p className="text-muted-foreground text-sm">
            Add multiple customer × category × type rates, then apply them all in one go.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_1fr_7rem_1fr_6rem_2rem] gap-2 px-1 text-xs font-medium text-muted-foreground">
          <span>Customer</span>
          <span>Category</span>
          <span>Type</span>
          <span>Transporter</span>
          <span>Rate</span>
          <span />
        </div>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.key} className="grid grid-cols-[1fr_1fr_7rem_1fr_6rem_2rem] items-center gap-2">
              <NativeSelect
                value={r.customer}
                onChange={(v) => setRow(r.key, { customer: v })}
                options={lookups?.customers ?? []}
                placeholder="Customer"
              />
              <Combo
                value={r.category}
                onChange={(v) => setRow(r.key, { category: v })}
                options={lookups?.categories ?? []}
                placeholder="Category"
              />
              <NativeSelect
                value={r.type}
                onChange={(v) => setRow(r.key, { type: v })}
                options={lookups?.types ?? []}
                placeholder="Type"
              />
              <Combo
                value={r.transportName}
                onChange={(v) => setRow(r.key, { transportName: v })}
                options={transporterNames}
                placeholder="Transporter"
              />
              <Input
                type="number"
                step="any"
                inputMode="decimal"
                className="text-right tabular-nums"
                value={r.rate}
                onChange={(e) => setRow(r.key, { rate: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                onClick={() => removeRow(r.key)}
                disabled={rows.length === 1}
                aria-label="Remove row"
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" className="w-fit" onClick={addRow}>
          <Plus /> Add condition
        </Button>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || ready.length === 0}>
            {saving ? <Loader2 className="animate-spin" /> : null} Apply {ready.length || ''} rate{ready.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransRateDialog({ rate, onClose }: { rate: TransRateDto | null; onClose: () => void }) {
  const isEdit = !!rate;
  const { data: lookups } = useTransLookups();
  const bulk = useBulkTransRates();
  const [customer, setCustomer] = useState(rate?.customerName ?? '');
  const [category, setCategory] = useState(rate?.category ?? '');
  const [type, setType] = useState(rate?.type ?? '');
  const [transportName, setTransportName] = useState(rate?.transportName ?? '');
  const [rateVal, setRateVal] = useState(rate?.rate?.toString() ?? '');
  const transporterNames = (lookups?.transporters ?? []).map((t) => t.name);

  const submit = () => {
    if (!customer.trim() || !category.trim() || !type.trim())
      return toast.error('Customer, category and type are required');
    bulk.mutate(
      {
        customerName: customer.trim(),
        rates: [
          {
            category: category.trim(),
            type: type.trim(),
            transportName: transportName.trim() || null,
            rate: rateVal.trim() === '' ? null : Number(rateVal),
          },
        ],
      },
      {
        onSuccess: () => {
          toast.success(isEdit ? 'Rate updated' : 'Rate added');
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit transport rate' : 'Add transport rate'}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label>Customer</Label>
            <NativeSelect
              value={customer}
              onChange={setCustomer}
              options={lookups?.customers ?? []}
              placeholder="Select a customer…"
              disabled={isEdit}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Category</Label>
              <Combo
                value={category}
                onChange={setCategory}
                options={lookups?.categories ?? []}
                placeholder="Category"
                disabled={isEdit}
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <NativeSelect
                value={type}
                onChange={setType}
                options={lookups?.types ?? []}
                placeholder="Type"
                disabled={isEdit}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Transporter</Label>
              <Combo value={transportName} onChange={setTransportName} options={transporterNames} placeholder="Transporter" />
            </div>
            <div className="space-y-2">
              <Label>Rate</Label>
              <Input
                type="number"
                step="any"
                inputMode="decimal"
                className="text-right tabular-nums"
                value={rateVal}
                onChange={(e) => setRateVal(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={bulk.isPending}>
              {bulk.isPending ? <Loader2 className="animate-spin" /> : null}
              {isEdit ? 'Save' : 'Add rate'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Secondary mode: pick a customer, then fill their rates via the shared grid. */
function BulkByCustomer() {
  const { data: lookups } = useTransLookups();
  const [customer, setCustomer] = useState('');

  return (
    <Card className="rounded-[4px]">
      <CardContent className="space-y-3 pt-5">
        <div className="grid gap-1 sm:max-w-64">
          <Label className="text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">Customer</Label>
          <NativeSelect
            value={customer}
            onChange={setCustomer}
            options={lookups?.customers ?? []}
            placeholder="Select a customer…"
            className={cn(CONTROL, 'font-medium')}
          />
        </div>

        {customer.trim() === '' ? (
          <p className="text-muted-foreground py-10 text-center text-[13px] font-medium">
            Choose a customer to fill their transport rates.
          </p>
        ) : (
          <CustomerTransRates customerName={customer.trim()} />
        )}
      </CardContent>
    </Card>
  );
}
