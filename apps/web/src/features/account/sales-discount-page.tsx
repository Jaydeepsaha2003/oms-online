import { useEffect, useMemo, useState } from 'react';
import { BadgePercent, History, Loader2, Pencil, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { DiscountDto, DiscountInvoiceRow } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCustomers } from '@/features/customers/use-customers';
import {
  useDeleteDiscount,
  useDiscountHistory,
  useDiscountInvoices,
  useSaveDiscount,
  useUpdateDiscount,
} from './use-account';

const money = (v: number) => `₹ ${(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const prettyDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type Mode = '' | 'BANK' | 'CASH';
type DiscountTarget = { row: DiscountInvoiceRow; side: 'BANK' | 'CASH'; editing: DiscountDto | null };

export function SalesDiscountPage() {
  const { can } = usePermissions();
  const [party, setParty] = useState('');
  const [mode, setMode] = useState<Mode>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<DiscountTarget | null>(null);
  const [historyRow, setHistoryRow] = useState<DiscountInvoiceRow | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data: customerData } = useCustomers({ page: 1, pageSize: 1000 });
  const byLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of customerData?.items ?? []) if (c.partyName) m.set(c.partyName, c.id);
    return m;
  }, [customerData]);
  const partyOptions = useMemo(() => [...byLabel.keys()].sort((a, b) => a.localeCompare(b)), [byLabel]);
  const customerId = party ? byLabel.get(party) : undefined;

  const query = { customerId, mode: mode || undefined, search: search || undefined };
  const { data: rows = [], isLoading } = useDiscountInvoices(query);

  const openDiscount = (row: DiscountInvoiceRow) => {
    if (!mode) return toast.error('Select a Discount Mode (BANK / CASH) first.');
    const bal = mode === 'BANK' ? row.billBal : row.cashBal;
    if (bal <= 0) return toast.error(`This invoice is fully settled on the ${mode} side.`);
    setTarget({ row, side: mode, editing: null });
  };

  const bankActive = mode === 'BANK';
  const cashActive = mode === 'CASH';

  const columns: DataColumn<DiscountInvoiceRow>[] = [
    { id: 'invDate', label: 'Inv Date', cell: (r) => <span className="whitespace-nowrap">{prettyDate(r.invDate)}</span> },
    { id: 'invNo', label: 'Inv No', cell: (r) => <span className="font-mono font-semibold">{r.invNo}</span> },
    { id: 'party', label: 'Customer', cell: (r) => <span className="font-medium">{r.customerName}</span> },
    { id: 'billAmt', label: 'Bill Amt', align: 'right', cell: (r) => <span className="tabular-nums">{money(r.billAmt)}</span> },
    { id: 'billDisc', label: 'Bill Disc', align: 'right', cell: (r) => <span className={cn('tabular-nums', bankActive && 'bg-emerald-50')}>{money(r.billDisc)}</span> },
    { id: 'billBal', label: 'Bill Bal', align: 'right', cell: (r) => <span className={cn('tabular-nums font-semibold', bankActive && 'bg-amber-50')}>{money(r.billBal)}</span> },
    { id: 'cashAmt', label: 'Cash Amt', align: 'right', cell: (r) => <span className="tabular-nums">{money(r.cashAmt)}</span> },
    { id: 'cashDisc', label: 'Cash Disc', align: 'right', cell: (r) => <span className={cn('tabular-nums', cashActive && 'bg-emerald-50')}>{money(r.cashDisc)}</span> },
    { id: 'cashBal', label: 'Cash Bal', align: 'right', cell: (r) => <span className={cn('tabular-nums font-semibold', cashActive && 'bg-amber-50')}>{money(r.cashBal)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <BadgePercent className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Sales Discount</h2>
          <p className="text-muted-foreground text-sm">Give a discount on a pending invoice — it reduces the bank or cash balance and posts a ledger voucher.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card flex flex-wrap items-end gap-3 rounded-md border p-3 shadow-sm">
        <div className="w-full space-y-1 sm:w-72">
          <Label className="text-sm">Party Name</Label>
          <NativeSelect value={party} onChange={setParty} options={['', ...partyOptions]} placeholder="All parties" />
        </div>
        <div className="w-40 space-y-1">
          <Label className="text-sm">Discount Mode *</Label>
          <NativeSelect value={mode} onChange={(v) => setMode(v as Mode)} options={['', 'BANK', 'CASH']} placeholder="BANK / CASH" />
        </div>
        <div className="relative w-full sm:w-64">
          <Label className="text-sm">Search</Label>
          <Search className="text-muted-foreground pointer-events-none absolute left-3 top-[34px] size-4" />
          <Input placeholder="Inv no / party / amount…" className="pl-9" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <p className="text-muted-foreground ml-auto text-sm">
          {mode ? <>Click an invoice to discount its <b className="text-foreground">{mode}</b> balance.</> : 'Select a mode, then click an invoice.'}
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.invNo}
        isLoading={isLoading}
        emptyText={mode ? `No pending invoices with a ${mode} balance.` : 'No pending invoices — choose a party or mode.'}
        onRowClick={(r) => can('discount:create') && openDiscount(r)}
        actions={(r) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" className="size-8" title="Discount history" onClick={() => setHistoryRow(r)} aria-label="History">
              <History className="size-4" />
            </Button>
          </div>
        )}
      />

      {target && (
        <DiscountDialog
          target={target}
          onClose={() => setTarget(null)}
        />
      )}
      {historyRow && (
        <HistoryDialog
          row={historyRow}
          onEdit={(d) => {
            setHistoryRow(null);
            setTarget({ row: historyRow, side: d.billType === 'CASH' ? 'CASH' : 'BANK', editing: d });
          }}
          onClose={() => setHistoryRow(null)}
        />
      )}
    </div>
  );
}

function DiscountDialog({ target, onClose }: { target: DiscountTarget; onClose: () => void }) {
  const { row, side, editing } = target;
  const isEdit = !!editing;
  const save = useSaveDiscount();
  const update = useUpdateDiscount();
  const saving = save.isPending || update.isPending;

  const invAmt = side === 'BANK' ? row.billAmt : row.cashAmt;
  const received = side === 'BANK' ? row.billRec : row.cashRec;
  const balance = side === 'BANK' ? row.billBal : row.cashBal;
  // Editing puts the discount back "in play", so the max grows by its own amount.
  const maxAllowed = Math.max(0, balance + (editing?.disAmt ?? 0));

  const [disAmt, setDisAmt] = useState(editing ? String(editing.disAmt) : '');
  const [disDate, setDisDate] = useState(editing ? editing.disDate.slice(0, 10) : ymd(new Date()));

  const submit = () => {
    const amt = Number(disAmt);
    if (!Number.isFinite(amt) || amt <= 0) return toast.error('Enter a discount amount greater than zero.');
    if (amt > maxAllowed + 0.005) return toast.error(`Discount cannot exceed the pending ${side} amount (${money(maxAllowed)}).`);
    const input = { invNo: row.invNo, customerId: row.customerId, billType: side, disAmt: amt, disDate };
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'Discount updated' : 'Discount saved');
        onClose();
      },
      onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed')),
    };
    if (isEdit) update.mutate({ id: editing!.id, ...input }, opts);
    else save.mutate(input, opts);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BadgePercent className="size-5 text-primary" />
            {isEdit ? 'Edit discount' : 'Give discount'} · {side}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="bg-muted/40 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
            <span className="text-muted-foreground">Invoice</span><span className="text-right font-mono font-semibold">{row.invNo}</span>
            <span className="text-muted-foreground">Party</span><span className="truncate text-right font-medium">{row.customerName}</span>
            <span className="text-muted-foreground">{side} amount</span><span className="text-right tabular-nums">{money(invAmt)}</span>
            <span className="text-muted-foreground">Received</span><span className="text-right tabular-nums">{money(received)}</span>
            <span className="text-muted-foreground font-medium">Pending (max)</span><span className="text-right font-semibold tabular-nums text-amber-700">{money(maxAllowed)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-sm">Discount amount *</Label>
              <Input autoFocus value={disAmt} onChange={(e) => setDisAmt(e.target.value)} inputMode="decimal" placeholder="0" className="text-right tabular-nums" />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Discount date *</Label>
              <Input type="date" max={ymd(new Date())} value={disDate} onChange={(e) => setDisDate(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            {isEdit ? 'Update' : 'Save discount'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ row, onEdit, onClose }: { row: DiscountInvoiceRow; onEdit: (d: DiscountDto) => void; onClose: () => void }) {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const { data, isLoading } = useDiscountHistory(row.invNo);
  const del = useDeleteDiscount();
  const items = data?.items ?? [];

  const handleDelete = async (d: DiscountDto) => {
    const ok = await confirm({
      title: 'Delete discount?',
      description: `${d.billType} discount of ${money(d.disAmt)} on ${d.invNo} will be removed (its ledger voucher too).`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(d.id, {
      onSuccess: () => toast.success('Discount deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-5 text-primary" /> Discount history · <span className="font-mono">{row.invNo}</span>
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No discounts on this invoice yet.</div>
        ) : (
          <div className="max-h-[50vh] divide-y overflow-y-auto">
            {items.map((d) => (
              <div key={d.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset', d.billType === 'BANK' ? 'bg-sky-50 text-sky-700 ring-sky-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200')}>{d.billType}</span>
                    <span className="font-semibold tabular-nums">{money(d.disAmt)}</span>
                    <span className="text-muted-foreground text-xs">{prettyDate(d.disDate)}</span>
                  </div>
                  <div className="text-muted-foreground text-xs">Voucher {d.voucherNo ?? '—'} · on {money(d.invAmt)}</div>
                </div>
                {can('discount:update') && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onEdit(d)}>
                    <Pencil className="size-3" /> Edit
                  </Button>
                )}
                {can('discount:delete') && (
                  <Button variant="outline" size="sm" className="h-7 text-xs text-destructive" disabled={del.isPending} onClick={() => handleDelete(d)}>
                    <Trash2 className="size-3" /> Delete
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SalesDiscountPage;
