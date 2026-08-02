import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { problemsOf, useTallyReconRun, type ReconRunState } from './tally-recon-run-context';

/**
 * Floating status card for a Tally reconciliation.
 *
 * Shown app-wide so the user can start a reconciliation and carry on working:
 * the card follows them, and the result is announced wherever they end up. It
 * hides itself on the reconciliation page, which shows the same progress inline
 * and would otherwise duplicate it.
 */

const inr = (v: number) => (v ?? 0).toLocaleString('en-IN');

/** "Uploading 62%" / "Analysing register · 4s" — whichever the phase warrants. */
export function phaseLabel(s: ReconRunState): string {
  switch (s.phase) {
    case 'uploading':
      return `Uploading register · ${s.uploadPct}%`;
    case 'analysing':
      return `Matching against OMS · ${s.elapsed}s`;
    case 'done':
      return 'Reconciliation complete';
    case 'error':
      return 'Reconciliation failed';
    default:
      return '';
  }
}

/**
 * The bar. Determinate while the bytes are moving (a real percentage), then an
 * indeterminate sweep for the server's parse-and-match, which has no honest
 * percentage to report.
 */
export function ReconProgressBar({ state, className }: { state: ReconRunState; className?: string }) {
  const determinate = state.phase === 'uploading';
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-amber-200/70 dark:bg-amber-400/20', className)}>
      {determinate ? (
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-700 to-indigo-700 transition-[width] duration-200 dark:from-blue-500 dark:to-indigo-500"
          style={{ width: `${Math.max(4, state.uploadPct)}%` }}
        />
      ) : (
        <div className="animate-recon-sweep h-full w-2/5 rounded-full bg-gradient-to-r from-blue-700 to-indigo-700 dark:from-blue-500 dark:to-indigo-500" />
      )}
    </div>
  );
}

/** The three headline figures of a finished run. */
function DoneSummary({ state }: { state: ReconRunState }) {
  const r = state.result;
  if (!r) return null;
  const problems = problemsOf(r);
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] font-semibold">
      <span className="text-emerald-700 dark:text-emerald-400">{inr(r.matchedCount)} matched</span>
      {problems > 0 && <span className="text-rose-700 dark:text-rose-400">{inr(problems)} need attention</span>}
      <span className="text-muted-foreground">
        {inr(r.voucherCount)} vouchers · {inr(r.ledgerCount)} ledgers
      </span>
    </div>
  );
}

export function TallyReconDock() {
  const run = useTallyReconRun();
  const navigate = useNavigate();
  const location = useLocation();

  // The page itself shows this inline; don't stack two of the same thing.
  if (run.phase === 'idle' || location.pathname === '/account/tally-recon') return null;

  const done = run.phase === 'done';
  const failed = run.phase === 'error';

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed right-3 bottom-3 z-[60] w-[19.5rem] rounded-[6px] border-2 shadow-xl',
        'bg-card animate-in slide-in-from-bottom-3 fade-in duration-300',
        done
          ? 'border-emerald-500 dark:border-emerald-400/60'
          : failed
            ? 'border-rose-500 dark:border-rose-400/60'
            : 'border-amber-400 dark:border-amber-400/50',
      )}
    >
      <div className="flex items-start gap-2 p-2.5">
        <span className="mt-0.5 shrink-0">
          {done ? (
            <CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-400" />
          ) : failed ? (
            <AlertTriangle className="size-4 text-rose-700 dark:text-rose-400" />
          ) : (
            <Loader2 className="size-4 animate-spin text-blue-800 dark:text-blue-400" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] leading-tight font-bold">{phaseLabel(run)}</p>
          <p className="text-muted-foreground mt-0.5 flex items-center gap-1 truncate text-[11px] font-medium">
            <FileSpreadsheet className="size-3 shrink-0" />
            {run.fileName}
          </p>
          {done && <DoneSummary state={run} />}
          {failed && <p className="mt-1 text-[11.5px] font-medium text-rose-700 dark:text-rose-400">{run.error}</p>}
        </div>
        <button
          type="button"
          onClick={run.busy ? run.cancel : run.dismiss}
          title={run.busy ? 'Cancel reconciliation' : 'Dismiss'}
          className="text-muted-foreground hover:text-foreground -mt-0.5 -mr-0.5 shrink-0 cursor-pointer rounded p-0.5"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {run.busy && (
        <div className="px-2.5 pb-2.5">
          <ReconProgressBar state={run} />
          <p className="text-muted-foreground mt-1 text-[10.5px] font-medium">
            Keep working — this finishes in the background.
          </p>
        </div>
      )}

      {done && (
        <div className="flex justify-end gap-1.5 border-t border-emerald-200 px-2.5 py-1.5 dark:border-emerald-400/25">
          <Button variant="ghost" size="sm" className="h-7 rounded-[4px] text-[12px] font-semibold" onClick={run.dismiss}>
            Dismiss
          </Button>
          <Button
            size="sm"
            className="h-7 rounded-[4px] bg-emerald-700 text-[12px] font-bold text-white hover:bg-emerald-800"
            onClick={() => navigate('/account/tally-recon')}
          >
            View report
          </Button>
        </div>
      )}
    </div>
  );
}
