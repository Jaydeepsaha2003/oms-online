import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  Clock,
  FileSpreadsheet,
  History,
  Landmark,
  Link2,
  Banknote,
  Loader2,
  RotateCcw,
  Scale,
  Square,
  SquareCheckBig,
  Trash2,
  Upload,
  UserRoundX,
  X,
} from 'lucide-react';
import type { ReconPartyBalance, ReconReview, ReconRow, ReconStatus, TallyLedgerCategoryInput, UnmappedLedgers } from '@oms/shared';
import { RECON_PROBLEM_STATUSES } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { NativeSelect } from '@/components/common/combo';
import { MultiSelect } from '@/components/common/multi-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { usePartyLedgerLookups } from './use-party-ledger';
import {
  useCreateReconReceipts,
  useDeleteReconRun,
  useReconRun,
  useReconRuns,
  useMarkReconRows,
  useRerunRecon,
  useSaveTallyAlias,
  useSetLedgerCategory,
} from './use-tally-recon';
import { useTallyReconRun } from './tally-recon-run-context';
import { ReconProgressBar, phaseLabel } from './tally-recon-dock';

/* ── house chrome — the same language as Party Ledger / Daybook ────────────── */

const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON =
  'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';
const TH =
  'sticky top-0 z-10 bg-gradient-to-b from-blue-800 to-indigo-800 px-2 py-1.5 text-left text-[11px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap dark:from-blue-900 dark:to-indigo-900';
const TH_LINE = 'border-r border-white/15';
const TD = 'border-r border-r-amber-200/80 px-2 py-[3px] align-middle dark:border-r-amber-400/15 last:border-r-0';
const NUM = 'text-right tabular-nums';
const PANEL = 'border-amber-300 dark:border-amber-400/30';

const inr = (v: number) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
/** Accounting style: an empty figure reads as a dash, never as 0. */
const moneyOrDash = (v: number | null | undefined) => (v ? inr(v) : '-');
const prettyDate = (iso: string) => formatDate(iso);

/* ── status vocabulary ────────────────────────────────────────────────────── */

interface StatusMeta {
  label: string;
  /** Chip colours. */
  chip: string;
  /** Short blurb for the summary tile. */
  blurb: string;
}

const STATUS: Record<ReconStatus, StatusMeta> = {
  MATCHED: {
    label: 'Matched',
    chip: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300',
    blurb: 'Agree on both sides',
  },
  MISSING_IN_OMS: {
    label: 'Missing in OMS',
    chip: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-400/40 dark:bg-rose-400/10 dark:text-rose-300',
    blurb: 'In Tally, not in OMS',
  },
  MISSING_IN_TALLY: {
    label: 'Missing in Tally',
    chip: 'border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-400/40 dark:bg-orange-400/10 dark:text-orange-300',
    blurb: 'In OMS, not in Tally',
  },
  AMOUNT_MISMATCH: {
    label: 'Amount differs',
    chip: 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-400/50 dark:bg-amber-400/15 dark:text-amber-200',
    blurb: 'Found, figures disagree',
  },
  DATE_MISMATCH: {
    label: 'Date differs',
    chip: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300',
    blurb: 'Found, dates disagree',
  },
  BANK_MISMATCH: {
    label: 'Bank differs',
    chip: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-400/40 dark:bg-fuchsia-400/10 dark:text-fuchsia-300',
    blurb: 'Same money, other bank',
  },
  UNMATCHED_PARTY: {
    label: 'Party not mapped',
    chip: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-300',
    blurb: 'No OMS customer',
  },
  NOT_APPLICABLE: {
    label: 'Not applicable',
    chip: 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-500/40 dark:bg-slate-500/10 dark:text-slate-400',
    blurb: 'No OMS equivalent',
  },
};

const VCH_ORDER = ['OPENING', 'SALES', 'RECEIPT', 'CREDIT NOTE', 'DEBIT NOTE', 'DISCOUNT', 'OTHER'];

/** A line the user could have to do something about — the only kind worth marking. */
const isFlagged = (r: ReconRow) => r.status !== 'MATCHED' && r.status !== 'NOT_APPLICABLE';

/** Every unmapped ledger name across all three filings, however it's currently split. */
const ledgerTotal = (u: UnmappedLedgers) => u.party.length + u.expense.length + u.other.length;

/** A missing receipt that can be posted straight from the report. */
const canEnterAsReceipt = (r: ReconRow) =>
  r.vchType === 'RECEIPT' && r.status === 'MISSING_IN_OMS' && !r.resolvedAt && !!r.customerId;

const REVIEW: Record<Exclude<ReconReview, 'OPEN'>, { label: string; chip: string }> = {
  PENDING: {
    label: 'Pending',
    chip: 'border-amber-500 bg-amber-100 text-amber-900 dark:border-amber-400/60 dark:bg-amber-400/15 dark:text-amber-200',
  },
  SOLVED: {
    label: 'Solved',
    chip: 'border-emerald-500 bg-emerald-100 text-emerald-900 dark:border-emerald-400/60 dark:bg-emerald-400/15 dark:text-emerald-200',
  },
};

/**
 * The user's mark on a line, with a hairline "carried" cue when it was inherited
 * from an earlier upload — otherwise a mark made months ago looks like one made
 * against today's figures.
 */
function ReviewBadge({ row }: { row: ReconRow }) {
  if (row.review === 'OPEN') return null;
  // A mark this build has no entry for — what a payload written by a different
  // build looks like — is treated as no mark rather than taking the page down.
  const m: { label: string; chip: string } | undefined = REVIEW[row.review];
  if (!m) return null;
  const title = [
    row.reviewNote,
    row.reviewedBy ? `Marked by ${row.reviewedBy}` : null,
    row.reviewedAt ? prettyDate(row.reviewedAt) : null,
    row.reviewCarried ? 'Carried over from an earlier upload' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span
      title={title || undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-[1px] text-[10.5px] font-bold tracking-wide uppercase',
        m.chip,
      )}
    >
      {row.review === 'SOLVED' ? <Check className="size-3" /> : <Clock className="size-3" />}
      {m.label}
      {row.reviewCarried && <History className="size-3 opacity-70" />}
    </span>
  );
}

/** A status this build has no entry for — an older or newer payload than the
 *  code reading it. Shown plainly, because losing one chip's colour beats
 *  losing the whole report. */
const UNKNOWN_STATUS: StatusMeta = {
  label: 'Unknown',
  chip: 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-500/40 dark:bg-slate-500/10 dark:text-slate-400',
  blurb: '',
};

function StatusChip({ status }: { status: ReconStatus }) {
  const m = STATUS[status] ?? UNKNOWN_STATUS;
  return (
    <span className={cn('inline-block rounded-[3px] border px-1.5 py-[1px] text-[10.5px] font-bold tracking-wide whitespace-nowrap uppercase', m.chip)}>
      {m.label}
    </span>
  );
}

/** A clickable headline figure that doubles as the status filter. */
function Tile({
  label,
  blurb,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  blurb: string;
  value: number;
  tone: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'min-w-0 flex-1 cursor-pointer rounded-[4px] border px-2.5 py-1.5 text-left transition-colors',
        tone,
        active ? 'ring-2 ring-slate-800 ring-offset-1 dark:ring-amber-300' : 'hover:brightness-[0.97]',
      )}
    >
      <p className="truncate text-[10.5px] font-bold tracking-wide uppercase opacity-80">{label}</p>
      <p className="text-[17px] leading-tight font-extrabold tabular-nums">{inr(value)}</p>
      <p className="truncate text-[10.5px] font-medium opacity-70">{blurb}</p>
    </button>
  );
}

/**
 * Plain-language verdict for one party's balance.
 *
 * The whole point of this view is to answer "from when did we stop agreeing?", so
 * the wording leads with the last receipt: if both sides still matched there, the
 * user only has to look at what came after it.
 */
function balanceVerdict(b: ReconPartyBalance, periodFrom: string): { text: string; tone: string } {
  if (b.matched) {
    return { text: 'Agrees with the register', tone: 'text-emerald-700 dark:text-emerald-400' };
  }
  const openingDiffers = !!b.firstDivergenceOn && b.firstDivergenceOn.slice(0, 10) === periodFrom.slice(0, 10);
  if (openingDiffers) {
    return {
      text: `Opening balances already differ (Tally ${inr(b.tallyOpening)} vs OMS ${inr(b.omsOpening)}) — nothing in this period can reconcile it.`,
      tone: 'text-rose-700 dark:text-rose-400',
    };
  }
  if (b.divergedAfterLastReceipt && b.lastReceiptDate) {
    return {
      text: `Agreed up to ${prettyDate(b.lastReceiptDate)} (your last receipt${b.lastReceiptRef ? ` ${b.lastReceiptRef}` : ''}) — the difference starts ${b.firstDivergenceOn ? `on ${prettyDate(b.firstDivergenceOn)}` : 'after that'}.`,
      tone: 'text-emerald-700 dark:text-emerald-400',
    };
  }
  if (b.agreedAtLastReceipt === false && b.lastReceiptDate) {
    return {
      text: `Already differed by ${inr(Math.abs((b.tallyAtLastReceipt ?? 0) - (b.omsAtLastReceipt ?? 0)))} at your last receipt on ${prettyDate(b.lastReceiptDate)}${b.firstDivergenceOn ? ` — first parts company ${prettyDate(b.firstDivergenceOn)}` : ''}.`,
      tone: 'text-rose-700 dark:text-rose-400',
    };
  }
  if (!b.lastReceiptDate) {
    return {
      text: `No receipt recorded in this period${b.firstDivergenceOn ? ` — differs from ${prettyDate(b.firstDivergenceOn)}` : ''}.`,
      tone: 'text-amber-700 dark:text-amber-300',
    };
  }
  return {
    text: `Diverged ${b.firstDivergenceOn ? prettyDate(b.firstDivergenceOn) : 'mid-period'} but back in step by your last receipt on ${prettyDate(b.lastReceiptDate)}.`,
    tone: 'text-sky-700 dark:text-sky-400',
  };
}

