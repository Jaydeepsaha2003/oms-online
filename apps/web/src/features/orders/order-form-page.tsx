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
import { ArrowLeft, ArrowRightLeft, BadgePercent, Brush, Camera, Check, type LucideIcon, ChevronDown, ChevronUp, FilePen, FileText, History, Keyboard, Loader2, Lock, PackageOpen, Package, Pencil, Pin, Plus, RotateCcw, Save, Settings2, Trash2, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { ALL_PERMISSIONS, ORDER_PRIORITIES, RESOURCES, resolveSpecialRates, qtyOrderForCategory, type OrderInput, type QtyField } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAutoSizePcs } from '@/lib/auto-size-pcs';
import { usePermissions } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/common/confirm';
import { RecordHistory } from '@/components/common/record-history';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { NativeSelect } from '@/components/common/combo';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { settingValues, useOrderQtyLayout, useSettings } from '@/features/settings/use-settings';
import { useCustomerSpecialRates } from '@/features/special-rates/use-special-rates';
import { useCreateOrder, useOrder, useOrderLookups, useUpdateOrder } from './use-orders';
import { useDraftPhotoCheck, useFulfillOrder } from '../dispatch/use-dispatch';
import { useConvertQuotation, useCreateQuotation, useQuotation, useUpdateQuotation } from '../quotations/use-quotations';
import { clearOrderDraft, loadOrderDraft, saveOrderDraft } from './order-draft';
import { DraftLinePhotos, toPhotoInput, type LinePhoto } from './line-photos';
import { useActiveCustomerBookings } from '@/features/bookings/use-bookings';
import { BookingDrawSheet, type DrawnBookingLine } from './booking-draw-sheet';
import { DesignNamePicker, resolveDesignNameChoices } from './design-name-picker';

/**
 * State a caller can navigate in with to pre-fill the form — mirrors the same
 * pattern challan-form-page.tsx uses. Today the only source is Bag Bookings'
 * "Convert" action: land on New Order with the customer already picked and the
 * booking-draw sheet ready to open, instead of the older standalone convert page.
 */
type NavState = {
  customerName?: string;
  openBookingDraw?: boolean;
  /**
   * Where Back should go, when it is not the list.
   *
   * Order Modify sends this with its own filters in the query string, because
   * "back" from a line you opened there means that grid as you left it — not the
   * View Orders list, which is a different screen you were never on.
   */
  backTo?: string;
};

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
  photos?: LinePhoto[]; // reference images attached to this line
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
  // Explicit so the reset after each add visibly clears the entry row's photos —
  // they belong to the line just added, not to the next one.
  photos: [],
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
/**
 * A line's rate, with the product + design split behind a hover.
 *
 * `title` rather than a JS tooltip: this sits inside a table that can run to
 * dozens of rows, and the native one costs nothing per row, works on keyboard
 * focus, and cannot be clipped by the table's own overflow — which a positioned
 * tooltip in a horizontally scrolling grid regularly is.
 */
type RateBreakdownItem = Pick<
  Item,
  'productRate' | 'designRate' | 'designType' | 'designName' | 'special' | 'bookingCode' | 'bookingId' | 'calField'
>;

/** One line of the breakdown card: a coloured dot, a label, and the money. */
function RateLine({
  icon: Icon,
  label,
  sub,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  sub?: string | null;
  value: string;
  accent: 'blue' | 'violet';
}) {
  const tone =
    accent === 'blue'
      ? 'bg-blue-50 text-blue-700 ring-blue-200/70 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-900'
      : 'bg-violet-50 text-violet-700 ring-violet-200/70 dark:bg-violet-950/50 dark:text-violet-300 dark:ring-violet-900';
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn('grid size-7 shrink-0 place-items-center rounded-[6px] ring-1', tone)}>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] leading-tight font-semibold">{label}</p>
        {sub && <p className="text-muted-foreground truncate text-[10.5px] leading-tight">{sub}</p>}
      </div>
      <span className="shrink-0 text-[13px] font-bold tabular-nums">{value}</span>
    </div>
  );
}

/**
 * A line's rate, with the product + design split behind a hover card.
 *
 * Hover AND click, both: hover is what a mouse user discovers, and a tap is the
 * only thing a phone can do — a hover-only card is invisible on the device where
 * this table is hardest to read. A click PINS the card open (so the figures can
 * be read without holding the mouse still, and so touch works at all); moving
 * the mouse away only closes what hover opened.
 *
 * Radix portals the card to the body, so the surrounding table's horizontal
 * scroll cannot clip it — the reason this is a popover and not an absolutely
 * positioned div inside the cell.
 */
function RateBreakdown({ item }: { item: RateBreakdownItem }) {
  const prod = n(item.productRate) ?? 0;
  const dsgn = n(item.designRate) ?? 0;
  const total = prod + dsgn;
  const inr = (v: number) => `₹${v.toLocaleString('en-IN')}`;
  // A line with no design rate still opens — "no design rate on this line" is
  // itself the answer to "why is this 350?" — but only a line that HAS a split
  // gets the dotted underline, so the hint means something when you see it.
  const hasSplit = dsgn !== 0;
  const perUnit = item.calField === 'PCS' ? 'per piece' : 'per kg';

  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;

  /*
   * Unpinning clears hover as well, or the mouse still sitting on the number
   * would hold the card open and the second click would look like it did
   * nothing. Moving away and back re-opens it on hover as usual.
   *
   * Two plain setStates, NOT a setHovered inside a setPinned updater: an updater
   * must be pure, and React drops the nested update — which silently broke the
   * click entirely.
   */
  const toggle = () => {
    if (pinned) setHovered(false);
    setPinned(!pinned);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        // Escape and outside-click come through here; both mean "gone", so they
        // have to clear the hover flag as well or the card would spring back.
        if (!o) {
          setPinned(false);
          setHovered(false);
        }
      }}
    >
      {/*
        * Anchor, not Trigger, deliberately.
        *
        * Trigger toggles the popover on click all by itself, which fought the
        * `pinned` state: a click while hover had it open told Radix to close and
        * this component to pin, and the two cancelled out. Anchor only positions.
        */}
      <PopoverAnchor asChild>
        <span
          role="button"
          tabIndex={0}
          aria-expanded={open}
          aria-label={`Rate ${total.toLocaleString('en-IN')} — show breakdown`}
          onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setHovered(false)}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          }}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
          className={cn(
            'cursor-pointer rounded-[4px] px-1 outline-none transition-colors',
            'hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-sky-400 dark:hover:bg-sky-950/40',
            open && 'bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
            hasSplit && 'underline decoration-dotted decoration-sky-400 underline-offset-[3px]',
          )}
        >
          {total.toLocaleString('en-IN')}
        </span>
      </PopoverAnchor>

      <PopoverContent
        side="left"
        align="center"
        sideOffset={8}
        // Hover must not steal focus from the cell the user is typing in, and a
        // hovering card must not swallow the pointer either — otherwise moving
        // the mouse one pixel further would close it by leaving the trigger.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className={cn(
          'w-64 overflow-hidden rounded-[10px] border-0 p-0 shadow-xl',
          'ring-1 ring-slate-900/10 dark:ring-white/10',
          !pinned && 'pointer-events-none',
        )}
      >
        {/* Header: the answer first, in the brand gradient — the card is read
            top-down, and the total is what the eye came for. */}
        <div className="bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 px-3 py-2 text-white">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[10px] font-bold tracking-[0.14em] uppercase opacity-80">Rate breakdown</p>
            <p className="text-[9.5px] font-semibold opacity-80">{perUnit}</p>
          </div>
          <p className="text-[19px] leading-tight font-bold tabular-nums">{inr(total)}</p>
        </div>

        <div className="bg-card space-y-2 px-3 py-2.5">
          <RateLine icon={Package} label="Product rate" value={inr(prod)} accent="blue" />
          {hasSplit ? (
            <RateLine
              icon={Brush}
              label="Design rate"
              sub={item.designName || item.designType || null}
              value={inr(dsgn)}
              accent="violet"
            />
          ) : (
            <p className="text-muted-foreground rounded-[6px] border border-dashed px-2 py-1.5 text-[10.5px] leading-snug">
              No design rate on this line — the rate is the product rate alone.
            </p>
          )}

          {/* The sum, spelled out. The point of the card is that 350 + 15 = 365
              is checkable; showing only the parts leaves the reader to add up. */}
          {hasSplit && (
            <div className="flex items-center justify-between gap-2 border-t border-dashed pt-2">
              <p className="text-muted-foreground text-[10.5px] font-semibold">
                {inr(prod)} + {inr(dsgn)}
              </p>
              <p className="text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{inr(total)}</p>
            </div>
          )}

          {/* Why the rate is what it is, when there is a reason beyond the chart. */}
          {(item.special || item.bookingId) && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {item.special && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  <BadgePercent className="size-3" /> Special rate
                </span>
              )}
              {item.bookingId && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                  <PackageOpen className="size-3" /> {item.bookingCode ?? 'Booking'} · rate frozen
                </span>
              )}
            </div>
          )}
          {item.special && <p className="text-muted-foreground text-[10px] leading-snug">{item.special}</p>}
        </div>

        <div className="text-muted-foreground flex items-center gap-1 border-t bg-slate-50 px-3 py-1.5 text-[9.5px] dark:bg-slate-900/50">
          <Pin className={cn('size-2.5', pinned && 'text-sky-600')} />
          {pinned ? 'Pinned — click the rate again to close' : 'Click the rate to keep this open'}
        </div>
      </PopoverContent>
    </Popover>
  );
}

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

