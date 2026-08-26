/**
 * Agent Rate List exporters — PDF and Excel.
 *
 * A flat table, deliberately, where the customer rate list is pivoted: that
 * sheet's columns are pack sizes, while this one's are money of three different
 * kinds (price, base commission, special commission). Pivoting money across pack
 * columns would put figures that mean different things under one heading.
 *
 * The one thing this sheet must never do is imply that base + special add up.
 * A special commission REPLACES the base, so the two are shown side by side with
 * a third "Earns" column that is one or the other, and the footnote says so.
 */
import { jsPDF } from 'jspdf';
import type { AgentRateList, AgentRateListRow } from '@oms/shared';
import { dateStamp } from '@/lib/utils';
import { savePdfBlob, preOpenPdfTab } from '@/lib/pdf';
import { CALIBRI_FONT, registerCalibriFont } from '@/lib/pdf-fonts';
import {
  AMBER,
  BLUE,
  BLUE_DEEP,
  BLUE_SOFT,
  BLUE_ZEBRA,
  FAINT,
  HAIRLINE,
  INK,
  MUTED,
  ORANGE,
  WHITE,
  XL,
  sanitize,
  stampFull,
  type RGB,
} from './customer-rate-list-export';

/** A row carrying a special is tinted, so the exceptions are findable by eye on
 *  a sheet of two hundred lines rather than by reading every Source cell. */
const SPECIAL_TINT: RGB = [255, 247, 237];
/** No commission at all — greyed, matching the rate list's "not sold here". */
const NONE_TINT: RGB = [244, 246, 249];

/*
 * No rupee sign on the PDF, deliberately.
 *
 * The embedded Carlito subset has NO glyph for U+20B9 — it maps to .notdef,
 * which draws nothing but still advances, so "₹1,250" printed as a gap
 * followed by the number. The unit is stated once in the footnote instead, and
 * the Excel sheet (which uses the reader's real Calibri) keeps real numbers with
 * a number format, so it stays sortable either way.
 */
const inr = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-IN'));
const unit = (r: AgentRateListRow) => (r.basis === 'PCS' ? '/pc' : '/kg');

const FOOTNOTE =
  'All figures are rupees; commission figures are per kg or per piece as marked. ' +
  'A special commission REPLACES the base rate — the two are never added. "Earns" is the one that applies. ' +
  'A rate only applies where the category is charged in the same unit, so a per-kg rule never prices a per-piece category.';

const partyNote = (list: AgentRateList) =>
  list.partyScoped
    ? `Party-specific commission rules for ${list.customerName} ARE included, and the price column is this party's own rate.`
    : 'No party selected, so party-specific commission rules are NOT included — download a specific party to see those.';

const fileBase = (list: AgentRateList) =>
  `AgentRates-${sanitize(list.agentName)}${list.customerName ? `-${sanitize(list.customerName)}` : ''}-${dateStamp()}`;

/* ─────────────────────────── PDF ─────────────────────────── */

