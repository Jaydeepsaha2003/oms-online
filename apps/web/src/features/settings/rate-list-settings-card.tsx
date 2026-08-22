import { useEffect, useMemo, useState } from 'react';
import { Check, Layers, Loader2, Plus, RotateCcw, Trash2, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  AVAILABLE_DISPLAYS,
  type AvailableDisplay,
  type RateListCategoryConfig,
  type RateListCombination,
  type RateListConfigInput,
} from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/common/confirm';
import { NativeSelect } from '@/components/common/combo';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCustomers } from '@/features/customers/use-customers';
import {
  useCheckCombination,
  useClearPartyRateListConfig,
  useRateListConfigBundle,
  useSavePartyRateListConfig,
  useSaveRateListDefault,
} from '@/features/customers/use-rate-list-config';

/** A blank category entry: included, everything in it, inheriting the display. */
const blankCategory = (category: string): RateListCategoryConfig => ({
  category,
  included: true,
  subCategories: [],
  availableDisplay: null,
  combinations: [],
});

/**
 * Settings → Rate List (spec §5, §9, §10, §27).
 *
 * Two levels: the DEFAULT configuration every party uses, and per-party
 * overrides for the parties that always want something different. A party
 * inherits every field it does not override, so changing the default still
 * reaches it — which is why this screen shows, on each field, whether the value
 * came from the party or from the default.
 *
 * Nothing here changes how a rate is calculated. It decides what appears on the
 * sheet, in which unit, grouped how.
 */
