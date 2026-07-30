import { NativeSelect } from '@/components/common/combo';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** The reserved "free-typed reason" choice. */
export const OTHERS_REASON = 'Others';
export const isOthers = (reason: string) => reason.trim().toLowerCase() === OTHERS_REASON.toLowerCase();

/**
 * Shared cancellation-reason picker used by the Quotation and Order cancel
 * dialogs. Pick a reason from the managed list (Settings → Cancellation Reasons);
 * choosing "Others" reveals an optional free-text box for the detail.
 */
export function CancelReasonFields({
  reasons,
  reason,
  note,
  onReason,
  onNote,
}: {
  reasons: string[];
  reason: string;
  note: string;
  onReason: (v: string) => void;
  onNote: (v: string) => void;
}) {
  const options = reasons.some((r) => r.toLowerCase() === OTHERS_REASON.toLowerCase()) ? reasons : [...reasons, OTHERS_REASON];
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Reason *</Label>
        <NativeSelect value={reason} onChange={onReason} options={['', ...options]} placeholder="Choose a reason…" />
        <p className="text-muted-foreground text-xs">Manage this list under Settings → Cancellation Reasons.</p>
      </div>
      {isOthers(reason) && (
        <div className="space-y-1.5">
          <Label>Type the reason (optional)</Label>
          <Input value={note} onChange={(e) => onNote(e.target.value)} placeholder="Describe the reason…" autoFocus />
        </div>
      )}
    </div>
  );
}
