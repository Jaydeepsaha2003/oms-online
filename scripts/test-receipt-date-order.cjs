// Money that arrived first must settle the oldest bill first, whatever order the
// receipts were typed in (AARTI STEELS: an 8 Jan receipt entered before a 4 Jan
// one took the 1 Jan bill). A bill the party named (AGST REF) stays with the
// receipt that named it.
// Isolated SQLite fixture -- never reads or writes dev.db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-receipt-order-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { PaymentsService } = require('../apps/api/src/payments/payments.service.ts');
const { OpeningBalancesService } = require('../apps/api/src/opening-balances/opening-balances.service.ts');

const sql = spawnSync(
  process.execPath,
  [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'apps/api/prisma/schema.prisma'), '--script'],
  { cwd: root, encoding: 'utf8', env: process.env },
);
assert.equal(sql.status, 0, sql.stderr);
const sqlite = new DatabaseSync(dbPath);
sqlite.exec(sql.stdout);
sqlite.close();

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const svc = new PaymentsService(prisma);

let nextId = 1;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

async function party(partyName) {
  return prisma.customer.create({ data: { id: nextId++, partyName, payBy: 'PARTY' } });
}
async function bill(customer, code, day, amount = 100) {
  return prisma.challan.create({
    data: { code, prefix: 'SSS', invDate: new Date(day), customerId: customer.id, customerName: customer.partyName, challanStatus: 'CONFIRMED', b: amount, c: 0, total: amount },
  });
}
function receive(customer, day, amount, extra = {}) {
  return svc.save({ takeAccOn: 'PARTY', customerId: customer.id, payMode: 'BANK', bankName: 'AXIS BANK', adjMode: 'AUTOMATIC', receiptAmt: amount, recDate: day, ...extra }, 'Tester');
}
/** invoice -> voucher that paid it (one payer per bill in these fixtures). */
async function paidBy(customer) {
  const rows = await prisma.acctPaymentReceipt.findMany({ where: { custId: customer.id }, orderBy: { invNo: 'asc' } });
  const led = new Map((await prisma.acctLedger.findMany({ where: { custId: customer.id } })).map((l) => [l.voucherNo, l]));
  return Object.fromEntries(rows.map((r) => [r.invNo, r.sourceVoucherNo ?? r.refRecId]).filter(([, v]) => led.has(v)));
}

test('a back-dated receipt takes the oldest bill; the later receipt moves to the next one', async () => {
  const p = await party('AARTI STEELS');
  await bill(p, 'B-01JAN', '2026-01-01');
  await bill(p, 'B-03JAN', '2026-01-03');
  const jan8 = await receive(p, '2026-01-08', 100); // entered first
  const jan4 = await receive(p, '2026-01-04', 100); // entered later, arrived earlier
  assert.deepEqual(await paidBy(p), { 'B-01JAN': jan4.voucherNo, 'B-03JAN': jan8.voucherNo });
  const vouchers = await prisma.acctLedger.findMany({ where: { custId: p.id } });
  assert.equal(vouchers.length, 2, 'no receipt is lost or duplicated by the re-sort');
  assert.deepEqual(vouchers.map((v) => v.bankCredit).sort(), [100, 100]);
});

test('a receipt cannot pay a bill raised after its date; the money waits on account', async () => {
  const p = await party('LATE BILL CO');
  await bill(p, 'L-01JAN', '2026-01-01');
  await bill(p, 'L-06JAN', '2026-01-06');
  const jan8 = await receive(p, '2026-01-08', 100);
  const jan4 = await receive(p, '2026-01-04', 200); // only the 1 Jan bill existed on 4 Jan
  const paid = await paidBy(p);
  assert.equal(paid['L-01JAN'], jan4.voucherNo);
  assert.equal(paid['L-06JAN'] !== undefined, true, 'the 6 Jan bill is still paid');
  const onAccount = await prisma.acctPartyAdvance.findMany({ where: { custId: p.id } });
  assert.equal(onAccount.some((a) => a.refRecId === jan4.voucherNo), true, 'the 4 Jan surplus parks on account');
  const total = (await prisma.acctPaymentReceipt.aggregate({ where: { custId: p.id }, _sum: { recAmt: true } }))._sum.recAmt;
  assert.equal(total, 200, 'both bills fully paid, no more and no less');
  void jan8;
});

