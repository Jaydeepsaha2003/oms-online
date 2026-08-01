import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarRange,
  Eye,
  FileSpreadsheet,
  Loader2,
  Printer,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { LedgerBalanceRow, LedgerReceiptLine, PartyLedgerQuery, PartyLedgerRow, PartyListStanding } from '@oms/shared';
import { downloadFile, getApiErrorMessage } from '@/lib/api';
import { openPdf } from '@/lib/pdf';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { DateRangeCalendar } from '@/components/common/date-range-calendar';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchLedgerReceipts, usePartyLedger, usePartyLedgerLookups } from './use-party-ledger';

const inr = (v: number) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
/** Tally leaves a zero cell blank rather than printing 0. */
const money = (v: number) => (v ? inr(v) : '');
// Delegates to the shared formatter so this page follows the system-wide date format.
const prettyDate = (iso: string | null) => formatDate(iso);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Compact, amber-bordered filter controls — the same language as every other list page. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON =
  'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

/* ── Tally palette ──────────────────────────────────────────────────────────
   Tally puts amber chrome around a plain white data grid, with dark navy bars
   for the document header — so the ledger below follows that, rather than the
   blue-gradient headers the rest of the app's list screens use. */

/** Header cell: sticky, amber band, near-black type — Tally's column strip. */
const TH =
  'sticky bg-gradient-to-b from-amber-300 to-amber-400 px-2 text-[11px] font-extrabold tracking-wide text-amber-950 uppercase whitespace-nowrap dark:from-amber-500 dark:to-amber-600';
/** The Bank / Cash banner sits a shade deeper so the two tiers read apart. */
const TH_GROUP =
  'sticky bg-gradient-to-b from-amber-400 to-amber-500 px-2 text-[11px] font-extrabold tracking-wide text-amber-950 uppercase whitespace-nowrap dark:from-amber-600 dark:to-amber-700';
/** Rule between header cells — amber-on-amber, not white. */
const TH_LINE = 'border-r border-amber-600/30 dark:border-amber-900/30';
/** Body cell: full grid lines, tight rows. The colour is scoped to the right edge
 *  so a row's own top/bottom rule (the totals band) isn't overridden by it. */
const TD = 'border-r border-r-amber-200/80 px-2 py-[3px] align-middle dark:border-r-amber-400/15 last:border-r-0';
const NUM = 'text-right tabular-nums';
/** The panel that frames the whole worksheet. */
const PANEL = 'border-amber-300 dark:border-amber-400/30';

const FY_START_MONTH = 3; // April (0-based)
function fyStart(d: Date): Date {
  const y = d.getMonth() >= FY_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(y, FY_START_MONTH, 1);
}
const RANGE_PRESETS = ['This Year', 'Last Year', 'This Quarter', 'Last Quarter', 'This Month', 'Last Month', 'Yesterday', 'Today'] as const;
type Preset = (typeof RANGE_PRESETS)[number];

function presetRange(p: Preset): { from: Date; to: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fys = fyStart(today);
  const monthsSince = (today.getFullYear() - fys.getFullYear()) * 12 + (today.getMonth() - fys.getMonth());
  const qIdx = Math.max(0, Math.floor(monthsSince / 3));
  const qStart = new Date(fys.getFullYear(), fys.getMonth() + qIdx * 3, 1);
  switch (p) {
    case 'Today':
      return { from: today, to: today };
    case 'Yesterday': {
      const y = new Date(today.getTime() - 86400000);
      return { from: y, to: y };
    }
    case 'This Month':
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: today };
    case 'Last Month':
      return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 0) };
    case 'This Quarter':
      return { from: qStart, to: today };
    case 'Last Quarter':
      return { from: new Date(qStart.getFullYear(), qStart.getMonth() - 3, 1), to: new Date(qStart.getTime() - 86400000) };
    case 'Last Year':
      return { from: new Date(fys.getFullYear() - 1, FY_START_MONTH, 1), to: new Date(fys.getTime() - 86400000) };
    case 'This Year':
    default:
      return { from: fys, to: today };
  }
}

/** One money leg — Bank and Cash render through the same code path. */
interface Leg {
  group: 'Bank' | 'Cash';
  dr: 'bankDr' | 'cashDr';
  cr: 'bankCr' | 'cashCr';
  /** Signed opening net for this leg, used to seed the running balance. */
  openNet: (f: { openingBankNet: number; openingCashNet: number }) => number;
}
const BANK_LEG: Leg = { group: 'Bank', dr: 'bankDr', cr: 'bankCr', openNet: (f) => f.openingBankNet };
const CASH_LEG: Leg = { group: 'Cash', dr: 'cashDr', cr: 'cashCr', openNet: (f) => f.openingCashNet };
const legsFor = (mode: string): Leg[] => (mode === 'B' ? [BANK_LEG] : mode === 'C' ? [CASH_LEG] : [BANK_LEG, CASH_LEG]);

