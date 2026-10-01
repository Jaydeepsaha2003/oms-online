import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileSpreadsheet,
  Keyboard,
  Loader2,
  Pin,
  Printer,
  SlidersHorizontal,
  Target,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { LEDGER_DUE_FILTERS, LEDGER_EXPORT_COLUMNS } from '@oms/shared';
import type {
  DueFromCalc,
  LedgerBalanceRow,
  LedgerClearedResult,
  LedgerDueFilter,
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
import type { ComboboxOption } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { fetchLedgerCleared, fetchLedgerReceipts, usePartyLedger, usePartyLedgerLookups } from './use-party-ledger';
import { DemandPlanDialog } from '@/features/crm/demand-plan-dialog';

const inr = (v: number) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
GlobalWorkerOptions.workerSrc = pdfWorker;

/** The export columns last picked, remembered per browser. */
const EXPORT_COLS_KEY = 'oms.party-ledger.export-cols';
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

/* ── The Party Ledger skin ───────────────────────────────────────────────────
   The look lives in index.css (`.pl-*`, the Party Ledger mockup); what is here
   is what the rows need to choose between: a rail colour per row, the voucher
   type's own colour, the ageing tiles and the text-size steps. */

/** A voucher type's colour, where its settlement state has nothing to add. */
const VT_RAIL: Record<string, string> = {
  'SALES INVOICE': '#6366f1',
  RECEIPT: '#10b981',
  'CREDIT NOTE': '#f59e0b',
  'DEBIT NOTE': '#f43f5e',
};
/** The rail down a row's left edge: what is owed on it first, its type second. */
const railOf = (r: PartyLedgerRow) =>
  r.status === 'D' && /Over/i.test(r.dueFrom)
    ? '#e11d48'
    : r.status === 'P'
      ? '#0ea5e9'
      : r.status === 'F'
        ? '#10b981'
        : (VT_RAIL[r.voucherType.toUpperCase()] ?? '#94a3b8');
/** "SALES INVOICE" → "Sales Invoice", as the mockup sets the type column. */
const vtLabel = (vt: string) => vt.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The three ageing tiles. The hints say what the buckets actually are — the
 * shared rule (`classifyDueType`) Receive Payment uses too: over is past the
 * due date, past due is not yet due but under half the credit period left.
 */
const AGEING = [
  { key: 'overDue', due: 'OVERDUE', label: 'Over due', dot: '#e11d48', fg: 'text-rose-700 dark:text-rose-400', bar: 'linear-gradient(90deg,#fb7185,#e11d48)', hint: 'past the due date' },
  { key: 'pastDue', due: 'PAST DUE', label: 'Past due', dot: '#f59e0b', fg: 'text-amber-700 dark:text-amber-400', bar: 'linear-gradient(90deg,#fcd34d,#f59e0b)', hint: 'under half the credit left' },
  { key: 'normal', due: 'NORMAL', label: 'Normal due', dot: '#10b981', fg: 'text-emerald-700 dark:text-emerald-400', bar: 'linear-gradient(90deg,#6ee7b7,#10b981)', hint: 'within terms' },
] as const;

/** The Due type choices, labelled for the combo. */
const DUE_OPTIONS: ComboboxOption[] = LEDGER_DUE_FILTERS.map((f) => ({ value: f.value, label: f.label }));
const dueLabelOf = (v: string) => LEDGER_DUE_FILTERS.find((f) => f.value === v)?.label ?? v;

/** The keys that walk the ledger's rows, and how far each one moves. */
const ROW_STEP: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 };
const ROW_KEYS = new Set([...Object.keys(ROW_STEP), 'Home', 'End']);
/** Focus a row and bring it into view clear of the sticky header and foot
 *  (their room is the row's scroll-margin in index.css). */
const goToRow = (row: HTMLElement) => {
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: 'nearest' });
};

