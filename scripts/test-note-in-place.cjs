// A note saved late but dated in the past takes its place among the receipts:
// a credit note / purchase clears its own bill and the receipt that had paid it
// moves on to the next bills; nothing parks as an advance while bills are open
// (CHAITANYA CN/23). A debit note is paid in date order too, and deleting a note
// hands its bills back to the receipts. Isolated SQLite fixture — never dev.db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-note-in-place-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { PaymentsService } = require('../apps/api/src/payments/payments.service.ts');
const { NotesService } = require('../apps/api/src/notes/notes.service.ts');

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
const payments = new PaymentsService(prisma);
const notes = new NotesService(prisma, {}, payments);

let nextId = 1;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const party = (partyName) => prisma.customer.create({ data: { id: nextId++, partyName, payBy: 'PARTY' } });
const bill = (p, code, day, amount = 1000) =>
  prisma.challan.create({ data: { code, prefix: 'SSS', invDate: new Date(day), customerId: p.id, customerName: p.partyName, challanStatus: 'CONFIRMED', b: amount, c: 0, total: amount } });
const receive = (p, day, amount) =>
  payments.save({ takeAccOn: 'PARTY', customerId: p.id, payMode: 'BANK', bankName: 'AXIS BANK', adjMode: 'AUTOMATIC', receiptAmt: amount, recDate: day }, 'Tester');
// A no-GST line so the note's B is exactly `amount`.
const note = (p, mode, day, ref, amount = 1000, code) =>
  notes.save(
    { mode, code, invDate: day, customerId: p.id, customerName: p.partyName, noBill: false, items: [{ refInvNo: ref, productName: 'X', kgs: 1, unit: 'KGS', price: amount, gstRate: 0, dispatchId: 0 }] },
    'Tester',
  );
/** Bank still owed per bill. */
async function open(p) {
  const bills = await prisma.challan.findMany({ where: { customerId: p.id, challanStatus: 'CONFIRMED' }, orderBy: { invDate: 'asc' } });
  const out = {};
  for (const b of bills) {
    const paid = (await prisma.acctPaymentReceipt.aggregate({ where: { invNo: b.code, payMode: 'BANK' }, _sum: { recAmt: true } }))._sum.recAmt ?? 0;
    out[b.code] = Math.round((b.b ?? 0) - paid);
  }
  return out;
}
async function unusedAdvance(p) {
  const advs = await prisma.acctPartyAdvance.findMany({ where: { custId: p.id } });
  let left = 0;
  for (const a of advs) left += a.bankAmt - ((await prisma.acctPaymentReceipt.aggregate({ where: { refRecId: a.refId }, _sum: { recAmt: true } }))._sum.recAmt ?? 0);
  return Math.round(left);
}

test('a back-dated credit note clears its own bill; the receipt moves on to the next bill', async () => {
  const p = await party('CHAITANYA FIXTURE');
  await bill(p, 'A-01', '2026-07-01');
  await bill(p, 'A-05', '2026-07-05');
  await bill(p, 'A-10', '2026-07-10');
  await receive(p, '2026-07-15', 2000); // pays A-01 and A-05
  const res = await note(p, 'CREDIT', '2026-07-06', 'A-05');
  assert.equal(res.clearance.invNo, 'A-05', 'the note cleared the bill it names');
  assert.deepEqual(await open(p), { 'A-01': 0, 'A-05': 0, 'A-10': 0 });
  assert.equal(await unusedAdvance(p), 0, 'no advance while the party owes');
});

test('a purchase does the same', async () => {
  const p = await party('PURCHASE FIXTURE');
  await bill(p, 'P-01', '2026-07-01');
  await bill(p, 'P-10', '2026-07-10');
  await receive(p, '2026-07-15', 1000); // pays P-01
  await note(p, 'PURCHASE', '2026-07-02', 'P-01');
  assert.deepEqual(await open(p), { 'P-01': 0, 'P-10': 0 });
  assert.equal(await unusedAdvance(p), 0);
});

test('credit left over after its bill pays the next open bill, not an advance', async () => {
  const p = await party('SPILL FIXTURE');
  await bill(p, 'S-01', '2026-07-01', 500);
  await bill(p, 'S-20', '2026-07-20', 1000);
  await note(p, 'CREDIT', '2026-07-05', 'S-01', 800); // 300 more than S-01
  assert.deepEqual(await open(p), { 'S-01': 0, 'S-20': 700 });
  assert.equal(await unusedAdvance(p), 0);
});

test('deleting the note gives the bills back to the receipt', async () => {
  const p = await party('DELETE FIXTURE');
  await bill(p, 'D-01', '2026-07-01');
  await bill(p, 'D-05', '2026-07-05');
  await bill(p, 'D-10', '2026-07-10');
  await receive(p, '2026-07-15', 2000);
  const res = await note(p, 'CREDIT', '2026-07-06', 'D-05');
  await notes.remove('CREDIT', res.code);
  assert.deepEqual(await open(p), { 'D-01': 0, 'D-05': 0, 'D-10': 1000 }, 'as before the note');
  assert.equal(await unusedAdvance(p), 0);
});

test('a back-dated debit note is paid in date order by the later receipt', async () => {
  const p = await party('DEBIT FIXTURE');
  await bill(p, 'N-01', '2026-07-01');
  await bill(p, 'N-10', '2026-07-10');
  await receive(p, '2026-07-15', 2000); // pays N-01 and N-10
  const dn = await note(p, 'DEBIT', '2026-07-05', 'N-01');
  const o = await open(p);
  assert.equal(o['N-01'], 0);
  assert.equal(o[dn.code], 0, 'the older debit note is paid before the newer bill');
  assert.equal(o['N-10'], 1000);
  await notes.remove('DEBIT', dn.code);
  assert.deepEqual(await open(p), { 'N-01': 0, 'N-10': 0 }, 'deleting it hands the money back to the newer bill');
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