export async function buildAgentRateListPdfDoc(list: AgentRateList): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const hasCalibri = await registerCalibriFont(doc);
  const FONT = hasCalibri ? CALIBRI_FONT : 'helvetica';

  const margin = 14;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usable = pageW - margin * 2;
  const footerTop = pageH - 28;
  const rowH = 16;

  // SR | ITEM | CATEGORY | PRICE | BASE | SPECIAL | EARNS | SOURCE
  // Measured, not guessed: the money columns are sized to their widest realistic
  // value (₹1,24,500 is 33pt at 8.2pt) plus padding, and every point saved goes
  // to ITEM — the one column whose truncation actually loses information.
  const widths = [26, usable - 26 - 70 - 38 - 32 - 40 - 42 - 92, 70, 38, 32, 40, 42, 92];
  const HEAD = ['SR', 'ITEM', 'CATEGORY', 'PRICE', 'BASE', 'SPECIAL', 'EARNS', 'FROM'];

  let y = 0;
  const fit = (txt: string, x: number, yy: number, maxW: number, size: number, right = false) => {
    let s = size;
    doc.setFontSize(s);
    while (doc.getTextWidth(txt) > maxW && s > 6) doc.setFontSize((s -= 0.5));
    let t = txt;
    while (doc.getTextWidth(t) > maxW && t.length > 1) t = t.slice(0, -1);
    doc.text(t, right ? x + maxW : x, yy, right ? { align: 'right' } : undefined);
    doc.setFontSize(size);
  };

  const masthead = () => {
    doc.setFillColor(...BLUE_DEEP);
    doc.rect(0, 0, pageW, 34, 'F');
    doc.setFont(FONT, 'bold').setFontSize(15).setTextColor(...WHITE);
    doc.text('AGENT RATE LIST', margin, 22);
    doc.setFont(FONT, 'bold').setFontSize(10);
    doc.text(list.agentName.toUpperCase(), pageW - margin, 22, { align: 'right' });

    // The orange keyline the customer sheet uses, so the two are one family.
    doc.setFillColor(...ORANGE);
    doc.rect(0, 34, pageW, 2, 'F');

    doc.setFont(FONT, 'normal').setFontSize(8.5).setTextColor(...MUTED);
    doc.text(
      `${list.customerName ? `Party: ${list.customerName}` : 'All parties'}   ·   ${stampFull(list.generatedAt)}`,
      margin,
      48,
    );
    y = 58;

    // The party caveat is a box, not a footnote: it changes what the numbers
    // mean, and a reader who misses it misreads the whole sheet.
    // Amber when party rules are EXCLUDED — the case a reader must not miss.
    const noteFill: RGB = list.partyScoped ? BLUE_SOFT : [255, 244, 214];
    doc.setFillColor(...noteFill);
    doc.rect(margin, y, usable, 16, 'F');
    doc.setFont(FONT, 'bold').setFontSize(7.8).setTextColor(...INK);
    fit(partyNote(list), margin + 5, y + 11, usable - 10, 7.8);
    y += 24;
  };

  const headerRow = () => {
    doc.setFillColor(...BLUE);
    doc.rect(margin, y, usable, rowH, 'F');
    doc.setFont(FONT, 'bold').setFontSize(7.6).setTextColor(...WHITE);
    let x = margin;
    HEAD.forEach((h, i) => {
      const right = i >= 3 && i <= 6;
      fit(h, x + (right ? 0 : 4), y + 11, widths[i] - 8, 7.6, right);
      x += widths[i];
    });
    y += rowH + 2;
  };

  masthead();
  headerRow();

  list.rows.forEach((r, i) => {
    if (y + rowH > footerTop - 4) {
      doc.addPage();
      y = 12;
      headerRow();
    }
    const tint: RGB | null = r.source === 'SPECIAL' ? SPECIAL_TINT : r.source === 'NONE' ? NONE_TINT : i % 2 ? BLUE_ZEBRA : null;
    if (tint) {
      doc.setFillColor(...tint);
      doc.rect(margin, y - 1, usable, rowH, 'F');
    }

    const ty = y + rowH / 2 + 2.4;
    let x = margin;
    const cell = (txt: string, w: number, opts?: { right?: boolean; bold?: boolean; colour?: RGB; size?: number }) => {
      doc.setFont(FONT, opts?.bold ? 'bold' : 'normal').setTextColor(...(opts?.colour ?? INK));
      fit(txt, x + (opts?.right ? 0 : 4), ty, w - 8, opts?.size ?? 8.2, opts?.right);
      x += w;
    };

    cell(String(i + 1), widths[0], { colour: FAINT, size: 7.6 });
    cell(`${r.product}${r.size != null ? ` · ${r.size}` : ''}`, widths[1], { bold: true });
    cell(r.category, widths[2], { colour: MUTED, size: 7.8 });
    cell(inr(r.productRate), widths[3], { right: true, bold: true });
    cell(r.baseCommission == null ? '—' : `${inr(r.baseCommission)}`, widths[4], { right: true, colour: MUTED });
    cell(r.specialCommission == null ? '—' : `${inr(r.specialCommission)}`, widths[5], {
      right: true,
      bold: r.specialCommission != null,
      colour: r.specialCommission != null ? ORANGE : MUTED,
    });
    cell(
      r.effectiveCommission == null ? '—' : `${inr(r.effectiveCommission)}${unit(r)}`,
      widths[6],
      { right: true, bold: true, colour: r.source === 'SPECIAL' ? ORANGE : r.source === 'NONE' ? FAINT : INK },
    );
    cell(r.source === 'SPECIAL' ? (r.specialLabel ?? 'Special') : r.source === 'BASE' ? 'Base' : 'No rate', widths[7], {
      size: 7.4,
      colour: r.source === 'SPECIAL' ? ORANGE : MUTED,
    });

    doc.setDrawColor(...HAIRLINE);
    doc.setLineWidth(0.4);
    doc.line(margin, y + rowH - 1, margin + usable, y + rowH - 1);
    y += rowH;
  });

  // Totals band — counts, not sums: commission per unit cannot be added down a
  // column (each line's money depends on its own quantity), and a total there
  // would be a number nobody could reconcile.
  y += 6;
  // The band and the footnote need room, and the table above stops only when a
  // ROW no longer fits — which can leave 20pt, enough for neither. Without this
  // the summary printed over the footer rule and the page number, which is how a
  // sheet ends up with its own headline unreadable.
  const TAIL_H = 16 + 24 + 20;
  if (y + TAIL_H > footerTop) {
    doc.addPage();
    y = 12;
  }
  doc.setFillColor(...BLUE_SOFT);
  doc.rect(margin, y, usable, 16, 'F');
  doc.setFont(FONT, 'bold').setFontSize(8).setTextColor(...BLUE_DEEP);
  doc.text(
    `${list.rows.length} items   ·   ${list.specialCount} on a special rate   ·   ${list.noCommissionCount} with no commission`,
    margin + 5,
    y + 11,
  );
  y += 24;

  doc.setFont(FONT, 'normal').setFontSize(7.4).setTextColor(...MUTED);
  const lines = doc.splitTextToSize(FOOTNOTE, usable) as string[];
  lines.forEach((ln, i) => doc.text(ln, margin, y + i * 9));

  // Page numbers, added once every page exists.
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p += 1) {
    doc.setPage(p);
    doc.setFont(FONT, 'normal').setFontSize(7.4).setTextColor(...FAINT);
    doc.text(`Page ${p} of ${total}`, pageW - margin, footerTop + 14, { align: 'right' });
    doc.setFillColor(...AMBER);
    doc.rect(margin, footerTop + 4, usable, 1, 'F');
  }
  return doc;
}

