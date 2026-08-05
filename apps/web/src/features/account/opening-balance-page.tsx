import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { OpeningBalanceDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { usePageSize } from '@/hooks/use-page-size';
import { useConfirm } from '@/components/common/confirm';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCustomers } from '@/features/customers/use-customers';
import { useCreateOpeningBalance, useDeleteOpeningBalance, useOpeningBalances, useUpdateOpeningBalance } from './use-account';

/** Matches the Pending Challan / Challans / Orders grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';
const money = (v: number) => `₹ ${(v ?? 0).toLocaleString('en-IN')}`;
// Delegates to the shared formatter so this page follows the system-wide date format.
const prettyDate = (iso: string | null) => formatDate(iso);
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function OpeningBalancePage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [drCr, setDrCr] = useState('');
  const { page, setPage, pageSize, setPageSize } = usePageSize('opening-balance');
  const [editing, setEditing] = useState<OpeningBalanceDto | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize, search: search || undefined, drCr: drCr || undefined };
  const { data, isLoading } = useOpeningBalances(query);
  const del = useDeleteOpeningBalance();

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const hasFilters = !!search || !!drCr;
  const resetFilters = () => {
    setSearchInput('');
    setSearch('');
    setDrCr('');
    setPage(1);
  };

  const columns: DataColumn<OpeningBalanceDto>[] = [
    { id: 'date', label: 'Date', cell: (o) => <span className={cn(TEXT_CELL, 'whitespace-nowrap tabular-nums')}>{prettyDate(o.transDate)}</span> },
    { id: 'party', label: 'Party', cell: (o) => <span className={TEXT_CELL}>{o.customerName}</span> },
    {
      id: 'drcr',
      label: 'Dr / Cr',
      cell: (o) => (
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset', o.drCr === 'DEBIT' ? 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25' : 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25')}>
          {o.drCr}
        </span>
      ),
    },
    { id: 'bank', label: 'Bank', align: 'right', cell: (o) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(o.bankAmt)}</span> },
    { id: 'cash', label: 'Cash', align: 'right', cell: (o) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money(o.cashAmt)}</span> },
    { id: 'total', label: 'Total', align: 'right', cell: (o) => <span className="text-[14px] font-bold tabular-nums text-slate-900 dark:text-slate-100">{money(o.bankAmt + o.cashAmt)}</span> },
    { id: 'remarks', label: 'Remarks', cell: (o) => <span className="text-muted-foreground text-[13px]">{o.remarks ?? '—'}</span> },
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
    // Fills the viewport: toolbar pinned on top, footer pinned at the bottom, only
    // the grid scrolls. `/account/opening-balance` is a flush route (app-shell), so
    // the page owns its own padding.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <div className="relative w-full sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search party…"
              className={cn(CONTROL, 'pl-8 font-medium', searchInput && CONTROL_ON)}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="w-40">
            <NativeSelect value={drCr} onChange={(v) => { setDrCr(v); setPage(1); }} options={['', 'DEBIT', 'CREDIT']} placeholder="All Dr / Cr" className={cn(CONTROL, 'font-medium', drCr && CONTROL_ON)} />
          </div>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 rounded-[4px] text-[12.5px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-400/10"
              onClick={resetFilters}
            >
              <X className="size-3.5" /> Reset
            </Button>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {can('openingbalance:create') && (
              <Button size="sm" className="h-9 rounded-[4px] text-[12.5px] font-bold" onClick={() => setCreating(true)}>
                <Plus /> New opening
              </Button>
            )}
          </div>
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
          rows={items}
          rowKey={(o) => o.id}
          isLoading={isLoading}
          dense
          fill
          hideSortIcon
          emptyText="No opening balances yet — add each customer's opening bank/cash here."
          onRowClick={(o) => can('openingbalance:update') && setEditing(o)}
          className={[
            'font-sans text-[13px]',
            '[&_tbody]:select-none',
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
      </div>

      <div className="bg-card flex items-center justify-between rounded-[4px] border px-3 py-2 shadow-sm">
        <p className="text-muted-foreground text-[12px] font-medium">
          Page <span className="font-bold tabular-nums text-foreground">{data?.page ?? page}</span> of{' '}
          <span className="font-bold tabular-nums text-foreground">{totalPages}</span>
        </p>
        <div className="flex items-center gap-3">
          <PageSizeSelect value={pageSize} onChange={setPageSize} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft /> Prev
            </Button>
            <Button variant="outline" size="sm" className="rounded-[4px] font-semibold" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next <ChevronRight />
            </Button>
          </div>
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

  useSaveShortcut(submit);

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
