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
import type { GstRateDto } from '@oms/shared';
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
  downloadGstTemplate,
  exportGstRates,
  useBulkGstRates,
  useDeleteGstRate,
  useGstLookups,
  useGstRateHistory,
  useGstRates,
  useImportGstRates,
  useUpsertGstRate,
} from './use-gst-rates';
import { CustomerGstRates } from './customer-gst-rates';
import { RateHistoryDialog } from '@/components/common/rate-history-dialog';

const PAGE_SIZE = 50;
const pct = (n: number | null) => (n == null ? '—' : `${n.toLocaleString()}%`);

export function GstRatesPage() {
  const { can } = usePermissions();
  const [mode, setMode] = useState<'list' | 'bulk'>('list');
  const importMut = useImportGstRates();

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
          <h2 className="text-2xl font-semibold tracking-tight">Customer GST Rates</h2>
          <p className="text-muted-foreground text-sm">GST rate per customer × product category.</p>
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
          {can('gstrate:export') && <TemplateButton onClick={() => downloadGstTemplate()} />}
          {can('gstrate:export') && <ExportButton onClick={() => exportGstRates()} />}
          {can('gstrate:import') && <ImportButton onFile={handleImport} pending={importMut.isPending} />}
        </div>
      </div>

      {mode === 'list' ? <RatesList /> : <BulkByCustomer />}
    </div>
  );
}

/** Master table of every GST rate, with add / edit / delete. */
function RatesList() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useGstRates({ page, pageSize: PAGE_SIZE, search: search || undefined });
  const del = useDeleteGstRate();
  const [editing, setEditing] = useState<GstRateDto | null>(null);
  const [historyFor, setHistoryFor] = useState<GstRateDto | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const handleDelete = async (r: GstRateDto) => {
    const ok = await confirm({
      title: 'Delete GST rate?',
      description: `Remove the rate for "${r.customerName} / ${r.category}"?`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(r.id, {
      onSuccess: () => toast.success('Rate deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  const columns: DataColumn<GstRateDto>[] = [
    { id: 'customer', label: 'Customer', cell: (r) => <span className="font-medium">{r.customerName}</span> },
    { id: 'category', label: 'Product category', cell: (r) => r.category },
    { id: 'rate', label: 'GST rate', align: 'right', cell: (r) => <span className="tabular-nums">{pct(r.rate)}</span> },
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
              placeholder="Search customer or category…"
              className="pl-9"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setSearch(e.target.value.trim());
                setPage(1);
              }}
            />
          </div>
          {can('gstrate:create') && (
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
          emptyText="No GST rates yet — add one or import a sheet."
          onRowClick={can('gstrate:update') ? (r) => setEditing(r) : undefined}
          actions={(r) => (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setHistoryFor(r)} aria-label="History">
                <History className="size-4" />
              </Button>
              {can('gstrate:update') && (
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(r)} aria-label="Edit">
                  <Pencil className="size-4" />
                </Button>
              )}
              {can('gstrate:delete') && (
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

      {editing && <GstRateDialog rate={editing} onClose={() => setEditing(null)} />}
      {historyFor && <GstHistoryDialog rate={historyFor} onClose={() => setHistoryFor(null)} />}
      {bulkOpen && <GstBulkRateDialog onClose={() => setBulkOpen(false)} />}
    </Card>
  );
}

function GstHistoryDialog({ rate, onClose }: { rate: GstRateDto; onClose: () => void }) {
  const { data, isFetching } = useGstRateHistory(rate.customerName, rate.category);
  return (
    <RateHistoryDialog
      subtitle={`${rate.customerName} · ${rate.category}`}
      entries={data ?? []}
      loading={isFetching}
      unit="%"
      onClose={onClose}
    />
  );
}

interface BulkRow {
  key: string;
  customer: string;
  category: string;
  rate: string;
}

/** Add many customer × category rates at once: stack condition rows, then apply. */
function GstBulkRateDialog({ onClose }: { onClose: () => void }) {
  const { data: lookups } = useGstLookups();
  const bulk = useBulkGstRates();
  const keyer = useRef(0);
  const [rows, setRows] = useState<BulkRow[]>([{ key: 'r0', customer: '', category: '', rate: '' }]);
  const [saving, setSaving] = useState(false);

  const setRow = (key: string, patch: Partial<BulkRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((rs) => [...rs, { key: `r${++keyer.current}`, customer: '', category: '', rate: '' }]);
  const removeRow = (key: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  const ready = rows.filter((r) => r.customer.trim() && r.category.trim() && r.rate.trim() !== '');

  const submit = async () => {
    if (ready.length === 0) return toast.error('Fill at least one full row (customer, category, rate)');
    // Group by customer so each goes through the customer's bulk upsert.
    const byCustomer = new Map<string, { category: string; rate: number }[]>();
    for (const r of ready) {
      const c = r.customer.trim();
      const arr = byCustomer.get(c) ?? [];
      arr.push({ category: r.category.trim(), rate: Number(r.rate) });
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk rate change</DialogTitle>
          <p className="text-muted-foreground text-sm">
            Add multiple customer × category rates, then apply them all in one go.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_1fr_7rem_2rem] gap-2 px-1 text-xs font-medium text-muted-foreground">
          <span>Customer</span>
          <span>Product category</span>
          <span>Rate (%)</span>
          <span />
        </div>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.key} className="grid grid-cols-[1fr_1fr_7rem_2rem] items-center gap-2">
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

function GstRateDialog({ rate, onClose }: { rate: GstRateDto | null; onClose: () => void }) {
  const isEdit = !!rate;
  const { data: lookups } = useGstLookups();
  const upsert = useUpsertGstRate();
  const [customer, setCustomer] = useState(rate?.customerName ?? '');
  const [category, setCategory] = useState(rate?.category ?? '');
  const [rateVal, setRateVal] = useState(rate?.rate?.toString() ?? '');

  const submit = () => {
    if (!customer.trim() || !category.trim()) return toast.error('Customer and category are required');
    upsert.mutate(
      {
        customerName: customer.trim(),
        category: category.trim(),
        rate: rateVal.trim() === '' ? null : Number(rateVal),
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
          <DialogTitle>{isEdit ? 'Edit GST rate' : 'Add GST rate'}</DialogTitle>
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
          <div className="space-y-2">
            <Label>Product category</Label>
            <Combo
              value={category}
              onChange={setCategory}
              options={lookups?.categories ?? []}
              placeholder="Select or add…"
              disabled={isEdit}
            />
          </div>
          <div className="space-y-2">
            <Label>GST rate (%)</Label>
            <Input
              type="number"
              step="any"
              inputMode="decimal"
              className="text-right tabular-nums"
              value={rateVal}
              onChange={(e) => setRateVal(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={upsert.isPending}>
              {upsert.isPending ? <Loader2 className="animate-spin" /> : null}
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
  const { data: lookups } = useGstLookups();
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
            Choose a customer to fill their GST rates by category.
          </p>
        ) : (
          <CustomerGstRates customerName={customer.trim()} />
        )}
      </CardContent>
    </Card>
  );
}
