import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BellOff, BellRing, Building2, Check, ClipboardList, HardDrive, ImageIcon, Layers, Loader2, Plus, Receipt, SlidersHorizontal, Trash2, Truck, Upload, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_ORDER_QTY_LAYOUT, isWithinDnd, normalizeQtyOrder, QTY_FIELD_LABEL, SETTING_GROUP_META, type OrderOptionDto, type OrderQtyLayout, type QtyField, type SettingGroupMeta } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { RESOURCES } from '@oms/shared';
import { RecordHistory } from '@/components/common/record-history';
import { useChallanPrefixSettings, useSaveChallanPrefixSettings } from '@/features/challans/use-challans';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAutoSizePcs } from '@/lib/auto-size-pcs';
import { useOrderLookups } from '@/features/orders/use-orders';
import { CrmReminderCard } from '@/features/crm/crm-settings-card';
import { MyDevicesCard } from './my-devices-card';
import { TestNotificationCard } from './test-notification-card';
import { DatabaseBackupCard } from './database-backup-card';
import { DesignTrackCard } from './design-track-card';
import { DispatchAlertsCard } from './dispatch-alerts-card';
import { RateListSettingsCard } from './rate-list-settings-card';
import {
  useChallanFields,
  useNotificationDnd,
  useChallanTerms,
  useCompany,
  useCreateOrderOption,
  useDeleteOrderOption,
  useDispatchBagThreshold,
  useOrderFooter,
  useOrderTerms,
  useQuotationTerms,
  useSettings,
  useOrderQtyLayout,
  useTcsPercent,
  useUpdateChallanFields,
  useUpdateNotificationDnd,
  useUpdateChallanTerms,
  useUpdateCompany,
  useUpdateDispatchBagThreshold,
  useUpdateOrderFooter,
  useUpdateOrderQtyLayout,
  useUpdateOrderTerms,
  useUpdateQuotationTerms,
  useUpdateTcsPercent,
} from './use-settings';

type TabKey = 'general' | 'orders' | 'challan' | 'dispatch' | 'ratelist' | 'crm' | 'backup';

export function SettingsPage() {
  const { data: all, isLoading } = useSettings();
  const { can } = usePermissions();
  const canEdit = can('setting:update');
  const canBackup = can('backup:export');
  // Rate list configuration lives on the customer, so it follows customer rights
  // rather than the generic settings right.
  const canEditRateList = can('customer:update');

  const tabs: { id: TabKey; label: string; icon: LucideIcon }[] = [
    { id: 'general', label: 'General', icon: Building2 },
    { id: 'orders', label: 'Orders', icon: ClipboardList },
    { id: 'challan', label: 'Challan & Tax', icon: Receipt },
    { id: 'dispatch', label: 'Dispatch', icon: Truck },
    { id: 'ratelist', label: 'Rate List', icon: Layers },
    { id: 'crm', label: 'CRM', icon: BellRing },
    ...(canBackup ? ([{ id: 'backup', label: 'Backup', icon: HardDrive }] as const) : []),
  ];

  // The active tab lives in the URL (?tab=...) rather than plain component
  // state, so a refresh — or a bookmarked/shared link — lands back on the same
  // tab instead of always resetting to General.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const tab: TabKey = tabs.some((t) => t.id === requested) ? (requested as TabKey) : 'general';
  const setTab = (id: TabKey) => setSearchParams((prev) => ({ ...Object.fromEntries(prev), tab: id }), { replace: true });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <div>
          <p className="text-muted-foreground text-sm">Manage the option lists used across the app.</p>
        </div>
      </div>

      {/* Tab bar — same pill-segmented style used on the customer form's tabs. */}
      <div className="flex flex-wrap items-center gap-1 overflow-x-auto rounded-[4px] border border-amber-300 bg-amber-50/40 p-0.5 dark:border-amber-400/40">
        {tabs.map(({ id, label, icon: Icon }) => {
          const on = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-1.5 rounded-[3px] px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors',
                on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          );
        })}
      </div>

      {tab === 'general' && (
        <div className="space-y-4">
          <CompanyCard canEdit={canEdit} />
          <PreferencesCard />
          <MyDevicesCard />
          <ReminderDndCard />
          <TestNotificationCard />
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-4">
          <OrderTermsCard canEdit={canEdit} />
          <QuotationTermsCard canEdit={canEdit} />
          <OrderFooterCard canEdit={canEdit} />
          <OrderQtyLayoutCard canEdit={canEdit} />
          {isLoading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : (
            SETTING_GROUP_META.map((meta) => (
              <GroupCard key={meta.group} meta={meta} options={all ?? []} canEdit={canEdit} />
            ))
          )}
        </div>
      )}

      {tab === 'challan' && (
        <div className="space-y-4">
          <ChallanFieldsCard canEdit={canEdit} />
          <ChallanTermsCard canEdit={canEdit} />
          <ChallanPrefixCard canEdit={canEdit} />
          <TcsPercentCard canEdit={canEdit} />
        </div>
      )}

      {tab === 'dispatch' && (
        <div className="space-y-4">
          <DispatchBagThresholdCard canEdit={canEdit} />
          <DispatchAlertsCard canEdit={canEdit} />
          <DesignTrackCard canEdit={canEdit} />
        </div>
      )}

      {tab === 'ratelist' && (
        <div className="space-y-4">
          <RateListSettingsCard canEdit={canEditRateList} />
        </div>
      )}

      {tab === 'crm' && (
        <div className="space-y-4">
          <CrmReminderCard />
        </div>
      )}

      {tab === 'backup' && canBackup && (
        <div className="space-y-4">
          <DatabaseBackupCard />
        </div>
      )}
    </div>
  );
}

