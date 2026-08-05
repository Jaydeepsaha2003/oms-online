import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, KeyRound, Loader2, Mail, MonitorSmartphone, Pencil, Plus, Search, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { UserDto, UserStatus } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { usePageSize } from '@/hooks/use-page-size';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/common/combo';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useCreateUser, useDeleteUser, useRoles, useUpdateUser, useUsers } from './use-admin';
import { UserSessionsDialog } from './user-sessions-dialog';

const STATUSES: UserStatus[] = ['active', 'disabled', 'invited'];
const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  disabled: 'bg-rose-50 text-rose-700 ring-rose-200',
  invited: 'bg-amber-50 text-amber-700 ring-amber-200',
};
const AVATAR_TONES = [
  'from-blue-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-fuchsia-500 to-purple-600',
  'from-sky-500 to-cyan-600',
  'from-rose-500 to-pink-600',
];
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
const toneFor = (id: string) => AVATAR_TONES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];

const dt = (s?: string | null) =>
  s ? (
    <span className="text-muted-foreground font-mono text-xs whitespace-nowrap" title={formatDateTime(s)}>
      {formatDateShort(s)}
    </span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

const StatusBadge = ({ status }: { status: string }) => (
  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', STATUS_STYLE[status] ?? 'bg-muted')}>
    <span className={cn('size-1.5 rounded-full', status === 'active' ? 'bg-emerald-500' : status === 'disabled' ? 'bg-rose-500' : 'bg-amber-500')} />
    {status}
  </span>
);

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="bg-card flex items-center gap-3 rounded-xl border p-3 shadow-sm">
      <span className={cn('size-2.5 rounded-full', tone)} />
      <div>
        <div className="text-xl font-bold leading-none tabular-nums">{value}</div>
        <div className="text-muted-foreground mt-1 text-xs">{label}</div>
      </div>
    </div>
  );
}

