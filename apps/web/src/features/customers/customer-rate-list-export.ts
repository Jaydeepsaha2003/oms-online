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
import kavishLogo from '@/assets/kavish-logo.png';
import { buildSections, type PivotTable } from './customer-rate-list-pivot';

const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_').slice(0, 40);
const stampFull = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ─────────────────────────── palette ───────────────────────────
 * Brand three: navy #305496, peach #F4B084, white — everything else here is
 * a tint/shade of those two (plus neutral ink for body text/hairlines). */

const INK: [number, number, number] = [15, 23, 42]; // slate-900 — body text
const MUTED: [number, number, number] = [100, 116, 139]; // slate-500
const FAINT: [number, number, number] = [148, 163, 184]; // slate-400
const HAIRLINE: [number, number, number] = [232, 224, 216]; // warm-neutral divider (peach-tinted)
const WHITE: [number, number, number] = [255, 255, 255];
const NAVY: [number, number, number] = [48, 84, 150]; // #305496
const NAVY_DARK: [number, number, number] = [24, 42, 82]; // gradient top / deepest shade
const PEACH: [number, number, number] = [244, 176, 132]; // #F4B084
const PEACH_TINT: [number, number, number] = [251, 227, 212]; // pale peach column banding
const NAVY_TEXT_ON_DARK: [number, number, number] = [253, 239, 230]; // warm off-white for secondary text on navy

