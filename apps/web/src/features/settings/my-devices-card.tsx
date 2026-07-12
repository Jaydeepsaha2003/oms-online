import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MonitorSmartphone, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionList } from '@oms/shared';
import { getApiErrorMessage, http } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