test('a bill the party named stays with the receipt that named it', async () => {
  const p = await party('AMBIKA METAL');
  await bill(p, 'A-01JAN', '2026-01-01');
  await bill(p, 'A-03JAN', '2026-01-03');
  const named = await receive(p, '2026-01-08', 100, { adjMode: 'AGST REF', selectedInvNos: ['A-01JAN'] });
  const auto = await receive(p, '2026-01-04', 100); // older money, but A-01JAN is spoken for
  assert.deepEqual(await paidBy(p), { 'A-01JAN': named.voucherNo, 'A-03JAN': auto.voucherNo });
});

test('deleting an early receipt re-sorts the rest in date order, not typing order', async () => {
  const p = await party('DELETE CO');
  await bill(p, 'D-01JAN', '2026-01-01');
  await bill(p, 'D-02JAN', '2026-01-02');
  await bill(p, 'D-03JAN', '2026-01-03');
  const jan9 = await receive(p, '2026-01-09', 100);
  const jan7 = await receive(p, '2026-01-07', 100);
  const jan2 = await receive(p, '2026-01-02', 100);
  const led = await prisma.acctLedger.findFirst({ where: { voucherNo: jan2.voucherNo } });
  await svc.deleteReceipt(led.id);
  assert.deepEqual(await paidBy(p), { 'D-01JAN': jan7.voucherNo, 'D-02JAN': jan9.voucherNo });
});

test('moving a receipt to an earlier date re-sorts it ahead of the others', async () => {
  const p = await party('EDIT CO');
  await bill(p, 'E-01JAN', '2026-01-01');
  await bill(p, 'E-02JAN', '2026-01-02');
  const jan5 = await receive(p, '2026-01-05', 100);
  const jan9 = await receive(p, '2026-01-09', 100);
  const led = await prisma.acctLedger.findFirst({ where: { voucherNo: jan9.voucherNo } });
  await svc.editReceipt(led.id, { payMode: 'BANK', bankName: 'AXIS BANK', receiptAmt: 100, recDate: '2026-01-03' }, 'Tester');
  assert.deepEqual(await paidBy(p), { 'E-01JAN': jan9.voucherNo, 'E-02JAN': jan5.voucherNo });
});

test('Receive Payment shows the bills as they stood on a back-dated receipt date', async () => {
  const p = await party('PREVIEW CO');
  await bill(p, 'P-01JAN', '2026-01-01');
  await bill(p, 'P-03JAN', '2026-01-03');
  await receive(p, '2026-01-08', 100); // took P-01JAN
  const ctx = await svc.context({ customerId: p.id, recDate: '2026-01-04', payMode: 'BANK' });
  assert.deepEqual(ctx.invoices.map((i) => [i.invNo, i.bankBal]), [['P-01JAN', 100], ['P-03JAN', 100]]);
  const today = await svc.context({ customerId: p.id, recDate: '2026-01-10', payMode: 'BANK' });
  assert.deepEqual(today.invoices.map((i) => i.invNo), ['P-03JAN'], 'an ordinary date is unchanged');
});

test('a payment equal to one later bill settles that bill, even ahead of older money (SSS/26-27/393)', async () => {
  const p = await party('CHAITANYA STAINLESS STEEL');
  await bill(p, 'C-29JUN', '2026-06-29', 500);
  await bill(p, 'C-10JUL', '2026-07-10', 300);
  const older = await receive(p, '2026-08-20', 600); // no exact match: oldest first
  const exact = await receive(p, '2026-09-07', 300); // = C-10JUL exactly
  const paid = await prisma.acctPaymentReceipt.findMany({ where: { invNo: 'C-10JUL' } });
  assert.deepEqual(paid.map((r) => [r.sourceVoucherNo, r.recAmt]), [[exact.voucherNo, 300]]);
  const onAccount = await prisma.acctPartyAdvance.findMany({ where: { refRecId: older.voucherNo } });
  assert.deepEqual(onAccount.map((a) => a.bankAmt), [100], 'the older receipt keeps its surplus on account');
});

test('a payment equal to two bills together settles those two', async () => {
  const p = await party('TWO BILLS CO');
  await bill(p, 'T-01JAN', '2026-01-01', 105);
  await bill(p, 'T-02JAN', '2026-01-02', 100);
  await bill(p, 'T-03JAN', '2026-01-03', 100);
  const r = await receive(p, '2026-01-05', 200); // = T-02JAN + T-03JAN, not the oldest
  assert.deepEqual(await paidBy(p), { 'T-02JAN': r.voucherNo, 'T-03JAN': r.voucherNo });
});

