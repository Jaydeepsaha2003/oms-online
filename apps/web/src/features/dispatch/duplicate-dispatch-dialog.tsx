import { PackageCheck, Truck } from 'lucide-react';
import type { DuplicateDispatch } from '@oms/shared';
import { formatDate } from '@/lib/date-format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';

/** "05:30 am" — the detail that makes a duplicate recognisable ("oh, that was me"). */
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/**
 * Shown when a dispatch collides with one already recorded for the same order
 * line on the same day.
 *
 * A toast was the wrong vehicle: it auto-dismisses, it competes with whatever
 * else is on screen, and it is easy to miss on a shop floor tablet — yet this is
 * the one message that must be read, because ignoring it means the operator
 * believes goods went out twice. A modal stops everything and requires an
 * acknowledgement.
 *
 * Two strengths, and the difference matters:
 *
 *  - EXACT (`overridable` false) — every quantity identical. There is no second
 *    reading of that, so the only way out is OK, and the dispatch is refused.
 *  - SIMILAR (`overridable` true) — same bags, and the same Kgs or Pcs. Worth
 *    stopping for, but a 30 Kg line sent as 15 + 15 in one day looks exactly
 *    like this and is perfectly normal, so the operator gets to say so.
 */
export function DuplicateDispatchDialog({
  match,
  onClose,
  onContinue,
}: {
  match: DuplicateDispatch;
  onClose: () => void;
  /** Save it anyway. Only offered when the match is `overridable`. */
  onContinue?: () => void;
}) {
  const similar = !!match.overridable && !!onContinue;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        // The dialog's close X always renders and lands on the amber band, so it
        // is tinted for that background rather than left near-black on orange.
        className="max-w-[min(94vw,26rem)] overflow-hidden p-0 sm:max-w-md [&>button]:text-white [&>button]:opacity-90"
      >
        {/* Illustration band. The truck is the subject of the sentence, so it
            leads — and the tick over it says "this already went", which is the
            whole message in one glance. */}
        <div className="relative flex h-24 items-center justify-center overflow-hidden bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500">
          {/* Motion lines behind the truck — decorative only. */}
          <span aria-hidden className="absolute inset-0 opacity-25">
            <span className="absolute top-7 left-6 block h-1 w-14 rounded-full bg-white" />
            <span className="absolute top-12 left-2 block h-1 w-20 rounded-full bg-white" />
            <span className="absolute top-16 left-9 block h-1 w-10 rounded-full bg-white" />
            <span className="absolute top-9 right-8 block h-1 w-12 rounded-full bg-white" />
            <span className="absolute top-14 right-4 block h-1 w-16 rounded-full bg-white" />
          </span>
          <span className="relative grid size-16 place-items-center rounded-2xl bg-white/95 shadow-lg ring-1 ring-black/5">
            <Truck className="size-8 text-amber-600" strokeWidth={2.2} />
            <span className="absolute -right-1.5 -bottom-1.5 grid size-7 place-items-center rounded-full bg-emerald-500 text-white shadow-md ring-2 ring-white">
              <PackageCheck className="size-4" strokeWidth={2.6} />
            </span>
          </span>
        </div>

        <div className="space-y-3 px-5 pt-4 pb-1 text-center">
          <div>
            {/* A real DialogTitle/Description, not styled headings: Radix needs
                them to label the dialog for screen readers. */}
            <DialogTitle className="text-[17px] font-extrabold tracking-tight">
              {similar ? 'Similar dispatch already today' : 'Already dispatched today'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-1 text-[13px]">
              {similar ? (
                <>
                  Something with the same{' '}
                  <span className="font-bold text-amber-700 dark:text-amber-400">{match.matchedOn}</span> already went
                  out for this order line today.
                </>
              ) : (
                'This exact quantity has already gone out for this order line today.'
              )}
            </DialogDescription>
          </div>

          {/* The matched record, so nobody has to go and look it up. */}
          <div className="bg-muted/50 space-y-1.5 rounded-lg border p-3 text-left">
            <Row label="Dispatch" value={match.code} strong />
            <Row label="Item" value={match.productName} />
            <Row label="Quantity" value={match.qtyText} strong />
            <Row label="Customer" value={match.customerName} />
            <Row label="Order" value={match.orderCode} />
            <Row label="Recorded" value={`${formatDate(match.dispatchedAt)} at ${timeOf(match.dispatchedAt)}`} />
          </div>

          <p className="text-[12.5px] font-medium text-amber-700 dark:text-amber-400">
            {similar
              ? 'If this is the rest of the line going out separately, carry on. If it is the same load being entered twice, cancel and check that dispatch.'
              : 'If the quantity is wrong, modify that dispatch instead of adding another one.'}
          </p>
        </div>

        <DialogFooter className="gap-2 px-5 pt-2 pb-5 sm:flex-row">
          {similar ? (
            <>
              {/* Cancel is the default action and holds the focus: the warning
                  exists because carrying on is the riskier of the two, so the
                  Enter key must not be the one that ships the goods twice. */}
              <Button
                variant="outline"
                className="h-10 flex-1 text-[13px] font-bold"
                onClick={onClose}
                autoFocus
              >
                Cancel
              </Button>
              <Button
                className="h-10 flex-1 bg-amber-600 text-[13px] font-bold text-white hover:bg-amber-700"
                onClick={onContinue}
              >
                Continue anyway
              </Button>
            </>
          ) : (
            <Button className="h-10 w-full text-[13px] font-bold" onClick={onClose} autoFocus>
              OK, got it
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
      <span className="text-muted-foreground shrink-0 font-medium">{label}</span>
      <span className={strong ? 'truncate font-bold text-slate-900 dark:text-slate-100' : 'truncate font-semibold'}>{value}</span>
    </div>
  );
}
