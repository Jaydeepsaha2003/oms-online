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

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Surface it in the console too (visible via remote debugging if needed).
    console.error('App crashed:', error);
  }

  private handleReload = () => {
    const done = () => window.location.reload();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .then(() => ('caches' in window ? caches.keys().then((n) => Promise.all(n.map((k) => caches.delete(k)))) : undefined))
        .finally(done);
    } else {
      done();
    }
  };

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
