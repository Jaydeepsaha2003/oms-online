// "Enter receipt" from the Tally reconciliation report must never write a
// second copy of money already in OMS, must collect an agent-routed party the
// way Receive Payment does, and must accept a cash line.
// Isolated SQLite fixture -- never reads or writes dev.db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-recon-receipts-'));
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
const payments = new PaymentsService(prisma);
const svc = new TallyReconService(prisma, payments, new OpeningBalancesService(prisma));

let nextCust = 1;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const party = (partyName, extra = {}) => prisma.customer.create({ data: { id: nextCust++, partyName, payBy: 'PARTY', ...extra } });
const run = () => prisma.tallyReconRun.create({ data: { fileName: 'Register.xlsx', fromDate: new Date('2026-04-01'), toDate: new Date('2026-09-09') } });
/** One "missing in OMS" receipt line of the report. */
const missingReceipt = (runId, customer, amount, day, particulars = 'AXIS BANK') =>
  prisma.tallyReconRow.create({
    data: {
      runId, source: 'TALLY', ledgerName: customer.partyName, customerId: customer.id, customerName: customer.partyName,
      txnDate: new Date(day), vchType: 'RECEIPT', vchNo: '135', particulars, dr: 0, cr: amount, status: 'MISSING_IN_OMS',
      issueKey: `r|${customer.id}|${amount}|${day}|${Math.random()}`,
    },
  });

test('money already in OMS under the agent is not entered again (BK METAL ₹95,800)', async () => {
  const roopi = await party('ROOPI (B KUMAR)', { payBy: 'AGENT', agentName: 'B KUMAR' });
  const bk = await party('BK METAL', { payBy: 'AGENT', agentName: 'B KUMAR' });
  await prisma.challan.create({ data: { code: 'BK/1', prefix: 'SSS', invDate: new Date('2026-05-01'), customerId: roopi.id, customerName: roopi.partyName, challanStatus: 'CONFIRMED', b: 95800, c: 0, total: 95800 } });
  const existing = await payments.save({ takeAccOn: 'AGENT', agentName: 'B KUMAR', payMode: 'BANK', bankName: 'AXIS BANK', adjMode: 'AUTOMATIC', receiptAmt: 95800, recDate: '2026-05-29' }, 'Tester');
  const r = await run();
  const row = await missingReceipt(r.id, bk, 95800, '2026-05-29');
  const res = await svc.createReceipts({ rowIds: [row.id] }, 'Tester');
  assert.equal(res.created.length, 0);
  assert.match(res.failed[0].reason, new RegExp(`${existing.voucherNo.replace('/', '\\/')} .* already in OMS under agent B KUMAR`));
  assert.equal(await prisma.acctLedger.count({ where: { voucherType: 'RECEIPT' } }), 1, 'still one receipt');
});

test('an agent-routed party with no such receipt is collected on its agent', async () => {
  const p = await party('RS STEEL (B KUMAR)', { payBy: 'AGENT', agentName: 'RAJ KUMAR' });
  const r = await run();
  const row = await missingReceipt(r.id, p, 12345, '2026-06-10');
  const res = await svc.createReceipts({ rowIds: [row.id] }, 'Tester');
  assert.equal(res.failed.length, 0, res.failed[0]?.reason);
  const led = await prisma.acctLedger.findFirst({ where: { voucherNo: res.created[0].voucherNo } });
  assert.equal(led.takeAccOn, 'AGENT');
  assert.equal(led.agentName, 'RAJ KUMAR');
});

test('a cash line from the register is entered as cash', async () => {
  const p = await party('CASH PARTY');
  const r = await run();
  const row = await missingReceipt(r.id, p, 5000, '2026-06-11', 'Cash');
  const res = await svc.createReceipts({ rowIds: [row.id] }, 'Tester');
  assert.equal(res.failed.length, 0, res.failed[0]?.reason);
  const led = await prisma.acctLedger.findFirst({ where: { voucherNo: res.created[0].voucherNo } });
  assert.equal(led.transMode, 'CASH');
  assert.equal(led.cashCredit, 5000);
});

test('the same row cannot be entered twice', async () => {
  const p = await party('TWICE CO');
  const r = await run();
  const row = await missingReceipt(r.id, p, 7000, '2026-07-01');
  await svc.createReceipts({ rowIds: [row.id] }, 'Tester');
  const again = await svc.createReceipts({ rowIds: [row.id] }, 'Tester');
  assert.equal(again.created.length, 0);
  assert.equal(await prisma.acctLedger.count({ where: { custId: p.id } }), 1);
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
