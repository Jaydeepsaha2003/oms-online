import { useMemo, useState } from 'react';
import { BadgeIndianRupee, History, Loader2, Pencil, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { basisUnit, COMMISSION_BASES, type AgentRateCoverageRow, type CommissionBasis } from '@oms/shared';
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
import { useOrderLookups } from '@/features/orders/use-orders';
import {
  useBackfillAccruals,
  useCommissionRates,
  useCreateCommissionRate,
  useDeleteCommissionRate,
  useRateCoverage,
} from './use-agent-commission';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = (n: number) => n.toLocaleString('en-IN');

/**
 * Agent → category → ₹ per kg or per piece.
 *
 * Built as a grid of what the business actually sells rather than a list of the
 * rates that happen to exist, because the dangerous state here is the ABSENT
 * row: an agent invoicing a category nobody priced earns nothing, silently, and
 * a list of existing rates can never show you that. Every square the agent
 * sells is on screen whether it's priced or not, and the unpriced ones are the
 * loudest thing on the page.
 */
export function CommissionRatesPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const canEdit = can('agentcommission:update');

  const { data: coverage, isLoading } = useRateCoverage();
  const { data: agentList } = useAgents({ page: 1, pageSize: 500 });
  const { data: allRates } = useCommissionRates();
  const { data: lookups } = useOrderLookups();
  const backfill = useBackfillAccruals();

  const [editing, setEditing] = useState<{ agentId: number; agentName: string; pCategory: string; basis: CommissionBasis } | null>(null);
  const [adding, setAdding] = useState(false);
  const [onlyGaps, setOnlyGaps] = useState(false);

  const rows = coverage ?? [];
  const agentsInGrid = useMemo(() => [...new Set(rows.map((r) => r.agentName))].sort(), [rows]);
  const categories = useMemo(() => [...new Set(rows.map((r) => r.pCategory))].sort(), [rows]);
  const cell = useMemo(() => {
    const m = new Map<string, AgentRateCoverageRow>();
    for (const r of rows) m.set(`${r.agentName}|${r.pCategory}`, r);
    return m;
  }, [rows]);

  const gaps = useMemo(() => rows.filter((r) => r.gap), [rows]);
  const priced = rows.length - gaps.length;
  const visibleAgents = onlyGaps ? agentsInGrid.filter((a) => gaps.some((g) => g.agentName === a)) : agentsInGrid;

  const runBackfill = async () => {
    const ok = await confirm({
      title: 'Re-price every invoice?',
      description:
        'Every confirmed invoice is re-checked against the rate master and its commission re-derived. ' +
        'Run this after changing rates, since invoices already priced keep their old figures until you do. Safe to repeat.',
      confirmText: 'Re-price',
    });
    if (!ok) return;
    backfill.mutate(
      {},
      {
        onSuccess: (r) => toast.success(`${r.challans} invoices scanned · ${r.accruals} commission rows written`),
        onError: (e) => toast.error(getApiErrorMessage(e, 'Backfill failed')),
      },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-2.5 font-sans sm:p-3">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <BadgeIndianRupee className="size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight">Commission Rates</h2>
          <p className="text-muted-foreground text-sm">
            What each agent earns per kg or per piece, by product category. A category with no rate earns them nothing.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {can('agentcommission:manage') && (
            <Button variant="outline" onClick={runBackfill} disabled={backfill.isPending} title="Re-derive commission on every confirmed invoice">
              {backfill.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Re-price invoices
            </Button>
          )}
          {canEdit && (
            <Button className="bg-gradient-brand text-white shadow-sm hover:opacity-95" onClick={() => setAdding(true)}>
              <Plus /> Set a rate
            </Button>
          )}
        </div>
      </div>

      {/* ── What the grid adds up to ────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Agents selling" value={agentsInGrid.length} tone="slate" />
        <Stat label="Categories sold" value={categories.length} tone="slate" />
        <Stat label="Priced" value={priced} tone="emerald" />
        <Stat
          label="Earning nothing"
          value={gaps.length}
          tone={gaps.length ? 'rose' : 'emerald'}
          hint={gaps.length ? 'agent sells it, no rate set' : 'every category is priced'}
          onClick={gaps.length ? () => setOnlyGaps((v) => !v) : undefined}
          active={onlyGaps}
        />
      </div>

      {/* The single most useful sentence on the page, when it applies. */}
      {!!gaps.length && (
        <div className="flex items-start gap-2 rounded-[4px] border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm text-rose-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            <b>
              {gaps.length} agent–category {gaps.length === 1 ? 'pairing has' : 'pairings have'} no rate
            </b>{' '}
            — {gaps.reduce((s, g) => s + g.invoiceCount, 0).toLocaleString('en-IN')} invoices already dispatched under{' '}
            {gaps.length === 1 ? 'it' : 'them'} are earning the agent nothing. Click any red square to price it.
          </p>
        </div>
      )}

      {/* ── The grid ────────────────────────────────────────────────────── */}
      <div className="bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b px-2.5 py-2">
          <span className="text-[12.5px] font-semibold">Rate grid</span>
          <span className="text-muted-foreground text-[11.5px]">agent × category, as actually invoiced</span>
          {onlyGaps && (
            <Button variant="ghost" size="sm" className="ml-auto h-7 text-[12px]" onClick={() => setOnlyGaps(false)}>
              Showing gaps only — show all
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : !rows.length ? (
            <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-1 px-6 text-center text-[13px]">
              <p className="font-medium">No invoiced categories yet.</p>
              <p>Once invoices exist for parties with an agent, every category they sell appears here to be priced.</p>
            </div>
          ) : (
            <table className="w-full border-separate border-spacing-0">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="bg-gradient-to-b from-blue-800 to-indigo-800 px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-white">
                    Agent
                  </th>
                  {categories.map((c) => {
                    const suggested = rows.find((r) => r.pCategory === c)?.suggestedBasis;
                    return (
                      <th
                        key={c}
                        className="bg-gradient-to-b from-blue-800 to-indigo-800 px-2 py-2 text-center text-[11px] font-extrabold uppercase tracking-wide text-white"
                      >
                        <div className="whitespace-nowrap">{c}</div>
                        {suggested && <div className="text-[9.5px] font-semibold normal-case text-white/70">per {basisUnit(suggested)}</div>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleAgents.map((agentName) => (
                  <tr key={agentName} className="even:bg-amber-50/40">
                    <td className="border-b border-amber-200/70 px-3 py-1.5 text-[12.5px] font-bold whitespace-nowrap">{agentName}</td>
                    {categories.map((c) => {
                      const r = cell.get(`${agentName}|${c}`);
                      return (
                        <td key={c} className="border-b border-l border-amber-200/70 p-1 text-center">
                          <RateCell
                            row={r}
                            canEdit={canEdit}
                            onClick={
                              canEdit && r
                                ? () =>
                                    setEditing({
                                      agentId: r.agentId,
                                      agentName: r.agentName,
                                      pCategory: r.pCategory,
                                      basis: r.basis ?? r.suggestedBasis ?? 'KGS',
                                    })
                                : undefined
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-muted-foreground border-t px-3 py-1.5 text-[11.5px]">
          Rates are dated, never overwritten — an invoice always prices at the rate in force on its invoice date, so changing one here never rewrites
          what has already been settled.
        </p>
      </div>

      {(editing || adding) && (
        <RateDialog
          seed={editing}
          agents={(agentList?.items ?? []).map((a) => ({ id: a.id, name: a.name }))}
          categories={categories}
          lookups={lookups}
          history={allRates ?? []}
          onClose={() => {
            setEditing(null);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone, hint, onClick, active }: {
  label: string;
  value: number;
  tone: 'slate' | 'emerald' | 'rose';
  hint?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const tones = {
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    rose: 'border-rose-300 bg-rose-50 text-rose-700',
  } as const;
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={cn(
        'rounded-[4px] border px-3 py-2 text-left shadow-sm transition-all',
        tones[tone],
        onClick && 'hover:shadow-md cursor-pointer',
        active && 'ring-2 ring-rose-400 ring-offset-1',
        !onClick && 'cursor-default',
      )}
    >
      <div className="text-[11px] font-bold uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-[22px] font-extrabold leading-tight tabular-nums">{num(value)}</div>
      {hint && <div className="text-[10.5px] font-medium opacity-80">{hint}</div>}
    </button>
  );
}

/** One square: the rate, or a gap that says what it is costing. */
function RateCell({ row, canEdit, onClick }: { row?: AgentRateCoverageRow; canEdit: boolean; onClick?: () => void }) {
  // The agent doesn't sell this category at all — deliberately quiet, so the
  // real gaps stand out against it.
  if (!row) return <span className="text-muted-foreground/40 text-[12px]">·</span>;

  const Wrapper = onClick ? 'button' : 'div';
  const common = 'w-full rounded-[3px] px-2 py-1 transition-colors';

  if (row.gap) {
    return (
      <Wrapper
        {...(onClick ? { type: 'button' as const, onClick } : {})}
        title={`${row.agentName} has invoiced ${row.invoiceCount} ${row.pCategory} invoice(s) with no commission rate — click to set one`}
        className={cn(common, 'border border-rose-300 bg-rose-100/70 text-rose-800', onClick && 'hover:bg-rose-200')}
      >
        <div className="text-[12px] font-extrabold uppercase">not set</div>
        <div className="text-[10px] font-medium">{row.invoiceCount} inv · earns ₹0</div>
      </Wrapper>
    );
  }

  const mismatch = !!row.suggestedBasis && !!row.basis && row.suggestedBasis !== row.basis;
  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      title={
        `${row.agentName} · ${row.pCategory} · ₹${row.ratePerUnit}/${basisUnit(row.basis!)} from ${formatDate(row.effectiveFrom!)}` +
        (row.invoiceCount ? ` · ${row.invoiceCount} invoices` : ' · not yet invoiced') +
        (canEdit ? ' — click to change' : '')
      }
      className={cn(common, 'border border-transparent', onClick && 'hover:border-amber-300 hover:bg-amber-100/60')}
    >
      <div className="text-[13px] font-extrabold tabular-nums text-emerald-700">
        ₹{num(row.ratePerUnit!)}
        <span className="text-muted-foreground text-[9.5px] font-semibold">/{basisUnit(row.basis!)}</span>
      </div>
      <div className={cn('text-[9.5px] font-medium', mismatch ? 'font-bold text-amber-700' : 'text-muted-foreground')}>
        {mismatch ? `sold per ${basisUnit(row.suggestedBasis!)}` : row.invoiceCount ? `${row.invoiceCount} inv` : 'unsold'}
      </div>
    </Wrapper>
  );
}

/* ── Set / change a rate ──────────────────────────────────────────────────── */

function RateDialog({ seed, agents, categories, lookups, history, onClose }: {
  seed: { agentId: number; agentName: string; pCategory: string; basis: CommissionBasis } | null;
  agents: { id: number; name: string }[];
  categories: string[];
  lookups: ReturnType<typeof useOrderLookups>['data'];
  history: import('@oms/shared').AgentCommissionRateDto[];
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const create = useCreateCommissionRate();
  const del = useDeleteCommissionRate();
  const { can } = usePermissions();

  const categoryBasis = useMemo(() => {
    const m = new Map<string, CommissionBasis>();
    for (const cf of lookups?.categoryFields ?? []) m.set(cf.category.trim().toUpperCase(), cf.field === 'PCS' ? 'PCS' : 'KGS');
    return m;
  }, [lookups]);

  const allCategories = useMemo(
    () => [...new Set([...categories, ...(lookups?.categories ?? []).map((c) => c.trim().toUpperCase())])].filter(Boolean).sort(),
    [categories, lookups],
  );

  const [agentName, setAgentName] = useState(seed?.agentName ?? '');
  const [pCategory, setPCategory] = useState(seed?.pCategory ?? '');
  const [basis, setBasis] = useState<CommissionBasis>(seed?.basis ?? 'KGS');
  const [rate, setRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(ymd(new Date()));
  const [note, setNote] = useState('');

  const suggested = categoryBasis.get(pCategory.trim().toUpperCase());
  const overridden = !!suggested && suggested !== basis;

  const pickCategory = (c: string) => {
    setPCategory(c);
    const s = categoryBasis.get(c.trim().toUpperCase());
    if (s) setBasis(s);
  };

  // Everything ever set for this agent + category, newest first.
  const past = useMemo(
    () =>
      history
        .filter((h) => h.agentName === agentName && h.pCategory === pCategory.trim().toUpperCase())
        .sort((a, b) => +new Date(b.effectiveFrom) - +new Date(a.effectiveFrom)),
    [history, agentName, pCategory],
  );
  const current = past.find((h) => h.current);

  const save = async () => {
    const agentId = agents.find((a) => a.name === agentName)?.id;
    if (!agentId) return toast.error('Choose an agent.');
    if (!pCategory.trim()) return toast.error('Choose a category.');
    if (!rate.trim()) return toast.error('Enter the rate.');
    const value = Number(rate);
    if (!Number.isFinite(value) || value < 0) return toast.error('Enter a valid rate — it cannot be negative.');
    const ceiling = basis === 'PCS' ? 500 : 5000;
    if (value > ceiling) return toast.error(`₹${value} per ${basisUnit(basis)} looks like a slipped decimal. The most that can be set is ₹${ceiling}.`);
    if (!effectiveFrom) return toast.error('Choose the date this rate takes effect.');
    if (past.some((h) => ymd(new Date(h.effectiveFrom)) === effectiveFrom)) {
      return toast.error(`${agentName} already has a ${pCategory} rate from this date. Pick another date.`);
    }
    if (value === 0) {
      const ok = await confirm({
        title: `Set ${pCategory.toUpperCase()} to zero commission?`,
        description: `${agentName} will earn nothing on ${pCategory.toUpperCase()} for invoices dated on or after ${effectiveFrom}.`,
        confirmText: 'Yes, zero',
      });
      if (!ok) return;
    }
    if (current && current.basis !== basis) {
      const ok = await confirm({
        title: `Change ${pCategory.toUpperCase()} from per ${basisUnit(current.basis)} to per ${basisUnit(basis)}?`,
        description: `That is a different quantity entirely — ${agentName}'s ${pCategory.toUpperCase()} commission would be measured a new way from ${effectiveFrom}.`,
        confirmText: `Charge per ${basisUnit(basis)}`,
        destructive: true,
      });
      if (!ok) return;
    }
    create.mutate(
      { agentId, pCategory: pCategory.trim().toUpperCase(), basis, ratePerUnit: value, effectiveFrom, note: note.trim() || null },
      {
        onSuccess: () => {
          toast.success(`₹${value}/${basisUnit(basis)} set for ${agentName} · ${pCategory.toUpperCase()}`);
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not save the rate')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{seed ? `${seed.agentName} · ${seed.pCategory}` : 'Set a commission rate'}</DialogTitle>
          <DialogDescription>
            {current
              ? `Currently ₹${current.ratePerUnit}/${basisUnit(current.basis)} since ${formatDate(current.effectiveFrom)}. Saving adds a new dated rate — it does not overwrite this one.`
              : 'Nothing is priced here yet, so these invoices currently earn the agent nothing.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-sm">Agent</Label>
            <NativeSelect value={agentName} onChange={setAgentName} options={agents.map((a) => a.name)} placeholder="Select agent…" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Category</Label>
            <NativeSelect value={pCategory} onChange={pickCategory} options={allCategories} placeholder="Product category…" />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-sm">Charge per</Label>
            <div className="flex h-10 items-center rounded-[4px] border p-0.5">
              {COMMISSION_BASES.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBasis(b)}
                  className={cn(
                    'h-full rounded-[3px] px-4 text-[13px] font-bold transition-colors',
                    basis === b ? 'bg-gradient-brand text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {b === 'PCS' ? 'Piece' : 'Kg'}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">₹ per {basisUnit(basis)}</Label>
            <Input
              type="number"
              step="any"
              min={0}
              autoFocus
              className="h-10 w-32 text-right text-base font-semibold tabular-nums"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder={basis === 'PCS' ? '2' : '40'}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Effective from</Label>
            <Input type="date" className="h-10 w-44 tabular-nums" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>
        </div>

        {pCategory && suggested && (
          <p className={cn('rounded-[4px] px-2.5 py-1.5 text-[12px]', overridden ? 'bg-amber-50 font-semibold text-amber-800' : 'text-muted-foreground')}>
            {overridden
              ? `${pCategory.toUpperCase()} is sold by ${suggested === 'PCS' ? 'piece' : 'weight'} — you are paying commission per ${basisUnit(basis)} instead. Only do this deliberately.`
              : `${pCategory.toUpperCase()} is sold by ${suggested === 'PCS' ? 'piece' : 'weight'}, so commission is charged per ${basisUnit(basis)} to match.`}
          </p>
        )}

        <div className="space-y-1.5">
          <Label className="text-sm">Note</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — why it changed" />
        </div>

        {/* The dated history, where it belongs: beside the thing being changed. */}
        {past.length > 0 && (
          <div className="space-y-1">
            <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide">
              <History className="size-3.5" /> Rate history
            </div>
            <ul className="max-h-32 space-y-0.5 overflow-auto rounded-[4px] border p-1.5">
              {past.map((h) => (
                <li key={h.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-[12.5px] hover:bg-muted/50">
                  <span className="font-bold tabular-nums text-emerald-700">
                    ₹{num(h.ratePerUnit)}
                    <span className="text-muted-foreground text-[9.5px] font-semibold">/{basisUnit(h.basis)}</span>
                  </span>
                  <span className="tabular-nums">{formatDate(h.effectiveFrom)}</span>
                  {h.current && (
                    <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9.5px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      current
                    </span>
                  )}
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">{h.note}</span>
                  {can('agentcommission:update') && (
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Remove this rate?',
                          description: `${h.agentName} · ${h.pCategory} · ₹${h.ratePerUnit}/${basisUnit(h.basis)} from ${formatDate(h.effectiveFrom)}. Invoices already priced on it keep their commission until you re-price.`,
                          confirmText: 'Remove',
                          destructive: true,
                        });
                        if (ok) del.mutate(h.id, { onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')) });
                      }}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex size-6 shrink-0 items-center justify-center rounded-[4px]"
                      aria-label={`Remove the ₹${h.ratePerUnit} rate from ${formatDate(h.effectiveFrom)}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : current ? <Pencil /> : <Plus />} {current ? 'Save new rate' : 'Set rate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
