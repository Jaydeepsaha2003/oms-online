/**
 * Client-side Excel report builders for the Challans list "Get Report by" menu.
 * Ports the legacy ViewChallan exports (PictureBox1 = Detailed / current view,
 * PictureBox2 = Challan Summary = challans + their line items) to SheetJS so the
 * whole thing runs in-browser with no server round-trip.
 */
import * as XLSX from 'xlsx';
import type { ChallanDto } from '@oms/shared';
import { dateStamp } from '@/lib/utils';

/** Filter context shown in the report header block. */
export interface ReportMeta {
  status: string;
  dateRange: string;
  search: string;
  category: string;
}

const MONEY_FMT = '₹ #,##0';
const DATE_FMT = 'dd-mmm-yyyy';

const asDate = (iso: string | null): Date | '' => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d;
};

/** DUE / OVER DUE text relative to today (mirrors the list's Due column). */
function dueText(due: string | null): string {
  if (!due) return '—';
  const d = new Date(due);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  return days < 0 ? `${Math.abs(days)} over` : `${days} left`;
}

/** A worksheet cell carrying an explicit type + number format. */
type Cell = XLSX.CellObject;
const txt = (v: string): Cell => ({ t: 's', v });
const num = (v: number | null, z?: string): Cell => ({ t: 'n', v: v ?? 0, z });
const dat = (v: Date | '', z = DATE_FMT): Cell => (v === '' ? txt('') : { t: 'd', v, z });

/** Build the shared "Challans" sheet (title + meta block + the list table). */
function buildChallansSheet(rows: ChallanDto[], meta: ReportMeta, title: string): XLSX.WorkSheet {
  const headers = ['Date', 'Challan No', 'Party', 'Category', 'B', 'C', 'GST', 'TDS', 'Total', 'Due', 'Status', 'Remarks'];
  const lastCol = headers.length - 1;

  const aoa: Cell[][] = [
    [txt(title)],
    [txt('Status:'), txt(meta.status)],
    [txt('Category:'), txt(meta.category)],
    [txt('Date Range:'), txt(meta.dateRange)],
    [txt('Search:'), txt(meta.search)],
    [txt(`Generated: ${new Date().toLocaleString('en-IN')}   ·   ${rows.length} challan(s)`)],
    [], // spacer (report row 7)
    headers.map(txt),
    ...rows.map((r): Cell[] => [
      dat(asDate(r.invDate)),
      txt(r.code),
      txt(r.customerName),
      txt(r.category ?? '—'),
      num(r.b, MONEY_FMT),
      num(r.c, MONEY_FMT),
      num(r.tax, MONEY_FMT),
      num(r.tds, MONEY_FMT),
      num(r.total, MONEY_FMT),
      txt(dueText(r.dueDate)),
      txt(r.challanStatus),
      txt(r.remarks ?? ''),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } }, // title spans all columns
    { s: { r: 5, c: 0 }, e: { r: 5, c: lastCol } }, // generated line
  ];
  ws['!cols'] = [
    { wch: 13 }, // Date
    { wch: 18 }, // Challan No
    { wch: 26 }, // Party
    { wch: 12 }, // Category
    { wch: 13 }, // B
    { wch: 13 }, // C
    { wch: 11 }, // GST
    { wch: 11 }, // TDS
    { wch: 14 }, // Total
    { wch: 10 }, // Due
    { wch: 11 }, // Status
    { wch: 30 }, // Remarks
  ];
  ws['!freeze'] = { xSplit: 0, ySplit: 8 };
  return ws;
}

/** Build the "Challan Items" sheet: one row per line across all challans. */
function buildItemsSheet(rows: ChallanDto[]): XLSX.WorkSheet {
  const headers = ['InvDate', 'Challan No', 'Party', 'Product Name', 'Design', 'BAGS', 'PCS', 'KGS', 'BOX', 'Unit', 'Price', 'Amount', 'P.Category', 'Comment'];
  const body: Cell[][] = [];
  for (const c of rows) {
    const d = asDate(c.invDate);
    for (const it of c.items ?? []) {
      body.push([
        dat(d),
        txt(c.code),
        txt(c.customerName),
        txt(it.productName ?? ''),
        txt(it.design ?? ''),
        num(it.bags),
        num(it.pcs),
        num(it.kgs),
        num(it.box),
        txt(it.unit ?? ''),
        num(it.price, MONEY_FMT),
        num(it.amount, MONEY_FMT),
        txt(it.pCategory ?? ''),
        txt(it.comment ?? ''),
      ]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet([headers.map(txt), ...body], { cellDates: true });
  ws['!cols'] = [
    { wch: 13 }, { wch: 18 }, { wch: 24 }, { wch: 22 }, { wch: 16 },
    { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 8 }, { wch: 8 },
    { wch: 11 }, { wch: 13 }, { wch: 12 }, { wch: 26 },
  ];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  return ws;
}

/** Detailed View (legacy "Current View") — a single "Challans" sheet. */
export function exportDetailedReport(rows: ChallanDto[], meta: ReportMeta): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildChallansSheet(rows, meta, 'SALES CHALLANS REPORT (Detailed View)'), 'Challans');
  XLSX.writeFile(wb, `Challans-Detailed-${dateStamp()}.xlsx`);
}

/** Challan Summary — "Challans" sheet + a "Challan Items" sheet. */
export function exportSummaryReport(rows: ChallanDto[], meta: ReportMeta): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildChallansSheet(rows, meta, 'SALES CHALLANS REPORT (Summary)'), 'Challans');
  XLSX.utils.book_append_sheet(wb, buildItemsSheet(rows), 'Challan Items');
  XLSX.writeFile(wb, `Challans-Summary-${dateStamp()}.xlsx`);
}
