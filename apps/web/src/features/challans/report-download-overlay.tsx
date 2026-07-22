import { CheckCircle2, Download, FileSpreadsheet, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ReportPhase = 'fetching' | 'building' | 'done';

interface Props {
  open: boolean;
  /** What's being generated, e.g. "Detailed View" / "Challan Summary". */
  title: string;
  phase: ReportPhase;
  count?: number;
  /** Dismiss the overlay (also lets the user close it manually / after download). */
  onClose?: () => void;
}

const LABEL: Record<ReportPhase, string> = {
  fetching: 'Gathering challans…',
  building: 'Building your spreadsheet…',
  done: 'Downloaded ✓',
};

/** Full-screen animated overlay shown while a "Get Report by" export is built. */
export function ReportDownloadOverlay({ open, title, phase, count, onClose }: Props) {
  if (!open) return null;
  const done = phase === 'done';
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/40 backdrop-blur-sm"
      // Tapping the dim backdrop dismisses it once the file is ready.
      onClick={done && onClose ? onClose : undefined}
    >
      {/* self-contained animation keyframes */}
      <style>{`
        @keyframes oms-indeterminate { 0%{left:-40%;width:40%} 50%{width:60%} 100%{left:100%;width:40%} }
        @keyframes oms-pop { 0%{transform:scale(.5);opacity:0} 60%{transform:scale(1.15)} 100%{transform:scale(1);opacity:1} }
        @keyframes oms-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
      `}</style>
      <div className="relative w-80 rounded-2xl border bg-white p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-2.5 right-2.5 grid size-7 place-items-center rounded-full transition-colors"
          >
            <X className="size-4" />
          </button>
        )}
        <div
          className={cn(
            'mx-auto mb-4 grid size-16 place-items-center rounded-2xl text-white shadow-md ring-1 ring-white/25',
            done ? 'bg-emerald-500' : 'bg-gradient-brand',
          )}
        >
          {done ? (
            <CheckCircle2 className="size-8" style={{ animation: 'oms-pop .4s ease-out' }} />
          ) : (
            <div className="relative">
              <FileSpreadsheet className="size-8 opacity-90" />
              <Download className="absolute -right-2 -bottom-2 size-5 rounded-full bg-white/95 p-0.5 text-emerald-600" style={{ animation: 'oms-float 1s ease-in-out infinite' }} />
            </div>
          )}
        </div>

        <p className="text-base font-semibold">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-sm">{LABEL[phase]}</p>
        {typeof count === 'number' && phase !== 'fetching' && (
          <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">{count.toLocaleString('en-IN')} challan(s)</p>
        )}

        {/* progress track */}
        <div className="bg-muted relative mt-4 h-1.5 overflow-hidden rounded-full">
          {done ? (
            <div className="h-full w-full rounded-full bg-emerald-500" />
          ) : (
            <div className="bg-gradient-brand absolute top-0 h-full rounded-full" style={{ animation: 'oms-indeterminate 1.1s ease-in-out infinite' }} />
          )}
        </div>

        {done && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="bg-foreground text-background mt-5 w-full rounded-lg py-2 text-sm font-semibold transition-opacity hover:opacity-90"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}

export default ReportDownloadOverlay;
