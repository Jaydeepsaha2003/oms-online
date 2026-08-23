/**
 * Client-side Rate List exporters for Customers → Rate List.
 *
 * The SR/ITEM/AVAILABLE-PCS/rate-by-pcs pivot is built in
 * {@link ./customer-rate-list-pivot} (shared with the on-screen preview); here we
 * only render those PivotTables into an Excel workbook and a PDF.
 *
 * Both carry the same brand. The PDF is the customer-facing artefact — gradient
 * masthead, amber accents, airy zebra tables, the faint KAVISH watermark from
 * the original printed sheet. The workbook is the working copy of that same
 * document: a contents sheet, then one styled worksheet per category with a
 * frozen filterable header and print titles set.
 *
 * Every row is styled identically: the sheet quotes the customer's effective
 * price, and deliberately does not mark which of those prices came from a
 * special adjustment.
 */
import { jsPDF } from 'jspdf';
import type { CustomerRateList } from '@oms/shared';
import { dateStamp } from '@/lib/utils';
import { preOpenPdfTab, savePdfBlob } from '@/lib/pdf';
import { CALIBRI_FONT, registerCalibriFont } from '@/lib/pdf-fonts';
import kavishLogo from '@/assets/kavish-logo.png';
import { buildSections, type BuildSectionsOptions, type DesignPivotTable, type PivotTable } from './customer-rate-list-pivot';

const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_').slice(0, 40);
const stampFull = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ─────────────────────────── palette ───────────────────────────
 * White-paper document in the brand's own three: BLUE (structure + identity),
 * ORANGE and AMBER (accents). The KAVISH mark is itself blue +
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
const AMBER: RGB = [245, 158, 11]; // amber-500 — gradient end, section accents

/** Linear blend between two RGBs (used for the orange→amber accent rules). */
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/**
 * Load the brand mark once as a base64 data URL (+ natural size). Used twice —
 * as the masthead lockup and as the very-light page watermark.
 *
 * `logoUrl` is the company logo uploaded on Settings → General
 * (`CompanyProfileDto.logo`, already a data: URL — no fetch needed). When the
 * company hasn't uploaded one, this falls back to the bundled KAVISH mark, so
 * the document is never bare. Only the fallback is cached: the uploaded logo
 * can change between one download and the next.
 */
