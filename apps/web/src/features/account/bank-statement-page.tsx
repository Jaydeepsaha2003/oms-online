import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  FileSpreadsheet,
  Landmark,
  Loader2,
  PanelRightClose,
  Pencil,
  PanelRightOpen,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  UserPlus,
} from 'lucide-react';
import { DEFAULT_LEDGER_GROUP, detectStatementDateOrder, parseStatementPeriod, statementDateToDisplay, statementDateToYmd, trimStatementTrailer, type BankReturnedCheque, type BankStatementColumnMap, type BankStatementCreateResponse, type BankStatementRowDto, type BankStatementRunResult, type BankStatementRecheckResult } from '@oms/shared';
import { detectBankAccount, statementIdentityText } from './bank-statement-detect';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { detectHeaderRow, gridToRows, parseSheetGrid } from '@/lib/excel';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { NativeSelect } from '@/components/common/combo';
import { Combobox } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/ui/date-picker';
import { useCustomerLookups, useCustomers } from '@/features/customers/use-customers';
import { useActiveBankAccounts } from './use-account';
import {
  useAssignBankRows,
  useClearBankParty,
  useReverseReturned,
  useBankParty,
  useBankRun,
  useBankRuns,
  useColumnPreset,
  useCreateBankRun,
  useDeleteBankRun,
  useIgnoreBankRows,
  useProcessBankRun,
  useRecheckBankRun,
} from './use-bank-statement';

/* ── House chrome, shared with the other Accounts worksheets ──────────────── */

const FIELD_LABEL = 'text-[10px] font-bold tracking-widest text-amber-900/70 uppercase dark:text-amber-200/60';
const CONTROL =
  'h-11 rounded-lg border-amber-300 text-[13px] dark:border-amber-400/40 sm:h-9 sm:rounded-[4px] sm:text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const TH =
  'sticky top-0 z-10 bg-gradient-to-b from-blue-800 to-indigo-800 px-3 py-2 text-left text-[12px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap dark:from-blue-900 dark:to-indigo-900';
const TD = 'border-r border-r-amber-200/80 px-3 py-2 align-middle text-[13px] dark:border-r-amber-400/15 last:border-r-0';
const NUM = 'text-right tabular-nums';
const PANEL = 'rounded-xl border border-amber-300 bg-card shadow-sm dark:border-amber-400/30 sm:rounded-[4px]';

const money = (v: number) => `₹ ${(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const money0 = (v: number) => `₹ ${(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** What each row status means, in the words the screen uses everywhere. */
const STATUS_META: Record<string, { label: string; cls: string; hint: string }> = {
  MATCHED: {
    label: 'Matched',
    cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300',
    hint: 'Paired with a receipt of the same amount, within a few days.',
  },
  PARTIAL: {
    label: 'In total',
    cls: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300',
    hint: 'No single receipt matches, but the party’s receipts for the range cover it.',
  },
  UNMATCHED: {
    label: 'No receipt',
    cls: 'bg-rose-50 text-rose-700 ring-rose-300 dark:bg-rose-500/20 dark:text-rose-300',
    hint: 'Money the bank received that OMS has no receipt for. Process creates it.',
  },
  NO_PARTY: {
    label: 'No party',
    cls: 'bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-400/20 dark:text-amber-200',
    hint: 'Assign a customer before this line can be reconciled.',
  },
  IGNORED: {
    label: 'Not required',
    cls: 'bg-slate-100 text-slate-600 ring-slate-300 dark:bg-white/10 dark:text-slate-300',
    hint: 'Left out of the reconciliation — not a customer receipt. Nothing is posted for it.',
  },
  POSTED: {
    label: 'Posted',
    cls: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300',
    hint: 'A receipt was created from this line.',
  },
  RETURNED: {
    label: 'Cheque returned',
    cls: 'bg-rose-100 text-rose-800 ring-rose-300 dark:bg-rose-500/20 dark:text-rose-200',
    hint: 'The bank credited this cheque and then took it back unpaid. It is not money received, so nothing is posted for it.',
  },
};

function StatusChip({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.NO_PARTY;
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-bold ring-1 ring-inset', m.cls)}
      title={m.hint}
    >
      {m.label}
    </span>
  );
}

/** One headline figure. */
function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn'; hint?: string }) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-[4px] border px-2.5 py-1.5 sm:px-3 sm:py-2',
        tone === 'good' && 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-400/40 dark:bg-emerald-500/10',
        tone === 'bad' && 'border-rose-300 bg-rose-50/70 dark:border-rose-400/40 dark:bg-rose-500/10',
        tone === 'warn' && 'border-amber-300 bg-amber-50/70 dark:border-amber-400/40 dark:bg-amber-400/10',
        !tone && 'bg-card',
      )}
      title={hint}
    >
      <p className="text-muted-foreground truncate text-[10px] font-bold tracking-widest uppercase">{label}</p>
      <p className="truncate text-[15px] font-extrabold tabular-nums sm:text-[17px]">{value}</p>
    </div>
  );
}

/**
 * Bank Statement reconciliation.
 *
 * Three steps, in one place: read the file and say which columns are which,
 * review what the credits pair with party by party, then Process. Nothing
 * reaches the ledger until that last button, and everything before it is
 * written to the server as it happens — the run IS the saved working.
 */
