import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasAllPermissions } from '@oms/shared';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Enforces @Permissions(...) metadata. Runs after JwtAuthGuard, so the user is
 * already attached. Routes with no @Permissions are allowed (authentication is
 * still required unless @Public).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) throw new ForbiddenException('Not authenticated.');

    if (!hasAllPermissions(user.permissions, required)) {
      throw new ForbiddenException(
        `Missing required permission(s): ${required.join(', ')}`,
      );
    }
    return true;
  }
}
