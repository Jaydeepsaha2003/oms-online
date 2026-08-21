import { useEffect, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';

const DISMISS_KEY = 'oms:cert-banner-dismissed';

/**
 * Warns when THIS device — not the server — hasn't trusted the app's HTTPS
 * certificate. On a phone this is the single biggest cause of "the app just
 * stopped working": this deployment runs on a self-signed LAN certificate
 * (see certs/rootCA.pem, apps/api/src/main.ts's /oms-rootCA.crt route), and a
 * device that never completed the one-time "install & trust" step treats
 * EVERY request as untrusted. A page load can show a browser warning the user
 * backs out of; a background request (API polling, notifications, a
 * service-worker fetch) has no warning screen to show at all — it just fails
 * silently. Both read as "the server stopped," repeatedly, while a PC that
 * already trusts the certificate (Windows only needs telling once) never sees
 * anything wrong — which is exactly the split this banner exists to explain.
 *
 * `window.isSecureContext` is the browser's own verdict on whether the
 * current connection is genuinely trusted — false here means untrusted-cert
 * or plain http, never a real server outage, so this and ApiStatusBanner
 * (server updating) never fire for the same cause.
 *
 * Dismissal is per-tab (sessionStorage): closing and reopening keeps it
 * gone for that session, but a fresh visit re-checks — so it comes back if
 * the device is still untrusted next time, rather than being silenced once
 * and forgotten on the one device that actually needed to see it.
 */
export function UntrustedCertBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [insecure, setInsecure] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setInsecure(!window.isSecureContext);
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      /* private browsing / storage blocked — just don't remember the dismissal */
    }
  }, []);

  if (!insecure || dismissed) return null;

  const host = typeof window !== 'undefined' ? window.location.host : '';
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* nothing to persist if storage is unavailable — it just re-shows next visit */
    }
  };

  return (
    <div
      role="status"
      className="flex items-start gap-2 border-b border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] font-medium text-rose-900 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200"
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      <span className="flex-1">
        {isHttps ? (
          <>
            This device hasn’t trusted OMS’s security certificate yet — some things (notifications, background
            updates) may randomly fail until it does.{' '}
            <a href={`https://${host}/oms-rootCA.crt`} className="font-semibold underline underline-offset-2">
              Tap here to install it
            </a>
            , then reload. On iPhone, one more step after installing: Settings → General → About → Certificate Trust
            Settings → turn on full trust for the OMS certificate.
          </>
        ) : (
          <>
            You’re on an unsecured connection ({host || 'this address'}). Open OMS’s https:// address instead for it
            to work reliably.
          </>
        )}
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 text-rose-700 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-500/20"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
