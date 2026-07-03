import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BadgePercent, Ban, ListFilter, Package, Palette, Plus, Search, Trash2, Users, UsersRound, Weight } from 'lucide-react';
import { toast } from 'sonner';
import type {
  AgentCustomer,
  CustomerBagWeightDto,
  CustomerLogoDto,
  CustomerRateDto,
  LogoScope,
  RateKind,
  RateScope,
  SpecialRateLookups,
} from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCustomers } from '@/features/customers/use-customers';
import {
  useAgentCustomers,
  useBulkSaveCustomerBagWeight,
  useBulkSaveCustomerLogo,
  useBulkSaveCustomerRate,
  useCustomerSpecialRates,
  useDeleteCustomerBagWeight,
  useDeleteCustomerLogo,
  useDeleteCustomerRate,
  useSaveCustomerBagWeight,
  useSaveCustomerLogo,
  useSaveCustomerRate,
  useSpecialRateAgents,
  useSpecialRateLookups,
} from './use-special-rates';
import { SpecialRatesMaster } from './special-rates-master';
import { InfoTip } from '@/components/common/info-tip';

const RATE_LEVELS: { value: RateScope; label: string; title: string }[] = [
  { value: 'CATEGORY', label: 'Whole category', title: 'Apply this rate to every item in the chosen category.' },
  { value: 'SUBCATEGORY', label: 'Sub-category', title: 'Apply this rate to every item in the chosen sub-category.' },
  { value: 'ITEM', label: 'Specific item', title: 'Apply this rate to one specific product/design only.' },
];
const LOGO_LEVELS: { value: LogoScope; label: string; title: string }[] = [
  { value: 'CATEGORY', label: 'Whole category', title: 'Block the logo for the whole category.' },
  { value: 'SUBCATEGORY', label: 'Sub-category', title: 'Block the logo for a specific sub-category.' },
];
const scopeLabel = (s: string) => RATE_LEVELS.find((l) => l.value === s)?.label ?? s;
const signed = (n: number) => (n > 0 ? `+${n.toLocaleString('en-IN')}` : n.toLocaleString('en-IN'));

interface Accent {
  ring: string;
  head: string;
  chip: string;
  solid: string;
  active: string;
  idle: string;
}
const ACCENTS: Record<'PRODUCT' | 'DESIGN' | 'LOGO' | 'BAG', Accent> = {
  PRODUCT: {
    ring: 'border-sky-200',
    head: 'from-sky-50 to-sky-100/40',
    chip: 'bg-sky-100 text-sky-700',
    solid: 'bg-sky-600 hover:bg-sky-700',
    active: 'border-sky-600 bg-sky-600 text-white',
    idle: 'border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700',
  },
  DESIGN: {
    ring: 'border-violet-200',
    head: 'from-violet-50 to-violet-100/40',
    chip: 'bg-violet-100 text-violet-700',
    solid: 'bg-violet-600 hover:bg-violet-700',
    active: 'border-violet-600 bg-violet-600 text-white',
    idle: 'border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700',
  },
  LOGO: {
    ring: 'border-rose-200',
    head: 'from-rose-50 to-rose-100/40',
    chip: 'bg-rose-100 text-rose-700',
    solid: 'bg-rose-600 hover:bg-rose-700',
    active: 'border-rose-600 bg-rose-600 text-white',
    idle: 'border-slate-200 bg-white text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700',
  },
  BAG: {
    ring: 'border-amber-200',
    head: 'from-amber-50 to-amber-100/40',
    chip: 'bg-amber-100 text-amber-700',
    solid: 'bg-amber-600 hover:bg-amber-700',
    active: 'border-amber-600 bg-amber-600 text-white',
    idle: 'border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700',
  },
};

type Mode = 'single' | 'bulk' | 'all';

