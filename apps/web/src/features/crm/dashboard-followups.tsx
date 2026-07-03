import { useNavigate } from 'react-router-dom';
import { AlarmClock, ArrowRight, BellRing, Check, CircleCheck } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useFollowupBoard, useFollowupSummary, useResolveFollowup, useSnoozeFollowup } from './use-crm';
import { Chip, itemLine, UrgencyChip } from './crm-shared';

/** Prominent dashboard panel: everything promised that needs attention now. */
export function DashboardFollowups() {
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { data: summary } = useFollowupSummary();
  const { data: groups = [] } = useFollowupBoard({ bucket: 'attention' });
  const snooze = useSnoozeFollowup();
  const resolve = useResolveFollowup();
  if (!can('crm:view')) return null;

  const items = groups.flatMap((g) => g.items).slice(0, 8);
  const attention = (summary?.overdue ?? 0) + (summary?.dueToday ?? 0);

  return (
    <Card className={attention > 0 ? 'border-amber-300 shadow-amber-100' : ''}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className={`flex size-7 items-center justify-center rounded-lg text-white shadow-sm ${attention > 0 ? 'bg-gradient-to-br from-amber-500 to-orange-600' : 'bg-gradient-to-br from-emerald-400 to-emerald-600'}`}>
            <BellRing className="size-4" />
          </span>
          Follow-ups need attention
          {attention > 0 && <Chip tone="rose">{attention}</Chip>}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => navigate('/crm')}>
          Open <ArrowRight className="size-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
            <CircleCheck className="text-emerald-500 size-5" /> All commitments are on track — nothing overdue right now.
          </div>
        ) : (
          <div className="divide-y">
            {items.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {f.priority === 'URGENT' && <Chip tone="rose">URGENT</Chip>}
                    <span className="font-medium">{f.partyName}</span>
                    <UrgencyChip f={f} />
                    {f.stage && <Chip tone="slate">{f.stage}</Chip>}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    {f.title}{itemLine(f) ? ` · ${itemLine(f)}` : ''}{f.promisedAt ? ` · promised ${formatDate(f.promisedAt)}` : ''}
                  </div>
                </div>
                {(can('crm:update')) && (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-xs text-amber-700" disabled={snooze.isPending} onClick={() => snooze.mutate(f.id, { onSuccess: () => toast.success('Snoozed'), onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) })}>
                      <AlarmClock className="size-3" /> Snooze
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-700" disabled={resolve.isPending} onClick={() => resolve.mutate(f.id, { onSuccess: () => toast.success('Done'), onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')) })}>
                      <Check className="size-3" /> Done
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
