// Run: node --test apps/api/src/tally/tally-voucher.spec.ts   (Node 24 runs TS directly)
// Fixtures are real FY 26-27 bills, checked against what the accountant entered in Tally.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSalesVoucher } = require('./tally-voucher.ts');

const base = {
  transaction: 'SALES INVOICE',
  challanStatus: 'CONFIRMED',
  noBill: false,
  billingRate: 0,
  tcs: null,
  pouch: null,
  transName: 'BEST ROADWAYS',
  invDate: new Date(2026, 8, 22),
};
const glass = (kgs: number, price: number, gstRate?: number) => ({ productName: 'X', unit: 'KGS', pCategory: 'GLASS', kgs, pcs: 0, price, gstRate });

test('SSS-739: inter-state full bill matches Tally', () => {
  const { voucher, blocks } = buildSalesVoucher(
    { ...base, code: 'SSS/26-27/739', gst: 5, tax: 6886, total: 144606, b: 144606, packing: 1200, freight: 900, items: [glass(71.5, 345), glass(144.4, 330), glass(211, 300)] },
    { name: 'PNB KITCHENMATE LTD BAHALGARH', state: 'Haryana' },
    'Maharashtra',
    'SSS-739/26-27',
  );
  assert.deepEqual(blocks, []);
  assert.equal(voucher.lines.length, 3);
  assert.equal(voucher.total, 144606);
  const l = Object.fromEntries(voucher.ledgers.map((x: { name: string; amount: number }) => [x.name, x.amount]));
  assert.equal(l['PACKING CHARGES'], 2100);
  assert.ok(Math.abs(l['IGST 5%'] - 6885.97) <= 0.01);
  assert.ok(Math.abs(l['ROUND OFF']) < 1);
});

test('SSS-687: PCS lines at the same rate merge; box charge; CGST+SGST within Maharashtra', () => {
  const cup = (pcs: number, price: number) => ({ productName: 'CUP', unit: 'PCS', pCategory: 'CUP', kgs: 0, pcs, price });
  const { voucher, blocks } = buildSalesVoucher(
    { ...base, code: 'SSS/26-27/667', gst: 5, tax: 1736, total: 36458, b: 36458, packing: 250, freight: 200, pouch: 1512, items: [cup(504, 65)] },
    { name: 'METRO METALS', state: 'Maharashtra' },
    'Maharashtra',
    'SSS-667/26-27',
  );
  assert.deepEqual(blocks, []);
  assert.deepEqual(voucher.lines, [{ item: 'S.S.UTENSILS/GLASS (PCS)', unit: 'PCS', qty: 504, rate: 65, amount: 32760 }]);
  const names = voucher.ledgers.map((x: { name: string }) => x.name);
  assert.deepEqual(names.slice(0, 4), ['PACKING CHARGES', 'BOX CHARGES', 'CGST', 'SGST']);

  // 1000 + 120 cups @ ₹90 are one Tally line of 1120 (as on SSS-687).
  const merged = buildSalesVoucher(
    { ...base, code: 'x', gst: 5, tax: 5314, total: 111598, b: 111598, packing: 1200, freight: 0, pouch: 4284, items: [cup(1000, 90), cup(120, 90)] },
    { name: 'JEE ALTO', state: 'Gujarat' },
    'Maharashtra',
    'x',
  );
  assert.deepEqual(merged.blocks, []);
  assert.deepEqual(merged.voucher.lines, [{ item: 'S.S.UTENSILS/GLASS (PCS)', unit: 'PCS', qty: 1120, rate: 90, amount: 100800 }]);
});

test('billing-rate bill posts billed KGS at billing rate; C and unbilled charges stay outside Tally', () => {
  const party = { name: 'SANCHETI STEEL HOUSE', state: 'Maharashtra' };
  const half = buildSalesVoucher(
    { ...base, code: 'SSS/26-27/744', gst: 5, tax: 747, total: 33732, b: 15687, billingRate: 180, packing: 200, freight: 0, items: [{ ...glass(83, 395), gstRate: 5 }] },
    party,
    'Maharashtra',
    'SSS-744/26-27',
  );
  assert.deepEqual(half.blocks, []);
  assert.equal(half.voucher.total, 15687);
  assert.deepEqual(half.voucher.lines, [{ item: 'S.S.UTENSILS/GLASS', unit: 'KGS', qty: 83, rate: 180, amount: 14940 }]);
  assert.deepEqual(half.voucher.ledgers, [
    { name: 'CGST', amount: 373.5 },
    { name: 'SGST', amount: 373.5 },
  ]);
  assert.equal(half.voucher.lines.reduce((sum: number, l: { amount: number }) => sum + l.amount, 0) + half.voucher.ledgers.reduce((sum: number, l: { amount: number }) => sum + l.amount, 0), 15687);

  const scrap = buildSalesVoucher(
    {
      ...base,
      code: 'SSS/26-27/745',
      gst: 5,
      tax: 765,
      total: 30000,
      b: 16065,
      billingRate: 180,
      items: [glass(83, 395, 5), { ...glass(2, 25), productName: 'SCRAP', pCategory: 'SCRAP', gstRate: 5 }],
    },
    party,
    'Maharashtra',
    'SSS-745/26-27',
  );
  assert.deepEqual(scrap.blocks, []);
  assert.deepEqual(scrap.voucher.lines, [
    { item: 'S.S.UTENSILS/GLASS', unit: 'KGS', qty: 83, rate: 180, amount: 14940 },
    { item: 'S.S.SCRAP', unit: 'KGS', qty: 2, rate: 180, amount: 360 },
  ]);
  assert.equal(scrap.voucher.total, 16065);

  const missingRate = buildSalesVoucher(
    { ...base, code: 'SSS/26-27/736', gst: 5, tax: 1516, total: 69250, b: 31828, billingRate: 180, items: [glass(81.6, 405)] },
    party,
    'Maharashtra',
    'x',
  );
  assert.equal(missingRate.voucher, null);
  assert.equal(missingRate.blocks.length, 1);
  assert.ok(missingRate.blocks[0].includes('no saved GST rate'));

  const neg = buildSalesVoucher({ ...base, code: 'x', gst: 5, tax: 50, total: 1049, b: 1049, packing: -1, freight: 0, items: [glass(10, 100)] }, party, 'Maharashtra', 'x');
  assert.ok(neg.blocks.some((b: string) => b.includes('negative')));
});

test('transporter ID goes into the e-way bill details; none sent when OMS has no ID', () => {
  const { salesVoucherXml } = require('./tally-voucher.ts');
  const v = { vchNo: 'SSS-740/26-27', date: new Date(2026, 8, 23), party: 'BAPU STEEL', lines: [], ledgers: [], total: 1, shippedBy: 'BEST ROADWAYS', deliveryNote: null };
  const withId = salesVoucherXml({ ...v, transporterId: '88AAACB4214A1ZJ' }, { name: 'BAPU STEEL', state: 'Maharashtra' });
  assert.match(withId, /<EWAYBILLDETAILS\.LIST>.*<TRANSPORTERNAME>BEST ROADWAYS<\/TRANSPORTERNAME><TRANSPORTERID>88AAACB4214A1ZJ<\/TRANSPORTERID>.*<\/EWAYBILLDETAILS\.LIST>/);
  assert.doesNotMatch(salesVoucherXml({ ...v, transporterId: null }, { name: 'BAPU STEEL', state: 'Maharashtra' }), /EWAYBILLDETAILS/);
});
