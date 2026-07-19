import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { OpeningBalanceDto } from '@oms/shared';
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
import { useCreateOpeningBalance, useDeleteOpeningBalance, useOpeningBalances, useUpdateOpeningBalance } from './use-account';

const PAGE_SIZE = 50;
const money = (v: number) => `₹ ${(v ?? 0).toLocaleString('en-IN')}`;
const prettyDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function OpeningBalancePage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [drCr, setDrCr] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<OpeningBalanceDto | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize: PAGE_SIZE, search: search || undefined, drCr: drCr || undefined };
  const { data, isLoading } = useOpeningBalances(query);
  const del = useDeleteOpeningBalance();

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const columns: DataColumn<OpeningBalanceDto>[] = [
    { id: 'date', label: 'Date', cell: (o) => <span className="whitespace-nowrap">{prettyDate(o.transDate)}</span> },
    { id: 'party', label: 'Party', cell: (o) => <span className="font-medium">{o.customerName}</span> },
    {
      id: 'drcr',
      label: 'Dr / Cr',
      cell: (o) => (
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset', o.drCr === 'DEBIT' ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200')}>
          {o.drCr}
        </span>
      ),
    },
    { id: 'bank', label: 'Bank', align: 'right', cell: (o) => <span className="tabular-nums">{money(o.bankAmt)}</span> },
    { id: 'cash', label: 'Cash', align: 'right', cell: (o) => <span className="tabular-nums">{money(o.cashAmt)}</span> },
    { id: 'total', label: 'Total', align: 'right', cell: (o) => <span className="tabular-nums font-semibold">{money(o.bankAmt + o.cashAmt)}</span> },
    { id: 'remarks', label: 'Remarks', cell: (o) => <span className="text-muted-foreground">{o.remarks ?? '—'}</span> },
  ];

  const handleDelete = async (o: OpeningBalanceDto) => {
    const ok = await confirm({
      title: 'Delete opening balance?',
      description: `${o.customerName}'s opening (${o.drCr} · ${money(o.bankAmt + o.cashAmt)}) will be removed.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(o.id, {
      onSuccess: () => toast.success('Opening balance deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <BookOpen className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Opening Balance</h2>
          <p className="text-muted-foreground text-sm">{data?.total ?? 0} entr(ies) · per-customer opening bank/cash as Debit or Credit</p>
        </div>
        {can('openingbalance:create') && (
          <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
            <Plus /> New opening
          </Button>
        )}
      </div>

      <div className="bg-card flex flex-wrap items-end gap-2 rounded-md border p-3 shadow-sm">
        <div className="relative w-full sm:w-64">
          <Label className="text-xs">Search party</Label>
          <Search className="text-muted-foreground pointer-events-none absolute left-3 top-[30px] size-4" />
          <Input placeholder="Party name…" className="pl-9" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <div className="w-40 space-y-1">
          <Label className="text-xs">Dr / Cr</Label>
          <NativeSelect value={drCr} onChange={(v) => { setDrCr(v); setPage(1); }} options={['', 'DEBIT', 'CREDIT']} placeholder="All" />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(o) => o.id}
        isLoading={isLoading}
        emptyText="No opening balances yet — add each customer's opening bank/cash here."
        onRowClick={(o) => can('openingbalance:update') && setEditing(o)}
        actions={(o) => (
          <div className="flex justify-end gap-1">
            {can('openingbalance:update') && (
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(o)} aria-label="Edit">
                <Pencil className="size-4" />
              </Button>
            )}
            {can('openingbalance:delete') && (
              <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => handleDelete(o)} aria-label="Delete">
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        )}
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

      {(creating || editing) && (
        <OpeningDialog
          entry={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function OpeningDialog({ entry, onClose }: { entry: OpeningBalanceDto | null; onClose: () => void }) {
  const isEdit = !!entry;
  const create = useCreateOpeningBalance();
  const update = useUpdateOpeningBalance(entry?.id ?? 0);
  const saving = create.isPending || update.isPending;

  const { data: customerData } = useCustomers({ page: 1, pageSize: 1000 });
  const byLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of customerData?.items ?? []) if (c.partyName) m.set(c.partyName, c.id);
    return m;
  }, [customerData]);
  const options = useMemo(() => [...byLabel.keys()].sort((a, b) => a.localeCompare(b)), [byLabel]);

  const [party, setParty] = useState(entry?.customerName ?? '');
  const [transDate, setTransDate] = useState(entry ? entry.transDate.slice(0, 10) : ymd(new Date()));
  const [bankAmt, setBankAmt] = useState(entry ? String(entry.bankAmt) : '');
  const [cashAmt, setCashAmt] = useState(entry ? String(entry.cashAmt) : '');
  const [drCr, setDrCr] = useState<'DEBIT' | 'CREDIT'>(entry?.drCr ?? 'DEBIT');
  const [remarks, setRemarks] = useState(entry?.remarks ?? '');

  const customerId = byLabel.get(party) ?? entry?.customerId;

  const submit = () => {
    if (!party.trim()) return toast.error('Please select a party.');
    if (customerId == null) return toast.error('Customer not found — re-select the party.');
    const bank = Number(bankAmt || 0);
    const cash = Number(cashAmt || 0);
    if (!Number.isFinite(bank) || !Number.isFinite(cash) || bank < 0 || cash < 0) return toast.error('Amounts must be valid numbers.');
    if (bank <= 0 && cash <= 0) return toast.error('Enter a bank and/or cash opening amount.');

    const input = { customerId, transDate, bankAmt: bank, cashAmt: cash, drCr, remarks: remarks.trim() || null };
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'Opening balance updated' : 'Opening balance saved');
        onClose();
      },
      onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed')),
    };
    if (isEdit) update.mutate(input, opts);
    else create.mutate(input, opts);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit opening #${entry!.id}` : 'New opening balance'}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1">
            <Label className="text-xs">Party *</Label>
            <NativeSelect value={party} onChange={setParty} options={options} placeholder="Select party…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Opening date *</Label>
              <Input type="date" value={transDate} onChange={(e) => setTransDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Dr / Cr *</Label>
              <NativeSelect value={drCr} onChange={(v) => setDrCr(v as 'DEBIT' | 'CREDIT')} options={['DEBIT', 'CREDIT']} placeholder="DEBIT / CREDIT" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Bank amount</Label>
              <Input value={bankAmt} onChange={(e) => setBankAmt(e.target.value)} inputMode="decimal" placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cash amount</Label>
              <Input value={cashAmt} onChange={(e) => setCashAmt(e.target.value)} inputMode="decimal" placeholder="0" />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            <b className={drCr === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'}>{drCr}</b>{' '}
            {drCr === 'DEBIT' ? '— party owes us (cleared first by receipts).' : '— we owe the party (on-account credit).'}
          </p>
          <div className="space-y-1">
            <Label className="text-xs">Remarks</Label>
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              {isEdit ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default OpeningBalancePage;