test('an amount that is just the oldest bills stays plain oldest-first', async () => {
  const p = await party('PLAIN FIFO CO');
  await bill(p, 'F-01JAN', '2026-01-01', 100);
  await bill(p, 'F-02JAN', '2026-01-02', 100);
  const late = await receive(p, '2026-01-09', 100);
  const early = await receive(p, '2026-01-04', 100);
  assert.deepEqual(await paidBy(p), { 'F-01JAN': early.voucherNo, 'F-02JAN': late.voucherNo });
});

test('an exact bill payment is not swallowed by the opening balance', async () => {
  const p = await party('OPENING CO');
  await prisma.acctOpeningTrans.create({ data: { kind: 'OPENING', drCr: 'DEBIT', customerName: p.partyName, custId: p.id, transDate: new Date('2025-04-01'), bankAmt: 1000, cashAmt: 0 } });
  await bill(p, 'O-01JAN', '2026-01-01', 250);
  await bill(p, 'O-02JAN', '2026-01-02', 300);
  const r = await receive(p, '2026-01-05', 300);
  assert.deepEqual(await paidBy(p), { 'O-02JAN': r.voucherNo });
  const cleared = await prisma.acctOpeningTrans.count({ where: { custId: p.id, kind: 'CLEARANCE' } });
  assert.equal(cleared, 0, 'the opening stays open');
});

test('money on account settles a bill raised later, dated on the bill', async () => {
  const p = await party('ADVANCE CO');
  await bill(p, 'V-31JAN', '2026-01-31', 400);
  const r = await receive(p, '2026-02-01', 1000); // clears 31 Jan, 600 waits on account
  await bill(p, 'V-05FEB', '2026-02-05', 250);
  await prisma.$transaction((tx) => svc.applyOnAccount(tx, p.id)); // what saving the bill does
  const row = await prisma.acctPaymentReceipt.findFirst({ where: { invNo: 'V-05FEB' } });
  assert.equal(row.recAmt, 250);
  assert.equal(row.sourceVoucherNo, r.voucherNo, 'reversing the receipt takes it back out');
  assert.equal(row.recDate.toISOString().slice(0, 10), '2026-02-05', 'paid the day the bill was raised');
  const ctx = await svc.context({ customerId: p.id, recDate: '2026-02-10', payMode: 'BANK' });
  assert.deepEqual(ctx.invoices, [], 'nothing shows as due');
  assert.equal(ctx.advances.reduce((s, a) => s + a.bankBal, 0), 350, 'the rest still waits on account');
});

test('an old spend of a receipt\'s money on account goes when that receipt re-settles (DEVI METALS)', async () => {
  const p = await party('DEVI METALS');
  await bill(p, 'DV-01JAN', '2026-01-01', 100);
  const r = await receive(p, '2026-01-05', 150); // pays DV-01JAN, 50 waits on account
  const adv = await prisma.acctPartyAdvance.findFirst({ where: { refRecId: r.voucherNo } });
  await bill(p, 'DV-10JAN', '2026-01-10', 50);
  // What an old import left: a spend of that money, written by nobody we track.
  await prisma.acctPaymentReceipt.create({ data: { refId: adv.refId, recDate: new Date('2026-01-10'), invNo: 'DV-10JAN', customerName: p.partyName, custId: p.id, recType: 'RECEIPT', recAmt: 50, payMode: 'BANK', modeOfAdj: 'ADVANCE', refRecId: adv.refId } });
  await receive(p, '2026-01-03', 100); // back-dated: takes DV-01JAN, so r now parks all 150
  const spends = await prisma.acctPaymentReceipt.findMany({ where: { refRecId: { startsWith: 'ADV' }, custId: p.id } });
  const parked = await prisma.acctPartyAdvance.findMany({ where: { custId: p.id } });
  for (const a of parked) {
    const spent = spends.filter((s) => s.refRecId === a.refId).reduce((s, x) => s + x.recAmt, 0);
    assert.ok(spent <= a.bankAmt + a.cashAmt + 0.01, `${a.refId} spent ${spent} of ${a.bankAmt}`);
  }
  const paid10 = (await prisma.acctPaymentReceipt.aggregate({ where: { invNo: 'DV-10JAN' }, _sum: { recAmt: true } }))._sum.recAmt;
  assert.equal(paid10, 50, 'DV-10JAN paid once, from money that exists');
});

