/**
 * Client-side Rate List exporters for Customers → Rate List.
 *
 * The SR/ITEM/AVAILABLE-PCS/rate-by-pcs pivot is built in
 * {@link ./customer-rate-list-pivot} (shared with the on-screen preview); here we
 * only render those PivotTables into an Excel workbook and a PDF.
 *
 * The PDF is the customer-facing artefact, so it gets the premium treatment:
 * a gradient brand masthead, amber accents, airy zebra tables, the faint KAVISH
 * watermark from the original printed sheet, and special-rate markers.
 */
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import type { CustomerRateList } from '@oms/shared';
import { dateStamp } from '@/lib/utils';
import { preOpenPdfTab, savePdfBlob } from '@/lib/pdf';
import { CALIBRI_FONT, registerCalibriFont } from '@/lib/pdf-fonts';
import kavishLogo from '@/assets/kavish-logo.png';
import { buildSections, type PivotTable } from './customer-rate-list-pivot';

const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_').slice(0, 40);
const stampFull = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ─────────────────────────── palette ───────────────────────────
 * White-paper document in the brand's own three: BLUE (structure + identity),
 * ORANGE and AMBER (accents, special rates). The KAVISH mark is itself blue +
 * orange, so the sheet reads as an extension of the logo. Everything else is a
 * neutral ink/slate for body text and hairlines — no heavy fills, so the page
 * stays white and the very-light logo watermark can breathe through it. */

type RGB = [number, number, number];

const INK: RGB = [15, 23, 42]; // slate-900 — body text
const MUTED: RGB = [100, 116, 139]; // slate-500
const FAINT: RGB = [148, 163, 184]; // slate-400
const HAIRLINE: RGB = [226, 232, 240]; // slate-200 — row rules
const WHITE: RGB = [255, 255, 255];

const BLUE: RGB = [29, 78, 216]; // blue-700 — table headers, primary accent
const BLUE_DEEP: RGB = [30, 58, 138]; // blue-900 — headings / wordmark
const BLUE_ZEBRA: RGB = [243, 247, 255]; // barely-there blue banding for alt rows
const BLUE_SOFT: RGB = [219, 234, 254]; // blue-100 — chip fills / keylines

const ORANGE: RGB = [234, 88, 12]; // orange-600 — gradient start, section accents
const AMBER: RGB = [245, 158, 11]; // amber-500 — gradient end, special-rate marker
const AMBER_SOFT: RGB = [254, 243, 199]; // amber-100 — special-rate row wash

/** Linear blend between two RGBs (used for the orange→amber accent rules). */
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Load the KAVISH logo once as a base64 data URL (+ natural size). Used twice —
 *  as the masthead lockup and as the very-light page watermark. Uses only fetch +
 *  jsPDF itself so it runs in the browser AND in Node (where the design harness
 *  renders the same document). */
let watermarkCache: Promise<{ data: string; w: number; h: number }> | null = null;
function loadWatermark(doc: jsPDF): Promise<{ data: string; w: number; h: number }> {
  watermarkCache ??= (async () => {
    const buf = new Uint8Array(await (await fetch(kavishLogo)).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
    const data = `data:image/png;base64,${btoa(bin)}`;
    const { width, height } = doc.getImageProperties(data);
    return { data, w: width, h: height };
  })();
  return watermarkCache;
}

/* ─────────────────────────── Excel ─────────────────────────── */

export function exportRateListExcel(list: CustomerRateList): void {
  const { products, designs } = buildSections(list);
  const aoa: (string | number)[][] = [
    ['RATE LIST'],
    ['Customer', list.customerName],
    ['Generated', stampFull(list.generatedAt)],
    ['Note', 'Effective rates = base chart rate + this customer’s special-rate adjustments.'],
    [],
  ];
  let maxCols = 4;

  const pushTable = (t: PivotTable) => {
    aoa.push([`${t.title}  (${t.rows.length} item${t.rows.length === 1 ? '' : 's'})`]);
    aoa.push(['SR', 'ITEM', 'AVAILABLE PCS', ...t.columns]);
    maxCols = Math.max(maxCols, 3 + t.columns.length);
    for (const r of t.rows) {
      aoa.push([
        r.sr,
        r.special ? `${r.item} *` : r.item,
        r.available,
        ...r.cells.map((c) => (c && !c.includes('/') ? Number(c) : c)),
      ]);
    }
    aoa.push([]);
  };
  products.forEach(pushTable);
  designs.forEach(pushTable);
  aoa.push(['* item includes your special-rate adjustment']);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 5 }, { wch: 32 }, { wch: 14 }, ...Array.from({ length: maxCols - 3 }, () => ({ wch: 12 }))];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: maxCols - 1 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Rate List');
  XLSX.writeFile(wb, `RateList-${sanitize(list.customerName)}-${dateStamp()}.xlsx`);
}

