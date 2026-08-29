import ExcelJS from 'exceljs';
import type { ChallanDto } from '@oms/shared';

/**
 * The Challans list's two Excel reports.
 *
 * Built here rather than in the browser because SheetJS — which the browser
 * copy used — cannot write a font, a fill or a border in its free build. Those
 * reports came out as bare grids whatever was asked of them. ExcelJS can, so
 * the file now arrives looking like the screen it came from.
 *
 *   Challan Summary — one sheet, one row per challan.
 *   Detailed View   — the same sheet plus every line item on a second one.
 */

/** Filter context printed above the table, so a saved file explains itself. */
export interface ChallanReportMeta {
  status: string;
  category: string;
  dateRange: string;
  search: string;
}

const FONT = 'Calibri';
const SIZE = 11;
/** The navy and amber the app's own grids use. */
const NAVY = 'FF163E64';
const AMBER = 'FFE2A346';
const ZEBRA = 'FFF5F7FA';
const GRID = 'FFD9DEE5';
const MONEY = '#,##0.00';
const DATE_FMT = 'dd-mm-yyyy';

const thin = { style: 'thin' as const, color: { argb: GRID } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

/**
 * Excel's day serial for a date, from its LOCAL calendar day.
 *
 * ExcelJS writes a Date in UTC, and these are local midnight — so 11-08-2026
 * would go into the file as 2026-08-10T18:30Z and Excel would show the 10th.
 * A whole-day serial also keeps Excel's Date Filters matching whole days.
 */
function excelSerial(d: Date): number {
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

const asDate = (iso: string | null | undefined): number | '' => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : excelSerial(d);
};

/** DUE / OVER DUE text relative to today (mirrors the list's Due column). */
function dueText(due: string | null | undefined): string {
  if (!due) return '—';
  const d = new Date(due);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  return days < 0 ? `${Math.abs(days)} over` : `${days} left`;
}

/** Header row: navy, white, bold, frozen and filterable. */
function styleHeader(ws: ExcelJS.Worksheet, rowNo: number, cols: number): void {
  const row = ws.getRow(rowNo);
  row.height = 22;
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.font = { name: FONT, size: SIZE, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = box;
  }
}

/** Body rows: one font, real formats, quiet zebra. */
function styleBody(ws: ExcelJS.Worksheet, firstRow: number, lastRow: number, cols: number, moneyCols: number[], dateCols: number[]): void {
  for (let r = firstRow; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const zebra = (r - firstRow) % 2 === 1;
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      cell.font = { name: FONT, size: SIZE };
      cell.border = box;
      if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      if (dateCols.includes(c)) {
        cell.numFmt = DATE_FMT;
        cell.alignment = { horizontal: 'center' };
      } else if (moneyCols.includes(c)) {
        cell.numFmt = MONEY;
        cell.alignment = { horizontal: 'right' };
      } else if (typeof cell.value === 'number') {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
      } else {
        cell.alignment = { horizontal: 'left', vertical: 'top' };
      }
    }
  }
}

/** A bold total row under the table, so the figures foot without a formula. */
function addTotalRow(ws: ExcelJS.Worksheet, cols: number, values: (string | number | null)[], moneyCols: number[]): void {
  const row = ws.addRow(values);
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.font = { name: FONT, size: SIZE, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } };
    cell.border = box;
    if (moneyCols.includes(c)) {
      cell.numFmt = MONEY;
      cell.alignment = { horizontal: 'right' };
    }
  }
}

function fitColumns(ws: ExcelJS.Worksheet, headerRow: number, cols: number, min = 10, max = 42): void {
  for (let c = 1; c <= cols; c++) {
    let width = String(ws.getRow(headerRow).getCell(c).value ?? '').length + 4;
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n <= headerRow) return;
      const v = row.getCell(c).value;
      const len = typeof v === 'number' ? 12 : String(v ?? '').length + 2;
      if (len > width) width = len;
    });
    ws.getColumn(c).width = Math.max(min, Math.min(max, width));
  }
}

