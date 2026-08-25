import { useMemo, useState } from 'react';
import { FlaskConical, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  basisUnit,
  COMMISSION_BASES,
  SPECIAL_COMMISSION_SCOPE_LABEL,
  SPECIAL_COMMISSION_SCOPES,
  type AgentSpecialCommissionDto,
  type CommissionBasis,
  type SpecialCommissionScope,
} from '@oms/shared';
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
  useCreateSpecialCommission,
  useDeleteSpecialCommission,
  useSpecialCommissions,
  useTestCommissionRate,
} from './use-agent-commission';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TH = 'bg-gradient-to-b from-blue-800 to-indigo-800 px-2 py-1.5 text-[11px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap';
const TD = 'px-2 py-1.5 text-[12.5px]';

/** Which fields a scope actually uses — drives both the form and its validation. */
const NEEDS: Record<SpecialCommissionScope, { category: boolean; subCategory: boolean; product: boolean; design: boolean; party: 'required' | 'optional' }> = {
  CUSTOMER: { category: false, subCategory: false, product: false, design: false, party: 'required' },
  CATEGORY: { category: true, subCategory: false, product: false, design: false, party: 'optional' },
  SUBCATEGORY: { category: true, subCategory: true, product: false, design: false, party: 'optional' },
  PRODUCT: { category: true, subCategory: false, product: true, design: false, party: 'optional' },
  DESIGN: { category: true, subCategory: false, product: false, design: true, party: 'optional' },
};

/**
 * Special Commission — overrides of an agent's base rate.
 *
 * The base grid answers "what does this agent earn on GLASS?", one number per
 * category. Real arrangements are not that flat: a big party negotiated on a
 * thinner margin, or a design that is hard to sell paying more. Before this, the
 * only way to say that was to change the base rate — for every party and every
 * product at once.
 *
 * The rules are REPLACEMENTS, not deltas (a commission rate is the whole number
 * per unit, so adding two would be meaningless), exactly one wins, and if none
 * matches the base rate applies.
 */
