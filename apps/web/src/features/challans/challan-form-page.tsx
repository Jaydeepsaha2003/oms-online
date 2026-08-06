import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  Camera,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronDown,
  Hash,
  History,
  ListX,
  Loader2,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  ScrollText,
  SlidersHorizontal,
  Trash2,
  UserSearch,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ACTIONS,
  CHALLAN_STATUSES,
  computeChallanTotals,
  perm,
  qtyOrderForCategory,
  RESOURCES,
  type ChallanDraft,
  type ChallanDraftItem,
  type CreateChallanInput,
  type DuplicateMatch,
  type PendingChallanLine,
  type QtyField,
} from '@oms/shared';
import { cn } from '@/lib/utils';
import { getApiErrorMessage, getDuplicateMatch } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { useConfirm } from '@/components/common/confirm';
import { RecordHistory } from '@/components/common/record-history';
import { Combo, NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePermissions } from '@/hooks/use-permissions';
import { useOrderQtyLayout } from '@/features/settings/use-settings';
import { LiveLinePhotos } from '../orders/line-photos';
import { useOrderItemPhotos } from '../orders/use-orders';
import {
  useAllChallanCustomers,
  useChallanDraft,
  useChallanEdit,
  useChallanNextCode,
  useChallanPrefixSettings,
  useCreateChallan,
  useUpdateChallan,
} from './use-challans';
import { clearChallanDraft, loadChallanDraft, saveChallanDraft, type ChallanDraftData } from './challan-draft';
import { MissingChallanDialog } from './missing-challan-dialog';
import { RateFixDialog } from './rate-fix-dialog';
import { MissingRateBadge, missingRatesFor } from './rate-status';

type NavState = { customerName?: string; lines?: PendingChallanLine[]; returnTo?: string };
type Row = ChallanDraftItem & { key: string };

/** Bags/Pcs/Kgs/Box column order + accessors, driven by Settings → Order quantity
 *  fields. A challan's rows can span several product categories at once, and an
 *  HTML table's columns can't vary per row — so unlike the single-item forms
 *  (New Order, Dispatch, Order Modify), this table always uses the layout's
 *  DEFAULT arrangement rather than a per-row category lookup. */
const QTY_COL_LABEL: Record<QtyField, string> = { bags: 'Bags', pcs: 'Pcs', kgs: 'Kgs', box: 'Box' };
const qtyCell = (r: Row, f: QtyField): number | null => (f === 'bags' ? r.bags : f === 'pcs' ? r.pcs : f === 'kgs' ? r.kgs : r.box);
const qtyTotal = (t: ReturnType<typeof computeChallanTotals>, f: QtyField): number =>
  f === 'bags' ? t.tBags : f === 'pcs' ? t.tPcs : f === 'kgs' ? t.tKgs : t.tBox;

const inr = (v: number) => `₹ ${(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const numOr = (s: string) => {
  const v = parseFloat((s ?? '').replace(/,/g, ''));
  return Number.isFinite(v) ? v : 0;
};
const isKgs = (unit: string | null) => ['KGS', 'KG', 'KGS.'].includes((unit ?? '').trim().toUpperCase());
const round5 = (x: number) => Math.round(x / 5) * 5;
const round2 = (x: number) => Math.round(x * 100) / 100;
const n = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : 0);
// Quantities (bags/pcs/kgs/box) render at 3 decimals max, trailing zeros dropped.
// Float sums like 69.8 + 71.6 are otherwise shown raw as 141.39999999999998.
const qty = (v: number | null | undefined) =>
  Number.isFinite(v as number) ? (v as number).toLocaleString('en-IN', { maximumFractionDigits: 3 }) : null;
const itemLabel = (it: ChallanDraftItem) =>
  // Quantities go through qty() (3-decimal, trailing zeros dropped) so the label —
  // which is also the text shown in the Add-line field once picked — never leaks a
  // raw float like 74.0999999 (matches how the grid/rows already render qty).
  `${it.productName || '(item)'} · ${it.design || 'NA'} · ${isKgs(it.unit) ? `${qty(n(it.kgs))}kg` : `${qty(n(it.pcs))}pc`} @ ₹${n(it.price)}  #${it.dispatchId}`;

// Shipping Address input is hidden for now — flip to true to bring the field back.
// The value itself is still tracked/saved (defaults to the billing address), so
// hiding it changes nothing about what gets stored on the challan.
const SHOW_SHIPPING_ADDRESS = false;

// `null` on gstRate/freightRate/packingRate means the rate master has NO row at
// all for that item's category (+ transport) — genuinely unconfigured, not the
// same as a deliberately-set 0. Flag it loudly: a silent 0 here means the party
// gets billed short on freight/packing, or undercharged/overcharged GST.
const warnMissingRates = (items: ChallanDraftItem[]) => {
  const missing = new Map<string, Set<string>>(); // category → which rates are missing
  for (const it of items) {
    const miss = missingRatesFor(it);
    if (!miss.length) continue;
    const cat = it.pCategory || 'this item';
    const set = missing.get(cat) ?? new Set<string>();
    miss.forEach((m) => set.add(m));
    missing.set(cat, set);
  }
  if (!missing.size) return;
  const detail = [...missing.entries()].map(([cat, rates]) => `${cat} — ${[...rates].join('/')}`).join(', ');
  toast.warning('Some rates are not set up for these items', {
    description: `${detail}. They'll bill as ₹0 until added under Customer GST Rates / Transport Rates.`,
    duration: 9000,
  });
};

/** Read-only viewer for a challan line's reference photos — the same photos
 *  attached back on the order line (Order Modify / Dispatch), surfaced here so
 *  anyone building or reviewing the challan can see what was actually shipped.
 *  Shows nothing for a manual/SCRAP line (no order line to attach photos to). */
