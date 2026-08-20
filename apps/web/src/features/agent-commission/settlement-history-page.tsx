import { Fragment, useMemo, useState } from 'react';
import { Ban, Banknote, Check, ChevronDown, ChevronRight, Clock, FileText, Loader2, Wallet, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  AGENT_SETTLEMENT_STATUSES,
  basisUnit,
  type AgentSettlementDto,
  type AgentSettlementStatus,
} from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDateFormat } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useAgents } from '@/features/agents/use-agents';
import { useCancelSettlement, usePaySettlement, useSettlements } from './use-agent-commission';

const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const TH = 'bg-gradient-to-b from-blue-800 to-indigo-800 px-2 py-1.5 text-[11px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap';
const TD = 'px-2 py-1.5 text-[12.5px]';

const STATUS_META: Record<AgentSettlementStatus, { label: string; chip: string; Icon: typeof Check }> = {
  DRAFT: {
    label: 'Draft',
    chip: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25',
    Icon: Clock,
  },
  PAID: {
    label: 'Paid',
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25',
    Icon: Check,
  },
  CANCELLED: {
    label: 'Cancelled',
    chip: 'bg-slate-100 text-slate-500 ring-slate-200 dark:bg-white/10 dark:text-slate-400 dark:ring-white/10',
    Icon: XCircle,
  },
};

function StatusChip({ status }: { status: AgentSettlementStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset', m.chip)}>
      <m.Icon className="size-3" /> {m.label}
    </span>
  );
}

/**
 * Agent → Settlement History
 * --------------------------
 * Every settlement ever raised, and the only place a saved DRAFT can be paid or
 * cancelled.
 *
 * "Settle & pay" on the Settlement screen covers the agent standing at the desk.
 * "Save as draft" covers everything else — and until now a draft went nowhere:
 * it held its invoices' claimable share against future settlements while being
 * invisible and unpayable. This is the other half of that button.
 *
 * A PAID settlement is deliberately immutable here. Money left the building; the
 * server refuses to cancel it, and the correct fix is a fresh entry, not editing
 * history.
 */
