import { useEffect, useState } from 'react';
import { BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { DispatchAlertSettingsDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useDispatchAlerts, useUpdateDispatchAlerts } from './use-settings';

const ALL_OFF: DispatchAlertSettingsDto = {
  enabled: false,
  onCreate: false,
  onBulk: false,
  onBackdateApproved: false,
  onEdit: false,
  onDelete: false,
};

/** The five events, in the order they read most naturally on screen. */
const EVENTS: { key: Exclude<keyof DispatchAlertSettingsDto, 'enabled'>; label: string; hint: string }[] = [
  { key: 'onCreate', label: 'New dispatch saved', hint: 'Someone records a dispatch on the Dispatch form.' },
  {
    key: 'onBulk',
    label: 'Whole order dispatched (Create & Dispatch)',
    hint: 'The New Order shortcut ships every line at once — one alert per order, not per item. This path needs no approval of any kind.',
  },
  {
    key: 'onBackdateApproved',
    label: 'Back-dated dispatch approved',
    hint: 'Fires when an approver signs one off and it becomes real — not when it is requested.',
  },
  { key: 'onEdit', label: 'Dispatch edited', hint: 'Quantity, status, date or remark changed on an existing dispatch.' },
  { key: 'onDelete', label: 'Dispatch deleted', hint: 'An existing dispatch was removed.' },
];

/**
 * Who hears about dispatches, and about what.
 *
 * Recipients are not chosen here — they are everyone whose role grants
 * "Dispatch Alerts: notify" on Roles & Permissions (Super Admin always does).
 * This card only decides which EVENTS are worth an alert.
 */
export function DispatchAlertsCard({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading } = useDispatchAlerts();
  const save = useUpdateDispatchAlerts();
  const [form, setForm] = useState<DispatchAlertSettingsDto>(ALL_OFF);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const set = (key: keyof DispatchAlertSettingsDto, value: boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const onSave = () =>
    save.mutate(form, {
      onSuccess: () => toast.success('Dispatch alerts saved'),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
    });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-amber-600" /> Dispatch Alerts
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Tells everyone whose role grants <strong>Dispatch Alerts: notify</strong> when a user dispatches party items —
          in the app, and on their phone even when it is closed. You are never alerted about your own dispatches.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-muted-foreground flex h-24 items-center justify-center">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <Switch checked={form.enabled} disabled={!canEdit} onCheckedChange={(v) => set('enabled', v)} />
              Send dispatch alerts
            </label>

            <div className="space-y-2.5 border-t pt-3">
              {EVENTS.map((e) => (
                <label key={e.key} className="flex items-start gap-2.5 text-sm">
                  <Switch
                    checked={form[e.key]}
                    // Greyed out while the master switch is off, so it is obvious
                    // that ticking one alone would do nothing.
                    disabled={!canEdit || !form.enabled}
                    onCheckedChange={(v) => set(e.key, v)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{e.label}</span>
                    <span className="text-muted-foreground block text-xs">{e.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {canEdit && (
              <Button onClick={onSave} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" /> : null} Save dispatch alerts
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
