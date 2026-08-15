import { useMemo, useState } from 'react';
import { BadgeIndianRupee, Banknote, Check, Loader2, RotateCcw, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { AGENT_TDS_PERCENT, basisUnit, settlementNet, type AgentSettlementInput } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAgents } from '@/features/agents/use-agents';
import { useCreateSettlement, usePaySettlement, useSettlementPreview } from './use-agent-commission';

const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const TH = 'bg-gradient-to-b from-blue-800 to-indigo-800 px-2 py-1.5 text-[11px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap';
const TD = 'px-2 py-1 text-[12.5px]';

/** yyyy-mm-dd for the date inputs. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fyStart = () => {
  const t = new Date();
  return ymd(new Date(t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1, 3, 1));
};

/** Per-line owner override, held locally until the draft is saved. */
interface Override {
  rate: number;
  reason: string;
}

export function AgentSettlementPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const canSettle = can('agentcommission:settle');

  const { data: agents } = useAgents({ page: 1, pageSize: 500 });
  const agentOptions = useMemo(() => (agents?.items ?? []).map((a) => a.name), [agents]);
  const [agentName, setAgentName] = useState('');
  const agentId = useMemo(() => (agents?.items ?? []).find((a) => a.name === agentName)?.id, [agents, agentName]);

  const [periodFrom, setPeriodFrom] = useState(fyStart());
  const [periodTo, setPeriodTo] = useState(ymd(new Date()));
  const [payMode, setPayMode] = useState<'CASH' | 'BANK'>('BANK');

  const { data: preview, isLoading } = useSettlementPreview(agentId, periodFrom, periodTo);

  /* Owner decisions, keyed by invoice+category — see §4. Held here rather than
     written straight away, so the whole run can be reviewed before committing. */
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [pickedBounces, setPickedBounces] = useState<Set<number>>(new Set());
  const [pickedCovers, setPickedCovers] = useState<Set<number>>(new Set());
  const keyOf = (invNo: string, cat: string) => `${invNo}|${cat}`;

  const reset = () => {
    setOverrides({});
    setPickedBounces(new Set());
    setPickedCovers(new Set());
  };

  const lines = useMemo(() => {
    return (preview?.lines ?? []).map((l) => {
      const ov = overrides[keyOf(l.invNo, l.pCategory)];
      const appliedRatePerUnit = ov?.rate ?? l.baseRatePerUnit;
      // Same formula the server uses — qty × applied rate × the share THIS line
      // pays for (on a balance line, only what's been collected since).
      const amount = Math.round(l.qty * appliedRatePerUnit * l.paidRatio * 100) / 100;
      return { ...l, appliedRatePerUnit, amount, reason: ov?.reason ?? null };
    });
  }, [preview, overrides]);

  const grossCommission = useMemo(() => Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100, [lines]);
  const bounceDeduction = useMemo(
    () => Math.round((preview?.bounceCandidates ?? []).filter((b) => pickedBounces.has(b.id)).reduce((s, b) => s + b.totalCharge, 0) * 100) / 100,
    [preview, pickedBounces],
  );
  const coverDeduction = useMemo(
    () => Math.round((preview?.coverCandidates ?? []).filter((c) => pickedCovers.has(c.id)).reduce((s, c) => s + c.amount, 0) * 100) / 100,
    [preview, pickedCovers],
  );
  const tdsPercent = payMode === 'BANK' ? AGENT_TDS_PERCENT : 0;
  const totals = settlementNet({ grossCommission, bounceDeduction, coverDeduction, otherDeduction: 0, payMode, tdsPercent });

  const create = useCreateSettlement();
  const pay = usePaySettlement();
  const busy = create.isPending || pay.isPending;

  const buildInput = (): AgentSettlementInput => ({
    agentId: agentId!,
    periodFrom,
    periodTo,
    payMode,
    tdsPercent,
    lines: lines.map((l) => ({
      challanId: l.challanId,
      invNo: l.invNo,
      customerName: l.customerName,
      pCategory: l.pCategory,
      basis: l.basis,
      qty: l.qty,
      baseRatePerUnit: l.baseRatePerUnit,
      appliedRatePerUnit: l.appliedRatePerUnit,
      paidRatio: l.paidRatio,
      invoiceAmount: l.invoiceAmount,
      paidAmount: l.paidAmount,
      amount: l.amount,
      reason: l.reason,
      // Kept so a settlement can still explain a balance line months later.
      isTopUp: l.isTopUp,
      previouslySettledRatio: l.previouslySettledRatio,
    })),
    deductions: [
      ...(preview?.bounceCandidates ?? [])
        .filter((b) => pickedBounces.has(b.id))
        .map((b) => ({ kind: 'BOUNCE' as const, bounceEventId: b.id, chequeNo: b.chequeNo, bankName: b.bankName, refDate: b.bounceDate, amount: b.totalCharge })),
      ...(preview?.coverCandidates ?? [])
        .filter((c) => pickedCovers.has(c.id))
        .map((c) => ({ kind: 'COVER' as const, coverId: c.id, amount: c.amount, note: `${c.customerName}${c.invNo ? ` · ${c.invNo}` : ''}` })),
    ],
  });

  /**
   * Everything that must be true before a settlement may be raised. Returned as
   * a message rather than thrown, so the same check can disable the buttons AND
   * explain why they're disabled.
   */
  const blocker = useMemo((): string | null => {
    if (!agentId) return 'Choose an agent first.';
    if (!periodFrom || !periodTo) return 'Set the period this settlement covers.';
    if (periodFrom > periodTo) return 'The period starts after it ends — check the dates.';
    if (periodTo > ymd(new Date())) return 'The period ends in the future — an invoice cannot be settled before it exists.';
    if (!lines.length) return 'Nothing to settle in this period.';
    const bad = lines.find((l) => !Number.isFinite(l.appliedRatePerUnit) || l.appliedRatePerUnit < 0);
    if (bad) return `The rate on ${bad.invNo} is not a valid amount.`;
    // §4 allows cutting a rate for a delayed bill, never raising it.
    const raised = lines.find((l) => l.appliedRatePerUnit > l.baseRatePerUnit + 0.0001);
    if (raised) return `${raised.invNo} is set to ₹${raised.appliedRatePerUnit}, above the agreed ₹${raised.baseRatePerUnit}. A rate can be cut here, not raised.`;
    if (totals.netPayable < -0.005) {
      return `Deductions exceed the ${inr(grossCommission)} commission, so this would pay below zero. Recover the rest on a later settlement.`;
    }
    return null;
  }, [agentId, periodFrom, periodTo, lines, totals.netPayable, grossCommission]);

  /** A cut rate without a reason is indistinguishable from a typo months later. */
  const unexplainedCuts = useMemo(
    () => lines.filter((l) => l.appliedRatePerUnit < l.baseRatePerUnit - 0.0001 && !l.reason?.trim()),
    [lines],
  );

  const saveDraft = async () => {
    if (blocker) return toast.error(blocker);
    create.mutate(buildInput(), {
      onSuccess: (s) => { toast.success(`Draft ${s.code} saved`); reset(); },
      onError: (e) => toast.error(getApiErrorMessage(e, 'Could not save the draft')),
    });
  };

  /** Draft then pay in one go — the common case when the agent is standing there. */
  const settleNow = async () => {
    if (blocker) return toast.error(blocker);
    // A reduced rate with nothing written down cannot be defended later, when
    // the agent asks why he was paid less than the agreed rate.
    if (unexplainedCuts.length) {
      const ok = await confirm({
        title: `${unexplainedCuts.length} rate${unexplainedCuts.length === 1 ? '' : 's'} cut with no reason given`,
        description:
          `${unexplainedCuts.map((l) => l.invNo).slice(0, 4).join(', ')}${unexplainedCuts.length > 4 ? ' and others' : ''} ` +
          `${unexplainedCuts.length === 1 ? 'is' : 'are'} being paid below the agreed rate without a note. ` +
          'Without one, nobody will be able to explain the deduction to the agent months from now.',
        confirmText: 'Settle anyway',
        cancelText: 'Go back and add reasons',
        destructive: true,
      });
      if (!ok) return;
    }
    const ok = await confirm({
      title: `Settle ${inr(totals.netPayable)} to ${agentName}?`,
      description:
        `${lines.length} invoice${lines.length === 1 ? '' : 's'} · gross ${inr(grossCommission)}` +
        `${bounceDeduction ? ` · less bounce ${inr(bounceDeduction)}` : ''}` +
        `${coverDeduction ? ` · less cover ${inr(coverDeduction)}` : ''}` +
        `${totals.tdsAmount ? ` · less TDS ${inr(totals.tdsAmount)}` : ''}. ` +
        'Once paid, these invoices can never be claimed again.',
      confirmText: `Pay ${inr(totals.netPayable)}`,
    });
    if (!ok) return;
    create.mutate(buildInput(), {
      onSuccess: (s) =>
        pay.mutate(
          { id: s.id, payMode, tdsPercent },
          {
            onSuccess: () => { toast.success(`${s.code} settled — ${inr(totals.netPayable)} to ${agentName}`); reset(); },
            onError: (e) => toast.error(getApiErrorMessage(e, `Draft ${s.code} saved, but paying it failed`)),
          },
        ),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Could not settle')),
    });
  };

  const toggle = (set: Set<number>, id: number, apply: (s: Set<number>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      {/* ── Who, and over what period ─────────────────────────────────────── */}
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-end gap-2 p-2.5 sm:gap-3 sm:p-3">
          <div className="w-full space-y-1 sm:w-64">
            <Label className="text-muted-foreground text-[11px] font-bold uppercase tracking-wide">Agent</Label>
            <NativeSelect value={agentName} onChange={setAgentName} options={agentOptions} placeholder="Select agent…" />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[11px] font-bold uppercase tracking-wide">Invoices from</Label>
            <Input type="date" className="h-9 w-40 tabular-nums" value={periodFrom} max={periodTo} onChange={(e) => setPeriodFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[11px] font-bold uppercase tracking-wide">to</Label>
            <Input type="date" className="h-9 w-40 tabular-nums" value={periodTo} min={periodFrom} onChange={(e) => setPeriodTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[11px] font-bold uppercase tracking-wide">Pay by</Label>
            {/* TDS is a consequence of this choice, never typed by hand. */}
            <div className="flex h-9 items-center gap-1 rounded-[4px] border border-amber-300 bg-amber-50/40 p-0.5">
              {(['BANK', 'CASH'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPayMode(m)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-[3px] px-3 py-1 text-[12px] font-semibold transition-colors',
                    payMode === m ? 'bg-indigo-600 text-white shadow-sm' : 'text-amber-900/70 hover:bg-amber-100',
                  )}
                >
                  {m === 'BANK' ? <Banknote className="size-3.5" /> : <Wallet className="size-3.5" />} {m}
                </button>
              ))}
            </div>
          </div>
          {Object.keys(overrides).length > 0 && (
            <Button variant="outline" size="sm" className="h-9" onClick={reset}>
              <RotateCcw className="size-3.5" /> Reset changes
            </Button>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-2.5 lg:grid-cols-[1fr_20rem]">
        {/* ── Eligible invoices ───────────────────────────────────────────── */}
        <div className="bg-card flex min-h-0 flex-col overflow-hidden rounded-[4px] border shadow-sm">
          <div className="overflow-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className={TH}>Invoice</th>
                  <th className={TH}>Party</th>
                  <th className={TH}>Category</th>
                  <th className={cn(TH, 'text-right')}>Qty</th>
                  <th className={cn(TH, 'text-right')}>Collected</th>
                  <th className={cn(TH, 'text-right')}>Rate ₹/unit</th>
                  <th className={cn(TH, 'text-right')}>Commission</th>
                </tr>
              </thead>
              <tbody>
                {!agentId ? (
                  <tr><td colSpan={7} className="text-muted-foreground h-32 text-center text-[13px] font-medium">Choose an agent to see what is payable.</td></tr>
                ) : isLoading ? (
                  <tr><td colSpan={7} className="h-32 text-center"><Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" /></td></tr>
                ) : !lines.length ? (
                  <tr><td colSpan={7} className="text-muted-foreground h-32 text-center text-[13px] font-medium">
                    Nothing payable in this period — commission is only earned once the party has actually paid.
                  </td></tr>
                ) : (
                  lines.map((l) => {
                    const k = keyOf(l.invNo, l.pCategory);
                    const changed = l.appliedRatePerUnit !== l.baseRatePerUnit;
                    // Badly overdue bills are what the owner is most likely to cut.
                    const late = (l.overdueDays ?? 0) > 0;
                    return (
                      <tr key={k} className={cn('border-b border-amber-200/70 even:bg-amber-50/40', changed && 'bg-sky-50')}>
                        <td className={cn(TD, 'font-mono font-bold whitespace-nowrap')}>
                          {l.invNo}
                          {/* The balance on an invoice settled earlier, now that
                              the party has paid more of it. */}
                          {l.isTopUp && (
                            <span className="ml-1.5 rounded-full bg-violet-50 px-1.5 py-0.5 font-sans text-[10px] font-bold text-violet-700 ring-1 ring-inset ring-violet-200">
                              balance
                            </span>
                          )}
                        </td>
                        <td className={cn(TD, 'font-semibold')}>{l.customerName}</td>
                        <td className={TD}>{l.pCategory}</td>
                        <td className={cn(TD, 'text-right tabular-nums')}>
                          {l.qty.toLocaleString('en-IN')}
                          <span className="text-muted-foreground ml-0.5 text-[10px]">{basisUnit(l.basis)}</span>
                        </td>
                        <td className={cn(TD, 'text-right tabular-nums')}>
                          <span className={cn('font-semibold', l.paidRatio >= 0.999 ? 'text-emerald-700' : 'text-amber-700')}>
                            {(l.paidRatio * 100).toFixed(0)}%
                          </span>
                          <span className="text-muted-foreground ml-1 text-[11px]">{inr(l.paidAmount)}</span>
                          {late && <span className="ml-1 text-[10px] font-bold text-rose-600">{l.overdueDays}d late</span>}
                          {l.isTopUp && (
                            <div className="text-[10px] font-medium text-violet-700">
                              a further {(l.paidRatio * 100).toFixed(0)}% — {((l.previouslySettledRatio ?? 0) * 100).toFixed(0)}% already paid
                              {l.previouslySettledAmount ? ` (${inr(l.previouslySettledAmount)})` : ''}
                            </div>
                          )}
                        </td>
                        <td className={cn(TD, 'text-right')}>
                          {/* §4: the configured rate is only a proposal. */}
                          <Input
                            type="number"
                            step="any"
                            min={0}
                            className="h-7 w-20 text-right text-[12.5px] tabular-nums"
                            value={l.appliedRatePerUnit}
                            onChange={(e) => {
                              const rate = Number(e.target.value);
                              setOverrides((o) => ({ ...o, [k]: { rate: Number.isFinite(rate) ? rate : 0, reason: o[k]?.reason ?? '' } }));
                            }}
                            title={changed ? `Master rate is ₹${l.baseRatePerUnit}/${basisUnit(l.basis)}` : undefined}
                          />
                          {changed && <div className="text-[10px] text-sky-700">was ₹{l.baseRatePerUnit}</div>}
                        </td>
                        <td className={cn(TD, 'text-right font-bold tabular-nums text-emerald-700')}>{inr(l.amount)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Deductions + the bottom line ────────────────────────────────── */}
        <div className="flex min-h-0 flex-col gap-2.5 overflow-auto">
          {/* Bounce charges — only cheques THIS agent brought in are offered. */}
          <div className="bg-card rounded-[4px] border p-2.5 shadow-sm">
            <p className="text-muted-foreground mb-2 text-[11px] font-bold uppercase tracking-wide">Cheque bounce charges</p>
            {!preview?.bounceCandidates.length ? (
              <p className="text-muted-foreground text-[12px]">None outstanding for this agent.</p>
            ) : (
              preview.bounceCandidates.map((b) => (
                <label key={b.id} className="flex cursor-pointer items-start gap-2 py-1 text-[12px]">
                  <input type="checkbox" className="mt-0.5 size-3.5 accent-blue-600" checked={pickedBounces.has(b.id)} onChange={() => toggle(pickedBounces, b.id, setPickedBounces)} />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono font-semibold">{b.chequeNo}</span>{' '}
                    <span className="text-muted-foreground">{b.partyName}</span>
                    <span className="text-muted-foreground block text-[11px]">{formatDate(b.bounceDate)} · {b.bankName ?? '—'}</span>
                  </span>
                  <span className="font-bold tabular-nums text-rose-700">{inr(b.totalCharge)}</span>
                </label>
              ))
            )}
          </div>

          {/* Amounts the agent covered for a defaulting party. */}
          <div className="bg-card rounded-[4px] border p-2.5 shadow-sm">
            <p className="text-muted-foreground mb-2 text-[11px] font-bold uppercase tracking-wide">Amounts covered by agent</p>
            {!preview?.coverCandidates.length ? (
              <p className="text-muted-foreground text-[12px]">Nothing to recoup.</p>
            ) : (
              preview.coverCandidates.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-start gap-2 py-1 text-[12px]">
                  <input type="checkbox" className="mt-0.5 size-3.5 accent-blue-600" checked={pickedCovers.has(c.id)} onChange={() => toggle(pickedCovers, c.id, setPickedCovers)} />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{c.customerName}</span>
                    <span className="text-muted-foreground block text-[11px]">{formatDate(c.coveredAt)}{c.invNo ? ` · ${c.invNo}` : ''}</span>
                  </span>
                  <span className="font-bold tabular-nums text-rose-700">{inr(c.amount)}</span>
                </label>
              ))
            )}
          </div>

          {/* The sum the agent actually walks away with. */}
          <div className="bg-card rounded-[4px] border-2 border-indigo-200 p-2.5 shadow-sm">
            <Row label="Gross commission" value={inr(grossCommission)} />
            {bounceDeduction > 0 && <Row label="Less bounce charges" value={`− ${inr(bounceDeduction)}`} tone="rose" />}
            {coverDeduction > 0 && <Row label="Less covered amounts" value={`− ${inr(coverDeduction)}`} tone="rose" />}
            {totals.tdsAmount > 0 && <Row label={`Less TDS @ ${tdsPercent}%`} value={`− ${inr(totals.tdsAmount)}`} tone="rose" />}
            {payMode === 'CASH' && <p className="text-muted-foreground py-1 text-[11px]">Cash settlement — no TDS deducted.</p>}
            <div className="mt-1.5 flex items-baseline justify-between border-t pt-1.5">
              <span className="text-[12px] font-bold uppercase tracking-wide">Net payable</span>
              <span className="text-[19px] font-extrabold tabular-nums text-emerald-700">{inr(totals.netPayable)}</span>
            </div>
            {/* Why the buttons are off, rather than a dead button and no
                explanation. Permission is stated separately because it is the
                one blocker the user cannot fix themselves. */}
            {(blocker || !canSettle) && (
              <p className="mt-2 rounded-[4px] border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11.5px] font-medium text-amber-900">
                {blocker ?? 'You do not have permission to pay a settlement — you can still save it as a draft.'}
              </p>
            )}
            <div className="mt-2.5 flex flex-col gap-1.5">
              <Button
                onClick={settleNow}
                disabled={busy || !!blocker || !canSettle}
                title={blocker ?? (canSettle ? undefined : 'You do not have permission to pay a settlement')}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Check />} Settle &amp; pay
              </Button>
              <Button variant="outline" onClick={saveDraft} disabled={busy || !!blocker} title={blocker ?? undefined}>
                <BadgeIndianRupee /> Save as draft
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'rose' }) {
  return (
    <div className="flex items-baseline justify-between py-0.5 text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-bold tabular-nums', tone === 'rose' ? 'text-rose-700' : 'text-slate-900 dark:text-slate-100')}>{value}</span>
    </div>
  );
}