/** Load the KAVISH logo once as a base64 data URL (+ natural size) for the PDF
 *  watermark. Uses only fetch + jsPDF itself so it runs in the browser AND in
 *  Node (where the design harness renders the same document). */
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
  const rowH = 18;
  const footerTop = pageH - 34;
  let y = 0;
  let headerH = 0;

  const { products, designs } = buildSections(list);
  const productCount = list.products.length;
  const designCount = list.designs.length;
  const anySpecial = [...products, ...designs].some((t) => t.rows.some((r) => r.special));

  const wm = await loadWatermark(doc).catch(() => null);
  const drawWatermark = () => {
    if (!wm) return;
    const wmW = usable * 0.66;
    const wmH = (wmW * wm.h) / wm.w;
    const x = margin + (usable - wmW) / 2;
    const yy = headerH + (footerTop - headerH - wmH) / 2;
    doc.saveGraphicsState();
    // @ts-expect-error jsPDF GState typing isn't exported on the instance
    doc.setGState(new doc.GState({ opacity: 0.06 }));
    doc.addImage(wm.data, 'PNG', x, yy, wmW, wmH, 'kavish-wm', 'FAST');
    doc.restoreGraphicsState();
  };

  /** Page-1 masthead: navy gradient band + peach keyline. */
  const heroHeader = () => {
    const heroH = 108;
    const steps = 36;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      doc.setFillColor(
        Math.round(NAVY_DARK[0] + (NAVY[0] - NAVY_DARK[0]) * t),
        Math.round(NAVY_DARK[1] + (NAVY[1] - NAVY_DARK[1]) * t),
        Math.round(NAVY_DARK[2] + (NAVY[2] - NAVY_DARK[2]) * t),
      );
      doc.rect(0, (heroH / steps) * i, pageW, heroH / steps + 1, 'F');
    }
    doc.setFillColor(...PEACH);
    doc.rect(0, heroH, pageW, 2.5, 'F');

    doc.setTextColor(...PEACH).setFont('helvetica', 'bold').setFontSize(8);
    doc.text('KAVISH  ·  THE UNIQUE', margin, 28, { charSpace: 2 });
    doc.setTextColor(...WHITE).setFontSize(27);
    doc.text('RATE LIST', margin, 60, { charSpace: 4 });
    doc.setFontSize(12.5);
    doc.text(list.customerName, margin, 82);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...NAVY_TEXT_ON_DARK);
    doc.text('Effective rates for this customer  ·  base chart + special adjustments  ·  amounts in INR', margin, 96);

    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...PEACH);
    doc.text('GENERATED', pageW - margin, 30, { align: 'right', charSpace: 1.5 });
    doc.setFontSize(10).setTextColor(...WHITE);
    doc.text(stampFull(list.generatedAt), pageW - margin, 44, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...NAVY_TEXT_ON_DARK);
    doc.text(`${productCount} products  ·  ${designCount} designs`, pageW - margin, 58, { align: 'right' });

    headerH = heroH + 2.5;
    y = headerH + 26;
    drawWatermark();
  };

  /** Slim masthead for continuation pages. */
  const contHeader = () => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageW, 40, 'F');
    doc.setFillColor(...PEACH);
    doc.rect(0, 40, pageW, 2, 'F');
    doc.setTextColor(...WHITE).setFont('helvetica', 'bold').setFontSize(9.5);
    doc.text(`RATE LIST  ·  ${list.customerName}`, margin, 25, { charSpace: 1 });
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...NAVY_TEXT_ON_DARK);
    doc.text(stampFull(list.generatedAt), pageW - margin, 25, { align: 'right' });
    headerH = 42;
    y = headerH + 22;
    drawWatermark();
  };

  const breakPage = () => {
    doc.addPage();
    contHeader();
  };
  const ensure = (need: number) => {
    if (y + need > footerTop - 6) breakPage();
  };

  heroHeader();

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
    const hasSpecial = t.rows.some((r) => r.special);

    ensure(rowH * 4 + 34);

    // Section heading: peach accent bar + title, item count on the right.
    doc.setFillColor(...PEACH);
    doc.rect(margin, y - 10, 3.5, 13, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(...INK);
    doc.text(t.title, margin + 10, y);
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...FAINT);
    doc.text(`${t.rows.length} item${t.rows.length === 1 ? '' : 's'}${hasSpecial ? '   ·   • your special rate' : ''}`, margin + usable, y, {
      align: 'right',
    });
    y += 10;

    // Header row: navy block over SR+ITEM, peach block over AVAILABLE PCS, plain
    // white over the rate columns — mirrors the printed sheet's column banding.
    const identityW = widths[0] + widths[1] + (showAvail ? widths[2] : 0);
    const headerRow = () => {
      doc.setFillColor(...NAVY);
      doc.rect(margin, y, widths[0] + widths[1], rowH + 1, 'F');
      if (showAvail) {
        doc.setFillColor(...PEACH);
        doc.rect(margin + widths[0] + widths[1], y, widths[2], rowH + 1, 'F');
      }
      doc.setDrawColor(...NAVY);
      doc.setLineWidth(1);
      doc.line(margin, y + rowH + 1, margin + usable, y + rowH + 1);

      doc.setFont('helvetica', 'bold');
      let x = margin;
      headers.forEach((h, i) => {
        const right = i >= firstRateCol;
        doc.setTextColor(...(i < 2 ? WHITE : i === 2 && showAvail ? INK : NAVY));
        fitText(h, right ? x + widths[i] - 5 : x + 6, y + 12.5, widths[i] - 10, 8, right ? { align: 'right' } : undefined);
        x += widths[i];
      });
      y += rowH + 3;
    };
    headerRow();

    t.rows.forEach((r, idx) => {
      if (y + rowH > footerTop - 4) {
        breakPage();
        headerRow();
      }
      // Pale peach band behind the identity columns on every row (the rate
      // columns stay plain white) — reproduces the printed sheet's look.
      doc.setFillColor(...PEACH_TINT);
      doc.rect(margin, y - 2, identityW, rowH, 'F');
      let x = margin;
      // SR
      doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED);
      doc.text(String(r.sr), x + 6, y + 10);
      x += widths[0];
      // ITEM (+ peach dot for special-rate items); single line, shrink-to-fit.
      let itemX = x + 6;
      if (r.special) {
        doc.setFillColor(...NAVY);
        doc.circle(x + 8.5, y + 7.5, 2, 'F');
        itemX = x + 15;
      }
      doc.setFont('helvetica', 'bold').setTextColor(...INK);
      fitText(r.item, itemX, y + 10, widths[1] - (itemX - x) - 4, 9.5, { minSize: 7.5 });
      x += widths[1];
      // AVAILABLE PCS
      if (showAvail) {
        doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED);
        doc.text(r.available, x + 6, y + 10);
        x += widths[2];
      }
      // rate cells
      r.cells.forEach((cell, i) => {
        const w = widths[firstRateCol + i];
        if (cell) {
          doc.setFont('helvetica', 'bold').setTextColor(...INK);
          fitText(cell, x + w - 5, y + 10, w - 10, 9.5, { align: 'right', minSize: 7 });
        } else {
          doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...HAIRLINE);
          doc.text('—', x + w - 5, y + 10, { align: 'right' });
        }
        x += w;
      });
      doc.setDrawColor(...HAIRLINE);
      doc.setLineWidth(0.5);
      doc.line(margin, y + rowH - 2, margin + usable, y + rowH - 2);
      y += rowH;
    });
    y += 26;
  };

  products.forEach(drawPivot);
  designs.forEach(drawPivot);

  // Footer on every page: keyline, brand, customer, page number.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...HAIRLINE);
    doc.setLineWidth(0.75);
    doc.line(margin, footerTop + 6, pageW - margin, footerTop + 6);
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...NAVY);
    doc.text('KAVISH · THE UNIQUE', margin, footerTop + 18, { charSpace: 1 });
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...FAINT);
    doc.text(`${list.customerName}  ·  ${stampFull(list.generatedAt)}${anySpecial ? '  ·  • special rate applied' : ''}`, pageW / 2, footerTop + 18, {
      align: 'center',
    });
    doc.text(`Page ${i} of ${pages}`, pageW - margin, footerTop + 18, { align: 'right' });
  }

  return doc;
}

export async function exportRateListPdf(list: CustomerRateList): Promise<void> {
  const doc = await buildRateListPdfDoc(list);
  doc.save(`RateList-${sanitize(list.customerName)}-${dateStamp()}.pdf`);
}
