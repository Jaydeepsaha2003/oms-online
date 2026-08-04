import { RefreshCw } from 'lucide-react';
import { TYPICAL_RESTART_SECS, useApiStatus } from '@/lib/api-status';

/**
 * A quiet strip shown while the server is being updated.
 *
 * It deliberately does NOT cover the screen or trap the user: on a phone or in
 * the installed app there is no other tab to escape to, so blocking the whole
 * UI would strand them. Every screen stays reachable and keeps showing its
 * last-known data; only saving is refused while this is up.
 */
export function ApiStatusBanner() {
  const { updating, downForSecs } = useApiStatus();
  if (!updating) return null;

  const left = TYPICAL_RESTART_SECS - downForSecs;
  // Once past the estimate, stop counting down and say so, rather than sitting
  // on "1 second" and looking broken.
  const text = left > 0 ? `back in about ${left}s` : 'taking longer than usual — still trying';

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[12.5px] font-medium text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
    >
      <RefreshCw className="size-3.5 shrink-0 animate-spin" />
      <span>
        Updating the app — <span className="tabular-nums">{text}</span>. You can keep looking around; saving is paused.
      </span>
    </div>
  );
}
