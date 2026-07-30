import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Pencil, Plus, Search, Shield, ShieldAlert, ShieldCheck, Tag, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  OPERATORS_FOR_TYPE,
  PARTY_METRIC_META,
  type PartyClassRow,
  type PartyCondition,
  type PartyListDef,
  type PartyListKind,
  type PartyListOperator,
  type PartyMetricKey,
  type PartyMetricType,
} from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { inrCompact, inrFull } from '@/features/dashboard/format';
import { NativeSelect } from '@/components/common/combo';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePartyListsConfig, usePartyListsEvaluate, useSavePartyListsConfig } from './use-party-lists';
import { initials } from './crm-shared';

const META_BY_KEY = new Map(PARTY_METRIC_META.map((m) => [m.key, m]));
const typeOf = (k: PartyMetricKey): PartyMetricType => META_BY_KEY.get(k)?.type ?? 'number';
const OP_LABEL: Record<PartyListOperator, string> = {
  '>=': '≥', '<=': '≤', '>': '>', '<': '<', '==': 'is', '!=': 'is not', contains: 'contains', notContains: "doesn't contain",
};

/** Palette for a list badge/card by kind. */
function kindStyle(l: Pick<PartyListDef, 'kind' | 'color'>) {
  if (l.kind === 'GREEN') return { chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', dot: 'bg-emerald-500', bar: 'from-emerald-500 to-green-600', icon: <ShieldCheck className="size-4" /> };
  if (l.kind === 'BLACK') return { chip: 'bg-slate-800 text-white ring-slate-900/30', dot: 'bg-slate-800', bar: 'from-slate-700 to-slate-900', icon: <ShieldAlert className="size-4" /> };
  return { chip: 'bg-violet-50 text-violet-700 ring-violet-600/20', dot: 'bg-violet-500', bar: 'from-violet-500 to-purple-600', icon: <Shield className="size-4" /> };
}

const fmtMetric = (k: PartyMetricKey, v: number | string | boolean | null): string => {
  if (v == null) return '—';
  const t = typeOf(k);
  if (t === 'money') return inrCompact(Number(v));
  if (t === 'percent') return `${v}%`;
  if (t === 'days') return `${v}d`;
  if (t === 'bool') return v ? 'Yes' : 'No';
  return String(v);
};

export function PartyListsPage() {
  const { can } = usePermissions();
  const canEdit = can('crm:update');
  const { data: evalData, isLoading } = usePartyListsEvaluate();
  const lists = evalData?.lists ?? [];
  const parties = evalData?.parties ?? [];

  const [tab, setTab] = useState<string>('all'); // 'all' | 'unclassified' | listId
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PartyListDef | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);

  const counts = useMemo(() => {
    const m = new Map<string, { members: number; outstanding: number }>();
    for (const l of lists) m.set(l.id, { members: 0, outstanding: 0 });
    let unclassified = 0;
    for (const p of parties) {
      if (p.matched.length === 0) unclassified += 1;
      for (const id of p.matched) { const c = m.get(id); if (c) { c.members += 1; c.outstanding += p.metrics.outstanding; } }
    }
    return { m, unclassified };
  }, [lists, parties]);

  const filtered = useMemo(() => {
    let rows = parties;
    if (tab === 'unclassified') rows = rows.filter((p) => p.matched.length === 0);
    else if (tab !== 'all') rows = rows.filter((p) => p.matched.includes(tab));
    const s = search.trim().toLowerCase();
    if (s) rows = rows.filter((p) => p.party.toLowerCase().includes(s) || (p.metrics.agent ?? '').toLowerCase().includes(s));
    return rows;
  }, [parties, tab, search]);

  const openNew = () => { setEditing(null); setBuilderOpen(true); };
  const openEdit = (l: PartyListDef) => { setEditing(l); setBuilderOpen(true); };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <Tag className="size-5" />
        </div>
        <div className="mr-auto">
          <h2 className="text-2xl font-semibold tracking-tight">Party Lists</h2>
          <p className="text-muted-foreground text-sm">Green-list your best payers, black-list the risky ones — using your own conditions.</p>
        </div>
        {canEdit && <Button onClick={openNew}><Plus /> New list</Button>}
      </div>

      {/* List cards */}
      {isLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm"><Loader2 className="size-4 animate-spin" /> Evaluating parties…</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lists.map((l) => {
              const st = kindStyle(l);
              const c = counts.m.get(l.id);
              return (
                <div key={l.id} className={cn('bg-card overflow-hidden rounded-xl border shadow-sm transition-all', tab === l.id && 'ring-primary ring-2')}>
                  <div className={cn('h-1.5 bg-gradient-to-r', st.bar)} />
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', st.chip)}>{st.icon}</span>
                      <button type="button" onClick={() => setTab(tab === l.id ? 'all' : l.id)} className="min-w-0 flex-1 text-left">
                        <div className="flex items-center gap-1.5 truncate font-semibold">{l.name}{!l.enabled && <span className="text-muted-foreground text-xs font-normal">(off)</span>}</div>
                        {l.description && <div className="text-muted-foreground truncate text-xs">{l.description}</div>}
                      </button>
                      {canEdit && (
                        <button type="button" onClick={() => openEdit(l)} className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1" aria-label="Edit list"><Pencil className="size-3.5" /></button>
                      )}
                    </div>
                    <div className="mt-2.5 flex items-end justify-between">
                      <div>
                        <div className="text-2xl font-bold tabular-nums leading-none">{c?.members ?? 0}</div>
                        <div className="text-muted-foreground text-xs">parties</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold tabular-nums" title={inrFull(c?.outstanding ?? 0)}>{inrCompact(c?.outstanding ?? 0)}</div>
                        <div className="text-muted-foreground text-xs">outstanding</div>
                      </div>
                    </div>
                    <div className="text-muted-foreground mt-2 border-t pt-2 text-[11px]">
                      Matches <strong>{l.match === 'ALL' ? 'ALL' : 'ANY'}</strong> of {l.conditions.length} condition{l.conditions.length === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Party table with filter tabs */}
          <div className="bg-card overflow-hidden rounded-xl border shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b bg-gradient-to-r from-slate-50 to-transparent px-3 py-2.5">
              <div className="flex flex-wrap gap-1">
                <TabBtn active={tab === 'all'} onClick={() => setTab('all')}>All · {parties.length}</TabBtn>
                {lists.map((l) => <TabBtn key={l.id} active={tab === l.id} onClick={() => setTab(l.id)} dot={kindStyle(l).dot}>{l.name.split('—')[0].trim()} · {counts.m.get(l.id)?.members ?? 0}</TabBtn>)}
                <TabBtn active={tab === 'unclassified'} onClick={() => setTab('unclassified')}>Unlisted · {counts.unclassified}</TabBtn>
              </div>
              <div className="relative ml-auto w-full sm:w-56">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input placeholder="Search party or agent…" className="h-9 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <PartyTable rows={filtered} lists={lists} />
          </div>
        </>
      )}

      {builderOpen && <ListBuilder lists={lists} editing={editing} onClose={() => setBuilderOpen(false)} />}
    </div>
  );
}

