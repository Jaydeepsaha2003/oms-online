/** User / role / permission shapes shared across the stack. */

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
  createdAt: string;
  updatedAt: string;
}

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
