import { Component, type ReactNode } from 'react';

/**
 * Catches render-time errors (including failed lazy-chunk loads) anywhere below
 * it and shows a readable message + a Reload button instead of leaving a blank
 * white screen. The reload also clears the service worker and its caches, since
 * the most common cause on a phone is a stale cached page pointing at a JS chunk
 * that no longer exists after a redeploy.
 */
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

const CHUNK_RELOAD_KEY = 'oms:chunk-reloaded';

/**
 * Drop the service worker and every cache it holds, then reload.
 *
 * A plain reload is not enough to recover a stale chunk. sw.js answers
 * navigations network-first but gives up after 2.5s and serves the cached
 * shell — so on a slow or blipping link (a phone on the router's OpenVPN) the
 * reload is answered with the SAME poisoned shell, pointing at chunk names the
 * last build deleted. It fails identically, the one-shot guard is now spent,
 * and the user is parked on the error screen with no way back but a manual tap.
 *
 * Purging is safe HERE specifically because the caller has a confirmed stale
 * chunk error in hand — unlike index.html's blank-screen timer, which fires on
 * a guess and must not wipe a healthy client's prefetched assets over a merely
 * slow load.
 */
function purgeAndReload(): void {
  const done = () => window.location.reload();
  if (!('serviceWorker' in navigator)) return done();
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => Promise.all(regs.map((r) => r.unregister())))
    .then(() => ('caches' in window ? caches.keys().then((n) => Promise.all(n.map((k) => caches.delete(k)))) : undefined))
    .finally(done);
}

/** A lazy route whose chunk no longer exists — i.e. a build shipped under us.
 *  Browsers word this differently, so match on the shapes they all use. */
function isStaleChunkError(error: Error): boolean {
  const msg = `${error?.name ?? ''} ${error?.message ?? ''}`.toLowerCase();
  return (
    msg.includes('dynamically imported module') || // Chrome/Edge
    msg.includes('error loading dynamically') ||
    msg.includes('importing a module script failed') || // Safari
    msg.includes('chunkloaderror') ||
    (msg.includes('failed to fetch') && msg.includes('module'))
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Surface it in the console too (visible via remote debugging if needed).
    console.error('App crashed:', error);

    // A tab open across a deploy still references the OLD hashed chunk names,
    // and the build has deleted them — so the first navigation to a page it
    // hasn't loaded yet fails on the import, not on anything the user did.
    // Reloading picks up the new index and its chunks. Guarded by a session
    // flag so a genuine, reproducible crash can't reload in a loop.
    if (isStaleChunkError(error) && !sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
      purgeAndReload();
    }
  }

  private handleReload = purgeAndReload;

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-50 px-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-red-100 text-2xl">⚠️</span>
          <h1 className="text-xl font-bold text-slate-800">Something went wrong</h1>
          <p className="max-w-sm text-sm text-slate-500">
            The app hit an unexpected error. Tap Reload to refresh — this clears any stale cached files and usually fixes it.
          </p>
        </div>

        <button
          type="button"
          onClick={this.handleReload}
          className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          Reload the app
        </button>

        {/* The actual error text — shown so it can be read/screenshotted for support. */}
        <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-100 px-3 py-2 text-left text-[11px] leading-relaxed text-slate-500">
          {this.state.error.message || String(this.state.error)}
        </pre>
      </div>
    );
  }
}
