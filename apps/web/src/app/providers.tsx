import type { ReactNode } from 'react';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient, queryPersistOptions } from '@/lib/query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { ConfirmProvider } from '@/components/common/confirm';
import { ErrorBoundary } from '@/components/common/error-boundary';

/** App-wide context providers: server-state, tooltips, confirm dialog and toasts.
 *  PersistQueryClientProvider restores the localStorage-persisted query cache
 *  on boot (instant last-known data on a cold open) and keeps persisting it.
 *  The ErrorBoundary wraps everything so a render error (or a failed lazy-chunk
 *  load on a phone) shows a Reload screen instead of a blank white page. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <PersistQueryClientProvider client={queryClient} persistOptions={queryPersistOptions}>
        <TooltipProvider delayDuration={200}>
          <ConfirmProvider>{children}</ConfirmProvider>
          <Toaster />
        </TooltipProvider>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}
