import { queryClient } from './query';

/**
 * Keeps an installed PWA current — written for iOS home-screen apps.
 *
 * On iOS a home-screen app is frozen and resumed rather than reloaded: the page
 * never runs again, so the one-shot `serviceWorker.register()` in main.tsx never
 * re-checks for a new worker. Even force-quitting often restores the snapshot.
 * The result is an app that keeps running last week's build no matter how many
 * times it is reopened.
 *
 * So on every foreground we explicitly:
 *   1. ask the browser to re-fetch sw.js (`registration.update()`), which — with
 *      the new worker's `skipWaiting()` + `clients.claim()` — triggers
 *      `controllerchange` in main.tsx and reloads the app onto the new build;
 *   2. refetch active queries, so the data on screen is current even when the
 *      code itself is already up to date (the common case).
 */

// iOS fires visibilitychange several times around a resume; don't hammer the
// network with an update check on each one.
const MIN_CHECK_GAP_MS = 10_000;
let lastCheck = 0;

async function checkForNewVersion(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    // update() re-fetches sw.js bypassing the HTTP cache (registration used
    // updateViaCache: 'none'). If it differs by even a byte, the new worker
    // installs, skips waiting, claims this client → main.tsx reloads the app.
    await reg?.update();
  } catch {
    /* offline or unsupported — nothing to do, we retry on the next foreground */
  }
}

/** Refetch what's on screen so a reopened app shows current data, not a snapshot. */
function refreshData(): void {
  void queryClient.invalidateQueries({ type: 'active' });
}

/** The hashed entry bundle this page is running, e.g. "/assets/index-DKgepo0u.js".
 *  Vite content-hashes it, so its name changes on every build that changes code. */
function runningBundle(): string | null {
  const els = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'));
  const src = els.map((e) => e.getAttribute('src') ?? '').find((s) => /\/assets\/index-.*\.js$/.test(s));
  return src || null;
}

/**
 * Detects a new deploy without needing sw.js to change: fetch the current
 * index.html straight from the server and compare its hashed entry bundle with
 * the one this page is running. Different hash ⇒ a new build is live ⇒ reload.
 *
 * This is what actually fixes the iOS home-screen app, where the page is frozen
 * and resumed (never re-requested), so it can otherwise run an old bundle
 * indefinitely. `_v` busts every cache layer and is excluded from SW caching.
 */
async function reloadIfNewBuildDeployed(): Promise<void> {
  const current = runningBundle();
  if (!current) return; // dev server (unhashed /src/main.tsx) — nothing to compare
  try {
    const res = await fetch(`/?_v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const html = await res.text();
    const latest = /src="([^"]*\/assets\/index-[^"]*\.js)"/.exec(html)?.[1];
    if (!latest) return;
    // Compare just the filenames so a differing origin/base can't cause a loop.
    const name = (p: string) => p.split('/').pop();
    if (name(latest) !== name(current)) announceUpdate();
    // Running the newest bundle — forget any earlier failed reload attempts so a
    // future update starts from a clean count rather than jumping to the purge.
    else clearReloadGuard();
  } catch {
    /* offline / server down — keep running the current build */
  }
}

/* ── Applying a new build without eating someone's work ────────────────────── */

/**
 * A reload mid-entry throws away whatever is typed but not yet saved, which is
 * exactly when it hurts most. So a new build waits: it applies itself the
 * moment the screen looks idle, and until then it's just a pill the user can
 * tap when they're ready.
 */
let updatePending = false;
const updateListeners = new Set<(pending: boolean) => void>();

/** True when reloading now would cost the user nothing. */
function safeToReloadNow(): boolean {
  // Mid-typing, or a dialog is open (a form, a confirm) — their work is on screen.
  const el = document.activeElement;
  const typing = !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  const isEditable = !!el && (el as HTMLElement).isContentEditable;
  const dialogOpen = !!document.querySelector('[role="dialog"], [data-sonner-toast]');
  return !typing && !isEditable && !dialogOpen;
}

/**
 * How many plain reloads to try before assuming a reload alone can't land the
 * new build. Counted per tab/session, so a normal update (one reload) never
 * escalates, but a client stuck on a stale shell stops looping and gets purged.
 */
const RELOAD_GUARD_KEY = 'oms:update-reload-attempts';
const MAX_PLAIN_RELOADS = 2;

const attempts = (): number => Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? '0');
/** Called once we're confirmed to be running the newest bundle. */
function clearReloadGuard(): void {
  try {
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
  } catch {
    /* private mode / storage disabled — the guard just doesn't persist */
  }
}

/** Ask the service worker to bin its caches, then reload. Last resort for a
 *  client whose reloads keep being answered from a stale shell. */
async function hardRefresh(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sw = reg?.active;
    if (sw) {
      await new Promise<void>((resolve) => {
        const ch = new MessageChannel();
        // Don't wait forever if the worker never answers.
        const t = setTimeout(resolve, 3000);
        ch.port1.onmessage = () => {
          clearTimeout(t);
          resolve();
        };
        sw.postMessage({ type: 'CLEAR_ALL' }, [ch.port2]);
      });
    }
  } catch {
    /* fall through — reloading is still worth a try */
  }
  clearReloadGuard();
  window.location.reload();
}

export function applyUpdateNow(): void {
  let n = MAX_PLAIN_RELOADS; // assume the worst if sessionStorage is unavailable
  try {
    n = attempts() + 1;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(n));
  } catch {
    /* storage disabled — go straight to the purge path below */
  }
  // Reloading twice without the bundle changing means something is answering
  // the navigation from cache. Purge and reload instead of looping.
  if (n > MAX_PLAIN_RELOADS) {
    void hardRefresh();
    return;
  }
  window.location.reload();
}

export function subscribeToUpdates(fn: (pending: boolean) => void): () => void {
  updateListeners.add(fn);
  fn(updatePending);
  return () => updateListeners.delete(fn);
}

function announceUpdate(): void {
  if (updatePending) return;
  updatePending = true;
  updateListeners.forEach((fn) => fn(true));
  // Re-check periodically: the user will finish the form eventually, and we
  // apply it the first quiet moment after that without them doing anything.
  const timer = window.setInterval(() => {
    if (safeToReloadNow()) {
      window.clearInterval(timer);
      applyUpdateNow();
    }
  }, 5_000);
  if (safeToReloadNow()) {
    window.clearInterval(timer);
    applyUpdateNow();
  }
}

/** Call once on boot (see main.tsx). Safe to call more than once. */
export function watchForAppUpdates(): void {
  if (typeof document === 'undefined') return;

  const onForeground = () => {
    if (document.visibilityState !== 'visible') return;
    // iOS fires visibilitychange/focus/pageshow several times around a single
    // resume — collapse that burst into one check.
    const now = Date.now();
    if (now - lastCheck < MIN_CHECK_GAP_MS) return;
    lastCheck = now;

    void checkForNewVersion();
    void reloadIfNewBuildDeployed();
    refreshData();
  };

  document.addEventListener('visibilitychange', onForeground);
  // iOS restoring from the back/forward cache doesn't always fire
  // visibilitychange — pageshow with persisted=true is the reliable signal.
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) onForeground();
  });
  // Standalone iOS apps resuming can land here rather than on visibilitychange.
  window.addEventListener('focus', onForeground);

  // And check once at startup, so a cold open also lands on the newest build.
  void checkForNewVersion();
  void reloadIfNewBuildDeployed();
}
