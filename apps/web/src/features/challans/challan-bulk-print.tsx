import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CheckCircle2, Download, Loader2, Printer, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { ChallanDto } from '@oms/shared';
import { http } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { buildBillFilename, captureScale, decodeImage, isIOS, waitForPaintable } from '@/lib/pdf';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useChallanTerms, useCompany } from '@/features/settings/use-settings';
import { ChallanInvoice, challanTermsFor, pcsLineCount } from './challan-invoice';

/**
 * Print rules for a whole batch, mirroring the single challan's `PRINT_CSS`
 * (there it is one `#print-image`; here it is N of them).
 *
 * `break-after: page` on every capture but the last is what makes one
 * `window.print()` produce one challan per sheet. Without the `:last-child`
 * exception the final break emits a trailing blank page, which on a real
 * printer is a wasted sheet per batch.
 */
const BATCH_PRINT_CSS = `
@media print {
  @page { size: A4; margin: 10mm; }
  body * { visibility: hidden !important; }
  #print-batch, #print-batch * { visibility: visible !important; }
  #print-batch { display: block !important; position: absolute; left: 0; top: 0; width: 100%; }
  #print-batch img { display: block; width: 100%; break-after: page; page-break-after: always; }
  #print-batch img:last-child { break-after: auto; page-break-after: auto; }
  .no-print { display: none !important; }
}`;

/** What the run does with each capture once it has it. */
type Delivery = 'save' | 'print';

/** A rasterised challan. `ratio` is height/width, which the PDF path needs to
 *  size the page and the print path does not (CSS scales it to the sheet). */
