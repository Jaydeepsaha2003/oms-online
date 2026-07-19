import { useEffect, useRef, useState } from 'react';
import { ImageIcon, Loader2, Plus, Settings as SettingsIcon, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { SETTING_GROUP_META, type OrderOptionDto, type SettingGroupMeta } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { useChallanPrefixSettings, useSaveChallanPrefixSettings } from '@/features/challans/use-challans';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAutoSizePcs } from '@/lib/auto-size-pcs';
import { AccessImportCard } from './access-import-card'; // MS Access connector — Access stays a live parallel data source
import { CrmReminderCard } from '@/features/crm/crm-settings-card';
import { MyDevicesCard } from './my-devices-card';
import { TestNotificationCard } from './test-notification-card';
import {
  useChallanTerms,
  useCompany,
  useCreateOrderOption,
  useDeleteOrderOption,
  useOrderFooter,
  useOrderTerms,
  useSettings,
  useUpdateChallanTerms,
  useUpdateCompany,
  useUpdateOrderFooter,
  useUpdateOrderTerms,
} from './use-settings';

export function SettingsPage() {
  const { data: all, isLoading } = useSettings();
  const { can } = usePermissions();
  const canEdit = can('setting:update');

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-gradient-brand flex size-10 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/20">
          <SettingsIcon className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
          <p className="text-muted-foreground text-sm">Manage the option lists used across the app.</p>
        </div>
      </div>

      <MyDevicesCard />

      <TestNotificationCard />

      <CompanyCard canEdit={canEdit} />

      <OrderTermsCard canEdit={canEdit} />

      <OrderFooterCard canEdit={canEdit} />

      <ChallanTermsCard canEdit={canEdit} />

      {canEdit && <AccessImportCard />}

      <PreferencesCard />

      <ChallanPrefixCard canEdit={canEdit} />

      <CrmReminderCard />

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

/** The Challan / Tax Invoice bill's "Terms & Conditions" list — same layout as the
 *  Sales Order card above, but its own list and empty by default (nothing is
 *  printed until the business adds terms here). */
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
