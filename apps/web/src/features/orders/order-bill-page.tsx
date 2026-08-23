import { useEffect, useMemo, useState, type CSSProperties, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { Button } from '@/components/ui/button';
import { buildBillFilename, captureScale, decodeImage, isIOS, savePdfBlob } from '@/lib/pdf';
import { shortOrderCode } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import kavishLogo from '@/assets/kavish-logo-order.png';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useFitToWidth } from '@/hooks/use-fit-to-width';
import { useCompany, useOrderFooter, useOrderTerms, useQuotationTerms } from '@/features/settings/use-settings';
import { useOrder } from './use-orders';
import { useQuotation } from '../quotations/use-quotations';

// A4 design width the sales order / quotation is laid out at — matches the PDF
// capture width so the on-screen mobile preview mirrors the printed page.
const ORDER_DESIGN_W = 960;

// Kavish brand colours (sampled from the official letterhead template).
const NAVY = '#163e64';
const BANNER_ORANGE_FROM = '#f2914a';
const BANNER_ORANGE_TO = '#e3601b';
const ORANGE = '#F99A0F'; // table header / total row
const BLACK = '#111111';
const FONT = 'Calibri, Carlito, "Segoe UI", Arial, sans-serif';

// Shown until the Settings → "Sales Order Terms & Conditions" list loads.
const FALLBACK_TERMS = [
  'Payment Should Be Made Within 30 Days',
  'If Payment Defaulted 18% Interest Will Be Applicable',
  'Order Cannot Be Cancelled Once Placed/Confirmed',
  'Any Type Of Defect/Design Issue Should Be Reported Within 15 days After Goods Recived.',
];

// Shown until the Settings → "Sales Order footer text" list loads.
const FALLBACK_FOOTER = ['***THIS IS COMPUTER GENRATED {DOC_TYPE}***'];

