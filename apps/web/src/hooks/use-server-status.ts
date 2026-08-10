import { useEffect, useRef, useState } from 'react';

/**
 * Live connectivity indicator for the OMS server.
 *
 * A browser client can only reliably tell two root causes apart:
 *   1. This DEVICE is offline        → navigator.onLine === false
 *   2. The SERVER is unreachable     → the device is online but /api/health
 *      fails/times out. This one bucket covers BOTH "the server app is stopped
 *      (no ports up)" AND "the host PC is switched off" — from a browser those
 *      are indistinguishable (nothing else on the host answers to ask), so they
 *      honestly share one message.
 *
 * The health endpoint is @Public, so this needs no auth and adds negligible
 * load (one tiny GET every 10s, only while the tab is visible).
 */
const HEALTH_URL = `${import.meta.env.VITE_API_URL || '/api'}/health`;
const POLL_MS = 10_000;
// 8s, not 5s. Phones reach this server through the router's OpenVPN, where a
// cell handoff (5G↔LTE, or moving between towers) re-establishes the tunnel and
// one round trip can easily outlast 5 seconds without anything being wrong.
const TIMEOUT_MS = 8_000;
// A failed check is retried sooner than the normal cadence, so a blip is
// confirmed or cleared quickly instead of leaving the UI stale for 10s.
const RETRY_MS = 3_000;
/**
 * Report "offline" only after this many CONSECUTIVE failures. One dropped or
 * slow probe — a Wi-Fi hiccup, a cell handoff, a moment of load with several
 * people working at once — is not an outage, and reporting it as one made a
 * perfectly healthy server look like it kept "switching off": the dot flickered
 * red/green on every handoff. Recovery stays instant (one success clears it);
 * only the bad news waits for a second opinion. Worst case a real outage now
 * shows after ~2 checks instead of 1, which is still seconds.
 */
const FAILURES_BEFORE_OFFLINE = 2;

const REASON_DEVICE = 'This device has no internet or Wi-Fi connection.';
const REASON_SERVER =
  'Can’t reach the OMS server — the server app may be stopped, or the host PC may be switched off.';
/** The server ANSWERED, just not with a success. It is definitively running,
 *  so saying "it may be switched off" would be plainly wrong. */
const reasonHttp = (code: number) =>
  `The OMS server is running and reachable, but answered with an error (HTTP ${code}). It should recover on its own; if this keeps up, check the server log.`;

export type ServerStatus = 'connected' | 'offline';

export interface ServerStatusState {
  status: ServerStatus;
  /** null when connected; a human-readable reason when offline. */
  reason: string | null;
  /** true before the first result and while a re-check is in flight. */
  checking: boolean;
}

export function useServerStatus(): ServerStatusState {
  const [state, setState] = useState<ServerStatusState>({ status: 'connected', reason: null, checking: true });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const alive = useRef(true);
  // Consecutive failed checks; reset by any success. See FAILURES_BEFORE_OFFLINE.
  const fails = useRef(0);
  // True while a health request is in flight. check() runs from five places —
  // mount, the scheduled poll, `focus`, `online` and `visibilitychange` — and a
  // phone fires focus AND visibilitychange together every time the app is opened
  // or resumed, usually with a poll already due. Without this guard those all run
  // as separate checks, and ONE dropped moment on the link failed each of them
  // independently: fails jumped 0→2 (or 3) in a single tick, crossed
  // FAILURES_BEFORE_OFFLINE and showed "Offline" instantly — the exact flapping
  // the counter was added to prevent. Collapsing them to one in-flight check
  // makes a blip count once, which is what "consecutive failures" has to mean.
  const inFlight = useRef(false);

  useEffect(() => {
    alive.current = true;

    function schedule(delay: number = POLL_MS) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(check, delay);
    }

    /** A check failed. Hold the current status until enough failures pile up. */
    function onCheckFailed(reason: string) {
      fails.current += 1;
      if (fails.current >= FAILURES_BEFORE_OFFLINE) {
        setState({ status: 'offline', reason, checking: false });
      } else {
        // Not confident yet — leave the indicator as it was rather than
        // flashing red, and come back sooner than the normal cadence.
        setState((s) => ({ ...s, checking: false }));
      }
      schedule(fails.current >= FAILURES_BEFORE_OFFLINE ? POLL_MS : RETRY_MS);
    }

    async function check() {
      if (!alive.current) return;
      // A check is already running — let it be the one that reports. Returning
      // without rescheduling is deliberate: the in-flight check schedules the
      // next poll itself on every one of its exit paths.
      if (inFlight.current) return;
      // Don't spend requests while the tab is hidden — reschedule and wait.
      if (typeof document !== 'undefined' && document.hidden) return schedule();
      // Device-level offline is instantly knowable and unambiguous (the OS says
      // there's no network at all), so it skips the tolerance above and reports
      // immediately — there is nothing transient to wait out.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        fails.current = FAILURES_BEFORE_OFFLINE; // this one is certain, don't wait it out
        setState({ status: 'offline', reason: REASON_DEVICE, checking: false });
        return schedule();
      }
      setState((s) => ({ ...s, checking: true }));
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      inFlight.current = true;
      try {
        const res = await fetch(HEALTH_URL, { signal: ctrl.signal, cache: 'no-store' });
        if (!alive.current) return;
        // Any answer at all — including 429 — proves the server is up and
        // listening. Only a total lack of response can mean it's stopped.
        // 429 in particular is a healthy server deliberately shedding load, and
        // reporting that as "switched off" is what made busy periods look like
        // the server kept dying.
        if (res.ok || res.status === 429) {
          fails.current = 0;
          setState({ status: 'connected', reason: null, checking: false });
          schedule();
        } else {
          // It answered, just not with a success — so the reason says "running
          // but erroring", never "may be switched off".
          onCheckFailed(reasonHttp(res.status));
        }
      } catch {
        if (!alive.current) return;
        onCheckFailed(navigator.onLine === false ? REASON_DEVICE : REASON_SERVER);
      } finally {
        clearTimeout(to);
        // In `finally`, never in a branch: if this ever failed to reset, every
        // future check would return at the guard above and the indicator would
        // freeze on whatever it last showed, with no polling at all.
        inFlight.current = false;
      }
    }

    // Re-check immediately on the events that most often mean the answer changed.
    const recheck = () => check();
    const onOffline = () => setState({ status: 'offline', reason: REASON_DEVICE, checking: false });
    const onVisible = () => {
      if (!document.hidden) check();
    };
    window.addEventListener('focus', recheck);
    window.addEventListener('online', recheck);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);

    check();

    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener('focus', recheck);
      window.removeEventListener('online', recheck);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return state;
}
