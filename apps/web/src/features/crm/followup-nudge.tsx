import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlarmClock, ArrowRight, BellRing, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { FollowupDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCrmSettings, useFollowupDue, useResolveFollowup, useSnoozeFollowup } from './use-crm';
import { Chip, itemLine, UrgencyChip } from './crm-shared';

/** A short two-tone chime via WebAudio (no asset needed). */
function playChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {
    /* audio blocked — ignore */
  }
}

/**
 * The "anti-forget" reminder. Polls the active nudges and pops an intrusive modal
 * that can't be plainly dismissed — you snooze (re-arms after the interval) or
 * resolve. Fires a chime + desktop notification when a new commitment comes due.
 * Mounted once in the app shell.
 */
export function FollowupNudge() {
  const navigate = useNavigate();
  const { data: due = [] } = useFollowupDue();
  const { data: settings } = useCrmSettings();
  const snooze = useSnoozeFollowup();
  const resolve = useResolveFollowup();

  const [open, setOpen] = useState(false);
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

  // When new nudges appear: open the modal, chime, and fire desktop notifications.
  useEffect(() => {
    const fresh = due.filter((f) => !seen.current.has(f.id));
    if (due.length > 0) setOpen(true);
    else setOpen(false);
    if (fresh.length === 0) return;

    if (settings?.sound !== false) playChime();
    if (settings?.desktopNotifications && 'Notification' in window && Notification.permission === 'granted') {
      for (const f of fresh.slice(0, 3)) {
        try {
          new Notification(`Follow-up: ${f.partyName}`, { body: `${f.title}${f.promisedAt ? ` · promised ${formatDate(f.promisedAt)}` : ''}`, tag: `followup-${f.id}` });
        } catch {
          /* ignore */
        }
      }
    }
    fresh.forEach((f) => seen.current.add(f.id));
    // Drop ids no longer due so a later re-trigger chimes again.
    const active = new Set(due.map((f) => f.id));
    for (const id of [...seen.current]) if (!active.has(id)) seen.current.delete(id);
  }, [due, settings?.sound, settings?.desktopNotifications]);

  const snoozeAll = () => {
    due.forEach((f) => snooze.mutate(f.id));
    setOpen(false);
    toast.success('Snoozed — I’ll nudge you again after the interval.');
  };

  if (!open || due.length === 0) return null;

  return (
    <Dialog open onOpenChange={() => { /* not plainly dismissible — must snooze or resolve */ }}>
      <DialogContent className="max-w-lg gap-3 border-amber-300 [&>button]:hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <span className="relative flex size-8 items-center justify-center rounded-full bg-amber-100">
              <BellRing className="size-4 text-amber-600" />
              <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/40" />
            </span>
            {due.length} commitment{due.length > 1 ? 's' : ''} need your attention
          </DialogTitle>
          <DialogDescription>Update the status, snooze to be reminded again, or mark it done. It won’t stop until you resolve it.</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 max-h-[52vh] space-y-2 overflow-y-auto px-1">
          {due.map((f) => <NudgeRow key={f.id} f={f} snooze={snooze} resolve={resolve} onOpen={() => { setOpen(false); navigate('/crm'); }} />)}
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="ghost" onClick={() => { setOpen(false); navigate('/crm'); }}>
            Open Follow-ups <ArrowRight className="size-4" />
          </Button>
          <Button variant="outline" onClick={snoozeAll} disabled={snooze.isPending}>
            <AlarmClock className="size-4" /> Snooze all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NudgeRow({ f, snooze, resolve, onOpen }: { f: FollowupDto; snooze: ReturnType<typeof useSnoozeFollowup>; resolve: ReturnType<typeof useResolveFollowup>; onOpen: () => void }) {
  const line = itemLine(f);
  return (
    <div className="rounded-lg border bg-amber-50/40 p-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            {f.priority === 'URGENT' && <Chip tone="rose">URGENT</Chip>}
            <span className="font-semibold">{f.partyName}</span>
            <UrgencyChip f={f} />
          </span>
          <span className="text-muted-foreground mt-0.5 block truncate text-sm">
            {f.title}{line ? ` · ${line}` : ''}{f.stage ? ` · ${f.stage}` : ''}
          </span>
        </span>
      </div>
      <div className="mt-2 flex gap-1.5">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onOpen}>Update</Button>
        <Button size="sm" variant="outline" className="h-7 text-xs text-amber-700" disabled={snooze.isPending} onClick={() => snooze.mutate(f.id, { onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) })}>
          {snooze.isPending ? <Loader2 className="size-3 animate-spin" /> : <AlarmClock className="size-3" />} Snooze
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-700" disabled={resolve.isPending} onClick={() => resolve.mutate(f.id, { onSuccess: () => toast.success('Done'), onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) })}>
          <Check className="size-3" /> Done
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
