import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Inject the authenticated user (or one of its properties) into a handler.
 *
 * @example
 *   create(@CurrentUser() user: AuthenticatedUser) { ... }
 *   whoAmI(@CurrentUser('id') userId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    return data ? user?.[data] : user;
  },
);
