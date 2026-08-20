import { Injectable } from '@nestjs/common';
import { hasPermission } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { flattenAccess, USER_ACCESS_INCLUDE } from '../auth/user-access.util';

/**
 * Who is allowed to receive a notification.
 *
 * Notifications used to go to everyone signed in — a dispatch-only user got CRM
 * follow-up reminders for a screen they can't even open. Delivery now follows
 * the same permission that gates the page itself, so the audience can never
 * drift from what the sidebar shows.
 *
 * Resolving through {@link flattenAccess} (rather than querying the join tables
 * directly) is what makes super-admins work: their `*` wildcard is granted at
 * flatten time, not stored as a row.
 */
@Injectable()
export class NotificationAudienceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ids of ACTIVE users whose roles grant `permission`. */
  async userIdsWith(permission: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { status: 'active' },
      include: USER_ACCESS_INCLUDE,
    });
    return users.filter((u) => hasPermission(flattenAccess(u).permissions, permission)).map((u) => u.id);
  }

  /**
   * Ids of ACTIVE users granted ANY of `permissions`.
   *
   * For shop-floor news — a new order, an order edited, a dispatch, a Design
   * Track entry — where the point is that whoever works those screens finds out,
   * without anyone first having to be granted a dedicated "notify" permission.
   * Reusing the permissions that already gate the screens means an operator who
   * can open Dispatch hears about dispatch work by definition, while somebody
   * who only does accounts is not paged about it.
   */
  async userIdsWithAny(permissions: string[]): Promise<string[]> {
    if (!permissions.length) return [];
    const users = await this.prisma.user.findMany({
      where: { status: 'active' },
      include: USER_ACCESS_INCLUDE,
    });
    return users
      .filter((u) => {
        const held = flattenAccess(u).permissions;
        return permissions.some((p) => hasPermission(held, p));
      })
      .map((u) => u.id);
  }
}
