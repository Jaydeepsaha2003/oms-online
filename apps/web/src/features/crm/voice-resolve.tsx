import { useState } from 'react';
import { Check, HelpCircle } from 'lucide-react';
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

export interface ResolveCandidate {
  id: number | null;
  label: string;
  /** Extra context line (e.g. an item's category), shown muted. */
  hint?: string;
}

export interface ResolveField {
  kind: 'customer' | 'item';
  /** What the voice model heard for this field. */
  spoken: string;
  candidates: ResolveCandidate[];
}

export interface ResolveAnswer {
  kind: 'customer' | 'item';
  label: string;
  id: number | null;
  /** True when the user kept their spoken text instead of a catalogue match. */
  isNew: boolean;
}

/**
 * Shown only when a spoken customer/item matches MORE THAN ONE entry in the
 * lists — the "re-ask the specific question" step. Each field defaults to its
 * closest match, so a quick confirm is enough; the user can also keep what they
 * said verbatim (a new party, or free-typed item text).
 */
export function VoiceResolveDialog({
  fields,
  onCancel,
  onResolve,
}: {
  fields: ResolveField[];
  onCancel: () => void;
  onResolve: (answers: ResolveAnswer[]) => void;
}) {
  // Per-field selection: a candidate index as a string, or 'spoken'.
  const [sel, setSel] = useState<Record<number, string>>(
    () => Object.fromEntries(fields.map((_, i) => [i, '0'])),
  );

  const confirm = () => {
    const answers: ResolveAnswer[] = fields.map((f, i) => {
      const choice = sel[i];
      if (choice === 'spoken') return { kind: f.kind, label: f.spoken, id: null, isNew: true };
      const c = f.candidates[Number(choice)];
      return { kind: f.kind, label: c.label, id: c.id, isNew: false };
    });
    onResolve(answers);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-blue-100 sm:mx-0">
            <HelpCircle className="size-6 text-blue-600" />
          </div>
          <DialogTitle>Just to be sure…</DialogTitle>
          <DialogDescription>
            A couple of things you said match more than one entry. Pick the right one — I’ve pre-selected the closest.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {fields.map((f, i) => (
            <div key={i} className="space-y-2">
              <div className="text-sm font-semibold">
                {f.kind === 'customer' ? 'Which party did you mean?' : 'Which item did you mean?'}
                <span className="text-muted-foreground font-normal"> — you said “{f.spoken}”</span>
              </div>
              <div className="space-y-1.5">
                {f.candidates.map((c, ci) => {
                  const picked = sel[i] === String(ci);
                  return (
                    <button
                      key={ci}
                      type="button"
                      onClick={() => setSel((s) => ({ ...s, [i]: String(ci) }))}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                        picked ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:bg-slate-50',
                      )}
                    >
                      <Radio on={picked} />
                      <span className="flex-1">
                        {c.label}
                        {c.hint && <span className="text-muted-foreground"> · {c.hint}</span>}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setSel((s) => ({ ...s, [i]: 'spoken' }))}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg border border-dashed px-3 py-2 text-left text-sm transition-colors',
                    sel[i] === 'spoken' ? 'border-blue-600 bg-blue-50' : 'border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <Radio on={sel[i] === 'spoken'} />
                  <span className="flex-1 text-slate-600">
                    {f.kind === 'customer' ? `Use “${f.spoken}” as a new party` : `Keep “${f.spoken}” as typed`}
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Skip</Button>
          <Button onClick={confirm}><Check className="size-4" /> Use selected</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full border',
        on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300',
      )}
    >
      {on && <Check className="size-3" />}
    </span>
  );
}
