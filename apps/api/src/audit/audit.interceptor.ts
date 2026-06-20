import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDIT_KEY, type AuditOptions } from '../common/decorators/audit.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AuditService } from './audit.service';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Records an audit entry for every mutating request (and any route explicitly
 * annotated with @Audit). Captures who (user), what (action/resource), when,
 * and from where (ip/user-agent) — plus the resulting status code.
 *
 * Registered globally from AuditModule.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only HTTP requests are audited here.
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const meta = this.reflector.getAllAndOverride<AuditOptions | undefined>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Auth routes (login/refresh/logout) are audited explicitly by AuthService;
    // skip the generic pass unless a route opts in with @Audit.
    const isAuthRoute = req.path.includes('/auth/');
    const shouldAudit = Boolean(meta) || (MUTATING_METHODS.has(req.method) && !isAuthRoute);
    if (!shouldAudit) return next.handle();

    const user = req.user as AuthenticatedUser | undefined;
    const base = {
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      action: meta?.action ?? req.method.toLowerCase(),
      resource: meta?.resource ?? this.resourceFromPath(req),
      resourceId: (req.params?.id as string) ?? null,
      description: meta?.description ?? null,
      method: req.method,
      path: req.originalUrl,
      ip: this.clientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    };

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();
          void this.audit.record({ ...base, statusCode: res.statusCode });
        },
        error: (err) => {
          const statusCode = typeof err?.status === 'number' ? err.status : 500;
          void this.audit.record({
            ...base,
            statusCode,
            description: base.description ?? `Failed: ${err?.message ?? 'error'}`,
          });
        },
      }),
    );
  }

  /** Best-effort resource name from the URL when @Audit isn't supplied. */
  private resourceFromPath(req: Request): string {
    const parts = req.path.split('/').filter(Boolean); // e.g. ['api','orders','123']
    const idx = parts[0] === 'api' ? 1 : 0;
    return parts[idx] ?? 'unknown';
  }

  private clientIp(req: Request): string | null {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
    return req.ip ?? req.socket?.remoteAddress ?? null;
  }
}
