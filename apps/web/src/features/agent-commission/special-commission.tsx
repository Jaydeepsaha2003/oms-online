import { useMemo, useState } from 'react';
import { FlaskConical, Loader2, Plus, Receipt, Search, Sparkles } from 'lucide-react';
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
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { ACCENTS, AddButton, deleteAction, LevelButtons, Panel, PanelField } from '@/components/common/rate-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAgents } from '@/features/agents/use-agents';
import { useOrderLookups } from '@/features/orders/use-orders';
import {
  useCreateSpecialCommission,
  useCreateSpecialCommissionBulk,
  useDeleteSpecialCommission,
  useSpecialCommissions,
  useTestCommissionRate,
} from './use-agent-commission';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
/** The five aims a rule can take, widest first — same idiom as the customer
 *  Special Rates level picker. */
const LEVELS: { value: SpecialCommissionScope; label: string; title: string }[] = SPECIAL_COMMISSION_SCOPES.map((v) => ({
  value: v,
  label: SPECIAL_COMMISSION_SCOPE_LABEL[v],
  title:
    v === 'CUSTOMER'
      ? 'One party, whatever they buy'
      : v === 'CATEGORY'
        ? 'A product category'
        : v === 'SUBCATEGORY'
          ? 'One sub-category inside a category'
          : v === 'PRODUCT'
            ? 'One product'
            : 'One design type',
}));

const PRECEDENCE_INFO =
  'A special rate REPLACES the base rate on the lines it matches — it is never added to it. When several rules match, the one naming the party wins; among equals the narrower aim wins (design → product → sub-category → category → party). A rate only applies where the category is charged in the same unit, so a per-kg rate never prices a per-piece category. If nothing matches, the base rate applies.';