/** Text size for the ledger (A · A · A), remembered per device. */
const ZOOM_KEY = 'oms:ledger-zoom';
const ZOOMS = [
  { z: 1, fs: '13px', label: 'Normal text size' },
  { z: 1.12, fs: '15px', label: 'Larger text' },
  { z: 1.25, fs: '17px', label: 'Largest text' },
] as const;
const readZoom = (): number => {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return ZOOMS.some((step) => step.z === z) ? z : 1;
  } catch {
    return 1; // storage blocked — the normal size
  }
};

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
      <span className={cn('font-extrabold tabular-nums text-[#047857] dark:text-emerald-400', className)}>
        0<span className="ml-1 text-[10px] font-extrabold opacity-70">{nilLabel}</span>
      </span>
    ) : (
      <span className="text-[#c3c9d6] dark:text-slate-600">—</span>
    );
  }
  const cr = net < 0;
  return (
    <span
      className={cn(
        'tabular-nums font-extrabold whitespace-nowrap',
        cr ? 'text-[#047857] dark:text-emerald-400' : 'text-[#141a2b] dark:text-slate-100',
        className,
      )}
    >
      {inr(Math.abs(net))}
      <span className="ml-1 text-[10px] font-extrabold opacity-70">{cr ? 'Cr' : 'Dr'}</span>
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
    dueType: get('due', '') as LedgerDueFilter | '',
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
    if (changes.dueType !== undefined) write('due', changes.dueType);
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
  const { party, agent, from, to, mode, voucherType, dueType, preset, showBalance, patch, clear } =
    useLedgerFilters();
  const [receiptFor, setReceiptFor] = useState<PartyLedgerRow | null>(null);
  /** Which period chip has its picker open — the desktop bar's or the phone's. */
  const [dateOpen, setDateOpen] = useState<'d' | 'm' | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  /** The desktop row that holds the tab stop; ↑ / ↓ move it, as in a grid. */
  const [focusRow, setFocusRow] = useState(0);
  const [zoom, setZoom] = useState(readZoom);
  const pickZoom = (z: number) => {
    setZoom(z);
    try {
      localStorage.setItem(ZOOM_KEY, String(z));
    } catch {
      /* storage blocked — the size holds for this visit */
    }
  };

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
      dueType: dueType || undefined,
    }),
    [party, agent, from, to, mode, voucherType, dueType, custByName],
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
  /** True when the filter's TO date is before today, so the closing balance is a
   *  historical position rather than "where this party stands now". */
  const windowEndsInPast = to < ymd(new Date());

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
    if (q.dueType) params.set('dueType', q.dueType);
    if (exportCols.length < LEDGER_EXPORT_COLUMNS.length) params.set('cols', exportCols.join(','));
    return `/party-ledger/export.${fmt}?${params.toString()}`;
  };
  /** Which file the column picker is open for; the file is built on Done. */
  const [exportAsk, setExportAsk] = useState<'pdf' | 'xlsx' | null>(null);
  const [exportCols, setExportCols] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(EXPORT_COLS_KEY) ?? 'null');
      if (Array.isArray(saved) && saved.length) return saved;
    } catch {
      /* storage blocked — start with every column */
    }
    return LEDGER_EXPORT_COLUMNS.map((c) => c.key);
  });
  const textPicked = exportCols.some((k) => k !== 'dr' && k !== 'cr');
  const moneyPicked = exportCols.includes('dr') || exportCols.includes('cr');
  const exportDone = () => {
    try {
      localStorage.setItem(EXPORT_COLS_KEY, JSON.stringify(exportCols));
    } catch {
      /* not remembered — still exported */
    }
    const fmt = exportAsk;
    setExportAsk(null);
    if (fmt === 'pdf') void onPdf();
    else void onExcel();
  };
  const [pdfLoading, setPdfLoading] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
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
    data?.customerName || data?.groupName || (data?.agentName ? `Agent-${data.agentName}` : 'All-Parties'),
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
  // "/" jumps to the customer filter and "?" lists the shortcuts — never while
  // typing in a field or with a dialog up, where both are ordinary keys. The
  // row keys work from anywhere too: with nothing focused, the first press
  // lands on the grid (where rowKey takes over) instead of doing nothing until
  // a row has been clicked.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (ROW_KEYS.has(event.key) && !target?.closest('[data-lrow], button, a, [role="combobox"], [role="listbox"]')) {
        const rows = [...document.querySelectorAll<HTMLElement>('[data-lrow]')].filter((el) => el.offsetParent);
        const row = event.key === 'End' ? rows[rows.length - 1] : event.key === 'Home' ? rows[0] : rows.find((el) => el.tabIndex === 0) ?? rows[0];
        if (!row) return; // a phone: cards, no grid to walk
        event.preventDefault();
        goToRow(row);
        return;
      }
      if (event.key === '/') {
        const field = [...document.querySelectorAll<HTMLInputElement>('#pl-customer, #pl-customer-m')].find((el) => el.offsetParent);
        if (!field) return;
        event.preventDefault();
        field.focus();
      } else if (event.key === '?') {
        event.preventDefault();
        setKeysOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  /** The running balance as the Total Outstanding tile's trend line: the
   *  opening, then every row, so it ends on the closing figure. */
  const spark = useMemo(() => {
    if (!running || running.length < 2 || openingNet == null) return null;
    const pts = [openingNet, ...running];
    const min = Math.min(...pts);
    const span = Math.max(...pts) - min || 1;
    return pts
      .map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * 120).toFixed(1)},${(27 - ((v - min) / span) * 24).toFixed(1)}`)
      .join(' ');
  }, [running, openingNet]);

  /** ↑ / ↓ walk the desktop rows, Page Up / Down ten at a time, Home / End to
   *  either end; Enter or Space opens one that has detail. */
  const rowKey = (e: React.KeyboardEvent<HTMLElement>, r: PartyLedgerRow, openable: boolean) => {
    if (e.target !== e.currentTarget) return;
    if (ROW_KEYS.has(e.key)) {
      const all = [...document.querySelectorAll<HTMLElement>('[data-lrow]')];
      const at = all.indexOf(e.currentTarget);
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : Math.max(0, Math.min(all.length - 1, at + (ROW_STEP[e.key] ?? 0)));
      if (to === at || !all[to]) return;
      e.preventDefault();
      goToRow(all[to]);
    } else if ((e.key === 'Enter' || e.key === ' ') && openable) {
      e.preventDefault();
      setReceiptFor(r);
    }
  };
  const rowStop = Math.min(focusRow, Math.max(0, rows.length - 1));

  /** Opening / Current / Closing share one row shape across the grid. */
  const balanceCells = (b: LedgerBalanceRow) => legs.flatMap((l) => [b[l.dr], b[l.cr]]);
  /** Text columns before the figures: Date, Particulars, Vch Type, Vch No, St, Due From. */
  const LEAD_COLS = 6;
  /** The eye column, for rows backed by a challan or a note. */
  const viewCol = canViewChallan || canViewNote;
  const totalCols = LEAD_COLS + legs.length * 2 + 1 + (viewCol ? 1 : 0);

  const dateLabel = preset || `${prettyDate(from)} → ${prettyDate(to)}`;
  const scopeLabel = data
    ? data.scope === 'CUSTOMER'
      ? data.customerName
      : data.scope === 'AGENT'
        ? `Agent: ${data.agentName}`
        : data.scope === 'GROUP'
          ? `${data.groupName} (combined)`
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
              'cursor-pointer rounded-[9px] px-2 py-1.5 text-[12px] font-bold transition-colors',
              preset === p
                ? 'bg-gradient-to-b from-[#5b7cff] to-[#3b4fd8] text-white shadow-sm'
                : 'text-[#3a4256] hover:bg-[#f1f4fb] dark:text-slate-300 dark:hover:bg-white/5',
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
        <button type="button" className="pl-btn pl-btn-primary h-8 shrink-0 px-4" onClick={() => setDateOpen(null)}>
          Done
        </button>
      </div>
    </div>
  );

  const modeLabel = mode === 'BOTH' ? 'Bank & Cash' : mode === 'B' ? 'Bank' : 'Cash';
  /** Filters that live in the phone's sheet, counted on its button. */
  const sheetFilters = [agent && agent !== 'All', voucherType, dueType].filter(Boolean).length;
  /** What a partial list is limited to, for the Current Total line. */
  const onlyLabel = [voucherType, dueType && dueLabelOf(dueType)].filter(Boolean).join(' · ');
  /** An agent's or an all-parties ledger: each row says whose entry it is. */
  const multiParty = !!data && data.scope !== 'CUSTOMER';
  const pendingTotal = kpis ? kpis.overDue.amount + kpis.pastDue.amount + kpis.normal.amount : 0;
  const canPlan = query.customerId != null && can('payment:view');
  const outstandingNote =
    closingNet == null && footer ? 'clear the filters' : windowEndsInPast ? `as at ${formatDate(to)}` : undefined;

  /* ── Controls, shared by the desktop bar and the phone's filter card ── */
  const onParty = (v: string) => patch({ party: v, ...(v ? { agent: '' } : {}) });
  const onAgent = (v: string) => patch({ agent: v, ...(v ? { party: '' } : {}) });
  const agentList = agentOptions.filter((a) => a !== 'All');

  const periodButton = (where: 'd' | 'm') => (
    <Popover open={dateOpen === where} onOpenChange={(o) => setDateOpen(o ? where : null)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          // Never narrower than a full "01-04-2026 → 27-09-2026": which dates the
          // statement covers is not something to truncate.
          className={cn('pl-period', where === 'd' ? 'w-[256px] flex-none' : 'min-w-0 flex-1')}
          title="Statement period"
        >
          <CalendarRange className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{dateLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto rounded-[16px] p-3">
        {datePanel}
      </PopoverContent>
    </Popover>
  );

  /** Bank / Cash / Both — the ledger's column groups follow this. */
  const modeSeg = (grow: boolean) => (
    <div role="group" aria-label="Transaction mode" className={cn('pl-seg', grow && 'flex-1 [&>button]:flex-1')}>
      {(['BOTH', 'B', 'C'] as const).map((m) => (
        <button key={m} type="button" onClick={() => patch({ mode: m })} aria-pressed={mode === m} className="pl-seg-btn">
          {m === 'BOTH' ? 'Both' : m === 'B' ? 'Bank' : 'Cash'}
        </button>
      ))}
    </div>
  );

  const zoomSeg = (
    <div role="group" aria-label="Text size" className="pl-seg pl-seg-soft">
      {ZOOMS.map((step) => (
        <button
          key={step.z}
          type="button"
          aria-pressed={zoom === step.z}
          aria-label={step.label}
          title={step.label}
          onClick={() => pickZoom(step.z)}
          className="pl-seg-btn"
          style={{ fontSize: step.fs }}
        >
          A
        </button>
      ))}
    </div>
  );

  /* Off by default — the running Balance per transaction is a detail most
     glances at the ledger don't need; Closing Balance always shows regardless.
     Disabled under a voucher-type filter: with no opening to seed from there is
     no running balance to show. */
  const balanceSwitch = (
    <Switch checked={showBalance && !!running} onCheckedChange={(v) => patch({ showBalance: v })} disabled={!running} />
  );
  const balanceTitle = running ? undefined : 'Clear the voucher type and due type filters to see running balances';

  const pdfButton = canPrintLedger && (
    <button
      type="button"
      className="pl-btn pl-btn-sq pl-btn-rose"
      onClick={() => setExportAsk('pdf')}
      disabled={!rows.length || pdfLoading}
      aria-label="Open Party Ledger PDF"
      title="Open PDF (Ctrl+P)"
    >
      {pdfLoading ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
    </button>
  );
  const excelButton = can('partyledger:export') && (
    <button
      type="button"
      className="pl-btn pl-btn-sq pl-btn-emerald"
      onClick={() => setExportAsk('xlsx')}
      disabled={!rows.length || excelLoading}
      aria-label="Download Party Ledger Excel"
      title="Download Excel"
    >
      {excelLoading ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
    </button>
  );

  /** A row's own document: a note opens its note bill, anything else backed by
   *  a Challan opens the challan bill. */
  const viewTarget = (r: PartyLedgerRow) => {
    const note = noteRefOf(r);
    if (note && canViewNote)
      return { label: `View ${note.label} ${r.voucherNo}`, short: `View ${note.mode === 'CREDIT' ? 'credit' : 'debit'} note`, go: () => viewNote(r, note.mode) };
    if (isOpenableRow(r) && r.challanId && canViewChallan)
      return { label: `View challan ${r.voucherNo}`, short: 'View challan', go: () => viewChallan(r) };
    return null;
  };

  return (
    // Fills the viewport exactly: filters + figures pinned on top, the ledger the
    // only scrolling region, and the Closing Balance stuck to the bottom of the
    // grid. `/account/party-ledger` is a flush route (see app-shell) so the page
    // owns its own padding. Phones: filters + cards fill the screen, so the page
    // itself scrolls and the ledger flows below them.
    <div className="pl-page flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto overscroll-contain p-2.5 sm:overflow-visible sm:p-3">
      {/* ── Filters: one bar on desktop ── */}
      <section aria-label="Ledger filters" className="pl-glass hidden shrink-0 flex-wrap items-center gap-[7px] p-2 sm:flex">
        {/* Wider than the others: party names run long, and this is the one filter
            the statement is named after. */}
        <PlSelect id="pl-customer" label="Customer" value={party} onChange={onParty} options={partyOptions} className="max-w-[320px] flex-[2_1_220px]" />
        <PlSelect label="Agent" value={agent === 'All' ? '' : agent} onChange={onAgent} options={agentList} className="max-w-[180px] flex-[1_1_150px]" />
        {periodButton('d')}
        <PlSelect label="Voucher type" value={voucherType} onChange={(v) => patch({ voucherType: v })} options={data?.voucherTypes ?? []} className="max-w-[190px] flex-[1_1_150px]" />
        <PlSelect label="Due type" value={dueType} onChange={(v) => patch({ dueType: v as LedgerDueFilter | '' })} options={DUE_OPTIONS} className="max-w-[170px] flex-[1_1_140px]" />
        {modeSeg(false)}
        <label
          className={cn('flex h-[38px] items-center gap-2 px-1.5 text-[12.5px] font-extrabold select-none', running ? 'cursor-pointer' : 'cursor-not-allowed opacity-50')}
          title={balanceTitle}
        >
          {balanceSwitch} Show balance
        </label>
        <button type="button" className="pl-btn" onClick={onReset}>
          <X className="size-3.5" /> Reset
        </button>
        <span className="flex-1" aria-hidden />
        {/* How many rows the statement has — the only way to know how much
            there is below the fold. */}
        {data && (
          <span className="pl-muted flex items-center gap-1.5 text-[12px] font-semibold whitespace-nowrap">
            <strong className="text-[#141a2b] tabular-nums dark:text-white">{rows.length}</strong> row{rows.length === 1 ? '' : 's'}
            {isFetching && <Loader2 className="size-3 animate-spin" />}
          </span>
        )}
        {zoomSeg}
        <button type="button" className="pl-btn pl-btn-sq" onClick={() => setKeysOpen(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          <Keyboard className="size-4" />
        </button>
        {canPlan && (
          <button type="button" className="pl-btn pl-btn-indigo" onClick={() => setPlanOpen(true)} title="How much to ask for, to a target average age">
            Demand plan
          </button>
        )}
        {pdfButton}
        {excelButton}
      </section>

      {/* ── Filters: a card on a phone, the rest in a sheet ── */}
      <section aria-label="Ledger filters" className="pl-glass pl-tall flex shrink-0 flex-col gap-[7px] p-2 sm:hidden">
        <PlSelect id="pl-customer-m" label="Customer" value={party} onChange={onParty} options={partyOptions} />
        <div className="flex gap-[7px]">
          {periodButton('m')}
          <button type="button" className="pl-btn pl-btn-sq relative" onClick={() => setFiltersOpen(true)} aria-label="More filters" title="More filters">
            <SlidersHorizontal className="size-[18px]" />
            {sheetFilters > 0 && <span className="pl-badge">{sheetFilters}</span>}
          </button>
        </div>
        <div className="flex items-center gap-[7px]">
          {modeSeg(true)}
          {canPlan && (
            <button type="button" className="pl-btn pl-btn-sq pl-btn-indigo" onClick={() => setPlanOpen(true)} aria-label="Demand plan" title="Demand plan">
              <Target className="size-[18px]" />
            </button>
          )}
          {pdfButton}
          {excelButton}
        </div>
      </section>

      {planOpen && query.customerId != null && (
        <DemandPlanDialog open onOpenChange={setPlanOpen} customerId={query.customerId} partyName={party} defaultSide={mode === 'C' ? 'C' : 'B'} />
      )}

      {/* ── Figures: a grid on desktop, a swipeable rail on a phone ── */}
      <section aria-label="Ageing summary" className="pl-rail">
        <InvDueFromKpi
          text={kpis?.invDueFrom}
          detail={kpis?.invDueFromDetail}
          // Widen the FROM date back to the invoice; the TO end is left alone so
          // nothing currently on screen disappears.
          onShowInvoice={(iso) => patch({ from: iso.slice(0, 10), preset: '' })}
        />
        <div className="pl-kpi pl-kpi-blue">
          <span className="pl-kpi-label flex-wrap gap-y-1">
            <span className="whitespace-nowrap">Total outstanding</span>
            {/* Say WHEN this figure is from. On a window ending in the past, the
                ageing tiles and every row's status are as at that same day. */}
            {outstandingNote && (
              <span className="rounded-full bg-white/20 px-[7px] py-px text-[9.5px] tracking-[0.04em] whitespace-nowrap normal-case">{outstandingNote}</span>
            )}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[22px] font-extrabold tracking-[-0.01em] tabular-nums">{closingNet != null ? inr(Math.abs(closingNet)) : '—'}</span>
            {closingNet != null && (
              <span className={cn('rounded-full px-[7px] py-px text-[11.5px] font-extrabold', closingNet < 0 ? 'bg-[#b9f6dc] text-[#047857]' : 'bg-white/95 text-[#2f3fb5]')}>
                {closingNet > 0 ? 'Dr' : closingNet < 0 ? 'Cr' : 'Settled'}
              </span>
            )}
          </span>
          <div className="mt-0.5 h-[30px] w-full">
            {spark && (
              <svg
                key={`${party}|${from}|${to}|${mode}`}
                viewBox="0 0 120 30"
                preserveAspectRatio="none"
                className="block h-[30px] w-full overflow-visible"
                role="img"
                aria-label="Running balance trend over the period"
              >
                <defs>
                  <linearGradient id="pl-spark" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fff" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#fff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path d={`${spark} L120,30 L0,30 Z`} fill="url(#pl-spark)" className="pl-spark-fill" />
                <path
                  d={spark}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  pathLength={1}
                  className="pl-spark-line"
                />
              </svg>
            )}
          </div>
        </div>
        {AGEING.map((a) => {
          const k = kpis?.[a.key];
          const share = k && pendingTotal > 0 ? (k.amount / pendingTotal) * 100 : 0;
          const on = dueType === a.due;
          return (
            // Each tile is also its Due type filter: tap Over due to see those bills.
            <button
              key={a.key}
              type="button"
              className="pl-kpi pl-kpi-pick gap-[3px] text-left"
              data-on={on}
              aria-pressed={on}
              title={on ? 'Show every bill again' : `Show only the ${a.label.toLowerCase()} bills`}
              onClick={() => patch({ dueType: on ? '' : a.due })}
            >
              <span className="pl-kpi-label">
                <span className="pl-kpi-dot" style={{ background: a.dot, boxShadow: `0 0 0 3px ${a.dot}26` }} />
                {a.label}
              </span>
              <span className="flex items-baseline gap-[7px]">
                <span className={cn('text-[19px] font-extrabold tabular-nums', a.fg)}>{k ? inr(k.amount) : '—'}</span>
                {k && <span className="pl-muted text-[11.5px] font-bold">{k.count} inv</span>}
              </span>
              <span className="pl-kpi-track" role="img" aria-label={`${a.label}: ${Math.round(share)}% of what is pending`}>
                <span style={{ width: `${share}%`, background: a.bar }} />
              </span>
              <span className="pl-kpi-hint">{a.hint}</span>
            </button>
          );
        })}
      </section>

      {/* ── The ledger ── */}
      <section aria-label="Ledger" className="pl-ledger flex flex-none flex-col sm:min-h-0 sm:flex-1">
        {/* The statement's caption: which account, which dates, which side of
            the book — part of the figures, so it shows on phones too. */}
        <div className="pl-docbar">
          <span className="pl-docbar-dot hidden sm:block" aria-hidden />
          <span className="pl-docbar-title flex-1 sm:flex-none sm:truncate">{scopeLabel || 'Ledger account'}</span>
          <span className="pl-docbar-period">
            {prettyDate(from)} — {prettyDate(to)} · {modeLabel}
          </span>
        </div>

        {/* Desktop: the grid. Only this region scrolls; the heading rows stay
            pinned at the top and the Closing Balance at the bottom. */}
        <div className="hidden min-h-0 flex-1 overflow-auto overscroll-x-contain [scrollbar-width:thin] sm:block">
          <table className="pl-table min-w-[880px]" style={{ zoom }}>
            <caption className="sr-only">
              Party ledger for {scopeLabel} from {prettyDate(from)} to {prettyDate(to)}
            </caption>
            <thead>
              {grouped && (
                <tr>
                  <th className="pl-th pl-th-group top-0" colSpan={LEAD_COLS} />
                  {legs.map((l) => (
                    <th key={l.group} className="pl-th pl-th-group top-0 text-center" colSpan={2} scope="colgroup">
                      <span className="pl-th-key" style={{ background: l === BANK_LEG ? '#2c4fd0' : '#34d399' }} />
                      {l.group}
                    </th>
                  ))}
                  <th className="pl-th pl-th-group top-0" colSpan={1 + (viewCol ? 1 : 0)} />
                </tr>
              )}
              <tr>
                {['Date', 'Particulars', 'Vch Type', 'Vch No'].map((h) => (
                  <th key={h} scope="col" className={cn('pl-th text-left', grouped ? 'top-7' : 'top-0')}>
                    {h}
                  </th>
                ))}
                {/* Settlement state (P/D/F) then the ageing, both sitting right after
                    the voucher number where they're read together. */}
                <th scope="col" title="Settlement: F = fully paid, P = partially paid, D = due" className={cn('pl-th w-10 text-center', grouped ? 'top-7' : 'top-0')}>
                  St
                </th>
                <th scope="col" className={cn('pl-th text-left', grouped ? 'top-7' : 'top-0')}>
                  Due From
                </th>
                {legs.flatMap((l) =>
                  ['Debit', 'Credit'].map((side) => (
                    <th key={`${l.group}-${side}`} scope="col" className={cn('pl-th text-right', grouped ? 'top-7' : 'top-0')}>
                      {grouped ? side : `${l.group} ${side}`}
                    </th>
                  )),
                )}
                <th scope="col" className={cn('pl-th text-right', grouped ? 'top-7' : 'top-0')}>
                  Balance
                </th>
                {viewCol && <th scope="col" className={cn('pl-th w-12', grouped ? 'top-7' : 'top-0')} aria-label="View" />}
              </tr>
            </thead>

            <tbody>
              {isFetching && !data ? (
                <tr>
                  <td colSpan={totalCols} className="pl-muted h-24 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={totalCols} className="pl-muted h-28 text-center text-[13.5px] font-semibold">
                    No ledger entries for these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => {
                  const openable = isOpenableRow(r);
                  const view = viewTarget(r);
                  return (
                    <tr
                      key={`${r.voucherNo}-${r.txnDate}-${i}`}
                      data-lrow
                      data-open={openable}
                      // One tab stop for the grid; ↑ / ↓ move it (see rowKey).
                      tabIndex={i === rowStop ? 0 : -1}
                      role={openable ? 'button' : undefined}
                      aria-label={
                        openable ? (isInvoiceRow(r) ? `Receipts against ${r.voucherNo}` : `Invoices cleared by ${r.voucherNo}`) : undefined
                      }
                      onFocus={() => setFocusRow(i)}
                      onClick={openable ? () => setReceiptFor(r) : undefined}
                      onKeyDown={(e) => rowKey(e, r, openable)}
                      className="pl-tr"
                      style={{ '--rail': railOf(r), animationDelay: `${Math.min(i, 18) * 24}ms` } as CSSProperties}
                    >
                      <td className="pl-td font-bold whitespace-nowrap text-[#3a4256] tabular-nums dark:text-slate-300">{prettyDate(r.txnDate)}</td>
                      <td className="pl-td font-bold text-[#1d2438] dark:text-slate-100">
                        {r.particulars}
                        {multiParty && <span className="pl-muted block text-[11px] font-semibold">{r.customerName}</span>}
                      </td>
                      <td className="pl-td pl-muted text-[12px] font-semibold whitespace-nowrap">{vtLabel(r.voucherType)}</td>
                      <td className="pl-td">
                        <span className="pl-vno" data-link={openable}>
                          {r.voucherNo}
                        </span>
                      </td>
                      <td className="pl-td text-center">
                        <StatusChip status={r.status} side={mode === 'BOTH' ? r.pendingSide : null} />
                      </td>
                      <td className="pl-td whitespace-nowrap">
                        <DueFrom text={r.dueFrom} calc={r.dueFromCalc} />
                      </td>
                      {legs.flatMap((l) => [
                        <td key={`${l.group}-dr`} className="pl-td text-right font-bold whitespace-nowrap text-[#141a2b] tabular-nums dark:text-slate-100">
                          {money(r[l.dr])}
                          {/* A part-paid bill: what is still owed — the figure the
                              ageing tiles add up, so the two can be checked by eye. */}
                          {r.status === 'P' && r.pendingAmount > 0 && !!r[l.dr] && (!grouped || r.pendingSide === (l === BANK_LEG ? 'B' : 'C')) && (
                            <div className="text-[10.5px] font-extrabold text-[#0369a1] dark:text-sky-300">{money(r.pendingAmount)} due</div>
                          )}
                        </td>,
                        <td key={`${l.group}-cr`} className="pl-td text-right font-bold whitespace-nowrap text-[#047857] tabular-nums dark:text-emerald-400">
                          {money(r[l.cr])}
                        </td>,
                      ])}
                      <td className="pl-td text-right">{showBalance && running && <Balance net={running[i]} />}</td>
                      {viewCol && (
                        <td className="pl-td text-center" onClick={(e) => e.stopPropagation()}>
                          {view && (
                            <button type="button" onClick={view.go} className="pl-eye" title={view.label} aria-label={view.label}>
                              <Eye className="size-4" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Opening balance + current total + closing balance ride together at
                the foot of the grid and stay visible while the body scrolls. */}
            {footer && (
              <tfoot className="pl-sticky-foot">
                {footer.opening && (
                  <FootRow
                    kind="open"
                    label="Opening Balance"
                    cells={balanceCells(footer.opening)}
                    lead={LEAD_COLS}
                    trailing={viewCol}
                    balance={openingNet ?? undefined}
                    showBalance={showBalance}
                  />
                )}
                {/* Under a voucher-type filter this is the only honest line left, so it
                    carries the filter in its label and takes the bottom-line styling. */}
                <FootRow
                  kind={footer.closing ? 'current' : 'close'}
                  label={footer.closing ? 'Current Total' : `Current Total · ${onlyLabel} only`}
                  cells={balanceCells(footer.current)}
                  lead={LEAD_COLS}
                  trailing={viewCol}
                />
                {footer.closing && closingNet != null && (
                  <FootRow
                    kind="close"
                    label="Closing Balance"
                    cells={balanceCells(footer.closing)}
                    lead={LEAD_COLS}
                    trailing={viewCol}
                    balance={closingNet}
                  />
                )}
              </tfoot>
            )}
          </table>
        </div>

        {/* Phones: one card per voucher — the grid is unusable at this width. */}
        <div className="flex flex-col gap-2 p-2 sm:hidden" style={{ zoom }}>
          {isFetching && !data ? (
            <div className="pl-muted flex h-24 items-center justify-center">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="pl-muted px-3 py-9 text-center text-[13px] font-semibold">No ledger entries for these filters.</p>
          ) : (
            rows.map((r, i) => {
              const openable = isOpenableRow(r);
              const view = viewTarget(r);
              return (
                <div
                  key={`${r.voucherNo}-${r.txnDate}-${i}`}
                  role={openable ? 'button' : undefined}
                  tabIndex={openable ? 0 : undefined}
                  data-open={openable}
                  aria-label={openable ? (isInvoiceRow(r) ? `Receipts against ${r.voucherNo}` : `Invoices cleared by ${r.voucherNo}`) : undefined}
                  onClick={openable ? () => setReceiptFor(r) : undefined}
                  onKeyDown={
                    openable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setReceiptFor(r);
                          }
                        }
                      : undefined
                  }
                  className="pl-card"
                  style={{ '--rail': railOf(r), animationDelay: `${Math.min(i, 18) * 24}ms` } as CSSProperties}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] leading-tight font-extrabold">{r.particulars}</div>
                      {multiParty && <div className="pl-muted text-[11px] font-semibold">{r.customerName}</div>}
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="pl-muted text-[11.5px] font-semibold">{vtLabel(r.voucherType)}</span>
                        <span className="text-[#c3c9d6]" aria-hidden>
                          ·
                        </span>
                        <span className="pl-vno text-[11.5px]" data-link={openable}>
                          {r.voucherNo}
                        </span>
                      </div>
                    </div>
                    <span className="pl-muted text-[11.5px] font-bold whitespace-nowrap tabular-nums">{prettyDate(r.txnDate)}</span>
                  </div>
                  {(r.status || r.dueFrom) && (
                    <div className="mt-[7px] flex items-center gap-1.5">
                      <StatusChip status={r.status} side={mode === 'BOTH' ? r.pendingSide : null} />
                      <DueFrom text={r.dueFrom} calc={r.dueFromCalc} />
                    </div>
                  )}
                  <div className="pl-card-sum mt-2 flex items-end gap-2.5 pt-2">
                    {/*
                     * EVERY leg, including the empty ones — a bank-only row that
                     * simply had no cash figures on it could not be told apart
                     * from a card that is not showing cash. A dash for nil,
                     * matching the grid's own empty cell, so the two read alike.
                     */}
                    <div className="grid flex-1 grid-cols-2 gap-x-3.5 gap-y-[3px]">
                      {legs.flatMap((l) =>
                        (['dr', 'cr'] as const).map((side) => {
                          const v = r[l[side]];
                          return (
                            <span key={`${l.group}-${side}`} className="flex items-baseline justify-between gap-1.5">
                              <span className="pl-mlabel">{grouped ? `${l.group} ${side === 'dr' ? 'Dr' : 'Cr'}` : side === 'dr' ? 'Dr' : 'Cr'}</span>
                              <span
                                className={cn(
                                  'text-[12.5px] font-extrabold tabular-nums',
                                  !v ? 'text-[#c3c9d6] dark:text-slate-600' : side === 'cr' ? 'text-[#047857] dark:text-emerald-400' : 'text-[#141a2b] dark:text-slate-100',
                                )}
                              >
                                {moneyOrDash(v)}
                              </span>
                            </span>
                          );
                        }),
                      )}
                    </div>
                    {showBalance && running && <Balance net={running[i]} className="shrink-0 text-[13px]" />}
                  </div>
                  {view && (
                    <div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="pl-view" onClick={view.go} aria-label={view.label}>
                        {view.short}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
          {/* All 3 summary rows grouped at the bottom, in statement order. */}
          {footer && (
            <div className="pl-mfoot">
              {footer.opening && (
                <div className="pl-mfoot-row flex items-center justify-between gap-2.5">
                  <span className="pl-mfoot-label">Opening Balance</span>
                  <span className="text-[12.5px] font-extrabold tabular-nums">{balanceCells(footer.opening).map((v) => moneyOrDash(v)).join('  /  ')}</span>
                </div>
              )}
              <div className="pl-mfoot-row flex items-center justify-between gap-2.5">
                <span className="pl-mfoot-label">{footer.closing ? 'Current Total' : `Current Total · ${onlyLabel} only`}</span>
                <span className="text-[12.5px] font-extrabold tabular-nums">{balanceCells(footer.current).map((v) => moneyOrDash(v)).join('  /  ')}</span>
              </div>
              {footer.closing && closingNet != null && (
                <div className="pl-mfoot-row flex items-center justify-between gap-2.5">
                  <span className="pl-mfoot-label">Closing Balance</span>
                  <Balance net={closingNet} nilLabel="Settled" className="text-[15px]" />
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── The phone's other filters ── */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="pl-tall gap-3 rounded-t-[22px] border-0 px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <span className="mx-auto h-1 w-10 shrink-0 rounded-full bg-slate-300 dark:bg-white/20" aria-hidden />
          <SheetHeader className="flex-row items-center justify-between gap-2 pr-10">
            <SheetTitle className="text-[17px] font-extrabold">Filters</SheetTitle>
            <button type="button" className="text-[13px] font-extrabold text-rose-600 dark:text-rose-400" onClick={onReset}>
              × Reset all
            </button>
          </SheetHeader>
          {(
            [
              ['Agent', 'All agents', agent === 'All' ? '' : agent, onAgent, agentList],
              ['Voucher type', 'All voucher types', voucherType, (v: string) => patch({ voucherType: v }), data?.voucherTypes ?? []],
              ['Due type', 'All bills', dueType, (v: string) => patch({ dueType: v as LedgerDueFilter | '' }), DUE_OPTIONS],
            ] as [string, string, string, (v: string) => void, (string | ComboboxOption)[]][]
          ).map(([label, all, value, onChange, options]) => (
            <div key={label}>
              <p className="pl-mlabel mb-1.5">{label}</p>
              <PlSelect label={label} placeholder={all} value={value} onChange={onChange} options={options} />
            </div>
          ))}
          <label
            className={cn('pl-tile flex items-center justify-between gap-3 py-2.5', running ? 'cursor-pointer' : 'cursor-not-allowed opacity-50')}
            title={balanceTitle}
          >
            <span>
              <span className="block text-[14px] font-extrabold">Show running balance</span>
              <span className="pl-muted block text-[12px]">Show the running balance on every row</span>
            </span>
            {balanceSwitch}
          </label>
          <div className="pl-tile flex items-center justify-between gap-3 py-2">
            <span className="text-[14px] font-extrabold">Text size</span>
            {zoomSeg}
          </div>
          <button type="button" className="pl-btn pl-btn-primary w-full text-[15px]" onClick={() => setFiltersOpen(false)}>
            Show {rows.length} row{rows.length === 1 ? '' : 's'}
          </button>
        </SheetContent>
      </Sheet>

      {/* ── Keyboard shortcuts ── */}
      {/* Pick the columns for the PDF / Excel; Done builds the file. */}
      <Dialog open={exportAsk != null} onOpenChange={(o) => !o && setExportAsk(null)}>
        <DialogContent className="max-w-sm gap-3 rounded-[18px]">
          <DialogHeader>
            <DialogTitle>{exportAsk === 'pdf' ? 'PDF' : 'Excel'} — columns to include</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {LEDGER_EXPORT_COLUMNS.map((c) => (
              <label key={c.key} className="flex cursor-pointer items-center gap-2 text-[13.5px] font-medium">
                <input
                  type="checkbox"
                  className="size-4 accent-indigo-600"
                  checked={exportCols.includes(c.key)}
                  onChange={(e) =>
                    setExportCols((cur) => {
                      const next = new Set(cur);
                      if (e.target.checked) next.add(c.key);
                      else next.delete(c.key);
                      return LEDGER_EXPORT_COLUMNS.map((x) => x.key as string).filter((k) => next.has(k));
                    })
                  }
                />
                {c.label}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3 text-[12px]">
            <button type="button" className="text-indigo-600 hover:underline" onClick={() => setExportCols(LEDGER_EXPORT_COLUMNS.map((c) => c.key))}>
              Select all
            </button>
            {(!textPicked || !moneyPicked) && <span className="font-semibold text-rose-600">Pick a text column and Debit or Credit.</span>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setExportAsk(null)}>
              Cancel
            </Button>
            <Button onClick={exportDone} disabled={!textPicked || !moneyPicked}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={keysOpen} onOpenChange={setKeysOpen}>
        <DialogContent className="max-w-sm gap-3 rounded-[18px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] font-extrabold">Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <ul className="space-y-2.5">
            {(
              [
                ['Move between ledger rows (from anywhere on the page)', '↑  ↓'],
                ['Jump ten rows', 'PgUp  PgDn'],
                ['First / last row', 'Home  End'],
                ['Open receipts / allocation', 'Enter'],
                ['Show how an ageing is worked out', 'Tab → Enter'],
                ['Jump to the Customer filter', '/'],
                ...(canPrintLedger ? [['Open the PDF (print inside it)', 'Ctrl + P']] : []),
                ['Close any popup', 'Esc'],
                ['Show this list', '?'],
              ] as [string, string][]
            ).map(([what, key]) => (
              <li key={what} className="flex items-center justify-between gap-3 text-[13px] font-semibold">
                <span>{what}</span>
                <kbd className="pl-kbd">{key}</kbd>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pdfPreview} onOpenChange={(open) => !open && setPdfPreview(null)}>
        <DialogContent className="flex h-[min(92vh,900px)] w-[min(96vw,920px)] max-w-none flex-col gap-0 overflow-hidden rounded-[22px] p-0">
          <DialogHeader className="shrink-0 border-b px-4 py-3 pr-14 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <DialogTitle className="truncate text-[16px] font-extrabold">Party Ledger PDF</DialogTitle>
              <p className="pl-muted truncate text-xs">{pdfPreview?.filename}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-2 sm:pt-0">
              <button type="button" onClick={printPreview} className="pl-btn">
                <Printer className="size-4" /> Print
              </button>
              <button type="button" onClick={downloadPreview} className="pl-btn pl-btn-rose px-4">
                <Download className="size-4" /> Download PDF
              </button>
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
  kind,
  label,
  cells,
  lead,
  trailing,
  balance,
  showBalance = true,
}: {
  /** Opening, Current Total or Closing — the band it is drawn in. Current Total
   *  takes the closing band when a voucher-type filter leaves it the bottom line. */
  kind: 'open' | 'current' | 'close';
  label: string;
  cells: number[];
  lead: number;
  trailing: boolean;
  balance?: number;
  /** Hide the Balance cell's VALUE (the column itself always stays, so the grid
   *  keeps its column count) — the page's "Show balance" toggle, which every
   *  summary row but Closing Balance respects. */
  showBalance?: boolean;
}) {
  // Each band's rule is an inset box-shadow, not a border (see .pl-foot): this
  // row sits in a `position: sticky` tfoot, where browsers drop a top border
  // once the row is actually stuck mid-scroll.
  const strong = kind === 'close';
  return (
    <tr className="pl-foot" data-kind={kind}>
      {/* Date stays blank; the label runs across the remaining text columns. */}
      <td />
      <td colSpan={lead - 1}>{label}</td>
      {cells.map((v, i) => (
        <td key={i} className="text-right whitespace-nowrap">
          {moneyOrDash(v)}
        </td>
      ))}
      <td className="text-right whitespace-nowrap">
        {/* Closing Balance ignores the toggle — it's the one figure this ledger
            always needs, not an optional detail like the per-row running balance. */}
        {balance === undefined || (!strong && !showBalance) ? null : (
          <Balance
            net={balance}
            className={strong ? 'text-[14px]' : undefined}
            // Only the bottom line names a nil balance; on the others a dash is right.
            nilLabel={strong ? 'Settled' : undefined}
          />
        )}
      </td>
      {trailing && <td />}
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
  if (status === 'F') return <span className="pl-chip pl-tone-emerald" title="Fully paid">F</span>;
  if (status === 'P')
    return (
      <span
        className="pl-chip pl-tone-sky"
        title={side ? `Partially paid — ${side === 'B' ? 'bank' : 'cash'} balance still pending` : 'Partially paid'}
      >
        P{side ? <span className="ml-0.5 opacity-75">({side})</span> : null}
      </span>
    );
  if (status === 'D') return <span className="pl-chip pl-tone-rose" title="Due">D</span>;
  return null;
}

/** Ageing text — "45 Over", "36 Late", "12 Left", "Due Today". Overdue reads red;
 *  Early / On Time / Late describe an already-settled bill, so they read green. */
const dueTone = (t: string) =>
  /Over/i.test(t) ? 'pl-tone-rose' : /Early|On Time|Late/i.test(t) ? 'pl-tone-emerald' : 'pl-tone-indigo';

/** The card's accent, keyed off the same test `dueTone` uses so a figure and the
 *  card it opens are never two different colours. */
const dueAccent = (t: string): 'rose' | 'emerald' | 'slate' =>
  /Over/i.test(t) ? 'rose' : /Early|On Time|Late/i.test(t) ? 'emerald' : 'slate';

/** A signed day figure with a real minus sign rather than a hyphen. */
const dayText = (days: number) => (days < 0 ? `−${Math.abs(days)}` : String(days));

/** Signed whole days as a phrase, so no line has to be read as "is −3 good?". */
const dayPhrase = (days: number, back: string, forward: string, same: string) =>
  days === 0
    ? same
    : `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ${days < 0 ? back : forward}`;

/** One labelled line inside the Due From card. */
function CalcLine({
  label,
  value,
  sub,
  strong,
}: {
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <p
          className={cn(
            'text-[11px] leading-tight',
            strong ? 'font-bold' : 'text-muted-foreground font-semibold',
          )}
        >
          {label}
        </p>
        {sub && <p className="text-muted-foreground text-[10px] leading-tight">{sub}</p>}
      </div>
      <span
        className={cn(
          'shrink-0 tabular-nums',
          strong ? 'text-[12.5px] font-bold' : 'text-[11.5px] font-semibold',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * "3 Over" / "63 Late", with the arithmetic behind it on hover.
 *
 * The column is the most-queried figure on the page and the least explicable:
 * two different rules produce it, and the one for a settled invoice is an
 * amount-weighted average nobody could be expected to guess from "63 Late".
 *
 * Everything shown comes from the server's `dueFromCalc`, derived in the same
 * pass as the text itself. The card formats; it never recomputes. A second
 * implementation of the ageing rules here would be a second set of answers to
 * the same question, and the card would eventually contradict the badge it is
 * attached to.
 *
 * Hover AND click-to-pin, matching the rate breakdown card: hover is what a
 * mouse finds, a tap is all a phone can do, and pinning lets the figures be
 * read without holding the mouse still. Both handlers stop propagation, because
 * the ledger row underneath opens the receipt dialog on click and on Enter.
 */
function DueFrom({ text, calc }: { text: string; calc?: DueFromCalc | null }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;

  if (!text) return <span className="text-[#c3c9d6] dark:text-slate-600">—</span>;
  // A row with no workings on record — an older cached response — keeps the
  // plain badge rather than offering a card that would open empty.
  if (!calc) return <span className={cn('pl-due inline-flex items-center no-underline', dueTone(text))}>{text}</span>;

  const accent = dueAccent(text);
  const head =
    accent === 'rose'
      ? 'from-rose-600 to-red-700'
      : accent === 'emerald'
        ? 'from-emerald-600 to-teal-700'
        : 'from-blue-700 to-indigo-800';

  const basisLabel = calc.basis === 'DUE_DATE' ? 'Due date' : 'Invoice date';
  const receipts = calc.receipts ?? [];
  const toggle = () => {
    // Two plain setStates, not one nested inside the other's updater: an updater
    // has to be pure and React drops the nested call, which silently kills the
    // click and leaves the card openable only by hover.
    if (pinned) setHovered(false);
    setPinned(!pinned);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        // Escape and outside-click arrive here; both mean "gone", so they have to
        // clear the hover flag too or the card springs straight back.
        if (!o) {
          setPinned(false);
          setHovered(false);
        }
      }}
    >
      {/* Anchor, not Trigger — Trigger toggles the popover on click by itself and
          fights `pinned`, so a click while hovering cancelled itself out. */}
      <PopoverAnchor asChild>
        <span
          role="button"
          tabIndex={0}
          aria-expanded={open}
          aria-label={`Ageing ${text} — show how this is calculated`}
          onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setHovered(false)}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            toggle();
          }}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
          className={cn('pl-due inline-flex items-center', dueTone(text))}
        >
          {text}
        </span>
      </PopoverAnchor>

      <PopoverContent
        side="left"
        align="center"
        sideOffset={8}
        collisionPadding={12}
        // A card opened by hover must not steal focus from the page, and must not
        // swallow the pointer either — otherwise moving the mouse one pixel would
        // close it by leaving the badge.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-[18rem] overflow-hidden rounded-[14px] border-0 p-0 shadow-xl',
          'ring-1 ring-slate-900/10 dark:ring-white/10',
          !pinned && 'pointer-events-none',
        )}
      >
        {/* The answer first, in words. The badge says "63 Late"; this is where it
            stops being a code and becomes a sentence. */}
        <div className={cn('bg-gradient-to-r px-3 py-2 text-white', head)}>
          <p className="text-[9.5px] font-bold tracking-[0.14em] uppercase opacity-80">
            {calc.kind === 'OPEN' ? 'Ageing — still owed' : 'Ageing — settled'}
          </p>
          <p className="text-[17px] leading-tight font-bold">
            {calc.kind === 'OPEN'
              ? dayPhrase(calc.days, 'past due', 'of credit left', 'Due today')
              : dayPhrase(calc.days, 'late', 'early', 'Paid on time')}
          </p>
        </div>

        <div className="bg-card space-y-2 px-3 py-2.5">
          {calc.kind === 'OPEN' ? (
            <>
              <div className="space-y-1">
                <CalcLine label={basisLabel} value={prettyDate(calc.fromDate)} />
                <CalcLine label="Today" value={prettyDate(calc.asOf ?? null)} />
              </div>
              {/* The subtraction, spelled out — the point of the card is that the
                  figure is checkable against the two dates above it. */}
              <div className="flex items-baseline justify-between gap-2 border-t border-dashed pt-1.5">
                <span className="text-muted-foreground text-[10.5px] font-semibold">
                  {basisLabel} − today
                </span>
                <span
                  className={cn(
                    'text-[13px] font-bold tabular-nums',
                    calc.days < 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-800 dark:text-slate-200',
                  )}
                >
                  {/* A real minus, matching the − in the label above it. */}
                  {calc.days > 0 ? '+' : calc.days < 0 ? '−' : ''}
                  {Math.abs(calc.days)} {Math.abs(calc.days) === 1 ? 'day' : 'days'}
                </span>
              </div>
              <p className="text-muted-foreground rounded-[6px] border border-dashed px-2 py-1.5 text-[10.5px] leading-snug">
                {calc.days < 0
                  ? `“Over” counts the days past the ${basisLabel.toLowerCase()}.`
                  : calc.days === 0
                    ? 'Payment falls due today.'
                    : '“Left” counts the days of credit still to run.'}
                {calc.basis === 'INVOICE_DATE' &&
                  ' This voucher carries no due date, so it ages from the day it was raised.'}
                {/*
                 * The two cases read differently. On a PART-PAID bill the point
                 * worth making is that paying some of it did not push the due
                 * date back — the single most common misreading of this column.
                 * On a wholly unpaid one that sentence invents a payment that
                 * was never made, so it says the plain thing instead.
                 */}
                {calc.pending != null && calc.pending > 0 && (
                  <>
                    {' '}
                    {calc.partPaid ? (
                      <>
                        <span className="font-semibold">₹{inr(calc.pending)}</span> is still
                        unpaid — a part payment does not move the due date.
                      </>
                    ) : (
                      <>
                        The full <span className="font-semibold">₹{inr(calc.pending)}</span> is
                        still outstanding.
                      </>
                    )}
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <CalcLine label={basisLabel} value={prettyDate(calc.fromDate)} />
              <div className="space-y-1 border-t border-dashed pt-1.5">
                <p className="text-muted-foreground text-[9.5px] font-bold tracking-[0.1em] uppercase">
                  {receipts.length === 1 ? 'Paid by' : `Cleared by ${receipts.length} receipts`}
                </p>
                {receipts.map((r, i) => (
                  <CalcLine
                    key={`${r.date}-${i}`}
                    label={prettyDate(r.date)}
                    sub={
                      // The share IS the weighting, so it sits next to the money
                      // rather than being left for the reader to work out.
                      calc.weighted && receipts.length > 1
                        ? `${inr(r.amount)} · ${Math.round(r.share * 100)}% of the bill`
                        : inr(r.amount)
                    }
                    value={dayPhrase(r.days, 'late', 'early', 'on time')}
                  />
                ))}
              </div>
              {/*
               * Only where there is something to reconcile. With ONE receipt the
               * average IS that receipt's offset — provably, the weighting has a
               * single term — so the line repeated the figure already on the row
               * above and in the header, as a bare unlabelled number.
               */}
              {receipts.length > 1 && (
                <div className="flex items-baseline justify-between gap-2 border-t border-dashed pt-1.5">
                  <span className="text-muted-foreground text-[10.5px] font-semibold">
                    {calc.weighted ? 'Weighted average' : 'From the latest receipt'}
                  </span>
                  <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {/* The unrounded mean, then what it rounded to. The whole-day
                        figures above do not average to exactly this, so the card
                        shows the rounding rather than asserting an equals sign. */}
                    {calc.daysExact != null && calc.daysExact !== calc.days
                      ? `${dayText(calc.daysExact)} → ${dayText(calc.days)}`
                      : dayText(calc.days)}
                  </span>
                </div>
              )}
              {receipts.length > 1 && (
                <p className="text-muted-foreground rounded-[6px] border border-dashed px-2 py-1.5 text-[10.5px] leading-snug">
                  {calc.weighted
                    ? 'Each payment counts in proportion to how much of the bill it cleared, so a large payment on time is not cancelled out by a small one arriving late.'
                    : 'These receipts carry no amount between them, so there was nothing to weight by — the figure is measured from the latest one alone.'}
                </p>
              )}
            </>
          )}
        </div>

        <div className="text-muted-foreground flex items-center gap-1 border-t bg-slate-50 px-3 py-1.5 text-[9.5px] dark:bg-slate-900/50">
          <Pin className={cn('size-2.5', pinned && 'text-blue-600')} />
          {pinned ? 'Pinned — click the figure again to close' : 'Click the figure to keep this open'}
        </div>
      </PopoverContent>
    </Popover>
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
    <div className="pl-kpi" data-warn={outside}>
      <span className="pl-kpi-label">Inv due from</span>
      <span className="truncate text-[17px] font-extrabold tabular-nums">{date}</span>
      {ref && <span className="pl-muted truncate font-mono text-[11.5px]">{ref}</span>}
      {outside && detail && (
        <button
          type="button"
          onClick={() => onShowInvoice?.(detail.invDate)}
          title={`Raised ${formatDate(detail.invDate)}, before the dates shown. Click to widen the range back to it.`}
          className="mt-[3px] cursor-pointer self-start rounded-full bg-[#fffbeb] px-[9px] py-[3px] text-left text-[11px] leading-snug font-extrabold text-[#b45309] shadow-[inset_0_0_0_1px_#fde68a] dark:bg-amber-400/10 dark:text-amber-300 dark:shadow-[inset_0_0_0_1px_rgba(251,191,36,0.3)]"
        >
          Raised {formatDate(detail.invDate)} — before these dates. Show it
        </button>
      )}
    </div>
  );
}

/**
 * A filter field in the mockup's style: the app's searchable combo inside,
 * tinted once it holds a value, with a clear button. `id` is what "/" jumps to.
 */
function PlSelect({
  id,
  label,
  placeholder,
  value,
  onChange,
  options,
  className,
}: {
  id?: string;
  label: string;
  /** What the empty field reads; the label itself where it stands alone. */
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  options: (string | ComboboxOption)[];
  className?: string;
}) {
  return (
    <div className={cn('pl-field', className)} data-on={!!value}>
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <NativeSelect id={id} value={value} onChange={onChange} options={['', ...options]} placeholder={placeholder ?? label} />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label={`Clear ${label} filter`} title={`Clear ${label} filter`} className="pl-field-clear">
          <X className="size-3.5" />
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
    <div className="flex min-h-0 flex-1 flex-col bg-[#e9edf5] dark:bg-slate-900">
      <div className="bg-card flex h-10 shrink-0 items-center justify-center gap-2 border-b px-3">
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
        <span className="min-w-24 text-center text-xs font-extrabold tabular-nums">
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
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#e9edf5]/80 text-sm font-medium text-slate-600 dark:bg-slate-900/80 dark:text-slate-300">
            <Loader2 className="mr-2 size-4 animate-spin" /> Rendering preview…
          </div>
        )}
        {error ? (
          <div className="flex h-full items-center justify-center text-sm font-medium text-rose-600">
            Could not render the PDF preview.
          </div>
        ) : (
          <canvas ref={canvasRef} className="mx-auto h-auto max-w-full rounded-[4px] bg-white shadow-[0_12px_32px_-12px_rgba(20,30,60,0.35)]" />
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

  /*
   * Where the bill stands, from the row's own figures — the same status and
   * pending the grid shows, so the dialog cannot disagree with the row that
   * opened it. Only for an invoice: a receipt row has its own reconciliation.
   */
  const bill = row ? (mode === 'B' ? row.bankDr : mode === 'C' ? row.cashDr : row.bankDr + row.cashDr) : 0;
  const pending = !row ? 0 : row.status === 'F' ? 0 : row.status === 'P' ? Math.min(bill, row.pendingAmount) : bill;
  const clearedAmt = Math.max(0, bill - pending);
  const showStanding = !isReceipt && bill > 0 && !!row?.status;

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('gap-0 overflow-hidden rounded-[20px] p-0', isReceipt ? 'max-w-lg' : 'max-w-md')}>
        <div className="pl-dlg-head">
          <DialogTitle className="text-[15px] font-extrabold tracking-[0.01em] text-white uppercase">
            {row?.voucherType} — <span className="tabular-nums">{row?.voucherNo}</span>
          </DialogTitle>
          <p className="mt-0.5 text-[12px] text-white/80">
            {row?.particulars}
            {row?.customerName && row.customerName !== row.particulars ? ` · ${row.customerName}` : ''}
          </p>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4">
          {loading ? (
            <div className="pl-muted flex items-center gap-2 py-4 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading{isReceipt ? ' allocation' : ' receipts'}…
            </div>
          ) : isReceipt ? (
            <ClearedBreakdown data={cleared} />
          ) : lines && lines.length ? (
            <ol className="relative space-y-2">
              {/* The thread through the payments, oldest first. */}
              {lines.length > 1 && <span className="absolute top-4 bottom-4 left-[15px] w-px bg-emerald-200 dark:bg-emerald-400/30" aria-hidden />}
              {lines.map((l, i) => (
                <li
                  key={i}
                  className="relative flex items-center gap-2.5 rounded-[12px] border border-[#e6eaf3] bg-[#f7f9fd] py-2 pr-3 pl-2.5 text-[13px] dark:border-white/10 dark:bg-white/5"
                >
                  <span className="relative size-2 shrink-0 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />
                  <span className={cn('pl-chip', l.bucket === 'B' ? 'pl-tone-indigo' : 'pl-tone-emerald')} title={l.bucket === 'B' ? 'Settled the bank side' : 'Settled the cash side'}>
                    {l.bucket}
                  </span>
                  <span className="min-w-0 flex-1">
                    {verb(l.recType)} on <strong className="tabular-nums">{prettyDate(l.recDate)}</strong> vide <span className="pl-vno">{l.refRecId || '?'}</span>
                  </span>
                  {l.recAmt > 0 && <span className="shrink-0 font-extrabold tabular-nums">₹{inr(l.recAmt)}</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="pl-muted py-3 text-sm">
              {mode === 'BOTH'
                ? 'No payments / clearances recorded yet.'
                : `No ${mode === 'B' ? 'bank' : 'cash'} payments against this invoice. Switch to Both to see the other side.`}
            </p>
          )}
          {!loading && showStanding && (
            <div className="mt-3 space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <div className="pl-tile">
                  <div className="pl-tile-label">Bill</div>
                  <div className="text-[15px] font-extrabold tabular-nums">₹{inr(bill)}</div>
                </div>
                <div className="pl-tile" data-tone="emerald">
                  <div className="pl-tile-label">Cleared</div>
                  <div className="text-[15px] font-extrabold text-[#047857] tabular-nums dark:text-emerald-400">₹{inr(clearedAmt)}</div>
                </div>
                <div className="pl-tile" data-tone={pending > 0 ? 'rose' : 'emerald'}>
                  <div className="pl-tile-label">Pending</div>
                  <div className={cn('text-[15px] font-extrabold tabular-nums', pending > 0 ? 'text-[#be123c] dark:text-rose-400' : 'text-[#047857] dark:text-emerald-400')}>
                    ₹{inr(pending)}
                  </div>
                </div>
              </div>
              <div className="pl-kpi-track h-[7px]" role="img" aria-label={`${Math.round((clearedAmt / bill) * 100)}% of the bill cleared`}>
                <span style={{ width: `${(clearedAmt / bill) * 100}%`, background: 'linear-gradient(90deg,#6ee7b7,#10b981)' }} />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
