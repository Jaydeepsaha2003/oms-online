import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, ExternalLink, Eye, Loader2, Printer, Share2, X } from 'lucide-react';
import { toast } from 'sonner';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useFitToWidth } from '@/hooks/use-fit-to-width';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { buildBillFilename, captureScale, decodeImage, isIOS, savePdfBlob, sharePdfFile, showPreviewPlaceholder, takePendingPreviewTab, waitForPaintable } from '@/lib/pdf';
import kavishLogo from '@/assets/kavish-logo-order.png';
import { useChallanTerms, useCompany } from '@/features/settings/use-settings';
import { useChallan, usePendingChallans } from './use-challans';
import { ChallanInvoice, challanTermsFor, isPcsUnit, pcsLineCount } from './challan-invoice';

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 10mm; }
  body * { visibility: hidden !important; }
  #print-image { display: block !important; visibility: visible !important; position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
}`;

/** Read by Chrome/Edge's built-in PDF viewer out of the URL fragment: no
 *  toolbar (filename, page box, zoom, download, print, kebab), no thumbnail
 *  rail, and the page fitted to the frame's width. Without them the preview wore
 *  the browser's own furniture and read as "a PDF opened in Chrome" sitting
 *  inside a dialog, rather than as part of this app.
 *
 *  Deliberately NOT folded into `previewUrl`: "Open in tab" hands over the bare
 *  blob, where the browser's controls are exactly what you want.
 *
 *  Firefox's pdf.js ignores these and keeps its own toolbar — the document still
 *  renders, it just keeps that chrome there. */
const PDF_VIEWER_PARAMS = '#toolbar=0&navpanes=0&scrollbar=0&view=FitH';

// A4 design width the challan is laid out at — matches the PDF capture width
// (PDF_RENDER_W) so the on-screen preview mirrors the printed page exactly.
const CHALLAN_DESIGN_W = 960;

export function ChallanBillPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const challanId = id ? Number(id) : undefined;
  const { data: challan, isLoading } = useChallan(challanId);
  // After saving a challan, the Print/PDF screen's Back should land on Pending
  // Challan when anything is still awaiting a challan, otherwise on View Challans.
  // Only this post-save entry passes the flag; a bill opened elsewhere keeps the
  // plain browser-back. We fetch the pending count live so it reflects this save.
  const smartBack = (location.state as { backTo?: string } | null)?.backTo === 'challan-pending-or-list';
  const { data: pending } = usePendingChallans({ page: 1, pageSize: 1 }, { enabled: smartBack });
  // `?from=tab` marks a bill the Credit/Debit Note screen popped into a SECOND
  // tab. That tab has no history behind it, so browser-back is a dead button —
  // the way out is to close the tab and return to the note still open in the
  // first one. The opener sets the flag explicitly rather than us sniffing
  // window.opener / history.length, neither of which is dependable once the
  // user has clicked around inside the tab.
  const inOwnTab = new URLSearchParams(location.search).get('from') === 'tab';
  /* Where the opener wants us to land. The challans list sends the URL of the
   * exact filtered view the user left, because plain history-back is not good
   * enough: an auto-print or an iOS preview replaces this entry first, and the
   * user then returns to an unfiltered list having lost their search. */
  const backTarget = (location.state as { returnTo?: string } | null)?.returnTo;
  const goBack = () => {
    if (inOwnTab) {
      window.close();
      // Only reached if the browser refuses to close the tab (it will not for a
      // script-opened one) — land somewhere real instead of doing nothing.
      setTimeout(() => navigate('/challans'), 150);
      return;
    }
    if (smartBack) navigate((pending?.total ?? 0) > 0 ? '/challans/pending' : '/challans');
    else if (backTarget) navigate(backTarget);
    else navigate(-1);
  };
  const { data: termsData, isPending: termsPending } = useChallanTerms();
  /* Same tag substitution as the sales order — see the note there. A challan
     carries its OWN payment term, so this one does not need the party record. */
  const terms = useMemo(() => challanTermsFor(termsData?.terms, challan), [termsData, challan]);
  const { data: company, isPending: companyPending } = useCompany();
  const logoSrc = company?.logo || kavishLogo;
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  // Whether PCS-sold lines print their Kgs — see `askKgsForPcs`. Off by default,
  // matching the desktop OMS, where "No" is the highlighted button.
  const [kgsForPcs, setKgsForPcs] = useState(false);
  const [printImg, setPrintImg] = useState<string | null>(null);
  // iOS only: a finished PDF waiting for a fresh tap to hand it to the share
  // sheet (see `download`). Null everywhere else.
  const [readyPdf, setReadyPdf] = useState<{ blob: Blob; filename: string } | null>(null);
  // The blob URL currently shown in the on-page preview overlay (desktop route).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // The same bytes the overlay is showing. An object URL cannot be turned back
  // into a File, and the share sheet needs one — so the blob is kept alongside.
  const [previewFile, setPreviewFile] = useState<{ blob: Blob; filename: string } | null>(null);
  // Where to go when that overlay is closed, when the preview was launched from
  // a list row rather than from this page's own button.
  const [returnAfterPreview, setReturnAfterPreview] = useState<string | null>(null);
  // On phones, shrink the fixed-width A4 challan to fit the screen (see hook).
  const isMobile = useIsMobile();
  const fit = useFitToWidth(CHALLAN_DESIGN_W, isMobile);

  // Clear the print image once the print dialog closes.
  useEffect(() => {
    const clear = () => setPrintImg(null);
    window.addEventListener('afterprint', clear);
    return () => window.removeEventListener('afterprint', clear);
  }, []);

  // A preview blob is a few MB; don't strand it if the page is left with the
  // overlay still open. Reads the latest URL from a ref so the effect can stay
  // mount-only rather than revoking on every change.
  const previewUrlRef = useRef<string | null>(null);
  previewUrlRef.current = previewUrl;
  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); }, []);

  /**
   * Arriving here straight from Ctrl+P in the challan form, or from "Print / PDF"
   * / "Preview PDF" in the challan list: run that action without a second click.
   *
   * The capture rasterises the live DOM, so it has to wait for the invoice to
   * actually be on screen with its fonts and logo resolved — firing on data
   * arrival alone yields a half-drawn page. Once fired, the flag is stripped from
   * history so a refresh or a Back/Forward doesn't repeat it.
   */
  const autoActionFired = useRef(false);
  const autoState = location.state as { autoPrint?: boolean; autoPreview?: boolean; backTo?: string; returnTo?: string } | null;
  const wantsAutoPrint = !!autoState?.autoPrint;
  const wantsAutoPreview = !!autoState?.autoPreview;
  const challanReady = !!challan;
  /*
   * The company profile carries the logo, and it is a SEPARATE query from the
   * challan. Firing the capture on the challan alone meant a cold open
   * rasterised the bundled fallback mark — or nothing — and then swapped in the
   * real logo afterwards, changing the page after the PDF had been built. On the
   * second open the profile is already cached (staleTime 60s), which is why it
   * looked right the second time.
   *
   * `isPending` and not `isSuccess`: a settings request that FAILS must still
   * release the gate, or the bill would never print at all.
   *
   * TERMS matter more than the logo here, and are the actual reported bug: the
   * terms block is rendered behind `terms.length > 0`, so until that query lands
   * it is not in the DOM AT ALL. Capturing then produced a challan with its whole
   * bottom section missing — "it printed half" — and the second open looked fine
   * only because React Query had the terms cached by then.
   */
  const printableReady = !companyPending && !termsPending;
  useEffect(() => {
    if ((!wantsAutoPrint && !wantsAutoPreview) || !challanReady || !printableReady || autoActionFired.current) return;
    autoActionFired.current = true;
    void (async () => {
      const node = document.getElementById('challan-invoice');
      if (node) await waitForPaintable(node);
      if (wantsAutoPrint) {
        await print();
        navigate(location.pathname, { replace: true, state: { backTo: autoState?.backTo, returnTo: autoState?.returnTo } });
        return;
      }
      // On iOS the list reserved a tab inside its click (a popup opened later
      // would be blocked); everywhere else the preview lands on this page.
      const how = await previewPdf(takePendingPreviewTab());
      if (how === 'ready') {
        // iOS: the PDF is parked and the "ready" banner is on this page. Going
        // back to the list now would take the banner with it.
        navigate(location.pathname, { replace: true, state: { backTo: autoState?.backTo, returnTo: autoState?.returnTo } });
      } else if (how === 'inline' && autoState?.returnTo) {
        // The user is looking at the overlay — closing it takes them back.
        setReturnAfterPreview(autoState.returnTo);
        navigate(location.pathname, { replace: true, state: { backTo: autoState?.backTo, returnTo: autoState?.returnTo } });
      } else if (autoState?.returnTo) {
        navigate(autoState.returnTo, { replace: true });
      } else {
        // Drop the flag so a refresh or Back/Forward doesn't repeat it.
        navigate(location.pathname, { replace: true, state: { backTo: autoState?.backTo, returnTo: autoState?.returnTo } });
      }
    })();
    // Deps are booleans, and there is no cleanup that aborts the run: saving
    // invalidates the challan query, so a refetch lands mid-capture and would
    // otherwise cancel the action a moment before it fired. The ref keeps it to once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsAutoPrint, wantsAutoPreview, challanReady, printableReady]);

  // Capture the challan at 960 px — wide enough to avoid over-wrapping but
  // narrow enough that fonts appear noticeably larger when scaled to A4.
  const captureImage = async (): Promise<{ dataURL: string; ratio: number } | null> => {
    const src = document.getElementById('challan-invoice');
    if (!src) return null;
    const PDF_RENDER_W = 960;
    const clone = src.cloneNode(true) as HTMLElement;
    clone.style.width = `${PDF_RENDER_W}px`;
    clone.style.borderRadius = '0';
    const holder = document.createElement('div');
    holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${PDF_RENDER_W}px;background:#ffffff`;
    holder.appendChild(clone);
    document.body.appendChild(holder);
    // BEFORE any measurement below: an undecoded image has no height, so
    // measuring first yields offsets for a layout that never gets printed.
    await waitForPaintable(clone);
    const canvas = await html2canvas(clone, { scale: captureScale(), backgroundColor: '#ffffff' });
    holder.remove();
    const dataURL = canvas.toDataURL('image/jpeg', 0.95);
    // Safari returns a stub ("data:,") instead of throwing when it gives up on a
    // canvas. Catch it here rather than silently embedding a blank page.
    if (!dataURL.startsWith('data:image/')) throw new Error('Canvas capture failed');
    return { dataURL, ratio: canvas.height / canvas.width };
  };

  /** Captures the invoice and lays it out as an A4 jsPDF, paginating if it runs
   *  long. Shared by Download (saves the result) and Preview (shows it in a tab). */
  const buildPdf = async (): Promise<jsPDF | null> => {
    const cap = await captureImage();
    if (!cap) return null;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    // Very thin margin — just enough to avoid printer clip zones.
    const margin = 4;
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW - margin * 2;
    const imgH = cap.ratio * imgW;
    const contentH = pageH - margin * 2;
    if (imgH <= contentH) {
      pdf.addImage(cap.dataURL, 'JPEG', margin, margin, imgW, imgH);
    } else {
      let yOffset = 0;
      let firstPage = true;
      while (yOffset < imgH) {
        if (!firstPage) pdf.addPage();
        pdf.addImage(cap.dataURL, 'JPEG', margin, margin - yOffset, imgW, imgH);
        yOffset += contentH;
        firstPage = false;
      }
    }
    return pdf;
  };

  /** @param asked true when the caller already put the Kgs question (the iOS
   *   print path routes through here, and asking twice for one tap is nonsense). */
  const download = async (asked = false) => {
    if (!challan) return;
    if (!asked) await askKgsForPcs();
    setBusy(true);
    try {
      const pdf = await buildPdf();
      if (!pdf) return;
      const filename = buildBillFilename('Challan', challan.code, `challan-${challanId}`);
      const blob = pdf.output('blob');
      // iOS: rasterising the challan takes seconds, which outlives this tap's
      // transient activation — so the share sheet would be refused and we'd
      // strand the user on the blank fallback tab. Park the finished PDF and
      // let a fresh tap hand it over instead. Android/desktop are unaffected:
      // their fallback is an <a download>, which needs no activation.
      if (isIOS()) setReadyPdf({ blob, filename });
      else void savePdfBlob(blob, filename);
    } catch {
      toast.error('Could not generate the PDF');
    } finally {
      setBusy(false);
    }
  };

  /** Deliver the parked PDF from a live tap, so `navigator.share()` is allowed. */
  const deliverReadyPdf = () => {
    if (!readyPdf) return;
    void savePdfBlob(readyPdf.blob, readyPdf.filename);
    setReadyPdf(null);
  };

  /**
   * Show the generated PDF **on this screen**, in an overlay, rather than firing
   * it into another tab.
   *
   * The tab route was the source of the "it opens a blank page and then jumps
   * somewhere else" behaviour: the tab has to be opened inside the click (or the
   * popup blocker eats it), but the PDF only exists several seconds later, so
   * the browser fronted an empty tab for the whole rasterise — and any question
   * we had to ask meanwhile was stranded behind it. Previewing in place removes
   * the popup entirely: nothing is opened until there is something to show, and
   * the question is asked on the page the user is already looking at.
   *
   * iOS is the exception — Safari won't render a PDF inside an iframe — so there
   * it still hands the document to a tab. `reservedTab` is that pre-opened tab.
   *
   * Returns how the preview was delivered, so an auto-preview knows whether the
   * user is now looking at an overlay (stay put) or a tab (this page is done).
   */
  const previewPdf = async (reservedTab?: Window | null): Promise<'inline' | 'ready' | 'tab' | 'none'> => {
    if (!challan) return 'none';
    let tab = reservedTab ?? null;
    if (pcsLines) {
      // The question is answered on THIS page, so any reserved tab has to go —
      // it would be fronted by the browser and hide the dialog behind it.
      tab?.close();
      tab = null;
      await askKgsForPcs();
      // iOS still needs a tab, and it must be opened while the dialog's own
      // click still carries activation — a popup after the rasterise is blocked.
      if (isIOS()) tab = window.open('', '_blank');
    }
    // Only iOS keeps a tab open across the build; give it something to look at.
    if (isIOS()) showPreviewPlaceholder(tab);
    setBusy(true);
    try {
      const pdf = await buildPdf();
      if (!pdf) {
        tab?.close();
        return 'none';
      }
      const blob = pdf.output('blob');
      const filename = buildBillFilename('Challan', challan.code, `challan-${challanId}`);

      if (isIOS()) {
        /*
         * NOT a `blob:` tab any more.
         *
         * Handing the PDF to a tab left the only share button in reach being
         * Safari's own, and Safari shares the PAGE: the
         * `blob:https://…/uuid` string went out as a WhatsApp message, and the
         * attachment came from a URL that carries no filename — which is where
         * "Unknown.pdf" came from. The blob is parked instead, and the banner
         * below hands it over on a fresh tap, where `navigator.share()` sends a
         * properly named file and nothing else.
         */
        tab?.close();
        setPreviewFile({ blob, filename });
        setReadyPdf({ blob, filename });
        return 'ready';
      }

      const url = URL.createObjectURL(blob);
      tab?.close(); // nothing to put in it — the preview stays here
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setPreviewFile({ blob, filename });
      return 'inline';
    } catch {
      tab?.close();
      toast.error('Could not preview the PDF');
      return 'none';
    } finally {
      setBusy(false);
    }
  };

  /** Close the overlay, free the blob, and go back if we came from a list row. */
  const closePreview = () => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPreviewFile(null);
    if (returnAfterPreview) {
      const to = returnAfterPreview;
      setReturnAfterPreview(null);
      navigate(to, { replace: true });
    }
  };

  /** Print the captured image — guarantees no app/menu text and an exact match.
   *  `asked` mirrors {@link download}: the preview overlay has already settled
   *  the Kgs question, so printing what is on screen must not re-open it. */
  const print = async (asked = false) => {
    // iOS Safari's window.print() is unreliable for the hidden-image trick below
    // (it prints a blank / whole page). Route to the PDF instead — the user then
    // taps Print from the iOS share sheet / Safari's PDF viewer. `download` opens
    // the tab synchronously inside this tap, so iOS doesn't block it.
    if (!asked) await askKgsForPcs();
    if (isIOS()) {
      await download(true);
      return;
    }
    setBusy(true);
    try {
      const cap = await captureImage();
      if (!cap) return;
      setPrintImg(cap.dataURL);
      // Pre-decode the (large) capture so it's painted before the browser
      // snapshots the print view — otherwise mobile prints a blank page.
      await decodeImage(cap.dataURL);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.print();
    } catch {
      toast.error('Could not prepare the print');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Share the previewed receipt.
   *
   * On a phone this is the OS share sheet, with the PDF already attached —
   * WhatsApp, Mail, AirDrop and the rest are all targets in it, which is why the
   * button is not named after any one of them.
   *
   * Where the browser cannot share files (most desktops) the fallback does the
   * two halves separately rather than pretending: the PDF is saved and WhatsApp
   * opens with the message written, leaving only the attach to do. No link
   * scheme can carry the file itself — `wa.me` takes text and nothing else.
   */
  const shareReceipt = async () => {
    if (!previewFile) return;
    const text = `Sales Receipt ${challan?.code ?? ''} — ${challan?.customerName ?? ''}`.replace(/\s+—\s*$/, '').trim();
    // No await before this: the share sheet needs the tap's transient activation.
    if (await sharePdfFile(previewFile.blob, previewFile.filename, text)) return;
    await savePdfBlob(previewFile.blob, previewFile.filename);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    toast.info('No share sheet in this browser — the PDF is saved and WhatsApp is open; attach it there.');
  };

  const pcsLines = useMemo(() => (challan ? pcsLineCount(challan) : 0), [challan]);

  /**
   * Ask, once per print/download/preview, whether the PCS-sold lines should also
   * print their Kgs — carried over from the desktop OMS (Form14), where the same
   * question is asked as the challan is written to the Excel template.
   *
   * The reason it's a question and not a setting: a line sold by the piece still
   * carries a weight, and whether the customer should see it depends on the deal
   * — some parties are billed per piece and reading a Kgs figure next to it
   * invites an argument about the rate. So the operator decides at print time.
   *
   * No PCS lines on the challan means no question, exactly as before. "No" is the
   * default (the dialog focuses Cancel), so an absent-minded Enter prints dashes
   * rather than disclosing weights.
   *
   * `flushSync` + two frames matter: the PDF is a raster capture of the live DOM,
   * so the table must be repainted with the answer applied BEFORE the capture
   * starts, or the choice silently misses the document it was made for.
   */
  const askKgsForPcs = async (): Promise<void> => {
    if (!pcsLines) {
      if (kgsForPcs) flushSync(() => setKgsForPcs(false));
      return;
    }
    const yes = await confirm({
      title: 'Print Kgs for the PCS items?',
      description: `${pcsLines} item${pcsLines > 1 ? 's are' : ' is'} sold by PCS on this challan. Choose No to print a dash in the Kgs column for ${pcsLines > 1 ? 'those lines' : 'that line'} — the Kgs total will leave ${pcsLines > 1 ? 'them' : 'it'} out too.`,
      confirmText: 'Yes, print Kgs',
      cancelText: 'No',
    });
    flushSync(() => setKgsForPcs(yes));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };

  if (isLoading || !challan) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <style>{PRINT_CSS}</style>
      {/* Hidden on screen; the only thing visible when printing. */}
      {printImg && <img id="print-image" src={printImg} alt="Sales Challan" style={{ display: 'none' }} />}

      <div className="no-print flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={goBack} aria-label={inOwnTab ? 'Close this tab' : 'Back'} title={inOwnTab ? 'Close this tab' : 'Back'}>
          {inOwnTab ? <X /> : <ArrowLeft />}
        </Button>
        <h2 className="text-xl font-bold tracking-tight">Sales Challan</h2>
        <div className="ml-auto flex gap-2">
          {/* Wrapped, not passed bare: print() now takes an `asked` flag and a
              bare handler would hand it the click event — truthy, so the Kgs
              question would be skipped on the one path that must ask it. */}
          <Button variant="outline" onClick={() => void print()} disabled={busy}>
            <Printer /> Print
          </Button>
          <Button variant="outline" onClick={() => void previewPdf()} disabled={busy}>
            <Eye /> Preview
          </Button>
          <Button onClick={() => void download()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
          </Button>
        </div>
      </div>

      {/* iOS only — see `download`. The capture outlives the tap that started it,
          so the finished PDF is handed over on a fresh tap. */}
      {readyPdf && (
        <div className="no-print border-primary/30 bg-primary/5 flex items-center gap-3 rounded-md border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Your PDF is ready</p>
            <p className="text-muted-foreground truncate text-xs">{readyPdf.filename}</p>
          </div>
          <Button size="sm" onClick={deliverReadyPdf}>
            <Download /> Save / Share
          </Button>
        </div>
      )}

      {/* ── Printable Challan (matches the Sales Order / Quotation letterhead format) ── */}
      {/* Mobile: outer measures the available width + reserves the scaled height;
          inner holds the full-width page and scales it down. Desktop: both are
          transparent pass-throughs (no width/transform), so nothing changes. */}
      <div
        ref={fit.outerRef}
        className={isMobile ? 'overflow-hidden rounded-lg border shadow-sm' : undefined}
        style={isMobile ? { height: fit.height } : undefined}
      >
      <div
        ref={fit.innerRef}
        style={isMobile ? { width: CHALLAN_DESIGN_W, transformOrigin: 'top left', transform: `scale(${fit.scale})` } : undefined}
      >
      {/* The printed document itself. Extracted so bulk print can mount the
          very same component off-screen per challan — see ChallanInvoice. */}
      <ChallanInvoice
        challan={challan}
        terms={terms}
        logoSrc={logoSrc}
        companyName={company?.name ?? null}
        kgsForPcs={kgsForPcs}
      />
      </div>
      </div>

      {/* ── The PDF itself, previewed in place ───────────────────────────────
          An <iframe> hands the blob to the browser's own PDF viewer, so this is
          the real generated document — the same bytes Download writes — not a
          re-render of the page that might differ from it. */}
      {previewUrl && (
        <Dialog open onOpenChange={(o) => !o && closePreview()}>
          <DialogContent
            className="flex h-[92dvh] w-[min(1100px,96vw)] max-w-[96vw] flex-col gap-3 overflow-hidden overflow-y-hidden p-4 sm:!max-w-[1100px]"
          >
            <DialogHeader className="space-y-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Eye className="text-violet-600 size-4.5" /> Preview — {challan?.code}
              </DialogTitle>
            </DialogHeader>

            {/* The document sits on an app surface rather than the browser's
                grey viewer shell — see PDF_VIEWER_PARAMS for the rest of it. */}
            <div className="min-h-0 w-full flex-1 overflow-hidden rounded-[6px] border bg-slate-200/60 shadow-inner dark:bg-slate-800/60">
              <iframe
                src={`${previewUrl}${PDF_VIEWER_PARAMS}`}
                title={`Challan ${challan?.code ?? ''} preview`}
                className="size-full border-0"
              />
            </div>

            <DialogFooter className="gap-2 sm:justify-end">
              <Button variant="outline" onClick={closePreview}>Close</Button>
              {/* Hiding the viewer's toolbar takes its print button with it, so
                  the app supplies one. `true` — the Kgs question is already answered. */}
              <Button variant="outline" onClick={() => void print(true)} disabled={busy} title="Print this challan">
                <Printer /> Print
              </Button>
              <Button
                variant="outline"
                onClick={() => void shareReceipt()}
                disabled={!previewFile}
                title="Share this receipt — WhatsApp, Mail and the rest are targets in the share sheet"
              >
                <Share2 /> Share
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open(previewUrl, '_blank')}
                title="Open this PDF in a browser tab"
              >
                <ExternalLink /> Open in tab
              </Button>
              {/* Already asked about Kgs before the preview was built, so this
                  saves exactly the document on screen rather than asking again. */}
              <Button onClick={() => void download(true)} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default ChallanBillPage;
