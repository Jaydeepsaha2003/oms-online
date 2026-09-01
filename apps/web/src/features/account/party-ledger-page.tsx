import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileSpreadsheet,
  Loader2,
  Printer,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  LedgerBalanceRow,
  LedgerClearedResult,
  LedgerReceiptLine,
  NoteMode,
  PartyLedgerFooter,
  PartyLedgerKpis,
  PartyLedgerQuery,
  PartyLedgerRow,
  PartyListStanding,
} from '@oms/shared';
import { api, downloadFile, getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { DateRangeCalendar } from '@/components/common/date-range-calendar';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchLedgerCleared, fetchLedgerReceipts, usePartyLedger, usePartyLedgerLookups } from './use-party-ledger';

const inr = (v: number) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
GlobalWorkerOptions.workerSrc = pdfWorker;
/** Tally leaves a zero cell blank rather than printing 0. */
const money = (v: number) => (v ? inr(v) : '');
/** The 3 summary rows (Opening Balance / Current Total / Closing Balance) fill
 *  a blank or zero cell with "-" instead — standard accounting-statement style,
 *  as opposed to the transaction rows above which stay genuinely blank. */
const moneyOrDash = (v: number) => (v ? inr(v) : '-');
// Delegates to the shared formatter so this page follows the system-wide date format.
const prettyDate = (iso: string | null) => formatDate(iso);
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const timestampedPdfName = (partyName: string) => {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, '0');
  const stamp = `${two(now.getDate())}_${two(now.getMonth() + 1)}_${two(now.getFullYear() % 100)}_${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `${partyName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim()}_${stamp}.pdf`;
};

/** Compact, amber-bordered filter controls — the same language as every other list page. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON =
  'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';

/* ── Tally palette ──────────────────────────────────────────────────────────
   Tally puts amber chrome around a plain white data grid; the ledger keeps that
   amber frame (borders, filters, opening/closing bands) but the column strip
   itself uses the same dark navy→indigo gradient as every other list screen's
   header, for one consistent look across the app. */

/** Header cell: sticky, navy→indigo band, white type — the app's column strip. */
const TH =
  'sticky bg-gradient-to-b from-blue-800 to-indigo-800 px-2 text-[11px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap dark:from-blue-900 dark:to-indigo-900';
/** The Bank / Cash banner — same band as the column strip below it, so the two
 *  header tiers read as one continuous header rather than two different bars. */
const TH_GROUP = TH;
/** Rule between header cells — white-on-navy, not amber. */
const TH_LINE = 'border-r border-white/15';
/** Body cell: full grid lines, tight rows. The colour is scoped to the right edge
 *  so a row's own top/bottom rule (the totals band) isn't overridden by it. */
const TD =
  'border-r border-r-amber-200/80 px-2 py-[3px] align-middle dark:border-r-amber-400/15 last:border-r-0';
const NUM = 'text-right tabular-nums';
/** The panel that frames the whole worksheet. */
const PANEL = 'border-amber-300 dark:border-amber-400/30';

const FY_START_MONTH = 3; // April (0-based)
function fyStart(d: Date): Date {
  const y = d.getMonth() >= FY_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(y, FY_START_MONTH, 1);
}
const RANGE_PRESETS = [
  'This Year',
  'Last Year',
  'This Quarter',
  'Last Quarter',
  'This Month',
  'Last Month',
  'Yesterday',
  'Today',
] as const;
type Preset = (typeof RANGE_PRESETS)[number];

function presetRange(p: Preset): { from: Date; to: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fys = fyStart(today);
  const monthsSince =
    (today.getFullYear() - fys.getFullYear()) * 12 + (today.getMonth() - fys.getMonth());
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
      return {
        from: new Date(today.getFullYear(), today.getMonth() - 1, 1),
        to: new Date(today.getFullYear(), today.getMonth(), 0),
      };
    case 'This Quarter':
      return { from: qStart, to: today };
    case 'Last Quarter':
      return {
        from: new Date(qStart.getFullYear(), qStart.getMonth() - 3, 1),
        to: new Date(qStart.getTime() - 86400000),
      };
    case 'Last Year':
      return {
        from: new Date(fys.getFullYear() - 1, FY_START_MONTH, 1),
        to: new Date(fys.getTime() - 86400000),
      };
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
  /** Signed opening net for this leg, used to seed the running balance. Null when
   *  the server withholds balances under a voucher-type filter. */
  openNet: (f: PartyLedgerFooter) => number | null;
}
const BANK_LEG: Leg = {
  group: 'Bank',
  dr: 'bankDr',
  cr: 'bankCr',
  openNet: (f) => f.openingBankNet,
};
const CASH_LEG: Leg = {
  group: 'Cash',
  dr: 'cashDr',
  cr: 'cashCr',
  openNet: (f) => f.openingCashNet,
};
const legsFor = (mode: string): Leg[] =>
  mode === 'B' ? [BANK_LEG] : mode === 'C' ? [CASH_LEG] : [BANK_LEG, CASH_LEG];

/**
 * A signed balance rendered the Tally way: magnitude followed by Dr or Cr.
 *
 * Zero is a faint dash on a per-transaction running balance, where it means
 * "nothing to say here". On the Closing Balance it means the exact opposite —
 * the party is square — and a dash there reads as the figure having failed to
 * arrive. `nilLabel` makes that line spell it out instead.
 */
function Balance({
  net,
  className,
  nilLabel,
}: {
  net: number;
  className?: string;
  nilLabel?: string;
}) {
  if (!net) {
    return nilLabel ? (
      <span
        className={cn('font-bold tabular-nums text-emerald-700 dark:text-emerald-400', className)}
      >
        0<span className="ml-1 text-[10px] font-bold opacity-70">{nilLabel}</span>
      </span>
    ) : (
      <span className="text-muted-foreground/50">—</span>
    );
  }
  const cr = net < 0;
  return (
    <span
      className={cn(
        'tabular-nums font-bold',
        cr ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-100',
        className,
      )}
    >
      {inr(Math.abs(net))}
      <span className="ml-1 text-[10px] font-bold opacity-70">{cr ? 'Cr' : 'Dr'}</span>
    </span>
  );
}

/** Filters kept in the URL rather than in component state. "View challan"
 *  leaves this route, so the page unmounts; on Back it mounts fresh and plain
 *  useState comes back empty — the party, the dates and the mode you had set
 *  were gone. The query string survives that trip (Back restores the entry's
 *  full URL), and makes a ledger view shareable as a bonus. Writes are
 *  `replace`, so changing a filter never adds a history step of its own —
 *  Back still means "leave the ledger", not "undo my last filter". */
function useLedgerFilters() {
  const [params, setParams] = useSearchParams();
  const get = (key: string, fallback: string) => params.get(key) ?? fallback;
  const filters = {
    party: get('party', ''),
    agent: get('agent', ''),
    from: get('from', ymd(fyStart(new Date()))),
    to: get('to', ymd(new Date())),
    mode: get('mode', 'BOTH') as 'BOTH' | 'B' | 'C',
    voucherType: get('vtype', ''),
    preset: get('preset', ''),
    showBalance: params.get('balance') === '1',
  };
  /** One writer for the whole set: several filters move together (a preset sets
   *  from+to+preset, picking a party clears the agent), and separate setters
   *  would each compute from the same pre-update query string and clobber one
   *  another. */
  const patch = (changes: Partial<typeof filters>) => {
    const next = new URLSearchParams(params);
    const write = (key: string, value: string) => (value ? next.set(key, value) : next.delete(key));
    if (changes.party !== undefined) write('party', changes.party);
    if (changes.agent !== undefined) write('agent', changes.agent);
    if (changes.from !== undefined) write('from', changes.from);
    if (changes.to !== undefined) write('to', changes.to);
    if (changes.mode !== undefined) write('mode', changes.mode === 'BOTH' ? '' : changes.mode);
    if (changes.voucherType !== undefined) write('vtype', changes.voucherType);
    if (changes.preset !== undefined) write('preset', changes.preset);
    if (changes.showBalance !== undefined) write('balance', changes.showBalance ? '1' : '');
    setParams(next, { replace: true });
  };
  return { ...filters, patch, clear: () => setParams(new URLSearchParams(), { replace: true }) };
}

export function PartyLedgerPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canPrintLedger = can('partyledger:print');
  const { data: lookups } = usePartyLedgerLookups();

  // Off by default (`balance=1` in the URL turns it on): the running Balance per
  // transaction is a detail, not something every glance at the ledger needs —
  // Closing Balance (the actual bottom line) always shows regardless.
  const { party, agent, from, to, mode, voucherType, preset, showBalance, patch, clear } =
    useLedgerFilters();
  const [receiptFor, setReceiptFor] = useState<PartyLedgerRow | null>(null);
  const [dateOpen, setDateOpen] = useState(false);

  const custByName = useMemo(
    () => new Map((lookups?.customers ?? []).map((c) => [c.name, c.id])),
    [lookups],
  );
  const partyOptions = useMemo(() => (lookups?.customers ?? []).map((c) => c.name), [lookups]);
  const agentOptions = useMemo(() => ['All', ...(lookups?.agents ?? [])], [lookups]);

  const query = useMemo<PartyLedgerQuery>(
    () => ({
      customerId: party ? custByName.get(party) : undefined,
      agentName: !party && agent && agent !== 'All' ? agent : undefined,
      from,
      to,
      mode,
      voucherType: voucherType || undefined,
    }),
    [party, agent, from, to, mode, voucherType, custByName],
  );

  const { data, isFetching } = usePartyLedger(query);
  const rows = data?.rows ?? [];
  const footer = data?.footer;
  const kpis = data?.kpis;
  /** Signed closing net for whichever leg(s) the current mode shows — the one
   *  number the ledger is actually for. Shared by the KPI rail and both
   *  Closing Balance renderings (desktop footer row + mobile summary card).
   *  Null when a voucher-type filter is on: the server withholds opening and
   *  closing there, because a full-ledger opening plus a one-type Current Total
   *  isn't this party's position. */
  const closingNet =
    footer && footer.closingBankNet != null && footer.closingCashNet != null
      ? footer.closingBankNet * (mode === 'C' ? 0 : 1) +
        footer.closingCashNet * (mode === 'B' ? 0 : 1)
      : null;

  const onReset = () => clear();
  const applyPreset = (p: Preset) => {
    const { from: f, to: t } = presetRange(p);
    patch({ from: ymd(f), to: ymd(t), preset: p });
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
  const [pdfPreview, setPdfPreview] = useState<{ url: string; filename: string } | null>(null);
  const pdfFrameRef = useRef<HTMLIFrameElement>(null);
  const [excelLoading, setExcelLoading] = useState(false);
  useEffect(
    () => () => {
      if (pdfPreview) URL.revokeObjectURL(pdfPreview.url);
    },
    [pdfPreview],
  );
  const pdfFilename = timestampedPdfName(
    data?.customerName || (data?.agentName ? `Agent-${data.agentName}` : 'All-Parties'),
  );
  const onPdf = async () => {
    setPdfLoading(true);
    try {
      const response = await api.get(exportUrl('pdf'), { responseType: 'blob' });
      const disposition = response.headers['content-disposition'] as string | undefined;
      const filename = disposition?.match(/filename="?([^";]+)"?/i)?.[1]?.trim() || pdfFilename;
      setPdfPreview({ url: URL.createObjectURL(response.data as Blob), filename });
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'PDF failed'));
    } finally {
      setPdfLoading(false);
    }
  };
  const downloadPreview = () => {
    if (!pdfPreview) return;
    const link = document.createElement('a');
    link.href = pdfPreview.url;
    link.download = pdfPreview.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  const printPreview = () => {
    const frameWindow = pdfFrameRef.current?.contentWindow;
    if (!frameWindow) return toast.error('PDF preview is not ready yet.');
    frameWindow.focus();
    frameWindow.print();
  };
  const printShortcutRef = useRef({ openPdf: onPdf, printPreview });
  printShortcutRef.current = { openPdf: onPdf, printPreview };
  useEffect(() => {
    if (!canPrintLedger) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'p'
      )
        return;
      if (!pdfPreview && document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      if (pdfPreview) {
        printShortcutRef.current.printPreview();
      } else if (rows.length && !pdfLoading) {
        void printShortcutRef.current.openPdf();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canPrintLedger, pdfLoading, pdfPreview, rows.length]);
  const onExcel = async () => {
    setExcelLoading(true);
    try {
      await downloadFile(
        exportUrl('xlsx'),
        `${(data?.customerName || data?.agentName || 'party-ledger').replace(/[\\/:*?"<>|]/g, '-')}.xlsx`,
      );
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
  /** Rows that open the detail dialog: an invoice shows what paid it, a receipt
   *  shows what it cleared. Both directions of the same question. */
  const isOpenableRow = (r: PartyLedgerRow) => isInvoiceRow(r) || r.voucherType.toUpperCase() === 'RECEIPT';

  // Both desktop and mobile navigate to the in-app Challan bill page
  // (matches the Sales Order / Quotation "Print / PDF" pattern).
  const canViewChallan = can('challan:print');
  const viewChallan = (r: PartyLedgerRow) => {
    if (!r.challanId) return;
    navigate(`/challans/${r.challanId}/bill`);
  };

  /*
   * A note row's own document.
   *
   * A DEBIT NOTE is stored as a Challan, so it arrives here carrying a
   * challanId and used to open the CHALLAN bill — a document headed SALES
   * RECEIPT with challan columns, which is not what a debit note is. A CREDIT
   * NOTE lives in its own table, has no challanId, and so had no way to be
   * opened from the ledger at all. Both now go to the note bill, addressed the
   * way that page expects: the voucher type is the mode and the voucher no is
   * the code.
   */
  const canViewNote = can('note:print');
  const noteRefOf = (r: PartyLedgerRow): { mode: NoteMode; label: string } | null => {
    const vt = r.voucherType.trim().toUpperCase();
    if (vt === 'CREDIT NOTE') return { mode: 'CREDIT', label: 'credit note' };
    if (vt === 'DEBIT NOTE') return { mode: 'DEBIT', label: 'debit note' };
    return null;
  };
  const viewNote = (r: PartyLedgerRow, mode: NoteMode) =>
    navigate(`/account/notes/bill?mode=${mode}&code=${encodeURIComponent(r.voucherNo)}`);

  const legs = legsFor(mode);
  const grouped = legs.length === 2;

  /* Running balance, Tally's defining column. Seeded from the opening net of the
     legs on screen and walked forward in the server's chronological order, so the
     last row lands exactly on the Closing Balance the footer reports. */
  const openingNet =
    footer && footer.opening ? legs.reduce((sum, l) => sum + (l.openNet(footer) ?? 0), 0) : null;
  /** How many rows the sticky footer renders — Opening (when there is one),
   *  Current Total (always), Closing (when not filtered to one voucher type).
   *  Drives the body spacer that stops it covering the last invoices. */
  const footRowCount =
    (footer?.opening ? 1 : 0) + 1 + (footer?.closing && closingNet != null ? 1 : 0);
  // No opening to seed from (voucher-type filter) → there is no running balance to
  // walk, so the column stays empty rather than counting up from a made-up zero.
  const running = useMemo(() => {
    if (openingNet == null) return null;
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
          onChange={(f, t) => patch({ from: f, ...(t ? { to: t } : {}), preset: '' })}
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <span className="min-w-0 truncate text-[11.5px] font-semibold">
          {prettyDate(from)} <span className="text-muted-foreground">→</span> {prettyDate(to)}
        </span>
        <Button
          size="sm"
          className="h-7 shrink-0 px-3 text-[12px] font-semibold"
          onClick={() => setDateOpen(false)}
        >
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
            onChange={(v) => patch({ party: v, ...(v ? { agent: '' } : {}) })}
            options={partyOptions}
            className="w-full sm:w-52"
          />
          <FitSelect
            label="Agent"
            value={agent === 'All' ? '' : agent}
            onChange={(v) => patch({ agent: v, ...(v ? { party: '' } : {}) })}
            options={agentOptions.filter((a) => a !== 'All')}
            className="w-full sm:w-40"
          />

          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  CONTROL,
                  'w-full max-w-full justify-start font-medium sm:w-auto sm:max-w-56',
                  CONTROL_ON,
                )}
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
            onChange={(v) => patch({ voucherType: v })}
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
                onClick={() => patch({ mode: m })}
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

          {/* Off by default — the running Balance per transaction is a detail most
              glances at the ledger don't need; Closing Balance always shows regardless.
              Disabled under a voucher-type filter: with no opening to seed from there
              is no running balance to show. */}
          <label
            className={cn(
              'flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-amber-900/80 select-none dark:text-amber-200/80',
              running ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
            )}
            title={running ? undefined : 'Clear the voucher type filter to see running balances'}
          >
            <Switch
              checked={showBalance && !!running}
              onCheckedChange={(v) => patch({ showBalance: v })}
              disabled={!running}
            />{' '}
            Show Balance
          </label>

          <Button
            variant="outline"
            className="h-9 rounded-[4px] text-[12.5px] font-semibold"
            onClick={onReset}
          >
            <X /> Reset
          </Button>

          <div className="ml-auto flex items-center gap-2">
            {/* Was `lg:block`. How many rows the statement has is not a desktop
                luxury — on a phone, where you cannot see the end of the list, it
                is the only way to know how much there is. */}
            {data && (
              <p className="text-muted-foreground text-[12px] font-medium">
                <span className="text-foreground font-bold tabular-nums">{rows.length}</span> row
                {rows.length === 1 ? '' : 's'}
                {isFetching && <Loader2 className="ml-1 inline size-3 animate-spin align-[-2px]" />}
              </p>
            )}
            {canPrintLedger && (
              <Button
                variant="outline"
                size="icon"
                className="size-9 rounded-[4px] border-rose-600 bg-rose-600 text-white shadow-sm hover:border-rose-700 hover:bg-rose-700 hover:text-white disabled:border-rose-300 disabled:bg-rose-300 disabled:text-white dark:border-rose-500 dark:bg-rose-600 dark:hover:border-rose-400 dark:hover:bg-rose-500"
                onClick={onPdf}
                disabled={!rows.length || pdfLoading}
                aria-label="Open Party Ledger PDF"
                title="Open PDF (Ctrl+P)"
              >
                {pdfLoading ? <Loader2 className="animate-spin" /> : <Printer />}
              </Button>
            )}
            {can('partyledger:export') && (
              <Button
                variant="outline"
                size="icon"
                className="size-9 rounded-[4px] border-emerald-600 bg-emerald-600 text-white shadow-sm hover:border-emerald-700 hover:bg-emerald-700 hover:text-white disabled:border-emerald-300 disabled:bg-emerald-300 disabled:text-white dark:border-emerald-500 dark:bg-emerald-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500"
                onClick={onExcel}
                disabled={!rows.length || excelLoading}
                aria-label="Download Party Ledger Excel"
                title="Download Excel"
              >
                {excelLoading ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Ageing rail ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <InvDueFromKpi
          text={kpis?.invDueFrom}
          detail={kpis?.invDueFromDetail}
          // Widen the FROM date back to the invoice; the TO end is left alone so
          // nothing currently on screen disappears.
          onShowInvoice={(iso) => patch({ from: iso.slice(0, 10), preset: '' })}
        />
        <Kpi
          label="Total Outstanding"
          value={
            closingNet != null
              ? `${inr(Math.abs(closingNet))}${closingNet !== 0 ? ` ${closingNet < 0 ? 'Cr' : 'Dr'}` : ''}`
              : '—'
          }
          note={closingNet == null && footer ? 'clear voucher type' : undefined}
          tone={
            closingNet == null || closingNet === 0 ? 'slate' : closingNet < 0 ? 'emerald' : 'amber'
          }
        />
        <Kpi
          label="Over Due"
          value={kpis ? inr(kpis.overDue.amount) : '—'}
          note={kpis ? `${kpis.overDue.count} inv` : undefined}
          tone="rose"
        />
        <Kpi
          label="Past Due"
          value={kpis ? inr(kpis.pastDue.amount) : '—'}
          note={kpis ? `${kpis.pastDue.count} inv` : undefined}
          tone="amber"
        />
        <Kpi
          label="Normal Due"
          value={kpis ? inr(kpis.normal.amount) : '—'}
          note={kpis ? `${kpis.normal.count} inv` : undefined}
          tone="emerald"
        />
      </div>

      {/* ── The ledger ──────────────────────────────────────────────────────── */}
      <div
        className={cn(
          'bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[4px] border shadow-sm',
          PANEL,
        )}
      >
        {/* Document header — Tally captions every ledger with the account and the
            period it covers, on a dark bar above the amber column strip. */}
        <div className="flex items-center justify-between gap-3 bg-slate-800 px-2.5 py-1 dark:bg-slate-900">
          <span className="truncate text-[12px] font-extrabold tracking-wide text-amber-300 uppercase">
            {scopeLabel || 'Ledger Account'}
          </span>
          {/*
           * Shown on phones too.
           *
           * It used to be `sm:inline` on the reasoning that the Date control
           * above already states the period. It does not, once the page is
           * scrolled — and this is a STATEMENT: which dates it covers and
           * whether it is bank, cash or both is part of the figures, not
           * decoration. A ledger that does not say what it covers is the one
           * thing a ledger must not be.
           *
           * `text-right` + wrapping rather than `truncate`, so a narrow screen
           * folds it onto a second line instead of cutting the mode off the end.
           */}
          <span className="shrink-0 text-right text-[10.5px] leading-tight font-bold tracking-wide text-white tabular-nums sm:text-[11px]">
            {prettyDate(from)} — {prettyDate(to)}
            <span className="hidden sm:inline"> · </span>
            <span className="block sm:inline">
              {mode === 'BOTH' ? 'Bank & Cash' : mode === 'B' ? 'Bank' : 'Cash'}
            </span>
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
                    <th
                      key={l.group}
                      className={cn(TH_GROUP, TH_LINE, 'top-0 h-7 text-center')}
                      colSpan={2}
                      scope="colgroup"
                    >
                      {l.group}
                    </th>
                  ))}
                  <th
                    className={cn(TH_GROUP, 'top-0 h-7')}
                    colSpan={1 + (canViewChallan ? 1 : 0)}
                  />
                </tr>
              )}
              <tr>
                {['Date', 'Particulars', 'Vch Type', 'Vch No'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className={cn(TH, TH_LINE, grouped ? 'top-7' : 'top-0', 'py-1.5 text-left')}
                  >
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
                <th
                  scope="col"
                  className={cn(TH, TH_LINE, grouped ? 'top-7' : 'top-0', 'py-1.5 text-left')}
                >
                  Due From
                </th>
                {legs.flatMap((l) =>
                  ['Debit', 'Credit'].map((side) => (
                    <th
                      key={`${l.group}-${side}`}
                      scope="col"
                      className={cn(TH, TH_LINE, grouped ? 'top-7' : 'top-0', 'py-1.5 text-right')}
                    >
                      {grouped ? side : `${l.group} ${side}`}
                    </th>
                  )),
                )}
                <th
                  scope="col"
                  className={cn(TH, TH_LINE, grouped ? 'top-7' : 'top-0', 'py-1.5 text-right')}
                >
                  Balance
                </th>
                {canViewChallan && (
                  <th
                    scope="col"
                    className={cn(TH, grouped ? 'top-7' : 'top-0', 'w-10 py-1.5')}
                    aria-label="View"
                  />
                )}
              </tr>
            </thead>

            <tbody>
              {isFetching && !data ? (
                <tr>
                  <td colSpan={totalCols} className="text-muted-foreground h-24 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={totalCols}
                    className="text-muted-foreground h-24 text-center text-[13px] font-medium"
                  >
                    No ledger entries for these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => {
                  const invoice = isOpenableRow(r);
                  const note = noteRefOf(r);
                  return (
                    <tr
                      key={`${r.voucherNo}-${r.txnDate}-${i}`}
                      // Invoice rows open their receipts; keyboard users get the same
                      // affordance via Enter / Space on the focused row.
                      tabIndex={invoice ? 0 : undefined}
                      role={invoice ? 'button' : undefined}
                      aria-label={
                        invoice
                          ? isInvoiceRow(r)
                            ? `Receipts against ${r.voucherNo}`
                            : `Invoices cleared by ${r.voucherNo}`
                          : undefined
                      }
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
                      <td
                        className={cn(
                          TD,
                          'whitespace-nowrap tabular-nums font-semibold text-slate-700 dark:text-slate-300',
                        )}
                      >
                        {prettyDate(r.txnDate)}
                      </td>
                      <td className={cn(TD, 'font-semibold text-slate-800 dark:text-slate-200')}>
                        {r.particulars}
                      </td>
                      <td
                        className={cn(
                          TD,
                          'whitespace-nowrap text-[12px] font-medium text-slate-600 dark:text-slate-400',
                        )}
                      >
                        {r.voucherType}
                      </td>
                      <td
                        className={cn(
                          TD,
                          'whitespace-nowrap text-[12.5px] font-semibold',
                          invoice &&
                            'font-bold text-amber-900 underline-offset-2 group-hover:underline dark:text-amber-300',
                        )}
                      >
                        {r.voucherNo}
                      </td>
                      <td className={cn(TD, 'text-center')}>
                        <StatusChip
                          status={r.status}
                          side={mode === 'BOTH' ? r.pendingSide : null}
                        />
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap')}>
                        <DueFrom text={r.dueFrom} />
                      </td>
                      {legs.flatMap((l) => [
                        <td
                          key={`${l.group}-dr`}
                          className={cn(
                            TD,
                            NUM,
                            'font-semibold text-slate-900 dark:text-slate-100',
                          )}
                        >
                          {money(r[l.dr])}
                        </td>,
                        <td
                          key={`${l.group}-cr`}
                          className={cn(
                            TD,
                            NUM,
                            'font-semibold text-emerald-700 dark:text-emerald-400',
                          )}
                        >
                          {money(r[l.cr])}
                        </td>,
                      ])}
                      <td className={cn(TD, NUM)}>
                        {showBalance && running && <Balance net={running[i]} />}
                      </td>
                      {(canViewChallan || canViewNote) && (
                        <td className={cn(TD, 'text-center')} onClick={(e) => e.stopPropagation()}>
                          {/* A note opens its own note bill; anything else backed
                              by a Challan opens the challan bill. */}
                          {note && canViewNote ? (
                            <button
                              type="button"
                              onClick={() => viewNote(r, note.mode)}
                              className="text-muted-foreground hover:text-primary hover:bg-muted inline-flex size-6 items-center justify-center rounded transition-colors"
                              title={`View ${note.label} ${r.voucherNo}`}
                              aria-label={`View ${note.label} ${r.voucherNo}`}
                            >
                              <Eye className="size-3.5" />
                            </button>
                          ) : invoice && r.challanId && canViewChallan ? (
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
              {/* Spacer: the tfoot below is `sticky bottom-0`, so it OVERLAYS the
                  end of the body rather than pushing it up — scrolled to the
                  bottom, the last one to three invoices sat hidden behind the
                  Opening / Current / Closing rows and simply could not be read.
                  Reserving the footer's own height lets them scroll clear of it. */}
              {footer && (
                <tr aria-hidden="true">
                  <td colSpan={99} className="p-0" style={{ height: footRowCount * 30 }} />
                </tr>
              )}
            </tbody>

            {/* Opening balance + current total + closing balance ride together at the
                foot of the grid and stay visible while the body scrolls — Tally
                always shows you the closing, and grouping all 3 summary rows here
                (rather than opening at the top) keeps them in one glance. */}
            {footer && (
              <tfoot className="sticky bottom-0 z-20">
                {footer.opening && (
                  <FootRow
                    label="Opening Balance"
                    cells={balanceCells(footer.opening)}
                    lead={LEAD_COLS}
                    trailing={canViewChallan}
                    balance={openingNet ?? undefined}
                    showBalance={showBalance}
                    underline
                  />
                )}
                {/* Under a voucher-type filter this is the only honest line left, so it
                    carries the filter in its label and takes the bottom-line styling. */}
                <FootRow
                  label={footer.closing ? 'Current Total' : `Current Total · ${voucherType} only`}
                  cells={balanceCells(footer.current)}
                  lead={LEAD_COLS}
                  trailing={canViewChallan}
                  strong={!footer.closing}
                />
                {footer.closing && closingNet != null && (
                  <FootRow
                    label="Closing Balance"
                    cells={balanceCells(footer.closing)}
                    lead={LEAD_COLS}
                    trailing={canViewChallan}
                    strong
                    balance={closingNet}
                  />
                )}
              </tfoot>
            )}
          </table>
        </div>

        {/* Phones: one card per voucher — the grid is unusable at this width. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:hidden">
          {isFetching && !data ? (
            <div className="text-muted-foreground flex h-24 items-center justify-center">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground px-4 py-10 text-center text-[13px] font-medium">
              No ledger entries for these filters.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((r, i) => {
                const invoice = isOpenableRow(r);
                const note = noteRefOf(r);
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
                      invoice &&
                        'cursor-pointer active:bg-amber-100/70 dark:active:bg-amber-400/15',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] leading-tight font-bold text-slate-900 dark:text-slate-100">
                          {r.particulars}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-[11.5px] font-medium">
                          {r.voucherType} · <span className="font-semibold">{r.voucherNo}</span>
                        </p>
                      </div>
                      <span className="text-muted-foreground shrink-0 text-[11px] font-semibold tabular-nums">
                        {prettyDate(r.txnDate)}
                      </span>
                    </div>
                    {(r.status || r.dueFrom) && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <StatusChip
                          status={r.status}
                          side={mode === 'BOTH' ? r.pendingSide : null}
                        />
                        <DueFrom text={r.dueFrom} />
                      </div>
                    )}
                    <div className="mt-2 flex items-end justify-between gap-2 border-t pt-2">
                      {/*
                       * EVERY leg, including the empty ones.
                       *
                       * These used to render only when non-zero, so a bank-only
                       * row simply had no cash figures on it — and a reader
                       * could not tell "cash was nil" from "the card is not
                       * showing me cash". The desktop grid always draws all four
                       * money columns; a card that quietly drops half of them is
                       * not the same statement.
                       *
                       * A dash for nil, matching the grid's own empty cell, so
                       * the two read alike.
                       */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px]">
                        {legs.flatMap((l) => [
                          <span
                            key={`${l.group}-dr`}
                            className="flex items-baseline justify-between gap-1.5"
                          >
                            <span className="text-muted-foreground text-[10px] font-bold tracking-wide uppercase">
                              {grouped ? `${l.group} Dr` : 'Dr'}
                            </span>
                            <span
                              className={cn(
                                'tabular-nums font-bold',
                                r[l.dr]
                                  ? 'text-slate-800 dark:text-slate-200'
                                  : 'text-muted-foreground/50',
                              )}
                            >
                              {moneyOrDash(r[l.dr])}
                            </span>
                          </span>,
                          <span
                            key={`${l.group}-cr`}
                            className="flex items-baseline justify-between gap-1.5"
                          >
                            <span className="text-muted-foreground text-[10px] font-bold tracking-wide uppercase">
                              {grouped ? `${l.group} Cr` : 'Cr'}
                            </span>
                            <span
                              className={cn(
                                'tabular-nums font-bold',
                                r[l.cr]
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-muted-foreground/50',
                              )}
                            >
                              {moneyOrDash(r[l.cr])}
                            </span>
                          </span>,
                        ])}
                      </div>
                      {showBalance && running && (
                        <Balance net={running[i]} className="shrink-0 text-[13px]" />
                      )}
                    </div>
                    {(note && canViewNote) || (invoice && r.challanId && canViewChallan) ? (
                      <div
                        className="mt-2 flex justify-end border-t pt-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-[4px] text-[11.5px] font-semibold"
                          onClick={() =>
                            note && canViewNote ? viewNote(r, note.mode) : viewChallan(r)
                          }
                        >
                          <Eye className="size-3.5" />{' '}
                          {note && canViewNote
                            ? `View ${note.mode === 'CREDIT' ? 'credit' : 'debit'} note`
                            : 'View challan'}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          {/* All 3 summary rows grouped at the bottom, in statement order —
              Opening, Current Total, Closing — rather than opening at the top. */}
          {footer && (
            <div className="mt-2 space-y-1.5 rounded-[4px] border-2 border-amber-600 bg-amber-100/80 px-3 py-2 dark:border-amber-400/60 dark:bg-amber-400/15">
              {footer.opening && (
                <div className="flex items-center justify-between">
                  <span className="text-[11.5px] font-semibold uppercase tracking-wide text-amber-950 dark:text-amber-100">
                    Opening Balance
                  </span>
                  <span className="text-[12.5px] font-bold tabular-nums">
                    {balanceCells(footer.opening)
                      .map((v) => moneyOrDash(v))
                      .join('  /  ')}
                  </span>
                </div>
              )}
              <div
                className={cn(
                  'flex items-center justify-between',
                  footer.opening && 'border-t border-amber-600/30 pt-1.5 dark:border-amber-400/30',
                )}
              >
                <span className="text-[11.5px] font-semibold uppercase tracking-wide text-amber-950 dark:text-amber-100">
                  {footer.closing ? 'Current Total' : `Current Total · ${voucherType} only`}
                </span>
                <span className="text-[12.5px] font-bold tabular-nums">
                  {balanceCells(footer.current)
                    .map((v) => moneyOrDash(v))
                    .join('  /  ')}
                </span>
              </div>
              {footer.closing && closingNet != null && (
                <div className="flex items-center justify-between border-t border-amber-600/30 pt-1.5 dark:border-amber-400/30">
                  <span className="text-[12px] font-extrabold uppercase tracking-wide text-amber-950 dark:text-amber-100">
                    Closing Balance
                  </span>
                  <Balance net={closingNet} className="text-[15px]" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!pdfPreview} onOpenChange={(open) => !open && setPdfPreview(null)}>
        <DialogContent className="flex h-[min(92vh,900px)] w-[min(96vw,920px)] max-w-none flex-col gap-0 overflow-hidden rounded-[6px] p-0">
          <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base">Party Ledger PDF</DialogTitle>
              <p className="text-muted-foreground truncate text-xs">{pdfPreview?.filename}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-2 sm:pt-0">
              <Button variant="outline" size="sm" onClick={printPreview} className="rounded-[4px]">
                <Printer className="size-4" /> Print
              </Button>
              <Button
                size="sm"
                onClick={downloadPreview}
                className="rounded-[4px] bg-rose-600 font-bold text-white hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-500"
              >
                <Download className="size-4" /> Download PDF
              </Button>
            </div>
          </DialogHeader>
          {pdfPreview && <PdfCanvasPreview url={pdfPreview.url} />}
          {pdfPreview && (
            <iframe
              ref={pdfFrameRef}
              src={pdfPreview.url}
              title="Party Ledger print source"
              className="pointer-events-none fixed size-px opacity-0"
            />
          )}
        </DialogContent>
      </Dialog>

      <ReceiptDialog row={receiptFor} mode={mode} onClose={() => setReceiptFor(null)} />
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
  showBalance = true,
  underline,
}: {
  label: string;
  cells: number[];
  lead: number;
  trailing: boolean;
  strong?: boolean;
  balance?: number;
  /** Hide the Balance cell's VALUE (the column itself always stays, so the grid
   *  keeps its column count) — used to respect the page's "Show Balance" toggle
   *  for every summary row except Closing Balance, which always shows its figure. */
  showBalance?: boolean;
  /** A thick rule under this row — e.g. separating Opening Balance from the
   *  Current Total/Closing Balance rows below it. Box-shadow for the same
   *  sticky+border-collapse reason as the Closing Balance rule above. */
  underline?: boolean;
}) {
  // The Closing Balance rule is a box-shadow, not a border: this row sits inside
  // a `position: sticky` tfoot over a `border-collapse` table, a combination
  // browsers are known to mis-render top borders on once the row is actually
  // stuck mid-scroll (the border silently disappears). A box-shadow paints
  // independently of border-collapse's border-resolution algorithm, so the rule
  // stays visible the whole time the ledger is scrolled, not just at rest.
  const bg = strong
    ? 'bg-amber-200/90 dark:bg-amber-400/20 shadow-[inset_0_2px_0_0_var(--color-amber-700)] dark:shadow-[inset_0_2px_0_0_var(--color-amber-400)]'
    : underline
      ? 'bg-amber-100/70 dark:bg-amber-400/10 shadow-[inset_0_-2px_0_0_var(--color-amber-700)] dark:shadow-[inset_0_-2px_0_0_var(--color-amber-400)]'
      : 'bg-amber-100/70 dark:bg-amber-400/10 border-t border-t-amber-300 dark:border-t-amber-400/30';
  // The grid line is scoped to the RIGHT edge only — a blanket `border-amber-200`
  // also sets the top colour and would beat the totals rule above.
  const cell = cn(
    'border-r border-r-amber-300/60 px-2 py-1 dark:border-r-amber-400/15 last:border-r-0',
    bg,
  );
  return (
    <tr className={bg}>
      {/* Date stays blank; the label runs across the remaining text columns. */}
      <td className={cell} />
      <td
        className={cn(cell, strong ? 'text-[13.5px] font-extrabold' : 'text-[13px] font-bold')}
        colSpan={lead - 1}
      >
        {label}
      </td>
      {cells.map((v, i) => (
        <td
          key={i}
          className={cn(cell, NUM, strong ? 'text-[13.5px] font-extrabold' : 'font-bold')}
        >
          {moneyOrDash(v)}
        </td>
      ))}
      <td className={cn(cell, NUM)}>
        {/* Closing Balance ignores the toggle — it's the one figure this ledger
            always needs, not an optional detail like the per-row running balance. */}
        {balance === undefined || (!strong && !showBalance) ? null : (
          <Balance
            net={balance}
            className={strong ? 'text-[13.5px]' : undefined}
            // Only the bottom line names a nil balance; on the others a dash is right.
            nilLabel={strong ? 'Settled' : undefined}
          />
        )}
      </td>
      {trailing && <td className={cell} />}
    </tr>
  );
}

/**
 * The one-letter settlement chip this system has always used: F = fully paid,
 * P = partially paid, D = due. Kept exactly as-is — only the palette gained dark
 * variants — because it's the shorthand the ledger is read by.
 *
 * A part-paid bill additionally names the leg the money is still owed on —
 * `P (B)` / `P (C)` — but only when exactly ONE leg is open. With both still
 * open there is no single answer, so it stays a plain P rather than pick a side.
 */
function StatusChip({ status, side }: { status: string; side?: 'B' | 'C' | null }) {
  if (status === 'F')
    return (
      <span
        className="rounded bg-emerald-100 px-1.5 text-[11.5px] font-bold text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"
        title="Fully paid"
      >
        F
      </span>
    );
  if (status === 'P')
    // Pale like the other two, but sky rather than amber: the rows behind it
    // are amber-banded, so a pale amber chip would disappear into the banding.
    return (
      <span
        className="rounded bg-sky-100 px-1.5 text-[11.5px] font-bold whitespace-nowrap text-sky-700 dark:bg-sky-400/15 dark:text-sky-300"
        title={
          side
            ? `Partially paid — ${side === 'B' ? 'bank' : 'cash'} balance still pending`
            : 'Partially paid'
        }
      >
        P{side ? <span className="ml-0.5 opacity-75">({side})</span> : null}
      </span>
    );
  if (status === 'D')
    return (
      <span
        className="rounded bg-rose-100 px-1.5 text-[11.5px] font-bold text-rose-700 dark:bg-rose-400/15 dark:text-rose-300"
        title="Due"
      >
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

type Tone = 'slate' | 'muted' | 'rose' | 'amber' | 'emerald';
const toneCls: Record<Tone, string> = {
  slate: 'text-slate-800 dark:text-slate-200',
  muted: 'text-muted-foreground',
  rose: 'text-rose-600 dark:text-rose-400',
  amber: 'text-amber-600 dark:text-amber-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
};

/** Compact ageing tile — label above, figure below, count trailing. */
function Kpi({
  label,
  value,
  note,
  tone = 'slate',
}: {
  label: string;
  value: string;
  note?: string;
  tone?: Tone;
}) {
  return (
    <div className="bg-card rounded-[4px] border border-amber-200 px-2.5 py-1.5 shadow-sm dark:border-amber-400/20">
      <div className="text-[9.5px] font-bold tracking-widest text-amber-900/70 uppercase dark:text-amber-200/60">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn('truncate text-[15px] font-bold tabular-nums', toneCls[tone])}
          title={value}
        >
          {value}
        </span>
        {note && (
          <span className="text-muted-foreground shrink-0 text-[10.5px] font-medium tabular-nums">
            {note}
          </span>
        )}
      </div>
    </div>
  );
}

/** "Inv Due From" gets its own two-line tile: the date reads as the headline
 *  figure, the invoice code (and party, on a multi-party ledger) sits below as
 *  a small mono line — cramming both onto one row (the old layout) truncated
 *  the invoice code on anything but the widest screens. */
/**
 * The oldest invoice still owed anything — which is very often NOT in the table
 * underneath it.
 *
 * That is deliberate: the KPI looks past the date filter so an old unpaid bill
 * cannot hide behind it. But a headline naming a document nobody can find reads
 * as a bug, and was reported as one ("that invoice doesn't exist"). So when the
 * invoice sits outside the window, the card says so and offers to go and get it.
 */
function InvDueFromKpi({
  text,
  detail,
  onShowInvoice,
}: {
  text?: string;
  detail?: PartyLedgerKpis['invDueFromDetail'];
  onShowInvoice?: (fromISO: string) => void;
}) {
  const value = text ?? '—';
  const m = /^(.+?)\s+\((.+)\)$/.exec(value);
  const date = m ? m[1] : value;
  const ref = m ? m[2] : null;
  const outside = !!detail && !detail.inRange;
  return (
    <div
      className={cn(
        'bg-card rounded-[4px] border px-2.5 py-1.5 shadow-sm',
        outside
          ? 'border-amber-400 dark:border-amber-400/50'
          : 'border-amber-200 dark:border-amber-400/20',
      )}
    >
      <div className="text-[9.5px] font-bold tracking-widest text-amber-900/70 uppercase dark:text-amber-200/60">
        Inv Due From
      </div>
      <div className="truncate text-[15px] font-bold tabular-nums text-slate-800 dark:text-slate-200">
        {date}
      </div>
      {ref && (
        <div className="text-muted-foreground truncate text-[10.5px] font-mono font-medium">
          {ref}
        </div>
      )}
      {outside && detail && (
        <button
          type="button"
          onClick={() => onShowInvoice?.(detail.invDate)}
          title={`Raised ${formatDate(detail.invDate)}, before the dates shown. Click to widen the range back to it.`}
          className="mt-0.5 cursor-pointer text-left text-[10px] leading-tight font-semibold text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
        >
          Raised {formatDate(detail.invDate)} — before these dates. Show it
        </button>
      )}
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

/** Canvas-based PDF preview. Browser PDF plug-ins are inconsistent inside
 * dialogs, while pdf.js renders the same server PDF reliably on every page. */
function PdfCanvasPreview({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const task = getDocument({ url });
    setLoading(true);
    setError(false);
    setDocument(null);
    setPage(1);
    task.promise
      .then((pdf) => {
        if (!active) return void pdf.cleanup();
        setDocument(pdf);
        setPageCount(pdf.numPages);
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
      void task.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!document) return;
    let active = true;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
    setLoading(true);
    document
      .getPage(page)
      .then((pdfPage) => {
        if (!active || !canvasRef.current) return;
        const viewport = pdfPage.getViewport({ scale: 1.35 });
        const canvas = canvasRef.current;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        renderTask = pdfPage.render({ canvas, viewport });
        return renderTask.promise;
      })
      .then(() => active && setLoading(false))
      .catch((reason: unknown) => {
        if (active && (reason as { name?: string })?.name !== 'RenderingCancelledException')
          setError(true);
      });
    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [document, page]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-100">
      <div className="flex h-10 shrink-0 items-center justify-center gap-2 border-b bg-white px-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          title="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-24 text-center text-xs font-semibold tabular-nums">
          Page {page} of {pageCount || 1}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          disabled={!pageCount || page >= pageCount}
          title="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto p-3 sm:p-5">
        {loading && !error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100/80 text-sm font-medium text-slate-600">
            <Loader2 className="mr-2 size-4 animate-spin" /> Rendering preview…
          </div>
        )}
        {error ? (
          <div className="flex h-full items-center justify-center text-sm font-medium text-rose-600">
            Could not render the PDF preview.
          </div>
        ) : (
          <canvas ref={canvasRef} className="mx-auto h-auto max-w-full bg-white shadow-md" />
        )}
      </div>
    </div>
  );
}

/**
 * What a receipt voucher did with its money, grouped by the party that owed it.
 *
 * Grouping is the whole point for an agent receipt: the voucher is booked
 * against the agent, but the invoices belong to his parties, so a flat list
 * would never say whose debt just moved. The footer reconciles cleared + parked
 * against the voucher total, so every rupee is accounted for rather than a
 * difference being left for the reader to notice.
 */
function ClearedBreakdown({ data }: { data: LedgerClearedResult | null }) {
  if (!data) return <p className="py-3 text-sm text-muted-foreground">Could not load what this receipt cleared.</p>;
  if (!data.lines.length && !data.parked) {
    return <p className="py-3 text-sm text-muted-foreground">This receipt has no allocation recorded against it.</p>;
  }

  const byParty = new Map<string, typeof data.lines>();
  for (const l of data.lines) byParty.set(l.customerName, [...(byParty.get(l.customerName) ?? []), l]);
  // Only this voucher's OWN money reconciles against its total — clearing paid
  // for from an older advance is real but was not carried by this receipt.
  const balanced = Math.abs(data.fromReceipt + (data.parked?.amount ?? 0) - data.voucherTotal) < 0.01;

  return (
    <div className="space-y-3 py-1 text-sm">
      {[...byParty.entries()].map(([party, ls]) => (
        <div key={party}>
          <div className="flex items-baseline justify-between gap-2 border-b pb-1">
            <span className="truncate font-bold text-indigo-700 dark:text-indigo-300">{party}</span>
            <span className="text-muted-foreground shrink-0 text-[11.5px] font-semibold tabular-nums">
              {ls.length} invoice{ls.length === 1 ? '' : 's'} · ₹ {inr(ls.reduce((t, l) => t + l.amount, 0))}
            </span>
          </div>
          <ul className="mt-1 space-y-1">
            {ls.map((l, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="font-semibold tabular-nums">{l.invNo}</span>
                {l.kind === 'ADVANCE' && (
                  <span
                    className="rounded-[3px] bg-slate-100 px-1 text-[10px] font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300"
                    title={`Funded from money already on account (${l.fundedBy}) — not a second payment`}
                  >
                    ADV
                  </span>
                )}
                <span className="ml-auto shrink-0 font-semibold tabular-nums">₹ {inr(l.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="space-y-1 border-t pt-2 text-[13px]">
        <div className="flex justify-between">
          <span className="text-muted-foreground font-medium">
            {data.lines.length} invoice{data.lines.length === 1 ? '' : 's'} cleared
          </span>
          <span className="font-semibold tabular-nums">₹ {inr(data.cleared)}</span>
        </div>
        {data.fromAdvance > 0 && (
          <div className="flex justify-between text-[12px]">
            <span className="text-muted-foreground pl-3">
              of which from money already on account
            </span>
            <span className="text-muted-foreground tabular-nums">− ₹ {inr(data.fromAdvance)}</span>
          </div>
        )}
        {data.parked && (
          <div className="flex justify-between">
            <span className="text-muted-foreground font-medium">Parked on account ({data.parked.refId})</span>
            <span className="font-semibold tabular-nums">₹ {inr(data.parked.amount)}</span>
          </div>
        )}
        <div className="flex justify-between border-t pt-1 font-bold">
          <span>Receipt {data.voucherNo}</span>
          <span className="tabular-nums">
            ₹ {inr(data.voucherTotal)} {balanced && <span className="text-emerald-600 dark:text-emerald-400">✓</span>}
          </span>
        </div>
        {!balanced && (
          <p className="text-[11.5px] font-medium text-amber-700 dark:text-amber-300">
            ₹ {inr(Math.abs(data.voucherTotal - data.fromReceipt - (data.parked?.amount ?? 0)))} of this voucher could
            not be traced to an invoice or an advance.
          </p>
        )}
      </div>
    </div>
  );
}

function ReceiptDialog({ row, mode, onClose }: { row: PartyLedgerRow | null; mode: string; onClose: () => void }) {
  const [lines, setLines] = useState<LedgerReceiptLine[] | null>(null);
  const [cleared, setCleared] = useState<LedgerClearedResult | null>(null);
  const [loading, setLoading] = useState(false);
  // A receipt row asks the opposite question of an invoice row: not "what paid
  // this bill" but "whose bills did this money pay".
  const isReceipt = (row?.voucherType ?? '').toUpperCase() === 'RECEIPT';
  useEffect(() => {
    if (!row) return;
    setLoading(true);
    setLines(null);
    setCleared(null);
    const done = () => setLoading(false);
    if ((row.voucherType ?? '').toUpperCase() === 'RECEIPT') {
      fetchLedgerCleared(row.voucherNo).then(setCleared).catch(() => setCleared(null)).finally(done);
    } else {
      fetchLedgerReceipts(row.voucherNo, mode).then(setLines).catch(() => setLines([])).finally(done);
    }
  }, [row, mode]);

  const verb = (t: string) =>
    t === 'CREDIT NOTE' ? 'Cleared' : t === 'ADVANCE' ? 'Adjusted' : 'Paid';
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={isReceipt ? 'max-w-lg' : 'max-w-md'}>
        <DialogHeader>
          <DialogTitle>
            {row?.voucherType} —{' '}
            <span className="font-semibold tabular-nums">{row?.voucherNo}</span>
          </DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground -mt-2 text-sm">{row?.particulars}</p>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading{isReceipt ? ' allocation' : ' receipts'}…
          </div>
        ) : isReceipt ? (
          <ClearedBreakdown data={cleared} />
        ) : lines && lines.length ? (
          <ul className="space-y-1.5 py-1 text-sm">
            {lines.map((l, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-amber-500" />
                <span
                  className={cn(
                    'rounded-[3px] px-1 text-[10px] font-bold',
                    l.bucket === 'B'
                      ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300',
                  )}
                  title={l.bucket === 'B' ? 'Settled the bank side' : 'Settled the cash side'}
                >
                  {l.bucket}
                </span>
                {verb(l.recType)} on {prettyDate(l.recDate)} vide{' '}
                <span className="font-semibold">{l.refRecId || '?'}</span>
                {l.recAmt > 0 && (
                  <span className="ml-auto tabular-nums font-semibold">₹ {inr(l.recAmt)}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-3 text-sm text-muted-foreground">
            {mode === 'BOTH'
              ? 'No payments / clearances recorded yet.'
              : `No ${mode === 'B' ? 'bank' : 'cash'} payments against this invoice. Switch to Both to see the other side.`}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
