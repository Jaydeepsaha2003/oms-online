/**
 * A small in-app flight recorder for network behaviour.
 *
 * Exists because describing "it's still slow" over chat loses exactly the
 * detail that matters: whether a request failed or merely waited, how long it
 * waited, and whether it happened right after the phone woke up. Over a VPN
 * that iOS pauses on every screen-off, that timing IS the diagnosis.
 *
 * Deliberately tiny: a capped ring buffer in memory, mirrored to localStorage
 * so a reload (or the PWA restoring a snapshot) doesn't lose the evidence.
 * Nothing is sent anywhere — the user reads it off the Settings screen.
 */

export type NetEventKind = 'ok' | 'fail' | 'resume' | 'online' | 'offline';

export interface NetEvent {
  /** Epoch ms. */
  t: number;
  kind: NetEventKind;
  /** Short label — "GET /orders", or "app resumed". */
  label: string;
  /** Round-trip in ms, for request outcomes. */
  ms?: number;
  /** Status code, axios error code, or a short note. */
  detail?: string;
}

const MAX_EVENTS = 200;
const STORAGE_KEY = 'oms:net-diagnostics';

function load(): NetEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as NetEvent[]).slice(-MAX_EVENTS) : [];
  } catch {
    return [];
  }
}

let events: NetEvent[] = typeof window === 'undefined' ? [] : load();
const listeners = new Set<() => void>();

// localStorage writes are synchronous; a burst of requests would otherwise
// serialize the whole buffer on every single one.
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush(): void {
  if (flushTimer || typeof window === 'undefined') return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch {
      /* quota or private mode — the in-memory buffer still works */
    }
  }, 1000);
}

export function recordNetEvent(kind: NetEventKind, label: string, extra?: { ms?: number; detail?: string }): void {
  // A NEW array each time, so useSyncExternalStore sees the reference change.
  events = [...events, { t: Date.now(), kind, label, ...extra }].slice(-MAX_EVENTS);
  scheduleFlush();
  listeners.forEach((fn) => fn());
}

export function getNetEvents(): NetEvent[] {
  return events;
}

export function clearNetEvents(): void {
  events = [];
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

export function subscribeToNetEvents(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Trim a URL to something readable in a list: "/orders?page=2" -> "/orders". */
export function shortUrl(url?: string): string {
  if (!url) return '?';
  return url.split('?')[0].replace(/^\/api/, '') || '/';
}
