import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { BankAccountDto } from '@oms/shared';
import { RESOURCES } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { usePageSize } from '@/hooks/use-page-size';
import { useConfirm } from '@/components/common/confirm';
import { RecordHistory } from '@/components/common/record-history';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useBankAccounts, useCreateBankAccount, useDeleteBankAccount, useUpdateBankAccount } from './use-account';

/** Matches the Pending Challan / Challans / Orders grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

const dt = (s: string) => (
  <span className="text-muted-foreground whitespace-nowrap font-mono text-xs" title={formatDateTime(s)}>
    {formatDateShort(s)}
  </span>
);

export function BankAccountsPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const { page, setPage, pageSize, setPageSize } = usePageSize('bank-accounts');
  const [editing, setEditing] = useState<BankAccountDto | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize, search: search || undefined };
  const { data, isLoading } = useBankAccounts(query);
  const del = useDeleteBankAccount();

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const columns: DataColumn<BankAccountDto>[] = [
    { id: 'bankName', label: 'Bank name', cell: (b) => <span className={TEXT_CELL}>{b.bankName}</span> },
    { id: 'acNo', label: 'A/C No', cell: (b) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{b.acNo}</span> },
    { id: 'display', label: 'Picker label', cell: (b) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{b.display}</span> },
    { id: 'ifsc', label: 'IFSC', cell: (b) => <span className={TEXT_CELL}>{b.ifsc ?? '—'}</span> },
    { id: 'branch', label: 'Branch', cell: (b) => <span className={TEXT_CELL}>{b.branch ?? '—'}</span> },
    {
      id: 'active',
      label: 'Active',
      cell: (b) =>
        b.isActive ? (
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25">Active</span>
        ) : (
          <span className="text-muted-foreground rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-white/10">Inactive</span>
        ),
    },
    { id: 'added', label: 'Added on', cell: (b) => dt(b.createdAt) },
  ];

  const handleDelete = async (b: BankAccountDto) => {
    const ok = await confirm({
      title: 'Delete bank account?',
      description: `"${b.display}" will be removed. Existing cheques keep their stored deposit-bank text.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(b.id, {
      onSuccess: () => toast.success('Bank account deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  return (
    // Fills the viewport: toolbar pinned on top, footer pinned at the bottom, only
    // the grid scrolls. `/account/bank-accounts` is a flush route (app-shell), so
    // the page owns its own padding.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <div className="relative w-full sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search bank, A/C, branch…"
              className={cn(CONTROL, 'pl-8 font-medium', searchInput && CONTROL_ON)}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          {!!searchInput && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 rounded-[4px] text-[12.5px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-400/10"
              onClick={() => setSearchInput('')}
            >
              <X className="size-3.5" /> Reset
            </Button>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {can('bankaccount:create') && (
              <Button size="sm" className="h-9 rounded-[4px] text-[12.5px] font-bold" onClick={() => setCreating(true)}>
                <Plus /> New account
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
          rowKey={(b) => b.id}
          isLoading={isLoading}
          dense
          fill
          hideSortIcon
          emptyText="No bank accounts yet — add one so it appears in the cheque deposit-bank picker."
          onRowClick={(b) => can('bankaccount:update') && setEditing(b)}
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
          actions={(b) => (
            <div className="flex justify-end gap-1">
              <RecordHistory resource={RESOURCES.BANK_ACCOUNT} resourceId={b.id} label={b.display} />
              {can('bankaccount:update') && (
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(b)} aria-label="Edit">
                  <Pencil className="size-4" />
                </Button>
              )}
              {can('bankaccount:delete') && (
                <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => handleDelete(b)} aria-label="Delete">
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
        <BankAccountDialog
          account={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function BankAccountDialog({ account, onClose }: { account: BankAccountDto | null; onClose: () => void }) {
  const isEdit = !!account;
  const create = useCreateBankAccount();
  const update = useUpdateBankAccount(account?.id ?? 0);
  const saving = create.isPending || update.isPending;

  const [bankName, setBankName] = useState(account?.bankName ?? '');
  const [acNo, setAcNo] = useState(account?.acNo ?? '');
  const [ifsc, setIfsc] = useState(account?.ifsc ?? '');
  const [branch, setBranch] = useState(account?.branch ?? '');
  const [isActive, setIsActive] = useState(account?.isActive ?? true);

  const submit = () => {
    if (!bankName.trim()) return toast.error('Bank name is required');
    if (!acNo.trim()) return toast.error('Account number is required');
    const input = {
      bankName: bankName.trim(),
      acNo: acNo.trim(),
      ifsc: ifsc.trim() || null,
      branch: branch.trim() || null,
      isActive,
    };
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'Bank account updated' : 'Bank account created');
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
          <DialogTitle>{isEdit ? `Edit bank account #${account!.id}` : 'New bank account'}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label>Bank name *</Label>
            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} className="uppercase" autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Account number *</Label>
            <Input value={acNo} onChange={(e) => setAcNo(e.target.value)} className="font-mono" />
            <p className="text-muted-foreground text-xs">Picker shows: <b className="font-mono">{bankName || 'BANK'}-{(acNo.replace(/\s+/g, '').slice(-4)) || '####'}</b></p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>IFSC</Label>
              <Input value={ifsc} onChange={(e) => setIfsc(e.target.value)} className="uppercase" />
            </div>
            <div className="space-y-2">
              <Label>Branch</Label>
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} className="uppercase" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4" />
            Active (show in the deposit-bank picker)
          </label>
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

export default BankAccountsPage;
