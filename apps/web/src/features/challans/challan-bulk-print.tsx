import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CheckCircle2, Download, Loader2, Printer, TriangleAlert } from 'lucide-react';
import type { ChallanDto } from '@oms/shared';
import { http } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { buildBillFilename, captureScale, waitForPaintable } from '@/lib/pdf';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useChallanTerms, useCompany } from '@/features/settings/use-settings';
import { ChallanInvoice, challanTermsFor, pcsLineCount } from './challan-invoice';

/** One selected challan, once it has been loaded and its options answered. */
interface Job {
  challan: ChallanDto;
  /** Print Kgs on the PCS-sold (cup) lines? Defaults to No, matching the
   *  single-challan question's highlighted answer. */
  kgsForPcs: boolean;
  status: 'pending' | 'working' | 'done' | 'failed';
  error?: string;
}

/**
 * Save a batch of challans — one PDF per challan, not one merged file.
 *
 * Each challan is rendered through the SAME {@link ChallanInvoice} the single
 * print uses and captured the same way, so a batch of ten comes out identical
 * to printing those ten one at a time. That is the whole reason the invoice was
 * extracted into a component: the PDF is a raster of that DOM, so any second
 * implementation would quietly produce different-looking invoices.
 *
 * SAVES rather than prints, and that is not a shortcut: `window.print()` always
 * raises the browser's own dialog and no API exists to bypass it, so printing
 * five challans meant clicking through five previews — which is exactly what
 * selecting five was meant to avoid. Writing the files is genuinely unattended,
 * and the folder can then print all five in one action.
 *
 * The cup question is asked UP FRONT for every challan that has PCS-sold lines,
 * listed in the order they will be written, rather than interrupting the run
 * ten times. Answer them all, press save once, walk away.
 */
