import { useNavigate } from 'react-router-dom';
import { Lock, Pencil, Shield, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { type RoleDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { useDeleteRole, useRoles } from './use-admin';

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
  const navigate = useNavigate();
  const { can } = usePermissions();
  const confirm = useConfirm();
  const { data: roles, isLoading } = useRoles();
  const del = useDeleteRole();

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
                navigate(`/admin/roles/${r.id}/edit`);
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
          <p className="text-muted-foreground text-sm">{roles?.length ?? 0} roles · define what each role can access</p>
        </div>
        {can('role:create') && (
          <Button size="sm" onClick={() => navigate('/admin/roles/new')}>
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
        onRowClick={(r) => can('role:update') && navigate(`/admin/roles/${r.id}/edit`)}
        mobileCard={roleMobileCard}
        actions={(r) => (
          <div className="flex justify-end gap-1">
            {can('role:update') && (
              <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate(`/admin/roles/${r.id}/edit`)} aria-label="Edit" title="Edit">
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

    </div>
  );
}

export default RolesPage;
