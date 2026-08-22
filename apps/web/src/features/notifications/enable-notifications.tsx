import { useEffect, useState } from 'react';
import { BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { hasActivePushSubscription, subscribeToPush } from '@/lib/push-subscription';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Remembers that this device was offered the prompt, so it opens itself only
 *  once. The BUTTON stays available afterwards — dismissing hides the pitch, not
 *  the way in. */
const PROMPTED_KEY = 'oms:push-prompt-shown';

const wasPrompted = () => {
  try {
    return localStorage.getItem(PROMPTED_KEY) === '1';
  } catch {
    return true; // private mode / no storage — never nag
  }
};
const markPrompted = () => {
  try {
    localStorage.setItem(PROMPTED_KEY, '1');
  } catch {
    /* ignore quota / private-mode errors */
  }
};

/**
 * "Turn on alerts" for the CURRENT device — in the topbar, for every signed-in
 * user regardless of role.
 *
 * The only way to enrol a device used to be the Test-notifications card on
 * /settings, which is gated behind `setting:view` — a permission no role but
 * super_admin holds. So everyone else (operators, managers, admins) had no
 * reachable way to switch notifications on, and never saw the browser's
 * permission prompt at all. Every push subscription in the system belonged to
 * the one super-admin account.
 *
 * Enrolment must be started by a real tap: iOS only honours
 * Notification.requestPermission() from a user gesture (and only for a PWA added
 * to the Home Screen), so this is a button the user presses — never an automatic
 * prompt on load, which iOS would silently refuse.
 */
/**
 * Device push-enrolment state, shared by anything that offers to switch it on.
 *
 * Extracted from the standalone button so the notification bell can host the
 * same action — two bells in the topbar (one to enrol, one to read) was one
 * entry point too many, but the enrolment itself still has to be reachable.
 */
export function usePushEnrolment() {
  // null = still checking; keeps the offer from flashing in for a device that
  // is already enrolled.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [supported, setSupported] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!isSupported) {
      setSupported(false);
      setEnabled(false);
      return;
    }
    hasActivePushSubscription().then((active) => {
      if (cancelled) return;
      setEnabled(active);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setEnabling(true);
    const result = await subscribeToPush();
    setEnabling(false);
    if (result.ok) {
      setEnabled(true);
      setProblem(null);
      toast.success('Notifications are on for this device');
      return true;
    }
    setProblem(result.reason);
    toast.error(result.reason);
    return false;
  };

  /** True only when this device COULD be enrolled and isn't. */
  const needsEnrolling = supported && enabled === false;
  return { needsEnrolling, enabling, problem, enable };
}

/** The enrol offer as a self-contained panel — rendered inside the bell. */
export function EnablePushPanel({ onDone }: { onDone?: () => void }) {
  const { needsEnrolling, enabling, problem, enable } = usePushEnrolment();
  if (!needsEnrolling) return null;
  return (
    <div className="border-b bg-amber-50/70 px-3 py-2.5 dark:bg-amber-400/10">
      <p className="text-[13px] font-semibold">Turn on notifications on this device</p>
      <p className="text-muted-foreground mt-0.5 text-[11.5px]">
        Get alerts even when OMS is closed. Your phone will ask you to allow them.
      </p>
      {problem && <p className="mt-1.5 text-[11.5px] text-amber-700 dark:text-amber-400">{problem}</p>}
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 text-[12px]"
          disabled={enabling}
          onClick={() => void enable().then((ok) => ok && onDone?.())}
        >
          {enabling ? <Loader2 className="animate-spin" /> : <BellRing />} Turn on
        </Button>
      </div>
    </div>
  );
}

export function EnableNotificationsButton({ className }: { className?: string }) {
  // null = still checking; keeps the button from flashing in for a device that
  // is already enrolled.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [supported, setSupported] = useState(true);
  const [open, setOpen] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!isSupported) {
      setSupported(false);
      setEnabled(false);
      return;
    }
    hasActivePushSubscription().then((active) => {
      if (cancelled) return;
      setEnabled(active);
      // First time on this device and never asked → open the pitch once, so the
      // feature is discovered rather than depending on someone noticing an icon.
      if (!active && !wasPrompted() && Notification.permission === 'default') {
        setOpen(true);
        markPrompted();
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setEnabling(true);
    const result = await subscribeToPush();
    setEnabling(false);
    if (result.ok) {
      setEnabled(true);
      setProblem(null);
      setOpen(false);
      toast.success('Notifications are on for this device');
    } else {
      setProblem(result.reason);
      toast.error(result.reason);
    }
  };

  // Already enrolled, still checking, or a browser that can't do push at all:
  // show nothing rather than a control that would mislead.
  if (enabled !== false || !supported) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Turn on notifications for this device"
          title="Turn on notifications for this device"
          className={cn('relative', className)}
        >
          <BellRing />
          {/* Amber dot: something is available to switch on, without the alarm
              of a red badge (nothing is wrong — it just isn't set up yet). */}
          <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-amber-500 ring-2 ring-background" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[19rem] p-3">
        <p className="text-sm font-semibold">Turn on notifications</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Get alerts on this device even when OMS is closed. You&apos;ll need to allow notifications when your
          phone asks.
        </p>
        {problem && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
        <div className="mt-3 flex items-center gap-2">
          <Button type="button" size="sm" onClick={enable} disabled={enabling}>
            {enabling ? <Loader2 className="animate-spin" /> : <BellRing />} Turn on
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Not now
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
