import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MonitorSmartphone, PencilLine, ShieldOff, X } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionList } from '@oms/shared';
import { getApiErrorMessage, http } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SessionRow } from '@/features/admin/user-sessions-dialog';

const KEY = ['my-sessions'] as const;

/** "My devices" — the current user sees and signs out their own sessions. */
export function MyDevicesCard() {
  const qc = useQueryClient();
  const { data: sessions = [], isLoading } = useQuery({
    queryKey: KEY,
    queryFn: () => http.get<SessionList>('/auth/sessions'),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });

  const revoke = useMutation({
    mutationFn: (id: string) => http.delete(`/auth/sessions/${id}`),
    onSuccess: invalidate,
  });
  const revokeOthers = useMutation({
    mutationFn: () => http.delete('/auth/sessions'),
    onSuccess: invalidate,
  });

  /*
   * Naming a device.
   *
   * Only this one can be named, and deliberately so: a name is a label someone
   * puts on the phone in their own pocket. The others in this list are named
   * from those devices themselves, which is also the only place anyone can tell
   * which physical thing they are.
   */
  const [naming, setNaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => http.patch(`/auth/sessions/${id}/name`, { name }),
    onSuccess: () => {
      setNaming(null);
      invalidate();
    },
  });
  const current = sessions.find((s) => s.current);

  const others = sessions.filter((s) => !s.current).length;

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <MonitorSmartphone className="size-4 text-primary" /> My devices
          </CardTitle>
          <p className="text-muted-foreground text-xs">Where you're signed in. Sign out any device you don't recognise.</p>
        </div>
        {others > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-rose-600 hover:bg-rose-50 sm:w-auto"
            disabled={revokeOthers.isPending}
            onClick={() =>
              revokeOthers.mutate(undefined, {
                onSuccess: () => toast.success('Signed out other devices'),
                onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')),
              })
            }
          >
            {revokeOthers.isPending ? <Loader2 className="animate-spin" /> : <ShieldOff />} Log out other devices
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {/* Why the name matters, said once rather than per row. */}
        {current && (
          <div className="mb-3 rounded-[4px] border bg-slate-50/70 px-3 py-2.5 dark:bg-white/5">
            {naming === current.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  autoFocus
                  value={draft}
                  maxLength={60}
                  placeholder="e.g. Shop floor tablet"
                  className="h-8 max-w-56 text-[13px]"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') rename.mutate({ id: current.id, name: draft });
                    if (e.key === 'Escape') setNaming(null);
                  }}
                />
                <Button size="sm" className="h-8" disabled={rename.isPending} onClick={() => rename.mutate({ id: current.id, name: draft })}>
                  {rename.isPending ? <Loader2 className="animate-spin" /> : <Check className="size-3.5" />} Save
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setNaming(null)}>
                  <X className="size-3.5" /> Cancel
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[12.5px]">
                  {current.deviceName ? (
                    <>
                      This device is called <b>{current.deviceName}</b>.
                    </>
                  ) : (
                    <>
                      This device has no name, so it shows as <b>{current.deviceLabel}</b> — the same as every other phone
                      running that browser.
                    </>
                  )}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[12px]"
                  onClick={() => {
                    setDraft(current.deviceName ?? '');
                    setNaming(current.id);
                  }}
                >
                  <PencilLine className="size-3.5" /> {current.deviceName ? 'Rename' : 'Name this device'}
                </Button>
              </div>
            )}
          </div>
        )}
        {isLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm"><Loader2 className="size-4 animate-spin" /> Loading…</div>
        ) : (
          <div className="divide-y">
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                onRevoke={(id) =>
                  revoke.mutate(id, {
                    onSuccess: () => toast.success('Device signed out'),
                    onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')),
                  })
                }
                revoking={revoke.isPending && revoke.variables === s.id}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
