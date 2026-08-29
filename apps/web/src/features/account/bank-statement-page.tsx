import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  FileSpreadsheet,
  Landmark,
  Loader2,
  Trash2,
  TriangleAlert,
  Upload,
  UserPlus,
} from 'lucide-react';
import type { BankStatementColumnMap, BankStatementRowDto, BankStatementRunResult } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { detectHeaderRow, gridToRows, parseSheetGrid } from '@/lib/excel';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { NativeSelect } from '@/components/common/combo';
import { Combobox } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/ui/date-picker';
import { useCustomers } from '@/features/customers/use-customers';
import { useActiveBankAccounts } from './use-account';
import {
  useAssignBankRows,
  useBankParty,
  useBankRun,
  useBankRuns,
  useColumnPreset,
  useCreateBankRun,
  useDeleteBankRun,
  useIgnoreBankRows,
  useProcessBankRun,
} from './use-bank-statement';

/* ── House chrome, shared with the other Accounts worksheets ──────────────── */

const FIELD_LABEL = 'text-[10px] font-bold tracking-widest text-amber-900/70 uppercase dark:text-amber-200/60';
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const TH =
  'sticky top-0 z-10 bg-gradient-to-b from-blue-800 to-indigo-800 px-3 py-2 text-left text-[12px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap dark:from-blue-900 dark:to-indigo-900';
