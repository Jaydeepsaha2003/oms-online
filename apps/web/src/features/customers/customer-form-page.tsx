import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Contact,
  IndianRupee,
  Loader2,
  MapPin,
  Percent,
  Receipt,
  Save,
  Tags,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { type CustomerInput, parsePayByModes } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combo, NativeSelect } from '@/components/common/combo';
import { Switch } from '@/components/ui/switch';
import { CustomerGstRates } from '@/features/gst-rates/customer-gst-rates';
import { CustomerTransRates } from '@/features/trans-rates/customer-trans-rates';
import {
  useCreateCustomer,
  useCustomer,
  useCustomerLookups,
  useUpdateCustomer,
} from './use-customers';

const EMPTY = {
  partySource: '',
  agentName: '',
  category: '',
  partyName: '',
  billingRate: '',
  transportName: '',
  bagName: '',
  packing: '',
  freight: '',
  boxRate: '',
  creditPeriod: '',
  city: '',
  state: '',
  region: '',
  mobile: '',
  email: '',
  brand: '',
  billRatePc: '',
  payBy: '',
  // Per-bucket routing. '' = follow Pay By.
  payByBank: '',
  payByCash: '',
  tdsApplicable: false,
  tdsPercent: '',
  active: true,
};
type FormState = typeof EMPTY;

// Legacy Access placeholders ("N/A", "NA", "None", "-", …) stand in for a blank
// value. Treat them as empty when loading so they don't trip mobile/email
// validation every time an unrelated field (credit period, etc.) is saved; the
// cleared value is then persisted as null on the next save.
const PLACEHOLDERS = new Set(['', 'N/A', 'NA', 'N.A.', 'N.A', 'NONE', 'NIL', '-', '--']);
const cleanPlaceholder = (v: string | null | undefined): string => {
  const s = (v ?? '').trim();
  return PLACEHOLDERS.has(s.toUpperCase()) ? '' : s;
};

const numOrNull = (v: string): number | null => {
  const n = parseFloat(v);
  return v.trim() === '' || Number.isNaN(n) ? null : n;
};
const intOrNull = (v: string): number | null => {
  const n = parseInt(v, 10);
  return v.trim() === '' || Number.isNaN(n) ? null : n;
};

