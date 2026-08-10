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

export const PERMISSIONS_ANY_KEY = 'permissions:any';

/**
 * Require ANY ONE of the listed permissions — for a route that legitimately
 * belongs to more than one job.
 *
 * Attaching a reference photo is the case this exists for: it writes to an
 * OrderItem, so it was gated on `order:update`, but it is done from the Dispatch
 * screen by packing staff who have no business editing orders. Requiring
 * `order:update` there meant a dispatch-only operator got "Missing required
 * permission(s): order:update" the moment they tried to add the photo the
 * dispatch itself demands.
 *
 * @example
 *   @AnyPermission('order:update', 'dispatch:create')
 */
export const AnyPermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_ANY_KEY, permissions);
