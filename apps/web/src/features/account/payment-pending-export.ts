/**
 * "Pending Invoices" Excel export for Account → Payment (legacy PendDownload).
 * Title + meta block, the pending grid, and a totals row — built with SheetJS.
 * Only built-in number formats are used (custom ₹ formats corrupt the file).
 */
import * as XLSX from 'xlsx';
import type { PendingInvoiceRow } from '@oms/shared';
import { dateStamp } from '@/lib/utils';

const MONEY_FMT = '#,##0';
const DATE_FMT = 'd-mmm-yy';

type Cell = XLSX.CellObject;
const txt = (v: string): Cell => ({ t: 's', v });
const num = (v: number, z = MONEY_FMT): Cell => ({ t: 'n', v, z });
const dat = (iso: string | null): Cell => {
  if (!iso) return txt('');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? txt('') : { t: 'd', v: d, z: DATE_FMT };
};

export interface PendingExportMeta {
  owner: string;
  ownerKind: 'Party' | 'Agent';
  payMode: string;
  asOf: string;
  /** Which bucket the AMT column shows (BANK or CASH). */
  bucket: 'BANK' | 'CASH';
  showParty: boolean;
  /** Live allocation preview per invNo (ADJ AMT column). */
  adjByInv: Map<string, number>;
}

export function exportPendingInvoices(rows: PendingInvoiceRow[], meta: PendingExportMeta): void {
  const headers = [
    '#',
    'INV DATE',
    'INV NO',
    ...(meta.showParty ? ['PARTY NAME'] : []),
    'TRANSACTION',
    'DUE DATE',
    'STATUS',
    `${meta.bucket} AMT (₹)`,
    'ADJ AMT (₹)',
    'BAL AMT (₹)',
    'DUE DAYS',
  ];
  const lastCol = headers.length - 1;

  let totAmt = 0;
  let totAdj = 0;
  let totBal = 0;
  const body: Cell[][] = rows.map((r, i) => {
    const amt = meta.bucket === 'BANK' ? r.bankBal : r.cashBal;
    const adj = meta.adjByInv.get(r.invNo) ?? 0;
    const bal = Math.max(0, amt - adj);
    totAmt += amt;
    totAdj += adj;
    totBal += bal;
    return [
      num(i + 1, '0'),
      dat(r.invDate),
      txt(r.invNo),
      ...(meta.showParty ? [txt(r.customerName)] : []),
      txt(r.transaction),
      dat(r.dueDate),
      txt(r.dueType),
      num(amt),
      num(adj),
      num(bal),
      txt(r.dueDays),
    ];
  });

  const aoa: Cell[][] = [
    [txt('PENDING INVOICES REPORT')],
    [txt(`${meta.ownerKind}:`), txt(meta.owner)],
    [txt('Payment Mode:'), txt(meta.payMode || '—')],
    [txt('As of:'), txt(meta.asOf)],
    [txt(`Generated: ${new Date().toLocaleString('en-IN')}   ·   ${rows.length} invoice(s)`)],
    [],
    headers.map(txt),
    ...body,
    [
      txt(`TOTAL (${rows.length} invoices)`),
      txt(''),
      txt(''),
      ...(meta.showParty ? [txt('')] : []),
      txt(''),
      txt(''),
      txt(''),
      num(totAmt),
      num(totAdj),
      num(totBal),
      txt(''),
    ],
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: lastCol } },
  ];
  ws['!cols'] = [
    { wch: 5 },
    { wch: 12 },
    { wch: 18 },
    ...(meta.showParty ? [{ wch: 26 }] : []),
    { wch: 15 },
    { wch: 12 },
    { wch: 11 },
    { wch: 14 },
    { wch: 13 },
    { wch: 13 },
    { wch: 11 },
  ];
  ws['!freeze'] = { xSplit: 0, ySplit: 7 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pending Invoices');
  const owner = meta.owner.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_').slice(0, 30);
  XLSX.writeFile(wb, `Pending_Invoices_${owner}-${dateStamp()}.xlsx`);
}
