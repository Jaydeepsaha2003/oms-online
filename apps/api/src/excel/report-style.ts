import ExcelJS from 'exceljs';

/**
 * The house look for a printed Excel report.
 *
 * One implementation, shared by every report builder, so the Challans export
 * and the Pending Invoices export cannot drift into looking like two different
 * products. Everything here is presentation — no report decides its own font.
 */

export const FONT = 'Calibri';
export const SIZE = 11;
/** The navy and amber the app's own grids use. */
export const NAVY = 'FF163E64';
export const AMBER = 'FFE2A346';
export const ZEBRA = 'FFF5F7FA';
export const GRID = 'FFD9DEE5';
export const MONEY = '#,##0.00';
export const DATE_FMT = 'dd-mm-yyyy';

const thin = { style: 'thin' as const, color: { argb: GRID } };
export const box = { top: thin, left: thin, bottom: thin, right: thin };

/**
 * Excel's day serial for a date, from its LOCAL calendar day.
 *
 * ExcelJS writes a Date in UTC, and these are local midnight — so 11-08-2026
 * would go into the file as 2026-08-10T18:30Z and Excel would show the 10th.
 * A whole-day serial also keeps Excel's Date Filters matching whole days.
 */
export function excelSerial(d: Date): number {
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

export const asDate = (iso: string | null | undefined): number | '' => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : excelSerial(d);
};

/** The title band across the top of a sheet. */
export function addTitle(ws: ExcelJS.Worksheet, cols: number, title: string): void {
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT, size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  t.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 28;
}

/**
 * The label/value block under the title.
 *
 * A saved file that cannot say what it covers is one nobody can trust six
 * months later, so every report states the filters it was run with.
 */
export function addMetaBlock(ws: ExcelJS.Worksheet, cols: number, pairs: [string, string][], footnote: string): number {
  pairs.forEach(([k, v], i) => {
    const r = ws.getRow(2 + i);
    r.getCell(1).value = k;
    r.getCell(1).font = { name: FONT, size: SIZE, bold: true, color: { argb: 'FF555555' } };
    r.getCell(2).value = v;
    r.getCell(2).font = { name: FONT, size: SIZE };
  });
  const noteRow = 2 + pairs.length;
  ws.mergeCells(noteRow, 1, noteRow, cols);
  const gen = ws.getCell(noteRow, 1);
  gen.value = footnote;
  gen.font = { name: FONT, size: 10, italic: true, color: { argb: 'FF555555' } };
  // Blank spacer, then the header lands on the row after.
  return noteRow + 2;
}

/** Header row: navy, white, bold, and bordered. */
export function styleHeader(ws: ExcelJS.Worksheet, rowNo: number, cols: number): void {
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

/** Body rows: one font, real number and date formats, quiet zebra. */
export function styleBody(
  ws: ExcelJS.Worksheet,
  firstRow: number,
  lastRow: number,
  cols: number,
  moneyCols: number[],
  dateCols: number[],
): void {
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
export function addTotalRow(ws: ExcelJS.Worksheet, cols: number, values: (string | number | null)[], moneyCols: number[]): void {
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

/** Column widths from the widest cell, within sane bounds. */
export function fitColumns(ws: ExcelJS.Worksheet, headerRow: number, cols: number, min = 10, max = 42): void {
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

/** A workbook with the app's authorship stamped on it. */
export function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OMS';
  wb.created = new Date();
  return wb;
}

export async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
