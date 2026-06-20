import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Require one or more permissions to access a route. ALL listed permissions
 * must be satisfied (each honours the `*` and `<resource>:manage` wildcards).
 *
 * @example
 *   @Permissions('order:create')
 *   @Post() create() { ... }
 */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
