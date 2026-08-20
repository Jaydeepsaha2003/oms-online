import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '@/hooks/use-permissions';

/** Route-level permission gate. Redirects to /forbidden when access is denied. */
export function RequirePermission({
  permission,
  anyPermission,
  children,
}: {
  permission?: string;
  /**
   * Admitted with ANY one of these — for a screen two different roles reach for
   * different reasons (Product Photos: a catalogue viewer OR an order viewer).
   * Mirrors `anyPermission` on a MENU node and `@AnyPermission` on the
   * controller, so the menu, the route and the API agree on who gets in.
   */
  anyPermission?: string[];
  children: ReactNode;
}) {
  const { can, canAny } = usePermissions();
  if (permission && !can(permission)) return <Navigate to="/forbidden" replace />;
  if (anyPermission?.length && !canAny(anyPermission)) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}
