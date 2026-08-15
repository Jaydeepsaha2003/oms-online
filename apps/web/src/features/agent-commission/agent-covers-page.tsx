import { useMemo, useState } from 'react';
import { HandCoins, Loader2, Plus, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { AGENT_COVER_MODES, type AgentCoverMode } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAgents } from '@/features/agents/use-agents';
import { useCustomers } from '@/features/customers/use-customers';
import { useAgentCovers, useCreateCover, useRecoverCover } from './use-agent-commission';

const TH = 'bg-gradient-to-b from-blue-800 to-indigo-800 px-2 py-1.5 text-[11px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap';
const TD = 'px-2 py-1.5 text-[12.5px]';
const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const MODE_LABEL: Record<AgentCoverMode, string> = {
  CASH: 'Paid in cash',
  BANK: 'Paid by bank',
  COMMISSION_ADJUST: 'Off his commission',
};

/**
 * Amounts an agent personally covered for a party that would not pay.
 *
 * The rule that shapes this screen: the party still owes the money. Nothing here
 * touches the party's ledger — their outstanding stays exactly as it was, and
 * the "party still owes" column is read live from it. When that reaches zero the
 * party has finally paid, and the agent is due his money back.
 */
export function AgentCoversPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const canCreate = can('agentcommission:create');

  const { data: agents } = useAgents({ page: 1, pageSize: 500 });
  const agentOptions = useMemo(() => (agents?.items ?? []).map((a) => a.name), [agents]);
  const [filterAgent, setFilterAgent] = useState('');
  const [filterStatus, setFilterStatus] = useState('OPEN');
  const filterAgentId = useMemo(() => (agents?.items ?? []).find((a) => a.name === filterAgent)?.id, [agents, filterAgent]);

  const { data: covers, isLoading } = useAgentCovers(filterAgentId, filterStatus || undefined);
  const rows = covers ?? [];
  const openTotal = useMemo(() => rows.filter((c) => c.status === 'OPEN').reduce((s, c) => s + c.amount, 0), [rows]);

  const [adding, setAdding] = useState(false);
  const recover = useRecoverCover();

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 p-2.5 font-sans sm:p-3">
      <div className="bg-card font-poppins flex flex-wrap items-center gap-2 rounded-[4px] border p-2.5 shadow-sm">
        <div className="w-56">
          <NativeSelect value={filterAgent} onChange={setFilterAgent} options={['', ...agentOptions]} placeholder="All agents" />
        </div>
        <div className="w-40">
          <NativeSelect value={filterStatus} onChange={setFilterStatus} options={['', 'OPEN', 'RECOVERED', 'WRITTEN_OFF']} placeholder="Any status" />
        </div>
        {openTotal > 0 && (
          <span className="rounded-[4px] bg-amber-50 px-2 py-1 text-[12px] font-bold text-amber-800 ring-1 ring-inset ring-amber-200">
            {inr(openTotal)} outstanding to agents
          </span>
        )}
        {canCreate && (
          <Button size="sm" className="ml-auto h-9" onClick={() => setAdding(true)}>
            <Plus /> Record a cover
          </Button>
        )}
      </div>

      <div className="bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[4px] border shadow-sm">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={TH}>Covered on</th>
                <th className={TH}>Agent</th>
                <th className={TH}>Party</th>
                <th className={TH}>Invoice</th>
                <th className={cn(TH, 'text-right')}>Amount</th>
                <th className={TH}>How</th>
                <th className={cn(TH, 'text-right')}>Party still owes</th>
                <th className={TH}>Status</th>
                <th className={cn(TH, 'w-24')} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="h-28 text-center"><Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" /></td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={9} className="text-muted-foreground h-28 text-center text-[13px] font-medium">Nothing recorded.</td></tr>
              ) : (
                rows.map((c) => {
                  // The party has settled up, so the agent should get his back.
                  const partyPaid = c.partyStillOwes != null && c.partyStillOwes <= 0.5;
                  return (
                    <tr key={c.id} className={cn('border-b border-amber-200/70 even:bg-amber-50/40', c.status !== 'OPEN' && 'opacity-60')}>
                      <td className={cn(TD, 'whitespace-nowrap tabular-nums')}>{formatDate(c.coveredAt)}</td>
                      <td className={cn(TD, 'font-semibold')}>{c.agentName}</td>
                      <td className={TD}>{c.customerName}</td>
                      <td className={cn(TD, 'font-mono')}>{c.invNo || '—'}</td>
                      <td className={cn(TD, 'text-right font-bold tabular-nums')}>{inr(c.amount)}</td>
                      <td className={cn(TD, 'text-[11.5px]')}>{MODE_LABEL[c.mode] ?? c.mode}</td>
                      <td className={cn(TD, 'text-right tabular-nums')}>
                        {c.partyStillOwes == null ? <span className="text-muted-foreground">—</span>
                          : partyPaid ? <span className="font-bold text-emerald-700">nil</span>
                          : <span className="font-semibold text-rose-700">{inr(c.partyStillOwes)}</span>}
                      </td>
                      <td className={TD}>
                        <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset',
                          c.status === 'OPEN' ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200')}>
                          {c.status}
                        </span>
                        {c.status === 'OPEN' && partyPaid && (
                          <span className="ml-1 text-[10px] font-bold text-emerald-700">party paid — refund due</span>
                        )}
                      </td>
                      <td className="px-1">
                        {c.status === 'OPEN' && can('agentcommission:update') && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={async () => {
                              const ok = await confirm({
                                title: `Mark ${inr(c.amount)} returned to ${c.agentName}?`,
                                description:
                                  `Records that the agent has been repaid for ${c.customerName}${c.invNo ? ` · ${c.invNo}` : ''}. ` +
                                  'Use this when you refund him directly — a cover taken off his commission is closed automatically when that settlement is paid.',
                                confirmText: 'Mark returned',
                              });
                              if (ok) recover.mutate({ id: c.id, via: 'Refunded directly' }, { onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) });
                            }}
                          >
                            <Undo2 className="size-3" /> Returned
                          </Button>
                        )}
                        {c.status === 'RECOVERED' && <span className="text-muted-foreground text-[10.5px]">{c.recoveredVia}</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adding && <AddCoverDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddCoverDialog({ onClose }: { onClose: () => void }) {
  const { data: agents } = useAgents({ page: 1, pageSize: 500 });
  const { data: customers } = useCustomers({ page: 1, pageSize: 1000 } as never);
  const create = useCreateCover();

  const [agentName, setAgentName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [invNo, setInvNo] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<AgentCoverMode>('CASH');
  const [coveredAt, setCoveredAt] = useState(ymd(new Date()));
  const [remarks, setRemarks] = useState('');

  const agentOptions = useMemo(() => (agents?.items ?? []).map((a) => a.name), [agents]);
  const customerOptions = useMemo(() => (customers?.items ?? []).map((c) => c.partyName ?? '').filter(Boolean), [customers]);

  const save = () => {
    const agentId = (agents?.items ?? []).find((a) => a.name === agentName)?.id;
    if (!agentId) return toast.error('Choose the agent.');
    if (!customerName.trim()) return toast.error('Choose the party.');
    const amt = Number(amount);
    if (!amount.trim()) return toast.error('Enter the amount covered.');
    if (!Number.isFinite(amt) || amt <= 0) return toast.error('The amount covered must be more than zero.');
    if (!coveredAt) return toast.error('When was it covered?');
    if (coveredAt > ymd(new Date())) return toast.error('A cover cannot be dated in the future — the money has not changed hands yet.');
    // The party's ledger deliberately keeps showing the debt (§5), so without an
    // invoice there is nothing to refund the agent against later.
    if (!invNo.trim()) return toast.error('Name the invoice this covers, otherwise the agent cannot be refunded when the party pays.');
    const customerId = (customers?.items ?? []).find((c) => c.partyName === customerName)?.id;
    create.mutate(
      { agentId, customerId, customerName: customerName.trim(), invNo: invNo.trim() || null, amount: amt, mode, coveredAt, remarks: remarks.trim() || null },
      {
        onSuccess: () => { toast.success(`${inr(amt)} recorded against ${agentName}`); onClose(); },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not record it')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><HandCoins className="size-5" /> Agent covered a party&apos;s amount</DialogTitle>
          <DialogDescription>
            The party&apos;s ledger is left exactly as it is — they still owe this money. This only records that the agent has
            fronted it, so he can be repaid when they eventually pay.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Agent</Label>
              <NativeSelect value={agentName} onChange={setAgentName} options={agentOptions} placeholder="Agent…" />
            </div>
            <div className="space-y-1">
              <Label>Party</Label>
              <NativeSelect value={customerName} onChange={setCustomerName} options={customerOptions} placeholder="Party…" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Amount ₹</Label>
              <Input type="number" step="any" min={0} className="text-right tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" />
            </div>
            <div className="space-y-1">
              <Label>Covered on</Label>
              <Input type="date" className="tabular-nums" value={coveredAt} onChange={(e) => setCoveredAt(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Against invoice (optional)</Label>
            <Input value={invNo} onChange={(e) => setInvNo(e.target.value)} placeholder="SSS/26-27/187" />
            <p className="text-muted-foreground text-[11px]">Naming the bill lets the system watch it and tell you when the party finally pays.</p>
          </div>
          <div className="space-y-1">
            <Label>How</Label>
            <NativeSelect value={mode} onChange={(v) => setMode(v as AgentCoverMode)} options={[...AGENT_COVER_MODES]} renderOption={(v) => MODE_LABEL[v as AgentCoverMode] ?? v} />
            <p className="text-muted-foreground text-[11px]">
              {mode === 'COMMISSION_ADJUST'
                ? 'Offered as a deduction next time this agent is settled.'
                : 'Money handed over now — it stays owed to him until the party pays or you refund it.'}
            </p>
          </div>
          <div className="space-y-1">
            <Label>Remarks</Label>
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button onClick={save} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
