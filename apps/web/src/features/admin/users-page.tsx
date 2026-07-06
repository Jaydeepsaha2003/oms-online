import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, MonitorSmartphone, Pencil, Plus, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { UserDto, UserStatus } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/common/combo';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCreateUser, useDeleteUser, useRoles, useUpdateUser, useUsers } from './use-admin';
import { UserSessionsDialog } from './user-sessions-dialog';

const PAGE_SIZE = 50;
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
  const [page, setPage] = useState(1);
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

  const query = { page, pageSize: PAGE_SIZE, search: search || undefined, status: (status || undefined) as UserStatus | undefined };
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
        <div className="relative w-full max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input placeholder="Search name or email…" className="pl-9" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <div className="w-40">
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

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Page {data?.page ?? page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <ChevronLeft /> Prev
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next <ChevronRight />
          </Button>
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

function UserDialog({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const isEdit = !!user;
  const create = useCreateUser();
  const update = useUpdateUser(user?.id ?? '');
  const saving = create.isPending || update.isPending;
  const { data: roles } = useRoles();

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

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${user!.name}` : 'New user'}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Email {!isEdit && '*'}</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={isEdit} placeholder="name@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {!isEdit && (
              <div className="space-y-1.5">
                <Label>Password *</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Status</Label>
              <NativeSelect value={status} onChange={(v) => setStatus(v as UserStatus)} options={STATUSES} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Roles *</Label>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
              {(roles ?? []).map((r) => (
                <label key={r.id} className="hover:bg-muted/60 flex cursor-pointer items-start gap-2 rounded px-2 py-1.5">
                  <input type="checkbox" className="mt-0.5 accent-indigo-600" checked={roleIds.has(r.id)} onChange={() => toggleRole(r.id)} />
                  <span>
                    <span className="block text-sm font-medium">{r.label}</span>
                    {r.description && <span className="text-muted-foreground block text-xs">{r.description}</span>}
                  </span>
                </label>
              ))}
              {!roles?.length && <p className="text-muted-foreground p-2 text-sm">No roles defined yet.</p>}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Plus />} {isEdit ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default UsersPage;
