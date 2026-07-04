import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRightLeft, BadgePercent, Check, ChevronDown, ChevronUp, FilePen, FileText, History, Keyboard, Loader2, Lock, PackageOpen, Plus, ReceiptText, RotateCcw, Save, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ORDER_PRIORITIES, resolveSpecialRates, type OrderInput } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAutoSizePcs } from '@/lib/auto-size-pcs';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { NativeSelect } from '@/components/common/combo';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { settingValues, useSettings } from '@/features/settings/use-settings';
import { useCustomerSpecialRates } from '@/features/special-rates/use-special-rates';
import { useCreateOrder, useOrder, useOrderLookups, useUpdateOrder } from './use-orders';
import { useConvertQuotation, useCreateQuotation, useQuotation, useUpdateQuotation } from '../quotations/use-quotations';
import { clearOrderDraft, loadOrderDraft, saveOrderDraft } from './order-draft';
import { useActiveCustomerBookings } from '@/features/bookings/use-bookings';
import { BookingDrawSheet, type DrawnBookingLine } from './booking-draw-sheet';

/** A line item once added to the order. */
interface Item {
  key: string;
  id?: number | null; // DB id of an existing line (undefined for a newly-added row)
  status?: string | null; // per-line CONFIRMED/CANCELLED, preserved across edits
  bookingId?: number | null; // set when the line was drawn from a bag Booking (rate frozen)
  bookingCode?: string | null; // the source booking's code, for the badge
  special?: string | null; // human note when a customer special rate priced this line (shows the "special" tag)
  itemName: string; // composite display: "{size|pcs} {product} {designType}"
  product: string;
  category: string;
  subCategory: string;
  designType: string;
  designName: string; // human-readable name shown in the Design Name dropdown
  productRate: string;
  designRate: string;
  weight: string; // per-piece weight of the picked product (for Pcs→Kgs)
  pcsBox: string; // pieces per box of the picked product (for Pcs→Box)
  ordType: string;
  priority: string;
  bags: string;
  pcs: string;
  gram: string;
  box: string;
  comment: string;
  calField: string;
}

const blankEntry = (): Omit<Item, 'key'> => ({
  itemName: '',
  product: '',
  category: '',
  subCategory: '',
  designType: '',
  designName: '',
  productRate: '',
  designRate: '',
  weight: '',
  pcsBox: '',
  ordType: '',
  priority: 'NORMAL',
  bags: '',
  pcs: '',
  gram: '',
  box: '',
  comment: '',
  calField: 'KGS',
});

/** Number → compact string for the item label (drops trailing ".0"). */
const fmtNum = (v: number | null) => (v == null ? '' : String(v));

const n = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
const itemRate = (l: Pick<Item, 'productRate' | 'designRate'>) => (n(l.productRate) ?? 0) + (n(l.designRate) ?? 0);
const scopeWord = (s: string | null) =>
  s === 'ITEM' ? 'item' : s === 'SUBCATEGORY' ? 'sub-category' : s === 'CATEGORY' ? 'category' : '';
const fmtDelta = (n: number) => (n > 0 ? `+${n}` : `${n}`);
/** A design that carries a logo (standalone "LOGO" or a combo like "HAMMER+LOGO"). */
const isLogoDesign = (designType?: string | null) => (designType ?? '').toUpperCase().includes('LOGO');
/** Line amount = rate × quantity, where the quantity is Kgs or Pcs per the line's calc field. */
const lineAmount = (l: Pick<Item, 'productRate' | 'designRate' | 'gram' | 'pcs' | 'calField'>) => {
  const qty = l.calField === 'PCS' ? (n(l.pcs) ?? 0) : (n(l.gram) ?? 0);
  return itemRate(l) * qty;
};
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (dateStr: string, days: number) => {
  if (!dateStr || Number.isNaN(days)) return '';
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Render a 'YYYY-MM-DD' string the same way the DatePicker field shows it. */
const niceDate = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

// The form's focusable controls, in entry order — used by the Tab-access panel.
const TAB_FIELDS = [
  { key: 'customer', label: 'Customer' },
  { key: 'poNumber', label: 'PO Number' },
  { key: 'orderDate', label: 'Order date' },
  { key: 'completionDay', label: 'Completion days' },
  { key: 'showBy', label: 'Show item by' },
  { key: 'itemName', label: 'Item name' },
  { key: 'designName', label: 'Design Name' },
  { key: 'productRate', label: 'Product rate' },
  { key: 'designRate', label: 'Design rate' },
  { key: 'ordType', label: 'Order type' },
  { key: 'priority', label: 'Priority' },
  { key: 'bags', label: 'Bags' },
  { key: 'pcs', label: 'Pcs' },
  { key: 'gram', label: 'Kgs' },
  { key: 'box', label: 'Box' },
  { key: 'comment', label: 'Remarks' },
] as const;
const TAB_PREF_KEY = 'oms:order-tab-order';
// Saved "rows to show in the item panel" preference (0 = show all).
const ROWS_PREF_KEY = 'oms:order-rows-to-show';
const ROWS_OPTIONS = [5, 8, 10, 15, 20, 0];
const rowsLabel = (n: number) => (n === 0 ? 'All rows' : `${n} rows`);
const FIELD_LABEL: Record<string, string> = Object.fromEntries(TAB_FIELDS.map((f) => [f.key, f.label]));

interface TabEntry {
  key: string;
  enabled: boolean;
}
const defaultTabOrder = (): TabEntry[] => TAB_FIELDS.map((f) => ({ key: f.key, enabled: true }));

/** Load the saved order, reconciling it with the current field set. */
function loadTabOrder(): TabEntry[] {
  try {
    const raw = localStorage.getItem(TAB_PREF_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as TabEntry[];
      const known = new Set<string>(TAB_FIELDS.map((f) => f.key));
      const seen = new Set<string>();
      const merged = saved.filter((t) => t && known.has(t.key) && !seen.has(t.key) && seen.add(t.key));
      for (const f of TAB_FIELDS) if (!seen.has(f.key)) merged.push({ key: f.key, enabled: true });
      return merged.map((t) => ({ key: t.key, enabled: t.enabled !== false }));
    }
  } catch {
    /* ignore */
  }
  return defaultTabOrder();
}

const FOCUSABLE = 'input, select, textarea, button, [role="combobox"]';
const focusField = (root: HTMLElement | null, key: string) =>
  root?.querySelector<HTMLElement>(`[data-tabfield="${key}"]`)?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="bg-muted text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded border px-1.5 font-mono text-[10px] font-semibold">
      {children}
    </kbd>
  );
}

