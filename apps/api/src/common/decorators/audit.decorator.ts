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

export const SKIP_AUDIT_KEY = 'skipAudit';

/**
 * Opt a route OUT of the interceptor's automatic audit entry entirely — for when
 * the service itself writes a richer, request-specific entry (e.g. an edit's
 * actual before/after values) and a generic "Edited an X" entry would just be
 * noise sitting next to it.
 *
 * @example
 *   @SkipAudit()
 *   @Patch(':id') update() { // service calls AuditService.record(...) itself
 */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);
