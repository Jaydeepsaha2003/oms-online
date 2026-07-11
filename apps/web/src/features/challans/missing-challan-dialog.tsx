import { useState } from 'react';
import { Loader2, RotateCcw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/lib/api';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/common/combo';
import {
  useDismissMissingChallan,
  useMissingChallanFys,
  useMissingChallanList,
  useRestoreMissingChallan,
} from './use-challans';

/**
 * Port of the legacy MissingChallanForm: pick a prefix + fiscal year, see every
 * invoice number that was skipped in that series (never issued, e.g. #45 missing
 * between #44 and #46). Skips can be dismissed (acknowledged as intentional —
 * e.g. voided by hand, with a reason kept for future reference) or restored back
 * onto the list.
 */
export function MissingChallanDialog({
  prefixes,
  defaultPrefix,
  onClose,
}: {
  prefixes: string[];
  defaultPrefix: string;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const [prefix, setPrefix] = useState(defaultPrefix);
  const [fy, setFy] = useState('');
  const [showDeletedOnly, setShowDeletedOnly] = useState(false);
  const [dismissTarget, setDismissTarget] = useState<{ invNo: number; code: string } | null>(null);
  const [reason, setReason] = useState('');

  const { data: fysData } = useMissingChallanFys(prefix);
  // Default to the last built invoice's FY, not today's calendar FY — right after a
  // fiscal-year rollover "today's FY" can still be empty while the prior year's
  // series is the one that actually has gaps to review.
  const fy_ = fy || fysData?.lastBuilt || fysData?.current || '';
  const { data: entries, isLoading } = useMissingChallanList(prefix && fy_ ? { prefix, fy: fy_, deletedOnly: showDeletedOnly } : null);
  const dismiss = useDismissMissingChallan();
  const restore = useRestoreMissingChallan();

  const handleRestore = async (invNo: number, code: string) => {
    const ok = await confirm({ title: 'Restore this number?', description: `Bring ${code} back onto the missing list?`, confirmText: 'Restore' });
    if (!ok) return;
    restore.mutate(
      { prefix, fy: fy_, invNo },
      { onError: (e) => toast.error(getApiErrorMessage(e, 'Restore failed')) },
    );
  };

  const confirmDismiss = () => {
    if (!dismissTarget) return;
    if (!reason.trim()) return toast.error('Please enter a reason.');
    dismiss.mutate(
      { prefix, fy: fy_, invNo: dismissTarget.invNo, reason: reason.trim() },
      {
        onSuccess: () => setDismissTarget(null),
        onError: (e) => toast.error(getApiErrorMessage(e, 'Dismiss failed')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Missing Challan</DialogTitle>
          <p className="text-muted-foreground text-sm">
            Invoice numbers skipped in a prefix's series — never issued, and not (yet) acknowledged.
          </p>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="w-28">
            <NativeSelect value={prefix} onChange={(v) => { setPrefix(v); setFy(''); }} options={prefixes} placeholder="Prefix" />
          </div>
          <div className="w-32">
            <NativeSelect value={fy_} onChange={setFy} options={fysData?.fys ?? []} placeholder="FY" />
          </div>
          <Button
            type="button"
            variant={showDeletedOnly ? 'default' : 'outline'}
            size="sm"
            className="ml-auto"
            onClick={() => setShowDeletedOnly((v) => !v)}
          >
            Show Deleted Only
          </Button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto rounded-md border">
          {isLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 p-6 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : !entries || entries.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-1.5 p-8 text-center text-sm">
              <Search className="size-5 opacity-40" />
              {showDeletedOnly ? 'Nothing dismissed for this series.' : 'No gaps — every number in this series is accounted for.'}
            </div>
          ) : (
            <div className="divide-y">
              {entries.map((e) => (
                <div key={e.invNo} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <span className="font-mono text-sm font-medium">{e.code}</span>
                    {showDeletedOnly && e.reason && (
                      <p className="text-muted-foreground truncate text-xs" title={e.reason}>
                        {e.reason}
                      </p>
                    )}
                  </div>
                  {showDeletedOnly ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                      disabled={restore.isPending}
                      onClick={() => handleRestore(e.invNo, e.code)}
                      aria-label="Restore to missing list"
                      title="Restore to missing list"
                    >
                      <RotateCcw className="size-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => {
                        setReason('');
                        setDismissTarget({ invNo: e.invNo, code: e.code });
                      }}
                      aria-label="Dismiss from missing list"
                      title="Dismiss from missing list"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>

      {dismissTarget && (
        <Dialog open onOpenChange={(o) => !o && setDismissTarget(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Dismiss {dismissTarget.code}?</DialogTitle>
              <p className="text-muted-foreground text-sm">
                Record why this number was skipped — kept on the "Show Deleted Only" list for future reference.
              </p>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Voided by hand, duplicate, cancelled order…"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && confirmDismiss()}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDismissTarget(null)} disabled={dismiss.isPending}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" onClick={confirmDismiss} disabled={dismiss.isPending || !reason.trim()}>
                {dismiss.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />} Dismiss
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