// The reference template always prints the raw number (including 0), never blanks it.
const numf = (v: number | null) => (v ?? 0).toLocaleString('en-IN');
// Follows the system-wide date format (dd-mm-yy by default).
const fmtDate = (d?: string | null) => formatDate(d);

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 10mm; }
  body * { visibility: hidden !important; }
  #print-image { display: block !important; visibility: visible !important; position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
}`;

export function OrderBillPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const orderId = id ? Number(id) : undefined;
  // The same bill renders both orders and quotations — the route decides which.
  const isQuotation = location.pathname.startsWith('/quotations');
  const orderQ = useOrder(isQuotation ? undefined : orderId);
  const quotationQ = useQuotation(isQuotation ? orderId : undefined);
  const order = isQuotation ? quotationQ.data : orderQ.data;
  const isLoading = isQuotation ? quotationQ.isLoading : orderQ.isLoading;
  // Editable from Settings → "Sales Order Terms & Conditions"; falls back to the
  // built-in default text until that loads (or if it's never been customised).
  const { data: orderTermsData } = useOrderTerms();
  // Quotations print their own list (Settings → "Quotation Terms & Conditions");
  // the server hands back the Sales Order terms until one is saved, so the two
  // documents only diverge once the business actually customises the quotation's.
  const { data: quotationTermsData } = useQuotationTerms();
  const termsData = isQuotation ? quotationTermsData : orderTermsData;
  const terms = termsData?.terms.length ? termsData.terms : FALLBACK_TERMS;
  const docTitle = isQuotation ? 'QUOTATION' : 'SALES ORDER';
  // Editable from Settings → "Sales Order footer text"; {DOC_TYPE} is swapped for docTitle.
  const { data: footerData } = useOrderFooter();
  const footerLines = (footerData?.lines.length ? footerData.lines : FALLBACK_FOOTER).map((l) => l.replaceAll('{DOC_TYPE}', docTitle));
  // Uploaded via Settings → "Company branding"; falls back to the built-in Kavish
  // logo until one's been uploaded.
  const { data: company } = useCompany();
  const logoSrc = company?.logo || kavishLogo;
  const pageTitle = isQuotation ? 'Quotation' : 'Sales Order';
  const fileSuffix = isQuotation ? 'quotation' : 'sales-order';
  const [busy, setBusy] = useState(false);
  const [printImg, setPrintImg] = useState<string | null>(null);
  // iOS only: a finished PDF waiting for a fresh tap to hand it to the share
  // sheet (see `download`). Null everywhere else.
  const [readyPdf, setReadyPdf] = useState<{ blob: Blob; filename: string } | null>(null);
  // On phones, shrink the fixed-width A4 document to fit the screen (see hook).
  const isMobile = useIsMobile();
  const fit = useFitToWidth(ORDER_DESIGN_W, isMobile);

  // Clear the print image once the print dialog closes.
  useEffect(() => {
    const clear = () => setPrintImg(null);
    window.addEventListener('afterprint', clear);
    return () => window.removeEventListener('afterprint', clear);
  }, []);

  // Capture the exact rendered Sales Order as a crisp A4-proportioned JPEG — both
  // Download and Print use this, so they look identical to the preview.
  const captureImage = async (): Promise<{ dataURL: string; ratio: number; renderW: number; rowBreaksPx: number[] } | null> => {
    const src = document.getElementById('sales-order');
    if (!src) return null;
    // Cap the render width at 960 px.  On a wide monitor the element may be
    // 1 300–1 500 px wide; capturing at that full width and squeezing into A4
    // (~595 pt) makes everything look tiny.  960 px gives a comfortable scale
    // factor of ~0.62 so fonts and cells appear noticeably larger in the PDF
    // while still being wide enough that content doesn't over-wrap.
    const PDF_RENDER_W = 960;
    const clone = src.cloneNode(true) as HTMLElement;
    clone.style.width = `${PDF_RENDER_W}px`;
    clone.style.borderRadius = '0';
    const holder = document.createElement('div');
    holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${PDF_RENDER_W}px;background:#ffffff`;
    holder.appendChild(clone);
    document.body.appendChild(holder);
    // Safe places to later cut this into pages: the bottom edge of every block
    // that must not be split — item rows, and every terms/footer line below the
    // table. Measured on the clone (same 960px-wide layout the canvas below is
    // captured from, so these positions map to the canvas 1:1 modulo scale).
    // Anything NOT listed here can still be cut through, so the terms block has
    // to be marked too — not just the table.
    const cloneTop = clone.getBoundingClientRect().top;
    const rowBreaksPx = [...clone.querySelectorAll('#items-table tr, [data-pdf-block]')].map(
      (el) => el.getBoundingClientRect().bottom - cloneTop,
    );
    const canvas = await html2canvas(clone, { scale: captureScale(), backgroundColor: '#ffffff' });
    holder.remove();
    const dataURL = canvas.toDataURL('image/jpeg', 0.95);
    // Safari returns a stub ("data:,") instead of throwing when it gives up on a
    // canvas. Catch it here rather than silently embedding a blank page.
    if (!dataURL.startsWith('data:image/')) throw new Error('Canvas capture failed');
    return { dataURL, ratio: canvas.height / canvas.width, renderW: PDF_RENDER_W, rowBreaksPx };
  };

  /**
   * Choose where each PDF page should start reading from the tall captured
   * image, in image-space points.
   *
   * Slicing at a fixed height every page tears whatever row happens to sit at
   * that height — the torn piece can then reappear in full at the top of the
   * next page, which is what shows up as a row's text printing twice around a
   * page break. Snapping every cut back to the nearest row boundary at or
   * before the ideal cut means a page simply ends a little short of full
   * rather than mid-row; the row itself moves to the next page whole.
   */
  const computePageOffsets = (imgH: number, contentH: number, rowBreaksPt: number[]): number[] => {
    const offsets = [0];
    let yOffset = 0;
    while (yOffset + contentH < imgH) {
      const idealNext = yOffset + contentH;
      const safe = rowBreaksPt.filter((y) => y > yOffset && y <= idealNext);
      // Math.max, not "the last one": the candidates come from querySelectorAll
      // in document order, and a marked block nested inside another marked block
      // reports a SMALLER bottom than its parent, so the list is not sorted.
      // No boundary fits in this page at all (a single block taller than a full
      // page) — fall back to the plain cut rather than looping forever.
      const next = safe.length ? Math.max(...safe) : idealNext;
      offsets.push(next);
      yOffset = next;
    }
    return offsets;
  };

  const download = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const cap = await captureImage();
      if (!cap) return;
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      // Very thin margin — just enough to avoid printer clip zones.
      const margin = 4;
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      // Image fills the full usable width between the thin margins.
      const imgW = pageW - margin * 2;
      // Total rendered image height (scaled proportionally to imgW).
      const imgH = cap.ratio * imgW;
      // Height of the content area on each page.
      const contentH = pageH - margin * 2;
      if (imgH <= contentH) {
        // Single page — image fits without slicing.
        pdf.addImage(cap.dataURL, 'JPEG', margin, margin, imgW, imgH);
      } else {
        // Multi-page: slice the image by shifting its Y offset each page, at
        // row-safe boundaries — see computePageOffsets.
        const pxToPt = imgW / cap.renderW;
        const rowBreaksPt = cap.rowBreaksPx.map((y) => y * pxToPt);
        const offsets = computePageOffsets(imgH, contentH, rowBreaksPt);
        offsets.forEach((yOffset, i) => {
          if (i > 0) pdf.addPage();
          // Shift the image up by yOffset so the correct slice appears in the
          // content area of this page.
          pdf.addImage(cap.dataURL, 'JPEG', margin, margin - yOffset, imgW, imgH);
          // The image is drawn at FULL height every page and merely clipped by
          // the page edge — so when the next page's start was snapped backwards
          // to a block boundary, the strip between that boundary and the page
          // bottom is still painted here AND again at the top of the next page.
          // That is the duplicated block. Cover it.
          const sliceEnd = i + 1 < offsets.length ? offsets[i + 1] : imgH;
          const sliceH = sliceEnd - yOffset;
          if (sliceH < contentH) {
            pdf.setFillColor(255, 255, 255);
            pdf.rect(0, margin + sliceH, pageW, pageH - margin - sliceH, 'F');
          }
        });
      }
      const filename = buildBillFilename(isQuotation ? 'Quotation' : 'Order', order.code, `${fileSuffix}-${orderId}`);
      const blob = pdf.output('blob');
      // iOS: rasterising the document takes seconds, which outlives this tap's
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

  // Print the captured image only — guarantees no app/menu text and an exact match.
  const print = async () => {
    // iOS Safari's window.print() is unreliable for the hidden-image trick below
    // (it prints a blank / whole page). Route to the PDF instead — the user then
    // taps Print from the iOS share sheet / Safari's PDF viewer. `download` opens
    // the tab synchronously inside this tap, so iOS doesn't block it.
    if (isIOS()) {
      await download();
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
   * Arrived here from a one-tap action elsewhere (View Orders' card buttons):
   * run it without a second click. Same shape as the challan bill page.
   *
   * The capture rasterises the live DOM, so it has to wait for the document to
   * actually be on screen with fonts and logo resolved — firing on data arrival
   * alone yields a half-drawn page. Once fired the flag is stripped from history
   * so a refresh or Back/Forward doesn't repeat it.
   */
  const autoFired = useRef(false);
  const autoState = location.state as { autoPrint?: boolean; autoPdf?: boolean } | null;
  const wantsPrint = !!autoState?.autoPrint;
  const wantsPdf = !!autoState?.autoPdf;
  const ready = !!order;
  useEffect(() => {
    if ((!wantsPrint && !wantsPdf) || !ready || autoFired.current) return;
    autoFired.current = true;
    void (async () => {
      const node = document.getElementById('sales-order');
      const images = node ? [...node.querySelectorAll('img')] : [];
      await Promise.all([
        document.fonts?.ready ?? Promise.resolve(),
        ...images.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((res) => {
          img.addEventListener('load', () => res(), { once: true });
          img.addEventListener('error', () => res(), { once: true });
        }))),
      ]);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (wantsPrint) await print();
      else await download();
      navigate(location.pathname, { replace: true, state: null });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsPrint, wantsPdf, ready]);

  const totals = useMemo(() => {
    // Cancelled lines are excluded from the order totals.
    const items = (order?.items ?? []).filter((it) => it.status !== 'CANCELLED');
    return {
      bags: items.reduce((s, it) => s + (it.bags ?? 0), 0),
      pcs: items.reduce((s, it) => s + (it.pcs ?? 0), 0),
      kgs: items.reduce((s, it) => s + (it.gram ?? 0), 0),
      box: items.reduce((s, it) => s + (it.box ?? 0), 0),
    };
  }, [order]);

  if (isLoading || !order) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const BORDER = '#C9D2DC';
  // wordBreak + whiteSpace let long item names/comments wrap onto extra lines
  // instead of overflowing or stretching the column — the row then grows to fit
  // (verticalAlign: top keeps wrapped text starting at the top of the row).
  const th: CSSProperties = { background: ORANGE, color: BLACK, border: `0.2px solid ${BORDER}`, padding: '9px 11px', fontWeight: 800, fontSize: 18.5, whiteSpace: 'normal', wordBreak: 'break-word' };
  const td: CSSProperties = { border: `0.2px solid ${BORDER}`, padding: '8px 11px', whiteSpace: 'normal', wordBreak: 'break-word', verticalAlign: 'top' };

  return (
    <div className="flex w-full flex-col gap-4">
      <style>{PRINT_CSS}</style>
      {/* Hidden on screen; the only thing visible when printing. */}
      {printImg && <img id="print-image" src={printImg} alt="Sales Order" style={{ display: 'none' }} />}

      <div className="no-print flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft />
        </Button>
        <h2 className="text-xl font-bold tracking-tight">{pageTitle}</h2>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={print} disabled={busy}>
            <Printer /> Print
          </Button>
          <Button onClick={download} disabled={busy}>
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

      {/* ── Printable Sales Order (Kavish letterhead format) ────────────── */}
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
        style={isMobile ? { width: ORDER_DESIGN_W, transformOrigin: 'top left', transform: `scale(${fit.scale})` } : undefined}
      >
      <div
        id="sales-order"
        style={{
          position: 'relative',
          background: '#fff',
          color: BLACK,
          border: 'none',
          overflow: 'hidden',
          fontSize: 14,
          fontFamily: FONT,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {/* Very-light logo watermark — sits behind all content */}
        <img
          src={logoSrc}
          alt=""
          aria-hidden
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '55%',
            opacity: 0.03,
            pointerEvents: 'none',
            zIndex: 0,
            userSelect: 'none',
          }}
        />
        {/* Decorative banner — a close visual match to the letterhead's artwork
            (not a vector trace of it): navy fills the whole bar edge to edge,
            with an orange gradient block covering the right 65% at full
            height — square corners throughout except the one soft rounded
            notch at its bottom-left, where the two colours meet. */}
        <div style={{ position: 'relative', height: 56, width: '100%' }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: NAVY,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: '65%',
              background: `linear-gradient(90deg, ${BANNER_ORANGE_FROM} 0%, ${BANNER_ORANGE_TO} 100%)`,
              borderBottomLeftRadius: 28,
            }}
          />
        </div>

        <h1 style={{ textAlign: 'center', fontSize: 26, fontWeight: 700, fontFamily: FONT, letterSpacing: 1, margin: '16px 0 14px' }}>{docTitle}</h1>

        {/* Bill-to (left) · Kavish logo (center) · Order meta (right) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'flex-start', gap: 12, padding: '0 24px 16px' }}>
          <div style={{ fontSize: 19, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, textTransform: 'uppercase' }}>{isQuotation ? 'Quote To,' : 'Bill To,'}</div>
            <div style={{ fontWeight: 700, textTransform: 'uppercase' }}>{order.customerName}</div>
            {order.billingAddress && <div>{order.billingAddress}</div>}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <img src={logoSrc} alt={company?.name || 'Company logo'} style={{ width: 130, height: 'auto' }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 19, fontWeight: 700, lineHeight: 1.6 }}>
              <tbody>
                {([
                  [isQuotation ? 'Quotation ID' : 'Order ID', `#${shortOrderCode(order.code, order.id)}`],
                  // The party's OWN reference for this order. It was captured on the
                  // form and stored, but never printed — so the one number the
                  // customer files the document under was missing from the document.
                  // Conditional: an order without a PO must not print an empty row.
                  ...(order.poNumber ? ([['PO No', order.poNumber]] as const) : []),
                  [isQuotation ? 'Quotation Date' : 'Order Date', fmtDate(order.orderDate)],
                  // The same stored date reads differently per document: an order is
                  // DUE by it, a quotation merely stops being valid.
                  [isQuotation ? 'Valid Till' : 'Due Date', fmtDate(order.completionDate)],
                ] as const).map(([label, value], i, rows) => {
                  /* A hairline under each row, so Order ID / PO No / dates read
                     as separate facts rather than one block of text. Light
                     enough not to compete with the items table below, and
                     skipped on the last row so the group does not end on a rule
                     with nothing under it. */
                  const rule = i < rows.length - 1 ? { borderBottom: '1px solid #d7dbe3' } : undefined;
                  return (
                    <tr key={label}>
                      {/* Label — right-aligned so the colon column always lines up */}
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '3px 0', ...rule }}>{label}</td>
                      {/* Dedicated colon column — gives perfect vertical alignment */}
                      <td style={{ textAlign: 'center', padding: '3px 4px', whiteSpace: 'nowrap', ...rule }}>:</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '3px 0 3px 6px', ...rule }}>{value}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Items */}
        <div style={{ padding: '0 24px 16px' }}>
          {/* table-layout: auto lets each column shrink/grow to fit its content
              (autofit).  minWidth guards against very narrow numeric columns. */}
          <table id="items-table" style={{ width: '100%', tableLayout: 'auto', borderCollapse: 'collapse', fontSize: 18, fontWeight: 600, fontFamily: FONT }}>
            <thead style={{ textTransform: 'uppercase' }}>
              <tr>
                <th style={{ ...th, textAlign: 'center', whiteSpace: 'nowrap' }}>#</th>
                <th style={{ ...th, textAlign: 'left' }}>Item Name</th>
                <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>Bags</th>
                <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>PCs</th>
                <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>KGs</th>
                <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>Box</th>
                <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>Rate</th>
                <th style={{ ...th, textAlign: 'left' }}>Comments</th>
              </tr>
            </thead>
            <tbody>
              {order.items.filter((it) => it.status !== 'CANCELLED').map((it, idx) => (
                <tr key={it.id} style={{ background: idx % 2 === 1 ? '#F5F7FA' : '#fff' }}>
                  <td style={{ ...td, textAlign: 'center' }}>{idx + 1}</td>
                  <td style={td}>
                    {it.productName || it.product || '—'}
                    {it.priority === 'URGENT' && <span style={{ color: '#e11d48', fontWeight: 700 }}> (URGENT)</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{numf(it.bags)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{numf(it.pcs)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{numf(it.gram)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{numf(it.box)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{numf(it.rate)}</td>
                  <td style={td}>{it.comment || ''}</td>
                </tr>
              ))}
              {/* Total row — orange, quantity sums */}
              <tr>
                <td style={{ ...th, textAlign: 'right' }} colSpan={2}>Total</td>
                <td style={{ ...th, textAlign: 'right' }}>{numf(totals.bags)}</td>
                <td style={{ ...th, textAlign: 'right' }}>{numf(totals.pcs)}</td>
                <td style={{ ...th, textAlign: 'right' }}>{numf(totals.kgs)}</td>
                <td style={{ ...th, textAlign: 'right' }}>{numf(totals.box)}</td>
                <td style={th} colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>

        {/* Terms & Conditions — shown on both the Sales Order and the Quotation,
            so the two documents share the exact same printed format. */}
        {/* data-pdf-block marks a run of content the PDF slicer must not cut
            through — see captureImage/computePageOffsets. */}
        <div data-pdf-block style={{ padding: '0 24px', display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ fontSize: 17 }}>
            <div style={{ color: '#ff8c01', fontWeight: 700, fontSize: 19, marginBottom: 6 }}>Terms &amp; Conditions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {terms.map((t, i) => (
                <div key={i} data-pdf-block style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ width: 6, height: 6, marginTop: 5, flexShrink: 0, background: BLACK }} />
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 15, fontStyle: 'italic', fontWeight: 700, whiteSpace: 'nowrap', alignSelf: 'flex-end' }}>Authorised Signatory</div>
        </div>

        <div data-pdf-block style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, marginTop: 18, padding: '0 24px' }}>
          {footerLines.map((line, i) => (
            <div key={i} data-pdf-block>{line}</div>
          ))}
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}

export default OrderBillPage;
