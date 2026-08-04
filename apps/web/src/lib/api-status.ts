import { useSyncExternalStore } from 'react';
import { setApiUnreachableHandler } from './api';

/**
 * Tracks whether the API is reachable, so a deploy looks like a brief pause
 * rather than a screen full of errors.
 *
 * Deliberately NOT a React context: `api.ts` needs to report a dead connection
 * from inside an axios interceptor, which has no component to hang a hook on.
 * A tiny module-level store keeps that one-way reporting simple, and
 * `useSyncExternalStore` gives components a correct subscription to it.
 *
 * The API only goes quiet here when it is restarting for a new build (it is
 * ready ~3s later), so the sequence is: a call fails → start polling
 * `/api/health` → the moment it answers, clear and let React Query refetch.
 */

/** Long enough that a routine restart finishes before anything is shown. */
const SHOW_AFTER_MS = 2_000;
const POLL_MS = 1_000;
/** What we tell the user to expect. Honest for a rebuild + relaunch. */
export const TYPICAL_RESTART_SECS = 20;

export interface ApiStatus {
  /** True once the API has been unreachable for longer than SHOW_AFTER_MS. */
  updating: boolean;
  /** Seconds since we first lost contact — drives the countdown. */
  downForSecs: number;
}

let status: ApiStatus = { updating: false, downForSecs: 0 };
let downSince = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function set(next: ApiStatus) {
  // Same-value guard: useSyncExternalStore re-renders on every emit, and the
  // 1s poll would otherwise re-render the whole shell while nothing is wrong.
  if (next.updating === status.updating && next.downForSecs === status.downForSecs) return;
  status = next;
  emit();
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/** Recovered — drop the banner and let the app refetch normally. */
function markUp() {
  stopPolling();
  downSince = 0;
  set({ updating: false, downForSecs: 0 });
}

async function probe(): Promise<void> {
  try {
    // Bypass axios entirely: its interceptor reports failures back here, and a
    // probe feeding its own detector would keep the banner alive forever.
    // `cache: no-store` so a service worker can't answer from cache.
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (res.ok) markUp();
  } catch {
    /* still down — the tick below keeps the countdown moving */
  }
}

function tick() {
  if (!downSince) return;
  const secs = Math.round((Date.now() - downSince) / 1000);
  set({ updating: Date.now() - downSince >= SHOW_AFTER_MS, downForSecs: secs });
  void probe();
}

/** Called by the axios interceptor when a request never reached the API. */
export function noteApiUnreachable(): void {
  if (downSince) return; // already watching
  downSince = Date.now();
  pollTimer = setInterval(tick, POLL_MS);
  void probe(); // it may already be back
}

/** Wire the interceptor to this store. Call once at boot (see main.tsx). */
export function startApiStatusWatch(): void {
  setApiUnreachableHandler(noteApiUnreachable);
}

export function useApiStatus(): ApiStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
    () => status,
  );
}

/**
 * Whether a *write* should be attempted right now. Reads are always allowed —
 * they either serve cached data or retry themselves — but a save during the
 * gap would fail and risk losing what the user typed, so callers block it and
 * show the banner's message instead.
 */
export const canWriteNow = () => !status.updating;
