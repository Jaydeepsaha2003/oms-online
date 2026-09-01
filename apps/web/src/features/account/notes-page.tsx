import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Check,
  FolderOpen,
  Layers,
  Link2,
  Loader2,
  Plus,
  Printer,
  RotateCcw,
  Shuffle,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  computeNoteBreakup,
  noteClearanceReason,
  noteItemAmount,
  noteRefInvoices,
  type CustomerDto,
  type NoteDirectoryRow,
  type NoteItemInput,
  type NoteMode,
  type RecentSoldRow,
} from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDate } from '@/lib/date-format';
import { usePermissions } from '@/hooks/use-permissions';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { useConfirm } from '@/components/common/confirm';
import { DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/combo';
import { Combobox } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { isIOS, reservePreviewTab } from '@/lib/pdf';
import { useCustomers } from '@/features/customers/use-customers';
import { fetchChallanByCode } from '@/features/challans/use-challans';
import {
  fetchNote,
  useDeleteNote,
  useNextNoteNo,
  useNoteDirectory,
  useRecentSold,
  useSaveNote,
} from './use-notes';

const money = (v: number) =>
  `₹ ${(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (v: number) => `₹ ${(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
// Delegates to the shared formatter so this page follows the system-wide date format.
const prettyDate = (iso: string | null) => formatDate(iso);
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const numOrU = (s: string) => (s.trim() === '' ? undefined : Number(s));

/** Matches the Dispatch / Orders / Pending Challan grids: Inter, semibold, near-black. */
const TEXT_CELL = 'text-[13px] font-semibold text-slate-800 dark:text-slate-200';
/** Compact, amber-bordered filter controls — same language as the other list pages. */
const CONTROL =
  'h-9 rounded-[4px] border-amber-300 dark:border-amber-400/40 text-[12.5px] focus-visible:border-amber-500 focus-visible:ring-amber-400/30';
const CONTROL_ON =
  'border-amber-500 bg-amber-50 text-amber-900 font-semibold dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200';
/** House grid className block — typography/border/zebra treatment shared across list & entry tables. */
const GRID_CLASSES = [
  'font-sans text-[13px]',
  '[&_thead_th]:text-[13.5px] [&_thead_th]:font-extrabold [&_thead_th]:uppercase [&_thead_th]:tracking-wide [&_thead_th]:py-1.5',
  '[&_td]:py-1 [&_td]:px-3 [&_th]:px-3',
  '[&_tbody_tr]:border-b [&_tbody_tr]:border-slate-200 dark:[&_tbody_tr]:border-white/10',
  '[&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0',
  '[&_tbody_tr:nth-child(even)_td]:bg-slate-100/80 dark:[&_tbody_tr:nth-child(even)_td]:bg-white/[0.04]',
].join(' ');
/** History-browsing grid (Directory dialog) is click-to-reopen, so it gets the fuller
 *  house pattern: hover affordance on header + row, and text-selection suppressed. */
const DIRECTORY_GRID_CLASSES =
  GRID_CLASSES +
  ' [&_thead_th:hover]:from-blue-900 [&_thead_th:hover]:to-indigo-900 [&_tbody]:select-none [&_tbody_tr:hover:hover_td]:bg-amber-100/70 dark:[&_tbody_tr:hover:hover_td]:bg-amber-400/10';

/* ── Tally worksheet chrome — the same tokens the Party Ledger, Daybook and
   Receive Payment screens use, so this voucher reads as one of the family. ─── */

/** Small-caps caption above each control. */
const FIELD_LABEL =
  'text-[10px] font-bold tracking-widest text-amber-900/70 uppercase dark:text-amber-200/60';
/** Sticky navy→indigo column strip. */
const TH =
  'sticky top-0 z-10 bg-gradient-to-b from-blue-800 to-indigo-800 px-2 py-1.5 text-left text-[11px] font-extrabold tracking-wide text-white uppercase whitespace-nowrap dark:from-blue-900 dark:to-indigo-900';
const TH_LINE = 'border-r border-white/15';
const TD =
  'border-r border-r-amber-200/80 px-2 py-[3px] align-middle dark:border-r-amber-400/15 last:border-r-0';
const NUM = 'text-right tabular-nums';
/** The frame around each worksheet pane. */
const PANEL = 'border-amber-300 dark:border-amber-400/30';
/** The dark document caption bar that tops each pane. */
const DOC_BAR =
  'flex shrink-0 items-center justify-between gap-3 bg-slate-800 px-2.5 py-1 dark:bg-slate-900';
const DOC_TITLE = 'truncate text-[12px] font-extrabold tracking-wide text-amber-300 uppercase';

/** An item on the working note (input + the fields the grid shows). */
type Line = NoteItemInput & {
  gstRate?: number;
  invDate?: string;
  /** What the original sale's price was made of — see RecentSoldRow. Held
   *  on the line so the breakdown survives being added to the note. */
  productRate?: number | null;
  designRate?: number | null;
  dispatchRate?: number | null;
};

/** The quantity boxes on the add-line bar. */
const QTY_FIELDS = [
  ['bags', 'Bags'],
  ['pcs', 'Pcs'],
  ['kgs', 'Kgs'],
  ['box', 'Box'],
] as const;
type QtyField = (typeof QTY_FIELDS)[number][0];
/** What the referenced sale actually carried — the ceiling for a note line. A
 *  unit the sale never had is nothing to credit or debit back, so its box is
 *  locked; the rest can't be typed past what was sold. null = no sale picked
 *  (hand-typed line), so nothing to check against. */
type QtyLimits = Record<QtyField, number>;

const EMPTY_ENTRY = {
  product: '',
  design: '',
  unit: '',
  bags: '',
  pcs: '',
  kgs: '',
  box: '',
  price: '',
  comment: '',
  refInvNo: '',
  dispatchId: 0,
  pCategory: '',
  gstRate: 0,
  invDate: '',
  productRate: null as number | null,
  designRate: null as number | null,
  dispatchRate: null as number | null,
  limits: null as QtyLimits | null,
};

/**
 * What a note line's price is made of, on hover.
 *
 * A note prices from the original sale, and that sale's rate was assembled from
 * parts the challan does not keep — only the dispatch behind it does. Showing
 * them here is the difference between "₹377, take it or leave it" and being
 * able to see the ₹365 product and the ₹12 design that make it up before
 * crediting any of it back.
 *
 * The special-rate line is the REMAINDER (rate less product less design), which
 * is what a customer special rate actually is in this system. An agent
 * commission flagged "add to rate" is already inside the product rate by the
 * time a dispatch stores it and cannot be separated out afterwards, so it is
 * not listed as if it were a distinct component — saying so is better than
 * showing a figure that would be a guess.
 *
 * Nothing is rendered for a line with no source dispatch; there is nothing to
 * break down and an empty card is worse than none.
 */
function PriceBreakdown({ line, children }: { line: Line; children: ReactNode }) {
  const base = line.productRate;
  const design = line.designRate;
  const rate = line.dispatchRate;
  if (base == null && design == null && rate == null) return <>{children}</>;

  const parts = (base ?? 0) + (design ?? 0);
  const special = rate != null ? Math.round((rate - parts) * 100) / 100 : 0;
  const billed = line.price ?? 0;
  const edited = rate != null && Math.abs(billed - rate) > 0.001;

  const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className={cn('flex items-center justify-between gap-6', strong && 'font-bold')}>
      <span className={strong ? undefined : 'opacity-80'}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="focus-visible:ring-primary/40 cursor-help rounded-[3px] focus-visible:ring-2 focus-visible:outline-none"
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-none p-0">
        <div className="min-w-56 space-y-1 p-2.5 text-[11.5px]">
          <p className="text-[10px] font-bold tracking-widest uppercase opacity-60">
            How this price was built{line.refInvNo ? ` · ${line.refInvNo}` : ''}
          </p>
          {base != null && <Row label="Product rate" value={money(base)} />}
          {design != null && <Row label="Design rate" value={money(design)} />}
          {special !== 0 && (
            <Row
              label="Special rate"
              value={`${special > 0 ? '+' : '−'} ${money(Math.abs(special))}`}
            />
          )}
          {rate != null && (
            <div className="mt-1 border-t border-white/20 pt-1">
              <Row label="Rate on the sale" value={money(rate)} strong />
            </div>
          )}
          {edited && (
            <div className="mt-1 border-t border-white/20 pt-1">
              <Row label="Billed on the invoice" value={money(billed)} strong />
              <p className="pt-0.5 text-[10.5px] opacity-70">
                Edited on the challan, so it differs from the rate above.
              </p>
            </div>
          )}
          <p className="pt-1 text-[10.5px] opacity-60">
            An agent commission set to add to the rate is already inside the product rate.
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function NotesPage() {
  const { can } = usePermissions();
  const confirm = useConfirm();

  const [mode, setMode] = useState<NoteMode>('DEBIT');
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [invDate, setInvDate] = useState(ymd(new Date()));
  const [party, setParty] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [entry, setEntry] = useState({ ...EMPTY_ENTRY });

  // Header charges / rates.
  const [packing, setPacking] = useState('');
  const [freight, setFreight] = useState('');
  const [pouch, setPouch] = useState('');
  const [otherCharges, setOtherCharges] = useState('');
  const [tcs, setTcs] = useState('');
  const [billingRate, setBillingRate] = useState('');
  const [category, setCategory] = useState('');
  const [transName, setTransName] = useState('');
  const [paymentTerm, setPaymentTerm] = useState('0');
  const [noBill, setNoBill] = useState(false);
  const [noBillWithoutGst, setNoBillWithoutGst] = useState(false);
  const [remarks, setRemarks] = useState('');

  const [dirOpen, setDirOpen] = useState(false);
  const canViewChallans = can('challan:view');

  /**
   * Open a note line's source sale in the same Sales Challan view the Party
   * Ledger opens — but in a SECOND TAB, because this screen holds unsaved work:
   * the note's lines live in component state, so navigating away in this tab
   * would throw away everything added since the last save.
   *
   * The tab is reserved synchronously inside the click (same trick as
   * the PDF helpers do); opening it after the await would be swallowed as a popup.
   * The lines carry a Ref Inv, not the challan's row id, so the id is looked up
   * by code and the reserved tab is then pointed at the bill route.
   */
  const openChallan = (code: string) => {
    const tab = window.open('', '_blank');
    // Null means the browser refused the tab (pop-up blocker, or a strict mobile
    // setting). Say so — the alternative is an arrow that looks broken, and the
    // silent-nothing case is worse than the error.
    if (!tab) {
      toast.error(
        'Your browser blocked the new tab. Allow pop-ups for this site to view the challan.',
      );
      return;
    }
    fetchChallanByCode(code)
      .then((challan) => {
        // ?from=tab tells the bill page it was popped into a tab of its own, so
        // its Back control closes the tab instead of trying a browser-back that
        // has no history to move through.
        if (tab && !tab.closed) tab.location.href = `/challans/${challan.id}/bill?from=tab`;
      })
      .catch((e) => {
        tab?.close();
        toast.error(getApiErrorMessage(e, `Could not open challan ${code}`));
      });
  };

  const { data: customerData } = useCustomers({ page: 1, pageSize: 1000 });
  const custByName = useMemo(() => {
    const m = new Map<string, CustomerDto>();
    for (const c of customerData?.items ?? []) if (c.partyName) m.set(c.partyName, c);
    return m;
  }, [customerData]);
  const partyOptions = useMemo(
    () => [...custByName.keys()].sort((a, b) => a.localeCompare(b)),
    [custByName],
  );
  const customerId = party ? custByName.get(party)?.id : undefined;

  const { data: nextNo } = useNextNoteNo(mode);
  const { data: recentSold = [] } = useRecentSold(customerId);
  const saveMut = useSaveNote();
  const del = useDeleteNote();

  const voucherNo = editingCode ?? nextNo?.code ?? '…';

  // Live B/C breakup — identical math to the server.
  const breakup = useMemo(
    () =>
      computeNoteBreakup({
        items: lines,
        packing: numOrU(packing),
        freight: numOrU(freight),
        pouch: numOrU(pouch),
        otherCharges: numOrU(otherCharges),
        billingRate: numOrU(billingRate),
        noBill,
        noBillWithoutGst,
      }),
    [lines, packing, freight, pouch, otherCharges, billingRate, noBill, noBillWithoutGst],
  );

  /**
   * A credit note whose lines all point at ONE sale is settled straight against
   * that invoice by the API. Predicted here (same shared helper the API uses) so
   * the intent is visible before saving, not discovered afterwards.
   */
  const refInvoices = useMemo(() => noteRefInvoices(lines), [lines]);
  const targetInv = mode === 'CREDIT' && refInvoices.length === 1 ? refInvoices[0] : null;

  const resetHeaderFromCustomer = (name: string) => {
    const c = custByName.get(name);
    if (!c) return;
    setCategory(c.category ?? '');
    setTransName(c.transportName ?? '');
    setBillingRate(c.billingRate != null ? String(c.billingRate) : '');
    setPaymentTerm(c.creditPeriod != null ? String(c.creditPeriod) : '0');
    setPacking(c.packing != null ? String(c.packing) : '');
    setOtherCharges('');
    setFreight(c.freight != null ? String(c.freight) : '');
  };

  const onPartyChange = (name: string) => {
    setParty(name);
    setLines([]);
    setEntry({ ...EMPTY_ENTRY });
    resetHeaderFromCustomer(name);
  };

  const resetForNew = () => {
    setEditingCode(null);
    setLines([]);
    setEntry({ ...EMPTY_ENTRY });
    setOtherCharges('');
    // A fresh note asks about each invoice again — the previous note's answers
    // say nothing about this one.
    setInvoiceChoice({});
    setNoBill(false);
    setNoBillWithoutGst(false);
    setRemarks('');
    setInvDate(ymd(new Date()));
  };

  const switchMode = (m: NoteMode) => {
    if (m === mode) return;
    setMode(m);
    resetForNew();
  };

  // ── item entry ────────────────────────────────────────────────────────────

  /** Remembers, per invoice number, whether the user wanted the whole invoice or
   *  just single items. Asked ONCE per invoice per note — picking a second item
   *  off an invoice already answered for must not re-prompt. */
  const [invoiceChoice, setInvoiceChoice] = useState<Record<string, 'ALL' | 'ONE'>>({});
  const [askInvoice, setAskInvoice] = useState<{
    invNo: string;
    rows: RecentSoldRow[];
    picked: RecentSoldRow;
  } | null>(null);

  /** Build a note line straight from a sold row, at the full sold quantity —
   *  what "add all items from this invoice" means: a full return of that
   *  invoice. Individual lines can still be edited down afterwards. */
  const lineFromSold = (r: RecentSoldRow): Line => ({
    dispatchId: r.dispatchId || undefined,
    refInvNo: r.invNo || undefined,
    productName: r.productName,
    design: r.design || undefined,
    bags: r.bags || undefined,
    pcs: r.pcs || undefined,
    kgs: r.kgs || undefined,
    box: r.box || undefined,
    unit: r.unit || undefined,
    price: r.price || undefined,
    pCategory: r.pCategory || undefined,
    gstRate: r.gstRate,
    invDate: r.invDate,
    productRate: r.productRate,
    designRate: r.designRate,
    dispatchRate: r.dispatchRate,
  });

  /** Same identity the manual add uses, so both paths agree on "already there". */
  const sameLine = (
    a: { refInvNo?: string; productName?: string; design?: string },
    r: RecentSoldRow,
  ) =>
    (a.refInvNo ?? '') === r.invNo &&
    a.productName === r.productName &&
    (a.design ?? '') === (r.design ?? '');

  /** Add every remaining item of one invoice in one go. */
  const addWholeInvoice = (invNo: string) => {
    const rows = recentSold.filter((r: RecentSoldRow) => r.invNo === invNo);
    setLines((prev) => {
      const fresh = rows.filter((r) => !prev.some((l) => sameLine(l, r)));
      if (!fresh.length) {
        toast.info(`Every item on ${invNo} is already on this note.`);
        return prev;
      }
      toast.success(`Added ${fresh.length} item${fresh.length === 1 ? '' : 's'} from ${invNo}.`);
      return [...prev, ...fresh.map(lineFromSold)];
    });
    setEntry({ ...EMPTY_ENTRY });
  };

  const pickRecent = (idxStr: string) => {
    const i = Number(idxStr);
    const r = recentSold[i];
    if (!r) return;
    // First time an item from this invoice is picked, offer the whole invoice —
    // but only when there is actually more than one item to offer.
    const siblings = recentSold.filter((x: RecentSoldRow) => x.invNo === r.invNo);
    if (r.invNo && siblings.length > 1 && !invoiceChoice[r.invNo]) {
      setAskInvoice({ invNo: r.invNo, rows: siblings, picked: r });
      return;
    }
    setEntry({
      product: r.productName,
      design: r.design,
      unit: r.unit,
      // Debit note pre-fills quantities from the sale; credit note starts blank (user enters return qty).
      bags: mode === 'DEBIT' ? String(r.bags || '') : '',
      pcs: mode === 'DEBIT' ? String(r.pcs || '') : '',
      kgs: mode === 'DEBIT' ? String(r.kgs || '') : '',
      box: mode === 'DEBIT' ? String(r.box || '') : '',
      price: String(r.price || ''),
      comment: '',
      refInvNo: r.invNo,
      dispatchId: r.dispatchId,
      pCategory: r.pCategory,
      gstRate: r.gstRate,
      invDate: r.invDate,
      productRate: r.productRate ?? null,
      designRate: r.designRate ?? null,
      dispatchRate: r.dispatchRate ?? null,
      limits: { bags: r.bags || 0, pcs: r.pcs || 0, kgs: r.kgs || 0, box: r.box || 0 },
    });
  };

  /** Quantity typing, held to what the referenced sale carried: over-typing is
   *  clamped back to the sold figure rather than silently accepted. */
  const setQty = (field: QtyField, raw: string) => {
    const max = entry.limits?.[field];
    if (max != null && raw.trim() !== '' && Number(raw) > max) {
      toast.error(`Only ${max} ${field} on ${entry.refInvNo || 'the selected sale'}.`);
      return setEntry((s) => ({ ...s, [field]: String(max) }));
    }
    setEntry((s) => ({ ...s, [field]: raw }));
  };

  const entryAmount = noteItemAmount({
    bags: numOrU(entry.bags),
    pcs: numOrU(entry.pcs),
    kgs: numOrU(entry.kgs),
    box: numOrU(entry.box),
    unit: entry.unit,
    price: numOrU(entry.price),
  });

  const addLine = () => {
    if (!entry.product.trim()) return toast.error('Pick a product from the dropdown first.');
    const qtyOk = [entry.bags, entry.pcs, entry.kgs, entry.box].some((q) => Number(q) > 0);
    if (!qtyOk) return toast.error('Enter at least one quantity (Bags / Pcs / Kgs / Box).');
    const over = entry.limits && QTY_FIELDS.find(([f]) => Number(entry[f] || 0) > entry.limits![f]);
    if (over)
      return toast.error(
        `${over[1]} is more than the ${entry.limits![over[0]]} sold on ${entry.refInvNo || 'this sale'}.`,
      );
    const dup = lines.some(
      (l) =>
        (l.refInvNo ?? '') === entry.refInvNo &&
        l.productName === entry.product &&
        (l.design ?? '') === entry.design,
    );
    if (dup) return toast.error('This item already exists (same Ref Inv + Product + Design).');
    setLines((prev) => [
      ...prev,
      {
        dispatchId: entry.dispatchId || undefined,
        refInvNo: entry.refInvNo || undefined,
        productName: entry.product,
        design: entry.design || undefined,
        bags: numOrU(entry.bags),
        pcs: numOrU(entry.pcs),
        kgs: numOrU(entry.kgs),
        box: numOrU(entry.box),
        unit: entry.unit || undefined,
        price: numOrU(entry.price),
        comment: entry.comment || undefined,
        pCategory: entry.pCategory || undefined,
        gstRate: entry.gstRate,
        productRate: entry.productRate,
        designRate: entry.designRate,
        dispatchRate: entry.dispatchRate,
        invDate: entry.invDate,
      },
    ]);
    setEntry({ ...EMPTY_ENTRY });
  };

  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  // ── save ──────────────────────────────────────────────────────────────────

  /** Set while the credit-note save is waiting on the Undispatched question. */
  const [askUndispatch, setAskUndispatch] = useState(false);

  /**
   * A credit note is a money document; marking it Undispatched ALSO moves stock
   * back into the dispatch pending pool. Those are different decisions, so the
   * save asks rather than guessing. Debit notes never ask — nothing came back.
   */
  const onSave = () => {
    if (!customerId) return toast.error('Select a customer.');
    if (!lines.length) return toast.error('Add at least one item.');
    if (mode === 'CREDIT') return setAskUndispatch(true);
    doSave(false);
  };

  const doSave = (markUndispatched: boolean) => {
    setAskUndispatch(false);
    if (!customerId) return;
    saveMut.mutate(
      {
        mode,
        markUndispatched: markUndispatched || undefined,
        code: editingCode ?? undefined,
        invDate,
        customerId,
        customerName: party,
        category: category || undefined,
        transName: transName || undefined,
        paymentTerm: numOrU(paymentTerm),
        packing: numOrU(packing),
        freight: numOrU(freight),
        pouch: numOrU(pouch),
        otherCharges: numOrU(otherCharges),
        tcs: numOrU(tcs),
        billingRate: numOrU(billingRate),
        remarks: remarks || undefined,
        noBill,
        noBillWithoutGst,
        items: lines.map((l) => ({ ...l, gstRate: l.gstRate })),
      },
      {
        onSuccess: (res) => {
          toast.success(
            `${mode === 'CREDIT' ? 'Credit' : 'Debit'} Note ${res.code} saved — ${money0(res.total)}`,
          );

          // What the note actually settled. The API is authoritative here — the
          // referenced bill may have been paid off since the lines were picked.
          const cl = res.clearance;
          if (cl) {
            const spill = (cl.spillBank ?? 0) + (cl.spillCash ?? 0);
            if (cl.invNo) {
              const applied = (cl.bank ?? 0) + (cl.cash ?? 0);
              if (spill > 0.005) {
                toast.warning(
                  `${money0(applied)} cleared against ${cl.invNo}; ${money0(spill)} went to older dues / advance.`,
                  {
                    duration: 10000,
                  },
                );
              } else {
                toast.success(`${money0(applied)} cleared against ${cl.invNo}.`);
              }
            } else if (cl.skipped === 'ALREADY_SETTLED' || cl.skipped === 'NOT_FOUND') {
              // The user aimed at a specific bill and did not get it — say so.
              toast.warning(noteClearanceReason(cl), { duration: 10000 });
            }
          }

          const u = res.undispatched;
          if (u) {
            if (u.returned)
              toast.success(
                `${u.returned} line${u.returned === 1 ? '' : 's'} put back for dispatch.`,
              );
            // Never silent: a line that did not come back is exactly the kind of
            // thing that gets noticed weeks later.
            if (u.skipped.length) {
              toast.warning(
                `${u.skipped.length} line${u.skipped.length === 1 ? '' : 's'} could not be put back — ${u.skipped.join('; ')}`,
                {
                  duration: 10000,
                },
              );
            }
          }
          resetForNew();
        },
        onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
      },
    );
  };

  useSaveShortcut(onSave);

  // ── load an existing note for edit (from directory) ────────────────────────
  const loadForEdit = async (row: NoteDirectoryRow) => {
    try {
      const n = await fetchNote(row.mode, row.code);
      setMode(n.mode);
      setEditingCode(n.code);
      setInvDate(n.invDate.slice(0, 10));
      setParty(n.customerName);
      setCategory(n.category ?? '');
      setTransName(n.transName ?? '');
      setPaymentTerm(n.paymentTerm != null ? String(n.paymentTerm) : '0');
      setPacking(n.packing != null ? String(n.packing) : '');
      setFreight(n.freight != null ? String(n.freight) : '');
      setPouch(n.pouch != null ? String(n.pouch) : '');
      setOtherCharges(n.otherCharges != null ? String(n.otherCharges) : '');
      setTcs(n.tcs != null ? String(n.tcs) : '');
      setBillingRate(n.billingRate != null ? String(n.billingRate) : '');
      setNoBill(n.noBill);
      setNoBillWithoutGst(false);
      setRemarks(n.remarks ?? '');
      setLines(
        n.items.map((it) => ({
          dispatchId: it.dispatchId,
          refInvNo: it.refInvNo,
          productName: it.productName,
          design: it.design,
          bags: it.bags,
          pcs: it.pcs,
          kgs: it.kgs,
          box: it.box,
          unit: it.unit,
          price: it.price,
          comment: it.comment,
          pCategory: it.pCategory,
          gstRate: n.gst ?? 0,
        })),
      );
      setDirOpen(false);
      toast.success(`Editing ${n.code}`);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Could not load note'));
    }
  };

  const noteLabel = mode === 'CREDIT' ? 'Credit Note' : 'Debit Note';

  return (
    // Fills the viewport on desktop: the voucher pane stays put while only the
    // item grid scrolls. Below `lg` it falls back to a normal scrolling page.
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2.5 font-sans sm:gap-2.5 sm:p-3 lg:overflow-hidden">
      <div className="grid gap-2 sm:gap-2.5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(19rem,21rem)_1fr]">
        {/* ── Voucher pane: identity → charges → totals → commit ──────────── */}
        <section
          className={cn(
            'bg-card flex flex-col overflow-hidden rounded-[4px] border shadow-sm lg:min-h-0',
            PANEL,
          )}
        >
          <div className={DOC_BAR}>
            <span className={DOC_TITLE}>{editingCode ? `Edit ${noteLabel}` : noteLabel}</span>
            <span className="shrink-0 font-mono text-[11px] font-bold text-white tabular-nums">
              {voucherNo}
            </span>
          </div>

          <div className="space-y-2.5 p-2.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {/* Debit vs Credit is the most consequential choice on this screen — it
                flips the sign of the whole voucher — so it leads, as a segmented
                control rather than a dropdown. */}
            <div className="space-y-1">
              <span className={FIELD_LABEL}>Note Type *</span>
              <div
                role="group"
                aria-label="Note type"
                className="grid grid-cols-2 gap-0.5 rounded-[4px] border border-amber-300 bg-amber-50/40 p-0.5 dark:border-amber-400/40 dark:bg-transparent"
              >
                {(['DEBIT', 'CREDIT'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => switchMode(m)}
                    className={cn(
                      'min-h-11 cursor-pointer rounded-[3px] py-1.5 text-[11.5px] font-bold tracking-wide uppercase transition-colors duration-150 lg:min-h-8',
                      mode === m
                        ? m === 'DEBIT'
                          ? 'bg-slate-800 text-white shadow-sm dark:bg-slate-700'
                          : 'bg-emerald-600 text-white shadow-sm'
                        : 'text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-200/70 dark:hover:bg-amber-400/10',
                    )}
                  >
                    {m === 'DEBIT' ? 'Debit' : 'Credit'}
                  </button>
                ))}
              </div>
              <p className="text-muted-foreground text-[11px] leading-snug">
                {mode === 'DEBIT'
                  ? 'Debit note — the party owes MORE (squares off advances).'
                  : 'Credit note — the party owes LESS (clears the Ref Inv, else the oldest dues).'}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="n-date" className={FIELD_LABEL}>
                Date *
              </Label>
              <DatePicker
                id="n-date"
                value={invDate}
                onChange={(v) => v && setInvDate(v)}
                clearable={false}
                className={cn(CONTROL, 'w-full')}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="n-party" className={FIELD_LABEL}>
                Party Name *
              </Label>
              <NativeSelect
                id="n-party"
                value={party}
                onChange={onPartyChange}
                options={partyOptions}
                placeholder="Select party…"
                className={cn(CONTROL, 'font-medium', party && CONTROL_ON)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="n-cat" className={FIELD_LABEL}>
                  Category
                </Label>
                <Input
                  id="n-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={cn(CONTROL, 'uppercase')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="n-term" className={FIELD_LABEL}>
                  Term (days)
                </Label>
                <Input
                  id="n-term"
                  value={paymentTerm}
                  onChange={(e) => setPaymentTerm(e.target.value)}
                  inputMode="numeric"
                  className={cn(CONTROL, 'text-right tabular-nums')}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="n-trans" className={FIELD_LABEL}>
                Transport
              </Label>
              <Input
                id="n-trans"
                value={transName}
                onChange={(e) => setTransName(e.target.value)}
                className={cn(CONTROL, 'uppercase')}
              />
            </div>

            {/* ── Charges ── */}
            <div className="space-y-2 rounded-[4px] border border-amber-300 bg-amber-50/50 p-2 dark:border-amber-400/30 dark:bg-amber-400/[0.07]">
              <span className="text-[10px] font-extrabold tracking-widest text-amber-900/80 uppercase dark:text-amber-200/70">
                Charges
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="n-pack" className={FIELD_LABEL}>
                    Packing
                  </Label>
                  <Input
                    id="n-pack"
                    value={packing}
                    onChange={(e) => setPacking(e.target.value)}
                    inputMode="decimal"
                    className={cn(CONTROL, 'bg-background text-right tabular-nums')}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="n-freight" className={FIELD_LABEL}>
                    Freight
                  </Label>
                  <Input
                    id="n-freight"
                    value={freight}
                    onChange={(e) => setFreight(e.target.value)}
                    inputMode="decimal"
                    className={cn(CONTROL, 'bg-background text-right tabular-nums')}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="n-pouch" className={FIELD_LABEL}>
                    Box / Pouch
                  </Label>
                  <Input
                    id="n-pouch"
                    value={pouch}
                    onChange={(e) => setPouch(e.target.value)}
                    inputMode="decimal"
                    className={cn(CONTROL, 'bg-background text-right tabular-nums')}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="n-other" className={FIELD_LABEL}>
                    Other Charges
                  </Label>
                  <Input
                    id="n-other"
                    value={otherCharges}
                    onChange={(e) => setOtherCharges(e.target.value)}
                    inputMode="decimal"
                    placeholder="from party"
                    className={cn(CONTROL, 'bg-background text-right tabular-nums')}
                  />
                </div>
                {mode === 'DEBIT' ? (
                  <div className="space-y-1">
                    <Label htmlFor="n-tcs" className={FIELD_LABEL}>
                      TCS
                    </Label>
                    <Input
                      id="n-tcs"
                      value={tcs}
                      onChange={(e) => setTcs(e.target.value)}
                      inputMode="decimal"
                      className={cn(CONTROL, 'bg-background text-right tabular-nums')}
                    />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label htmlFor="n-brate" className={FIELD_LABEL}>
                      Billing Rate
                    </Label>
                    <Input
                      id="n-brate"
                      value={billingRate}
                      onChange={(e) => setBillingRate(e.target.value)}
                      inputMode="decimal"
                      placeholder="0 = full"
                      className={cn(CONTROL, 'bg-background text-right tabular-nums')}
                    />
                  </div>
                )}
              </div>
              {mode === 'DEBIT' && (
                <div className="space-y-1">
                  <Label htmlFor="n-brate2" className={FIELD_LABEL}>
                    Billing Rate
                  </Label>
                  <Input
                    id="n-brate2"
                    value={billingRate}
                    onChange={(e) => setBillingRate(e.target.value)}
                    inputMode="decimal"
                    placeholder="0 = full bill"
                    className={cn(CONTROL, 'bg-background text-right tabular-nums')}
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-amber-600/25 pt-1.5 dark:border-amber-400/25">
                <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-semibold select-none">
                  <Switch
                    checked={noBill}
                    onCheckedChange={(v) => {
                      setNoBill(v);
                      if (!v) setNoBillWithoutGst(false);
                    }}
                  />{' '}
                  No Bill
                </label>
                {noBill && (
                  <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-[12px] font-medium select-none">
                    <Switch checked={noBillWithoutGst} onCheckedChange={setNoBillWithoutGst} />{' '}
                    Without GST
                  </label>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="n-rem" className={FIELD_LABEL}>
                Remarks
              </Label>
              <Input
                id="n-rem"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional"
                className={cn(CONTROL, 'uppercase')}
              />
            </div>
          </div>

          {/* Totals + commit, pinned to the foot so they're always reachable. */}
          <div className="shrink-0 border-t border-amber-300 dark:border-amber-400/30">
            <div className="space-y-0.5 bg-amber-50/60 px-2.5 py-2 dark:bg-amber-400/[0.07]">
              <Row2 label="Items total" value={money(breakup.tAmt)} />
              <Row2
                label={`GST${breakup.gstPercent ? ` @ ${breakup.gstPercent}%` : ''}`}
                value={money(breakup.tax)}
              />
              <Row2 label="Round off" value={money(breakup.roundOff)} />
            </div>
            <div
              className={cn(
                'flex items-center justify-between px-2.5 py-2 text-white',
                mode === 'DEBIT' ? 'bg-slate-800 dark:bg-slate-700' : 'bg-emerald-600',
              )}
            >
              <span className="text-[11px] font-extrabold tracking-widest uppercase">
                {mode === 'DEBIT' ? 'Total Dr' : 'Total Cr'}
              </span>
              <span className="text-[16px] font-extrabold tabular-nums">
                {money0(breakup.total)}
              </span>
            </div>
            <div className="space-y-0.5 bg-amber-50/60 px-2.5 py-2 dark:bg-amber-400/[0.07]">
              <Row2
                label="B (bank)"
                value={money0(breakup.b)}
                className="text-blue-700 dark:text-blue-400"
              />
              <Row2
                label="C (cash)"
                value={money0(breakup.c)}
                className="text-emerald-700 dark:text-emerald-400"
              />

              {/* Where this credit will land. Silent auto-allocation is exactly the
                  kind of thing that gets queried a month later, so it is stated. */}
              {mode === 'CREDIT' && lines.length > 0 && (
                <div
                  className={cn(
                    'mt-2 flex items-start gap-2 rounded-md border px-2.5 py-2 text-[11.5px] leading-snug',
                    targetInv
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200'
                      : 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-200',
                  )}
                >
                  {targetInv ? (
                    <Link2 className="mt-px size-3.5 shrink-0" />
                  ) : (
                    <Shuffle className="mt-px size-3.5 shrink-0" />
                  )}
                  <span>
                    {targetInv ? (
                      <>
                        Clears against <b className="font-mono font-bold">{targetInv}</b>. Anything
                        more than that bill's pending amount moves on to the party's oldest dues.
                      </>
                    ) : refInvoices.length > 1 ? (
                      <>
                        Lines reference <b>{refInvoices.length} invoices</b> — clears the party's
                        oldest dues first (FIFO). Keep one Ref Inv per note to settle that bill
                        directly.
                      </>
                    ) : (
                      <>No Ref Inv on these lines — clears the party's oldest dues first (FIFO).</>
                    )}
                  </span>
                </div>
              )}

              <div className="mt-2 flex gap-2">
                <Button
                  onClick={onSave}
                  disabled={saveMut.isPending || !can('note:create')}
                  title={`${editingCode ? 'Update' : 'Save'} ${noteLabel} (Ctrl+S)`}
                  className="h-11 flex-[2] bg-emerald-600 font-bold text-white hover:bg-emerald-700 lg:h-10"
                >
                  {saveMut.isPending ? <Loader2 className="animate-spin" /> : <Check />}{' '}
                  {editingCode ? 'UPDATE' : 'SAVE'}
                </Button>
                <Button
                  variant="outline"
                  onClick={resetForNew}
                  className="h-11 flex-1 border-rose-200 font-semibold text-rose-600 hover:bg-rose-50 lg:h-10 dark:border-rose-400/40 dark:text-rose-400 dark:hover:bg-rose-400/10"
                >
                  <RotateCcw /> {editingCode ? 'CANCEL' : 'CLEAR'}
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Item workspace: add-line bar + the note's lines ─────────────── */}
        <section
          className={cn(
            'bg-card flex flex-col overflow-hidden rounded-[4px] border shadow-sm lg:min-h-0',
            PANEL,
          )}
        >
          <div className={DOC_BAR}>
            <span className={DOC_TITLE}>Items — {party || 'no party selected'}</span>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="hidden text-[11px] font-bold tracking-wide text-white uppercase tabular-nums lg:inline">
                {lines.length} line{lines.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => setDirOpen(true)}
                title={`Browse past ${noteLabel}s`}
                className="flex cursor-pointer items-center gap-1 rounded-[3px] px-1.5 py-1 text-[11px] font-bold tracking-wide text-amber-200 uppercase transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
              >
                <FolderOpen className="size-3.5" />{' '}
                <span className="hidden sm:inline">Directory</span>
              </button>
            </div>
          </div>

          {/* Add-line bar — the recent-sale picker leads, the figures sit in a
              tight strip beneath it, ADD closes the row. */}
          <div className="shrink-0 space-y-2 border-b border-amber-300 bg-amber-50/40 p-2 dark:border-amber-400/30 dark:bg-amber-400/[0.05]">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              <div className="col-span-2 space-y-1 lg:col-span-3">
                <Label className={FIELD_LABEL}>Pick a past sale (last 12 months)</Label>
                <div className="flex items-center gap-1.5">
                  {/* flex-1 + min-w-0: the Combobox's own wrapper is a plain block
                      div, so as a bare flex item it shrinks to the input's
                      intrinsic ~20ch and leaves the rest of the column empty
                      (its `w-full` then resolves against that shrunken box). */}
                  <div className="min-w-0 flex-1">
                    <Combobox
                      value=""
                      onChange={pickRecent}
                      options={recentSold.map((r: RecentSoldRow, i) => ({
                        value: String(i),
                        label: `${r.invNo} · ${r.productName}${r.design ? ` · ${r.design}` : ''} · ${money(r.price)}`,
                      }))}
                      placeholder={customerId ? 'Search a past sale…' : 'Select a party first'}
                      className={cn(CONTROL, 'w-full')}
                    />
                  </div>
                  {canViewChallans && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0"
                      disabled={!entry.refInvNo}
                      onClick={() => openChallan(entry.refInvNo)}
                      title={
                        entry.refInvNo
                          ? `View challan ${entry.refInvNo}`
                          : 'Pick a past sale to view its challan'
                      }
                      aria-label={
                        entry.refInvNo ? `View challan ${entry.refInvNo}` : 'View challan'
                      }
                    >
                      <ArrowUpRight className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <Label className={FIELD_LABEL}>Product *</Label>
                <Input
                  value={entry.product}
                  onChange={(e) => setEntry((s) => ({ ...s, product: e.target.value }))}
                  className={cn(CONTROL, 'bg-background')}
                />
              </div>
              <div className="space-y-1">
                <Label className={FIELD_LABEL}>Design</Label>
                <Input
                  value={entry.design}
                  onChange={(e) => setEntry((s) => ({ ...s, design: e.target.value }))}
                  className={cn(CONTROL, 'bg-background')}
                />
              </div>
              <div className="space-y-1">
                <Label className={FIELD_LABEL}>Ref Inv</Label>
                <Input
                  value={entry.refInvNo}
                  onChange={(e) => setEntry((s) => ({ ...s, refInvNo: e.target.value }))}
                  className={cn(CONTROL, 'bg-background font-mono')}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              <div className="space-y-1">
                <Label className={FIELD_LABEL}>Unit</Label>
                <Input
                  value={entry.unit}
                  onChange={(e) => setEntry((s) => ({ ...s, unit: e.target.value }))}
                  placeholder="KGS"
                  className={cn(CONTROL, 'bg-background uppercase')}
                />
              </div>
              {QTY_FIELDS.map(([field, label]) => {
                const max = entry.limits?.[field] ?? null;
                const locked = max === 0;
                return (
                  <div key={field} className="space-y-1">
                    <Label className={cn(FIELD_LABEL, 'flex items-center gap-1.5')}>
                      {label}
                      {/* The ceiling is the whole point of these fields — it was set
                          in a muted colour AND dimmed again, which read as absent. */}
                      {max ? (
                        <span className="rounded-[3px] bg-amber-200 px-1 py-px text-[10.5px] font-extrabold tracking-normal text-amber-950 normal-case tabular-nums dark:bg-amber-400/30 dark:text-amber-50">
                          max {max}
                        </span>
                      ) : locked ? (
                        <span className="rounded-[3px] bg-rose-100 px-1 py-px text-[10.5px] font-extrabold tracking-normal text-rose-800 normal-case dark:bg-rose-400/20 dark:text-rose-200">
                          none
                        </span>
                      ) : null}
                    </Label>
                    <Input
                      value={entry[field]}
                      onChange={(e) => setQty(field, e.target.value)}
                      disabled={locked}
                      title={
                        locked
                          ? `${entry.refInvNo || 'This sale'} has no ${label.toLowerCase()} to adjust`
                          : undefined
                      }
                      inputMode="decimal"
                      className={cn(
                        CONTROL,
                        'bg-background text-right tabular-nums',
                        locked && 'text-muted-foreground cursor-not-allowed opacity-60',
                      )}
                    />
                  </div>
                );
              })}
              <div className="space-y-1">
                <Label className={FIELD_LABEL}>Price</Label>
                <Input
                  value={entry.price}
                  onChange={(e) => setEntry((s) => ({ ...s, price: e.target.value }))}
                  inputMode="decimal"
                  className={cn(CONTROL, 'bg-background text-right tabular-nums')}
                />
              </div>
              <div className="space-y-1">
                <Label className={FIELD_LABEL}>Amount</Label>
                <Input
                  value={money(entryAmount)}
                  readOnly
                  tabIndex={-1}
                  className={cn(
                    CONTROL,
                    'bg-muted/50 cursor-default text-right font-bold tabular-nums',
                  )}
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  onClick={addLine}
                  className="h-9 w-full rounded-[4px] font-bold"
                >
                  <Plus className="size-3.5" /> ADD
                </Button>
              </div>
            </div>
            <Input
              value={entry.comment}
              onChange={(e) => setEntry((s) => ({ ...s, comment: e.target.value }))}
              placeholder="Line comment (optional)"
              className={cn(CONTROL, 'bg-background')}
            />
          </div>

          {/* Desktop line grid. */}
          <div
            className={cn(
              'hidden overflow-x-auto overscroll-x-contain sm:block lg:min-h-0 lg:flex-1 lg:overflow-auto',
              '[scrollbar-width:thin] [scrollbar-color:var(--color-amber-400)_var(--color-amber-100)]',
            )}
          >
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">Lines on this {noteLabel}</caption>
              <thead>
                <tr>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-9 text-center')}>
                    #
                  </th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-28')}>
                    Ref Inv
                  </th>
                  <th scope="col" className={cn(TH, TH_LINE)}>
                    Product
                  </th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-24')}>
                    Design
                  </th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-16 text-right')}>
                    Bags
                  </th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-16 text-right')}>
                    Pcs
                  </th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-16 text-right')}>
                    Kgs
                  </th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-16 text-right')}>
                    Box
                  </th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-14')}>
                    Unit
                  </th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-24 text-right')}>
                    Price
                  </th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-28 text-right')}>
                    Amount
                  </th>
                  <th scope="col" className={cn(TH, TH_LINE, 'w-14 text-right')}>
                    GST%
                  </th>
                  <th scope="col" className={cn(TH, 'w-20')} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td
                      colSpan={13}
                      className="text-muted-foreground h-28 text-center text-[13px] font-medium"
                    >
                      {party
                        ? 'No lines yet — pick a past sale or type a product above, then press ADD.'
                        : 'Select a party to begin.'}
                    </td>
                  </tr>
                ) : (
                  lines.map((l, i) => (
                    <tr
                      key={i}
                      className="border-b border-amber-200/70 even:bg-amber-50/70 hover:bg-amber-200/70 dark:border-amber-400/10 dark:even:bg-amber-400/[0.05] dark:hover:bg-amber-400/20"
                    >
                      <td
                        className={cn(
                          TD,
                          'text-center text-[12px] font-bold text-slate-500 tabular-nums dark:text-slate-400',
                        )}
                      >
                        {i + 1}
                      </td>
                      <td className={cn(TD, 'font-mono text-[12.5px] font-bold whitespace-nowrap')}>
                        {l.refInvNo ?? '—'}
                      </td>
                      <td className={cn(TD, 'font-semibold text-slate-800 dark:text-slate-200')}>
                        {l.productName}
                      </td>
                      <td
                        className={cn(
                          TD,
                          'text-[12px] font-medium text-slate-600 dark:text-slate-400',
                        )}
                      >
                        {l.design ?? '—'}
                      </td>
                      <td className={cn(TD, NUM, 'font-semibold')}>{l.bags ?? '-'}</td>
                      <td className={cn(TD, NUM, 'font-semibold')}>{l.pcs ?? '-'}</td>
                      <td className={cn(TD, NUM, 'font-semibold')}>{l.kgs ?? '-'}</td>
                      <td className={cn(TD, NUM, 'font-semibold')}>{l.box ?? '-'}</td>
                      <td
                        className={cn(
                          TD,
                          'text-[11.5px] font-bold tracking-wide uppercase text-slate-500 dark:text-slate-400',
                        )}
                      >
                        {l.unit ?? '—'}
                      </td>
                      <td className={cn(TD, NUM, 'font-semibold')}>
                        <PriceBreakdown line={l}>{money(l.price ?? 0)}</PriceBreakdown>
                      </td>
                      <td className={cn(TD, NUM, 'font-bold text-slate-900 dark:text-slate-100')}>
                        <PriceBreakdown line={l}>{money(noteItemAmount(l))}</PriceBreakdown>
                      </td>
                      <td
                        className={cn(
                          TD,
                          NUM,
                          'text-[12px] font-medium text-slate-600 dark:text-slate-400',
                        )}
                      >
                        {l.gstRate ?? 0}
                      </td>
                      <td className={cn(TD, 'text-center whitespace-nowrap')}>
                        {canViewChallans && l.refInvNo && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => openChallan(l.refInvNo!)}
                            title={`View challan ${l.refInvNo}`}
                            aria-label={`View challan ${l.refInvNo}`}
                          >
                            <ArrowUpRight className="size-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:text-destructive"
                          onClick={() => removeLine(i)}
                          aria-label={`Remove line ${i + 1}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {lines.length > 0 && (
                <tfoot className="sticky bottom-0 z-20">
                  <tr className="bg-amber-200/90 font-bold shadow-[inset_0_2px_0_0_var(--color-amber-700)] dark:bg-amber-400/20 dark:shadow-[inset_0_2px_0_0_var(--color-amber-400)]">
                    <td className={TD} colSpan={9} />
                    <td
                      className={cn(
                        TD,
                        'text-[11px] font-extrabold tracking-wide text-amber-950 uppercase dark:text-amber-100',
                      )}
                    >
                      Total
                    </td>
                    <td className={cn(TD, NUM, 'text-[13.5px] font-extrabold')}>
                      {money(breakup.tAmt)}
                    </td>
                    <td className={TD} colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Phones: one card per line. */}
          <div className="space-y-2 p-2 sm:hidden">
            {lines.length === 0 ? (
              <p className="text-muted-foreground px-4 py-8 text-center text-[13px] font-medium">
                {party ? 'No lines yet — add one above.' : 'Select a party to begin.'}
              </p>
            ) : (
              lines.map((l, i) => (
                <div
                  key={i}
                  className="rounded-[4px] border border-amber-200 bg-amber-50/60 p-2.5 shadow-sm dark:border-amber-400/20 dark:bg-amber-400/[0.06]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-bold text-slate-900 dark:text-slate-100">
                        {l.productName}
                        {l.design ? ` · ${l.design}` : ''}
                      </p>
                      {l.refInvNo && (
                        <p className="text-muted-foreground font-mono text-[11px]">
                          Ref {l.refInvNo}
                        </p>
                      )}
                      <p className="text-muted-foreground text-[11.5px]">
                        {[
                          l.bags ? `${l.bags} bags` : null,
                          l.pcs ? `${l.pcs} pcs` : null,
                          l.kgs ? `${l.kgs} kgs` : null,
                          l.box ? `${l.box} box` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                        {' · '}
                        {money(l.price ?? 0)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-[13.5px] font-extrabold tabular-nums">
                        {money(noteItemAmount(l))}
                      </span>
                      {canViewChallans && l.refInvNo && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openChallan(l.refInvNo!)}
                          aria-label={`View challan ${l.refInvNo}`}
                        >
                          <ArrowUpRight className="size-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => removeLine(i)}
                        aria-label={`Remove line ${i + 1}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <NoteDirectoryDialog
        open={dirOpen}
        onOpenChange={setDirOpen}
        mode={mode}
        onEdit={loadForEdit}
        onDelete={del}
        canDelete={can('note:delete')}
        canPrint={can('note:print')}
        confirm={confirm}
      />

      {/* Whole invoice, or just this item? Asked once per invoice per note. */}
      <Dialog open={!!askInvoice} onOpenChange={(o) => !o && setAskInvoice(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="size-5 text-primary" /> Invoice {askInvoice?.invNo}
            </DialogTitle>
          </DialogHeader>
          <p className="text-[13px]">
            This invoice has <b>{askInvoice?.rows.length} items</b>. Add them all, or only{' '}
            <b>{askInvoice?.picked.productName}</b>?
          </p>
          <p className="text-muted-foreground text-[11.5px]">
            Adding all brings each item in at its full sold quantity — you can still change any line
            afterwards. You will not be asked about {askInvoice?.invNo} again on this note.
          </p>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              className="h-11 flex-1"
              onClick={() => {
                if (!askInvoice) return;
                setInvoiceChoice((m) => ({ ...m, [askInvoice.invNo]: 'ONE' }));
                const only = askInvoice.picked;
                setAskInvoice(null);
                // Re-enter the normal single-item path now the choice is recorded.
                pickRecent(String(recentSold.indexOf(only)));
              }}
            >
              Only this item
            </Button>
            <Button
              className="h-11 flex-1"
              onClick={() => {
                if (!askInvoice) return;
                setInvoiceChoice((m) => ({ ...m, [askInvoice.invNo]: 'ALL' }));
                addWholeInvoice(askInvoice.invNo);
                setAskInvoice(null);
              }}
            >
              Add all {askInvoice?.rows.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credit note only: is this also a stock return? */}
      <Dialog open={askUndispatch} onOpenChange={(o) => !o && setAskUndispatch(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="size-5 text-primary" /> Save this credit note
            </DialogTitle>
          </DialogHeader>
          <p className="text-[13px]">Did these goods physically come back?</p>
          <div className="text-muted-foreground space-y-1.5 text-[11.5px]">
            <p>
              <b className="text-foreground">Mark as Undispatched</b> — the credit note is raised{' '}
              <i>and</i> the returned quantity goes back into Dispatch Orders, so it can be
              dispatched again.
            </p>
            <p>
              <b className="text-foreground">Just the credit note</b> — money only. Nothing changes
              in dispatch.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              className="h-11 flex-1"
              disabled={saveMut.isPending}
              onClick={() => doSave(false)}
            >
              Just the credit note
            </Button>
            <Button
              className="h-11 flex-1"
              disabled={saveMut.isPending}
              onClick={() => doSave(true)}
            >
              {saveMut.isPending ? <Loader2 className="animate-spin" /> : <Undo2 />} Mark as
              Undispatched
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A label/value line in the totals card — same shape as Create Challan's. */
function Row2({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between text-[13px]', className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

// ── Directory dialog ──────────────────────────────────────────────────────────
function NoteDirectoryDialog({
  open,
  onOpenChange,
  mode,
  onEdit,
  onDelete,
  canDelete,
  canPrint,
  confirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: NoteMode;
  onEdit: (r: NoteDirectoryRow) => void;
  onDelete: ReturnType<typeof useDeleteNote>;
  canDelete: boolean;
  canPrint: boolean;
  confirm: ReturnType<typeof useConfirm>;
}) {
  const navigate = useNavigate();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [payMode, setPayMode] = useState('ALL');
  const { data, isLoading } = useNoteDirectory({
    mode,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    payMode,
  });
  const rows = data?.items ?? [];

  const handleDelete = async (r: NoteDirectoryRow) => {
    const ok = await confirm({
      title: `Delete ${r.code}?`,
      description:
        'This reverses its ledger, receipts, advance and opening entries. This cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    onDelete.mutate(
      { mode: r.mode, code: r.code },
      {
        onSuccess: () => toast.success(`${r.code} deleted`),
        onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
      },
    );
  };

  const cols: DataColumn<NoteDirectoryRow>[] = [
    {
      id: 'code',
      label: 'No',
      cell: (r) => <span className={cn(TEXT_CELL, 'font-mono')}>{r.code}</span>,
    },
    {
      id: 'date',
      label: 'Date',
      cell: (r) => (
        <span className={cn(TEXT_CELL, 'whitespace-nowrap tabular-nums')}>
          {prettyDate(r.invDate)}
        </span>
      ),
    },
    {
      id: 'party',
      label: 'Customer',
      cell: (r) => <span className={TEXT_CELL}>{r.customerName}</span>,
    },
    {
      id: 'b',
      label: 'B (bank)',
      align: 'right',
      cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money0(r.b)}</span>,
    },
    {
      id: 'c',
      label: 'C (cash)',
      align: 'right',
      cell: (r) => <span className={cn(TEXT_CELL, 'tabular-nums')}>{money0(r.c)}</span>,
    },
    {
      id: 'total',
      label: 'Total',
      align: 'right',
      cell: (r) => (
        <span className={cn(TEXT_CELL, 'tabular-nums font-bold')}>{money0(r.total)}</span>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{mode === 'CREDIT' ? 'Credit Note' : 'Debit Note'} Directory</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-sm">From</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className={cn(CONTROL, 'font-medium', fromDate && CONTROL_ON)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">To</Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className={cn(CONTROL, 'font-medium', toDate && CONTROL_ON)}
            />
          </div>
          <div className="w-40 space-y-1">
            <Label className="text-sm">Pay Mode</Label>
            <NativeSelect
              value={payMode}
              onChange={setPayMode}
              options={['ALL', 'BANK', 'CASH', 'BOTH']}
              className={cn(CONTROL, 'font-medium', payMode && payMode !== 'ALL' && CONTROL_ON)}
            />
          </div>
          <div className="bg-card ml-auto rounded-[4px] border px-3 py-2 shadow-sm">
            <p className="text-muted-foreground text-[12px] font-medium">
              {rows.length} record{rows.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <div className="max-h-[55vh] overflow-auto">
          <DataTable
            columns={cols}
            rows={rows}
            rowKey={(r) => r.code}
            isLoading={isLoading}
            emptyText="No notes for these filters."
            onRowClick={(r) => onEdit(r)}
            className={DIRECTORY_GRID_CLASSES}
            actions={(r) => (
              <div className="flex justify-end gap-1">
                {/* Opens the letterhead bill page and PREVIEWS the finished PDF
                    there, exactly as the challan list does. It used to auto-print,
                    which handed over the browser's Save-as-PDF chooser instead of
                    a look at the document. `returnTo` brings the user back here
                    when they close the preview. */}
                {canPrint && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => {
                      // iOS cannot render a PDF in an iframe and needs a tab
                      // reserved inside this very click, or the popup is blocked.
                      if (isIOS()) reservePreviewTab();
                      navigate(
                        `/account/notes/bill?mode=${r.mode}&code=${encodeURIComponent(r.code)}`,
                        {
                          state: { autoPreview: true, returnTo: '/account/notes' },
                        },
                      );
                    }}
                    aria-label={`Preview ${r.code}`}
                    title={`Preview ${r.code}`}
                  >
                    <Printer className="size-4" />
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(r)}
                    aria-label="Delete"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            )}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
