import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlarmClock, ArrowRight, Bell, Check, CircleCheck } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useFollowupBoard, useFollowupSummary, useResolveFollowup, useSnoozeFollowup } from './use-crm';
import { useNudgeCount } from './followup-nudge';
import { usePermissions } from '@/hooks/use-permissions';
import { EnablePushPanel, usePushEnrolment } from '@/features/notifications/enable-notifications';
import { Chip, itemLine, UrgencyChip } from './crm-shared';

/**
 * The single topbar bell.
 *
 * There used to be two: this one, and a separate "turn on notifications for this
 * device" bell beside it. Two bell icons an inch apart is one entry point too
 * many, so device enrolment now lives INSIDE this popover.
 *
 * Split in two components rather than branching inside one, because the CRM
 * variant calls CRM queries — a user without `crm:view` must not fire them at
 * all, and hooks cannot be called conditionally.
 */
export function NotificationsBell() {
  const { can } = usePermissions();
  return can('crm:view') ? <CrmNotificationsBell /> : <DeviceOnlyBell />;
}

/**
 * For users with no CRM access: the bell exists only while there is something to
 * offer — enrolling this device. Once enrolled it disappears rather than sitting
 * there opening an empty panel.
 */
function DeviceOnlyBell() {
  const [open, setOpen] = useState(false);
  const { needsEnrolling } = usePushEnrolment();
  if (!needsEnrolling) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Turn on notifications for this device">
          <Bell />
          {/* Amber, not red: nothing is wrong — something is simply available to
              switch on. */}
          <span className="ring-background absolute top-1.5 right-1.5 size-2 rounded-full bg-amber-500 ring-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1rem)] overflow-hidden p-0">
        <EnablePushPanel onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function CrmNotificationsBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: summary } = useFollowupSummary();
  const { data: groups = [] } = useFollowupBoard({ bucket: 'attention' });
  const snooze = useSnoozeFollowup();
  const resolve = useResolveFollowup();
  // Due reminders drive the ring/badge; the list also shows overdue + due-today.
  const dueCount = useNudgeCount();
  const items = groups.flatMap((g) => g.items).slice(0, 12);
  const attention = (summary?.overdue ?? 0) + (summary?.dueToday ?? 0);
  const badge = Math.max(attention, dueCount, items.length);
  const ringing = badge > 0;

  const goCrm = () => {
    setOpen(false);
    navigate('/crm');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notifications${badge ? ` — ${badge} pending` : ''}`}
        >
          <Bell className={cn(ringing && 'animate-bell-ring', ringing && 'text-amber-600')} />
          {badge > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-background">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-1rem)] overflow-hidden p-0">
        {/* Renders nothing once this device is enrolled. */}
        <EnablePushPanel onDone={() => setOpen(false)} />
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="size-4 text-amber-600" />
            Notifications
            {badge > 0 && <Chip tone="rose">{badge}</Chip>}
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={goCrm}>
            Open all <ArrowRight className="size-3.5" />
          </Button>
        </div>

        {items.length === 0 ? (
          <div className="text-muted-foreground flex items-center gap-2 px-3 py-6 text-sm">
            <CircleCheck className="size-5 text-emerald-500" /> All caught up — nothing pending.
          </div>
        ) : (
          <div className="max-h-[min(60vh,26rem)] divide-y overflow-y-auto">
            {items.map((f) => (
              <div key={f.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {f.priority === 'URGENT' && <Chip tone="rose">URGENT</Chip>}
                  <span className="font-medium">{f.partyName}</span>
                  <UrgencyChip f={f} />
                  {f.stage && <Chip tone="slate">{f.stage}</Chip>}
                </div>
                <div className="text-muted-foreground mt-0.5 truncate text-xs">
                  {f.title}
                  {itemLine(f) ? ` · ${itemLine(f)}` : ''}
                  {f.promisedAt ? ` · promised ${formatDate(f.promisedAt)}` : ''}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-amber-700"
                    disabled={snooze.isPending}
                    onClick={() =>
                      snooze.mutate(f.id, {
                        onSuccess: () => toast.success('Snoozed'),
                        onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')),
                      })
                    }
                  >
                    <AlarmClock className="size-3" /> Snooze
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-emerald-700"
                    disabled={resolve.isPending}
                    onClick={() =>
                      resolve.mutate({ id: f.id }, {
                        onSuccess: () => toast.success('Done'),
                        onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')),
                      })
                    }
                  >
                    <Check className="size-3" /> Done
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
