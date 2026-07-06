import { Globe, Laptop, Loader2, LogOut, MapPin, Monitor, ShieldOff, Smartphone, Tablet, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionDto, UserDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRevokeAllUserSessions, useRevokeUserSession, useUserSessions } from './use-admin';

const DEVICE_ICON: Record<string, typeof Monitor> = {
  mobile: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
  unknown: Laptop,
};

const LOCATION_TONE: Record<string, string> = {
  'This device': 'text-emerald-600',
  'Local network': 'text-sky-600',
  'External network': 'text-amber-600',
  Unknown: 'text-muted-foreground',
};

/** Presentational device row — reused by the admin dialog and self "My devices". */
export function SessionRow({
  s,
  onRevoke,
  revoking,
  revokeLabel = 'Log out',
}: {
  s: SessionDto;
  onRevoke?: (id: string) => void;
  revoking?: boolean;
  revokeLabel?: string;
}) {
  const Icon = DEVICE_ICON[s.deviceType] ?? Laptop;
  return (
    <div className="flex items-center gap-3 py-3">
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', s.current ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground')}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{s.deviceLabel}</span>
          {s.current && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">This device</span>}
        </div>
        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          <span className="inline-flex items-center gap-1"><Wifi className="size-3" /> {s.ip ?? '—'}</span>
          <span className={cn('inline-flex items-center gap-1', LOCATION_TONE[s.location])}><MapPin className="size-3" /> {s.location}</span>
          <span>since {formatDateTime(s.createdAt)}</span>
        </div>
      </div>
      {onRevoke && !s.current && (
        <Button variant="outline" size="sm" className="h-8 text-rose-600 hover:bg-rose-50" disabled={revoking} onClick={() => onRevoke(s.id)}>
          {revoking ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />} {revokeLabel}
        </Button>
      )}
      {s.current && <span className="text-muted-foreground text-xs">current</span>}
    </div>
  );
}

/** Admin: view & remotely sign a user out of their devices. */
export function UserSessionsDialog({ user, onClose }: { user: UserDto; onClose: () => void }) {
  const confirm = useConfirm();
  const { data: sessions = [], isLoading } = useUserSessions(user.id);
  const revoke = useRevokeUserSession(user.id);
  const revokeAll = useRevokeAllUserSessions(user.id);

  const handleRevoke = (id: string) => {
    revoke.mutate(id, {
      onSuccess: () => toast.success('Device signed out'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')),
    });
  };

  const handleRevokeAll = async () => {
    const ok = await confirm({
      title: 'Log out everywhere?',
      description: `${user.name} will be signed out of all ${sessions.length} device${sessions.length === 1 ? '' : 's'} immediately and must log in again.`,
      confirmText: 'Log out everywhere',
      destructive: true,
    });
    if (!ok) return;
    revokeAll.mutate(undefined, {
      onSuccess: () => toast.success('Signed out of all devices'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="size-5 text-primary" /> Devices &amp; sessions · {user.name}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm"><Loader2 className="size-4 animate-spin" /> Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-sm">
            <ShieldOff className="size-6 opacity-40" /> No active sessions — this user isn't signed in anywhere.
          </div>
        ) : (
          <div className="max-h-[55vh] divide-y overflow-y-auto pr-1">
            {sessions.map((s) => (
              <SessionRow key={s.id} s={s} onRevoke={handleRevoke} revoking={revoke.isPending && revoke.variables === s.id} />
            ))}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <p className="text-muted-foreground text-xs">
            {sessions.length} active {sessions.length === 1 ? 'device' : 'devices'} · signs out on the device's next action.
          </p>
          <div className="flex gap-2">
            {sessions.length > 0 && (
              <Button variant="outline" className="text-rose-600 hover:bg-rose-50" disabled={revokeAll.isPending} onClick={handleRevokeAll}>
                {revokeAll.isPending ? <Loader2 className="animate-spin" /> : <ShieldOff />} Log out everywhere
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
