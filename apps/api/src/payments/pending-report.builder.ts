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
 * Receive Payment's "Pending Invoices" export.
 *
 * Formatted here for the same reason the challan reports are: the browser copy
 * used SheetJS, which cannot write a font, a fill or a border in its free
 * build, so the file arrived as a bare grid.
 *
 * The ROWS are computed by the caller rather than re-derived here, because this
 * report shows the allocation the user is composing ON SCREEN — the ADJ AMT
 * column is unsaved working, not something a query could reproduce. The server
 * formats exactly what was on the screen; it does not second-guess the figures.
 */

export interface PendingReportRow {
  invDate: string | null;
  invNo: string;
  customerName: string;
  transaction: string;
  dueDate: string | null;
  dueType: string;
  /** Outstanding on the chosen leg. */
  amt: number;
  /** What this voucher would put against it. */
  adj: number;
  /** What would remain. */
  bal: number;
  dueDays: string;
}

export interface PendingReportInput {
  owner: string;
  ownerKind: 'Party' | 'Agent';
  payMode: string;
  asOf: string;
  /** Which leg the AMT column shows. */
  bucket: 'BANK' | 'CASH';
  /** Agent vouchers span several parties, so the name earns a column. */
  showParty: boolean;
  rows: PendingReportRow[];
}

export async function buildPendingInvoicesReport(input: PendingReportInput): Promise<Buffer> {
  const { rows, showParty, bucket } = input;
  const headers = [
    '#',
    'Inv Date',
    'Inv No',
    ...(showParty ? ['Party Name'] : []),
    'Transaction',
    'Due Date',
    'Status',
    `${bucket} Amt (₹)`,
    'Adj Amt (₹)',
    'Bal Amt (₹)',
    'Due Days',
  ];
  const cols = headers.length;
  /*
   * Column numbers come from the headers themselves.
   *
   * They shift when the Party column appears, and computing that shift by hand
   * put TOTAL under Amt and money formatting on Due Days. Looking the column up
   * by its title cannot drift when the layout changes again.
   */
  const at = (name: string) => headers.findIndex((h) => h === name) + 1;
  const amtCol = at(`${bucket} Amt (₹)`);
  const adjCol = at('Adj Amt (₹)');
  const balCol = at('Bal Amt (₹)');
  const moneyCols = [amtCol, adjCol, balCol];
  const dateCols = [at('Inv Date'), at('Due Date')];

  const wb = newWorkbook();
  const ws = wb.addWorksheet('Pending Invoices', { views: [{ state: 'frozen', ySplit: 8 }] });

  addTitle(ws, cols, 'PENDING INVOICES');
  addMetaBlock(
    ws,
    cols,
    [
      [input.ownerKind, input.owner],
      ['Payment Mode', input.payMode || '—'],
      ['As of', input.asOf],
      ['Showing', `${bucket} outstanding`],
    ],
    `Generated ${new Date().toLocaleString('en-IN')}   ·   ${rows.length} invoice(s)`,
  );
  ws.addRow([]); // spacer, row 7
  ws.addRow(headers); // row 8
  styleHeader(ws, 8, cols);

  rows.forEach((r, i) => {
    ws.addRow([
      i + 1,
      asDate(r.invDate),
      r.invNo,
      ...(showParty ? [r.customerName] : []),
      r.transaction,
      asDate(r.dueDate),
      r.dueType,
      r.amt,
      r.adj,
      r.bal,
      r.dueDays,
    ]);
  });
  styleBody(ws, 9, 8 + rows.length, cols, moneyCols, dateCols);

  const sum = (pick: (r: PendingReportRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const total: (string | number)[] = new Array(cols).fill('');
  // `at()` is 1-based, the array is 0-based.
  total[at('Inv No') - 1] = `${rows.length} invoice(s)`;
  total[at('Status') - 1] = 'TOTAL';
  total[amtCol - 1] = sum((r) => r.amt);
  total[adjCol - 1] = sum((r) => r.adj);
  total[balCol - 1] = sum((r) => r.bal);
  addTotalRow(ws, cols, total, moneyCols);

  if (rows.length) ws.autoFilter = { from: { row: 8, column: 1 }, to: { row: 8, column: cols } };
  fitColumns(ws, 8, cols, 8);
  ws.getColumn(1).width = 6;
  return toBuffer(wb);
}