export function SpecialCommissionPanel() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const canEdit = can('agentcommission:update');

  const { data: agents } = useAgents({ page: 1, pageSize: 500 });
  const { data: lookups } = useOrderLookups();
  const [filterAgent, setFilterAgent] = useState('');
  const filterAgentId = useMemo(() => (agents?.items ?? []).find((a) => a.name === filterAgent)?.id, [agents, filterAgent]);
  const { data: rules, isLoading } = useSpecialCommissions(filterAgentId);
  const [adding, setAdding] = useState(false);
  const del = useDeleteSpecialCommission();

  const rows = rules ?? [];

  const remove = async (r: AgentSpecialCommissionDto) => {
    const ok = await confirm({
      title: 'Remove this special rate?',
      description: `${r.agentName} — ${describe(r)} at ₹${r.ratePerUnit}/${basisUnit(r.basis)}. Invoices will re-price to the next matching rule, or to the base rate.`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(r.id, {
      onSuccess: (r) => {
        const n = r?.repriced?.challans ?? 0;
        toast.success(n ? `Special rate removed — ${n} invoice${n === 1 ? '' : 's'} re-priced` : 'Special rate removed');
      },
      onError: (e) => toast.error(getApiErrorMessage(e, 'Could not remove the rule')),
    });
  };

  return (
    <div className="space-y-3">
      {/* How this behaves, stated once. The precedence is the part people get
          wrong, and getting it wrong means paying an agent the wrong amount. */}
      <div className="flex items-start gap-2 rounded-[4px] border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-[12.5px] text-indigo-900 dark:border-indigo-400/30 dark:bg-indigo-500/10 dark:text-indigo-200">
        <Sparkles className="mt-0.5 size-4 shrink-0" />
        <p>
          A special rate <b>replaces</b> the base rate for the lines it matches — it is not added to it. When several rules
          match, the one naming the <b>party</b> wins; among equals the narrower aim wins (design → product → sub-category →
          category → party). A rate only applies where the category is charged in the same unit, so a per-kg rate never
          prices a per-piece category. If nothing matches, the base rate applies.
        </p>
      </div>

      <RateTester agents={agents?.items ?? []} lookups={lookups} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full min-w-0 space-y-1 sm:w-64">
          <Label className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">Agent</Label>
          <NativeSelect
            value={filterAgent}
            onChange={setFilterAgent}
            options={['', ...(agents?.items ?? []).map((a) => a.name)]}
            placeholder="All agents"
          />
        </div>
        {canEdit && (
          <Button className="bg-gradient-brand ml-auto h-9 text-white shadow-sm hover:opacity-95" onClick={() => setAdding(true)}>
            <Plus /> Add special rate
          </Button>
        )}
      </div>

      {/* ── Desktop table ─────────────────────────────────────────────────── */}
      <div className="bg-card hidden overflow-auto rounded-[4px] border shadow-sm sm:block">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={TH}>Agent</th>
              <th className={TH}>Applies to</th>
              <th className={TH}>Party</th>
              <th className={cn(TH, 'text-right')}>Rate</th>
              <th className={TH}>From</th>
              <th className={TH}>Note</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="py-10 text-center">
                  <Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" />
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={7} className="text-muted-foreground py-12 text-center text-[13px]">
                  No special rates yet — every line prices at the agent&rsquo;s base rate.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className={cn('border-b', !r.current && 'text-muted-foreground bg-slate-50/70 dark:bg-white/[0.03]')}>
                  <td className={cn(TD, 'font-semibold')}>{r.agentName}</td>
                  <td className={TD}>
                    <ScopeChip scope={r.scope} />
                    <span className="ml-1.5 font-semibold">{describe(r)}</span>
                  </td>
                  <td className={TD}>{r.customerName ?? <span className="text-muted-foreground">All parties</span>}</td>
                  <td className={cn(TD, 'text-right font-bold tabular-nums')}>
                    ₹{r.ratePerUnit}
                    <span className="text-muted-foreground text-[10px]">/{basisUnit(r.basis)}</span>
                  </td>
                  <td className={cn(TD, 'whitespace-nowrap tabular-nums')}>
                    {formatDate(r.effectiveFrom)}
                    {/* A rule kept only for history: superseded by a later one at
                        the same aim, or not yet in force. Shown rather than
                        hidden, because an invoice from that period still priced
                        on it. */}
                    {!r.current && <span className="ml-1 text-[10px] font-bold uppercase">superseded</span>}
                  </td>
                  <td className={cn(TD, 'text-muted-foreground max-w-[16rem] truncate')} title={r.note ?? undefined}>
                    {r.note ?? ''}
                  </td>
                  <td className={TD}>
                    {canEdit && (
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => remove(r)} disabled={del.isPending} aria-label="Remove">
                        <Trash2 className="size-3.5 text-rose-600" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Phones ────────────────────────────────────────────────────────── */}
      <div className="space-y-2.5 sm:hidden">
        {isLoading ? (
          <div className="text-muted-foreground flex h-24 items-center justify-center rounded-2xl border">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : !rows.length ? (
          <div className="text-muted-foreground rounded-2xl border px-4 py-10 text-center text-sm">
            No special rates yet — every line prices at the agent&rsquo;s base rate.
          </div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className={cn('bg-card rounded-2xl border p-3 shadow-sm', !r.current && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[14px] leading-tight font-extrabold break-words">{r.agentName}</p>
                  <p className="mt-0.5 text-[12px] font-semibold break-words">{describe(r)}</p>
                </div>
                <span className="shrink-0 text-[15px] font-extrabold tabular-nums">
                  ₹{r.ratePerUnit}
                  <span className="text-muted-foreground text-[10px]">/{basisUnit(r.basis)}</span>
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <ScopeChip scope={r.scope} />
                <span className="text-muted-foreground text-[11px] font-medium">
                  {r.customerName ?? 'All parties'} · from {formatDate(r.effectiveFrom)}
                </span>
                {!r.current && <span className="text-muted-foreground text-[10px] font-bold uppercase">superseded</span>}
              </div>
              {r.note && <p className="text-muted-foreground mt-1.5 border-l-2 border-amber-300 pl-2 text-[11.5px]">{r.note}</p>}
              {canEdit && (
                <Button variant="outline" size="sm" className="mt-2 h-8 w-full text-[12px]" onClick={() => remove(r)} disabled={del.isPending}>
                  <Trash2 className="size-3.5" /> Remove
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      {adding && <AddSpecialDialog agents={agents?.items ?? []} lookups={lookups} onClose={() => setAdding(false)} />}
    </div>
  );
}

function ScopeChip({ scope }: { scope: SpecialCommissionScope }) {
  return (
    <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-400/25">
      {SPECIAL_COMMISSION_SCOPE_LABEL[scope]}
    </span>
  );
}

/** What the rule is aimed at, in one phrase. */
function describe(r: AgentSpecialCommissionDto): string {
  switch (r.scope) {
    case 'DESIGN':
      return [r.pCategory, r.subCategory, r.designType].filter(Boolean).join(' · ');
    case 'PRODUCT':
      return [r.pCategory, r.subCategory, r.product].filter(Boolean).join(' · ');
    case 'SUBCATEGORY':
      return [r.pCategory, r.subCategory].filter(Boolean).join(' · ');
    case 'CATEGORY':
      return r.pCategory ?? '—';
    default:
      return r.customerName ?? '—';
  }
}

/**
 * "What would this line pay?" — answered by the server's resolver.
 *
 * Worth its own panel because the precedence between five scopes and
 * party-or-not is genuinely hard to hold in your head, and the alternative way
 * to find out is to re-price every invoice and read the result off a settlement.
 */
function RateTester({
  agents,
  lookups,
}: {
  agents: { id: number; name: string }[];
  lookups: ReturnType<typeof useOrderLookups>['data'];
}) {
  const [open, setOpen] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [party, setParty] = useState('');
  const [pCategory, setPCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [product, setProduct] = useState('');
  const [designType, setDesignType] = useState('');

  const agentId = agents.find((a) => a.name === agentName)?.id;
  const customerId = (lookups?.customers ?? []).find((c) => c.name === party)?.id;
  const parties = useMemo(() => partiesOfAgent(lookups?.customers, agentName), [lookups, agentName]);
  const { data: result, isFetching } = useTestCommissionRate({
    agentId,
    customerId: customerId ?? null,
    pCategory: pCategory || null,
    subCategory: subCategory || null,
    product: product || null,
    designType: designType || null,
  });

  const cats = useMemo(() => [...new Set((lookups?.products ?? []).map((p) => p.category))].filter(Boolean).sort(), [lookups]);
  const subs = useMemo(
    () => [...new Set((lookups?.products ?? []).filter((p) => !pCategory || p.category === pCategory).map((p) => p.subCategory))].filter(Boolean).sort(),
    [lookups, pCategory],
  );
  const prods = useMemo(
    () => [...new Set((lookups?.products ?? []).filter((p) => !pCategory || p.category === pCategory).map((p) => p.product))].filter(Boolean).sort(),
    [lookups, pCategory],
  );
  const designs = useMemo(
    () => [...new Set((lookups?.designs ?? []).filter((d) => !pCategory || d.category === pCategory).map((d) => d.designType))].filter(Boolean).sort(),
    [lookups, pCategory],
  );

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setOpen(true)}>
        <FlaskConical className="size-3.5" /> Check what rate applies
      </Button>
    );
  }

  return (
    <div className="bg-card rounded-[4px] border border-dashed border-indigo-300 p-2.5 shadow-sm dark:border-indigo-400/40">
      <div className="mb-2 flex items-center gap-2">
        <FlaskConical className="size-4 text-indigo-600" />
        <p className="text-[12.5px] font-bold">What rate applies?</p>
        <Button variant="ghost" size="sm" className="ml-auto h-7 text-[11.5px]" onClick={() => setOpen(false)}>
          Hide
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Agent">
          {/* Switching agent invalidates the party — it belongs to the old one. */}
          <NativeSelect value={agentName} onChange={(v) => { setAgentName(v); setParty(''); }} options={['', ...agents.map((a) => a.name)]} placeholder="Pick agent" />
        </Field>
        <Field label="Party">
          <NativeSelect value={party} onChange={setParty} options={['', ...parties]} placeholder="Any party" />
        </Field>
        <Field label="Category">
          <NativeSelect value={pCategory} onChange={setPCategory} options={['', ...cats]} placeholder="Any" />
        </Field>
        <Field label="Sub-category">
          <NativeSelect value={subCategory} onChange={setSubCategory} options={['', ...subs]} placeholder="Any" />
        </Field>
        <Field label="Product">
          <NativeSelect value={product} onChange={setProduct} options={['', ...prods]} placeholder="Any" />
        </Field>
        <Field label="Design">
          <NativeSelect value={designType} onChange={setDesignType} options={['', ...designs]} placeholder="Any" />
        </Field>
      </div>
      <div className="mt-2 rounded-[4px] border bg-slate-50 px-2.5 py-2 dark:bg-white/[0.04]">
        {!agentId ? (
          <p className="text-muted-foreground text-[12px]">Pick an agent to see the rate.</p>
        ) : isFetching && !result ? (
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        ) : !result ? (
          <p className="text-[12.5px] font-semibold text-rose-700 dark:text-rose-300">
            Nothing would be earned — there is no base rate for this category and no special rule matches.
          </p>
        ) : (
          <p className="text-[13px]">
            <span className="text-[17px] font-extrabold tabular-nums">
              ₹{result.ratePerUnit}
              <span className="text-muted-foreground text-[11px]">/{basisUnit(result.basis)}</span>
            </span>
            <span className="text-muted-foreground ml-2">
              from <span className="text-foreground font-semibold">{result.label}</span>
              {result.scope == null && ' (no special rule matches)'}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-muted-foreground text-[10px] font-bold tracking-wide uppercase">{label}</Label>
      {children}
    </div>
  );
}

/** The parties this agent actually sells to.
 *
 *  A special rate is scoped to one agent, so aiming it at somebody else's party
 *  produces a rule that can never match a line. The picker offered all 137
 *  customers regardless of the agent — JOHN has 9 — so the wrong pick was the
 *  easy one. No agent chosen yet → nothing to narrow by, so offer everyone. */
function partiesOfAgent(
  customers: { name: string; agentName: string | null }[] | undefined,
  agentName: string,
): string[] {
  const list = customers ?? [];
  const a = agentName.trim().toUpperCase();
  if (!a) return list.map((c) => c.name);
  return list.filter((c) => (c.agentName ?? '').trim().toUpperCase() === a).map((c) => c.name);
}

/** Add a rule. The scope decides which fields appear at all — an empty box that
 *  does nothing is how a rule gets saved aimed at the wrong thing. */
function AddSpecialDialog({
  agents,
  lookups,
  onClose,
}: {
  agents: { id: number; name: string }[];
  lookups: ReturnType<typeof useOrderLookups>['data'];
  onClose: () => void;
}) {
  const create = useCreateSpecialCommission();
  const [agentName, setAgentName] = useState('');
  const [scope, setScope] = useState<SpecialCommissionScope>('CUSTOMER');
  const [party, setParty] = useState('');
  const [pCategory, setPCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [product, setProduct] = useState('');
  const [designType, setDesignType] = useState('');
  const [basis, setBasis] = useState<CommissionBasis>('KGS');
  const [rate, setRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(ymd(new Date()));
  const [note, setNote] = useState('');

  const needs = NEEDS[scope];
  const agentId = agents.find((a) => a.name === agentName)?.id;
  const customerId = (lookups?.customers ?? []).find((c) => c.name === party)?.id;
  const parties = useMemo(() => partiesOfAgent(lookups?.customers, agentName), [lookups, agentName]);

  const cats = useMemo(() => [...new Set((lookups?.products ?? []).map((p) => p.category))].filter(Boolean).sort(), [lookups]);
  const subs = useMemo(
    () => [...new Set((lookups?.products ?? []).filter((p) => !pCategory || p.category === pCategory).map((p) => p.subCategory))].filter(Boolean).sort(),
    [lookups, pCategory],
  );
  const prods = useMemo(
    () => [...new Set((lookups?.products ?? []).filter((p) => !pCategory || p.category === pCategory).map((p) => p.product))].filter(Boolean).sort(),
    [lookups, pCategory],
  );
  const designs = useMemo(
    () => [...new Set((lookups?.designs ?? []).filter((d) => !pCategory || d.category === pCategory).map((d) => d.designType))].filter(Boolean).sort(),
    [lookups, pCategory],
  );

  // The category's own KGS/PCS setting, so the basis is not a guess: commission
  // follows the unit the product master already prices that category in.
  const categoryBasis = useMemo(() => {
    const f = (lookups?.categoryFields ?? []).find((c) => c.category.toUpperCase() === pCategory.toUpperCase());
    return f ? ((f.field === 'PCS' ? 'PCS' : 'KGS') as CommissionBasis) : null;
  }, [lookups, pCategory]);
  const effectiveBasis = categoryBasis ?? basis;

  /** Everything that must be true before this can be saved, as a sentence. */
  const blocker = useMemo((): string | null => {
    if (!agentId) return 'Choose an agent.';
    if (needs.party === 'required' && !customerId) return 'A party rule needs a party.';
    if (needs.category && !pCategory) return 'Choose the product category.';
    if (needs.subCategory && !subCategory) return 'Choose the sub-category.';
    if (needs.product && !product) return 'Choose the product.';
    if (needs.design && !designType) return 'Choose the design.';
    const n = Number(rate);
    if (rate.trim() === '' || !Number.isFinite(n)) return 'Enter the rate.';
    if (n < 0) return 'The rate cannot be negative.';
    if (!effectiveFrom) return 'Set the date this rate takes effect.';
    return null;
  }, [agentId, customerId, needs, pCategory, subCategory, product, designType, rate, effectiveFrom]);

  const save = () => {
    if (blocker) return toast.error(blocker);
    create.mutate(
      {
        agentId: agentId!,
        scope,
        customerId: customerId ?? null,
        pCategory: needs.category ? pCategory : null,
        subCategory: needs.subCategory || needs.product || needs.design ? subCategory || null : null,
        product: needs.product ? product : null,
        designType: needs.design ? designType : null,
        basis: effectiveBasis,
        ratePerUnit: Number(rate),
        effectiveFrom,
        note: note.trim() || null,
      },
      {
        onSuccess: (saved) => {
          const n = saved.repriced?.challans ?? 0;
          toast.success(
            n
              ? `Special rate saved — ${n} invoice${n === 1 ? '' : 's'} priced on it`
              : 'Special rate saved — no invoices match it yet',
          );
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not save the rule')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a special commission rate</DialogTitle>
          <DialogDescription>
            This replaces the base rate on the lines it matches. Existing invoices keep their figures until you re-price.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Agent">
              {/* Switching agent invalidates the party — it belongs to the old one. */}
              <NativeSelect value={agentName} onChange={(v) => { setAgentName(v); setParty(''); }} options={['', ...agents.map((a) => a.name)]} placeholder="Pick agent" />
            </Field>
            <Field label="Applies to">
              <NativeSelect
                value={scope}
                onChange={(v) => setScope(v as SpecialCommissionScope)}
                options={SPECIAL_COMMISSION_SCOPES.map((s) => ({ value: s, label: SPECIAL_COMMISSION_SCOPE_LABEL[s] }))}
              />
            </Field>
          </div>

          <Field label={needs.party === 'required' ? 'Party' : 'Party (optional — leave blank for all)'}>
            <NativeSelect value={party} onChange={setParty} options={['', ...parties]} placeholder="All parties" />
            {agentName && parties.length === 0 && (
              <p className="mt-1 text-[11.5px] font-medium text-amber-700">No party is assigned to {agentName} yet — set the agent on the customer first.</p>
            )}
          </Field>

          {needs.category && (
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Category">
                <NativeSelect value={pCategory} onChange={setPCategory} options={['', ...cats]} placeholder="Pick category" />
              </Field>
              {/* Optional on PRODUCT/DESIGN: it narrows the rule when given, and
                  those scopes are already specific enough without it. */}
              {(needs.subCategory || needs.product || needs.design) && (
                <Field label={needs.subCategory ? 'Sub-category' : 'Sub-category (optional)'}>
                  <NativeSelect value={subCategory} onChange={setSubCategory} options={['', ...subs]} placeholder="Any" />
                </Field>
              )}
            </div>
          )}

          {needs.product && (
            <Field label="Product">
              <NativeSelect value={product} onChange={setProduct} options={['', ...prods]} placeholder="Pick product" />
            </Field>
          )}
          {needs.design && (
            <Field label="Design">
              <NativeSelect value={designType} onChange={setDesignType} options={['', ...designs]} placeholder="Pick design" />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <Field label={`Rate per ${basisUnit(effectiveBasis)}`}>
              <Input type="number" step="any" min={0} value={rate} onChange={(e) => setRate(e.target.value)} className="text-right tabular-nums" />
            </Field>
            <Field label="Effective from">
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="tabular-nums" />
            </Field>
          </div>

          {/* The basis is the category's, not a choice — it decides the QUANTITY
              the money is calculated on, and a special only ever decides the
              rate. Offered manually only where the category has no setting. */}
          {categoryBasis ? (
            <p className="text-muted-foreground text-[11.5px]">
              {pCategory} is charged per <span className="text-foreground font-semibold">{basisUnit(categoryBasis)}</span> — set on
              the Products page, so this rate follows it.
            </p>
          ) : (
            <>
              <Field label="Charged per">
                <NativeSelect value={basis} onChange={(v) => setBasis(v as CommissionBasis)} options={[...COMMISSION_BASES]} />
              </Field>
              {/* A party rule names no category, so it would otherwise reach
                  per-kg and per-piece categories alike — and ₹30 meant per kg
                  paid per piece is sixty times the intended amount on cups.
                  The rule only prices categories charged in ITS unit; say so
                  here rather than letting someone discover it in a settlement. */}
              <p className="text-muted-foreground text-[11.5px]">
                This rate is per <span className="text-foreground font-semibold">{basisUnit(basis)}</span>, so it applies only to
                categories charged per {basisUnit(basis)}. Add a second rule for the others.
              </p>
            </>
          )}

          <Field label="Note (why this rate was agreed)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. volume deal agreed Aug 2026" />
          </Field>

          {blocker && (
            <p className="rounded-[4px] border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11.5px] font-medium text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-300">
              {blocker}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={create.isPending || !!blocker}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Save rate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