export function ChallanBulkPrint({
  ids,
  onClose,
  onPrinted,
}: {
  /** Selected challan ids, in the order they should be written. */
  ids: number[];
  onClose: () => void;
  /** Fired once every challan has been written. */
  onPrinted?: () => void;
}) {
  const { data: termsData } = useChallanTerms();
  const { data: company } = useCompany();

  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'asking' | 'printing' | 'done'>('loading');
  const [at, setAt] = useState(0);
  const cancelled = useRef(false);

  // Unmounting mid-run must stop it too, or a closed dialog keeps writing files.
  useEffect(() => () => { cancelled.current = true; }, []);

  // Load every selected challan up front: the questions below need to know
  // which of them actually have cup lines, and a half-answered batch that then
  // fails to load a challan mid-print is worse than failing here.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const loaded = await Promise.all(ids.map((id) => http.get<ChallanDto>(`/challans/${id}`)));
        if (!live) return;
        setJobs(loaded.map((challan) => ({ challan, kgsForPcs: false, status: 'pending' })));
        setPhase('asking');
      } catch {
        if (live) setLoadError('Could not load the selected challans. Close this and try again.');
      }
    })();
    return () => { live = false; };
  }, [ids]);

  /** The ones the cup question applies to — a challan with no PCS line has
   *  nothing to decide, so it is never put to the user. */
  const asking = useMemo(() => (jobs ?? []).filter((j) => pcsLineCount(j.challan) > 0), [jobs]);

  const setKgs = (id: number, value: boolean) =>
    setJobs((prev) => (prev ?? []).map((j) => (j.challan.id === id ? { ...j, kgsForPcs: value } : j)));

  const setAllKgs = (value: boolean) =>
    setJobs((prev) => (prev ?? []).map((j) => (pcsLineCount(j.challan) > 0 ? { ...j, kgsForPcs: value } : j)));

  /**
   * Render one challan off-screen, capture it, and write it out as its own PDF.
   *
   * Mounted into a detached root rather than rendered by this component: the
   * capture has to happen for challan N while the dialog on screen keeps
   * showing progress, and each mount has to be torn down before the next so
   * only one invoice is ever in the DOM under a given id.
   */
  const printOne = async (job: Job): Promise<void> => {
    const holder = document.createElement('div');
    // Off-screen but genuinely laid out — `display:none` has no box, so
    // html2canvas would capture nothing.
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:960px;background:#ffffff;z-index:-1';
    document.body.appendChild(holder);
    let root: Root | null = null;
    try {
      root = createRoot(holder);
      const domId = `bulk-invoice-${job.challan.id}`;
      // flushSync so the markup exists before we go looking for it — a normal
      // render is async and the capture would race an empty holder.
      flushSync(() => {
        root!.render(
          <ChallanInvoice
            challan={job.challan}
            terms={challanTermsFor(termsData?.terms, job.challan)}
            logoSrc={company?.logo ?? null}
            companyName={company?.name ?? null}
            kgsForPcs={job.kgsForPcs}
            domId={domId}
          />,
        );
      });
      const node = document.getElementById(domId);
      if (!node) throw new Error('The invoice did not render');
      // Fonts + the logo must have decoded, or the capture catches a collapsed
      // header — the same reason the single print waits.
      await waitForPaintable(node);

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas-pro'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(node, { scale: captureScale(), backgroundColor: '#ffffff' });
      const dataURL = canvas.toDataURL('image/jpeg', 0.95);
      if (!dataURL.startsWith('data:image/')) throw new Error('Canvas capture failed');

      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      const margin = 4;
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW - margin * 2;
      const imgH = (canvas.height / canvas.width) * imgW;
      const contentH = pageH - margin * 2;
      if (imgH <= contentH) {
        pdf.addImage(dataURL, 'JPEG', margin, margin, imgW, imgH);
      } else {
        let y = 0;
        let first = true;
        while (y < imgH) {
          if (!first) pdf.addPage();
          pdf.addImage(dataURL, 'JPEG', margin, margin - y, imgW, imgH);
          y += contentH;
          first = false;
        }
      }

      const filename = buildBillFilename('Challan', job.challan.code, `challan-${job.challan.id}`);
      saveBlobSilently(pdf.output('blob'), filename);
    } finally {
      // Unmount on a later tick — React refuses to unmount a root while it is
      // still rendering, which is exactly where flushSync leaves us.
      const r = root;
      setTimeout(() => {
        try { r?.unmount(); } catch { /* already gone */ }
        holder.remove();
      }, 0);
    }
  };

  /** Abort the rest of the run. The challan being written finishes (it is
   *  already rasterised); nothing after it is started. */
  const stop = () => {
    cancelled.current = true;
    setPhase('done');
  };

  const run = async () => {
    const list = jobs ?? [];
    if (!list.length) return;
    cancelled.current = false;
    setPhase('printing');
    for (let i = 0; i < list.length; i++) {
      if (cancelled.current) return;
      setAt(i);
      setJobs((prev) => (prev ?? []).map((j, k) => (k === i ? { ...j, status: 'working' } : j)));
      try {
        await printOne(list[i]);
        setJobs((prev) => (prev ?? []).map((j, k) => (k === i ? { ...j, status: 'done' } : j)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Print failed';
        setJobs((prev) => (prev ?? []).map((j, k) => (k === i ? { ...j, status: 'failed', error: msg } : j)));
        // Carry on with the rest — one bad challan should not strand the batch.
      }
    }
    if (cancelled.current) return;
    setPhase('done');
    onPrinted?.();
  };

  const done = (jobs ?? []).filter((j) => j.status === 'done').length;
  const failed = (jobs ?? []).filter((j) => j.status === 'failed');

  return (
    <Dialog
      open
      // Closing mid-run stops the run — the X used to be inert while printing,
      // so a batch started by mistake could not be called off at all.
      onOpenChange={(o) => {
        if (o) return;
        if (phase === 'printing') stop();
        else onClose();
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
              <Printer className="size-4" />
            </span>
            Save {ids.length} challan{ids.length === 1 ? '' : 's'}
          </DialogTitle>
        </DialogHeader>

        {loadError && (
          <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] text-rose-900 dark:border-rose-400/40 dark:bg-rose-400/10 dark:text-rose-100">
            {loadError}
          </p>
        )}

        {phase === 'loading' && !loadError && (
          <p className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading the selected challans…
          </p>
        )}

        {phase === 'asking' && jobs && (
          <div className="space-y-3">
            {/* Says saved, not printed, because that is what happens — and why.
                A browser cannot send a document to a printer without raising
                its own dialog, so printing N challans meant N dialogs. */}
            <p className="text-muted-foreground text-sm">
              Each challan is saved as its own PDF, in this order — no prompts.
              Print them together afterwards from your downloads folder (select
              all → Print).
            </p>

            {/* The cup question, once per challan that has PCS-sold lines. */}
            {asking.length > 0 ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[13px] font-semibold">
                    Print Kgs for the PCS items?
                    <span className="text-muted-foreground ml-1.5 font-normal">
                      {asking.length} of {jobs.length} {asking.length === 1 ? 'has' : 'have'} cup / PCS lines
                    </span>
                  </p>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setAllKgs(true)} className="text-[11px] font-semibold text-sky-700 underline decoration-dotted underline-offset-2 hover:text-sky-900 dark:text-sky-300">
                      All yes
                    </button>
                    <button type="button" onClick={() => setAllKgs(false)} className="text-muted-foreground hover:text-foreground text-[11px] font-semibold underline decoration-dotted underline-offset-2">
                      All no
                    </button>
                  </div>
                </div>
                <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border p-2">
                  {asking.map((j) => (
                    <div key={j.challan.id} className="flex items-center gap-2 rounded-[4px] px-1.5 py-1">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold">
                          {j.challan.code}
                          <span className="text-muted-foreground ml-1.5 font-normal">{formatDate(j.challan.invDate)}</span>
                        </p>
                        <p className="text-muted-foreground truncate text-[11px]">
                          {j.challan.customerName} · {pcsLineCount(j.challan)} PCS line
                          {pcsLineCount(j.challan) === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div className="flex shrink-0 overflow-hidden rounded-md border">
                        {([['Yes', true], ['No', false]] as const).map(([label, value]) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setKgs(j.challan.id, value)}
                            className={cn(
                              'px-2.5 py-1 text-[11.5px] font-bold transition-colors',
                              j.kgsForPcs === value
                                ? value
                                  ? 'bg-sky-600 text-white'
                                  : 'bg-slate-700 text-white'
                                : 'bg-background hover:bg-muted text-muted-foreground',
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-muted-foreground text-[11px]">
                  No prints a dash in the Kgs column for those lines, and leaves them out of the Kgs total.
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-[12.5px]">
                None of these challans has PCS-sold lines, so there is nothing to customise.
              </p>
            )}
          </div>
        )}

        {(phase === 'printing' || phase === 'done') && jobs && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">
              {phase === 'done'
                ? `Saved ${done} of ${jobs.length}${cancelled.current && done < jobs.length ? ' — stopped' : ''}`
                : `Saving ${at + 1} of ${jobs.length}…`}
            </p>
            <div className="bg-muted h-1.5 overflow-hidden rounded-full">
              <div
                className="h-full bg-sky-600 transition-all"
                style={{ width: `${Math.round(((phase === 'done' ? jobs.length : at) / jobs.length) * 100)}%` }}
              />
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto text-[12px]">
              {jobs.map((j) => (
                <div key={j.challan.id} className="flex items-center gap-2">
                  {j.status === 'done' && <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />}
                  {j.status === 'working' && <Loader2 className="size-3.5 shrink-0 animate-spin text-sky-600" />}
                  {j.status === 'failed' && <TriangleAlert className="size-3.5 shrink-0 text-rose-600" />}
                  {j.status === 'pending' && <span className="size-3.5 shrink-0" />}
                  <span className={cn('truncate', j.status === 'pending' && 'text-muted-foreground')}>
                    {j.challan.code} · {j.challan.customerName}
                  </span>
                  {j.status === 'failed' && <span className="ml-auto shrink-0 text-[11px] text-rose-600">{j.error}</span>}
                </div>
              ))}
            </div>
            {phase === 'done' && failed.length > 0 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100">
                {failed.length} did not print. The rest went through — print those {failed.length === 1 ? 'one' : 'ones'} on their own to see the error.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === 'asking' && (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => void run()} disabled={!jobs?.length}>
                <Download /> Save {jobs?.length ?? 0} PDFs
              </Button>
            </>
          )}
          {/* A real Stop, not a disabled spinner: a 40-challan batch started by
              mistake has to be callable off without closing the tab. */}
          {phase === 'printing' && (
            <>
              <Button variant="outline" onClick={stop}>Stop</Button>
              <Button disabled>
                <Loader2 className="animate-spin" /> Saving…
              </Button>
            </>
          )}
          {phase === 'done' && <Button onClick={onClose}>Close</Button>}
          {loadError && <Button variant="outline" onClick={onClose}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Write one finished PDF straight to the downloads folder — no dialog, no
 * preview, no interaction.
 *
 * This batch used to call `window.print()` per challan, which is the one thing
 * a browser will not do quietly: `print()` ALWAYS raises the print/preview
 * dialog, and there is no API that sends a document to a printer without one.
 * Five challans therefore meant five dialogs to click through, which defeats
 * the point of selecting five.
 *
 * So the batch saves instead. Saving genuinely is automatic, and the files can
 * then be printed together from the folder (select all → Print) in one action
 * — one dialog for the batch rather than one per challan.
 *
 * A bare anchor click rather than `savePdfBlob`: that helper prefers the mobile
 * share sheet, which needs a live tap per file and would throw up a share sheet
 * per challan — the same interruption in a different coat.
 */
function saveBlobSilently(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default ChallanBulkPrint;