export function SpecialCommissionPanel() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const canEdit = can('agentcommission:update');
  const accent = ACCENTS.COMMISSION;

  const { data: agents } = useAgents({ page: 1, pageSize: 500 });
  const { data: lookups } = useOrderLookups();
  const [filterAgent, setFilterAgent] = useState('');
  const filterAgentId = useMemo(() => (agents?.items ?? []).find((a) => a.name === filterAgent)?.id, [agents, filterAgent]);
  const { data: rules, isLoading } = useSpecialCommissions(filterAgentId);
  const del = useDeleteSpecialCommission();
  const create = useCreateSpecialCommission();
  const createBulk = useCreateSpecialCommissionBulk();

  const rows = rules ?? [];
  const agentList = agents?.items ?? [];

  /* ── the add form, inline rather than in a modal ────────────────────────
   * The dialog was a second surface for a rule the list is already showing:
   * you could not see what was already set while deciding what to add, and on a
   * phone it filled the screen. Inline is what the customer Special Rates screen
   * does, and it is the pattern this was asked to match. */
  /*
   * Simple by default; Advanced only when the job needs it.
   *
   * Simple aims the rule at all of the agent's parties (or at one, for a Party
   * rule) — which is what almost every rule is. Advanced exists for the case
   * Simple genuinely cannot express: the same rate for SOME parties but not
   * others, which otherwise meant adding the rule once per party by hand.
   *
   * Not two screens and not a mode switch that changes what the fields mean —
   * the form is identical either way, Advanced just swaps the single party box
   * for a checklist.
   */
  const [advanced, setAdvanced] = useState(false);
  const [partyIds, setPartyIds] = useState<Set<number>>(new Set());
  const [partySearch, setPartySearch] = useState('');

  const [scope, setScope] = useState<SpecialCommissionScope>('CUSTOMER');
  const [agentName, setAgentName] = useState('');
  const [party, setParty] = useState('');
  const [pCategory, setPCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [product, setProduct] = useState('');
  const [designType, setDesignType] = useState('');
  const [basis, setBasis] = useState<CommissionBasis>('KGS');
  const [rate, setRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(ymd(new Date()));
  const [note, setNote] = useState('');
  /** Fold this rate into the party's product price instead of paying it out of
   *  margin at settlement. Only ever writable when a party is actually
   *  attached — see the toggle's own gating below — and reset after every
   *  save (unlike agent/scope) since it changes what a customer is BILLED and
   *  should never carry over unnoticed onto the next rule. */
  const [addToRate, setAddToRate] = useState(false);

  const needs = NEEDS[scope];
  const agentId = agentList.find((a) => a.name === agentName)?.id;
  const customerId = (lookups?.customers ?? []).find((c) => c.name === party)?.id;
  const parties = useMemo(() => partiesOfAgent(lookups?.customers, agentName), [lookups, agentName]);
  /** The agent's parties as {id,name}, for the Advanced checklist. Same source
   *  and same agent filter as `parties`, so the two lists cannot disagree. */
  const partyRows = useMemo(() => {
    const names = new Set(parties);
    return (lookups?.customers ?? []).filter((c) => names.has(c.name)).map((c) => ({ id: c.id, name: c.name }));
  }, [lookups, parties]);
  const shownParties = useMemo(
    () => partyRows.filter((c) => !partySearch.trim() || c.name.toLowerCase().includes(partySearch.trim().toLowerCase())),
    [partyRows, partySearch],
  );
  const allPartiesChecked = partyRows.length > 0 && partyIds.size === partyRows.length;

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

  // The category's own KGS/PCS setting, so the unit is not a guess: commission
  // follows the unit the product master already prices that category in.
  const categoryBasis = useMemo(() => {
    const f = (lookups?.categoryFields ?? []).find((c) => c.category.toUpperCase() === pCategory.toUpperCase());
    return f ? ((f.field === 'PCS' ? 'PCS' : 'KGS') as CommissionBasis) : null;
  }, [lookups, pCategory]);
  const effectiveBasis = categoryBasis ?? basis;

  // Whether a party is actually going to be attached to the rule being built —
  // true for ANY scope, not just CUSTOMER (see NEEDS: party is always offered,
  // only required for CUSTOMER). This is what decides whether "add to rate"
  // has anything to attach to.
  const partyChosen = advanced ? partyIds.size > 0 : !!customerId;

  const blocker = useMemo((): string | null => {
    if (!agentId) return 'Choose an agent.';
    if (advanced) {
      // A Party-level rule aimed at nobody is the one case Advanced cannot leave
      // blank: with no party there is nothing for the rule to be about.
      if (needs.party === 'required' && partyIds.size === 0) return 'Tick at least one party.';
    } else if (needs.party === 'required' && !customerId) {
      return 'A party rule needs a party.';
    }
    if (addToRate && !partyChosen) return 'Adding this to the rate needs a party — pick one, or turn it off.';
    if (needs.category && !pCategory) return 'Choose the product category.';
    if (needs.subCategory && !subCategory) return 'Choose the sub-category.';
    if (needs.product && !product) return 'Choose the product.';
    if (needs.design && !designType) return 'Choose the design.';
    const n = Number(rate);
    if (rate.trim() === '' || !Number.isFinite(n)) return 'Enter the rate.';
    if (n < 0) return 'The rate cannot be negative.';
    if (!effectiveFrom) return 'Set the date this rate takes effect.';
    return null;
  }, [agentId, customerId, needs, pCategory, subCategory, product, designType, rate, effectiveFrom, advanced, partyIds, addToRate, partyChosen]);

  const submit = () => {
    if (blocker) return toast.error(blocker);
    const common = {
      agentId: agentId!,
      scope,
      pCategory: needs.category ? pCategory : null,
      subCategory: needs.subCategory || needs.product || needs.design ? subCategory || null : null,
      product: needs.product ? product : null,
      designType: needs.design ? designType : null,
      basis: effectiveBasis,
      ratePerUnit: Number(rate),
      effectiveFrom,
      note: note.trim() || null,
      addToRate: partyChosen && addToRate,
    };

    // The figures reset on success, and so does "add to rate" — the agent and
    // the aim stay put (the next rule is nearly always the same agent at a
    // neighbouring aim), but a billing-affecting toggle should never silently
    // carry over onto a rule the user hasn't looked at yet.
    const done = () => {
      setRate('');
      setNote('');
      setAddToRate(false);
    };
    const onError = (e: unknown) => toast.error(getApiErrorMessage(e, 'Could not save the rule'));

    if (advanced) {
      createBulk.mutate(
        { ...common, customerIds: [...partyIds] },
        {
          onSuccess: (r) => {
            const n = r.repriced?.challans ?? 0;
            toast.success(
              `${r.created} rule${r.created === 1 ? '' : 's'} saved` +
                (r.skipped ? `, ${r.skipped} already set` : '') +
                (n ? ` — ${n} invoice${n === 1 ? '' : 's'} re-priced` : ''),
            );
            done();
          },
          onError,
        },
      );
      return;
    }

    create.mutate(
      { ...common, customerId: customerId ?? null },
      {
        onSuccess: (saved) => {
          const n = saved.repriced?.challans ?? 0;
          toast.success(n ? `Saved — ${n} invoice${n === 1 ? '' : 's'} priced on it` : 'Saved — no invoices match it yet');
          done();
        },
        onError,
      },
    );
  };

  const remove = async (r: AgentSpecialCommissionDto) => {
    const ok = await confirm({
      title: 'Remove this special rate?',
      description: `${r.agentName} — ${describe(r)} at ₹${r.ratePerUnit}/${basisUnit(r.basis)}. Invoices will re-price to the next matching rule, or to the base rate.`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(r.id, {
      onSuccess: (res) => {
        const n = res?.repriced?.challans ?? 0;
        toast.success(n ? `Removed — ${n} invoice${n === 1 ? '' : 's'} re-priced` : 'Special rate removed');
      },
      onError: (e) => toast.error(getApiErrorMessage(e, 'Could not remove the rule')),
    });
  };

  const columns: DataColumn<AgentSpecialCommissionDto>[] = [
    { id: 'agent', label: 'Agent', cell: (r) => <span className="font-semibold">{r.agentName}</span> },
    {
      id: 'aim',
      label: 'Applies to',
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <ScopeChip scope={r.scope} />
          <span className="font-medium">{describe(r)}</span>
        </span>
      ),
    },
    {
      id: 'party',
      label: 'Party',
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {r.customerName ?? <span className="text-muted-foreground">All parties</span>}
          {r.addToRate && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
              title="Added onto this party's product rate — shows on their invoice, not just paid at settlement"
            >
              <Receipt className="size-2.5" /> in rate
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'rate',
      label: 'Rate',
      align: 'right',
      cell: (r) => (
        <span className="font-bold tabular-nums">
          ₹{r.ratePerUnit}
          <span className="text-muted-foreground text-[10px]">/{basisUnit(r.basis)}</span>
        </span>
      ),
    },
    {
      id: 'from',
      label: 'From',
      cell: (r) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatDate(r.effectiveFrom)}
          {/* Kept only for history: replaced by a later rule at the same aim, or
              not started yet. Shown rather than hidden, because an invoice from
              that period was still priced on it. Same word as the All-rates
              register's chip, so one thing has one name. */}
          {!r.current && <span className="text-muted-foreground ml-1 text-[10px] font-bold uppercase">replaced</span>}
        </span>
      ),
    },
    { id: 'note', label: 'Note', cell: (r) => <span className="text-muted-foreground">{r.note ?? ''}</span> },
  ];

  return (
    <div className="space-y-3">
      <Panel
        title="Special Commission"
        icon={<Sparkles className="size-4" />}
        accent={accent}
        info={PRECEDENCE_INFO}
        badge={`${rows.length} set`}
      >
        {canEdit && (
          <div className="space-y-3 rounded-lg border bg-slate-50/70 p-3 dark:bg-white/[0.03]">
            <div className="flex flex-wrap items-center gap-2">
              <LevelButtons
                levels={LEVELS}
                value={scope}
                accent={accent}
                onChange={(v) => {
                setScope(v);
                // Clear what the new aim does not use, so a stale box cannot be
                // saved into a rule aimed somewhere else.
                const n = NEEDS[v];
                if (!n.category) setPCategory('');
                if (!n.subCategory && !n.product && !n.design) setSubCategory('');
                if (!n.product) setProduct('');
                  if (!n.design) setDesignType('');
                }}
              />
              {/* Simple / Advanced, beside the levels rather than above them: it
                  changes only HOW the parties are chosen, not what the rule is
                  aimed at, so it belongs on the same line as the aim. */}
              <div role="group" aria-label="Party selection mode" className="ml-auto inline-flex h-9 overflow-hidden rounded-md border">
                {([[false, 'Simple'], [true, 'Advanced']] as const).map(([v, label], i) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={advanced === v}
                    onClick={() => setAdvanced(v)}
                    title={
                      v
                        ? 'Choose several parties, and write the same rule for each'
                        : 'One rule — for all of this agent’s parties, or one named party'
                    }
                    className={cn(
                      'cursor-pointer px-3 text-[12.5px] font-semibold transition-colors',
                      i > 0 && 'border-l',
                      advanced === v ? 'bg-slate-700 text-white' : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <PanelField label="Agent">
                <NativeSelect
                  value={agentName}
                  onChange={(v) => {
                    setAgentName(v);
                    setParty('');
                  }}
                  options={agentList.map((a) => a.name)}
                  placeholder="Pick agent…"
                />
              </PanelField>

              {/* Simple: one box. Only CUSTOMER rules REQUIRE a party; the others
                  may name one to narrow the rule, or leave it as "all parties". */}
              {!advanced && (
                <PanelField label={needs.party === 'required' ? 'Party' : 'Party — optional'}>
                  <NativeSelect
                    value={party}
                    onChange={setParty}
                    options={['', ...parties]}
                    placeholder={agentName ? 'All parties' : 'Pick an agent first'}
                    disabled={!agentName}
                  />
                </PanelField>
              )}

              {needs.category && (
                <PanelField label="Category">
                  <NativeSelect
                    value={pCategory}
                    onChange={(v) => {
                      setPCategory(v);
                      setSubCategory('');
                      setProduct('');
                      setDesignType('');
                    }}
                    options={cats}
                    placeholder="Category…"
                  />
                </PanelField>
              )}

              {needs.subCategory && (
                <PanelField label="Sub-category">
                  <NativeSelect value={subCategory} onChange={setSubCategory} options={subs} placeholder="Sub-category…" disabled={!pCategory} />
                </PanelField>
              )}

              {needs.product && (
                <PanelField label="Product">
                  <NativeSelect value={product} onChange={setProduct} options={prods} placeholder="Product…" disabled={!pCategory} />
                </PanelField>
              )}

              {needs.design && (
                <PanelField label="Design">
                  <NativeSelect value={designType} onChange={setDesignType} options={designs} placeholder="Design…" disabled={!pCategory} />
                </PanelField>
              )}

              <PanelField label={`Rate per ${basisUnit(effectiveBasis)}`}>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="e.g. 2.50"
                  className="text-right tabular-nums"
                />
              </PanelField>

              {/*
                * Only offered once a party is actually attached — commission
                * folded into "the product rate" has to be somebody's product
                * rate, and a general (all-parties) rule has no single price to
                * raise. `partyChosen` covers Simple and Advanced alike.
                */}
              {partyChosen && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                      addToRate
                        ? 'border-amber-300 bg-amber-50 dark:border-amber-400/40 dark:bg-amber-400/10'
                        : 'bg-white hover:bg-slate-50 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]',
                    )}
                  >
                    <Switch checked={addToRate} onCheckedChange={setAddToRate} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                        <Receipt className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                        Add this rate to the product price
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-[11.5px] leading-snug">
                        {addToRate
                          ? `This amount is added onto the product rate on this party's orders — it shows on their invoice. The agent is still paid it separately, exactly as usual.`
                          : `Off (usual): the agent is paid this out of margin at settlement — the party's price is untouched. Turn on to charge it through instead.`}
                      </span>
                    </span>
                  </label>
                </div>
              )}

              <PanelField label="Charged per">
                {/* Locked to the category's own basis when the category is known:
                    commission has to be charged in the unit the category is
                    priced in, and letting the two disagree produced a rule that
                    silently never matched anything. */}
                <NativeSelect
                  value={effectiveBasis}
                  onChange={(v) => setBasis(v as CommissionBasis)}
                  options={[...COMMISSION_BASES]}
                  disabled={!!categoryBasis}
                />
              </PanelField>

              <PanelField label="Effective from">
                <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="tabular-nums" />
              </PanelField>

              <PanelField label="Note — why this was agreed" className="sm:col-span-2 lg:col-span-3">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. volume deal agreed Aug 2026" />
              </PanelField>
            </div>

            {/*
              * Advanced: the agent's parties as a checklist.
              *
              * Ticking none is a real choice, not an empty form — it means the
              * one all-parties rule, which is exactly what Simple writes. Said
              * out loud under the list, because an empty checklist otherwise
              * reads as "nothing will happen".
              */}
            {advanced && (
              <div className="rounded-lg border bg-white dark:bg-white/[0.02]">
                <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50/70 px-3 py-2 dark:bg-white/[0.03]">
                  <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium">
                    <input
                      type="checkbox"
                      className="size-4 accent-emerald-600"
                      disabled={!partyRows.length}
                      checked={allPartiesChecked}
                      onChange={() => setPartyIds(allPartiesChecked ? new Set() : new Set(partyRows.map((c) => c.id)))}
                    />
                    All parties
                  </label>
                  <span className="text-muted-foreground text-[11.5px] tabular-nums">
                    {partyIds.size} of {partyRows.length} ticked
                  </span>
                  <div className="relative ml-auto w-full sm:w-52">
                    <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
                    <Input
                      value={partySearch}
                      onChange={(e) => setPartySearch(e.target.value)}
                      placeholder="Find a party…"
                      className="h-8 pl-7 text-[12.5px]"
                    />
                  </div>
                </div>

                {!agentName ? (
                  <p className="text-muted-foreground px-3 py-4 text-[12.5px]">Pick an agent to list their parties.</p>
                ) : !partyRows.length ? (
                  <p className="text-muted-foreground px-3 py-4 text-[12.5px]">This agent has no parties on file.</p>
                ) : (
                  <div className="grid max-h-52 grid-cols-1 gap-x-4 overflow-y-auto p-2 sm:grid-cols-2 lg:grid-cols-3">
                    {shownParties.map((c) => (
                      <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12.5px] hover:bg-muted/60">
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-emerald-600"
                          checked={partyIds.has(c.id)}
                          onChange={() => {
                            const next = new Set(partyIds);
                            if (next.has(c.id)) next.delete(c.id);
                            else next.add(c.id);
                            setPartyIds(next);
                          }}
                        />
                        <span className="truncate">{c.name}</span>
                      </label>
                    ))}
                    {!shownParties.length && (
                      <p className="text-muted-foreground col-span-full px-1.5 py-2 text-[12.5px]">No party matches “{partySearch}”.</p>
                    )}
                  </div>
                )}

                <p className="text-muted-foreground border-t px-3 py-1.5 text-[11.5px]">
                  {partyIds.size === 0
                    ? 'Nothing ticked — one rule will be written for ALL of this agent’s parties.'
                    : `One rule per ticked party — ${partyIds.size} in total. Parties that already carry this exact rule are skipped.`}
                </p>
              </div>
            )}

            {/* The blocker reads as the next thing to do, in place, instead of
                waiting for a toast after a failed save. */}
            {blocker && <p className="text-[12.5px] font-medium text-amber-700 dark:text-amber-400">{blocker}</p>}

            <AddButton
              accent={accent}
              onClick={submit}
              disabled={create.isPending || createBulk.isPending || !!blocker}
              title="Save this special rate"
            >
              {create.isPending || createBulk.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {advanced && partyIds.size > 0
                ? `Add for ${partyIds.size} part${partyIds.size === 1 ? 'y' : 'ies'}`
                : 'Add special rate'}
            </AddButton>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full min-w-0 space-y-1 sm:w-64">
            <Label className="text-muted-foreground text-xs font-medium">Show rules for</Label>
            <NativeSelect value={filterAgent} onChange={setFilterAgent} options={['', ...agentList.map((a) => a.name)]} placeholder="All agents" />
          </div>
        </div>

        {isLoading ? (
          <div className="text-muted-foreground flex h-24 items-center justify-center">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            dense
            emptyText="No special rates yet — every line prices at the agent's base rate."
            actions={canEdit ? deleteAction(remove) : undefined}
          />
        )}
      </Panel>

      <RateTester agents={agentList} lookups={lookups} />
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
            {result.addToRate && (
              <span
                className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                title="Added onto the party's product rate — shows on their invoice"
              >
                <Receipt className="size-2.5" /> in rate
              </span>
            )}
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
