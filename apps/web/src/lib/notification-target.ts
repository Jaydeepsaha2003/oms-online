import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Taking a tapped notification to the page it is about.
 *
 * The service worker knows the right URL (see `notificationTarget` in
 * public/sw.js) but on iOS it cannot apply it: an installed PWA is launched at
 * the manifest's `start_url` and WebKit ignores the URL passed to
 * `clients.openWindow()` / `WindowClient.navigate()` in standalone mode. A
 * dispatch alert therefore opened the dashboard, however correct the worker's
 * URL was.
 *
 * So the worker leaves the target in the cache and the app routes itself there
 * — a client-side navigation nothing can override. A running app skips all that
 * and gets a postMessage instead.
 */
const PENDING_TARGET_URL = '/__pending-notification';

/** Same-origin path check. `startsWith('/')` alone is not one: "//host/path" is
 *  protocol-relative and the browser resolves it to another origin, so a stash
 *  or a message carrying one would navigate straight off the app. */
function isInAppPath(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//');
}

/** A stash older than this is not what this launch is about — a phone left on a
 *  charger overnight should not jump to yesterday's dispatch. */
const MAX_AGE_MS = 5 * 60 * 1000;

/** Delete the stash from every cache the worker might have written it to. The
 *  cache NAME is versioned (`oms-v15`) and bumps whenever the worker's caching
 *  rules change, so the read side never names it. */
async function clearPendingTarget(): Promise<void> {
  const keys = await caches.keys();
  await Promise.all(
    keys.map((k) =>
      caches
        .open(k)
        .then((c) => c.delete(PENDING_TARGET_URL))
        .catch(() => false),
    ),
  );
}

/** The URL a notification tap asked for, or null. Reading it consumes it —
 *  including when it is too old to use, so a declined target cannot sit there
 *  and hijack an unrelated launch later. */
export async function takePendingNotificationTarget(): Promise<string | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const hit = await caches.match(PENDING_TARGET_URL);
    // Read the body BEFORE clearing. A Response keeps its body once handed over,
    // so the order is not strictly load-bearing — but "parse, then delete" is
    // true regardless of that, and does not rest on it.
    const raw = hit ? ((await hit.json().catch(() => null)) as { url?: unknown; at?: unknown } | null) : null;
    await clearPendingTarget();
    if (!raw) return null;
    const { url, at } = raw;
    if (!isInAppPath(url)) return null;
    if (typeof at !== 'number' || Date.now() - at > MAX_AGE_MS) return null;
    return url;
  } catch {
    return null; // a malformed or unreadable stash is not worth failing a boot over
  }
}

/** Mounted once inside the router. Handles both halves: the message a running
 *  app gets, and the stash a cold-started one has to go looking for. */
export function useNotificationNavigation(): void {
  const navigate = useNavigate();
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | undefined;
      if (data?.type !== 'NOTIFICATION_NAVIGATE') return;
      if (isInAppPath(data.url)) navigate(data.url);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  useEffect(() => {
    // Wait for the session: navigating mid-bootstrap means ProtectedRoute sees
    // no user yet and bounces the whole thing to /login.
    if (isBootstrapping) return;
    let cancelled = false;
    void takePendingNotificationTarget().then((url) => {
      if (!cancelled && url) navigate(url, { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [isBootstrapping, navigate]);
}
