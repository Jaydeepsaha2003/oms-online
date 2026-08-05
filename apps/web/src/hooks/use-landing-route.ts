import { landingRoute } from '@oms/shared';
import { usePermissions } from './use-permissions';

/**
 * The first page the current user can actually open — their home.
 *
 * Same permission-filtered menu the sidebar is built from, so this is always
 * whatever sits at the top of their own navigation. `undefined` means the
 * account can open nothing at all.
 */
export function useLandingRoute(): string | undefined {
  const { permissions } = usePermissions();
  return landingRoute(permissions);
}
