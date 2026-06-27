/**
 * TEMPORARY: MS Access → OMS data import card (Settings).
 * Delete this file + its <AccessImportCard/> usage in settings-page.tsx to remove.
 */
import { useEffect, useRef, useState } from 'react';
import { DatabaseZap, Eye, FileUp, Loader2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage, http } from '@/lib/api';
import { useConfirm } from '@/components/common/confirm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

interface ImportResult {
  ok: boolean;
  dry: boolean;
  fileName: string;
  results: { section: string; counts: Record<string, number> }[];
}

// Friendly groups → backend section keys.
const GROUPS = [
  { key: 'masters', label: 'Masters', detail: 'Customers, products, designs, transporters, GST & transport rates, price-calc, agents', sections: ['masters', 'pricecal', 'agents'] },
  { key: 'special', label: 'Special rates', detail: 'Customer rate overrides + logo restrictions', sections: ['special'] },
  { key: 'txn', label: 'Orders & Dispatch', detail: 'Order history + dispatch records (replaces existing orders)', sections: ['orders', 'dispatch'] },
] as const;

export function AccessImportCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({ masters: true, special: true, txn: true });
  const [busy, setBusy] = useState<null | 'preview' | 'import'>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    http
      .get<{ supported: boolean }>('/access-import/status')
      .then((s) => setSupported(s.supported))
      .catch(() => setSupported(false));
  }, []);

  const run = async (dry: boolean) => {
    if (!file) return toast.error('Choose a .accdb file first');
    const sections = GROUPS.filter((g) => picked[g.key]).flatMap((g) => g.sections);
    if (sections.length === 0) return toast.error('Select at least one data group');
    if (!dry) {
      const ok = await confirm({
        title: 'Import data into the database?',
        description:
          'This writes to the live database. Masters are merged (matched by name/key); Orders & Dispatch REPLACE the existing order history.',
        confirmText: 'Import now',
      });
      if (!ok) return;
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('sections', sections.join(','));
    fd.append('dry', String(dry));
    setBusy(dry ? 'preview' : 'import');
    setResult(null);
    try {
      const res = await http.post<ImportResult>('/access-import/run', fd);
      setResult(res);
      toast.success(dry ? 'Preview complete — nothing was written' : 'Import complete — data written to the database');
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Import failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-amber-300/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <DatabaseZap className="size-4 text-amber-600" /> Data import — MS Access
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Temporary</span>
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Upload your legacy <code>.accdb</code> to import it into this database. Runs on the Windows host (uses the MS
          Access engine). Remove this tool any time once you&apos;re done.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {supported === false ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <TriangleAlert className="size-4" /> Not available — the server is not running on a Windows host with the
            MS Access engine.
          </div>
        ) : (
          <>
            {/* File picker */}
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept=".accdb,.mdb" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <FileUp /> {file ? 'Change file' : 'Choose .accdb'}
              </Button>
              <span className="text-muted-foreground truncate text-sm">
                {file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)` : 'No file selected'}
              </span>
            </div>

            {/* Section toggles */}
            <div className="space-y-2">
              {GROUPS.map((g) => (
                <label key={g.key} className="flex items-start justify-between gap-4">
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{g.label}</span>
                    <span className="text-muted-foreground block text-xs">{g.detail}</span>
                  </span>
                  <Switch checked={!!picked[g.key]} onCheckedChange={(v) => setPicked((p) => ({ ...p, [g.key]: v }))} />
                </label>
              ))}
            </div>

            {/* Actions: explicit Preview vs Import */}
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button type="button" variant="outline" onClick={() => run(true)} disabled={!!busy || !file}>
                {busy === 'preview' ? <Loader2 className="animate-spin" /> : <Eye />} Preview (no changes)
              </Button>
              <Button type="button" onClick={() => run(false)} disabled={!!busy || !file}>
                {busy === 'import' ? <Loader2 className="animate-spin" /> : <DatabaseZap />} Import now
              </Button>
              <span className="text-muted-foreground text-xs">Preview = counts only · Import now = writes to the database</span>
            </div>

            <p className="text-xs text-amber-700">
              <TriangleAlert className="mr-1 inline size-3.5 align-[-2px]" />
              Masters are merged (matched by name/key). <b>Orders &amp; Dispatch replace</b> the existing order history.
            </p>

            {/* Results */}
            {result && (
              <div className="space-y-2 rounded-lg border bg-slate-50/70 p-3">
                <div className="text-sm font-semibold">
                  {result.dry ? 'Preview' : 'Imported'} — {result.fileName}
                </div>
                {result.results.map((sec) => (
                  <div key={sec.section} className="text-sm">
                    <span className="font-medium text-slate-700">{sec.section}</span>
                    <div className="text-muted-foreground ml-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                      {Object.entries(sec.counts).map(([label, n]) => (
                        <span key={label} className="tabular-nums">
                          {label}: <b className="text-slate-700">{n.toLocaleString()}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default AccessImportCard;
