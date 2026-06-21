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
   */
  jsonToBuffer(
    rows: Record<string, unknown>[],
    opts: { sheetName?: string; headers?: string[] } = {},
  ): Buffer {
    if (opts.headers && rows.length === 0) {
      return this.aoaToBuffer([opts.headers], opts.sheetName);
    }
    const worksheet = opts.headers
      ? XLSX.utils.json_to_sheet(rows, { header: opts.headers })
      : XLSX.utils.json_to_sheet(rows);
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
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    return this.workbookToBuffer(worksheet, sheetName);
  }

  private workbookToBuffer(worksheet: XLSX.WorkSheet, sheetName = 'Sheet1'): Buffer {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}