/** Render a 'YYYY-MM-DD' string the same way the DatePicker field shows it (dd/mm/yyyy). */
const niceDate = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d)}/${pad(m)}/${y}`;
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
// The four quantity fields' data-tabfield keys (Kgs uses 'gram'), in the fixed
// default order. Tab walks these in the picked category's configured LAYOUT order
// instead (see qtyTabOrderRef) so it stays serial with how they're displayed.
const QTY_TABKEYS = ['bags', 'pcs', 'gram', 'box'];
const qtyFieldToTabKey = (f: QtyField): string => (f === 'kgs' ? 'gram' : f);
const TAB_PREF_KEY = 'oms:order-tab-order';
// Saved "rows to show in the item panel" preference (0 = show all).
// v2: reset everyone to the "All rows" default — the old key had many users
// stuck on a small cap that hid their added items.
const ROWS_PREF_KEY = 'oms:order-rows-to-show:v2';
const ROWS_OPTIONS = [0, 5, 8, 10, 15, 20];
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
/** A control the user can actually Tab into right now: not disabled, not removed
 *  from the tab order, and not visually hidden (offsetParent is null for
 *  display:none subtrees). */
const isTabbable = (el: HTMLElement) =>
  !(el as HTMLInputElement).disabled && el.tabIndex !== -1 && el.offsetParent !== null;
/** The tabbable controls inside a field wrapper, in DOM order. */
const fieldControls = (root: HTMLElement | null, key: string): HTMLElement[] => {
  const wrap = root?.querySelector<HTMLElement>(`[data-tabfield="${key}"]`);
  if (!wrap) return [];
  return [...wrap.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isTabbable);
};
/** Focus a field's first usable control; returns false when it has none (so the
 *  caller can skip to the next field instead of the Tab silently dying). */
const focusField = (root: HTMLElement | null, key: string): boolean => {
  const el = fieldControls(root, key)[0];
  if (!el) return false;
  el.focus();
  return true;
};

function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn('bg-muted text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded border px-1.5 font-mono text-[10px] font-semibold', className)}>
      {children}
    </kbd>
  );
}

export function OrderFormPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const { can, permissions } = usePermissions();
  const isSuperAdmin = permissions.includes(ALL_PERMISSIONS);
  const params = useParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const isEdit = id != null;
  // The same form drives both orders and quotations. The route decides which
  // document we're editing; on /orders/new the user picks via the two buttons.
  const docKind: 'order' | 'quotation' = location.pathname.startsWith('/quotations') ? 'quotation' : 'order';
  const listPath = docKind === 'quotation' ? '/quotations' : '/orders';
  const docLabel = docKind === 'quotation' ? 'quotation' : 'order';
  const navState = (location.state ?? null) as NavState | null;
  /** Only a path within the app is honoured — a `backTo` is navigation state, and
   *  state is not somewhere to take an absolute URL from on trust. */
  const backPath = navState?.backTo?.startsWith('/') ? navState.backTo : listPath;
  const [saved, setSaved] = useState(false); // shows the success-tick overlay
  const [savePrompt, setSavePrompt] = useState(false); // new-order "Save & PDF / Save only" choice

  const { data: lookups } = useOrderLookups();
  const { data: settings } = useSettings();
  const { data: qtyLayout } = useOrderQtyLayout();
  const orderQuery = useOrder(docKind === 'order' ? id : undefined);
  const quotationQuery = useQuotation(docKind === 'quotation' ? id : undefined);
  const existing = docKind === 'quotation' ? quotationQuery.data : orderQuery.data;
  const isLoading = docKind === 'quotation' ? quotationQuery.isLoading : orderQuery.isLoading;
  /** Completion date is frozen once anything has shipped — super admin excepted.
   *  Quotations never dispatch, so this only ever applies to a saved order. */
  const completionLocked =
    isEdit &&
    docKind === 'order' &&
    !isSuperAdmin &&
    (orderQuery.data?.items ?? []).some((it) => it.dispatched);
  const create = useCreateOrder();
  const update = useUpdateOrder(id ?? 0);
  const createQuotation = useCreateQuotation();
  const updateQuotation = useUpdateQuotation(id ?? 0);
  const convertQuotation = useConvertQuotation();
  const fulfillOrder = useFulfillOrder();
  const saving =
    create.isPending ||
    update.isPending ||
    createQuotation.isPending ||
    updateQuotation.isPending ||
    convertQuotation.isPending ||
    fulfillOrder.isPending;
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
  // Live qty-field tab order = the picked category's layout order (Settings → Order
  // quantity fields). Updated each render once `entry` exists; read by handleTabNav
  // so Tab walks Bags/Box/Pcs/Kgs in the SAME order they're laid out.
  const qtyTabOrderRef = useRef<string[]>([...QTY_TABKEYS]);

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
    const key = wrap.getAttribute('data-tabfield') ?? '';
    const step = e.shiftKey ? -1 : 1;

    // A field can hold several controls (e.g. the Box input + its "fill boxes"
    // tick). Let natural Tab walk between them before we jump to the next field.
    const within = fieldControls(root, key);
    const pos = within.indexOf(e.target as HTMLElement);
    if (pos !== -1 && pos + step >= 0 && pos + step < within.length) return;

    // Re-sequence the qty slots (Bags/Pcs/Kgs/Box) into the category layout order
    // so Tab is serial with the displayed order; everything else keeps its place.
    const orderedQty = qtyTabOrderRef.current.filter((k) => tabSequence.includes(k));
    let qi = 0;
    const seq = tabSequence.map((k) => (QTY_TABKEYS.includes(k) ? (orderedQty[qi++] ?? k) : k));

    const i = seq.indexOf(key);
    if (i === -1) return;
    // Advance to the next field that actually has a focusable control — skipping
    // ones that are disabled or hidden right now (so Tab never dead-ends).
    const advance = () => {
      for (let j = i + step; j >= 0 && j < seq.length; j += step) {
        if (focusField(root, seq[j])) return true;
      }
      return false;
    };

    // Leaving a field whose dropdown was open: that same keypress just committed
    // the highlighted option, and the pick reshapes the form — choosing an item
    // is what gives Design Name its choices, so until this render lands that
    // field is still disabled and "next focusable field" skips right past it to
    // Product ₹. Resolve after the DOM has caught up so Tab lands where the
    // finished form says it should.
    if ((e.target as HTMLElement).getAttribute('aria-expanded') === 'true') {
      e.preventDefault();
      requestAnimationFrame(advance);
      return;
    }
    // Nothing focusable ahead in the sequence — let natural Tab continue.
    if (advance()) e.preventDefault();
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
  // New orders default to confirmed; new quotations default to draft — they're
  // different status vocabularies (ORDER_STATUSES vs QUOTATION_STATUSES) and
  // must never cross over (a quotation showing "CONFIRMED" is meaningless).
  const [status, setStatus] = useState(docKind === 'quotation' ? 'DRAFT' : 'CONFIRMED');
  const [showBy, setShowBy] = useState<'PCS' | 'SIZE'>('SIZE');
  const { autoSizePcs } = useAutoSizePcs();

  // Item entry (the row being built) + the added items
  const [entry, setEntry] = useState(blankEntry());
  const [items, setItems] = useState<Item[]>([]);
  const [editingItemKey, setEditingItemKey] = useState<string | null>(null);

  // How many item rows to keep visible in the panel before it scrolls — a saved
  // per-user preference. 0 = show all (the panel grows and the page scrolls);
  // that's also the default until someone picks a smaller number themselves.
  const [rowsToShow, setRowsToShow] = useState<number>(() => {
    const stored = localStorage.getItem(ROWS_PREF_KEY);
    if (stored == null) return 0;
    const raw = Number(stored);
    return ROWS_OPTIONS.includes(raw) ? raw : 0;
  });
  useEffect(() => {
    try {
      localStorage.setItem(ROWS_PREF_KEY, String(rowsToShow));
    } catch {
      /* ignore */
    }
  }, [rowsToShow]);
  // Cap the grid's height to the chosen number of rows (row ≈ 2.5rem + header) —
  // capped again by the actual item count so a handful of lines doesn't leave a
  // tall blank strip reserved for rows that don't exist yet.
  const gridMaxHeight = rowsToShow === 0 ? undefined : `${Math.min(rowsToShow, Math.max(items.length, 1)) * 2.5 + 2.9}rem`;

  // Bag-booking draw-down: pull a customer's reserved bags into this order. The
  // button only shows when the customer actually has a drawable booking.
  const [bookingSheetOpen, setBookingSheetOpen] = useState(false);
  const { data: activeBookings = [] } = useActiveCustomerBookings(docKind === 'order' ? customer.trim() : '');
  // Arriving from Bag Bookings' "Convert" action: once the pre-filled customer's
  // bookings have actually loaded, open the sheet automatically instead of making
  // the user click "Draw from Bag Booking" themselves. Fires at most once — after
  // that the sheet is the user's own to open/close, e.g. via the button below.
  const autoOpenedBookingSheet = useRef(false);
  useEffect(() => {
    if (autoOpenedBookingSheet.current || !navState?.openBookingDraw) return;
    if (customer.trim() !== (navState.customerName ?? '').trim()) return; // wait for the pre-fill to land
    if (activeBookings.length === 0) return; // nothing to draw — leave it closed, no dead-end popup
    autoOpenedBookingSheet.current = true;
    setBookingSheetOpen(true);
  }, [navState?.openBookingDraw, navState?.customerName, customer, activeBookings.length]);
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
        // Carried from the draw sheet so editing a drawn line here still
        // cascades Pcs ⇄ Box ⇄ Kgs (editItem reloads the line into the entry row).
        weight: d.weight,
        pcsBox: d.pcsBox,
        ordType: entry.ordType,
        priority: d.priority || 'NORMAL',
        bags: d.bags,
        pcs: d.pcs,
        gram: d.gram,
        box: d.box,
        comment: d.comment,
        calField: d.calField,
        photos: [],
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
      setEditingItemKey(null);
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
          designName: it.design?.trim() || (it.designType ? (nameByCode.get(it.designType.toUpperCase()) ?? '') : ''),
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
          photos: (it.photos ?? []).map((ph) => ({
            id: ph.id,
            url: ph.url,
            path: ph.path,
            filename: ph.filename,
            mimeType: ph.mimeType,
            size: ph.size,
          })),
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
  // Skipped when a customer arrived via nav state (Bag Bookings' Convert): that's
  // a deliberate, specific navigation, and silently restoring an unrelated old
  // draft on top of the customer we just set would stomp it back out.
  const draftEnabled = !isEdit && docKind === 'order' && !navState?.customerName;
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
    setEditingItemKey(null);
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

  // Arriving from Bag Bookings' "Convert" action with a customer already chosen —
  // apply it the same way picking it from the dropdown would (agent/category
  // fill in too). Waits on `lookups` so that lookup actually succeeds; re-running
  // once it resolves is harmless since setting the same name again is a no-op.
  useEffect(() => {
    if (isEdit || docKind !== 'order' || !navState?.customerName || !lookups) return;
    onCustomer(navState.customerName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, docKind, navState?.customerName, lookups]);

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
    const options: { value: string; label: string; keywords: string }[] = [];
    for (const it of list) {
      if (isLogoDesign(it.designType) && logoBlocked(it.category, it.subCategory)) continue;
      const prefix = showBy === 'PCS' ? fmtNum(it.pcs) : fmtNum(it.size);
      const label = [prefix, it.product, it.designType ?? ''].filter(Boolean).join(' ');
      if (!label || map.has(label)) continue; // first wins on duplicate labels
      map.set(label, it);
      // Search-only tokens: BOTH size and pcs (whichever isn't the visible
      // prefix) plus the sub-category — so a Size-view row like "5.5 RAJWADI" is
      // still found by typing "15" (its pcs / "15-PCS" sub-category), and a
      // Pcs-view row is found by its size. Matches the user's Size/Pcs setting
      // for display while staying findable either way.
      const keywords = [fmtNum(it.size), fmtNum(it.pcs), it.subCategory ?? ''].filter(Boolean).join(' ');
      options.push({ value: label, label, keywords });
    }
    return { options, map };
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
    const t = text.trim();
    const lead = t.match(/^(\d+(?:\.\d+)?)/)?.[1];
    if (!lead) return;
    const SEP = /[\s(),+/-]+/;
    const list = lookups?.items ?? [];
    // Judge the leading number against ONLY the products whose name matches what's
    // typed after it — so "15 RAJWADI" is decided by RAJWADI's own sizes
    // (5.5/6.5/7) and pcs (15/12/10), NOT by the unrelated products that happen to
    // be a 15-inch size. That's what makes it flip to Pcs and show "15 RAJWADI".
    const nameTerms = t.slice(lead.length).trim().toLowerCase().split(SEP).filter(Boolean);
    const named = nameTerms.length
      ? list.filter((it) => {
          const words = `${it.product} ${it.designType ?? ''}`.toLowerCase().split(SEP).filter(Boolean);
          return nameTerms.every((q) => words.some((w) => w.startsWith(q)));
        })
      : list;
    const pool = named.length ? named : list;
    const some = (key: 'size' | 'pcs', test: (v: string) => boolean) => pool.some((it) => it[key] != null && test(String(it[key])));
    const sizeExact = some('size', (v) => v === lead);
    const pcsExact = some('pcs', (v) => v === lead);
    if (pcsExact && !sizeExact) return setShowBy('PCS');
    if (sizeExact && !pcsExact) return setShowBy('SIZE');
    if (sizeExact || pcsExact) return setShowBy('SIZE'); // both/ambiguous → Size
    // Mid-number: prefix match within the name-narrowed pool.
    const sizePre = some('size', (v) => v.startsWith(lead));
    const pcsPre = some('pcs', (v) => v.startsWith(lead));
    if (pcsPre && !sizePre) return setShowBy('PCS');
    if (sizePre) return setShowBy('SIZE');
  };

  // Keep the qty-field Tab order live with the picked category's layout, so Tab
  // walks Bags/Box/Pcs/Kgs in the same order they're displayed (read by handleTabNav).
  qtyTabOrderRef.current = qtyOrderForCategory(qtyLayout, entry.category).map(qtyFieldToTabKey);

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

  // Pcs ⇄ Box are linked by the product's pieces-per-box (pcsBox): typing Pcs fills
  // Box (= Pcs ÷ pcs-per-box) AND Kgs (= Pcs × weight). Fully dynamic — onBox does
  // the reverse. With no pcs-per-box on the product, Box is left untouched.
  const onPcs = (value: string) => {
    setEntry((e) => {
      const pcs = n(value) ?? 0;
      const w = n(e.weight);
      const per = n(e.pcsBox);
      const has = value.trim() !== '';
      const round2 = (x: number) => String(Math.round(x * 100) / 100);
      return {
        ...e,
        pcs: value,
        gram: w != null && has ? round2(pcs * w) : e.gram,
        box: per != null && per > 0 && has ? round2(pcs / per) : e.box,
      };
    });
  };

  // Box ⇄ Pcs reverse: typing Box fills Pcs (= Box × pcs-per-box) and cascades Kgs
  // (= Pcs × weight). e.g. a cup with 6 pcs-per-box: Box 32 → Pcs 192. With no
  // pcs-per-box, Box is just a plain number (nothing to derive).
  const onBox = (value: string) => {
    setEntry((e) => {
      const per = n(e.pcsBox);
      if (per == null || per <= 0) return { ...e, box: value };
      const box = n(value) ?? 0;
      const pcs = box * per;
      const w = n(e.weight);
      const has = value.trim() !== '';
      const round2 = (x: number) => String(Math.round(x * 100) / 100);
      return {
        ...e,
        box: value,
        pcs: has ? round2(pcs) : e.pcs,
        gram: w != null && has ? round2(pcs * w) : e.gram,
      };
    });
  };

  const designNameOptions = useMemo(
    () => resolveDesignNameChoices(lookups, entry.designType, entry.category, entry.subCategory),
    [lookups, entry.designType, entry.category, entry.subCategory],
  );

  // Picking names only changes the label; the code and summed rate come from the item.
  const onDesignName = (name: string) => setEntry((e) => ({ ...e, designName: name }));

  // The item's design code has no names in the master (or it has no design) → lock to "NA".
  const noDesignNames = designNameOptions.choices.length === 0;
  // Design rate is editable only when it is > 0 (per the legacy rule).
  const designRateEditable = (n(entry.designRate) ?? 0) > 0;

  const entryTotal = itemRate(entry);

  // Items can only be built once a customer is chosen (the special rates, bag
  // weights and category all key off the customer). Lock item entry until then.
  const noCustomer = !customer.trim();
  /*
   * The "pick a customer first" prompt waits until the user actually reaches for
   * the item area. Showing it the moment the form opens greeted everyone with a
   * warning before they had done anything wrong — it read as an error on a blank
   * form rather than guidance at the point of need. Once tripped it stays until a
   * customer is chosen, so it does not blink in and out while they look around.
   */
  const [triedItemEntry, setTriedItemEntry] = useState(false);
  const showCustomerPrompt = noCustomer && triedItemEntry;
  /** Attach to the item-entry area: any attempt to interact without a customer
   *  is what makes the prompt relevant. */
  const itemAreaGuard = {
    onFocusCapture: () => { if (noCustomer) setTriedItemEntry(true); },
    onPointerDownCapture: () => { if (noCustomer) setTriedItemEntry(true); },
  };

  // Per-category price-calc field (KGS/PCS), configured on the Products page.
  const categoryFieldMap = useMemo(() => {
    const m = new Map<string, 'KGS' | 'PCS'>();
    for (const cf of lookups?.categoryFields ?? []) m.set(cf.category.toUpperCase(), cf.field === 'PCS' ? 'PCS' : 'KGS');
    return m;
  }, [lookups]);

  const addItem = async () => {
    // A customer must be chosen before any item can be added to the order.
    if (!customer.trim()) {
      toast.error('Please select a customer first');
      requestAnimationFrame(() => focusField(formRef.current, 'customer'));
      return;
    }
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
    // Same rule as Order Modify: an empty (and disabled) name picker means the
    // user chose nothing, so don't write 'NA' over a value the line already had.
    // On imported lines this field carries the design TYPE ("WL+TOOL"), and
    // losing it unlinks the line from Design Track and the photo rules.
    const designName = noDesignNames ? entry.designName.trim() || 'NA' : entry.designName;
    // Duplicate guard: same item + design name already on the list → confirm.
    const dupIdx = items.findIndex(
      (i) =>
        i.key !== editingItemKey &&
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
    const wasEditing = editingItemKey != null;
    const completed: Item = {
      ...entry,
      key: editingItemKey ?? `i${keyer.current++}`,
      calField,
      designName,
      photos: entry.photos ?? [],
    };
    setItems((its) =>
      editingItemKey
        ? its.map((item) => (item.key === editingItemKey ? completed : item))
        : [...its, completed],
    );
    setEditingItemKey(null);
    // Reset the item fields but keep order type / priority for the next line.
    setEntry((e) => ({ ...blankEntry(), ordType: e.ordType, priority: e.priority }));
    // Return focus to Item name so the next line can be entered immediately.
    requestAnimationFrame(() => focusField(formRef.current, 'itemName'));
    if (wasEditing) toast.success('Item updated');
  };

  const cancelItemEdit = () => {
    setEditingItemKey(null);
    setEntry((e) => ({ ...blankEntry(), ordType: e.ordType, priority: e.priority }));
  };

  const removeItem = (key: string) => {
    setItems((its) => its.filter((i) => i.key !== key));
    if (editingItemKey === key) cancelItemEdit();
  };

  // Keep the original row in the list while its values are edited above. This
  // preserves a safe copy and prevents a second edit from overwriting the first.
  // For an ORDER, saved lines are not editable here (their id carries dispatch
  // history — Order Modify owns that), and booking-drawn lines are rate-frozen.
  // A QUOTATION's saved lines have neither concern: the server replaces its
  // items wholesale on save, so they stay editable right up to conversion.
  const lineLocked = (item: Item) => (docKind === 'order' && item.id != null) || item.bookingId != null;
  const editItem = (item: Item) => {
    if (lineLocked(item)) return;
    if (editingItemKey != null) {
      toast.info('Finish or cancel the current item edit first.');
      return;
    }
    const { key, ...rest } = item;
    setEditingItemKey(key);
    setEntry(rest);
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[data-tabfield="itemName"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      focusField(formRef.current, 'itemName');
    });
    toast.info('Editing item — change the fields above, then tap Update.');
  };

  /**
   * Reference-photo status per line, for "Create & Dispatch".
   *
   * That button creates the order AND ships every line immediately, so the
   * photo rule the Dispatch screen enforces has to be answered HERE — once the
   * lines are dispatched it's too late to ask. Plain Create/Save is untouched:
   * an order on its own promises nothing about what shipped, and demanding a
   * photo just to write one down would block the everyday case.
   *
   * The size is the leading number of the composite item name ("12 MIRROR DL"),
   * which is how that name is built in the first place.
   */
  const photoLines = useMemo(
    () =>
      items
        .filter((i) => i.product.trim())
        .map((i) => ({
          key: i.key,
          product: i.product.trim(),
          psize: (() => {
            const n = Number(/^\s*([\d.]+)/.exec(i.itemName)?.[1]);
            return Number.isFinite(n) ? n : null;
          })(),
          designType: i.designType.trim() || null,
          design: i.designName.trim() || null,
        })),
    [items],
  );
  const canDispatch = !isEdit && docKind === 'order' && can('dispatch:create');
  const { data: photoStatus } = useDraftPhotoCheck({ customerId: customerId ?? null, lines: photoLines }, canDispatch);

  /** Lines that would ship undocumented: the rule applies, nothing on file from
   *  an earlier dispatch, and nothing attached here either. */
  const missingPhotoKeys = useMemo(() => {
    if (!photoStatus) return new Set<string>();
    const attached = new Map(items.map((i) => [i.key, (i.photos ?? []).length > 0]));
    return new Set(
      Object.entries(photoStatus)
        .filter(([key, st]) => st.needsPhoto && !st.hasPhoto && !attached.get(key))
        .map(([key]) => key),
    );
  }, [photoStatus, items]);

  /** What the camera button for a line should say — undefined when this form
   *  can't dispatch, so nothing changes for plain order entry. */
  const photoStatusFor = (key: string) =>
    canDispatch ? { required: missingPhotoKeys.has(key), onFile: photoStatus?.[key]?.sampleUrl ?? null } : undefined;

  const setItemPhotos = (key: string, photos: LinePhoto[]) =>
    setItems((its) => its.map((i) => (i.key === key ? { ...i, photos } : i)));

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
          // No rate total: Rate is ₹ PER UNIT, so adding the column produces a
          // number that means nothing — eight lines at 430/460 summed to 3,560,
          // which reads like a figure but is not a price of anything. Amount is
          // the column that legitimately adds up.
          amount: a.amount + lineAmount(i),
        }),
        { bags: 0, pcs: 0, gram: 0, box: 0, amount: 0 },
      ),
    [items],
  );

  // Quick success tick, then navigate. The order is saved now, so drop the WIP draft.
  const finishTo = (dest: string) => {
    clearOrderDraft();
    setSaved(true);
    window.setTimeout(() => navigate(dest), 950);
  };

  // "Save only": after the tick, clear the form back to a blank new order and stay
  // here — ready for the next entry — instead of leaving for the bill/list page.
  const finishToNewForm = () => {
    clearOrderDraft();
    setRestoredDraft(false);
    setSaved(true);
    window.setTimeout(() => {
      blankForm();
      setSaved(false);
      requestAnimationFrame(() => focusField(formRef.current, 'customer'));
    }, 950);
  };

  const validate = (forDraft = false): boolean => {
    if (!customer.trim()) return !toast.error('Please select a correct customer');
    if (!forDraft && !completionDay.trim()) return !toast.error('Please Select the Completion Day');
    if (items.length === 0) return !toast.error('There are no items to save.');
    if (editingItemKey != null) return !toast.error('Finish or cancel the current item edit before saving.');
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
      design: i.designName.trim() || 'NA',
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
      // Photos only apply to orders (quotation lines have none) — sending the full
      // set (existing by id + new uploads) lets the server sync additions/removals.
      ...(docKind === 'order' && i.photos !== undefined ? { photos: toPhotoInput(i.photos) } : {}),
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
      confirmText: isEdit ? 'Update changes' : `Create ${noun}`,
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
      // Saving the *order* form as a quotation: `input.status` is an ORDER status
      // ("CONFIRMED"), which the quotation API rejects. A new quotation starts as DRAFT.
      // After creating, jump to the printable page so it can be downloaded right
      // away. Back from there returns to this New Order form (browser history).
      createQuotation.mutate({ ...input, status: 'DRAFT' }, {
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
      confirmText: isEdit ? (isDraft ? 'Save draft' : 'Update & save') : isDraft ? 'Save draft' : 'Create order',
    });
    if (!ok) return;
    const input = { ...buildInput(await resolveOrderDate()), status: statusValue };
    const onError = (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed'));
    const done = (orderId?: number) =>
      finishTo(redirectToBill && orderId && can('order:print') ? `/orders/${orderId}/bill` : '/orders');
    if (isEdit) update.mutate(input, { onSuccess: () => done(), onError });
    else create.mutate(input, { onSuccess: (o) => done(o.id), onError });
  };

  // Create a brand-new CONFIRMED order, then either open its printable bill
  // ("Save & PDF") or reset the form for the next entry ("Save only"). Called from
  // the two buttons in the save-choice dialog (which is itself the confirmation).
  const runNewOrder = async (redirectToBill: boolean) => {
    setSavePrompt(false);
    const input = { ...buildInput(await resolveOrderDate()), status: 'CONFIRMED' };
    create.mutate(input, {
      onSuccess: (o) => {
        if (redirectToBill && can('order:print')) finishTo(`/orders/${o.id}/bill`);
        else finishToNewForm();
      },
      onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
    });
  };

  // Create & Dispatch (Alt+D): take the order AND ship every line in full in one
  // step. Creates the CONFIRMED order, then fully dispatches all its lines, then
  // clears the form for the next entry. New orders only; needs dispatch:create.
  const createAndDispatch = async () => {
    if (isEdit || docKind !== 'order' || !can('dispatch:create')) return;
    if (!validate()) return;
    // Dispatching is what triggers the photo rule — see photoLines above. Block
    // before the confirm, not after: the order must not be created either, or
    // the user is left with a half-done job they didn't ask for.
    if (missingPhotoKeys.size) {
      const names = items
        .filter((i) => missingPhotoKeys.has(i.key))
        .map((i) => i.itemName.trim() || i.product.trim())
        .filter(Boolean);
      toast.error(
        `Reference photo required before dispatching: ${names.join(', ')}. Add a photo on ${names.length === 1 ? 'that line' : 'those lines'} (red camera), or use Save without dispatching.`,
        { duration: 8000 },
      );
      return;
    }
    const ok = await confirm({
      title: 'Create & fully dispatch this order?',
      description: `${items.length} item${items.length === 1 ? '' : 's'} · total ₹${total.toLocaleString('en-IN')} for ${customer.trim()}. The order is created and every line is dispatched in full right away.`,
      confirmText: 'Create & Dispatch',
    });
    if (!ok) return;
    const input = { ...buildInput(await resolveOrderDate()), status: 'CONFIRMED' };
    create.mutate(input, {
      onSuccess: (o) =>
        fulfillOrder.mutate(o.id, {
          onSuccess: (res) => {
            toast.success(`Order created · ${res.dispatched} line${res.dispatched === 1 ? '' : 's'} dispatched in full`);
            finishToNewForm();
          },
          // The order saved but the bulk dispatch failed — don't lose it; send the
          // user to the order so they can dispatch the lines manually.
          onError: (e) => {
            toast.error(getApiErrorMessage(e, 'Order saved, but dispatch failed — dispatch it manually.'));
            finishTo(can('order:print') ? `/orders/${o.id}/bill` : '/orders');
          },
        }),
      onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
    });
  };

  // The primary action (Ctrl+S / main button). Quotations go through persist();
  // editing keeps its single-confirm save. A brand-new order asks how to finish —
  // "Save & PDF" (open the bill) or "Save only" (blank the form) — Vyapar-style.
  const submit = () => {
    if (docKind === 'quotation') return persist('quotation');
    if (isEdit) return saveOrder(status === 'DRAFT' ? 'CONFIRMED' : status, false);
    // Users who can't print a bill have nothing to preview — save straight away.
    if (!can('order:print')) return saveOrder('CONFIRMED', false);
    if (!validate()) return;
    setSavePrompt(true);
  };

  const orderIsDraft = docKind === 'order' && status === 'DRAFT';
  const primaryLabel = isEdit ? (orderIsDraft ? 'Update & save' : 'Update changes') : `Create ${docLabel}`;
  // Offer "Save as Draft" on a new order, or when editing one that's still a draft.
  const showSaveDraft = docKind === 'order' && (!isEdit || orderIsDraft);

  // ── Leave-without-saving guard (new order/quotation only) ────────────────
  // Editing an existing document already has a customer + items the moment it
  // loads, so this can't reuse that same "has content" check without prompting
  // on every single edit visit — it's scoped to brand-new documents, where any
  // content at all is genuinely unsaved work.
  const [exitPrompt, setExitPrompt] = useState<string | null>(null);
  const hasUnsavedNewContent = !isEdit && (customer.trim() !== '' || items.length > 0);

  /** Every in-page "leave" affordance funnels through here so a half-built new
   *  order/quotation isn't silently discarded — offers to save it first. */
  const confirmExit = (dest: string) => {
    if (!hasUnsavedNewContent) {
      navigate(dest);
      return;
    }
    setExitPrompt(dest);
  };

  // Tab close / hard reload — the in-app dialog above can't catch this, so warn
  // via the browser's own native prompt instead (same pattern as the Tally
  // Reconciliation page's upload guard).
  useEffect(() => {
    if (!hasUnsavedNewContent) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedNewContent]);

  // Keep the latest action handlers in a ref so the global shortcut listener
  // (bound once) always calls the current closures.
  const actionsRef = useRef<{ add: () => void; save: () => void; quote: () => void; dispatch: () => void; cancel: () => void; focusItem: () => void } | null>(null);
  actionsRef.current = {
    add: addItem,
    save: submit,
    // Create-as-quotation — only on a brand-new order form.
    quote: () => {
      if (!isEdit && docKind === 'order') persist('quotation');
    },
    dispatch: createAndDispatch,
    cancel: () => confirmExit(backPath),
    focusItem: () => formRef.current?.querySelector<HTMLElement>('[data-tabfield="itemName"] input')?.focus(),
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actionsRef.current;
      if (!a) return;
      const k = e.key.toLowerCase();
      // Shift-held Alt combos belong to the global Alt+Shift menu nav — ignore them here.
      const alt = e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey;
      if ((e.ctrlKey || e.metaKey) && k === 's') {
        e.preventDefault();
        a.save();
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && k === 'a') {
        // Ctrl+A adds the item, alongside Alt+A. This DELIBERATELY takes over the
        // browser's select-all on this page: the whole point is to add without
        // leaving the keyboard, and your hands are normally still inside a field
        // when you want it — a handler that backed off inside inputs would never
        // fire where it is actually needed.
        e.preventDefault();
        a.add();
      } else if (alt && k === 'a') {
        e.preventDefault();
        a.add();
      } else if (alt && k === 'q') {
        e.preventDefault();
        a.quote();
      } else if (alt && k === 'd') {
        e.preventDefault();
        a.dispatch();
      } else if (alt && k === 'i') {
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
    /*
     * The light field edge this form used to opt into via `data-soft-fields` is
     * now the app-wide default — see "One edge on every field" in index.css. The
     * wrapper is gone rather than left as a no-op, so there is one place that
     * decides what a field looks like.
     */
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

      {/* New-order save choice — "Save & PDF" opens the printable bill, "Save only"
          just saves and clears the form for the next entry. */}
      <Dialog open={savePrompt} onOpenChange={setSavePrompt}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create this order?</DialogTitle>
            <DialogDescription>
              {items.length} item{items.length === 1 ? '' : 's'} · total ₹{total.toLocaleString('en-IN')} for{' '}
              {customer.trim() || '—'}. Choose how to finish.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setSavePrompt(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => runNewOrder(false)} disabled={saving}>
              <Save /> Save only
            </Button>
            <Button onClick={() => runNewOrder(true)} disabled={saving}>
              <FileText /> Save &amp; PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leaving a new, unsaved order/quotation — offer to save it as a draft
          instead of silently discarding whatever was typed/added so far. */}
      <Dialog open={!!exitPrompt} onOpenChange={(o) => !o && setExitPrompt(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>
              {items.length} item{items.length === 1 ? '' : 's'}
              {customer.trim() ? ` for ${customer.trim()}` : ''} {items.length === 1 ? "hasn't" : "haven't"} been saved yet.
              {docKind === 'order' ? ' You can save it as a draft and pick it up later.' : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setExitPrompt(null)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const dest = exitPrompt!;
                clearOrderDraft();
                setExitPrompt(null);
                navigate(dest);
              }}
            >
              Discard &amp; leave
            </Button>
            <Button
              onClick={() => {
                setExitPrompt(null);
                if (docKind === 'quotation') void persist('quotation');
                else void saveOrder('DRAFT', false);
              }}
              disabled={saving}
            >
              <FilePen /> Save as draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Slim toolbar — the page title already shows in the top bar, so the big
          in-page heading is dropped to avoid a duplicate title and free up space. */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => confirmExit(backPath)} aria-label="Back" title="Back">
          <ArrowLeft />
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {isEdit && existing?.code && (
            <span className="rounded-lg border bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">
              {existing.code}
            </span>
          )}
          {isEdit && id && (
            <RecordHistory
              resource={docKind === 'quotation' ? RESOURCES.QUOTATION : RESOURCES.ORDER}
              resourceId={id}
              label={existing?.code}
            />
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

      {/* Card 1 — order header. Fits all 7 fields on one row at full desktop width
          (lg, ≥1024px); on a narrower/unmaximized desktop window (sm, ≥640px) it
          settles into a clean two-row split (4 + 3) instead of the old lopsided
          wrap. `min-w-0` on every cell lets the field shrink to its grid track
          instead of overflowing past it. */}
      <Card className="border-l-4 border-l-primary py-0">
        <CardContent className="grid grid-cols-2 gap-2 px-3 py-2 sm:grid-cols-4 sm:px-4 sm:py-3 lg:grid-cols-8">
          <div className="col-span-2 min-w-0 space-y-1.5 sm:col-span-2 lg:col-span-2" data-tabfield="customer">
            <Label className="text-base">Customer <span className="text-rose-500">*</span></Label>
            <NativeSelect
              value={customer}
              onChange={onCustomer}
              options={(lookups?.customers ?? []).map((c) => c.name)}
              placeholder="Select…"
              onInvalidEntry={() => toast.error('Please select a correct customer')}
            />
          </div>
          <div className="min-w-0 space-y-1.5" data-tabfield="poNumber">
            <Label className="text-base whitespace-nowrap">PO Number</Label>
            <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO number…" />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label className="text-base">Agent (auto)</Label>
            <Input value={agentName} readOnly tabIndex={-1} className="border-indigo-200/70 bg-indigo-50/60 font-medium text-indigo-700" />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label className="text-base whitespace-nowrap">Category (auto)</Label>
            <Input value={category} readOnly tabIndex={-1} className="border-indigo-200/70 bg-indigo-50/60 font-medium text-indigo-700" />
          </div>
          <div className="min-w-0 space-y-1.5" data-tabfield="orderDate">
            <Label className="text-base">Order date <span className="text-rose-500">*</span></Label>
            <DatePicker value={orderDate} onChange={setOrderDate} clearable={false} />
          </div>
          {/* Once anything on this order has shipped, its completion date is the
              yardstick Pending Dispatch and the party ledger age everything
              against — so only a System Administrator may move it. The server
              enforces this too; this only saves the user a failed save. */}
          <div
            className="min-w-0 space-y-1.5"
            data-tabfield="completionDay"
            // On the wrapper, not the select: a disabled control swallows hover,
            // so a title on it would never surface.
            title={
              completionLocked
                ? 'This order has already been dispatched — only a System Administrator can change the completion date now.'
                : undefined
            }
          >
            <Label className="text-base">
              Com. days <span className="text-rose-500">*</span>
              {completionLocked && <Lock className="ml-1 inline size-3 align-[-1px] text-slate-400" />}
            </Label>
            <NativeSelect
              value={completionDay}
              onChange={setCompletionDay}
              options={completionDayOptions}
              placeholder="Days…"
              disabled={completionLocked}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label className="text-base whitespace-nowrap">Com. date (auto)</Label>
            <Input value={niceDate(completionDate)} readOnly tabIndex={-1} className="border-indigo-200/70 bg-indigo-50/60 font-medium text-indigo-700" />
          </div>
        </CardContent>
      </Card>

      {/* Card 2 — item entry (2 rows) + grid */}
      <Card className="border-border border-l-4 border-l-slate-400 bg-slate-50/70 py-0">
        <CardContent className="space-y-2 px-3 py-2 sm:px-4 sm:py-3" {...itemAreaGuard}>
          {/* Prompt to choose a customer — see showCustomerPrompt. */}
          {showCustomerPrompt && (
            <div className="animate-in fade-in flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 duration-200">
              <ArrowLeft className="size-4 shrink-0" />
              Select a customer above to start adding items.
            </div>
          )}
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
              {/* Item labels are "{size|pcs} {product} {design}", so the keyboard
                  opens on digits and hands over to letters — plus the space —
                  the moment no item continues the typed number. The one item
                  with no leading number ("S.S.STEEL SCRAP") is reachable via the
                  field's ABC button. See `digitsFirst`. */}
              <NativeSelect
                value={entry.itemName}
                onChange={onItemPick}
                onType={detectShowBy}
                options={itemOptions.options}
                placeholder={noCustomer ? 'Select a customer first' : 'Item name'}
                className="text-left"
                disabled={noCustomer}
                digitsFirst
                onInvalidEntry={() => {
                  toast.error('Please select a correct item');
                  requestAnimationFrame(() => focusField(formRef.current, 'itemName'));
                }}
              />
            </div>
            <div className="space-y-1 lg:col-span-2" data-tabfield="designName">
              <Label className="text-base">Design Name</Label>
              <DesignNamePicker
                value={noDesignNames ? 'NA' : entry.designName}
                onChange={onDesignName}
                choices={designNameOptions.choices}
                multiple={designNameOptions.multiple}
                disabled={noDesignNames}
                onInvalidEntry={() => toast.error('Please select a correct design name')}
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
          {/* 24 columns, and the spans MUST sum to 24: 5 (type) + 3 (priority) +
              4×2 (quantities) + 5 (remarks) + 4 (actions). When they fall short
              the whole row huddles into the left half of the form, Remarks
              shrinks to a stub, and the 1-unit actions cell overflows leftward,
              painting the camera on top of the Remarks input — which is exactly
              how this row looked when the spans summed to 14. */}
          <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4 lg:grid-cols-24">
            <div className="space-y-1 lg:col-span-4" data-tabfield="ordType">
              <Label className="text-base">Order type</Label>
              <NativeSelect value={entry.ordType} onChange={(v) => setEntryField({ ordType: v })} options={orderTypeOptions} placeholder="Type…" />
            </div>
            {/* 3 units: "NORMAL" / "URGENT" are short, so this is the one field
                that can stay narrow. */}
            <div className="space-y-1 lg:col-span-3" data-tabfield="priority">
              <Label className="text-base">Priority</Label>
              <NativeSelect value={entry.priority} onChange={(v) => setEntryField({ priority: v })} options={[...ORDER_PRIORITIES]} />
            </div>
            {/* Bags / Pcs / Kgs / Box — order is configurable per product category
                in Settings → Order quantity fields; falls back to the default order. */}
            {qtyOrderForCategory(qtyLayout, entry.category).map((f: QtyField) => {
              if (f === 'bags')
                return (
                  <div key="bags" className="space-y-1 lg:col-span-2" data-tabfield="bags">
                    <Label className="text-base">Bags</Label>
                    <Input type="number" step="any" min={0} value={entry.bags} onKeyDown={onlyNumericKey} onChange={(e) => onBags(e.target.value)} />
                  </div>
                );
              if (f === 'pcs')
                return (
                  <div key="pcs" className="space-y-1 lg:col-span-2" data-tabfield="pcs">
                    <Label className={cn('text-base', showBy === 'PCS' && 'text-primary font-semibold')}>Pcs</Label>
                    <Input type="number" step="any" min={0} value={entry.pcs} onKeyDown={onlyNumericKey} onChange={(e) => onPcs(e.target.value)} />
                  </div>
                );
              if (f === 'kgs')
                return (
                  <div key="kgs" className="space-y-1 lg:col-span-2" data-tabfield="gram">
                    <Label className={cn('text-base', showBy === 'SIZE' && 'text-primary font-semibold')}>Kgs</Label>
                    <Input type="number" step="any" min={0} value={entry.gram} onKeyDown={onlyNumericKey} onChange={(e) => setEntryField({ gram: e.target.value })} />
                  </div>
                );
              return (
                <div key="box" className="space-y-1 lg:col-span-2" data-tabfield="box">
                  <Label className="text-base">Box</Label>
                  <Input type="number" step="any" min={0} value={entry.box} onKeyDown={onlyNumericKey} onChange={(e) => onBox(e.target.value)} />
                </div>
              );
            })}
            <div className="col-span-2 space-y-1 sm:col-span-3 lg:col-span-5" data-tabfield="comment">
              <Label className="text-base">Remarks</Label>
              <Input value={entry.comment} onChange={(e) => setEntryField({ comment: e.target.value })} placeholder="Item remark…" />
            </div>
            {/* Actions sit at the RIGHT of the row, camera first then Add — the
                same order and the same button as each line in the list below, so
                a photo can be attached to the line BEFORE it is added. The photos
                ride along on `entry` and addItem() copies them onto the item, so
                nothing extra is needed to persist them. */}
            <div className="col-span-2 sm:col-span-1 lg:col-span-4">
              {editingItemKey ? (
                <div className="flex items-center justify-end gap-1.5">
                  {docKind === 'order' && (
                    <LinePhotoButton
                      photos={entry.photos ?? []}
                      onChange={(photos) => setEntryField({ photos })}
                      status={photoStatusFor(editingItemKey)}
                    />
                  )}
                  <Button onClick={addItem} size="icon" aria-label="Update item" title="Update this item (Alt+A or Ctrl+A)">
                    <Check className="size-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={cancelItemEdit} aria-label="Cancel item edit" title="Cancel item edit">
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-1.5">
                  {/* No `status` here: the required/on-file check is keyed by an
                      item key, which this row does not have until it is added.
                      The line picks its status up in the list below. */}
                  {docKind === 'order' && (
                    <LinePhotoButton photos={entry.photos ?? []} onChange={(photos) => setEntryField({ photos })} />
                  )}
                  <Button onClick={addItem} disabled={noCustomer} aria-label="Add item" title={noCustomer ? 'Select a customer first' : 'Add item (Alt+A or Ctrl+A)'}>
                    <Plus /> Add
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Items panel toolbar: count · rows-to-show setting · Draw from booking. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs font-medium">
              Added items{items.length ? ` · ${items.length}` : ''}
              {items.some((i) => i.bookingId) ? ` · ${items.filter((i) => i.bookingId).length} from a booking` : ''}
            </span>
            <div className="flex items-center gap-2">
              {/* How many item rows stay visible before the panel scrolls — only
                  meaningful for the desktop table; the phone card list is unbounded. */}
              <label className="text-muted-foreground hidden items-center gap-1.5 text-xs sm:flex">
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
              chosen "Show N rows" preference (unbounded when set to All). Desktop/
              tablet only: phones get the card list below instead. */}
          <div className="hidden overflow-auto rounded-lg border sm:block" style={{ maxHeight: gridMaxHeight }}>
            {/* Prod ₹ / Dsgn ₹ are saved with the order but hidden from this list. */}
            <table className="w-full text-sm [&_td]:border-r [&_td]:border-border/60 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-border/40 [&_th:last-child]:border-r-0">
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
                  <th className="w-24 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="[&_td]:border-t [&_td]:px-3 [&_td]:py-2">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="text-muted-foreground py-4 text-center">
                      No items yet — fill the fields above and click “Add”.
                    </td>
                  </tr>
                ) : (
                  items.map((i, idx) => (
                    <tr key={i.key} className={cn('hover:bg-muted/40', editingItemKey === i.key && 'bg-sky-50 hover:bg-sky-50')}>
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
                      {/*
                        * The rate is a SUM of two figures the row does not show
                        * — the product rate and the design rate — so the number
                        * on its own cannot be checked. Opening the edit sheet was
                        * the only way to see the split. The dotted underline is
                        * what says "there is more here"; without it a tooltip
                        * nobody hovers is a tooltip nobody has.
                        */}
                      <td className="text-right tabular-nums">
                        <RateBreakdown item={i} />
                      </td>
                      <td className="text-right text-[15px] font-bold tabular-nums text-emerald-700">{lineAmount(i).toLocaleString('en-IN')}</td>
                      <td className="max-w-[14rem] truncate" title={i.comment}>{i.comment || '—'}</td>
                      <td>
                        <div className="flex items-center justify-center gap-0.5">
                          {docKind === 'order' && (
                            <LinePhotoButton photos={i.photos ?? []} onChange={(photos) => setItemPhotos(i.key, photos)} status={photoStatusFor(i.key)} />
                          )}
                          {docKind === 'order' && i.id != null ? (
                          // A saved ORDER line — deleting it belongs on the Order Modify
                          // page, where the removal (and its dispatch guard) is handled
                          // properly. Quotation lines never lock: nothing dispatches off
                          // a quotation, so editing is free until it converts.
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-help text-slate-400">
                                <span className="inline-flex size-8 items-center justify-center">
                                  <Lock className="size-4" />
                                </span>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-56">
                              <p className="font-semibold">Saved order line</p>
                              <p className="opacity-80">Existing items can’t be removed here — delete them from the Order Modify page.</p>
                            </TooltipContent>
                          </Tooltip>
                          ) : (
                            <>
                              {i.bookingId == null && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-primary hover:text-primary size-8"
                                  onClick={() => editItem(i)}
                                  disabled={editingItemKey != null}
                                  aria-label="Edit"
                                  title={editingItemKey === i.key ? 'Currently editing this item' : editingItemKey ? 'Finish or cancel the current edit first' : 'Edit this item'}
                                >
                                  <Pencil className="size-4" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => removeItem(i.key)} aria-label="Remove">
                                <Trash2 className="size-5" />
                              </Button>
                            </>
                          )}
                        </div>
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
                    {/* Rate column deliberately blank — see `totals`. The cell
                        stays so Amount keeps sitting under its own heading. */}
                    <td />
                    <td className="text-right text-[15px] tabular-nums text-emerald-700">{totals.amount.toLocaleString('en-IN')}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Phones: one card per line item (mirrors the Challan form's mobile list). */}
          <div className="sm:hidden">
            {items.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center gap-1.5 px-3 py-8 text-center text-sm">
                No items yet — fill the fields above and tap “Add”.
              </div>
            ) : (
              <>
                <div className="divide-y rounded-lg border">
                  {items.map((i, idx) => (
                    <div key={i.key} className={cn('px-2.5 py-2', editingItemKey === i.key && 'bg-sky-50')}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            <span className="text-muted-foreground mr-1 tabular-nums">{idx + 1}.</span>
                            {i.itemName || i.product || '—'}
                          </p>
                          {(i.special || i.bookingId) && (
                            <div className="mt-0.5 flex flex-wrap items-center gap-1">
                              {i.special && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700" title={`Special rate applied — ${i.special}`}>
                                  <BadgePercent className="size-3" /> special
                                </span>
                              )}
                              {i.bookingId && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700" title={`Drawn from booking ${i.bookingCode ?? ''} — rate frozen to the booking date`}>
                                  <PackageOpen className="size-3" /> {i.bookingCode ?? 'Booking'}
                                </span>
                              )}
                            </div>
                          )}
                          <p className="text-muted-foreground truncate text-xs">
                            {i.designName || '—'} · {i.ordType || '—'}
                            {i.priority === 'URGENT' ? <span className="ml-1 font-semibold text-rose-600">· URGENT</span> : i.priority ? ` · ${i.priority}` : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          {docKind === 'order' && <LinePhotoButton photos={i.photos ?? []} onChange={(photos) => setItemPhotos(i.key, photos)} status={photoStatusFor(i.key)} />}
                          {docKind === 'order' && i.id != null ? (
                            <span className="text-slate-400 inline-flex size-8 items-center justify-center" title="Existing order line — edit it on the Order Modify page">
                              <Lock className="size-4" />
                            </span>
                          ) : (
                            <>
                              {i.bookingId == null && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-primary hover:text-primary size-8"
                                  onClick={() => editItem(i)}
                                  disabled={editingItemKey != null}
                                  aria-label="Edit item"
                                  title={editingItemKey === i.key ? 'Currently editing this item' : editingItemKey ? 'Finish or cancel the current edit first' : 'Edit this item'}
                                >
                                  <Pencil className="size-4.5" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => removeItem(i.key)} aria-label="Remove">
                                <Trash2 className="size-5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex items-end justify-between gap-3">
                        <div className="grid grid-cols-4 gap-x-3 gap-y-0.5 text-xs">
                          <div><p className="text-muted-foreground">Bags</p><p className="font-medium tabular-nums">{i.bags || '—'}</p></div>
                          <div><p className="text-muted-foreground">Pcs</p><p className="font-medium tabular-nums">{i.pcs || '—'}</p></div>
                          <div><p className="text-muted-foreground">Kgs</p><p className="font-medium tabular-nums">{i.gram || '—'}</p></div>
                          <div><p className="text-muted-foreground">Box</p><p className="font-medium tabular-nums">{i.box || '—'}</p></div>
                        </div>
                        <div className="shrink-0 text-right leading-tight">
                          <p className="text-muted-foreground text-[11px]">Rate <span className="text-foreground font-medium tabular-nums">₹{itemRate(i).toLocaleString('en-IN')}</span></p>
                          <p className="text-[15px] font-bold tabular-nums text-emerald-700">₹{lineAmount(i).toLocaleString('en-IN')}</p>
                        </div>
                      </div>
                      {i.comment && <p className="text-muted-foreground mt-1.5 text-xs">📝 {i.comment}</p>}
                    </div>
                  ))}
                </div>
                <div className="bg-muted/60 mt-1 flex items-center justify-between rounded-md border-t-2 px-2.5 py-1.5 text-sm font-semibold">
                  <span className="text-muted-foreground tracking-wide uppercase">Total · {items.length} item(s)</span>
                  <span className="text-primary tabular-nums">₹{totals.amount.toLocaleString('en-IN')}</span>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Action bar flows at the end of the form (not pinned) — it appears right
          after the content, so with many line items you reach it at the bottom.
          Wraps so the buttons are never cut off when zoomed in. */}
      {/* Action bar flows at the end of the form (not pinned). On phones the total
          sits on its own line, the secondary actions form a compact 2-col grid,
          and the primary action is a full-width, thumb-friendly button underneath;
          desktop keeps the single inline row. */}
      <div className="-mx-1 mt-1 border-t px-2 py-2.5 sm:mt-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3 sm:gap-y-2 sm:py-3">
        <p className="mb-2.5 text-center text-sm sm:mb-0 sm:text-left">
          {items.length} item(s) · total{' '}
          <span className="text-lg font-bold tabular-nums text-emerald-600">₹{total.toLocaleString('en-IN')}</span>
        </p>
        <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex sm:flex-wrap sm:justify-end">
          <Button type="button" variant="destructive" onClick={() => confirmExit(backPath)} title="Cancel (Esc)">
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
              <Kbd className="hidden sm:inline-flex">Alt+Q</Kbd>
            </Button>
          )}
          {/* Edit a quotation → also offer "Save & Convert" straight to an order. */}
          {isEdit && docKind === 'quotation' && (
            <Button
              type="button"
              onClick={saveAndConvert}
              disabled={saving}
              className="col-span-2 bg-emerald-600 text-white hover:bg-emerald-700 sm:col-auto"
              title="Save changes and convert to an order"
            >
              <ArrowRightLeft /> Save &amp; Convert
            </Button>
          )}
          {/* Advanced one-step: create the order AND fully dispatch every line. */}
          {!isEdit && docKind === 'order' && can('dispatch:create') && (
            <Button
              type="button"
              onClick={createAndDispatch}
              disabled={saving}
              className="col-span-2 bg-amber-500 text-white hover:bg-amber-600 sm:col-auto"
              title="Create the order and dispatch every line in full (Alt+D)"
            >
              {fulfillOrder.isPending ? <Loader2 className="animate-spin" /> : <Truck />} Create &amp; Dispatch
              <Kbd className="hidden sm:inline-flex">Alt+D</Kbd>
            </Button>
          )}
          <Button
            type="button"
            onClick={submit}
            disabled={saving}
            title={`${primaryLabel} (Ctrl+S)`}
            className="col-span-2 h-12 text-base font-semibold shadow-sm sm:col-auto sm:h-9 sm:text-sm sm:font-medium sm:shadow-none"
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {primaryLabel}
            <Kbd className="hidden sm:inline-flex">Ctrl+S</Kbd>
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

/** Per-row camera button → popover with the line's draft photo manager. */
/**
 * @param status the line's reference-photo standing when the form can dispatch
 *   (see `photoLines`). `required` turns the camera red — the line would be
 *   shipped with nothing on file. `onFile` is a photo from an earlier dispatch
 *   of the same party + item + design: nothing to do, but shown so the user can
 *   see WHAT is on file rather than just being told there is something.
 */
function LinePhotoButton({
  photos,
  onChange,
  status,
}: {
  photos: LinePhoto[];
  onChange: (photos: LinePhoto[]) => void;
  status?: { required: boolean; onFile: string | null };
}) {
  const count = photos.length;
  const required = !!status?.required;
  const onFile = status?.onFile ?? null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'relative size-8',
            required
              ? 'text-rose-600 hover:text-rose-700 ring-1 ring-rose-300 ring-inset'
              : 'text-indigo-600 hover:text-indigo-800',
          )}
          aria-label={required ? 'Line photos — required before dispatch' : 'Line photos'}
          title={
            required
              ? 'No reference photo on file for this party + item + design — required before Create & Dispatch'
              : count
                ? `${count} photo${count === 1 ? '' : 's'}`
                : onFile
                  ? 'A reference photo is already on file for this party + item + design'
                  : 'Add photos'
          }
        >
          <Camera className="size-5" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-indigo-600 px-0.5 text-[9px] font-bold text-white tabular-nums">
              {count}
            </span>
          )}
          {/* No count to show, but there IS one on file — a quiet dot, so the
              line reads as "documented" without pretending it has attachments. */}
          {count === 0 && !required && onFile && (
            <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-500" />
          )}
        </Button>
      </PopoverTrigger>
      {/* Wider than the usual popover, with 3 columns instead of 4/5: these are
          REFERENCE photos — the point is to recognise the design at a glance,
          which a ~50px tile in a 320px popover didn't allow. Capped to the
          viewport so it still fits a phone, and scrolled rather than grown
          past the screen — tiles this size stack up fast on a line with many
          photos, where the old small ones stayed comfortably short. */}
      <PopoverContent align="end" className="max-h-[70vh] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto">
        {required && (
          <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-400/25 dark:bg-rose-500/10 dark:text-rose-300">
            This party has never been sent this item and design with a photo on record. Add one before using Create &amp; Dispatch —
            saving the order on its own is fine without it.
          </p>
        )}
        {onFile && (
          <div className="mb-3 rounded-md border p-2">
            <p className="text-muted-foreground mb-2 text-xs font-medium">Already on file from an earlier dispatch</p>
            <img src={onFile} alt="Reference photo on file" className="max-h-40 w-full rounded object-contain" />
          </div>
        )}
        <DraftLinePhotos value={photos} onChange={onChange} gridClassName="grid-cols-2 gap-3" />
      </PopoverContent>
    </Popover>
  );
}

/** One key combination rendered as Kbd chips joined by "+". */
function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <>
      {keys.map((k, i) => (
        <span key={k} className="flex items-center gap-0.5">
          {i > 0 && <span className="text-muted-foreground text-[10px]">+</span>}
          <Kbd>{k}</Kbd>
        </span>
      ))}
    </>
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
  // `or` is a second, equivalent combo for the same action — one row, not two,
  // so the list doesn't read as if there were two different actions.
  const SHORTCUTS: { label: string; keys: string[]; or?: string[] }[] = [
    { label: 'Add item', keys: ['Alt', 'A'], or: ['Ctrl', 'A'] },
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
                    <KeyCombo keys={s.keys} />
                    {s.or && (
                      <>
                        <span className="text-muted-foreground mx-1 text-[10px]">or</span>
                        <KeyCombo keys={s.or} />
                      </>
                    )}
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
