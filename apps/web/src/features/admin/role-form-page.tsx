import { Fragment, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Lock, Plus, Save, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  ACTIONS,
  ALL_PERMISSIONS,
  menuPermissionRows,
  perm,
  RESOURCE_DEFINITIONS,
  type Action,
  type MenuPermissionRow,
} from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateRole, useRoles, useUpdateRole } from './use-admin';

/** Which actions each resource supports, for gating the matrix cells. */
const ACTIONS_BY_RESOURCE = new Map(RESOURCE_DEFINITIONS.map((d) => [d.resource as string, d.actions]));

/** Every screen in the sidebar, in sidebar order. */
const SCREENS = menuPermissionRows();

/** Only the action columns some listed screen can actually use — no dead columns. */
const COLUMNS: Action[] = Object.values(ACTIONS).filter((a) =>
  SCREENS.some((s) => ACTIONS_BY_RESOURCE.get(s.resource)?.includes(a)),
);

const ACTION_LABEL: Record<string, string> = {
  [ACTIONS.MANAGE]: 'Manage (full)',
  [ACTIONS.VIEWRATES]: 'View rates',
  [ACTIONS.NOTIFY]: 'Receive alerts',
};
const label = (a: Action) => ACTION_LABEL[a] ?? a.charAt(0).toUpperCase() + a.slice(1);

/**
 * Permissions that belong to no sidebar screen.
 *
 * The matrix above has one row per MENU leaf, so a permission that grants an
 * ability rather than access to a page (receiving dispatch alerts, downloading
 * a backup) produces no row and no column — it would sit in the catalog and in
 * the database while being impossible to tick. These get their own section.
 */
const CAPABILITIES = RESOURCE_DEFINITIONS.filter((d) => !SCREENS.some((s) => s.resource === d.resource)).map((d) => ({
  resource: d.resource as string,
  label: d.label,
  group: d.group,
  items: d.actions.map((a) => ({ key: perm(d.resource, a), action: a })),
}));

/** Every concrete permission this page can grant (backs "Select all"). */
const ALL_KEYS = [
  ...new Set([
    ...SCREENS.flatMap((s) => (ACTIONS_BY_RESOURCE.get(s.resource) ?? []).map((a) => perm(s.resource, a))),
    ...CAPABILITIES.flatMap((c) => c.items.map((i) => i.key)),
  ]),
];

