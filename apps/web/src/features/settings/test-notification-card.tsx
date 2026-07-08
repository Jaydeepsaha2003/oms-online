import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TestNotificationResult } from '@oms/shared';
import { getApiErrorMessage, http } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/** Lets any signed-in user broadcast a test sound to every device currently signed into OMS. */
export function TestNotificationCard() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification === 'undefined' ? 'denied' : Notification.permission,
  );

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    setPermission(await Notification.requestPermission());
  };

  const sendTest = useMutation({
    mutationFn: () => http.post<TestNotificationResult>('/notifications/test'),
    onSuccess: (result) => toast.success(`Sent to ${result.devicesNotified} device(s)`),
    onError: (e) => toast.error(getApiErrorMessage(e, 'Could not send test notification')),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-primary" /> Test notifications
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Send a test alert to every device currently signed into OMS, to check that sound and
          notifications work.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {permission !== 'granted' && (
          <Button type="button" variant="outline" onClick={enableNotifications}>
            Enable browser notifications
          </Button>
        )}
        <Button type="button" onClick={() => sendTest.mutate()} disabled={sendTest.isPending}>
          {sendTest.isPending ? <Loader2 className="animate-spin" /> : <BellRing />} Send test notification
        </Button>
      </CardContent>
    </Card>
  );
}