export function RateListSettingsCard({ canEdit }: { canEdit: boolean }) {
  const { data: bundle, isLoading } = useRateListConfigBundle();
  const [level, setLevel] = useState<'DEFAULT' | 'PARTY'>('DEFAULT');
  const [partyId, setPartyId] = useState<number | null>(null);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-[15px]">
          <Layers className="size-4 text-indigo-600" /> Rate List
          <span className="text-muted-foreground text-[11.5px] font-medium">
            what a rate list contains, and how it is laid out
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Which level is being edited. Kept as a switch rather than two cards:
            the party view has to be read against the default it inherits from,
            and side-by-side tabs make that relationship obvious. */}
        <div className="flex h-9 w-full items-center gap-1 rounded-[4px] border border-indigo-200 bg-indigo-50/40 p-0.5 sm:w-auto sm:self-start dark:border-indigo-400/30 dark:bg-indigo-500/10">
          {(
            [
              ['DEFAULT', 'Default — everyone'],
              ['PARTY', 'Party overrides'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setLevel(value)}
              className={cn(
                'flex-1 rounded-[3px] px-3 py-1 text-[12px] font-semibold transition-colors sm:flex-none',
                level === value
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-indigo-900/70 hover:bg-indigo-100 dark:text-indigo-200/80 dark:hover:bg-indigo-500/20',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {isLoading || !bundle ? (
          <div className="text-muted-foreground flex h-32 items-center justify-center">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : level === 'DEFAULT' ? (
          <ConfigEditor key="default" bundle={bundle} canEdit={canEdit} />
        ) : (
          <PartyOverrides bundle={bundle} canEdit={canEdit} partyId={partyId} onParty={setPartyId} />
        )}
      </CardContent>
    </Card>
  );
}

/* ── party level ─────────────────────────────────────────────────────────────── */

function PartyOverrides({
  bundle,
  canEdit,
  partyId,
  onParty,
}: {
  bundle: NonNullable<ReturnType<typeof useRateListConfigBundle>['data']>;
  canEdit: boolean;
  partyId: number | null;
  onParty: (id: number | null) => void;
}) {
  const confirm = useConfirm();
  const { data: customers } = useCustomers({ page: 1, pageSize: 1000 });
  const clear = useClearPartyRateListConfig();
  const list = customers?.items ?? [];
  const byId = useMemo(() => new Map(list.map((c) => [c.id, c.partyName || `Customer ${c.id}`])), [list]);
  const configured = bundle.parties;
  const party = configured.find((p) => p.customerId === partyId) ?? null;

  const drop = async (id: number) => {
    const ok = await confirm({
      title: `Clear ${byId.get(id) ?? 'this party'}’s configuration?`,
      description: 'Their rate list will follow the default again. Nothing else changes.',
      confirmText: 'Clear it',
      destructive: true,
    });
    if (!ok) return;
    clear.mutate(id, {
      onSuccess: () => toast.success('Configuration cleared — this party now follows the default'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Could not clear it')),
    });
  };

  return (
    <div className="space-y-3">
      {/* The empty state is the CORRECT state — most parties should inherit. */}
      <div className="bg-muted/40 rounded-lg px-3 py-2 text-[12px]">
        {configured.length === 0 ? (
          <>
            No party has its own configuration — every rate list follows the default. That is the normal state; add an
            override only for a party that always wants something different.
          </>
        ) : (
          <>
            <b>
              {configured.length} part{configured.length === 1 ? 'y has' : 'ies have'} their own configuration
            </b>{' '}
            — everyone else follows the default. A party inherits every field it does not override.
          </>
        )}
      </div>

      {!!configured.length && (
        <div className="divide-y rounded-lg border">
          {configured.map((p) => (
            <div key={p.customerId} className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => onParty(p.customerId)}
                className={cn('min-w-0 flex-1 text-left text-[13px] font-semibold', partyId === p.customerId && 'text-primary')}
              >
                {byId.get(p.customerId) ?? `Customer ${p.customerId}`}
                <span className="text-muted-foreground ml-2 text-[11px] font-medium">
                  {[
                    p.availableDisplay ? `${p.availableDisplay === 'PCS' ? 'Pieces' : 'Size'} display` : null,
                    p.categories?.length ? `${p.categories.length} categories` : null,
                    p.includeDesigns === false ? 'no designs' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'no overrides set'}
                </span>
              </button>
              {canEdit && (
                <Button variant="ghost" size="icon" className="size-7" onClick={() => drop(p.customerId)} disabled={clear.isPending}>
                  <Trash2 className="size-3.5 text-rose-600" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
          {party ? 'Editing' : 'Add or edit a party'}
        </Label>
        <NativeSelect
          value={partyId == null ? '' : String(partyId)}
          onChange={(v) => onParty(v ? Number(v) : null)}
          options={list.map((c) => ({ value: String(c.id), label: c.partyName || `Customer ${c.id}` }))}
          placeholder="Pick a party…"
        />
      </div>

      {partyId != null && (
        <ConfigEditor
          key={`party-${partyId}`}
          bundle={bundle}
          canEdit={canEdit}
          party={{ customerId: partyId, name: byId.get(partyId) ?? '', saved: party }}
        />
      )}
    </div>
  );
}

/* ── the editor, shared by both levels ───────────────────────────────────────── */

function ConfigEditor({
  bundle,
  canEdit,
  party,
}: {
  bundle: NonNullable<ReturnType<typeof useRateListConfigBundle>['data']>;
  canEdit: boolean;
  party?: { customerId: number; name: string; saved: { availableDisplay?: AvailableDisplay | null; categories?: RateListCategoryConfig[] | null; includeDesigns?: boolean | null } | null };
}) {
  const saveDefault = useSaveRateListDefault();
  const saveParty = useSavePartyRateListConfig();
  const busy = saveDefault.isPending || saveParty.isPending;
  const def = bundle.default;

  // Null at the party level means "inherit" — a distinct state from any value,
  // which is why these are nullable rather than pre-filled from the default.
  const [display, setDisplay] = useState<AvailableDisplay | null>(party ? (party.saved?.availableDisplay ?? null) : def.availableDisplay);
  const [designs, setDesigns] = useState<boolean | null>(party ? (party.saved?.includeDesigns ?? null) : def.includeDesigns);
  const [cats, setCats] = useState<RateListCategoryConfig[]>(party ? (party.saved?.categories ?? []) : def.categories);

  useEffect(() => {
    setDisplay(party ? (party.saved?.availableDisplay ?? null) : def.availableDisplay);
    setDesigns(party ? (party.saved?.includeDesigns ?? null) : def.includeDesigns);
    setCats(party ? (party.saved?.categories ?? []) : def.categories);
  }, [party?.customerId, party?.saved, def]);

  const subsFor = (category: string) =>
    [
      ...new Set(
        [...bundle.lookups.subCategories, ...bundle.lookups.designSubCategories]
          .filter((s) => s.category === category)
          .map((s) => s.subCategory)
          .filter(Boolean),
      ),
    ].sort();

  const upsert = (category: string, patch: Partial<RateListCategoryConfig>) =>
    setCats((prev) => {
      const i = prev.findIndex((c) => c.category === category);
      if (i === -1) return [...prev, { ...blankCategory(category), ...patch }];
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });

  const entry = (category: string) => cats.find((c) => c.category === category);

  const save = () => {
    if (party) {
      const input = {
        customerId: party.customerId,
        availableDisplay: display,
        includeDesigns: designs,
        categories: cats.length ? cats : null,
      };
      saveParty.mutate(input, {
        onSuccess: () => toast.success(`${party.name}’s rate list configuration saved`),
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not save')),
      });
      return;
    }
    const input: RateListConfigInput = {
      availableDisplay: display ?? 'PCS',
      includeDesigns: designs !== false,
      categories: cats,
    };
    saveDefault.mutate(input, {
      onSuccess: () => toast.success('Default rate list configuration saved'),
      // §8's refusal arrives here — surfaced verbatim, because the message names
      // the items and rates that clash and is the whole point of the check.
      onError: (e) => toast.error(getApiErrorMessage(e, 'Could not save'), { duration: 8000 }),
    });
  };

  return (
    <div className="space-y-3">
      {/* ── the two whole-sheet choices ────────────────────────────────────── */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
            Available column shows
          </Label>
          <NativeSelect
            value={display ?? ''}
            onChange={(v) => setDisplay((v || null) as AvailableDisplay | null)}
            options={[
              ...(party ? [{ value: '', label: `Default (${def.availableDisplay === 'PCS' ? 'Pieces' : 'Size'})` }] : []),
              ...AVAILABLE_DISPLAYS.map((d) => ({ value: d, label: d === 'PCS' ? 'Pieces' : 'Size' })),
            ]}
          />
          <p className="text-muted-foreground text-[11px]">
            A category can still choose its own below (§6).
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">Design rate list</Label>
          <NativeSelect
            value={designs == null ? '' : designs ? 'YES' : 'NO'}
            onChange={(v) => setDesigns(v === '' ? null : v === 'YES')}
            options={[
              ...(party ? [{ value: '', label: `Default (${def.includeDesigns ? 'included' : 'excluded'})` }] : []),
              { value: 'YES', label: 'Include designs' },
              { value: 'NO', label: 'Products only' },
            ]}
          />
        </div>
      </div>

      {/* ── categories ────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <Label className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">Categories</Label>
          <span className="text-muted-foreground text-[11px]">
            {cats.length === 0
              ? party
                ? 'no changes for this party — same as Default'
                : 'nothing configured — every category is included with all its sub-categories'
              : `${cats.length} configured; anything not listed is included in full`}
          </span>
        </div>

        <div className="space-y-2">
          {bundle.lookups.categories.map((category) => (
            <CategoryRow
              key={category}
              category={category}
              subs={subsFor(category)}
              value={entry(category)}
              canEdit={canEdit}
              inheritLabel={party ? 'same as Default' : undefined}
              onChange={(patch) => upsert(category, patch)}
              onReset={() => setCats((prev) => prev.filter((c) => c.category !== category))}
            />
          ))}
        </div>
      </div>

      {canEdit && (
        <div className="flex items-center gap-2 border-t pt-3">
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} Save {party ? `for ${party.name}` : 'default'}
          </Button>
          {party && (
            <span className="text-muted-foreground text-[11.5px]">
              Anything left on “Default” follows the shared setting, including later changes to it.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ── one category ────────────────────────────────────────────────────────────── */

function CategoryRow({
  category,
  subs,
  value,
  canEdit,
  inheritLabel,
  onChange,
  onReset,
}: {
  category: string;
  subs: string[];
  value: RateListCategoryConfig | undefined;
  canEdit: boolean;
  inheritLabel?: string;
  onChange: (patch: Partial<RateListCategoryConfig>) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const included = value?.included !== false;
  const picked = value?.subCategories ?? [];
  const combos = value?.combinations ?? [];

  const toggleSub = (s: string) => {
    const next = picked.includes(s) ? picked.filter((x) => x !== s) : [...picked, s];
    onChange({ subCategories: next });
  };

  return (
    <div className={cn('rounded-lg border', !included && 'bg-muted/30 opacity-70')}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="min-w-0 flex-1 text-left text-[13px] font-bold"
        >
          {category}
          <span className="text-muted-foreground ml-2 text-[11px] font-medium">
            {!value
              ? (inheritLabel ?? 'all sub-categories')
              : [
                  included ? null : 'excluded',
                  picked.length ? `${picked.length} of ${subs.length} sub-categories` : 'all sub-categories',
                  value.availableDisplay ? (value.availableDisplay === 'PCS' ? 'Pieces' : 'Size') : null,
                  combos.length ? `${combos.length} combination${combos.length === 1 ? '' : 's'}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </span>
        </button>
        {canEdit && (
          <>
            <Button
              variant={included ? 'outline' : 'default'}
              size="sm"
              className="h-7 px-2 text-[11.5px]"
              onClick={() => onChange({ included: !included })}
            >
              {included ? <X className="size-3.5" /> : <Check className="size-3.5" />}
              {included ? 'Exclude' : 'Include'}
            </Button>
            {value && (
              <Button variant="ghost" size="icon" className="size-7" onClick={onReset} title="Reset this category">
                <RotateCcw className="size-3.5" />
              </Button>
            )}
          </>
        )}
      </div>

      {open && included && (
        <div className="space-y-3 border-t px-3 py-2.5">
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">
              Available column for {category}
            </Label>
            <NativeSelect
              value={value?.availableDisplay ?? ''}
              onChange={(v) => onChange({ availableDisplay: (v || null) as AvailableDisplay | null })}
              options={[{ value: '', label: 'Default' }, { value: 'PCS', label: 'Pieces' }, { value: 'SIZE', label: 'Size' }]}
              className="h-8 w-40 text-[12px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">
              Sub-categories — none picked means all {subs.length}
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {subs.map((s) => {
                const on = picked.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => toggleSub(s)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                      on
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-400/40 dark:bg-indigo-500/15 dark:text-indigo-300'
                        : 'text-muted-foreground border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5',
                    )}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          <CombinationEditor
            category={category}
            subs={picked.length ? picked : subs}
            combinations={combos}
            canEdit={canEdit}
            onChange={(next) => onChange({ combinations: next })}
          />
        </div>
      )}
    </div>
  );
}

/* ── §7 / §8 combinations ────────────────────────────────────────────────────── */

function CombinationEditor({
  category,
  subs,
  combinations,
  canEdit,
  onChange,
}: {
  category: string;
  subs: string[];
  combinations: RateListCombination[];
  canEdit: boolean;
  onChange: (next: RateListCombination[]) => void;
}) {
  const check = useCheckCombination();
  const [picking, setPicking] = useState<string[]>([]);
  const [label, setLabel] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const toggle = (s: string) => {
    setProblem(null);
    setPicking((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  };

  /** Verified by the SERVER before it is added — the rule that matters here is
   *  §8, and a client-side copy of it would eventually disagree with the one
   *  that guards the save. */
  const add = () => {
    setProblem(null);
    check.mutate(
      { category, subCategories: picking },
      {
        onSuccess: (res) => {
          if (!res.ok) {
            setProblem(res.message ?? 'These cannot be combined.');
            return;
          }
          onChange([
            ...combinations,
            { id: `c${Date.now()}`, label: label.trim() || picking.join(', '), members: picking },
          ]);
          setPicking([]);
          setLabel('');
          toast.success(
            res.agreeing > 0
              ? `Combined — ${res.agreeing} shared item${res.agreeing === 1 ? '' : 's'} price the same across these`
              : 'Combined — no item appears in more than one of these, so nothing can clash',
          );
        },
        onError: (e) => setProblem(getApiErrorMessage(e, 'Could not check the rates')),
      },
    );
  };

  return (
    <div className="space-y-2">
      <Label className="text-muted-foreground text-[10.5px] font-bold tracking-wide uppercase">
        Price combinations — show several sub-categories under one column
      </Label>

      {!!combinations.length && (
        <div className="space-y-1">
          {combinations.map((cb) => (
            <div key={cb.id} className="flex items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 dark:bg-transparent">
              <span className="min-w-0 flex-1 text-[12px]">
                <b>{cb.label}</b>
                <span className="text-muted-foreground ml-1.5">{cb.members.join(' + ')}</span>
              </span>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => onChange(combinations.filter((x) => x.id !== cb.id))}
                >
                  <Trash2 className="size-3 text-rose-600" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="bg-muted/40 space-y-2 rounded-md p-2.5">
          <div className="flex flex-wrap gap-1.5">
            {subs.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggle(s)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                  picking.includes(s)
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : 'text-muted-foreground border-slate-200 hover:bg-white dark:border-white/10',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Column title (optional)"
              className="h-8 w-52 text-[12px]"
            />
            <Button size="sm" className="h-8 text-[12px]" onClick={add} disabled={picking.length < 2 || check.isPending}>
              {check.isPending ? <Loader2 className="animate-spin" /> : <Plus className="size-3.5" />} Combine{' '}
              {picking.length >= 2 ? `${picking.length} selected` : ''}
            </Button>
          </div>
          {problem && (
            <p className="flex items-start gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[11.5px] text-rose-900 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-200">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>{problem}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
