import { Fragment, useMemo, useState } from 'react';
import { Loader2, Lock, Pencil, Plus, Shield, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ACTIONS, perm, RESOURCE_DEFINITIONS, type Action, type ResourceDef, type RoleDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCreateRole, useDeleteRole, useRoles, useUpdateRole } from './use-admin';

// All concrete permission keys (used by "Select all").
const ALL_KEYS = RESOURCE_DEFINITIONS.flatMap((d) => d.actions.map((a) => perm(d.resource, a)));
// Every action, as a fixed column order for the permission matrix — a resource
// that doesn't use a given action just shows a blank cell in that column, so
// every row lines up under the same headings.
const ALL_ACTIONS: Action[] = Object.values(ACTIONS);
const ACTION_LABEL: Record<string, string> = { [ACTIONS.MANAGE]: 'manage (full)', [ACTIONS.VIEWRATES]: 'view rates' };
const actionLabel = (a: Action) => ACTION_LABEL[a] ?? a;
// Resource definitions grouped by their heading, in declared order.
const GROUPS: [string, ResourceDef[]][] = (() => {
  const m = new Map<string, ResourceDef[]>();
  for (const d of RESOURCE_DEFINITIONS) {
    const g = m.get(d.group) ?? [];
    g.push(d);
    m.set(d.group, g);
  }
  return [...m.entries()];
})();

