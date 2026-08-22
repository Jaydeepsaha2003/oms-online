/** User / role / permission shapes shared across the stack. */

import type { Paginated, PaginationQuery } from './common';

export interface PermissionDto {
  id: string;
  key: string;
  resource: string;
  action: string;
  label: string;
  group: string;
}

export interface RoleDto {
  id: string;
  name: string;
  label: string;
  description?: string | null;
  isSystem: boolean;
  permissions: string[]; // permission keys
  userCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type UserStatus = 'active' | 'disabled' | 'invited';

export interface UserDto {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  roles: { id: string; name: string; label: string }[];
  lastLoginAt?: string | null;
  /**
   * When this user last DID something (their most recent audit entry), as
   * opposed to when they last signed in. A signed-in user who then walked away
   * has a recent login and no recent activity, and the two must not be confused
   * (spec §13.1).
   */
  lastActiveAt?: string | null;
  /** Live sign-ins right now — refresh tokens neither revoked nor expired. */
  activeSessions?: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserQuery extends PaginationQuery {
  status?: UserStatus;
}
export type UserList = Paginated<UserDto>;

export interface CreateUserDto {
  email: string;
  name: string;
  password: string;
  roleIds: string[];
  status?: UserStatus;
}

export interface UpdateUserDto {
  name?: string;
  status?: UserStatus;
  roleIds?: string[];
}

export interface CreateRoleDto {
  name: string;
  label: string;
  description?: string;
  permissions: string[];
}

export interface UpdateRoleDto {
  label?: string;
  description?: string;
  permissions?: string[];
}
