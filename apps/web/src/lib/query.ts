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
 * Persist the query cache to localStorage so a cold app open (killed PWA over
 * a slow VPN link) paints every screen's LAST-KNOWN data instantly while the
 * real fetch runs in the background — the same stale-while-revalidate idea the
 * service worker uses for code, applied to data. Only successful queries are
 * persisted. The cache is wiped on logout/session-clear (auth-store.clear).
 */
export const queryPersistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: createSyncStoragePersister({
    storage: typeof window === 'undefined' ? undefined : window.localStorage,
    key: 'oms-query-cache',
    // Batch writes; the cache serializes on every change otherwise.
    throttleTime: 2_000,
  }),
  maxAge: 24 * 60 * 60 * 1000,
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
