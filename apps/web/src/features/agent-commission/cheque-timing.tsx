import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, MessageSquarePlus } from 'lucide-react';
import { toast } from 'sonner';
import { chequeTimingVerdict, type ChequeDto, type ChequeTimingDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateFollowup, useFollowupList } from '@/features/crm/use-crm';
import { useChequeTimingFor } from './use-agent-commission';

const money = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plural = (n: number, w: string) => `${n} ${w}${Math.abs(n) === 1 ? '' : 's'}`;

/**
 * §7 — Cheque date vs the party's due date.
 *
 * The point of this panel is timing: it has to be on screen while the agent is
 * still in the room, not discovered later. So it says the delay in one plain
 * sentence first, and puts the workings underneath.
 */
export function ChequeTimingPanel({ timing, loading, onRecordCommitment, className }: {
  timing?: ChequeTimingDto;
  loading?: boolean;
  /** Omitted while the cheque is unsaved — a commitment needs a cheque to hang off. */
  onRecordCommitment?: () => void;
  className?: string;
}) {
  if (loading) {
    return (
      <div className={cn('text-muted-foreground flex items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-sm', className)}>
        <Loader2 className="size-4 animate-spin" /> Checking this cheque against the party's due date…
      </div>
    );
  }
  if (!timing) return null;

  const verdict = chequeTimingVerdict(timing.delayDays);
  const late = verdict === 'LATE';

  // Nothing outstanding means there is no due date to be late against — say so
  // rather than showing a reassuring green tick that hasn't checked anything.
  if (verdict === 'UNKNOWN') {
    return (
      <div className={cn('text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm', className)}>
        <CalendarClock className="mt-0.5 size-4 shrink-0" />
        <p>
          {timing.partyOutstanding > 0
            ? `${timing.partyName} owes ${money(timing.partyOutstanding)}, but none of it carries a due date or credit period — so this cheque's date can't be checked against anything.`
            : `${timing.partyName} has nothing outstanding, so there's no due date to compare this cheque against.`}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2.5 text-sm',
        late ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        {late ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {late
              ? `This cheque is dated ${plural(timing.delayDays!, 'day')} after ${timing.partyName} was due to pay.`
              : `This cheque is in line with when ${timing.partyName} was due to pay.`}
          </p>

          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
            <dt className="opacity-80">Party was due</dt>
            <dd className="font-medium">
              {formatDate(timing.expectedDueDate!)}
              <span className="ml-1.5 font-normal opacity-80">
                {timing.dueBasis === 'CREDIT_PERIOD'
                  ? `(invoice ${formatDate(timing.oldestInvoiceDate!)} + ${plural(timing.creditPeriodDays!, 'day')} credit)`
                  : '(invoice due date)'}
              </span>
            </dd>
            <dt className="opacity-80">Cheque dated</dt>
            <dd className="font-medium">{formatDate(timing.chequeDate)}</dd>
            <dt className="opacity-80">Party owes</dt>
            <dd className="font-medium">
              {money(timing.partyOutstanding)}
              {!timing.coversOutstanding && timing.partyOutstanding > 0 && (
                <span className="ml-1.5 font-normal opacity-80">
                  — this cheque leaves {money(timing.partyOutstanding - timing.chequeAmount)} unpaid
                </span>
              )}
            </dd>
          </dl>

          {late && (
            <p className="mt-2">
              Ask {timing.agentName ? <b>{timing.agentName}</b> : 'the agent'} for an NEFT/RTGS instead before accepting it.
            </p>
          )}
        </div>
      </div>

      {late && onRecordCommitment && (
        <Button type="button" size="sm" variant="outline" className="mt-2.5 h-8 border-amber-400 bg-white/70 hover:bg-white" onClick={onRecordCommitment}>
          <MessageSquarePlus className="size-3.5" /> Record what the agent promised
        </Button>
      )}
    </div>
  );
}

/**
 * §7 + §8 for a cheque already on file: how its date sat against the party's
 * due date, and every commitment made about it since.
 */
export function ChequeTimingModal({ cheque, onClose }: { cheque: ChequeDto; onClose: () => void }) {
  const { data: timing, isLoading } = useChequeTimingFor(cheque.id);
  const { data: commitments } = useFollowupList({ page: 1, pageSize: 50, chequeId: cheque.id });
  const [recording, setRecording] = useState(false);

  const rows = commitments?.items ?? [];

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="size-5" /> Cheque {cheque.chequeNo}
            </DialogTitle>
            <DialogDescription>
              {cheque.partyName}
              {cheque.agentName ? ` · brought by ${cheque.agentName}` : ' · handed over by the party'} · {money(cheque.chequeAmt)}
            </DialogDescription>
          </DialogHeader>

          <ChequeTimingPanel timing={timing} loading={isLoading} onRecordCommitment={() => setRecording(true)} />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm">What the agent promised</Label>
              {!!rows.length && (
                <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setRecording(true)}>
                  <MessageSquarePlus className="size-3.5" /> Add
                </Button>
              )}
            </div>
            {!rows.length ? (
              <p className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-sm">
                Nothing recorded against this cheque yet.
                {timing && chequeTimingVerdict(timing.delayDays) !== 'LATE' && (
                  <>
                    {' '}
                    <button type="button" className="text-primary font-medium underline-offset-2 hover:underline" onClick={() => setRecording(true)}>
                      Record a commitment
                    </button>
                    .
                  </>
                )}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {rows.map((f) => {
                  const overdue = f.status === 'OPEN' && !!f.promisedAt && new Date(f.promisedAt) < new Date();
                  return (
                    <li key={f.id} className="rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1">{f.detail || f.title}</p>
                        <span
                          className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-inset',
                            f.status !== 'OPEN'
                              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                              : overdue
                                ? 'bg-rose-50 text-rose-700 ring-rose-200'
                                : 'bg-amber-50 text-amber-700 ring-amber-200',
                          )}
                        >
                          {f.status !== 'OPEN' ? 'done' : overdue ? 'not yet received' : 'awaiting'}
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                        {f.agentName ? `${f.agentName} · ` : ''}
                        {f.promisedAt ? `expected ${formatDate(f.promisedAt)}` : 'no date'}
                        {f.promisedAmount ? ` · ${money(f.promisedAmount)}` : ''}
                        {f.createdByName ? ` · noted by ${f.createdByName}` : ''}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {recording && timing && (
        <RecordCommitmentDialog timing={timing} agentId={cheque.agentId} customerId={cheque.customerId} onClose={() => setRecording(false)} />
      )}
    </>
  );
}

/**
 * §8 — the agent's commitment, recorded against the cheque and the party.
 *
 * This is a normal CRM follow-up, so it inherits the reminder loop and shows up
 * on the board with everything else — the owner shouldn't have to remember a
 * second place to look.
 */
export function RecordCommitmentDialog({ timing, agentId, customerId, onClose }: {
  timing: ChequeTimingDto;
  agentId?: number | null;
  customerId?: number | null;
  onClose: () => void;
}) {
  const create = useCreateFollowup();
  const defaultBy = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return ymd(d);
  }, []);

  const [detail, setDetail] = useState(
    timing.agentName
      ? `${timing.agentName} will arrange an NEFT/RTGS from ${timing.partyName} instead of waiting for cheque ${timing.chequeNo || '(this cheque)'}.`
      : '',
  );
  const [promisedAt, setPromisedAt] = useState(defaultBy);
  const [amount, setAmount] = useState(String(Math.round(timing.chequeAmount)));

  const save = () => {
    if (!detail.trim()) return toast.error('Write down what was promised.');
    const amt = Number(amount);
    create.mutate(
      {
        kind: 'PAYMENT',
        customerId: customerId ?? null,
        partyName: timing.partyName,
        agentId: agentId ?? null,
        agentName: timing.agentName,
        chequeId: timing.chequeId || null,
        title: `${timing.agentName ?? 'Agent'} — payment promised for ${timing.partyName}`,
        detail: detail.trim(),
        priority: 'URGENT',
        promisedAt,
        promisedAmount: Number.isFinite(amt) && amt > 0 ? amt : null,
      },
      {
        onSuccess: () => {
          toast.success('Commitment recorded — it will keep reminding you until it is settled.');
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not record the commitment')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What did the agent promise?</DialogTitle>
          <DialogDescription>
            Kept against {timing.chequeNo ? <b>cheque {timing.chequeNo}</b> : 'this cheque'} and {timing.partyName}, so you can check later whether it
            actually happened instead of relying on memory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm">The commitment</Label>
            <textarea
              rows={3}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="e.g. will arrange an RTGS from the party by Friday"
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-[4px] border bg-transparent px-3 py-2 text-[13px] shadow-xs outline-none focus-visible:ring-[3px]"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Expected by</Label>
              <Input type="date" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} className="h-10 tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Amount promised</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="h-10 text-right tabular-nums" />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />} Record it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
