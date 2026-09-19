import { Check, ChevronRight, FileSpreadsheet, Landmark, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** Tally's menu path to the Ledger report. */
const PATH = ['Gateway of Tally', 'Display More Reports', 'Account Books', 'Ledger'];

/**
 * The F12 settings that must be CHANGED. Every other option in that screen is
 * "No" — listing those just buried the few that matter, so they're summed up
 * in one line instead.
 */
const SETTINGS: [string, string][] = [
  ['Report Type', 'Ledger Accounts'],
  ['Period', 'Range to reconcile'],
  ['Show Voucher No.', 'Yes'],
  ['Format of Report', 'Condensed'],
  ['Type of Voucher entries', 'All Vouchers'],
  ['Include Opening Balance', 'Yes'],
  ['Balancing Method', 'Yearly'],
  ['Start each A/c on a fresh page', 'Yes'],
  ['Sorting Method', 'Default'],
];

const delay = (ms: number) => ({ animationDelay: `${ms}ms` });

function Key({ children, press = 0 }: { children: React.ReactNode; press?: number }) {
  return (
    <kbd
      className="oms-keypress inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-slate-300 border-b-[3px] bg-white px-1.5 font-mono text-[12px] font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      style={delay(press)}
    >
      {children}
    </kbd>
  );
}

function Step({ n, title, at, last, children }: { n: number; title: string; at: number; last?: boolean; children: React.ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {/* timeline rail, drawn top-down */}
      {!last && (
        <span
          aria-hidden
          className="oms-line-draw absolute top-8 bottom-0 left-[15px] w-[2px] origin-top rounded-full bg-gradient-to-b from-indigo-400 to-amber-400"
          style={delay(at + 200)}
        />
      )}
      <span
        className="oms-pop relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-blue-500 text-[13px] font-extrabold text-white shadow-lg shadow-indigo-500/30"
        style={delay(at)}
      >
        {n}
      </span>
      <div className="oms-rise min-w-0 flex-1 pt-1" style={delay(at + 80)}>
        <p className="text-[13.5px] font-bold text-slate-900 dark:text-white">{title}</p>
        <div className="mt-2">{children}</div>
      </div>
    </li>
  );
}

/**
 * "Export this from Tally first" — shown before every register upload. Three
 * animated steps (menu path → F12 settings → Ctrl+E), then the file picker.
 */
export function TallyExportGuide({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[34rem]">
        {/* ── Hero: Tally → Excel → OMS, with data flowing along the links ── */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-900 px-5 pt-5 pb-4 text-white">
          <div aria-hidden className="oms-hero-glow absolute -top-16 -right-10 size-56 rounded-full bg-amber-400/25 blur-3xl" />
          <div aria-hidden className="oms-hero-glow absolute -bottom-20 -left-10 size-56 rounded-full bg-sky-400/25 blur-3xl" style={delay(-3000)} />

          <div className="relative flex items-center justify-center gap-1.5">
            {(
              [
                ['Tally', <Landmark key="t" className="size-5" />, 'from-amber-400 to-orange-500'],
                ['Excel', <FileSpreadsheet key="e" className="size-5" />, 'from-emerald-400 to-green-600'],
                ['OMS', <Upload key="o" className="size-5" />, 'from-sky-400 to-indigo-500'],
              ] as const
            ).map(([label, icon, tone], i) => (
              <div key={label} className="flex items-center gap-1.5">
                {i > 0 && (
                  <svg aria-hidden width="46" height="10" viewBox="0 0 46 10" className="oms-rise text-white/70" style={delay(250 + i * 250)}>
                    <line x1="2" y1="5" x2="40" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 5" className="oms-dash-flow" />
                    <path d="M39 1.5 44 5l-5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                <div className="oms-pop flex flex-col items-center gap-1" style={delay(120 + i * 250)}>
                  <span
                    className={cn('oms-bob flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg ring-1 ring-white/30', tone)}
                    style={delay(i * -700)}
                  >
                    {icon}
                  </span>
                  <span className="text-[10.5px] font-bold tracking-wider text-white/80 uppercase">{label}</span>
                </div>
              </div>
            ))}
          </div>

          <DialogTitle className="oms-rise relative mt-3 text-center text-[17px] font-extrabold tracking-tight text-white" style={delay(700)}>
            Export from Tally in <span className="text-amber-300">3 steps</span>
          </DialogTitle>
          <DialogDescription className="oms-rise relative mt-0.5 text-center text-[12px] font-medium text-white/70" style={delay(780)}>
            Set it up once like this and the register reconciles cleanly.
          </DialogDescription>
        </div>

        {/* ── Steps ───────────────────────────────────────────────────────── */}
        <ol className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Step n={1} title="Open the Ledger report" at={850}>
            <div className="flex flex-wrap items-center gap-1">
              {PATH.map((p, i) => (
                <span key={p} className="oms-rise flex items-center gap-1" style={delay(950 + i * 110)}>
                  {i > 0 && <ChevronRight className="size-3.5 text-slate-400" />}
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
                      i === PATH.length - 1
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                        : 'bg-indigo-50 text-indigo-800 dark:bg-indigo-400/15 dark:text-indigo-200',
                    )}
                  >
                    {p}
                  </span>
                </span>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-slate-600 dark:text-slate-300">
              Pick <strong className="text-slate-900 dark:text-white">Sundry Debtors</strong> (or the party group you're reconciling).
            </p>
          </Step>

          <Step n={2} title="Press F12 and set only these" at={1350}>
            <div className="mb-2 flex items-center gap-1.5">
              <Key press={1500}>F12</Key>
              <span className="text-[11.5px] font-medium text-slate-500 dark:text-slate-400">opens Configuration</span>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {SETTINGS.map(([label, value], i) => (
                <div
                  key={label}
                  className="oms-rise flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm dark:border-white/10 dark:bg-white/5"
                  style={delay(1500 + i * 70)}
                >
                  <span className="oms-pop flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white" style={delay(1600 + i * 70)}>
                    <Check className="size-2.5" strokeWidth={3.5} />
                  </span>
                  <div className="min-w-0 leading-tight">
                    <p className="truncate text-[10.5px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
                    <p className="truncate text-[12px] font-bold text-slate-900 dark:text-white">{value}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="oms-rise mt-2 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300" style={delay(2200)}>
              Every other option stays <span className="font-bold text-slate-900 dark:text-white">No</span>
            </p>
          </Step>

          <Step n={3} title="Export as Excel" at={2300} last>
            <div className="flex flex-wrap items-center gap-1.5">
              <Key press={2500}>Ctrl</Key>
              <span className="text-[12px] font-bold text-slate-400">+</span>
              <Key press={2500}>E</Key>
              <ChevronRight className="size-4 text-slate-400" />
              <span className="oms-pop inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11.5px] font-bold text-white shadow-md shadow-emerald-600/30" style={delay(2650)}>
                <FileSpreadsheet className="size-3.5" /> .xlsx
              </span>
              <span className="text-[11.5px] font-medium text-slate-500 dark:text-slate-400">— upload that file here.</span>
            </div>
          </Step>
        </ol>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-slate-50/80 px-5 py-3 dark:bg-white/[0.03]">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 cursor-pointer rounded-lg px-3.5 text-[12.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onChoose();
            }}
            className="oms-login-cta relative inline-flex h-9 cursor-pointer items-center gap-1.5 overflow-hidden rounded-lg px-4 text-[12.5px] font-bold text-white shadow-lg shadow-indigo-500/30 transition-transform hover:-translate-y-0.5 active:translate-y-0"
          >
            <span aria-hidden className="oms-login-cta-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent" />
            <Upload className="size-3.5" /> Choose file
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
