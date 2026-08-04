import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { http, getApiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** One product category on the challan that has no rate row configured, and
 *  which of the three rates are missing (`'GST' | 'Freight' | 'Packing'`). */
export interface MissingRateGroup {
  pCategory: string;
  missing: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerName: string;
  /** The party's transport, which trans rates are keyed by. */
  transportName?: string | null;
  groups: MissingRateGroup[];
  /** Re-price the challan once the masters have been written. */
  onSaved: () => void | Promise<void>;
}

type Draft = Record<string, { GST: string; Freight: string; Packing: string }>;

const blank = (groups: MissingRateGroup[]): Draft =>
  Object.fromEntries(groups.map((g) => [g.pCategory, { GST: '', Freight: '', Packing: '' }]));

/**
 * Adds the missing Customer GST / Transport rates without leaving the challan.
 *
 * Saving is blocked while a line is unpriced, so sending the operator off to
 * Settings would mean losing an in-progress challan — this writes the masters
 * in place and hands back to the form to re-price.
 */
export function RateFixDialog({ open, onOpenChange, customerName, transportName, groups, onSaved }: Props) {
  const [values, setValues] = useState<Draft>(() => blank(groups));
  const [busy, setBusy] = useState(false);

  // Re-arm whenever a different set of categories comes in, so a previous
  // dialog's typing never leaks into the next one.
  useEffect(() => {
    if (open) setValues(blank(groups));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groups.map((g) => g.pCategory).join('|')]);

  const set = (cat: string, field: 'GST' | 'Freight' | 'Packing', v: string) =>
    setValues((prev) => ({ ...prev, [cat]: { ...prev[cat], [field]: v } }));

  // The rate masters store whole numbers (`@IsInt()` on both upsert DTOs).
  const asInt = (s: string) => Math.round(Number(s));
  const filled = (s: string) => s.trim() !== '' && Number.isFinite(Number(s));

  /** Every missing field must be given a value — a half-filled save would leave
   *  the challan blocked and the operator none the wiser as to why. */
  const complete = groups.every((g) => g.missing.every((m) => filled(values[g.pCategory]?.[m as 'GST'] ?? '')));

  const submit = async () => {
    setBusy(true);
    try {
      for (const g of groups) {
        const v = values[g.pCategory];
        if (g.missing.includes('GST')) {
          await http.post('/gst-rates', { customerName, category: g.pCategory, rate: asInt(v.GST) });
        }
        for (const type of ['Freight', 'Packing'] as const) {
          if (!g.missing.includes(type)) continue;
          await http.post('/trans-rates', {
            customerName,
            category: g.pCategory,
            type: type.toUpperCase(),
            transportName: transportName || undefined,
            rate: asInt(v[type]),
          });
        }
      }
      toast.success('Rates saved');
      await onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Could not save the rates'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Set the missing rates</DialogTitle>
          <DialogDescription>
            For <span className="font-semibold">{customerName}</span>. These are saved to Customer GST Rates /
            Transport Rates and the challan is re-priced straight away.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-4 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.pCategory} className="rounded-md border p-3">
              <p className="mb-2 text-sm font-semibold">{g.pCategory}</p>
              <div className="grid grid-cols-3 gap-2">
                {(['GST', 'Freight', 'Packing'] as const).map((f) =>
                  g.missing.includes(f) ? (
                    <div key={f}>
                      <Label className="text-muted-foreground text-[11px] tracking-wide uppercase">
                        {f === 'GST' ? 'GST %' : `${f} rate`}
                      </Label>
                      <Input
                        inputMode="numeric"
                        value={values[g.pCategory]?.[f] ?? ''}
                        onChange={(e) => set(g.pCategory, f, e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  ) : (
                    <div key={f} className="text-muted-foreground self-end text-[11px]">
                      {f} already set
                    </div>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !complete}>
            {busy && <Loader2 className="animate-spin" />} Save rates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
