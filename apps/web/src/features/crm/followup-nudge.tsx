import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlarmClock, ArrowRight, BellRing, Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { FollowupDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { buzz, playChime } from '@/lib/chime';
import { formatDate } from '@/lib/date-format';
import { Button } from '@/components/ui/button';
import { useCrmSettings, useFollowupDue, useResolveFollowup, useSnoozeFollowup } from './use-crm';
import { Chip, itemLine, UrgencyChip } from './crm-shared';

/**
 * The reminder manager.
 * Plays the loud chime, triggers desktop browser notifications, and displays
 * beautiful Instagram-style in-app notification banners at the top of the viewport
 * for mobile & desktop Chrome browsers.
 *
 * Mounted once in the app shell.
 */
export function FollowupNudge() {
  const navigate = useNavigate();
  const { data: due = [] } = useFollowupDue();
  const { data: settings } = useCrmSettings();
  const snooze = useSnoozeFollowup();
  const resolve = useResolveFollowup();

  const [activeBanners, setActiveBanners] = useState<{ id: number; followup: FollowupDto }[]>([]);
  const seen = useRef<Set<number>>(new Set());
  const askedPermission = useRef(false);

  // Ask for desktop-notification permission once (best-effort).
  useEffect(() => {
    if (askedPermission.current || !settings?.desktopNotifications) return;
    askedPermission.current = true;
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [settings?.desktopNotifications]);

  // When new nudges appear: chime, vibrate, show banners, and fire desktop notifications.
  useEffect(() => {
    const fresh = due.filter((f) => !seen.current.has(f.id));
    
    if (fresh.length > 0) {
      // Add new followups to active banners list
      setActiveBanners((prev) => {
        const existingIds = new Set(prev.map((b) => b.id));
        const toAdd = fresh
          .filter((f) => !existingIds.has(f.id))
          .map((f) => ({ id: f.id, followup: f }));
        return [...prev, ...toAdd];
      });

      if (settings?.sound !== false) {
        playChime();
        buzz();
        // Play a second chime after a short pause so it's impossible to miss
        const timer = setTimeout(() => {
          playChime();
          buzz();
        }, 2500);
        return () => clearTimeout(timer);
      }

      if (settings?.desktopNotifications && 'Notification' in window && Notification.permission === 'granted') {
        for (const f of fresh.slice(0, 3)) {
          try {
            new Notification(`Follow-up: ${f.partyName}`, {
              body: `${f.title}${f.promisedAt ? ` · promised ${formatDate(f.promisedAt)}` : ''}`,
              tag: `followup-${f.id}`,
            });
          } catch {
            /* ignore */
          }
        }
      }

      fresh.forEach((f) => seen.current.add(f.id));
    }

    // Clean up tracking and banner list for resolved or rescheduled items
    const active = new Set(due.map((f) => f.id));
    for (const id of [...seen.current]) {
      if (!active.has(id)) {
        seen.current.delete(id);
        setActiveBanners((prev) => prev.filter((b) => b.id !== id));
      }
    }
  }, [due, settings?.sound, settings?.desktopNotifications]);

  return (
    <>
      {/* Slide-down Instagram-style in-app notification container */}
      <div className="fixed top-4 left-4 right-4 z-[99999] flex flex-col items-center gap-2 pointer-events-none md:left-auto md:right-4 md:w-96">
        {activeBanners.map(({ id, followup }) => (
          <FollowupBannerNotification
            key={id}
            f={followup}
            snooze={snooze}
            resolve={resolve}
            onOpen={() => {
              setActiveBanners((prev) => prev.filter((b) => b.id !== id));
              navigate('/crm');
            }}
            onDismiss={() => {
              setActiveBanners((prev) => prev.filter((b) => b.id !== id));
            }}
          />
        ))}
      </div>
    </>
  );
}

/**
 * Individual Instagram-style notification banner.
 * Auto-dismisses after 12 seconds if not interacted with.
 */
function FollowupBannerNotification({
  f,
  snooze,
  resolve,
  onOpen,
  onDismiss,
}: {
  f: FollowupDto;
  snooze: ReturnType<typeof useSnoozeFollowup>;
  resolve: ReturnType<typeof useResolveFollowup>;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, 12000); // 12 seconds auto-dismiss
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const line = itemLine(f);

  return (
    <div className="w-full max-w-sm pointer-events-auto bg-card/95 dark:bg-card/98 backdrop-blur-md border border-border/80 shadow-2xl rounded-2xl p-3 flex flex-col gap-2.5 animate-slide-in-top transition-all duration-300">
      {/* Banner Header (iOS/Instagram look) */}
      <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
        <div className="flex items-center gap-2">
          {/* App Badge Icon */}
          <div className="relative flex size-6 items-center justify-center rounded-lg bg-gradient-brand text-[9px] font-black text-white shadow-md shadow-primary/20">
            OMS
            <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-rose-500 animate-pulse" />
          </div>
          <span className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Follow-up Reminder</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">now</span>
          <button
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded-md hover:bg-muted"
            aria-label="Dismiss alert"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Banner Details */}
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-1.5">
          {f.priority === 'URGENT' && <Chip tone="rose">URGENT</Chip>}
          <span className="font-semibold text-sm">{f.partyName}</span>
          <UrgencyChip f={f} />
        </div>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {f.title}
          {line ? ` · ${line}` : ''}
          {f.stage ? ` · ${f.stage}` : ''}
        </p>
      </div>

      {/* Quick Action Buttons */}
      <div className="flex items-center gap-2 border-t border-border/40 pt-2 mt-0.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 flex-1 text-xs justify-center hover:bg-muted font-semibold transition-colors"
          onClick={onOpen}
        >
          View
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 flex-1 text-xs justify-center text-amber-600 dark:text-amber-500 hover:bg-amber-50/50 dark:hover:bg-amber-950/20 font-semibold transition-colors"
          disabled={snooze.isPending}
          onClick={() =>
            snooze.mutate(f.id, {
              onSuccess: onDismiss,
              onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')),
            })
          }
        >
          {snooze.isPending ? <Loader2 className="size-3 animate-spin" /> : <AlarmClock className="size-3.5 mr-1" />} Snooze
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 flex-1 text-xs justify-center text-emerald-600 dark:text-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 font-semibold transition-colors"
          disabled={resolve.isPending}
          onClick={() =>
            resolve.mutate(f.id, {
              onSuccess: () => {
                toast.success('Resolved');
                onDismiss();
              },
              onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')),
            })
          }
        >
          <Check className="size-3.5 mr-1" /> Done
        </Button>
      </div>
    </div>
  );
}

/** Live count of active nudges — for the topbar bell + sidebar badge. */
export function useNudgeCount(enabled = true): number {
  const { data } = useFollowupDue(undefined, enabled);
  return useMemo(() => data?.length ?? 0, [data]);
}