export function CustomerFormPage() {
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const isEdit = id != null;

  const { data: existing, isLoading: loadingCustomer } = useCustomer(id);
  const { data: lookups } = useCustomerLookups();
  const create = useCreateCustomer();
  const update = useUpdateCustomer(id ?? 0);
  const saving = create.isPending || update.isPending;

  const [form, setForm] = useState<FormState>(EMPTY);
  // Snapshot of the form as it was loaded — Save stays disabled until `form` differs.
  const [baseline, setBaseline] = useState<FormState>(EMPTY);
  const [tab, setTab] = useState<'details' | 'gst' | 'trans'>('details');
  const set = <K extends keyof FormState>(key: K, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!existing) return;
    const loaded: FormState = {
      partySource: existing.partySource ?? '',
      agentName: existing.agentName ?? '',
      category: existing.category ?? '',
      partyName: existing.partyName ?? '',
      billingRate: existing.billingRate?.toString() ?? '',
      transportName: existing.transportName ?? '',
      bagName: existing.bagName ?? '',
      packing: existing.packing?.toString() ?? '',
      freight: existing.freight?.toString() ?? '',
      boxRate: existing.boxRate?.toString() ?? '',
      creditPeriod: existing.creditPeriod?.toString() ?? '',
      city: existing.city ?? '',
      state: existing.state ?? '',
      region: existing.region ?? '',
      mobile: cleanPlaceholder(existing.mobile),
      email: cleanPlaceholder(existing.email),
      brand: existing.brand ?? '',
      billRatePc: existing.billRatePc?.toString() ?? '',
      payBy: existing.payBy ?? '',
      payByBank: parsePayByModes(existing.payByModes).bank ?? '',
      payByCash: parsePayByModes(existing.payByModes).cash ?? '',
      tdsApplicable: existing.tdsApplicable ?? false,
      tdsPercent: existing.tdsPercent?.toString() ?? '',
      active: existing.active ?? true,
    };
    setForm(loaded);
    setBaseline(loaded);
  }, [existing]);

  const isSelf = form.partySource === 'SELF';
  // Only allow saving when the form actually differs from what was loaded.
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);

  const onPartySource = (value: string) => {
    setForm((f) => ({
      ...f,
      partySource: value,
      agentName: value === 'SELF' ? 'SELF' : f.agentName === 'SELF' ? '' : f.agentName,
    }));
  };

  // Selecting a known transporter auto-fills packing & freight (legacy behavior).
  const onTransportName = (value: string) => {
    const match = lookups?.transporters.find(
      (t) => t.name.toLowerCase() === value.trim().toLowerCase(),
    );
    setForm((f) => ({
      ...f,
      transportName: value,
      ...(match
        ? { packing: match.packing?.toString() ?? '', freight: match.freight?.toString() ?? '' }
        : {}),
    }));
  };

  const submit = () => {
    const required: [string, string][] = [
      ['Party Source', form.partySource],
      ...(isSelf ? [] : ([['Agent Name', form.agentName]] as [string, string][])),
      ['Category', form.category],
      ['Party Name', form.partyName],
      ['Transport Name', form.transportName],
      ['Credit Period', form.creditPeriod],
      ['City', form.city],
      ['State', form.state],
      ['Region', form.region],
    ];
    const missing = required.filter(([, v]) => !v.trim()).map(([l]) => l);
    if (missing.length) {
      toast.error(`Required: ${missing.join(', ')}`);
      return;
    }

    if (form.mobile.trim() && !/^\+?[0-9][0-9\s\-()]{6,18}$/.test(form.mobile.trim())) {
      toast.error('Enter a valid mobile number');
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error('Enter a valid email address');
      return;
    }
    if (form.tdsApplicable && form.tdsPercent.trim() === '') {
      toast.error('Enter the TDS % (or turn TDS Applicable off)');
      return;
    }

    const input: CustomerInput = {
      partySource: form.partySource || null,
      agentName: form.agentName || null,
      category: form.category || null,
      partyName: form.partyName.trim(),
      billingRate: numOrNull(form.billingRate),
      transportName: form.transportName || null,
      bagName: form.bagName || null,
      packing: numOrNull(form.packing),
      freight: numOrNull(form.freight),
      boxRate: intOrNull(form.boxRate),
      creditPeriod: intOrNull(form.creditPeriod),
      city: form.city || null,
      state: form.state || null,
      region: form.region || null,
      mobile: form.mobile || null,
      email: form.email || null,
      brand: form.brand || null,
      billRatePc: numOrNull(form.billRatePc),
      payBy: form.payBy || null,
      // Only the buckets actually overridden are sent; the server drops an empty
      // object to null so "follows Pay By" has one representation, not two.
      payByModes: JSON.stringify({
        ...(form.payByBank ? { bank: form.payByBank } : {}),
        ...(form.payByCash ? { cash: form.payByCash } : {}),
      }),
      tdsApplicable: form.tdsApplicable,
      tdsPercent: form.tdsApplicable ? numOrNull(form.tdsPercent) : null,
      active: form.active,
    };

    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'Customer updated' : 'Customer created');
        navigate('/customers');
      },
      onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed')),
    };
    if (isEdit) update.mutate(input, opts);
    else create.mutate(input, opts);
  };

  useSaveShortcut(submit);

  if (isEdit && loadingCustomer) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-3 font-sans">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate('/customers')} aria-label="Back">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="bg-gradient-brand flex size-9 items-center justify-center rounded-[4px] text-white shadow-md shadow-blue-600/20 ring-1 ring-white/20">
          <Contact className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-[17px] leading-tight font-bold tracking-tight">
            {isEdit ? 'Edit customer' : 'New customer'}
          </h2>
          <p className="text-muted-foreground truncate text-[11.5px] font-medium">
            {isEdit
              ? (existing?.partyName ?? `#${id}`)
              : 'Add a new party to the customer master'}
          </p>
        </div>
        {isEdit && existing?.code && (
          <span className="ml-auto shrink-0 rounded-[4px] border bg-muted px-2.5 py-1 text-[11.5px] font-bold tabular-nums text-muted-foreground">
            {existing.code}
          </span>
        )}
      </div>

      {/* Tabs — manage the customer's details, GST rates and transport rates in one place. */}
      {isEdit && existing?.partyName && (
        <div className="inline-flex flex-wrap items-center gap-1 rounded-[4px] border border-amber-300 bg-amber-50/40 p-0.5 dark:border-amber-400/40">
          {(
            [
              { id: 'details' as const, label: 'Details', icon: Contact },
              { id: 'gst' as const, label: 'GST Rates', icon: Percent },
              { id: 'trans' as const, label: 'Transport Rates', icon: Receipt },
            ]
          ).map(({ id: tabId, label, icon: Icon }) => {
            const on = tab === tabId;
            return (
              <button
                key={tabId}
                type="button"
                onClick={() => setTab(tabId)}
                aria-pressed={on}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 rounded-[3px] px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors duration-150',
                  on
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-200/70 dark:hover:bg-amber-400/10',
                )}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            );
          })}
        </div>
      )}

      {isEdit && existing?.partyName && tab === 'gst' && (
        <Card className="gap-0 overflow-hidden rounded-[4px] py-0">
          <CardHeader className="flex-row items-center gap-2.5 border-b bg-muted/30 py-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[4px] bg-primary/10 text-primary">
              <Percent className="size-3.5" />
            </span>
            <div className="space-y-0">
              <CardTitle className="text-[13px] font-bold">GST rates</CardTitle>
              <p className="text-muted-foreground text-[11px] font-medium">GST % per product category for this customer</p>
            </div>
          </CardHeader>
          <CardContent className="py-4">
            <CustomerGstRates customerName={existing.partyName} />
          </CardContent>
        </Card>
      )}

      {isEdit && existing?.partyName && tab === 'trans' && (
        <Card className="gap-0 overflow-hidden rounded-[4px] py-0">
          <CardHeader className="flex-row items-center gap-2.5 border-b bg-muted/30 py-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[4px] bg-primary/10 text-primary">
              <Receipt className="size-3.5" />
            </span>
            <div className="space-y-0">
              <CardTitle className="text-[13px] font-bold">Transport rates</CardTitle>
              <p className="text-muted-foreground text-[11px] font-medium">
                Rate per category × type (PACKING / FREIGHT) for this customer
              </p>
            </div>
          </CardHeader>
          <CardContent className="py-4">
            <CustomerTransRates customerName={existing.partyName} />
          </CardContent>
        </Card>
      )}

      <form
        hidden={tab !== 'details'}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-3 [&_input]:uppercase [&_input::placeholder]:normal-case"
      >
        <Section icon={Tags} title="Classification" desc="How this party is sourced and categorised">
          <Field label="Party Source" required>
            <NativeSelect
              value={form.partySource}
              onChange={onPartySource}
              options={lookups?.partySources ?? ['SELF', 'AGENT']}
            />
          </Field>
          <Field label="Agent Name" required={!isSelf}>
            <Combo
              value={form.agentName}
              onChange={(v) => set('agentName', v)}
              options={lookups?.agents ?? []}
              disabled={isSelf}
              placeholder="Type to add a new agent…"
            />
          </Field>
          <Field label="Category" required>
            <Combo value={form.category} onChange={(v) => set('category', v)} options={lookups?.categories ?? []} />
          </Field>
          <Field label="Brand">
            <Combo value={form.brand} onChange={(v) => set('brand', v)} options={lookups?.brands ?? []} />
          </Field>
        </Section>

        <Section icon={Contact} title="Party details" desc="Name and how to reach them">
          <Field label="Party Name" required className="sm:col-span-2 lg:col-span-2">
            <Input value={form.partyName} onChange={(e) => set('partyName', e.target.value)} />
          </Field>
          <Field label="Mobile">
            <Input type="tel" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
        </Section>

        <Section icon={Truck} title="Transport & packing">
          <Field label="Transport Name" required>
            <Combo
              value={form.transportName}
              onChange={onTransportName}
              options={(lookups?.transporters ?? []).map((t) => t.name)}
            />
          </Field>
          <Field label="Packing">
            <Input type="number" step="any" value={form.packing} onChange={(e) => set('packing', e.target.value)} />
          </Field>
          <Field label="Freight">
            <Input type="number" step="any" value={form.freight} onChange={(e) => set('freight', e.target.value)} />
          </Field>
          <Field label="Bag Name">
            <Input value={form.bagName} onChange={(e) => set('bagName', e.target.value)} />
          </Field>
          <Field label="Box Rate">
            <Input type="number" value={form.boxRate} onChange={(e) => set('boxRate', e.target.value)} />
          </Field>
        </Section>

        <Section icon={IndianRupee} title="Pricing & terms">
          <Field label="Billing Rate/KGS">
            <Input type="number" step="any" value={form.billingRate} onChange={(e) => set('billingRate', e.target.value)} />
          </Field>
          <Field label="Billing Rate/Pcs">
            <Input type="number" step="any" value={form.billRatePc} onChange={(e) => set('billRatePc', e.target.value)} />
          </Field>
          <Field label="Pay By">
            <NativeSelect
              value={form.payBy}
              onChange={(v) => set('payBy', v)}
              options={lookups?.payBys ?? ['PARTY', 'AGENT']}
            />
          </Field>
          {/* Per-bucket routing, for the common case of a party that pays its
              bank transfers directly while its agent hands over the cash.
              Blank follows Pay By, so an untouched customer behaves as before. */}
          <Field label="Pay By — Bank">
            <NativeSelect
              value={form.payByBank}
              onChange={(v) => set('payByBank', v)}
              options={['', ...(lookups?.payBys ?? ['PARTY', 'AGENT'])]}
              placeholder={`Same as Pay By (${form.payBy || 'PARTY'})`}
            />
          </Field>
          <Field label="Pay By — Cash">
            <NativeSelect
              value={form.payByCash}
              onChange={(v) => set('payByCash', v)}
              options={['', ...(lookups?.payBys ?? ['PARTY', 'AGENT'])]}
              placeholder={`Same as Pay By (${form.payBy || 'PARTY'})`}
            />
          </Field>
          <Field label="Credit Period" required>
            <Input type="number" value={form.creditPeriod} onChange={(e) => set('creditPeriod', e.target.value)} />
          </Field>
          <Field label="TDS Applicable">
            <div className="flex h-9 items-center gap-2">
              <Switch
                checked={form.tdsApplicable}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, tdsApplicable: v, tdsPercent: v ? f.tdsPercent : '' }))
                }
              />
              <span className="text-muted-foreground text-[12.5px] font-medium">{form.tdsApplicable ? 'Yes' : 'No'}</span>
            </div>
          </Field>
          <Field label="Party Status">
            <div className="flex h-9 items-center gap-2">
              <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
              <span className={cn('text-[12.5px] font-bold', form.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                {form.active ? 'ACTIVE' : 'INACTIVE'}
              </span>
              {!form.active && <span className="text-muted-foreground text-[11px] font-medium">— hidden from all pickers</span>}
            </div>
          </Field>
          {form.tdsApplicable && (
            <Field label="TDS %" required>
              <Input
                type="number"
                step="any"
                inputMode="decimal"
                autoFocus
                value={form.tdsPercent}
                onChange={(e) => set('tdsPercent', e.target.value)}
              />
            </Field>
          )}
        </Section>

        <Section icon={MapPin} title="Location">
          <Field label="City" required>
            <Combo value={form.city} onChange={(v) => set('city', v)} options={lookups?.cities ?? []} />
          </Field>
          <Field label="State" required>
            <Combo value={form.state} onChange={(v) => set('state', v)} options={lookups?.states ?? []} />
          </Field>
          <Field label="Region" required>
            <Combo value={form.region} onChange={(v) => set('region', v)} options={lookups?.regions ?? []} />
          </Field>
        </Section>

        {/* Action bar: sits at the end of the form and scrolls with the page —
            not pinned, so it never overlaps the last fields on short screens. */}
        <div className="flex items-center justify-end gap-2 border-t px-1 py-2.5">
          <Button type="button" variant="outline" className="rounded-[4px] font-semibold" onClick={() => navigate('/customers')}>
            Cancel
          </Button>
          <Button type="submit" className="rounded-[4px] font-bold" disabled={saving || !dirty}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {isEdit ? 'Save changes' : 'Create customer'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: LucideIcon;
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 overflow-hidden rounded-[4px] py-0">
      <CardHeader className="flex-row items-center gap-2.5 border-b bg-muted/30 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[4px] bg-primary/10 text-primary">
          <Icon className="size-3.5" />
        </span>
        <div className="space-y-0">
          <CardTitle className="text-[13px] font-bold">{title}</CardTitle>
          {desc && <p className="text-muted-foreground text-[11px] font-medium">{desc}</p>}
        </div>
      </CardHeader>
      <CardContent className="py-4">
        <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label className="text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}
