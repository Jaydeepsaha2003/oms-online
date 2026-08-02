import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCheck,
  CircleCheck,
  FileSpreadsheet,
  Link2,
  Loader2,
  Trash2,
  Upload,
  UserRoundX,
  X,
} from 'lucide-react';
import type { ReconRow, ReconStatus } from '@oms/shared';
import { RECON_PROBLEM_STATUSES } from '@oms/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { Combo, NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { usePartyLedgerLookups } from './use-party-ledger';
import {
  useCreateReconReceipts,
  useDeleteReconRun,
  useReconRun,
  useReconRuns,
  useSaveTallyAlias,
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

function StatusChip({ status }: { status: ReconStatus }) {
  const m = STATUS[status];
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

/* ── the page ─────────────────────────────────────────────────────────────── */

export function TallyReconPage() {
  const { can } = usePermissions();
  const canRun = can('tallyrecon:create');
  const canDelete = can('tallyrecon:delete');
  const canEnterReceipt = canRun && can('payment:create');

  const fileRef = useRef<HTMLInputElement>(null);
  const [runId, setRunId] = useState<number | null>(null);

  const [status, setStatus] = useState<ReconStatus | 'PROBLEMS' | ''>('PROBLEMS');
  const [vchType, setVchType] = useState('');
  const [party, setParty] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const [aliasFor, setAliasFor] = useState<string | null>(null);
  const [aliasCustomer, setAliasCustomer] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bankOverride, setBankOverride] = useState('');

  const { data: runs } = useReconRuns();
  // Default to the newest run so the page is never empty after a reload.
  const activeId = runId ?? runs?.[0]?.id ?? null;
  const { data: run, isFetching } = useReconRun(activeId);
  const { data: lookups } = usePartyLedgerLookups();

  // The reconciliation itself lives in the app shell so it survives navigating
  // away mid-run; this page just drives it and renders its progress inline.
  const recon = useTallyReconRun();
  const removeRun = useDeleteReconRun();
  const saveAlias = useSaveTallyAlias();
  const createReceipts = useCreateReconReceipts();

  const custByName = useMemo(() => new Map((lookups?.customers ?? []).map((c) => [c.name, c.id])), [lookups]);
  const customerOptions = useMemo(() => [...custByName.keys()].sort((a, b) => a.localeCompare(b)), [custByName]);

  const rows = run?.rows ?? [];
  const partyOptions = useMemo(() => [...new Set(rows.map((r) => r.ledgerName))].sort((a, b) => a.localeCompare(b)), [rows]);
  const vchOptions = useMemo(() => VCH_ORDER.filter((t) => rows.some((r) => r.vchType === t)), [rows]);

  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (status === 'PROBLEMS' && !RECON_PROBLEM_STATUSES.includes(r.status)) return false;
        if (status && status !== 'PROBLEMS' && r.status !== status) return false;
        if (vchType && r.vchType !== vchType) return false;
        if (party && r.ledgerName !== party) return false;
        return true;
      }),
    [rows, status, vchType, party],
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

  /** Rows the user can turn into a receipt with one click. */
  const entryable = useMemo(
    () => visible.filter((r) => r.vchType === 'RECEIPT' && r.status === 'MISSING_IN_OMS' && !r.resolvedAt && r.customerId),
    [visible],
  );
  const entryableIds = useMemo(() => new Set(entryable.map((r) => r.id)), [entryable]);
  const pickedRows = useMemo(() => entryable.filter((r) => picked.has(r.id)), [entryable, picked]);
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
    setPicked((prev) => (entryable.every((r) => prev.has(r.id)) ? new Set() : new Set(entryable.map((r) => r.id))));

  /* ── actions ────────────────────────────────────────────────────────────── */

  const onPickFile = () => fileRef.current?.click();

  const onFile = (file: File | undefined) => {
    if (!file) return;
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
    setVchType('');
    setParty('');
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
    const customerId = custByName.get(aliasCustomer);
    if (!aliasFor || !customerId) return;
    try {
      await saveAlias.mutateAsync({ tallyName: aliasFor, customerId });
      toast.success(`"${aliasFor}" now maps to ${aliasCustomer}. Upload the register again to re-check it.`);
      setAliasFor(null);
      setAliasCustomer('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that mapping.');
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
  const hasFilters = !!vchType || !!party || status !== 'PROBLEMS';

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
            <Label className="sr-only" htmlFor="recon-party">
              Party
            </Label>
            <NativeSelect
              id="recon-party"
              value={party}
              onChange={setParty}
              options={['', ...partyOptions]}
              placeholder="Party"
              className={cn(CONTROL, 'font-medium', party && CONTROL_ON)}
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

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 rounded-[4px] text-[12.5px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-400/10"
              onClick={() => {
                setStatus('PROBLEMS');
                setVchType('');
                setParty('');
              }}
            >
              <X className="size-3.5" /> Reset
            </Button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {run && (
              <p className="text-muted-foreground hidden text-[12px] font-medium lg:block">
                <span className="text-foreground font-bold tabular-nums">{inr(visible.length)}</span> row{visible.length === 1 ? '' : 's'}
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
              label={STATUS.UNMATCHED_PARTY.label}
              blurb={`${run.unmatchedLedgers.length} ledger${run.unmatchedLedgers.length === 1 ? '' : 's'}`}
              value={run.unmatchedParty}
              tone={STATUS.UNMATCHED_PARTY.chip}
              active={status === 'UNMATCHED_PARTY'}
              onClick={() => setStatus(status === 'UNMATCHED_PARTY' ? '' : 'UNMATCHED_PARTY')}
            />
          </div>
        )}

        {/* ── unmapped ledgers: pin them to a customer, then re-run ────────── */}
        {run && run.unmatchedLedgers.length > 0 && canRun && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-amber-200 px-2.5 py-2 sm:px-3 dark:border-amber-400/20">
            <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-violet-800 uppercase dark:text-violet-300">
              <UserRoundX className="size-3.5" /> Unmapped ledgers
            </span>
            {run.unmatchedLedgers.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setAliasFor(name);
                  setAliasCustomer('');
                }}
                className="cursor-pointer rounded-[3px] border border-violet-300 bg-violet-50 px-1.5 py-[2px] text-[11px] font-semibold text-violet-800 hover:bg-violet-100 dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-300 dark:hover:bg-violet-400/20"
              >
                <Link2 className="mr-1 inline size-3 align-[-2px]" />
                {name}
              </button>
            ))}
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
          <span className="truncate text-[12px] font-extrabold tracking-wide text-amber-300 uppercase">
            Tally Reconciliation{run ? ` — ${run.fileName}` : ''}
          </span>
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
                      {canEnterReceipt && entryable.length > 0 ? (
                        <button
                          type="button"
                          onClick={toggleAll}
                          title="Select every missing receipt shown"
                          className="cursor-pointer align-middle text-amber-300 hover:text-white"
                        >
                          <CheckCheck className="size-3.5" />
                        </button>
                      ) : (
                        <span className="sr-only">Enter</span>
                      )}
                    </th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-24')}>Date</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-32')}>Vch Type</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-28')}>Vch No</th>
                    <th scope="col" className={cn(TH, TH_LINE)}>Particulars</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-28 text-right')}>Debit</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-28 text-right')}>Credit</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-32')}>Status</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-28')}>OMS Ref</th>
                    <th scope="col" className={cn(TH, TH_LINE, 'w-28 text-right')}>OMS Amt</th>
                    <th scope="col" className={cn(TH, 'min-w-[16rem]')}>Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {isFetching && !blocks.length ? (
                    <tr>
                      <td colSpan={11} className="text-muted-foreground h-24 text-center">
                        <Loader2 className="mx-auto size-5 animate-spin" />
                      </td>
                    </tr>
                  ) : !blocks.length ? (
                    <tr>
                      <td colSpan={11} className="text-muted-foreground h-24 text-center text-[13px] font-medium">
                        {status === 'PROBLEMS'
                          ? 'Nothing needs attention — every register entry agrees with OMS.'
                          : 'No rows for these filters.'}
                      </td>
                    </tr>
                  ) : (
                    blocks.map(([ledgerName, list]) => (
                      <Fragment key={ledgerName}>
                        <tr className="bg-amber-100/90 dark:bg-amber-400/10">
                          <td className={TD} />
                          <td className={cn(TD, 'text-[12px] font-extrabold tracking-wide text-amber-950 uppercase dark:text-amber-100')} colSpan={6}>
                            {ledgerName}
                            {list[0].customerName && list[0].customerName !== ledgerName && (
                              <span className="ml-1.5 font-semibold normal-case opacity-70">→ {list[0].customerName}</span>
                            )}
                          </td>
                          <td className={cn(TD, 'text-[11px] font-bold text-amber-900 dark:text-amber-200')} colSpan={4}>
                            {list.length} row{list.length === 1 ? '' : 's'}
                          </td>
                        </tr>
                        {list.map((r) => {
                          const tickable = canEnterReceipt && isEntryable(r);
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
                                {tickable ? (
                                  <button
                                    type="button"
                                    onClick={() => toggle(r.id)}
                                    aria-pressed={on}
                                    title={`Enter this ${inr(r.cr || r.dr)} receipt in OMS`}
                                    className={cn(
                                      'cursor-pointer align-middle transition-colors',
                                      on ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-300',
                                    )}
                                  >
                                    <CircleCheck className={cn('size-4', on && 'fill-emerald-200 dark:fill-emerald-900')} />
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
                              <td className={cn(TD, 'text-[12.5px] font-semibold whitespace-nowrap')}>{r.omsRef || '-'}</td>
                              <td className={cn(TD, NUM, 'font-semibold')}>{moneyOrDash(r.omsAmount)}</td>
                              <td className={cn(TD, 'text-muted-foreground text-[11.5px] font-medium')}>{r.note || ''}</td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))
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
                blocks.map(([ledgerName, list]) => (
                  <div key={ledgerName} className="bg-card overflow-hidden rounded-[4px] border border-amber-200 shadow-sm dark:border-amber-400/20">
                    <div className="bg-slate-800 px-3 py-1.5 text-[11.5px] font-bold tracking-wide text-amber-300 uppercase dark:bg-slate-900">
                      {ledgerName}
                    </div>
                    <div className="divide-y divide-amber-200/70 dark:divide-amber-400/10">
                      {list.map((r) => {
                        const tickable = canEnterReceipt && isEntryable(r);
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
                              {tickable && (
                                <button
                                  type="button"
                                  onClick={() => toggle(r.id)}
                                  aria-pressed={on}
                                  className={cn('shrink-0 cursor-pointer', on ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400')}
                                >
                                  <CircleCheck className={cn('size-5', on && 'fill-emerald-200 dark:fill-emerald-900')} />
                                </button>
                              )}
                            </div>
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              <StatusChip status={r.status} />
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
            </div>
          </>
        )}

        {/* ── quick receipt entry bar ──────────────────────────────────────── */}
        {canEnterReceipt && pickedRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t-2 border-emerald-500 bg-emerald-50 px-2.5 py-2 sm:px-3 dark:border-emerald-400/60 dark:bg-emerald-400/10">
            <span className="text-[12.5px] font-bold text-emerald-900 dark:text-emerald-200">
              {pickedRows.length} receipt{pickedRows.length === 1 ? '' : 's'} selected ·{' '}
              <span className="tabular-nums">{inr(pickedTotal)}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-[4px] text-[12px] font-semibold"
              onClick={() => setPicked(new Set())}
            >
              Clear
            </Button>
            <Button
              className="ml-auto h-8 gap-1.5 rounded-[4px] bg-emerald-700 text-[12.5px] font-bold text-white hover:bg-emerald-800"
              onClick={() => setConfirmOpen(true)}
            >
              <CircleCheck className="size-3.5" /> Enter receipts in OMS
            </Button>
          </div>
        )}
      </div>

      {/* ── alias dialog ──────────────────────────────────────────────────── */}
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
                <Combo value={aliasCustomer} onChange={setAliasCustomer} options={customerOptions} placeholder="Pick a customer" className={CONTROL} />
              </div>
            </div>
            <p className="text-muted-foreground text-[11.5px] font-medium">
              The mapping is remembered for future uploads. Upload the register again to reconcile this party's entries.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-9 rounded-[4px] text-[12.5px] font-semibold" onClick={() => setAliasFor(null)}>
              Cancel
            </Button>
            <Button
              className="h-9 rounded-[4px] text-[12.5px] font-bold"
              onClick={() => void onSaveAlias()}
              disabled={!aliasCustomer || saveAlias.isPending}
            >
              {saveAlias.isPending && <Loader2 className="size-3.5 animate-spin" />} Save mapping
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
