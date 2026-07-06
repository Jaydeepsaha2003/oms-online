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
