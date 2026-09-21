// Bank Reco's Process must collect money the same way Receive Payment does.
// Reproduces ROOPI (B KUMAR): a party whose BANK money comes through an agent,
// whose statement line could never be posted because Process always said PARTY.
// Isolated SQLite fixture — never reads or writes dev.db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-bank-process-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { BankStatementService } = require('../apps/api/src/bank-statement/bank-statement.service.ts');
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
const svc = new BankStatementService(prisma, payments);

let nextId = 1;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

async function party(partyName, payBy, agentName = null) {
  return prisma.customer.create({ data: { id: nextId++, partyName, payBy, agentName } });
}
async function bill(customer, code, amount, day = '2026-08-01') {
  return prisma.challan.create({
    data: {
      code, prefix: 'SSS', invDate: new Date(day), customerId: customer.id, customerName: customer.partyName,
      challanStatus: 'CONFIRMED', b: amount, c: 0, total: amount,
    },
  });
}
/** A run with one unmatched credit for that party, ready for Process. */
async function runWithRow(customer, amount, day = '2026-08-11') {
  const run = await prisma.bankStatementRun.create({
    data: {
      fileName: 'AcctStatement.csv', bankName: 'AXIS BANK', status: 'DRAFT',
      fromDate: new Date('2026-04-01'), toDate: new Date('2026-08-27'),
    },
  });
  const row = await prisma.bankStatementRow.create({
    data: {
      runId: run.id, rowNo: 1, txnDate: new Date(day), narration: `NEFT/${customer.partyName}`,
      amount, customerId: customer.id, customerName: customer.partyName, partySource: 'NARRATION',
      status: 'UNMATCHED', matchedAmount: 0, rowKey: `${day}|${amount}|${customer.id}`,
    },
  });
  return { run, row };
}

test('an agent-routed party posts, instead of failing with advice this screen cannot take', async () => {
  const p = await party('ROOPI (B KUMAR)', 'AGENT', 'B KUMAR');
  await bill(p, 'SSS/AG1', 95800);
  const { run, row } = await runWithRow(p, 95800);

  const res = await svc.process(run.id, 'Tester');
  assert.deepEqual(res.failed, [], 'the line must post, not report an error the operator cannot act on');
  assert.equal(res.created.length, 1);
  assert.equal(res.created[0].amount, 95800);

  // Taken on the AGENT, exactly as Receive Payment would have recorded it.
  const led = await prisma.acctLedger.findFirst({ where: { voucherNo: res.created[0].voucherNo } });
  assert.equal(led.takeAccOn, 'AGENT');
  assert.equal(led.agentName, 'B KUMAR');
  assert.equal(led.bankCredit, 95800);
  assert.equal((await prisma.bankStatementRow.findUnique({ where: { id: row.id } })).status, 'POSTED');
});

test('an ordinary party is still taken on the party', async () => {
  const p = await party('DIRECT METALS', 'PARTY');
  await bill(p, 'SSS/PT1', 40000);
  const { run } = await runWithRow(p, 40000);

  const res = await svc.process(run.id, 'Tester');
  assert.deepEqual(res.failed, []);
  const led = await prisma.acctLedger.findFirst({ where: { voucherNo: res.created[0].voucherNo } });
  assert.equal(led.takeAccOn, 'PARTY');
  assert.equal(led.custId, p.id);
});

test('agent routing set with no agent named says what to fix', async () => {
  const p = await party('NO AGENT SET', 'AGENT', null);
  await bill(p, 'SSS/NA1', 1000);
  const { run } = await runWithRow(p, 1000);

  const res = await svc.process(run.id, 'Tester');
  assert.equal(res.created.length, 0);
  assert.equal(res.failed.length, 1);
  assert.match(res.failed[0].reason, /no agent is named/i);
  assert.match(res.failed[0].reason, /PAY BY/i, 'the message must name the setting to change');
});