/* ─────────────────────────── PDF ─────────────────────────── */

/** Build the full A4 rate-list document (design work lives here; `exportRateListPdf`
 *  just saves it). Exported separately so the Node design harness can render the
 *  exact same document to a file for visual review. */
export async function buildRateListPdfDoc(list: CustomerRateList): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 36;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usable = pageW - margin * 2;
  const footerTop = pageH - 34;
  let y = 0;
  let headerH = 0;

  const { products, designs } = buildSections(list);
  const productCount = list.products.length;
  const designCount = list.designs.length;
  const anySpecial = [...products, ...designs].some((t) => t.rows.some((r) => r.special));

  const wm = await loadWatermark(doc).catch(() => null);

  /* ── Items-table typography ─────────────────────────────────────────────
   * The rate grid is set in Calibri (Carlito — see lib/pdf-fonts) at 14pt bold,
   * which is what the printed sheet uses. Calibri runs visually smaller than
   * Helvetica at the same size, but 14pt still needs a taller row than the old
   * 9.5pt text did, so the row grows with it. If the font fails to load we fall
   * back to Helvetica at a size that suits its larger appearance, and keep the
   * compact row — the document degrades rather than breaks. */
  const hasCalibri = await registerCalibriFont(doc);
  const TABLE_FONT = hasCalibri ? CALIBRI_FONT : 'helvetica';
  const DATA_SIZE = hasCalibri ? 14 : 10.5;
  const META_SIZE = hasCalibri ? 11 : 8.5;
  const HEAD_SIZE = hasCalibri ? 10 : 8;
  const rowH = hasCalibri ? 24 : 18;

  /** Draw one line of text shrunk (then ellipsised) to fit `maxW` — rows never wrap. */
  const fitText = (txt: string, x: number, yy: number, maxW: number, size: number, opts?: { align?: 'right'; minSize?: number }) => {
    let s = size;
    doc.setFontSize(s);
    while (doc.getTextWidth(txt) > maxW && s > (opts?.minSize ?? 6.5)) {
      s -= 0.25;
      doc.setFontSize(s);
    }
    let out = txt;
    while (out.length > 2 && doc.getTextWidth(out) > maxW) out = `${out.slice(0, -2).trimEnd()}…`;
    doc.text(out, x, yy, opts?.align ? { align: opts.align } : undefined);
    doc.setFontSize(size);
  };

  /** The brand mark, ghosted into the middle of the page. Deliberately faint
   *  (4%) — it should read as watermarked stationery, never compete with rates. */
  const drawWatermark = () => {
    if (!wm) return;
    const wmW = usable * 0.62;
    const wmH = (wmW * wm.h) / wm.w;
    const x = margin + (usable - wmW) / 2;
    const yy = headerH + (footerTop - headerH - wmH) / 2;
    doc.saveGraphicsState();
    // @ts-expect-error jsPDF GState typing isn't exported on the instance
    doc.setGState(new doc.GState({ opacity: 0.04 }));
    doc.addImage(wm.data, 'PNG', x, yy, wmW, wmH, 'kavish-mark', 'FAST');
    doc.restoreGraphicsState();
  };

  /** Measure-only sibling of {@link fitText}: ellipsise `txt` until it fits
   *  `maxW` at the CURRENT font settings, and return the string. */
  const truncate = (txt: string, maxW: number): string => {
    let out = txt;
    while (out.length > 2 && doc.getTextWidth(out) > maxW) out = `${out.slice(0, -2).trimEnd()}…`;
    return out;
  };

  /** Right-align text that uses letter-spacing. jsPDF's `align: 'right'` measures
   *  the string WITHOUT charSpace, so a tracked-out title silently overhangs the
   *  right margin — we compute the true width and draw it left-aligned instead. */
  const rightTracked = (txt: string, xRight: number, yy: number, charSpace: number) => {
    const w = doc.getTextWidth(txt) + charSpace * Math.max(0, txt.length - 1);
    doc.text(txt, xRight - w, yy, { charSpace });
  };

  /** Horizontal orange→amber gradient rule — the sheet's one signature flourish. */
  const accentRule = (x: number, yy: number, w: number, h: number) => {
    const steps = 72;
    const seg = w / steps;
    for (let i = 0; i < steps; i++) {
      doc.setFillColor(...mix(ORANGE, AMBER, i / (steps - 1)));
      doc.rect(x + seg * i, yy, seg + 0.7, h, 'F');
    }
  };

  /** A small stat pill: coloured dot + label + value, on a soft tinted card. */
  const statPill = (x: number, yy: number, label: string, value: string, dot: RGB, fill: RGB): number => {
    doc.setFont('helvetica', 'bold').setFontSize(9);
    const valW = doc.getTextWidth(value);
    doc.setFont('helvetica', 'normal').setFontSize(7.5);
    const labW = doc.getTextWidth(label.toUpperCase());
    const w = Math.max(valW, labW) + 26;
    doc.setFillColor(...fill);
    doc.roundedRect(x, yy, w, 26, 3, 3, 'F');
    doc.setFillColor(...dot);
    doc.circle(x + 9, yy + 9.5, 2.4, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...BLUE_DEEP);
    doc.text(value, x + 15, yy + 12);
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x + 15, yy + 21, { charSpace: 0.6 });
    return w;
  };

  /** Page-1 masthead — white stationery: logo lockup, blue wordmark, the
   *  orange→amber rule, then the "prepared for" block and summary pills. */
  const heroHeader = () => {
    if (wm) {
      const logoH = 42;
      const logoW = (logoH * wm.w) / wm.h;
      doc.addImage(wm.data, 'PNG', margin, 34, logoW, logoH, 'kavish-mark', 'FAST');
    } else {
      doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...BLUE_DEEP);
      doc.text('KAVISH', margin, 62);
    }

    doc.setFont('helvetica', 'bold').setFontSize(25).setTextColor(...BLUE_DEEP);
    rightTracked('RATE LIST', pageW - margin, 62, 2.5);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
    doc.text(stampFull(list.generatedAt), pageW - margin, 78, { align: 'right' });

    accentRule(margin, 92, usable, 3);

    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...ORANGE);
    doc.text('PREPARED FOR', margin, 116, { charSpace: 1.8 });
    doc.setFontSize(15).setTextColor(...BLUE_DEEP);
    fitText(list.customerName, margin, 135, usable, 15, { minSize: 10 });
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED);
    doc.text('Effective rates  ·  base chart rate + your special adjustments  ·  all amounts in INR', margin, 150);

    let px = margin;
    px += statPill(px, 162, 'Products', String(productCount), BLUE, BLUE_ZEBRA) + 8;
    px += statPill(px, 162, 'Designs', String(designCount), BLUE, BLUE_ZEBRA) + 8;
    statPill(px, 162, 'Categories', String(products.length + designs.length), ORANGE, BLUE_ZEBRA);

    // The special-rate legend is stated once, here — not repeated under each table.
    if (anySpecial) {
      doc.setFillColor(...AMBER);
      doc.rect(pageW - margin - 152, 172, 2.5, 8, 'F');
      doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED);
      doc.text('Amber rows carry your special rate', pageW - margin, 179, { align: 'right' });
    }

    headerH = 196;
    y = headerH + 20;
    drawWatermark();
  };

  /** Slim masthead for continuation pages — same stationery, less of it. */
  const contHeader = () => {
    if (wm) {
      const logoH = 22;
      const logoW = (logoH * wm.w) / wm.h;
      doc.addImage(wm.data, 'PNG', margin, 26, logoW, logoH, 'kavish-mark', 'FAST');
    }
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...BLUE_DEEP);
    rightTracked('RATE LIST', pageW - margin, 38, 1.5);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED);
    doc.text(list.customerName, pageW - margin, 50, { align: 'right' });
    accentRule(margin, 58, usable, 2);
    headerH = 60;
    y = headerH + 24;
    drawWatermark();
  };

  const breakPage = () => {
    doc.addPage();
    contHeader();
  };
  const ensure = (need: number) => {
    if (y + need > footerTop - 6) breakPage();
  };

  // Draws page 1's masthead. Must run after `fitText` above is initialised —
  // the "prepared for" name is shrink-to-fit.
  heroHeader();

  const drawPivot = (t: PivotTable) => {
    const n = Math.max(1, t.columns.length);
    // Some sections (e.g. per-kg designs) have no pcs info at all — drop the
    // AVAILABLE PCS column entirely and give the room to ITEM.
    const showAvail = t.rows.some((r) => r.available !== '');
    const availW = showAvail ? 78 : 0;
    // Column plan: ITEM gets priority (≥120), rate columns share the rest (44–110).
    let itemW = 190;
    let rateW = (usable - 26 - availW - itemW) / n;
    if (rateW < 44) {
      itemW = Math.max(120, usable - 26 - availW - 44 * n);
      rateW = (usable - 26 - availW - itemW) / n;
    } else if (rateW > 110) {
      rateW = 110;
      itemW = usable - 26 - availW - rateW * n;
    }
    const widths = [26, itemW, ...(showAvail ? [availW] : []), ...t.columns.map(() => rateW)];
    const headers = ['SR', 'ITEM', ...(showAvail ? ['AVAILABLE PCS'] : []), ...t.columns.map((c) => c.toUpperCase())];
    const firstRateCol = showAvail ? 3 : 2;

    ensure(rowH * 4 + 40);

    // Section heading: orange→amber accent bar + blue title, count on the right.
    // The pivot's title carries a "— RATE LIST" suffix for the Excel/on-screen
    // views; under a sheet already titled RATE LIST it's just noise, so the PDF
    // drops it (display only — the shared title itself is untouched).
    accentRule(margin, y - 10.5, 3.5, 14);
    doc.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(...BLUE_DEEP);
    doc.text(t.title.replace(/\s*—\s*RATE LIST\s*$/i, ''), margin + 11, y);
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...FAINT);
    doc.text(`${t.rows.length} item${t.rows.length === 1 ? '' : 's'}`, margin + usable, y, { align: 'right' });
    y += 11;

    // Header row: one solid blue bar across the full table, white caps. Keeping
    // it a single block (rather than the old two-tone navy/peach split) is what
    // lets the white paper and the watermark carry the page.
    const identityW = widths[0] + widths[1] + (showAvail ? widths[2] : 0);
    const headerRow = () => {
      doc.setFillColor(...BLUE);
      doc.roundedRect(margin, y, usable, rowH + 2, 2.5, 2.5, 'F');
      doc.setFont(TABLE_FONT, 'bold');
      let x = margin;
      headers.forEach((h, i) => {
        const right = i >= firstRateCol;
        doc.setTextColor(...WHITE);
        fitText(h, right ? x + widths[i] - 6 : x + 7, y + rowH / 2 + 4, widths[i] - 12, HEAD_SIZE, right ? { align: 'right' } : undefined);
        x += widths[i];
      });
      y += rowH + 5;
    };
    headerRow();

    t.rows.forEach((r, idx) => {
      if (y + rowH > footerTop - 4) {
        breakPage();
        headerRow();
      }
      // Zebra: a whisper of blue on alternate rows; special-rate rows get an
      // amber wash + amber left tab so they're findable at a glance.
      if (r.special) {
        doc.setFillColor(...AMBER_SOFT);
        doc.rect(margin, y - 2, usable, rowH, 'F');
        doc.setFillColor(...AMBER);
        doc.rect(margin, y - 2, 2.5, rowH, 'F');
      } else if (idx % 2 === 1) {
        doc.setFillColor(...BLUE_ZEBRA);
        doc.rect(margin, y - 2, usable, rowH, 'F');
      }
      // Baseline that centres the text in the (now taller) row.
      const ty = y + rowH / 2 + DATA_SIZE * 0.34;
      let x = margin;
      // SR
      doc.setFont(TABLE_FONT, 'normal').setFontSize(META_SIZE).setTextColor(...FAINT);
      doc.text(String(r.sr), x + 7, ty);
      x += widths[0];
      // ITEM — special-rate items read in blue so the eye pairs them with the tab.
      doc.setFont(TABLE_FONT, 'bold').setTextColor(...(r.special ? BLUE_DEEP : INK));
      fitText(r.item, x + 6, ty, widths[1] - 10, DATA_SIZE, { minSize: 8 });
      x += widths[1];
      // AVAILABLE PCS
      if (showAvail) {
        doc.setFont(TABLE_FONT, 'normal').setFontSize(META_SIZE).setTextColor(...MUTED);
        doc.text(r.available, x + 6, ty);
        x += widths[2];
      }
      // Hairline separating identity columns from the rate block — guides the
      // eye across on wide tables without drawing a full grid.
      doc.setDrawColor(...HAIRLINE);
      doc.setLineWidth(0.5);
      doc.line(margin + identityW, y - 2, margin + identityW, y + rowH - 2);
      // rate cells
      r.cells.forEach((cell, i) => {
        const w = widths[firstRateCol + i];
        if (cell) {
          doc.setFont(TABLE_FONT, 'bold').setTextColor(...INK);
          fitText(cell, x + w - 6, ty, w - 12, DATA_SIZE, { align: 'right', minSize: 7.5 });
        } else {
          doc.setFont(TABLE_FONT, 'normal').setFontSize(META_SIZE).setTextColor(...FAINT);
          doc.text('–', x + w - 6, ty, { align: 'right' });
        }
        x += w;
      });
      doc.setDrawColor(...HAIRLINE);
      doc.setLineWidth(0.4);
      doc.line(margin, y + rowH - 2, margin + usable, y + rowH - 2);
      y += rowH;
    });

    // Close the section with a soft blue keyline, then breathe. (The special-rate
    // legend is stated once in the masthead, not repeated under every table.)
    doc.setDrawColor(...BLUE_SOFT);
    doc.setLineWidth(1);
    doc.line(margin, y - 1.5, margin + usable, y - 1.5);
    y += 28;
  };

  products.forEach(drawPivot);
  designs.forEach(drawPivot);

  // Footer on every page: orange→amber hairline, brand, customer, page number.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    accentRule(margin, footerTop + 6, usable, 1.2);

    const brand = 'KAVISH · THE UNIQUE';
    const pageLabel = `Page ${i} of ${pages}`;
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...BLUE_DEEP);
    const brandW = doc.getTextWidth(brand) + 1 * (brand.length - 1); // + charSpace
    doc.text(brand, margin, footerTop + 19, { charSpace: 1 });

    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED);
    const pageW_ = doc.getTextWidth(pageLabel);
    doc.text(pageLabel, pageW - margin, footerTop + 19, { align: 'right' });

    // Centre the customer/date strip in the gap BETWEEN the brand and the page
    // number, ellipsised to fit — a long party name would otherwise run straight
    // through both of them.
    const gapL = margin + brandW + 14;
    const gapR = pageW - margin - pageW_ - 14;
    doc.setTextColor(...FAINT);
    doc.text(truncate(`${list.customerName}  ·  ${stampFull(list.generatedAt)}`, gapR - gapL), (gapL + gapR) / 2, footerTop + 19, {
      align: 'center',
    });
  }

  return doc;
}

export async function exportRateListPdf(list: CustomerRateList): Promise<void> {
  // Reserve a tab now (in the tap gesture) so iOS Safari doesn't block the save
  // that fires after the async doc build. No-op off iOS.
  const iosTab = preOpenPdfTab();
  try {
    const doc = await buildRateListPdfDoc(list);
    void savePdfBlob(doc.output('blob'), `RateList-${sanitize(list.customerName)}-${dateStamp()}.pdf`, iosTab);
  } catch (e) {
    iosTab?.close();
    throw e;
  }
}
