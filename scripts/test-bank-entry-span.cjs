// A statement's entry span: first/last dated line inside the chosen range, debits
// included — its declared 'To' can run past the last entry. Isolated fixture DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-bank-entry-span-'));
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
const svc = new BankStatementService(prisma, new PaymentsService(prisma));

(async () => {
  let failed = false;
  try {
    const res = await svc.create({
      onDuplicate: 'import', fileName: 'axis.csv', bankName: 'AXIS BANK', fromDate: '2026-09-17', toDate: '2026-09-30',
      map: { date: 'Date', narration: 'Narration', credit: 'Credit', debit: 'Debit' },
      rows: [
        { Date: '16-09-2026', Narration: 'NEFT/OUTSIDE RANGE', Credit: '500', Debit: '' },
        { Date: '18-09-2026', Narration: 'NEFT/STARLINES', Credit: '1000', Debit: '' },
        { Date: '25-09-2026', Narration: 'NEFT/RAMSON', Credit: '2000', Debit: '' },
        { Date: '29-09-2026', Narration: 'AUTOBPAY/ELECTRICITY', Credit: '', Debit: '900' },
      ],
    }, 'T');
    const run = res.run;
    const local = (iso) => new Date(iso).toLocaleDateString('en-CA');
    assert.equal(local(run.firstEntry), '2026-09-18');
    assert.equal(local(run.lastEntry), '2026-09-29', 'a debit-only last day still counts; the declared To (30-09) does not');
    assert.equal(local(run.toDate), '2026-09-30');
    console.log('PASS entries span 18-09 -> 29-09 inside a 17-09..30-09 statement, debits included');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.stack ?? e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})();