test('a per-bucket override decides it, not the headline PAY BY', async () => {
  // payByModes overrides payBy for one bucket — the same rule Receive Payment
  // resolves through payByFor(). Bank money via agent, cash direct.
  const p = await prisma.customer.create({
    data: { id: nextId++, partyName: 'SPLIT ROUTING', payBy: 'PARTY', agentName: 'B KUMAR', payByModes: JSON.stringify({ bank: 'AGENT', cash: 'PARTY' }) },
  });
  await bill(p, 'SSS/SP1', 12000);
  const { run } = await runWithRow(p, 12000);

  const res = await svc.process(run.id, 'Tester');
  assert.deepEqual(res.failed, [], 'the bank override must be honoured');
  const led = await prisma.acctLedger.findFirst({ where: { voucherNo: res.created[0].voucherNo } });
  assert.equal(led.takeAccOn, 'AGENT');
});

test('Process refreshes a receipt entered after the screen loaded without duplicating it', async () => {
  const p = await party('LATE RECEIPT', 'PARTY');
  const { run, row } = await runWithRow(p, 1500);
  await payments.save({ takeAccOn: 'PARTY', customerId: p.id, payMode: 'BANK', bankName: 'AXIS BANK', adjMode: 'AUTOMATIC', receiptAmt: 1500, recDate: '2026-08-11' }, 'Tester');
  const before = await prisma.acctLedger.count();
  const res = await svc.process(run.id, 'Tester');
  assert.equal(res.created.length, 0);
  assert.equal(await prisma.acctLedger.count(), before);
  assert.equal((await prisma.bankStatementRow.findUnique({ where: { id: row.id } })).status, 'MATCHED');
});

test('concurrent Process requests create only one receipt', async () => {
  const p = await party('DOUBLE CLICK', 'PARTY');
  const { run } = await runWithRow(p, 1700);
  const results = await Promise.all([svc.process(run.id, 'Tester'), svc.process(run.id, 'Tester')]);
  assert.equal(results.reduce((sum, r) => sum + r.created.length, 0), 1);
  assert.equal(await prisma.acctLedger.count({ where: { custId: p.id, voucherType: 'RECEIPT' } }), 1);
});