/** The PDF as a blob, for the in-app preview — same builder as the download. */
export async function buildAgentRateListPdfBlob(list: AgentRateList): Promise<{ blob: Blob; filename: string }> {
  const doc = await buildAgentRateListPdfDoc(list);
  return { blob: doc.output('blob'), filename: `${fileBase(list)}.pdf` };
}

export async function exportAgentRateListPdf(list: AgentRateList): Promise<void> {
  const iosTab = preOpenPdfTab();
  try {
    const doc = await buildAgentRateListPdfDoc(list);
    void savePdfBlob(doc.output('blob'), `${fileBase(list)}.pdf`, iosTab);
  } catch (e) {
    iosTab?.close();
    throw e;
  }
}

/* ─────────────────────────── Excel ─────────────────────────── */

export async function exportAgentRateListExcel(list: AgentRateList): Promise<void> {
  const mod = await import('exceljs');
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'OMS';
  wb.created = new Date(list.generatedAt);

  const thin = { style: 'thin' as const, color: { argb: XL.hairline } };
  const boxed = { top: thin, left: thin, bottom: thin, right: thin };
  const ws = wb.addWorksheet('Agent rates', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 6 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:6' },
  });
  ws.columns = [
    { width: 5.5 },
    { width: 38 },
    { width: 14 },
    { width: 12 },
    { width: 11 },
    { width: 12 },
    { width: 13 },
    { width: 30 },
  ];

  const band = (row: number, text: string, fill: string, size: number, colour: string, bold = true) => {
    ws.mergeCells(row, 1, row, 8);
    const c = ws.getRow(row).getCell(1);
    c.value = text;
    c.font = { name: 'Calibri', size, bold, color: { argb: colour } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  };

  band(1, 'AGENT RATE LIST', XL.blueDeep, 16, XL.white);
  ws.getRow(1).height = 28;
  band(2, `${list.agentName}${list.customerName ? `   ·   ${list.customerName}` : '   ·   All parties'}`, XL.blue, 11, XL.white);
  ws.getRow(2).height = 19;
  band(3, stampFull(list.generatedAt), 'FFFFFFFF', 9, XL.muted, false);
  // Amber when party rules are EXCLUDED — the case a reader must not miss.
  band(4, partyNote(list), list.partyScoped ? XL.blueSoft : 'FFFFF4D6', 9, XL.ink, false);
  ws.getRow(4).height = 17;
  band(5, FOOTNOTE, 'FFFFFFFF', 8.5, XL.muted, false);
  ws.getRow(5).height = 22;
  ws.getCell(5, 1).alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };

  const head = ws.getRow(6);
  ['SR', 'ITEM', 'CATEGORY', 'PRICE', 'BASE COMM', 'SPECIAL COMM', 'EARNS', 'FROM'].forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: XL.white } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.blue } };
    c.alignment = { vertical: 'middle', horizontal: i >= 3 && i <= 6 ? 'right' : 'left', indent: 1, wrapText: true };
    c.border = boxed;
  });
  head.height = 24;

  list.rows.forEach((r, i) => {
    const row = ws.getRow(7 + i);
    const tint = r.source === 'SPECIAL' ? 'FFFFF7ED' : r.source === 'NONE' ? XL.unavailable : i % 2 ? XL.blueZebra : null;
    const vals: (string | number | null)[] = [
      i + 1,
      `${r.product}${r.size != null ? ` · ${r.size}` : ''}`,
      r.category,
      r.productRate,
      r.baseCommission,
      r.specialCommission,
      r.effectiveCommission,
      r.source === 'SPECIAL' ? (r.specialLabel ?? 'Special') : r.source === 'BASE' ? 'Base rate' : 'No commission',
    ];
    vals.forEach((v, ci) => {
      const c = row.getCell(ci + 1);
      c.value = v === null ? null : v;
      const money = ci >= 3 && ci <= 6;
      if (money && typeof v === 'number') c.numFmt = r.basis === 'PCS' ? '#,##0.##" /pc"' : '#,##0.##" /kg"';
      // The PRICE column is money per unit sold, not per commission unit — no
      // suffix, or it would read as a commission.
      if (ci === 3 && typeof v === 'number') c.numFmt = '#,##0.##';
      c.alignment = { vertical: 'middle', horizontal: money ? 'right' : 'left', indent: 1 };
      c.font = {
        name: 'Calibri',
        size: ci === 0 ? 9 : 10,
        bold: ci === 1 || ci === 6,
        color: {
          argb: ci === 5 && r.specialCommission != null ? XL.orange : ci === 0 ? XL.muted : ci === 6 && r.source === 'SPECIAL' ? XL.orange : XL.ink,
        },
      };
      c.border = boxed;
      if (tint) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint } };
    });
    row.height = 17;
  });

  if (list.rows.length) {
    ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + list.rows.length, column: 8 } };
  }

  const totalRow = 8 + list.rows.length;
  band(
    totalRow,
    `${list.rows.length} items   ·   ${list.specialCount} on a special rate   ·   ${list.noCommissionCount} with no commission`,
    XL.blueSoft,
    10,
    XL.blueDeep,
  );

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileBase(list)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
