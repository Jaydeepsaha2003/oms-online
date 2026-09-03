import { Fragment, type CSSProperties } from 'react';
import { renderDocLines } from '@oms/shared';
import type { ChallanDto } from '@oms/shared';
import { formatDate } from '@/lib/date-format';
import kavishLogo from '@/assets/kavish-logo-order.png';

/**
 * The printable Sales Receipt itself — the one and only rendering of a challan
 * that gets printed.
 *
 * Lifted out of ChallanBillPage so it can be mounted more than once: bulk print
 * renders each selected challan through THIS component off-screen and captures
 * it, which is the only way a batch can come out identical to the single print.
 * The PDF is a raster capture of this DOM (see captureImage), so a second,
 * separately-written layout for batches would print visibly different invoices
 * for the same data — and pdfmake's server-side challan PDF, which does exist,
 * is exactly that other layout.
 *
 * Presentational and self-contained: everything below the props is derived from
 * `challan` + `kgsForPcs`, so the caller never has to reproduce the totals or
 * the Kgs-suppression rules to get a faithful copy.
 */
// Same Kavish brand colours + letterhead layout as the Sales Order / Quotation bill,
// so all three printed documents look like one consistent family.
const NAVY = '#163e64';
const BANNER_ORANGE_FROM = '#EBC078';
const BANNER_ORANGE_TO = '#E2A346';
const ORANGE = '#E2A346';
const BLACK = '#111111';
const FONT = 'Montserrat, Carlito, Calibri, "Segoe UI", Arial, sans-serif';
// Crisp near-black hairline for the totals grid so it reads clean like the old receipt.
const INK = '#1a1a1a';

const docTitle = 'SALES RECEIPT';

const numf = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN');
// Whole rupees only — paise are dropped on the printed receipt.
const money = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
// Rate keeps its decimals (e.g. 92.5) — rounding it to a whole number silently
// changes the actual agreed price shown on the receipt, unlike Amount which is
// genuinely whole rupees.
const rateFmt = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
// Follows the system-wide date format (dd-mm-yy by default).
const fmtDate = (d?: string | null) => formatDate(d);

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

/** Sold by the piece. Substring match, like the desktop OMS — the unit is free
 *  text and turns up as "PCS", "PCS.", "NOS/PCS" and so on. Cups are sold this
 *  way, which is why they are what the Kgs question is really about. */
export const isPcsUnit = (unit: string | null) => (unit ?? '').trim().toUpperCase().includes('PCS');

/** How many PCS-sold lines this challan has — 0 means the Kgs question does not
 *  apply to it at all, and bulk print skips asking. */
export const pcsLineCount = (challan: Pick<ChallanDto, 'items'>) =>
  (challan.items ?? []).filter((it) => isPcsUnit(it.unit)).length;

export interface ChallanInvoiceProps {
  challan: ChallanDto;
  /** Terms already tag-substituted for THIS challan (see renderDocLines). */
  terms: string[];
  /** Company logo (falls back to the bundled Kavish mark). */
  logoSrc?: string | null;
  /** Company display name — the logo's alt text. */
  companyName?: string | null;
  /** Do the PCS-sold lines print their Kgs? Off prints a dash and leaves those
   *  lines out of the Kgs total. See ChallanBillPage.askKgsForPcs. */
  kgsForPcs?: boolean;
  /** DOM id the capture targets. Distinct per mount when several are rendered
   *  at once, or html2canvas would keep capturing the first one. */
  domId?: string;
}

