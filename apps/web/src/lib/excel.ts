/**
 * Client-side Excel helpers (SheetJS). Use these for instant in-browser export
 * of data you already have, and to parse user-uploaded spreadsheets before
 * sending the rows to the API. For server-generated exports, use
 * `downloadFile()` from `@/lib/api`.
 */
import * as XLSX from 'xlsx';
import { dateStamp } from './utils';

export interface ExcelColumn<T> {
  header: string;
  key: keyof T | string;
  map?: (row: T) => unknown;
}

/** Build and download an .xlsx from typed rows + a column spec. */
export function exportToExcel<T>(
  rows: T[],
  columns: ExcelColumn<T>[],
  filename = 'export',
  sheetName = 'Sheet1',
): void {
  const header = columns.map((c) => c.header);
  const body = rows.map((row) =>
    columns.map((col) => {
      const value = col.map ? col.map(row) : (row as Record<string, unknown>)[col.key as string];
      return value ?? '';
    }),
  );
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${filename}-${dateStamp()}.xlsx`);
}

/** Download a header-only template the user can fill in and re-upload. */
export function downloadTemplate(headers: string[], filename = 'template'): void {
  const worksheet = XLSX.utils.aoa_to_sheet([headers]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

/** Parse an uploaded spreadsheet file into an array of row objects. */
export function parseExcelFile<T = Record<string, unknown>>(
  file: File,
  opts: { sheet?: string } = {},
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        /*
         * `raw: true` is load-bearing, not tidiness.
         *
         * Without it SheetJS type-guesses every CSV cell, and on an Indian
         * statement that means reading dd-mm-yyyy as MM-DD-YYYY: "01-04-2026"
         * (1 April) became the Date 4 January and was reprinted "1/4/26", while
         * "27-08-2026" survived untouched because month 27 does not exist. On
         * the file this was found with, 214 of 577 dates were rewritten and 363
         * were not. It happened to come out right only because our own parser
         * reads d/m and the two swaps cancelled — a coincidence of SheetJS's
         * output format, not a guarantee, and silently a month wrong the day
         * that format changes.
         *
         * With `raw` the grid holds exactly what the file holds, and
         * `parseStatementDate` is the only thing that interprets it. Verified
         * to change nothing in a real .xlsx (dates there are typed cells, which
         * `cellDates` still resolves).
         */
        const workbook = XLSX.read(data, { type: 'array', cellDates: true, raw: true });
        const sheetName = opts.sheet ?? workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        resolve(XLSX.utils.sheet_to_json<T>(worksheet, { defval: null, raw: false }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Read a sheet as a raw grid, with no assumption that row 1 is the header.
 *
 * Bank statements open with a block of account details — the Axis export runs
 * to 19 lines of name, address, IFSC and a "Statement of Account" sentence
 * before the column titles. `parseExcelFile` would take the first of those as
 * the header and produce a column called "Name :- S.S. STEEL", leaving nothing
 * to map. Callers get the grid and decide for themselves where the table starts.
 */
export function parseSheetGrid(file: File, opts: { sheet?: string } = {}): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = opts.sheet ?? workbook.SheetNames[0];
        const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
          header: 1,
          defval: null,
          raw: false,
          blankrows: false,
        });
        resolve(grid.map((r) => (r ?? []).map((c) => (c == null ? '' : String(c).trim()))));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * The row that looks like column titles.
 *
 * Scored rather than pattern-matched to one bank: the header is the row with
 * the most cells that read like a column name AND that is followed by rows of
 * a similar width. Returns 0 when nothing looks like a header, which is the
 * right answer for a plain export whose first row already is one.
 */
export function detectHeaderRow(grid: string[][]): number {
  const WORDS = /^(tran(saction)?\s*date|value\s*date|date|particulars?|narration|description|remarks?|details?|chq|cheque|chq\s*no|ref(erence)?(\s*no)?|withdrawal|deposit|debit|credit|dr|cr|balance|bal|amount|sol|branch|utr)$/i;
  let best = { row: 0, score: 0 };
  const limit = Math.min(grid.length, 40);
  for (let i = 0; i < limit; i++) {
    const cells = grid[i].filter((c) => c !== '');
    if (cells.length < 3) continue;
    const hits = cells.filter((c) => WORDS.test(c.replace(/[.\s]+$/, ''))).length;
    // Needs to look like titles AND have a table under it.
    const below = grid[i + 1]?.filter((c) => c !== '').length ?? 0;
    if (hits >= 3 && below >= 3 && hits > best.score) best = { row: i, score: hits };
  }
  return best.row;
}

/** Turn a grid into row objects using `headerRow` as the column titles. */
export function gridToRows(grid: string[][], headerRow: number): { columns: string[]; rows: Record<string, string | null>[] } {
  const raw = grid[headerRow] ?? [];
  // Blank titles still hold data in some exports, so they are kept and named by
  // position rather than dropped — an unnamed column the user can still map.
  const columns = raw.map((c, i) => (c ? c : `Column ${i + 1}`));
  const rows = grid.slice(headerRow + 1).map((r) => {
    const o: Record<string, string | null> = {};
    columns.forEach((c, i) => {
      o[c] = r[i] ?? null;
    });
    return o;
  });
  return { columns, rows };
}
