import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AuthResult, AuthUser, LoginDto, PinLoginDto } from '@oms/shared';
import { http } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

/** Log in with email + password; stores the session on success. */
export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (dto: LoginDto) => http.post<AuthResult>('/auth/login', dto),
    onSuccess: (auth) => setSession(auth),
  });
}

/** Quick login with email + numeric PIN; stores the session on success. */
export function usePinLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (dto: PinLoginDto) => http.post<AuthResult>('/auth/pin-login', dto),
    onSuccess: (auth) => setSession(auth),
  });
}

/** Revoke the refresh token server-side and clear the local session. */
export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  return useMutation({
    mutationFn: () => http.post('/auth/logout'),
    onSettled: () => clear(),
  });
}

/**
 * Restore a session on first load: validate a stored access token via /auth/me,
 * or attempt a cookie-based refresh. Runs exactly once at the app root.
 */
export function useBootstrapAuth(): void {
  useEffect(() => {
    let active = true;
    const { accessToken } = useAuthStore.getState();

    (async () => {
      try {
        if (accessToken) {
          const me = await http.get<AuthUser>('/auth/me');
          if (active) useAuthStore.getState().setUser(me);
        } else {
          const auth = await http.post<AuthResult>('/auth/refresh');
          if (active) useAuthStore.getState().setSession(auth);
        }
      } catch {
        if (active) useAuthStore.getState().clear();
      } finally {
        if (active) useAuthStore.getState().setBootstrapping(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);
}