export function ChallanInvoice({
  challan,
  terms,
  logoSrc: logoSrcProp,
  companyName,
  kgsForPcs = false,
  domId = 'challan-invoice',
}: ChallanInvoiceProps) {
  const logoSrc = logoSrcProp || kavishLogo;
  const company = { name: companyName ?? null };
  const items = challan.items ?? [];

  const tcs = challan.tcs ?? 0;
  const tds = challan.tds ?? 0;
  const total = challan.total ?? 0;
  const netReceivable = total - tds;
  const norm = (s: string | null) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const hasDifferentShippingAddress =
    !!challan.shippingAddress?.trim() && norm(challan.shippingAddress) !== norm(challan.billingAddress);

  const isKgs = (unit: string | null) => ['KGS', 'KG', 'KGS.'].includes((unit ?? '').trim().toUpperCase());
  const isScrap = (challan.category ?? '').toUpperCase() === 'SCRAP';
  /** Does this line's Kgs go on the printed challan? */
  const showKgs = (unit: string | null) => kgsForPcs || !isPcsUnit(unit);

  const totals = {
    bags: items.reduce((s, it) => s + (it.bags ?? 0), 0),
    box: items.reduce((s, it) => s + (it.box ?? 0), 0),
    pcs: items.reduce((s, it) => s + (it.pcs ?? 0), 0),
    // Only the Kgs actually printed are totalled — a total that counted lines
    // showing "-" would contradict the column right above it.
    kgs: items.reduce((s, it) => s + (showKgs(it.unit) ? (it.kgs ?? 0) : 0), 0),
    subTotal: items.reduce((s, it) => s + (it.amount ?? 0), 0),
  };

  // wordBreak + whiteSpace let long item names wrap within their column.
  // Single-draw borders (bottom + right only) - the wrapping div supplies the top
  // + left edges. This avoids html2canvas double-painting collapsed borders, which
  // made the inner grid lines look bolder than the outer edge.
  const th: CSSProperties = { background: ORANGE, color: BLACK, borderBottom: `1.2px solid ${INK}`, borderRight: `1.2px solid ${INK}`, padding: '3px 11px', fontWeight: 800, fontSize: 18.5, whiteSpace: 'normal', wordBreak: 'break-word' };
  const td: CSSProperties = { borderBottom: `1.2px solid ${INK}`, borderRight: `1.2px solid ${INK}`, padding: '3px 11px', whiteSpace: 'normal', wordBreak: 'break-word', verticalAlign: 'top', fontSize: 18 };

  return (
  <div
    id={domId}
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
        {/*
          * Fixed box, not `height: 'auto'`.
          *
          * With auto height this row's height depended on the logo having
          * decoded — undecoded meant a collapsed header and every row below
          * shifted up, which is exactly what the PDF captured on a cold open.
          * 125x84 is the bundled mark's own ratio; `contain` letterboxes a
          * company-uploaded logo of any other shape rather than distorting it,
          * and the reserved space is identical either way.
          */}
        <img
          src={logoSrc}
          alt={company?.name || 'Company logo'}
          style={{ width: 125, height: 84, objectFit: 'contain' }}
        />
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

    {/* Items — table-layout: auto so each column autofits its content. The
        wrapper draws the top + left edges (cells draw bottom + right), so every
        grid line is painted exactly once and reads uniform after PDF capture. */}
    <div style={{ padding: '0 8px 10px' }}>
      <div style={{ borderTop: `1.2px solid ${INK}`, borderLeft: `1.2px solid ${INK}` }}>
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
                {/* A PCS-sold line only shows its Kgs when the operator said
                    so at print time (see askKgsForPcs). */}
                <td style={{ ...td, textAlign: 'right' }}>{showKgs(it.unit) && it.kgs ? numf(it.kgs) : '-'}</td>
                <td style={{ ...td, textAlign: 'center' }}>{isKgs(it.unit) ? 'KGS' : it.unit || '-'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{rateFmt(it.price)}</td>
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
    </div>

    {/* Amount in words (left) + charges / totals breakdown (right) */}
    <div style={{ padding: '0 8px 10px', display: 'flex', justifyContent: 'space-between', gap: 15 }}>
      <div style={{ fontSize: 19, maxWidth: '52%', lineHeight: 1.4 }}>
        <div style={{ color: ORANGE, fontWeight: 700, fontSize: 19 }}>Total In Words</div>
        <div style={{ fontWeight: 700, marginTop: 3, fontSize: 18 }}>{amountInWordsIndian(tds ? netReceivable : total)}</div>
        {challan.transName && (
          <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 800, marginTop: 20 }}>
            <span style={{ color: ORANGE }}>TRANSPORTER : </span>
            {challan.transName}
          </div>
        )}
        {challan.remarks && (
          <>
            {/* `fontFamily: FONT` on both, like the Transporter line above:
                without it these two fell back to the default face and the
                remarks visibly didn't match the rest of the bill. */}
            <div style={{ fontFamily: FONT, color: ORANGE, fontWeight: 700, fontSize: 16, marginTop: 6 }}>Remarks</div>
            <div style={{ fontFamily: FONT, marginTop: 3, color: '#555555', fontSize: 16 }}>{challan.remarks}</div>
          </>
        )}
      </div>

      {/* Charges / totals — Sub Total + Grand Total rows filled orange, the
          charge rows white, all with black grid borders (matches the reference).
          Freight always shows, "-" when zero. Sizes to content, min 260. */}
      <div style={{ border: `1.4px solid ${INK}`, minWidth: 380, alignSelf: 'flex-start' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: FONT }}>
          <colgroup>
            <col style={{ width: '62%' }} />
            <col style={{ width: '38%' }} />
          </colgroup>
          <tbody>
            <tr style={{ background: ORANGE }}>
              <td style={{ fontWeight: 700, borderBottom: `1.2px solid ${INK}`, borderRight: `1.2px solid ${INK}`, padding: '3px 14px', whiteSpace: 'nowrap', fontSize: 19 }}>Sub Total Amount</td>
              <td style={{ textAlign: 'right', fontWeight: 700, borderBottom: `1.2px solid ${INK}`, padding: '3px 14px', whiteSpace: 'nowrap', fontSize: 19 }}>{money(totals.subTotal)}</td>
            </tr>
            {(
              [
                ['Packing Charges', money(challan.packing)],
                ['Freight Charges', challan.freight ? money(challan.freight) : '-'],
                ['Box/Pouch', money(challan.pouch)],
                ['Tax Amount', money(challan.tax)],
                ...(isScrap || tcs ? [[`TCS${challan.tcsPercent ? ` @ ${challan.tcsPercent}%` : ''}`, money(tcs)]] : []),
                ...(tds ? [[`Less: TDS${challan.tdsPercent ? ` @ ${challan.tdsPercent}%` : ''}`, `-${money(tds)}`]] : []),
              ] as [string, string][]
            ).map(([label, value]) => (
              <tr key={label}>
                <td style={{ fontWeight: 700, borderBottom: `1.2px solid ${INK}`, borderRight: `1.2px solid ${INK}`, padding: '3px 14px', whiteSpace: 'nowrap', fontSize: 19 }}>{label}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, borderBottom: `1.2px solid ${INK}`, padding: '3px 14px', whiteSpace: 'nowrap', fontSize: 19 }}>{value}</td>
              </tr>
            ))}
            <tr style={{ background: ORANGE }}>
              <td style={{ fontWeight: 800, fontSize: 21, borderRight: `1.2px solid ${INK}`, padding: '4px 14px', whiteSpace: 'nowrap' }}>{tds ? 'Net Receivable' : 'Grand Total Amount'}</td>
              <td style={{ textAlign: 'right', fontWeight: 800, fontSize: 21, padding: '4px 14px', whiteSpace: 'nowrap' }}>{money(tds ? netReceivable : total)}</td>
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
  );
}

/** The challan's terms, tag-substituted — the shape ChallanInvoice wants.
 *  Shared so the bill page and bulk print resolve them identically. */
export function challanTermsFor(raw: string[] | undefined, challan: ChallanDto | undefined): string[] {
  if (!raw?.length || !challan) return [];
  return renderDocLines(raw, {
    pay_terms: challan.paymentTerm ?? null,
    party: challan.customerName ?? null,
    doc_no: challan.code ?? null,
    doc_date: formatDate(challan.invDate),
    due_date: challan.dueDate ? formatDate(challan.dueDate) : null,
  });
}

export default ChallanInvoice;
