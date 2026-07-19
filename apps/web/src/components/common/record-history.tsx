import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History as HistoryIcon, Loader2 } from 'lucide-react';
import { ACTIONS, RESOURCES, perm, type AuditLogList } from '@oms/shared';
import { cn } from '@/lib/utils';
import { http } from '@/lib/api';
import { actionColor, actionLabel, fmtWhen, statusColor } from '@/lib/audit-format';
import { usePermissions } from '@/hooks/use-permissions';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

/**
 * A small "who touched this" control for a single record — an icon button that
 * opens a panel listing that record's own audit trail. Drop into any form header
 * or table row action group; renders nothing if the viewer lacks auditlog:view
 * or the record has no id yet (e.g. a brand-new, unsaved form).
 */
export function RecordHistory({
  resource,
  resourceId,
  label,
  className,
}: {
  /** A `RESOURCES` value, e.g. RESOURCES.ORDER. */
  resource: string;
  resourceId: string | number | null | undefined;
  /** Shown in the panel title, e.g. the record's code — "#1132". */
  label?: string | null;
  className?: string;
}) {
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  const id = resourceId != null ? String(resourceId) : undefined;
  const canView = can(perm(RESOURCES.AUDIT_LOG, ACTIONS.VIEW));

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', 'record', resource, id],
    queryFn: () => http.get<AuditLogList>('/audit-logs', { params: { resource, resourceId: id, page: 1, pageSize: 100 } }),
    enabled: open && canView && !!id,
  });

  if (!canView || !id) return null;
  const items = data?.items ?? [];

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('size-8', className)}
        onClick={() => setOpen(true)}
        aria-label="Activity history"
        title="Activity history — who created/edited this"
      >
        <HistoryIcon className="size-4" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Activity history{label ? ` — ${label}` : ''}</SheetTitle>
          </SheetHeader>
          <div className="space-y-2.5">
            {isLoading ? (
              <div className="text-muted-foreground flex h-32 items-center justify-center">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">No activity recorded for this record yet.</p>
            ) : (
              items.map((r) => (
                <div key={r.id} className="rounded-md border p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', actionColor(r.action))}>
                      {actionLabel(r.action)}
                    </span>
                    <span className="text-muted-foreground text-xs whitespace-nowrap">{fmtWhen(r.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium">{r.userName || r.userEmail || 'System'}</p>
                  {r.description && <p className="text-muted-foreground text-xs">{r.description}</p>}
                  <p className={cn('mt-1 text-xs tabular-nums', statusColor(r.statusCode))}>Status {r.statusCode ?? '—'}</p>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default RecordHistory;
