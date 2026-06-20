import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';
import { FullScreenLoader } from '@/components/common/full-screen-loader';

/** Gate for authenticated areas. Waits for session bootstrap, then requires a user. */
export function ProtectedRoute() {
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (isBootstrapping) return <FullScreenLoader label="Restoring your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  return <Outlet />;
}
