// Guards that keep payments attached to the bills they paid:
//  - a paid bill cannot change its money fields or be cancelled/deleted
//  - a bill paid only from money on account can change; the money re-applies
//  - saving a bill settles it from the party's money on account
//  - renaming a party carries its bills along (Receive Payment finds bills by name)
//  - Bank Reco will not post a second receipt over one typed under the agent
// Isolated SQLite fixture -- never reads or writes dev.db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-payment-guards-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { PaymentsService } = require('../apps/api/src/payments/payments.service.ts');
const { ChallansService } = require('../apps/api/src/challans/challans.service.ts');
const { CustomersService } = require('../apps/api/src/customers/customers.service.ts');
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
const payments = new PaymentsService(prisma);
const challans = new ChallansService(
  prisma,
  {},
  { emitPendingChallansChanged() {} },
  { getTcsPercent: async () => ({ tcsPercent: 0 }) },
  { rebuildForChallan: async () => 0 },
  { activeLockOwners: async () => new Map() },
  payments,
);
const customers = new CustomersService(prisma);
const bank = new BankStatementService(prisma, payments);

let nextId = 1;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

async function party(partyName, extra = {}) {
  return prisma.customer.create({ data: { id: nextId++, partyName, payBy: 'PARTY', ...extra } });
}
const billDto = (p, day, amount, extra = {}) => ({
  customerId: p.id, customerName: p.partyName, invDate: day, b: amount, c: 0, total: amount, challanStatus: 'CONFIRMED', items: [], ...extra,
});
function receive(p, day, amount) {
  return payments.save({ takeAccOn: 'PARTY', customerId: p.id, payMode: 'BANK', bankName: 'AXIS BANK', adjMode: 'AUTOMATIC', receiptAmt: amount, recDate: day }, 'Tester');
}

test('a paid bill cannot change its amount, be cancelled or be deleted', async () => {
  const p = await party('PAID BILL CO');
  const b = await challans.create(billDto(p, '2026-01-01', 1000, { code: 'PB/1' }));
  const r = await receive(p, '2026-01-05', 1000);
  await assert.rejects(challans.update(b.id, billDto(p, '2026-01-01', 900)), new RegExp(`PB/1 already has payments against it \\(${r.voucherNo}\\)`));
  await assert.rejects(challans.updateStatus(b.id, 'CANCELLED'), /already has payments/);
  await assert.rejects(challans.remove(b.id), /already has payments/);
  // A change that leaves the money alone is still fine.
  await challans.update(b.id, billDto(p, '2026-01-01', 1000, { remarks: 'CALL BEFORE DELIVERY' }));
  assert.equal((await prisma.acctPaymentReceipt.aggregate({ where: { invNo: 'PB/1' }, _sum: { recAmt: true } }))._sum.recAmt, 1000);
});

test('saving a bill settles it from money already on account, dated on the bill', async () => {
  const p = await party('ON ACCOUNT CO');
  const r = await receive(p, '2026-02-01', 1000); // no bills yet: all on account
  await challans.create(billDto(p, '2026-02-05', 400, { code: 'OA/1' }));
  const row = await prisma.acctPaymentReceipt.findFirst({ where: { invNo: 'OA/1' } });
  assert.equal(row.recAmt, 400);
  assert.equal(row.sourceVoucherNo, r.voucherNo);
  assert.equal(row.recDate.toISOString().slice(0, 10), '2026-02-05');
});

test('a bill paid only from money on account can still be corrected; the money re-applies', async () => {
  const p = await party('CORRECTABLE CO');
  await receive(p, '2026-03-01', 1000);
  const b = await challans.create(billDto(p, '2026-03-05', 400, { code: 'CR/1' }));
  await challans.update(b.id, billDto(p, '2026-03-05', 450));
  const rows = await prisma.acctPaymentReceipt.findMany({ where: { invNo: 'CR/1' } });
  assert.equal(rows.reduce((s, r) => s + r.recAmt, 0), 450, 'settled at the corrected amount, not 400 + 450');
  await challans.remove(b.id);
  assert.equal(await prisma.acctPaymentReceipt.count({ where: { invNo: 'CR/1' } }), 0, 'deleting it hands the money back to on account');
});

test('renaming a party carries its bills, so Receive Payment still sees them', async () => {
  const p = await party('OLD NAME TRADERS');
  await challans.create(billDto(p, '2026-04-01', 700, { code: 'RN-B/1' }));
  await customers.update(p.id, { partyName: 'NEW NAME TRADERS', payBy: 'PARTY' });
  const ctx = await payments.context({ customerId: p.id, recDate: '2026-04-10', payMode: 'BANK' });
  assert.deepEqual(ctx.invoices.map((i) => i.invNo), ['RN-B/1']);
});

test('Bank Reco will not post a second receipt over one typed under the agent', async () => {
  const roopi = await party('ROOPI (B KUMAR)', { payBy: 'AGENT', agentName: 'B KUMAR' });
  const bk = await party('BK METAL', { payBy: 'AGENT', agentName: 'B KUMAR' });
  await challans.create(billDto(roopi, '2026-05-01', 95800, { code: 'BK/1' }));
  // Typed by hand, under the agent, before the statement came in.
  const typed = await payments.save({ takeAccOn: 'AGENT', agentName: 'B KUMAR', payMode: 'BANK', bankName: 'AXIS BANK', adjMode: 'AUTOMATIC', receiptAmt: 95800, recDate: '2026-05-29' }, 'Tester');
  const run = await prisma.bankStatementRun.create({ data: { fileName: 'AcctStatement.csv', bankName: 'AXIS BANK', status: 'DRAFT', fromDate: new Date('2026-05-01'), toDate: new Date('2026-05-31') } });
  const row = await prisma.bankStatementRow.create({
    data: { runId: run.id, rowNo: 1, txnDate: new Date('2026-05-29'), narration: 'NEFT/B K METAL', amount: 95800, customerId: bk.id, customerName: bk.partyName, partySource: 'NARRATION', status: 'UNMATCHED', matchedAmount: 0, rowKey: 'bk|95800' },
  });
  const res = await bank.process(run.id, 'Tester');
  assert.equal(res.created.length, 0, 'no second receipt');
  assert.match(res.failed[0].reason, new RegExp(`${typed.voucherNo.replace('/', '\\/')} .* may be this same payment`));
  // Ticked on its own, it is a deliberate different payment and posts.
  const again = await bank.process(run.id, 'Tester', [row.id]);
  assert.equal(again.created.length, 1);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${String(e.stack ?? e.message).split('\n').slice(0, 6).join('\n     ')}`);
    }
  }
  await prisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
