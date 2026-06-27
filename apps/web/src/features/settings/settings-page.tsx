import { useEffect, useRef, useState } from 'react';
import { ImageIcon, Loader2, Plus, Settings as SettingsIcon, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { SETTING_GROUP_META, type OrderOptionDto, type SettingGroupMeta } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { usePermissions } from '@/hooks/use-permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAutoSizePcs } from '@/lib/auto-size-pcs';
import { AccessImportCard } from './access-import-card'; // TEMP: MS Access connector — delete this import + usage to remove
import { useCompany, useCreateOrderOption, useDeleteOrderOption, useSettings, useUpdateCompany } from './use-settings';

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

      <CompanyCard canEdit={canEdit} />

      {canEdit && <AccessImportCard />}

      <PreferencesCard />

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

/** Company branding — the logo is printed on order bills, invoices and quotations. */
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
        <p className="text-muted-foreground text-xs">Your logo &amp; name printed on the order bill, invoice and quotations.</p>
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
