import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Layers, Loader2, Plus, RotateCcw, Trash2, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  AVAILABLE_DISPLAYS,
  type AvailableDisplay,
  type AvailableOverrideScope,
  type RateListAvailableOverride,
  type RateListCategoryConfig,
  type RateListCombination,
  type RateListConfigInput,
} from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/common/confirm';
import { NativeSelect } from '@/components/common/combo';
import { InfoTip } from '@/components/common/info-tip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCustomers } from '@/features/customers/use-customers';
import {
  useCheckCombination,
  useClearPartyRateListConfig,
  useRateListCategoryItems,
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
  availableOverrides: [],
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
          <Label className="text-muted-foreground flex items-center gap-1 text-[11px] font-bold tracking-wide uppercase">
            Available column shows
            <InfoTip text="The third column on the rate list. Pieces shows how many pcs each item comes in; Size shows its size. Applies to every category unless a category below overrides it." />
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
            Applies to everything.
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
                ? 'same as Default'
                : 'open one to set it up'
              : `${cats.length} set up`}
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
  const overrides = value?.availableOverrides ?? [];

  const toggleSub = (s: string) => {
    const next = picked.includes(s) ? picked.filter((x) => x !== s) : [...picked, s];
    onChange({ subCategories: next });
  };

  return (
    <div className={cn('rounded-lg border', !included && 'bg-muted/30 opacity-70')}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {/*
          * This row is the only way in to the Available column, the sub-category
          * picker and the per-item exceptions — and it used to be a bare text
          * button: no chevron, no cursor, no hover. Nothing said it opened, so
          * every one of those settings was invisible unless you happened to
          * click the category name. The chevron and the explicit "Set up" are
          * the fix; the row is a real disclosure control now.
          */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title={`${open ? 'Hide' : 'Show'} ${category} — Available column, sub-categories, per-item exceptions`}
          className="hover:bg-muted/60 -mx-1.5 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors"
        >
          <ChevronRight className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-90')} />
          <span className="min-w-0 flex-1">
            <span className="text-[13px] font-bold">{category}</span>
            <span className="text-muted-foreground ml-2 text-[11px] font-medium">
              {!value
                ? (inheritLabel ?? 'all sub-categories')
                : [
                    included ? null : 'excluded',
                    picked.length ? `${picked.length} of ${subs.length} sub-categories` : 'all sub-categories',
                    value.availableDisplay ? (value.availableDisplay === 'PCS' ? 'Pieces' : 'Size') : null,
                    overrides.length ? `${overrides.length} available exception${overrides.length === 1 ? '' : 's'}` : null,
                    combos.length ? `${combos.length} combination${combos.length === 1 ? '' : 's'}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </span>
          </span>
          {!open && (
            <span className="text-primary shrink-0 text-[10.5px] font-bold tracking-wide uppercase">Set up</span>
          )}
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

      {/* An excluded category has nothing to configure, so the panel is empty —
          say that rather than appearing to ignore the click. */}
      {open && !included && (
        <p className="text-muted-foreground border-t px-3 py-2 text-[11.5px]">
          {category} is excluded from the rate list, so there is nothing to lay out. Include it to set its Available column.
        </p>
      )}

      {open && included && (
        <div className="space-y-3 border-t px-3 py-2.5">
          <div className="space-y-1">
            <Label className="text-muted-foreground flex items-center gap-1 text-[10.5px] font-bold tracking-wide uppercase">
              Available column
              <InfoTip text={`Applies to everything in ${category}. Leave it on Default to follow the setting at the top. Add an exception below if one sub-category, item or design needs the other unit.`} />
            </Label>
            <NativeSelect
              value={value?.availableDisplay ?? ''}
              onChange={(v) => onChange({ availableDisplay: (v || null) as AvailableDisplay | null })}
              options={[{ value: '', label: 'Default' }, { value: 'PCS', label: 'Pieces' }, { value: 'SIZE', label: 'Size' }]}
              className="h-8 w-40 text-[12px]"
            />

          </div>

          <AvailableOverrideEditor
            category={category}
            subs={picked.length ? picked : subs}
            categoryDisplay={value?.availableDisplay ?? null}
            overrides={overrides}
            canEdit={canEdit}
            onChange={(next) => onChange({ availableOverrides: next })}
          />

          <div className="space-y-1.5">
            <Label className="text-muted-foreground flex items-center gap-1 text-[10.5px] font-bold tracking-wide uppercase">
              Sub-categories
              <InfoTip text={`Which sub-categories appear on the sheet. Pick none to include all ${subs.length} — that way a new sub-category shows up on its own instead of going missing until someone ticks it.`} />
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

/* ── Available-column exceptions inside one category ───────────────────────── */

const SCOPE_LABEL: Record<AvailableOverrideScope, string> = {
  SUBCATEGORY: 'Sub-category',
  ITEM: 'Item',
  DESIGN: 'Design',
};

/**
 * "Everything in GLASS by pieces — except this one item, which goes by size."
 *
 * The Available column used to be a single choice per category, which has no
 * right answer for a category that mixes the two: whichever you picked was wrong
 * for part of the sheet. These rules resolve most-specific-first (item, then
 * sub-category, then the category, then the global default), the same cascade as
 * special rates.
 *
 * The note at the bottom is the important part of the UI: rows that resolve to a
 * different unit are pivoted into their OWN table on the sheet, because one grid
 * cannot carry two column axes. Somebody adding a rule here needs to know it
 * splits the table, not just relabels a column.
 */
function AvailableOverrideEditor({
  category,
  subs,
  categoryDisplay,
  overrides,
  canEdit,
  onChange,
}: {
  category: string;
  subs: string[];
  categoryDisplay: AvailableDisplay | null;
  overrides: RateListAvailableOverride[];
  canEdit: boolean;
  onChange: (next: RateListAvailableOverride[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [scope, setScope] = useState<AvailableOverrideScope>('SUBCATEGORY');
  const [sub, setSub] = useState('');
  const [target, setTarget] = useState('');
  const [display, setDisplay] = useState<AvailableDisplay>('SIZE');

  // Only fetched once the form is open — the picker is the only thing that needs
  // item names, and the settings screen must not pull the catalogue to render.
  /*
   * `isFetching`/`isError` rather than `isLoading`.
   *
   * `isLoading` stayed true after a failed request, so a picker that could not
   * load sat on "Loading…" for ever — and the fallback for an empty list,
   * "Nothing on the sheet", would have been just as wrong: it states a fact
   * about the catalogue when the truth is that we never got an answer. The two
   * cases have to read differently or the user cannot tell "this category has no
   * items" from "something is broken".
   */
  const { data: items, isFetching, isError } = useRateListCategoryItems(adding && scope !== 'SUBCATEGORY' ? category : null);
  const pool = scope === 'DESIGN' ? (items?.designs ?? []) : (items?.products ?? []);
  /** Narrowed by the chosen sub-category, so picking one does not offer items
   *  that do not appear in it. */
  const targetOptions = useMemo(
    () => [...new Set(pool.filter((r) => !sub || r.subCategory === sub).map((r) => r.item))].sort(),
    [pool, sub],
  );

  const reset = () => {
    setAdding(false);
    setScope('SUBCATEGORY');
    setSub('');
    setTarget('');
    setDisplay('SIZE');
  };

  const add = () => {
    if (scope === 'SUBCATEGORY' ? !sub : !target) return;
    const row: RateListAvailableOverride = {
      id: `o${Date.now().toString(36)}`,
      scope,
      subCategory: sub,
      target: scope === 'SUBCATEGORY' ? '' : target,
      display,
    };
    // Replace rather than append when the same thing is already ruled on —
    // otherwise the list grows two rows that disagree and only one can win.
    const key = (r: RateListAvailableOverride) => `${r.scope}|${r.subCategory}|${r.target}`;
    onChange([...overrides.filter((r) => key(r) !== key(row)), row]);
    reset();
  };

  const describe = (r: RateListAvailableOverride) =>
    r.scope === 'SUBCATEGORY' ? r.subCategory : r.subCategory ? `${r.target} · in ${r.subCategory}` : r.target;

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-muted-foreground flex items-center gap-1 text-[10.5px] font-bold tracking-wide uppercase">
          Exceptions
          <InfoTip
            text={`One sub-category, item or design in ${category} that should use the other unit. On the sheet, ${category} then prints as separate tables — one per unit — because a table can only have one kind of column heading.`}
          />
        </Label>
        {canEdit && !adding && (
          <Button variant="outline" size="sm" className="ml-auto h-7 px-2 text-[11.5px]" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add exception
          </Button>
        )}
      </div>

      {!!overrides.length && (
        <div className="space-y-1">
          {overrides.map((r) => (
            <div key={r.id} className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-[11.5px]">
              <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-white/10 dark:text-slate-300">
                {SCOPE_LABEL[r.scope]}
              </span>
              <span className="min-w-0 truncate font-semibold">{describe(r)}</span>
              <span
                className={cn(
                  'ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold',
                  r.display === 'SIZE'
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300'
                    : 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
                )}
              >
                {r.display === 'SIZE' ? 'Size' : 'Pieces'}
              </span>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive size-6"
                  onClick={() => onChange(overrides.filter((x) => x.id !== r.id))}
                  aria-label={`Remove exception for ${describe(r)}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="space-y-2 rounded-md border p-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-[10px] font-bold tracking-wide uppercase">Applies to</Label>
              <NativeSelect
                value={scope}
                onChange={(v) => {
                  setScope(v as AvailableOverrideScope);
                  setTarget('');
                }}
                options={[
                  { value: 'SUBCATEGORY', label: 'A sub-category' },
                  { value: 'ITEM', label: 'One item' },
                  { value: 'DESIGN', label: 'One design' },
                ]}
                className="h-8 w-40 text-[12px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-[10px] font-bold tracking-wide uppercase">
                Sub-category{scope === 'SUBCATEGORY' ? '' : ' — optional'}
              </Label>
              <NativeSelect
                value={sub}
                onChange={(v) => {
                  setSub(v);
                  setTarget('');
                }}
                options={[{ value: '', label: scope === 'SUBCATEGORY' ? 'Pick one…' : 'Any' }, ...subs.map((x) => ({ value: x, label: x }))]}
                className="h-8 w-44 text-[12px]"
              />
            </div>
            {scope !== 'SUBCATEGORY' && (
              <div className="space-y-1">
                <Label className="text-muted-foreground text-[10px] font-bold tracking-wide uppercase">
                  {scope === 'DESIGN' ? 'Design' : 'Item'}
                </Label>
                {/*
                  * The empty option's label is FIXED.
                  *
                  * It used to carry the state — "Loading…" / "Could not load" /
                  * "Nothing on the sheet" — but the combobox seeds its visible
                  * text from the matching option once and does not re-derive it
                  * when the options change. So the box sat on "Loading…" after
                  * the request had already failed. State belongs in the disabled
                  * flag and the line below, both of which do re-render.
                  */}
                <NativeSelect
                  value={target}
                  onChange={setTarget}
                  disabled={isError || (isFetching && !items)}
                  options={[{ value: '', label: 'Pick one…' }, ...targetOptions.map((x) => ({ value: x, label: x }))]}
                  className="h-8 w-56 text-[12px]"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-muted-foreground text-[10px] font-bold tracking-wide uppercase">Show</Label>
              <NativeSelect
                value={display}
                onChange={(v) => setDisplay(v as AvailableDisplay)}
                options={AVAILABLE_DISPLAYS.map((d) => ({ value: d, label: d === 'PCS' ? 'Pieces' : 'Size' }))}
                className="h-8 w-32 text-[12px]"
              />
            </div>
            <Button size="sm" className="h-8 text-[11.5px]" disabled={scope === 'SUBCATEGORY' ? !sub : !target} onClick={add}>
              <Check className="size-3.5" /> Add
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-[11.5px]" onClick={reset}>
              Cancel
            </Button>
          </div>
          {scope !== 'SUBCATEGORY' && isError && (
            <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              Could not load the {scope === 'DESIGN' ? 'designs' : 'items'} in {category}. Pick a sub-category rule instead, or
              reload the page and try again.
            </p>
          )}
          {scope !== 'SUBCATEGORY' && !isError && isFetching && !items && (
            <p className="text-muted-foreground text-[11px]">Loading the {scope === 'DESIGN' ? 'designs' : 'items'} in {category}…</p>
          )}
          {scope !== 'SUBCATEGORY' && !isError && !isFetching && items && targetOptions.length === 0 && (
            <p className="text-muted-foreground text-[11px]">
              Nothing on the rate list in {category}
              {sub ? ` under ${sub}` : ''} to make a rule about.
            </p>
          )}
        </div>
      )}

      {/* Only said when it applies. Before, the same box carried a paragraph
          whether or not there was an exception to explain. */}
      {!!overrides.length && (
        <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <TriangleAlert className="mr-1 inline size-3" />
          {category} will print as separate tables — one per unit.
        </p>
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
      <Label className="text-muted-foreground flex items-center gap-1 text-[10.5px] font-bold tracking-wide uppercase">
        Price combinations
        <InfoTip text="Show several sub-categories under one shared column, when they all charge the same rate. Refused if their rates differ — one heading over two prices hides one of them." />
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
