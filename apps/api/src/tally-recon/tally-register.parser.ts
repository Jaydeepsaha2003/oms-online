import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';

/**
 * Reads a Tally "Group Outstanding / Ledger register" export (Sundry Debtors).
 *
 * The export repeats a small block per party:
 *
 *   Ledger:  | AARTI STEELS | 1-Apr-26 to 31-Mar-27 …
 *   Date | Particulars | Particulars | Vch Type | Vch No. | Debit | Credit
 *   1-Apr-26 | To | Opening Balance | Opening Balance | Opening Balance | 49667
 *   2-Apr-26 | To | SALES          | Sales   | SSS-13/26-27 | 48753 |
 *   7-Apr-26 | By | AXIS BANK LTD  | Receipt | 11           |       | 49667
 *            | To | Closing Balance …
 *
 * Two sheets usually ship together: a detailed one that explodes each voucher
 * into its GST/round-off sub-lines, and a condensed one with a single row per
 * voucher. We want the condensed shape, so the sheet with a `Vch Type` column
 * closest to the left is preferred — the detailed sheet pads several merged
 * "Particulars" columns in front of it.
 *
 * Everything here is defensive: a Tally export's column positions shift with the
 * merged-cell layout, and the totals rows at the foot of each block repeat the
 * figures across every column, which is why rows are only accepted when the
 * `Vch Type` cell holds a value Tally actually uses.
 */

/** Voucher types Tally writes into a debtors register. */
const KNOWN_VCH = new Set(['Sales', 'Receipt', 'Purchase', 'Journal', 'Credit Note', 'Debit Note', 'Payment', 'Contra']);

export interface ParsedVoucher {
  ledgerName: string;
  /** Midnight-normalised. */
  txnDate: Date;
  /** 'To' (debit side) or 'By' (credit side) as Tally prints it. */
  drCr: string;
  particulars: string;
  vchType: string;
  vchNo: string;
  debit: number;
  credit: number;
}

export interface ParsedLedger {
  ledgerName: string;
  /** Signed opening as Tally states it: + = Dr (party owes), − = Cr. */
  openingNet: number | null;
  openingDate: Date | null;
  vouchers: ParsedVoucher[];
}

export interface ParsedRegister {
  fromDate: Date;
  toDate: Date;
  ledgers: ParsedLedger[];
}

/* ── cell readers ─────────────────────────────────────────────────────────── */

function text(row: ExcelJS.Row, col: number): string {
  const v = row.getCell(col).value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: string };
    if (o.richText) return o.richText.map((t) => t.text).join('').trim();
    if (o.result !== undefined) return String(o.result).trim();
    if (o.text) return String(o.text).trim();
    return '';
  }
  return String(v).trim();
}

function amount(row: ExcelJS.Row, col: number): number | null {
  const v = row.getCell(col).value;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') {
    const r = (v as { result?: unknown }).result;
    if (typeof r === 'number') return r;
  }
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Parses both what ExcelJS hands back as a real Date and Tally's `1-Apr-26`. */
function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const tally = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(raw.trim());
  if (tally) {
    const mi = MONTHS.indexOf(tally[2].toLowerCase());
    if (mi < 0) return null;
    let y = Number(tally[3]);
    if (y < 100) y += 2000;
    return new Date(y, mi, Number(tally[1]));
  }
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return null;
}

/** "1-Apr-26 to 31-Mar-27" → the two ends. */
function parsePeriod(s: string): { from: Date; to: Date } | null {
  const m = /(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s*to\s*(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i.exec(s);
  if (!m) return null;
  const from = parseDate(m[1]);
  const to = parseDate(m[2]);
  return from && to ? { from, to } : null;
}

/* ── sheet selection ──────────────────────────────────────────────────────── */

/** Column index of the `Vch Type` heading on a sheet, or 0 when it has none. */
function vchTypeColumn(ws: ExcelJS.Worksheet): number {
  let found = 0;
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (found) return;
    for (let c = 1; c <= Math.max(ws.columnCount, 20); c += 1) {
      if (/^vch\s*type$/i.test(text(row, c))) {
        found = c;
        return;
      }
    }
  });
  return found;
}

/* ── the parse ────────────────────────────────────────────────────────────── */

