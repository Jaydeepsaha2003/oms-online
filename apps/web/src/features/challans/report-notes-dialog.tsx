import { useState } from 'react';
import { FileMinus2, FilePlus2, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** What the user chose to put in the workbook. */
export interface ReportNoteChoice {
  debit: boolean;
  credit: boolean;
}

/** One tickable sheet, as a whole row you can click. */
function SheetToggle({
  on,
  onToggle,
  icon: Icon,
  title,
  detail,
  accent,
}: {
  on: boolean;
  onToggle: () => void;
  icon: typeof Layers;
  title: string;
  detail: string;
  accent: 'amber' | 'rose';
}) {
  const ring =
    accent === 'amber'
      ? 'border-amber-400 bg-amber-50 dark:border-amber-400/50 dark:bg-amber-400/10'
      : 'border-rose-300 bg-rose-50 dark:border-rose-400/40 dark:bg-rose-400/10';
  const tint = accent === 'amber' ? 'text-amber-700 dark:text-amber-300' : 'text-rose-600 dark:text-rose-400';
  return (
    // A label wrapping a real checkbox: the whole row is then the hit target on
    // a phone without any of the tap-forwarding a div would need.
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-[6px] border px-2.5 py-2 transition-colors',
        on ? ring : 'hover:bg-accent border-dashed',
      )}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={onToggle}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-indigo-600"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-bold">
          <Icon className={cn('size-3.5 shrink-0', tint)} />
          {title}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-[11.5px] leading-snug">{detail}</span>
      </span>
    </label>
  );
}

/**
 * Asked before a challan report downloads: should the debit and credit notes
 * come with it?
 *
 * Each kind gets its OWN sheet rather than extra rows on the challan list. A
 * credit note reduces what a party owes, so adding one to a column that totals
 * sales would produce a figure that is true of nothing — and a debit note is
 * already one of the challan rows (they share the table), so it moves onto its
 * sheet rather than appearing on both.
 *
 * Both default to on. Somebody who opens this dialog is being asked precisely
 * because they want the notes; making them tick twice to get what they came for
 * is a worse default than letting them untick.
 */
export function ReportNotesDialog({
  kind,
  onCancel,
  onConfirm,
}: {
  /** Which report was asked for — named so the dialog says what it is building. */
  kind: 'detailed' | 'summary';
  onCancel: () => void;
  onConfirm: (choice: ReportNoteChoice) => void;
}) {
  const [debit, setDebit] = useState(true);
  const [credit, setCredit] = useState(true);
  // The wire contract has the two names the wrong way round and stays that way
  // — see buildChallanReport. This is only the wording on screen.
  const label = kind === 'summary' ? 'Detailed View' : 'Challan Summary';

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-[min(96vw,29rem)] font-sans sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            <Layers className="size-4.5 text-sky-600" />
            {label} — add notes?
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-relaxed">
            Each kind you tick gets a sheet of its own, on the same filters and date range as the
            challans. Leave both clear for the challan list on its own.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <SheetToggle
            on={debit}
            onToggle={() => setDebit((v) => !v)}
            icon={FilePlus2}
            title="Debit notes"
            detail="What a party owes on top of its bills. They sit in the challan list today — ticking this moves them onto their own sheet instead, so nothing is counted twice."
            accent="amber"
          />
          <SheetToggle
            on={credit}
            onToggle={() => setCredit((v) => !v)}
            icon={FileMinus2}
            title="Credit notes"
            detail="Returns and allowances that reduce what a party owes, with the sale each line refers to. Not in the report at all until now."
            accent="rose"
          />
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-[4px] font-semibold"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="rounded-[4px] font-bold"
            onClick={() => onConfirm({ debit, credit })}
          >
            Download{debit || credit ? ` with ${[debit && 'debit', credit && 'credit'].filter(Boolean).join(' + ')} notes` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
