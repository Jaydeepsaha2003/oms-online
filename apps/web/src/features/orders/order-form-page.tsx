import {
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
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Keyboard, Loader2, Plus, ReceiptText, RotateCcw, Save, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ORDER_PRIORITIES, type OrderInput } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { NativeSelect } from '@/components/common/combo';
import { settingValues, useSettings } from '@/features/settings/use-settings';
import { useCreateOrder, useOrder, useOrderLookups, useUpdateOrder } from './use-orders';

/** A line item once added to the order. */
interface Item {
  key: string;
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
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (dateStr: string, days: number) => {
  if (!dateStr || Number.isNaN(days)) return '';
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// The form's focusable controls, in entry order — used by the Tab-access panel.
const TAB_FIELDS = [
  { key: 'customer', label: 'Customer' },
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
  const confirm = useConfirm();
  const params = useParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const isEdit = id != null;
  const [saved, setSaved] = useState(false); // shows the success-tick overlay

  const { data: lookups } = useOrderLookups();
  const { data: settings } = useSettings();
  const { data: existing, isLoading } = useOrder(id);
  const create = useCreateOrder();
  const update = useUpdateOrder(id ?? 0);
  const saving = create.isPending || update.isPending;
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
  const [agentName, setAgentName] = useState('');
  const [category, setCategory] = useState('SALES');
  const [orderDate, setOrderDate] = useState(today());
  const [completionDay, setCompletionDay] = useState('');
  const [status, setStatus] = useState('CONFIRMED'); // new orders default to confirmed
  const [showBy, setShowBy] = useState<'PCS' | 'SIZE'>('SIZE');

  // Item entry (the row being built) + the added items
  const [entry, setEntry] = useState(blankEntry());
  const [items, setItems] = useState<Item[]>([]);

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

  // Load an existing order for editing.
  useEffect(() => {
    if (!existing) return;
    setCustomer(existing.customerName);
    setAgentName(existing.agentName ?? '');
    setCategory(existing.category ?? 'SALES');
    setOrderDate(existing.orderDate.slice(0, 10));
    setCompletionDay(existing.completionDay?.toString() ?? '');
    setStatus(existing.status);
    setItems(
      existing.items.map((it, i) => ({
        key: `e${it.id}-${i}`,
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
  }, [existing, nameByCode]);

  // Auto-fill agent + category from the chosen customer.
  const onCustomer = (name: string) => {
    setCustomer(name);
    const c = lookups?.customers.find((x) => x.name === name);
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
    const map = new Map<string, (typeof list)[number]>();
    const labels: string[] = [];
    for (const it of list) {
      const prefix = showBy === 'PCS' ? fmtNum(it.pcs) : fmtNum(it.size);
      const label = [prefix, it.product, it.designType ?? ''].filter(Boolean).join(' ');
      if (!label || map.has(label)) continue; // first wins on duplicate labels
      map.set(label, it);
      labels.push(label);
    }
    return { labels, map };
  }, [lookups, showBy]);

  // Picking an item fills product, category/sub, design type, rates + weight/box info.
  const onItemPick = (label: string) => {
    const it = itemOptions.map.get(label);
    if (!it) {
      setEntry((e) => ({ ...e, itemName: label, product: label }));
      return;
    }
    // The composite item carries a design-type code. Show its human name only —
    // never the raw code (it.designName falls back to the code when none exists).
    const realName = it.designName && it.designName !== it.designType ? it.designName : '';
    setEntry((e) => ({
      ...e,
      itemName: label,
      product: it.product,
      category: it.category,
      subCategory: it.subCategory,
      weight: it.weight != null ? String(it.weight) : '',
      pcsBox: it.pcs != null ? String(it.pcs) : '',
      productRate: it.productRate != null ? String(it.productRate) : '',
      designType: it.designType ?? '',
      designName: realName,
      designRate: it.designType && it.designRate != null ? String(it.designRate) : '',
    }));
  };

  // Auto-calc Kgs (= Pcs × weight) and Box (= Pcs ÷ pcs-per-box) when a product is picked.
  const onPcs = (value: string) => {
    setEntry((e) => {
      const pcs = n(value) ?? 0;
      const w = n(e.weight);
      const per = n(e.pcsBox);
      const round2 = (x: number) => String(Math.round(x * 100) / 100);
      return {
        ...e,
        pcs: value,
        gram: w != null && value.trim() !== '' ? round2(pcs * w) : e.gram,
        box: per != null && per > 0 && value.trim() !== '' ? round2(pcs / per) : e.box,
      };
    });
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

  const addItem = () => {
    if (!entry.product.trim() && !entry.designType.trim()) {
      return toast.error('Pick a product or design type to add');
    }
    const designName = noDesignNames ? 'NA' : entry.designName;
    setItems((its) => [
      ...its,
      { ...entry, key: `i${keyer.current++}`, calField: showBy === 'PCS' ? 'PCS' : 'KGS', designName },
    ]);
    // Reset the item fields but keep order type / priority for the next line.
    setEntry((e) => ({ ...blankEntry(), ordType: e.ordType, priority: e.priority }));
    // Return focus to Item name so the next line can be entered immediately.
    requestAnimationFrame(() => focusField(formRef.current, 'itemName'));
  };

  const removeItem = (key: string) => setItems((its) => its.filter((i) => i.key !== key));

  const total = useMemo(() => items.reduce((s, i) => s + itemRate(i), 0), [items]);

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
        }),
        { bags: 0, pcs: 0, gram: 0, box: 0, rate: 0 },
      ),
    [items],
  );

  const submit = async () => {
    if (!customer.trim()) return toast.error('Please select a correct customer');
    if (!completionDay.trim()) return toast.error('Please Select the Completion Day');
    if (items.length === 0) return toast.error('There are no items to save.');
    const ok = await confirm({
      title: isEdit ? 'Save changes to this order?' : 'Create this order?',
      description: `${items.length} item${items.length === 1 ? '' : 's'} · total ₹${total.toLocaleString()} for ${customer.trim()}.`,
      confirmText: isEdit ? 'Save changes' : 'Create order',
    });
    if (!ok) return;
    const input: OrderInput = {
      customerName: customer.trim(),
      agentName: agentName.trim() || null,
      category: category.trim() || null,
      orderDate,
      completionDate: completionDate || null,
      status,
      items: items.map((i) => ({
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
    };
    const opts = {
      onSuccess: () => {
        // Quick success tick, then close back to the list.
        setSaved(true);
        window.setTimeout(() => navigate('/orders'), 950);
      },
      onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed')),
    };
    if (isEdit) update.mutate(input, opts);
    else create.mutate(input, opts);
  };

  // Keep the latest action handlers in a ref so the global shortcut listener
  // (bound once) always calls the current closures.
  const actionsRef = useRef<{ add: () => void; save: () => void; cancel: () => void; focusItem: () => void } | null>(null);
  actionsRef.current = {
    add: addItem,
    save: submit,
    cancel: () => navigate('/orders'),
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
            <p className="text-sm font-semibold text-emerald-700">{isEdit ? 'Order saved' : 'Order created'}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/orders')} aria-label="Back">
          <ArrowLeft />
        </Button>
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <ReceiptText className="size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight">{isEdit ? 'Modify order' : 'New order'}</h2>
          <p className="text-muted-foreground truncate text-xs">
            {isEdit ? (existing?.code ?? `#${id}`) : 'Create a sales order — add items one by one'}
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

      {/* Card 1 — order header in one row */}
      <Card className="border-l-4 border-l-primary py-0">
        <CardContent className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-3 lg:grid-cols-12">
          <div className="col-span-2 space-y-1.5 sm:col-span-1 lg:col-span-5" data-tabfield="customer">
            <Label className="text-sm">Customer <span className="text-rose-500">*</span></Label>
            <NativeSelect
              value={customer}
              onChange={onCustomer}
              options={(lookups?.customers ?? []).map((c) => c.name)}
              placeholder="Select…"
              onInvalidEntry={() => toast.error('Please select a correct customer')}
            />
          </div>
          <div className="space-y-1.5 lg:col-span-1">
            <Label className="text-sm">Agent (auto)</Label>
            <Input value={agentName} readOnly tabIndex={-1} className="border-indigo-200/70 bg-indigo-50/60 font-medium text-indigo-700" />
          </div>
          <div className="space-y-1.5 lg:col-span-1">
            <Label className="text-sm">Category (auto)</Label>
            <Input value={category} readOnly tabIndex={-1} className="border-indigo-200/70 bg-indigo-50/60 font-medium text-indigo-700" />
          </div>
          <div className="space-y-1.5 lg:col-span-2" data-tabfield="orderDate">
            <Label className="text-sm">Order date <span className="text-rose-500">*</span></Label>
            <DatePicker value={orderDate} onChange={setOrderDate} clearable={false} />
          </div>
          <div className="space-y-1.5 lg:col-span-1" data-tabfield="completionDay">
            <Label className="text-sm">Com. days</Label>
            <NativeSelect
              value={completionDay}
              onChange={setCompletionDay}
              options={completionDayOptions}
              placeholder="Days…"
            />
          </div>
          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-sm">Completion date (auto)</Label>
            <Input value={completionDate} readOnly tabIndex={-1} className="border-indigo-200/70 bg-indigo-50/60 font-medium text-indigo-700" />
          </div>
        </CardContent>
      </Card>

      {/* Card 2 — item entry (2 rows) + grid */}
      <Card className="border-border border-l-4 border-l-slate-400 bg-slate-50/70 py-0">
        <CardContent className="space-y-2 px-4 py-3">
          {/* Row 1 */}
          <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3 lg:grid-cols-12">
            <div className="col-span-2 space-y-1 sm:col-span-1 lg:col-span-2" data-tabfield="showBy">
              <Label className="text-sm">Show item by</Label>
              <div className="flex h-9 items-center gap-4 text-sm">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="radio" className="accent-indigo-600" checked={showBy === 'SIZE'} onChange={() => setShowBy('SIZE')} /> Size
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="radio" className="accent-indigo-600" checked={showBy === 'PCS'} onChange={() => setShowBy('PCS')} /> Pcs
                </label>
              </div>
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-2 lg:col-span-5" data-tabfield="itemName">
              <Label className="text-sm">Item name</Label>
              <NativeSelect
                value={entry.itemName}
                onChange={onItemPick}
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
              <Label className="text-sm">Design Name</Label>
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
              <Label className="text-sm">Prod ₹</Label>
              <Input type="number" step="any" className="text-right tabular-nums" value={entry.productRate} onKeyDown={onlyNumericKey} onChange={(e) => setEntryField({ productRate: e.target.value })} />
            </div>
            <div className="space-y-1 lg:col-span-1" data-tabfield="designRate">
              <Label className="text-sm">Dsgn ₹</Label>
              <Input type="number" step="any" className="text-right tabular-nums" value={entry.designRate} disabled={!designRateEditable} onKeyDown={onlyNumericKey} onChange={(e) => setEntryField({ designRate: e.target.value })} />
            </div>
            <div className="space-y-1 lg:col-span-1">
              <Label className="text-sm">Total ₹</Label>
              <div className="flex h-9 items-center justify-end rounded-md border border-emerald-200 bg-emerald-50 px-2 text-sm font-bold tabular-nums text-emerald-700">
                {entryTotal.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4 lg:grid-cols-12">
            <div className="space-y-1 lg:col-span-2" data-tabfield="ordType">
              <Label className="text-sm">Order type</Label>
              <NativeSelect value={entry.ordType} onChange={(v) => setEntryField({ ordType: v })} options={orderTypeOptions} placeholder="Type…" />
            </div>
            <div className="space-y-1 lg:col-span-2" data-tabfield="priority">
              <Label className="text-sm">Priority</Label>
              <NativeSelect value={entry.priority} onChange={(v) => setEntryField({ priority: v })} options={[...ORDER_PRIORITIES]} />
            </div>
            <div className="space-y-1 lg:col-span-1" data-tabfield="bags">
              <Label className="text-sm">Bags</Label>
              <Input type="number" step="any" value={entry.bags} onKeyDown={onlyNumericKey} onChange={(e) => setEntryField({ bags: e.target.value })} />
            </div>
            <div className="space-y-1 lg:col-span-1" data-tabfield="pcs">
              <Label className={cn('text-sm', showBy === 'PCS' && 'text-primary font-semibold')}>Pcs</Label>
              <Input type="number" step="any" value={entry.pcs} onKeyDown={onlyNumericKey} onChange={(e) => onPcs(e.target.value)} />
            </div>
            <div className="space-y-1 lg:col-span-1" data-tabfield="gram">
              <Label className={cn('text-sm', showBy === 'SIZE' && 'text-primary font-semibold')}>Kgs</Label>
              <Input type="number" step="any" value={entry.gram} onKeyDown={onlyNumericKey} onChange={(e) => setEntryField({ gram: e.target.value })} />
            </div>
            <div className="space-y-1 lg:col-span-1" data-tabfield="box">
              <Label className="text-sm">Box</Label>
              <Input type="number" step="any" value={entry.box} onKeyDown={onlyNumericKey} onChange={(e) => setEntryField({ box: e.target.value })} />
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-3 lg:col-span-3" data-tabfield="comment">
              <Label className="text-sm">Remarks</Label>
              <Input value={entry.comment} onChange={(e) => setEntryField({ comment: e.target.value })} placeholder="Item remark…" />
            </div>
            <div className="col-span-2 sm:col-span-1 lg:col-span-1">
              <Button onClick={addItem} className="w-full" aria-label="Add item" title="Add item (Alt+A)">
                <Plus /> Add
              </Button>
            </div>
          </div>

          {/* Added items — grid auto-fits to the desktop width */}
          <div className="max-h-[28vh] overflow-auto rounded-lg border">
            {/* Prod ₹ / Dsgn ₹ are saved with the order but hidden from this list. */}
            <table className="w-full text-sm">
              <thead className="bg-indigo-50 [&_th]:sticky [&_th]:top-0 [&_th]:bg-indigo-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-indigo-900">
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
                  <th>Remarks</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="[&_td]:border-t [&_td]:px-3 [&_td]:py-2">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="text-muted-foreground h-14 text-center">
                      No items yet — fill the fields above and click “Add”.
                    </td>
                  </tr>
                ) : (
                  items.map((i, idx) => (
                    <tr key={i.key} className="hover:bg-muted/40">
                      <td className="text-muted-foreground text-center tabular-nums">{idx + 1}</td>
                      <td className="font-medium">{i.itemName || i.product || '—'}</td>
                      <td>{i.designName || '—'}</td>
                      <td>{i.ordType || '—'}</td>
                      <td>{i.priority === 'URGENT' ? <span className="font-semibold text-rose-600">URGENT</span> : i.priority}</td>
                      <td className="text-right tabular-nums">{i.bags || '—'}</td>
                      <td className="text-right tabular-nums">{i.pcs || '—'}</td>
                      <td className="text-right tabular-nums">{i.gram || '—'}</td>
                      <td className="text-right tabular-nums">{i.box || '—'}</td>
                      <td className="text-right font-semibold tabular-nums text-emerald-700">{itemRate(i).toLocaleString()}</td>
                      <td className="max-w-[14rem] truncate" title={i.comment}>{i.comment || '—'}</td>
                      <td>
                        <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => removeItem(i.key)} aria-label="Remove">
                          <Trash2 className="size-4" />
                        </Button>
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
                    <td className="text-right tabular-nums">{totals.bags.toLocaleString()}</td>
                    <td className="text-right tabular-nums">{totals.pcs.toLocaleString()}</td>
                    <td className="text-right tabular-nums">{totals.gram.toLocaleString()}</td>
                    <td className="text-right tabular-nums">{totals.box.toLocaleString()}</td>
                    <td className="text-right tabular-nums text-emerald-700">{totals.rate.toLocaleString()}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Sticky action bar with total */}
      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-3 border-t bg-background/85 px-1 py-3 backdrop-blur">
        <p className="text-sm">
          {items.length} item(s) · total{' '}
          <span className="font-bold tabular-nums text-emerald-600">₹{total.toLocaleString()}</span>
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="destructive" onClick={() => navigate('/orders')} title="Cancel (Esc)">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} title={`${isEdit ? 'Save changes' : 'Create order'} (Ctrl+S)`}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {isEdit ? 'Save changes' : 'Create order'}
            <Kbd>Ctrl+S</Kbd>
          </Button>
        </div>
      </div>
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