let fallbackWatermarkCache: Promise<{ data: string; w: number; h: number }> | null = null;
function loadWatermark(doc: jsPDF, logoUrl?: string | null): Promise<{ data: string; w: number; h: number }> {
  if (logoUrl) {
    const { width, height } = doc.getImageProperties(logoUrl);
    return Promise.resolve({ data: logoUrl, w: width, h: height });
  }
  // Uses only fetch + jsPDF itself so it runs in the browser AND in Node (where
  // the design harness renders the same document with no company configured).
  fallbackWatermarkCache ??= (async () => {
    const buf = new Uint8Array(await (await fetch(kavishLogo)).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
    const data = `data:image/png;base64,${btoa(bin)}`;
    const { width, height } = doc.getImageProperties(data);
    return { data, w: width, h: height };
  })();
  return fallbackWatermarkCache;
}

/* ─────────────────────────── Excel ─────────────────────────── */

/*
 * The workbook is the working copy of the same document the PDF prints, so it
 * carries the same brand: a blue masthead, blue table headers, orange/amber for
 * anything carrying this customer's own adjustment.
 *
 * What changed, and why:
 *
 *  - It was ONE sheet with every category dumped one after another, as a flat
 *    array-of-arrays. There was no styling at all — SheetJS's community build
 *    cannot write cell formats — so it opened as unformatted text: no header
 *    fill, no borders, rates as left-aligned strings, and the "8pcs/10pcs"
 *    header indistinguishable from an item name. exceljs replaces it, loaded
 *    dynamically so its weight only lands on someone who actually downloads.
 *
 *  - Each category is now its own worksheet with its own header row, because a
 *    pivot's columns are per-category: stacking sections in one grid meant one
 *    category's "12pcs" column sat above another's "6pcs", and neither Excel's
 *    filter nor a frozen header could work across them. Per sheet, the header
 *    freezes, the filter filters, and the column widths fit that category.
 *
 *  - A CONTENTS sheet leads, because a workbook of eight tabs needs a way in —
 *    it lists each section with its item count, cheapest rate and how many
 *    lines carry an adjustment, each row clicking through to its sheet.
 *
 *  - Rates are written as NUMBERS with a format, not text. The old exporter did
 *    convert plain rates, but anything merged ("140/150") arrived as a string
 *    and silently poisoned the column: SUM and AVERAGE skipped it. Merged cells
 *    are still text — they are genuinely two rates — but they are marked, so the
 *    reason a total looks light is visible rather than invisible.
 */

/** ARGB forms of the document palette above — exceljs wants alpha-first hex. */
const XL = {
  blue: 'FF1D4ED8',
  blueDeep: 'FF1E3A8A',
  blueZebra: 'FFF3F7FF',
  blueSoft: 'FFDBEAFE',
  orange: 'FFEA580C',
  amber: 'FFF59E0B',
  amberSoft: 'FFFEF3C7',
  ink: 'FF0F172A',
  muted: 'FF64748B',
  hairline: 'FFE2E8F0',
  white: 'FFFFFFFF',
} as const;

/** One table the workbook can render, flattened from either pivot shape. */
interface XlSection {
  /** Full section heading, e.g. "GLASS — RATE LIST" — shown in the masthead and
   *  as the CONTENTS label. */
  title: string;
  /**
   * What the sheet TAB is called — the bare category, or "DESIGNS – GLASS".
   *
   * Not the title: Excel caps a sheet name at 31 characters, and the pivot's own
   * headings are long enough to be cut ("RATE OF DESIGNS ON GLASS (per k"). They
   * are also redundant on a tab — every sheet in the book is a rate list, so
   * repeating it in six tabs says nothing and hides the one word that differs.
   */
  tab: string;
  /** Header labels after SR / ITEM / AVAILABLE. */
  rateColumns: string[];
  /** Second column's heading — "ITEM" for products, "DESIGN TYPE" for designs. */
  itemLabel: string;
  availableLabel: string;
  rows: { sr: number; item: string; available: string; cells: (number | string)[]; special: boolean }[];
  /** "item" / "design" — used in the counts, so they read correctly. */
  noun: string;
}

/** A rate cell as Excel should hold it: a number where it is one, text where the
 *  pivot merged two rates into "140/150" and there is no single number to hold. */
const rateCell = (c: string): number | string => {
  if (!c) return '';
  const n = Number(c);
  return Number.isFinite(n) && !c.includes('/') ? n : c;
};

/** Excel forbids []:*?/\ in a sheet name and caps it at 31 characters; names
 *  must also be unique, so a collision gets a numeric suffix rather than
 *  throwing halfway through building the workbook. */
function sheetName(raw: string, taken: Set<string>): string {
  const base = (raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet').slice(0, 31);
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i += 1) {
    const suffix = ` (${i})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(name.toLowerCase());
  return name;
}

export async function exportRateListExcel(list: CustomerRateList, opts: BuildSectionsOptions = {}): Promise<void> {
  // exceljs is CommonJS, so the shape of the namespace depends on who did the
  // interop: an ESM bundler hands back `{ default: { Workbook } }` while a
  // plain require hands back `{ Workbook }` directly. Reaching straight for
  // `.Workbook` works under one and throws "not a constructor" under the other,
  // so take whichever is actually there.
  const mod = await import('exceljs');
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const { products, designs } = buildSections(list, opts);

  const sections: XlSection[] = [
    ...products.map((t) => ({
      title: t.title,
      tab: t.category || 'OTHER',
      rateColumns: t.columns,
      itemLabel: 'ITEM',
      availableLabel: t.availableLabel.toUpperCase(),
      noun: 'item',
      rows: t.rows.map((r) => ({ sr: r.sr, item: r.item, available: r.available, cells: r.cells.map(rateCell), special: r.special })),
    })),
    // Designs keep their single Rate column — one design type almost always
    // charges one rate regardless of pcs, so pivoting it would repeat the same
    // number across the row.
    ...designs.map((t) => ({
      title: t.title,
      tab: `DESIGNS – ${t.category || 'OTHER'}`,
      rateColumns: ['RATE'],
      itemLabel: 'DESIGN TYPE',
      availableLabel: t.availableLabel.toUpperCase(),
      noun: 'design',
      rows: t.rows.map((r) => ({ sr: r.sr, item: r.item, available: r.available, cells: [r.rate as number | string], special: r.special })),
    })),
  ];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'OMS';
  wb.created = new Date(list.generatedAt);

  const thin = { style: 'thin' as const, color: { argb: XL.hairline } };
  const boxed = { top: thin, left: thin, bottom: thin, right: thin };

  /* ── CONTENTS ─────────────────────────────────────────────────────────── */
  const taken = new Set<string>();
  const contents = wb.addWorksheet(sheetName('Contents', taken), {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  contents.columns = [{ width: 4 }, { width: 34 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 4 }];

  /**
   * Masthead shared by every sheet: the wordmark band, who it is for, and when
   * it was generated. Written as merged bands rather than a header/footer so it
   * is visible on screen, not only in print preview.
   */
  const masthead = (ws: import('exceljs').Worksheet, lastCol: number, heading: string, sub: string) => {
    const col = (n: number) => ws.getRow(n).getCell(1);
    ws.mergeCells(1, 1, 1, lastCol);
    const t = col(1);
    t.value = 'RATE LIST';
    t.font = { name: 'Calibri', size: 20, bold: true, color: { argb: XL.white } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.blueDeep } };
    t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 34;

    ws.mergeCells(2, 1, 2, lastCol);
    const s = col(2);
    s.value = heading;
    s.font = { name: 'Calibri', size: 12, bold: true, color: { argb: XL.white } };
    s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.blue } };
    s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(2).height = 20;

    ws.mergeCells(3, 1, 3, lastCol);
    const n = col(3);
    n.value = sub;
    n.font = { name: 'Calibri', size: 9, italic: true, color: { argb: XL.muted } };
    n.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(3).height = 16;
  };

  const generated = `Generated ${stampFull(list.generatedAt)}`;
  masthead(
    contents,
    6,
    list.customerName,
    `${generated}   ·   Effective rates = base chart rate + this customer’s special-rate adjustments.`,
  );

  const cHead = contents.getRow(5);
  ['', 'SECTION', 'LINES', 'FROM ₹', 'ADJUSTED', ''].forEach((h, i) => {
    const c = cHead.getCell(i + 1);
    c.value = h;
    if (!h) return;
    c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: XL.white } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.blue } };
    c.alignment = { vertical: 'middle', horizontal: i >= 2 ? 'center' : 'left', indent: i < 2 ? 1 : 0 };
    c.border = boxed;
  });
  cHead.height = 18;

  /* ── One sheet per section ────────────────────────────────────────────── */
  sections.forEach((sec, si) => {
    const name = sheetName(sec.tab, taken);
    const lastCol = 3 + sec.rateColumns.length;
    const ws = wb.addWorksheet(name, {
      views: [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: 6 }],
      pageSetup: {
        paperSize: 9,
        orientation: sec.rateColumns.length > 3 ? 'landscape' : 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        // Repeat the masthead + column headings on every printed page — a long
        // category runs to several sheets of paper and a rate column with no
        // heading above it is unreadable.
        printTitlesRow: '1:6',
        margins: { left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
      },
    });

    ws.columns = [
      { width: 5.5 },
      { width: Math.min(46, Math.max(22, ...sec.rows.map((r) => r.item.length + 3))) },
      { width: Math.min(24, Math.max(sec.availableLabel.length + 3, ...sec.rows.map((r) => r.available.length + 3))) },
      ...sec.rateColumns.map((c) => ({ width: Math.max(11, c.length + 3) })),
    ];

    masthead(ws, lastCol, `${list.customerName}   ·   ${sec.title}`, `${generated}   ·   ${sec.rows.length} ${sec.noun}${sec.rows.length === 1 ? '' : 's'}`);
    ws.getRow(5).height = 6; // breathing room between masthead and grid

    const head = ws.getRow(6);
    ['SR', sec.itemLabel, sec.availableLabel, ...sec.rateColumns].forEach((h, i) => {
      const c = head.getCell(i + 1);
      c.value = h;
      c.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: XL.white } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.blue } };
      c.alignment = { vertical: 'middle', horizontal: i === 1 ? 'left' : 'center', indent: i === 1 ? 1 : 0, wrapText: true };
      c.border = boxed;
    });
    head.height = 24;

    sec.rows.forEach((r, ri) => {
      const row = ws.getRow(7 + ri);
      const zebra = ri % 2 === 1;

      const sr = row.getCell(1);
      sr.value = r.sr;
      sr.alignment = { horizontal: 'center', vertical: 'middle' };
      sr.font = { name: 'Calibri', size: 10, color: { argb: XL.muted } };

      const item = row.getCell(2);
      // The asterisk stays — it is what the footnote refers to, and it survives
      // a copy-paste into somewhere with no colour.
      item.value = r.special ? `${r.item} *` : r.item;
      item.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      item.font = { name: 'Calibri', size: 10, bold: true, color: { argb: r.special ? XL.orange : XL.ink } };

      const avail = row.getCell(3);
      // null, not '': an empty string is a real (blank-looking) text cell, which
      // makes the column non-empty for COUNTA and for Excel's filter.
      avail.value = r.available || null;
      avail.alignment = { horizontal: 'center', vertical: 'middle' };
      avail.font = { name: 'Calibri', size: 9.5, color: { argb: XL.muted } };

      r.cells.forEach((v, ci) => {
        const c = row.getCell(4 + ci);
        c.value = v === '' ? null : v;
        c.alignment = { horizontal: typeof v === 'number' ? 'right' : 'center', vertical: 'middle', indent: typeof v === 'number' ? 1 : 0 };
        c.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: XL.ink } };
        if (typeof v === 'number') c.numFmt = '#,##0.##';
        // A merged "140/150" is text, so it cannot join a SUM. Tinting it amber
        // makes the gap in a column total visible instead of silent.
        else if (v) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.amberSoft } };
      });

      for (let ci = 1; ci <= lastCol; ci += 1) {
        const c = row.getCell(ci);
        c.border = boxed;
        // Zebra only where nothing more specific already claimed the fill.
        if (zebra && !c.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.blueZebra } };
      }
      row.height = 17;
    });

    // Excel's own filter, on the real header row. Worth having per sheet: it is
    // how anyone actually finds one item in a 200-row category.
    if (sec.rows.length > 0) {
      ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + sec.rows.length, column: lastCol } };
    }

    // Only footnote what is actually on this sheet. The legend used to be
    // printed unconditionally, so a section with no adjustments and no merged
    // columns still carried two sentences explaining marks that were not there.
    const anySpecial = sec.rows.some((r) => r.special);
    const anyMerged = sec.rows.some((r) => r.cells.some((v) => typeof v === 'string' && v !== ''));
    const notes = [
      anySpecial ? '*  this line includes your special-rate adjustment.' : '',
      anyMerged ? 'Amber cell = two rates merged into one column, so it is held as text and will not join a SUM.' : '',
    ].filter(Boolean);
    if (notes.length) {
      const footRow = 8 + sec.rows.length;
      ws.mergeCells(footRow, 1, footRow, lastCol);
      const foot = ws.getRow(footRow).getCell(1);
      foot.value = notes.join('   ');
      foot.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: XL.muted } };
      foot.alignment = { horizontal: 'left', indent: 1 };
    }

    /* ── the CONTENTS row pointing here ───────────────────────────────── */
    const cRow = contents.getRow(6 + si);
    const numeric = sec.rows.flatMap((r) => r.cells.filter((v): v is number => typeof v === 'number'));
    const adjusted = sec.rows.filter((r) => r.special).length;
    const cells: (string | number | { formula: string })[] = [
      '',
      // Clicking the section name opens its sheet — the point of a contents page.
      { formula: `HYPERLINK("#'${name}'!A6","${sec.title.replace(/"/g, '""')}")` },
      sec.rows.length,
      numeric.length ? Math.min(...numeric) : '—',
      adjusted || '—',
      '',
    ];
    cells.forEach((v, i) => {
      const c = cRow.getCell(i + 1);
      if (i === 0 || i === 5) return;
      c.value = v as never;
      c.border = boxed;
      c.alignment = { vertical: 'middle', horizontal: i >= 2 ? 'center' : 'left', indent: i < 2 ? 1 : 0 };
      c.font =
        i === 1
          ? { name: 'Calibri', size: 10.5, bold: true, color: { argb: XL.blue }, underline: true }
          : { name: 'Calibri', size: 10.5, bold: i === 4 && !!adjusted, color: { argb: i === 4 && adjusted ? XL.orange : XL.ink } };
      if (i === 3 && numeric.length) c.numFmt = '#,##0.##';
      if (si % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.blueZebra } };
    });
    cRow.height = 18;
  });

  /* ── Contents footer: the totals, and the legend ──────────────────────── */
  const totalRow = 6 + sections.length;
  const tr = contents.getRow(totalRow);
  [
    ['', ''],
    [2, 'TOTAL'],
    [3, sections.reduce((n, s) => n + s.rows.length, 0)],
    [4, ''],
    [5, sections.reduce((n, s) => n + s.rows.filter((r) => r.special).length, 0) || '—'],
  ].forEach(([i, v]) => {
    if (!i) return;
    const c = tr.getCell(i as number);
    c.value = v as never;
    c.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: XL.blueDeep } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.blueSoft } };
    c.alignment = { vertical: 'middle', horizontal: (i as number) >= 3 ? 'center' : 'left', indent: (i as number) < 3 ? 1 : 0 };
    c.border = boxed;
  });
  tr.height = 19;

  contents.mergeCells(totalRow + 2, 2, totalRow + 2, 5);
  const legend = contents.getRow(totalRow + 2).getCell(2);
  legend.value = 'Click a section to open its sheet. “Adjusted” counts the lines carrying this customer’s special rate — those lines are marked * and shown in orange.';
  legend.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: XL.muted } };
  legend.alignment = { wrapText: true, vertical: 'top' };
  contents.getRow(totalRow + 2).height = 26;

  // Nothing to show at all still has to produce a readable file rather than a
  // workbook with no sheets, which Excel refuses to open.
  if (sections.length === 0) {
    contents.mergeCells(6, 2, 6, 5);
    const empty = contents.getRow(6).getCell(2);
    empty.value = 'No rates on this sheet for the categories selected.';
    empty.font = { name: 'Calibri', size: 10.5, italic: true, color: { argb: XL.muted } };
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `RateList-${sanitize(list.customerName)}-${dateStamp()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ─────────────────────────── PDF ─────────────────────────── */

/** Build the full A4 rate-list document (design work lives here; `exportRateListPdf`
 *  just saves it). Exported separately so the Node design harness can render the
 *  exact same document to a file for visual review. */
export async function buildRateListPdfDoc(list: CustomerRateList, opts: BuildSectionsOptions = {}, logo?: string | null): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  /** Very narrow margins (14pt ≈ 5mm), so the rate columns get almost the full
   *  paper width instead of the edge. Everything else is measured off `usable`,
   *  so the whole document reflows from this one number. 5mm is close to what
   *  most office printers can still image right to the edge of an A4 sheet. */
  const margin = 14;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usable = pageW - margin * 2;
  const footerTop = pageH - 34;
  let y = 0;
  let headerH = 0;

  const { products, designs } = buildSections(list, opts);
  // Both counted off the BUILT sections rather than the raw payload, so each
  // pill states the number of rows actually printed below it. Counting the
  // source would over-report: the pivot merges a product's pcs variants into one
  // row, and combination designs are dropped from the sheet entirely.
  const productCount = products.reduce((n, t) => n + t.rows.length, 0);
  const designCount = designs.reduce((n, t) => n + t.rows.length, 0);

  const wm = await loadWatermark(doc, logo).catch(() => null);

  /* ── Items-table typography ─────────────────────────────────────────────
   * The rate grid is set in Calibri (Carlito — see lib/pdf-fonts) at 11pt BOLD,
   * matching the printed sheet. Everything in the grid is bold: this is a price
   * list read across a counter, so the figures carry the page and a mix of
   * weights would only make some of them look provisional.
   *
   * Row height tracks the type size — at 11pt the old 24pt row left the text
   * swimming, so it comes down in proportion. If the font fails to load we fall
   * back to Helvetica, which runs visually larger, at a size that matches — the
   * document degrades rather than breaks. */
  const hasCalibri = await registerCalibriFont(doc);
  /** Calibri (Carlito) everywhere — masthead, section headings, grid, footer.
   *  The grid was already set in it; leaving the chrome in Helvetica put two
   *  typefaces on one page for no reason. Falls back to Helvetica as a set if
   *  the font can't be loaded. */
  const TABLE_FONT = hasCalibri ? CALIBRI_FONT : 'helvetica';
  const UI_FONT = TABLE_FONT;
  const DATA_SIZE = hasCalibri ? 11 : 10.5;
  const META_SIZE = hasCalibri ? 9 : 8.5;
  const HEAD_SIZE = hasCalibri ? 11 : 8;
  const rowH = hasCalibri ? 19 : 18;

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

  /** Widest of `values` at `size`, using whatever font face is currently set. */
  const maxWidthAt = (values: string[], size: number): number => {
    if (!values.length) return 0;
    const prev = doc.getFontSize();
    doc.setFontSize(size);
    const w = Math.max(...values.map((v) => doc.getTextWidth(v)));
    doc.setFontSize(prev);
    return w;
  };

  /**
   * ONE type size for a whole column — the largest (≤ `base`) at which every
   * value fits `maxW`.
   *
   * Sizing each cell on its own, as {@link fitText} does, left a single column
   * rendering at three or four different sizes depending on how long each entry
   * happened to be; that reads as a defect rather than as fitting. Used for
   * columns whose values are alike (the pcs lists) — NOT for item names, where
   * lengths vary so wildly that one long outlier would shrink every other row.
   */
  const columnSize = (values: string[], maxW: number, base: number, min = 7.5): number => {
    let s = base;
    while (s > min && maxWidthAt(values, s) > maxW) s -= 0.25;
    return s;
  };

  /**
   * ONE type size for a row of labels that each have their OWN column width —
   * the largest at which every label still fits its cell.
   *
   * The header row needs this rather than {@link columnSize}: a wide label like
   * "13–18PCS" sits in a narrow rate column while "8PCS" sits in an identical
   * one, so sizing each header on its own printed the same header row at two or
   * three different sizes, which reads as a defect.
   */
  const rowFitSize = (items: { text: string; maxW: number }[], base: number, min = 6.5): number => {
    if (!items.length) return base;
    const prev = doc.getFontSize();
    let s = base;
    const fits = () => {
      doc.setFontSize(s);
      return items.every((it) => doc.getTextWidth(it.text) <= it.maxW);
    };
    while (s > min && !fits()) s -= 0.25;
    doc.setFontSize(prev);
    return s;
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

  /* Summary-pill metrics, kept in one place so measuring and drawing can never
   * disagree — the pills are right-aligned, which needs their width BEFORE the
   * first one is drawn. */
  const PILL = { valueSize: 12, labelSize: 8.5, h: 30, pad: 32, textX: 19, gap: 9 };

  /** Width of a pill, without drawing it. */
  const pillWidth = (label: string, value: string): number => {
    doc.setFont(UI_FONT, 'bold').setFontSize(PILL.valueSize);
    const valW = doc.getTextWidth(value);
    doc.setFont(UI_FONT, 'normal').setFontSize(PILL.labelSize);
    const labW = doc.getTextWidth(label.toUpperCase());
    return Math.max(valW, labW) + PILL.pad;
  };

  /** A stat pill: coloured dot + value + label, on a soft tinted card. */
  const statPill = (x: number, yy: number, label: string, value: string, dot: RGB, fill: RGB): number => {
    const w = pillWidth(label, value);
    doc.setFillColor(...fill);
    doc.roundedRect(x, yy, w, PILL.h, 3.5, 3.5, 'F');
    doc.setFillColor(...dot);
    doc.circle(x + 11, yy + 11.5, 2.8, 'F');
    doc.setFont(UI_FONT, 'bold').setFontSize(PILL.valueSize).setTextColor(...BLUE_DEEP);
    doc.text(value, x + PILL.textX, yy + 14.5);
    doc.setFont(UI_FONT, 'normal').setFontSize(PILL.labelSize).setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x + PILL.textX, yy + 25, { charSpace: 0.6 });
    return w;
  };

  /** Page-1 masthead — white stationery: logo lockup, blue wordmark, the
   *  orange→amber rule, then the "prepared for" block and summary pills. */
  const heroHeader = () => {
    // The brand mark leads the page, so it is sized to hold its own against the
    // RATE LIST wordmark opposite it rather than sitting as a small corner tag.
    const logoH = 60;
    if (wm) {
      const logoW = (logoH * wm.w) / wm.h;
      doc.addImage(wm.data, 'PNG', margin, 28, logoW, logoH, 'kavish-mark', 'FAST');
    } else {
      doc.setFont(UI_FONT, 'bold').setFontSize(20).setTextColor(...BLUE_DEEP);
      doc.text('KAVISH', margin, 68);
    }

    doc.setFont(UI_FONT, 'bold').setFontSize(31).setTextColor(...BLUE_DEEP);
    rightTracked('RATE LIST', pageW - margin, 66, 2.5);
    doc.setFont(UI_FONT, 'normal').setFontSize(9).setTextColor(...MUTED);
    doc.text(stampFull(list.generatedAt), pageW - margin, 84, { align: 'right' });

    accentRule(margin, 100, usable, 3);

    /* The "prepared for" block reads left, the totals sit right, on one band —
     * the two are different kinds of fact and shouldn't queue up in a column. */
    doc.setFont(UI_FONT, 'bold').setFontSize(8.5).setTextColor(...ORANGE);
    doc.text('PREPARED FOR', margin, 126, { charSpace: 1.8 });

    const pills = [
      { label: 'Products', value: String(productCount) },
      { label: 'Designs', value: String(designCount) },
    ];
    const pillsW = pills.reduce((n, p) => n + pillWidth(p.label, p.value), 0) + PILL.gap * (pills.length - 1);
    let px = pageW - margin - pillsW;
    for (const p of pills) px += statPill(px, 122, p.label, p.value, BLUE, BLUE_ZEBRA) + PILL.gap;

    // The name takes whatever the pills leave, so a long one shrinks to fit
    // rather than running underneath them.
    doc.setFont(UI_FONT, 'bold').setFontSize(22).setTextColor(...BLUE_DEEP);
    fitText(list.customerName, margin, 150, usable - pillsW - 24, 22, { minSize: 12 });

    headerH = 172;
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
    doc.setFont(UI_FONT, 'bold').setFontSize(10).setTextColor(...BLUE_DEEP);
    rightTracked('RATE LIST', pageW - margin, 38, 1.5);
    doc.setFont(UI_FONT, 'normal').setFontSize(8).setTextColor(...MUTED);
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

  /**
   * Every column boundary gets a vertical rule and every row a horizontal one
   * (spec §22), so the sheet prints as a complete grid rather than a set of
   * banded rows. Drawn from the measured widths, so the rules always land on the
   * real boundaries even after a column has been shrunk to fit.
   */
  const columnRules = (widths: number[], top: number, height: number) => {
    doc.setDrawColor(...HAIRLINE);
    doc.setLineWidth(0.5);
    let x = margin;
    doc.line(x, top, x, top + height);
    for (const w of widths) {
      x += w;
      doc.line(x, top, x, top + height);
    }
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
    const headers = ['SR', 'ITEM', ...(showAvail ? [t.availableLabel.toUpperCase()] : []), ...t.columns.map((c) => c.toUpperCase())];
    // One size for the whole pcs column, so it never renders ragged.
    doc.setFont(TABLE_FONT, 'bold');
    const availSize = showAvail ? columnSize(t.rows.map((r) => r.available).filter(Boolean), availW - 12, DATA_SIZE) : DATA_SIZE;
    const firstRateCol = showAvail ? 3 : 2;

    ensure(rowH * 4 + 40);

    // Section heading: orange→amber accent bar + blue title, count on the right.
    // The pivot's title carries a "— RATE LIST" suffix for the Excel/on-screen
    // views; under a sheet already titled RATE LIST it's just noise, so the PDF
    // drops it (display only — the shared title itself is untouched).
    accentRule(margin, y - 10.5, 3.5, 14);
    doc.setFont(UI_FONT, 'bold').setFontSize(12.5).setTextColor(...BLUE_DEEP);
    doc.text(t.title.replace(/\s*—\s*RATE LIST\s*$/i, ''), margin + 11, y);
    doc.setFont(UI_FONT, 'normal').setFontSize(9).setTextColor(...FAINT);
    doc.text(`${t.rows.length} item${t.rows.length === 1 ? '' : 's'}`, margin + usable, y, { align: 'right' });
    y += 11;

    // Header row: one solid blue bar across the full table, white caps. Keeping
    // it a single block (rather than the old two-tone navy/peach split) is what
    // lets the white paper and the watermark carry the page.
    doc.setFont(TABLE_FONT, 'bold');
    const headSize = rowFitSize(headers.map((h, i) => ({ text: h, maxW: widths[i] - 12 })), HEAD_SIZE);
    const headerRow = () => {
      doc.setFillColor(...BLUE);
      doc.roundedRect(margin, y, usable, rowH + 2, 2.5, 2.5, 'F');
      doc.setFont(TABLE_FONT, 'bold');
      let x = margin;
      headers.forEach((h, i) => {
        const right = i >= firstRateCol;
        doc.setTextColor(...WHITE);
        fitText(h, right ? x + widths[i] - 6 : x + 7, y + rowH / 2 + 4, widths[i] - 12, headSize, {
          ...(right ? { align: 'right' as const } : {}),
          minSize: headSize,
        });
        x += widths[i];
      });
      // Faint dividers inside the blue header bar, so the grid of §22 starts at
      // the heading rather than only under it.
      doc.setDrawColor(255, 255, 255);
      doc.setLineWidth(0.5);
      let hx = margin;
      for (const w of widths.slice(0, -1)) {
        hx += w;
        doc.line(hx, y + 2, hx, y + rowH);
      }
      y += rowH + 5;
    };
    headerRow();

    t.rows.forEach((r, idx) => {
      if (y + rowH > footerTop - 4) {
        breakPage();
        headerRow();
      }
      // Zebra: a whisper of blue on alternate rows. Every row is presented the
      // same way — the sheet quotes the customer's effective price and doesn't
      // annotate how it was arrived at.
      if (idx % 2 === 1) {
        doc.setFillColor(...BLUE_ZEBRA);
        doc.rect(margin, y - 2, usable, rowH, 'F');
      }
      // Baseline that centres the text in the (now taller) row.
      const ty = y + rowH / 2 + DATA_SIZE * 0.34;
      let x = margin;
      // SR
      doc.setFont(TABLE_FONT, 'bold').setFontSize(META_SIZE).setTextColor(...FAINT);
      doc.text(String(r.sr), x + 7, ty);
      x += widths[0];
      doc.setFont(TABLE_FONT, 'bold').setTextColor(...INK);
      fitText(r.item, x + 6, ty, widths[1] - 10, DATA_SIZE, { minSize: 8 });
      x += widths[1];
      // Available column — same size as the rate figures, so it reads as data
      // rather than a faint footnote next to them.
      if (showAvail) {
        doc.setFont(TABLE_FONT, 'bold').setTextColor(...INK);
        fitText(r.available, x + 6, ty, widths[2] - 10, availSize, { minSize: availSize });
        x += widths[2];
      }
      // rate cells
      r.cells.forEach((cell, i) => {
        const w = widths[firstRateCol + i];
        if (cell) {
          doc.setFont(TABLE_FONT, 'bold').setTextColor(...INK);
          fitText(cell, x + w - 6, ty, w - 12, DATA_SIZE, { align: 'right', minSize: 7.5 });
        } else {
          doc.setFont(TABLE_FONT, 'bold').setFontSize(META_SIZE).setTextColor(...FAINT);
          doc.text('–', x + w - 6, ty, { align: 'right' });
        }
        x += w;
      });
      columnRules(widths, y - 2, rowH);
      doc.setDrawColor(...HAIRLINE);
      doc.setLineWidth(0.4);
      doc.line(margin, y + rowH - 2, margin + usable, y + rowH - 2);
      y += rowH;
    });

    // Close the section with a soft blue keyline, then breathe.
    doc.setDrawColor(...BLUE_SOFT);
    doc.setLineWidth(1);
    doc.line(margin, y - 1.5, margin + usable, y - 1.5);
    y += 28;
  };

  /**
   * Designs get their own drawer instead of `drawPivot`: a design type almost
   * always charges one rate regardless of pcs/size, so the pcs-pivoted grid
   * products use would mostly repeat the same figure across several columns.
   * One wide RATE column holds it instead, showing the one rate each design
   * type is billed at most often.
   */
  const drawDesignPivot = (t: DesignPivotTable) => {
    const showAvail = t.rows.some((r) => r.available !== '');
    const availValues = t.rows.map((r) => r.available).filter(Boolean);

    /* Column plan. RATE used to take everything left over — around 200pt for a
     * three-digit number — while AVAILABLE PCS was pinned at 78pt, so the long
     * pcs lists had to shrink and ellipsise inside a cramped column next to a
     * mostly-empty one. RATE now takes only what a rate needs, and the pcs
     * column is sized to its own content. */
    doc.setFont(TABLE_FONT, 'bold');
    const rateW = 92;
    let availW = showAvail ? Math.min(Math.max(78, Math.ceil(maxWidthAt(availValues, DATA_SIZE)) + 14), 210) : 0;
    let itemW = usable - 26 - availW - rateW;
    // The design name still comes first if the two ever compete for space.
    if (itemW < 150) {
      availW = Math.max(70, availW - (150 - itemW));
      itemW = usable - 26 - availW - rateW;
    }
    const widths = [26, itemW, ...(showAvail ? [availW] : []), rateW];
    const headers = ['SR', 'DESIGN TYPE', ...(showAvail ? [t.availableLabel.toUpperCase()] : []), 'RATE'];
    // One size for the whole pcs column, so it never renders ragged.
    const availSize = showAvail ? columnSize(availValues, availW - 12, DATA_SIZE) : DATA_SIZE;
    const rateColIdx = showAvail ? 3 : 2;

    ensure(rowH * 4 + 40);

    accentRule(margin, y - 10.5, 3.5, 14);
    doc.setFont(UI_FONT, 'bold').setFontSize(12.5).setTextColor(...BLUE_DEEP);
    doc.text(t.title.replace(/\s*—\s*RATE LIST\s*$/i, ''), margin + 11, y);
    doc.setFont(UI_FONT, 'normal').setFontSize(9).setTextColor(...FAINT);
    const note = `${t.rows.length} design${t.rows.length === 1 ? '' : 's'}`;
    doc.text(note, margin + usable, y, { align: 'right' });
    y += 11;

    doc.setFont(TABLE_FONT, 'bold');
    const headSize = rowFitSize(headers.map((h, i) => ({ text: h, maxW: widths[i] - 12 })), HEAD_SIZE);
    const headerRow = () => {
      doc.setFillColor(...BLUE);
      doc.roundedRect(margin, y, usable, rowH + 2, 2.5, 2.5, 'F');
      doc.setFont(TABLE_FONT, 'bold');
      let x = margin;
      headers.forEach((h, i) => {
        const right = i >= rateColIdx;
        doc.setTextColor(...WHITE);
        fitText(h, right ? x + widths[i] - 6 : x + 7, y + rowH / 2 + 4, widths[i] - 12, headSize, {
          ...(right ? { align: 'right' as const } : {}),
          minSize: headSize,
        });
        x += widths[i];
      });
      // Faint dividers inside the blue header bar, so the grid of §22 starts at
      // the heading rather than only under it.
      doc.setDrawColor(255, 255, 255);
      doc.setLineWidth(0.5);
      let hx = margin;
      for (const w of widths.slice(0, -1)) {
        hx += w;
        doc.line(hx, y + 2, hx, y + rowH);
      }
      y += rowH + 5;
    };
    headerRow();

    t.rows.forEach((r, idx) => {
      if (y + rowH > footerTop - 4) {
        breakPage();
        headerRow();
      }
      if (idx % 2 === 1) {
        doc.setFillColor(...BLUE_ZEBRA);
        doc.rect(margin, y - 2, usable, rowH, 'F');
      }
      const ty = y + rowH / 2 + DATA_SIZE * 0.34;
      let x = margin;
      doc.setFont(TABLE_FONT, 'bold').setFontSize(META_SIZE).setTextColor(...FAINT);
      doc.text(String(r.sr), x + 7, ty);
      x += widths[0];
      doc.setFont(TABLE_FONT, 'bold').setTextColor(...INK);
      fitText(r.item, x + 6, ty, widths[1] - 10, DATA_SIZE, { minSize: 8 });
      x += widths[1];
      if (showAvail) {
        doc.setFont(TABLE_FONT, 'bold').setTextColor(...INK);
        fitText(r.available, x + 6, ty, widths[2] - 10, availSize, { minSize: availSize });
        x += widths[2];
      }
      const rateW2 = widths[rateColIdx];
      doc.setFont(TABLE_FONT, 'bold').setTextColor(...INK);
      fitText(String(r.rate), x + rateW2 - 6, ty, rateW2 - 12, DATA_SIZE, { align: 'right', minSize: 7 });
      columnRules(widths, y - 2, rowH);
      doc.setDrawColor(...HAIRLINE);
      doc.setLineWidth(0.4);
      doc.line(margin, y + rowH - 2, margin + usable, y + rowH - 2);
      y += rowH;
    });

    doc.setDrawColor(...BLUE_SOFT);
    doc.setLineWidth(1);
    doc.line(margin, y - 1.5, margin + usable, y - 1.5);
    y += 28;
  };

  products.forEach(drawPivot);
  designs.forEach(drawDesignPivot);

  // Footer on every page: orange→amber hairline, brand, customer, page number.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    accentRule(margin, footerTop + 6, usable, 1.2);

    const brand = 'KAVISH · THE UNIQUE';
    const pageLabel = `Page ${i} of ${pages}`;
    doc.setFont(UI_FONT, 'bold').setFontSize(7.5).setTextColor(...BLUE_DEEP);
    const brandW = doc.getTextWidth(brand) + 1 * (brand.length - 1); // + charSpace
    doc.text(brand, margin, footerTop + 19, { charSpace: 1 });

    doc.setFont(UI_FONT, 'normal').setFontSize(7.5).setTextColor(...MUTED);
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

export async function exportRateListPdf(
  list: CustomerRateList,
  opts: BuildSectionsOptions = {},
  logo?: string | null,
): Promise<void> {
  // Reserve a tab now (in the tap gesture) so iOS Safari doesn't block the save
  // that fires after the async doc build. No-op off iOS.
  const iosTab = preOpenPdfTab();
  try {
    const doc = await buildRateListPdfDoc(list, opts, logo);
    void savePdfBlob(doc.output('blob'), `RateList-${sanitize(list.customerName)}-${dateStamp()}.pdf`, iosTab);
  } catch (e) {
    iosTab?.close();
    throw e;
  }
}