/** Dr / Cr the way an accountant reads it, from a signed figure. */
const drCr = (v: number) => (v === 0 ? '-' : `${inr(Math.abs(v))} ${v > 0 ? 'Dr' : 'Cr'}`);

/**
 * Per-party balance comparison — whose bottom line disagrees, and from when.
 *
 * Clicking a party drops back into the voucher report filtered to it, which is
 * where the actual differing documents are.
 */
function BalancesView({
  run,
  onlyDiffering,
  setOnlyDiffering,
  onPickParty,
}: {
  run: {
    fromDate: string;
    balances: ReconPartyBalance[];
    balanceCheckedCount: number;
    balanceMismatchCount: number;
  };
  onlyDiffering: boolean;
  setOnlyDiffering: (v: boolean) => void;
  // Every Tally ledger name this balance combines (see sourceLedgerNames) —
  // a merged party's rows on the Vouchers tab are still filed under their own
  // original names, so the jump has to filter by all of them at once.
  onPickParty: (ledgerNames: string[]) => void;
}) {
  const list = onlyDiffering ? run.balances.filter((b) => !b.matched) : run.balances;
  const agreeing = run.balanceCheckedCount - run.balanceMismatchCount;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50/70 px-2.5 py-1.5 dark:border-amber-400/20 dark:bg-amber-400/5">
        <span className="text-[12px] font-semibold">
          <span className="font-extrabold text-rose-700 tabular-nums dark:text-rose-400">{inr(run.balanceMismatchCount)}</span> of{' '}
          <span className="font-extrabold tabular-nums">{inr(run.balanceCheckedCount)}</span> parties disagree
          <span className="text-muted-foreground"> · {inr(agreeing)} agree</span>
        </span>
        <button
          type="button"
          onClick={() => setOnlyDiffering(!onlyDiffering)}
          aria-pressed={onlyDiffering}
          className={cn(
            'ml-auto cursor-pointer rounded-[3px] border px-2 py-[2px] text-[11.5px] font-semibold transition-colors',
            onlyDiffering ? CONTROL_ON : 'border-amber-300 hover:bg-amber-100 dark:border-amber-400/40',
          )}
        >
          {onlyDiffering ? 'Showing only differences' : 'Showing every party'}
        </button>
      </div>

      {/* Desktop */}
      <div
        className={cn(
          'hidden min-h-0 flex-1 overflow-auto overscroll-x-contain sm:block',
          '[scrollbar-width:thin] [scrollbar-color:var(--color-amber-400)_var(--color-amber-100)]',
          '[&_tbody]:select-none',
        )}
      >
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">Closing balance per party, Tally against OMS</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(TH, TH_LINE)}>Party</th>
              <th scope="col" className={cn(TH, TH_LINE, 'w-32 text-right')}>Tally Closing</th>
              <th scope="col" className={cn(TH, TH_LINE, 'w-32 text-right')}>OMS Closing</th>
              <th scope="col" className={cn(TH, TH_LINE, 'w-32 text-right')}>Difference</th>
              <th scope="col" className={cn(TH, TH_LINE, 'w-28')}>Last Receipt</th>
              <th scope="col" className={cn(TH, 'min-w-[22rem]')}>What it means</th>
            </tr>
          </thead>
          <tbody>
            {!list.length ? (
              <tr>
                <td colSpan={6} className="text-muted-foreground h-24 text-center text-[13px] font-medium">
                  {onlyDiffering ? 'Every closing balance agrees with the register.' : 'No parties could be compared.'}
                </td>
              </tr>
            ) : (
              list.map((b) => {
                const v = balanceVerdict(b, run.fromDate);
                return (
                  <tr
                    key={b.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onPickParty(b.sourceLedgerNames ?? [b.ledgerName])}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onPickParty(b.sourceLedgerNames ?? [b.ledgerName]);
                      }
                    }}
                    title="Show this party's vouchers"
                    className={cn(
                      'group cursor-pointer border-b border-amber-200/70 outline-none dark:border-amber-400/10',
                      'even:bg-amber-50/70 dark:even:bg-amber-400/[0.05]',
                      'hover:bg-amber-200/80 dark:hover:bg-amber-400/20',
                      'focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-inset',
                    )}
                  >
                    <td className={cn(TD, 'font-bold text-slate-900 group-hover:underline dark:text-slate-100')}>
                      {b.ledgerName}
                      {b.customerName && b.customerName !== b.ledgerName && (
                        <span className="text-muted-foreground ml-1.5 text-[11.5px] font-semibold">-&gt; {b.customerName}</span>
                      )}
                      {b.sourceLedgerNames && b.sourceLedgerNames.length > 1 && (
                        <span
                          className="ml-1.5 rounded-[3px] border border-violet-300 px-1 text-[10px] font-bold text-violet-700 uppercase dark:border-violet-400/40 dark:text-violet-300"
                          title={`This party was renamed in Tally — combined from ${b.sourceLedgerNames.length} ledger names: ${b.sourceLedgerNames.join(', ')}`}
                        >
                          combined ({b.sourceLedgerNames.length})
                        </span>
                      )}
                    </td>
                    <td className={cn(TD, NUM, 'font-semibold')}>{drCr(b.tallyClosing)}</td>
                    <td className={cn(TD, NUM, 'font-semibold')}>{drCr(b.omsClosing)}</td>
                    <td
                      className={cn(
                        TD,
                        NUM,
                        'font-extrabold',
                        b.matched ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400',
                      )}
                    >
                      {b.matched ? '-' : drCr(b.difference)}
                    </td>
                    <td className={cn(TD, 'text-[12.5px] font-semibold whitespace-nowrap tabular-nums')}>
                      {b.lastReceiptDate ? prettyDate(b.lastReceiptDate) : '-'}
                    </td>
                    <td className={cn(TD, 'text-[11.5px] font-medium', v.tone)}>{v.text}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Phones */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 sm:hidden">
        {!list.length ? (
          <p className="text-muted-foreground px-4 py-10 text-center text-[13px] font-medium">
            {onlyDiffering ? 'Every balance agrees.' : 'No parties could be compared.'}
          </p>
        ) : (
          list.map((b) => {
            const v = balanceVerdict(b, run.fromDate);
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onPickParty(b.sourceLedgerNames ?? [b.ledgerName])}
                className="bg-card block w-full overflow-hidden rounded-[4px] border border-amber-200 p-2.5 text-left shadow-sm dark:border-amber-400/20"
              >
                <p className="truncate text-[13.5px] font-bold">
                  {b.ledgerName}
                  {b.sourceLedgerNames && b.sourceLedgerNames.length > 1 && (
                    <span className="text-muted-foreground ml-1.5 text-[10.5px] font-bold uppercase">
                      combined ({b.sourceLedgerNames.length})
                    </span>
                  )}
                </p>
                <div className="mt-1 grid grid-cols-3 gap-1 text-[11.5px]">
                  <span>
                    <span className="text-muted-foreground block text-[10px] font-bold uppercase">Tally</span>
                    <span className="font-semibold tabular-nums">{drCr(b.tallyClosing)}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground block text-[10px] font-bold uppercase">OMS</span>
                    <span className="font-semibold tabular-nums">{drCr(b.omsClosing)}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground block text-[10px] font-bold uppercase">Difference</span>
                    <span className={cn('font-extrabold tabular-nums', b.matched ? 'text-emerald-700' : 'text-rose-700')}>
                      {b.matched ? '-' : drCr(b.difference)}
                    </span>
                  </span>
                </div>
                <p className={cn('mt-1.5 text-[11.5px] font-medium', v.tone)}>{v.text}</p>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

/* ── the page ─────────────────────────────────────────────────────────────── */

export function TallyReconPage() {
  const { can } = usePermissions();
  const canRun = can('tallyrecon:create');
  const canDelete = can('tallyrecon:delete');
  const canEnterReceipt = canRun && can('payment:create');
  /** Marking is an annotation, so recon-create alone is enough for it. */
  const canMark = canRun;

  const fileRef = useRef<HTMLInputElement>(null);
  const [runId, setRunId] = useState<number | null>(null);

  const [status, setStatus] = useState<ReconStatus | 'PROBLEMS' | ''>('PROBLEMS');
  const [review, setReview] = useState<ReconReview | ''>('');
  const [view, setView] = useState<'VOUCHERS' | 'BALANCES'>('VOUCHERS');
  const [onlyDiffering, setOnlyDiffering] = useState(true);
  const [vchType, setVchType] = useState('');
  /*
   * Two party filters, because a reconciliation has two sides.
   *
   * "Our party" is the OMS customer, "Tally party" the register's own ledger
   * name — and the whole point of this screen is that those disagree. One
   * combined filter could only search one of them, which meant the ledger you
   * could see on the row was not the ledger you could filter by.
   *
   * Both take several values: the normal use is a handful of parties being
   * chased together, and picking them one at a time meant one pass of the whole
   * report per party.
   */
  const [tallyParties, setTallyParties] = useState<string[]>([]);
  const [omsParties, setOmsParties] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const [aliasFor, setAliasFor] = useState<string | null>(null);
  const [aliasCustomer, setAliasCustomer] = useState('');
  // The full unmapped-ledgers list lives in its own dialog now (see below) — a
  // party with 100+ unmapped ledgers used to wrap that many pill buttons right
  // on the page, several rows tall, and squeeze the report table underneath it
  // down to almost nothing. This just tracks whether that dialog is open.
  const [unmappedListOpen, setUnmappedListOpen] = useState(false);
  const [ledgerTab, setLedgerTab] = useState<'party' | 'expense' | 'other'>('party');
  // Ticked ledger names in the CURRENT tab, for the bulk action bar. Cleared on
  // every tab switch and after a successful filing — stale ids left over from
  // a tab the user isn't looking at any more, or from a batch that just moved
  // out of this list, would make the next click act on the wrong rows.
  const [selectedLedgers, setSelectedLedgers] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bankOverride, setBankOverride] = useState('');

  const { data: runs } = useReconRuns();
  // Default to the newest run so the page is never empty after a reload.
  const activeId = runId ?? runs?.[0]?.id ?? null;
  const { data: run, isFetching, refetch: refetchRun } = useReconRun(activeId);
  const { data: lookups } = usePartyLedgerLookups();

  // The reconciliation itself lives in the app shell so it survives navigating
  // away mid-run; this page just drives it and renders its progress inline.
  const recon = useTallyReconRun();
  const removeRun = useDeleteReconRun();
  const saveAlias = useSaveTallyAlias();
  const setLedgerCategory = useSetLedgerCategory();
  const rerun = useRerunRecon();
  const createReceipts = useCreateReconReceipts();
  const markRows = useMarkReconRows();

  const custByName = useMemo(() => new Map((lookups?.customers ?? []).map((c) => [c.name, c.id])), [lookups]);
  const customerOptions = useMemo(() => [...custByName.keys()].sort((a, b) => a.localeCompare(b)), [custByName]);

  const rows = run?.rows ?? [];
  // Sets, not arrays: `visible` tests every row against both, and `includes`
  // over a 20-party pick across 2,700 rows is 50k string comparisons a render.
  const tallySet = useMemo(() => new Set(tallyParties), [tallyParties]);
  const omsSet = useMemo(() => new Set(omsParties), [omsParties]);
  const tallyPartyOptions = useMemo(() => [...new Set(rows.map((r) => r.ledgerName))].sort((a, b) => a.localeCompare(b)), [rows]);
  /** Only the parties the register actually mapped — an unmapped ledger has no
   *  OMS name to offer, and a blank entry in the list is not a choice. */
  const omsPartyOptions = useMemo(
    () => [...new Set(rows.map((r) => r.customerName).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const vchOptions = useMemo(() => VCH_ORDER.filter((t) => rows.some((r) => r.vchType === t)), [rows]);

  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (status === 'PROBLEMS' && !RECON_PROBLEM_STATUSES.includes(r.status)) return false;
        if (status && status !== 'PROBLEMS' && r.status !== status) return false;
        if (review && r.review !== review) return false;
        if (vchType && r.vchType !== vchType) return false;
        if (tallySet.size && !tallySet.has(r.ledgerName)) return false;
        if (omsSet.size && !(r.customerName && omsSet.has(r.customerName))) return false;
        return true;
      }),
    [rows, status, review, vchType, tallySet, omsSet],
  );

  /** Party blocks, Tally-style: a heading per ledger with its rows beneath. */
  const blocks = useMemo(() => {
    const map = new Map<string, ReconRow[]>();
    for (const r of visible) {
      const list = map.get(r.ledgerName);
      if (list) list.push(r);
      else map.set(r.ledgerName, [r]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  /**
   * How many rows actually get mounted in the DOM, not just how many match
   * the filter. A big register's default "Needs Attention" view is 3,600+
   * rows — rendered in full, that's tens of thousands of <tr>/<td> nodes, in
   * BOTH the desktop table AND the phone card list at once (Tailwind's
   * `hidden sm:block` only hides one with CSS — React still mounts both), and
   * THAT is what made switching a filter or opening a run feel hangy: the
   * browser laying out and painting all of it, every time, whether the tab in
   * front is the one showing it or not.
   *
   * Capped here instead of a full virtualized-scroll rewrite (react-virtual
   * et al.) because this report's columns mix fixed and flexible widths and a
   * few carry wrapping text — genuinely virtualizing that means moving off
   * real <table> markup, which needs to be seen to get right, and this screen
   * can't be logged into to check. A render cap needs none of that: it's the
   * same rows, same markup, just fewer mounted before the user asks for more.
   * `RECON_PROBLEM_STATUSES`-sized views (the default) are the common case
   * this actually fixes; a narrow filter typically lands well under the cap
   * on its own and this changes nothing for it.
   */
  const RENDER_CHUNK = 500;
  const [renderLimit, setRenderLimit] = useState(RENDER_CHUNK);
  // A new filter or a different run is a different set of rows — start over
  // at one chunk rather than carrying forward a limit sized for a bigger (or
  // smaller) list that no longer applies.
  useEffect(() => setRenderLimit(RENDER_CHUNK), [blocks]);
  const { renderedBlocks, shownRowCount, remainingRowCount } = useMemo(() => {
    let shown = 0;
    const out: typeof blocks = [];
    for (const block of blocks) {
      // Always take at least one block whole, even if it alone exceeds the
      // limit — a ledger's rows are never split across the cut, and an empty
      // list never happens just because block #1 is unusually large.
      if (shown >= renderLimit && out.length > 0) break;
      out.push(block);
      shown += block[1].length;
    }
    const total = blocks.reduce((s, b) => s + b[1].length, 0);
    return { renderedBlocks: out, shownRowCount: shown, remainingRowCount: Math.max(0, total - shown) };
  }, [blocks, renderLimit]);

  /** Every flagged line can be selected, so one selection drives every bulk action. */
  const selectable = useMemo(() => visible.filter(isFlagged), [visible]);
  const selectedRows = useMemo(() => selectable.filter((r) => picked.has(r.id)), [selectable, picked]);

  /** Of those, the ones that are a missing receipt we can actually post. */
  const entryable = useMemo(() => visible.filter(canEnterAsReceipt), [visible]);
  const entryableIds = useMemo(() => new Set(entryable.map((r) => r.id)), [entryable]);
  const pickedRows = useMemo(() => selectedRows.filter((r) => entryableIds.has(r.id)), [selectedRows, entryableIds]);
  const pickedTotal = pickedRows.reduce((s, r) => s + (r.cr || r.dr), 0);

  const isEntryable = (r: ReconRow) => entryableIds.has(r.id);
  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setPicked((prev) => (selectable.length > 0 && selectable.every((r) => prev.has(r.id)) ? new Set() : new Set(selectable.map((r) => r.id))));

  /* ── actions ────────────────────────────────────────────────────────────── */

  const onPickFile = () => fileRef.current?.click();

  const onFile = (file: File | undefined) => {
    if (!file) return;
    // Same extension check the server enforces (tally-recon.controller.ts) —
    // done here FIRST so a wrong file is refused before it's ever uploaded,
    // not after a full upload + parse round trip. The server check stays as
    // the real backstop (anyone could call the API directly), this one is
    // purely to save the user the wait and say so plainly up front.
    if (!/\.xlsx?$/i.test(file.name)) {
      toast.error('Wrong file — don’t upload this one.', {
        description: `"${file.name}" isn’t a Tally register. Only the .xlsx ledger export from Tally can be reconciled — export that from Tally and upload it instead.`,
        duration: 10_000,
      });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    // Fire and forget: the provider owns the request, and both the toast and the
    // floating card report the outcome even if the user leaves this page.
    void recon.start(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  // A run that finishes — here or while the user was elsewhere — becomes the
  // report on screen. Consumed once, so manually picking an older run then sticks.
  useEffect(() => {
    if (recon.phase !== 'done') return;
    const fresh = recon.takeFreshRunId();
    if (fresh == null) return;
    setRunId(fresh);
    setPicked(new Set());
    setStatus('PROBLEMS');
    setReview('');
    setVchType('');
    setTallyParties([]);
    setOmsParties([]);
  }, [recon.phase, recon.takeFreshRunId]);

  const onDeleteRun = async () => {
    if (!activeId) return;
    try {
      await removeRun.mutateAsync(activeId);
      setRunId(null);
      setPicked(new Set());
      toast.success('Reconciliation deleted.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete that reconciliation.');
    }
  };

  const onSaveAlias = async () => {
    if (!aliasFor) return;
    /*
     * Resolve the typed name to a real customer, and SAY SO when it doesn't.
     *
     * This used to `return` on a miss, which is how the dialog came to do
     * nothing at all: the field was a creatable combo, so typing "pn" and
     * taking its "Create pn" row left a value that matches no customer — and
     * then Save was enabled, clicked, and silently did nothing. The field is a
     * fixed-list picker now (see the dialog), and this is the backstop.
     */
    const customerId = custByName.get(aliasCustomer);
    if (!customerId) {
      toast.error(
        aliasCustomer.trim()
          ? `"${aliasCustomer}" is not an OMS customer — pick one from the list.`
          : 'Pick the OMS customer this ledger belongs to.',
      );
      return;
    }
    try {
      await saveAlias.mutateAsync({ tallyName: aliasFor, customerId });
      setAliasFor(null);
      setAliasCustomer('');
      /*
       * Re-reconcile straight away rather than telling the user to upload the
       * same workbook again. Mapping a ledger changes nothing about the
       * register, only who it belongs to, so the comparison can simply be
       * replayed against the copy already stored on the run.
       *
       * Runs recorded before registers were kept report canRerun false; those
       * still get the old instruction, because for them it is the truth.
       */
      if (activeId != null && run?.canRerun) {
        await rerun.mutateAsync(activeId);
        toast.success(`"${aliasFor}" now maps to ${aliasCustomer}. Register re-checked.`);
      } else {
        toast.success(`"${aliasFor}" now maps to ${aliasCustomer}. Upload the register again to re-check it.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that mapping.');
    }
  };

  /**
   * Files one or more ledgers as Expense / Other, or clears that filing back
   * to Party — one save for the whole batch, whether it's a single row's
   * button or every ticked checkbox in the tab.
   *
   * Deliberately does NOT rerun the report (measured: ~1s on this run's
   * 4,500+ rows). It used to, on every single save, which made triaging
   * 100+ ledgers one at a time cost that long in pure waiting. The dialog
   * still updates immediately either way — `run.unmatchedLedgers` is
   * re-derived from the SAME table this just wrote to, fresh on every read
   * (see bucketLedgers on the server), so a plain refetch (a few ms) is
   * enough to move these names to their new tab right now. Only the run's
   * own KPI counters (Needs Attention, etc.) are a snapshot that stays as it
   * was until `recheckReport` below is used — deliberately a separate,
   * explicit action, not an automatic side effect of filing.
   */
  const onSetCategory = async (tallyNames: string[], category: TallyLedgerCategoryInput) => {
    if (!tallyNames.length) return;
    const label = category === 'EXPENSE' ? 'Expense' : category === 'OTHER' ? 'Other' : 'Party';
    const who = tallyNames.length === 1 ? `"${tallyNames[0]}"` : `${tallyNames.length} ledgers`;
    try {
      await setLedgerCategory.mutateAsync({ tallyNames, category });
      setSelectedLedgers(new Set());
      await refetchRun();
      toast.success(category === 'PARTY' ? `${who} moved back to Party.` : `${who} filed as ${label}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that filing.');
    }
  };

  /**
   * The explicit "bring the counters up to date" step filing no longer does
   * automatically. Same re-check-in-place vs. re-upload distinction as
   * onSaveAlias — canRerun is false only for runs recorded before the
   * register itself was kept.
   */
  const recheckReport = async () => {
    if (activeId == null) return;
    if (!run?.canRerun) return toast.info('Upload the register again to re-check it — this run predates the stored copy.');
    try {
      await rerun.mutateAsync(activeId);
      toast.success('Report re-checked — counters are up to date.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not re-check the report.');
    }
  };

  const onMark = async (next: ReconReview) => {
    if (!selectedRows.length) return;
    try {
      const res = await markRows.mutateAsync({ rowIds: selectedRows.map((r) => r.id), review: next });
      setPicked(new Set());
      const n = res.updated;
      toast.success(
        next === 'OPEN'
          ? `Cleared ${n} mark${n === 1 ? '' : 's'}.`
          : `Marked ${n} line${n === 1 ? '' : 's'} as ${next === 'SOLVED' ? 'solved' : 'pending'}.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that mark.');
    }
  };

  const onCreateReceipts = async () => {
    if (!pickedRows.length) return;
    try {
      const res = await createReceipts.mutateAsync({
        rowIds: pickedRows.map((r) => r.id),
        bankName: bankOverride.trim() || undefined,
      });
      setConfirmOpen(false);
      setPicked(new Set());
      setBankOverride('');
      if (res.created.length) toast.success(`Entered ${res.created.length} receipt${res.created.length === 1 ? '' : 's'}.`);
      for (const f of res.failed) toast.error(`Row ${f.rowId}: ${f.reason}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not enter those receipts.');
    }
  };

  const problemCount = run ? run.missingInOms + run.missingInTally + run.mismatchCount + run.unmatchedParty : 0;
  const hasFilters =
    !!vchType || tallyParties.length > 0 || omsParties.length > 0 || !!review || status !== 'PROBLEMS';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {/* ── toolbar ───────────────────────────────────────────────────────── */}
      <div className={cn('bg-card font-poppins rounded-[4px] border shadow-sm', PANEL)}>
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          {canRun && (
            <Button
              className="h-9 gap-1.5 rounded-[4px] bg-slate-800 text-[12.5px] font-bold text-amber-200 hover:bg-slate-700 dark:bg-slate-900"
              onClick={onPickFile}
              disabled={recon.busy}
            >
              {recon.busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              {recon.busy ? 'Reconciling…' : 'Upload Tally register'}
            </Button>
          )}

          {!!runs?.length && (
            <div className="w-full sm:w-64">
              <Label className="sr-only" htmlFor="recon-run">
                Reconciliation
              </Label>
              <NativeSelect
                id="recon-run"
                value={activeId ? String(activeId) : ''}
                onChange={(v) => {
                  setRunId(v ? Number(v) : null);
                  setPicked(new Set());
                }}
                options={runs.map((r) => ({ value: String(r.id), label: `${prettyDate(r.uploadedAt)} · ${r.fileName}` }))}
                placeholder="Reconciliation"
                className={cn(CONTROL, 'font-medium', CONTROL_ON)}
              />
            </div>
          )}

          <div className="w-full sm:w-52">
            <MultiSelect
              label="Our party"
              values={omsParties}
              onChange={setOmsParties}
              options={omsPartyOptions}
              itemLabel="party"
              pluralLabel="parties"
              searchPlaceholder="Search our parties…"
              emptyText="No mapped parties in this run."
              className={cn(CONTROL, 'font-medium', omsParties.length > 0 && CONTROL_ON)}
            />
          </div>

          <div className="w-full sm:w-52">
            <MultiSelect
              label="Tally party"
              values={tallyParties}
              onChange={setTallyParties}
              options={tallyPartyOptions}
              itemLabel="party"
              pluralLabel="parties"
              searchPlaceholder="Search Tally ledgers…"
              emptyText="No ledgers in this run."
              className={cn(CONTROL, 'font-medium', tallyParties.length > 0 && CONTROL_ON)}
            />
          </div>

          <div className="w-full sm:w-40">
            <Label className="sr-only" htmlFor="recon-vch">
              Voucher type
            </Label>
            <NativeSelect
              id="recon-vch"
              value={vchType}
              onChange={setVchType}
              options={['', ...vchOptions]}
              placeholder="Voucher type"
              className={cn(CONTROL, 'font-medium', vchType && CONTROL_ON)}
            />
          </div>

          <div className="w-full sm:w-40">
            <Label className="sr-only" htmlFor="recon-review">
              Review
            </Label>
            <NativeSelect
              id="recon-review"
              value={review}
              onChange={(v) => setReview(v as ReconReview | '')}
              options={[
                { value: '', label: 'Any review' },
                { value: 'OPEN', label: 'Unmarked' },
                { value: 'PENDING', label: 'Pending' },
                { value: 'SOLVED', label: 'Solved' },
              ]}
              placeholder="Review"
              className={cn(CONTROL, 'font-medium', review && CONTROL_ON)}
            />
          </div>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 rounded-[4px] text-[12.5px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-400/10"
              onClick={() => {
                setStatus('PROBLEMS');
                setReview('');
                setVchType('');
                setTallyParties([]);
                setOmsParties([]);
              }}
            >
              <X className="size-3.5" /> Reset
            </Button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {run && (
              <p className="text-muted-foreground hidden text-[12px] font-medium lg:block">
                {remainingRowCount > 0 ? (
                  // The render cap is active — say so, rather than silently
                  // showing fewer rows than the count implies.
                  <>
                    <span className="text-foreground font-bold tabular-nums">{inr(shownRowCount)}</span> of{' '}
                    <span className="text-foreground font-bold tabular-nums">{inr(visible.length)}</span> rows shown
                  </>
                ) : (
                  <>
                    <span className="text-foreground font-bold tabular-nums">{inr(visible.length)}</span> row{visible.length === 1 ? '' : 's'}
                  </>
                )}
                {isFetching && <Loader2 className="ml-1 inline size-3 animate-spin align-[-2px]" />}
              </p>
            )}
            {run && canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 rounded-[4px] text-[12.5px] font-semibold text-rose-700 hover:bg-rose-50 hover:text-rose-900 dark:text-rose-300 dark:hover:bg-rose-400/10"
                onClick={() => void onDeleteRun()}
                disabled={removeRun.isPending}
              >
                <Trash2 className="size-3.5" /> Delete
              </Button>
            )}
          </div>
        </div>

        {/* ── headline figures, doubling as the status filter ──────────────── */}
        {run && (
          <div className="flex flex-wrap gap-1.5 border-t border-amber-200 px-2.5 py-2 sm:gap-2 sm:px-3 dark:border-amber-400/20">
            <Tile
              label="Needs attention"
              blurb="Everything flagged"
              value={problemCount}
              tone="border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-500/40 dark:bg-slate-500/10 dark:text-slate-100"
              active={status === 'PROBLEMS'}
              onClick={() => setStatus(status === 'PROBLEMS' ? '' : 'PROBLEMS')}
            />
            <Tile
              label={STATUS.MATCHED.label}
              blurb={STATUS.MATCHED.blurb}
              value={run.matchedCount}
              tone={STATUS.MATCHED.chip}
              active={status === 'MATCHED'}
              onClick={() => setStatus(status === 'MATCHED' ? '' : 'MATCHED')}
            />
            <Tile
              label={STATUS.MISSING_IN_OMS.label}
              blurb={STATUS.MISSING_IN_OMS.blurb}
              value={run.missingInOms}
              tone={STATUS.MISSING_IN_OMS.chip}
              active={status === 'MISSING_IN_OMS'}
              onClick={() => setStatus(status === 'MISSING_IN_OMS' ? '' : 'MISSING_IN_OMS')}
            />
            <Tile
              label={STATUS.MISSING_IN_TALLY.label}
              blurb={STATUS.MISSING_IN_TALLY.blurb}
              value={run.missingInTally}
              tone={STATUS.MISSING_IN_TALLY.chip}
              active={status === 'MISSING_IN_TALLY'}
              onClick={() => setStatus(status === 'MISSING_IN_TALLY' ? '' : 'MISSING_IN_TALLY')}
            />
            <Tile
              label="Figures differ"
              blurb="Amount or date"
              value={run.mismatchCount}
              tone={STATUS.AMOUNT_MISMATCH.chip}
              active={status === 'AMOUNT_MISMATCH'}
              onClick={() => setStatus(status === 'AMOUNT_MISMATCH' ? '' : 'AMOUNT_MISMATCH')}
            />
            <Tile
              label={STATUS.BANK_MISMATCH.label}
              blurb={STATUS.BANK_MISMATCH.blurb}
              value={run.bankMismatchCount}
              tone={STATUS.BANK_MISMATCH.chip}
              active={status === 'BANK_MISMATCH'}
              onClick={() => setStatus(status === 'BANK_MISMATCH' ? '' : 'BANK_MISMATCH')}
            />
            <Tile
              label={STATUS.UNMATCHED_PARTY.label}
              // Party only — a ledger filed as Expense/Other isn't a problem
              // needing attention any more (see UnmappedLedgers).
              blurb={`${run.unmatchedLedgers.party.length} ledger${run.unmatchedLedgers.party.length === 1 ? '' : 's'}`}
              value={run.unmatchedParty}
              tone={STATUS.UNMATCHED_PARTY.chip}
              active={status === 'UNMATCHED_PARTY'}
              onClick={() => setStatus(status === 'UNMATCHED_PARTY' ? '' : 'UNMATCHED_PARTY')}
            />
            {/* Review progress. A mark never removes a line from the counts above —
                it records what has been done about it. */}
            <Tile
              label="Balances differ"
              blurb={`of ${inr(run.balanceCheckedCount)} parties`}
              value={run.balanceMismatchCount}
              tone="border-rose-400 bg-rose-100 text-rose-900 dark:border-rose-400/50 dark:bg-rose-400/15 dark:text-rose-200"
              active={view === 'BALANCES'}
              onClick={() => setView(view === 'BALANCES' ? 'VOUCHERS' : 'BALANCES')}
            />
            <Tile
              label="Marked pending"
              blurb="Still being chased"
              value={run.pendingCount}
              tone={REVIEW.PENDING.chip}
              active={review === 'PENDING'}
              onClick={() => {
                setReview(review === 'PENDING' ? '' : 'PENDING');
                setStatus('');
              }}
            />
            <Tile
              label="Marked solved"
              blurb="Dealt with"
              value={run.solvedCount}
              tone={REVIEW.SOLVED.chip}
              active={review === 'SOLVED'}
              onClick={() => {
                setReview(review === 'SOLVED' ? '' : 'SOLVED');
                setStatus('');
              }}
            />
          </div>
        )}

        {/* ── unmapped ledgers: one line + a button that opens the full list ──
            Used to render every unmatched ledger inline as a wrapping pill —
            fine for a handful, but a party with 100+ unmapped ledgers (a real
            case) turned into 15+ rows of pills sitting ABOVE the report table,
            leaving the table itself a couple of visible rows tall. The full,
            scrollable list now lives in its own dialog (below), split into
            Party / Expenses / Others — this stays a single line regardless. */}
        {run && ledgerTotal(run.unmatchedLedgers) > 0 && canRun && (
          <div className="flex min-w-0 items-center gap-1.5 border-t border-amber-200 px-2.5 py-2 sm:px-3 dark:border-amber-400/20">
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold tracking-wide text-violet-800 uppercase dark:text-violet-300">
              <UserRoundX className="size-3.5" /> Unmapped ledgers
            </span>
            <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-violet-700 dark:text-violet-400">
              {run.unmatchedLedgers.party.length > 0 ? (
                <>
                  {run.unmatchedLedgers.party.slice(0, 4).join(', ')}
                  {run.unmatchedLedgers.party.length > 4 ? '…' : ''}
                </>
              ) : (
                // Nothing still needs a customer — everything left has been
                // filed. Said plainly rather than showing an empty line, so it
                // reads as "done", not as a state nobody explained.
                <span className="text-emerald-700 dark:text-emerald-400">
                  All filed — {run.unmatchedLedgers.expense.length} expense, {run.unmatchedLedgers.other.length} other.
                </span>
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 shrink-0 gap-0.5 rounded-[3px] border-violet-300 px-2 text-[11px] font-bold text-violet-800 hover:bg-violet-100 dark:border-violet-400/40 dark:text-violet-300 dark:hover:bg-violet-400/20"
              onClick={() => setUnmappedListOpen(true)}
            >
              View all ({ledgerTotal(run.unmatchedLedgers)})
              <ChevronRight className="size-3" />
            </Button>
          </div>
        )}
      </div>

      {/* ── live progress / outcome, inline on the page ───────────────────── */}
      {recon.phase !== 'idle' && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'font-poppins animate-in fade-in slide-in-from-top-1 rounded-[4px] border-2 shadow-sm duration-300',
            recon.phase === 'done'
              ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-400/60 dark:bg-emerald-400/10'
              : recon.phase === 'error'
                ? 'border-rose-500 bg-rose-50 dark:border-rose-400/60 dark:bg-rose-400/10'
                : 'border-amber-400 bg-amber-50 dark:border-amber-400/50 dark:bg-amber-400/10',
          )}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2.5 py-2 sm:px-3">
            <span className="shrink-0">
              {recon.phase === 'done' ? (
                <CircleCheck className="size-4 text-emerald-700 dark:text-emerald-400" />
              ) : recon.phase === 'error' ? (
                <AlertTriangle className="size-4 text-rose-700 dark:text-rose-400" />
              ) : (
                <Loader2 className="size-4 animate-spin text-blue-800 dark:text-blue-400" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] leading-tight font-bold">{phaseLabel(recon)}</p>
              <p className="text-muted-foreground mt-0.5 truncate text-[11.5px] font-medium">
                {recon.phase === 'error'
                  ? recon.error
                  : recon.phase === 'analysing'
                    ? `${recon.fileName} — checking openings, invoices, notes and receipts against OMS.`
                    : recon.phase === 'done' && recon.result
                      ? `${recon.fileName} — ${inr(recon.result.voucherCount)} vouchers across ${inr(recon.result.ledgerCount)} ledgers in ${recon.elapsed}s.`
                      : recon.fileName}
              </p>
            </div>
            {recon.busy && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 rounded-[4px] text-[12px] font-semibold"
                onClick={recon.cancel}
              >
                Cancel
              </Button>
            )}
            {!recon.busy && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 rounded-[4px] text-[12px] font-semibold"
                onClick={recon.dismiss}
              >
                <X className="size-3.5" /> Dismiss
              </Button>
            )}
          </div>
          {recon.busy && (
            <div className="px-2.5 pb-2 sm:px-3">
              <ReconProgressBar state={recon} />
              <p className="text-muted-foreground mt-1 text-[10.5px] font-medium">
                You can leave this page — the reconciliation carries on and you'll be told when it's done.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── the report ────────────────────────────────────────────────────── */}
      <div className={cn('bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[4px] border shadow-sm', PANEL)}>
        <div className="flex items-center justify-between gap-3 bg-slate-800 px-2.5 py-1 dark:bg-slate-900">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[12px] font-extrabold tracking-wide text-amber-300 uppercase">
              Tally Reconciliation{run ? ` — ${run.fileName}` : ''}
            </span>
            {run && (
              <span className="flex shrink-0 overflow-hidden rounded-[3px] border border-white/25">
                {(
                  [
                    ['VOUCHERS', 'Vouchers', Scale],
                    ['BALANCES', 'Party balances', Landmark],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setView(key)}
                    aria-pressed={view === key}
                    className={cn(
                      'flex cursor-pointer items-center gap-1 px-2 py-[3px] text-[11px] font-bold tracking-wide uppercase transition-colors',
                      view === key ? 'bg-amber-300 text-slate-900' : 'text-amber-200 hover:bg-white/10',
                    )}
                  >
                    <Icon className="size-3" /> <span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </span>
            )}
          </div>
          {run && (
            <span className="hidden shrink-0 text-[11px] font-bold tracking-wide text-white tabular-nums sm:inline">
              {prettyDate(run.fromDate)} — {prettyDate(run.toDate)} · Bank
            </span>
          )}
        </div>

        {!run ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <FileSpreadsheet className="size-10 text-amber-400" />
            <div>
              <p className="text-[14px] font-bold">No reconciliation yet</p>
              <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-[12.5px] font-medium">
                Upload a Tally ledger register (.xlsx) for Sundry Debtors. Its own date range drives the comparison, and only
                bank entries are matched — openings first, then invoices, notes and receipts.
              </p>
            </div>
            {canRun && (
              <Button className="h-9 gap-1.5 rounded-[4px] text-[12.5px] font-bold" onClick={onPickFile} disabled={recon.busy}>
                <Upload className="size-3.5" /> Choose register
              </Button>
            )}
          </div>
        ) : view === 'BALANCES' ? (
          <BalancesView run={run} onlyDiffering={onlyDiffering} setOnlyDiffering={setOnlyDiffering} onPickParty={(names) => {
              // A balance row is keyed by the register's ledger name(s), so the
              // jump lands on the Tally-side filter. Replaces whatever was
              // picked rather than adding to it: this is "show me THIS party".
              // A merged (renamed-in-Tally) party hands over every name it
              // combines, so its rows under BOTH old and new names show up.
              setTallyParties(names);
              setOmsParties([]);
              setView('VOUCHERS');
              setStatus('');
            }} />
        ) : (
          <>
            {/* Desktop grid. */}
            <div
              className={cn(
                'hidden min-h-0 flex-1 overflow-auto overscroll-x-contain sm:block',
                '[scrollbar-width:thin] [scrollbar-color:var(--color-amber-400)_var(--color-amber-100)]',
                '[&_tbody]:select-none',
              )}
            >
              <table className="w-full border-collapse text-[13px]">
                <caption className="sr-only">
                  Tally reconciliation for {run.fileName}, {prettyDate(run.fromDate)} to {prettyDate(run.toDate)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-9 text-center')}>
                      {canMark && selectable.length > 0 ? (
                        <button
                          type="button"
                          onClick={toggleAll}
                          title="Select every flagged line shown"
                          className="cursor-pointer align-middle text-amber-300 hover:text-white"
                        >
                          <CheckCheck className="size-3.5" />
                        </button>
                      ) : (
                        <span className="sr-only">Select</span>
                      )}
                    </th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-24')}>Date</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-32')}>Vch Type</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-28')}>Vch No</th>
                    <th scope="col" className={cn(TH, TH_LINE)}>Particulars</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-28 text-right')}>Debit</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-28 text-right')}>Credit</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-32')}>Status</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-28')}>Review</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-28')}>OMS Ref</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-28 text-right')}>OMS Amt</th>
                    <th scope="col" className={cn(TH, 'min-w-[16rem]')}>Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {isFetching && !blocks.length ? (
                    <tr>
                      <td colSpan={12} className="text-muted-foreground h-24 text-center">
                        <Loader2 className="mx-auto size-5 animate-spin" />
                      </td>
                    </tr>
                  ) : !blocks.length ? (
                    <tr>
                      <td colSpan={12} className="text-muted-foreground h-24 text-center text-[13px] font-medium">
                        {status === 'PROBLEMS'
                          ? 'Nothing needs attention — every register entry agrees with OMS.'
                          : 'No rows for these filters.'}
                      </td>
                    </tr>
                  ) : (
                    renderedBlocks.map(([ledgerName, list]) => {
                      // Debit/Credit subtotal for this party's block, so its
                      // total shows right on the heading — lined up under the
                      // same Debit/Credit columns the rows below use, not
                      // buried in a "go add it up yourself" row count.
                      let drSubtotal = 0;
                      let crSubtotal = 0;
                      for (const r of list) {
                        drSubtotal += r.dr || 0;
                        crSubtotal += r.cr || 0;
                      }
                      return (
                      <Fragment key={ledgerName}>
                        <tr className="bg-amber-100/90 dark:bg-amber-400/10">
                          <td className={TD} />
                          <td className={cn(TD, 'text-[12px] font-extrabold tracking-wide text-amber-950 uppercase dark:text-amber-100')} colSpan={4}>
                            {ledgerName}
                            {list[0].customerName && list[0].customerName !== ledgerName && (
                              <span className="ml-1.5 font-semibold normal-case opacity-70">→ {list[0].customerName}</span>
                            )}
                          </td>
                          <td className={cn(TD, NUM, 'font-extrabold text-amber-950 dark:text-amber-100')}>{moneyOrDash(drSubtotal)}</td>
                          <td className={cn(TD, NUM, 'font-extrabold text-amber-950 dark:text-amber-100')}>{moneyOrDash(crSubtotal)}</td>
                          <td className={cn(TD, 'text-[11px] font-bold text-amber-900 dark:text-amber-200')} colSpan={5}>
                            {list.length} row{list.length === 1 ? '' : 's'}
                          </td>
                        </tr>
                        {list.map((r) => {
                          const pickable = canMark && isFlagged(r);
                          const on = picked.has(r.id);
                          return (
                            <tr
                              key={r.id}
                              className={cn(
                                'border-b border-amber-200/70 dark:border-amber-400/10',
                                'even:bg-amber-50/70 dark:even:bg-amber-400/[0.05]',
                                'hover:bg-amber-200/80 dark:hover:bg-amber-400/20',
                                on && 'bg-emerald-100/80 dark:bg-emerald-400/15',
                              )}
                            >
                              <td className={cn(TD, 'text-center')}>
                                {pickable ? (
                                  <button
                                    type="button"
                                    onClick={() => toggle(r.id)}
                                    aria-pressed={on}
                                    title={
                                      isEntryable(r)
                                        ? `Select — this ${inr(r.cr || r.dr)} receipt can be entered in OMS`
                                        : 'Select to mark solved or pending'
                                    }
                                    className={cn(
                                      'cursor-pointer align-middle transition-colors',
                                      on ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
                                    )}
                                  >
                                    {on ? <SquareCheckBig className="size-4" /> : <Square className="size-4" />}
                                  </button>
                                ) : r.resolvedAt ? (
                                  <CircleCheck className="mx-auto size-4 fill-emerald-200 text-emerald-700 dark:fill-emerald-900 dark:text-emerald-300" />
                                ) : null}
                              </td>
                              <td className={cn(TD, 'whitespace-nowrap font-semibold tabular-nums text-slate-700 dark:text-slate-300')}>
                                {prettyDate(r.txnDate)}
                              </td>
                              <td className={cn(TD, 'text-[12px] font-medium whitespace-nowrap text-slate-600 dark:text-slate-400')}>{r.vchType}</td>
                              <td className={cn(TD, 'text-[12.5px] font-semibold whitespace-nowrap')}>{r.vchNo || '-'}</td>
                              <td className={cn(TD, 'text-slate-700 dark:text-slate-300')}>
                                {r.particulars || '-'}
                                {r.source === 'OMS' && (
                                  <span className="ml-1.5 rounded-[3px] border border-slate-300 px-1 text-[10px] font-bold tracking-wide text-slate-500 uppercase dark:border-slate-500/40 dark:text-slate-400">
                                    OMS
                                  </span>
                                )}
                              </td>
                              <td className={cn(TD, NUM, 'font-semibold text-slate-900 dark:text-slate-100')}>{moneyOrDash(r.dr)}</td>
                              <td className={cn(TD, NUM, 'font-semibold text-emerald-700 dark:text-emerald-400')}>{moneyOrDash(r.cr)}</td>
                              <td className={TD}>
                                <StatusChip status={r.status} />
                              </td>
                              <td className={cn(TD, 'whitespace-nowrap')}>
                                {r.review !== 'OPEN' ? (
                                  <ReviewBadge row={r} />
                                ) : canMark && isFlagged(r) ? (
                                  <span className="text-muted-foreground text-[11px] font-medium">—</span>
                                ) : null}
                              </td>
                              <td className={cn(TD, 'text-[12.5px] font-semibold whitespace-nowrap')}>
                                {r.omsRef || '-'}
                                {/* Only where the banks actually disagree. The
                                    Particulars column two cells left already
                                    carries the register's bank, so on every
                                    other row this would just repeat it. */}
                                {r.status === 'BANK_MISMATCH' && r.omsBank && (
                                  <span className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-fuchsia-700 dark:text-fuchsia-300">
                                    <Banknote className="size-3 shrink-0" />
                                    {r.omsBank}
                                  </span>
                                )}
                              </td>
                              <td className={cn(TD, NUM, 'font-semibold')}>{moneyOrDash(r.omsAmount)}</td>
                              <td className={cn(TD, 'text-muted-foreground text-[11.5px] font-medium')}>{r.note || ''}</td>
                            </tr>
                          );
                        })}
                      </Fragment>
                      );
                    })
                  )}
                  {remainingRowCount > 0 && (
                    <tr>
                      <td colSpan={12} className="p-0">
                        <button
                          type="button"
                          onClick={() => setRenderLimit((l) => l + RENDER_CHUNK)}
                          className="w-full border-t border-amber-200 bg-amber-50/60 py-2 text-center text-[12px] font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-400/20 dark:bg-amber-400/5 dark:text-amber-300 dark:hover:bg-amber-400/10"
                        >
                          Show {Math.min(remainingRowCount, RENDER_CHUNK).toLocaleString('en-IN')} more row
                          {Math.min(remainingRowCount, RENDER_CHUNK) === 1 ? '' : 's'} ({remainingRowCount.toLocaleString('en-IN')} left)
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Phones: one card per row, tick on the card itself. */}
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 sm:hidden">
              {!blocks.length ? (
                <p className="text-muted-foreground px-4 py-10 text-center text-[13px] font-medium">
                  {status === 'PROBLEMS' ? 'Nothing needs attention.' : 'No rows for these filters.'}
                </p>
              ) : (
                renderedBlocks.map(([ledgerName, list]) => (
                  <div key={ledgerName} className="bg-card overflow-hidden rounded-[4px] border border-amber-200 shadow-sm dark:border-amber-400/20">
                    <div className="bg-slate-800 px-3 py-1.5 text-[11.5px] font-bold tracking-wide text-amber-300 uppercase dark:bg-slate-900">
                      {ledgerName}
                    </div>
                    <div className="divide-y divide-amber-200/70 dark:divide-amber-400/10">
                      {list.map((r) => {
                        const pickable = canMark && isFlagged(r);
                        const on = picked.has(r.id);
                        return (
                          <div key={r.id} className={cn('p-2.5', on && 'bg-emerald-100/70 dark:bg-emerald-400/15')}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[11px] font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                                  {r.vchType} {r.vchNo && `· ${r.vchNo}`}
                                </p>
                                <p className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-200">{r.particulars || '-'}</p>
                              </div>
                              {pickable && (
                                <button
                                  type="button"
                                  onClick={() => toggle(r.id)}
                                  aria-pressed={on}
                                  className={cn('shrink-0 cursor-pointer', on ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400')}
                                >
                                  {on ? <SquareCheckBig className="size-5" /> : <Square className="size-5" />}
                                </button>
                              )}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <StatusChip status={r.status} />
                                <ReviewBadge row={r} />
                              </span>
                              <span className="text-[12.5px] font-bold tabular-nums">
                                {prettyDate(r.txnDate)} · {moneyOrDash(r.dr || r.cr)}
                              </span>
                            </div>
                            {r.note && <p className="text-muted-foreground mt-1 text-[11.5px] font-medium">{r.note}</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
              {remainingRowCount > 0 && (
                <button
                  type="button"
                  onClick={() => setRenderLimit((l) => l + RENDER_CHUNK)}
                  className="w-full rounded-[4px] border border-amber-200 bg-amber-50/60 py-2.5 text-center text-[12.5px] font-bold text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/5 dark:text-amber-300"
                >
                  Show {Math.min(remainingRowCount, RENDER_CHUNK).toLocaleString('en-IN')} more row
                  {Math.min(remainingRowCount, RENDER_CHUNK) === 1 ? '' : 's'} ({remainingRowCount.toLocaleString('en-IN')} left)
                </button>
              )}
            </div>
          </>
        )}

        {/* ── bulk actions on the selection ────────────────────────────────── */}
        {canMark && selectedRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t-2 border-emerald-500 bg-emerald-50 px-2.5 py-2 sm:gap-2 sm:px-3 dark:border-emerald-400/60 dark:bg-emerald-400/10">
            <span className="text-[12.5px] font-bold text-emerald-900 dark:text-emerald-200">
              {selectedRows.length} line{selectedRows.length === 1 ? '' : 's'} selected
              {pickedRows.length > 0 && (
                <span className="font-semibold opacity-80">
                  {' '}
                  · {pickedRows.length} enterable receipt{pickedRows.length === 1 ? '' : 's'} ({inr(pickedTotal)})
                </span>
              )}
            </span>
            <Button variant="ghost" size="sm" className="h-8 rounded-[4px] text-[12px] font-semibold" onClick={() => setPicked(new Set())}>
              Clear selection
            </Button>

            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 rounded-[4px] border-amber-500 bg-amber-100 text-[12px] font-bold text-amber-900 hover:bg-amber-200 dark:border-amber-400/60 dark:bg-amber-400/15 dark:text-amber-200"
                onClick={() => void onMark('PENDING')}
                disabled={markRows.isPending}
              >
                <Clock className="size-3.5" /> Mark pending
              </Button>
              <Button
                size="sm"
                className="h-8 gap-1.5 rounded-[4px] bg-emerald-700 text-[12px] font-bold text-white hover:bg-emerald-800"
                onClick={() => void onMark('SOLVED')}
                disabled={markRows.isPending}
              >
                <Check className="size-3.5" /> Mark solved
              </Button>
              {selectedRows.some((r) => r.review !== 'OPEN') && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 rounded-[4px] text-[12px] font-semibold"
                  onClick={() => void onMark('OPEN')}
                  disabled={markRows.isPending}
                >
                  <RotateCcw className="size-3.5" /> Clear mark
                </Button>
              )}
              {canEnterReceipt && pickedRows.length > 0 && (
                <Button
                  size="sm"
                  className="h-8 gap-1.5 rounded-[4px] bg-blue-800 text-[12px] font-bold text-white hover:bg-blue-900"
                  onClick={() => setConfirmOpen(true)}
                >
                  <CircleCheck className="size-3.5" /> Enter {pickedRows.length} receipt{pickedRows.length === 1 ? '' : 's'}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── alias dialog ──────────────────────────────────────────────────── */}
      {/* Full unmapped-ledgers list — the "View all" button above opens this
          instead of the page growing a wall of pills. Three tabs, one per
          filing: Party still needs a customer mapping (tap the name); Expense
          and Other are ledgers filed as not-a-party, each with a way back.
          Filing (and un-filing) is a plain save — no rerun, so it's instant
          even ticking through a long list; "Recheck report" below brings the
          KPI counters up to date in one explicit step once you're done. */}
      <Dialog
        open={unmappedListOpen}
        onOpenChange={(o) => {
          setUnmappedListOpen(o);
          if (o) setLedgerTab('party'); // always open on what still needs attention
          setSelectedLedgers(new Set());
        }}
      >
        <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Unmapped ledgers ({run ? ledgerTotal(run.unmatchedLedgers) : 0})</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-1.5">
            {(
              [
                ['party', 'Party'],
                ['expense', 'Expenses'],
                ['other', 'Others'],
              ] as const
            ).map(([tab, label]) => {
              const count = run?.unmatchedLedgers[tab].length ?? 0;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setLedgerTab(tab);
                    setSelectedLedgers(new Set()); // a tick from one tab must not act on another
                  }}
                  className={cn(
                    'rounded-[4px] border px-2.5 py-1 text-[12px] font-bold',
                    ledgerTab === tab
                      ? 'border-violet-600 bg-violet-600 text-white'
                      : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-300',
                  )}
                >
                  {label} ({count})
                </button>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              title="Filing is already saved — this only refreshes the KPI counters above (Needs Attention etc.), which stay as they were until you ask."
              className="ml-auto h-7 shrink-0 gap-1 rounded-[4px] text-[11.5px] font-bold"
              onClick={() => void recheckReport()}
              disabled={rerun.isPending}
            >
              {rerun.isPending ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
              Recheck report
            </Button>
          </div>
          <p className="text-muted-foreground -mt-1 text-[11.5px] font-medium">
            {ledgerTab === 'party'
              ? "These Tally ledger names don't match an OMS customer yet. Tap one to map it, or file it as Expense/Other if it never will."
              : `Filed as ${ledgerTab === 'expense' ? 'Expense' : 'Other'} — not a customer, so left out of "needs attention". Move one back if that was wrong.`}
          </p>

          {(() => {
            const list = run?.unmatchedLedgers[ledgerTab] ?? [];
            const allSelected = list.length > 0 && list.every((n) => selectedLedgers.has(n));
            const toggleAll = () => setSelectedLedgers(allSelected ? new Set() : new Set(list));
            const toggleOne = (name: string) =>
              setSelectedLedgers((s) => {
                const next = new Set(s);
                if (next.has(name)) next.delete(name);
                else next.add(name);
                return next;
              });
            const CheckBox = ({ checked }: { checked: boolean }) => (
              <span
                className={cn(
                  'flex size-[15px] shrink-0 items-center justify-center rounded-[3px] border-[1.5px] bg-white transition-colors',
                  checked ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-400 group-hover:border-violet-500',
                )}
              >
                {checked && <Check className="size-2.5" strokeWidth={3.5} />}
              </span>
            );

            return (
              <>
                {/* select-all + bulk actions — only worth its own row once there's a
                    list to act on. */}
                {list.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="group flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300"
                    >
                      <CheckBox checked={allSelected} />
                      Select all
                    </button>
                    {selectedLedgers.size > 0 && (
                      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
                        <span className="text-[11px] font-bold text-violet-700 dark:text-violet-300">
                          {selectedLedgers.size} selected
                        </span>
                        {ledgerTab !== 'party' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 gap-1 rounded-[3px] px-1.5 text-[10.5px] font-bold"
                            onClick={() => void onSetCategory([...selectedLedgers], 'PARTY')}
                          >
                            <RotateCcw className="size-3" /> Move to Party
                          </Button>
                        )}
                        {ledgerTab !== 'expense' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 rounded-[3px] px-1.5 text-[10.5px] font-bold"
                            onClick={() => void onSetCategory([...selectedLedgers], 'EXPENSE')}
                          >
                            File as Expense
                          </Button>
                        )}
                        {ledgerTab !== 'other' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 rounded-[3px] px-1.5 text-[10.5px] font-bold"
                            onClick={() => void onSetCategory([...selectedLedgers], 'OTHER')}
                          >
                            File as Other
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded-[4px] border border-violet-200 p-1.5 dark:border-violet-400/20">
                  {list.length === 0 && <p className="text-muted-foreground p-3 text-center text-[12px]">Nothing here.</p>}
                  {ledgerTab === 'party'
                    ? list.map((name) => (
                        <div
                          key={name}
                          className="group flex items-center gap-1.5 rounded-[3px] border border-violet-200 bg-violet-50/60 px-1.5 py-1 dark:border-violet-400/25 dark:bg-violet-400/5"
                        >
                          <button type="button" onClick={() => toggleOne(name)} className="shrink-0" aria-label={`Select ${name}`}>
                            <CheckBox checked={selectedLedgers.has(name)} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setUnmappedListOpen(false);
                              setAliasFor(name);
                              setAliasCustomer('');
                            }}
                            title="Map to an OMS customer"
                            className="flex min-w-0 flex-1 cursor-pointer items-center text-left text-[11px] font-semibold text-violet-800 hover:underline dark:text-violet-300"
                          >
                            <Link2 className="mr-1 inline size-3 shrink-0 align-[-2px]" />
                            <span className="truncate">{name}</span>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 shrink-0 rounded-[3px] px-1.5 text-[10.5px] font-bold text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-white/10"
                            onClick={() => void onSetCategory([name], 'EXPENSE')}
                          >
                            Expense
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 shrink-0 rounded-[3px] px-1.5 text-[10.5px] font-bold text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-white/10"
                            onClick={() => void onSetCategory([name], 'OTHER')}
                          >
                            Other
                          </Button>
                        </div>
                      ))
                    : list.map((name) => (
                        <div
                          key={name}
                          className="group flex items-center gap-1.5 rounded-[3px] border border-slate-200 bg-slate-50 px-1.5 py-1 dark:border-white/10 dark:bg-white/[0.03]"
                        >
                          <button type="button" onClick={() => toggleOne(name)} className="shrink-0" aria-label={`Select ${name}`}>
                            <CheckBox checked={selectedLedgers.has(name)} />
                          </button>
                          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700 dark:text-slate-300">{name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 shrink-0 gap-1 rounded-[3px] px-1.5 text-[10.5px] font-bold text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-400/20"
                            onClick={() => void onSetCategory([name], 'PARTY')}
                          >
                            <RotateCcw className="size-3" /> Move to Party
                          </Button>
                        </div>
                      ))}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={!!aliasFor} onOpenChange={(o) => !o && setAliasFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Map a Tally ledger</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-[11px] font-bold tracking-wide uppercase">Tally ledger name</Label>
              <p className="mt-0.5 rounded-[4px] border border-amber-300 bg-amber-50 px-2 py-1.5 text-[13px] font-bold dark:border-amber-400/40 dark:bg-amber-400/10">
                {aliasFor}
              </p>
            </div>
            <div>
              <Label className="text-[11px] font-bold tracking-wide uppercase" htmlFor="alias-customer">
                OMS customer
              </Label>
              <div className="mt-0.5">
                {/*
                 * NativeSelect, not Combo: Combo is `creatable`, so typing a
                 * few letters offered a "Create …" row that committed free text
                 * as the value. That value matches no customer, and saving it
                 * did nothing at all — the reported bug. This one picks from the
                 * list only, and says so when what was typed isn't on it.
                 */}
                <NativeSelect
                  id="alias-customer"
                  value={aliasCustomer}
                  onChange={setAliasCustomer}
                  options={customerOptions}
                  placeholder="Type to search customers"
                  onInvalidEntry={(typed) =>
                    toast.error(`No OMS customer matches "${typed}" — pick one from the list.`)
                  }
                  className={CONTROL}
                />
              </div>
            </div>
            <p className="text-muted-foreground text-[11.5px] font-medium">
              {run?.canRerun
                ? 'The mapping is remembered for future uploads, and this register is re-checked straight away.'
                : "The mapping is remembered for future uploads. Upload the register again to reconcile this party's entries."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-9 rounded-[4px] text-[12.5px] font-semibold" onClick={() => setAliasFor(null)}>
              Cancel
            </Button>
            <Button
              className="h-9 rounded-[4px] text-[12.5px] font-bold"
              onClick={() => void onSaveAlias()}
              // Disabled until the picked name is a REAL customer, so the button
              // can no longer be clicked into doing nothing.
              disabled={!custByName.has(aliasCustomer) || saveAlias.isPending || rerun.isPending}
            >
              {(saveAlias.isPending || rerun.isPending) && <Loader2 className="size-3.5 animate-spin" />}
              {rerun.isPending ? 'Re-checking…' : 'Save mapping'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── receipt confirmation ──────────────────────────────────────────── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Enter {pickedRows.length} receipt{pickedRows.length === 1 ? '' : 's'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-[4px] border border-amber-300 bg-amber-50 px-2.5 py-2 dark:border-amber-400/40 dark:bg-amber-400/10">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
              <p className="text-[11.5px] font-medium text-amber-900 dark:text-amber-200">
                These post as real receipts, allocated automatically against each party's oldest dues — exactly as if keyed in
                Receive Payment. The register's own date and bank are used.
              </p>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-[4px] border border-amber-200 dark:border-amber-400/20">
              <table className="w-full border-collapse text-[12.5px]">
                <tbody>
                  {pickedRows.map((r) => (
                    <tr key={r.id} className="border-b border-amber-200/70 last:border-b-0 dark:border-amber-400/10">
                      <td className="px-2 py-1 font-semibold">{r.customerName ?? r.ledgerName}</td>
                      <td className="px-2 py-1 whitespace-nowrap tabular-nums">{prettyDate(r.txnDate)}</td>
                      <td className="text-muted-foreground px-2 py-1 text-[11.5px]">{r.particulars}</td>
                      <td className="px-2 py-1 text-right font-bold tabular-nums">{inr(r.cr || r.dr)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-amber-100/80 dark:bg-amber-400/10">
                    <td className="px-2 py-1 text-[11px] font-extrabold tracking-wide uppercase" colSpan={3}>
                      Total
                    </td>
                    <td className="px-2 py-1 text-right font-extrabold tabular-nums">{inr(pickedTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div>
              <Label className="text-[11px] font-bold tracking-wide uppercase" htmlFor="recon-bank">
                Receiving bank (optional)
              </Label>
              <div className="mt-0.5">
                <NativeSelect
                  id="recon-bank"
                  value={bankOverride}
                  onChange={setBankOverride}
                  options={['', ...new Set(pickedRows.map((r) => (r.particulars ?? '').trim()).filter(Boolean))]}
                  placeholder="Use each register entry's own bank"
                  className={CONTROL}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-9 rounded-[4px] text-[12.5px] font-semibold" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              className="h-9 gap-1.5 rounded-[4px] bg-emerald-700 text-[12.5px] font-bold text-white hover:bg-emerald-800"
              onClick={() => void onCreateReceipts()}
              disabled={createReceipts.isPending}
            >
              {createReceipts.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <CircleCheck className="size-3.5" />}
              Post {pickedRows.length} receipt{pickedRows.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
