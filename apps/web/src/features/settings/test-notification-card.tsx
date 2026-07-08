import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TestNotificationResult } from '@oms/shared';
import { getApiErrorMessage, http } from '@/lib/api';
import { hasActivePushSubscription, subscribeToPush } from '@/lib/push-subscription';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/** Lets any signed-in user broadcast a test sound to every device currently signed into OMS. */
export function TestNotificationCard() {
  const [enabled, setEnabled] = useState(false);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hasActivePushSubscription().then((active) => {
      if (!cancelled) setEnabled(active);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enableNotifications = async () => {
    setEnabling(true);
    const result = await subscribeToPush();
    setEnabling(false);
    if (result.ok) {
      setEnabled(true);
      setUnsupportedReason(null);
      toast.success('Notifications enabled on this device');
    } else {
      setUnsupportedReason(result.reason);
      toast.error(result.reason);
    }
  };

  const sendTest = useMutation({
    mutationFn: () => http.post<TestNotificationResult>('/notifications/test'),
    onSuccess: (result) =>
      toast.success(
        `Sent to ${result.devicesNotified} open device(s), attempted push on ${result.pushDevicesNotified} device(s)`,
      ),
    onError: (e) => toast.error(getApiErrorMessage(e, 'Could not send test notification')),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-primary" /> Test notifications
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Send a test alert to every device currently signed into OMS — including devices where
          the app is closed, once notifications are enabled there.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {!enabled && (
          <Button type="button" variant="outline" onClick={enableNotifications} disabled={enabling}>
            {enabling ? <Loader2 className="animate-spin" /> : <BellRing />} Enable notifications
          </Button>
        )}
        {unsupportedReason && <p className="text-muted-foreground w-full text-xs">{unsupportedReason}</p>}
        <Button type="button" onClick={() => sendTest.mutate()} disabled={sendTest.isPending}>
          {sendTest.isPending ? <Loader2 className="animate-spin" /> : <BellRing />} Send test notification
        </Button>
      </CardContent>
    </Card>
  );
}
