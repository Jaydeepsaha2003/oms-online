// A deleted receipt stays traceable: when, by whom, the optional reason, and
// what it was (party, date, amount, mode) — read back from the audit log.
// Isolated SQLite fixture — never dev.db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-deleted-receipts-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
require('reflect-metadata');
const { PrismaClient } = require('@prisma/client');
const { PaymentsService } = require('../apps/api/src/payments/payments.service.ts');
const { PaymentsController } = require('../apps/api/src/payments/payments.controller.ts');
const { AUDIT_KEY } = require('../apps/api/src/common/decorators/audit.decorator.ts');

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

(async () => {
  let failed = false;
  try {
    await prisma.customer.create({ data: { id: 1, partyName: 'DELETE FIXTURE', payBy: 'PARTY' } });
    const saved = await payments.save({ takeAccOn: 'PARTY', customerId: 1, payMode: 'BANK', bankName: 'AXIS BANK', adjMode: 'AUTOMATIC', receiptAmt: 1500, recDate: '2026-09-22' }, 'Tester');
    const row = await prisma.acctLedger.findFirst({ where: { voucherNo: saved.voucherNo } });
    const res = await payments.deleteReceipts([row.id]);
    assert.deepEqual(res.receipts.map((r) => [r.voucherNo, r.customerName, r.amount, r.mode]), [[saved.voucherNo, 'DELETE FIXTURE', 1500, 'BANK']]);

    // What the audit interceptor writes for this route, with the comment typed in.
    const audit = Reflect.getMetadata(AUDIT_KEY, PaymentsController.prototype.removeMany);
    const entry = audit.describe(res, { body: { ids: [row.id], reason: '  typed twice by mistake ' } });
    await prisma.auditLog.create({ data: { action: 'delete', resource: 'payment', statusCode: 201, userEmail: 'tester@x', description: entry.description, metadata: JSON.stringify(entry.metadata) } });

    const [d] = await payments.deletedReceipts();
    assert.equal(d.voucherNo, saved.voucherNo);
    assert.equal(d.reason, 'typed twice by mistake');
    assert.equal(d.customerName, 'DELETE FIXTURE');
    assert.equal(d.amount, 1500);
    assert.equal(d.deletedBy, 'tester@x');
    assert.ok(d.deletedAt);
    console.log('PASS a deleted receipt is kept with its time, user, reason and details');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})();
