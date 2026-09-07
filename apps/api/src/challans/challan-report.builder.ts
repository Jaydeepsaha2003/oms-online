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
  agent: string;
  dateRange: string;
  search: string;
}

/** Is this challan row actually a debit note? They share the table — see the
 *  note types in @oms/shared for why. */
export const isDebitNote = (r: ChallanDto): boolean =>
  (r.transaction ?? '').trim().toUpperCase() === 'DEBIT NOTE';

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

/**
 * Everything a challan weighs, added up off its own lines.
 *
 * The challan row itself carries no weight — only the items do — so this is a
 * sum, not a field. EVERY line counts, including those priced by the piece: the
 * question is what left the building, and a Pcs line still has a weight. (The
 * printed bill can hide the Kgs on a Pcs line, which is a decision about that
 * document, not about the goods.)
 */
const totalKgs = (c: ChallanDto): number =>
  Math.round((c.items ?? []).reduce((s, it) => s + (it.kgs ?? 0), 0) * 100) / 100;

/** The "Challans" sheet — title, the filters it was run with, then the table. */
function addChallansSheet(wb: ExcelJS.Workbook, rows: ChallanDto[], meta: ChallanReportMeta, title: string): void {
  const headers = ['Date', 'Challan No', 'Party', 'Category', 'Billing Rate (₹)', 'Total Kgs', 'B (₹)', 'C (₹)', 'GST (₹)', 'TDS (₹)', 'Total (₹)', 'Due', 'Status', 'Remarks'];
  const cols = headers.length;
  /*
   * The header row is computed, not counted.
   *
   * These were all the literal 8 that four meta rows happened to produce, so
   * adding a fifth (Agent) slid the table one row down while the styling,
   * the freeze and the autofilter stayed pointing at the old line.
   */
  const ws = wb.addWorksheet('Challans');

  addTitle(ws, cols, title);
  const headerRow = addMetaBlock(
    ws,
    cols,
    [
      ['Status', meta.status],
      ['Category', meta.category],
      ['Agent', meta.agent],
      ['Date Range', meta.dateRange],
      ['Search', meta.search],
    ],
    `Generated ${new Date().toLocaleString('en-IN')}   ·   ${rows.length} challan(s)`,
  );
  ws.addRow([]); // spacer between the meta block and the table
  ws.addRow(headers);
  ws.views = [{ state: 'frozen', ySplit: headerRow }];
  styleHeader(ws, headerRow, cols);

  for (const r of rows) {
    ws.addRow([
      asDate(r.invDate),
      r.code,
      r.customerName,
      r.category ?? '—',
      /*
       * The party's billing rate as it stood when this challan was raised —
       * snapshotted onto the challan, not read back off the customer master, so
       * an old bill keeps the rate it was actually billed at.
       *
       * Blank, never 0, when the challan carries none. Roughly a third of them
       * don't, and a zero in a money column reads as "billed at nothing" rather
       * than "not recorded".
       */
      r.billingRate ?? '',
      totalKgs(r),
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
  /*
   * The two-decimal, right-aligned columns — `styleBody` calls them money, and
   * Total Kgs is in the list because it wants exactly that format, not because
   * it is money. Kgs are fractional on most lines (3,408 of 4,246 items here),
   * and the default whole-number format for a numeric column would round the
   * weight away.
   */
  const money = [5, 6, 7, 8, 9, 10, 11];
  styleBody(ws, headerRow + 1, headerRow + rows.length, cols, money, [1]);

  /*
   * Rounded to paise/grams, because the raw float sum is not.
   *
   * Adding 2,041 weights gave a total row holding 307203.7000000005. Excel's
   * own format displays that as 307,203.70, so the sheet looked right — but the
   * value stored in the cell was the noisy one, and it surfaces the moment
   * anyone widens the decimals or copies the figure out.
   */
  const sum = (pick: (r: ChallanDto) => number | null | undefined) =>
    Math.round(rows.reduce((s, r) => s + (pick(r) ?? 0), 0) * 100) / 100;
  addTotalRow(
    ws,
    cols,
    /*
     * Billing Rate is left blank on purpose: it is a rate per Kg, so a column
     * sum would be a meaningless figure and an unweighted mean across different
     * parties a misleading one.
     *
     * Total Kgs IS summed — weight across a set of challans is a real quantity,
     * and "how many Kgs went out this month" is the question the column invites.
     */
    ['', '', `${rows.length} challan(s)`, 'TOTAL', '', sum(totalKgs), sum((r) => r.b), sum((r) => r.c), sum((r) => r.tax), sum((r) => r.tds), sum((r) => r.total), '', '', ''],
    money,
  );

  if (rows.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: cols } };
  fitColumns(ws, headerRow, cols);
}

/**
 * One debit or credit note, as its sheet needs it.
 *
 * A shape of its own rather than a ChallanDto, even though a debit note IS
 * stored as a challan: a credit note is not, and the two have to arrive at the
 * same sheet builder. Everything either kind actually carries, and nothing it
 * doesn't — a note has no Due or TDS in the sense the challan list means them,
 * and columns of blanks are worse than columns that aren't there.
 */
export interface NoteReportRow {
  code: string;
  invDate: string;
  customerName: string;
  category: string | null;
  billingRate: number | null;
  totalKgs: number;
  b: number;
  c: number;
  tax: number;
  total: number;
  /** The sale(s) the note refers to, off its item lines. Credit notes only —
   *  challan_items has no refInvNo column, so a debit note has none to give. */
  refInvNos: string;
  remarks: string | null;
}

/**
 * A "Debit Notes" / "Credit Notes" sheet.
 *
 * Its own sheet, not extra rows on the Challans one, because the money runs the
 * other way: a credit note REDUCES what a party owes, and a TOTAL row that
 * added it to a column of sales would report a figure that is true of nothing.
 * Each sheet totals only its own kind.
 */
function addNotesSheet(wb: ExcelJS.Workbook, rows: NoteReportRow[], title: string, withRef: boolean): void {
  const headers = [
    'Date',
    'Note No',
    'Party',
    'Category',
    'Billing Rate (₹)',
    'Total Kgs',
    'B (₹)',
    'C (₹)',
    'GST (₹)',
    'Total (₹)',
    ...(withRef ? ['Ref Inv'] : []),
    'Remarks',
  ];
  const cols = headers.length;
  const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(headers);
  styleHeader(ws, 1, cols);

  for (const r of rows) {
    ws.addRow([
      asDate(r.invDate),
      r.code,
      r.customerName,
      r.category ?? '—',
      r.billingRate ?? '',
      r.totalKgs,
      r.b,
      r.c,
      r.tax,
      r.total,
      ...(withRef ? [r.refInvNos] : []),
      r.remarks ?? '',
    ]);
  }
  // Same two-decimal columns as the Challans sheet: rate, weight and the money.
  const money = [5, 6, 7, 8, 9, 10];
  styleBody(ws, 2, 1 + rows.length, cols, money, [1]);

  const sum = (pick: (r: NoteReportRow) => number) =>
    Math.round(rows.reduce((a, r) => a + pick(r), 0) * 100) / 100;
  addTotalRow(
    ws,
    cols,
    [
      '',
      '',
      `${rows.length} note(s)`,
      'TOTAL',
      '',
      sum((r) => r.totalKgs),
      sum((r) => r.b),
      sum((r) => r.c),
      sum((r) => r.tax),
      sum((r) => r.total),
      ...(withRef ? [''] : []),
      '',
    ],
    money,
  );
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } };
  fitColumns(ws, 1, cols);
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

/** The notes to add, and therefore which ones to take OUT of the challan list. */
export interface ChallanReportNotes {
  /** Debit notes, when the user asked for them. Null = not asked for, and the
   *  DN rows then stay in the Challans sheet exactly as they always have. */
  debit: NoteReportRow[] | null;
  credit: NoteReportRow[] | null;
}

export async function buildChallanReport(
  rows: ChallanDto[],
  meta: ChallanReportMeta,
  kind: 'detailed' | 'summary',
  notes: ChallanReportNotes = { debit: null, credit: null },
): Promise<Buffer> {
  const wb = newWorkbook();
  /*
   * The two names are the wrong way round in the wire contract and stay that
   * way: `detailed` is the challan LIST and `summary` is the list WITH its line
   * items. The titles say what the file actually contains, matching the buttons.
   */
  const isItemised = kind === 'summary';
  /*
   * A debit note is stored IN the challan table, so it is already one of these
   * rows. Once it has a sheet of its own it comes out of this one — the same
   * document on two sheets, each with its own TOTAL, is how a figure gets
   * counted twice. Nothing is removed when the user didn't ask for the sheet.
   */
  const challans = notes.debit ? rows.filter((r) => !isDebitNote(r)) : rows;
  addChallansSheet(wb, challans, meta, isItemised ? 'SALES CHALLANS — DETAILED VIEW' : 'SALES CHALLANS — CHALLAN SUMMARY');
  if (isItemised) addItemsSheet(wb, challans);
  if (notes.debit) addNotesSheet(wb, notes.debit, 'Debit Notes', false);
  if (notes.credit) addNotesSheet(wb, notes.credit, 'Credit Notes', true);
  return toBuffer(wb);
}
