import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { ConfirmProvider } from '@/components/common/confirm';
import { ErrorBoundary } from '@/components/common/error-boundary';

/** App-wide context providers: server-state, tooltips, confirm dialog and toasts.
 *  The ErrorBoundary wraps everything so a render error (or a failed lazy-chunk
 *  load on a phone) shows a Reload screen instead of a blank white page. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          <ConfirmProvider>{children}</ConfirmProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
