/**
 * OMS challan → Tally Sales voucher, as the accountant has been entering them
 * (checked against FY 26-27 Tally bills). Pure: no DB, no Tally. The same
 * result feeds the preview now and the XML at posting time, so what is
 * previewed is exactly what will be sent.
 */

/** Ledger and item names in S.S.STEEL, confirmed by the owner on 23-Sep-2026. */
export const TALLY_NAMES = {
  sales: 'SALES',
  packing: 'PACKING CHARGES', // packing + freight, together
  box: 'BOX CHARGES', // OMS "pouch"
  cgst: 'CGST',
  sgst: 'SGST',
  igst: { 5: 'IGST 5%', 18: 'IGST 18%' } as Record<number, string>,
  tcs: 'TCS @2%', // the ledger's name; the amount is whatever OMS computed (1%)
  roundOff: 'ROUND OFF',
  itemKgs: 'S.S.UTENSILS/GLASS',
  itemPcs: 'S.S.UTENSILS/GLASS (PCS)',
  itemScrap: 'S.S.SCRAP',
};

export interface VoucherChallan {
  code: string;
  invDate: Date;
  transaction: string;
  challanStatus: string;
  noBill: boolean;
  billingRate: number | null;
  gst: number | null;
  tax: number | null;
  tcs: number | null;
  total: number | null;
  b: number | null;
  packing: number | null;
  freight: number | null;
  pouch: number | null;
  transName: string | null;
  items: { productName: string | null; unit: string | null; pCategory: string | null; kgs: number | null; pcs: number | null; price: number | null; bags: number | null; gstRate?: number | null }[];
}

export interface VoucherParty {
  /** Current Tally ledger name (read live by GUID). */
  name: string;
  state: string | null;
  gstin?: string | null;
  registrationType?: string | null;
  address?: string[];
  pincode?: string | null;
  /** OMS customer city, for "final destination" as the accountant types it. */
  city?: string | null;
}

export interface VoucherLine {
  item: string;
  unit: 'KGS' | 'PCS';
  qty: number;
  rate: number;
  amount: number;
}

export interface SalesVoucher {
  vchNo: string;
  date: Date;
  party: string;
  lines: VoucherLine[];
  /** Every ledger except the party, credit amounts (round-off may be negative). */
  ledgers: { name: string; amount: number }[];
  /** What the party is debited — always OMS "B". */
  total: number;
  shippedBy: string | null;
  /** "6-BAG" — the accountant's delivery-note entry. */
  deliveryNote: string | null;
  /** Transporter GSTIN/TRANSIN from the OMS Transporter master — pre-fills the e-way bill. */
  transporterId?: string | null;
}

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const r3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000;
const n = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : 0);

/** Which Tally item a line bills as. SCRAP by category, the rest by the OMS unit. */
function itemFor(line: VoucherChallan['items'][number]): { item: string; unit: 'KGS' | 'PCS' } | null {
  if ((line.pCategory ?? '').toUpperCase() === 'SCRAP') return { item: TALLY_NAMES.itemScrap, unit: 'KGS' };
  // A handful of old lines have no unit; their category still says "(PCS)".
  const unit = (line.unit ?? ((line.pCategory ?? '').toUpperCase().includes('PCS') ? 'PCS' : '')).toUpperCase().replace(/\.$/, '');
  if (unit === 'KGS' || unit === 'KG') return { item: TALLY_NAMES.itemKgs, unit: 'KGS' };
  if (unit === 'PCS') return { item: TALLY_NAMES.itemPcs, unit: 'PCS' };
  return null;
}

/**
 * Build the voucher, or say why this challan must not be posted. Every
 * refusal is a sentence the person at the screen can act on.
 */