/** A signed balance rendered the Tally way: magnitude followed by Dr or Cr. */
function Balance({ net, className }: { net: number; className?: string }) {
  if (!net) return <span className="text-muted-foreground/50">—</span>;
  const cr = net < 0;
  return (
    <span className={cn('tabular-nums font-bold', cr ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-100', className)}>
      {inr(Math.abs(net))}
      <span className="ml-1 text-[10px] font-bold opacity-70">{cr ? 'Cr' : 'Dr'}</span>
    </span>
  );
}

export function PartyLedgerPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { data: lookups } = usePartyLedgerLookups();

  const [party, setParty] = useState('');
  const [agent, setAgent] = useState('');
  const [from, setFrom] = useState(() => ymd(fyStart(new Date())));
  const [to, setTo] = useState(() => ymd(new Date()));
  const [mode, setMode] = useState<'BOTH' | 'B' | 'C'>('BOTH');
  const [voucherType, setVoucherType] = useState('');
  const [receiptFor, setReceiptFor] = useState<PartyLedgerRow | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [preset, setPreset] = useState('');

  const custByName = useMemo(() => new Map((lookups?.customers ?? []).map((c) => [c.name, c.id])), [lookups]);
  const partyOptions = useMemo(() => (lookups?.customers ?? []).map((c) => c.name), [lookups]);
  const agentOptions = useMemo(() => ['All', ...(lookups?.agents ?? [])], [lookups]);

  const query = useMemo<PartyLedgerQuery>(() => ({
    customerId: party ? custByName.get(party) : undefined,
    agentName: !party && agent && agent !== 'All' ? agent : undefined,
    from,
    to,
    mode,
    voucherType: voucherType || undefined,
  }), [party, agent, from, to, mode, voucherType, custByName]);

  const { data, isFetching } = usePartyLedger(query);
  const rows = data?.rows ?? [];
  const footer = data?.footer;
  const kpis = data?.kpis;

  const onReset = () => {
    setParty('');
    setAgent('');
    setMode('BOTH');
    setVoucherType('');
    setPreset('');
    setFrom(ymd(fyStart(new Date())));
    setTo(ymd(new Date()));
  };
  const applyPreset = (p: Preset) => {
    const { from: f, to: t } = presetRange(p);
    setFrom(ymd(f));
    setTo(ymd(t));
    setPreset(p);
  };

  const exportUrl = (fmt: 'pdf' | 'xlsx') => {
    const q = query;
    const params = new URLSearchParams();
    if (q.customerId) params.set('customerId', String(q.customerId));
    if (q.agentName) params.set('agentName', q.agentName);
    params.set('from', q.from);
    params.set('to', q.to);
    if (q.mode) params.set('mode', q.mode);
    if (q.voucherType) params.set('voucherType', q.voucherType);
    return `/party-ledger/export.${fmt}?${params.toString()}`;
  };
  const [pdfLoading, setPdfLoading] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const onPdf = async () => {
    setPdfLoading(true);
    try {
      await openPdf(exportUrl('pdf'), `${(data?.customerName || data?.agentName || 'party-ledger').replace(/[\\/:*?"<>|]/g, '-')}.pdf`);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'PDF failed'));
    } finally {
      setPdfLoading(false);
    }
  };
  const onExcel = async () => {
    setExcelLoading(true);
    try {
      await downloadFile(exportUrl('xlsx'), `${(data?.customerName || data?.agentName || 'party-ledger').replace(/[\\/:*?"<>|]/g, '-')}.xlsx`);
      toast.success('Excel ledger downloaded');
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Export failed'));
    } finally {
      setExcelLoading(false);
    }
  };

  const isInvoiceRow = (r: PartyLedgerRow) => {
    const vt = r.voucherType.toUpperCase();
    return vt === 'SALES INVOICE' || vt === 'DEBIT NOTE';
  };

  // Both desktop and mobile navigate to the in-app Challan bill page
  // (matches the Sales Order / Quotation "Print / PDF" pattern).
  const canViewChallan = can('challan:print');
  const viewChallan = (r: PartyLedgerRow) => {
    if (!r.challanId) return;
    navigate(`/challans/${r.challanId}/bill`);
  };

  const legs = legsFor(mode);
  const grouped = legs.length === 2;

  /* Running balance, Tally's defining column. Seeded from the opening net of the
     legs on screen and walked forward in the server's chronological order, so the
     last row lands exactly on the Closing Balance the footer reports. */
  const openingNet = footer ? legs.reduce((sum, l) => sum + l.openNet(footer), 0) : 0;
  const running = useMemo(() => {
    let bal = openingNet;
    return rows.map((r) => {
      bal += legs.reduce((sum, l) => sum + r[l.dr] - r[l.cr], 0);
      return bal;
    });
  }, [rows, openingNet, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Opening / Current / Closing share one row shape across the grid. */
  const balanceCells = (b: LedgerBalanceRow) => legs.flatMap((l) => [b[l.dr], b[l.cr]]);
  /** Text columns before the figures: Date, Particulars, Vch Type, Vch No, St, Due From. */
  const LEAD_COLS = 6;
  const totalCols = LEAD_COLS + legs.length * 2 + 1 + (canViewChallan ? 1 : 0);

  const dateLabel = preset || `${prettyDate(from)} → ${prettyDate(to)}`;
  const scopeLabel = data
    ? data.scope === 'CUSTOMER'
      ? data.customerName
      : data.scope === 'AGENT'
        ? `Agent: ${data.agentName}`
        : 'All parties'
    : '';

  /* ── Filter controls, shared by the bar ── */
  const datePanel = (
    <div className="w-[15.5rem] space-y-2">
      <div className="grid grid-cols-2 gap-1">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => applyPreset(p)}
            aria-pressed={preset === p}
            className={cn(
              'cursor-pointer rounded-[3px] border px-2 py-1 text-[11.5px] font-semibold transition-colors',
              preset === p
                ? 'border-amber-500 bg-amber-100 text-amber-900 dark:border-amber-400/60 dark:bg-amber-400/15 dark:text-amber-200'
                : 'hover:bg-accent border-transparent',
            )}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="border-t pt-2">
        <DateRangeCalendar
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f);
            if (t) setTo(t);
            setPreset('');
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <span className="min-w-0 truncate text-[11.5px] font-semibold">
          {prettyDate(from)} <span className="text-muted-foreground">→</span> {prettyDate(to)}
        </span>
        <Button size="sm" className="h-7 shrink-0 px-3 text-[12px] font-semibold" onClick={() => setDateOpen(false)}>
          Done
        </Button>
      </div>
    </div>
  );

  return (
    // Fills the viewport exactly: filters + KPIs pinned on top, the ledger the only
    // scrolling region, and the Closing Balance stuck to the bottom of the grid.
    // `/account/party-ledger` is a flush route (see app-shell) so the page owns its
    // own padding.
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5 font-sans sm:gap-2.5 sm:p-3">
      {/* ── Filter bar ─────────────────────────────────────────────────────────
          Poppins, so the controls read as chrome and stay distinct from the
          figures in the ledger below. */}
      <div className={cn('bg-card font-poppins rounded-[4px] border shadow-sm', PANEL)}>
        <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-2.5 sm:p-3">
          <FitSelect
            label="Customer"
            value={party}
            onChange={(v) => {
              setParty(v);
              if (v) setAgent('');
            }}
            options={partyOptions}
            className="w-full sm:w-52"
          />
          <FitSelect
            label="Agent"
            value={agent === 'All' ? '' : agent}
            onChange={(v) => {
              setAgent(v);
              if (v) setParty('');
            }}
            options={agentOptions.filter((a) => a !== 'All')}
            className="w-full sm:w-40"
          />

          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(CONTROL, 'w-full max-w-full justify-start font-medium sm:w-auto sm:max-w-56', CONTROL_ON)}
                title="Statement period"
              >
                <CalendarRange className="size-3.5 shrink-0" />
                <span className="truncate">{dateLabel}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
              {datePanel}
            </PopoverContent>
          </Popover>

          <FitSelect
            label="Voucher type"
            value={voucherType}
            onChange={setVoucherType}
            options={data?.voucherTypes ?? []}
            className="w-full sm:w-40"
          />

          {/* Bank / Cash / Both — the ledger's column groups follow this. */}
          <div
            role="group"
            aria-label="Transaction mode"
            className="inline-flex items-center gap-0.5 rounded-[4px] border border-amber-300 bg-amber-50/40 p-0.5 dark:border-amber-400/40 dark:bg-transparent"
          >
            {(['BOTH', 'B', 'C'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cn(
                  'cursor-pointer rounded-[3px] px-2.5 py-1 text-[12px] font-semibold transition-colors duration-150',
                  mode === m
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-200/70 dark:hover:bg-amber-400/10',
                )}
              >
                {m === 'BOTH' ? 'Both' : m === 'B' ? 'Bank' : 'Cash'}
              </button>
            ))}
          </div>

          <Button variant="outline" className="h-9 rounded-[4px] text-[12.5px] font-semibold" onClick={onReset}>
            <X /> Reset
          </Button>

          <div className="ml-auto flex items-center gap-2">
            {data && (
              <p className="text-muted-foreground hidden text-[12px] font-medium lg:block">
                <span className="text-foreground font-bold">{scopeLabel}</span> ·{' '}
                <span className="text-foreground font-bold tabular-nums">{rows.length}</span> entr{rows.length === 1 ? 'y' : 'ies'}
                {isFetching && <Loader2 className="ml-1 inline size-3 animate-spin align-[-2px]" />}
              </p>
            )}
            {can('partyledger:print') && (
              <Button
                variant="outline"
                className="h-9 rounded-[4px] text-[12.5px] font-semibold"
                onClick={onPdf}
                disabled={!rows.length || pdfLoading}
                title="Tally-style black & white statement"
              >
                {pdfLoading ? <Loader2 className="animate-spin" /> : <Printer />} PDF
              </Button>
            )}
            {can('partyledger:export') && (
              <Button
                variant="outline"
                className="h-9 rounded-[4px] text-[12.5px] font-semibold"
                onClick={onExcel}
                disabled={!rows.length || excelLoading}
              >
                {excelLoading ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Excel
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Ageing rail ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Inv Due From" value={kpis?.invDueFrom ?? '—'} />
        <Kpi
          label="Payment DNA"
          value={kpis?.paymentDNA ?? '—'}
          tone={dnaTone(kpis?.paymentDNAKind)}
          dot={kpis?.paymentDNAKind}
        />
        <Kpi label="Over Due" value={kpis ? inr(kpis.overDue.amount) : '—'} note={kpis ? `${kpis.overDue.count} inv` : undefined} tone="rose" />
        <Kpi label="Past Due" value={kpis ? inr(kpis.pastDue.amount) : '—'} note={kpis ? `${kpis.pastDue.count} inv` : undefined} tone="amber" />
        <Kpi label="Normal Due" value={kpis ? inr(kpis.normal.amount) : '—'} note={kpis ? `${kpis.normal.count} inv` : undefined} tone="emerald" />
      </div>

      {/* ── The ledger ──────────────────────────────────────────────────────── */}
      <div className={cn('bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[4px] border shadow-sm', PANEL)}>
        {/* Document header — Tally captions every ledger with the account and the
            period it covers, on a dark bar above the amber column strip. */}
        <div className="flex items-center justify-between gap-3 bg-slate-800 px-2.5 py-1 dark:bg-slate-900">
          <span className="truncate text-[12px] font-extrabold tracking-wide text-amber-300 uppercase">
            {scopeLabel || 'Ledger Account'}
          </span>
          {/* Phones give the account name the full bar — the Date control above
              already states the period. */}
          <span className="hidden shrink-0 text-[11px] font-bold tracking-wide text-amber-100/70 tabular-nums sm:inline">
            {prettyDate(from)} — {prettyDate(to)} · {mode === 'BOTH' ? 'Bank & Cash' : mode === 'B' ? 'Bank' : 'Cash'}
          </span>
        </div>

        {/* Desktop: the Tally grid. Only this region scrolls; the heading rows stay
            pinned at the top and the Closing Balance at the bottom. */}
        <div
          className={cn(
            'hidden min-h-0 flex-1 overflow-auto overscroll-x-contain sm:block',
            '[scrollbar-width:thin] [scrollbar-color:var(--color-amber-400)_var(--color-amber-100)]',
          )}
        >
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">
              Party ledger for {scopeLabel} from {prettyDate(from)} to {prettyDate(to)}
            </caption>
            <thead className="z-30">
              {grouped && (
                <tr>
                  <th className={cn(TH_GROUP, TH_LINE, 'top-0 h-7')} colSpan={LEAD_COLS} />
                  {legs.map((l) => (
                    <th key={l.group} className={cn(TH_GROUP, TH_LINE, 'top-0 h-7 text-center')} colSpan={2} scope="colgroup">
                      {l.group}
                    </th>
                  ))}
                  <th className={cn(TH_GROUP, 'top-0 h-7')} colSpan={1 + (canViewChallan ? 1 : 0)} />
                </tr>
              )}
              <tr>
                {['Date', 'Particulars', 'Vch Type', 'Vch No'].map((h) => (
                  <th key={h} scope="col" className={cn(TH, TH_LINE, grouped ? 'top-7' : 'top-0', 'py-1.5 text-left')}>
                    {h}
                  </th>
                ))}
                {/* Settlement state (P/D/F) then the ageing, both sitting right after
                    the voucher number where they're read together. */}
                <th
                  scope="col"
                  title="Settlement: F = fully paid, P = partially paid, D = due"
                  className={cn(TH, TH_LINE, grouped ? 'top-7' : 'top-0', 'w-8 py-1.5 text-center')}
                >
                  St
                </th>
                <th scope="col" className={cn(TH, TH_LINE, grouped ? 'top-7' : 'top-0', 'py-1.5 text-left')}>
                  Due From
                </th>
                {legs.flatMap((l) => (
                  ['Debit', 'Credit'].map((side) => (
                    <th
                      key={`${l.group}-${side}`}
                      scope="col"
                      className={cn(TH, TH_LINE, grouped ? 'top-7' : 'top-0', 'py-1.5 text-right')}
                    >
                      {grouped ? side : `${l.group} ${side}`}
                    </th>
                  ))
                ))}
                <th scope="col" className={cn(TH, TH_LINE, grouped ? 'top-7' : 'top-0', 'py-1.5 text-right')}>
                  Balance
                </th>
                {canViewChallan && <th scope="col" className={cn(TH, grouped ? 'top-7' : 'top-0', 'w-10 py-1.5')} aria-label="View" />}
              </tr>
            </thead>

            <tbody>
              {/* Opening balance opens the statement, exactly as Tally prints it. */}
              {footer && (
                <tr className="bg-amber-100/80 font-bold dark:bg-amber-400/10">
                  <td className={TD} />
                  <td className={cn(TD, 'text-[13px] font-bold text-amber-950 dark:text-amber-100')}>Opening Balance</td>
                  <td className={TD} />
                  <td className={TD} />
                  <td className={TD} />
                  <td className={TD} />
                  {balanceCells(footer.opening).map((v, i) => (
                    <td key={i} className={cn(TD, NUM, 'font-bold')}>
                      {money(v)}
                    </td>
                  ))}
                  <td className={cn(TD, NUM)}>
                    <Balance net={openingNet} />
                  </td>
                  {canViewChallan && <td className={TD} />}
                </tr>
              )}

              {isFetching && !data ? (
                <tr>
                  <td colSpan={totalCols} className="text-muted-foreground h-24 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={totalCols} className="text-muted-foreground h-24 text-center text-[13px] font-medium">
                    No ledger entries for these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => {
                  const invoice = isInvoiceRow(r);
                  return (
                    <tr
                      key={`${r.voucherNo}-${r.txnDate}-${i}`}
                      // Invoice rows open their receipts; keyboard users get the same
                      // affordance via Enter / Space on the focused row.
                      tabIndex={invoice ? 0 : undefined}
                      role={invoice ? 'button' : undefined}
                      aria-label={invoice ? `Receipts against ${r.voucherNo}` : undefined}
                      onClick={invoice ? () => setReceiptFor(r) : undefined}
                      onKeyDown={
                        invoice
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setReceiptFor(r);
                              }
                            }
                          : undefined
                      }
                      className={cn(
                        'border-b border-amber-200/70 outline-none dark:border-amber-400/10',
                        'even:bg-amber-50/70 dark:even:bg-amber-400/[0.05]',
                        // Tally moves a solid amber selection bar down the ledger.
                        'hover:bg-amber-200/80 dark:hover:bg-amber-400/20',
                        'focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-inset',
                        invoice && 'group cursor-pointer',
                      )}
                    >
                      <td className={cn(TD, 'whitespace-nowrap tabular-nums font-semibold text-slate-700 dark:text-slate-300')}>
                        {prettyDate(r.txnDate)}
                      </td>
                      <td className={cn(TD, 'font-semibold text-slate-800 dark:text-slate-200')}>{r.particulars}</td>
                      <td className={cn(TD, 'whitespace-nowrap text-[12px] font-medium text-slate-600 dark:text-slate-400')}>{r.voucherType}</td>
                      <td className={cn(TD, 'whitespace-nowrap text-[12.5px] font-semibold', invoice && 'font-bold text-amber-900 underline-offset-2 group-hover:underline dark:text-amber-300')}>
                        {r.voucherNo}
                      </td>
                      <td className={cn(TD, 'text-center')}>
                        <StatusChip status={r.status} />
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap')}>
                        <DueFrom text={r.dueFrom} />
                      </td>
                      {legs.flatMap((l) => [
                        <td key={`${l.group}-dr`} className={cn(TD, NUM, 'font-semibold text-slate-900 dark:text-slate-100')}>
                          {money(r[l.dr])}
                        </td>,
                        <td key={`${l.group}-cr`} className={cn(TD, NUM, 'font-semibold text-emerald-700 dark:text-emerald-400')}>
                          {money(r[l.cr])}
                        </td>,
                      ])}
                      <td className={cn(TD, NUM)}>
                        <Balance net={running[i]} />
                      </td>
                      {canViewChallan && (
                        <td className={cn(TD, 'text-center')} onClick={(e) => e.stopPropagation()}>
                          {invoice && r.challanId ? (
                            <button
                              type="button"
                              onClick={() => viewChallan(r)}
                              className="text-muted-foreground hover:text-primary hover:bg-muted inline-flex size-6 items-center justify-center rounded transition-colors"
                              title="View challan"
                              aria-label={`View challan ${r.voucherNo}`}
                            >
                              <Eye className="size-3.5" />
                            </button>
                          ) : null}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Current total + closing balance ride at the foot of the grid and stay
                visible while the body scrolls — Tally always shows you the closing. */}
            {footer && (
              <tfoot className="sticky bottom-0 z-20">
                <FootRow label="Current Total" cells={balanceCells(footer.current)} lead={LEAD_COLS} trailing={canViewChallan} />
                <FootRow
                  label="Closing Balance"
                  cells={balanceCells(footer.closing)}
                  lead={LEAD_COLS}
                  trailing={canViewChallan}
                  strong
                  balance={footer.closingBankNet * (mode === 'C' ? 0 : 1) + footer.closingCashNet * (mode === 'B' ? 0 : 1)}
                />
              </tfoot>
            )}
          </table>
        </div>

        {/* Phones: one card per voucher — the grid is unusable at this width. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:hidden">
          {footer && (
            <div className="mb-2 flex items-center justify-between rounded-[4px] border border-amber-300 bg-amber-100/80 px-3 py-2 dark:border-amber-400/30 dark:bg-amber-400/10">
              <span className="text-[12px] font-bold uppercase tracking-wide text-amber-950 dark:text-amber-100">Opening Balance</span>
              <Balance net={openingNet} className="text-[14px]" />
            </div>
          )}
          {isFetching && !data ? (
            <div className="text-muted-foreground flex h-24 items-center justify-center">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground px-4 py-10 text-center text-[13px] font-medium">No ledger entries for these filters.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((r, i) => {
                const invoice = isInvoiceRow(r);
                return (
                  <div
                    key={`${r.voucherNo}-${r.txnDate}-${i}`}
                    role={invoice ? 'button' : undefined}
                    tabIndex={invoice ? 0 : undefined}
                    onClick={invoice ? () => setReceiptFor(r) : undefined}
                    onKeyDown={
                      invoice
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setReceiptFor(r);
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      'bg-card rounded-[4px] border border-amber-200 p-2.5 shadow-sm dark:border-amber-400/20',
                      invoice && 'cursor-pointer active:bg-amber-100/70 dark:active:bg-amber-400/15',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] leading-tight font-bold text-slate-900 dark:text-slate-100">{r.particulars}</p>
                        <p className="text-muted-foreground mt-0.5 text-[11.5px] font-medium">
                          {r.voucherType} · <span className="font-semibold">{r.voucherNo}</span>
                        </p>
                      </div>
                      <span className="text-muted-foreground shrink-0 text-[11px] font-semibold tabular-nums">{prettyDate(r.txnDate)}</span>
                    </div>
                    {(r.status || r.dueFrom) && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <StatusChip status={r.status} />
                        <DueFrom text={r.dueFrom} />
                      </div>
                    )}
                    <div className="mt-2 flex items-end justify-between gap-2 border-t pt-2">
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]">
                        {legs.flatMap((l) => [
                          r[l.dr] ? (
                            <span key={`${l.group}-dr`} className="tabular-nums font-bold text-slate-800 dark:text-slate-200">
                              {grouped ? `${l.group} Dr ` : 'Dr '}
                              {inr(r[l.dr])}
                            </span>
                          ) : null,
                          r[l.cr] ? (
                            <span key={`${l.group}-cr`} className="tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                              {grouped ? `${l.group} Cr ` : 'Cr '}
                              {inr(r[l.cr])}
                            </span>
                          ) : null,
                        ])}
                      </div>
                      <Balance net={running[i]} className="shrink-0 text-[13px]" />
                    </div>
                    {invoice && r.challanId && canViewChallan && (
                      <div className="mt-2 flex justify-end border-t pt-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-[4px] text-[11.5px] font-semibold"
                          onClick={() => viewChallan(r)}
                        >
                          <Eye className="size-3.5" /> View challan
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {footer && (
            <div className="mt-2 space-y-1.5 rounded-[4px] border-2 border-amber-600 bg-amber-100/80 px-3 py-2 dark:border-amber-400/60 dark:bg-amber-400/15">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] font-semibold uppercase tracking-wide text-amber-950 dark:text-amber-100">Current Total</span>
                <span className="text-[12.5px] font-bold tabular-nums">
                  {balanceCells(footer.current).map((v) => inr(v)).join('  /  ')}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-amber-600/30 pt-1.5 dark:border-amber-400/30">
                <span className="text-[12px] font-extrabold uppercase tracking-wide text-amber-950 dark:text-amber-100">Closing Balance</span>
                <Balance
                  net={footer.closingBankNet * (mode === 'C' ? 0 : 1) + footer.closingCashNet * (mode === 'B' ? 0 : 1)}
                  className="text-[15px]"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <ReceiptDialog row={receiptFor} onClose={() => setReceiptFor(null)} />
    </div>
  );
}

/** Totals line at the foot of the grid — same column geometry as a data row. */
function FootRow({
  label,
  cells,
  lead,
  trailing,
  strong,
  balance,
}: {
  label: string;
  cells: number[];
  lead: number;
  trailing: boolean;
  strong?: boolean;
  balance?: number;
}) {
  const bg = strong
    ? 'bg-amber-200/90 dark:bg-amber-400/20 border-t-2 border-t-amber-700 dark:border-t-amber-400/70'
    : 'bg-amber-100/70 dark:bg-amber-400/10 border-t border-t-amber-300 dark:border-t-amber-400/30';
  // The grid line is scoped to the RIGHT edge only — a blanket `border-amber-200`
  // also sets the top colour and would beat the totals rule above.
  const cell = cn('border-r border-r-amber-300/60 px-2 py-1 dark:border-r-amber-400/15 last:border-r-0', bg);
  return (
    <tr className={bg}>
      {/* Date stays blank; the label runs across the remaining text columns. */}
      <td className={cell} />
      <td className={cn(cell, strong ? 'text-[13.5px] font-extrabold' : 'text-[13px] font-bold')} colSpan={lead - 1}>
        {label}
      </td>
      {cells.map((v, i) => (
        <td key={i} className={cn(cell, NUM, strong ? 'text-[13.5px] font-extrabold' : 'font-bold')}>
          {money(v)}
        </td>
      ))}
      <td className={cn(cell, NUM)}>{balance === undefined ? null : <Balance net={balance} className={strong ? 'text-[13.5px]' : undefined} />}</td>
      {trailing && <td className={cell} />}
    </tr>
  );
}

/**
 * The one-letter settlement chip this system has always used: F = fully paid,
 * P = partially paid, D = due. Kept exactly as-is — only the palette gained dark
 * variants — because it's the shorthand the ledger is read by.
 */
function StatusChip({ status }: { status: string }) {
  if (status === 'F')
    return (
      <span className="rounded bg-emerald-100 px-1.5 text-[11.5px] font-bold text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300" title="Fully paid">
        F
      </span>
    );
  if (status === 'P')
    // Deeper than the other two: the rows behind it are amber, so a pale amber
    // chip would disappear into the banding.
    return (
      <span className="rounded bg-amber-500 px-1.5 text-[11.5px] font-bold text-amber-950 dark:bg-amber-500 dark:text-amber-950" title="Partially paid">
        P
      </span>
    );
  if (status === 'D')
    return (
      <span className="rounded bg-rose-100 px-1.5 text-[11.5px] font-bold text-rose-700 dark:bg-rose-400/15 dark:text-rose-300" title="Due">
        D
      </span>
    );
  return null;
}

/** Ageing text — "45 Over", "36 Late", "12 Left", "Due Today". Overdue reads red;
 *  Early / On Time / Late describe an already-settled bill, so they read green. */
const dueTone = (t: string) =>
  /Over/i.test(t)
    ? 'text-rose-600 dark:text-rose-400'
    : /Early|On Time|Late/i.test(t)
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-slate-600 dark:text-slate-400';

function DueFrom({ text }: { text: string }) {
  if (!text) return <span className="text-muted-foreground/50">—</span>;
  return <span className={cn('text-[12px] font-semibold uppercase', dueTone(text))}>{text}</span>;
}

/** Payment DNA is now a Party-Lists standing, so it colours by list kind. */
function dnaTone(kind?: PartyListStanding): Tone {
  switch (kind) {
    case 'GREEN':
      return 'emerald';
    case 'BLACK':
      return 'black';
    case 'CUSTOM':
      return 'violet';
    default:
      return 'muted';
  }
}
type Tone = 'slate' | 'muted' | 'rose' | 'amber' | 'emerald' | 'violet' | 'black';
const toneCls: Record<Tone, string> = {
  slate: 'text-slate-800 dark:text-slate-200',
  muted: 'text-muted-foreground',
  rose: 'text-rose-600 dark:text-rose-400',
  amber: 'text-amber-600 dark:text-amber-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  violet: 'text-violet-600 dark:text-violet-400',
  black: 'text-slate-900 dark:text-white',
};

/** Green / Black list swatch, matching the CRM Party Lists palette. */
const DOT_CLS: Record<PartyListStanding, string> = {
  GREEN: 'bg-emerald-500',
  BLACK: 'bg-slate-800 dark:bg-slate-100',
  CUSTOM: 'bg-violet-500',
  NONE: 'bg-slate-300 dark:bg-slate-600',
};

/** Compact ageing tile — label above, figure below, count trailing. */
function Kpi({
  label,
  value,
  note,
  tone = 'slate',
  dot,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: Tone;
  /** Renders a list-kind swatch before the value (Payment DNA only). */
  dot?: PartyListStanding;
}) {
  return (
    <div className="bg-card rounded-[4px] border border-amber-200 px-2.5 py-1.5 shadow-sm dark:border-amber-400/20">
      <div className="text-[9.5px] font-bold tracking-widest text-amber-900/70 uppercase dark:text-amber-200/60">{label}</div>
      <div className="flex items-baseline gap-1.5">
        {dot && <span className={cn('mb-px size-2 shrink-0 self-center rounded-full ring-1 ring-black/10', DOT_CLS[dot])} aria-hidden />}
        <span className={cn('truncate text-[15px] font-bold tabular-nums', toneCls[tone])} title={value}>
          {value}
        </span>
        {note && <span className="text-muted-foreground shrink-0 text-[10.5px] font-medium tabular-nums">{note}</span>}
      </div>
    </div>
  );
}

/**
 * A filter dropdown that grows to fit whatever was picked, so a long customer name
 * isn't truncated, with a clear button once it has a value.
 */
function FitSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  className?: string;
}) {
  const fitted = value ? `${Math.min(Math.max(value.length + 6, 12), 34)}ch` : undefined;
  return (
    <div
      className={cn('relative', className, value && 'sm:w-[var(--fit)]')}
      style={fitted ? ({ '--fit': fitted } as CSSProperties) : undefined}
    >
      <Label className="sr-only">{label}</Label>
      <NativeSelect
        value={value}
        onChange={onChange}
        options={['', ...options]}
        placeholder={label}
        className={cn(CONTROL, 'font-medium', value && CONTROL_ON)}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={`Clear ${label} filter`}
          title={`Clear ${label} filter`}
          className="absolute top-1/2 right-6 z-10 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-amber-700/70 transition-colors hover:bg-amber-100 hover:text-amber-900"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

function ReceiptDialog({ row, onClose }: { row: PartyLedgerRow | null; onClose: () => void }) {
  const [lines, setLines] = useState<LedgerReceiptLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!row) return;
    setLoading(true);
    setLines(null);
    fetchLedgerReceipts(row.voucherNo)
      .then(setLines)
      .catch(() => setLines([]))
      .finally(() => setLoading(false));
  }, [row]);

  const verb = (t: string) => (t === 'CREDIT NOTE' ? 'Cleared' : t === 'ADVANCE' ? 'Adjusted' : 'Paid');
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {row?.voucherType} — <span className="font-semibold tabular-nums">{row?.voucherNo}</span>
          </DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground -mt-2 text-sm">{row?.particulars}</p>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading receipts…
          </div>
        ) : lines && lines.length ? (
          <ul className="space-y-1.5 py-1 text-sm">
            {lines.map((l, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-amber-500" />
                {verb(l.recType)} on {prettyDate(l.recDate)} vide <span className="font-semibold">{l.refRecId || '?'}</span>
                {l.recAmt > 0 && <span className="ml-auto tabular-nums font-semibold">₹ {inr(l.recAmt)}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-3 text-sm text-muted-foreground">No payments / clearances recorded yet.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
