import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import type { AuthResult, AuthUser, LoginDto, PinLoginDto } from '@oms/shared';
import { http, refreshAccessToken } from '@/lib/api';
import { appWasKilled, markAppRunning } from '@/lib/app-session';
import { disconnectNotificationsSocket } from '@/lib/notifications-socket';
import { useAuthStore } from '@/stores/auth-store';

// Sign-in must fail LOUDLY rather than hang. The shared axios instance sets no
// `timeout`, and axios defaults to 0 = wait forever — so with no route to the
// server (phone on the VPN with the tunnel not carrying traffic, or pointed at a
// hostname that doesn't resolve off-LAN) the button sat on "Signing in…"
// indefinitely with nothing to tell the user what was wrong. 20s is well past a
// slow-but-working login over the router's OpenVPN, and short enough that a dead
// path surfaces as a real error the user can act on. `/auth/me` and
// `/auth/refresh` below already do this; login was the one that was missed.
const LOGIN_TIMEOUT_MS = 20_000;

/** Log in with email + password; stores the session on success. */
export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (dto: LoginDto) => http.post<AuthResult>('/auth/login', dto, { timeout: LOGIN_TIMEOUT_MS }),
    onSuccess: (auth) => setSession(auth),
  });
}

/** Quick login with email + numeric PIN; stores the session on success. */
export function usePinLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (dto: PinLoginDto) => http.post<AuthResult>('/auth/pin-login', dto, { timeout: LOGIN_TIMEOUT_MS }),
    onSuccess: (auth) => setSession(auth),
  });
}

/** Revoke the refresh token server-side and clear the local session. */
export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  return useMutation({
    mutationFn: () => http.post('/auth/logout'),
    onSettled: () => {
      // Drop the live socket too — it's authenticated with the token being
      // revoked. Left open, the next sign-in would reuse this dead connection
      // (connectNotificationsSocket is a no-op while one exists) and the new
      // session would never receive server pushes.
      disconnectNotificationsSocket();
      clear();
    },
  });
}

/**
 * Restore a session on first load: validate a stored access token via /auth/me,
 * or attempt a cookie-based refresh. Runs exactly once at the app root.
 */
export function useBootstrapAuth(): void {
  useEffect(() => {
    let active = true;

    // The installed app was closed since the last run: end the session before
    // anything can restore it. Clearing the local store alone is not enough —
    // the branch below would still trade the 15-day refresh cookie for a fresh
    // session and walk straight past the login screen — so the cookie is
    // revoked server-side too, and this returns without attempting a refresh.
    if (appWasKilled()) {
      useAuthStore.getState().clear();
      // Best-effort: an offline relaunch still shows the login screen, and the
      // stale refresh token expires on its own.
      void http.post('/auth/logout').catch(() => {});
      useAuthStore.getState().setBootstrapping(false);
      return markAppRunning();
    }

    const stopHeartbeat = markAppRunning();
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
        stopHeartbeat();
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
      stopHeartbeat();
    };
  }, []);
}
