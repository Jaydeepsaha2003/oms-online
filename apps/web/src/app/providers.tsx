import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { ConfirmProvider } from '@/components/common/confirm';

/** App-wide context providers: server-state, tooltips, confirm dialog and toasts. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <ConfirmProvider>{children}</ConfirmProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
