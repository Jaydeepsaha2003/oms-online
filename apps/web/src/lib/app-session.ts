/**
 * App-run lifecycle for the installed (home-screen) app.
 *
 * The session is persisted to localStorage and backed by a 15-day refresh
 * cookie, so killing the app and reopening it silently restored the session —
 * the login screen never rendered, and the intro video with it. On a phone the
 * app is expected to behave like an app: closing it ends the session.
 *
 * Scope is deliberately the installed app only. In a desktop browser a tab is
 * closed and reopened all day long, and signing the user out each time would be
 * an obstacle, not a security gain.
 */

/** sessionStorage: present for as long as ONE run of the app lives. */
const RUN_MARKER = 'oms:app-run';
/** localStorage: when the app was last known to be alive (epoch ms). */
const LAST_ALIVE = 'oms:app-last-alive';

/**
 * How long after the app vanished a relaunch still counts as "not the user's
 * doing" and silently restores the session.
 *
 * Zero — deliberately — because a time window cannot tell the two cases apart,
 * and gets the trade-off backwards. A user killing the app reopens it seconds
 * later, so ANY window long enough to be useful also swallows the very case
 * this feature exists for. An OS eviction, by contrast, happens after the app
 * has been backgrounded for a long time, which no short window would cover.
 * `document.wasDiscarded` below is the signal that actually distinguishes them.
 *
 * Set this to e.g. 120_000 to trade "kill always signs out" for "a relaunch
 * within two minutes never does".
 */
const EVICTION_GRACE_MS = 0;

const read = (store: Storage, key: string): string | null => {
  try {
    return store.getItem(key);
  } catch {
    return null; // private mode / storage disabled
  }
};

const write = (store: Storage, key: string, value: string): void => {
  try {
    store.setItem(key, value);
  } catch {
    /* nothing we can do, and nothing depends on it succeeding */
  }
};

/** Running as an installed app (home-screen / standalone window) rather than a browser tab. */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return window.matchMedia?.('(display-mode: standalone)').matches === true || iosStandalone;
}

let killedThisLaunch: boolean | null = null;

/**
 * Did this launch follow the user closing the app?
 *
 * `sessionStorage` is the primitive that matches an app run: it survives a
 * reload and any amount of backgrounding, and dies with the app. So a missing
 * marker means a genuinely fresh start.
 *
 * The one thing that must NOT be read as a kill is the browser discarding the
 * page on its own under memory pressure. Chromium reports exactly that via
 * `document.wasDiscarded`, and it is a real signal rather than a guess at
 * intent. iOS Safari has no equivalent, so there a memory eviction does end the
 * session — the honest failure direction, since it errs toward asking for a
 * sign-in rather than silently keeping one alive.
 *
 * Memoised: the answer must not change once `markAppRunning` has written the
 * marker, and callers shouldn't have to care about ordering.
 */
export function appWasKilled(): boolean {
  if (killedThisLaunch !== null) return killedThisLaunch;

  if (!isInstalledApp()) return (killedThisLaunch = false);
  if (read(window.sessionStorage, RUN_MARKER)) return (killedThisLaunch = false);

  if ((document as Document & { wasDiscarded?: boolean }).wasDiscarded) return (killedThisLaunch = false);

  if (EVICTION_GRACE_MS > 0) {
    const last = Number(read(window.localStorage, LAST_ALIVE) ?? 0);
    if (last && Date.now() - last <= EVICTION_GRACE_MS) return (killedThisLaunch = false);
  }

  return (killedThisLaunch = true);
}

/**
 * Claim this app run and keep its liveness stamp fresh.
 *
 * `pagehide`/`visibilitychange` matter more than the interval: they are the
 * last code that runs before the app goes away, and on iOS they are the only
 * lifecycle events that fire reliably at all. Returns a cleanup function.
 */
export function markAppRunning(): () => void {
  if (typeof window === 'undefined') return () => {};

  const stamp = () => write(window.localStorage, LAST_ALIVE, String(Date.now()));
  write(window.sessionStorage, RUN_MARKER, '1');
  stamp();

  const onHide = () => stamp();
  const timer = window.setInterval(stamp, 30_000);
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onHide);

  return () => {
    window.clearInterval(timer);
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onHide);
  };
}
