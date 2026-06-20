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
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
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
