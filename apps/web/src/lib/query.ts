import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      // Keep data in memory (and therefore in the persisted cache below) for a
      // day — the default 5min gcTime would garbage-collect restored entries
      // immediately on a cold open, defeating the persistence.
      gcTime: 24 * 60 * 60 * 1000,
    },
  },
});

/**
 * The hashed entry bundle this page is running, e.g. "index-DKgepo0u.js". Vite
 * renames it on every build that changes code, which makes it a free version
 * stamp for the persisted cache below. Dev (unhashed /src/main.tsx) has no
 * hash to read, so it gets a constant and keeps its persistence across reloads.
 */
function buildId(): string {
  if (typeof document === 'undefined') return 'dev';
  const src = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
    .map((e) => e.getAttribute('src') ?? '')
    .find((s) => /\/assets\/index-.*\.js$/.test(s));
  return src?.split('/').pop() ?? 'dev';
}

/**
 * Persist the query cache to localStorage so a cold app open (killed PWA over
 * a slow VPN link) paints every screen's LAST-KNOWN data instantly while the
 * real fetch runs in the background — the same stale-while-revalidate idea the
 * service worker uses for code, applied to data. Only successful queries are
 * persisted. The cache is wiped on logout/session-clear (auth-store.clear).
 *
 * `buster` ties the stored payloads to the build that wrote them. Without it a
 * new build rehydrates the previous build's JSON and hands it to components
 * expecting the new shape — a field added since (e.g. a recon row's `review`)
 * is simply absent, and an unguarded read of it takes the page down. Because
 * this lives in localStorage, reloading would NOT clear it: the crash would
 * survive every reload until the entry aged out. Changing builds now discards
 * the old cache instead, at the cost of one refetch after each deploy.
 */
export const queryPersistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: createSyncStoragePersister({
    storage: typeof window === 'undefined' ? undefined : window.localStorage,
    key: 'oms-query-cache',
    // Batch writes; the cache serializes on every change otherwise.
    throttleTime: 2_000,
  }),
  maxAge: 24 * 60 * 60 * 1000,
  buster: buildId(),
  dehydrateOptions: {
    // Queries opted into `refetchOnMount: 'always'` (e.g. the Create Challan
    // draft, which prices from master rate tables that can change any time —
    // GST/Freight/Packing rates) are explicitly declaring "never trust a cached
    // snapshot, always hit the server". Persisting them anyway defeats that: a
    // cold reload restores the stale snapshot first and paints it before the
    // background refetch lands, which is exactly the "doesn't reflect until I
    // refresh 2-3 times" staleness users were seeing after editing a rate
    // elsewhere and coming straight back to Create Challan.
    shouldDehydrateQuery: (query) => {
      if (query.state.status !== 'success') return false;
      // `refetchOnMount` is a React-Query-layer option, not part of query-core's
      // own QueryOptions type, but it's still present on the runtime object.
      const refetchOnMount = (query.options as { refetchOnMount?: unknown }).refetchOnMount;
      return refetchOnMount !== 'always';
    },
  },
};
