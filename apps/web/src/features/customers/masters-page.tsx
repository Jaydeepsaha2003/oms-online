import { useMemo, useState } from 'react';
import { ArrowRightLeft, FolderTree, Loader2, Lock, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  GROUP_ALLOC_LABELS,
  GROUP_ALLOC_METHODS,
  type AccountGroupDto,
  type AccountGroupInput,
  type GroupAllocMethod,
  type GroupLedgerDto,
} from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { useConfirm } from '@/components/common/confirm';
import { NativeSelect } from '@/components/common/combo';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAccountGroups, useDeleteAccountGroup, useGroupLedgers, useMoveLedgers, useSaveAccountGroup } from './use-account-groups';

const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON = 'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';
const TABLE = [
  'font-sans text-[13px]',
  '[&_thead_th]:text-[13.5px] [&_thead_th]:font-extrabold [&_thead_th]:uppercase [&_thead_th]:tracking-wide [&_thead_th]:py-1.5',
  '[&_td]:py-1 [&_td]:px-3 [&_th]:px-3',
  '[&_tbody_tr]:border-b [&_tbody_tr]:border-slate-200 dark:[&_tbody_tr]:border-white/10',
  '[&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0',
  '[&_tbody_tr:nth-child(even)_td]:bg-slate-100/80 dark:[&_tbody_tr:nth-child(even)_td]:bg-white/[0.04]',
  '[&_tbody_tr:hover:hover_td]:bg-amber-100/70 dark:[&_tbody_tr:hover:hover_td]:bg-amber-400/10',
].join(' ');
const PRIMARY = '';

type Tab = 'group' | 'ledger';