function ItemPhotosButton({ orderItemId }: { orderItemId: number }) {
  const [open, setOpen] = useState(false);
  const { data: photos } = useOrderItemPhotos(orderItemId);
  const count = photos?.length ?? 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-bold transition-colors',
          count ? 'text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-400/10' : 'text-muted-foreground/50 hover:text-muted-foreground',
        )}
        title={count ? `View ${count} photo${count === 1 ? '' : 's'}` : 'No photos on this line'}
      >
        <Camera className="size-3" />
        {count > 0 && <span className="tabular-nums">{count}</span>}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Line photos</DialogTitle>
          </DialogHeader>
          <LiveLinePhotos orderItemId={orderItemId} canEdit={false} hideHeader />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ChallanFormPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const params = useParams();
  const editId = params.id ? Number(params.id) : null;
  const isEdit = editId != null;

  const { state } = useLocation() as { state: NavState | null };
  const navCustomer = state?.customerName ?? '';
  // Position of each dispatchId in the order rows were ticked on Pending Challan —
  // a Map (not a Set) so that click order survives the trip here (see below).
  const navOrder = useMemo(() => {
    const m = new Map<number, number>();
    (state?.lines ?? []).forEach((l, i) => m.set(l.dispatchId, i));
    return m;
  }, [state]);
  // Callers (e.g. Party Ledger's "view challan") can override where Back/Cancel
  // return to, so closing this form lands back on the exact view the user came from.
  const backTo = state?.returnTo ?? (isEdit ? '/challans' : '/challans/pending');

  const [customer, setCustomer] = useState(navCustomer);
  const { data: customers = [], isLoading: custLoading } = useAllChallanCustomers();
  const { data: prefixSettings } = useChallanPrefixSettings();
  const createDraftQ = useChallanDraft(!isEdit && customer ? { customerName: customer } : null);
  const editQ = useChallanEdit(isEdit ? editId : null);

  const createChallan = useCreateChallan();
  const updateChallan = useUpdateChallan();
  const saving = createChallan.isPending || updateChallan.isPending;

  // Bags/Pcs/Kgs/Box column order — Settings → Order quantity fields' DEFAULT
  // arrangement (see the QTY_COL_LABEL comment above for why this table can't
  // vary the order per row).
  const { data: qtyLayout } = useOrderQtyLayout();
  const qtyOrder = useMemo(() => qtyOrderForCategory(qtyLayout, undefined), [qtyLayout]);

  const draft = isEdit ? editQ.data?.draft : createDraftQ.data;
  const savedChallan = editQ.data?.challan;
  const isError = isEdit ? editQ.isError : createDraftQ.isError;

  // Tracks which screen the one-time init below has already run for. Declared
  // here (not beside its effect) because `isLoading` has to know whether that
  // init has happened yet.
  const initedRef = useRef('');

  // A draft served from cache is NOT the data this screen may act on.
  //
  // Both draft queries are `staleTime: Infinity` + `refetchOnMount: 'always'`,
  // so re-opening a party already fetched this session hands the component the
  // OLD pool immediately and the fresh one a moment later. The one-shot init
  // effect latched onto that first snapshot and then ignored the real response
  // — so lines dispatched (or rates fixed) since the last visit were missing
  // from Create Challan until a hard reload, the one thing that empties the
  // in-memory cache. Waiting for the fetch to settle removes the race: the form
  // is only ever built from what the server just said.
  const draftSettling = isEdit ? editQ.isFetching : createDraftQ.isFetching;

  // Show the spinner while that first fetch settles instead of an empty item
  // table. Only until the init runs — a later background refetch (a rate edit
  // invalidating this cache, say) must not blank out a form being worked on.
  const isLoading =
    (isEdit ? editQ.isLoading : !!customer && createDraftQ.isLoading) || (draftSettling && !initedRef.current);

  // Working state.
  const [rows, setRows] = useState<Row[]>([]);
  const [addSel, setAddSel] = useState('');
  // Bumped after each add to force a clean remount of the Add-line select, so its
  // field text clears instead of lingering on the item just added (the shared
  // Combobox otherwise restores stale text on blur).
  const [addKey, setAddKey] = useState(0);
  const [invDate, setInvDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [prefix, setPrefix] = useState('');
  const [manualCode, setManualCode] = useState(''); // '' = auto (server-assigned) invoice number
  const [missingChallanOpen, setMissingChallanOpen] = useState(false);
  const [status, setStatus] = useState<string>('CONFIRMED');
  const [freight, setFreight] = useState('0');
  const [packing, setPacking] = useState('0');
  const [pouch, setPouch] = useState('0');
  const [billingRate, setBillingRate] = useState('0');
  const [gstPct, setGstPct] = useState('0');
  const [noBill, setNoBill] = useState(false);
  const [noBillRemoveGst, setNoBillRemoveGst] = useState(false);
  const [manualTax, setManualTax] = useState(''); // '' = auto
  const [manualB, setManualB] = useState(''); // '' = auto
  const [manualC, setManualC] = useState(''); // '' = auto
  const [shippingAddress, setShippingAddress] = useState('');
  const [remarks, setRemarks] = useState('');
  const [locked, setLocked] = useState({ freight: true, packing: true, pouch: true });
  // Phones: charges/shipping are secondary — tucked behind a "More details" toggle
  // so the totals card is reachable without scrolling past a wall of inputs.
  const [showDetails, setShowDetails] = useState(false);
  // Manual line entry.
  const [showManual, setShowManual] = useState(false);
  const [m, setM] = useState({ product: '', design: 'NA', unit: 'KGS', qty: '', price: '' });
  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedCode, setSavedCode] = useState('');
  const [rateFixOpen, setRateFixOpen] = useState(false);
  // Writing the masters needs create rights on BOTH — the dialog may have to
  // write a GST row and a transport row for the same category.
  const { can } = usePermissions();
  const canFixRates = can(perm(RESOURCES.GST_RATE, ACTIONS.CREATE)) && can(perm(RESOURCES.TRANS_RATE, ACTIONS.CREATE));

  // ── Work-in-progress local draft (Form14 TempChallanTbl): persist a half-built
  // challan across refresh/navigation and offer it back. New challan only. ──
  const draftEnabled = !isEdit;
  const draftReady = useRef(false); // gates auto-save until the initial restore settles
  const restoreRef = useRef<ChallanDraftData | null>(null); // saved rows/fields awaiting the draft fetch
  const [restoredDraft, setRestoredDraft] = useState(false);

  // Live invoice-no preview for the chosen prefix + date (server assigns this
  // unless overridden — see manualCode below).
  const nextCodeQ = useChallanNextCode(!isEdit ? prefix || undefined : undefined, invDate, !isEdit);
  const previewCode = isEdit ? savedChallan?.code ?? '—' : nextCodeQ.data?.code ?? draft?.code ?? '—';
  // Invoice No stays a free-editable textbox (Form14 InvNo) — typing a number
  // overrides the auto-assigned one; clearing it reverts to auto.
  const effectiveCode = manualCode.trim() || previewCode;

  const recalc = (rs: Row[], d = draft) => {
    if (!d) return;
    setFreight(String(round5(rs.reduce((a, r) => a + n(r.bags) * n(r.freightRate), 0))));
    setPacking(String(round5(rs.reduce((a, r) => a + n(r.bags) * n(r.packingRate), 0))));
    setPouch(String(round2(rs.reduce((a, r) => a + n(r.box), 0) * n(d.boxRate))));
    setGstPct(String(Math.max(0, ...rs.map((r) => n(r.gstRate)), 0)));
  };

  // Restore a saved WIP challan once on mount (new challan, not arriving from
  // Pending Challan). Setting the customer triggers the draft fetch; the init
  // effect below then applies the saved rows + edits.
  useEffect(() => {
    if (!draftEnabled) {
      draftReady.current = true;
      return;
    }
    if (navCustomer) {
      // Came from "Create Challan" on the Pending list — honour that selection.
      draftReady.current = true;
      return;
    }
    const d = loadChallanDraft();
    if (d && d.customer && Array.isArray(d.rows) && d.rows.length) {
      restoreRef.current = d;
      setRestoredDraft(true);
      setCustomer(d.customer); // fetches the pool → init effect restores the rest
    } else {
      draftReady.current = true;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // One-time init when the data arrives — from the SETTLED fetch, never from a
  // cached snapshot still being revalidated (see `draftSettling`).
  useEffect(() => {
    if (!draft || draftSettling) return;
    const key = isEdit ? `edit:${editId}` : `create:${draft.customerName}`;
    if (initedRef.current === key) return;
    initedRef.current = key;
    setPrefix(draft.prefix);

    if (isEdit && savedChallan && editQ.data) {
      const c = savedChallan;
      setRows(editQ.data.rows.map((it, i) => ({ ...it, key: `${it.dispatchId ?? 'm'}-${i}` })));
      setInvDate((c.invDate ?? new Date().toISOString()).slice(0, 10));
      setStatus(c.challanStatus);
      setFreight(String(c.freight ?? 0));
      setPacking(String(c.packing ?? 0));
      setPouch(String(c.pouch ?? 0));
      setBillingRate(String(c.billingRate ?? 0));
      setGstPct(String(c.gst ?? 0));
      setNoBill(!!c.noBill);
      setNoBillRemoveGst(!!c.noBill && n(c.tax) === 0);
      setShippingAddress(c.shippingAddress || c.billingAddress || draft.billingAddress || '');
      setRemarks(c.remarks ?? '');
      if (draft.isScrap) setM((x) => ({ ...x, product: draft.defaultManualProduct ?? '', unit: 'KGS' }));
    } else if (!isEdit) {
      const restore = restoreRef.current;
      if (restore && restore.customer === draft.customerName) {
        // Reinstate the saved WIP challan (TempChallanTbl equivalent).
        restoreRef.current = null;
        setRows((restore.rows as Row[]).map((it, i) => ({ ...it, key: `${it.dispatchId ?? 'm'}-${i}` })));
        setInvDate(restore.invDate || invDate);
        setPrefix(restore.prefix || draft.prefix);
        setManualCode(restore.manualCode || '');
        setStatus(restore.status || 'CONFIRMED');
        setFreight(restore.freight);
        setPacking(restore.packing);
        setPouch(restore.pouch);
        setBillingRate(restore.billingRate || String(draft.billingRate ?? 0));
        setGstPct(restore.gstPct);
        setNoBill(!!restore.noBill);
        setNoBillRemoveGst(!!restore.noBillRemoveGst);
        setManualTax(restore.manualTax || '');
        setManualB(restore.manualB || '');
        setManualC(restore.manualC || '');
        setShippingAddress(restore.shippingAddress || draft.billingAddress || '');
        setRemarks(restore.remarks || '');
        if (draft.isScrap) setM((x) => ({ ...x, product: draft.defaultManualProduct ?? '', unit: 'KGS' }));
        draftReady.current = true;
        return;
      }
      // Filtered by the picked ids, then re-sorted to match the order they were
      // ticked in on Pending Challan (`filter` alone would keep the pool's own order).
      const preset =
        customer === navCustomer && navOrder.size
          ? draft.items
              .filter((i) => i.dispatchId != null && navOrder.has(i.dispatchId))
              .sort((a, b) => (navOrder.get(a.dispatchId!) ?? 0) - (navOrder.get(b.dispatchId!) ?? 0))
          : [];
      const next = preset.map((it, i) => ({ ...it, key: `${it.dispatchId ?? 'm'}-${i}` }));
      setRows(next);
      setBillingRate(String(draft.billingRate ?? 0));
      setShippingAddress(draft.billingAddress ?? '');
      recalc(next, draft);
      if (preset.length) warnMissingRates(preset);
      if (draft.isScrap) setM((x) => ({ ...x, product: draft.defaultManualProduct ?? '', unit: 'KGS' }));
      draftReady.current = true;
    }
  }, [draft, draftSettling, savedChallan, editQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scrap parties bill as manual lines (there's no dispatched pool), so open the
  // manual entry automatically — its design field is locked (scrap carries no design).
  useEffect(() => {
    if (draft?.isScrap) setShowManual(true);
  }, [draft?.isScrap]);

  // Auto-save the WIP challan (debounced) whenever it has content; clear when empty.
  //
  // `savedId` stops it dead once the challan is persisted. Without that guard the
  // 800ms debounce loses a race: a save that lands within 800ms of the last edit
  // leaves a timer pending, which then fires AFTER onSuccess called
  // clearChallanDraft() and rewrites the draft — resurrecting a challan that is
  // already in the database. The form then offers it back on the next visit and
  // every save attempt is rejected as a duplicate invoice number. Listing it in
  // the deps also runs the cleanup, cancelling that in-flight timer.
  useEffect(() => {
    if (!draftEnabled || !draftReady.current || savedId) return;
    const t = setTimeout(() => {
      if (customer && rows.length) {
        saveChallanDraft({ customer, invDate, prefix, manualCode, status, freight, packing, pouch, billingRate, gstPct, noBill, noBillRemoveGst, manualTax, manualB, manualC, shippingAddress, remarks, rows });
      } else {
        clearChallanDraft();
      }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftEnabled, savedId, customer, invDate, prefix, manualCode, status, freight, packing, pouch, billingRate, gstPct, noBill, noBillRemoveGst, manualTax, manualB, manualC, shippingAddress, remarks, rows]);

  // Throw away the restored draft and start blank.
  const discardDraft = () => {
    clearChallanDraft();
    setRestoredDraft(false);
    restoreRef.current = null;
    resetForm();
  };

  const pool = draft?.items ?? [];
  const available = useMemo(() => pool.filter((p) => !rows.some((r) => r.dispatchId != null && r.dispatchId === p.dispatchId)), [pool, rows]);
  const optionMap = useMemo(() => new Map(available.map((it) => [itemLabel(it), it])), [available]);
  const options = useMemo(() => [...optionMap.keys()], [optionMap]);

  const addItem = () => {
    const it = optionMap.get(addSel);
    if (!it) return;
    const next = [...rows, { ...it, key: `${it.dispatchId ?? 'm'}-${rows.length}-${performance.now() | 0}` }];
    setRows(next);
    recalc(next);
    warnMissingRates([it]);
    setAddSel('');
    setAddKey((k) => k + 1); // remount the select so its field text resets to empty
  };
  // Bulk-add every remaining pending/dispatched item for this party in one go —
  // triggered by the mobile swipe gesture on the Bill To card (see touchStartRef below).
  const addAllPending = () => {
    if (!available.length) return;
    const next = [
      ...rows,
      ...available.map((it, i) => ({ ...it, key: `${it.dispatchId ?? 'm'}-${rows.length + i}-${performance.now() | 0}-${i}` })),
    ];
    setRows(next);
    recalc(next);
    toast.success(`Added ${available.length} pending item${available.length === 1 ? '' : 's'}`);
    warnMissingRates(available);
  };
  // Swipe-to-add-all: a horizontal swipe on the Bill To card loads every pending
  // dispatched item for the selected party straight into the list (mobile shortcut
  // for what the "Add" dropdown does one line at a time).
  const billToTouchRef = useRef<{ x: number; y: number } | null>(null);
  const onBillToTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    billToTouchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onBillToTouchEnd = (e: React.TouchEvent) => {
    const start = billToTouchRef.current;
    billToTouchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) addAllPending();
  };
  const addManual = () => {
    if (!draft) return;
    const qty = numOr(m.qty);
    const price = numOr(m.price);
    if (!m.product.trim() || qty <= 0) return toast.error('Enter a product name and quantity.');
    const unit = m.unit === 'PCS' ? 'PCS' : 'KGS';
    const row: Row = {
      key: `man-${rows.length}-${performance.now() | 0}`,
      dispatchId: null,
      orderItemId: null,
      orderId: null,
      orderCode: null,
      productName: m.product.trim(),
      design: m.design.trim() || 'NA',
      bags: 0,
      pcs: unit === 'PCS' ? qty : 0,
      kgs: unit === 'KGS' ? qty : 0,
      box: 0,
      unit,
      price,
      amount: round2(qty * price),
      pCategory: draft.isScrap ? 'SCRAP' : null,
      comment: null,
      gstRate: draft.isScrap ? (draft.scrapGstRate ?? 0) : n(draft.gst),
      freightRate: 0,
      packingRate: 0,
    };
    const next = [...rows, row];
    setRows(next);
    recalc(next);
    // Scrap parties keep billing the same scrap item line after line, so re-arm
    // the picker with the category's default instead of clearing it.
    setM({ product: draft.isScrap ? (draft.defaultManualProduct ?? '') : '', design: 'NA', unit: 'KGS', qty: '', price: '' });
  };
  const removeRow = (key: string) => {
    const next = rows.filter((r) => r.key !== key);
    setRows(next);
    recalc(next);
  };

  const unlock = async (field: 'freight' | 'packing' | 'pouch') => {
    if (!locked[field]) return;
    const ok = await confirm({ title: `Unlock ${field}?`, description: `Edit ${field} manually? It is auto-calculated from the grid otherwise.`, confirmText: 'Unlock' });
    if (ok) setLocked((l) => ({ ...l, [field]: false }));
  };

  const onNoBill = async (checked: boolean) => {
    if (!checked) {
      setNoBill(false);
      setNoBillRemoveGst(false);
      return;
    }
    const keepGst = await confirm({
      title: 'No Bill',
      description: 'Keep GST in the total, or bill without tax? Choose "Remove GST" to drop the tax.',
      confirmText: 'Keep GST',
      cancelText: 'Remove GST',
    });
    setNoBill(true);
    setNoBillRemoveGst(!keepGst);
  };

  const dueDate = useMemo(() => {
    const term = isEdit ? savedChallan?.paymentTerm ?? draft?.paymentTerm : draft?.paymentTerm;
    if (term == null) return null;
    const dt = new Date(invDate);
    dt.setDate(dt.getDate() + term);
    return dt;
  }, [invDate, draft, savedChallan, isEdit]);

  // Lines whose category has no rate configured. Persistent row state — the
  // old toast named a CATEGORY and vanished, leaving the operator to work out
  // which row it meant.
  const unpricedRows = useMemo(
    () => rows.map((r, idx) => ({ key: r.key, idx, pCategory: r.pCategory, missing: missingRatesFor(r) })).filter((x) => x.missing.length > 0),
    [rows],
  );
  const unpricedByKey = useMemo(() => new Map(unpricedRows.map((u) => [u.key, u.missing])), [unpricedRows]);

  const totals = useMemo(
    () =>
      computeChallanTotals({
        items: rows,
        freight: numOr(freight),
        packing: numOr(packing),
        pouch: numOr(pouch),
        gstRatePct: numOr(gstPct),
        billingRate: numOr(billingRate),
        noBill,
        noBillRemoveGst,
        isScrap: draft?.isScrap ?? false,
        tcsPercent: draft?.tcsPercent ?? 1,
        tdsApplicable: draft?.tdsApplicable ?? false,
        tdsPercent: draft?.tdsPercent ?? 0,
        taxOverride: manualTax.trim() === '' ? null : numOr(manualTax),
        bOverride: manualB.trim() === '' ? null : numOr(manualB),
        cOverride: manualC.trim() === '' ? null : numOr(manualC),
      }),
    [rows, freight, packing, pouch, gstPct, billingRate, noBill, noBillRemoveGst, draft, manualTax, manualB, manualC],
  );

  const resetForm = () => {
    initedRef.current = '';
    clearChallanDraft();
    setRestoredDraft(false);
    setCustomer('');
    setRows([]);
    setAddSel('');
    setSavedId(null);
    setSavedCode('');
    setNoBill(false);
    setNoBillRemoveGst(false);
    setManualCode('');
    setManualTax('');
    setManualB('');
    setManualC('');
    setShippingAddress('');
    setRemarks('');
    setStatus('CONFIRMED');
  };

  // Leave the form. Always drop the saved WIP draft first so it never resurfaces
  // as a "Restored your unsaved challan" prompt next time.
  const handleCancel = () => {
    clearChallanDraft();
    setRestoredDraft(false);
    restoreRef.current = null;
    navigate(backTo);
  };

  // Reset button: clear back to blank (new) or reload the saved challan (edit),
  // after a confirm when there's anything to lose.
  const handleReset = async () => {
    const hasContent = customer.trim() || rows.length > 0;
    if (hasContent) {
      const ok = await confirm({
        title: isEdit ? 'Revert changes to this challan?' : 'Reset this challan?',
        description: isEdit
          ? 'Every line and field goes back to the last saved challan.'
          : 'Clears the customer and all items so you can start fresh.',
        confirmText: isEdit ? 'Revert' : 'Reset',
        destructive: true,
      });
      if (!ok) return;
    }
    if (isEdit) {
      setManualCode('');
      initedRef.current = ''; // re-run the load effect against the saved challan
    } else {
      resetForm();
    }
  };

  /**
   * @param thenPrint after a successful save, go straight to the bill view and
   *   open the print dialog there (Ctrl+P). The bill page owns printing, so this
   *   hands off rather than duplicating the capture logic.
   */
  const save = async ({ thenPrint = false }: { thenPrint?: boolean } = {}) => {
    if (!draft || rows.length === 0) return toast.error('Add at least one item.');
    // An unpriced line silently inherits the highest GST rate on the challan
    // (the server takes Math.max across lines), so a wrong rate is invisible in
    // the totals. Block rather than let that ship.
    if (unpricedRows.length > 0) {
      const ok = await confirmUnpriced();
      if (!ok) return;
    }
    if (status === 'CANCELLED') {
      const ok = await confirm({
        title: 'Save as CANCELLED?',
        description: isEdit ? 'This challan will be marked CANCELLED.' : 'You are saving a NEW challan as CANCELLED.',
        confirmText: 'Save cancelled',
      });
      if (!ok) return;
    }
    const cust = isEdit ? savedChallan?.customerName ?? draft.customerName : draft.customerName;
    // Omit to let the server keep auto-numbering (new) / leave the number
    // unchanged (edit); a typed override is sent as-is (uppercased).
    const codeOverride = manualCode.trim() ? manualCode.trim().toUpperCase() : undefined;
    const payload: CreateChallanInput = {
      code: codeOverride,
      prefix: prefix || draft.prefix,
      invDate: new Date(invDate).toISOString(),
      customerId: draft.customerId,
      customerName: cust,
      billingAddress: isEdit ? savedChallan?.billingAddress ?? draft.billingAddress : draft.billingAddress,
      shippingAddress: shippingAddress.trim() || null,
      category: isEdit ? savedChallan?.category ?? draft.category : draft.category,
      paymentTerm: isEdit ? savedChallan?.paymentTerm ?? draft.paymentTerm : draft.paymentTerm,
      dueDate: dueDate ? dueDate.toISOString() : null,
      transName: isEdit ? savedChallan?.transName ?? draft.transName : draft.transName,
      packing: numOr(packing),
      freight: numOr(freight),
      pouch: numOr(pouch),
      tcs: totals.tcs,
      tds: totals.tdsAmount,
      tdsPercent: draft.tdsPercent,
      tax: totals.tax,
      total: totals.total,
      b: totals.b,
      c: totals.c,
      remarks: remarks.trim() || null,
      gst: totals.gstRatePct,
      billingRate: numOr(billingRate),
      noBill,
      challanStatus: status as CreateChallanInput['challanStatus'],
      items: rows.map((r) => ({
        dispatchId: r.dispatchId,
        productName: r.productName,
        design: r.design,
        bags: r.bags,
        pcs: r.pcs,
        kgs: r.kgs,
        box: r.box,
        unit: r.unit,
        price: r.price,
        amount: r.amount,
        pCategory: r.pCategory,
        comment: r.comment,
      })),
    };
    const onSuccess = (c: { id: number; code: string }) => {
      clearChallanDraft(); // the WIP is now persisted server-side
      setRestoredDraft(false);
      setSavedId(c.id);
      setSavedCode(c.code);
      toast.success(`Challan ${c.code} ${isEdit ? 'updated' : 'saved'}`);
      if (thenPrint) {
        navigate(`/challans/${c.id}/bill`, { state: { backTo: 'challan-pending-or-list', autoPrint: true } });
      }
    };
    // Submits `body`; re-runnable so a confirmed near-duplicate can be resent
    // verbatim plus the flag, without recomputing totals (the operator must get
    // exactly what they reviewed).
    const submit = (body: CreateChallanInput) => {
      // An AxiosError IS an Error, so `e.message` here was only ever "Request
      // failed with status code 400" — the server's actual reason (a rejected
      // field, a duplicate invoice number) lives in the response body.
      const onError = (e: unknown) => {
        const dup = getDuplicateMatch(e);
        if (dup) return void askDuplicate(dup, body, submit);
        toast.error(getApiErrorMessage(e, 'Failed to save challan'));
      };
      if (isEdit) updateChallan.mutate({ id: editId!, ...body }, { onSuccess, onError });
      else createChallan.mutate(body, { onSuccess, onError });
    };
    submit(payload);
  };

  /** One entry per unpriced category, for the rate dialog. */
  const missingRateGroups = useMemo(() => {
    const by = new Map<string, Set<string>>();
    for (const u of unpricedRows) {
      const cat = u.pCategory || '';
      if (!cat) continue; // no category → nothing to key a rate row on
      const set = by.get(cat) ?? new Set<string>();
      u.missing.forEach((m) => set.add(m));
      by.set(cat, set);
    }
    return [...by.entries()].map(([pCategory, missing]) => ({ pCategory, missing: [...missing] }));
  }, [unpricedRows]);

  /**
   * Pull the freshly-configured rates back onto the existing lines.
   *
   * Only the three rate fields are touched, so quantity and price edits made
   * before the fix survive. Keyed by category because that is what the rate
   * masters are keyed by.
   */
  const applyFreshRates = async () => {
    // Split the branches: the two queries return different shapes, and a
    // union'd result loses `draft` on the create side.
    let fresh: ChallanDraft | undefined;
    if (isEdit) fresh = (await editQ.refetch()).data?.draft;
    else fresh = (await createDraftQ.refetch()).data;
    const byCat = new Map<string, { g: number | null; f: number | null; p: number | null }>();
    for (const it of fresh?.items ?? []) {
      const c = (it.pCategory ?? '').toUpperCase();
      if (!byCat.has(c)) byCat.set(c, { g: it.gstRate, f: it.freightRate, p: it.packingRate });
    }
    const next = rows.map((r) => {
      const m = byCat.get((r.pCategory ?? '').toUpperCase());
      if (!m) return r;
      return { ...r, gstRate: r.gstRate ?? m.g, freightRate: r.freightRate ?? m.f, packingRate: r.packingRate ?? m.p };
    });
    setRows(next);
    recalc(next);
  };

  /**
   * Saving is blocked while any line is unpriced.
   *
   * Returns true only when the operator may proceed anyway — which is the
   * permission fallback below. Otherwise it opens the rate dialog and returns
   * false; once the rates are in, the lines re-price and Save works normally.
   */
  const confirmUnpriced = async (): Promise<boolean> => {
    const lines = (
      <ul className="list-disc space-y-0.5 pl-4 text-sm">
        {unpricedRows.map((u) => (
          <li key={u.key}>
            Line {u.idx + 1}
            {u.pCategory ? ` · ${u.pCategory}` : ''} — no {u.missing.join(' · ')} rate
          </li>
        ))}
      </ul>
    );

    // Two cases must never hard-block:
    //  - Editing an already-billed challan. Those lines went out under the
    //    rates of the day (the server even falls back to the challan's own GST),
    //    so refusing the save would strand a correction to something else.
    //  - An operator without rights on the rate masters, who would be trapped:
    //    unable to save, unable to fix.
    if (isEdit || !canFixRates) {
      return confirm({
        title: 'Some lines have no rate configured',
        description: (
          <div className="space-y-2">
            {lines}
            <p className="text-muted-foreground text-xs">
              {canFixRates
                ? 'Add them under Customer GST Rates / Transport Rates.'
                : 'Ask an admin to add these under Customer GST Rates / Transport Rates.'}{' '}
              Saving now bills them at the highest GST rate on this challan.
            </p>
          </div>
        ),
        confirmText: 'Save anyway',
      });
    }

    const ok = await confirm({
      title: 'Set the missing rates before saving',
      description: (
        <div className="space-y-2">
          {lines}
          <p className="text-muted-foreground text-xs">
            An unpriced line takes the highest GST rate on this challan, so a wrong rate would not show in the
            totals.
          </p>
        </div>
      ),
      confirmText: 'Set rates now',
      cancelText: 'Back to challan',
      autoFocusConfirm: true,
    });
    if (ok) setRateFixOpen(true);
    return false;
  };

  /**
   * A near-duplicate came back from the server (409). The matched challan is
   * usually a save that already succeeded and whose response was lost, so
   * "Open existing challan" leads — offering only "save anyway" would push the
   * operator into creating the very duplicate this is meant to prevent.
   */
  const askDuplicate = async (
    dup: DuplicateMatch,
    body: CreateChallanInput,
    submit: (b: CreateChallanInput) => void,
  ) => {
    const ok = await confirm({
      title: 'A matching challan already exists',
      description: (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-semibold">{dup.code}</span> · {dup.customerName} · same items · total {inr(dup.total)}
          </p>
          <p className="text-muted-foreground text-xs">
            This is usually a save that already went through. Open it and check before saving another.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/challans/${dup.id}/bill`, { state: { backTo: 'challan-pending-or-list' } })}
          >
            Open existing challan
          </Button>
        </div>
      ),
      confirmText: 'Save anyway',
      cancelText: 'Cancel',
    });
    // Cancel keeps the form and its WIP draft intact so editing can continue.
    if (ok) submit({ ...body, confirmDuplicate: true });
  };

  // Ctrl/Cmd+S saves the challan; Ctrl/Cmd+P saves and then prints it; Esc
  // cancels (bound once; always call the latest closures via refs).
  const saveRef = useRef(save);
  saveRef.current = save;
  const cancelRef = useRef(handleCancel);
  cancelRef.current = handleCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        // Take over the browser's own print — printing this form would put the
        // editor on paper, not the challan.
        e.preventDefault();
        void saveRef.current({ thenPrint: true });
      } else if (e.key === 'Escape') {
        // Let an open dropdown / dialog swallow Esc first; only cancel when none is open.
        if (!document.querySelector('[data-slot="popover-content"], [role="dialog"], [role="alertdialog"]')) {
          cancelRef.current();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Success ──
  if (savedId) {
    return (
      <div className="space-y-4">
        <div className="bg-card mx-auto max-w-lg rounded-md border p-8 text-center shadow-sm">
          <div className="bg-emerald-100 mx-auto flex size-12 items-center justify-center rounded-full text-emerald-700">
            <Check className="size-6" />
          </div>
          <h2 className="mt-3 text-xl font-semibold">Challan {savedCode} {isEdit ? 'updated' : 'saved'}</h2>
          <p className="text-muted-foreground mt-1 text-sm">Total {inr(totals.total)}{totals.tdsAmount ? ` · Net after TDS ${inr(totals.netReceivable)}` : ''}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => navigate(`/challans/${savedId}/bill`, { state: { backTo: 'challan-pending-or-list' } })}>
              <Printer /> Print / PDF
            </Button>
            <Button variant="outline" onClick={() => navigate('/challans')}>
              View Challans
            </Button>
            {!isEdit && (
              <Button variant="outline" onClick={resetForm}>
                New Challan
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    // The whole form flows and the page scrolls naturally (same as New Order), so
    // the item list grows to show ALL rows instead of scrolling inside a fixed
    // viewport-height box. (The old desktop layout pinned the header/totals and
    // capped the item list to the leftover height, hiding rows behind a scrollbar.)
    <div className="flex w-full flex-col gap-2 sm:gap-3">
      {/* Header — pick / show the customer here; Save / Cancel / Reset sit at the
          bottom of the form (sticky). */}
      {/* Phones: the customer picker wraps to its own full-width row (order-last). */}
      <div className="bg-background/85 z-20 -mt-1 flex shrink-0 flex-wrap items-center gap-1.5 rounded-md py-1 backdrop-blur sm:gap-2">
        <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate(backTo)} title="Back">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="bg-gradient-brand flex size-8 items-center justify-center rounded-md text-white shadow-sm ring-1 ring-white/20">
          <ScrollText className="size-4" />
        </div>
        <span className="text-muted-foreground shrink-0 text-sm font-semibold whitespace-nowrap">
          {isEdit ? 'Edit Challan' : 'Create Challan'} <span className="text-muted-foreground/60 hidden sm:inline">—</span>
        </span>
        {isEdit ? (
          <span className="min-w-0 flex-1 truncate text-base font-bold tracking-tight">{savedChallan?.customerName ?? ''}</span>
        ) : (
          <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:max-w-md sm:flex-1">
            <NativeSelect
              value={customer}
              onChange={setCustomer}
              options={customers}
              placeholder={custLoading ? 'Loading…' : 'Select a customer…'}
              className="bg-background h-9 w-full rounded-md text-base font-semibold"
            />
          </div>
        )}
        {isEdit && editId && <RecordHistory resource={RESOURCES.CHALLAN} resourceId={editId} label={savedChallan?.code} className="ml-auto shrink-0" />}
      </div>

      {/* Restored work-in-progress notice */}
      {restoredDraft && (
        <div className="flex shrink-0 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <History className="size-4 shrink-0" /> Restored your unsaved challan from last time — keep editing or discard it.
          <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-amber-800 hover:bg-amber-100 hover:text-amber-900" onClick={discardDraft}>
            Discard
          </Button>
        </div>
      )}

      {/* Invoice paper — grows with its content (header, full item list, charges,
          totals) so nothing is capped; the page scrolls if it runs long. */}
      <div className="bg-card flex flex-col overflow-hidden rounded-md border shadow-sm">
        {/* Header: Bill-to party block + a bordered document-info panel. */}
        <div className="from-primary/[0.06] dark:from-primary/[0.12] shrink-0 border-b bg-gradient-to-br via-transparent to-sky-50/40 px-3 py-2.5 sm:px-4 dark:to-sky-500/[0.05]">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-stretch lg:gap-4">
            {/* Bill To — the party, anchored by a brand accent bar on its left. */}
            <div
              className="bg-background/50 min-w-0 flex-1 touch-pan-y space-y-1 rounded-md border border-l-[3px] border-border/50 border-l-primary/50 px-3 py-2 dark:bg-white/[0.03]"
              onTouchStart={onBillToTouchStart}
              onTouchEnd={onBillToTouchEnd}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-primary/70 flex items-center gap-1 text-[10px] font-bold tracking-widest uppercase">
                  <UserSearch className="size-3.5" /> Bill To
                </span>
                {draft?.category && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">{draft.category}</span>}
                {draft?.tdsApplicable && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">TDS {draft.tdsPercent ?? 0}%</span>}
                {draft?.isScrap && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">SCRAP · {draft.tcsPercent}% TCS</span>}
              </div>
              {/* Customer is chosen in the top header now — shown here read-only so
                  the invoice still reads its bill-to. */}
              {draft && <div className="text-base leading-tight font-bold tracking-tight text-slate-900 sm:text-lg dark:text-slate-100">{isEdit ? savedChallan?.customerName : draft.customerName}</div>}
              {draft && <p className="text-muted-foreground truncate text-[12px]">{(isEdit ? savedChallan?.billingAddress : draft.billingAddress) || '—'}</p>}
              {draft && available.length > 0 && (
                <div className="text-primary bg-primary/10 mt-1 inline-flex animate-pulse items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium lg:hidden">
                  <ArrowLeftRight className="size-3" /> Swipe here to add all {available.length} pending item{available.length === 1 ? '' : 's'}
                </div>
              )}

              {/* Settlement — B/C Amount (pencil to override) + No Bill, on the party card. */}
              {draft && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/50 pt-1.5">
                  <EditableAmount label="B Amount" computed={totals.b} manual={manualB} onManual={setManualB} />
                  <EditableAmount label="C Amount" computed={totals.c} manual={manualC} onManual={setManualC} />
                  <label
                    className={cn(
                      'ml-auto flex cursor-pointer items-center gap-1.5 rounded-[4px] px-2 py-1 text-[13px] font-semibold transition-colors select-none',
                      noBill ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/60',
                    )}
                    title="Bill without a tax invoice"
                  >
                    <input type="checkbox" checked={noBill} onChange={(e) => onNoBill(e.target.checked)} className="size-3.5 accent-blue-600" />
                    No Bill
                    {noBill && <span className="text-[11px] font-medium text-amber-600 dark:text-amber-300">{noBillRemoveGst ? '(GST removed)' : '(GST kept)'}</span>}
                  </label>
                </div>
              )}
            </div>

            {/* Keep the 2x2 document panel left of its related series action. */}
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-start">
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border/70 sm:w-[26rem] dark:bg-white/10">
                <MetaCell label="Invoice No" icon={Hash}>
                  <div className="flex items-center gap-1.5">
                    {!isEdit && (draft?.prefixes.length ?? 0) > 1 && (
                      <select
                        value={prefix}
                        onChange={(e) => setPrefix(e.target.value)}
                        className="border-input bg-background h-8 rounded-[4px] border px-1.5 text-[13px] font-semibold"
                        title="Challan prefix"
                      >
                        {draft?.prefixes.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    )}
                    <Input
                      value={effectiveCode === '—' ? '' : effectiveCode}
                      onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                      placeholder={previewCode}
                      title="Editable — clear to go back to the auto-assigned number"
                      className="bg-background h-8 w-full rounded-[4px] text-[13px] font-bold"
                    />
                  </div>
                </MetaCell>
                <MetaCell label="Invoice Date" icon={CalendarDays}>
                  <DatePicker value={invDate} onChange={setInvDate} clearable={false} className="bg-background h-8 w-full rounded-[4px] text-[13px]" />
                </MetaCell>
                {/* Second row mirrors the first: Status under Invoice No, Due Date
                    under Invoice Date — each date sits below the other date. */}
                <MetaCell label="Status">
                  {isEdit ? (
                    <NativeSelect value={status} onChange={setStatus} options={[...CHALLAN_STATUSES]} className="bg-background h-8 w-full rounded-[4px] text-[13px]" />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-[4px] bg-emerald-100 px-2 py-1 text-[13px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      <span className="size-1.5 rounded-full bg-emerald-500" /> CONFIRMED
                    </span>
                  )}
                </MetaCell>
                <MetaCell label="Due Date" icon={CalendarCheck2}>
                  <Input
                    readOnly
                    value={dueDate ? formatDate(dueDate) : ''}
                    placeholder="—"
                    className="bg-muted/40 h-8 w-full cursor-default rounded-[4px] text-[13px] tabular-nums"
                  />
                </MetaCell>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 self-start"
                onClick={() => setMissingChallanOpen(true)}
                title="Find skipped invoice numbers in a prefix's series"
              >
                <ListX /> <span className="hidden sm:inline">Missing Challan</span><span className="sm:hidden">Missing</span>
              </Button>
            </div>
          </div>
        </div>

        {!isEdit && !customer && (
          <div className="text-muted-foreground border-t p-6 text-center text-sm sm:p-8">Choose a customer to begin.</div>
        )}
        {isLoading && (
          <div className="text-muted-foreground flex items-center justify-center gap-2 border-t p-6 text-sm"><Loader2 className="size-4 animate-spin" /> Loading…</div>
        )}
        {isError && <p className="text-destructive border-t p-4 text-sm">Could not load the challan.</p>}

        {draft && (
          <>
            {/* Add-line toolbar */}
            <div className="bg-muted/30 shrink-0 space-y-2 border-y px-3 py-2 sm:px-4 sm:py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {/* Phones: the picker takes its own row; Add / Manual split the next one. */}
                <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                  <NativeSelect
                    key={addKey}
                    value={addSel}
                    onChange={setAddSel}
                    options={options}
                    placeholder={options.length ? '+ Add a dispatched product…' : 'No more dispatched items'}
                    className="h-9"
                    listHeader={
                      <>
                        <span className="min-w-0 flex-1">Product</span>
                        <span className="w-24">Design</span>
                        <span className="w-20 text-right">Qty</span>
                        <span className="w-16 text-right">Price</span>
                      </>
                    }
                    renderOption={(val) => {
                      const it = optionMap.get(val);
                      if (!it) return <span className="truncate">{val}</span>;
                      return (
                        <>
                          <span className="min-w-0 flex-1 truncate font-medium">{it.productName || '(item)'}</span>
                          <span className="text-muted-foreground w-24 truncate">{it.design || 'NA'}</span>
                          <span className="w-20 text-right tabular-nums">{isKgs(it.unit) ? `${qty(n(it.kgs))} kg` : `${qty(n(it.pcs))} pc`}</span>
                          <span className="w-16 text-right tabular-nums">₹{n(it.price)}</span>
                        </>
                      );
                    }}
                  />
                </div>
                <Button onClick={addItem} disabled={!addSel} className="h-9 flex-1 rounded-[4px] sm:flex-none"><Plus /> Add</Button>
                <Button variant="outline" onClick={() => setShowManual((v) => !v)} className="h-9 flex-1 rounded-[4px] sm:flex-none">{showManual ? 'Hide manual' : 'Manual'}</Button>
              </div>
              {showManual && (
                <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-6">
                  {/* Product picker over the ACTIVE catalogue (draft.manualProducts).
                      A SCRAP party gets its SCRAP-category items first and the first
                      one pre-selected — so adding "S.S. SCRAP" to Products under the
                      SCRAP category is all that's needed. Creatable, so a one-off
                      item that isn't in the catalogue can still be typed in. */}
                  <div className="col-span-2 space-y-1">
                    <Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Product</Label>
                    <Combo
                      value={m.product}
                      onChange={(v) => setM({ ...m, product: v })}
                      options={draft.manualProducts}
                      placeholder={draft.manualProducts.length ? 'Pick an item or type one…' : 'e.g. S.S. SCRAP'}
                      className="h-8 rounded-[4px] text-[13px]"
                    />
                  </div>
                  <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Design</Label><Input value={m.design} onChange={(e) => setM({ ...m, design: e.target.value })} disabled={draft.isScrap} title={draft.isScrap ? 'Scrap items carry no design' : undefined} className={cn('h-8 rounded-[4px] text-[13px]', draft.isScrap && 'bg-muted/40 cursor-not-allowed')} /></div>
                  <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Unit</Label><NativeSelect value={m.unit} onChange={(v) => setM({ ...m, unit: v })} options={['KGS', 'PCS']} className="h-8 rounded-[4px] text-[13px]" /></div>
                  <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Qty</Label><Input value={m.qty} onChange={(e) => setM({ ...m, qty: e.target.value })} className="h-8 rounded-[4px] text-right text-[13px] tabular-nums" /></div>
                  <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Price</Label><Input value={m.price} onChange={(e) => setM({ ...m, price: e.target.value })} className="h-8 rounded-[4px] text-right text-[13px] tabular-nums" /></div>
                  <div className="col-span-2 sm:col-span-6"><Button size="sm" variant="secondary" onClick={addManual} className="w-full rounded-[4px] sm:w-auto"><Plus /> Add manual line</Button></div>
                </div>
              )}
            </div>

            {/* Line items — grows to show every row (no internal scroll cap); the
                page scrolls when the list is long. Desktop/tablet only; phones get
                the card list below instead. */}
            <div className="hidden sm:block">
              {/* ERP line grid — matches the Challans/Pending tables: blue header,
                  grey rules both ways, banded rows, compact 13px cells. */}
              <table className="w-full text-[13px] [&_td]:border-r [&_td]:border-slate-200 dark:[&_td]:border-white/10 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-white/20 [&_th:last-child]:border-r-0">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gradient-to-b from-blue-800 to-indigo-800 text-left text-white [&>th]:px-3 [&>th]:py-2 [&>th]:text-[11.5px] [&>th]:font-extrabold [&>th]:tracking-wide [&>th]:uppercase">
                    <th className="w-10 text-center">#</th>
                    <th>Product</th>
                    <th className="w-24">Design</th>
                    {qtyOrder.map((f) => (
                      <th key={f} className="w-16 text-right">{QTY_COL_LABEL[f]}</th>
                    ))}
                    <th className="w-14">Unit</th>
                    <th className="w-24 text-right">Price</th>
                    <th className="w-24 text-right">Amount</th>
                    <th className="w-14 text-right">GST%</th>
                    <th className="w-9"></th>
                  </tr>
                </thead>
                <tbody className="text-[14.5px]">
                  {rows.map((r, idx) => (
                    <tr
                      key={r.key}
                      className={cn(
                        'border-b border-slate-200 transition-colors odd:bg-slate-100/70 hover:bg-amber-100/70 dark:border-white/10 dark:odd:bg-white/[0.04] dark:hover:bg-amber-400/10 [&>td]:px-3 [&>td]:py-1',
                        // `odd:` outranks a plain class, so the tint has to win in
                        // both variants or banded rows would swallow it.
                        unpricedByKey.has(r.key) && 'bg-amber-50 odd:bg-amber-50 dark:bg-amber-400/10 dark:odd:bg-amber-400/10',
                      )}
                    >
                      <td className="w-10 text-center text-slate-500 tabular-nums dark:text-slate-400">{idx + 1}</td>
                      <td className="font-semibold text-slate-800 dark:text-slate-200">
                        {r.productName || '—'}
                        {r.dispatchId == null && <span className="bg-muted text-muted-foreground ml-1 rounded px-1 text-[10px]">manual</span>}
                        <MissingRateBadge missing={unpricedByKey.get(r.key) ?? []} pCategory={r.pCategory} className="ml-1.5" />
                        {r.orderItemId != null && <ItemPhotosButton orderItemId={r.orderItemId} />}
                      </td>
                      <td className="w-24 font-medium text-slate-600 dark:text-slate-300">{r.design || '—'}</td>
                      {qtyOrder.map((f) => (
                        <td key={f} className="w-16 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-200">{qty(qtyCell(r, f)) ?? '—'}</td>
                      ))}
                      <td className="w-14 font-bold text-[11px] uppercase tracking-wider text-slate-500">{r.unit || '—'}</td>
                      <td className="w-24 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-200">₹{(r.price ?? 0).toLocaleString('en-IN')}</td>
                      <td className="w-24 text-right font-bold tabular-nums text-slate-900 dark:text-slate-100">{(r.amount ?? 0).toLocaleString('en-IN')}</td>
                      {/* An unconfigured rate must not read as a real 0% — that
                          ambiguity is what hid this problem in the first place. */}
                      <td className="w-14 text-right font-medium tabular-nums text-slate-500 dark:text-slate-400">
                        {r.gstRate == null ? <span className="font-bold text-amber-700 dark:text-amber-300" title="Not configured">—</span> : r.gstRate}
                      </td>
                      <td className="w-9 text-right"><button onClick={() => removeRow(r.key)} className="text-slate-400 transition-colors hover:text-destructive" title="Remove line"><Trash2 className="size-4" /></button></td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-3 py-10 text-center">
                        <div className="text-muted-foreground flex flex-col items-center gap-1.5 text-sm">
                           <Plus className="size-5 opacity-40" />
                           No items yet — pick a dispatched product above, or add a manual line.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot className="bg-slate-200/80 dark:bg-white/[0.06]">
                    <tr className="border-t-2 border-slate-300 font-bold dark:border-white/15 [&>td]:px-3 [&>td]:py-1.5">
                      <td className="w-10"></td>
                      <td className="text-[11px] font-bold tracking-widest text-slate-500 uppercase dark:text-slate-400">Total · {rows.length} item(s)</td>
                      <td className="w-24"></td>
                      {qtyOrder.map((f) => (
                        <td key={f} className="w-16 text-right tabular-nums text-slate-800 dark:text-slate-100">{qtyTotal(totals, f) ? qty(qtyTotal(totals, f)) : ''}</td>
                      ))}
                      <td className="w-14"></td>
                      <td className="w-24"></td>
                      <td className="w-24 text-right tabular-nums text-primary">{totals.tAmt.toLocaleString('en-IN')}</td>
                      <td className="w-14"></td>
                      <td className="w-9"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Phones: one card per line item (mirrors Order Modify's mobile list). */}
            <div className="sm:hidden">
              {rows.length === 0 ? (
                <div className="text-muted-foreground flex flex-col items-center gap-2 px-3 py-10 text-center text-sm">
                  <div className="bg-muted flex size-10 items-center justify-center rounded-full">
                    <Plus className="size-5 opacity-50" />
                  </div>
                  No items yet — pick a dispatched product above, or add a manual line.
                </div>
              ) : (
                <>
                  <div className="divide-y divide-slate-200 dark:divide-white/10">
                    {rows.map((r, idx) => (
                      <div
                        key={r.key}
                        className={cn(
                          'px-2.5 py-1.5 odd:bg-slate-100/70 dark:odd:bg-white/[0.04]',
                          unpricedByKey.has(r.key) && 'bg-amber-50 odd:bg-amber-50 dark:bg-amber-400/10 dark:odd:bg-amber-400/10',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-bold text-slate-800 dark:text-slate-200">
                              <span className="text-slate-400 mr-1 tabular-nums">{idx + 1}.</span>
                              {r.productName || '—'}
                              {r.dispatchId == null && <span className="bg-muted text-muted-foreground ml-1.5 rounded px-1 text-[10px]">manual</span>}
                              {r.orderItemId != null && <ItemPhotosButton orderItemId={r.orderItemId} />}
                            </p>
                            <p className="text-muted-foreground truncate text-[11px] font-medium">
                              {r.design || '—'} · {r.unit || '—'} · ₹{(r.price ?? 0).toLocaleString('en-IN')}
                              {r.gstRate ? ` · GST ${r.gstRate}%` : ''}
                            </p>
                            <MissingRateBadge missing={unpricedByKey.get(r.key) ?? []} pCategory={r.pCategory} className="mt-1" showCategory />
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">₹{(r.amount ?? 0).toLocaleString('en-IN')}</span>
                            <button onClick={() => removeRow(r.key)} className="text-slate-400 hover:text-destructive p-0.5" title="Remove line">
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </div>
                        <div className="mt-1 grid grid-cols-4 gap-1.5 text-[11px]">
                          {qtyOrder.map((f) => (
                            <div key={f}>
                              <p className="text-muted-foreground text-[9px] font-bold uppercase tracking-widest">{QTY_COL_LABEL[f]}</p>
                              <p className="font-bold tabular-nums text-slate-700 dark:text-slate-200">{qty(qtyCell(r, f)) ?? '—'}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Totals — the phone equivalent of the desktop tfoot. The four
                      quantity columns sit in the same 4-col grid each card above
                      uses, so the numbers line up down the list. */}
                  <div className="bg-muted/60 border-t-2">
                    <div className="grid grid-cols-4 gap-2 px-2.5 pt-2 pb-1.5 text-xs">
                      {qtyOrder.map((f) => (
                        <div key={f}>
                          <p className="text-muted-foreground tracking-wide uppercase">{QTY_COL_LABEL[f]}</p>
                          <p className="text-sm font-bold tabular-nums">{qtyTotal(totals, f) ? qty(qtyTotal(totals, f)) : '—'}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between border-t px-2.5 py-1.5 text-sm font-semibold">
                      <span className="text-muted-foreground tracking-wide uppercase">Total · {rows.length} item(s)</span>
                      <span className="text-primary tabular-nums">{totals.tAmt.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer: charges + totals. Phones: totals surface first (order-1) since
                that's what matters most; charges/shipping sit behind a "More details"
                toggle (order-2) so you don't have to scroll past a wall of inputs. */}
            <div className="grid shrink-0 gap-3 border-t p-3 sm:gap-4 sm:p-4 lg:grid-cols-[1fr_320px]">
              <div className="order-2 space-y-2.5 lg:order-1">
                <button
                  type="button"
                  onClick={() => setShowDetails((v) => !v)}
                  className="text-muted-foreground hover:bg-muted/60 flex w-full items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-semibold sm:hidden"
                >
                  <SlidersHorizontal className="size-3.5" /> Charges &amp; shipping details
                  <ChevronDown className={cn('ml-auto size-4 transition-transform', showDetails && 'rotate-180')} />
                </button>
                <div className={cn(showDetails ? 'block' : 'hidden', 'sm:block space-y-2.5')}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[minmax(12rem,1.5fr)_repeat(4,minmax(6.5rem,1fr))]">
                    <div className="space-y-1 xl:col-span-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Transporter</Label><Input value={(isEdit ? savedChallan?.transName : draft.transName) || '—'} readOnly className="h-8 rounded-[4px] border-amber-500 bg-amber-50 text-[13px] dark:border-amber-400/70 dark:bg-amber-400/10" /></div>
                    <LockField label="Freight" value={freight} locked={locked.freight} onUnlock={() => unlock('freight')} onChange={setFreight} onBlur={() => setLocked((l) => ({ ...l, freight: true }))} />
                    <LockField label="Packing" value={packing} locked={locked.packing} onUnlock={() => unlock('packing')} onChange={setPacking} onBlur={() => setLocked((l) => ({ ...l, packing: true }))} />
                    <LockField label="Box / Pouch" value={pouch} locked={locked.pouch} onUnlock={() => unlock('pouch')} onChange={setPouch} onBlur={() => setLocked((l) => ({ ...l, pouch: true }))} />
                    {/* GST % field removed — GST is not editable; it follows the customer's configured
                        rate (applied automatically) and is shown in the totals panel below. */}
                    <div className="space-y-1"><Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Billing Rate</Label><Input value={billingRate} onChange={(e) => setBillingRate(e.target.value)} className="h-8 rounded-[4px] border-amber-500 bg-amber-50 text-right text-[13px] tabular-nums dark:border-amber-400/70 dark:bg-amber-400/10" /></div>
                  </div>
                  {SHOW_SHIPPING_ADDRESS && (
                    <div className="space-y-1">
                      <Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Shipping Address</Label>
                      <textarea
                        className="border-input bg-background min-h-10 w-full rounded-[4px] border px-3 py-1.5 text-[13px]"
                        placeholder="Shipping address…"
                        value={shippingAddress}
                        onChange={(e) => setShippingAddress(e.target.value)}
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Remarks</Label>
                    <textarea
                      className="border-input bg-background min-h-10 w-full rounded-[4px] border px-3 py-1.5 text-[13px]"
                      placeholder="Remarks…"
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="order-1 self-start overflow-hidden rounded-[4px] border shadow-sm lg:order-2">
                <div className="bg-card space-y-0.5 p-2.5">
                  <Row2 label="Taxable" value={inr(totals.tAmt)} />
                  <Row2 label="Freight" value={inr(numOr(freight))} />
                  <Row2 label="Packing" value={inr(numOr(packing))} />
                  <Row2 label="Box / Pouch" value={inr(numOr(pouch))} />
                  <Row2 label={`GST${totals.gstRatePct ? ` @ ${totals.gstRatePct}%` : ''}`} value={inr(totals.tax)} />
                  {(draft.isScrap || totals.tcs > 0) && <Row2 label={`TCS @ ${draft.tcsPercent}%`} value={inr(totals.tcs)} />}
                </div>
                <div className="bg-gradient-brand flex items-center justify-between px-3 py-2 text-base font-bold text-white">
                  <span className="tracking-wide">TOTAL</span>
                  <span className="tabular-nums">{inr(totals.total)}</span>
                </div>
                {draft.tdsApplicable && (
                  <div className="bg-card space-y-1 p-2.5">
                    <Row2 label={`Less: TDS @ ${draft.tdsPercent ?? 0}%`} value={`- ${inr(totals.tdsAmount)}`} className="text-amber-700 dark:text-amber-300" />
                    <div className="flex items-center justify-between rounded-[4px] bg-emerald-50 px-2 py-1 text-[13px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      <span>Net Receivable</span>
                      <span className="tabular-nums">{inr(totals.netReceivable)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bottom action bar — flows at the end of the form (not pinned), same as the
          New Order form: it appears right after the content, so it's reached only
          once you've actually scrolled to the bottom instead of floating over the
          last item's row. */}
      <div className="bg-background/95 z-30 -mx-1 mt-0.5 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t px-2 py-2 backdrop-blur sm:mt-1 sm:gap-y-2 sm:py-3">
        <p className="text-sm">
          {rows.length} item(s)
          {draft && (
            <>
              {' '}· total <span className="font-bold tabular-nums text-emerald-600">{inr(totals.total)}</span>
            </>
          )}
        </p>
        {/* Phones: the three actions share one full-width row (Create grows widest). */}
        <div className="ml-auto flex w-full flex-wrap justify-end gap-2 sm:w-auto">
          <Button type="button" variant="destructive" onClick={handleCancel} title="Cancel (Esc)" className="flex-1 sm:flex-none">
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={handleReset} title={isEdit ? 'Revert unsaved changes' : 'Clear the form'} className="flex-1 sm:flex-none">
            <RotateCcw /> Reset
          </Button>
          {draft && (
            <Button
              onClick={() => void save()}
              disabled={saving || rows.length === 0}
              title={`${isEdit ? 'Update' : 'Create'} challan (Ctrl+S) — Ctrl+P saves and prints`}
              className="flex-[2] sm:flex-none"
            >
              {saving ? <Loader2 className="animate-spin" /> : <Check />} {isEdit ? 'Update Challan' : 'Create Challan'}
              <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold sm:inline">Ctrl+S</kbd>
            </Button>
          )}
        </div>
      </div>

      {missingChallanOpen && (
        <MissingChallanDialog
          prefixes={prefixSettings?.prefixes.length ? prefixSettings.prefixes : prefix ? [prefix] : []}
          defaultPrefix={prefix || draft?.prefix || prefixSettings?.default || ''}
          onClose={() => setMissingChallanOpen(false)}
        />
      )}

      <RateFixDialog
        open={rateFixOpen}
        onOpenChange={setRateFixOpen}
        customerName={draft?.customerName ?? customer}
        transportName={draft?.transName}
        groups={missingRateGroups}
        onSaved={applyFreshRates}
      />
    </div>
  );
}

function MetaCell({
  label,
  children,
  className,
  icon: Icon,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  // A single field inside the document-info panel. The panel provides the border
  // and the 1px dividers (via gap-px on a filled ground), so each cell just needs a
  // solid background and its own padding. Centred vertically so the 2×2 cells stay
  // balanced when the grid rows share a height.
  return (
    <div className={cn('bg-card flex min-w-0 flex-col justify-center gap-1 px-3 py-2.5', className)}>
      <div className="text-muted-foreground flex items-center gap-1 text-[10px] font-bold tracking-widest uppercase">
        {Icon && <Icon className="size-3 opacity-70" />} {label}
      </div>
      <div className="text-[13px] leading-tight font-semibold">{children}</div>
    </div>
  );
}

function LockField({ label, value, locked, onUnlock, onChange, onBlur }: { label: string; value: string; locked: boolean; onUnlock: () => void; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
        {label}
        {locked ? <Lock className="size-3 text-muted-foreground" /> : <LockOpen className="size-3 text-emerald-600" />}
      </Label>
      <Input
        value={value}
        readOnly={locked}
        title={locked ? 'Double-click to unlock' : ''}
        onDoubleClick={onUnlock}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={cn(
          'h-8 rounded-[4px] border-amber-500 bg-amber-50 text-right text-[13px] tabular-nums dark:border-amber-400/70 dark:bg-amber-400/10',
          locked && 'cursor-default',
        )}
      />
    </div>
  );
}

/** A header meta cell whose amount is directly editable (Form14 B/C Amount). Shows
 *  the live computed value by default; the pencil opens an inline input to override
 *  it, and a small revert arrow appears once overridden. */
function EditableAmount({
  label,
  computed,
  manual,
  onManual,
}: {
  label: string;
  computed: number;
  manual: string;
  onManual: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isManual = manual.trim() !== '';
  const display = isManual ? manual : String(Math.round(computed));

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  return (
    <div className="space-y-0.5">
      <div className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase">{label}</div>
      {editing ? (
        <input
          ref={inputRef}
          value={display}
          onChange={(e) => onManual(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === 'Enter' && setEditing(false)}
          className="border-input bg-background h-7 w-24 rounded-[4px] border px-2 text-right text-[13px] font-bold tabular-nums focus:ring-1"
        />
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="text-[15px] leading-tight font-bold tabular-nums">₹{Number(display || 0).toLocaleString('en-IN')}</span>
          <button type="button" onClick={() => setEditing(true)} title={`Edit ${label}`} className="text-muted-foreground hover:text-primary">
            <Pencil className="size-3.5" />
          </button>
          {isManual && (
            <button type="button" onClick={() => onManual('')} title="Reset to auto" className="text-amber-600 hover:text-amber-700">
              <RotateCcw className="size-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row2({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between text-[13px]', strong && 'text-base font-semibold', className)}>
      <span className={cn('text-muted-foreground', strong && 'text-foreground')}>{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export default ChallanFormPage;
