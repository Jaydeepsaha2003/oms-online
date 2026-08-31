import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  BellOff,
  ChevronLeft,
  ChevronRight,
  MonitorSmartphone,
  Pencil,
  Search,
  Trash2,
  UserPlus,
} from 'lucide-react';
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
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
const toneFor = (id: string) =>
  AVATAR_TONES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];

/** "2 minutes ago" / "3 days ago" — relative reads faster than a timestamp when
 *  the question is "recently?". The exact time stays in the tooltip. */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/** Anything inside this window counts as "using the system right now". */
const ONLINE_WINDOW_MIN = 15;

/**
 * Whether this person is actually USING the system — deliberately separate from
 * the account's Active flag.
 *
 * "Active" only ever meant "this account is allowed to sign in". It said nothing
 * about whether anyone has touched it, so a dormant account and a busy one
 * looked identical (spec §13.1). Activity comes from the audit log; a live
 * session alone is not enough, because a signed-in tab left open overnight is
 * not somebody working.
 */
function PresenceCell({ u }: { u: UserDto }) {
  const last = u.lastActiveAt;
  const mins = last ? (Date.now() - new Date(last).getTime()) / 60000 : Infinity;
  const online = mins <= ONLINE_WINDOW_MIN;
  const sessions = u.activeSessions ?? 0;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap">
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            online
              ? 'bg-emerald-500'
              : last
                ? 'bg-slate-300 dark:bg-white/25'
                : 'bg-transparent ring-1 ring-slate-300',
          )}
        />
        {online ? (
          <span className="text-emerald-700 dark:text-emerald-400">Using now</span>
        ) : last ? (
          <span className="text-muted-foreground" title={formatDateTime(last)}>
            {ago(last)}
          </span>
        ) : (
          <span className="text-muted-foreground/60">Never used</span>
        )}
      </span>
      {sessions > 0 && (
        <span className="text-muted-foreground/70 text-[10.5px] font-medium">
          {sessions} open session{sessions === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );
}

/**
 * Whether this user's devices will actually receive a notification.
 *
 * Distinct from a session, and that distinction is the whole point: someone can
 * be signed in on a phone and still get nothing, because push delivery needs a
 * subscription and only the person holding the device can create one. Orders
 * were notifying every user while five of six had never enrolled, and there was
 * nowhere to see that — it just looked like notifications were broken.
 *
 * Nobody can fix this for them from here, so the cell says what to ask them to
 * do rather than implying an admin action.
 */
function AlertsCell({ u }: { u: UserDto }) {
  const devices = u.alertDevices ?? 0;
  if (devices > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap text-emerald-700 dark:text-emerald-400">
        <Bell className="size-3.5 shrink-0" />
        On
        <span className="text-muted-foreground/70 font-medium">
          · {devices} device{devices === 1 ? '' : 's'}
        </span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap text-amber-700 dark:text-amber-400"
      title="This user gets no notifications on their device. They need to sign in, tap the bell in the top bar and turn alerts on — on iPhone, from the app added to the Home Screen."
    >
      <BellOff className="size-3.5 shrink-0" />
      Not enabled
    </span>
  );
}

const dt = (s?: string | null) =>
  s ? (
    <span
      className="text-muted-foreground font-mono text-xs whitespace-nowrap"
      title={formatDateTime(s)}
    >
      {formatDateShort(s)}
    </span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

const StatusBadge = ({ status }: { status: string }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
      STATUS_STYLE[status] ?? 'bg-muted',
    )}
  >
    <span
      className={cn(
        'size-1.5 rounded-full',
        status === 'active'
          ? 'bg-emerald-500'
          : status === 'disabled'
            ? 'bg-rose-500'
            : 'bg-amber-500',
      )}
    />
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

  const query = {
    page,
    pageSize,
    search: search || undefined,
    status: (status || undefined) as UserStatus | undefined,
  };
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
          <span
            className={cn(
              'bg-gradient-to-br flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm',
              toneFor(u.id),
            )}
          >
            {initials(u.name)}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium leading-tight">{u.name}</div>
            <div className="text-muted-foreground truncate text-xs leading-tight">{u.email}</div>
          </div>
        </div>
      ),
    },
    { id: 'status', label: 'Account', cell: (u) => <StatusBadge status={u.status} /> },
    { id: 'presence', label: 'Last active', cell: (u) => <PresenceCell u={u} /> },
    { id: 'alerts', label: 'Alerts', noSort: true, cell: (u) => <AlertsCell u={u} /> },
    {
      id: 'roles',
      label: 'Roles',
      cell: (u) =>
        u.roles.length ? (
          <div className="flex flex-wrap gap-1">
            {u.roles.map((r) => (
              <span
                key={r.id}
                className="bg-primary/5 text-primary/90 ring-primary/15 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
              >
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
          <span
            className={cn(
              'bg-gradient-to-br flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm',
              toneFor(u.id),
            )}
          >
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
            <span
              key={r.id}
              className="bg-primary/5 text-primary/90 ring-primary/15 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
            >
              {r.label}
            </span>
          ))}
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Last login {u.lastLoginAt ? formatDateShort(u.lastLoginAt) : '—'} · Created{' '}
        {formatDateShort(u.createdAt)}
        <span className="mt-1 block">
          <PresenceCell u={u} />
        </span>
        <span className="mt-1 block">
          <AlertsCell u={u} />
        </span>
      </p>
      <div
        className="flex items-center justify-end gap-1 border-t pt-2"
        onClick={(e) => e.stopPropagation()}
      >
        {can('user:view') && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setSessionsUser(u)}
            aria-label="Devices & sessions"
          >
            <MonitorSmartphone className="size-4" />
          </Button>
        )}
        {can('user:update') && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => navigate(`/admin/users/${u.id}/edit`)}
            aria-label="Edit"
          >
            <Pencil className="size-4" />
          </Button>
        )}
        {can('user:delete') && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-destructive hover:text-destructive"
            onClick={() => handleDelete(u)}
            aria-label="Delete"
          >
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
          <div>
            <p className="text-muted-foreground text-sm">
              {data?.total ?? 0} users · manage access, roles &amp; devices
            </p>
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
          <Input
            placeholder="Search name or email…"
            className="pl-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="w-40 max-w-full">
          <NativeSelect
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={['', ...STATUSES]}
            placeholder="All statuses"
          />
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
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setSessionsUser(u)}
                aria-label="Devices & sessions"
                title="Devices & sessions"
              >
                <MonitorSmartphone className="size-4" />
              </Button>
            )}
            {can('user:update') && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => navigate(`/admin/users/${u.id}/edit`)}
                aria-label="Edit"
              >
                <Pencil className="size-4" />
              </Button>
            )}
            {can('user:delete') && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                onClick={() => handleDelete(u)}
                aria-label="Delete"
              >
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      </div>

      {sessionsUser && (
        <UserSessionsDialog user={sessionsUser} onClose={() => setSessionsUser(null)} />
      )}
    </div>
  );
}

export default UsersPage;
