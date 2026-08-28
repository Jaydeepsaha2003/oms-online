import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { renderDocLines, type NoteMode } from '@oms/shared';
import { ArrowLeft, Download, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { Button } from '@/components/ui/button';
import { buildBillFilename, captureScale, decodeImage, isIOS, savePdfBlob, waitForPaintable } from '@/lib/pdf';
import { formatDate } from '@/lib/date-format';
import kavishLogo from '@/assets/kavish-logo-order.png';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useFitToWidth } from '@/hooks/use-fit-to-width';
import { useChallanTerms, useCompany } from '@/features/settings/use-settings';
import { useNote } from './use-notes';

/*
 * Debit / Credit Note, printed on the Challan letterhead.
 *
 * These two used to be a server-side pdfmake document — no logo, no watermark,
 * no terms, a different typeface — so a note handed to a party plainly did not
 * come from the same company as the challan next to it. This is the challan
 * bill's layout with the note's own fields in it, so the whole set of printed
 * documents reads as one.
 *
 * Colours and font are the CHALLAN's, deliberately: the Sales Order bill uses a
 * warmer orange (#F99A0F) and Calibri, so "match the challan" is a real choice
 * between two existing looks rather than one house style.
 */

/** A4 design width the note is laid out at — matches the PDF capture width. */
const NOTE_DESIGN_W = 960;

const NAVY = '#163e64';
const BANNER_ORANGE_FROM = '#EBC078';
const BANNER_ORANGE_TO = '#E2A346';
const ORANGE = '#E2A346';
const BLACK = '#111111';
const FONT = 'Montserrat, Carlito, Calibri, "Segoe UI", Arial, sans-serif';
/** Crisp near-black hairline for the grids, as on the challan. */
const INK = '#1a1a1a';

const numf = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN');
/** Whole rupees only — paise are dropped on the printed document. */
const money = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
/** Rate keeps its decimals; rounding it would change the agreed price. */
const rateFmt = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtDate = (d?: string | null) => formatDate(d);

/** Indian numbering amount-in-words, same wording as the challan. */
function amountInWordsIndian(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const words = rupees === 0 ? 'Zero' : numToWords(rupees);
  return `RUPEES ${words} ONLY`.toUpperCase();
}

function numToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const below1000 = (x: number): string => {
    let s = '';
    if (x >= 100) {
      s += `${ones[Math.floor(x / 100)]} Hundred`;
      x %= 100;
      if (x) s += ' And ';
    }
    if (x >= 20) {
      s += tens[Math.floor(x / 10)];
      if (x % 10) s += ` ${ones[x % 10]}`;
    } else if (x > 0) {
      s += ones[x];
    }
    return s;
  };
  const parts: string[] = [];
  const crore = Math.floor(num / 10000000);
  if (crore) { parts.push(`${below1000(crore)} Crore`); num %= 10000000; }
  const lakh = Math.floor(num / 100000);
  if (lakh) { parts.push(`${below1000(lakh)} Lakh`); num %= 100000; }
  const thousand = Math.floor(num / 1000);
  if (thousand) { parts.push(`${below1000(thousand)} Thousand`); num %= 1000; }
  if (num) parts.push(below1000(num));
  return parts.join(' ').trim();
}

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 10mm; }
  body * { visibility: hidden !important; }
  #print-image { display: block !important; visibility: visible !important; position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
}`;

/**
 * The note is addressed by mode + code, and a code carries a slash ("CN/13").
 * An encoded slash inside a path segment is handled inconsistently across
 * servers and routers, so the code travels as a query parameter instead.
 */
export function NoteBillPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const mode = (params.get('mode') ?? 'DEBIT').toUpperCase() as NoteMode;
  const code = params.get('code') ?? '';

  const { data: note, isLoading } = useNote(mode, code);
  const isCredit = mode === 'CREDIT';
  const docTitle = isCredit ? 'CREDIT NOTE' : 'DEBIT NOTE';
  const pageTitle = isCredit ? 'Credit Note' : 'Debit Note';

  // The challan's own terms list, so the two documents carry identical wording.
  const { data: termsData, isPending: termsPending } = useChallanTerms();
  const terms = useMemo(
    () =>
      renderDocLines(termsData?.terms ?? [], {
        pay_terms: note?.paymentTerm ?? null,
        party: note?.customerName ?? null,
        doc_no: note?.code ?? null,
        doc_date: note ? fmtDate(note.invDate) : null,
        due_date: note?.dueDate ? fmtDate(note.dueDate) : null,
      }),
    [termsData, note],
  );
  const { data: company, isPending: companyPending } = useCompany();
  const logoSrc = company?.logo || kavishLogo;

  const [busy, setBusy] = useState(false);
  const [printImg, setPrintImg] = useState<string | null>(null);
  /** iOS only: a finished PDF waiting for a fresh tap (see `download`). */
  const [readyPdf, setReadyPdf] = useState<{ blob: Blob; filename: string } | null>(null);
  const isMobile = useIsMobile();
  const fit = useFitToWidth(NOTE_DESIGN_W, isMobile);

  useEffect(() => {
    const clear = () => setPrintImg(null);
    window.addEventListener('afterprint', clear);
    return () => window.removeEventListener('afterprint', clear);
  }, []);

  const totals = useMemo(() => {
    const items = note?.items ?? [];
    return {
      bags: items.reduce((s, it) => s + (it.bags ?? 0), 0),
      pcs: items.reduce((s, it) => s + (it.pcs ?? 0), 0),
      kgs: items.reduce((s, it) => s + (it.kgs ?? 0), 0),
      box: items.reduce((s, it) => s + (it.box ?? 0), 0),
      subTotal: items.reduce((s, it) => s + (it.amount ?? 0), 0),
    };
  }, [note]);

  /** Capture the rendered note as a crisp A4-proportioned JPEG. */
  const captureImage = async (): Promise<{ dataURL: string; ratio: number; renderW: number; rowBreaksPx: number[] } | null> => {
    const src = document.getElementById('note-bill');
    if (!src) return null;
    const PDF_RENDER_W = 960;
    const clone = src.cloneNode(true) as HTMLElement;
    clone.style.width = `${PDF_RENDER_W}px`;
    clone.style.borderRadius = '0';
    const holder = document.createElement('div');
    holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${PDF_RENDER_W}px;background:#ffffff`;
    holder.appendChild(clone);
    document.body.appendChild(holder);
    // Before any measurement: an undecoded logo has no height, so measuring
    // first describes a layout that never gets printed.
    await waitForPaintable(clone);
    const cloneTop = clone.getBoundingClientRect().top;
    const rowBreaksPx = [...clone.querySelectorAll('#items-table tr, [data-pdf-block]')].map(
      (el) => el.getBoundingClientRect().bottom - cloneTop,
    );
    const canvas = await html2canvas(clone, { scale: captureScale(), backgroundColor: '#ffffff' });
    holder.remove();
    const dataURL = canvas.toDataURL('image/jpeg', 0.95);
    // Safari returns a stub ("data:,") rather than throwing when it gives up.
    if (!dataURL.startsWith('data:image/')) throw new Error('Canvas capture failed');
    return { dataURL, ratio: canvas.height / canvas.width, renderW: PDF_RENDER_W, rowBreaksPx };
  };

  /** Page cuts snapped back to a row boundary, so no row is torn in two. */
  const computePageOffsets = (imgH: number, contentH: number, rowBreaksPt: number[]): number[] => {
    const offsets = [0];
    let yOffset = 0;
    while (yOffset + contentH < imgH) {
      const idealNext = yOffset + contentH;
      const safe = rowBreaksPt.filter((y) => y > yOffset && y <= idealNext);
      const next = safe.length ? Math.max(...safe) : idealNext;
      offsets.push(next);
      yOffset = next;
    }
    return offsets;
  };

  const download = async () => {
    if (!note) return;
    setBusy(true);
    try {
      const cap = await captureImage();
      if (!cap) return;
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      const margin = 4;
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW - margin * 2;
      const imgH = cap.ratio * imgW;
      const contentH = pageH - margin * 2;
      if (imgH <= contentH) {
        pdf.addImage(cap.dataURL, 'JPEG', margin, margin, imgW, imgH);
      } else {
        const pxToPt = imgW / cap.renderW;
        const rowBreaksPt = cap.rowBreaksPx.map((y) => y * pxToPt);
        const offsets = computePageOffsets(imgH, contentH, rowBreaksPt);
        offsets.forEach((yOffset, i) => {
          if (i > 0) pdf.addPage();
          pdf.addImage(cap.dataURL, 'JPEG', margin, margin - yOffset, imgW, imgH);
          // The image is drawn full-height every page and merely clipped, so the
          // strip below a backwards-snapped cut would print twice. Cover it.
          const sliceEnd = i + 1 < offsets.length ? offsets[i + 1] : imgH;
          const sliceH = sliceEnd - yOffset;
          if (sliceH < contentH) {
            pdf.setFillColor(255, 255, 255);
            pdf.rect(0, margin + sliceH, pageW, pageH - margin - sliceH, 'F');
          }
        });
      }
      const filename = buildBillFilename(pageTitle, note.code, `${isCredit ? 'credit' : 'debit'}-note`);
      const blob = pdf.output('blob');
      // iOS: the capture outlives this tap's transient activation, so the share
      // sheet would be refused. Park the PDF and let a fresh tap hand it over.
      if (isIOS()) setReadyPdf({ blob, filename });
      else void savePdfBlob(blob, filename);
    } catch {
      toast.error('Could not generate the PDF');
    } finally {
      setBusy(false);
    }
  };

  const deliverReadyPdf = () => {
    if (!readyPdf) return;
    void savePdfBlob(readyPdf.blob, readyPdf.filename);
    setReadyPdf(null);
  };

  /** Print the captured image only — no app chrome, an exact match to the PDF. */
  const print = async () => {
    if (isIOS()) {
      await download();
      return;
    }
    setBusy(true);
    try {
      const cap = await captureImage();
      if (!cap) return;
      setPrintImg(cap.dataURL);
      await decodeImage(cap.dataURL);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.print();
    } catch {
      toast.error('Could not prepare the print');
    } finally {
      setBusy(false);
    }
  };

  /*
   * Arrived from the notes directory's Print button: run it without a second
   * click. Gated on the logo AND the terms, not just the note — the terms block
   * is rendered behind `terms.length > 0`, so capturing before it lands prints
   * a document with its whole bottom section missing.
   */
  const autoFired = useRef(false);
  const autoState = location.state as { autoPrint?: boolean; autoPdf?: boolean } | null;
  const wantsPrint = !!autoState?.autoPrint;
  const wantsPdf = !!autoState?.autoPdf;
  const ready = !!note;
  const printableReady = !companyPending && !termsPending;
  useEffect(() => {
    if ((!wantsPrint && !wantsPdf) || !ready || !printableReady || autoFired.current) return;
    autoFired.current = true;
    void (async () => {
      const node = document.getElementById('note-bill');
      if (node) await waitForPaintable(node);
      if (wantsPrint) await print();
      else await download();
      navigate(location.pathname + location.search, { replace: true, state: null });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsPrint, wantsPdf, ready, printableReady]);

  if (isLoading || !note) {
    return (
      <div className="text-muted-foreground flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const total = note.total ?? 0;

  const th: CSSProperties = { background: ORANGE, color: BLACK, borderBottom: `1.2px solid ${INK}`, borderRight: `1.2px solid ${INK}`, padding: '3px 11px', fontWeight: 800, fontSize: 18.5, whiteSpace: 'normal', wordBreak: 'break-word' };
  const td: CSSProperties = { borderBottom: `1.2px solid ${INK}`, borderRight: `1.2px solid ${INK}`, padding: '3px 11px', whiteSpace: 'normal', wordBreak: 'break-word', verticalAlign: 'top' };
  const totalCell: CSSProperties = { fontWeight: 700, borderBottom: `1.2px solid ${INK}`, borderRight: `1.2px solid ${INK}`, padding: '3px 14px', whiteSpace: 'nowrap', fontSize: 19 };
  const totalValue: CSSProperties = { textAlign: 'right', fontWeight: 700, borderBottom: `1.2px solid ${INK}`, padding: '3px 14px', whiteSpace: 'nowrap', fontSize: 19 };

  return (
    <div className="flex w-full flex-col gap-4">
      <style>{PRINT_CSS}</style>
      {printImg && <img id="print-image" src={printImg} alt={docTitle} style={{ display: 'none' }} />}

      <div className="no-print flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft />
        </Button>
        <h2 className="text-xl font-bold tracking-tight">
          {pageTitle} <span className="text-muted-foreground font-mono">{note.code}</span>
        </h2>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={print} disabled={busy}>
            <Printer /> Print
          </Button>
          <Button onClick={download} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
          </Button>
        </div>
      </div>

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

      {/* ── Printable note (Challan letterhead format) ───────────────────── */}
      <div
        ref={fit.outerRef}
        className={isMobile ? 'overflow-hidden rounded-lg border shadow-sm' : undefined}
        style={isMobile ? { height: fit.height } : undefined}
      >
      <div
        ref={fit.innerRef}
        style={isMobile ? { width: NOTE_DESIGN_W, transformOrigin: 'top left', transform: `scale(${fit.scale})` } : undefined}
      >
      <div
        id="note-bill"
        style={{
          position: 'relative',
          background: '#fff',
          color: BLACK,
          border: 'none',
          overflow: 'hidden',
          fontSize: 14,
          fontFamily: FONT,
          fontVariantNumeric: 'tabular-nums',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
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

        {/* Decorative banner — navy base with orange-gradient right block */}
        <div style={{ position: 'relative', height: 56, width: '100%' }}>
          <div style={{ position: 'absolute', inset: 0, background: NAVY }} />
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: '65%',
              background: `linear-gradient(180deg, rgba(138,82,10,0.34) 0%, rgba(138,82,10,0) 48%), linear-gradient(90deg, ${BANNER_ORANGE_FROM} 0%, ${BANNER_ORANGE_TO} 100%)`,
              borderBottomLeftRadius: 28,
            }}
          />
        </div>

        {/* Title (left) · logo (center) · note meta (right) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'start', gap: 12, padding: '10px 8px 6px' }}>
          <div style={{ fontSize: 19, lineHeight: 1.35 }}>
            <h1 style={{ textAlign: 'left', fontSize: 26, fontWeight: 700, fontFamily: FONT, letterSpacing: 1, margin: '0 0 6px' }}>{docTitle}</h1>
            <div style={{ fontWeight: 700, textTransform: 'uppercase' }}>Bill To,</div>
            <div style={{ fontWeight: 700, textTransform: 'uppercase' }}>{note.customerName}</div>
            {note.billingAddress && (
              <div style={{ whiteSpace: 'pre-line', fontWeight: 600 }}>{note.billingAddress}</div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignSelf: 'center' }}>
            {/* Fixed box, not auto height: an undecoded logo would collapse this
                row and shift everything below it in the captured PDF. */}
            <img
              src={logoSrc}
              alt={company?.name || 'Company logo'}
              style={{ width: 125, height: 84, objectFit: 'contain' }}
            />
          </div>

          {/* 6-column grid: label · colon · value (×2) — all colons aligned. */}
          <div
            style={{
              display: 'grid',
              alignSelf: 'center',
              gridTemplateColumns: 'auto auto auto auto auto auto',
              columnGap: 10,
              rowGap: 1,
              justifyContent: 'end',
              fontSize: 17,
              fontWeight: 700,
              fontFamily: FONT,
              lineHeight: 1.25,
              textTransform: 'uppercase',
            }}
          >
            {(
              [
                [`${isCredit ? 'Credit' : 'Debit'} Note No`, note.code, 'Pay Term', note.paymentTerm ? `${note.paymentTerm} Days` : '—'],
                ['Note Date', fmtDate(note.invDate), 'B', money(note.b)],
                ['Due Date', fmtDate(note.dueDate), 'C', money(note.c)],
              ] as [string, string, string, string][]
            ).map((row, ri) => (
              <Fragment key={ri}>
                <span style={{ textAlign: 'right', whiteSpace: 'nowrap', color: '#555555' }}>{row[0]}</span>
                <span style={{ textAlign: 'center', padding: '0 2px', color: '#555555' }}>:</span>
                <span style={{ textAlign: 'right', whiteSpace: 'nowrap', paddingRight: 36 }}>{row[1]}</span>
                <span style={{ textAlign: 'right', whiteSpace: 'nowrap', color: '#555555' }}>{row[2]}</span>
                <span style={{ textAlign: 'center', padding: '0 2px', color: '#555555' }}>:</span>
                <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{row[3]}</span>
              </Fragment>
            ))}
          </div>
        </div>

        {/* Items. The wrapper draws the top + left edges and the cells draw
            bottom + right, so every grid line is painted exactly once. */}
        <div style={{ padding: '0 8px 10px' }}>
          <div style={{ borderTop: `1.2px solid ${INK}`, borderLeft: `1.2px solid ${INK}` }}>
          <table id="items-table" style={{ width: '100%', tableLayout: 'auto', borderCollapse: 'collapse', fontSize: 18, fontWeight: 600, fontFamily: FONT }}>
            <thead style={{ textTransform: 'uppercase' }}>
              <tr>
                <th style={{ ...th, textAlign: 'center', whiteSpace: 'nowrap' }}>#</th>
                {/* A note exists because of an earlier sale, so the invoice it
                    refers to belongs on the printed document. */}
                <th style={{ ...th, textAlign: 'left', whiteSpace: 'nowrap' }}>Ref Inv</th>
                <th style={{ ...th, textAlign: 'left' }}>Item Name</th>
                <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>Bags</th>
                <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>Box</th>
                <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>Pcs</th>
                <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>Kgs</th>
                <th style={{ ...th, textAlign: 'center', whiteSpace: 'nowrap' }}>Unit</th>
                <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>Rate</th>
                <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {note.items.map((it, idx) => {
                const name = [it.productName, it.design && it.design.toUpperCase() !== 'NA' ? it.design : null].filter(Boolean).join(' ');
                return (
                  <tr key={it.id} style={{ background: idx % 2 === 1 ? '#F5F7FA' : '#fff' }}>
                    <td style={{ ...td, textAlign: 'center' }}>{idx + 1}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{it.refInvNo || '-'}</td>
                    <td style={td}>{name || '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{it.bags ? numf(it.bags) : '-'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{it.box ? numf(it.box) : '-'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{it.pcs ? numf(it.pcs) : '-'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{it.kgs ? numf(it.kgs) : '-'}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{it.unit || '-'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{rateFmt(it.price)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{money(it.amount)}</td>
                  </tr>
                );
              })}
              {/* Total row — orange, matching the challan */}
              <tr>
                <td style={{ ...th, textAlign: 'right' }} colSpan={3}>Total</td>
                <td style={{ ...th, textAlign: 'right' }}>{numf(totals.bags)}</td>
                <td style={{ ...th, textAlign: 'right' }}>{numf(totals.box)}</td>
                <td style={{ ...th, textAlign: 'right' }}>{numf(totals.pcs)}</td>
                <td style={{ ...th, textAlign: 'right' }}>{numf(totals.kgs)}</td>
                <td style={th} />
                <td style={th} />
                <td style={{ ...th, textAlign: 'right' }}>{money(totals.subTotal)}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>

        {/* Amount in words (left) + charges / totals breakdown (right) */}
        <div style={{ padding: '0 8px 10px', display: 'flex', justifyContent: 'space-between', gap: 15 }}>
          <div style={{ fontSize: 19, maxWidth: '52%', lineHeight: 1.4 }} data-pdf-block>
            <div style={{ color: ORANGE, fontWeight: 700, fontSize: 19 }}>Total In Words</div>
            <div style={{ fontWeight: 700, marginTop: 3, fontSize: 18 }}>{amountInWordsIndian(total)}</div>
            {note.transName && (
              <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 800, marginTop: 20 }}>
                <span style={{ color: ORANGE }}>TRANSPORTER : </span>
                {note.transName}
              </div>
            )}
            {note.remarks && (
              <>
                <div style={{ fontFamily: FONT, color: ORANGE, fontWeight: 700, fontSize: 16, marginTop: 6 }}>Remarks</div>
                <div style={{ fontFamily: FONT, marginTop: 3, color: '#555555', fontSize: 16 }}>{note.remarks}</div>
              </>
            )}
          </div>

          <div style={{ border: `1.4px solid ${INK}`, minWidth: 380, alignSelf: 'flex-start' }} data-pdf-block>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: FONT }}>
              <colgroup>
                <col style={{ width: '62%' }} />
                <col style={{ width: '38%' }} />
              </colgroup>
              <tbody>
                <tr style={{ background: ORANGE }}>
                  <td style={totalCell}>Sub Total Amount</td>
                  <td style={totalValue}>{money(totals.subTotal)}</td>
                </tr>
                {(
                  [
                    ['Packing Charges', money(note.packing)],
                    ['Freight Charges', note.freight ? money(note.freight) : '-'],
                    ['Box/Pouch', money(note.pouch)],
                    // Only when it carries a figure — a zero row on every note
                    // would be noise on the many that never use it.
                    ...(note.otherCharges ? [['Other Charges', money(note.otherCharges)]] : []),
                    [`Tax Amount${note.gst ? ` @ ${note.gst}%` : ''}`, money(note.tax)],
                    // No Round Off row: the challan has none, and this document
                    // prints whole rupees, so the sub-rupee rounding could only
                    // ever render as "0" or "-0". It is already inside the total.
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <tr key={label}>
                    <td style={totalCell}>{label}</td>
                    <td style={totalValue}>{value}</td>
                  </tr>
                ))}
                <tr style={{ background: ORANGE }}>
                  <td style={{ fontWeight: 800, fontSize: 21, borderRight: `1.2px solid ${INK}`, padding: '4px 14px', whiteSpace: 'nowrap' }}>Grand Total Amount</td>
                  <td style={{ textAlign: 'right', fontWeight: 800, fontSize: 21, padding: '4px 14px', whiteSpace: 'nowrap' }}>{money(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Terms & Conditions */}
        <div style={{ padding: '0 8px 6px' }}>
          {terms.length > 0 && (
            <div style={{ fontSize: 17, lineHeight: 1.3 }}>
              <div style={{ color: ORANGE, fontWeight: 700, fontSize: 19, marginBottom: 4 }}>Terms &amp; Conditions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {terms.map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }} data-pdf-block>
                    <span style={{ width: 5, height: 5, marginTop: 4, flexShrink: 0, background: BLACK }} />
                    <span style={{ fontSize: 16 }}>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}

export default NoteBillPage;
