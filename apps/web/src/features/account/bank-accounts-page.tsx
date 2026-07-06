import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Landmark, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BankAccountDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useBankAccounts, useCreateBankAccount, useDeleteBankAccount, useUpdateBankAccount } from './use-account';

const PAGE_SIZE = 50;

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
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<BankAccountDto | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize: PAGE_SIZE, search: search || undefined };
  const { data, isLoading } = useBankAccounts(query);
  const del = useDeleteBankAccount();

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const columns: DataColumn<BankAccountDto>[] = [
    { id: 'bankName', label: 'Bank name', cell: (b) => <span className="font-medium">{b.bankName}</span> },
    { id: 'acNo', label: 'A/C No', cell: (b) => <span className="font-mono">{b.acNo}</span> },
    { id: 'display', label: 'Picker label', cell: (b) => <span className="font-mono text-xs">{b.display}</span> },
    { id: 'ifsc', label: 'IFSC', cell: (b) => b.ifsc ?? '—' },
    { id: 'branch', label: 'Branch', cell: (b) => b.branch ?? '—' },
    {
      id: 'active',
      label: 'Active',
      cell: (b) =>
        b.isActive ? (
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">Active</span>
        ) : (
          <span className="text-muted-foreground rounded bg-slate-100 px-1.5 py-0.5 text-xs">Inactive</span>
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
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <Landmark className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Bank Accounts</h2>
          <p className="text-muted-foreground text-sm">{data?.total ?? 0} account(s) · used as the deposit-bank picker in Manage Cheques</p>
        </div>
        {can('bankaccount:create') && (
          <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
            <Plus /> New account
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
        <Input placeholder="Search bank, A/C, branch…" className="pl-9" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(b) => b.id}
        isLoading={isLoading}
        emptyText="No bank accounts yet — add one so it appears in the cheque deposit-bank picker."
        onRowClick={(b) => can('bankaccount:update') && setEditing(b)}
        actions={(b) => (
          <div className="flex justify-end gap-1">
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
