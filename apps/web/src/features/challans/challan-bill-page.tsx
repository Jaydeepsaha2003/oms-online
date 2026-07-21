import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { Button } from '@/components/ui/button';
import { buildBillFilename, preOpenPdfTab, savePdfBlob } from '@/lib/pdf';
import kavishLogo from '@/assets/kavish-logo-order.png';
import { useChallanTerms, useCompany } from '@/features/settings/use-settings';
import { useChallan } from './use-challans';

// Same Kavish brand colours + letterhead layout as the Sales Order / Quotation bill,
// so all three printed documents look like one consistent family.
const NAVY = '#163e64';
const BANNER_ORANGE_FROM = '#EBC078';
const BANNER_ORANGE_TO = '#E2A346';
const ORANGE = '#E2A346';
const BLACK = '#111111';
const FONT = 'Montserrat, Carlito, Calibri, "Segoe UI", Arial, sans-serif';
const BORDER = '#D5D5D5';
// Crisp near-black hairline for the totals grid so it reads clean like the old receipt.
const INK = '#1a1a1a';

const docTitle = 'SALES RECEIPT';

const numf = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN');
// Whole rupees only — paise are dropped on the printed receipt.
const money = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtDate = (d?: string | null) => {
  if (!d) return '—';
  const x = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(x.getDate())}-${pad(x.getMonth() + 1)}-${x.getFullYear()}`;
};

/** Indian numbering amount-in-words (e.g. 1,05,588 → "RUPEES ONE LAKH FIVE THOUSAND FIVE HUNDRED AND EIGHTY EIGHT ONLY"). */
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
      x %= 10;
      if (x) s += ` ${ones[x]}`;
    } else if (x > 0) {
      s += ones[x];
    }
    return s;
  };
  let words = '';
  const crore = Math.floor(num / 10_000_000); num %= 10_000_000;
  const lakh = Math.floor(num / 100_000); num %= 100_000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  if (crore) words += `${below1000(crore)} Crore `;
  if (lakh) words += `${below1000(lakh)} Lakh `;
  if (thousand) words += `${below1000(thousand)} Thousand `;
  if (num) words += below1000(num);
  return words.trim();
}

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 10mm; }
  body * { visibility: hidden !important; }
  #print-image { display: block !important; visibility: visible !important; position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
}`;