export function UsersPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const { page, setPage, pageSize, setPageSize } = usePageSize('users');
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [sessionsUser, setSessionsUser] = useState<UserDto | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize, search: search || undefined, status: (status || undefined) as UserStatus | undefined };
  const { data, isLoading } = useUsers(query);
  const del = useDeleteUser();

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const counts = useMemo(() => {
    const c = { active: 0, disabled: 0, invited: 0 };
    for (const u of items) c[u.status] = (c[u.status] ?? 0) + 1;
    return c;
  }, [items]);

  const columns: DataColumn<UserDto>[] = [
    {
      id: 'name',
      label: 'User',
      pin: 'left0',
      fixed: true,
      cell: (u) => (
        <div className="flex items-center gap-2.5">
          <span className={cn('bg-gradient-to-br flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm', toneFor(u.id))}>
            {initials(u.name)}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium leading-tight">{u.name}</div>
            <div className="text-muted-foreground truncate text-xs leading-tight">{u.email}</div>
          </div>
        </div>
      ),
    },
    { id: 'status', label: 'Status', cell: (u) => <StatusBadge status={u.status} /> },
    {
      id: 'roles',
      label: 'Roles',
      cell: (u) =>
        u.roles.length ? (
          <div className="flex flex-wrap gap-1">
            {u.roles.map((r) => (
              <span key={r.id} className="bg-primary/5 text-primary/90 ring-primary/15 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset">
                {r.label}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { id: 'lastLogin', label: 'Last login', cell: (u) => dt(u.lastLoginAt) },
    { id: 'created', label: 'Created', cell: (u) => dt(u.createdAt) },
  ];

  // Phones: one card per user (mirrors the rest of the app's mobile lists).
  const userMobileCard = (u: UserDto) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn('bg-gradient-to-br flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm', toneFor(u.id))}>
            {initials(u.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate leading-tight font-medium">{u.name}</p>
            <p className="text-muted-foreground truncate text-xs">{u.email}</p>
          </div>
        </div>
        <StatusBadge status={u.status} />
      </div>
      {u.roles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {u.roles.map((r) => (
            <span key={r.id} className="bg-primary/5 text-primary/90 ring-primary/15 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset">
              {r.label}
            </span>
          ))}
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Last login {u.lastLoginAt ? formatDateShort(u.lastLoginAt) : '—'} · Created {formatDateShort(u.createdAt)}
      </p>
      <div className="flex items-center justify-end gap-1 border-t pt-2" onClick={(e) => e.stopPropagation()}>
        {can('user:view') && (
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setSessionsUser(u)} aria-label="Devices & sessions">
            <MonitorSmartphone className="size-4" />
          </Button>
        )}
        {can('user:update') && (
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(u)} aria-label="Edit">
            <Pencil className="size-4" />
          </Button>
        )}
        {can('user:delete') && (
          <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => handleDelete(u)} aria-label="Delete">
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );

  const handleDelete = async (u: UserDto) => {
    const ok = await confirm({
      title: 'Delete user?',
      description: `"${u.name}" (${u.email}) will lose access and be removed.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(u.id, {
      onSuccess: () => toast.success('User deleted'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
            <Users className="size-5" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Users</h2>
            <p className="text-muted-foreground text-sm">{data?.total ?? 0} users · manage access, roles &amp; devices</p>
          </div>
        </div>
        {can('user:create') && (
          <Button onClick={() => setCreating(true)}>
            <UserPlus /> New user
          </Button>
        )}
      </div>

      {/* Summary + filters */}
      <div className="grid gap-2 sm:grid-cols-3">
        <StatCard label="Active (this page)" value={counts.active} tone="bg-emerald-500" />
        <StatCard label="Disabled" value={counts.disabled} tone="bg-rose-500" />
        <StatCard label="Invited" value={counts.invited} tone="bg-amber-500" />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-full sm:max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input placeholder="Search name or email…" className="pl-9" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <div className="w-40 max-w-full">
          <NativeSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={['', ...STATUSES]} placeholder="All statuses" />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(u) => u.id}
        isLoading={isLoading}
        emptyText="No users match your filters."
        onRowClick={(u) => can('user:update') && setEditing(u)}
        mobileCard={userMobileCard}
        actions={(u) => (
          <div className="flex justify-end gap-1">
            {can('user:view') && (
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setSessionsUser(u)} aria-label="Devices & sessions" title="Devices & sessions">
                <MonitorSmartphone className="size-4" />
              </Button>
            )}
            {can('user:update') && (
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(u)} aria-label="Edit">
                <Pencil className="size-4" />
              </Button>
            )}
            {can('user:delete') && (
              <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => handleDelete(u)} aria-label="Delete">
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        )}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Page {data?.page ?? page} of {totalPages}
        </p>
        <div className="flex items-center gap-3">
          <PageSizeSelect value={pageSize} onChange={setPageSize} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft /> Prev
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      </div>

      {(creating || editing) && (
        <UserDialog
          user={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {sessionsUser && <UserSessionsDialog user={sessionsUser} onClose={() => setSessionsUser(null)} />}
    </div>
  );
}

/** Status choices as a tactile segmented control, colour-coded like the table's badges. */
const STATUS_SEGMENT_TONE: Record<UserStatus, string> = {
  active: 'data-[on=true]:bg-emerald-50 data-[on=true]:text-emerald-700 data-[on=true]:ring-emerald-200 dark:data-[on=true]:bg-emerald-500/15 dark:data-[on=true]:text-emerald-300',
  disabled: 'data-[on=true]:bg-rose-50 data-[on=true]:text-rose-700 data-[on=true]:ring-rose-200 dark:data-[on=true]:bg-rose-500/15 dark:data-[on=true]:text-rose-300',
  invited: 'data-[on=true]:bg-amber-50 data-[on=true]:text-amber-700 data-[on=true]:ring-amber-200 dark:data-[on=true]:bg-amber-500/15 dark:data-[on=true]:text-amber-300',
};

function UserDialog({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const isEdit = !!user;
  const create = useCreateUser();
  const update = useUpdateUser(user?.id ?? '');
  const saving = create.isPending || update.isPending;
  const { data: roles } = useRoles();
  const [roleSearch, setRoleSearch] = useState('');

  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<UserStatus>(user?.status ?? 'active');
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set(user?.roles.map((r) => r.id) ?? []));

  const toggleRole = (id: string) =>
    setRoleIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const visibleRoles = useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    const all = roles ?? [];
    return q ? all.filter((r) => r.label.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)) : all;
  }, [roles, roleSearch]);
  const allVisibleSelected = visibleRoles.length > 0 && visibleRoles.every((r) => roleIds.has(r.id));
  const toggleAllVisible = () =>
    setRoleIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleRoles.forEach((r) => next.delete(r.id));
      else visibleRoles.forEach((r) => next.add(r.id));
      return next;
    });

  const submit = () => {
    if (!name.trim()) return toast.error('Name is required');
    if (roleIds.size === 0) return toast.error('Assign at least one role');
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'User updated' : 'User created');
        onClose();
      },
      onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed')),
    };
    if (isEdit) {
      update.mutate({ name: name.trim(), status, roleIds: [...roleIds] }, opts);
    } else {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return toast.error('Enter a valid email');
      if (password.length < 8) return toast.error('Password must be at least 8 characters');
      create.mutate({ email: email.trim(), name: name.trim(), password, status, roleIds: [...roleIds] }, opts);
    }
  };

  useSaveShortcut(submit);

  const previewId = user?.id ?? (name || email || 'new');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className={cn('bg-gradient-to-br flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm', toneFor(previewId))}>
              {initials(name || 'New User')}
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate">{isEdit ? user!.name : 'New user'}</DialogTitle>
              <DialogDescription>{isEdit ? 'Update account access — email is permanent once created.' : 'Create an account and grant it access.'}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1">
          {/* ── Account: identity fields, minimal on purpose ─────────────────── */}
          <div className="grid grid-cols-1 gap-3 rounded-lg border bg-slate-50/60 p-3 sm:grid-cols-2 dark:bg-white/[0.02]">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
                <Mail className="size-3.5" /> Email {!isEdit && '*'}
              </Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={isEdit} placeholder="name@company.com" title={isEdit ? 'Email is permanent once the account is created' : undefined} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Full name" />
            </div>
            {!isEdit && (
              <div className="space-y-1.5">
                <Label className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
                  <KeyRound className="size-3.5" /> Password *
                </Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters" />
              </div>
            )}
          </div>

          {/* ── Access: everything that decides what this account can do ────── */}
          <div className="space-y-3 rounded-lg border border-primary/15 bg-primary/[0.03] p-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-primary">
              <ShieldCheck className="size-4" /> Access
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">Account status</Label>
              <div className="bg-muted grid grid-cols-3 gap-1 rounded-lg p-1">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    data-on={status === s}
                    onClick={() => setStatus(s)}
                    className={cn(
                      'ring-1 ring-inset ring-transparent rounded-md py-1.5 text-xs font-bold capitalize transition-all active:scale-[0.98]',
                      status === s ? cn('bg-card shadow-sm', STATUS_SEGMENT_TONE[s]) : 'text-muted-foreground',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                  Roles * <span className="text-primary/70 normal-case">({roleIds.size} assigned)</span>
                </Label>
                {(roles?.length ?? 0) > 5 && (
                  <button type="button" onClick={toggleAllVisible} className="text-primary text-[11px] font-semibold hover:underline">
                    {allVisibleSelected ? 'Clear' : 'Select all'}
                  </button>
                )}
              </div>
              {(roles?.length ?? 0) > 5 && (
                <div className="relative">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                  <Input value={roleSearch} onChange={(e) => setRoleSearch(e.target.value)} placeholder="Search roles…" className="h-8 pl-8 text-sm" />
                </div>
              )}
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border bg-card p-1.5">
                {visibleRoles.map((r) => {
                  const on = roleIds.has(r.id);
                  return (
                    <button
                      type="button"
                      key={r.id}
                      onClick={() => toggleRole(r.id)}
                      className={cn(
                        'flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                        on ? 'bg-primary/[0.06] ring-1 ring-primary/20' : 'hover:bg-muted/60',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] transition-colors',
                          on ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-400',
                        )}
                      >
                        {on && <Check className="size-3" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{r.label}</span>
                        {r.description && <span className="text-muted-foreground block text-xs">{r.description}</span>}
                      </span>
                    </button>
                  );
                })}
                {!visibleRoles.length && <p className="text-muted-foreground p-2 text-sm">{roleSearch ? 'No roles match your search.' : 'No roles defined yet.'}</p>}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Plus />} {isEdit ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default UsersPage;
