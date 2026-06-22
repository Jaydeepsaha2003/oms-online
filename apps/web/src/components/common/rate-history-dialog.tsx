import { ArrowRight, Clock, Loader2 } from 'lucide-react';
import type { RateHistoryEntry } from '@oms/shared';
import { formatDateTime } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Timeline of a rate's changes (old → new), newest first. */
export function RateHistoryDialog({
  subtitle,
  entries,
  loading,
  unit = '',
  onClose,
}: {
  subtitle: string;
  entries: RateHistoryEntry[];
  loading: boolean;
  /** Suffix shown after each rate (e.g. '%' for GST). */
  unit?: string;
  onClose: () => void;
}) {
  const fmt = (n: number | null) => (n == null ? '—' : `${n.toLocaleString()}${unit}`);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-4" /> Rate history
          </DialogTitle>
          <p className="text-muted-foreground text-sm">{subtitle}</p>
        </DialogHeader>

        {loading ? (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">No changes recorded yet.</p>
        ) : (
          <ol className="max-h-[55vh] space-y-2 overflow-y-auto">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2"
              >
                <span
                  className="text-muted-foreground font-mono text-xs"
                  title={e.changedByName ? `by ${e.changedByName}` : undefined}
                >
                  {formatDateTime(e.changedAt)}
                </span>
                <span className="flex items-center gap-2 text-sm tabular-nums">
                  <span className="text-muted-foreground line-through">{fmt(e.oldRate)}</span>
                  <ArrowRight className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="text-emerald-600 font-semibold">{fmt(e.newRate)}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
