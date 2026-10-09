import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ReceiptText } from 'lucide-react';
import { toast } from 'sonner';
import type { BillReadyAlertsDto } from '@oms/shared';
import { getApiErrorMessage, http } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useUsers } from '@/features/admin/use-admin';

const KEY = ['tally', 'bill-ready-alerts'];

/**
 * Who is told "Bill ready — please collect" when the Tally PC finishes a bill
 * (e-invoice / e-way made and printed). Picked person by person by an admin.
 */
export function BillReadyAlertsCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: () => http.get<BillReadyAlertsDto>('/tally/bill-ready-alerts') });
  const save = useMutation({
    mutationFn: (v: BillReadyAlertsDto) => http.put<BillReadyAlertsDto>('/tally/bill-ready-alerts', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const { data: users } = useUsers({ page: 1, pageSize: 200 });
  const [form, setForm] = useState<BillReadyAlertsDto>({ enabled: false, userIds: [] });
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const toggleUser = (id: string, on: boolean) =>
    setForm((f) => ({ ...f, userIds: on ? [...f.userIds, id] : f.userIds.filter((u) => u !== id) }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ReceiptText className="size-4 text-emerald-600" /> Bill Ready Alerts
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          When the Tally PC has made a bill's e-invoice / e-way bill and printed it, the people ticked below get
          "Bill ready — please collect" in the app and on their phone.
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
              <Switch checked={form.enabled} disabled={!canEdit} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
              Send bill ready alerts
            </label>
            <div className="grid gap-1.5 border-t pt-3 sm:grid-cols-2">
              {(users?.items ?? [])
                .filter((u) => u.status === 'active')
                .map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-emerald-600"
                      checked={form.userIds.includes(u.id)}
                      disabled={!canEdit || !form.enabled}
                      onChange={(e) => toggleUser(u.id, e.target.checked)}
                    />
                    <span className="font-medium">{u.name}</span>
                    <span className="text-muted-foreground truncate text-xs">{u.email}</span>
                  </label>
                ))}
            </div>
            {canEdit && (
              <Button
                onClick={() =>
                  save.mutate(form, {
                    onSuccess: () => toast.success('Bill ready alerts saved'),
                    onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
                  })
                }
                disabled={save.isPending}
              >
                {save.isPending ? <Loader2 className="animate-spin" /> : null} Save bill ready alerts
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
