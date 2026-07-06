import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Landmark,
  Loader2,
  Plus,
  ReceiptIndianRupee,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ChequeDto, ChequeStatus } from '@oms/shared';
import { CHARGES_PAID_BY } from '@oms/shared';
import { cn } from '@/lib/utils';
import { getApiErrorMessage } from '@/lib/api';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCustomers } from '@/features/customers/use-customers';
import {
  useActiveBankAccounts,
  useCheques,
  useChequeReminders,
  useChequeSummary,
  useCreateCheque,
  useDeleteCheque,
  useDepositCheque,
  useDepositedCheques,
  useSettleCheque,
} from './use-account';

const PAGE_SIZE = 50;
const money = (v: number | null | undefined) => `₹ ${(v ?? 0).toLocaleString('en-IN')}`;

/** yyyy-mm-dd in LOCAL time (date inputs + server payloads). */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const ymdOf = (iso: string) => ymd(new Date(iso));
const prettyDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const TODAY = () => ymd(new Date());

/** Days from today to a due date (negative = overdue). */
function daysToDue(dueIso: string): number {
  const due = new Date(dueIso);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

const STATUS_META: Record<ChequeStatus, { label: string; cls: string }> = {
  PENDING: { label: 'PENDING', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  DEPOSITED: { label: 'DEPOSITED', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  CLEARED: { label: 'CLEARED', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  BOUNCED: { label: 'BOUNCED', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
};

export function ManageChequesPage() {
  const { can } = usePermissions();
  const canCreate = can('cheque:create');
  const canUpdate = can('cheque:update');
  const canDelete = can('cheque:delete');

  const { data: summary } = useChequeSummary();

  // grid filters
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const query = { page: 1, pageSize: PAGE_SIZE, status: status || undefined, search: searchInput.trim() || undefined };
  const { data: gridData, isLoading } = useCheques(query);

  // modals
  const [addOpen, setAddOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleId, setSettleId] = useState<number | ''>('');
  const [depositCheque, setDepositCheque] = useState<ChequeDto | null>(null);

  const openSettle = (id: number | '') => {
    setSettleId(id);
    setSettleOpen(true);
  };

  const del = useDeleteCheque();
  const confirm = useConfirm();

  const removeCheque = async (c: ChequeDto) => {
    const ok = await confirm({
      title: `Delete cheque ${c.chequeNo}?`,
      description: `This ${c.status} cheque for ${c.partyName} (${money(c.chequeAmt)}) will be permanently deleted.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(c.id, {
      onSuccess: () => toast.success(`${c.chequeNo} deleted`),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  const columns: DataColumn<ChequeDto>[] = useMemo(
    () => [
      { id: 'recDate', label: 'Rec Date', sortValue: (c) => c.recDate, cell: (c) => <span className="whitespace-nowrap">{prettyDate(c.recDate)}</span> },
      { id: 'chequeNo', label: 'Cheque No', cell: (c) => <span className="font-mono font-semibold">{c.chequeNo}</span> },
      { id: 'party', label: 'Party', cell: (c) => <span className="font-medium">{c.partyName}</span> },
      { id: 'drawerBank', label: 'Deposit Bank', cell: (c) => c.drawerBank ?? '—' },
      { id: 'amt', label: 'Cheque Amt', align: 'right', sortValue: (c) => c.chequeAmt ?? 0, cell: (c) => <span className="tabular-nums font-semibold">{money(c.chequeAmt)}</span> },
      {
        id: 'status',
        label: 'Status',
        cell: (c) => {
          const m = STATUS_META[c.status] ?? STATUS_META.PENDING;
          return (
            <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset', m.cls)}>
              {m.label}
              {c.isRepresent && <span className="ml-1 text-amber-600" title="Marked for re-deposit">↻</span>}
            </span>
          );
        },
      },
      { id: 'dueDate', label: 'Due Date', sortValue: (c) => c.dueDate, cell: (c) => <span className="whitespace-nowrap">{prettyDate(c.dueDate)}</span> },
      { id: 'depDate', label: 'Deposit Date', cell: (c) => <span className="whitespace-nowrap">{prettyDate(c.depositDate)}</span> },
      { id: 'transDate', label: 'Clear/Bounce Date', cell: (c) => <span className="whitespace-nowrap">{prettyDate(c.acctTransDate)}</span> },
      { id: 'bounce', label: 'Bounce Chg', align: 'right', cell: (c) => (c.bounceCharges != null ? <span className="tabular-nums text-rose-700">{money(c.bounceCharges)}</span> : <span className="text-muted-foreground">—</span>) },
      { id: 'paidBy', label: 'Charges By', cell: (c) => c.chargesPaidBy ?? '—' },
      { id: 'payee', label: 'Payee Bank', cell: (c) => c.payeeBank ?? '—' },
      { id: 'represent', label: 'Represented', cell: (c) => (c.isRepresent ? 'TRUE' : 'FALSE') },
      { id: 'comments', label: 'Comments', cell: (c) => <span className="text-muted-foreground">{c.comments ?? '—'}</span> },
    ],
    [],
  );

  const rowActions = (c: ChequeDto) => (
    <div className="flex items-center justify-end gap-1.5">
      {canUpdate && c.status === 'PENDING' && (
        <button onClick={() => setDepositCheque(c)} className="text-muted-foreground hover:text-blue-600" title="Deposit">
          <Banknote className="size-4" />
        </button>
      )}
      {canUpdate && c.status === 'DEPOSITED' && (
        <button onClick={() => openSettle(c.id)} className="text-muted-foreground hover:text-emerald-600" title="Clear / Bounce">
          <CheckCircle2 className="size-4" />
        </button>
      )}
      {canDelete && (
        <button onClick={() => removeCheque(c)} className="text-muted-foreground hover:text-destructive" title="Delete">
          <Trash2 className="size-4" />
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header: title + the two modal launchers */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <ReceiptIndianRupee className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Manage Cheques</h2>
          <p className="text-muted-foreground text-sm">Add received cheques, deposit on/after due date, and record clear/bounce outcomes.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canUpdate && (
            <Button variant="outline" onClick={() => openSettle('')} title="Mark a deposited cheque cleared or bounced">
              <CheckCircle2 className="text-emerald-600" /> Clear / Bounce
            </Button>
          )}
          {canCreate && (
            <Button className="bg-gradient-brand text-white shadow-sm hover:opacity-95" onClick={() => setAddOpen(true)}>
              <Plus /> Add Cheque
            </Button>
          )}
        </div>
      </div>

      {/* KPI chips */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Pending" count={summary?.pending.count} amount={summary?.pending.amount} tone="slate" />
        <Kpi label="Overdue to deposit" count={summary?.overdue.count} amount={summary?.overdue.amount} tone="amber" />
        <Kpi label="Deposited" count={summary?.deposited.count} amount={summary?.deposited.amount} tone="blue" />
        <Kpi label="Cleared" count={summary?.cleared.count} amount={summary?.cleared.amount} tone="emerald" />
        <Kpi label="Bounced" count={summary?.bounced.count} amount={summary?.bounced.amount} tone="rose" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_350px]">
        {/* LEFT: filters + grid */}
        <div className="min-w-0 space-y-3">
          <div className="bg-card flex flex-wrap items-end gap-2 rounded-md border p-3 shadow-sm">
            <div className="w-44 space-y-1">
              <Label className="text-xs">Status</Label>
              <NativeSelect value={status} onChange={setStatus} options={['', 'PENDING', 'DEPOSITED', 'CLEARED', 'BOUNCED']} placeholder="All statuses" />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Search</Label>
              <Input placeholder="Cheque no, party, bank…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            </div>
          </div>

          <DataTable
            columns={columns}
            rows={gridData?.items ?? []}
            rowKey={(c) => c.id}
            isLoading={isLoading}
            dense
            className="text-[15px] [&_thead_th]:text-[13px] [&_td]:py-2 [&_th]:py-2 [&_tbody_button]:size-8"
            maxBodyHeight="max-h-[calc(100dvh_-_26rem)]"
            actions={rowActions}
            emptyText="No cheques match the current filter."
          />
        </div>

        {/* RIGHT: reminder cards */}
        <ReminderColumn onOpen={setDepositCheque} />
      </div>

      {addOpen && <AddChequeModal onClose={() => setAddOpen(false)} />}
      {settleOpen && <SettleModal initialId={settleId} onClose={() => { setSettleOpen(false); setSettleId(''); }} />}
      {depositCheque && <DepositModal cheque={depositCheque} onClose={() => setDepositCheque(null)} />}
    </div>
  );
}

/* ── KPI chip ─────────────────────────────────────────────────────────────── */

function Kpi({ label, count, amount, tone }: { label: string; count?: number; amount?: number; tone: 'slate' | 'amber' | 'blue' | 'emerald' | 'rose' }) {
  const toneCls = {
    slate: 'border-slate-200 bg-slate-50/60',
    amber: 'border-amber-200 bg-amber-50/60',
    blue: 'border-blue-200 bg-blue-50/60',
    emerald: 'border-emerald-200 bg-emerald-50/60',
    rose: 'border-rose-200 bg-rose-50/60',
  }[tone];
  return (
    <div className={cn('rounded-lg border p-3 shadow-sm', toneCls)}>
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{count ?? 0}</p>
      <p className="text-muted-foreground text-sm tabular-nums">{money(amount)}</p>
    </div>
  );
}

/* ── Add Cheque modal ─────────────────────────────────────────────────────── */

function AddChequeModal({ onClose }: { onClose: () => void }) {
  const create = useCreateCheque();
  const { data: customerData } = useCustomers({ page: 1, pageSize: 1000 });
  const { data: banks } = useActiveBankAccounts();

  const byLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of customerData?.items ?? []) if (c.partyName) m.set(c.partyName, c.id);
    return m;
  }, [customerData]);
  const partyOptions = useMemo(() => [...byLabel.keys()].sort((a, b) => a.localeCompare(b)), [byLabel]);
  const bankOptions = useMemo(() => (banks ?? []).map((b) => b.display), [banks]);

  const [party, setParty] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [chequeAmt, setChequeAmt] = useState('');
  const [payeeBank, setPayeeBank] = useState('');
  const [drawerBank, setDrawerBank] = useState('');
  const [recDate, setRecDate] = useState(TODAY);
  const [dueDate, setDueDate] = useState(TODAY);
  const [comments, setComments] = useState('');

  const customerId = byLabel.get(party);

  const clear = () => {
    setParty('');
    setChequeNo('');
    setChequeAmt('');
    setPayeeBank('');
    setDrawerBank('');
    setRecDate(TODAY());
    setDueDate(TODAY());
    setComments('');
  };

  const submit = () => {
    // Validation mirrors the legacy "ADD CHEQUE" guards, in order.
    if (!party.trim()) return toast.error('Please select Party Name.');
    if (customerId == null) return toast.error('Customer ID is missing. Please re-select Party Name.');
    if (!chequeNo.trim()) return toast.error('Please enter Cheque No.');
    const amt = Number(chequeAmt);
    if (!chequeAmt.trim() || !Number.isFinite(amt) || amt <= 0) return toast.error('Please enter a valid Cheque Amount.');
    if (!drawerBank.trim()) return toast.error('Please select Drawer (deposit) Bank.');

    create.mutate(
      {
        partyName: party.trim(),
        customerId,
        chequeNo: chequeNo.trim().toUpperCase(),
        chequeAmt: amt,
        payeeBank: payeeBank.trim().toUpperCase() || null,
        drawerBank: drawerBank.trim(),
        recDate,
        dueDate,
        comments: comments.trim().toUpperCase() || null,
      },
      {
        onSuccess: () => {
          toast.success('Cheque saved successfully.');
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Error saving cheque')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <span className="bg-gradient-brand flex size-8 items-center justify-center rounded-lg text-white shadow-sm ring-1 ring-white/20">
              <Plus className="size-4" />
            </span>
            Add Cheque
          </DialogTitle>
          <DialogDescription className="text-base">Record a cheque received from a party.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-sm">Party Name *</Label>
            <NativeSelect value={party} onChange={setParty} options={partyOptions} placeholder="Select party…" className="h-10 text-base" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Cheque No *</Label>
            <Input value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} className="h-10 text-base uppercase" placeholder="Cheque number" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Cheque Amt *</Label>
            <Input value={chequeAmt} onChange={(e) => setChequeAmt(e.target.value)} inputMode="decimal" placeholder="0" className="h-10 text-right text-base font-semibold tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Payee Bank</Label>
            <Input value={payeeBank} onChange={(e) => setPayeeBank(e.target.value)} className="h-10 text-base uppercase" placeholder="Party's bank (optional)" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Drawer (Deposit) Bank *</Label>
            <NativeSelect value={drawerBank} onChange={setDrawerBank} options={bankOptions} placeholder="Our deposit account…" className="h-10 text-base" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Comments</Label>
            <Input value={comments} onChange={(e) => setComments(e.target.value)} className="h-10 text-base uppercase" placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Rec Date *</Label>
            <Input type="date" value={recDate} onChange={(e) => setRecDate(e.target.value)} className="h-10 text-base" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Due Date *</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-10 text-base" />
          </div>
        </div>

        {bankOptions.length === 0 && (
          <p className="flex items-center gap-1.5 text-sm text-amber-600">
            <Landmark className="size-4" /> No active bank accounts yet — add one under Account → Bank Accounts to populate the deposit-bank picker.
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="h-10" onClick={clear}>
            <RotateCcw /> Clear
          </Button>
          <Button className="h-10" onClick={submit} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add Cheque
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Clear / Bounce modal ─────────────────────────────────────────────────── */

function SettleModal({ initialId, onClose }: { initialId: number | ''; onClose: () => void }) {
  const { data: deposited } = useDepositedCheques();
  const settle = useSettleCheque();

  const byNo = useMemo(() => {
    const m = new Map<string, ChequeDto>();
    for (const c of deposited ?? []) m.set(c.chequeNo, c);
    return m;
  }, [deposited]);
  const options = useMemo(() => (deposited ?? []).map((c) => c.chequeNo), [deposited]);

  const preselected = (deposited ?? []).find((c) => c.id === initialId) ?? null;
  const [chequeNo, setChequeNo] = useState('');
  const syncedNo = chequeNo || (preselected ? preselected.chequeNo : '');
  const current = byNo.get(syncedNo) ?? preselected;

  const [outcome, setOutcome] = useState<'CLEARED' | 'BOUNCED' | ''>('');
  const [transDate, setTransDate] = useState(TODAY);
  const [bounceCharges, setBounceCharges] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [redeposit, setRedeposit] = useState(false);

  const submit = () => {
    if (!current) return toast.error('Please select a deposited cheque first.');
    if (!outcome) return toast.error('Please select Cleared or Bounced.');
    if (!transDate) return toast.error('Please select the Clear/Bounce date.');
    let charges: number | null = null;
    if (outcome === 'BOUNCED' && bounceCharges.trim()) {
      const n = Number(bounceCharges);
      if (!Number.isFinite(n) || n < 0) return toast.error('Bounce Charges must be a valid number.');
      charges = n;
    }
    settle.mutate(
      {
        id: current.id,
        input: {
          status: outcome,
          acctTransDate: transDate,
          bounceCharges: outcome === 'BOUNCED' ? charges : null,
          chargesPaidBy: outcome === 'BOUNCED' ? (paidBy || null) : null,
          isRepresent: outcome === 'BOUNCED' ? redeposit : false,
        },
      },
      {
        onSuccess: () => {
          toast.success(`Cheque ${current.chequeNo} marked ${outcome}.`);
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Error updating record')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm ring-1 ring-white/20">
              <CheckCircle2 className="size-4" />
            </span>
            Clear / Bounce Cheque
          </DialogTitle>
          <DialogDescription className="text-base">Record the bank outcome for a deposited cheque.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="text-sm">Cheque No (deposited) *</Label>
            <NativeSelect
              value={syncedNo}
              onChange={setChequeNo}
              options={options}
              placeholder={options.length ? 'Select deposited cheque…' : 'No deposited cheques'}
              className="h-10 text-base"
            />
          </div>

          {current && (
            <div className="text-muted-foreground rounded-md border bg-muted/40 px-3 py-2.5 text-sm">
              <b className="text-foreground">{current.partyName}</b> · {money(current.chequeAmt)} · deposited {prettyDate(current.depositDate)} · into {current.drawerBank}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-sm">Outcome *</Label>
            <div className="flex flex-wrap gap-2">
              <OutcomeBtn active={outcome === 'CLEARED'} onClick={() => setOutcome('CLEARED')} icon={CheckCircle2} label="Cheque Cleared" tone="emerald" />
              <OutcomeBtn active={outcome === 'BOUNCED'} onClick={() => setOutcome('BOUNCED')} icon={XCircle} label="Cheque Bounced" tone="rose" />
            </div>
          </div>

          {outcome && (
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm">{outcome === 'CLEARED' ? 'Clear Date *' : 'Bounce Date *'}</Label>
                <Input type="date" value={transDate} onChange={(e) => setTransDate(e.target.value)} className="h-10 text-base" />
              </div>
              {outcome === 'BOUNCED' && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Bounce Charge</Label>
                    <Input value={bounceCharges} onChange={(e) => setBounceCharges(e.target.value)} inputMode="decimal" placeholder="0" className="h-10 text-right text-base tabular-nums" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Charges Paid By</Label>
                    <NativeSelect value={paidBy} onChange={setPaidBy} options={['', ...CHARGES_PAID_BY]} placeholder="SELF / PARTY" className="h-10 text-base" />
                  </div>
                  <label className="flex items-center gap-2 pt-6 text-base">
                    <input type="checkbox" checked={redeposit} onChange={(e) => setRedeposit(e.target.checked)} className="size-4" />
                    Is Cheque Re-Deposit?
                  </label>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="h-10" onClick={onClose}>
            Cancel
          </Button>
          <Button className="h-10" onClick={submit} disabled={settle.isPending || !current}>
            {settle.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Save Outcome
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OutcomeBtn({
  active,
  onClick,
  icon: Icon,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof CheckCircle2;
  label: string;
  tone: 'emerald' | 'rose';
}) {
  const activeCls = tone === 'emerald' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-rose-500 bg-rose-50 text-rose-700';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-base font-medium transition-colors',
        active ? activeCls : 'text-muted-foreground hover:bg-muted/50',
      )}
    >
      <Icon className="size-4" /> {label}
    </button>
  );
}

/* ── Reminder column ──────────────────────────────────────────────────────── */

function ReminderColumn({ onOpen }: { onOpen: (c: ChequeDto) => void }) {
  const { data: reminders, isLoading } = useChequeReminders();
  const list = reminders ?? [];

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 rounded-md bg-rose-600 px-3 py-2 font-semibold text-white shadow-sm">
        <CalendarClock className="size-4" /> Upcoming Reminder ({list.length})
      </div>
      <div className="max-h-[calc(100dvh_-_22rem)] space-y-2.5 overflow-y-auto pr-0.5">
        {isLoading ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : list.length === 0 ? (
          <div className="text-muted-foreground grid place-items-center rounded-lg border border-dashed py-10 text-center text-sm">
            <CheckCircle2 className="mb-2 size-7 text-emerald-500 opacity-60" />
            No pending cheques to deposit. 🎉
          </div>
        ) : (
          list.map((c) => <ReminderCard key={c.id} cheque={c} onClick={() => onOpen(c)} />)
        )}
      </div>
    </div>
  );
}

function ReminderCard({ cheque, onClick }: { cheque: ChequeDto; onClick: () => void }) {
  const days = daysToDue(cheque.dueDate);
  const { msg, cls, bar } =
    days > 0
      ? { msg: `Deposit in ${days} day(s)!`, cls: 'text-emerald-700', bar: 'from-emerald-500/15 to-emerald-500/5 border-emerald-200' }
      : days === 0
        ? { msg: 'Deposit today!', cls: 'text-amber-700', bar: 'from-amber-500/15 to-amber-500/5 border-amber-200' }
        : { msg: `Overdue by ${Math.abs(days)} day(s)!`, cls: 'text-rose-700', bar: 'from-rose-500/15 to-rose-500/5 border-rose-200' };
  // Legacy: due within 3 days → orange accent
  const soon = days > 0 && days <= 3;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('block w-full rounded-lg border bg-gradient-to-b p-3 text-left shadow-sm transition-transform hover:-translate-y-0.5', bar, soon && 'from-amber-500/15 to-amber-500/5 border-amber-200')}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-base font-bold text-slate-800">Cheque No: {cheque.chequeNo}</span>
        <ChevronRight className="text-muted-foreground size-4" />
      </div>
      <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
        <span className="text-muted-foreground font-semibold">Party:</span>
        <span className="truncate">{cheque.partyName}</span>
        <span className="text-muted-foreground font-semibold">Bank:</span>
        <span className="truncate">{cheque.drawerBank ?? '—'}</span>
        <span className="text-muted-foreground font-semibold">Amount:</span>
        <span className="tabular-nums">{money(cheque.chequeAmt)}</span>
        <span className="text-muted-foreground font-semibold">Due:</span>
        <span>{prettyDate(cheque.dueDate)}</span>
      </div>
      <div className={cn('mt-1.5 text-sm font-bold', cls)}>{msg}</div>
    </button>
  );
}

/* ── Deposit modal ────────────────────────────────────────────────────────── */

function DepositModal({ cheque, onClose }: { cheque: ChequeDto; onClose: () => void }) {
  const deposit = useDepositCheque();
  const confirm = useConfirm();
  const dueYmd = ymdOf(cheque.dueDate);
  // Prefill to max(today, dueDate) — you can never deposit before the due date.
  const initial = TODAY() < dueYmd ? dueYmd : TODAY();
  const [depositDate, setDepositDate] = useState(cheque.depositDate ? ymdOf(cheque.depositDate) : initial);

  const days = daysToDue(cheque.dueDate);
  const statusLine =
    days < 0 ? { text: `Due date crossed by ${Math.abs(days)} day(s).`, cls: 'text-rose-600' } : days === 0 ? { text: 'Deposit today!', cls: 'text-amber-600' } : { text: `Deposit in ${days} day(s).`, cls: 'text-emerald-600' };

  const save = async () => {
    if (depositDate < dueYmd) {
      return toast.error(`You can deposit this cheque only on/after ${prettyDate(cheque.dueDate)}.`);
    }
    const ok = await confirm({
      title: 'Confirm Deposit',
      description: `You can deposit this cheque only on/after ${prettyDate(cheque.dueDate)}.\n\nSelected Deposit Date: ${prettyDate(new Date(depositDate).toISOString())}\n\nProceed?`,
      confirmText: 'Yes, deposit',
    });
    if (!ok) return;
    deposit.mutate(
      { id: cheque.id, input: { depositDate } },
      {
        onSuccess: () => {
          toast.success(`Deposited ${cheque.chequeNo} · ${cheque.partyName} on ${prettyDate(new Date(depositDate).toISOString())}`);
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Error saving deposit')),
      },
    );
  };

  const Row = ({ k, v }: { k: string; v: string }) => (
    <>
      <div className="text-muted-foreground font-semibold">{k}</div>
      <div className="font-medium">{v}</div>
    </>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Banknote className="text-primary size-5" /> Cheque Details
          </DialogTitle>
          <DialogDescription className="text-base">Deposit is allowed only on or after the due date.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-2 text-base">
          <Row k="Party Name:" v={cheque.partyName} />
          <Row k="Cheque No:" v={cheque.chequeNo} />
          <Row k="Cheque Amount:" v={money(cheque.chequeAmt)} />
          <Row k="Payee Bank:" v={cheque.payeeBank ?? '—'} />
          <Row k="Deposit Into:" v={cheque.drawerBank ?? '—'} />
          <Row k="Receipt Date:" v={prettyDate(cheque.recDate)} />
          <Row k="Due Date:" v={prettyDate(cheque.dueDate)} />
        </div>

        <div className={cn('flex items-center gap-1.5 text-base font-semibold', statusLine.cls)}>
          <AlertTriangle className="size-4" /> {statusLine.text}
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">Deposit Date *</Label>
          <Input type="date" min={dueYmd} value={depositDate} onChange={(e) => setDepositDate(e.target.value)} className="h-10 w-56 text-base" />
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-10" onClick={onClose}>Cancel</Button>
          <Button className="h-10" onClick={save} disabled={deposit.isPending}>
            {deposit.isPending ? <Loader2 className="animate-spin" /> : <Banknote />} Deposit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ManageChequesPage;