const COLUMNS: DataColumn<RoleDto>[] = [
  {
    id: 'label',
    label: 'Role',
    pin: 'left0',
    fixed: true,
    cell: (r) => (
      <span className="flex items-center gap-2 font-medium">
        {r.label}
        {r.isSystem && <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium"><Lock className="size-2.5" /> system</span>}
      </span>
    ),
  },
  { id: 'name', label: 'Machine name', cell: (r) => <span className="text-muted-foreground font-mono text-xs">{r.name}</span> },
  { id: 'description', label: 'Description', cell: (r) => <span className="text-muted-foreground">{r.description || '—'}</span> },
  {
    id: 'perms',
    label: 'Permissions',
    align: 'right',
    cell: (r) => <span className="tabular-nums">{r.permissions.includes('*') ? 'All' : r.permissions.length}</span>,
  },
  { id: 'users', label: 'Users', align: 'right', cell: (r) => <span className="tabular-nums">{r.userCount ?? 0}</span> },
];

export function RolesPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const { data: roles, isLoading } = useRoles();
  const del = useDeleteRole();
  const [editing, setEditing] = useState<RoleDto | null>(null);
  const [creating, setCreating] = useState(false);

  // Phones: one card per role (mirrors the rest of the app's mobile lists).
  const roleMobileCard = (r: RoleDto) => (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 font-medium">
            <span className="truncate">{r.label}</span>
            {r.isSystem && (
              <span className="bg-muted text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
                <Lock className="size-2.5" /> system
              </span>
            )}
          </p>
          <p className="text-muted-foreground truncate font-mono text-xs">{r.name}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {can('role:update') && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(r);
              }}
              aria-label="Edit"
            >
              <Pencil className="size-4" />
            </Button>
          )}
          {can('role:delete') && !r.isSystem && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(r);
              }}
              aria-label="Delete"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>
      {r.description && <p className="text-muted-foreground truncate text-xs">{r.description}</p>}
      <div className="flex items-center gap-3 text-xs">
        <span className="text-muted-foreground">
          Permissions <span className="text-foreground font-semibold tabular-nums">{r.permissions.includes('*') ? 'All' : r.permissions.length}</span>
        </span>
        <span className="text-muted-foreground">
          Users <span className="text-foreground font-semibold tabular-nums">{r.userCount ?? 0}</span>
        </span>
      </div>
    </div>
  );

  const handleDelete = async (r: RoleDto) => {
    const ok = await confirm({
      title: 'Delete role?',
      description: `"${r.label}" will be removed. Users keep their other roles.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(r.id, {
      onSuccess: () => toast.success('Role deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Roles &amp; Permissions</h2>
          <p className="text-muted-foreground text-sm">{roles?.length ?? 0} roles · define what each role can access</p>
        </div>
        {can('role:create') && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Shield /> New role
          </Button>
        )}
      </div>

      <DataTable
        columns={COLUMNS}
        rows={roles ?? []}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        emptyText="No roles yet."
        onRowClick={(r) => can('role:update') && setEditing(r)}
        mobileCard={roleMobileCard}
        actions={(r) => (
          <div className="flex justify-end gap-1">
            {can('role:update') && (
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(r)} aria-label="Edit" title="Edit">
                <Pencil className="size-4" />
              </Button>
            )}
            {can('role:delete') && !r.isSystem && (
              <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => handleDelete(r)} aria-label="Delete" title="Delete">
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        )}
      />

      {(creating || editing) && (
        <RoleDialog
          role={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function RoleDialog({ role, onClose }: { role: RoleDto | null; onClose: () => void }) {
  const isEdit = !!role;
  const isWildcard = !!role?.permissions.includes('*'); // super admin — locked
  const create = useCreateRole();
  const update = useUpdateRole(role?.id ?? '');
  const saving = create.isPending || update.isPending;

  const [name, setName] = useState(role?.name ?? '');
  const [label, setLabel] = useState(role?.label ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []));

  const has = (key: string) => isWildcard || perms.has(key);
  const toggle = (key: string) => {
    if (isWildcard) return;
    setPerms((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  const selectedCount = isWildcard ? ALL_KEYS.length : perms.size;

  // Resources that actually use a given action — a column with nothing to
  // toggle (no resource in the whole catalog uses that action) is skipped.
  const rowsForAction = (a: Action) => RESOURCE_DEFINITIONS.filter((d) => d.actions.includes(a));
  const columnAllOn = (a: Action) => rowsForAction(a).every((d) => has(perm(d.resource, a)));
  const columnAnyOn = (a: Action) => rowsForAction(a).some((d) => has(perm(d.resource, a)));
  const toggleColumn = (a: Action) => {
    if (isWildcard) return;
    const rows = rowsForAction(a);
    const turnOn = !rows.every((d) => has(perm(d.resource, a)));
    setPerms((prev) => {
      const next = new Set(prev);
      rows.forEach((d) => {
        const key = perm(d.resource, a);
        if (turnOn) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  };

  const submit = () => {
    if (!label.trim()) return toast.error('Label is required');
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'Role updated' : 'Role created');
        onClose();
      },
      onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed')),
    };
    if (isEdit) {
      update.mutate({ label: label.trim(), description: description.trim() || undefined, permissions: isWildcard ? role!.permissions : [...perms] }, opts);
    } else {
      if (!/^[a-z][a-z0-9_]*$/.test(name.trim())) return toast.error('Machine name: lowercase letters, digits and _ only (must start with a letter)');
      if (perms.size === 0) return toast.error('Grant at least one permission');
      create.mutate({ name: name.trim(), label: label.trim(), description: description.trim() || undefined, permissions: [...perms] }, opts);
    }
  };

  useSaveShortcut(submit);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit role — ${role!.label}` : 'New role'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 overflow-y-auto pr-1 sm:gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Machine name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                disabled={isEdit}
                placeholder="e.g. warehouse_lead"
                className="font-mono"
              />
              {isEdit && <p className="text-muted-foreground text-xs">The machine name can't be changed.</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Display label *</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Warehouse Lead" autoFocus />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={description ?? ''} onChange={(e) => setDescription(e.target.value)} placeholder="What this role is for…" />
          </div>

          <div className="space-y-2">
            {/* Phones: the count wraps to its own row above Select all/Clear instead
                of the two sharing one row with no guaranteed gap between them. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Label className="text-sm">Permissions <span className="text-muted-foreground font-normal">({selectedCount} selected)</span></Label>
              {!isWildcard && (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => setPerms(new Set(ALL_KEYS))}>
                    Select all
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="flex-1 sm:flex-none" onClick={() => setPerms(new Set())}>
                    Clear
                  </Button>
                </div>
              )}
            </div>

            {isWildcard && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <Lock className="mr-1 inline size-3.5" /> This is the Super Admin role — it always has full access and can't be narrowed.
              </p>
            )}

            <div className={cn('overflow-x-auto rounded-lg border', isWildcard && 'opacity-60')}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left text-xs font-semibold whitespace-nowrap">Form</th>
                    {ALL_ACTIONS.map((a) => {
                      const rows = rowsForAction(a);
                      if (!rows.length) return null;
                      const allOn = columnAllOn(a);
                      const anyOn = columnAnyOn(a);
                      return (
                        <th key={a} className="px-2 py-2 text-center text-xs font-semibold whitespace-nowrap">
                          <button
                            type="button"
                            disabled={isWildcard}
                            onClick={() => toggleColumn(a)}
                            className={cn('flex w-full flex-col items-center gap-1', !isWildcard && 'cursor-pointer')}
                            title={allOn ? `Unselect all "${actionLabel(a)}"` : `Select all "${actionLabel(a)}"`}
                          >
                            <input
                              type="checkbox"
                              className="accent-indigo-600 size-3.5"
                              checked={allOn}
                              readOnly
                              ref={(el) => { if (el) el.indeterminate = !allOn && anyOn; }}
                              disabled={isWildcard}
                            />
                            <span className="font-normal capitalize">{actionLabel(a)}</span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {GROUPS.map(([group, defs]) => (
                    <Fragment key={group}>
                      <tr className="bg-muted/20">
                        <td colSpan={ALL_ACTIONS.length + 1} className="text-muted-foreground sticky left-0 px-3 py-1 text-[11px] font-semibold tracking-wide uppercase">
                          {group}
                        </td>
                      </tr>
                      {defs.map((d) => (
                        <tr key={d.resource} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="sticky left-0 z-10 bg-card px-3 py-1.5 text-sm font-medium whitespace-nowrap">{d.label}</td>
                          {ALL_ACTIONS.map((a) => {
                            if (!d.actions.includes(a)) return <td key={a} className="text-muted-foreground/40 px-2 py-1.5 text-center">—</td>;
                            const key = perm(d.resource, a);
                            return (
                              <td key={a} className="px-2 py-1.5 text-center">
                                <input
                                  type="checkbox"
                                  className={cn('accent-indigo-600 size-3.5', !isWildcard && 'cursor-pointer')}
                                  checked={has(key)}
                                  disabled={isWildcard}
                                  onChange={() => toggle(key)}
                                  aria-label={`${d.label}: ${actionLabel(a)}`}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Plus />} {isEdit ? 'Save' : 'Create role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RolesPage;