interface Shot {
  dataURL: string;
  ratio: number;
}

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
 * Two ways out, because they answer different needs:
 *
 * - **Save** writes one PDF per challan, unattended — the batch to archive or
 *   send on.
 * - **Print** stacks every capture into ONE hidden document (see
 *   {@link BATCH_PRINT_CSS}) and calls `window.print()` exactly once, so the
 *   browser's own preview opens with one challan per page.
 *
 * Printing used to be rejected here on the grounds that `window.print()` always
 * raises a dialog and cannot be bypassed — true, but it only bit because the
 * old code printed each challan SEPARATELY, so five challans meant five
 * dialogs. Batching them into a single document costs one dialog no matter how
 * many were selected, which is the thing selecting five was after.
 *
 * The cup question is asked UP FRONT for every challan that has PCS-sold lines,
 * listed in the order they will be handled, rather than interrupting the run
 * ten times. Answer them all, press one button, walk away.
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
  /** Which button started the run — drives the wording and what happens to
   *  each capture. Set before the run so the progress text matches the action. */
  const [delivery, setDelivery] = useState<Delivery>('save');
  /** Captures waiting to be printed. Non-empty only between the last capture
   *  and `afterprint`; on screen the container stays hidden throughout. */
  const [printImgs, setPrintImgs] = useState<string[]>([]);

  // Drop the captures once the dialog closes — each is a full-page JPEG, and a
  // ten-challan batch left mounted is several MB held for nothing.
  useEffect(() => {
    const clear = () => setPrintImgs([]);
    window.addEventListener('afterprint', clear);
    return () => window.removeEventListener('afterprint', clear);
  }, []);
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
   * Render one challan off-screen and rasterise it.
   *
   * Returns the capture rather than delivering it: Save and Print want exactly
   * the same pixels and differ only in what happens next, and a batch that
   * printed from a second rendering path would quietly drift from the one the
   * PDFs use.
   *
   * Mounted into a detached root rather than rendered by this component: the
   * capture has to happen for challan N while the dialog on screen keeps
   * showing progress, and each mount has to be torn down before the next so
   * only one invoice is ever in the DOM under a given id.
   */
  const captureOne = async (job: Job): Promise<Shot> => {
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

      const { default: html2canvas } = await import('html2canvas-pro');
      const canvas = await html2canvas(node, { scale: captureScale(), backgroundColor: '#ffffff' });
      const dataURL = canvas.toDataURL('image/jpeg', 0.95);
      if (!dataURL.startsWith('data:image/')) throw new Error('Canvas capture failed');
      return { dataURL, ratio: canvas.height / canvas.width };
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

  /** Lay one capture out as an A4 PDF and write it straight to downloads,
   *  paginating if the challan runs longer than a sheet. */
  const saveShot = async (job: Job, shot: Shot): Promise<void> => {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const margin = 4;
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW - margin * 2;
    const imgH = shot.ratio * imgW;
    const contentH = pageH - margin * 2;
    if (imgH <= contentH) {
      pdf.addImage(shot.dataURL, 'JPEG', margin, margin, imgW, imgH);
    } else {
      let y = 0;
      let first = true;
      while (y < imgH) {
        if (!first) pdf.addPage();
        pdf.addImage(shot.dataURL, 'JPEG', margin, margin - y, imgW, imgH);
        y += contentH;
        first = false;
      }
    }
    const filename = buildBillFilename('Challan', job.challan.code, `challan-${job.challan.id}`);
    saveBlobSilently(pdf.output('blob'), filename);
  };

  /**
   * Hand the whole batch to the browser's print preview in one go.
   *
   * The captures are mounted first and DECODED before `print()` is called: an
   * undecoded image has no pixels when the browser snapshots the print view, so
   * skipping this prints blank sheets — the same trap the single challan's
   * print path documents.
   */
  const printShots = async (shots: Shot[]): Promise<void> => {
    flushSync(() => setPrintImgs(shots.map((s) => s.dataURL)));
    await Promise.all(shots.map((s) => decodeImage(s.dataURL)));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.print();
  };

  /** Abort the rest of the run. The challan being written finishes (it is
   *  already rasterised); nothing after it is started. */
  const stop = () => {
    cancelled.current = true;
    setPhase('done');
  };

  const run = async (how: Delivery) => {
    const list = jobs ?? [];
    if (!list.length) return;
    /*
     * iOS Safari cannot be printed this way — the hidden-image trick yields a
     * blank or whole-page print there, which is why the single challan's Print
     * routes iOS to a PDF too. Saving is the honest fallback: say so rather
     * than opening a preview that prints nothing.
     */
    const mode: Delivery = how === 'print' && isIOS() ? 'save' : how;
    if (mode !== how) toast.info('iPhone and iPad cannot print a batch directly — saving the PDFs instead.');
    cancelled.current = false;
    setDelivery(mode);
    setPhase('printing');
    // Print needs every capture in hand before it can open one preview; save
    // writes each out as it goes and keeps nothing.
    const shots: Shot[] = [];
    for (let i = 0; i < list.length; i++) {
      if (cancelled.current) return;
      setAt(i);
      setJobs((prev) => (prev ?? []).map((j, k) => (k === i ? { ...j, status: 'working' } : j)));
      try {
        const shot = await captureOne(list[i]);
        if (mode === 'save') await saveShot(list[i], shot);
        else shots.push(shot);
        setJobs((prev) => (prev ?? []).map((j, k) => (k === i ? { ...j, status: 'done' } : j)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : mode === 'print' ? 'Print failed' : 'Save failed';
        setJobs((prev) => (prev ?? []).map((j, k) => (k === i ? { ...j, status: 'failed', error: msg } : j)));
        // Carry on with the rest — one bad challan should not strand the batch.
      }
    }
    if (cancelled.current) return;
    setPhase('done');
    // Whatever captured cleanly goes to the preview; a challan that failed is
    // simply absent rather than blocking the ones that worked.
    if (mode === 'print' && shots.length) await printShots(shots);
    onPrinted?.();
  };

  const done = (jobs ?? []).filter((j) => j.status === 'done').length;
  const failed = (jobs ?? []).filter((j) => j.status === 'failed');

  return (
    <>
      <style>{BATCH_PRINT_CSS}</style>
      {/* Hidden on screen; the only thing visible when printing. Kept OUTSIDE
          the Dialog so the overlay's own transform and overflow cannot clip a
          full-page image out of the printed sheet. */}
      {printImgs.length > 0 && (
        <div id="print-batch" style={{ display: 'none' }}>
          {printImgs.map((src, i) => (
            <img key={i} src={src} alt={`Challan ${i + 1} of ${printImgs.length}`} />
          ))}
        </div>
      )}
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
            {ids.length} challan{ids.length === 1 ? '' : 's'}
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
            {/* Both routes described, because the buttons below offer both and
                they land in very different places. */}
            <p className="text-muted-foreground text-sm">
              <strong className="text-foreground font-semibold">Print</strong> opens one preview with
              all {jobs.length} on separate pages.{' '}
              <strong className="text-foreground font-semibold">Save PDFs</strong> writes each as its
              own file to your downloads, in this order — no prompts.
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
                ? `${delivery === 'print' ? 'Prepared' : 'Saved'} ${done} of ${jobs.length}${cancelled.current && done < jobs.length ? ' — stopped' : ''}`
                : `${delivery === 'print' ? 'Preparing' : 'Saving'} ${at + 1} of ${jobs.length}…`}
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
                {failed.length} did not go through{delivery === 'print' ? ' and are not in the preview' : ''}. The rest did — open those {failed.length === 1 ? 'one' : 'ones'} on their own to see the error.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === 'asking' && (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button variant="outline" onClick={() => void run('save')} disabled={!jobs?.length}>
                <Download /> Save {jobs?.length ?? 0} PDFs
              </Button>
              <Button onClick={() => void run('print')} disabled={!jobs?.length}>
                <Printer /> Print {jobs?.length ?? 0}
              </Button>
            </>
          )}
          {/* A real Stop, not a disabled spinner: a 40-challan batch started by
              mistake has to be callable off without closing the tab. */}
          {phase === 'printing' && (
            <>
              <Button variant="outline" onClick={stop}>Stop</Button>
              <Button disabled>
                <Loader2 className="animate-spin" /> {delivery === 'print' ? 'Preparing…' : 'Saving…'}
              </Button>
            </>
          )}
          {phase === 'done' && <Button onClick={onClose}>Close</Button>}
          {loadError && <Button variant="outline" onClick={onClose}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

/**
 * Write one finished PDF straight to the downloads folder — no dialog, no
 * preview, no interaction.
 *
 * This is the Save route only. Printing no longer comes through here: it stacks
 * every capture into one document and raises a single dialog for the batch (see
 * {@link BATCH_PRINT_CSS}), which is what the old per-challan `window.print()`
 * got wrong — `print()` ALWAYS raises a dialog, so calling it five times meant
 * five of them.
 *
 * Saving still earns its place beside that: it is genuinely unattended, and it
 * leaves files to archive or send on rather than sheets of paper.
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
