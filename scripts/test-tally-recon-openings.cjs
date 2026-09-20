// Adding an opening balance from the Tally report must store it exactly as one
// keyed into Opening Balances by hand -- and must refuse the cases where doing
// so would make the party's books wrong in a new way.
// Isolated SQLite fixture -- never reads or writes dev.db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-recon-openings-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { TallyReconService } = require('../apps/api/src/tally-recon/tally-recon.service.ts');
const { OpeningBalancesService } = require('../apps/api/src/opening-balances/opening-balances.service.ts');
const { PaymentsService } = require('../apps/api/src/payments/payments.service.ts');

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
const openings = new OpeningBalancesService(prisma);
const svc = new TallyReconService(prisma, new PaymentsService(prisma), openings);

let nextCust = 1;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

async function party(partyName) {
  return prisma.customer.create({ data: { id: nextCust++, partyName, payBy: 'PARTY' } });
}
async function run() {
  return prisma.tallyReconRun.create({ data: { fileName: 'Master.xlsx', fromDate: new Date('2026-04-01'), toDate: new Date('2026-09-04') } });
}
/** One OPENING line of the report. */
async function openingRow(runId, customer, { dr = 0, cr = 0, omsAmount = null, status = 'AMOUNT_MISMATCH' } = {}) {
  return prisma.tallyReconRow.create({
    data: {
      runId, source: 'TALLY', ledgerName: customer?.partyName ?? 'UNMAPPED LEDGER',
      customerId: customer?.id ?? null, customerName: customer?.partyName ?? null,
      txnDate: new Date('2026-04-01'), vchType: 'OPENING', vchNo: 'Opening Balance',
      particulars: 'Opening Balance', dr, cr, status, omsAmount,
      issueKey: `opening|${customer?.id ?? 0}|${dr}|${cr}|${Math.random()}`,
    },
  });
}
const openingsOf = (custId) => prisma.acctOpeningTrans.findMany({ where: { custId, kind: 'OPENING' } });

test('a debit opening OMS never received is created, on the bank side', async () => {
  const p = await party('ABHISHEK ENTERPRISE');
  const r = await run();
  const row = await openingRow(r.id, p, { dr: 3562 });

  const res = await svc.createOpenings({ rowIds: [row.id] }, 'Tester');
  assert.deepEqual(res.failed, []);
  assert.equal(res.created.length, 1);
  assert.equal(res.created[0].amount, 3562);
  assert.equal(res.created[0].drCr, 'DEBIT');

  const [made] = await openingsOf(p.id);
  assert.equal(made.bankAmt, 3562, 'the register is the bank leg');
  assert.equal(made.cashAmt, 0);
  assert.equal(made.drCr, 'DEBIT');
  assert.equal(made.customerName, 'ABHISHEK ENTERPRISE');

  // The row itself stops flagging, and says what happened to it.
  const after = await prisma.tallyReconRow.findUnique({ where: { id: row.id } });
  assert.equal(after.status, 'MATCHED');
  assert.equal(after.review, 'SOLVED');
  assert.equal(after.omsAmount, 3562);
  assert.ok(after.resolvedAt);
});

test('a credit opening keeps its side', async () => {
  const p = await party('CREDIT SIDE PARTY');
  const r = await run();
  const row = await openingRow(r.id, p, { cr: 1200 });
  const res = await svc.createOpenings({ rowIds: [row.id] }, 'Tester');
  assert.deepEqual(res.failed, []);
  const [made] = await openingsOf(p.id);
  assert.equal(made.drCr, 'CREDIT');
  assert.equal(made.bankAmt, 1200);
});

test('several rows go in together, each reported', async () => {
  const a = await party('BULK ONE');
  const b = await party('BULK TWO');
  const r = await run();
  const rows = [await openingRow(r.id, a, { dr: 240 }), await openingRow(r.id, b, { dr: 29171 })];
  const res = await svc.createOpenings({ rowIds: rows.map((x) => x.id) }, 'Tester');
  assert.equal(res.created.length, 2);
  assert.deepEqual(res.failed, []);
  assert.equal((await openingsOf(a.id))[0].bankAmt, 240);
  assert.equal((await openingsOf(b.id))[0].bankAmt, 29171);
});

test('a party OMS already has an opening for is refused', async () => {
  // Two openings that disagree is a difference to settle, not a row to add to.
  const p = await party('ALREADY HAS ONE');
  const r = await run();
  const row = await openingRow(r.id, p, { dr: 5000, omsAmount: 4000 });
  const res = await svc.createOpenings({ rowIds: [row.id] }, 'Tester');
  assert.equal(res.created.length, 0);
  assert.match(res.failed[0].reason, /already holds an opening/i);
  assert.equal((await openingsOf(p.id)).length, 0, 'nothing was written');
});

test('an unmapped ledger is refused, and says so', async () => {
  const r = await run();
  const row = await openingRow(r.id, null, { dr: 900, status: 'UNMATCHED_PARTY' });
  const res = await svc.createOpenings({ rowIds: [row.id] }, 'Tester');
  assert.equal(res.created.length, 0);
  assert.match(res.failed[0].reason, /No OMS customer is mapped/i);
});

test('the same row cannot be added twice', async () => {
  const p = await party('DOUBLE TAP');
  const r = await run();
  const row = await openingRow(r.id, p, { dr: 777 });
  await svc.createOpenings({ rowIds: [row.id] }, 'Tester');
  const again = await svc.createOpenings({ rowIds: [row.id] }, 'Tester');
  assert.equal(again.created.length, 0);
  assert.match(again.failed[0].reason, /Already added/i);
  assert.equal((await openingsOf(p.id)).length, 1, 'one opening, not two');
});

test('a row that is not an opening is refused', async () => {
  const p = await party('RECEIPT PARTY');
  const r = await run();
  const row = await prisma.tallyReconRow.create({
    data: {
      runId: r.id, source: 'TALLY', ledgerName: p.partyName, customerId: p.id, customerName: p.partyName,
      txnDate: new Date('2026-05-01'), vchType: 'RECEIPT', vchNo: '286', particulars: 'AXIS BANK LTD',
      dr: 0, cr: 5000, status: 'MISSING_IN_OMS', issueKey: 'receipt|286',
    },
  });
  const res = await svc.createOpenings({ rowIds: [row.id] }, 'Tester');
  assert.equal(res.created.length, 0);
  assert.match(res.failed[0].reason, /opening balance row/i);
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
