// A party ledger filtered to a past date shows every bill as it stood THEN, like
// Tally: a payment made after the window has not paid it yet (CHAITANYA RN/894,
// 22/09, on a 1/4–21/9 filter). Isolated SQLite fixture — never dev.db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-ledger-as-at-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { PaymentsService } = require('../apps/api/src/payments/payments.service.ts');
const { PartyLedgerService } = require('../apps/api/src/party-ledger/party-ledger.service.ts');

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
const ledger = new PartyLedgerService(prisma, {}, { evaluate: async () => ({ lists: [], parties: [] }) });

(async () => {
  let failed = false;
  try {
    const p = await prisma.customer.create({ data: { id: 1, partyName: 'AS AT FIXTURE', payBy: 'PARTY' } });
    await prisma.challan.create({ data: { code: 'T-01', prefix: 'SSS', invDate: new Date(2026, 6, 17), customerId: 1, customerName: p.partyName, challanStatus: 'CONFIRMED', b: 1000, c: 0, total: 1000 } });
    await prisma.challan.create({ data: { code: 'T-02', prefix: 'SSS', invDate: new Date(2026, 8, 25), customerId: 1, customerName: p.partyName, challanStatus: 'CONFIRMED', b: 500, c: 0, total: 500 } });
    await payments.save({ takeAccOn: 'PARTY', customerId: 1, payMode: 'BANK', bankName: 'AXIS BANK', adjMode: 'AUTOMATIC', receiptAmt: 1000, recDate: '2026-09-22' }, 'Tester');

    const past = await ledger.ledger({ customerId: 1, from: '2026-04-01', to: '2026-09-21', mode: 'B' });
    const row = past.rows.find((r) => r.voucherNo === 'T-01');
    assert.equal(row.status, 'D', 'the 22/09 payment had not paid it on 21/09');
    assert.equal(row.pendingAmount, 1000);
    const k = past.kpis;
    assert.equal(k.overDue.amount + k.pastDue.amount + k.normal.amount, 1000, 'the cards add up to the closing balance, without the 25/09 bill');
    assert.equal(past.footer.closingBankNet, 1000);

    const now = await ledger.ledger({ customerId: 1, from: '2026-04-01', to: '2099-12-31', mode: 'B' });
    assert.equal(now.rows.find((r) => r.voucherNo === 'T-01').status, 'F', 'today it is paid');
    console.log('PASS a past window shows bills as they stood then');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})();
