import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomerInput } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Combo, NativeSelect } from '@/components/common/combo';
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
};
type FormState = typeof EMPTY;

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
  const set = <K extends keyof FormState>(key: K, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!existing) return;
    setForm({
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
      mobile: existing.mobile ?? '',
      email: existing.email ?? '',
      brand: existing.brand ?? '',
      billRatePc: existing.billRatePc?.toString() ?? '',
      payBy: existing.payBy ?? '',
    });
  }, [existing]);

  const isSelf = form.partySource === 'SELF';

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

  if (isEdit && loadingCustomer) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/customers')} aria-label="Back">
          <ArrowLeft />
        </Button>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {isEdit ? `Edit customer #${id}` : 'New customer'}
          </h2>
          <p className="text-muted-foreground text-sm">
            {isEdit ? (existing?.partyName ?? '') : 'Add a new party to the customer master'}
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                />
              </Field>
              <Field label="Category" required>
                <Combo value={form.category} onChange={(v) => set('category', v)} options={lookups?.categories ?? []} />
              </Field>

              <Field label="Party Name" required className="lg:col-span-2">
                <Input value={form.partyName} onChange={(e) => set('partyName', e.target.value)} />
              </Field>
              <Field label="Brand">
                <Combo value={form.brand} onChange={(v) => set('brand', v)} options={lookups?.brands ?? []} />
              </Field>

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
              <Field label="Credit Period" required>
                <Input type="number" value={form.creditPeriod} onChange={(e) => set('creditPeriod', e.target.value)} />
              </Field>

              <Field label="Billing Rate">
                <Input type="number" step="any" value={form.billingRate} onChange={(e) => set('billingRate', e.target.value)} />
              </Field>
              <Field label="Bill Rate / Pc">
                <Input type="number" step="any" value={form.billRatePc} onChange={(e) => set('billRatePc', e.target.value)} />
              </Field>
              <Field label="Pay By">
                <NativeSelect
                  value={form.payBy}
                  onChange={(v) => set('payBy', v)}
                  options={lookups?.payBys ?? ['PARTY', 'AGENT']}
                />
              </Field>

              <Field label="City" required>
                <Combo value={form.city} onChange={(v) => set('city', v)} options={lookups?.cities ?? []} />
              </Field>
              <Field label="State" required>
                <Combo value={form.state} onChange={(v) => set('state', v)} options={lookups?.states ?? []} />
              </Field>
              <Field label="Region" required>
                <Combo value={form.region} onChange={(v) => set('region', v)} options={lookups?.regions ?? []} />
              </Field>

              <Field label="Mobile">
                <Input type="tel" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} />
              </Field>
              <Field label="Email" className="lg:col-span-2">
                <Input value={form.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate('/customers')}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                {isEdit ? 'Save changes' : 'Create customer'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
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
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-xs">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}
