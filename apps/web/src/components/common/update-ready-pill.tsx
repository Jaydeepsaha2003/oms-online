import { useEffect, useState } from 'react';
import { ArrowUpCircle } from 'lucide-react';
import { applyUpdateNow, subscribeToUpdates } from '@/lib/pwa-update';

/**
 * Offers a freshly deployed build instead of yanking the page out from under
 * whoever is mid-form. It applies itself as soon as the screen is idle (see
 * `pwa-update.ts`), so this is really only visible while the user is busy —
 * and tapping it is the "I'm ready now" shortcut.
 */
export function UpdateReadyPill() {
  const [pending, setPending] = useState(false);
  useEffect(() => subscribeToUpdates(setPending), []);
  if (!pending) return null;

  return (
    <button
      type="button"
      onClick={applyUpdateNow}
      className="fixed bottom-4 left-1/2 z-[99998] flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-[12.5px] font-semibold text-white shadow-lg ring-1 ring-white/15 transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
    >
      <ArrowUpCircle className="size-4" />
      Update ready — tap to apply
    </button>
  );
}
