import { Info, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useServerStatus } from '@/hooks/use-server-status';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * Live server-connectivity indicator. Two looks off one shared hook:
 *   - `compact` → a single status dot for the topbar (beside the bell). Tap for details.
 *   - `full`    → dot + "Connected"/"Offline" + an (i) button for the sidebar footer.
 * Both open the same popover explaining the current state and, when offline, why.
 */
export function SystemStatus({ variant = 'full', className }: { variant?: 'full' | 'compact'; className?: string }) {
  const { status, reason, checking } = useServerStatus();
  const connected = status === 'connected';
  const label = connected ? 'Connected' : 'Offline';
  const dot = connected ? 'bg-emerald-500' : 'bg-rose-500';
  const detail = connected ? 'Live connection to the OMS server is healthy.' : reason;

  const body = (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <StatusDot className={dot} pulse={!connected} size="sm" />
        <span className={cn('text-sm font-semibold', connected ? 'text-emerald-600' : 'text-rose-600')}>{label}</span>
        {checking && <Loader2 className="text-muted-foreground ml-auto size-3.5 animate-spin" />}
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">{detail}</p>
    </div>
  );

  if (variant === 'compact') {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`System status: ${label}`}
            className={cn('hover:bg-accent flex size-9 items-center justify-center rounded-md transition-colors', className)}
          >
            <StatusDot className={dot} pulse={!connected} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-3">
          {body}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <StatusDot className={dot} pulse={!connected} size="sm" />
      <span className={cn('text-xs font-medium', connected ? 'text-emerald-600' : 'text-rose-500')}>{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Connection details"
            className="text-sidebar-foreground/45 hover:text-sidebar-foreground transition-colors"
          >
            <Info className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          {body}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** A status dot; when `pulse`, a soft ping ring radiates to draw the eye (offline). */
function StatusDot({ className, pulse, size = 'md' }: { className?: string; pulse?: boolean; size?: 'sm' | 'md' }) {
  const s = size === 'sm' ? 'size-2' : 'size-2.5';
  return (
    <span className={cn('relative flex', s)}>
      {pulse && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', className)} />}
      <span className={cn('relative inline-flex rounded-full', s, className)} />
    </span>
  );
}
