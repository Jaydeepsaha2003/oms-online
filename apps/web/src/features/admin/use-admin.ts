import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateRoleDto,
  CreateUserDto,
  RoleDto,
  SessionList,
  UpdateRoleDto,
  UpdateUserDto,
  UserDto,
  UserList,
  UserQuery,
} from '@oms/shared';
import { http } from '@/lib/api';

const USERS = ['users'] as const;
const ROLES = ['roles'] as const;
const SESSIONS = ['user-sessions'] as const;

/* ── Users ──────────────────────────────────────────────────────────────── */

export function useUsers(query: UserQuery) {
  return useQuery({
    queryKey: [...USERS, query],
    queryFn: () => http.get<UserList>('/users', { params: query }),
    placeholderData: (prev) => prev,
  });
}

/** A single user, for the full-page edit form (route param → direct fetch,
 *  independent of whatever page of the list happens to be loaded). */
export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: [...USERS, id],
    queryFn: () => http.get<UserDto>(`/users/${id}`),
    enabled: !!id,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserDto) => http.post<UserDto>('/users', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS }),
  });
}

export function useUpdateUser(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserDto) => http.patch<UserDto>(`/users/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS }),
  });
}

/** Admin sets another user's password (forgotten-password reset). Signs that
 *  user out of every device, so nothing keeps working on the old password. */
export function useSetUserPassword(id: string) {
  return useMutation({
    mutationFn: (password: string) => http.patch<{ ok: true }>(`/users/${id}/password`, { password }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => http.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS }),
  });
}

/* ── Sessions / devices (admin) ─────────────────────────────────────────── */

/** Active devices a user is signed in from. */
export function useUserSessions(userId: string | null) {
  return useQuery({
    queryKey: [...SESSIONS, userId],
    queryFn: () => http.get<SessionList>(`/users/${userId}/sessions`),
    enabled: !!userId,
  });
}

export function useRevokeUserSession(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => http.delete(`/users/${userId}/sessions/${sessionId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...SESSIONS, userId] }),
  });
}

export function useRevokeAllUserSessions(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http.delete(`/users/${userId}/sessions`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...SESSIONS, userId] }),
  });
}

/* ── Roles ──────────────────────────────────────────────────────────────── */

export function useRoles() {
  return useQuery({
    queryKey: ROLES,
    queryFn: () => http.get<RoleDto[]>('/roles'),
    staleTime: 30_000,
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoleDto) => http.post<RoleDto>('/roles', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ROLES }),
  });
}

export function useUpdateRole(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRoleDto) => http.patch<RoleDto>(`/roles/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ROLES }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => http.delete(`/roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ROLES }),
  });
}
