import { hasAllPermissions, hasAnyPermission, hasPermission } from '@oms/shared';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Permission checks for the current user. Mirrors the backend rules (`*` and
 * `<resource>:manage` wildcards) so UI gating and API enforcement agree.
 *
 * @example
 *   const { can } = usePermissions();
 *   {can('order:create') && <Button>New order</Button>}
 */
export function usePermissions() {
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  return {
    permissions,
    can: (permission: string) => hasPermission(permissions, permission),
    canAny: (required: string[]) => hasAnyPermission(permissions, required),
    canAll: (required: string[]) => hasAllPermissions(permissions, required),
  };
}
