import type ExcelJS from 'exceljs';
import type { ChallanDto } from '@oms/shared';
import {
  addMetaBlock,
  addTitle,
  addTotalRow,
  asDate,
  fitColumns,
  newWorkbook,
  styleBody,
  styleHeader,
  toBuffer,
} from '../excel/report-style';

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

/** The "Challans" sheet — title, the filters it was run with, then the table. */
function addChallansSheet(wb: ExcelJS.Workbook, rows: ChallanDto[], meta: ChallanReportMeta, title: string): void {
  const headers = ['Date', 'Challan No', 'Party', 'Category', 'B (₹)', 'C (₹)', 'GST (₹)', 'TDS (₹)', 'Total (₹)', 'Due', 'Status', 'Remarks'];
  const cols = headers.length;
  const ws = wb.addWorksheet('Challans', { views: [{ state: 'frozen', ySplit: 8 }] });

  addTitle(ws, cols, title);
  const headerRow = addMetaBlock(
    ws,
    cols,
    [
      ['Status', meta.status],
      ['Category', meta.category],
      ['Date Range', meta.dateRange],
      ['Search', meta.search],
    ],
    `Generated ${new Date().toLocaleString('en-IN')}   ·   ${rows.length} challan(s)`,
  );
  void headerRow; // the sheet is frozen at 8, which is where the block lands
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
  const wb = newWorkbook();
  /*
   * The two names are the wrong way round in the wire contract and stay that
   * way: `detailed` is the challan LIST and `summary` is the list WITH its line
   * items. The titles say what the file actually contains, matching the buttons.
   */
  const isItemised = kind === 'summary';
  addChallansSheet(wb, rows, meta, isItemised ? 'SALES CHALLANS — DETAILED VIEW' : 'SALES CHALLANS — CHALLAN SUMMARY');
  if (isItemised) addItemsSheet(wb, rows);
  return toBuffer(wb);
}
