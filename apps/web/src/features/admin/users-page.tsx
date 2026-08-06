import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Loader2, MonitorSmartphone, Pencil, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { UserDto, UserStatus } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, formatDateShort, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { PageSizeSelect } from '@/components/common/page-size-select';
import { usePageSize } from '@/hooks/use-page-size';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/common/combo';
import { useDeleteUser, useUsers } from './use-admin';
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
  const navigate = useNavigate();
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const { page, setPage, pageSize, setPageSize } = usePageSize('users');
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
          <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate(`/admin/users/${u.id}/edit`)} aria-label="Edit">
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
          <Button onClick={() => navigate('/admin/users/new')}>
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
        onRowClick={(u) => can('user:update') && navigate(`/admin/users/${u.id}/edit`)}
        mobileCard={userMobileCard}
        actions={(u) => (
          <div className="flex justify-end gap-1">
            {can('user:view') && (
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setSessionsUser(u)} aria-label="Devices & sessions" title="Devices & sessions">
                <MonitorSmartphone className="size-4" />
              </Button>
            )}
            {can('user:update') && (
              <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate(`/admin/users/${u.id}/edit`)} aria-label="Edit">
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

      {sessionsUser && <UserSessionsDialog user={sessionsUser} onClose={() => setSessionsUser(null)} />}
    </div>
  );
}

export default UsersPage;
