import { Prisma } from '@prisma/client';
import { ALL_PERMISSIONS, SUPER_ADMIN_ROLE } from '@oms/shared';

/** Prisma include that loads a user together with roles → permissions. */
export const USER_ACCESS_INCLUDE = {
  roles: {
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  },
} satisfies Prisma.UserInclude;

export type UserWithAccess = Prisma.UserGetPayload<{ include: typeof USER_ACCESS_INCLUDE }>;

/**
 * Flatten a user's roles into role names + the de-duplicated set of permission
 * keys. Super admins additionally receive the `*` wildcard so newly added
 * permissions are granted automatically.
 */
export function flattenAccess(user: UserWithAccess): { roles: string[]; permissions: string[] } {
  const roles = user.roles.map((ur) => ur.role.name);
  const permissions = new Set<string>();
  for (const ur of user.roles) {
    for (const rp of ur.role.permissions) {
      permissions.add(rp.permission.key);
    }
  }
  if (roles.includes(SUPER_ADMIN_ROLE)) permissions.add(ALL_PERMISSIONS);
  return { roles, permissions: [...permissions] };
}