const TD = 'border-r border-r-amber-200/80 px-3 py-2 align-middle text-[13px] dark:border-r-amber-400/15 last:border-r-0';
const NUM = 'text-right tabular-nums';
const PANEL = 'rounded-[4px] border border-amber-300 bg-card shadow-sm dark:border-amber-400/30';

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
    label: 'Ignored',
    cls: 'bg-slate-100 text-slate-600 ring-slate-300 dark:bg-white/10 dark:text-slate-300',
    hint: 'Left out of the reconciliation — not a customer receipt.',
  },
  POSTED: {
    label: 'Posted',
    cls: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300',
    hint: 'A receipt was created from this line.',
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
        'flex-1 rounded-[4px] border px-3 py-2',
        tone === 'good' && 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-400/40 dark:bg-emerald-500/10',
        tone === 'bad' && 'border-rose-300 bg-rose-50/70 dark:border-rose-400/40 dark:bg-rose-500/10',
        tone === 'warn' && 'border-amber-300 bg-amber-50/70 dark:border-amber-400/40 dark:bg-amber-400/10',
        !tone && 'bg-card',
      )}
      title={hint}
    >
      <p className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase">{label}</p>
      <p className="text-[17px] font-extrabold tabular-nums">{value}</p>
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
  /** The whole sheet, and which of its rows holds the column titles. */
  const [grid, setGrid] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);

  const { data: banks } = useActiveBankAccounts();
  const { data: preset } = useColumnPreset(bankName);
  const { data: customerList } = useCustomers({ page: 1, pageSize: 2000 });
  const customers = useMemo(
    () => (customerList?.items ?? []).map((c) => ({ id: c.id, name: (c.partyName ?? '').trim() })).filter((c) => c.name),
    [customerList],
  );

  /* ── The working ──────────────────────────────────────────────────────── */
  const [runId, setRunId] = useState<number | undefined>(undefined);
  const { data: runResult, isLoading: runLoading } = useBankRun(runId);
  const { data: runsList } = useBankRuns(1, 15);
  const createRun = useCreateBankRun();
  const assign = useAssignBankRows(runId);
  const ignore = useIgnoreBankRows(runId);
  const process = useProcessBankRun(runId);
  const delRun = useDeleteBankRun();

  const [selectedParty, setSelectedParty] = useState<number | undefined>(undefined);
  const { data: partyView } = useBankParty(runId, selectedParty);
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
      const { rows } = gridToRows(g, hdr);
      toast.success(
        `${rows.length.toLocaleString('en-IN')} rows read from ${file.name}` +
          (hdr > 0 ? ` — column titles found on line ${hdr + 1}` : ''),
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

  const loadStatement = () => {
    if (!sheetRows.length) return toast.error('Choose a statement file first.');
    if (!map.date || !map.narration || !map.credit) return toast.error('Map the Date, Narration and Credit columns.');
    if (!fromDate || !toDate) return toast.error('Choose the date range this statement covers.');
    // Every receipt Process creates is a BANK receipt and needs an account on it.
    if (!bankName) return toast.error('Choose which bank account this statement is for.');
    createRun.mutate(
      { fileName, bankName: bankName || null, fromDate, toDate, map, rows: sheetRows },
      {
        onSuccess: (res) => {
          setRunId(res.run.id);
          toast.success(`${res.run.rowCount} credit lines loaded — ${res.run.noPartyCount} need a party`);
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not load the statement'), { duration: 10000 }),
      },
    );
  };

  /* ── Review ───────────────────────────────────────────────────────────── */

  const rows = runResult?.rows ?? [];
  const shown = useMemo(
    () => (selectedParty ? rows.filter((r) => r.customerId === selectedParty) : rows),
    [rows, selectedParty],
  );
  const run = runResult?.run;
  const isDraft = run?.status === 'DRAFT';

  const toggleRow = (id: number) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const doAssign = (remember: boolean) => {
    const id = customers.find((c) => c.name === assignTo)?.id;
    if (!id) return toast.error('Pick a customer.');
    if (!checked.size) return toast.error('Tick the lines to assign.');
    assign.mutate(
      { rowIds: [...checked], customerId: id, rememberAlias: remember },
      {
        onSuccess: () => {
          toast.success(`${checked.size} line${checked.size === 1 ? '' : 's'} assigned to ${assignTo}${remember ? ' — narration remembered' : ''}`);
          setChecked(new Set());
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not assign')),
      },
    );
  };

  const doIgnore = (ignored: boolean) => {
    if (!checked.size) return toast.error('Tick the lines first.');
    ignore.mutate(
      { rowIds: [...checked], ignored },
      {
        onSuccess: () => {
          toast.success(`${checked.size} line${checked.size === 1 ? '' : 's'} ${ignored ? 'ignored' : 'restored'}`);
          setChecked(new Set());
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not update')),
      },
    );
  };

  const doProcess = async () => {
    if (!run) return;
    const n = run.unmatchedCount;
    const total = rows.filter((r) => r.status === 'UNMATCHED').reduce((s, r) => s + (r.amount - r.matchedAmount), 0);
    const ok = await confirm({
      title: `Post ${n} receipt${n === 1 ? '' : 's'} to the ledger?`,
      description:
        `${money0(total)} across ${n} line${n === 1 ? '' : 's'} the bank received but OMS has no receipt for. ` +
        `Each one is entered as an ordinary Receive Payment against its party${run.bankName ? ` in ${run.bankName}` : ''}, ` +
        `allocated to invoices the usual way. Matched lines are left alone. This cannot be undone from here.`,
      confirmText: `Post ${n} receipt${n === 1 ? '' : 's'}`,
    });
    if (!ok) return;
    process.mutate(undefined, {
      onSuccess: (res) => {
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
    <div className="flex h-full min-h-0 flex-col gap-3 p-2.5 font-sans sm:p-3">
      {/* ── Step 1 — the file, the range, the columns ─────────────────────── */}
      {!runId && (
        <section className={cn(PANEL, 'p-3')}>
          <div className="mb-3 flex items-center gap-2">
            <Landmark className="size-5 text-indigo-700 dark:text-indigo-300" />
            <div>
              <h2 className="text-[15px] font-extrabold tracking-tight">Reconcile a bank statement</h2>
              <p className="text-muted-foreground text-[12px]">
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
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                className={cn(CONTROL, 'w-full justify-start font-semibold')}
                onClick={() => fileRef.current?.click()}
                disabled={parsing}
              >
                {parsing ? <Loader2 className="animate-spin" /> : <FileSpreadsheet className="size-4" />}
                <span className="truncate">{fileName || 'Choose Excel / CSV…'}</span>
              </Button>
            </div>
            <div className="space-y-1">
              <Label className={FIELD_LABEL}>Received into *</Label>
              <NativeSelect
                value={bankName}
                onChange={setBankName}
                options={['', ...(banks ?? []).map((b) => b.bankName)]}
                className={CONTROL}
              />
            </div>
            <div className="space-y-1">
              <Label className={FIELD_LABEL}>From</Label>
              <DatePicker value={fromDate} onChange={setFromDate} className={CONTROL} />
            </div>
            <div className="space-y-1">
              <Label className={FIELD_LABEL}>To</Label>
              <DatePicker value={toDate} onChange={setToDate} className={CONTROL} />
            </div>
          </div>

          {/* Column mapping — asked once per bank, then remembered. */}
          {columns.length > 0 && (
            <div className="mt-3 rounded-[4px] border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-400/30 dark:bg-indigo-500/10">
              <p className="mb-2 text-[12px] font-bold text-indigo-900 dark:text-indigo-200">
                Which column is which?{' '}
                <span className="font-medium opacity-80">
                  {preset?.map ? 'Filled in from the last statement for this bank.' : 'Best guess from the headers — check it.'}
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
              {!!sheetRows.length && (
                <div className="mt-3 overflow-auto rounded-[4px] border bg-white dark:bg-slate-900">
                  <table className="w-full border-collapse text-[11.5px]">
                    <thead>
                      <tr>
                        {columns.map((c) => (
                          <th
                            key={c}
                            className={cn(
                              'border-b px-2 py-1 text-left font-bold whitespace-nowrap',
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
                      {sheetRows.slice(0, 5).map((r, i) => (
                        <tr key={i} className="odd:bg-slate-50/70 dark:odd:bg-white/[0.03]">
                          {columns.map((c) => (
                            <td key={c} className="max-w-[220px] truncate border-b px-2 py-1 tabular-nums whitespace-nowrap">
                              {r[c] ?? ''}
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
                  {sheetRows.length.toLocaleString('en-IN')} rows below the titles. Debits and anything outside the date range
                  are dropped when it loads.
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

          <div className="mt-3 flex justify-end">
            <Button onClick={loadStatement} disabled={createRun.isPending || !canEdit || !sheetRows.length}>
              {createRun.isPending ? <Loader2 className="animate-spin" /> : <Upload className="size-4" />} Load statement
            </Button>
          </div>
        </section>
      )}

      {/* ── Saved workings ───────────────────────────────────────────────── */}
      {!runId && !!runsList?.items.length && (
        <section className={cn(PANEL, 'p-3')}>
          <h3 className="mb-2 text-[13px] font-extrabold tracking-tight">Saved workings</h3>
          <div className="overflow-auto">
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
                      run?.unmatchedCount
                        ? `Create ${run.unmatchedCount} receipts in the ledger`
                        : 'Nothing to post — every line already matches a receipt, or has no party'
                    }
                    className="bg-emerald-600 font-bold text-white hover:bg-emerald-700"
                  >
                    {process.isPending ? <Loader2 className="animate-spin" /> : <ArrowRight className="size-4" />}
                    Process {run?.unmatchedCount ? `(${run.unmatchedCount})` : ''}
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Stat label="Credits in range" value={money0(run?.creditTotal ?? 0)} hint="Total money in, for the range." />
              <Stat label="Matched" value={String(run?.matchedCount ?? 0)} tone="good" hint={STATUS_META.MATCHED.hint} />
              <Stat label="In total" value={String(run?.partialCount ?? 0)} hint={STATUS_META.PARTIAL.hint} />
              <Stat label="No receipt" value={String(run?.unmatchedCount ?? 0)} tone="bad" hint={STATUS_META.UNMATCHED.hint} />
              <Stat label="No party" value={String(run?.noPartyCount ?? 0)} tone="warn" hint={STATUS_META.NO_PARTY.hint} />
              {!!run?.postedCount && <Stat label="Posted" value={String(run.postedCount)} hint={STATUS_META.POSTED.hint} />}
            </div>
          </section>

          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_360px]">
            {/* Lines */}
            <section className={cn(PANEL, 'flex min-h-0 flex-col')}>
              <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 p-2.5 dark:border-amber-400/20">
                <NativeSelect
                  value={selectedParty ? String(selectedParty) : ''}
                  onChange={(v) => setSelectedParty(v ? Number(v) : undefined)}
                  options={[
                    { value: '', label: `All lines (${rows.length})` },
                    ...(runResult?.parties ?? []).map((p) => ({
                      value: String(p.customerId),
                      label: `${p.customerName} — ${p.lines} line${p.lines === 1 ? '' : 's'}, ${money0(p.total)}`,
                    })),
                  ]}
                  className={cn(CONTROL, 'min-w-[260px] flex-1')}
                />
                {!!checked.size && isDraft && canEdit && (
                  <div className="flex flex-wrap items-center gap-2 rounded-[4px] bg-sky-50 px-2 py-1.5 ring-1 ring-sky-200 ring-inset dark:bg-sky-400/10 dark:ring-sky-400/25">
                    <span className="text-[12px] font-bold text-sky-800 dark:text-sky-200">{checked.size} selected</span>
                    <Combobox
                      value={assignTo}
                      onChange={setAssignTo}
                      options={customers.map((c) => ({ value: c.name, label: c.name }))}
                      placeholder="Assign to customer…"
                      className={cn(CONTROL, 'w-56')}
                    />
                    <Button size="sm" className="h-8" onClick={() => doAssign(false)} disabled={assign.isPending}>
                      <UserPlus className="size-3.5" /> Assign
                    </Button>
                    {/* Teaching the narration is what stops the same payer being
                        re-assigned by hand on every future statement. */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => doAssign(true)}
                      disabled={assign.isPending}
                      title="Assign, and recognise this narration as this party next time"
                    >
                      Assign & remember
                    </Button>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => doIgnore(true)} disabled={ignore.isPending}>
                      <Ban className="size-3.5" /> Ignore
                    </Button>
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={cn(TH, 'w-9')} aria-label="Select" />
                      <th className={cn(TH, 'w-24')}>Date</th>
                      <th className={TH}>Narration</th>
                      <th className={cn(TH, 'w-28 text-right')}>Credit</th>
                      <th className={cn(TH, 'w-48')}>Party</th>
                      <th className={cn(TH, 'w-28 text-center')}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runLoading ? (
                      <tr>
                        <td colSpan={6} className="text-muted-foreground py-10 text-center">
                          <Loader2 className="mx-auto size-5 animate-spin" />
                        </td>
                      </tr>
                    ) : shown.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-muted-foreground py-10 text-center text-[13px]">
                          No lines.
                        </td>
                      </tr>
                    ) : (
                      shown.map((r) => <LineRow key={r.id} row={r} checked={checked.has(r.id)} onToggle={() => toggleRow(r.id)} selectable={isDraft && canEdit} />)
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Before / after for the selected party */}
            <section className={cn(PANEL, 'min-h-0 overflow-auto p-3')}>
              {!selectedParty ? (
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

                  {/* The before / after the whole screen exists for. */}
                  <div className="grid grid-cols-2 gap-2">
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
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value, tone, strong, hint }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn'; strong?: boolean; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12.5px]" title={hint}>
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'tabular-nums',
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

function LineRow({ row, checked, onToggle, selectable }: { row: BankStatementRowDto; checked: boolean; onToggle: () => void; selectable: boolean }) {
  return (
    <tr
      className={cn(
        'border-b transition-colors',
        row.status === 'UNMATCHED' && 'bg-rose-50/60 dark:bg-rose-500/10',
        row.status === 'NO_PARTY' && 'bg-amber-50/70 dark:bg-amber-400/10',
        row.status === 'IGNORED' && 'opacity-55',
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
        {row.refNo && <span className="text-muted-foreground font-mono text-[11px]">{row.refNo}</span>}
      </td>
      <td className={cn(TD, NUM, 'font-bold')}>{money0(row.amount)}</td>
      <td className={TD}>
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
      </td>
      <td className={cn(TD, 'text-center')}>
        <StatusChip status={row.status} />
        {row.postedRef && <p className="text-muted-foreground mt-0.5 font-mono text-[10.5px]">{row.postedRef}</p>}
      </td>
    </tr>
  );
}

export default BankStatementPage;