export function buildSalesVoucher(
  c: VoucherChallan,
  party: VoucherParty,
  companyState: string,
  vchNo: string,
): { voucher: SalesVoucher | null; blocks: string[] } {
  const blocks: string[] = [];
  if (c.transaction !== 'SALES INVOICE') blocks.push('Only sales invoices are posted.');
  if (c.challanStatus !== 'CONFIRMED') blocks.push('This invoice is cancelled.');
  if (c.noBill) blocks.push('No-bill challan — not posted to Tally.');
  const billingRate = n(c.billingRate);
  const billedAtSpecialRate = billingRate > 0;
  if (!billedAtSpecialRate && Math.abs(n(c.b) - n(c.total)) > 1) {
    blocks.push(`B (₹${n(c.b)}) is not the full invoice total (₹${n(c.total)}) — B was typed by hand.`);
  }
  const rate = n(c.gst);
  const intra = !!party.state && party.state.trim().toUpperCase() === companyState.trim().toUpperCase();
  if (!party.state) blocks.push(`Tally ledger ${party.name} has no state — cannot choose CGST/SGST or IGST.`);
  if (!intra && party.state && !TALLY_NAMES.igst[rate]) blocks.push(`No IGST ledger for ${rate}% GST.`);

  // A billing-rate invoice bills only KGS lines whose GST rate was saved with
  // the challan. C (Gaushala) and the unbilled balance are deliberately outside
  // this Tally invoice; its party amount is B, not the challan's full total.
  let itemsToBill = c.items;
  if (billedAtSpecialRate) {
    itemsToBill = [];
    for (const it of c.items) {
      const item = itemFor(it);
      if (!item || item.unit !== 'KGS') continue;
      if (it.gstRate == null || !Number.isFinite(it.gstRate)) {
        blocks.push(`Line "${it.productName ?? '?'}" has no saved GST rate. Check whether this bill is already in Tally before posting it.`);
        continue;
      }
      if (it.gstRate > 0) {
        if (Math.abs(it.gstRate - rate) > 0.001) {
          blocks.push(`Line "${it.productName ?? '?'}" has GST ${it.gstRate}%, but this invoice uses ${rate}%.`);
        }
        itemsToBill.push(it);
      }
    }
    // A missing historical rate makes all later totals meaningless. Do not
    // show zero-line, tax and round-off errors derived from that missing input.
    if (blocks.length) return { voucher: null, blocks };
    if (!itemsToBill.length) return { voucher: null, blocks: ['No KGS item with a saved GST rate is available to bill.'] };
  }

  // Same item at the same rate is one line, as in Tally today.
  const merged = new Map<string, VoucherLine>();
  for (const it of itemsToBill) {
    const t = itemFor(it);
    if (!t) {
      blocks.push(`Line "${it.productName ?? '?'}" has no unit (KGS/PCS), so it has no Tally item.`);
      continue;
    }
    const qty = t.unit === 'KGS' ? n(it.kgs) : n(it.pcs);
    const price = billedAtSpecialRate ? billingRate : n(it.price);
    if (qty <= 0 || price <= 0) blocks.push(`Line "${it.productName ?? '?'}" has no quantity or rate.`);
    const key = `${t.item}|${price}`;
    const m = merged.get(key) ?? { item: t.item, unit: t.unit, qty: 0, rate: price, amount: 0 };
    m.qty = r3(m.qty + qty);
    merged.set(key, m);
  }
  const lines = [...merged.values()].map((l) => ({ ...l, amount: r2(l.qty * l.rate) }));
  if (!lines.length) blocks.push('The invoice has no lines.');

  const goods = r2(lines.reduce((a, l) => a + l.amount, 0));
  const packing = billedAtSpecialRate ? 0 : r2(n(c.packing) + n(c.freight));
  const box = billedAtSpecialRate ? 0 : r2(n(c.pouch));
  if (packing < 0 || box < 0) blocks.push('Packing, freight or box charge is negative — correct the invoice first.');
  const taxable = r2(goods + packing + box);
  // Tax to the paisa, as Tally and the e-invoice compute it; OMS rounds its
  // own tax to the rupee, and that difference is what ROUND OFF carries.
  // Exactly Tally's arithmetic (value × rate%, then round) — r2's epsilon nudge
  // rounded 6885.975 up where Tally rounds it down, a paisa off on some bills.
  const half = Math.round(taxable * (rate / 200) * 100) / 100;
  const tax = intra ? r2(half * 2) : Math.round(taxable * (rate / 100) * 100) / 100;
  if (Math.abs(tax - n(c.tax)) > 1.01) blocks.push(`GST on the invoice (₹${n(c.tax)}) is not ${rate}% of ₹${taxable} — tax was typed by hand.`);
  const tcs = billedAtSpecialRate ? 0 : r2(n(c.tcs));
  const total = n(c.b);
  const roundOff = r2(total - taxable - tax - tcs);
  // OMS rounds its total its own way, a rupee off Tally's on ~1 bill in 70;
  // anything past ₹2 means the figures themselves disagree.
  if (Math.abs(roundOff) >= 2) blocks.push(`The invoice does not add up: round-off would be ₹${roundOff}.`);

  const ledgers = [
    ...(packing ? [{ name: TALLY_NAMES.packing, amount: packing }] : []),
    ...(box ? [{ name: TALLY_NAMES.box, amount: box }] : []),
    ...(intra
      ? [
          { name: TALLY_NAMES.cgst, amount: half },
          { name: TALLY_NAMES.sgst, amount: half },
        ]
      : [{ name: TALLY_NAMES.igst[rate] ?? `IGST ${rate}%`, amount: tax }]),
    ...(tcs ? [{ name: TALLY_NAMES.tcs, amount: tcs }] : []),
    ...(roundOff ? [{ name: TALLY_NAMES.roundOff, amount: roundOff }] : []),
  ];

  const bags = r3(itemsToBill.reduce((a, it) => a + n(it.bags), 0));
  return {
    voucher: blocks.length
      ? null
      : { vchNo, date: c.invDate, party: party.name, lines, ledgers, total, shippedBy: c.transName, deliveryNote: bags ? `${bags}-BAG` : null },
    blocks,
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const amt = (x: number) => x.toFixed(2);
const qty = (l: VoucherLine) => ` ${l.qty.toFixed(l.unit === 'KGS' ? 3 : 2)} ${l.unit}`;
const el = (tagName: string, v: string | null | undefined) => (v ? `<${tagName}>${esc(v)}</${tagName}>` : '');
const list = (tagName: string, lines: string[] | undefined) =>
  lines?.length ? `<${tagName}.LIST TYPE="String">${lines.map((l) => `<${tagName}>${esc(l)}</${tagName}>`).join('')}</${tagName}.LIST>` : '';

/**
 * The <VOUCHER> element Tally imports — the same shape as a Sales invoice the
 * accountant types (SSS-739/26-27 was copied field for field): party and
 * consignee GST details from the ledger, one stock line per item+rate booked
 * to SALES, then the charge, tax, TCS and round-off ledgers.
 */
export function salesVoucherXml(v: SalesVoucher, p: VoucherParty): string {
  const date = ymd(v.date);
  const dest = [p.city, p.state].filter(Boolean).join(',').toUpperCase();
  const lines = v.lines
    .map(
      (l) =>
        '<ALLINVENTORYENTRIES.LIST>' +
        `${el('STOCKITEMNAME', l.item)}<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>` +
        `<RATE>${amt(l.rate)}/${l.unit}</RATE><AMOUNT>${amt(l.amount)}</AMOUNT><ACTUALQTY>${qty(l)}</ACTUALQTY><BILLEDQTY>${qty(l)}</BILLEDQTY>` +
        `<BATCHALLOCATIONS.LIST><BATCHNAME>Primary Batch</BATCHNAME><AMOUNT>${amt(l.amount)}</AMOUNT><ACTUALQTY>${qty(l)}</ACTUALQTY><BILLEDQTY>${qty(l)}</BILLEDQTY></BATCHALLOCATIONS.LIST>` +
        `<ACCOUNTINGALLOCATIONS.LIST>${el('LEDGERNAME', TALLY_NAMES.sales)}<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amt(l.amount)}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>` +
        '</ALLINVENTORYENTRIES.LIST>',
    )
    .join('');
  const ledgers =
    `<LEDGERENTRIES.LIST>${el('LEDGERNAME', v.party)}<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>${amt(-v.total)}</AMOUNT></LEDGERENTRIES.LIST>` +
    // Credit side, signed — a negative round-off stays "No" with a minus amount, as Tally stores it.
    v.ledgers.map((l) => `<LEDGERENTRIES.LIST>${el('LEDGERNAME', l.name)}<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amt(l.amount)}</AMOUNT></LEDGERENTRIES.LIST>`).join('');
  return (
    '<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">' +
    list('ADDRESS', p.address) +
    list('BASICBUYERADDRESS', p.address) +
    `<DATE>${date}</DATE><EFFECTIVEDATE>${date}</EFFECTIVEDATE>` +
    '<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>' +
    el('VOUCHERNUMBER', v.vchNo) +
    el('PARTYLEDGERNAME', v.party) +
    el('PARTYNAME', v.party) +
    el('BASICBUYERNAME', v.party) +
    el('PARTYMAILINGNAME', v.party) +
    el('BASICBASEPARTYNAME', v.party) +
    el('GSTREGISTRATIONTYPE', p.registrationType) +
    el('PARTYGSTIN', p.gstin) +
    el('STATENAME', p.state) +
    el('PLACEOFSUPPLY', p.state) +
    '<COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>' +
    el('PARTYPINCODE', p.pincode) +
    el('CONSIGNEEGSTIN', p.gstin) +
    el('CONSIGNEEMAILINGNAME', v.party) +
    el('CONSIGNEEPINCODE', p.pincode) +
    el('CONSIGNEESTATENAME', p.state) +
    '<CONSIGNEECOUNTRYNAME>India</CONSIGNEECOUNTRYNAME>' +
    el('BASICSHIPPEDBY', v.shippedBy) +
    el('BASICFINALDESTINATION', dest) +
    '<PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><VCHENTRYMODE>Item Invoice</VCHENTRYMODE><ISINVOICE>Yes</ISINVOICE>' +
    (v.deliveryNote ? `<INVOICEDELNOTES.LIST><BASICSHIPPINGDATE>${date}</BASICSHIPPINGDATE>${el('BASICSHIPDELIVERYNOTE', v.deliveryNote)}</INVOICEDELNOTES.LIST>` : '') +
    // E-way bill Part-A transporter, where Tally keeps it (as on SSS-739) — the
    // accountant then only generates. No bill number: Tally/NIC fill that in.
    (v.transporterId
      ? '<EWAYBILLDETAILS.LIST><DOCUMENTTYPE>Tax Invoice</DOCUMENTTYPE><SUBTYPE>Supply</SUBTYPE>' +
        `<TRANSPORTDETAILS.LIST>${el('TRANSPORTERNAME', v.shippedBy)}${el('TRANSPORTERID', v.transporterId)}</TRANSPORTDETAILS.LIST></EWAYBILLDETAILS.LIST>`
      : '') +
    lines +
    ledgers +
    '</VOUCHER>'
  );
}