function YesNo({ on }: { on: boolean }) {
  return (
    <span className={cn('text-[12px] font-bold', on ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
      {on ? 'Yes' : 'No'}
    </span>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      className="size-4 cursor-pointer accent-indigo-600"
    />
  );
}

export function MastersPage() {
  const [tab, setTab] = useState<Tab>('group');
  const { data: groups = [], isLoading } = useAccountGroups();

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain p-2.5 font-sans sm:gap-2.5 sm:overflow-visible sm:p-3">
      <div className="bg-card font-poppins flex items-center gap-1 self-start rounded-[4px] border p-1 shadow-sm">
        {(
          [
            ['group', 'Group', FolderTree],
            ['ledger', 'Ledger', Users],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={cn(
              'flex cursor-pointer items-center gap-1.5 rounded-[3px] px-4 py-1.5 text-[13px] font-bold transition-colors',
              tab === key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      {tab === 'group' ? <GroupTab groups={groups} isLoading={isLoading} /> : <LedgerTab groups={groups} />}
    </div>
  );
}

/* ── Group ──────────────────────────────────────────────────────────────── */

function GroupTab({ groups, isLoading }: { groups: AccountGroupDto[]; isLoading: boolean }) {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const del = useDeleteAccountGroup();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AccountGroupDto | 'new' | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? groups.filter((g) => g.name.toLowerCase().includes(q) || (g.alias ?? '').toLowerCase().includes(q)) : groups;
  }, [groups, search]);

  const onDelete = async (g: AccountGroupDto) => {
    const ok = await confirm({ title: 'Delete group?', description: `"${g.name}" will be removed.`, confirmText: 'Delete', destructive: true });
    if (!ok) return;
    del.mutate(g.id, {
      onSuccess: () => toast.success('Group deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  const columns: DataColumn<AccountGroupDto>[] = [
    {
      id: 'name',
      label: 'Name of group',
      pin: 'left0',
      fixed: true,
      cell: (g) => (
        <span className={cn(TEXT_CELL, 'inline-flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300')}>
          {g.name}
          {g.isSystem && <Lock className="text-muted-foreground size-3" aria-label="Tally group" />}
        </span>
      ),
    },
    { id: 'under', label: 'Under', cell: (g) => <span className={TEXT_CELL}>{g.parentName ?? <em className="text-muted-foreground font-medium not-italic">Primary</em>}</span> },
    { id: 'sub', label: 'Sub-ledger', cell: (g) => <YesNo on={g.isSubLedger} /> },
    { id: 'nett', label: 'Nett Dr/Cr', cell: (g) => <YesNo on={g.nettBalances} /> },
    { id: 'calc', label: 'Used for calc', cell: (g) => <YesNo on={g.usedForCalc} /> },
    { id: 'ledgers', label: 'Ledgers', align: 'right', cell: (g) => <span className={cn(TEXT_CELL, 'tabular-nums', !g.ledgerCount && 'text-muted-foreground/50')}>{g.ledgerCount}</span> },
  ];

  const actions = (g: AccountGroupDto) => (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {can('customer:update') && (
        <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(g)} aria-label="Edit">
          <Pencil className="size-4" />
        </Button>
      )}
      {can('customer:delete') && !g.isSystem && (
        <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => onDelete(g)} aria-label="Delete">
          <Trash2 className="size-4" />
        </Button>
      )}
    </div>
  );

  return (
    <>
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <div className="relative w-full sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input placeholder="Search group…" className={cn(CONTROL, 'pl-8 font-medium', search && CONTROL_ON)} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <p className="text-muted-foreground shrink-0 text-[12px] font-medium tabular-nums">
            <span className="text-foreground font-bold">{rows.length}</span> group{rows.length === 1 ? '' : 's'}
          </p>
          {can('customer:create') && (
            <Button size="sm" className="ml-auto h-9 rounded-[4px] text-[12.5px] font-bold" onClick={() => setEditing('new')}>
              <Plus /> New group
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:min-h-0 sm:flex-1">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(g) => g.id}
          isLoading={isLoading}
          dense
          fill
          hideSortIcon
          emptyText="No groups."
          onRowClick={(g) => can('customer:update') && setEditing(g)}
          className={TABLE}
          actions={actions}
          mobileCard={(g) => (
            <div className="space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-[14px] leading-tight font-bold text-slate-900 dark:text-slate-100">{g.name}</p>
                <span className="text-muted-foreground shrink-0 text-[11px] font-semibold tabular-nums">{g.ledgerCount} ledger{g.ledgerCount === 1 ? '' : 's'}</span>
              </div>
              <p className="text-muted-foreground text-[12px] font-medium">Under {g.parentName ?? 'Primary'}</p>
              <div className="flex items-center justify-between border-t pt-1.5 text-[11.5px]">
                <span className="text-muted-foreground">
                  Sub-ledger <YesNo on={g.isSubLedger} /> · Nett <YesNo on={g.nettBalances} />
                </span>
                {actions(g)}
              </div>
            </div>
          )}
        />
      </div>

      {editing && <GroupDialog group={editing === 'new' ? null : editing} groups={groups} onClose={() => setEditing(null)} />}
    </>
  );
}

function YesNoField({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold">{label}</p>
        {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
      </div>
      <div className="flex shrink-0 rounded-[4px] border p-0.5">
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={cn(
              'cursor-pointer rounded-[3px] px-3 py-0.5 text-[12px] font-bold transition-colors',
              value === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {v ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    </div>
  );
}

function GroupDialog({ group, groups, onClose }: { group: AccountGroupDto | null; groups: AccountGroupDto[]; onClose: () => void }) {
  const save = useSaveAccountGroup();
  const [form, setForm] = useState<Required<AccountGroupInput>>({
    name: group?.name ?? '',
    alias: group?.alias ?? '',
    parentId: group?.parentId ?? null,
    isSubLedger: group?.isSubLedger ?? false,
    nettBalances: group?.nettBalances ?? false,
    usedForCalc: group?.usedForCalc ?? false,
    allocMethod: group?.allocMethod ?? 'NOT_APPLICABLE',
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Primary + every group except this one and its own sub-groups.
  const underOptions = useMemo(() => {
    const blocked = new Set<number>();
    if (group) {
      blocked.add(group.id);
      let grew = true;
      while (grew) {
        grew = false;
        for (const g of groups) if (g.parentId != null && blocked.has(g.parentId) && !blocked.has(g.id)) (blocked.add(g.id), (grew = true));
      }
    }
    return [{ value: PRIMARY, label: 'Primary' }, ...groups.filter((g) => !blocked.has(g.id)).map((g) => ({ value: String(g.id), label: g.name }))];
  }, [group, groups]);

  const submit = () => {
    if (!form.name.trim()) return toast.error('Name is required');
    save.mutate(
      { id: group?.id, input: { ...form, name: form.name.trim(), alias: form.alias?.trim() || null } },
      {
        onSuccess: () => {
          toast.success(group ? 'Group updated' : 'Group created');
          onClose();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
      },
    );
  };
  useSaveShortcut(submit);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{group ? 'Group Alteration' : 'Group Creation'}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>(alias)</Label>
              <Input value={form.alias ?? ''} onChange={(e) => set('alias', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Under</Label>
            <NativeSelect
              value={form.parentId == null ? PRIMARY : String(form.parentId)}
              onChange={(v) => set('parentId', v ? Number(v) : null)}
              options={underOptions}
            />
          </div>
          <div className="divide-y rounded-[4px] border px-3">
            <YesNoField label="Group behaves like a sub-ledger" value={form.isSubLedger} onChange={(v) => set('isSubLedger', v)} />
            <YesNoField label="Nett Debit/Credit Balances for Reporting" value={form.nettBalances} onChange={(v) => set('nettBalances', v)} />
            <YesNoField
              label="Used for calculation"
              hint="For example: taxes, discounts (for sales invoice entries)"
              value={form.usedForCalc}
              onChange={(v) => set('usedForCalc', v)}
            />
            <div className="flex items-center justify-between gap-3 py-1.5">
              <p className="text-[12.5px] font-semibold">Method to allocate when used in purchase invoice</p>
              <div className="w-44 shrink-0">
                <NativeSelect
                  value={form.allocMethod}
                  onChange={(v) => set('allocMethod', (v || 'NOT_APPLICABLE') as GroupAllocMethod)}
                  options={GROUP_ALLOC_METHODS.map((m) => ({ value: m, label: GROUP_ALLOC_LABELS[m] }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {group ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Ledger ─────────────────────────────────────────────────────────────── */

function LedgerTab({ groups }: { groups: AccountGroupDto[] }) {
  const { can } = usePermissions();
  const canMove = can('customer:update');
  const { data: ledgers = [], isLoading } = useGroupLedgers();
  const move = useMoveLedgers();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState('');

  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const groupOptions = useMemo(() => groups.map((g) => ({ value: String(g.id), label: g.name })), [groups]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ledgers.filter(
      (l) => (!q || l.partyName.toLowerCase().includes(q)) && (!filter || String(l.groupId ?? '') === filter),
    );
  }, [ledgers, search, filter]);

  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const toggle = (id: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const doMove = (customerIds: number[], groupId: number) =>
    move.mutate(
      { customerIds, groupId },
      {
        onSuccess: (r) => {
          toast.success(`${r.updated} ledger${r.updated === 1 ? '' : 's'} moved to ${groupName.get(groupId)}`);
          setPicked(new Set());
          setTarget('');
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Move failed')),
      },
    );

  const underCell = (l: GroupLedgerDto) =>
    canMove ? (
      <div className="w-52" onClick={(e) => e.stopPropagation()}>
        <NativeSelect
          value={l.groupId != null ? String(l.groupId) : ''}
          onChange={(v) => v && Number(v) !== l.groupId && doMove([l.id], Number(v))}
          options={groupOptions}
          className="h-7 text-[12.5px]"
        />
      </div>
    ) : (
      <span className={TEXT_CELL}>{(l.groupId != null && groupName.get(l.groupId)) || '—'}</span>
    );

  const columns: DataColumn<GroupLedgerDto>[] = [
    ...(canMove
      ? [
          {
            id: 'pick',
            label: 'Select',
            header: <Check checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)))} label="Select all" />,
            noSort: true,
            fixed: true,
            cell: (l: GroupLedgerDto) => <Check checked={picked.has(l.id)} onChange={() => toggle(l.id)} label={`Select ${l.partyName}`} />,
          },
        ]
      : []),
    {
      id: 'name',
      label: 'Name of ledger',
      fixed: true,
      cell: (l) => (
        <span className={cn(TEXT_CELL, 'text-indigo-700 dark:text-indigo-300', !l.active && 'opacity-60')}>
          {l.partyName}
          {!l.active && <span className="text-muted-foreground ml-1.5 text-[10.5px] font-bold uppercase">inactive</span>}
        </span>
      ),
    },
    { id: 'category', label: 'Category', cell: (l) => <span className={TEXT_CELL}>{l.category || '—'}</span> },
    { id: 'under', label: 'Under', noSort: true, cell: underCell },
  ];

  return (
    <>
      <div className="bg-card font-poppins rounded-[4px] border shadow-sm">
        <div className="grid grid-cols-2 items-center gap-2 p-2.5 sm:flex sm:flex-wrap sm:gap-2.5 sm:p-3">
          <div className="relative col-span-2 sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input placeholder="Search ledger…" className={cn(CONTROL, 'pl-8 font-medium', search && CONTROL_ON)} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="col-span-2 sm:w-52">
            <NativeSelect
              value={filter}
              onChange={setFilter}
              options={[{ value: '', label: 'All groups' }, ...groupOptions]}
              placeholder="Under — all groups"
              className={cn(CONTROL, filter && CONTROL_ON)}
            />
          </div>
          <p className="text-muted-foreground shrink-0 text-[12px] font-medium tabular-nums">
            <span className="text-foreground font-bold">{rows.length}</span> ledger{rows.length === 1 ? '' : 's'}
            {isLoading && <Loader2 className="ml-1 inline size-3 animate-spin align-[-2px]" />}
          </p>
          {canMove && picked.size > 0 && (
            <div className="col-span-2 flex flex-wrap items-center gap-2 rounded-[4px] bg-indigo-50 px-2 py-1.5 ring-1 ring-indigo-200 ring-inset sm:ml-auto dark:bg-indigo-400/10 dark:ring-indigo-400/25">
              <span className="text-[12px] font-bold text-indigo-800 dark:text-indigo-200">{picked.size} selected</span>
              <div className="w-48">
                <NativeSelect value={target} onChange={setTarget} options={groupOptions} placeholder="Move under…" className="h-8 text-[12.5px]" />
              </div>
              <Button size="sm" className="h-8 rounded-[4px] text-[12px] font-bold" disabled={!target || move.isPending} onClick={() => doMove([...picked], Number(target))}>
                {move.isPending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft className="size-3.5" />} Move
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:min-h-0 sm:flex-1">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(l) => l.id}
          isLoading={isLoading}
          dense
          fill
          hideSortIcon
          emptyText="No ledgers."
          onRowClick={canMove ? (l) => toggle(l.id) : undefined}
          className={TABLE}
          mobileCard={(l) => (
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                {canMove && <Check checked={picked.has(l.id)} onChange={() => toggle(l.id)} label={`Select ${l.partyName}`} />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] leading-tight font-bold text-slate-900 dark:text-slate-100">{l.partyName}</p>
                  <p className="text-muted-foreground text-[11.5px] font-medium">{l.category || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 border-t pt-2">
                <span className="text-muted-foreground text-[9px] font-bold tracking-widest uppercase">Under</span>
                <div className="min-w-0 flex-1">{underCell(l)}</div>
              </div>
            </div>
          )}
        />
      </div>
    </>
  );
}
