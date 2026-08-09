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
const TIMEOUT_MS = 8_000;
/**
 * How many checks in a row must fail before the user is told the server is
 * down. One dropped or slow probe — a Wi-Fi hiccup, a moment of load — is not
 * an outage, and reporting it as one made a perfectly healthy server look like
 * it kept "switching off", especially with several people working at once.
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
  const failures = useRef(0);

  useEffect(() => {
    alive.current = true;

    function schedule() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(check, POLL_MS);
    }

    async function check() {
      if (!alive.current) return;
      // Don't spend requests while the tab is hidden — reschedule and wait.
      if (typeof document !== 'undefined' && document.hidden) return schedule();
      // Device-level offline is instantly knowable; no request needed.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        failures.current = FAILURES_BEFORE_OFFLINE; // this one is certain, don't wait it out
        setState({ status: 'offline', reason: REASON_DEVICE, checking: false });
        return schedule();
      }
      setState((s) => ({ ...s, checking: true }));
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

      /** Only report an outage once it has been confirmed by a repeat check. */
      const fail = (reason: string) => {
        failures.current += 1;
        if (failures.current >= FAILURES_BEFORE_OFFLINE) setState({ status: 'offline', reason, checking: false });
        else setState((s) => ({ ...s, checking: false }));
      };
      const ok = () => {
        failures.current = 0;
        setState({ status: 'connected', reason: null, checking: false });
      };

      try {
        const res = await fetch(HEALTH_URL, { signal: ctrl.signal, cache: 'no-store' });
        if (!alive.current) return;
        // Any answer at all — including 429/5xx — proves the server is up and
        // listening. Only a total lack of response can mean it's stopped.
        // 429 in particular is a healthy server deliberately shedding load, and
        // reporting that as "switched off" is what made busy periods look like
        // the server kept dying.
        if (res.ok || res.status === 429) ok();
        else fail(reasonHttp(res.status));
      } catch {
        if (!alive.current) return;
        fail(navigator.onLine === false ? REASON_DEVICE : REASON_SERVER);
      } finally {
        clearTimeout(to);
        schedule();
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
