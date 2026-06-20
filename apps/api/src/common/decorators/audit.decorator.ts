import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

export interface AuditOptions {
  /** Verb, e.g. 'update' (see AUDIT_ACTIONS in @oms/shared). */
  action: string;
  /** Resource, e.g. 'order'. */
  resource: string;
  /** Optional human-readable description (static). For dynamic text, set it in the service. */
  description?: string;
}

/**
 * Annotate a route so the AuditInterceptor records a rich audit entry. Without
 * it, mutating requests are still logged generically (method + path).
 *
 * @example
 *   @Audit({ action: 'update', resource: 'order' })
 *   @Patch(':id') update() { ... }
 */
export const Audit = (options: AuditOptions) => SetMetadata(AUDIT_KEY, options);
