import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasAllPermissions, hasAnyPermission } from '@oms/shared';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSIONS_ANY_KEY, PERMISSIONS_KEY } from '../decorators/permissions.decorator';
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
    // @AnyPermission — satisfied by holding ONE of the listed permissions, for a
    // route that belongs to more than one job (see the decorator's note).
    const anyOf = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_ANY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const hasRequired = !!required && required.length > 0;
    const hasAnyOf = !!anyOf && anyOf.length > 0;
    if (!hasRequired && !hasAnyOf) return true;

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) throw new ForbiddenException('Not authenticated.');

    if (hasRequired && !hasAllPermissions(user.permissions, required)) {
      throw new ForbiddenException(`Missing required permission(s): ${required.join(', ')}`);
    }
    if (hasAnyOf && !hasAnyPermission(user.permissions, anyOf)) {
      throw new ForbiddenException(`Requires any one of: ${anyOf.join(', ')}`);
    }
    return true;
  }
}