export function SpecialRatesPage() {
  const { can } = usePermissions();
  const canCreate = can('specialrate:create');
  const canDelete = can('specialrate:delete');

  const [mode, setMode] = useState<Mode>('single');
  const { data: lookups } = useSpecialRateLookups();

  /* single-customer mode */
  const { data: customerData } = useCustomers({ page: 1, pageSize: 1000 });
  const { options, byLabel } = useMemo(() => {
    const map = new Map<string, number>();
    const opts: string[] = [];
    for (const c of customerData?.items ?? []) {
      const label = `${c.partyName ?? `#${c.id}`}${c.city ? ` · ${c.city}` : ''} · ${c.code ?? `#${c.id}`}`;
      map.set(label, c.id);
      opts.push(label);
    }
    return { options: opts, byLabel: map };
  }, [customerData]);
  const [customerLabel, setCustomerLabel] = useState('');
  const customerId = byLabel.get(customerLabel);
  const { data: special } = useCustomerSpecialRates(mode === 'single' ? customerId : undefined);
  const rates = special?.rates ?? [];
  const logos = special?.logos ?? [];
  const bagWeights = special?.bagWeights ?? [];

  /* agent (bulk) mode */
  const { data: agents } = useSpecialRateAgents();
  const [agentName, setAgentName] = useState('');
  const { data: agentCustomers } = useAgentCustomers(mode === 'bulk' ? agentName || undefined : undefined);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => {
    setSelected(new Set((agentCustomers ?? []).map((c) => c.id)));
  }, [agentCustomers]);
  const selectedIds = useMemo(() => [...selected], [selected]);

  const target = mode === 'single' ? (customerId != null ? { customerId } : null) : selectedIds.length ? { customerIds: selectedIds } : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <BadgePercent className="size-5" />
        </div>
        <div className="mr-auto">
          <h2 className="text-2xl font-semibold tracking-tight">Special Rates</h2>
          <p className="text-muted-foreground text-sm">Per-customer rate overrides &amp; logo restrictions</p>
        </div>
        {/* Mode switch */}
        <div className="bg-muted/60 flex rounded-lg p-1">
          {([
            { v: 'single', label: 'Per customer', icon: <Users className="size-4" /> },
            { v: 'bulk', label: 'By agent', icon: <UsersRound className="size-4" /> },
            { v: 'all', label: 'Master list', icon: <ListFilter className="size-4" /> },
          ] as const).map((m) => (
            <button
              key={m.v}
              type="button"
              onClick={() => setMode(m.v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                mode === m.v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'all' ? (
        <SpecialRatesMaster />
      ) : (
        <>
      {mode === 'single' ? (
        <div className="bg-card rounded-xl border border-l-4 border-l-primary p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label className="flex items-center gap-1.5 text-base">
                <Users className="text-primary size-4" /> Customer
              </Label>
              <NativeSelect value={customerLabel} onChange={setCustomerLabel} options={options} placeholder="Search and select a customer…" />
            </div>
            {customerId != null && (
              <div className="text-muted-foreground flex shrink-0 gap-3 text-sm">
                <span className="rounded-lg bg-sky-50 px-3 py-1.5 font-medium text-sky-700 ring-1 ring-inset ring-sky-200">{rates.length} rate override(s)</span>
                <span className="rounded-lg bg-rose-50 px-3 py-1.5 font-medium text-rose-700 ring-1 ring-inset ring-rose-200">{logos.length} logo block(s)</span>
              </div>
            )}
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            Rates are <span className="font-medium">deltas</span> added on top of the base rate (negative = discount). The most-specific level wins.
          </p>
        </div>
      ) : (
        <AgentSelector
          agents={agents ?? []}
          agentName={agentName}
          onAgent={setAgentName}
          customers={agentCustomers ?? []}
          selected={selected}
          setSelected={setSelected}
        />
      )}

      {target == null ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-12 text-center text-sm">
          <BadgePercent className="text-muted-foreground/40 mx-auto mb-3 size-10" />
          {mode === 'single' ? 'Select a customer above to manage their special rates.' : 'Pick an agent and select customers to apply rates to.'}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2 lg:items-stretch">
          <RatePanel
            title="Customize Product Rates"
            kind="PRODUCT"
            accent={ACCENTS.PRODUCT}
            icon={<Package className="size-4" />}
            target={target}
            lookups={lookups}
            rates={rates.filter((r) => r.kind === 'PRODUCT')}
            canCreate={canCreate}
            canDelete={canDelete}
          />
          <RatePanel
            title="Customize Design Rates"
            kind="DESIGN"
            accent={ACCENTS.DESIGN}
            icon={<Palette className="size-4" />}
            target={target}
            lookups={lookups}
            rates={rates.filter((r) => r.kind === 'DESIGN')}
            canCreate={canCreate}
            canDelete={canDelete}
          />
          <LogoPanel target={target} lookups={lookups} logos={logos} canCreate={canCreate} canDelete={canDelete} />
          <BagWeightPanel target={target} lookups={lookups} bagWeights={bagWeights} canCreate={canCreate} canDelete={canDelete} />
        </div>
      )}
        </>
      )}
    </div>
  );
}

/** Where a save is applied: a single customer, or many (agent bulk). */
type Target = { customerId: number } | { customerIds: number[] };
const isBulk = (t: Target): t is { customerIds: number[] } => 'customerIds' in t;
const targetCount = (t: Target) => (isBulk(t) ? t.customerIds.length : 1);

/* ── Agent selector (bulk mode) ──────────────────────────────────────────────── */

function AgentSelector({
  agents,
  agentName,
  onAgent,
  customers,
  selected,
  setSelected,
}: {
  agents: string[];
  agentName: string;
  onAgent: (v: string) => void;
  customers: AgentCustomer[];
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = customers.filter(
    (c) => !search.trim() || c.partyName.toLowerCase().includes(search.toLowerCase()) || c.city.toLowerCase().includes(search.toLowerCase()),
  );
  const allChecked = customers.length > 0 && selected.size === customers.length;
  const toggle = (id: number) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  return (
    <div className="bg-card rounded-xl border border-l-4 border-l-primary p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label className="flex items-center gap-1.5 text-base">
            <UsersRound className="text-primary size-4" /> Agent
          </Label>
          <NativeSelect value={agentName} onChange={onAgent} options={agents} placeholder="Select an agent…" />
        </div>
        {agentName && (
          <span className="rounded-lg bg-primary/10 text-primary shrink-0 px-3 py-1.5 text-sm font-semibold ring-1 ring-inset ring-primary/20">
            {selected.size} of {customers.length} selected
          </span>
        )}
      </div>

      {agentName && customers.length > 0 && (
        <div className="mt-3 rounded-lg border">
          <div className="flex items-center gap-2 border-b bg-slate-50/70 px-3 py-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4 accent-sky-600"
                checked={allChecked}
                onChange={() => setSelected(allChecked ? new Set() : new Set(customers.map((c) => c.id)))}
              />
              Select all
            </label>
            <div className="relative ml-auto w-56">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input className="h-8 pl-8 text-sm" placeholder="Search customers…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="grid max-h-56 grid-cols-1 gap-x-4 overflow-y-auto p-2 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => (
              <label key={c.id} className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                <input type="checkbox" className="size-4 accent-sky-600" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="truncate">
                  <span className="font-medium">{c.partyName}</span>
                  {c.city && <span className="text-muted-foreground"> · {c.city}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      <p className="text-muted-foreground mt-2 text-xs">
        Saving applies the same override to every selected customer. Existing per-customer overrides are shown in
        “Per customer” mode.
      </p>
    </div>
  );
}

/* ── Shared panel shell ─────────────────────────────────────────────────────── */

function Panel({ title, icon, accent, badge, info, className, children }: { title: string; icon: ReactNode; accent: Accent; badge: ReactNode; info?: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn('overflow-hidden rounded-xl border bg-card shadow-sm', accent.ring, className)}>
      <div className={cn('flex items-center gap-2 border-b bg-gradient-to-r px-4 py-3', accent.ring, accent.head)}>
        <span className={cn('flex size-8 items-center justify-center rounded-lg', accent.chip)}>{icon}</span>
        <h3 className="font-semibold text-slate-800">{title}</h3>
        {info && <InfoTip text={info} />}
        <span className={cn('ml-auto rounded-full px-2 py-0.5 text-xs font-semibold', accent.chip)}>{badge}</span>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function LevelButtons<T extends string>({ levels, value, onChange, accent }: { levels: { value: T; label: string; title?: string }[]; value: T; onChange: (v: T) => void; accent: Accent }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {levels.map((l) => (
        <button
          key={l.value}
          type="button"
          title={l.title}
          onClick={() => onChange(l.value)}
          className={cn('rounded-md border px-3.5 py-2 text-base font-medium transition-colors', value === l.value ? accent.active : accent.idle)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

function AddButton({ accent, onClick, disabled, title, children }: { accent: Accent; onClick: () => void; disabled?: boolean; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn('inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2.5 text-base font-semibold text-white shadow-sm transition-colors disabled:opacity-60', accent.solid)}
    >
      {children}
    </button>
  );
}

const deleteAction = <T extends { id: number }>(onDelete: (r: T) => void) => (r: T) => (
  <div className="flex justify-end">
    <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => onDelete(r)} aria-label="Remove" title="Remove">
      <Trash2 className="size-4" />
    </Button>
  </div>
);

/* ── Product / Design rate overrides ─────────────────────────────────────────── */

function RatePanel({
  title,
  kind,
  accent,
  icon,
  target,
  lookups,
  rates,
  canCreate,
  canDelete,
}: {
  title: string;
  kind: RateKind;
  accent: Accent;
  icon: ReactNode;
  target: Target;
  lookups: SpecialRateLookups | undefined;
  rates: CustomerRateDto[];
  canCreate: boolean;
  canDelete: boolean;
}) {
  const save = useSaveCustomerRate();
  const bulkSave = useBulkSaveCustomerRate();
  const del = useDeleteCustomerRate();
  const confirm = useConfirm();
  const bulk = isBulk(target);

  const [scope, setScope] = useState<RateScope>('CATEGORY');
  const [category, setCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [item, setItem] = useState('');
  const [rate, setRate] = useState('');

  const categories = lookups?.categories ?? [];
  const subOptions = useMemo(() => [...new Set((lookups?.subCategories ?? []).filter((s) => s.category === category).map((s) => s.subCategory))], [lookups, category]);
  const itemOptions = useMemo(() => {
    const src = kind === 'PRODUCT' ? lookups?.products ?? [] : lookups?.designs ?? [];
    return [...new Set(src.filter((i) => i.category === category && i.subCategory === subCategory).map((i) => ('product' in i ? i.product : i.designType)))];
  }, [lookups, kind, category, subCategory]);

  const needSub = scope !== 'CATEGORY';
  const needItem = scope === 'ITEM';
  const itemLabel = kind === 'PRODUCT' ? 'Product' : 'Design';

  const reset = () => {
    setCategory('');
    setSubCategory('');
    setItem('');
    setRate('');
  };

  const submit = () => {
    if (!category) return toast.error('Select a category');
    if (needSub && !subCategory) return toast.error('Select a sub-category');
    if (needItem && !item) return toast.error(`Select a ${itemLabel.toLowerCase()}`);
    if (rate.trim() === '' || Number.isNaN(Number(rate))) return toast.error('Enter a numeric rate delta');
    const common = {
      kind,
      scope,
      category,
      subCategory: needSub ? subCategory : undefined,
      target: needItem ? item : undefined,
      rate: Number(rate),
    };
    const onSuccess = (msg: string) => {
      toast.success(msg);
      reset();
    };
    const onError = (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed'));
    if (bulk) {
      bulkSave.mutate({ customerIds: target.customerIds, ...common }, { onSuccess: (r) => onSuccess(`Applied to ${r.applied} customer(s)`), onError });
    } else {
      save.mutate({ customerId: target.customerId, ...common }, { onSuccess: () => onSuccess('Override saved'), onError });
    }
  };

  const onDelete = async (r: CustomerRateDto) => {
    const ok = await confirm({
      title: 'Remove override?',
      description: `${scopeLabel(r.scope)} · ${r.category}${r.subCategory ? ` / ${r.subCategory}` : ''}${r.target ? ` / ${r.target}` : ''} (${signed(r.rate)}) will be removed.`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(r.id, { onSuccess: () => toast.success('Override removed'), onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')) });
  };

  const columns: DataColumn<CustomerRateDto>[] = [
    { id: 'level', label: 'Level', cell: (r) => <span className="font-medium">{scopeLabel(r.scope)}</span> },
    { id: 'category', label: 'Category', cell: (r) => r.category },
    { id: 'sub', label: 'Sub-cat', cell: (r) => r.subCategory || '—' },
    { id: 'item', label: itemLabel, cell: (r) => r.target || '—' },
    {
      id: 'rate',
      label: 'Δ',
      align: 'right',
      cell: (r) => <span className={cn('font-semibold tabular-nums', r.rate > 0 ? 'text-emerald-600' : r.rate < 0 ? 'text-rose-600' : '')}>{signed(r.rate)}</span>,
    },
  ];

  return (
    <Panel
      title={title}
      icon={icon}
      accent={accent}
      info={`A rupee delta added to this customer's ${itemLabel.toLowerCase()} rate. Pick a level, then a category/sub-category/item and the delta (negative = discount). The most-specific level wins (item → sub-category → category).`}
      badge={bulk ? `${targetCount(target)} customers` : `${rates.length} set`}
    >
      {canCreate && (
        <div className="space-y-3 rounded-lg border bg-slate-50/70 p-3">
          <LevelButtons
            levels={RATE_LEVELS}
            value={scope}
            accent={accent}
            onChange={(v) => {
              setScope(v);
              if (v === 'CATEGORY') {
                setSubCategory('');
                setItem('');
              } else if (v === 'SUBCATEGORY') {
                setItem('');
              }
            }}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <NativeSelect value={category} onChange={(v) => { setCategory(v); setSubCategory(''); setItem(''); }} options={categories} placeholder="Category…" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sub-category</Label>
              <NativeSelect value={subCategory} onChange={(v) => { setSubCategory(v); setItem(''); }} options={subOptions} placeholder={needSub ? 'Sub-category…' : '—'} disabled={!needSub || !category} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{itemLabel}</Label>
              <NativeSelect value={item} onChange={setItem} options={itemOptions} placeholder={needItem ? `${itemLabel}…` : '—'} disabled={!needItem || !subCategory} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rate delta</Label>
              <Input type="number" step="any" className="text-right tabular-nums" placeholder="e.g. 5 or -5" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
          </div>
          <AddButton
            accent={accent}
            onClick={submit}
            disabled={save.isPending || bulkSave.isPending}
            title={bulk ? 'Apply this override to every selected customer' : 'Save this override for the customer (adds a new one, or updates the matching level)'}
          >
            <Plus className="size-4" /> {bulk ? `Apply to ${targetCount(target)} customer(s)` : 'Add / update'}
          </AddButton>
        </div>
      )}

      {bulk ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-xs">
          Bulk mode — existing overrides are listed in “Per customer” mode.
        </p>
      ) : (
        <DataTable columns={columns} rows={rates} rowKey={(r) => r.id} dense emptyText="No overrides yet." actions={canDelete ? deleteAction(onDelete) : undefined} />
      )}
    </Panel>
  );
}

/* ── Logo restrictions ───────────────────────────────────────────────────────── */

function LogoPanel({
  target,
  lookups,
  logos,
  canCreate,
  canDelete,
  className,
}: {
  target: Target;
  lookups: SpecialRateLookups | undefined;
  logos: CustomerLogoDto[];
  canCreate: boolean;
  canDelete: boolean;
  className?: string;
}) {
  const accent = ACCENTS.LOGO;
  const save = useSaveCustomerLogo();
  const bulkSave = useBulkSaveCustomerLogo();
  const del = useDeleteCustomerLogo();
  const confirm = useConfirm();
  const bulk = isBulk(target);

  const [scope, setScope] = useState<LogoScope>('CATEGORY');
  const [category, setCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');

  const categories = lookups?.categories ?? [];
  const subOptions = useMemo(() => [...new Set((lookups?.subCategories ?? []).filter((s) => s.category === category).map((s) => s.subCategory))], [lookups, category]);
  const needSub = scope === 'SUBCATEGORY';

  const submit = () => {
    if (!category) return toast.error('Select a category');
    if (needSub && !subCategory) return toast.error('Select a sub-category');
    const common = { scope, category, subCategory: needSub ? subCategory : undefined };
    const onSuccess = (msg: string) => {
      toast.success(msg);
      setCategory('');
      setSubCategory('');
    };
    const onError = (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed'));
    if (bulk) {
      bulkSave.mutate({ customerIds: target.customerIds, ...common }, { onSuccess: (r) => onSuccess(`Applied to ${r.applied} customer(s)`), onError });
    } else {
      save.mutate({ customerId: target.customerId, ...common }, { onSuccess: () => onSuccess('Logo restriction saved'), onError });
    }
  };

  const onDelete = async (r: CustomerLogoDto) => {
    const ok = await confirm({
      title: 'Remove restriction?',
      description: `Logo will be allowed again for ${r.category}${r.subCategory ? ` / ${r.subCategory}` : ''}.`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(r.id, { onSuccess: () => toast.success('Restriction removed'), onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')) });
  };

  const columns: DataColumn<CustomerLogoDto>[] = [
    { id: 'level', label: 'Level', cell: (r) => <span className="font-medium">{scopeLabel(r.scope)}</span> },
    { id: 'category', label: 'Category', cell: (r) => r.category },
    { id: 'sub', label: 'Sub-category', cell: (r) => r.subCategory || '—' },
    {
      id: 'status',
      label: 'Logo',
      cell: () => (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
          <Ban className="size-3" /> Not allowed
        </span>
      ),
    },
  ];

  return (
    <Panel
      title="Logo restrictions"
      icon={<Ban className="size-4" />}
      accent={accent}
      info="Block the logo for this customer at a whole category or a sub-category. Logo items are then hidden when taking this customer's order."
      badge={bulk ? `${targetCount(target)} customers` : `${logos.length} set`}
      className={className}
    >
      {canCreate && (
        <div className="space-y-3 rounded-lg border bg-slate-50/70 p-3">
          <LevelButtons levels={LOGO_LEVELS} value={scope} accent={accent} onChange={(v) => { setScope(v); if (v === 'CATEGORY') setSubCategory(''); }} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <NativeSelect value={category} onChange={(v) => { setCategory(v); setSubCategory(''); }} options={categories} placeholder="Category…" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sub-category</Label>
              <NativeSelect value={subCategory} onChange={setSubCategory} options={subOptions} placeholder={needSub ? 'Sub-category…' : '—'} disabled={!needSub || !category} />
            </div>
            <div className="flex items-end">
              <AddButton
                accent={accent}
                onClick={submit}
                disabled={save.isPending || bulkSave.isPending}
                title={bulk ? 'Block the logo for every selected customer' : "Block the logo for this category/sub-category — logo items won't appear in this customer's order"}
              >
                <Ban className="size-4" /> {bulk ? `Block for ${targetCount(target)}` : 'Block logo'}
              </AddButton>
            </div>
          </div>
        </div>
      )}

      {bulk ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-xs">
          Bulk mode — existing restrictions are listed in “Per customer” mode.
        </p>
      ) : (
        <DataTable columns={columns} rows={logos} rowKey={(r) => r.id} dense emptyText="No logo restrictions — the logo is allowed everywhere." actions={canDelete ? deleteAction(onDelete) : undefined} />
      )}
    </Panel>
  );
}

/* ── Bag weights (Kgs per bag, per category) ─────────────────────────────────── */

function BagWeightPanel({
  target,
  lookups,
  bagWeights,
  canCreate,
  canDelete,
  className,
}: {
  target: Target;
  lookups: SpecialRateLookups | undefined;
  bagWeights: CustomerBagWeightDto[];
  canCreate: boolean;
  canDelete: boolean;
  className?: string;
}) {
  const accent = ACCENTS.BAG;
  const save = useSaveCustomerBagWeight();
  const bulkSave = useBulkSaveCustomerBagWeight();
  const del = useDeleteCustomerBagWeight();
  const confirm = useConfirm();
  const bulk = isBulk(target);

  const [category, setCategory] = useState('');
  const [kgsPerBag, setKgsPerBag] = useState('');
  const categories = lookups?.categories ?? [];

  const submit = () => {
    if (!category) return toast.error('Select a category');
    const kg = Number(kgsPerBag);
    if (kgsPerBag.trim() === '' || Number.isNaN(kg) || kg <= 0) return toast.error('Enter the kgs one bag weighs (a positive number)');
    const common = { category, kgsPerBag: kg };
    const onSuccess = (msg: string) => {
      toast.success(msg);
      setCategory('');
      setKgsPerBag('');
    };
    const onError = (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed'));
    if (bulk) {
      bulkSave.mutate({ customerIds: target.customerIds, ...common }, { onSuccess: (r) => onSuccess(`Applied to ${r.applied} customer(s)`), onError });
    } else {
      save.mutate({ customerId: target.customerId, ...common }, { onSuccess: () => onSuccess('Bag weight saved'), onError });
    }
  };

  const onDelete = async (r: CustomerBagWeightDto) => {
    const ok = await confirm({
      title: 'Remove bag weight?',
      description: `${r.category}: 1 bag = ${r.kgsPerBag} kg will be removed — Kgs will no longer auto-fill from Bags for this category.`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(r.id, { onSuccess: () => toast.success('Bag weight removed'), onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')) });
  };

  const columns: DataColumn<CustomerBagWeightDto>[] = [
    { id: 'category', label: 'Category', cell: (r) => <span className="font-medium">{r.category}</span> },
    {
      id: 'kgs',
      label: '1 Bag =',
      align: 'right',
      cell: (r) => <span className="font-semibold tabular-nums text-amber-700">{r.kgsPerBag.toLocaleString('en-IN')} kg</span>,
    },
  ];

  return (
    <Panel
      title="Bag weight (Kgs per bag)"
      icon={<Weight className="size-4" />}
      accent={accent}
      info="For this customer, how many kgs one bag weighs in a category. On the New Order form, typing Bags then auto-fills Kgs = Bags × this weight (the user can still overtype it)."
      badge={bulk ? `${targetCount(target)} customers` : `${bagWeights.length} set`}
      className={className}
    >
      {canCreate && (
        <div className="space-y-3 rounded-lg border bg-slate-50/70 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <NativeSelect value={category} onChange={setCategory} options={categories} placeholder="Category…" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Kgs per 1 bag</Label>
              <Input type="number" step="any" min="0" className="text-right tabular-nums" placeholder="e.g. 70" value={kgsPerBag} onChange={(e) => setKgsPerBag(e.target.value)} />
            </div>
            <div className="flex items-end">
              <AddButton
                accent={accent}
                onClick={submit}
                disabled={save.isPending || bulkSave.isPending}
                title={bulk ? 'Apply this bag weight to every selected customer' : 'Save the bag weight for this customer + category (updates if one exists)'}
              >
                <Plus className="size-4" /> {bulk ? `Apply to ${targetCount(target)}` : 'Add / update'}
              </AddButton>
            </div>
          </div>
        </div>
      )}

      {bulk ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-xs">
          Bulk mode — existing bag weights are listed in “Per customer” mode.
        </p>
      ) : (
        <DataTable columns={columns} rows={bagWeights} rowKey={(r) => r.id} dense emptyText="No bag weights — Kgs is typed manually for this customer." actions={canDelete ? deleteAction(onDelete) : undefined} />
      )}
    </Panel>
  );
}

export default SpecialRatesPage;
