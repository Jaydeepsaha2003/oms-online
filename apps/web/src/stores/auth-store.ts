import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthResult, AuthUser } from '@oms/shared';

/**
 * Session store. The access token is kept here (and mirrored to localStorage so
 * a page refresh doesn't drop the session); the refresh token lives only in an
 * httpOnly cookie and is never exposed to JS.
 */
interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  /** True while we attempt to restore a session on first load. */
  isBootstrapping: boolean;

  setSession: (auth: AuthResult) => void;
  setUser: (user: AuthUser | null) => void;
  setBootstrapping: (value: boolean) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      isBootstrapping: true,

      setSession: (auth) => set({ accessToken: auth.accessToken, user: auth.user }),
      setUser: (user) => set({ user }),
      setBootstrapping: (value) => set({ isBootstrapping: value }),
      clear: () => set({ accessToken: null, user: null }),
    }),
    {
      name: 'oms-auth',
      partialize: (state) => ({ accessToken: state.accessToken, user: state.user }),
    },
  ),
);
