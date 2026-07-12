import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import type { AuthResult, AuthUser, LoginDto, PinLoginDto } from '@oms/shared';
import { http, refreshAccessToken } from '@/lib/api';
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
    const { accessToken, user } = useAuthStore.getState();

    // A device with a persisted session renders the app IMMEDIATELY — no
    // network round-trip on the critical path (over the VPN that round-trip
    // alone kept the splash screen up for seconds). The token is revalidated
    // in the background: a stale one goes through the shared single-flight
    // refresh, which only drops the session if the server rejects the cookie.
    // Data requests racing ahead with an expired token are fine too — the api
    // interceptor refreshes on their 401 and retries them transparently.
    if (accessToken && user) {
      useAuthStore.getState().setBootstrapping(false);
      void (async () => {
        try {
          const me = await http.get<AuthUser>('/auth/me', { timeout: 15_000 });
          if (active) useAuthStore.getState().setUser(me);
        } catch (err) {
          const status = axios.isAxiosError(err) ? err.response?.status : undefined;
          if (status === 401 || status === 403) await refreshAccessToken();
          // Network error/timeout: keep the persisted session and move on.
        }
      })();
      return () => {
        active = false;
      };
    }

    // No persisted session: block on one cookie-refresh attempt to decide
    // between the app and the login page.
    void (async () => {
      try {
        const auth = await http.post<AuthResult>('/auth/refresh', undefined, { timeout: 10_000 });
        if (active) useAuthStore.getState().setSession(auth);
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