test('a failed statement link rolls back the receipt and allocations', async () => {
  const p = await party('ATOMIC POST', 'PARTY');
  await bill(p, 'SSS/ATOMIC', 2100);
  const { run, row } = await runWithRow(p, 2100);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_statement_link BEFORE UPDATE ON bank_statement_row WHEN NEW.id = ${row.id} AND NEW.status = 'POSTED' BEGIN SELECT RAISE(ABORT, 'fixture link failure'); END`);
  try {
    const res = await svc.process(run.id, 'Tester');
    assert.equal(res.created.length, 0);
    assert.equal(res.failed.length, 1);
    assert.equal(await prisma.acctLedger.count({ where: { custId: p.id } }), 0);
    assert.equal(await prisma.acctPaymentReceipt.count({ where: { custId: p.id } }), 0);
    assert.equal((await prisma.bankStatementRow.findUnique({ where: { id: row.id } })).status, 'UNMATCHED');
  } finally { await prisma.$executeRawUnsafe('DROP TRIGGER reject_statement_link'); }
});

test('a replacement receipt covers a missing old link without a reopened warning', async () => {
  const p = await party('REPLACEMENT RECEIPT', 'PARTY');
  const { run, row } = await runWithRow(p, 1900);
  await prisma.bankStatementRow.update({ where: { id: row.id }, data: { status: 'POSTED', postedRef: 'RN/MISSING' } });
  await prisma.bankStatementRun.update({ where: { id: run.id }, data: { status: 'PROCESSED' } });
  await payments.save({ takeAccOn: 'PARTY', customerId: p.id, payMode: 'BANK', bankName: 'AXIS BANK', adjMode: 'AUTOMATIC', receiptAmt: 1900, recDate: '2026-08-11' }, 'Tester');
  const res = await svc.recheck(run.id);
  assert.deepEqual(res.reopened, []);
  assert.deepEqual(res.uncovered, []);
  assert.equal((await prisma.bankStatementRow.findUnique({ where: { id: row.id } })).status, 'MATCHED');
});

test('historical coverage changes cannot silently create another receipt', async () => {
  const p = await party('REVIEW OLD COVER', 'PARTY');
  const { run, row } = await runWithRow(p, 2800);
  await prisma.bankStatementRow.update({ where: { id: row.id }, data: { status: 'MATCHED', matchedAmount: 2800, matchedRefs: 'REC-OLD-REFERENCE' } });
  await svc.recheck(run.id);
  await svc.recheck(run.id);
  const res = await svc.process(run.id, 'Tester');
  assert.equal(res.created.length, 0);
  assert.match(res.failed[0].reason, /receipt review/i);
  assert.match((await prisma.bankStatementRow.findUnique({ where: { id: row.id } })).note, /REC-OLD-REFERENCE/);
  assert.equal(await prisma.acctLedger.count({ where: { custId: p.id } }), 0);
});

test('historical partial-post coverage cannot steal an earlier exact match', async () => {
  const p = await party('HISTORICAL DOUBLE COVER', 'PARTY');
  const earlier = await runWithRow(p, 4000);
  const later = await runWithRow(p, 10000, '2026-08-12');
  const old = await payments.save({ takeAccOn: 'PARTY', customerId: p.id, payMode: 'BANK', bankName: 'AXIS BANK', adjMode: 'AUTOMATIC', receiptAmt: 4000, recDate: '2026-08-11' }, 'Tester');
  const oldLedger = await prisma.acctLedger.findFirst({ where: { voucherNo: old.voucherNo } });
  const ref = oldLedger.receiptRefId || oldLedger.advanceRefId;
  const posted = await payments.save({ takeAccOn: 'PARTY', customerId: p.id, payMode: 'BANK', bankName: 'AXIS BANK', adjMode: 'AUTOMATIC', receiptAmt: 6000, recDate: '2026-08-12' }, 'Tester');
  await prisma.bankStatementRow.update({ where: { id: earlier.row.id }, data: { status: 'MATCHED', matchedAmount: 4000, matchedRefs: ref } });
  await prisma.bankStatementRow.update({ where: { id: later.row.id }, data: { status: 'POSTED', postedRef: posted.voucherNo, matchedAmount: 4000, matchedRefs: ref } });
  await svc.recheck(earlier.run.id);
  assert.equal((await prisma.bankStatementRow.findUnique({ where: { id: earlier.row.id } })).status, 'MATCHED');
  const checked = await prisma.bankStatementRow.findUnique({ where: { id: later.row.id } });
  assert.equal(checked.status, 'POSTED');
  assert.equal(checked.matchedAmount, 0);
  assert.match(checked.note, /Receipt review required/);
});

test('normal Receive Payments can still save, edit and delete a receipt', async () => {
  const p = await party('NORMAL RECEIVE PAYMENT', 'PARTY');
  await bill(p, 'SSS/NORMAL', 5000);
  const dto = { takeAccOn: 'PARTY', customerId: p.id, payMode: 'BANK', bankName: 'AXIS BANK', adjMode: 'AUTOMATIC', receiptAmt: 2000, recDate: '2026-08-11' };
  const saved = await payments.save(dto, 'Tester');
  let ledger = await prisma.acctLedger.findFirst({ where: { voucherNo: saved.voucherNo } });
  assert.equal(ledger.bankCredit, 2000);
  await payments.editReceipt(ledger.id, { ...dto, receiptAmt: 2500 }, 'Tester');
  ledger = await prisma.acctLedger.findFirst({ where: { voucherNo: saved.voucherNo } });
  assert.equal(ledger.bankCredit, 2500);
  await payments.deleteReceipt(ledger.id);
  assert.equal(await prisma.acctLedger.count({ where: { custId: p.id } }), 0);
  assert.equal(await prisma.acctPaymentReceipt.count({ where: { custId: p.id } }), 0);
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