export function ChallanBillPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const challanId = id ? Number(id) : undefined;
  const { data: challan, isLoading } = useChallan(challanId);
  const { data: termsData } = useChallanTerms();
  const terms = termsData?.terms ?? [];
  const { data: company } = useCompany();
  const logoSrc = company?.logo || kavishLogo;
  const [busy, setBusy] = useState(false);
  const [printImg, setPrintImg] = useState<string | null>(null);

  // Clear the print image once the print dialog closes.
  useEffect(() => {
    const clear = () => setPrintImg(null);
    window.addEventListener('afterprint', clear);
    return () => window.removeEventListener('afterprint', clear);
  }, []);

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
    const canvas = await html2canvas(clone, { scale: 3, backgroundColor: '#ffffff' });
    holder.remove();
    return { dataURL: canvas.toDataURL('image/jpeg', 0.95), ratio: canvas.height / canvas.width };
  };

  const download = async () => {
    if (!challan) return;
    // iOS Safari blocks a download/window.open that fires after the async capture
    // below — so reserve a tab NOW, inside the tap gesture (no-op off iOS).
    const iosTab = preOpenPdfTab();
    setBusy(true);
    try {
      const cap = await captureImage();
      if (!cap) { iosTab?.close(); return; }
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
      savePdfBlob(pdf.output('blob'), buildBillFilename('Challan', challan.code, `challan-${challanId}`), iosTab);
    } catch {
      iosTab?.close();
      toast.error('Could not generate the PDF');
    } finally {
      setBusy(false);
    }
  };

  // Print the captured image — guarantees no app/menu text and an exact match.
  const print = async () => {
    setBusy(true);
    try {
      const cap = await captureImage();
      if (!cap) return;
      setPrintImg(cap.dataURL);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.print();
    } catch {
      toast.error('Could not prepare the print');
    } finally {
      setBusy(false);
    }
  };

  const isKgs = (unit: string | null) => ['KGS', 'KG', 'KGS.'].includes((unit ?? '').trim().toUpperCase());
  const isScrap = (challan?.category ?? '').toUpperCase() === 'SCRAP';

  const totals = useMemo(() => {
    const items = challan?.items ?? [];
    return {
      bags: items.reduce((s, it) => s + (it.bags ?? 0), 0),
      box: items.reduce((s, it) => s + (it.box ?? 0), 0),
      pcs: items.reduce((s, it) => s + (it.pcs ?? 0), 0),
      kgs: items.reduce((s, it) => s + (it.kgs ?? 0), 0),
      subTotal: items.reduce((s, it) => s + (it.amount ?? 0), 0),
    };
  }, [challan]);

  if (isLoading || !challan) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const tcs = challan.tcs ?? 0;
  const tds = challan.tds ?? 0;
  const total = challan.total ?? 0;
  const netReceivable = total - tds;
  const norm = (s: string | null) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const hasDifferentShippingAddress =
    !!challan.shippingAddress?.trim() && norm(challan.shippingAddress) !== norm(challan.billingAddress);

  // wordBreak + whiteSpace let long item names wrap within their column.
  const th: CSSProperties = { background: ORANGE, color: BLACK, border: `0.2px solid ${BORDER}`, padding: '9px 11px', fontWeight: 800, fontSize: 18.5, whiteSpace: 'normal', wordBreak: 'break-word' };
  const td: CSSProperties = { border: `0.2px solid ${BORDER}`, padding: '8px 11px', whiteSpace: 'normal', wordBreak: 'break-word', verticalAlign: 'top', fontSize: 18 };

  return (
    <div className="flex w-full flex-col gap-4">
      <style>{PRINT_CSS}</style>
      {/* Hidden on screen; the only thing visible when printing. */}
      {printImg && <img id="print-image" src={printImg} alt="Sales Challan" style={{ display: 'none' }} />}

      <div className="no-print flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft />
        </Button>
        <h2 className="text-xl font-bold tracking-tight">Sales Challan</h2>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={print} disabled={busy}>
            <Printer /> Print
          </Button>
          <Button onClick={download} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
          </Button>
        </div>
      </div>

      {/* ── Printable Challan (matches the Sales Order / Quotation letterhead format) ── */}
      <div
        id="challan-invoice"
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
              background: `linear-gradient(90deg, ${BANNER_ORANGE_FROM} 0%, ${BANNER_ORANGE_TO} 100%)`,
              borderBottomLeftRadius: 28,
            }}
          />
        </div>

        {/* Title (left) · Kavish logo (center) · Invoice meta (right) — all sharing one row,
            with Bill To directly under the title, so no row is left with empty space
            beside a short column. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'start', gap: 12, padding: '10px 8px 6px' }}>
          <div style={{ fontSize: 19, lineHeight: 1.35 }}>
            <h1 style={{ textAlign: 'left', fontSize: 26, fontWeight: 700, fontFamily: FONT, letterSpacing: 1, margin: '0 0 6px' }}>{docTitle}</h1>
            <div style={{ fontWeight: 700, textTransform: 'uppercase' }}>Bill To,</div>
            <div style={{ fontWeight: 700, textTransform: 'uppercase' }}>{challan.customerName}</div>

            {/* Only shown when the shipping address actually differs from billing */}
            {hasDifferentShippingAddress && (
              <>
                <div style={{ fontWeight: 700, textTransform: 'uppercase', marginTop: 6 }}>Ship To,</div>
                <div>{challan.shippingAddress}</div>
              </>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignSelf: 'center' }}>
            <img src={logoSrc} alt={company?.name || 'Company logo'} style={{ width: 125, height: 'auto' }} />
          </div>

          {/* 6-column grid: label · colon · value (×2) — all colons perfectly aligned.
              alignSelf centers it against the logo's height, independent of the taller
              title/Bill-To column beside it. */}
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
                ['Invoice No', challan.code, 'Pay Term', challan.paymentTerm ? `${challan.paymentTerm} Days` : '—'],
                ['Invoice Date', fmtDate(challan.invDate), 'B', money(challan.b)],
                ['Due Date', fmtDate(challan.dueDate), 'C', money(challan.c)],
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

        {/* Items — table-layout: auto so each column autofits its content */}
        <div style={{ padding: '0 8px 10px' }}>
          <table style={{ width: '100%', tableLayout: 'auto', borderCollapse: 'collapse', fontSize: 18, fontWeight: 600, fontFamily: FONT }}>
            <thead style={{ textTransform: 'uppercase' }}>
              <tr>
                <th style={{ ...th, textAlign: 'center', whiteSpace: 'nowrap' }}>#</th>
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
              {challan.items.map((it, idx) => {
                const name = [it.productName, it.design && it.design.toUpperCase() !== 'NA' ? it.design : null].filter(Boolean).join(' ');
                return (
                  <tr key={it.id} style={{ background: idx % 2 === 1 ? '#F5F7FA' : '#fff' }}>
                    <td style={{ ...td, textAlign: 'center' }}>{idx + 1}</td>
                    <td style={td}>{name || '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{it.bags ? numf(it.bags) : '-'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{it.box ? numf(it.box) : '-'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{it.pcs ? numf(it.pcs) : '-'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{it.kgs ? numf(it.kgs) : '-'}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{isKgs(it.unit) ? 'KGS' : it.unit || '-'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{money(it.price)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{money(it.amount)}</td>
                  </tr>
                );
              })}
              {/* Total row — orange, matching the Sales Order total row */}
              <tr>
                <td style={{ ...th, textAlign: 'right' }} colSpan={2}>Total</td>
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

        {/* Amount in words (left) + charges / totals breakdown (right) */}
        <div style={{ padding: '0 8px 10px', display: 'flex', justifyContent: 'space-between', gap: 15 }}>
          <div style={{ fontSize: 19, maxWidth: '52%', lineHeight: 1.4 }}>
            <div style={{ color: '#ff8c01', fontWeight: 700, fontSize: 19 }}>Total In Words</div>
            <div style={{ fontWeight: 700, marginTop: 3, fontSize: 18 }}>{amountInWordsIndian(tds ? netReceivable : total)}</div>
            {challan.transName && (
              <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 800, marginTop: 20 }}>
                <span style={{ color: '#ff8c01' }}>TRANSPORTER : </span>
                {challan.transName}
              </div>
            )}
            {challan.remarks && (
              <>
                <div style={{ color: '#ff8c01', fontWeight: 700, fontSize: 16, marginTop: 6 }}>Remarks</div>
                <div style={{ marginTop: 3, color: '#555555', fontSize: 16 }}>{challan.remarks}</div>
              </>
            )}
          </div>

          <div style={{ border: `1.2px solid ${INK}`, borderRadius: 2, overflow: 'hidden', minWidth: 220 }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 20, width: '100%', fontFamily: FONT, textTransform: 'uppercase' }}>
              <colgroup>
                <col style={{ width: '70%' }} />
                <col style={{ width: '30%' }} />
              </colgroup>
              <tbody>
                {(
                  [
                    ['Sub Total Amount', money(totals.subTotal)],
                    ['Packing Charges', money(challan.packing)],
                    ...(challan.freight ? [['Freight Charges', money(challan.freight)]] : []),
                    ['Box / Pouch', money(challan.pouch)],
                    ['Tax Amount', money(challan.tax)],
                    ...(isScrap || tcs ? [['TCS @ 1%', money(tcs)]] : []),
                    ...(tds ? [[`Less: TDS${challan.tdsPercent ? ` @ ${challan.tdsPercent}%` : ''}`, `-${money(tds)}`]] : []),
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <tr key={label}>
                    <td style={{ fontWeight: 700, borderBottom: `0.8px solid ${INK}`, borderRight: `0.8px solid ${INK}`, padding: '7px 10px', whiteSpace: 'nowrap', fontSize: 19 }}>{label}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, borderBottom: `0.8px solid ${INK}`, padding: '7px 10px', fontSize: 19 }}>{value}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ fontWeight: 800, fontSize: 21, borderRight: `0.8px solid ${INK}`, borderTop: `1.2px solid ${INK}`, padding: '8px 10px', whiteSpace: 'nowrap' }}>{tds ? 'Net Receivable' : 'Grand Total Amount'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 800, fontSize: 21, borderTop: `1.2px solid ${INK}`, padding: '8px 10px' }}>{money(tds ? netReceivable : total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Terms & Conditions */}
        <div style={{ padding: '0 8px 6px' }}>
          {terms.length > 0 && (
            <div style={{ fontSize: 17, lineHeight: 1.3 }}>
              <div style={{ color: '#ff8c01', fontWeight: 700, fontSize: 19, marginBottom: 4 }}>Terms &amp; Conditions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {terms.map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
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
  );
}

export default ChallanBillPage;
