import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '@/hooks/use-permissions';

/** Route-level permission gate. Redirects to /forbidden when access is denied. */
export function RequirePermission({
  permission,
  children,
}: {
  permission?: string;
  children: ReactNode;
}) {
  const { can } = usePermissions();
  if (permission && !can(permission)) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}