export function SettlementHistoryPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const { formatDate } = useDateFormat();
  const canSettle = can('agentcommission:settle');
  const canCancel = can('agentcommission:update');

  const { data: agents } = useAgents({ page: 1, pageSize: 500 });
  const [agentName, setAgentName] = useState('');
  const agentId = useMemo(() => (agents?.items ?? []).find((a) => a.name === agentName)?.id, [agents, agentName]);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());

  const { data, isLoading, isFetching } = useSettlements(agentId, status || undefined);
  const rows = data ?? [];

  const pay = usePaySettlement();
  const cancel = useCancelSettlement();
  const busy = pay.isPending || cancel.isPending;

  // Drafts and paid money are different questions, so they are counted apart —
  // a total mixing "owed" with "already handed over" answers neither.
  const totals = useMemo(() => {
    const of = (s: AgentSettlementStatus) => rows.filter((r) => r.status === s);
    const sum = (list: AgentSettlementDto[]) => list.reduce((a, r) => a + r.netPayable, 0);
    const drafts = of('DRAFT');
    const paid = of('PAID');
    return { drafts: drafts.length, draftValue: sum(drafts), paid: paid.length, paidValue: sum(paid) };
  }, [rows]);

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const doPay = async (s: AgentSettlementDto) => {
    const ok = await confirm({
      title: `Pay ${inr(s.netPayable)} to ${s.agentName}?`,
      description:
        `${s.code ?? `Settlement ${s.id}`} · ${s.lines.length} invoice${s.lines.length === 1 ? '' : 's'} · gross ${inr(s.grossCommission)}` +
        `${s.tdsAmount ? ` · less TDS ${inr(s.tdsAmount)}` : ''}. ` +
        'Once paid, these invoices can never be claimed again.',
      confirmText: `Pay ${inr(s.netPayable)}`,
    });
    if (!ok) return;
    pay.mutate(
      { id: s.id, payMode: s.payMode ?? 'BANK', tdsPercent: s.tdsPercent },
      {
        onSuccess: () => toast.success(`${s.code ?? 'Settlement'} paid — ${inr(s.netPayable)} to ${s.agentName}`),
        // The server re-derives every figure before paying, so a draft raised
        // before the party paid more (or before another settlement claimed the
        // same invoice) is REFUSED with an explanation. Surface it verbatim —
        // "could not pay" would hide the one thing the user needs to know.
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not pay this settlement')),
      },
    );
  };

  const doCancel = async (s: AgentSettlementDto) => {
    const ok = await confirm({
      title: `Cancel ${s.code ?? `settlement ${s.id}`}?`,
      description:
        `The ${s.lines.length} invoice${s.lines.length === 1 ? '' : 's'} on it become claimable again on a future settlement. ` +
        'Nothing has been paid, so no money is affected.',
      confirmText: 'Cancel settlement',
      cancelText: 'Keep it',
      destructive: true,
    });
    if (!ok) return;
    cancel.mutate(s.id, {
      onSuccess: () => toast.success(`${s.code ?? 'Settlement'} cancelled`),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Could not cancel this settlement')),
    });
  };

  return (
    <div className="space-y-3 p-2.5 font-sans sm:p-3">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="bg-gradient-brand flex size-9 items-center justify-center rounded-[4px] text-white shadow-md shadow-blue-600/20 ring-1 ring-white/20">
          <FileText className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-[17px] leading-tight font-bold tracking-tight">Settlement History</h2>
          <p className="text-muted-foreground truncate text-[11.5px] font-medium">
            Every settlement raised — and where a saved draft gets paid
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-muted-foreground rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums dark:bg-white/10">
            {rows.length}
          </span>
          {isFetching && <Loader2 className="text-muted-foreground size-3.5 animate-spin" />}
        </div>
      </div>

      {/* ── What is outstanding vs already gone ─────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5">
        <Stat
          label="Awaiting payment"
          value={inr(totals.draftValue)}
          hint={`${totals.drafts} draft${totals.drafts === 1 ? '' : 's'}`}
          tone={totals.drafts ? 'amber' : 'slate'}
        />
        <Stat label="Paid out" value={inr(totals.paidValue)} hint={`${totals.paid} settled`} tone="emerald" />
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="bg-card grid grid-cols-2 items-end gap-2 rounded-[4px] border p-2.5 shadow-sm sm:flex sm:flex-wrap sm:gap-3">
        <div className="w-full min-w-0 space-y-1 sm:w-64">
          <Label className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">Agent</Label>
          <NativeSelect
            value={agentName}
            onChange={setAgentName}
            options={['', ...(agents?.items ?? []).map((a) => a.name)]}
            placeholder="All agents"
          />
        </div>
        <div className="w-full min-w-0 space-y-1 sm:w-44">
          <Label className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">Status</Label>
          <NativeSelect value={status} onChange={setStatus} options={['', ...AGENT_SETTLEMENT_STATUSES]} placeholder="All statuses" />
        </div>
      </div>

      {/* ── Desktop table ───────────────────────────────────────────────────── */}
      <div className="bg-card hidden overflow-auto rounded-[4px] border shadow-sm sm:block">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={cn(TH, 'w-8')} />
              <th className={TH}>Settlement</th>
              <th className={TH}>Agent</th>
              <th className={TH}>Period</th>
              <th className={cn(TH, 'text-right')}>Invoices</th>
              <th className={cn(TH, 'text-right')}>Gross</th>
              <th className={cn(TH, 'text-right')}>Deductions</th>
              <th className={cn(TH, 'text-right')}>TDS</th>
              <th className={cn(TH, 'text-right')}>Net</th>
              <th className={TH}>Status</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={11} className="py-10 text-center">
                  <Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" />
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={11} className="text-muted-foreground py-12 text-center text-[13px]">
                  No settlements yet. Raise one from <span className="font-semibold">Agent → Agent Settlement</span>.
                </td>
              </tr>
            ) : (
              rows.map((s) => {
                const ded = s.bounceDeduction + s.coverDeduction + s.otherDeduction;
                const expanded = open.has(s.id);
                return (
                  <Fragment key={s.id}>
                    <tr className={cn('border-b', expanded && 'bg-indigo-50/50 dark:bg-indigo-500/5')}>
                      <td className={cn(TD, 'text-center')}>
                        <button
                          type="button"
                          onClick={() => toggle(s.id)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={expanded ? 'Hide detail' : 'Show detail'}
                        >
                          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      </td>
                      <td className={cn(TD, 'font-mono font-bold whitespace-nowrap')}>{s.code ?? `#${s.id}`}</td>
                      <td className={cn(TD, 'font-semibold')}>{s.agentName}</td>
                      <td className={cn(TD, 'whitespace-nowrap tabular-nums')}>
                        {formatDate(s.periodFrom)} – {formatDate(s.periodTo)}
                      </td>
                      <td className={cn(TD, 'text-right tabular-nums')}>{s.lines.length}</td>
                      <td className={cn(TD, 'text-right tabular-nums')}>{inr(s.grossCommission)}</td>
                      <td className={cn(TD, 'text-right tabular-nums', ded > 0 && 'text-rose-700 dark:text-rose-300')}>
                        {ded > 0 ? `− ${inr(ded)}` : '—'}
                      </td>
                      <td className={cn(TD, 'text-right tabular-nums', s.tdsAmount > 0 && 'text-rose-700 dark:text-rose-300')}>
                        {s.tdsAmount > 0 ? `− ${inr(s.tdsAmount)}` : '—'}
                      </td>
                      <td className={cn(TD, 'text-right font-bold tabular-nums text-emerald-700 dark:text-emerald-400')}>
                        {inr(s.netPayable)}
                      </td>
                      <td className={TD}>
                        <StatusChip status={s.status} />
                        {s.paidAt && (
                          <div className="text-muted-foreground text-[10.5px] tabular-nums">{formatDate(s.paidAt)}</div>
                        )}
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap')}>
                        {s.status === 'DRAFT' && <DraftActions s={s} busy={busy} canSettle={canSettle} canCancel={canCancel} onPay={doPay} onCancel={doCancel} />}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b bg-slate-50/70 dark:bg-white/[0.03]">
                        <td />
                        <td colSpan={10} className="px-2 pt-1 pb-3">
                          <SettlementDetail s={s} formatDate={formatDate} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Phones: one card per settlement ─────────────────────────────────── */}
      <div className="sm:hidden">
        {isLoading ? (
          <div className="text-muted-foreground flex h-24 items-center justify-center rounded-2xl border">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : !rows.length ? (
          <div className="text-muted-foreground rounded-2xl border px-4 py-12 text-center text-sm">
            No settlements yet. Raise one from Agent → Agent Settlement.
          </div>
        ) : (
          <div className="space-y-2.5">
            {rows.map((s) => {
              const ded = s.bounceDeduction + s.coverDeduction + s.otherDeduction;
              const expanded = open.has(s.id);
              return (
                <div key={s.id} className="bg-card overflow-hidden rounded-2xl border shadow-sm ring-1 ring-black/[0.02]">
                  <div className="space-y-2 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[14px] leading-tight font-extrabold break-words">{s.agentName}</p>
                        <p className="text-muted-foreground mt-0.5 font-mono text-[11px] font-bold">{s.code ?? `#${s.id}`}</p>
                      </div>
                      <StatusChip status={s.status} />
                    </div>
                    <p className="text-muted-foreground text-[11px] font-medium tabular-nums">
                      {formatDate(s.periodFrom)} – {formatDate(s.periodTo)} · {s.lines.length} invoice
                      {s.lines.length === 1 ? '' : 's'}
                      {s.paidAt ? ` · paid ${formatDate(s.paidAt)}` : ''}
                    </p>
                    <div className="flex items-baseline justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-white/[0.04]">
                      <span className="text-muted-foreground text-[9.5px] font-bold tracking-widest uppercase">Net paid</span>
                      <span className="text-[17px] font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">
                        {inr(s.netPayable)}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-[11px] tabular-nums">
                      Gross {inr(s.grossCommission)}
                      {ded > 0 && <span className="text-rose-700 dark:text-rose-300"> · less {inr(ded)}</span>}
                      {s.tdsAmount > 0 && <span className="text-rose-700 dark:text-rose-300"> · TDS {inr(s.tdsAmount)}</span>}
                    </p>
                    {s.status === 'DRAFT' && (
                      <DraftActions s={s} busy={busy} canSettle={canSettle} canCancel={canCancel} onPay={doPay} onCancel={doCancel} full />
                    )}
                    <Button variant="ghost" size="sm" className="h-8 w-full text-[12px]" onClick={() => toggle(s.id)}>
                      {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      {expanded ? 'Hide invoices' : `Show ${s.lines.length} invoice${s.lines.length === 1 ? '' : 's'}`}
                    </Button>
                    {expanded && <SettlementDetail s={s} formatDate={formatDate} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-muted-foreground text-[11px]">
        A draft holds its invoices' claimable share until it is paid or cancelled — so a draft left sitting will keep those
        invoices off the next settlement. A paid settlement cannot be cancelled; reverse it with a fresh entry.
      </p>
    </div>
  );
}

/** Pay / Cancel, with the reason spelled out when either is unavailable. */
function DraftActions({
  s,
  busy,
  canSettle,
  canCancel,
  onPay,
  onCancel,
  full,
}: {
  s: AgentSettlementDto;
  busy: boolean;
  canSettle: boolean;
  canCancel: boolean;
  onPay: (s: AgentSettlementDto) => void;
  onCancel: (s: AgentSettlementDto) => void;
  full?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-1.5', full && 'pt-0.5')}>
      <Button
        size="sm"
        className={cn('h-8 text-[12px]', full && 'flex-1')}
        onClick={() => onPay(s)}
        disabled={busy || !canSettle}
        title={canSettle ? undefined : 'You do not have permission to pay a settlement'}
      >
        {s.payMode === 'CASH' ? <Wallet className="size-3.5" /> : <Banknote className="size-3.5" />} Pay
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={cn('h-8 text-[12px]', full && 'flex-1')}
        onClick={() => onCancel(s)}
        disabled={busy || !canCancel}
        title={canCancel ? undefined : 'You do not have permission to cancel a settlement'}
      >
        <Ban className="size-3.5" /> Cancel
      </Button>
    </div>
  );
}

/**
 * The invoices and deductions the settlement was built from.
 *
 * Shown from the list's own data — `listSettlements` already returns lines and
 * deductions, so expanding a row costs no request. The point of keeping this on
 * screen is the pair of rates: what the master said, and what was actually paid.
 * A cut rate with its reason is the whole defence when an agent asks months
 * later why he was paid less than the agreed rate.
 */
function SettlementDetail({ s, formatDate }: { s: AgentSettlementDto; formatDate: (v: string) => string }) {
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border bg-white dark:bg-transparent">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="[&_th]:bg-slate-100 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-bold [&_th]:uppercase dark:[&_th]:bg-white/[0.06]">
              <th>Invoice</th>
              <th>Party</th>
              <th>Category</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Rate</th>
              <th className="text-right">Paid&nbsp;%</th>
              <th className="text-right">Commission</th>
            </tr>
          </thead>
          <tbody>
            {s.lines.map((l) => {
              const cut = l.appliedRatePerUnit < l.baseRatePerUnit - 0.0001;
              return (
                <tr key={l.id} className="border-t">
                  <td className="px-2 py-1 font-mono font-semibold whitespace-nowrap">
                    {l.invNo}
                    {l.isTopUp && (
                      <span className="ml-1 rounded-full bg-violet-50 px-1.5 text-[9.5px] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                        balance
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1">{l.customerName}</td>
                  <td className="px-2 py-1">{l.pCategory}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {l.qty.toLocaleString('en-IN')}
                    <span className="text-muted-foreground ml-0.5 text-[9.5px]">{basisUnit(l.basis)}</span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    ₹{l.appliedRatePerUnit}
                    {/* Only when they differ — printing "was ₹40" on every line
                        that was never touched is noise that hides the ones that
                        were. */}
                    {cut && (
                      <span className="block text-[9.5px] text-sky-700 dark:text-sky-300">
                        cut from ₹{l.baseRatePerUnit}
                        {l.reason ? ` — ${l.reason}` : ' — no reason given'}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{(l.paidRatio * 100).toFixed(0)}%</td>
                  <td className="px-2 py-1 text-right font-bold tabular-nums">{inr(l.amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!!s.deductions.length && (
        <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-2 dark:border-rose-400/30 dark:bg-rose-500/10">
          <p className="mb-1 text-[10px] font-bold tracking-wide text-rose-900 uppercase dark:text-rose-300">Deductions</p>
          {s.deductions.map((d) => (
            <div key={d.id} className="flex items-baseline justify-between gap-2 py-0.5 text-[11.5px]">
              <span className="text-rose-900/90 dark:text-rose-200">
                <span className="font-semibold">{d.kind === 'BOUNCE' ? 'Cheque bounce' : d.kind === 'COVER' ? 'Covered amount' : 'Other'}</span>
                {d.chequeNo ? ` · ${d.chequeNo}` : ''}
                {d.bankName ? ` · ${d.bankName}` : ''}
                {d.note ? ` · ${d.note}` : ''}
                {d.refDate ? ` · ${formatDate(d.refDate)}` : ''}
              </span>
              <span className="font-bold tabular-nums text-rose-700 dark:text-rose-300">− {inr(d.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {s.remarks && <p className="text-muted-foreground border-l-2 border-amber-300 pl-2 text-[11.5px]">{s.remarks}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: 'slate' | 'amber' | 'emerald';
}) {
  const tones = {
    slate: 'border-slate-200 dark:border-white/10',
    amber: 'border-amber-300 bg-amber-50/50 dark:border-amber-400/30 dark:bg-amber-500/10',
    emerald: 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-400/30 dark:bg-emerald-500/10',
  };
  return (
    <div className={cn('bg-card rounded-[4px] border px-2.5 py-2 shadow-sm', tones[tone])}>
      <p className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase">{label}</p>
      <p className="text-[17px] leading-tight font-extrabold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground text-[10.5px] font-medium">{hint}</p>}
    </div>
  );
}

export default SettlementHistoryPage;
