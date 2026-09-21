import { useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, FolderTree, Link2, ListPlus, Loader2, Search, Upload, Users, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import type { TallyImportOther, TallyImportParty, TallyImportPreview } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAccountGroups, useAddToList, useAdditions, useApplyTallyImport, useRemoveFromList } from './use-account-groups';
import { initialTallyPartyCustomerId, tallyPartyReviewBucket } from './tally-master-import-state';

type Tab = 'parties' | 'groups' | 'others';
type PartyFilter = 'check' | 'matched' | 'skipped' | 'missing' | 'all';

const HOW_LABEL = { LINKED: 'Already linked', SAME_NAME: 'Already in OMS' } as const;
const key = (s: string) => s.trim().toUpperCase();
const drcr = (v: number | null) =>
  v == null ? null : Math.abs(v) < 1 ? 'nil' : `₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })} ${v < 0 ? 'Cr' : 'Dr'}`;

function Tick({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className="size-4 shrink-0 cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}

export function TallyMasterImportDialog({ preview, onClose }: { preview: TallyImportPreview; onClose: () => void }) {
  const apply = useApplyTallyImport();
  const addToList = useAddToList();
  const removeFromList = useRemoveFromList();
  const { data: queued = [] } = useAdditions();
  const queuedId = useMemo(() => new Map(queued.map((q) => [key(q.tallyName), q.id])), [queued]);
  const toggleList = (items: TallyImportParty[], on: boolean) => {
    if (on) {
      addToList.mutate(
        items.map((p) => ({ tallyName: p.tallyName, groupName: p.tallyGroup, details: p.details })),
        {
          onSuccess: () => toast.success(items.length === 1 ? `"${items[0].tallyName}" added to the addition list` : `${items.length} parties added to the addition list`),
          onError: (e) => toast.error(getApiErrorMessage(e, 'Could not add to the list')),
        },
      );
    } else {
      const id = queuedId.get(key(items[0].tallyName));
      if (id != null) removeFromList.mutate(id, { onError: (e) => toast.error(getApiErrorMessage(e, 'Could not remove')) });
    }
  };
  const { data: omsGroups = [] } = useAccountGroups();
  const custName = useMemo(() => new Map(preview.customers.map((c) => [c.id, c.name])), [preview]);
  const custGroup = useMemo(() => new Map(preview.customers.map((c) => [c.id, c.groupId])), [preview]);
  const omsGroupName = useMemo(() => new Map(omsGroups.map((g) => [g.id, g.name])), [omsGroups]);
  const omsGroupKeys = useMemo(() => new Set(omsGroups.map((g) => key(g.name))), [omsGroups]);
  const custOptions = useMemo(
    () => [{ value: '', label: '— Skip —' }, ...preview.customers.map((c) => ({ value: String(c.id), label: c.active ? c.name : `${c.name} (inactive)` }))],
    [preview],
  );

  const [pick, setPick] = useState<Map<string, number | null>>(() =>
    new Map(preview.parties.map((p) => [p.tallyName, initialTallyPartyCustomerId(p)])),
  );
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [groupOn, setGroupOn] = useState<Set<string>>(() => new Set(preview.groups.filter((g) => g.status !== 'SAME').map((g) => g.name)));

  const sending = (p: TallyImportParty) => pick.get(p.tallyName) != null;

  const conflicts = useMemo(() => {
    const byCust = new Map<number, Set<string>>();
    for (const p of preview.parties) {
      if (!sending(p)) continue;
      const id = pick.get(p.tallyName)!;
      byCust.set(id, (byCust.get(id) ?? new Set()).add(key(p.tallyGroup)));
    }
    return new Set(preview.parties.filter((p) => sending(p) && (byCust.get(pick.get(p.tallyName)!)?.size ?? 0) > 1).map((p) => p.tallyName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, pick]);

  const groupReady = (name: string) => omsGroupKeys.has(key(name)) || [...groupOn].some((g) => key(g) === key(name));
  const missingGroup = useMemo(
    () => new Set(preview.parties.filter((p) => sending(p) && !groupReady(p.tallyGroup)).map((p) => p.tallyName)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview, pick, groupOn, omsGroupKeys],
  );

  const needsCheck = (p: TallyImportParty) => conflicts.has(p.tallyName) || missingGroup.has(p.tallyName);
  const reviewBucket = (p: TallyImportParty) =>
    tallyPartyReviewBucket({ customerId: pick.get(p.tallyName) ?? null, previouslySkipped: p.previouslySkipped });
  const counts = {
    check: preview.parties.filter(needsCheck).length,
    matched: preview.parties.filter((p) => reviewBucket(p) === 'matched').length,
    skipped: preview.parties.filter((p) => reviewBucket(p) === 'skipped').length,
    missing: preview.parties.filter((p) => reviewBucket(p) === 'missing').length,
  };
  const groupChanges = preview.groups.filter((g) => g.status !== 'SAME');
  const groupSaved = preview.groups.length - groupChanges.length;

  const [tab, setTab] = useState<Tab>('parties');
  const [filter, setFilter] = useState<PartyFilter>(counts.check ? 'check' : 'all');
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();

  const [balanceOnly, setBalanceOnly] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const hasBalance = (p: TallyImportParty) => Math.abs(p.tallyClosing ?? 0) >= 1;
  const missingWithBalance = preview.parties.filter((p) => reviewBucket(p) === 'missing' && hasBalance(p)).length;

  const partyRows = preview.parties.filter((p) => {
    if (q && !p.tallyName.toLowerCase().includes(q) && !(custName.get(pick.get(p.tallyName) ?? -1) ?? '').toLowerCase().includes(q)) return false;
    if (filter === 'check') return needsCheck(p);
    if (filter === 'matched') return reviewBucket(p) === 'matched';
    if (filter === 'skipped') return reviewBucket(p) === 'skipped';
    if (filter === 'missing') return reviewBucket(p) === 'missing' && (!balanceOnly || hasBalance(p));
    return true;
  });
  if (filter === 'missing' && balanceOnly) partyRows.sort((a, b) => Math.abs(b.tallyClosing ?? 0) - Math.abs(a.tallyClosing ?? 0));
  const tickable = filter === 'missing' ? partyRows.filter((p) => !queuedId.has(key(p.tallyName))) : [];
  const tickedRows = tickable.filter((p) => ticked.has(p.tallyName));
  const allTicked = tickable.length > 0 && tickedRows.length === tickable.length;
  const toggleTick = (name: string) =>
    setTicked((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  const otherRows = preview.others.filter((o) => !q || o.tallyName.toLowerCase().includes(q) || o.tallyGroup.toLowerCase().includes(q));
  const otherByGroup = useMemo(() => {
    const m = new Map<string, TallyImportOther[]>();
    for (const o of otherRows) m.set(o.tallyGroup, [...(m.get(o.tallyGroup) ?? []), o]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [otherRows]);
  const allLedgers = preview.parties.length + preview.others.length;
  const otherSaved = preview.others.filter((o) => o.status === 'SAVED').length;
  const otherMoved = preview.others.filter((o) => o.status === 'MOVE').length;
  const otherNew = preview.others.filter((o) => o.status === 'NEW').length;

  const blocked = conflicts.size > 0 || missingGroup.size > 0;
  const partiesToSend = preview.parties.filter(sending);
  const nothing = !allLedgers && !groupOn.size;

  const setParty = (name: string, id: number | null) => {
    setPick((m) => new Map(m).set(name, id));
    setEditing((s) => {
      const n = new Set(s);
      n.delete(name);
      return n;
    });
  };

  const submit = () => {
    apply.mutate(
      {
        groups: groupChanges.filter((g) => groupOn.has(g.name)).map((g) => ({ name: g.name, parent: g.parent })),
        parties: partiesToSend.map((p) => ({ tallyName: p.tallyName, customerId: pick.get(p.tallyName)!, groupName: p.tallyGroup })),
        ledgers: [...preview.parties, ...preview.others].map((l) => ({ name: l.tallyName, group: l.tallyGroup })),
      },
      {
        onSuccess: (r) => {
          toast.success('Tally master uploaded', {
            description: [
              `${r.partiesUpdated} parties updated`,
              r.groupsCreated && `${r.groupsCreated} groups created`,
              r.groupsMoved && `${r.groupsMoved} groups moved`,
              r.linksSaved && `${r.linksSaved} Tally names linked`,
              r.ledgersSaved && `${r.ledgersSaved} ledgers saved with their group`,
            ]
              .filter(Boolean)
              .join(' · '),
          });
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Upload failed')),
      },
    );
  };

  const TABS: [Tab, string, typeof Users, number][] = [
    ['parties', 'Parties', Users, preview.parties.length],
    ['groups', 'Groups', FolderTree, preview.groups.length],
    ['others', 'Other ledgers', Wallet, preview.others.length],
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && !apply.isPending && onClose()}>
      <DialogContent className="flex h-[92dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:h-[86vh] sm:max-w-4xl">
        <div className="shrink-0 border-b px-4 pt-4 pb-3 sm:px-5">
          <DialogTitle className="pr-10 text-[16px]">Review Tally master</DialogTitle>
          <DialogDescription className="truncate pr-10 text-[12px]">
            {preview.fileName} · nothing is saved until you press Upload
          </DialogDescription>
          <div className="mt-3 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map(([k, label, Icon, n]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                aria-pressed={tab === k}
                className={cn(
                  'flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-[12.5px] font-bold transition-colors',
                  tab === k ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" /> {label}
                <span className={cn('rounded-full px-1.5 text-[11px] tabular-nums', tab === k ? 'bg-white/20' : 'bg-muted')}>{n}</span>
              </button>
            ))}
          </div>
          {tab !== 'groups' && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                <Input placeholder="Search…" className="h-8 pl-8 text-[12.5px]" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              {tab === 'parties' &&
                (
                  [
                    ['check', 'Check', counts.check, 'amber'],
                    ['matched', 'Already in OMS', counts.matched, 'emerald'],
                    ['skipped', 'Skipped before', counts.skipped, 'slate'],
                    ['missing', 'Not in OMS', counts.missing, 'slate'],
                    ['all', 'All', preview.parties.length, 'slate'],
                  ] as const
                ).map(([k, label, n, tone]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFilter(k)}
                    aria-pressed={filter === k}
                    className={cn(
                      'cursor-pointer rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold transition-colors',
                      filter === k
                        ? tone === 'amber'
                          ? 'border-amber-500 bg-amber-500 text-white'
                          : tone === 'emerald'
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-slate-700 bg-slate-700 text-white dark:border-slate-300 dark:bg-slate-300 dark:text-slate-900'
                        : 'text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {label} {n}
                  </button>
                ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5">
          {tab === 'parties' && (
            <div className="space-y-1.5">
              {filter === 'missing' && (
                <div className="sticky -top-3 z-10 -mx-3 space-y-2 border-b bg-white/95 px-3 pt-1 pb-2 backdrop-blur sm:-mx-5 sm:px-5 dark:bg-slate-900/95">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        [false, `All ${counts.missing}`],
                        [true, `With balance (Dr / Cr) ${missingWithBalance}`],
                      ] as const
                    ).map(([on, label]) => (
                      <button
                        key={String(on)}
                        type="button"
                        onClick={() => {
                          setBalanceOnly(on);
                          setTicked(new Set());
                        }}
                        aria-pressed={balanceOnly === on}
                        className={cn(
                          'cursor-pointer rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold transition-colors',
                          balanceOnly === on ? 'border-indigo-600 bg-indigo-600 text-white' : 'text-muted-foreground hover:bg-accent',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                    {balanceOnly && <span className="text-muted-foreground text-[11px] font-medium">biggest amount first</span>}
                  </div>
                  {tickable.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-semibold">
                        <Tick
                          checked={allTicked}
                          onChange={() => setTicked(allTicked ? new Set() : new Set(tickable.map((p) => p.tallyName)))}
                          label="Select all shown"
                        />
                        Select all shown ({tickable.length})
                      </label>
                      <Button
                        size="sm"
                        className="ml-auto h-8 gap-1.5 rounded-[4px] text-[12px] font-bold"
                        disabled={!tickedRows.length || addToList.isPending}
                        onClick={() => {
                          toggleList(tickedRows, true);
                          setTicked(new Set());
                        }}
                      >
                        {addToList.isPending ? <Loader2 className="animate-spin" /> : <ListPlus className="size-3.5" />}
                        Add {tickedRows.length || ''} selected to list
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {!partyRows.length && <p className="text-muted-foreground py-10 text-center text-[12.5px]">Nothing here.</p>}
              {partyRows.map((p) => {
                const id = pick.get(p.tallyName) ?? null;
                const auto = id != null && id === p.match?.customerId && p.match.how !== 'LOOKS_LIKE';
                const nowGroup = id != null ? omsGroupName.get(custGroup.get(id) ?? -1) : undefined;
                const same = !!nowGroup && key(nowGroup) === key(p.tallyGroup);
                const bad = conflicts.has(p.tallyName) || missingGroup.has(p.tallyName);
                const showPicker = editing.has(p.tallyName) || id == null;
                const suggestionIds = p.match?.how === 'LOOKS_LIKE' ? [p.match.customerId, ...p.suggestions] : p.suggestions;
                return (
                  <div
                    key={p.tallyName}
                    className={cn(
                      'rounded-lg border px-3 py-2',
                      bad
                        ? 'border-rose-300 bg-rose-50/70 dark:border-rose-400/40 dark:bg-rose-400/10'
                        : id == null
                          ? 'bg-muted/30'
                          : 'bg-card',
                    )}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 items-start gap-2 sm:w-[42%]">
                        {filter === 'missing' && !queuedId.has(key(p.tallyName)) && (
                          <span className="pt-0.5">
                            <Tick checked={ticked.has(p.tallyName)} onChange={() => toggleTick(p.tallyName)} label={`Select ${p.tallyName}`} />
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-bold text-slate-900 dark:text-slate-100" title={p.tallyName}>{p.tallyName}</p>
                          <p className="text-muted-foreground truncate text-[11px] font-medium">Under {p.tallyGroup}</p>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {showPicker ? (
                          <div className="min-w-0 flex-1">
                            <NativeSelect
                              value={id != null ? String(id) : ''}
                              onChange={(v) => setParty(p.tallyName, v ? Number(v) : null)}
                              options={custOptions}
                              placeholder="Pick OMS party"
                              className="h-8 text-[12.5px]"
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditing((s) => new Set(s).add(p.tallyName))}
                            className="hover:bg-accent flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left"
                            title="Change OMS party"
                          >
                            <Link2 className="size-3.5 shrink-0 text-indigo-500" />
                            <span className="shrink-0 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">OMS</span>
                            <span className="truncate text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">{custName.get(id!)}</span>
                          </button>
                        )}
                        {id != null && (
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold',
                              !auto
                                ? 'bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200',
                            )}
                          >
                            {!auto ? 'Your pick' : HOW_LABEL[p.match!.how as keyof typeof HOW_LABEL]}
                          </span>
                        )}
                        {id == null && (
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold',
                              p.previouslySkipped
                                ? 'bg-slate-200 text-slate-700 dark:bg-slate-400/15 dark:text-slate-200'
                                : 'bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200',
                            )}
                          >
                            {p.previouslySkipped ? 'Skipped previously' : 'New in this upload'}
                          </span>
                        )}
                      </div>
                    </div>
                    {id == null && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className="text-[11.5px] font-medium text-slate-600 dark:text-slate-300">
                          Tally closing{' '}
                          <b
                            className={cn(
                              'tabular-nums',
                              p.tallyClosing == null || Math.abs(p.tallyClosing) < 1 ? 'text-muted-foreground font-medium' : p.tallyClosing < 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400',
                            )}
                          >
                            {drcr(p.tallyClosing) ?? 'not found — upload a Tally Reconciliation register'}
                          </b>
                          {p.tallyClosing != null && preview.balanceTo && <span className="text-muted-foreground"> as at {formatDate(preview.balanceTo)}</span>}
                        </span>
                        {queuedId.has(key(p.tallyName)) ? (
                          <button
                            type="button"
                            onClick={() => toggleList([p], false)}
                            className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-400/15 dark:text-emerald-200"
                            title="Remove from the addition list"
                          >
                            <Check className="size-3" /> In addition list
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleList([p], true)}
                            disabled={addToList.isPending}
                            className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-full border border-indigo-300 bg-white px-2.5 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-400/40 dark:bg-transparent dark:text-indigo-200"
                          >
                            <ListPlus className="size-3" /> Add to list
                          </button>
                        )}
                      </div>
                    )}
                    {id == null && suggestionIds.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span className="text-muted-foreground text-[10.5px] font-semibold">Looks like:</span>
                        {suggestionIds.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setParty(p.tallyName, s)}
                            className="cursor-pointer rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-800 hover:bg-violet-100 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-200"
                          >
                            {custName.get(s)}
                          </button>
                        ))}
                      </div>
                    )}
                    {id != null && (
                      <p className={cn('mt-1 text-[11px] font-medium', bad ? 'text-rose-700 dark:text-rose-300' : same ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300')}>
                        {conflicts.has(p.tallyName)
                          ? 'Another Tally ledger points to this party with a different group — pick a different party or Skip one.'
                          : missingGroup.has(p.tallyName)
                            ? `Group "${p.tallyGroup}" is not in OMS — tick it on the Groups tab.`
                            : same
                              ? `Already under ${p.tallyGroup}`
                              : `Under: ${nowGroup ?? '—'} → ${p.tallyGroup}`}
                        {!bad && p.tallyClosing != null && <span className="text-muted-foreground"> · Tally closing {drcr(p.tallyClosing)}</span>}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'groups' && (
            <div className="space-y-1.5">
              <p className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[12px] font-medium text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100">
                <b>{groupSaved}</b> already saved · <b>{groupChanges.filter((g) => g.status === 'NEW').length}</b> new ·{' '}
                <b>{groupChanges.filter((g) => g.status === 'MOVE').length}</b> will move
              </p>
              {preview.groups.map((g) => (
                <div key={g.name} className="bg-card flex items-center gap-3 rounded-lg border px-3 py-2">
                  {g.status === 'SAME' ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  ) : (
                    <Tick
                      checked={groupOn.has(g.name)}
                      onChange={() =>
                        setGroupOn((s) => {
                          const n = new Set(s);
                          if (n.has(g.name)) n.delete(g.name);
                          else n.add(g.name);
                          return n;
                        })
                      }
                      label={g.name}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold">{g.name}</p>
                    <p className="text-muted-foreground text-[11px] font-medium">
                      {g.status === 'SAME'
                        ? `Already saved under ${g.parent ?? 'Primary'}`
                        : g.status === 'NEW'
                          ? `Will be added under ${g.parent ?? 'Primary'}`
                          : `Will move: ${g.omsParent ?? 'Primary'} → ${g.parent ?? 'Primary'}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold',
                      g.status === 'SAME'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200'
                        : g.status === 'NEW'
                          ? 'bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200',
                    )}
                  >
                    {g.status === 'SAME' ? 'Already saved' : g.status === 'NEW' ? 'New' : 'Will move'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === 'others' && (
            <div className="space-y-3">
              <p className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-[12px] font-medium text-sky-900 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100">
                These are not customer parties. <b>{otherSaved}</b> are already saved, <b>{otherNew}</b> are new
                {otherMoved > 0 && <>, and <b>{otherMoved}</b> will change group</>}. Upload refreshes existing records instead of duplicating them.
              </p>
              {!otherByGroup.length && <p className="text-muted-foreground py-10 text-center text-[12.5px]">Nothing here.</p>}
              {otherByGroup.map(([group, list]) => (
                <div key={group} className="bg-card overflow-hidden rounded-lg border">
                  <div className="flex items-center justify-between gap-2 border-b bg-slate-50 px-3 py-1.5 dark:bg-white/[0.04]">
                    <span className="truncate text-[12.5px] font-bold">{group}</span>
                    <span className="bg-muted shrink-0 rounded-full px-2 text-[11px] font-bold tabular-nums">{list.length}</span>
                  </div>
                  <ul className="divide-y">
                    {list.map((o) => (
                      <li key={o.tallyName} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12.5px] font-medium" title={o.tallyName}>
                        <span className="min-w-0 truncate">
                          {o.tallyName}
                          {o.status === 'MOVE' && <span className="text-muted-foreground ml-1 text-[10.5px]">({o.savedGroup} → {o.tallyGroup})</span>}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold',
                            o.status === 'SAVED'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200'
                              : o.status === 'NEW'
                                ? 'bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200',
                          )}
                        >
                          {o.status === 'SAVED' ? 'Already saved' : o.status === 'NEW' ? 'New' : 'Group update'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t bg-slate-50/80 px-4 py-3 sm:flex-row sm:items-center sm:px-5 dark:bg-white/[0.03]">
          <p className={cn('min-w-0 flex-1 text-[12px] font-medium', blocked ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground')}>
            {blocked ? (
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="size-4 shrink-0" />
                {conflicts.size + missingGroup.size} {conflicts.size + missingGroup.size === 1 ? 'party needs' : 'parties need'} fixing — see “Check”.
              </span>
            ) : (
              <>
                <b className="text-foreground">{partiesToSend.length}</b> parties matched · <b className="text-foreground">{groupOn.size}</b> group changes ·{' '}
                <b className="text-foreground">{otherNew}</b> new other ledgers · <b className="text-foreground">{otherSaved}</b> already saved
              </>
            )}
          </p>
          <div className="flex gap-2 self-end sm:self-auto">
            <Button variant="outline" className="h-9 rounded-[4px] text-[12.5px] font-semibold" onClick={onClose} disabled={apply.isPending}>
              Cancel
            </Button>
            <Button className="h-9 gap-1.5 rounded-[4px] text-[12.5px] font-bold" onClick={submit} disabled={blocked || nothing || apply.isPending}>
              {apply.isPending ? <Loader2 className="animate-spin" /> : <Upload className="size-4" />} Upload
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
