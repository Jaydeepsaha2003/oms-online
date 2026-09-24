// The bank check compares BANKS. It must not compare a credit note's reason.
// Reproduces AMBIKA METAL: a credit note agreeing on party, date, amount and
// type, reported as "Bank differs" only because Tally wrote "SALES RETURN" and
// OMS wrote "SALES RETURN (1 ITEMS)".
// Pure matcher test — no database, no API, no fixture files.
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { reconcileParty } = require('../apps/api/src/tally-recon/tally-recon.matcher.ts');

const FROM = new Date('2026-04-01');
const day = (s) => new Date(s);

/** One Tally register line. */
const tallyVoucher = (vchType, particulars, amount, date, vchNo = '11') => ({
  ledgerName: 'AMBIKA METAL', txnDate: day(date), drCr: 'By', particulars,
  vchType, vchNo, debit: 0, credit: amount,
});
const ledger = (vouchers) => ({ ledgerName: 'AMBIKA METAL', openingNet: null, openingDate: null, closingNet: null, vouchers });

/** One OMS voucher. A note carries its REASON here; a receipt carries its BANK. */
const omsVoucher = (voucherType, particulars, amount, date, voucherNo) => ({
  voucherNo, transDate: day(date), voucherType, particulars,
  bankDr: 0, bankCr: amount, cashDr: 0, cashCr: 0,
});
const party = (vouchers) => ({
  customerId: 1, customerName: 'AMBIKA METAL', openingBankNet: 0, openingCashNet: 0,
  hasOpening: false, invoices: [], vouchers,
});

const only = (rows, vchType) => rows.filter((r) => r.vchType === vchType);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('a credit note is not "bank differs" over its own wording', () => {
  const rows = reconcileParty(
    ledger([tallyVoucher('Credit Note', 'SALES RETURN', 29899, '2026-07-24')]),
    party([omsVoucher('CREDIT NOTE', 'SALES RETURN (1 ITEMS)', 29899, '2026-07-24', 'CN/16')]),
    FROM,
  );
  const [row] = only(rows, 'CREDIT NOTE');
  assert.equal(row.status, 'MATCHED', `expected MATCHED, got ${row.status}: ${row.note ?? ''}`);
  assert.equal(row.omsRef, 'CN/16');
  assert.equal(row.omsAmount, 29899);
  assert.equal(row.note, null, 'nothing to remark on — the two sides agree');
});

test('a debit note with differently worded reasons still matches', () => {
  const rows = reconcileParty(
    ledger([tallyVoucher('Debit Note', 'RATE DIFFERANCE', 4196, '2026-08-14', '10')]),
    party([omsVoucher('DEBIT NOTE', 'SALES RETURN (1 ITEMS)', 4196, '2026-08-14', 'DN/10')]),
    FROM,
  );
  const [row] = only(rows, 'DEBIT NOTE');
  assert.equal(row.status, 'MATCHED', `expected MATCHED, got ${row.status}: ${row.note ?? ''}`);
});

test('a receipt in a DIFFERENT bank is still reported', () => {
  // The check exists for this. Losing it would hide two bank books disagreeing.
  const rows = reconcileParty(
    ledger([tallyVoucher('Receipt', 'ICICI BANK', 50000, '2026-08-11', '20')]),
    party([omsVoucher('RECEIPT', 'AXIS BANK-0884', 50000, '2026-08-11', 'RN/900')]),
    FROM,
  );
  const [row] = only(rows, 'RECEIPT');
  assert.equal(row.status, 'BANK_MISMATCH');
  assert.match(row.note, /ICICI BANK/);
  assert.match(row.note, /AXIS BANK-0884/);
});

test('a receipt in the same bank, spelled differently, matches', () => {
  const rows = reconcileParty(
    ledger([tallyVoucher('Receipt', 'AXIS BANK LTD', 50000, '2026-08-11', '21')]),
    party([omsVoucher('RECEIPT', 'AXIS BANK-0884', 50000, '2026-08-11', 'RN/901')]),
    FROM,
  );
  const [row] = only(rows, 'RECEIPT');
  assert.equal(row.status, 'MATCHED', `expected MATCHED, got ${row.status}: ${row.note ?? ''}`);
});

test('a real fault on a note still shows — the date, not the wording', () => {
  const rows = reconcileParty(
    ledger([tallyVoucher('Credit Note', 'SALES RETURN', 29899, '2026-07-24')]),
    party([omsVoucher('CREDIT NOTE', 'SALES RETURN (1 ITEMS)', 29899, '2026-09-24', 'CN/16')]),
    FROM,
  );
  const [row] = only(rows, 'CREDIT NOTE');
  assert.equal(row.status, 'DATE_MISMATCH', 'a genuine disagreement is still reported');
});

test('one OMS receipt entered as two Tally receipts the same day is matched (PNB 25 Jun)', () => {
  const rows = reconcileParty(
    ledger([tallyVoucher('Receipt', 'ICICI BANK', 374144, '2026-06-25', '195'), tallyVoucher('Receipt', 'ICICI BANK', 17811, '2026-06-25', '196')]),
    party([omsVoucher('RECEIPT', 'ICICI BANK', 391955, '2026-06-25', 'RN/785')]),
    FROM,
  );
  const receipts = only(rows, 'RECEIPT');
  assert.equal(receipts.length, 2, 'no extra "missing in Tally" row for RN/785');
  for (const r of receipts) { assert.equal(r.status, 'MATCHED'); assert.equal(r.omsRef, 'RN/785'); }
});

test('one Tally receipt entered as two OMS receipts the same day is matched (PADMAVATI 1 May)', () => {
  const rows = reconcileParty(
    ledger([tallyVoucher('Receipt', 'AXIS BANK', 41882, '2026-05-01', '70')]),
    party([omsVoucher('RECEIPT', 'AXIS BANK', 41880, '2026-05-01', 'RN/407'), omsVoucher('RECEIPT', 'AXIS BANK', 2, '2026-05-01', 'RN/815')]),
    FROM,
  );
  const receipts = only(rows, 'RECEIPT');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].status, 'MATCHED');
  assert.equal(receipts[0].omsRef, 'RN/407 + RN/815');
});

test('two Tally ledgers of one party are matched as one, each row under its own ledger', () => {
  const old = { ...tallyVoucher('Receipt', 'ICICI BANK', 1000, '2026-04-04', '1'), ledgerName: 'PNB KITCHENMATE (OLD)' };
  const cur = { ...tallyVoucher('Receipt', 'ICICI BANK', 2000, '2026-05-04', '2'), ledgerName: 'PNB KITCHENMATE LTD' };
  const merged = { ledgerName: 'PNB KITCHENMATE LTD', openingNet: null, openingDate: null, closingNet: null, vouchers: [old, cur] };
  const rows = reconcileParty(merged, party([omsVoucher('RECEIPT', 'ICICI BANK', 1000, '2026-04-04', 'RN/1'), omsVoucher('RECEIPT', 'ICICI BANK', 2000, '2026-05-04', 'RN/2')]), FROM);
  assert.deepEqual(rows.map((r) => [r.ledgerName, r.status, r.omsRef]), [['PNB KITCHENMATE (OLD)', 'MATCHED', 'RN/1'], ['PNB KITCHENMATE LTD', 'MATCHED', 'RN/2']]);
});

let failures = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e) { failures++; console.error(`FAIL ${name}: ${e.message}`); }
}
console.log(`${tests.length - failures}/${tests.length} passed`);
process.exitCode = failures ? 1 : 0;