/** The "Challans" sheet — title, the filters it was run with, then the table. */
function addChallansSheet(wb: ExcelJS.Workbook, rows: ChallanDto[], meta: ChallanReportMeta, title: string): void {
  const headers = ['Date', 'Challan No', 'Party', 'Category', 'B (₹)', 'C (₹)', 'GST (₹)', 'TDS (₹)', 'Total (₹)', 'Due', 'Status', 'Remarks'];
  const cols = headers.length;
  const ws = wb.addWorksheet('Challans', { views: [{ state: 'frozen', ySplit: 8 }] });

  // Title band.
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT, size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  t.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 28;

  // The filters this was run with — a saved file that cannot say what it covers
  // is a file nobody can trust six months later.
  const metaRows: [string, string][] = [
    ['Status', meta.status],
    ['Category', meta.category],
    ['Date Range', meta.dateRange],
    ['Search', meta.search],
  ];
  metaRows.forEach(([k, v], i) => {
    const r = ws.getRow(2 + i);
    r.getCell(1).value = k;
    r.getCell(1).font = { name: FONT, size: SIZE, bold: true, color: { argb: 'FF555555' } };
    r.getCell(2).value = v;
    r.getCell(2).font = { name: FONT, size: SIZE };
  });
  ws.mergeCells(6, 1, 6, cols);
  const gen = ws.getCell(6, 1);
  gen.value = `Generated ${new Date().toLocaleString('en-IN')}   ·   ${rows.length} challan(s)`;
  gen.font = { name: FONT, size: 10, italic: true, color: { argb: 'FF555555' } };

  ws.addRow([]); // spacer, row 7
  ws.addRow(headers); // row 8
  styleHeader(ws, 8, cols);

  for (const r of rows) {
    ws.addRow([
      asDate(r.invDate),
      r.code,
      r.customerName,
      r.category ?? '—',
      r.b ?? 0,
      r.c ?? 0,
      r.tax ?? 0,
      r.tds ?? 0,
      r.total ?? 0,
      dueText(r.dueDate),
      r.challanStatus,
      r.remarks ?? '',
    ]);
  }
  const money = [5, 6, 7, 8, 9];
  styleBody(ws, 9, 8 + rows.length, cols, money, [1]);

  const sum = (pick: (r: ChallanDto) => number | null | undefined) => rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
  addTotalRow(
    ws,
    cols,
    ['', '', `${rows.length} challan(s)`, 'TOTAL', sum((r) => r.b), sum((r) => r.c), sum((r) => r.tax), sum((r) => r.tds), sum((r) => r.total), '', '', ''],
    money,
  );

  if (rows.length) ws.autoFilter = { from: { row: 8, column: 1 }, to: { row: 8, column: cols } };
  fitColumns(ws, 8, cols);
}

/** The "Challan Items" sheet — one row per line across every challan. */
function addItemsSheet(wb: ExcelJS.Workbook, rows: ChallanDto[]): void {
  const headers = ['Inv Date', 'Challan No', 'Party', 'Product Name', 'Design', 'Bags', 'Pcs', 'Kgs', 'Box', 'Unit', 'Price (₹)', 'Amount (₹)', 'P.Category', 'Comment'];
  const cols = headers.length;
  const ws = wb.addWorksheet('Challan Items', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(headers);
  styleHeader(ws, 1, cols);

  let n = 0;
  for (const c of rows) {
    for (const it of c.items ?? []) {
      ws.addRow([
        asDate(c.invDate),
        c.code,
        c.customerName,
        it.productName ?? '',
        it.design ?? '',
        it.bags ?? 0,
        it.pcs ?? 0,
        it.kgs ?? 0,
        it.box ?? 0,
        it.unit ?? '',
        it.price ?? 0,
        it.amount ?? 0,
        it.pCategory ?? '',
        it.comment ?? '',
      ]);
      n += 1;
    }
  }
  const money = [11, 12];
  styleBody(ws, 2, 1 + n, cols, money, [1]);
  const amount = rows.reduce((s, c) => s + (c.items ?? []).reduce((a, it) => a + (it.amount ?? 0), 0), 0);
  addTotalRow(ws, cols, ['', '', `${n} line(s)`, '', '', '', '', '', '', '', 'TOTAL', amount, '', ''], money);
  if (n) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } };
  fitColumns(ws, 1, cols);
}

export async function buildChallanReport(
  rows: ChallanDto[],
  meta: ChallanReportMeta,
  kind: 'detailed' | 'summary',
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OMS';
  wb.created = new Date();
  /*
   * The two names are the wrong way round in the wire contract and stay that
   * way: `detailed` is the challan LIST and `summary` is the list WITH its line
   * items. The titles say what the file actually contains, matching the buttons.
   */
  const isItemised = kind === 'summary';
  addChallansSheet(wb, rows, meta, isItemised ? 'SALES CHALLANS — DETAILED VIEW' : 'SALES CHALLANS — CHALLAN SUMMARY');
  if (isItemised) addItemsSheet(wb, rows);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
