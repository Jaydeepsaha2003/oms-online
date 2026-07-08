/**
 * Debit / Credit Note — ported from legacy DebitNote.vb + CreditNoteBrowserForm.vb.
 *
 * A **Debit Note** (mode DEBIT) increases what a customer owes. It is stored in the
 * `Challan` table (prefix='DN', transaction='DEBIT NOTE') so it naturally appears as
 * a pending debit, posts a DEBIT NOTE ledger row (bank/cash DEBIT) and auto squares
 * off against the party's (or agent's) advances FIFO.
 *
 * A **Credit Note** (mode CREDIT) reduces what a customer owes. It is stored in its
 * own `CreditNote` table (like the legacy InvTblR) so it never counts as a pending
 * sale, posts a CREDIT NOTE ledger row (bank/cash CREDIT) and clears the customer's
 * balance in order: opening balance → pending invoices FIFO → parks the remainder as
 * a party (or agent) advance. Re-saving silently reverses the prior postings first.
 *
 * `b` = BANK portion, `c` = CASH portion (same B/C split used across the app).
 */
import type { Paginated } from './common';

export const NOTE_MODES = ['DEBIT', 'CREDIT'] as const;
export type NoteMode = (typeof NOTE_MODES)[number];

/** Directory pay-mode filter (matches legacy CreditNoteBrowserForm). */
export const NOTE_PAY_MODES = ['ALL', 'BANK', 'CASH', 'BOTH'] as const;
export type NotePayMode = (typeof NOTE_PAY_MODES)[number];

/**
 * One historical sale line for the note's product picker — the last 12 months of
 * this customer's sold items (legacy LoadRecentSoldProductsIntoProductCombo).
 */
export interface RecentSoldRow {
  dispatchId: number;
  /** Original sale invoice number. */
  invNo: string;
  invDate: string;
  productName: string;
  design: string;
  bags: number;
  pcs: number;
  kgs: number;
  box: number;
  price: number;
  unit: string;
  /** GST% on the original sale (from the challan header). */
  gstRate: number;
  /** Product category (from the source dispatch) — drives the GST lookup. */
  pCategory: string;
}

/** One item line on a note (both DN and CN). */
export interface NoteItemInput {
  dispatchId?: number;
  /** Original sale invoice this line refers to (shown as "Ref Inv No"). */
  refInvNo?: string;
  productName: string;
  design?: string;
  bags?: number;
  pcs?: number;
  kgs?: number;
  box?: number;
  unit?: string;
  price?: number;
  amount?: number;
  pCategory?: string;
  comment?: string;
}

export interface NoteItemDto extends NoteItemInput {
  id: number;
}

/** Payload to create or re-save a Debit/Credit Note. */
export interface SaveNoteInput {
  mode: NoteMode;
  /** Voucher no (DN/n or CN/n). Sent on edit; omit on create to auto-number. */
  code?: string;
  /** yyyy-mm-dd. */
  invDate: string;
  customerId: number;
  customerName: string;
  billingAddress?: string;
  shippingAddress?: string;
  category?: string;
  paymentTerm?: number;
  transName?: string;
  /** Charges + rates carried on the header. */
  packing?: number;
  freight?: number;
  pouch?: number;
  tcs?: number;
  gst?: number;
  freightRate?: number;
  packingRate?: number;
  billingRate?: number;
  bpcRate?: number;
  tax?: number;
  total?: number;
  /** BANK / CASH split of the note total. */
  b?: number;
  c?: number;
  remarks?: string;
  noBill?: boolean;
  /** When NoBill: drop GST entirely (the legacy "No Bill without GST" choice). */
  noBillWithoutGst?: boolean;
  /** DN only — CONFIRMED / CANCELLED. */
  challanStatus?: string;
  items: NoteItemInput[];
}

/** A saved note (header + items) for the editor / view. */
export interface NoteDto {
  mode: NoteMode;
  id: number;
  code: string;
  prefix: string;
  invDate: string;
  invTime: string | null;
  customerId: number | null;
  customerName: string;
  billingAddress: string | null;
  shippingAddress: string | null;
  category: string | null;
  paymentTerm: number | null;
  dueDate: string | null;
  transName: string | null;
  packing: number | null;
  freight: number | null;
  pouch: number | null;
  tcs: number | null;
  gst: number | null;
  freightRate: number | null;
  packingRate: number | null;
  billingRate: number | null;
  bpcRate: number | null;
  tax: number | null;
  total: number | null;
  b: number | null;
  c: number | null;
  remarks: string | null;
  noBill: boolean;
  challanStatus: string | null;
  status: string;
  userName: string | null;
  items: NoteItemDto[];
}

export interface SaveNoteResult {
  mode: NoteMode;
  id: number;
  code: string;
  total: number;
}

export interface NextNoteNoResult {
  mode: NoteMode;
  code: string;
}

/** One row in the Debit/Credit Note directory. */
export interface NoteDirectoryRow {
  mode: NoteMode;
  id: number;
  code: string;
  invDate: string;
  customerName: string;
  b: number;
  c: number;
  total: number;
}

export interface NoteDirectoryQuery {
  mode: NoteMode;
  /** yyyy-mm-dd inclusive bounds. */
  fromDate?: string;
  toDate?: string;
  /** ALL | BANK | CASH | BOTH. */
  payMode?: string;
  /** Restrict to one party (used from the customer ledger). */
  customerName?: string;
  search?: string;
}