export async function parseTallyRegister(buffer: Buffer, fileName: string): Promise<ParsedRegister> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException(`"${fileName}" isn't a readable .xlsx workbook.`);
  }

  // Prefer the condensed sheet: its Vch Type column sits furthest left because
  // the detailed sheet pads merged Particulars columns ahead of it.
  const candidates = wb.worksheets
    .map((ws) => ({ ws, col: vchTypeColumn(ws) }))
    .filter((c) => c.col > 0)
    .sort((a, b) => a.col - b.col);
  if (!candidates.length) {
    throw new BadRequestException('No Tally register found in this workbook — no sheet has a "Vch Type" column.');
  }
  const { ws, col: vchCol } = candidates[0];
  // Layout is fixed relative to Vch Type: … | Vch Type | Vch No. | Debit | Credit
  const noCol = vchCol + 1;
  const drCol = vchCol + 2;
  const crCol = vchCol + 3;

  let period: { from: Date; to: Date } | null = null;
  const ledgers: ParsedLedger[] = [];
  let cur: ParsedLedger | null = null;
  let inBlock = false;

  ws.eachRow({ includeEmpty: false }, (row) => {
    const c1 = text(row, 1);
    const c2 = text(row, 2);

    // The period appears in the page header and again beside each ledger name.
    if (!period) {
      for (let c = 1; c <= crCol + 1; c += 1) {
        const p = parsePeriod(text(row, c));
        if (p) {
          period = p;
          break;
        }
      }
    }

    if (/^ledger:?$/i.test(c1)) {
      cur = { ledgerName: c2, openingNet: null, openingDate: null, vouchers: [] };
      ledgers.push(cur);
      inBlock = false;
      return;
    }
    if (/^date$/i.test(c1)) {
      inBlock = true;
      return;
    }
    if (!cur || !inBlock) return;

    const particulars = text(row, 3);
    const vchType = text(row, vchCol);

    if (/opening balance/i.test(particulars)) {
      // Tally prints the opening in whichever of the money columns matches its
      // side; a Dr opening lands left of a Cr one. Scan from Debit rightwards.
      const dr = amount(row, drCol);
      const crRaw = amount(row, crCol);
      // With merged cells the figure can also sit one column early.
      const early = amount(row, drCol - 1);
      const side = (c2 || '').toLowerCase();
      const val = dr ?? crRaw ?? early ?? null;
      if (val != null) {
        // 'To' = Dr (party owes us) → positive. 'By' = Cr → negative.
        cur.openingNet = side.startsWith('by') ? -Math.abs(val) : Math.abs(val);
        cur.openingDate = parseDate(c1);
      }
      return;
    }
    if (/closing balance/i.test(particulars)) return;
    // Totals rows at the foot of a block repeat figures across every column, so
    // only a recognised Vch Type marks a real voucher.
    if (!KNOWN_VCH.has(vchType)) return;

    const txnDate = parseDate(c1);
    if (!txnDate) return;

    cur.vouchers.push({
      ledgerName: cur.ledgerName,
      txnDate,
      drCr: c2,
      particulars,
      vchType,
      vchNo: text(row, noCol),
      debit: amount(row, drCol) ?? 0,
      credit: amount(row, crCol) ?? 0,
    });
  });

  const withContent = ledgers.filter((l) => l.ledgerName && (l.vouchers.length || l.openingNet != null));
  if (!withContent.length) {
    throw new BadRequestException('That register has no ledger entries in it.');
  }
  if (!period) {
    // Fall back to the span of the data itself.
    const dates = withContent.flatMap((l) => l.vouchers.map((v) => v.txnDate.getTime()));
    if (!dates.length) throw new BadRequestException('Could not determine the period this register covers.');
    period = { from: new Date(Math.min(...dates)), to: new Date(Math.max(...dates)) };
  }

  return { fromDate: period.from, toDate: period.to, ledgers: withContent };
}

/**
 * Tally numbers a sales invoice `SSS-13/26-27`; OMS stores the same document as
 * `SSS/26-27/13`. Returns the candidate OMS codes to try, widest first, because
 * some OMS serials are zero-padded (`SSS/26-27/01`).
 */
export function omsCodeCandidates(tallyVchNo: string): string[] {
  const m = /^([A-Za-z]+)\s*-\s*(\d+)\s*\/\s*(\d{2}-\d{2})$/.exec(tallyVchNo.trim());
  if (!m) return [];
  const [, prefix, serial, fy] = m;
  const p = prefix.toUpperCase();
  const out = [`${p}/${fy}/${serial}`];
  const n = Number(serial);
  for (const width of [2, 3]) {
    const padded = String(n).padStart(width, '0');
    if (padded !== serial) out.push(`${p}/${fy}/${padded}`);
  }
  return out;
}

/** Maps Tally's voucher wording onto the reconciliation's own vocabulary. */
export function reconVchType(vchType: string, particulars: string): string {
  const v = vchType.trim().toLowerCase();
  if (v === 'sales') return 'SALES';
  if (v === 'receipt') return 'RECEIPT';
  if (v === 'credit note') return 'CREDIT NOTE';
  if (v === 'debit note') return 'DEBIT NOTE';
  // Tally posts a sales discount as a Journal whose particulars say DISCOUNT.
  if (v === 'journal' && /discount/i.test(particulars)) return 'DISCOUNT';
  return 'OTHER';
}