function TabBtn({ active, onClick, children, dot }: { active: boolean; onClick: () => void; children: React.ReactNode; dot?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors', active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-slate-100')}>
      {dot && <span className={cn('size-2 rounded-full', dot)} />}{children}
    </button>
  );
}

/* ── Party table ─────────────────────────────────────────────────────────────── */

const TABLE_METRICS: PartyMetricKey[] = ['outstanding', 'overdue', 'oldestOverdueDays', 'lifetimeRevenue', 'collectionRate', 'avgPaymentDays', 'brokenPromises'];

function PartyTable({ rows, lists }: { rows: PartyClassRow[]; lists: PartyListDef[] }) {
  const listById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
  if (rows.length === 0) return <div className="text-muted-foreground py-12 text-center text-sm">No parties here.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs uppercase tracking-wide">
            <th className="py-2 pl-3 pr-3 font-semibold">Party</th>
            <th className="py-2 pr-3 font-semibold">Lists</th>
            {TABLE_METRICS.map((k) => <th key={k} className="py-2 pr-3 text-right font-semibold">{META_BY_KEY.get(k)?.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.party} className="border-b last:border-0 hover:bg-slate-50/60">
              <td className="py-2 pl-3 pr-3">
                <div className="flex items-center gap-2">
                  <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">{initials(p.party)}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.party}</span>
                    <span className="text-muted-foreground block truncate text-xs">{p.metrics.agent || 'No agent'}{p.metrics.region ? ` · ${p.metrics.region}` : ''}</span>
                  </span>
                </div>
              </td>
              <td className="py-2 pr-3">
                <div className="flex flex-wrap gap-1">
                  {p.matched.length === 0 && <span className="text-muted-foreground text-xs">—</span>}
                  {p.matched.map((id) => {
                    const l = listById.get(id);
                    if (!l) return null;
                    const st = kindStyle(l);
                    return <span key={id} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', st.chip)}><span className={cn('size-1.5 rounded-full', l.kind === 'BLACK' ? 'bg-white' : st.dot)} />{l.name.split('—')[0].trim()}</span>;
                  })}
                </div>
              </td>
              {TABLE_METRICS.map((k) => {
                const v = (p.metrics as unknown as Record<string, number | null>)[k];
                const danger = (k === 'overdue' && Number(v) > 0) || (k === 'brokenPromises' && Number(v) > 0) || (k === 'oldestOverdueDays' && Number(v) >= 60);
                return <td key={k} className={cn('py-2 pr-3 text-right tabular-nums', danger && 'text-rose-600 font-semibold')} title={typeOf(k) === 'money' && v != null ? inrFull(Number(v)) : undefined}>{fmtMetric(k, v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── List builder dialog ─────────────────────────────────────────────────────── */

const newCondition = (): PartyCondition => ({ field: 'outstanding', op: '>=', value: 0 });

function ListBuilder({ lists, editing, onClose }: { lists: PartyListDef[]; editing: PartyListDef | null; onClose: () => void }) {
  const save = useSavePartyListsConfig();
  const confirm = useConfirm();
  const [name, setName] = useState(editing?.name ?? '');
  const [kind, setKind] = useState<PartyListKind>(editing?.kind ?? 'GREEN');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [match, setMatch] = useState<'ALL' | 'ANY'>(editing?.match ?? 'ALL');
  const [enabled, setEnabled] = useState(editing?.enabled !== false);
  const [conditions, setConditions] = useState<PartyCondition[]>(editing?.conditions?.length ? editing.conditions.map((c) => ({ ...c })) : [newCondition()]);

  const patchCond = (i: number, p: Partial<PartyCondition>) => setConditions((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const setField = (i: number, field: PartyMetricKey) => {
    const ops = OPERATORS_FOR_TYPE[typeOf(field)];
    const t = typeOf(field);
    patchCond(i, { field, op: ops[0], value: t === 'text' ? '' : t === 'bool' ? 'true' : 0 });
  };

  const persist = (nextLists: PartyListDef[]) =>
    save.mutate({ lists: nextLists }, { onSuccess: () => { toast.success('Saved'); onClose(); }, onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) });

  const submit = () => {
    if (!name.trim()) return toast.error('Give the list a name.');
    if (conditions.length === 0) return toast.error('Add at least one condition.');
    const def: PartyListDef = {
      id: editing?.id ?? `list-${Math.random().toString(36).slice(2, 9)}`,
      name: name.trim(), kind, color: null, description: description.trim() || null, match, enabled,
      conditions: conditions.map((c) => ({ field: c.field, op: c.op, value: typeOf(c.field) === 'text' || typeOf(c.field) === 'bool' ? String(c.value) : Number(c.value) })),
    };
    const next = editing ? lists.map((l) => (l.id === editing.id ? def : l)) : [...lists, def];
    persist(next);
  };

  const remove = async () => {
    if (!editing) return;
    if (!(await confirm({ title: 'Delete this list?', description: `“${editing.name}” will be removed. Parties are re-evaluated instantly.`, confirmText: 'Delete', destructive: true }))) return;
    persist(lists.filter((l) => l.id !== editing.id));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit list' : 'New party list'}</DialogTitle>
          <DialogDescription>Name it, pick a type, then add the conditions a party must meet.</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 max-h-[68vh] space-y-4 overflow-y-auto px-1 pb-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">List name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Green — Trusted payers" autoFocus />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['GREEN', 'BLACK', 'CUSTOM'] as PartyListKind[]).map((k) => {
                  const st = kindStyle({ kind: k, color: null });
                  return (
                    <button key={k} type="button" onClick={() => setKind(k)} className={cn('inline-flex h-9 items-center justify-center gap-1 rounded-lg border text-xs font-semibold capitalize transition-colors', kind === k ? cn(st.chip, 'ring-2') : 'bg-white text-slate-600 hover:bg-slate-50')}>
                      {st.icon} {k.toLowerCase()}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this list is for…" />
          </div>

          <div className="rounded-xl border bg-slate-50/60 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-semibold">Conditions</span>
              <div className="ml-1 flex rounded-lg border bg-white p-0.5 text-xs">
                {(['ALL', 'ANY'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMatch(m)} className={cn('rounded-md px-2 py-0.5 font-semibold transition-colors', match === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
                    Match {m}
                  </button>
                ))}
              </div>
              <span className="text-muted-foreground text-xs">{match === 'ALL' ? 'every condition must hold' : 'any one condition is enough'}</span>
            </div>

            <div className="space-y-2">
              {conditions.map((c, i) => {
                const t = typeOf(c.field);
                const ops = OPERATORS_FOR_TYPE[t];
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-2">
                    <span className="text-muted-foreground w-6 text-center text-xs font-semibold">{i === 0 ? 'IF' : match === 'ALL' ? 'AND' : 'OR'}</span>
                    <div className="min-w-[10rem] flex-1">
                      <NativeSelect
                        value={c.field}
                        onChange={(v) => setField(i, v as PartyMetricKey)}
                        options={PARTY_METRIC_META.map((m) => m.key)}
                        renderOption={(v) => <span>{META_BY_KEY.get(v as PartyMetricKey)?.label ?? v}</span>}
                      />
                    </div>
                    <div className="w-28">
                      <NativeSelect value={c.op} onChange={(v) => patchCond(i, { op: v as PartyListOperator })} options={ops} renderOption={(v) => <span>{OP_LABEL[v as PartyListOperator]}</span>} />
                    </div>
                    <div className="w-32">
                      {t === 'bool' ? (
                        <NativeSelect value={String(c.value)} onChange={(v) => patchCond(i, { value: v })} options={['true', 'false']} renderOption={(v) => <span>{v === 'true' ? 'Yes' : 'No'}</span>} />
                      ) : t === 'text' ? (
                        <Input value={String(c.value)} onChange={(e) => patchCond(i, { value: e.target.value })} placeholder="value" />
                      ) : (
                        <Input type="number" inputMode="decimal" className="tabular-nums" value={String(c.value)} onChange={(e) => patchCond(i, { value: e.target.value })} placeholder="0" />
                      )}
                    </div>
                    <button type="button" onClick={() => setConditions((cs) => cs.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive rounded p-1" aria-label="Remove"><X className="size-4" /></button>
                  </div>
                );
              })}
            </div>
            <Button type="button" variant="outline" className="mt-2 w-full gap-1.5 border-dashed" onClick={() => setConditions((cs) => [...cs, newCondition()])}><Plus className="size-4" /> Add condition</Button>
            <p className="text-muted-foreground mt-2 text-[11px]">{META_BY_KEY.get(conditions[conditions.length - 1]?.field)?.hint}</p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 rounded border-slate-300" />
            <CheckCircle2 className={cn('size-4', enabled ? 'text-emerald-500' : 'text-slate-300')} /> List is active (evaluated live)
          </label>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {editing ? <Button variant="ghost" className="text-destructive" onClick={remove}><Trash2 className="size-4" /> Delete</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Save list</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PartyListsPage;
