// A credit note only settles bills on its OWN side of the books. Reproduces
// CN/20: a No Bill note raised against a billed invoice, which settled nothing
// and became a party advance without saying why.
// Isolated SQLite fixture — never reads or writes dev.db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-note-clearance-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { NotesService } = require('../apps/api/src/notes/notes.service.ts');
const { noteClearanceReason } = require('../packages/shared/dist/cjs/types/note.js');

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
const notes = new NotesService(prisma, {});

const PARTY = 'RAMSON FIXTURE';
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** A confirmed sale. `billed` decides which side of the books it lands on. */
async function sale(code, amount, billed, day = '2026-06-30') {
  return prisma.challan.create({
    data: {
      code, prefix: 'SSS', invDate: new Date(day), customerId: 1, customerName: PARTY,
      challanStatus: 'CONFIRMED', b: billed ? amount : 0, c: billed ? 0 : amount, total: amount, gst: 5,
      items: { create: [{ productName: '10 RDX', design: 'NA', kgs: 72.8, unit: 'KGS', price: 345, amount, pCategory: 'GLASS' }] },
    },
  });
}

const note = (items, extra = {}) => ({
  mode: 'CREDIT', invDate: '2026-07-20', customerId: 1, customerName: PARTY,
  items, noBill: false, ...extra,
});
const line = (refInvNo, kgs = 72.8, price = 345) => ({
  refInvNo, productName: '10 RDX', design: 'NA', kgs, unit: 'KGS', price, pCategory: 'GLASS', gstRate: 0, dispatchId: 0,
});

const clearedOn = (code) => prisma.acctPaymentReceipt.findMany({ where: { refRecId: code } });
const advanceOf = (code) => prisma.acctPartyAdvance.findMany({ where: { refRecId: code } });

test('a No Bill note against a billed invoice clears nothing and says why', async () => {
  await sale('SSS/A1', 53233, true);
  const res = await notes.save(note([line('SSS/A1')], { noBill: true, noBillWithoutGst: true }), 'Tester');
  const cl = res.clearance;
  assert.equal(cl.skipped, 'OTHER_SIDE', 'the reason must be reported, not left blank');
  assert.equal(cl.side, 'CASH');
  assert.ok(cl.dueOtherSide > 0, 'it must say how much is owed on the other side');
  // The old behaviour named the invoice after applying zero, which read as
  // "cleared against SSS/A1: ₹0" — the complaint that started this.
  assert.equal(cl.invNo, null, 'an untouched invoice must not be reported as cleared');
  assert.equal((await clearedOn(res.code)).length, 0);
  assert.equal((await advanceOf(res.code)).length, 1, 'the value is parked, not lost');
  const why = noteClearanceReason(cl);
  assert.match(why, /no-bill note/i);
  assert.match(why, /parked as an advance/i);
  assert.match(why, /SSS\/A1/);
});

test('a billed note against the same invoice does clear it', async () => {
  await sale('SSS/B1', 53233, true);
  const res = await notes.save(note([line('SSS/B1')]), 'Tester');
  const cl = res.clearance;
  assert.equal(cl.skipped, undefined);
  assert.equal(cl.invNo, 'SSS/B1');
  assert.ok(cl.bank > 0, 'a billed note settles the billed side');
  const recs = await clearedOn(res.code);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].invNo, 'SSS/B1');
  assert.equal(recs[0].payMode, 'BANK');
});

test('a No Bill note against a No Bill sale clears it', async () => {
  await sale('SSS/C1', 40000, false);
  const res = await notes.save(note([line('SSS/C1')], { noBill: true, noBillWithoutGst: true }), 'Tester');
  assert.equal(res.clearance.invNo, 'SSS/C1');
  assert.ok(res.clearance.cash > 0);
  assert.equal((await clearedOn(res.code))[0].payMode, 'CASH');
});

test('nothing outstanding at all is not reported as a side mismatch', async () => {
  // No sales for this party on either side, so there is no "other side" to name.
  const res = await notes.save(
    { ...note([line('')], { noBill: true, noBillWithoutGst: true }), customerId: 2, customerName: 'EMPTY FIXTURE' },
    'Tester',
  );
  assert.notEqual(res.clearance.skipped, 'OTHER_SIDE');
  assert.equal((await advanceOf(res.code)).length, 1);
});

test('the past-sale picker reports which side each sale was on', async () => {
  const rows = await notes.recentSold(1);
  const byInv = new Map(rows.map((r) => [r.invNo, r.billed]));
  assert.equal(byInv.get('SSS/A1'), true, 'a GST invoice is billed');
  assert.equal(byInv.get('SSS/C1'), false, 'a no-bill sale is not');
});

(async () => {
  let failures = 0;
  try {
    await prisma.customer.create({ data: { id: 1, partyName: PARTY, payBy: 'PARTY' } });
    await prisma.customer.create({ data: { id: 2, partyName: 'EMPTY FIXTURE', payBy: 'PARTY' } });
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