export function OrderFormPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const { can } = usePermissions();
  const params = useParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const isEdit = id != null;
  // The same form drives both orders and quotations. The route decides which
  // document we're editing; on /orders/new the user picks via the two buttons.
  const docKind: 'order' | 'quotation' = location.pathname.startsWith('/quotations') ? 'quotation' : 'order';
  const listPath = docKind === 'quotation' ? '/quotations' : '/orders';
  const docLabel = docKind === 'quotation' ? 'quotation' : 'order';
  const [saved, setSaved] = useState(false); // shows the success-tick overlay

  const { data: lookups } = useOrderLookups();
  const { data: settings } = useSettings();
  const orderQuery = useOrder(docKind === 'order' ? id : undefined);
  const quotationQuery = useQuotation(docKind === 'quotation' ? id : undefined);
  const existing = docKind === 'quotation' ? quotationQuery.data : orderQuery.data;
  const isLoading = docKind === 'quotation' ? quotationQuery.isLoading : orderQuery.isLoading;
  const create = useCreateOrder();
  const update = useUpdateOrder(id ?? 0);
  const createQuotation = useCreateQuotation();
  const updateQuotation = useUpdateQuotation(id ?? 0);
  const convertQuotation = useConvertQuotation();
  const saving =
    create.isPending || update.isPending || createQuotation.isPending || updateQuotation.isPending || convertQuotation.isPending;
  const keyer = useRef(0);
  const formRef = useRef<HTMLDivElement>(null);

  // The Tab sequence (ordered + per-field enable), managed from the gear panel.
  const [tabOrder, setTabOrder] = useState<TabEntry[]>(loadTabOrder);
  useEffect(() => {
    try {
      localStorage.setItem(TAB_PREF_KEY, JSON.stringify(tabOrder));
    } catch {
      /* ignore */
    }
  }, [tabOrder]);

  // The enabled field keys, in the user's chosen order.
  const tabSequence = useMemo(() => tabOrder.filter((t) => t.enabled).map((t) => t.key), [tabOrder]);

  // Mark excluded fields un-tabbable; included ones stay reachable.
  useLayoutEffect(() => {
    const root = formRef.current;
    if (!root) return;
    const enabled = new Map(tabOrder.map((t) => [t.key, t.enabled] as const));
    root.querySelectorAll<HTMLElement>('[data-tabfield]').forEach((wrap) => {
      const key = wrap.getAttribute('data-tabfield')!;
      const idx = enabled.get(key) === false ? -1 : 0;
      wrap.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
        el.tabIndex = idx;
      });
    });
  });

  // Tab / Shift+Tab between tracked fields follow the user-defined sequence.
  const handleTabNav = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const root = formRef.current;
    if (!root) return;
    const wrap = (e.target as HTMLElement).closest('[data-tabfield]');
    if (!wrap || !root.contains(wrap)) return;
    const i = tabSequence.indexOf(wrap.getAttribute('data-tabfield') ?? '');
    if (i === -1) return;
    const j = e.shiftKey ? i - 1 : i + 1;
    if (j < 0 || j >= tabSequence.length) return; // at the ends, let natural Tab continue
    e.preventDefault();
    focusField(root, tabSequence[j]);
  };

  const completionDayOptions = useMemo(() => settingValues(settings, 'COMPLETION_DAYS'), [settings]);
  const orderTypeOptions = useMemo(() => settingValues(settings, 'ORDER_TYPE'), [settings]);

  // Header
  const [customer, setCustomer] = useState('');
  const [customerId, setCustomerId] = useState<number | undefined>(undefined);
  const [poNumber, setPoNumber] = useState('');
  const [agentName, setAgentName] = useState('');
  const [category, setCategory] = useState('SALES');
  const [orderDate, setOrderDate] = useState(today());
  const [completionDay, setCompletionDay] = useState('');
  const [status, setStatus] = useState('CONFIRMED'); // new orders default to confirmed
  const [showBy, setShowBy] = useState<'PCS' | 'SIZE'>('SIZE');
  const { autoSizePcs } = useAutoSizePcs();

  // Item entry (the row being built) + the added items
  const [entry, setEntry] = useState(blankEntry());
  const [items, setItems] = useState<Item[]>([]);

  // How many item rows to keep visible in the panel before it scrolls — a saved
  // per-user preference. 0 = show all (the panel grows and the page scrolls).
  const [rowsToShow, setRowsToShow] = useState<number>(() => {
    const stored = localStorage.getItem(ROWS_PREF_KEY);
    if (stored == null) return 8; // Number(null) is 0 (= "All"), so guard the empty case.
    const raw = Number(stored);
    return ROWS_OPTIONS.includes(raw) ? raw : 8;
  });
  useEffect(() => {
    try {
      localStorage.setItem(ROWS_PREF_KEY, String(rowsToShow));
    } catch {
      /* ignore */
    }
  }, [rowsToShow]);
  // Cap the grid's height to the chosen number of rows (row ≈ 2.5rem + header).
  const gridMaxHeight = rowsToShow === 0 ? undefined : `${rowsToShow * 2.5 + 2.9}rem`;

  // Bag-booking draw-down: pull a customer's reserved bags into this order. The
  // button only shows when the customer actually has a drawable booking.
  const [bookingSheetOpen, setBookingSheetOpen] = useState(false);
  const { data: activeBookings = [] } = useActiveCustomerBookings(docKind === 'order' ? customer.trim() : '');
  // Bags/kgs already queued in THIS order for a given booking (so the sheet can
  // show the true remaining before the order is even saved).
  const alreadyQueuedForBooking = (bookingId: number) =>
    items.reduce(
      (a, i) => (i.bookingId === bookingId && i.status !== 'CANCELLED' ? { bags: a.bags + (n(i.bags) ?? 0), kgs: a.kgs + (n(i.gram) ?? 0) } : a),
      { bags: 0, kgs: 0 },
    );
  // Append booking-drawn lines (already priced at the frozen rate) to the order.
  const addBookingLines = (drawn: DrawnBookingLine[]) => {
    setItems((its) => [
      ...its,
      ...drawn.map((d) => ({
        key: `bkg${keyer.current++}`,
        bookingId: d.bookingId,
        bookingCode: d.bookingCode,
        itemName: d.itemName,
        product: d.product,
        category: d.category,
        subCategory: d.subCategory,
        designType: d.designType,
        designName: d.designName || 'NA',
        productRate: d.productRate,
        designRate: d.designRate,
        weight: '',
        pcsBox: '',
        ordType: entry.ordType,
        priority: d.priority || 'NORMAL',
        bags: d.bags,
        pcs: d.pcs,
        gram: d.gram,
        box: d.box,
        comment: d.comment,
        calField: d.calField,
      })),
    ]);
    toast.success(`${drawn.length} item${drawn.length === 1 ? '' : 's'} drawn from booking`);
  };

  // The selected customer's special rates (deltas), applied when an item is picked.
  const { data: special } = useCustomerSpecialRates(customerId);

  // Keep customerId in sync with the customer NAME + the loaded lookups. Without
  // this, a customer set outside onCustomer() — a restored draft or an edit load —
  // leaves customerId undefined, so the customer's special rates and logo blocks
  // never load (rates aren't applied, blocked logos still show). Setting the same
  // id is a no-op, so this never fights onCustomer.
  useEffect(() => {
    const id = customer.trim() ? lookups?.customers.find((x) => x.name === customer)?.id : undefined;
    setCustomerId(id);
  }, [customer, lookups]);

  const completionDate = useMemo(
    () => (completionDay.trim() === '' ? '' : addDays(orderDate, Number(completionDay))),
    [orderDate, completionDay],
  );

  // designType code -> its first design name from the Design Names master.
  const nameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const dn of lookups?.designNames ?? []) {
      const k = dn.designType.toUpperCase();
      if (!m.has(k)) m.set(k, dn.designName);
    }
    return m;
  }, [lookups]);

  // Default the entry's order type once options load.
  useEffect(() => {
    if (!entry.ordType && orderTypeOptions.length) setEntry((e) => ({ ...e, ordType: orderTypeOptions[0] }));
  }, [orderTypeOptions, entry.ordType]);

  // Populate every field from a saved order (used on load + by the Reset button).
  const loadExisting = useCallback(
    (o: NonNullable<typeof existing>) => {
      setCustomer(o.customerName);
      setCustomerId(o.customerId ?? undefined);
      setPoNumber(o.poNumber ?? '');
      setAgentName(o.agentName ?? '');
      setCategory(o.category ?? 'SALES');
      setOrderDate(o.orderDate.slice(0, 10));
      setCompletionDay(o.completionDay?.toString() ?? '');
      setStatus(o.status);
      setEntry(blankEntry());
      setItems(
        o.items.map((it, i) => ({
          key: `e${it.id}-${i}`,
          id: it.id,
          status: it.status,
          bookingId: it.bookingId,
          bookingCode: it.bookingCode ?? null,
          itemName: it.productName ?? [it.product, it.designType].filter(Boolean).join(' '),
          product: it.product ?? '',
          category: it.pCategory ?? '',
          subCategory: it.subCategory ?? '',
          designType: it.designType ?? '',
          designName: it.designType ? (nameByCode.get(it.designType.toUpperCase()) ?? '') : '',
          productRate: it.productRate?.toString() ?? '',
          designRate: it.designRate?.toString() ?? '',
          weight: '',
          pcsBox: '',
          ordType: it.ordType ?? '',
          priority: it.priority ?? 'NORMAL',
          bags: it.bags?.toString() ?? '',
          pcs: it.pcs?.toString() ?? '',
          gram: it.gram?.toString() ?? '',
          box: it.box?.toString() ?? '',
          comment: it.comment ?? '',
          calField: it.calField ?? 'KGS',
        })),
      );
    },
    [nameByCode],
  );

  // Load an existing order for editing.
  useEffect(() => {
    if (existing) loadExisting(existing);
  }, [existing, loadExisting]);

  // ── Work-in-progress local draft (auto-save / restore) ───────────────────
  // Only for a brand-new order — restores a half-filled order from last time.
  const draftEnabled = !isEdit && docKind === 'order';
  const draftReady = useRef(false);
  const [restoredDraft, setRestoredDraft] = useState(false);

  // Restore once on mount.
  useEffect(() => {
    if (!draftEnabled) {
      draftReady.current = true;
      return;
    }
    const d = loadOrderDraft();
    if (d && (d.customer || (Array.isArray(d.items) && d.items.length > 0))) {
      setCustomer(d.customer || '');
      setPoNumber(d.poNumber || '');
      setAgentName(d.agentName || '');
      setCategory(d.category || 'SALES');
      if (d.orderDate) setOrderDate(d.orderDate);
      setCompletionDay(d.completionDay || '');
      if (d.status) setStatus(d.status);
      if (d.showBy) setShowBy(d.showBy);
      setItems((d.items as Item[]).map((it, idx) => ({ ...it, key: `d${idx}` })));
      setRestoredDraft(true);
    }
    draftReady.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save the WIP order (debounced) whenever it has any content.
  useEffect(() => {
    if (!draftEnabled || !draftReady.current) return;
    const t = window.setTimeout(() => {
      if (customer.trim() || items.length > 0) {
        saveOrderDraft({ customer, poNumber, agentName, category, orderDate, completionDay, status, showBy, items });
      } else {
        clearOrderDraft();
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [draftEnabled, customer, poNumber, agentName, category, orderDate, completionDay, status, showBy, items]);

  // Clear the whole form back to a blank state.
  const blankForm = () => {
    setCustomer('');
    setCustomerId(undefined);
    setPoNumber('');
    setAgentName('');
    setCategory('SALES');
    setOrderDate(today());
    setCompletionDay('');
    setStatus('CONFIRMED');
    setItems([]);
    setEntry(blankEntry());
  };

  // Throw away the restored draft and start blank.
  const discardDraft = () => {
    clearOrderDraft();
    setRestoredDraft(false);
    blankForm();
  };

  // Reset button: on a new form clear everything; when editing, revert every
  // field back to the saved order (undo unsaved changes). Asks first.
  const resetForm = async () => {
    const hasContent = customer.trim() || items.length > 0 || entry.itemName.trim();
    if (hasContent) {
      const ok = await confirm({
        title: isEdit ? `Revert changes to this ${docLabel}?` : `Reset this ${docLabel}?`,
        description: isEdit
          ? 'Every field goes back to the last saved values — unsaved changes are discarded.'
          : 'Clears the customer and all items so you can start fresh.',
        confirmText: isEdit ? 'Revert' : 'Reset',
        destructive: true,
      });
      if (!ok) return;
    }
    if (isEdit && existing) {
      loadExisting(existing);
    } else {
      clearOrderDraft();
      setRestoredDraft(false);
      blankForm();
    }
    requestAnimationFrame(() => focusField(formRef.current, 'customer'));
  };

  // Auto-fill agent + category from the chosen customer, and capture the id so we
  // can apply that customer's special rates to each line.
  const onCustomer = (name: string) => {
    setCustomer(name);
    const c = lookups?.customers.find((x) => x.name === name);
    setCustomerId(c?.id);
    if (c) {
      setAgentName(c.agentName ?? '');
      if (c.category) setCategory(c.category);
    }
  };

  const setEntryField = (patch: Partial<Item>) => setEntry((e) => ({ ...e, ...patch }));

  // Block any non-numeric keystroke (digits + a single decimal point), like the legacy CheckNum.
  const onlyNumericKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length > 1) return; // allow shortcuts + nav/control keys
    if (/[0-9]/.test(e.key)) return;
    if (e.key === '.' && !e.currentTarget.value.includes('.')) return;
    e.preventDefault();
  };

  // Build the composite item-name dropdown, exactly like the legacy combo:
  // each entry is "{size|pcs} {product} {designType}". The leading number is the
  // product's size in "Size" mode or its pcs in "Pcs" mode.
  const itemOptions = useMemo(() => {
    const list = lookups?.items ?? [];
    // Hide logo items entirely when this customer's logo is blocked for that
    // category (or category + sub-category) — a blocked logo can't be ordered.
    const logos = special?.logos ?? [];
    // Compare case/space-insensitively (mirrors resolveSpecialRates) so a casing
    // mismatch never lets a blocked-logo item slip back into the list.
    const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
    const logoBlocked = (category: string, subCategory: string) =>
      logos.some(
        (l) =>
          (l.scope === 'CATEGORY' && norm(l.category) === norm(category)) ||
          (l.scope === 'SUBCATEGORY' && norm(l.category) === norm(category) && norm(l.subCategory) === norm(subCategory)),
      );
    const map = new Map<string, (typeof list)[number]>();
    const labels: string[] = [];
    for (const it of list) {
      if (isLogoDesign(it.designType) && logoBlocked(it.category, it.subCategory)) continue;
      const prefix = showBy === 'PCS' ? fmtNum(it.pcs) : fmtNum(it.size);
      const label = [prefix, it.product, it.designType ?? ''].filter(Boolean).join(' ');
      if (!label || map.has(label)) continue; // first wins on duplicate labels
      map.set(label, it);
      labels.push(label);
    }
    return { labels, map };
  }, [lookups, showBy, special]);

  // Picking an item fills product, category/sub, design type, rates + weight/box info.
  const onItemPick = (label: string) => {
    const it = itemOptions.map.get(label);
    if (!it) {
      setEntry((e) => ({ ...e, itemName: label, product: label }));
      return;
    }
    // Apply the customer's special-rate cascade (most-specific level wins) on top
    // of the base product/design rate. Falls through to base rates when none set.
    const res = special
      ? resolveSpecialRates(special, {
          category: it.category,
          subCategory: it.subCategory,
          product: it.product,
          designType: it.designType ?? null,
        })
      : null;
    const hasProd = it.productRate != null || (res?.productDelta ?? 0) !== 0;
    const hasDesign = !!it.designType && (it.designRate != null || (res?.designDelta ?? 0) !== 0);
    const prodRate = (it.productRate ?? 0) + (res?.productDelta ?? 0);
    const desRate = (it.designRate ?? 0) + (res?.designDelta ?? 0);

    // When a special rate priced this pick, carry a human note onto the line so
    // the grid can show a "special" tag right beside the item (no banner).
    const specialTip =
      res && (res.productDelta !== 0 || res.designDelta !== 0)
        ? [
            res.productDelta !== 0 ? `product ${fmtDelta(res.productDelta)} (${scopeWord(res.productFrom)})` : '',
            res.designDelta !== 0 ? `design ${fmtDelta(res.designDelta)} (${scopeWord(res.designFrom)})` : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : null;

    setEntry((e) => ({
      ...e,
      itemName: label,
      product: it.product,
      category: it.category,
      subCategory: it.subCategory,
      weight: it.weight != null ? String(it.weight) : '',
      pcsBox: it.pcs != null ? String(it.pcs) : '',
      productRate: hasProd ? String(prodRate) : '',
      designType: it.designType ?? '',
      // Never pre-pick a design name — the user must choose it explicitly
      // (locked to "NA" only when the design code has no names at all).
      designName: '',
      designRate: hasDesign ? String(desRate) : '',
      special: specialTip,
    }));
  };

  // As the user types the item name, the leading number is either a size or a
  // pcs value — auto-flip the Size/Pcs radio to whichever the catalogue matches.
  // When a number is BOTH a size and a pcs we prefer Size. Only runs when the
  // auto-detect preference is on (otherwise the user picks Size/Pcs manually).
  const detectShowBy = (text: string) => {
    if (!autoSizePcs) return;
    const lead = text.trim().match(/^(\d+(?:\.\d+)?)/)?.[1];
    if (!lead) return;
    const list = lookups?.items ?? [];
    const sizeExact = list.some((it) => it.size != null && String(it.size) === lead);
    const pcsExact = list.some((it) => it.pcs != null && String(it.pcs) === lead);
    if (sizeExact || pcsExact) {
      setShowBy(sizeExact ? 'SIZE' : 'PCS'); // tie → Size
      return;
    }
    // Still mid-number: fall back to a prefix match when only one side leads with it.
    const sizePre = list.some((it) => it.size != null && String(it.size).startsWith(lead));
    const pcsPre = list.some((it) => it.pcs != null && String(it.pcs).startsWith(lead));
    if (sizePre || pcsPre) setShowBy(sizePre ? 'SIZE' : 'PCS'); // tie → Size
  };

  // Auto-calc Kgs (= Bags × the customer's per-category bag weight) as bags are
  // typed — configured in Special Rates → "Bag weight (Kgs per bag)". The user
  // can still overtype Kgs afterwards; without a configured weight nothing changes.
  const onBags = (value: string) => {
    setEntry((e) => {
      const cat = e.category.trim().toUpperCase();
      const bw = (special?.bagWeights ?? []).find((b) => b.category.trim().toUpperCase() === cat);
      const bags = n(value) ?? 0;
      const round2 = (x: number) => String(Math.round(x * 100) / 100);
      return {
        ...e,
        bags: value,
        gram: bw && value.trim() !== '' ? round2(bags * bw.kgsPerBag) : e.gram,
      };
    });
  };

  // Auto-calc Kgs (= Pcs × weight) as Pcs is typed. Box is NOT auto-filled here —
  // the user fills it on demand with the tick beside the Box field (fillBox).
  const onPcs = (value: string) => {
    setEntry((e) => {
      const pcs = n(value) ?? 0;
      const w = n(e.weight);
      const round2 = (x: number) => String(Math.round(x * 100) / 100);
      return {
        ...e,
        pcs: value,
        gram: w != null && value.trim() !== '' ? round2(pcs * w) : e.gram,
      };
    });
  };

  // Boxes needed for the current Pcs (= Pcs ÷ pieces-per-box). Only meaningful
  // once a product with a known pcs-per-box is picked and Pcs is entered.
  const boxPreview = useMemo(() => {
    const per = n(entry.pcsBox);
    const pcs = n(entry.pcs);
    if (per == null || per <= 0 || pcs == null || entry.pcs.trim() === '') return null;
    return Math.round((pcs / per) * 100) / 100;
  }, [entry.pcsBox, entry.pcs]);
  const fillBox = () => {
    if (boxPreview == null) return toast.error('Pick a product and enter Pcs first — pieces-per-box is needed.');
    setEntryField({ box: String(boxPreview) });
  };

  // Design names for the SELECTED item's design-type code — legacy:
  // SELECT [DESIGN NAME] FROM DesignName WHERE [DESIGN TYPE L] = <the item's design code>.
  const designChoices = useMemo(() => {
    const code = entry.designType.trim().toUpperCase();
    if (!code) return [] as string[];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const dn of lookups?.designNames ?? []) {
      if (dn.designType.toUpperCase() === code && !seen.has(dn.designName)) {
        seen.add(dn.designName);
        names.push(dn.designName);
      }
    }
    return names;
  }, [lookups, entry.designType]);

  // Picking a name only changes the label — the code + rate come from the item.
  const onDesignName = (name: string) => setEntry((e) => ({ ...e, designName: name }));

  // The item's design code has no names in the master (or it has no design) → lock to "NA".
  const noDesignNames = designChoices.length === 0;
  // Design rate is editable only when it is > 0 (per the legacy rule).
  const designRateEditable = (n(entry.designRate) ?? 0) > 0;

  const entryTotal = itemRate(entry);

  // Per-category price-calc field (KGS/PCS), configured on the Products page.
  const categoryFieldMap = useMemo(() => {
    const m = new Map<string, 'KGS' | 'PCS'>();
    for (const cf of lookups?.categoryFields ?? []) m.set(cf.category.toUpperCase(), cf.field === 'PCS' ? 'PCS' : 'KGS');
    return m;
  }, [lookups]);

  const addItem = async () => {
    if (!entry.product.trim() && !entry.designType.trim()) {
      return toast.error('Pick a product or design type to add');
    }
    // The picked item must come from the catalogue (free text can slip in when
    // the field loses focus without a pick).
    if (entry.itemName.trim() && !entry.category.trim() && !entry.subCategory.trim()) {
      return toast.error('Please select a correct item from the list');
    }
    // A design name must be chosen explicitly whenever the item's design code
    // has names in the master (locked to "NA" otherwise).
    if (!noDesignNames && !entry.designName.trim()) {
      return toast.error('Please select a Design Name for this item');
    }
    // Quantities can never be negative.
    const qtyFields: [string, string][] = [
      ['Bags', entry.bags],
      ['Pcs', entry.pcs],
      ['Kgs', entry.gram],
      ['Box', entry.box],
    ];
    for (const [label, v] of qtyFields) {
      const num = n(v);
      if (num != null && num < 0) return toast.error(`${label} cannot be negative`);
    }
    // The line's price-calc field follows the product's category mapping; if the
    // category isn't configured, fall back to the Size/Pcs selection.
    const calField = categoryFieldMap.get(entry.category.trim().toUpperCase()) ?? (showBy === 'PCS' ? 'PCS' : 'KGS');
    // The billing quantity (Kgs or Pcs, per the calc field) must be entered —
    // otherwise the line's amount would silently be ₹0.
    const billQty = calField === 'PCS' ? n(entry.pcs) : n(entry.gram);
    if (billQty == null || billQty <= 0) {
      return toast.error(
        calField === 'PCS' ? 'Enter Pcs — this item is billed by pieces' : 'Enter Kgs — this item is billed by weight',
      );
    }
    const designName = noDesignNames ? 'NA' : entry.designName;
    // Duplicate guard: same item + design name already on the list → confirm.
    const dupIdx = items.findIndex(
      (i) =>
        i.status !== 'CANCELLED' &&
        i.itemName.trim().toUpperCase() === entry.itemName.trim().toUpperCase() &&
        (i.designName || 'NA').toUpperCase() === designName.toUpperCase(),
    );
    if (dupIdx >= 0) {
      const ok = await confirm({
        title: 'Item already added',
        description: `"${entry.itemName}" is already on this order (line ${dupIdx + 1}). Add it again as a separate line?`,
        confirmText: 'Add anyway',
      });
      if (!ok) return;
    }
    setItems((its) => [
      ...its,
      { ...entry, key: `i${keyer.current++}`, calField, designName },
    ]);
    // Reset the item fields but keep order type / priority for the next line.
    setEntry((e) => ({ ...blankEntry(), ordType: e.ordType, priority: e.priority }));
    // Return focus to Item name so the next line can be entered immediately.
    requestAnimationFrame(() => focusField(formRef.current, 'itemName'));
  };

  const removeItem = (key: string) => setItems((its) => its.filter((i) => i.key !== key));

  // The order's money total = sum of line amounts (rate × Kgs/Pcs).
  const total = useMemo(() => items.reduce((s, i) => s + lineAmount(i), 0), [items]);

  // Column totals shown in the grid footer.
  const totals = useMemo(
    () =>
      items.reduce(
        (a, i) => ({
          bags: a.bags + (n(i.bags) ?? 0),
          pcs: a.pcs + (n(i.pcs) ?? 0),
          gram: a.gram + (n(i.gram) ?? 0),
          box: a.box + (n(i.box) ?? 0),
          rate: a.rate + itemRate(i),
          amount: a.amount + lineAmount(i),
        }),
        { bags: 0, pcs: 0, gram: 0, box: 0, rate: 0, amount: 0 },
      ),
    [items],
  );

  // Quick success tick, then navigate. The order is saved now, so drop the WIP draft.
  const finishTo = (dest: string) => {
    clearOrderDraft();
    setSaved(true);
    window.setTimeout(() => navigate(dest), 950);
  };

  const validate = (forDraft = false): boolean => {
    if (!customer.trim()) return !toast.error('Please select a correct customer');
    if (!forDraft && !completionDay.trim()) return !toast.error('Please Select the Completion Day');
    if (items.length === 0) return !toast.error('There are no items to save.');
    return true;
  };

  // If the order date is in the future, ask whether the order should be visible
  // from that day or from today, and return the date to actually save with.
  const resolveOrderDate = async (): Promise<string> => {
    if (docKind !== 'order') return orderDate;
    const todayStr = today();
    if (!orderDate || orderDate <= todayStr) return orderDate; // today or past — nothing to ask
    const fromFuture = await confirm({
      title: 'Order dated in the future',
      description: `This order's date is ${niceDate(orderDate)} — after today (${niceDate(todayStr)}). Should it be visible from ${niceDate(orderDate)}, or from today?`,
      confirmText: `From ${niceDate(orderDate)}`,
      cancelText: 'From today',
    });
    const eff = fromFuture ? orderDate : todayStr;
    if (eff !== orderDate) setOrderDate(eff);
    return eff;
  };

  // Build the create/update payload from the current form (orders & quotations
  // share the same shape, so this is reused for save and save-&-convert). Pass a
  // date to override the order date (completion date recomputes from it).
  const buildInput = (orderDateArg: string = orderDate): OrderInput => ({
    customerName: customer.trim(),
    poNumber: poNumber.trim() || null,
    agentName: agentName.trim() || null,
    category: category.trim() || null,
    orderDate: orderDateArg,
    completionDate: (completionDay.trim() === '' ? '' : addDays(orderDateArg, Number(completionDay))) || null,
    status,
    items: items.map((i) => ({
      id: i.id,
      status: i.status,
      bookingId: i.bookingId ?? null,
      pCategory: i.category.trim() || null,
      subCategory: i.subCategory.trim() || null,
      product: i.product.trim() || null,
      designType: i.designType.trim() || null,
      productName: i.itemName.trim() || [i.product.trim(), i.designType.trim()].filter(Boolean).join(' ') || null,
      productRate: n(i.productRate),
      designRate: n(i.designRate),
      rate: itemRate(i),
      ordType: i.ordType || null,
      priority: i.priority || null,
      bags: n(i.bags),
      pcs: n(i.pcs),
      gram: n(i.gram),
      box: n(i.box),
      comment: i.comment.trim() || null,
      calField: i.calField || null,
    })),
  });

  // Persist the form as either an order or a quotation. On /orders/new the two
  // footer buttons pick the target; when editing, the target follows the route.
  const persist = async (target: 'order' | 'quotation') => {
    if (!validate()) return;
    const noun = target === 'quotation' ? 'quotation' : 'order';
    const ok = await confirm({
      title: isEdit ? `Save changes to this ${noun}?` : `Create this ${noun}?`,
      description: `${items.length} item${items.length === 1 ? '' : 's'} · total ₹${total.toLocaleString('en-IN')} for ${customer.trim()}.`,
      confirmText: isEdit ? 'Save changes' : `Create ${noun}`,
    });
    if (!ok) return;
    const input = buildInput(await resolveOrderDate());
    const listDest = target === 'quotation' ? '/quotations' : '/orders';
    const onError = (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed'));
    if (isEdit) {
      const opts = { onSuccess: () => finishTo(listDest), onError };
      if (docKind === 'quotation') updateQuotation.mutate(input, opts);
      else update.mutate(input, opts);
    } else if (target === 'quotation') {
      // After creating, jump to the printable page so it can be downloaded right
      // away. Back from there returns to this New Order form (browser history).
      createQuotation.mutate(input, {
        onSuccess: (q) => finishTo(can('quotation:view') ? `/quotations/${q.id}/bill` : listDest),
        onError,
      });
    } else {
      create.mutate(input, {
        onSuccess: (o) => finishTo(can('order:print') ? `/orders/${o.id}/bill` : listDest),
        onError,
      });
    }
  };

  // Edit-&-convert: save the quotation's edits, then convert it to an order and
  // open the order's printable page. Only used when editing a quotation.
  const saveAndConvert = async () => {
    if (!validate()) return;
    const ok = await confirm({
      title: 'Save changes and convert to order?',
      description: `${items.length} item${items.length === 1 ? '' : 's'} · total ₹${total.toLocaleString('en-IN')} for ${customer.trim()}.`,
      confirmText: 'Save & Convert',
    });
    if (!ok) return;
    const onError = (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed'));
    updateQuotation.mutate(buildInput(), {
      onSuccess: () =>
        convertQuotation.mutate(
          { id: id!, mode: 'EDITED' },
          {
            onSuccess: (order) => finishTo(can('order:print') ? `/orders/${order.id}/bill` : '/orders'),
            onError: (e) => toast.error(getApiErrorMessage(e, 'Convert failed')),
          },
        ),
      onError,
    });
  };

  // Save the order with an explicit status. DRAFT orders are hidden from Order
  // Modify until confirmed; the WIP local draft is cleared via finishTo().
  const saveOrder = async (statusValue: string, redirectToBill: boolean) => {
    const isDraft = statusValue === 'DRAFT';
    if (!validate(isDraft)) return;
    const ok = await confirm({
      title: isEdit
        ? `Save changes to this ${isDraft ? 'draft' : 'order'}?`
        : isDraft
          ? 'Save this order as a draft?'
          : 'Create this order?',
      description: isDraft
        ? `${items.length} item${items.length === 1 ? '' : 's'} · kept as Draft and hidden from Order Modify until confirmed.`
        : `${items.length} item${items.length === 1 ? '' : 's'} · total ₹${total.toLocaleString('en-IN')} for ${customer.trim()}.`,
      confirmText: isEdit ? (isDraft ? 'Save draft' : 'Confirm & save') : isDraft ? 'Save draft' : 'Create order',
    });
    if (!ok) return;
    const input = { ...buildInput(await resolveOrderDate()), status: statusValue };
    const onError = (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed'));
    const done = (orderId?: number) =>
      finishTo(redirectToBill && orderId && can('order:print') ? `/orders/${orderId}/bill` : '/orders');
    if (isEdit) update.mutate(input, { onSuccess: () => done(), onError });
    else create.mutate(input, { onSuccess: (o) => done(o.id), onError });
  };

  // The primary action (Ctrl+S / main button). Quotations go through persist();
  // a new order is CONFIRMED, and the primary button on a draft order finalises it.
  const submit = () => {
    if (docKind === 'quotation') return persist('quotation');
    const statusValue = isEdit ? (status === 'DRAFT' ? 'CONFIRMED' : status) : 'CONFIRMED';
    return saveOrder(statusValue, !isEdit);
  };

  const orderIsDraft = docKind === 'order' && status === 'DRAFT';
  const primaryLabel = isEdit ? (orderIsDraft ? 'Confirm & Save' : 'Save changes') : `Create ${docLabel}`;
  // Offer "Save as Draft" on a new order, or when editing one that's still a draft.
  const showSaveDraft = docKind === 'order' && (!isEdit || orderIsDraft);

  // Keep the latest action handlers in a ref so the global shortcut listener
  // (bound once) always calls the current closures.
  const actionsRef = useRef<{ add: () => void; save: () => void; quote: () => void; cancel: () => void; focusItem: () => void } | null>(null);
  actionsRef.current = {
    add: addItem,
    save: submit,
    // Create-as-quotation — only on a brand-new order form.
    quote: () => {
      if (!isEdit && docKind === 'order') persist('quotation');
    },
    cancel: () => navigate(listPath),
    focusItem: () => formRef.current?.querySelector<HTMLElement>('[data-tabfield="itemName"] input')?.focus(),
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actionsRef.current;
      if (!a) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 's') {
        e.preventDefault();
        a.save();
      } else if (e.altKey && k === 'a') {
        e.preventDefault();
        a.add();
      } else if (e.altKey && k === 'q') {
        e.preventDefault();
        a.quote();
      } else if (e.altKey && k === 'i') {
        e.preventDefault();
        a.focusItem();
      } else if (e.key === 'Escape') {
        // Let an open dropdown / popover / dialog swallow Esc; only cancel when nothing is open.
        if (!document.querySelector('[data-slot="popover-content"], [role="dialog"], [role="alertdialog"]')) a.cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (isEdit && isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div ref={formRef} onKeyDown={handleTabNav} className="flex w-full flex-col gap-2">
      {/* Success tick overlay shown briefly after a save */}
      {saved && (
        <div className="bg-background/70 fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm">
          <div className="animate-in fade-in zoom-in-50 flex flex-col items-center gap-3 duration-300">
            <div className="flex size-24 items-center justify-center rounded-full bg-emerald-500 shadow-xl shadow-emerald-500/30 ring-8 ring-emerald-500/15">
              <Check className="animate-in zoom-in-50 size-12 text-white duration-500" strokeWidth={3} />
            </div>
            <p className="text-sm font-semibold text-emerald-700">{isEdit ? 'Saved' : 'Created'}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(listPath)} aria-label="Back">
          <ArrowLeft />
        </Button>
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <ReceiptText className="size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight">{isEdit ? `Modify ${docLabel}` : `New ${docLabel}`}</h2>
          <p className="text-muted-foreground truncate text-xs">
            {isEdit
              ? (existing?.code ?? `#${id}`)
              : docKind === 'quotation'
                ? 'Create a quotation — add items one by one'
                : 'Create a sales order — or save it as a quotation'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isEdit && existing?.code && (
            <span className="rounded-lg border bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">
              {existing.code}
            </span>
          )}
          <SettingsPanel tabOrder={tabOrder} setTabOrder={setTabOrder} />
        </div>
      </div>

      {/* Restored work-in-progress notice */}
      {restoredDraft && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span className="flex items-center gap-2">
            <History className="size-4" /> Restored your unsaved order from last time — keep editing or discard it.
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-7 text-amber-800 hover:bg-amber-100 hover:text-amber-900" onClick={discardDraft}>
            Discard
          </Button>
        </div>
      )}

      {/* Card 1 — order header in one row */}
      <Card className="border-l-4 border-l-primary py-0">
        <CardContent className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-3 lg:grid-cols-12">
          <div className="col-span-2 space-y-1.5 sm:col-span-1 lg:col-span-4" data-tabfield="customer">
            <Label className="text-base">Customer <span className="text-rose-500">*</span></Label>
            <NativeSelect
              value={customer}
              onChange={onCustomer}
              options={(lookups?.customers ?? []).map((c) => c.name)}
              placeholder="Select…"
              onInvalidEntry={() => toast.error('Please select a correct customer')}
            />
          </div>
          <div className="space-y-1.5 lg:col-span-2" data-tabfield="poNumber">
            <Label className="text-base whitespace-nowrap">PO Number</Label>
            <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO number…" />
          </div>
          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-base">Agent (auto)</Label>
            <Input value={agentName} readOnly tabIndex={-1} className="border-indigo-200/70 bg-indigo-50/60 font-medium text-indigo-700" />
          </div>
          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-base whitespace-nowrap">Category (auto)</Label>
            <Input value={category} readOnly tabIndex={-1} className="border-indigo-200/70 bg-indigo-50/60 font-medium text-indigo-700" />
          </div>
          <div className="space-y-1.5 lg:col-span-2" data-tabfield="orderDate">
            <Label className="text-base">Order date <span className="text-rose-500">*</span></Label>
            <DatePicker value={orderDate} onChange={setOrderDate} clearable={false} />
          </div>
          <div className="space-y-1.5 lg:col-span-2" data-tabfield="completionDay">
            <Label className="text-base">Com. days</Label>
            <NativeSelect
              value={completionDay}
              onChange={setCompletionDay}
              options={completionDayOptions}
              placeholder="Days…"
            />
          </div>
          <div className="space-y-1.5 lg:col-span-3">
            <Label className="text-base whitespace-nowrap">Completion date (auto)</Label>
            <Input value={niceDate(completionDate)} readOnly tabIndex={-1} className="border-indigo-200/70 bg-indigo-50/60 font-medium text-indigo-700" />
          </div>
        </CardContent>
      </Card>

      {/* Card 2 — item entry (2 rows) + grid */}
      <Card className="border-border border-l-4 border-l-slate-400 bg-slate-50/70 py-0">
        <CardContent className="space-y-2 px-4 py-3">
          {/* Row 1 */}
          <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3 lg:grid-cols-12">
            {/* Manual Size/Pcs picker — shown only when auto-detect is turned off. */}
            {!autoSizePcs && (
              <div className="col-span-2 space-y-1 sm:col-span-1 lg:col-span-2" data-tabfield="showBy">
                <Label className="text-base">Show item by</Label>
                <div className="flex h-9 items-center gap-4 text-sm">
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input type="radio" className="accent-indigo-600" checked={showBy === 'SIZE'} onChange={() => setShowBy('SIZE')} /> Size
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input type="radio" className="accent-indigo-600" checked={showBy === 'PCS'} onChange={() => setShowBy('PCS')} /> Pcs
                  </label>
                </div>
              </div>
            )}
            <div className={cn('col-span-2 space-y-1 sm:col-span-2', autoSizePcs ? 'lg:col-span-7' : 'lg:col-span-5')} data-tabfield="itemName">
              <Label className="text-base">Item name</Label>
              <NativeSelect
                value={entry.itemName}
                onChange={onItemPick}
                onType={detectShowBy}
                options={itemOptions.labels}
                placeholder="Item name"
                className="text-left"
                onInvalidEntry={() => {
                  toast.error('Please select a correct item');
                  requestAnimationFrame(() => focusField(formRef.current, 'itemName'));
                }}
              />
            </div>
            <div className="space-y-1 lg:col-span-2" data-tabfield="designName">
              <Label className="text-base">Design Name</Label>
              <NativeSelect
                value={noDesignNames ? 'NA' : entry.designName}
                onChange={onDesignName}
                options={noDesignNames ? ['NA'] : designChoices}
                placeholder="Design name"
                disabled={noDesignNames}
                onInvalidEntry={() => toast.error('Please select a correct design type')}
              />
            </div>
            <div className="space-y-1 lg:col-span-1" data-tabfield="productRate">
              <Label className="text-base">Product ₹</Label>
              <Input type="number" step="any" min={0} className="text-right tabular-nums" value={entry.productRate} onKeyDown={onlyNumericKey} onChange={(e) => setEntryField({ productRate: e.target.value })} />
            </div>
            <div className="space-y-1 lg:col-span-1" data-tabfield="designRate">
              <Label className="text-base">Design ₹</Label>
              <Input type="number" step="any" min={0} className="text-right tabular-nums" value={entry.designRate} disabled={!designRateEditable} onKeyDown={onlyNumericKey} onChange={(e) => setEntryField({ designRate: e.target.value })} />
            </div>
            <div className="space-y-1 lg:col-span-1">
              <Label className="text-base">Total ₹</Label>
              <div className="flex h-9 items-center justify-end rounded-md border border-emerald-200 bg-emerald-50 px-2 text-sm font-bold tabular-nums text-emerald-700">
                {entryTotal.toLocaleString('en-IN')}
              </div>
            </div>
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4 lg:grid-cols-12">
            <div className="space-y-1 lg:col-span-2" data-tabfield="ordType">
              <Label className="text-base">Order type</Label>
              <NativeSelect value={entry.ordType} onChange={(v) => setEntryField({ ordType: v })} options={orderTypeOptions} placeholder="Type…" />
            </div>
            <div className="space-y-1 lg:col-span-2" data-tabfield="priority">
              <Label className="text-base">Priority</Label>
              <NativeSelect value={entry.priority} onChange={(v) => setEntryField({ priority: v })} options={[...ORDER_PRIORITIES]} />
            </div>
            <div className="space-y-1 lg:col-span-1" data-tabfield="bags">
              <Label className="text-base">Bags</Label>
              <Input type="number" step="any" min={0} value={entry.bags} onKeyDown={onlyNumericKey} onChange={(e) => onBags(e.target.value)} />
            </div>
            <div className="space-y-1 lg:col-span-1" data-tabfield="pcs">
              <Label className={cn('text-base', showBy === 'PCS' && 'text-primary font-semibold')}>Pcs</Label>
              <Input type="number" step="any" min={0} value={entry.pcs} onKeyDown={onlyNumericKey} onChange={(e) => onPcs(e.target.value)} />
            </div>
            <div className="space-y-1 lg:col-span-1" data-tabfield="gram">
              <Label className={cn('text-base', showBy === 'SIZE' && 'text-primary font-semibold')}>Kgs</Label>
              <Input type="number" step="any" min={0} value={entry.gram} onKeyDown={onlyNumericKey} onChange={(e) => setEntryField({ gram: e.target.value })} />
            </div>
            <div className="space-y-1 lg:col-span-2" data-tabfield="box">
              <Label className="text-base">Box</Label>
              <div className="flex gap-1">
                <Input type="number" step="any" min={0} value={entry.box} onKeyDown={onlyNumericKey} onChange={(e) => setEntryField({ box: e.target.value })} />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-9 shrink-0 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 disabled:text-slate-300"
                  disabled={boxPreview == null}
                  onClick={fillBox}
                  aria-label="Fill boxes required"
                  title={boxPreview == null ? 'Enter Pcs (product needs pieces-per-box) to fill boxes' : `Fill boxes required — ${boxPreview} box (Pcs ÷ pcs-per-box)`}
                >
                  <Check className="size-4" />
                </Button>
              </div>
              {boxPreview != null && Number(entry.box) !== boxPreview && (
                <button type="button" onClick={fillBox} className="text-[11px] font-medium text-emerald-600 hover:underline">
                  {boxPreview} box required — tap ✓ to fill
                </button>
              )}
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-3 lg:col-span-2" data-tabfield="comment">
              <Label className="text-base">Remarks</Label>
              <Input value={entry.comment} onChange={(e) => setEntryField({ comment: e.target.value })} placeholder="Item remark…" />
            </div>
            <div className="col-span-2 sm:col-span-1 lg:col-span-1">
              <Button onClick={addItem} className="w-full" aria-label="Add item" title="Add item (Alt+A)">
                <Plus /> Add
              </Button>
            </div>
          </div>

          {/* Items panel toolbar: count · rows-to-show setting · Draw from booking. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs font-medium">
              Added items{items.length ? ` · ${items.length}` : ''}
              {items.some((i) => i.bookingId) ? ` · ${items.filter((i) => i.bookingId).length} from a booking` : ''}
            </span>
            <div className="flex items-center gap-2">
              {/* How many item rows stay visible before the panel scrolls. */}
              <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                Show
                <select
                  value={rowsToShow}
                  onChange={(e) => setRowsToShow(Number(e.target.value))}
                  className="border-input h-8 rounded-md border bg-transparent px-2 text-xs font-medium outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  title="How many item rows to show before the panel scrolls"
                >
                  {ROWS_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {rowsLabel(n)}
                    </option>
                  ))}
                </select>
              </label>
              {docKind === 'order' && can('booking:view') && activeBookings.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  className="bg-sky-700 font-semibold text-white shadow-md shadow-sky-700/25 hover:bg-sky-800"
                  onClick={() => setBookingSheetOpen(true)}
                  title="Draw items from this customer’s bag bookings"
                >
                  <PackageOpen /> Draw from Bag Booking
                  <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">{activeBookings.length}</span>
                </Button>
              )}
            </div>
          </div>

          {/* Added items — grid auto-fits to the desktop width; height follows the
              chosen "Show N rows" preference (unbounded when set to All). */}
          <div className="overflow-auto rounded-lg border" style={{ maxHeight: gridMaxHeight }}>
            {/* Prod ₹ / Dsgn ₹ are saved with the order but hidden from this list. */}
            <table className="w-full text-sm">
              <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:bg-gradient-to-b [&_th]:from-sky-50 [&_th]:to-indigo-100 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[15px] [&_th]:font-semibold [&_th]:text-slate-900">
                <tr>
                  <th className="w-10 text-center">Sr</th>
                  <th>Item name</th>
                  <th>Design Name</th>
                  <th>Order type</th>
                  <th>Priority</th>
                  <th className="text-right">Bags</th>
                  <th className="text-right">Pcs</th>
                  <th className="text-right">Kgs</th>
                  <th className="text-right">Box</th>
                  <th className="text-right">Rate ₹</th>
                  <th className="text-right">Amount ₹</th>
                  <th>Remarks</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="[&_td]:border-t [&_td]:px-3 [&_td]:py-2">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="text-muted-foreground h-14 text-center">
                      No items yet — fill the fields above and click “Add”.
                    </td>
                  </tr>
                ) : (
                  items.map((i, idx) => (
                    <tr key={i.key} className="hover:bg-muted/40">
                      <td className="text-muted-foreground text-center tabular-nums">{idx + 1}</td>
                      <td className="font-medium">
                        {i.itemName || i.product || '—'}
                        {i.special && (
                          <span
                            className="ml-2 inline-flex items-center gap-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700"
                            title={`Special rate applied — ${i.special}`}
                          >
                            <BadgePercent className="size-3" /> special
                          </span>
                        )}
                        {i.bookingId && (
                          <span
                            className="ml-2 inline-flex items-center gap-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700"
                            title={`Drawn from booking ${i.bookingCode ?? ''} — rate frozen to the booking date`}
                          >
                            <PackageOpen className="size-3" /> {i.bookingCode ?? 'Booking'}
                          </span>
                        )}
                      </td>
                      <td>{i.designName || '—'}</td>
                      <td>{i.ordType || '—'}</td>
                      <td>{i.priority === 'URGENT' ? <span className="font-semibold text-rose-600">URGENT</span> : i.priority}</td>
                      <td className="text-right tabular-nums">{i.bags || '—'}</td>
                      <td className="text-right tabular-nums">{i.pcs || '—'}</td>
                      <td className="text-right tabular-nums">{i.gram || '—'}</td>
                      <td className="text-right tabular-nums">{i.box || '—'}</td>
                      <td className="text-right tabular-nums">{itemRate(i).toLocaleString('en-IN')}</td>
                      <td className="text-right font-semibold tabular-nums text-emerald-700">{lineAmount(i).toLocaleString('en-IN')}</td>
                      <td className="max-w-[14rem] truncate" title={i.comment}>{i.comment || '—'}</td>
                      <td>
                        {i.id != null ? (
                          // A saved line — deleting it belongs on the Order Modify page,
                          // where the removal (and its dispatch guard) is handled properly.
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-help text-slate-400">
                                <span className="inline-flex size-7 items-center justify-center">
                                  <Lock className="size-3.5" />
                                </span>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-56">
                              <p className="font-semibold">Saved order line</p>
                              <p className="opacity-80">Existing items can’t be removed here — delete them from the Order Modify page.</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => removeItem(i.key)} aria-label="Remove">
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {items.length > 0 && (
                <tfoot className="[&_td]:sticky [&_td]:bottom-0 [&_td]:border-t-2 [&_td]:bg-slate-100 [&_td]:px-3 [&_td]:py-2 [&_td]:font-semibold">
                  <tr>
                    <td colSpan={5} className="text-right">
                      Total
                    </td>
                    <td className="text-right tabular-nums">{totals.bags.toLocaleString('en-IN')}</td>
                    <td className="text-right tabular-nums">{totals.pcs.toLocaleString('en-IN')}</td>
                    <td className="text-right tabular-nums">{totals.gram.toLocaleString('en-IN')}</td>
                    <td className="text-right tabular-nums">{totals.box.toLocaleString('en-IN')}</td>
                    <td className="text-right tabular-nums">{totals.rate.toLocaleString('en-IN')}</td>
                    <td className="text-right tabular-nums text-emerald-700">{totals.amount.toLocaleString('en-IN')}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Action bar pinned to the bottom of the viewport so Cancel / Save stay
          reachable no matter how tall the item panel grows. Wraps so the buttons
          are never cut off when zoomed in. */}
      <div className="bg-background/95 sticky bottom-0 z-30 -mx-1 mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t px-2 py-3 shadow-[0_-4px_12px_-8px_rgba(2,6,23,0.25)] backdrop-blur">
        <p className="text-sm">
          {items.length} item(s) · total{' '}
          <span className="font-bold tabular-nums text-emerald-600">₹{total.toLocaleString('en-IN')}</span>
        </p>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button type="button" variant="destructive" onClick={() => navigate(listPath)} title="Cancel (Esc)">
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={resetForm} title={isEdit ? 'Revert unsaved changes' : 'Clear the form'}>
            <RotateCcw /> Reset
          </Button>
          {/* Save the order with DRAFT status — hidden from Order Modify until confirmed. */}
          {showSaveDraft && (
            <Button
              type="button"
              variant="outline"
              onClick={() => saveOrder('DRAFT', false)}
              disabled={saving}
              title="Save as a draft order (hidden from Order Modify)"
            >
              <FilePen /> Save as Draft
            </Button>
          )}
          {/* On a new form, offer "Create Quotation" (light red) alongside the order action. */}
          {!isEdit && docKind === 'order' && (
            <Button
              type="button"
              onClick={() => persist('quotation')}
              disabled={saving}
              className="border border-red-200 bg-red-100 text-red-700 hover:bg-red-200"
              title="Save as a quotation (Alt+Q)"
            >
              <FileText /> Create Quotation
              <Kbd>Alt+Q</Kbd>
            </Button>
          )}
          {/* Edit a quotation → also offer "Save & Convert" straight to an order. */}
          {isEdit && docKind === 'quotation' && (
            <Button
              type="button"
              onClick={saveAndConvert}
              disabled={saving}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              title="Save changes and convert to an order"
            >
              <ArrowRightLeft /> Save &amp; Convert
            </Button>
          )}
          <Button onClick={submit} disabled={saving} title={`${primaryLabel} (Ctrl+S)`}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {primaryLabel}
            <Kbd>Ctrl+S</Kbd>
          </Button>
        </div>
      </div>

      {/* Draw-from-booking slide-over */}
      {docKind === 'order' && (
        <BookingDrawSheet
          open={bookingSheetOpen}
          onOpenChange={setBookingSheetOpen}
          customerName={customer}
          bookings={activeBookings}
          lookups={lookups}
          bagWeights={special?.bagWeights ?? []}
          logos={special?.logos ?? []}
          alreadyQueued={alreadyQueuedForBooking}
          onAdd={addBookingLines}
        />
      )}
    </div>
  );
}

/** Gear-button popover: reorder/enable the Tab sequence + view keyboard shortcuts. */
function SettingsPanel({
  tabOrder,
  setTabOrder,
}: {
  tabOrder: TabEntry[];
  setTabOrder: Dispatch<SetStateAction<TabEntry[]>>;
}) {
  const SHORTCUTS: { label: string; keys: string[] }[] = [
    { label: 'Add item', keys: ['Alt', 'A'] },
    { label: 'Save / Create order', keys: ['Ctrl', 'S'] },
    { label: 'Create quotation', keys: ['Alt', 'Q'] },
    { label: 'Focus Item name', keys: ['Alt', 'I'] },
    { label: 'Cancel', keys: ['Esc'] },
  ];

  const move = (index: number, dir: -1 | 1) =>
    setTabOrder((list) => {
      const j = index + dir;
      if (j < 0 || j >= list.length) return list;
      const copy = list.slice();
      [copy[index], copy[j]] = [copy[j], copy[index]];
      return copy;
    });
  const toggle = (key: string, enabled: boolean) =>
    setTabOrder((list) => list.map((t) => (t.key === key ? { ...t, enabled } : t)));

  // Running 1..N number shown only on the fields that are actually in the sequence.
  let pos = 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Keyboard & tab settings" title="Keyboard & tab settings">
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <div>
            <h4 className="flex items-center gap-1.5 text-sm font-semibold">
              <Keyboard className="size-4" /> Keyboard & Tab
            </h4>
            <p className="text-muted-foreground text-xs">
              Reorder the <Kbd>Tab</Kbd> sequence with the arrows, and toggle which fields it stops on.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Tab order</span>
              <button
                type="button"
                onClick={() => setTabOrder(defaultTabOrder())}
                className="text-primary hover:bg-accent flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium transition-colors"
              >
                <RotateCcw className="size-3" /> Reset
              </button>
            </div>
            <div className="max-h-60 divide-y overflow-auto rounded-md border">
              {tabOrder.map((t, i) => {
                if (t.enabled) pos += 1;
                return (
                  <div key={t.key} className="hover:bg-muted/50 flex items-center gap-2 px-2 py-1">
                    <span className="text-muted-foreground w-4 text-right text-xs tabular-nums">{t.enabled ? pos : '·'}</span>
                    <div className="flex flex-col">
                      <button
                        type="button"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        aria-label="Move up"
                        className="text-muted-foreground hover:text-foreground disabled:opacity-25"
                      >
                        <ChevronUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={i === tabOrder.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label="Move down"
                        className="text-muted-foreground hover:text-foreground disabled:opacity-25"
                      >
                        <ChevronDown className="size-3.5" />
                      </button>
                    </div>
                    <span className={cn('flex-1 text-sm', !t.enabled && 'text-muted-foreground/60 line-through')}>
                      {FIELD_LABEL[t.key]}
                    </span>
                    <Switch checked={t.enabled} onCheckedChange={(v) => toggle(t.key, v)} />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Shortcuts</span>
            <div className="space-y-1">
              {SHORTCUTS.map((s) => (
                <div key={s.label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="flex items-center gap-0.5">
                    {s.keys.map((k, i) => (
                      <span key={k} className="flex items-center gap-0.5">
                        {i > 0 && <span className="text-muted-foreground text-[10px]">+</span>}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default OrderFormPage;