test('a credit opening (party money held from day one) settles bills like money on account', async () => {
  const p = await party('MINAL METAL');
  await prisma.acctOpeningTrans.create({ data: { kind: 'OPENING', drCr: 'CREDIT', customerName: p.partyName, custId: p.id, transDate: new Date('2025-04-01'), bankAmt: 300, cashAmt: 0 } });
  await bill(p, 'M-01JAN', '2026-01-01', 200);
  await bill(p, 'M-02JAN', '2026-01-02', 200);
  await prisma.$transaction((tx) => svc.applyOnAccount(tx, p.id));
  const ctx = await svc.context({ customerId: p.id, recDate: '2026-01-05', payMode: 'BANK' });
  assert.deepEqual(ctx.invoices.map((i) => [i.invNo, i.bankBal]), [['M-02JAN', 100]], 'credit clears the oldest bill, then part of the next');
  const r = await receive(p, '2026-01-05', 100);
  assert.equal((await prisma.acctPaymentReceipt.findFirst({ where: { sourceVoucherNo: r.voucherNo } })).invNo, 'M-02JAN');
  await prisma.$transaction((tx) => svc.applyOnAccount(tx, p.id));
  assert.equal((await prisma.acctPaymentReceipt.aggregate({ where: { custId: p.id }, _sum: { recAmt: true } }))._sum.recAmt, 400, 'no bill is paid twice');
});

test('raising an opening balance re-settles the receipts: the opening is paid first (RANJITHAM)', async () => {
  const p = await party('RANJITHAM METAL STORES');
  const openings = new OpeningBalancesService(prisma, svc);
  const o = await openings.create({ customerId: p.id, transDate: '2025-06-26', bankAmt: 300, cashAmt: 0, drCr: 'DEBIT' }, 'Tester');
  await bill(p, 'RJ-01JAN', '2026-01-01', 200);
  await receive(p, '2026-01-05', 500); // clears opening 300, then the bill 200
  await openings.update(o.id, { customerId: p.id, transDate: '2025-06-26', bankAmt: 400, cashAmt: 0, drCr: 'DEBIT' });
  const cleared = await prisma.acctOpeningTrans.aggregate({ where: { custId: p.id, kind: 'CLEARANCE' }, _sum: { bankAmt: true } });
  assert.equal(cleared._sum.bankAmt, 400, 'the bigger opening is cleared first');
  const onBill = await prisma.acctPaymentReceipt.aggregate({ where: { invNo: 'RJ-01JAN' }, _sum: { recAmt: true } });
  assert.equal(onBill._sum.recAmt, 100, 'so only 100 is left for the bill');
});

test('an opening switched from Cr back to Dr stops paying bills (VIJAY put back)', async () => {
  const p = await party('SWITCH CO');
  const openings = new OpeningBalancesService(prisma, svc);
  const o = await openings.create({ customerId: p.id, transDate: '2025-06-26', bankAmt: 300, cashAmt: 0, drCr: 'CREDIT' }, 'Tester');
  await bill(p, 'SW-01JAN', '2026-01-01', 200);
  await prisma.$transaction((tx) => svc.applyOnAccount(tx, p.id));
  assert.equal((await prisma.acctPaymentReceipt.aggregate({ where: { invNo: 'SW-01JAN' }, _sum: { recAmt: true } }))._sum.recAmt, 200);
  await openings.update(o.id, { customerId: p.id, transDate: '2025-06-26', bankAmt: 300, cashAmt: 0, drCr: 'DEBIT' });
  assert.equal(await prisma.acctPaymentReceipt.count({ where: { invNo: 'SW-01JAN' } }), 0, 'the bill is unpaid again');
});

test('a named receipt whose bills are all paid is still refused when typed in', async () => {
  const p = await party('REFUSE CO');
  await bill(p, 'R-01JAN', '2026-01-01');
  await receive(p, '2026-01-02', 100);
  await assert.rejects(receive(p, '2026-01-05', 100, { adjMode: 'AGST REF', selectedInvNos: ['R-01JAN'] }), /AGST REF/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`);
    }
  }
  await prisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
