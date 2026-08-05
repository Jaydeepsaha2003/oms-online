import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { usePermissions } from '@/hooks/use-permissions';
import { useLandingRoute } from '@/hooks/use-landing-route';

/**
 * What "/" means for THIS user.
 *
 * Every sign-in lands on "/", so gating it on `dashboard:view` alone greeted a
 * dispatch-only user with "Access denied" on their own home page — next to a
 * sidebar full of pages they can use. Now "/" resolves to the first page their
 * permissions actually allow, and only an account with nothing at all to open
 * sees the denial (which is then the honest answer).
 *
 * Doing it here rather than in the login page covers every way of arriving:
 * sign-in, a refresh, the logo, or a bookmark.
 */
export function HomeRoute({ dashboard }: { dashboard: ReactNode }) {
  const { can } = usePermissions();
  const landing = useLandingRoute();

  if (can(perm(RESOURCES.DASHBOARD, ACTIONS.VIEW))) return <>{dashboard}</>;
  // `landingRoute` cannot return "/" for a user without dashboard access — the
  // dashboard is filtered out of their menu — so this can't bounce back here.
  if (landing) return <Navigate to={landing} replace />;
  return <Navigate to="/forbidden" replace />;
}
