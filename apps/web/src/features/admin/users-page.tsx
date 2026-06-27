import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Trash2, UserPlus } from 'lucide-react';
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

const PAGE_SIZE = 50;
const STATUSES: UserStatus[] = ['active', 'disabled', 'invited'];
const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  disabled: 'bg-rose-50 text-rose-700 ring-rose-200',
  invited: 'bg-amber-50 text-amber-700 ring-amber-200',
};

const dt = (s?: string | null) =>
  s ? (
    <span className="text-muted-foreground font-mono text-xs whitespace-nowrap" title={formatDateTime(s)}>
      {formatDateShort(s)}
    </span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

const StatusBadge = ({ status }: { status: string }) => (
  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', STATUS_STYLE[status] ?? 'bg-muted')}>
    {status}
  </span>
);

const COLUMNS: DataColumn<UserDto>[] = [
  { id: 'name', label: 'Name', pin: 'left0', fixed: true, cell: (u) => <span className="font-medium">{u.name}</span> },
  { id: 'email', label: 'Email', cell: (u) => <span className="text-muted-foreground">{u.email}</span> },
  { id: 'status', label: 'Status', cell: (u) => <StatusBadge status={u.status} /> },
  {
    id: 'roles',
    label: 'Roles',
    cell: (u) =>
      u.roles.length ? (
        <div className="flex flex-wrap gap-1">
          {u.roles.map((r) => (
            <span key={r.id} className="bg-muted inline-flex rounded-full border px-2 py-0.5 text-xs font-medium">
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

export function UsersPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = { page, pageSize: PAGE_SIZE, search: search || undefined };
  const { data, isLoading } = useUsers(query);
  const del = useDeleteUser();

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Users</h2>
          <p className="text-muted-foreground text-sm">{data?.total ?? 0} users · manage access and roles</p>
        </div>
        {can('user:create') && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <UserPlus /> New user
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input placeholder="Search name or email…" className="pl-9" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
      </div>

      <DataTable
        columns={COLUMNS}
        rows={items}
        rowKey={(u) => u.id}
        isLoading={isLoading}
        emptyText="No users yet."
        onRowClick={(u) => can('user:update') && setEditing(u)}
        actions={(u) => (
          <div className="flex justify-end gap-1">
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
