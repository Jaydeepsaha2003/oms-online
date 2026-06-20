/** Audit-trail shapes: the record of who did what, when and from where. */

import type { Paginated, PaginationQuery } from './common';

/** Canonical audit action verbs. Extend as needed. */
export const AUDIT_ACTIONS = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  LOGIN_FAILED: 'login_failed',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  EXPORT: 'export',
  IMPORT: 'import',
  APPROVE: 'approve',
  PRINT: 'print',
} as const;

export type AuditActionType = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] | string;

export interface AuditLogDto {
  id: string;
  /** Who — null for anonymous/unauthenticated events (e.g. failed login). */
  userId?: string | null;
  userEmail?: string | null;
  /** What — e.g. 'update'. */
  action: AuditActionType;
  /** On which resource — e.g. 'order'. */
  resource: string;
  /** Specific record id, when applicable. */
  resourceId?: string | null;
  /** Human-readable summary, e.g. 'Updated order #1023 status to SHIPPED'. */
  description?: string | null;
  /** HTTP method + path of the request that triggered it. */
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Optional structured before/after snapshot for change diffing. */
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogQuery extends PaginationQuery {
  userId?: string;
  action?: string;
  resource?: string;
  from?: string; // ISO date
  to?: string; // ISO date
}

export type AuditLogList = Paginated<AuditLogDto>;