export function RoleFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const { data: roles, isLoading } = useRoles();
  const role = useMemo(() => roles?.find((r) => r.id === id) ?? null, [roles, id]);

  const create = useCreateRole();
  const update = useUpdateRole(id ?? '');
  const saving = create.isPending || update.isPending;

  const [name, setName] = useState('');
  const [displayLabel, setDisplayLabel] = useState('');
  const [description, setDescription] = useState('');
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Seed once the role arrives (the list is cached, so this usually lands immediately).
  if (isEdit && role && !loaded) {
    setName(role.name);
    setDisplayLabel(role.label);
    setDescription(role.description ?? '');
    setPerms(new Set(role.permissions));
    setLoaded(true);
  }

  const isWildcard = !!role?.permissions.includes(ALL_PERMISSIONS); // super admin — locked
  const has = (key: string) => isWildcard || perms.has(key);
  const toggle = (key: string) => {
    if (isWildcard) return;
    setPerms((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SCREENS;
    return SCREENS.filter((s) => `${s.group} ${s.label}`.toLowerCase().includes(q));
  }, [search]);

  const visibleCapabilities = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return CAPABILITIES;
    return CAPABILITIES.filter((c) => `${c.group} ${c.label}`.toLowerCase().includes(q));
  }, [search]);

  /** Cells a column can actually toggle, across the rows currently on screen. */
  const keysInColumn = (a: Action) =>
    visible
      .filter((s) => ACTIONS_BY_RESOURCE.get(s.resource)?.includes(a))
      .map((s) => perm(s.resource, a));
  const columnAllOn = (a: Action) => {
    const keys = keysInColumn(a);
    return keys.length > 0 && keys.every(has);
  };
  const columnAnyOn = (a: Action) => keysInColumn(a).some(has);
  const toggleColumn = (a: Action) => {
    if (isWildcard) return;
    const keys = keysInColumn(a);
    const turnOn = !keys.every(has);
    setPerms((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (turnOn ? next.add(k) : next.delete(k)));
      return next;
    });
  };

  /** Grant/revoke everything one screen's area offers — the row's own toggle-all. */
  const toggleRow = (s: MenuPermissionRow) => {
    if (isWildcard) return;
    const keys = (ACTIONS_BY_RESOURCE.get(s.resource) ?? []).map((a) => perm(s.resource, a));
    const turnOn = !keys.every(has);
    setPerms((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (turnOn ? next.add(k) : next.delete(k)));
      return next;
    });
  };

  const goBack = () => navigate('/admin/roles');

  const submit = () => {
    if (!displayLabel.trim()) return toast.error('Display label is required');
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'Role updated' : 'Role created');
        goBack();
      },
      onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed')),
    };
    if (isEdit) {
      update.mutate(
        {
          label: displayLabel.trim(),
          description: description.trim() || undefined,
          permissions: isWildcard ? role!.permissions : [...perms],
        },
        opts,
      );
    } else {
      if (!/^[a-z][a-z0-9_]*$/.test(name.trim())) {
        return toast.error('Machine name: lowercase letters, digits and _ only (must start with a letter)');
      }
      if (perms.size === 0) return toast.error('Grant at least one permission');
      create.mutate({ name: name.trim(), label: displayLabel.trim(), description: description.trim() || undefined, permissions: [...perms] }, opts);
    }
  };

  useSaveShortcut(submit);

  if (isEdit && isLoading) {
    return (
      <div className="text-muted-foreground flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const selectedCount = isWildcard ? ALL_KEYS.length : perms.size;
  let lastGroup = '';

  return (
    <div className="flex flex-col gap-3 font-sans">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Button variant="ghost" size="icon" className="size-8" onClick={goBack} aria-label="Back">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="bg-gradient-brand flex size-9 items-center justify-center rounded-[4px] text-white shadow-md shadow-blue-600/20 ring-1 ring-white/20">
          <ShieldCheck className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-[17px] leading-tight font-bold tracking-tight">{isEdit ? 'Edit role' : 'New role'}</h2>
          <p className="text-muted-foreground truncate text-[11.5px] font-medium">
            {isEdit ? (role?.label ?? id) : 'Define what this role can open and do'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" onClick={goBack}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : isEdit ? <Save /> : <Plus />} {isEdit ? 'Save' : 'Create role'}
          </Button>
        </div>
      </div>

      {/* Identity */}
      <div className="bg-card grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-3">
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
          <Input value={displayLabel} onChange={(e) => setDisplayLabel(e.target.value)} placeholder="e.g. Warehouse Lead" autoFocus={!isEdit} />
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this role is for…" />
        </div>
      </div>

      {isWildcard && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-300">
          <Lock className="mr-1 inline size-3.5" /> This is the Super Admin role — it always has full access and can't be narrowed.
        </p>
      )}

      {/* Matrix toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Label className="text-sm">
            Permissions <span className="text-muted-foreground font-normal">({selectedCount} selected)</span>
          </Label>
          <div className="relative w-56">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a screen or capability…" className="h-8 pl-8 text-sm" />
          </div>
        </div>
        {!isWildcard && (
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setPerms(new Set(ALL_KEYS))}>
              Select all
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPerms(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </div>

      {/* The matrix. Header row and the screen-name column both stay put while
          scrolling — with 49 screens and 13 action columns you otherwise lose
          track of which row and which column a checkbox belongs to.
          The height is capped so THIS box is the scrollport (the page's <main>
          would otherwise be, leaving the container full-height and the sticky
          offsets anchored to the wrong element) — which also keeps the identity
          fields and Save button on screen while you work down the list. */}
      <div className={cn('max-h-[min(70vh,44rem)] overflow-auto rounded-lg border', isWildcard && 'opacity-60')}>
        <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="bg-muted sticky top-0 left-0 z-30 border-r border-b px-3 py-2 text-left text-xs font-semibold whitespace-nowrap">
                Screen
              </th>
              {COLUMNS.map((a) => {
                const allOn = columnAllOn(a);
                const anyOn = columnAnyOn(a);
                return (
                  <th key={a} className="bg-muted sticky top-0 z-20 border-b px-2 py-2 text-center text-xs font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      disabled={isWildcard}
                      onClick={() => toggleColumn(a)}
                      className={cn('flex w-full flex-col items-center gap-1', !isWildcard && 'cursor-pointer')}
                      title={allOn ? `Unselect all "${label(a)}"` : `Select all "${label(a)}"`}
                    >
                      <input
                        type="checkbox"
                        className="accent-indigo-600 size-3.5"
                        checked={allOn}
                        readOnly
                        ref={(el) => {
                          if (el) el.indeterminate = !allOn && anyOn;
                        }}
                        disabled={isWildcard}
                      />
                      <span className="font-normal">{label(a)}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const actions = ACTIONS_BY_RESOURCE.get(s.resource) ?? [];
              const groupHeader = s.group !== lastGroup ? s.group : null;
              lastGroup = s.group;
              return (
                <Fragment key={s.id}>
                  {groupHeader && (
                    <tr>
                      <th
                        colSpan={COLUMNS.length + 1}
                        className="bg-muted/40 text-muted-foreground sticky left-0 z-10 border-b px-3 py-1 text-left text-[11px] font-semibold tracking-wide uppercase"
                      >
                        {groupHeader}
                      </th>
                    </tr>
                  )}
                  <tr className="hover:bg-muted/20">
                    <td className="bg-card sticky left-0 z-10 border-r border-b px-3 py-1.5 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={isWildcard}
                        onClick={() => toggleRow(s)}
                        className={cn('text-left text-sm font-medium', !isWildcard && 'cursor-pointer hover:underline')}
                        title={isWildcard ? undefined : 'Toggle everything this screen offers'}
                      >
                        {s.label}
                      </button>
                      {s.sharedWith.length > 0 && (
                        <span
                          className="text-muted-foreground ml-1.5 cursor-help text-[10px]"
                          title={`Uses the same permission as: ${s.sharedWith.join(', ')} — these are granted together.`}
                        >
                          linked
                        </span>
                      )}
                    </td>
                    {COLUMNS.map((a) => {
                      if (!actions.includes(a)) {
                        return (
                          <td key={a} className="text-muted-foreground/30 border-b px-2 py-1.5 text-center">
                            —
                          </td>
                        );
                      }
                      const key = perm(s.resource, a);
                      // The permission that actually opens this screen — ringed so
                      // it's obvious which box controls sidebar/route access.
                      const isOpener = key === s.openPermission;
                      return (
                        <td
                          key={a}
                          className={cn('border-b px-2 py-1.5 text-center', isOpener && 'bg-indigo-50/60 dark:bg-indigo-500/10')}
                        >
                          <input
                            type="checkbox"
                            className={cn('accent-indigo-600 size-3.5', !isWildcard && 'cursor-pointer')}
                            checked={has(key)}
                            disabled={isWildcard}
                            onChange={() => toggle(key)}
                            aria-label={`${s.label}: ${label(a)}`}
                            title={isOpener ? `Opens ${s.label}` : `${s.label} — ${label(a)}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                </Fragment>
              );
            })}
            {!visible.length && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="text-muted-foreground px-3 py-10 text-center text-sm">
                  No screen matches “{search}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-muted-foreground shrink-0 text-[11px]">
        The tinted cell in each row is the permission that opens that screen. Rows marked <span className="font-semibold">linked</span> are
        gated by the same permission as another screen, so they can only be granted together.
      </p>

      {/* Abilities that aren't a screen, so the grid above can't express them. */}
      {visibleCapabilities.length > 0 && (
        <div className={cn('bg-card rounded-lg border p-3', isWildcard && 'opacity-60')}>
          <Label className="text-sm">Capabilities</Label>
          <p className="text-muted-foreground mt-0.5 mb-3 text-[11.5px]">
            These grant an ability rather than access to a page, so they have no row in the grid above.
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {visibleCapabilities.map((c) => (
              <div key={c.resource} className="rounded-md border p-2.5">
                <div className="text-[13px] font-medium">{c.label}</div>
                <div className="text-muted-foreground mb-1.5 text-[10.5px] tracking-wide uppercase">{c.group}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {c.items.map((i) => (
                    <label
                      key={i.key}
                      className={cn('flex items-center gap-1.5 text-[12.5px]', !isWildcard && 'cursor-pointer')}
                    >
                      <input
                        type="checkbox"
                        className={cn('accent-indigo-600 size-3.5', !isWildcard && 'cursor-pointer')}
                        checked={has(i.key)}
                        disabled={isWildcard}
                        onChange={() => toggle(i.key)}
                        aria-label={`${c.label}: ${label(i.action)}`}
                      />
                      {label(i.action)}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default RoleFormPage;
