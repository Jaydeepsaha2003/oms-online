import { useRef, useState } from 'react';
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
import { formatDateShort, formatDateTime } from '@/lib/utils';
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
const num = (n: number | null) => (n == null ? '—' : n.toLocaleString());

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
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Customer Transport Rates</h2>
          <p className="text-muted-foreground text-sm">
            Rate per customer × product category × type (PACKING / FREIGHT).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-muted/60 inline-flex rounded-lg p-0.5">
            <Button variant={mode === 'list' ? 'default' : 'ghost'} size="sm" onClick={() => setMode('list')}>
              <List className="size-4" /> All rates
            </Button>
            <Button variant={mode === 'bulk' ? 'default' : 'ghost'} size="sm" onClick={() => setMode('bulk')}>
              <Users className="size-4" /> Fill by customer
            </Button>
          </div>
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
    { id: 'customer', label: 'Customer', cell: (r) => <span className="font-medium">{r.customerName}</span> },
    { id: 'category', label: 'Category', cell: (r) => r.category },
    { id: 'type', label: 'Type', cell: (r) => r.type },
    { id: 'transporter', label: 'Transporter', cell: (r) => r.transportName ?? '—' },
    { id: 'rate', label: 'Rate', align: 'right', cell: (r) => <span className="tabular-nums">{num(r.rate)}</span> },
    {
      id: 'updated',
      label: 'Last updated',
      cell: (r) => (
        <span className="text-muted-foreground whitespace-nowrap font-mono text-xs" title={formatDateTime(r.updatedAt)}>
          {formatDateShort(r.updatedAt)}
        </span>
      ),
    },
  ];

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search customer, category, type…"
              className="pl-9"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setSearch(e.target.value.trim());
                setPage(1);
              }}
            />
          </div>
          {can('transrate:create') && (
            <Button size="sm" onClick={() => setBulkOpen(true)}>
              <ListPlus /> Bulk rate change
            </Button>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={items}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          emptyText="No transport rates yet — add one or import a sheet."
          onRowClick={can('transrate:update') ? (r) => setEditing(r) : undefined}
          actions={(r) => (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setHistoryFor(r)} aria-label="History">
                <History className="size-4" />
              </Button>
              {can('transrate:update') && (
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(r)} aria-label="Edit">
                  <Pencil className="size-4" />
                </Button>
              )}
              {can('transrate:delete') && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(r)}
                  aria-label="Delete"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          )}
        />

        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">
            {data?.total ?? 0} rate(s) · page {data?.page ?? page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      </CardContent>

      {editing && <TransRateDialog rate={editing} onClose={() => setEditing(null)} />}
      {historyFor && <TransHistoryDialog rate={historyFor} onClose={() => setHistoryFor(null)} />}
      {bulkOpen && <TransBulkRateDialog onClose={() => setBulkOpen(false)} />}
    </Card>
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
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="grid gap-2 sm:max-w-sm">
          <Label>Customer</Label>
          <NativeSelect
            value={customer}
            onChange={setCustomer}
            options={lookups?.customers ?? []}
            placeholder="Select a customer…"
          />
        </div>

        {customer.trim() === '' ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            Choose a customer to fill their transport rates.
          </p>
        ) : (
          <CustomerTransRates customerName={customer.trim()} />
        )}
      </CardContent>
    </Card>
  );
}
