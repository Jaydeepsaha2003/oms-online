import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
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
  export<T>(rows: T[], columns: ExcelColumn<T>[], opts: { sheetName?: string } = {}): Buffer {
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
  ): Buffer {
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
  template(headers: string[], opts: { sheetName?: string } = {}): Buffer {
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

  private aoaToBuffer(aoa: unknown[][], sheetName?: string): Buffer {
    const worksheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    return this.workbookToBuffer(worksheet, sheetName);
  }

  /**
   * Rewrite every Date-valued cell as a whole-day serial carrying a dd-mm-yyyy
   * format, so Excel treats the column as real dates.
   *
   * Exports used to hand SheetJS a preformatted "30-07-2025" STRING, which Excel
   * sorts character by character — i.e. by day of month, then month, then year.
   * That put 28-05-2026 above 30-06-2025 and made "sort oldest first" look
   * broken. Any caller that passes a real Date now gets a sortable, filterable
   * column for free; callers still passing strings are unaffected.
   */
  private stampDateCells(worksheet: XLSX.WorkSheet): void {
    for (const ref of Object.keys(worksheet)) {
      if (ref.startsWith('!')) continue;
      const cell = worksheet[ref] as XLSX.CellObject;
      if (cell?.t === 'd' && cell.v instanceof Date) {
        cell.t = 'n';
        cell.v = excelSerial(cell.v);
        cell.z = DATE_FMT;
        delete cell.w; // stale cached text from the old value
      }
    }
  }

  private workbookToBuffer(worksheet: XLSX.WorkSheet, sheetName = 'Sheet1'): Buffer {
    this.stampDateCells(worksheet);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}
