// A bank statement credit is only "already recorded" by what the bank actually
// paid in. Reproduces the RAMSON case (a ₹53,269 credit posted as ₹36,859) and
// the AMBIKA case that a narrower fix would have broken.
// Isolated SQLite fixture — never reads or writes dev.db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-bank-vouchers-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { BankStatementService } = require('../apps/api/src/bank-statement/bank-statement.service.ts');

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
const svc = new BankStatementService(prisma, {}, {});
const vouchers = (bank = 'AXIS BANK') => svc.receiptVouchers(1, new Date('2026-04-01'), new Date('2026-08-27'), bank);
const amountOf = async (refId, bank) => (await vouchers(bank)).find((v) => v.refId === refId)?.amount;

const PARTY = 'FIXTURE PARTY';
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** The receipt VOUCHER — one ledger row per receipt, carrying what the bank paid in. */
const voucher = (code, refId, bankCredit, date, bankName = 'AXIS BANK-8254') =>
  prisma.acctLedger.create({
    data: {
      voucherNo: code, transDate: new Date(date), customerName: PARTY, custId: 1,
      particulars: bankName, voucherType: 'RECEIPT', transMode: 'BANK',
      bankDebit: 0, cashDebit: 0, bankCredit, cashCredit: 0, receiptRefId: refId,
    },
  });

/** One allocation of that voucher. `via` says which pot funded it. */
const alloc = (refId, invNo, recAmt, date, via, bankName = 'AXIS BANK-8254') =>
  prisma.acctPaymentReceipt.create({
    data: {
      refId, invNo, recAmt, recDate: new Date(date),
      customerName: PARTY, custId: 1, recType: 'RECEIPT', payMode: 'BANK', bankName,
      modeOfAdj: via === 'ADVANCE' ? 'ADVANCE' : 'AUTOMATIC',
      refRecId: via === 'ADVANCE' ? 'ADV-0022' : via,
    },
  });

test('RAMSON: an advance re-applied later does not inflate the voucher', async () => {
  // ₹131,137 reached the bank. A ₹16,410 advance from March was spent off on the
  // same day, writing a fourth allocation row that never touched the account.
  await voucher('RN/591', 'REC-0504', 131137, '2026-06-07');
  await alloc('REC-0504', 'SSS/11', 86776, '2026-06-07', 'RN/591');
  await alloc('REC-0504', 'SSS/19', 26951, '2026-06-07', 'RN/591');
  await alloc('REC-0504', 'SSS/29', 17410, '2026-06-07', 'RN/591');
  await alloc('REC-0504', 'SSS/11', 16410, '2026-06-07', 'ADVANCE');

  assert.equal(await amountOf('REC-0504'), 131137, 'the voucher is worth what the bank paid in');
  assert.notEqual(await amountOf('REC-0504'), 147547, 'the allocation sum over-counts by the advance');
});

test('AMBIKA: real money settled from an advance still counts', async () => {
  // ₹67,204 DID arrive on 3 Aug (RN/693). It was allocated out of an older
  // advance and the new money parked as a fresh advance — so the only allocation
  // row is marked ADVANCE. Dropping those rows would have unmatched a genuine
  // credit and invited a duplicate receipt.
  await voucher('RN/693', 'REC-0607', 67204, '2026-08-03');
  await alloc('REC-0607', 'SSS/232', 67204, '2026-08-03', 'ADVANCE');
  assert.equal(await amountOf('REC-0607'), 67204, 'the bank still received this');
});

test('money left over as an advance is still money received', async () => {
  // Allocating less than arrived used to under-report the voucher, which showed
  // up as a shortfall that did not exist.
  await voucher('RN/700', 'REC-0420', 1106705, '2026-07-01');
  await alloc('REC-0420', 'SSS/40', 523753, '2026-07-01', 'RN/700');
  assert.equal(await amountOf('REC-0420'), 1106705);
});

test('an ordinary receipt is unchanged', async () => {
  await voucher('RN/710', 'REC-0600', 53269, '2026-07-05');
  await alloc('REC-0600', 'SSS/50', 40000, '2026-07-05', 'RN/710');
  await alloc('REC-0600', 'SSS/51', 13269, '2026-07-05', 'RN/710');
  assert.equal(await amountOf('REC-0600'), 53269);
});

test('a voucher that brought in no bank money offers no cover', async () => {
  await voucher('RN/720', 'REC-0800', 0, '2026-07-10');
  await alloc('REC-0800', 'SSS/60', 9000, '2026-07-10', 'ADVANCE');
  assert.equal(await amountOf('REC-0800'), undefined);
});

test('the bank filter still applies', async () => {
  await voucher('RN/730', 'REC-0900', 5000, '2026-07-20', 'ICICI BANK');
  await alloc('REC-0900', 'SSS/70', 5000, '2026-07-20', 'RN/730', 'ICICI BANK LTD');
  assert.equal(await amountOf('REC-0900', 'AXIS BANK'), undefined, 'ICICI money cannot cover an Axis credit');
  assert.equal(await amountOf('REC-0900', 'ICICI BANK'), 5000);
});

test('a receipt entirely parked as advance is discoverable without invoice allocations', async () => {
  const row = await voucher('RN/ADVANCE', null, 22109, '2026-07-22');
  await prisma.acctLedger.update({ where: { id: row.id }, data: { advanceRefId: 'ADV-ONLY', bankName: 'AXIS BANK-8254' } });
  assert.equal(await amountOf('ADV-ONLY'), 22109);
});

test('explicit account numbers cannot match a different account of the same bank', async () => {
  const row = await voucher('RN/ACCOUNT', 'REC-ACCOUNT', 777, '2026-07-23');
  await prisma.acctLedger.update({ where: { id: row.id }, data: { bankName: 'AXIS BANK-0884' } });
  await alloc('REC-ACCOUNT', 'SSS/ACCOUNT', 777, '2026-07-23', 'RN/ACCOUNT', 'AXIS BANK-0884');
  assert.equal(await amountOf('REC-ACCOUNT', 'AXIS BANK-8254'), undefined);
});

(async () => {
  let failures = 0;
  try {
    for (const [name, fn] of tests) {
      try { await fn(); console.log(`PASS ${name}`); }
      catch (e) { failures++; console.error(`FAIL ${name}: ${e.message}`); }
    }
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`${tests.length - failures}/${tests.length} passed`);
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