/** Per-browser UI preferences (no permission needed — each user sets their own). */
function PreferencesCard() {
  const { autoSizePcs, setAutoSizePcs } = useAutoSizePcs();
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Order form</CardTitle>
        <p className="text-muted-foreground text-xs">Behaviour preferences for the New Order screen.</p>
      </CardHeader>
      <CardContent>
        <label className="flex items-start justify-between gap-4">
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">Auto-detect Size / Pcs</span>
            <span className="text-muted-foreground block text-xs">
              Pick Size or Pcs automatically from the number typed in Item name. When off, the Size/Pcs
              selector is shown on the order form for manual choice.
            </span>
          </span>
          <Switch checked={autoSizePcs} onCheckedChange={setAutoSizePcs} />
        </label>
      </CardContent>
    </Card>
  );
}

/** Arrange the New Order quantity inputs (Bags/Pcs/Kgs/Box) — a default order,
 *  plus per-category overrides so, e.g., cup categories can lead with Box. */
function OrderQtyLayoutCard({ canEdit }: { canEdit: boolean }) {
  const { data: saved } = useOrderQtyLayout();
  const { data: lookups } = useOrderLookups();
  const save = useUpdateOrderQtyLayout();
  const [layout, setLayout] = useState<OrderQtyLayout>(DEFAULT_ORDER_QTY_LAYOUT);
  const [addCat, setAddCat] = useState('');

  useEffect(() => { if (saved) setLayout({ default: normalizeQtyOrder(saved.default), byCategory: saved.byCategory ?? {} }); }, [saved]);

  const categories = lookups?.categories ?? [];
  const configured = Object.keys(layout.byCategory).sort((a, b) => a.localeCompare(b));
  const available = categories.filter((c) => !layout.byCategory[c.trim().toUpperCase()]);

  const move = (order: QtyField[], i: number, dir: -1 | 1): QtyField[] => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return order;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };
  const setDefault = (order: QtyField[]) => setLayout((l) => ({ ...l, default: order }));
  const setCat = (cat: string, order: QtyField[]) => setLayout((l) => ({ ...l, byCategory: { ...l.byCategory, [cat]: order } }));
  const removeCat = (cat: string) => setLayout((l) => { const { [cat]: _drop, ...rest } = l.byCategory; return { ...l, byCategory: rest }; });
  const addCategory = () => {
    const key = addCat.trim().toUpperCase();
    if (!key) return;
    setLayout((l) => ({ ...l, byCategory: { ...l.byCategory, [key]: normalizeQtyOrder(l.default) } }));
    setAddCat('');
  };

  const onSave = () => save.mutate(layout, {
    onSuccess: () => toast.success('Quantity-field layout saved'),
    onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
  });

  const Row = ({ order, onChange, onRemove, title }: { order: QtyField[]; onChange: (o: QtyField[]) => void; onRemove?: () => void; title: string }) => (
    <div className="rounded-lg border bg-slate-50/60 p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        {onRemove && canEdit && (
          <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive rounded p-1" aria-label={`Remove ${title}`}><Trash2 className="size-3.5" /></button>
        )}
      </div>
      <div className="flex flex-wrap items-stretch gap-1.5">
        {order.map((f, i) => (
          <div key={f} className="bg-card flex items-center gap-1 rounded-md border px-2 py-1">
            <span className="text-primary/60 text-[11px] font-bold tabular-nums">{i + 1}</span>
            <span className="text-sm font-medium">{QTY_FIELD_LABEL[f]}</span>
            {canEdit && (
              <span className="ml-1 flex">
                <button type="button" disabled={i === 0} onClick={() => onChange(move(order, i, -1))} className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Move left"><ArrowLeft className="size-3.5" /></button>
                <button type="button" disabled={i === order.length - 1} onClick={() => onChange(move(order, i, 1))} className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Move right"><ArrowRight className="size-3.5" /></button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Order quantity fields</CardTitle>
        <p className="text-muted-foreground text-xs">Arrange how Bags / Pcs / Kgs / Box appear on the New Order form — a default order, and per-category overrides applied to the selected item's category.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Row order={layout.default} onChange={setDefault} title="Default (all categories)" />
        {configured.map((cat) => (
          <Row key={cat} order={normalizeQtyOrder(layout.byCategory[cat])} onChange={(o) => setCat(cat, o)} onRemove={() => removeCat(cat)} title={cat} />
        ))}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <select
              value={addCat}
              onChange={(e) => setAddCat(e.target.value)}
              className="border-input h-9 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <option value="">Add a category override…</option>
              {available.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Button type="button" variant="outline" size="sm" onClick={addCategory} disabled={!addCat.trim()}><Plus className="size-4" /> Add</Button>
            <Button type="button" size="sm" className="ml-auto" onClick={onSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Save layout
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Current Indian fiscal-year label, e.g. "26-27" (Apr–Mar). */
function fyLabel() {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** Manage challan-number prefixes. New challans are numbered PREFIX/FY/serial. */
function ChallanPrefixCard({ canEdit }: { canEdit: boolean }) {
  const { data } = useChallanPrefixSettings();
  const save = useSaveChallanPrefixSettings();
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [def, setDef] = useState('');
  const [input, setInput] = useState('');
  const fy = fyLabel();

  useEffect(() => {
    if (data) {
      setPrefixes(data.prefixes);
      setDef(data.default);
    }
  }, [data]);

  const add = () => {
    const v = input.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(v)) return toast.error('Use letters/digits only (up to 10 characters).');
    if (!prefixes.includes(v)) setPrefixes((p) => [...p, v]);
    if (!def) setDef(v);
    setInput('');
  };
  const remove = (p: string) => {
    const next = prefixes.filter((x) => x !== p);
    setPrefixes(next);
    if (def === p) setDef(next[0] ?? '');
  };
  const onSave = () => {
    if (!prefixes.length) return toast.error('Add at least one prefix.');
    save.mutate(
      { prefixes, default: def || prefixes[0] },
      { onSuccess: () => toast.success('Challan prefixes saved'), onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')) },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Challan number prefixes</CardTitle>
        <p className="text-muted-foreground text-xs">
          New challans are numbered <span className="font-mono">PREFIX / {fy} / serial</span> (e.g.{' '}
          <span className="text-foreground font-mono font-medium">{(def || 'SSS') + '/' + fy + '/1'}</span>). Add the prefixes you use and pick a default. Imported
          challans keep their original numbers.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {prefixes.length === 0 && <span className="text-muted-foreground text-sm">No prefixes yet.</span>}
          {prefixes.map((p) => (
            <span
              key={p}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border py-1 pr-1 pl-3 text-sm',
                p === def ? 'border-primary bg-primary/10 text-primary' : 'bg-muted',
              )}
            >
              <span className="font-semibold">{p}</span>
              {p === def && <span className="text-[10px] font-semibold tracking-wide uppercase opacity-70">default</span>}
              {canEdit && (
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-5 items-center justify-center rounded-full transition-colors"
                  onClick={() => remove(p)}
                  aria-label={`Remove ${p}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>

        {canEdit && (
          <>
            <div className="flex max-w-xs gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
                placeholder="e.g. SSS, NB, RTN"
                className="uppercase"
                maxLength={10}
              />
              <Button onClick={add} disabled={!input.trim()}>
                <Plus /> Add
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Default prefix:</span>
              <select
                value={def}
                onChange={(e) => setDef(e.target.value)}
                className="border-input bg-background h-8 rounded-md border px-2 text-sm"
                disabled={!prefixes.length}
              >
                {prefixes.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground text-xs">
                next: <span className="text-foreground font-mono">{(def || 'SSS') + '/' + fy + '/1'}</span>
              </span>
            </div>
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null} Save prefixes
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The Sales Order / Quotation bill's "Terms & Conditions" list — each line is
 *  shown with a small square bullet, above the Authorised Signatory. */
function OrderTermsCard({ canEdit }: { canEdit: boolean }) {
  const { data } = useOrderTerms();
  const save = useUpdateOrderTerms();
  const [terms, setTerms] = useState<string[]>([]);

  useEffect(() => {
    if (data) setTerms(data.terms);
  }, [data]);

  const setTerm = (i: number, value: string) => setTerms((t) => t.map((x, idx) => (idx === i ? value : x)));
  const remove = (i: number) => setTerms((t) => t.filter((_, idx) => idx !== i));
  const add = () => setTerms((t) => [...t, '']);

  const onSave = () => {
    const cleaned = terms.map((t) => t.trim()).filter(Boolean);
    if (!cleaned.length) return toast.error('Add at least one term.');
    save.mutate(
      { terms: cleaned },
      { onSuccess: () => { setTerms(cleaned); toast.success('Terms & Conditions saved'); }, onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')) },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Sales Order Terms &amp; Conditions</CardTitle>
        <p className="text-muted-foreground text-xs">Shown on the printed Sales Order bill, above the Authorised Signatory line.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {terms.length === 0 && <span className="text-muted-foreground text-sm">No terms yet.</span>}
          {terms.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="bg-foreground/70 size-2 shrink-0 rounded-[2px]" />
              <Input
                value={t}
                onChange={(e) => setTerm(i, e.target.value)}
                placeholder="e.g. Payment Should Be Made Within 30 Days"
                disabled={!canEdit}
                maxLength={300}
              />
              {canEdit && (
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-8 shrink-0 items-center justify-center rounded-full transition-colors"
                  onClick={() => remove(i)}
                  aria-label={`Remove term ${i + 1}`}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={add}>
              <Plus /> Add term
            </Button>
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null} Save terms
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


/** The Quotation bill's "Terms & Conditions" list — same layout as the Sales
 *  Order card above. Until saved here, the printed quotation keeps showing the
 *  Sales Order terms (the server falls back), so this card starts pre-filled
 *  with whatever the quotation currently prints. */
function QuotationTermsCard({ canEdit }: { canEdit: boolean }) {
  const { data } = useQuotationTerms();
  const save = useUpdateQuotationTerms();
  const [terms, setTerms] = useState<string[]>([]);

  useEffect(() => {
    if (data) setTerms(data.terms);
  }, [data]);

  const setTerm = (i: number, value: string) => setTerms((t) => t.map((x, idx) => (idx === i ? value : x)));
  const remove = (i: number) => setTerms((t) => t.filter((_, idx) => idx !== i));
  const add = () => setTerms((t) => [...t, '']);

  const onSave = () => {
    const cleaned = terms.map((t) => t.trim()).filter(Boolean);
    if (!cleaned.length) return toast.error('Add at least one term.');
    save.mutate(
      { terms: cleaned },
      { onSuccess: () => { setTerms(cleaned); toast.success('Quotation Terms & Conditions saved'); }, onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')) },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Quotation Terms &amp; Conditions</CardTitle>
        <p className="text-muted-foreground text-xs">
          Shown on the printed Quotation, above the Authorised Signatory line. Until saved here, the quotation shows the Sales Order terms.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {terms.length === 0 && <span className="text-muted-foreground text-sm">No terms yet.</span>}
          {terms.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="bg-foreground/70 size-2 shrink-0 rounded-[2px]" />
              <Input
                value={t}
                onChange={(e) => setTerm(i, e.target.value)}
                placeholder="e.g. This quotation is valid for 15 days"
                disabled={!canEdit}
                maxLength={300}
              />
              {canEdit && (
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-8 shrink-0 items-center justify-center rounded-full transition-colors"
                  onClick={() => remove(i)}
                  aria-label={`Remove term ${i + 1}`}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={add}>
              <Plus /> Add term
            </Button>
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null} Save terms
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The Challan / Tax Invoice bill's "Terms & Conditions" list — same layout as the
 *  Sales Order card above, but its own list and empty by default (nothing is
 *  printed until the business adds terms here). */
/**
 * Which optional fields the Challan form shows.
 *
 * Shipping Address was hidden behind a hard-coded constant in the form, so
 * bringing it back needed a code change and a deploy. The value has always been
 * saved on the challan (defaulting to the billing address) — this only decides
 * whether the field is on screen, so switching it either way is safe and loses
 * nothing.
 */
/**
 * Reminder quiet hours, for THIS user (spec: PWA reminder DND).
 *
 * Deliberately per-user and not part of the app-wide CRM reminder settings:
 * those decide when a follow-up becomes DUE, which is a business rule and the
 * same for everybody. This decides whether this particular person is disturbed
 * by it. The owner and a floor operator keep different hours.
 *
 * A reminder that falls inside the window is delayed, not cancelled - it is
 * still in the CRM and on the bell, and pushes once the window closes.
 */
function ReminderDndCard() {
  const { data } = useNotificationDnd();
  const update = useUpdateNotificationDnd();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  useEffect(() => {
    if (data) {
      setStart(data.start);
      setEnd(data.end);
    }
  }, [data]);

  const enabled = data?.enabled ?? false;
  const dirty = !!data && (start !== data.start || end !== data.end);
  // Shared with the server so the badge and the actual decision cannot disagree.
  const quietNow = isWithinDnd(data);

  const save = (next: { enabled?: boolean; start?: string; end?: string }) =>
    update.mutate(
      { enabled: next.enabled ?? enabled, start: next.start ?? start, end: next.end ?? end },
      {
        onSuccess: (v) => toast.success(v.enabled ? `Quiet hours on, ${v.start} to ${v.end}` : 'Quiet hours off'),
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not save')),
      },
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-[15px]">
          <BellOff className="size-4 text-indigo-600" /> Reminder quiet hours
          {quietNow && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10.5px] font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
              Quiet right now
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="min-w-0">
            <Label className="text-[13px] font-semibold">Do not disturb me</Label>
            <p className="text-muted-foreground mt-0.5 text-[12px]">
              Follow-up reminders will not be pushed to you during these hours. Nothing is lost - a reminder that falls in the
              window arrives once it ends, and stays visible in CRM and on the bell meanwhile. This setting is yours alone.
            </p>
          </div>
          <Switch checked={enabled} disabled={update.isPending} onCheckedChange={(v) => save({ enabled: v })} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="dnd-from" className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
              From
            </Label>
            <Input
              id="dnd-from"
              type="time"
              value={start}
              disabled={!enabled}
              onChange={(e) => setStart(e.target.value)}
              className="h-9 w-full tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dnd-to" className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
              Until
            </Label>
            <Input
              id="dnd-to"
              type="time"
              value={end}
              disabled={!enabled}
              onChange={(e) => setEnd(e.target.value)}
              className="h-9 w-full tabular-nums"
            />
          </div>
        </div>

        <p className="text-muted-foreground text-[11.5px]">
          {start && end && start > end
            ? `Crosses midnight - quiet from ${start} tonight until ${end} tomorrow.`
            : 'Set the end earlier than the start to cover overnight, e.g. 21:00 to 08:00.'}
        </p>

        {dirty && (
          <Button size="sm" disabled={update.isPending} onClick={() => save({})}>
            {update.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save quiet hours
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ChallanFieldsCard({ canEdit }: { canEdit: boolean }) {
  const { data } = useChallanFields();
  const update = useUpdateChallanFields();
  const on = data?.showShippingAddress ?? false;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <SlidersHorizontal className="size-4 text-indigo-600" /> Challan form fields
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="min-w-0">
            <Label className="text-[13px] font-semibold">Shipping Address</Label>
            <p className="text-muted-foreground mt-0.5 text-[12px]">
              Show the Shipping Address box under Charges &amp; shipping details on the Challan form. When hidden, the challan
              still stores a shipping address — it just copies the billing address instead of being typed.
            </p>
          </div>
          <Switch
            checked={on}
            disabled={!canEdit || update.isPending}
            onCheckedChange={(v) =>
              update.mutate(
                { showShippingAddress: v },
                {
                  onSuccess: () => toast.success(v ? 'Shipping Address is now shown' : 'Shipping Address is now hidden'),
                  onError: (e) => toast.error(getApiErrorMessage(e, 'Could not save')),
                },
              )
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ChallanTermsCard({ canEdit }: { canEdit: boolean }) {
  const { data } = useChallanTerms();
  const save = useUpdateChallanTerms();
  const [terms, setTerms] = useState<string[]>([]);

  useEffect(() => {
    if (data) setTerms(data.terms);
  }, [data]);

  const setTerm = (i: number, value: string) => setTerms((t) => t.map((x, idx) => (idx === i ? value : x)));
  const remove = (i: number) => setTerms((t) => t.filter((_, idx) => idx !== i));
  const add = () => setTerms((t) => [...t, '']);

  const onSave = () => {
    const cleaned = terms.map((t) => t.trim()).filter(Boolean);
    save.mutate(
      { terms: cleaned },
      { onSuccess: () => { setTerms(cleaned); toast.success('Terms & Conditions saved'); }, onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')) },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Challan Terms &amp; Conditions</CardTitle>
        <p className="text-muted-foreground text-xs">Shown on the printed Challan / Tax Invoice, above the Authorised Signatory line. Empty until you add some here.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {terms.length === 0 && <span className="text-muted-foreground text-sm">No terms yet — nothing is printed on the Challan.</span>}
          {terms.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="bg-foreground/70 size-2 shrink-0 rounded-[2px]" />
              <Input
                value={t}
                onChange={(e) => setTerm(i, e.target.value)}
                placeholder="e.g. Goods Once Sold Will Not Be Taken Back"
                disabled={!canEdit}
                maxLength={300}
              />
              {canEdit && (
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-8 shrink-0 items-center justify-center rounded-full transition-colors"
                  onClick={() => remove(i)}
                  aria-label={`Remove term ${i + 1}`}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={add}>
              <Plus /> Add term
            </Button>
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null} Save terms
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Global TCS % applied instead of TDS on SCRAP-category challans. Every save
 *  is recorded to the audit log with the old → new % (RecordHistory below). */
function TcsPercentCard({ canEdit }: { canEdit: boolean }) {
  const { data } = useTcsPercent();
  const save = useUpdateTcsPercent();
  const [value, setValue] = useState('');

  useEffect(() => {
    if (data) setValue(String(data.tcsPercent));
  }, [data]);

  const onSave = () => {
    const tcsPercent = Number(value);
    if (!Number.isFinite(tcsPercent) || tcsPercent < 0 || tcsPercent > 100) {
      toast.error('Enter a % between 0 and 100');
      return;
    }
    save.mutate(
      { tcsPercent },
      { onSuccess: () => toast.success('SCRAP TCS rate saved'), onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')) },
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">SCRAP TCS Rate</CardTitle>
          <p className="text-muted-foreground text-xs">
            Applied instead of TDS on challans for SCRAP-category customers. Changing it only affects challans saved afterwards.
          </p>
        </div>
        <RecordHistory resource={RESOURCES.SETTING} resourceId="TCS_PERCENT" label="SCRAP TCS Rate" />
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <div className="relative w-32">
          <Input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!canEdit}
            className="pr-7"
          />
          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm">%</span>
        </div>
        {canEdit && (
          <Button onClick={onSave} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Default bag threshold: how many bags a non-admin (no dispatch:override) may
 *  dispatch at once when the party has no threshold of its own set in Special
 *  Rates → Bag weight. Blank = no default limit. Every save is audit-logged. */
function DispatchBagThresholdCard({ canEdit }: { canEdit: boolean }) {
  const { data } = useDispatchBagThreshold();
  const save = useUpdateDispatchBagThreshold();
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue(data?.maxBagsPerDispatch != null ? String(data.maxBagsPerDispatch) : '');
  }, [data]);

  const onSave = () => {
    let maxBagsPerDispatch: number | null = null;
    if (value.trim() !== '') {
      maxBagsPerDispatch = Number(value);
      if (!Number.isFinite(maxBagsPerDispatch) || maxBagsPerDispatch <= 0) {
        toast.error('Enter a positive number of bags, or leave it blank for no default limit');
        return;
      }
    }
    save.mutate(
      { maxBagsPerDispatch },
      { onSuccess: () => toast.success('Default dispatch bag threshold saved'), onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')) },
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">Default Dispatch Bag Threshold</CardTitle>
          <p className="text-muted-foreground text-xs">
            Max bags a non-admin may dispatch in one go, when the party has no threshold of its own (Special Rates → Bag
            weight). Leave blank for no default limit — only party-specific thresholds would then apply.
          </p>
        </div>
        <RecordHistory resource={RESOURCES.SETTING} resourceId="DISPATCH_BAG_THRESHOLD" label="Default Dispatch Bag Threshold" />
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <div className="w-32">
          <Input type="number" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} disabled={!canEdit} placeholder="No limit" />
        </div>
        {canEdit && (
          <Button onClick={onSave} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** The Sales Order / Quotation bill's footer text, printed centered at the very
 *  bottom of the document. Use the token {DOC_TYPE} in a line to have it replaced
 *  with "SALES ORDER" or "QUOTATION" depending on which document is printed. */
function OrderFooterCard({ canEdit }: { canEdit: boolean }) {
  const { data } = useOrderFooter();
  const save = useUpdateOrderFooter();
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (data) setLines(data.lines);
  }, [data]);

  const setLine = (i: number, value: string) => setLines((l) => l.map((x, idx) => (idx === i ? value : x)));
  const remove = (i: number) => setLines((l) => l.filter((_, idx) => idx !== i));
  const add = () => setLines((l) => [...l, '']);

  const onSave = () => {
    const cleaned = lines.map((l) => l.trim()).filter(Boolean);
    if (!cleaned.length) return toast.error('Add at least one footer line.');
    save.mutate(
      { lines: cleaned },
      { onSuccess: () => { setLines(cleaned); toast.success('Footer text saved'); }, onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')) },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Sales Order footer text</CardTitle>
        <p className="text-muted-foreground text-xs">
          Printed centered at the bottom of the Sales Order / Quotation bill. Use{' '}
          <span className="font-mono">{'{DOC_TYPE}'}</span> in a line to show "SALES ORDER" or "QUOTATION" automatically.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {lines.length === 0 && <span className="text-muted-foreground text-sm">No footer lines yet.</span>}
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={l}
                onChange={(e) => setLine(i, e.target.value)}
                placeholder="e.g. ***THIS IS COMPUTER GENRATED {DOC_TYPE}***"
                disabled={!canEdit}
                maxLength={300}
              />
              {canEdit && (
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-8 shrink-0 items-center justify-center rounded-full transition-colors"
                  onClick={() => remove(i)}
                  aria-label={`Remove footer line ${i + 1}`}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={add}>
              <Plus /> Add line
            </Button>
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null} Save footer
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Read a file as a data URL. */
const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });

/** Downscale an image data URL to a max width, keeping PNG transparency. */
const downscale = (dataUrl: string, maxW = 360) =>
  new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')?.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

/** Company branding — stored for use on printable documents. The Sales Order /
 *  Quotation bill uses a fixed Kavish letterhead template instead of this logo. */
function CompanyCard({ canEdit }: { canEdit: boolean }) {
  const { data: company } = useCompany();
  const update = useUpdateCompany();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [logo, setLogo] = useState<string | null>(null);

  // Seed local state once the saved profile loads.
  useEffect(() => {
    if (company) {
      setName(company.name ?? '');
      setLogo(company.logo ?? null);
    }
  }, [company]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Please choose an image file (PNG or JPG).');
    if (file.size > 5 * 1024 * 1024) return toast.error('Image too large — max 5 MB.');
    try {
      const small = await downscale(await fileToDataUrl(file), 360);
      setLogo(small);
    } catch {
      toast.error('Could not read that image.');
    }
  };

  const save = () => {
    update.mutate(
      { name: name.trim() || null, logo },
      {
        onSuccess: () => toast.success('Company branding saved'),
        onError: (e) => toast.error(getApiErrorMessage(e, 'Save failed')),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Company branding</CardTitle>
        <p className="text-muted-foreground text-xs">Your logo &amp; name, stored for future printable documents. (The Sales Order / Quotation bill uses the fixed Kavish letterhead, not this logo.)</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="bg-muted/40 flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border">
            {logo ? (
              <img src={logo} alt="Company logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <ImageIcon className="text-muted-foreground size-7" />
            )}
          </div>
          {canEdit && (
            <div className="space-y-2">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload /> {logo ? 'Replace logo' : 'Upload logo'}
                </Button>
                {logo && (
                  <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setLogo(null)}>
                    <Trash2 /> Remove
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground text-xs">PNG or JPG. Resized to ~360px wide automatically.</p>
            </div>
          )}
        </div>

        {canEdit && (
          <div className="space-y-1.5">
            <Label>Company name (optional)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown next to the logo on documents" />
          </div>
        )}

        {canEdit && (
          <div>
            <Button onClick={save} disabled={update.isPending}>
              {update.isPending ? <Loader2 className="animate-spin" /> : null} Save branding
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GroupCard({
  meta,
  options,
  canEdit,
}: {
  meta: SettingGroupMeta;
  options: OrderOptionDto[];
  canEdit: boolean;
}) {
  const [value, setValue] = useState('');
  const create = useCreateOrderOption();
  const del = useDeleteOrderOption();

  const items = options
    .filter((o) => o.group === meta.group)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const add = () => {
    const v = value.trim();
    if (!v) return;
    if (meta.numeric && Number.isNaN(Number(v))) return toast.error('Enter a number');
    create.mutate(
      { group: meta.group, value: v },
      {
        onSuccess: () => setValue(''),
        onError: (e) => toast.error(getApiErrorMessage(e, 'Could not add')),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{meta.label}</CardTitle>
        <p className="text-muted-foreground text-xs">{meta.description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {items.length === 0 && <span className="text-muted-foreground text-sm">No options yet.</span>}
          {items.map((o) => (
            <span
              key={o.id}
              className="bg-muted inline-flex items-center gap-1.5 rounded-full border py-1 pr-1 pl-3 text-sm"
            >
              <span className="font-medium tabular-nums">{o.value}</span>
              {canEdit && (
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-5 items-center justify-center rounded-full transition-colors"
                  onClick={() =>
                    del.mutate(o.id, { onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')) })
                  }
                  aria-label={`Remove ${o.value}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>

        {canEdit && (
          <div className="flex max-w-xs gap-2">
            <Input
              type={meta.numeric ? 'number' : 'text'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
              placeholder={meta.placeholder}
              className={meta.numeric ? '' : 'uppercase'}
            />
            <Button onClick={add} disabled={create.isPending || !value.trim()}>
              <Plus /> Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
