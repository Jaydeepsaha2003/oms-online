import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';

/** Maps a row object to a spreadsheet column. */
export interface ExcelColumn<T> {
  header: string;
  /** Property name on the row, or any string key. */
  key: keyof T | string;
  /** Optional custom value extractor (overrides `key`). */
  map?: (row: T) => unknown;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** How date cells are displayed — matches {@link formatDate}, the dd-mm-yyyy the
 *  app shows on screen, so an export looks the same as the list it came from. */
const DATE_FMT = 'dd-mm-yyyy';

/**
 * Excel's day serial for a date, taken from its LOCAL calendar day so the cell
 * shows the same day the app does. Computed here rather than left to SheetJS:
 * its own Date→serial conversion drifts by a few seconds depending on the
 * server's timezone (10s on UTC+5:30), and that fractional part stops Excel's
 * "Date Filters" from matching whole days. Excel's epoch is 1899-12-30.
 */
function excelSerial(d: Date): number {
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/**
 * Reusable SheetJS wrapper for Excel import/export. Inject it into any controller
 * to add `GET .../export` and `POST .../import` endpoints in a couple of lines.
 */
@Injectable()
export class ExcelService {
  /** Build an .xlsx file (as a Buffer) from typed rows + a column spec. */
  export<T>(rows: T[], columns: ExcelColumn<T>[], opts: { sheetName?: string } = {}): Promise<Buffer> {
    const header = columns.map((c) => c.header);
    const body = rows.map((row) =>
      columns.map((col) => {
        const value = col.map ? col.map(row) : (row as Record<string, unknown>)[col.key as string];
        return value ?? '';
      }),
    );
    return this.aoaToBuffer([header, ...body], opts.sheetName);
  }

  /**
   * Build an .xlsx from an array of plain objects.
   *
   * Pass `headers` to guarantee the header row is always written — including the
   * exact column order and even when `rows` is empty. This keeps an export with
   * no data usable as a fill-in import template. Without `headers`, the object
   * keys become the headers (and an empty array yields an empty sheet).
   *
   * `headers` also RESTRICTS the sheet to exactly those keys. SheetJS's own
   * `header` option on `json_to_sheet` only reorders columns — any key on a row
   * that isn't listed still gets written, appended after the ones that are. A
   * caller asking for a 5-of-14-column export got all 14 back, the 5 just
   * pushed to the front. Every other caller here passes its row objects' full,
   * exact key set as `headers` anyway (for ordering, not restriction), so this
   * filter is a no-op for them and only changes behaviour for a genuine subset.
   */
  jsonToBuffer(
    rows: Record<string, unknown>[],
    opts: { sheetName?: string; headers?: string[] } = {},
  ): Promise<Buffer> {
    if (opts.headers && rows.length === 0) {
      return this.aoaToBuffer([opts.headers], opts.sheetName);
    }
    const restricted = opts.headers
      ? rows.map((row) => {
          const picked: Record<string, unknown> = {};
          for (const h of opts.headers!) picked[h] = row[h];
          return picked;
        })
      : rows;
    // cellDates keeps Date values as date cells instead of SheetJS converting
    // them to serials right here — stampDateCells() below needs to see them as
    // dates to give them a whole-day serial and the dd-mm-yyyy format.
    const worksheet = opts.headers
      ? XLSX.utils.json_to_sheet(restricted, { header: opts.headers, cellDates: true })
      : XLSX.utils.json_to_sheet(restricted, { cellDates: true });
    return this.workbookToBuffer(worksheet, opts.sheetName);
  }

  /** Build a header-only template file users can fill in and re-upload. */
  template(headers: string[], opts: { sheetName?: string } = {}): Promise<Buffer> {
    return this.aoaToBuffer([headers], opts.sheetName);
  }

  /** Parse an uploaded spreadsheet (first sheet by default) into objects. */
  parse<T = Record<string, unknown>>(file: Buffer, opts: { sheet?: string } = {}): T[] {
    const workbook = XLSX.read(file, { type: 'buffer', cellDates: true });
    const sheetName = opts.sheet ?? workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) return [];
    return XLSX.utils.sheet_to_json<T>(worksheet, { defval: null, raw: false });
  }

  /** Set the response headers for an .xlsx download. */
  setDownloadHeaders(res: Response, baseName: string): void {
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': XLSX_MIME,
      'Content-Disposition': `attachment; filename="${baseName}-${stamp}.xlsx"`,
    });
  }

  private aoaToBuffer(aoa: unknown[][], sheetName?: string): Promise<Buffer> {
    const worksheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    return this.workbookToBuffer(worksheet, sheetName);
  }

  /* ── Writing ───────────────────────────────────────────────────────────
     Sheets are BUILT with SheetJS (its json_to_sheet column ordering and
     restriction are what every caller relies on) and WRITTEN with ExcelJS,
     which is the only one of the two that can set a font. The community
     build of SheetJS ignores cell styles entirely, which is why exports
     used to arrive in Calibri 11 only by accident of Excel's default and
     with no header, widths or borders at all. */

  /** House look for every export in the app. */
  private static readonly FONT = 'Calibri';
  private static readonly SIZE = 11;
  /** The navy the app's own grid headers use. */
  private static readonly HEADER_BG = 'FF163E64';
  private static readonly ZEBRA_BG = 'FFF5F7FA';
  private static readonly GRID = 'FFD9DEE5';

  private async workbookToBuffer(worksheet: XLSX.WorkSheet, sheetName = 'Sheet1'): Promise<Buffer> {
    // Back to a plain grid, values intact — numbers as numbers, dates as Dates
    // (the sheet was built with cellDates), so Excel gets real types.
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: true, defval: null, blankrows: false });
    const [header = [], ...body] = aoa;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'OMS';
    wb.created = new Date();
    const ws = wb.addWorksheet(sheetName, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.addRow(header as unknown[]);
    for (const r of body) ws.addRow(r as unknown[]);

    const cols = Math.max(header.length, ...body.map((r) => (r as unknown[]).length), 1);
    const thin = { style: 'thin' as const, color: { argb: ExcelService.GRID } };

    // Header — navy, white, bold, and filterable.
    const head = ws.getRow(1);
    head.height = 22;
    head.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: ExcelService.FONT, size: ExcelService.SIZE, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ExcelService.HEADER_BG } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      cell.border = { top: thin, left: thin, bottom: thin, right: thin };
    });
    if (cols > 0 && body.length > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } };
    }

    // Body — one font, real number and date formats, quiet zebra.
    for (let i = 0; i < body.length; i++) {
      const row = ws.getRow(i + 2);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: ExcelService.FONT, size: ExcelService.SIZE };
        cell.border = { top: thin, left: thin, bottom: thin, right: thin };
        if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ExcelService.ZEBRA_BG } };
        const v = cell.value;
        if (v instanceof Date) {
          /*
           * Written as a whole-day SERIAL, not as a Date.
           *
           * ExcelJS serialises a Date in UTC, and these are local midnight — so
           * 11-08-2026 in IST went into the file as 2026-08-10T18:30Z and Excel
           * showed the 10th. Every exported date was a day early. The serial is
           * taken from the local calendar day, which also keeps whole-day values
           * so Excel's Date Filters match (see excelSerial).
           */
          cell.value = excelSerial(v);
          cell.numFmt = DATE_FMT;
          cell.alignment = { horizontal: 'center' };
        } else if (typeof v === 'number') {
          // Whole numbers keep their shape (a challan count is not 42.00);
          // anything with paise is shown to two places.
          cell.numFmt = Number.isInteger(v) ? '#,##0' : '#,##0.00';
          cell.alignment = { horizontal: 'right' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'top' };
        }
      });
    }

    // Widths from the widest cell in each column, within sane bounds.
    for (let c = 1; c <= cols; c++) {
      let width = String(header[c - 1] ?? '').length + 4;
      for (const r of body) {
        const v = (r as unknown[])[c - 1];
        const len = v instanceof Date ? 12 : String(v ?? '').length + 2;
        if (len > width) width = len;
      }
      ws.getColumn(c).width = Math.max(10, Math.min(45, width));
    }

    // ExcelJS types this as its own Buffer alias; the value is a real Node Buffer.
    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  }
}
