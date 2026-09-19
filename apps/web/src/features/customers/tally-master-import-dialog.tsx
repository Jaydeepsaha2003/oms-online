import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderTree, Link2, Loader2, Search, Upload, Users, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import type { TallyImportFiling, TallyImportParty, TallyImportPreview } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAccountGroups, useApplyTallyImport } from './use-account-groups';

type Tab = 'parties' | 'groups' | 'others';
type PartyFilter = 'check' | 'matched' | 'missing' | 'all';
type Filing = TallyImportFiling | 'SKIP';

const HOW_LABEL = { LINKED: 'Linked before', SAME_NAME: 'Same name', LOOKS_LIKE: 'Looks like' } as const;
const FILINGS: [Filing, string][] = [
  ['AGENT', 'Agent'],
  ['EXPENSE', 'Expense'],
  ['OTHER', 'Other'],
  ['SKIP', 'Leave'],
];
const key = (s: string) => s.trim().toUpperCase();

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
  const { data: omsGroups = [] } = useAccountGroups();
  const custName = useMemo(() => new Map(preview.customers.map((c) => [c.id, c.name])), [preview]);
  const custGroup = useMemo(() => new Map(preview.customers.map((c) => [c.id, c.groupId])), [preview]);
  const omsGroupName = useMemo(() => new Map(omsGroups.map((g) => [g.id, g.name])), [omsGroups]);
  const omsGroupKeys = useMemo(() => new Set(omsGroups.map((g) => key(g.name))), [omsGroups]);
  const custOptions = useMemo(
    () => [{ value: '', label: '— Skip —' }, ...preview.customers.map((c) => ({ value: String(c.id), label: c.active ? c.name : `${c.name} (inactive)` }))],
    [preview],
  );

  const [pick, setPick] = useState<Map<string, number | null>>(() => new Map(preview.parties.map((p) => [p.tallyName, p.match?.customerId ?? null])));
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [groupOn, setGroupOn] = useState<Set<string>>(() => new Set(preview.groups.filter((g) => g.status !== 'SAME').map((g) => g.name)));
  const [filing, setFiling] = useState<Map<string, Filing>>(() => new Map(preview.others.map((o) => [o.tallyName, o.filed ?? o.proposed])));

  const conflicts = useMemo(() => {
    const byCust = new Map<number, Set<string>>();
    for (const p of preview.parties) {
      const id = pick.get(p.tallyName);
      if (id == null) continue;
      byCust.set(id, (byCust.get(id) ?? new Set()).add(key(p.tallyGroup)));
    }
    return new Set(preview.parties.filter((p) => (byCust.get(pick.get(p.tallyName) ?? -1)?.size ?? 0) > 1).map((p) => p.tallyName));
  }, [preview, pick]);

  const groupReady = (name: string) => omsGroupKeys.has(key(name)) || [...groupOn].some((g) => key(g) === key(name));
  const missingGroup = useMemo(
    () => new Set(preview.parties.filter((p) => pick.get(p.tallyName) != null && !groupReady(p.tallyGroup)).map((p) => p.tallyName)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview, pick, groupOn, omsGroupKeys],
  );

  const needsCheck = (p: TallyImportParty) =>
    conflicts.has(p.tallyName) || missingGroup.has(p.tallyName) || (pick.get(p.tallyName) != null && p.match?.how === 'LOOKS_LIKE' && pick.get(p.tallyName) === p.match.customerId);
  const counts = {
    check: preview.parties.filter(needsCheck).length,
    matched: preview.parties.filter((p) => pick.get(p.tallyName) != null).length,
    missing: preview.parties.filter((p) => pick.get(p.tallyName) == null).length,
  };
  const groupChanges = preview.groups.filter((g) => g.status !== 'SAME');
  const othersToFile = preview.others.filter((o) => (filing.get(o.tallyName) ?? 'SKIP') !== 'SKIP' && filing.get(o.tallyName) !== o.filed);

  const [tab, setTab] = useState<Tab>('parties');
  const [filter, setFilter] = useState<PartyFilter>(counts.check ? 'check' : 'all');
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();

  const partyRows = preview.parties.filter((p) => {
    if (q && !p.tallyName.toLowerCase().includes(q) && !(custName.get(pick.get(p.tallyName) ?? -1) ?? '').toLowerCase().includes(q)) return false;
    if (filter === 'check') return needsCheck(p);
    if (filter === 'matched') return pick.get(p.tallyName) != null;
    if (filter === 'missing') return pick.get(p.tallyName) == null;
    return true;
  });
  const otherRows = preview.others.filter((o) => !q || o.tallyName.toLowerCase().includes(q) || o.tallyGroup.toLowerCase().includes(q));

  const blocked = conflicts.size > 0 || missingGroup.size > 0;
  const partiesToSend = preview.parties.filter((p) => pick.get(p.tallyName) != null);
  const nothing = !partiesToSend.length && !groupOn.size && !othersToFile.length;

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
        others: othersToFile.map((o) => ({ tallyName: o.tallyName, filing: filing.get(o.tallyName) as TallyImportFiling })),
      },
      {
        onSuccess: (r) => {
          toast.success('Tally master uploaded', {
            description: [
              `${r.partiesUpdated} parties updated`,
              r.groupsCreated && `${r.groupsCreated} groups created`,
              r.groupsMoved && `${r.groupsMoved} groups moved`,
              r.linksSaved && `${r.linksSaved} Tally names linked`,
              r.othersFiled && `${r.othersFiled} ledgers filed`,
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
    ['groups', 'Groups', FolderTree, groupChanges.length],
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
                    ['matched', 'Matched', counts.matched, 'emerald'],
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
              {!partyRows.length && <p className="text-muted-foreground py-10 text-center text-[12.5px]">Nothing here.</p>}
              {partyRows.map((p) => {
                const id = pick.get(p.tallyName) ?? null;
                const auto = id != null && id === p.match?.customerId;
                const nowGroup = id != null ? omsGroupName.get(custGroup.get(id) ?? -1) : undefined;
                const same = !!nowGroup && key(nowGroup) === key(p.tallyGroup);
                const bad = conflicts.has(p.tallyName) || missingGroup.has(p.tallyName);
                const showPicker = editing.has(p.tallyName) || id == null;
                return (
                  <div
                    key={p.tallyName}
                    className={cn(
                      'rounded-lg border px-3 py-2',
                      bad ? 'border-rose-300 bg-rose-50/70 dark:border-rose-400/40 dark:bg-rose-400/10' : id == null ? 'bg-muted/30' : 'bg-card',
                    )}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="min-w-0 sm:w-[42%]">
                        <p className="truncate text-[13px] font-bold text-slate-900 dark:text-slate-100" title={p.tallyName}>{p.tallyName}</p>
                        <p className="text-muted-foreground truncate text-[11px] font-medium">Under {p.tallyGroup}</p>
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
                            <span className="truncate text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">{custName.get(id!)}</span>
                          </button>
                        )}
                        {id != null && (
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold',
                              !auto
                                ? 'bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200'
                                : p.match!.how === 'LOOKS_LIKE'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200'
                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200',
                            )}
                          >
                            {auto ? HOW_LABEL[p.match!.how] : 'Your pick'}
                          </span>
                        )}
                      </div>
                    </div>
                    {id == null && p.suggestions.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span className="text-muted-foreground text-[10.5px] font-semibold">Looks like:</span>
                        {p.suggestions.map((s) => (
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
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'groups' && (
            <div className="space-y-1.5">
              {!groupChanges.length && (
                <p className="text-muted-foreground flex items-center justify-center gap-1.5 py-10 text-center text-[12.5px]">
                  <CheckCircle2 className="size-4 text-emerald-600" /> All {preview.groups.length} groups already match OMS.
                </p>
              )}
              {groupChanges.map((g) => (
                <label key={g.name} className="bg-card flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2">
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
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold">{g.name}</p>
                    <p className="text-muted-foreground text-[11px] font-medium">
                      {g.status === 'NEW' ? `New group under ${g.parent ?? 'Primary'}` : `Move: ${g.omsParent ?? 'Primary'} → ${g.parent ?? 'Primary'}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold',
                      g.status === 'NEW' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200',
                    )}
                  >
                    {g.status === 'NEW' ? 'New' : 'Move'}
                  </span>
                </label>
              ))}
            </div>
          )}

          {tab === 'others' && (
            <div className="space-y-1.5">
              {!otherRows.length && <p className="text-muted-foreground py-10 text-center text-[12.5px]">Nothing here.</p>}
              {otherRows.map((o) => {
                const v = filing.get(o.tallyName) ?? 'SKIP';
                return (
                  <div key={o.tallyName} className="bg-card flex flex-col gap-2 rounded-lg border px-3 py-2 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold" title={o.tallyName}>{o.tallyName}</p>
                      <p className="text-muted-foreground truncate text-[11px] font-medium">
                        Under {o.tallyGroup}
                        {o.filed && ` · filed as ${o.filed.toLowerCase()}`}
                        {o.linkedTo != null && ` · linked to ${custName.get(o.linkedTo) ?? 'a party'}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 rounded-[4px] border p-0.5">
                      {FILINGS.map(([f, label]) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setFiling((m) => new Map(m).set(o.tallyName, f))}
                          aria-pressed={v === f}
                          className={cn(
                            'cursor-pointer rounded-[3px] px-2.5 py-0.5 text-[11.5px] font-bold transition-colors',
                            v === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
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
                <b className="text-foreground">{partiesToSend.length}</b> parties · <b className="text-foreground">{groupOn.size}</b> groups ·{' '}
                <b className="text-foreground">{othersToFile.length}</b> ledgers to file
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