export function BankStatementPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const canProcess = can('bankstatement:update');
  const canEdit = can('bankstatement:create');

  /* ── Step 1: the file ─────────────────────────────────────────────────── */
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [sheetRows, setSheetRows] = useState<Record<string, string | null>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [bankName, setBankName] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [map, setMap] = useState<BankStatementColumnMap>({ date: '', narration: '', credit: '', debit: '', ref: '' });
  const [parsing, setParsing] = useState(false);
  /** True while From/To are the file's own range rather than the user's. Any
   *  edit to either date turns it off, so a chosen range is never overwritten
   *  by a re-read (changing the header line re-parses every row). */
  const [rangeFromFile, setRangeFromFile] = useState(false);
  /** How the bank was recognised — shown next to the field so an auto-pick is
   *  visibly a pick, not a default someone forgot to change. */
  const [bankReason, setBankReason] = useState<string | null>(null);
  /** The whole sheet, and which of its rows holds the column titles. */
  const [grid, setGrid] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);

  const { data: banks } = useActiveBankAccounts();
  const { data: preset } = useColumnPreset(bankName, columns);
  // Historical bank credits can belong to parties that are now inactive.
  const { data: customerList } = useCustomers({ page: 1, pageSize: 2000, status: 'ALL' });
  const { data: customerLookups } = useCustomerLookups();
  const customers = useMemo(() => {
    const groupName = new Map((customerLookups?.groups ?? []).map((g) => [g.id, g.name]));
    return (customerList?.items ?? [])
      .map((c) => ({
        id: c.id,
        name: (c.partyName ?? '').trim(),
        category: (c.category ?? '').trim().toUpperCase(),
        group: (c.groupId != null ? groupName.get(c.groupId) : undefined) ?? '',
      }))
      .filter((c) => c.name);
  }, [customerList, customerLookups],
  );

  /* ── The working ──────────────────────────────────────────────────────── */
  const [runId, setRunId] = useState<number | undefined>(undefined);
  const { data: runResult, isLoading: runLoading } = useBankRun(runId);
  const { data: runsList } = useBankRuns(1, 15);
  const createRun = useCreateBankRun();
  const assign = useAssignBankRows(runId);
  const ignore = useIgnoreBankRows(runId);
  const clearParty = useClearBankParty(runId);
  const reverseReturned = useReverseReturned(runId);
  const process = useProcessBankRun(runId);
  const delRun = useDeleteBankRun();

  /*
   * Opening a run re-checks it against the ledger as it stands now.
   *
   * A receipt this run created can be deleted afterwards in Receive Payment,
   * and nothing here noticed: the line went on saying POSTED, `rematch` skips
   * posted lines, and the run being processed made it read-only — so the money
   * was gone from the books with the statement still claiming it was in, and no
   * way to put it back. Anything reopened is reported in the dialog below
   * rather than left for someone to spot.
   */
  const recheck = useRecheckBankRun(runId);
  const [reopenedInfo, setReopenedInfo] = useState<BankStatementRecheckResult | null>(null);
  const recheckedRuns = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (runId == null || recheckedRuns.current.has(runId)) return;
    recheckedRuns.current.add(runId);
    recheck
      .mutateAsync()
      .then((res) => {
        if (res.reopened.length || res.uncovered?.length) setReopenedInfo(res);
      })
      .catch(() => {
        /* A failed re-check must not stop the run opening — the working is
           still readable, it simply has not been verified this time. */
      });
    // `recheck` is a fresh mutation object each render; keying on the run is
    // what makes this once-per-run rather than once-per-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  /*
   * Two different questions, so two pieces of state.
   *
   * `selectedParty` is a FILTER the user chose: show me only this party's lines.
   * `workingParty` is "whose figures is the panel on the right showing".
   *
   * They used to be one. Assigning set it so the working appeared straight away
   * — which also silently filtered the list down to the party just assigned, so
   * every other line vanished the moment you pressed Assign and you had to
   * notice the dropdown had changed to get back. Assigning now fills the panel
   * and leaves the list exactly where it was.
   */
  const [selectedParty, setSelectedParty] = useState<number | undefined>(undefined);
  const [workingParty, setWorkingParty] = useState<number | undefined>(undefined);
  /*
   * The party working panel is OFF by default, and the choice is remembered.
   *
   * The job on this screen is going down the lines and putting a party against
   * each one; the before/after is a thing you consult occasionally, not while
   * you work. Kept on, it took 360px from the lines permanently. Off, the lines
   * have the full width, and it is one click away when a figure needs checking.
   */
  const [showWorking, setShowWorking] = useState(() => {
    try {
      return localStorage.getItem('oms.bank-recon.working') === '1';
    } catch {
      return false; // private mode — the default stands
    }
  });
  const toggleWorking = (next: boolean) => {
    setShowWorking(next);
    try {
      localStorage.setItem('oms.bank-recon.working', next ? '1' : '0');
    } catch {
      /* nothing to do — it just will not be remembered */
    }
  };
  const { data: partyView } = useBankParty(runId, workingParty);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [assignTo, setAssignTo] = useState('');

  // A run change invalidates any selection made against the previous one.
  useEffect(() => {
    setChecked(new Set());
    setSelectedParty(undefined);
  }, [runId]);

  /**
   * Pre-fill the mapping from what this bank used last time, or from the
   * column names themselves.
   *
   * A STARTING POINT ONLY. Whatever the user leaves in these boxes is what gets
   * used — nothing here second-guesses it. An earlier version compared the
   * chosen column against the running balance and swapped credit and debit when
   * they disagreed; that was wrong. A statement whose columns look inverted is
   * a bad download, not a bank convention to be clever about, and silently
   * reconciling the opposite side of the account to the one the user asked for
   * is far worse than reconciling what they picked.
   */
  useEffect(() => {
    if (!columns.length) return;
    const saved = preset?.map;
    const has = (c: string | null | undefined) => !!c && columns.includes(c);
    if (saved && has(saved.date) && has(saved.narration) && has(saved.credit)) {
      setMap({ ...saved, debit: has(saved.debit) ? saved.debit : '', ref: has(saved.ref) ? saved.ref : '' });
      return;
    }
    const find = (...needles: string[]) =>
      columns.find((c) => needles.some((n) => c.toLowerCase().replace(/[^a-z]/g, '').includes(n))) ?? '';
    const guess = {
      date: find('date', 'txndate', 'valuedate'),
      narration: find('narration', 'description', 'particular', 'remark', 'detail'),
      credit: find('credit', 'deposit', 'cr'),
      debit: find('debit', 'withdrawal', 'dr'),
      ref: find('ref', 'chq', 'cheque', 'utr'),
    };
    setMap(guess);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, preset]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    // The `accept` attribute on the input is only a HINT - every file dialog
    // lets you switch it to "All files" and pick anything - so the rule is
    // enforced here as well. Checked before `parsing` is set, so a rejected
    // file leaves the button exactly as it was.
    if (!/\.csv$/i.test(file.name)) {
      toast.error('Only .csv statements can be reconciled', {
        description: `"${file.name}" is not a CSV. Open the statement in Excel and use File → Save As → CSV, or download the CSV export from your bank, then upload that.`,
      });
      return;
    }
    setParsing(true);
    try {
      // Read the sheet as a grid first: a statement opens with a block of
      // account details (the Axis export runs to 19 lines of it), so row 1 is
      // almost never the column titles.
      const g = await parseSheetGrid(file);
      if (!g.length) {
        toast.error('That sheet has no rows.');
        return;
      }
      const hdr = detectHeaderRow(g);
      setGrid(g);
      setHeaderRow(hdr);
      setFileName(file.name);
      // A new file owns the range again — see `rangeFromFile`.
      setRangeFromFile(true);
      const { rows } = gridToRows(g, hdr);

      // Which of OUR accounts is this? Matched on the account number, the IFSC
      // or the bank's name, whichever the statement carries — never on a list
      // of bank names in the code, so tomorrow's bank needs no change here.
      const match = detectBankAccount(statementIdentityText(file.name, g, hdr), banks ?? []);
      if (match) {
        setBankName(match.bankName);
        setBankReason(match.reason);
      } else {
        setBankReason(null);
      }

      toast.success(
        `${rows.length.toLocaleString('en-IN')} rows read from ${file.name}` +
          (hdr > 0 ? ` — column titles found on line ${hdr + 1}` : '') +
          (match ? ` · ${match.bankName} matched by ${match.reason}` : ''),
      );
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Could not read that file'));
    } finally {
      setParsing(false);
    }
  };

  // Columns and rows follow whichever line the user says holds the titles, so
  // correcting a mis-detected header re-reads the whole sheet instantly.
  useEffect(() => {
    if (!grid.length) return;
    const { columns: cols, rows } = gridToRows(grid, headerRow);
    setColumns(cols);
    setSheetRows(rows);
  }, [grid, headerRow]);

  /**
   * The first and last dates in the file, read through the SAME parser the
   * server uses to decide which rows fall inside the range (`parseStatementDate`
   * in @oms/shared). Typing these by hand was guesswork against a 605-row sheet,
   * and a range that missed either end silently dropped real credits.
   */
  /** The sheet's rows with the sign-off prose cut off — what the preview shows,
   *  what the range is read from, and what is sent to the server. */
  const trimmed = useMemo(() => trimStatementTrailer(sheetRows, map.date), [sheetRows, map.date]);
  const statementRows = trimmed.rows;

  /**
   * Which way round this file writes its dates, decided once from the whole
   * date column. The server derives the same thing from the same rows with the
   * same function, so the range shown here is the range it honours.
   */
  const dateOrder = useMemo(
    () => detectStatementDateOrder(map.date ? statementRows.map((r) => r[map.date!]) : []),
    [statementRows, map.date],
  );

  const rowScan = useMemo(() => {
    if (!map.date || !statementRows.length) return null;
    let min: string | null = null;
    let max: string | null = null;
    let dated = 0;
    for (const row of statementRows) {
      const ymd = statementDateToYmd(row[map.date], dateOrder);
      if (!ymd) continue; // a blank separator inside the table
      dated++;
      if (min === null || ymd < min) min = ymd;
      if (max === null || ymd > max) max = ymd;
    }
    return min && max ? { from: min, to: max, dated } : null;
  }, [statementRows, map.date, dateOrder]);

  /** The period the statement DECLARES, above its column titles — better than
   *  the rows, which cannot know about opening days that had no transactions. */
  const declaredPeriod = useMemo(
    () => parseStatementPeriod(statementIdentityText(fileName, grid, headerRow), dateOrder),
    [fileName, grid, headerRow, dateOrder],
  );

  const fileRange = declaredPeriod ?? (rowScan ? { from: rowScan.from, to: rowScan.to } : null);
  const rangeSource = declaredPeriod ? 'from the statement' : 'from the rows';

  useEffect(() => {
    if (!rangeFromFile || !fileRange) return;
    setFromDate(fileRange.from);
    setToDate(fileRange.to);
  }, [rangeFromFile, fileRange]);

  const loadStatement = () => {
    if (!statementRows.length) return toast.error('Choose a statement file first.');
    if (!map.date || !map.narration || !map.credit) return toast.error('Map the Date, Narration and Credit columns.');
    if (!fromDate || !toDate) return toast.error('Choose the date range this statement covers.');
    // Every receipt Process creates is a BANK receipt and needs an account on it.
    if (!bankName) return toast.error('Choose which bank account this statement is for.');
    submitRun('ask');
  };

  /**
   * Send the statement, and deal with the answer.
   *
   * `ask` is the first attempt: the server creates nothing if any line is
   * already held, and hands back which ones. Whoever is uploading then decides,
   * and the same request goes again carrying that decision. Nothing about it is
   * automatic, because neither answer is safe in general — skipping loses a
   * party's second identical payment of the day, importing can post a receipt
   * that already exists.
   */
  const submitRun = (onDuplicate: 'ask' | 'skip' | 'import', acceptUncleared = false) => {
    createRun.mutate(
      { onDuplicate, acceptUncleared, fileName, bankName: bankName || null, fromDate, toDate, map, rows: statementRows },
      {
        onSuccess: (res) => {
          if (res.outcome === 'duplicates') {
            void askAboutDuplicates(res);
            return;
          }
          if (res.outcome === 'uncleared') {
            void askAboutUnclearedCheques(res, onDuplicate);
            return;
          }
          setRunId(res.run.id);
          const dup = res.run.duplicateSkipped ?? 0;
          toast.success(`${res.run.rowCount} credit lines loaded — ${res.run.noPartyCount} need a party`, {
            // A silent skip is worse than no skip: the totals would not add up
            // against the statement and nothing would say why.
            description: dup ? `${dup} line${dup === 1 ? '' : 's'} left out — already on record.` : undefined,
            duration: dup ? 10000 : 4000,
          });
          /*
           * Returned cheques are reported separately and never as a passing
           * toast line: the ones already POSTED mean a receipt exists in the
           * ledger for money that came back, and that needs a person to reverse.
           */
          const returned = res.returnedCheques ?? [];
          if (returned.length) setReturnedCheques(returned);
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not load the statement'), { duration: 10000 }),
      },
    );
  };

  /**
   * A cheque credited near the end of the statement has not been watched long
   * enough to know it cleared — the reject debit, if it comes, is in the next
   * file. Ask before loading them.
   *
   * Cancel is the safe answer and is offered first in wording: re-export the
   * statement with a few more days on it and every one of these answers itself.
   * Going ahead is legitimate too — it is just a decision someone should make
   * knowingly, which is the whole point of stopping here.
   */
  const askAboutUnclearedCheques = async (
    res: Extract<BankStatementCreateResponse, { outcome: 'uncleared' }>,
    onDuplicate: 'ask' | 'skip' | 'import',
  ) => {
    const n = res.cheques.length;
    const total = res.cheques.reduce((s, c) => s + c.amount, 0);
    const lines = res.cheques
      .slice(0, 6)
      .map((c) => `• ${formatDate(c.txnDate)} — ${money0(c.amount)}${c.chequeNo ? ` (cheque ${c.chequeNo})` : ''}, watched ${c.daysWatched} day${c.daysWatched === 1 ? '' : 's'}`)
      .join('\n');
    const ok = await confirm({
      title: `${n} cheque${n === 1 ? '' : 's'} not yet known to have cleared`,
      description:
        `This statement ends ${formatDate(res.statementTo)}, which is less than ${res.days} days after ${n === 1 ? 'this cheque was' : 'these cheques were'} credited — ` +
        `so it cannot show whether ${n === 1 ? 'it' : 'they'} bounced. A returned cheque posted as a receipt puts money in the ledger that never arrived.\n\n` +
        `${lines}${n > 6 ? `\n…and ${n - 6} more.` : ''}\n\nTotal at risk: ${money0(total)}.\n\n` +
        `Re-export the statement with a few more days on it and this answers itself. Load them anyway?`,
      confirmText: 'Load them anyway',
      cancelText: 'Cancel the upload',
    });
    if (ok) submitRun(onDuplicate, true);
  };

  /**
   * Delete the receipt a bounced cheque created.
   *
   * The confirm spells out the two consequences that are easy to miss: the
   * invoices this receipt cleared go back to unpaid, and the party's LATER
   * receipts are re-allocated around the hole it leaves. Both are correct, and
   * both change numbers the user may be looking at elsewhere.
   */
  const doReverseReturned = async (c: BankReturnedCheque) => {
    const ok = await confirm({
      title: `Reverse receipt ${c.postedRef}?`,
      description:
        `Cheque ${c.chequeNo} for ${money0(c.amount)}${c.customerName ? ` from ${c.customerName}` : ''} was returned unpaid, but a receipt was already posted for it.\n\n` +
        `Reversing deletes ${c.postedRef}, puts the invoices it cleared back to unpaid, and re-allocates any later receipts for this party against the invoices they should have paid.\n\n` +
        `This changes the ledger and cannot be undone from here.`,
      confirmText: 'Reverse it',
      cancelText: 'Leave it',
    });
    if (!ok) return;
    reverseReturned.mutate(
      { rowId: c.rowId },
      {
        onSuccess: (res) => {
          toast.success(
            `${res.voucherNo} reversed` +
              (res.replayedCount ? ` — ${res.replayedCount} later receipt${res.replayedCount === 1 ? '' : 's'} re-allocated` : ''),
            { duration: 8000 },
          );
          setReturnedCheques((list) => list.filter((x) => x.rowId !== c.rowId));
        },
        // Shown verbatim: the server refuses for reasons that name what to do
        // (a receipt predating edit support, one stamped by Tally Reconciliation).
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not reverse that receipt'), { duration: 12000 }),
      },
    );
  };

  /** Put the overlap to the user, then re-send with what they chose. */
  const askAboutDuplicates = async (res: Extract<BankStatementCreateResponse, { outcome: 'duplicates' }>) => {
    const anyPosted = res.duplicates.some((d) => d.posted);
    const ok = await confirm({
      title: `${res.totalOnRecord} of ${res.totalIncoming} lines are already on record`,
      description: (
        <div className="space-y-2">
          <p>
            This bank account already holds these lines from an earlier working. Loading them again would leave two copies of
            the same money in the reconciliation
            {anyPosted ? ', and at least one has already been posted to the ledger — importing it would create a second receipt.' : '.'}
          </p>
          {/*
            `table-fixed` with declared widths, and the narration taking the
            slack. Auto layout let the narration and the "In file / held" header
            demand their natural width, which pushed the table past the dialog
            and put a horizontal scrollbar under a list you are supposed to read
            at a glance — while the header itself wrapped onto three lines.
          */}
          <div className="max-h-60 overflow-y-auto rounded-[4px] border">
            <table className="w-full table-fixed text-[11.5px]">
              <colgroup>
                <col className="w-[5.5rem]" />
                <col />
                <col className="w-[6rem]" />
                <col className="w-[7rem]" />
              </colgroup>
              <thead className="bg-muted/60 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left font-bold">Date</th>
                  <th className="px-2 py-1 text-left font-bold">Narration</th>
                  <th className="px-2 py-1 text-right font-bold">Amount</th>
                  <th className="px-2 py-1 text-right font-bold whitespace-nowrap">In file / held</th>
                </tr>
              </thead>
              <tbody>
                {res.duplicates.slice(0, 40).map((d, i) => (
                  <tr key={i} className={cn('border-t', d.posted && 'bg-rose-50 dark:bg-rose-500/10')}>
                    <td className="px-2 py-1 whitespace-nowrap tabular-nums">{formatDate(d.txnDate)}</td>
                    <td className="truncate px-2 py-1" title={d.narration}>
                      {d.narration}
                      {d.posted && <span className="ml-1 font-bold text-rose-700">posted</span>}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{money0(d.amount)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {d.incoming} / {d.onRecord}
                      {d.incoming > d.onRecord && (
                        <span className="ml-1 font-bold whitespace-nowrap text-emerald-700" title="More copies in this file than are held — the extra is new money">
                          +{d.incoming - d.onRecord} new
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {res.duplicates.length > 40 && (
            <p className="text-muted-foreground text-[11.5px]">…and {res.duplicates.length - 40} more.</p>
          )}
          <p className="text-[12px] font-semibold">
            Skip them — load only what is new. Any line the file holds more copies of than are on record still comes in.
          </p>
        </div>
      ),
      confirmText: 'Skip the ones already held',
      cancelText: 'Cancel the upload',
      // This one carries a table, not a sentence.
      wide: true,
    });
    if (ok) submitRun('skip');
  };

  /* ── Review ───────────────────────────────────────────────────────────── */

  const rows = runResult?.rows ?? [];
  /** Narrow the list to one kind of line. Without this a line marked "not
   *  required" fades into a 293-row list and can never be found to undo. */
  const [statusFilter, setStatusFilter] = useState('');
  /**
   * Statement order, or most-recently-decided first.
   *
   * A reconciliation is worked in long sittings, and in statement order there
   * was no way to see what had just been done — so "where did I stop" and "what
   * did I assign a moment ago" both meant scrolling 293 rows hunting for a party
   * name. Newest-first answers both, and is why `partyAt` is stamped on clearing
   * a line as well as on setting it.
   */
  const [recentFirst, setRecentFirst] = useState(false);
  /** Returned cheques from the last upload, shown until dismissed. */
  const [returnedCheques, setReturnedCheques] = useState<BankReturnedCheque[]>([]);
  const shown = useMemo(() => {
    const list = rows.filter(
      (r) => (!selectedParty || r.customerId === selectedParty) && (!statusFilter || r.status === statusFilter),
    );
    if (!recentFirst) return list;
    // Untouched lines (no partyAt) sink to the bottom rather than sorting as
    // epoch-0 — they are not "the oldest work", they are not work at all.
    return [...list].sort((a, b) => {
      const at = a.partyAt ? Date.parse(a.partyAt) : -Infinity;
      const bt = b.partyAt ? Date.parse(b.partyAt) : -Infinity;
      return bt - at;
    });
  }, [rows, selectedParty, statusFilter, recentFirst]);
  /** How many lines sit in each status, for the filter's own labels. */
  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [rows]);
  /** Whether the current selection is already marked not-required, which
   *  decides whether the button offers to mark or to undo. */
  const checkedRows = useMemo(() => rows.filter((r) => checked.has(r.id)), [rows, checked]);
  /** Ticked lines that actually have a party to remove. POSTED is excluded: a
   *  receipt already exists for it, so it is reversed, not cleared. */
  const checkedAssigned = useMemo(
    () => checkedRows.filter((r) => r.customerId != null && r.status !== 'POSTED').length,
    [checkedRows],
  );
  /** Ticked lines that Process could actually post. Drives the button's label,
   *  so it never offers to post a matched line just because it was ticked. */
  const selectedPostable = useMemo(
    () => rows.filter((r) => r.status === 'UNMATCHED' && checked.has(r.id)).length,
    [rows, checked],
  );
  const allCheckedIgnored = checkedRows.length > 0 && checkedRows.every((r) => r.status === 'IGNORED');
  const run = runResult?.run;
  const isDraft = run?.status === 'DRAFT';

  const toggleRow = (id: number) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /**
   * Assign the ticked lines to a party.
   *
   * `remember` defaults to TRUE. Telling the app who a payer is, is work; doing
   * it again next month for the same narration is the same work twice. The
   * fragment it learns is a distinctive word shared between the narration and
   * the party's name — generic and transaction words are thrown out first (see
   * `aliasFragment`), so "NEFT" or "PAYMENT" can never become an alias.
   *
   * `Assign once` is there for the narration that happens to name a party but
   * will not next time, where teaching it would mis-attribute a later line.
   */
  const doAssign = (remember: boolean) => {
    const id = customers.find((c) => c.name === assignTo)?.id;
    if (!id) return toast.error('Pick a customer.');
    if (!checked.size) return toast.error('Tick the lines to assign.');
    const n = checked.size;
    assign.mutate(
      { rowIds: [...checked], customerId: id, rememberAlias: remember },
      {
        onSuccess: () => {
          toast.success(
            `${n} line${n === 1 ? '' : 's'} assigned to ${assignTo}` +
              (remember ? ' — this narration will be recognised next time' : ' — narration not remembered'),
          );
          setChecked(new Set());
          setAssignTo('');
          // Show the working straight away — what was just assigned is exactly
          // when someone wants to see whether it matched and what it changes —
          // WITHOUT touching the list they are working through.
          setWorkingParty(id);
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not assign')),
      },
    );
  };

  /**
   * Undo the assignment on the ticked lines.
   *
   * Two questions, because they have different blast radii. Clearing the lines
   * only touches this run; forgetting the narration changes how EVERY future
   * statement is read, and there is no other screen in the app to undo that —
   * so it is asked separately and defaults to keeping the alias.
   */
  const doClearParty = async () => {
    const targets = checkedRows.filter((r) => r.customerId != null && r.status !== 'POSTED');
    if (!targets.length) return toast.error('Tick an assigned line first.');
    const n = targets.length;
    const forget = await confirm({
      title: `Clear the party on ${n} line${n === 1 ? '' : 's'}?`,
      description:
        'The line goes back to "No party". Choose "Also forget" to stop recognising this narration on future statements too — otherwise the next upload will assign it again.',
      confirmText: 'Also forget',
      cancelText: 'Just clear',
    });
    clearParty.mutate(
      { rowIds: targets.map((r) => r.id), forgetAlias: forget },
      {
        onSuccess: (res) => {
          toast.success(
            `Cleared ${n} line${n === 1 ? '' : 's'}` +
              (res.forgotten.length
                ? ` — no longer recognising ${res.forgotten.join(', ')}`
                : forget
                  ? ' — there was no remembered narration to forget'
                  : ' — the narration is still remembered'),
          );
          setChecked(new Set());
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not clear the party')),
      },
    );
  };

  /**
   * Put one line up for review: tick only it, and load its current party into
   * the assign box so the existing answer can be seen before it is changed.
   *
   * It routes through the SAME assign bar rather than writing straight away —
   * that bar is where "remember this narration" is chosen, and a correction is
   * precisely when that choice matters most.
   */
  const reviewParty = (row: BankStatementRowDto) => {
    setChecked(new Set([row.id]));
    setAssignTo(row.customerName ?? '');
    setWorkingParty(row.customerId ?? undefined);
  };

  const doIgnore = (ignored: boolean) => {
    if (!checked.size) return toast.error('Tick the lines first.');
    ignore.mutate(
      { rowIds: [...checked], ignored },
      {
        onSuccess: () => {
          toast.success(
            `${checked.size} line${checked.size === 1 ? '' : 's'} ${ignored ? 'marked not required — left out of the reconciliation' : 'brought back into the reconciliation'}`,
          );
          setChecked(new Set());
          setAssignTo('');
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not update')),
      },
    );
  };

  const doProcess = async () => {
    if (!run) return;
    /*
     * Ticking lines narrows Process to those; ticking nothing posts every
     * unmatched line, exactly as before. Only the POSTABLE ticked lines are
     * counted here so the confirmation promises what will actually happen —
     * ticking a matched line and a new one must not read as "post 2".
     */
    const postable = rows.filter((r) => r.status === 'UNMATCHED');
    const selected = postable.filter((r) => checked.has(r.id));
    const targets = selected.length ? selected : postable;
    const onlySelected = selected.length > 0;
    const n = targets.length;
    if (!n) {
      return toast.error(
        onlySelected ? 'None of the ticked lines can be posted.' : 'Nothing to post — every line already matches a receipt or has no party.',
      );
    }
    const total = targets.reduce((s, r) => s + (r.amount - r.matchedAmount), 0);
    const ignoredTicks = checked.size - selected.length;
    const ok = await confirm({
      title: onlySelected
        ? `Post ${n} selected receipt${n === 1 ? '' : 's'} to the ledger?`
        : `Post ${n} receipt${n === 1 ? '' : 's'} to the ledger?`,
      description:
        `${money0(total)} across ${n} line${n === 1 ? '' : 's'} the bank received but OMS has no receipt for. ` +
        `Each one is entered as an ordinary Receive Payment against its party${run.bankName ? ` in ${run.bankName}` : ''}, ` +
        `allocated to invoices the usual way. Matched lines are left alone. This cannot be undone from here.` +
        (onlySelected
          ? ` The other ${postable.length - n} unposted line${postable.length - n === 1 ? '' : 's'} stay${postable.length - n === 1 ? 's' : ''} as ${postable.length - n === 1 ? 'it is' : 'they are'}, and this working stays open so you can post ${postable.length - n === 1 ? 'it' : 'them'} later.`
          : '') +
        (ignoredTicks > 0
          ? ` ${ignoredTicks} ticked line${ignoredTicks === 1 ? '' : 's'} cannot be posted (already matched, no party, or not required) and ${ignoredTicks === 1 ? 'is' : 'are'} left out.`
          : ''),
      confirmText: `Post ${n} receipt${n === 1 ? '' : 's'}`,
    });
    if (!ok) return;
    process.mutate(onlySelected ? targets.map((r) => r.id) : undefined, {
      onSuccess: (res) => {
        // Drop the ticks: those lines are posted now, and a selection left
        // behind would silently narrow the NEXT Process to lines already done.
        setChecked(new Set());
        if (res.created.length) toast.success(`${res.created.length} receipt${res.created.length === 1 ? '' : 's'} posted`);
        if (res.failed.length) {
          toast.warning(`${res.failed.length} could not be posted — ${res.failed[0].reason}`, { duration: 12000 });
        }
      },
      onError: (e) => toast.error(getApiErrorMessage(e, 'Process failed'), { duration: 10000 }),
    });
  };

  const removeRun = async (id: number) => {
    const ok = await confirm({
      title: 'Delete this working?',
      description: 'The uploaded lines and every party assignment on them are removed. Nothing in the ledger changes.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    delRun.mutate(id, {
      onSuccess: () => {
        if (id === runId) setRunId(undefined);
        toast.success('Working deleted');
      },
      onError: (e) => toast.error(getApiErrorMessage(e, 'Could not delete')),
    });
  };

  return (
    // Phones: natural height, so <main> scrolls the whole page as one. sm+: a
    // fixed-height worksheet where only the lines list scrolls.
    <div className="flex min-h-0 flex-col gap-3 p-0.5 font-sans sm:h-full sm:p-3">
      {/* Says plainly what changed and why, the moment the run is opened —
          a reopened line is money the books are missing, not a detail. */}
      <Dialog open={!!reopenedInfo} onOpenChange={(o) => !o && setReopenedInfo(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-amber-600" />
              {(() => {
                const n = (reopenedInfo?.reopened.length ?? 0) + (reopenedInfo?.uncovered?.length ?? 0);
                return `${n} line${n === 1 ? '' : 's'} reopened`;
              })()}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-[13px]">
            {/* Lines that were MATCHED to an existing receipt which has since
                been deleted — the other way money drops out of the books. */}
            {!!reopenedInfo?.uncovered?.length && (
              <>
                <p>
                  {reopenedInfo.uncovered.length === 1 ? 'This line was' : 'These lines were'} matched against a receipt that has
                  since been deleted in Receive Payment, so the money is no longer in the books:
                </p>
                <div className="max-h-56 overflow-y-auto rounded-[4px] border border-amber-300 dark:border-amber-400/30">
                  <table className="w-full text-[12.5px]">
                    <tbody>
                      {reopenedInfo.uncovered.map((r) => (
                        <tr key={r.rowId} className="border-b last:border-b-0 odd:bg-slate-50/70 dark:odd:bg-white/[0.03]">
                          <td className="px-2 py-1 text-muted-foreground tabular-nums">#{r.rowNo}</td>
                          <td className="px-2 py-1 font-semibold">{r.customerName || '—'}</td>
                          <td className="px-2 py-1 text-right font-bold tabular-nums">{money(r.shortfall)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {!!reopenedInfo?.reopened.length && (
            <p>
              The receipt{reopenedInfo?.reopened.length === 1 ? '' : 's'} this statement created for the line
              {reopenedInfo?.reopened.length === 1 ? '' : 's'} below {reopenedInfo?.reopened.length === 1 ? 'has' : 'have'} since been
              deleted in Receive Payment, so this money is no longer in the books.
            </p>
            )}
            {!!reopenedInfo?.reopened.length && (
            <div className="max-h-56 overflow-y-auto rounded-[4px] border border-amber-300 dark:border-amber-400/30">
              <table className="w-full text-[12.5px]">
                <tbody>
                  {(reopenedInfo?.reopened ?? []).map((r) => (
                    <tr key={r.rowId} className="border-b last:border-b-0 odd:bg-slate-50/70 dark:odd:bg-white/[0.03]">
                      <td className="px-2 py-1 text-muted-foreground tabular-nums">#{r.rowNo}</td>
                      <td className="px-2 py-1 font-semibold">{r.customerName || '—'}</td>
                      <td className="px-2 py-1 text-muted-foreground font-mono text-[11.5px]">{r.postedRef}</td>
                      <td className="px-2 py-1 text-right font-bold tabular-nums">{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
            <p>
              They have been put back so you can post them again — this working is a draft once more, and
              <strong> Process</strong> will recreate just these.
              {!!reopenedInfo?.stillPosted && (
                <>
                  {' '}
                  The other {reopenedInfo.stillPosted} posted line{reopenedInfo.stillPosted === 1 ? '' : 's'} still
                  {reopenedInfo.stillPosted === 1 ? ' has its' : ' have their'} receipt and {reopenedInfo.stillPosted === 1 ? 'was' : 'were'} left
                  alone, so nothing can be posted twice.
                </>
              )}
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setReopenedInfo(null)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Step 1 — the file, the range, the columns ─────────────────────── */}
      {!runId && (
        <section className={cn(PANEL, 'p-4 sm:p-3')}>
          <div className="mb-4 flex items-start gap-3 sm:mb-3 sm:items-center sm:gap-2">
            <Landmark className="mt-0.5 size-5 shrink-0 text-indigo-700 dark:text-indigo-300 sm:mt-0" />
            <div>
              <h2 className="text-[16px] font-extrabold tracking-tight sm:text-[15px]">Reconcile a bank statement</h2>
              <p className="text-muted-foreground mt-0.5 text-[12px] leading-relaxed">
                Only the credit side is read — money in. Nothing reaches the ledger until you press Process.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className={FIELD_LABEL}>Statement file</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                // Cleared after every pick: a file input fires no change event
                // when the SAME file is chosen again, so without this a
                // rejected upload could not simply be retried.
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  e.target.value = '';
                  void onFile(picked);
                }}
              />
              <Button
                type="button"
                variant="outline"
                className={cn(CONTROL, 'w-full justify-start font-semibold')}
                onClick={() => fileRef.current?.click()}
                disabled={parsing}
              >
                {parsing ? <Loader2 className="animate-spin" /> : <FileSpreadsheet className="size-4" />}
                <span className="truncate">{fileName || 'Choose CSV…'}</span>
              </Button>
            </div>
            <div className="space-y-1">
              <Label className={FIELD_LABEL}>
                Received into *
                {bankReason && bankName && <span className="ml-1.5 font-medium normal-case opacity-70">matched by {bankReason}</span>}
              </Label>
              <NativeSelect
                value={bankName}
                onChange={(v) => {
                  setBankReason(null); // the user's pick, not ours
                  setBankName(v);
                }}
                options={['', ...(banks ?? []).map((b) => b.bankName)]}
                className={CONTROL}
              />
            </div>
            <div className="space-y-1">
              <Label className={FIELD_LABEL}>
                From
                {rangeFromFile && fileRange && <span className="ml-1.5 font-medium normal-case opacity-70">{rangeSource}</span>}
              </Label>
              <DatePicker
                value={fromDate}
                onChange={(v) => {
                  setRangeFromFile(false);
                  setFromDate(v);
                }}
                className={CONTROL}
              />
            </div>
            <div className="space-y-1">
              <Label className={FIELD_LABEL}>
                To
                {rangeFromFile && fileRange && <span className="ml-1.5 font-medium normal-case opacity-70">{rangeSource}</span>}
              </Label>
              <DatePicker
                value={toDate}
                onChange={(v) => {
                  setRangeFromFile(false);
                  setToDate(v);
                }}
                className={CONTROL}
              />
            </div>
          </div>

          {/* Column mapping — asked once per bank, then remembered. */}
          {columns.length > 0 && (
            <div className="mt-3 rounded-[4px] border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-400/30 dark:bg-indigo-500/10">
              <p className="mb-2 text-[12px] font-bold text-indigo-900 dark:text-indigo-200">
                Which column is which?{' '}
                <span className="font-medium opacity-80">
                  {preset?.from === 'bank'
                    ? 'Filled in from the last statement for this bank.'
                    : preset?.from === 'columns'
                      ? 'Filled in from the last statement that had these same columns.'
                      : 'Best guess from the headers — check it.'}
                </span>
              </p>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {(
                  [
                    ['date', 'Date *'],
                    ['narration', 'Narration *'],
                    ['credit', 'Credit (money in) *'],
                    ['debit', 'Debit (optional)'],
                    ['ref', 'Reference (optional)'],
                  ] as [keyof BankStatementColumnMap, string][]
                ).map(([field, label]) => (
                  <div key={field} className="space-y-1">
                    <Label className={FIELD_LABEL}>{label}</Label>
                    <NativeSelect
                      value={(map[field] as string) ?? ''}
                      onChange={(v) => setMap((m) => ({ ...m, [field]: v }))}
                      options={['', ...columns]}
                      className={CONTROL}
                    />
                  </div>
                ))}
              </div>
              {/* The first few rows, under the mapping.
                  Not decoration: a column cannot always be identified from its
                  title — a statement can arrive with its amount columns the
                  wrong way round. Showing the real figures is how the user
                  checks the mapping before it is used, which is why nothing
                  here tries to correct it for them. */}
              {!!statementRows.length && (
                /* EVERY row, not the first five. The point of this table is to
                   check the mapping against real figures, and five rows of a
                   605-row statement cannot show a column that only fills in
                   further down. Its own scroll box with the titles pinned, so
                   it stays checkable without swallowing the page. */
                <div className="mt-3 max-h-[420px] overflow-auto rounded-[4px] border bg-white dark:bg-slate-900">
                  <table className="w-full border-collapse text-[11.5px]">
                    <thead>
                      <tr>
                        {columns.map((c) => (
                          <th
                            key={c}
                            className={cn(
                              'sticky top-0 z-10 border-b bg-white px-2 py-1 text-left font-bold whitespace-nowrap dark:bg-slate-900',
                              c === map.date && 'bg-sky-100 dark:bg-sky-500/20',
                              c === map.narration && 'bg-violet-100 dark:bg-violet-500/20',
                              c === map.credit && 'bg-emerald-100 dark:bg-emerald-500/20',
                              c === map.debit && 'bg-rose-100 dark:bg-rose-500/20',
                            )}
                          >
                            {c}
                            {c === map.credit && <span className="ml-1 font-extrabold text-emerald-700">← money in</span>}
                            {c === map.debit && <span className="ml-1 font-extrabold text-rose-700">← money out</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {statementRows.map((r, i) => (
                        <tr key={i} className="odd:bg-slate-50/70 dark:odd:bg-white/[0.03]">
                          {columns.map((c) => (
                            <td key={c} className="max-w-[220px] truncate border-b px-2 py-1 tabular-nums whitespace-nowrap">
                              {/* The date column is shown as dd/mm/yy whichever way round the bank
                                  wrote it — an American export otherwise put "4/3/26" on screen
                                  meaning April, read here as March. Every other column is raw text. */}
                              {c === map.date ? statementDateToDisplay(r[c], dateOrder) : (r[c] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="text-muted-foreground text-[11.5px]">
                  All {statementRows.length.toLocaleString('en-IN')} statement rows are shown — scroll the table.
                  {trimmed.trimmed > 0 && (
                    <>
                      {' '}The <span className="font-semibold">{trimmed.trimmed.toLocaleString('en-IN')}</span> lines of legend
                      and disclaimer below them are left out.
                    </>
                  )}
                  {fileRange && (
                    <>
                      {' '}Covering <span className="font-semibold">{formatDate(fileRange.from)}</span> to{' '}
                      <span className="font-semibold">{formatDate(fileRange.to)}</span> ({rangeSource}).
                    </>
                  )}{' '}
                  Debits and anything outside the date range are dropped when it loads.
                </p>
                {/* Detection is good but not infallible, and a wrong header row
                    means every column is wrong. Correcting it is one field. */}
                <label className="text-muted-foreground ml-auto flex items-center gap-1.5 text-[11.5px]">
                  Column titles are on line
                  <Input
                    type="number"
                    min={1}
                    max={grid.length}
                    value={headerRow + 1}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 1 && n <= grid.length) setHeaderRow(n - 1);
                    }}
                    className="h-7 w-16 text-center text-[12px]"
                  />
                </label>
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end sm:mt-3">
            <Button className="w-full sm:w-auto" onClick={loadStatement} disabled={createRun.isPending || !canEdit || !sheetRows.length}>
              {createRun.isPending ? <Loader2 className="animate-spin" /> : <Upload className="size-4" />} Load statement
            </Button>
          </div>
        </section>
      )}

      {/* ── Saved workings ───────────────────────────────────────────────── */}
      {!runId && !!runsList?.items.length && (
        <section className={cn(PANEL, 'p-4 sm:p-3')}>
          <div className="mb-3 flex items-center justify-between sm:mb-2">
            <h3 className="text-[15px] font-extrabold tracking-tight sm:text-[13px]">Saved workings</h3>
            <span className="text-muted-foreground text-xs font-medium">{runsList.items.length} saved</span>
          </div>

          <div className="space-y-3 sm:hidden">
            {runsList.items.map((r) => (
              <article key={r.id} className="rounded-lg border border-amber-200 bg-card p-3.5 dark:border-amber-400/20">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words text-[13px] font-bold leading-snug">{r.fileName}</p>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold ring-1 ring-inset',
                      r.status === 'PROCESSED'
                        ? 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300'
                        : 'bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-400/20 dark:text-amber-200',
                    )}
                  >
                    {r.status === 'PROCESSED' ? 'Processed' : 'Draft'}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground font-medium">Bank</dt>
                    <dd className="mt-0.5 font-semibold">{r.bankName ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-medium">Credits</dt>
                    <dd className="mt-0.5 font-bold tabular-nums text-emerald-700">{money0(r.creditTotal)}</dd>
                  </div>
                  <div className="col-span-2 border-t border-border/70 pt-3">
                    <dt className="text-muted-foreground font-medium">Statement range</dt>
                    <dd className="mt-0.5 font-semibold tabular-nums">{formatDate(r.fromDate)} – {formatDate(r.toDate)}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-muted-foreground flex-1 text-xs font-medium">{r.rowCount.toLocaleString('en-IN')} lines</span>
                  <Button size="sm" variant="outline" className="h-10 px-4 font-semibold" onClick={() => setRunId(r.id)}>
                    Open working
                  </Button>
                  {can('bankstatement:delete') && r.status !== 'PROCESSED' && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive size-10"
                      onClick={() => void removeRun(r.id)}
                      aria-label={`Delete ${r.fileName}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>

          <div className="hidden overflow-auto sm:block">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH}>File</th>
                  <th className={TH}>Bank</th>
                  <th className={TH}>Range</th>
                  <th className={cn(TH, 'text-right')}>Credits</th>
                  <th className={cn(TH, 'text-right')}>Lines</th>
                  <th className={cn(TH, 'text-center')}>Status</th>
                  <th className={cn(TH, 'w-20 text-center')}>Action</th>
                </tr>
              </thead>
              <tbody>
                {runsList.items.map((r) => (
                  <tr key={r.id} className="border-b odd:bg-slate-50/60 hover:bg-indigo-50/60 dark:odd:bg-white/[0.02]">
                    <td className={cn(TD, 'font-semibold')}>{r.fileName}</td>
                    <td className={TD}>{r.bankName ?? '—'}</td>
                    <td className={cn(TD, 'whitespace-nowrap tabular-nums')}>
                      {formatDate(r.fromDate)} – {formatDate(r.toDate)}
                    </td>
                    <td className={cn(TD, NUM, 'font-bold')}>{money0(r.creditTotal)}</td>
                    <td className={cn(TD, NUM)}>{r.rowCount}</td>
                    <td className={cn(TD, 'text-center')}>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11.5px] font-bold ring-1 ring-inset',
                          r.status === 'PROCESSED'
                            ? 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300'
                            : 'bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-400/20 dark:text-amber-200',
                        )}
                      >
                        {r.status === 'PROCESSED' ? 'Processed' : 'Draft'}
                      </span>
                    </td>
                    <td className={cn(TD, 'text-center')}>
                      <div className="flex justify-center gap-1">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-[12px]" onClick={() => setRunId(r.id)}>
                          Open
                        </Button>
                        {can('bankstatement:delete') && r.status !== 'PROCESSED' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:text-destructive size-7"
                            onClick={() => void removeRun(r.id)}
                            aria-label={`Delete ${r.fileName}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Step 2 — review ──────────────────────────────────────────────── */}
      {runId && (
        <>
          <section className={cn(PANEL, 'p-3')}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setRunId(undefined)}>
                ← All workings
              </Button>
              <div className="min-w-0">
                <h2 className="truncate text-[15px] font-extrabold tracking-tight">{run?.fileName}</h2>
                <p className="text-muted-foreground text-[12px]">
                  {run && `${formatDate(run.fromDate)} – ${formatDate(run.toDate)}`}
                  {run?.bankName ? ` · ${run.bankName}` : ''}
                  {run?.status === 'PROCESSED' && ' · processed, read-only'}
                </p>
              </div>
              <div className="ml-auto flex gap-2">
                {canProcess && isDraft && (
                  <Button
                    onClick={() => void doProcess()}
                    disabled={process.isPending || !run?.unmatchedCount}
                    title={
                      selectedPostable
                        ? `Create ${selectedPostable} receipt(s) from the ticked lines — the rest stay for later`
                        : run?.unmatchedCount
                          ? `Create ${run.unmatchedCount} receipts in the ledger`
                          : 'Nothing to post — every line already matches a receipt, or has no party'
                    }
                    className="bg-emerald-600 font-bold text-white hover:bg-emerald-700"
                  >
                    {process.isPending ? <Loader2 className="animate-spin" /> : <ArrowRight className="size-4" />}
                    {selectedPostable ? `Process selected (${selectedPostable})` : `Process ${run?.unmatchedCount ? `(${run.unmatchedCount})` : ''}`}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Credits in range" value={money0(run?.creditTotal ?? 0)} hint="Total money in, for the range." />
              <Stat label="Matched" value={String(run?.matchedCount ?? 0)} tone="good" hint={STATUS_META.MATCHED.hint} />
              <Stat label="In total" value={String(run?.partialCount ?? 0)} hint={STATUS_META.PARTIAL.hint} />
              <Stat label="No receipt" value={String(run?.unmatchedCount ?? 0)} tone="bad" hint={STATUS_META.UNMATCHED.hint} />
              <Stat label="No party" value={String(run?.noPartyCount ?? 0)} tone="warn" hint={STATUS_META.NO_PARTY.hint} />
              {!!run?.postedCount && <Stat label="Posted" value={String(run.postedCount)} hint={STATUS_META.POSTED.hint} />}
            </div>
          </section>

          {/* grid-cols-1 = minmax(0,1fr): without it the column grows to the
              longest unbreakable narration and the cards run off a phone screen. */}
          <div className={cn('grid grid-cols-1 gap-3 sm:min-h-0 sm:flex-1', showWorking && 'lg:grid-cols-[1fr_360px]')}>
            {/* Lines */}
            <section className={cn(PANEL, 'flex min-w-0 flex-col sm:min-h-0')}>
              <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 p-2.5 dark:border-amber-400/20">
                <NativeSelect
                  value={selectedParty ? String(selectedParty) : ''}
                  onChange={(v) => {
                    const id = v ? Number(v) : undefined;
                    setSelectedParty(id);
                    // Picking a party here means "show me this party", so the
                    // working follows the filter. Only the reverse was wrong.
                    setWorkingParty(id);
                  }}
                  options={[
                    { value: '', label: `All lines (${rows.length})` },
                    ...(runResult?.parties ?? []).map((p) => ({
                      value: String(p.customerId),
                      label: `${p.customerName} — ${p.lines} line${p.lines === 1 ? '' : 's'}, ${money0(p.total)}`,
                    })),
                  ]}
                  className={cn(CONTROL, 'min-w-0 basis-full sm:min-w-[260px] sm:flex-1 sm:basis-auto')}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-8 shrink-0 rounded-[4px] text-[12px] font-semibold max-sm:order-last"
                  onClick={() => toggleWorking(!showWorking)}
                  title="The before / after figures for the party you pick"
                >
                  {showWorking ? <PanelRightClose className="size-3.5" /> : <PanelRightOpen className="size-3.5" />}
                  {showWorking ? 'Hide working' : 'Show working'}
                </Button>
                {/* Status filter. The one that matters is "Not required": a line
                    left out of the reconciliation is otherwise unfindable in a
                    list this long, and undoing it would be impossible. */}
                <NativeSelect
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: '', label: 'Any status' },
                    ...(['MATCHED', 'PARTIAL', 'UNMATCHED', 'NO_PARTY', 'IGNORED', 'POSTED', 'RETURNED'] as const)
                      .filter((k) => (statusCounts.get(k) ?? 0) > 0)
                      .map((k) => ({ value: k, label: `${STATUS_META[k].label} (${statusCounts.get(k)})` })),
                  ]}
                  className={cn(CONTROL, 'min-w-0 flex-1 sm:w-48 sm:flex-none', statusFilter && 'font-bold')}
                />
                {!!checked.size && isDraft && canEdit && (
                  <div className="flex flex-wrap items-center gap-2 rounded-[4px] bg-sky-50 px-2 py-1.5 ring-1 ring-sky-200 ring-inset dark:bg-sky-400/10 dark:ring-sky-400/25">
                    <span className="text-[12px] font-bold text-sky-800 dark:text-sky-200">{checked.size} selected</span>
                    <Combobox
                      value={assignTo}
                      onChange={setAssignTo}
                      /*
                       * A non-SALES party is tagged in the label and findable by
                       * its category.
                       *
                       * The list was bare names, so a scrap party looked exactly
                       * like a sales one — there was no way to tell which of 114
                       * rows took scrap money, and no way to ask for them. The
                       * category also rides along as a hidden keyword, so typing
                       * "scrap" brings up all of them at once.
                       *
                       * SALES is left untagged: it is the overwhelming majority,
                       * and labelling the norm just adds noise to every row.
                       */
                      options={customers.map((c) => ({
                        value: c.name,
                        label: c.group && c.group !== DEFAULT_LEDGER_GROUP ? `${c.name} · ${c.group}` : c.name,
                        keywords: `${c.group} ${c.category}`,
                      }))}
                      placeholder="Assign to customer…"
                      className={cn(CONTROL, 'w-56')}
                    />
                    {/* The default REMEMBERS. Teaching the narration is what
                        stops the same payer being re-assigned by hand on every
                        future statement, so it should not need a second thought. */}
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={() => doAssign(true)}
                      disabled={assign.isPending}
                      title="Assign, and recognise this narration as this party on future statements"
                    >
                      <UserPlus className="size-3.5" /> Assign
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => doAssign(false)}
                      disabled={assign.isPending}
                      title="Assign these lines only — do not recognise this narration next time"
                    >
                      Assign once
                    </Button>
                    {/* The real undo. Only offered when something is actually
                        assigned, so it never reads as a third way to assign. */}
                    {checkedAssigned > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-rose-700 hover:text-rose-800 dark:text-rose-400"
                        onClick={() => void doClearParty()}
                        disabled={clearParty.isPending}
                        title="Take the party off these lines — and optionally stop recognising this narration in future"
                      >
                        <Undo2 className="size-3.5" /> Clear party ({checkedAssigned})
                      </Button>
                    )}
                    {/* Marking a line not-required is the answer for a credit
                        that is not a customer receipt at all — a sweep reversal,
                        interest, an inter-account transfer. It is excluded from
                        every total and Process never posts it. Reversible, which
                        is why the same button offers the undo. */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => doIgnore(!allCheckedIgnored)}
                      disabled={ignore.isPending}
                      title={
                        allCheckedIgnored
                          ? 'Put these lines back into the reconciliation'
                          : 'Leave these out — not a customer receipt, nothing will be posted for them'
                      }
                    >
                      <Ban className="size-3.5" /> {allCheckedIgnored ? 'Bring back' : 'Not required'}
                    </Button>
                  </div>
                )}
              </div>

              {/* Returned cheques from this upload. Not a toast: the posted ones
                  mean the ledger holds a receipt for money that came back, and
                  that has to be read and acted on, not glimpsed. */}
              {returnedCheques.length > 0 && (
                <div className="mx-2 mb-2 rounded-[4px] border border-rose-300 bg-rose-50 px-3 py-2 dark:border-rose-400/40 dark:bg-rose-400/10">
                  <div className="flex items-start gap-2">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-600" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="text-[13px] font-bold text-rose-900 dark:text-rose-100">
                        {returnedCheques.length} cheque{returnedCheques.length === 1 ? '' : 's'} returned unpaid
                      </p>
                      {returnedCheques.map((c) => (
                        <p key={`${c.rowId}-${c.chequeNo}`} className="text-[12px] text-rose-900 dark:text-rose-100">
                          <span className="font-mono font-bold">{c.chequeNo}</span> · {money0(c.amount)}
                          {c.customerName ? ` · ${c.customerName}` : ''} —{' '}
                          {c.cancelled ? (
                            <span>its credit is marked returned and will not be posted.</span>
                          ) : (
                            <>
                              <span className="font-bold">already posted as {c.postedRef}.</span>{' '}
                              <Button
                                size="sm"
                                variant="outline"
                                className="ml-1 h-6 border-rose-400 px-2 text-[11px] text-rose-800 hover:bg-rose-100 dark:text-rose-200"
                                onClick={() => void doReverseReturned(c)}
                                disabled={reverseReturned.isPending}
                                title={`Delete receipt ${c.postedRef} and put its invoices back to unpaid`}
                              >
                                <Undo2 className="size-3" /> Reverse {c.postedRef}
                              </Button>
                            </>
                          )}
                        </p>
                      ))}
                    </div>
                    <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => setReturnedCheques([])}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}

              <div className="sm:min-h-0 sm:flex-1 sm:overflow-auto">
                {/* Mobile View: Cards */}
                <div className="space-y-2 p-2 sm:hidden">
                  {runLoading ? (
                    <div className="text-muted-foreground flex justify-center py-10">
                      <Loader2 className="size-6 animate-spin" />
                    </div>
                  ) : shown.length === 0 ? (
                    <p className="text-muted-foreground py-8 text-center text-xs">No lines.</p>
                  ) : (
                    shown.map((r) => (
                      <LineCard
                        key={r.id}
                        row={r}
                        checked={checked.has(r.id)}
                        onToggle={() => toggleRow(r.id)}
                        selectable={isDraft && canEdit}
                        vouchers={runResult?.receiptVouchers ?? {}}
                        onChangeParty={isDraft && canEdit ? reviewParty : undefined}
                      />
                    ))
                  )}
                </div>

                {/* Desktop View: Table */}
                <table className="hidden w-full border-collapse sm:table">
                  <thead>
                    <tr>
                      <th className={cn(TH, 'w-9')} aria-label="Select" />
                      <th className={cn(TH, 'w-24')}>Date</th>
                      <th className={TH}>Narration</th>
                      <th className={cn(TH, 'w-28 text-right')}>Credit</th>
                      <th className={cn(TH, 'w-48')}>Party</th>
                      {/* Sort lives on this header because it is the only column
                          whose order is a question — the rest are the statement's
                          own facts and read best in statement order. */}
                      <th
                        className={cn(TH, 'w-32 cursor-pointer select-none hover:underline')}
                        onClick={() => setRecentFirst((v) => !v)}
                        title={recentFirst ? 'Back to statement order' : 'Show the most recently decided lines first'}
                      >
                        Assigned {recentFirst ? '↓' : '·'}
                      </th>
                      <th className={cn(TH, 'w-28 text-center')}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runLoading ? (
                      <tr>
                        <td colSpan={7} className="text-muted-foreground py-10 text-center">
                          <Loader2 className="mx-auto size-5 animate-spin" />
                        </td>
                      </tr>
                    ) : shown.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-muted-foreground py-10 text-center text-[13px]">
                          No lines.
                        </td>
                      </tr>
                    ) : (
                      shown.map((r) => (
                        <LineRow
                          key={r.id}
                          row={r}
                          checked={checked.has(r.id)}
                          onToggle={() => toggleRow(r.id)}
                          selectable={isDraft && canEdit}
                          vouchers={runResult?.receiptVouchers ?? {}}
                          onChangeParty={isDraft && canEdit ? reviewParty : undefined}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Before / after for the selected party — off unless asked for. */}
            {showWorking && (
            <section className={cn(PANEL, 'min-h-0 min-w-0 overflow-auto p-3', !workingParty && 'max-sm:hidden')}>
              {!workingParty ? (
                <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[12.5px]">
                  <Landmark className="size-8 opacity-30" />
                  <p>Pick a customer above to see what Process would do to them.</p>
                </div>
              ) : !partyView ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-[14px] font-extrabold tracking-tight">{partyView.customerName}</h3>
                    <p className="text-muted-foreground text-[11.5px]">
                      {run && `${formatDate(run.fromDate)} – ${formatDate(run.toDate)}`}
                    </p>
                  </div>

                  <div className="space-y-1 rounded-[4px] border p-2.5">
                    <Row label="Bank credits" value={money(partyView.statementTotal)} strong />
                    <Row label="Already matched" value={money(partyView.matchedTotal)} tone="good" />
                    <Row label="No receipt yet" value={money(partyView.shortfall)} tone={partyView.shortfall ? 'bad' : undefined} strong />
                    {partyView.unbackedReceiptTotal > 0 && (
                      <Row
                        label="Receipts the bank didn’t show"
                        value={money(partyView.unbackedReceiptTotal)}
                        tone="warn"
                        hint="Recorded in OMS inside this range but with no bank credit behind it — worth a look, Process does not touch these."
                      />
                    )}
                  </div>

                  {/*
                    Before and after, stacked.
                    
                    Side by side gave each card about 165px in this 360px panel,
                    which is not enough for "Outstanding (bank)" and a figure like
                    1,62,934 on one line — so every label broke across two lines
                    and the pair was harder to compare than one under the other.
                    Full width, one above the other, each row fits and the two
                    columns of figures line up vertically for comparison.
                  */}
                  <div className="grid gap-2">
                    <BalanceCard title="Before" b={partyView.before} />
                    <BalanceCard title="After Process" b={partyView.after} highlight={partyView.shortfall > 0} />
                  </div>

                  {partyView.shortfall > 0 ? (
                    <p className="rounded-[4px] border border-rose-200 bg-rose-50 px-2.5 py-2 text-[12px] text-rose-900 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200">
                      <TriangleAlert className="mr-1 inline size-3.5" />
                      Process would add {money(partyView.shortfall)} of receipts for this party and allocate them to their
                      outstanding invoices.
                    </p>
                  ) : (
                    <p className="rounded-[4px] border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[12px] text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                      <CheckCircle2 className="mr-1 inline size-3.5" />
                      Every bank credit for this party is already accounted for. Process changes nothing here.
                    </p>
                  )}
                </div>
              )}
            </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value, tone, strong, hint }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn'; strong?: boolean; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12.5px]" title={hint}>
      <span className="text-muted-foreground min-w-0 truncate">{label}</span>
      <span
        className={cn(
          'shrink-0 tabular-nums whitespace-nowrap',
          strong ? 'font-extrabold' : 'font-semibold',
          tone === 'good' && 'text-emerald-700 dark:text-emerald-400',
          tone === 'bad' && 'text-rose-700 dark:text-rose-400',
          tone === 'warn' && 'text-amber-700 dark:text-amber-400',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function BalanceCard({ title, b, highlight }: { title: string; b: { receiptCount: number; receiptTotal: number; pendingBank: number; pendingCash: number; advance: number }; highlight?: boolean }) {
  return (
    <div className={cn('rounded-[4px] border p-2.5', highlight && 'border-emerald-400 bg-emerald-50/60 dark:border-emerald-400/50 dark:bg-emerald-500/10')}>
      <p className="text-muted-foreground mb-1 text-[10px] font-bold tracking-widest uppercase">{title}</p>
      <Row label={`Receipts (${b.receiptCount})`} value={money0(b.receiptTotal)} />
      <Row label="Outstanding (bank)" value={money0(b.pendingBank)} strong />
      <Row label="Outstanding (cash)" value={money0(b.pendingCash)} />
      {/* Where a receipt bigger than the debt actually goes. */}
      {b.advance > 0 && <Row label="On account" value={money0(b.advance)} tone="warn" />}
    </div>
  );
}

/** "2 min ago" / "3 hr ago" / a date once it stops being today's work. Relative
 *  is what matters here — the question is "did I just do this", not "at what
 *  o'clock", and the exact stamp is in the cell's tooltip either way. */
function sinceText(iso: string): string {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins) || mins < 0) return formatDate(iso);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return days < 7 ? `${days} day${days === 1 ? '' : 's'} ago` : formatDate(iso);
}

/** Statement ref columns carry "-", "NA" and friends on rows that have no
 *  instrument (NEFT/RTGS). Those are a filler, not a number worth showing. */
const hasRef = (v: string | null) => {
  const s = v?.trim() ?? '';
  return !!s && !/^([-–—.]+|na|n\/a|nil|null)$/i.test(s);
};

/** CLG / CHQ / CTS narrations are cheque clearings, so their ref IS the cheque
 *  number. Anything else (NEFT, IMPS, UPI) gets the neutral "Ref" — calling a
 *  UTR a cheque number would be a different kind of wrong. */
const isChequeTxn = (n: string) => /\b(clg|chq|cheque|cts|clearing)\b/i.test(n ?? '');

function LineCard({
  row,
  checked,
  onToggle,
  selectable,
  vouchers,
  onChangeParty,
}: {
  row: BankStatementRowDto;
  checked: boolean;
  onToggle: () => void;
  selectable: boolean;
  vouchers: Record<string, string>;
  onChangeParty?: (row: BankStatementRowDto) => void;
}) {
  return (
    <div
      className={cn(
        'relative rounded-lg border p-3 transition-colors space-y-2',
        row.status === 'UNMATCHED' && 'border-rose-200 bg-rose-50/60 dark:border-rose-900/30 dark:bg-rose-500/10',
        row.status === 'NO_PARTY' && 'border-amber-200 bg-amber-50/70 dark:border-amber-900/30 dark:bg-amber-400/10',
        row.status === 'MATCHED' && 'bg-card',
        row.status === 'PARTIAL' && 'bg-sky-50/50 dark:bg-sky-500/10',
        row.status === 'IGNORED' && 'opacity-60 bg-muted/40',
        row.status === 'RETURNED' && 'border-rose-300 bg-rose-50/70 dark:bg-rose-500/10',
        checked && 'ring-2 ring-primary/50',
      )}
      onClick={selectable ? onToggle : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {selectable && (
            <span
              className={cn(
                'inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] border-[1.5px]',
                checked ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-400 bg-white',
              )}
            >
              {checked && <CheckCircle2 className="size-3" />}
            </span>
          )}
          <span className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
            {formatDate(row.txnDate)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusChip status={row.status} />
          <span className="text-sm font-extrabold tabular-nums text-foreground">{money0(row.amount)}</span>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium leading-relaxed text-foreground break-words">{row.narration || '—'}</p>

        {hasRef(row.refNo) && (
          <div className="inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[10.5px]">
            <span className="text-muted-foreground font-semibold uppercase text-[9.5px]">
              {isChequeTxn(row.narration) ? 'Cheque' : 'Ref'}
            </span>
            <span className="font-mono font-semibold tabular-nums">{row.refNo}</span>
          </div>
        )}

        {row.matchedRefs.length > 0 && (
          <p
            className={cn(
              'text-[11px] font-semibold break-words',
              row.status === 'UNMATCHED' ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400',
            )}
          >
            {row.status === 'MATCHED' && 'against '}
            {row.status === 'PARTIAL' && 'covered by '}
            {row.status === 'UNMATCHED' && `${money0(row.matchedAmount)} of it against `}
            <span className="font-mono">{row.matchedRefs.map((r) => vouchers[r] ?? r).join(', ')}</span>
            {row.status === 'UNMATCHED' && ` · ${money0(row.amount - row.matchedAmount)} short`}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t pt-2 text-xs">
        <div onClick={(e) => e.stopPropagation()} className="min-w-0 flex-1">
          {onChangeParty ? (
            <button
              type="button"
              onClick={() => onChangeParty(row)}
              className="flex max-w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-indigo-50 dark:hover:bg-indigo-500/15"
            >
              <span className="truncate font-semibold text-slate-800 dark:text-slate-200">
                {row.customerName || 'Assign party…'}
                {row.partySource && row.partySource !== 'MANUAL' && (
                  <span className="text-muted-foreground ml-1 text-[10.5px] font-normal">(auto)</span>
                )}
              </span>
              <Pencil className="text-muted-foreground size-3 shrink-0" />
            </button>
          ) : (
            <span className="truncate font-semibold">{row.customerName || '—'}</span>
          )}
        </div>
        {row.partyAt && (
          <span className="text-muted-foreground shrink-0 text-[10.5px]">
            {sinceText(row.partyAt)} ({row.partyBy || 'auto'})
          </span>
        )}
      </div>
    </div>
  );
}

function LineRow({ row, checked, onToggle, selectable, vouchers, onChangeParty }: { row: BankStatementRowDto; checked: boolean; onToggle: () => void; selectable: boolean; vouchers: Record<string, string>; onChangeParty?: (row: BankStatementRowDto) => void }) {
  return (
    <tr
      className={cn(
        'border-b transition-colors',
        row.status === 'UNMATCHED' && 'bg-rose-50/60 dark:bg-rose-500/10',
        row.status === 'NO_PARTY' && 'bg-amber-50/70 dark:bg-amber-400/10',
        row.status === 'IGNORED' && 'opacity-55',
        // Struck through, not faded: a returned cheque is money that was there
        // and went away, which reads differently from one deliberately left out.
        row.status === 'RETURNED' && 'bg-rose-50/70 line-through decoration-rose-400/70 dark:bg-rose-500/10',
        selectable && 'cursor-pointer hover:bg-indigo-50/60',
      )}
      onClick={selectable ? onToggle : undefined}
    >
      <td className={cn(TD, 'text-center')}>
        {selectable && (
          <span
            className={cn(
              'inline-flex size-4 items-center justify-center rounded-[3px] border-[1.5px]',
              checked ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-400 bg-white',
            )}
          >
            {checked && <CheckCircle2 className="size-3" />}
          </span>
        )}
      </td>
      <td className={cn(TD, 'whitespace-nowrap tabular-nums')}>{formatDate(row.txnDate)}</td>
      <td className={cn(TD, 'max-w-0')}>
        <span className="block truncate font-medium" title={row.narration}>
          {row.narration || '—'}
        </span>
        {/* Labelled, because a bare grey number under the narration read as part
            of the narration — nobody could tell it was the cheque number. */}
        {hasRef(row.refNo) && (
          <span
            className="mt-0.5 inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-px align-middle text-[10.5px] leading-[1.45]"
            title={`${isChequeTxn(row.narration) ? 'Cheque no' : 'Reference no'} ${row.refNo} — from the statement's ref column`}
          >
            <span className="text-muted-foreground font-semibold tracking-wide uppercase">
              {isChequeTxn(row.narration) ? 'Cheque' : 'Ref'}
            </span>
            <span className="font-mono font-semibold tabular-nums">{row.refNo}</span>
          </span>
        )}
        {/* The evidence, not just the verdict. A line says "Matched" because a
            receipt of the same amount sits within a few days of it — naming
            that receipt is what makes the verdict checkable instead of trusted. */}
        {row.matchedRefs.length > 0 && (
          /*
           * The VOUCHER number, because that is what the Party Ledger prints —
           * quoting the internal REF ID alone made the two screens impossible to
           * line up. The REF ID stays in the tooltip.
           *
           * The wording has to follow the STATUS. A "No receipt" line can still
           * name a receipt: the party's spare receipts cover PART of it, and the
           * remainder is the shortfall Process would post. Saying "against" there
           * — the same word a fully matched line uses — read as a contradiction.
           */
          <span
            className={cn(
              'mt-0.5 block truncate text-[11px] font-semibold',
              row.status === 'UNMATCHED'
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-emerald-700 dark:text-emerald-400',
            )}
            title={
              (row.status === 'UNMATCHED'
                ? `${money(row.matchedAmount)} of this ${money(row.amount)} credit is covered; ${money(row.amount - row.matchedAmount)} has no receipt and is what Process would create. Covered by: `
                : 'Receipt(s): ') + row.matchedRefs.map((r) => (vouchers[r] ? `${vouchers[r]} (${r})` : r)).join(', ')
            }
          >
            {row.status === 'MATCHED' && 'against '}
            {row.status === 'PARTIAL' && 'covered by '}
            {row.status === 'UNMATCHED' && `${money0(row.matchedAmount)} of it against `}
            <span className="font-mono">{row.matchedRefs.slice(0, 2).map((r) => vouchers[r] ?? r).join(', ')}</span>
            {row.matchedRefs.length > 2 && ` +${row.matchedRefs.length - 2} more`}
            {row.status === 'UNMATCHED' && ` · ${money0(row.amount - row.matchedAmount)} short`}
          </span>
        )}
      </td>
      <td className={cn(TD, NUM, 'font-bold')}>{money0(row.amount)}</td>
      {/*
        The party is editable in place.
        
        Changing one that was already set meant finding it again, ticking it and
        using the bar at the top — so a party worked out automatically, which is
        exactly the kind most worth a second look, was the most awkward to
        correct. Clicking it here arms that same bar for this one line, so the
        "remember this narration" choice still gets made deliberately rather
        than being assumed.
      */}
      <td className={TD} onClick={(e) => e.stopPropagation()}>
        {onChangeParty ? (
          <button
            type="button"
            onClick={() => onChangeParty(row)}
            className="group/party -mx-1 flex max-w-full items-center gap-1 rounded-[3px] px-1 py-0.5 text-left hover:bg-indigo-50 dark:hover:bg-indigo-500/15"
            title={row.customerName ? 'Change the party on this line' : 'Assign a party to this line'}
          >
            {row.customerName ? (
              <span className="font-semibold">
                {row.customerName}
                {row.partySource && row.partySource !== 'MANUAL' && (
                  <span className="text-muted-foreground ml-1 text-[10.5px] font-medium" title="Worked out automatically — confirm it if unsure">
                    (auto)
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
            <Pencil className="text-muted-foreground size-3 shrink-0 opacity-0 transition-opacity group-hover/party:opacity-100" />
          </button>
        ) : row.customerName ? (
          <span className="font-semibold">
            {row.customerName}
            {row.partySource && row.partySource !== 'MANUAL' && (
              <span className="text-muted-foreground ml-1 text-[10.5px] font-medium" title="Worked out automatically — confirm it if unsure">
                (auto)
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      {/* When this line was last decided, and by whom. A row nobody has touched
          shows nothing rather than a time, so the sort has something honest to
          put at the bottom. */}
      <td className={cn(TD, 'whitespace-nowrap')}>
        {row.partyAt ? (
          <span title={`${new Date(row.partyAt).toLocaleString()}${row.partyBy ? ` — ${row.partyBy}` : ' — matched automatically'}`}>
            <span className="text-[12px]">{sinceText(row.partyAt)}</span>
            <span className="text-muted-foreground block text-[10.5px]">{row.partyBy || 'auto'}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className={cn(TD, 'text-center')}>
        <StatusChip status={row.status} />
        {row.postedRef && <p className="text-muted-foreground mt-0.5 font-mono text-[10.5px]">{row.postedRef}</p>}
      </td>
    </tr>
  );
}

export default BankStatementPage;