export type NoteDirectoryList = Paginated<NoteDirectoryRow>;

/* ── Pricing (ported verbatim from DebitNote.vb RecalcAmount + RecalcBillingBreakup) ──
 * Kept as pure functions in @oms/shared so the note editor (live display) and the API
 * (authoritative save) compute byte-identical totals. */

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
/** Decimal.Round(x, 0, AwayFromZero) — amounts here are non-negative. */
const roundAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x) + Number.EPSILON);

export interface NotePricingItem {
  bags?: number | null;
  pcs?: number | null;
  kgs?: number | null;
  box?: number | null;
  unit?: string | null;
  price?: number | null;
  gstRate?: number | null;
}

/** GetQtyByUnit: the quantity that drives amount = qty × price, chosen by unit
 *  (falls back to the first non-zero qty when the unit is blank/unknown). */
export function noteItemQty(it: NotePricingItem): number {
  const u = (it.unit ?? '').trim().toUpperCase();
  const kgs = it.kgs ?? 0;
  const pcs = it.pcs ?? 0;
  const bags = it.bags ?? 0;
  const box = it.box ?? 0;
  switch (u) {
    case 'KG':
    case 'KGS':
      return kgs;
    case 'PCS':
    case 'PC':
      return pcs;
    case 'BAG':
      return bags;
    case 'BOX':
      return box;
    default:
      return kgs || pcs || bags || box || 0;
  }
}

/** RecalcAmount: amount = qty(by unit) × price, to 2dp. */
export function noteItemAmount(it: NotePricingItem): number {
  return round2(noteItemQty(it) * (it.price ?? 0));
}

export interface NoteBreakupInput {
  items: NotePricingItem[];
  packing?: number | null;
  freight?: number | null;
  pouch?: number | null;
  /** Half-bill rate (₹/kg). 0/absent → full bill on the bank side. */
  billingRate?: number | null;
  /** NoBill party → everything falls on the cash (C) side. */
  noBill?: boolean;
  /** When NoBill: user chose to drop GST entirely. */
  noBillWithoutGst?: boolean;
  /** Manual tax override (null/undefined → auto GST). */
  manualTax?: number | null;
}

export interface NoteBreakup {
  /** Per-item amounts, in item order. */
  amounts: number[];
  /** Σ item amounts. */
  tAmt: number;
  /** Weighted-average GST% across the grid. */
  gstPercent: number;
  /** Effective GST amount applied. */
  tax: number;
  /** Grand total (rounded to whole rupees). */
  total: number;
  /** BANK portion. */
  b: number;
  /** CASH portion. */
  c: number;
}

/**
 * The B/C split engine — full port of RecalcGridTotalsAndGrandTotal +
 * RecalcBillingBreakup. Three modes:
 *   • NoBill      → b = 0, everything on cash (C).
 *   • Full bill   → billingRate ≤ 0 → whole challan billed on bank (B).
 *   • Half bill   → billingRate > 0 → B = rate × billable-kgs (+GST), rest on C.
 */
export function computeNoteBreakup(input: NoteBreakupInput): NoteBreakup {
  const amounts = input.items.map((it) => noteItemAmount(it));
  const tAmt = round2(amounts.reduce((a, b) => a + b, 0));

  // Weighted-average GST% (GetOverallGstPercentFromGrid).
  let rowTax = 0;
  input.items.forEach((it, i) => {
    rowTax += (amounts[i] * (it.gstRate ?? 0)) / 100;
  });
  const gstPercent = tAmt > 0 ? round2((rowTax / tAmt) * 100) : 0;

  const packing = input.packing ?? 0;
  const freight = input.freight ?? 0;
  const pouch = input.pouch ?? 0;
  const challanBase = tAmt + packing + freight + pouch;
  const rate = input.billingRate ?? 0;
  const manual = input.manualTax != null && Number.isFinite(input.manualTax);

  let effTax = 0;
  let total = 0;
  let b = 0;
  let c = 0;

  if (input.noBill) {
    b = 0;
    effTax = manual ? input.manualTax! : input.noBillWithoutGst ? 0 : (challanBase * gstPercent) / 100;
    total = challanBase + effTax;
    c = total;
  } else if (rate <= 0) {
    effTax = manual ? input.manualTax! : (challanBase * gstPercent) / 100;
    b = challanBase + effTax;
    total = b;
    c = 0;
  } else {
    // Billable kgs = Σ kgs of taxable rows (gst > 0), else Σ all kgs.
    let taxableKgs = 0;
    let allKgs = 0;
    input.items.forEach((it) => {
      const k = it.kgs ?? 0;
      allKgs += k;
      if ((it.gstRate ?? 0) > 0) taxableKgs += k;
    });
    const billableKgs = taxableKgs > 0 ? taxableKgs : allKgs;
    const billBase = rate * billableKgs;
    effTax = manual ? input.manualTax! : (billBase * gstPercent) / 100;
    b = billBase + effTax;
    total = challanBase + effTax;
    c = total - b;
  }

  total = roundAway(total);
  b = roundAway(b);
  c = total - b;
  if (c < 0) {
    c = 0;
    b = total;
  }

  return { amounts, tAmt, gstPercent, tax: round2(effTax), total, b, c };
}
