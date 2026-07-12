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
    shouldDehydrateQuery: (query) => query.state.status === 'success',
  },
};
