import { useState } from 'react';
import { Loader2, PauseCircle, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomerDto } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBulkSetCustomerHold, useSetCustomerHold } from './use-customers';

/** How many party names the confirmation spells out before it starts counting. */
const NAMES_SHOWN = 6;

const nameOf = (c: CustomerDto) => c.partyName ?? `#${c.id}`;

/** "A, B and C" / "A, B, C and 4 more" — a list somebody can actually check. */
function partyList(parties: CustomerDto[]): string {
  const names = parties.map(nameOf);
  if (names.length <= NAMES_SHOWN) {
    return names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, NAMES_SHOWN).join(', ')} and ${names.length - NAMES_SHOWN} more`;
}

/**
 * Place or release a dispatch hold, for one party or a ticked set.
 *
 * One dialog for both because the decision is the same either way, and the
 * sentence explaining what a hold does is the part most worth not duplicating —
 * a hold that people think also stops orders, or billing, is a hold that gets
 * used wrongly. It says plainly what is and is not blocked.
 *
 * The reason is optional. It is the sentence shown to whoever gets stopped at
 * the Dispatch Order screen, so the field asks for it prominently — but a hold
 * placed in a hurry with nothing typed is far better than no hold, and making
 * it mandatory would be the thing that stops somebody bothering.
 */
export function DispatchHoldDialog({
  parties,
  hold,
  onClose,
}: {
  parties: CustomerDto[];
  /** true = place the hold, false = release it. */
  hold: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const one = useSetCustomerHold();
  const many = useBulkSetCustomerHold();
  const pending = one.isPending || many.isPending;
  const single = parties.length === 1 ? parties[0] : null;
  const who = single ? nameOf(single) : `${parties.length} parties`;

  const submit = async () => {
    if (!parties.length) return;
    const trimmed = reason.trim() || undefined;
    try {
      if (single) {
        await one.mutateAsync({ id: single.id, hold, reason: trimmed });
        toast.success(
          hold ? `${nameOf(single)} — dispatches held` : `${nameOf(single)} — hold released`,
        );
      } else {
        // The server reports what actually MOVED, not how many ids were sent: a
        // selection built up across pages goes stale, and echoing the tick count
        // would claim parties were held that are no longer there.
        const res = await many.mutateAsync({ ids: parties.map((p) => p.id), hold, reason: trimmed });
        const verb = hold ? 'held' : 'released';
        const missed = res.skipped ? `, ${res.skipped} no longer found` : '';
        toast.success(`${res.updated} ${res.updated === 1 ? 'party' : 'parties'} ${verb}${missed}`);
      }
      onClose();
    } catch (e) {
      toast.error(getApiErrorMessage(e, hold ? 'Could not hold' : 'Could not release'));
    }
  };

  /** The existing hold, when releasing a single party — so the reason it was
   *  placed for is on screen at the moment somebody decides to lift it. */
  const existing = !hold && single?.dispatchHold ? single : null;

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-[min(96vw,30rem)] font-sans sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            {hold ? (
              <PauseCircle className="size-4.5 text-amber-600" />
            ) : (
              <PlayCircle className="size-4.5 text-emerald-600" />
            )}
            {hold ? `Hold dispatches for ${who}?` : `Release dispatch hold for ${who}?`}
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-relaxed">
            {hold ? (
              <>
                Nobody will be able to record a new dispatch for{' '}
                {single ? 'this party' : 'these parties'}. Orders can still be taken, goods already
                dispatched can still be billed, and returns still go through — only shipping again
                is blocked.
              </>
            ) : (
              <>Dispatches can be recorded again straight away.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {!single && (
          <p className="rounded-[6px] border border-dashed px-2.5 py-2 text-[12px] leading-snug font-medium text-slate-700 dark:text-slate-300">
            {partyList(parties)}
          </p>
        )}

        {existing && (
          <div className="rounded-[6px] border border-amber-300 bg-amber-50 px-2.5 py-2 text-[12px] leading-snug dark:border-amber-400/40 dark:bg-amber-400/10">
            <p className="font-bold text-amber-900 dark:text-amber-200">Currently held</p>
            <p className="mt-0.5 text-amber-900/85 dark:text-amber-200/85">
              {existing.dispatchHoldReason?.trim() || 'No reason was given.'}
            </p>
            {(existing.dispatchHoldBy || existing.dispatchHoldAt) && (
              <p className="mt-0.5 text-[11px] font-semibold text-amber-800/75 dark:text-amber-200/65">
                {[
                  existing.dispatchHoldBy ? `by ${existing.dispatchHoldBy}` : null,
                  existing.dispatchHoldAt ? `on ${formatDate(existing.dispatchHoldAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        )}

        {hold && (
          <div className="space-y-1.5">
            <Label htmlFor="hold-reason" className="text-[12px] font-bold">
              Reason <span className="text-muted-foreground font-medium">(optional)</span>
            </Label>
            <Input
              id="hold-reason"
              autoFocus
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !pending) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="e.g. Payment overdue — cleared by accounts only"
              className="h-9 rounded-[4px] text-[13px]"
            />
            <p className="text-muted-foreground text-[11px] leading-snug">
              Shown to whoever tries to dispatch this party, so write it for them.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onClose}
            className="rounded-[4px] font-semibold"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => void submit()}
            className={cnHold(hold)}
          >
            {pending && <Loader2 className="animate-spin" />}
            {hold ? 'Hold dispatches' : 'Release hold'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Amber to place, emerald to release — the same pair the badges use, so the
 *  button colour already says which way this goes. */
const cnHold = (hold: boolean) =>
  hold
    ? 'rounded-[4px] bg-amber-600 font-bold text-white hover:bg-amber-700'
    : 'rounded-[4px] bg-emerald-600 font-bold text-white hover:bg-emerald-700';
