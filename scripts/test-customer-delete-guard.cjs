// A customer with bills, orders or receipts cannot be deleted (VEER ENTERPRISE's
// open bill NB/53 was orphaned that way). One with no history still deletes.
// Isolated fixture DB — never dev.db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-cust-delete-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { CustomersService } = require('../apps/api/src/customers/customers.service.ts');

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
const svc = new CustomersService(prisma);

(async () => {
  let failed = false;
  try {
    const used = await prisma.customer.create({ data: { partyName: 'VEER FIXTURE' } });
    await prisma.challan.create({ data: { code: 'NB/1', prefix: 'NB', invDate: new Date(), customerId: used.id, customerName: used.partyName, challanStatus: 'CONFIRMED', b: 0, c: 14300, total: 14300 } });
    await assert.rejects(svc.remove(used.id), /cannot be deleted.*Inactive/);
    assert.ok(await prisma.customer.findUnique({ where: { id: used.id } }), 'the party is still there');
    console.log('PASS a party with a bill cannot be deleted');

    const unused = await prisma.customer.create({ data: { partyName: 'NEVER USED' } });
    await svc.remove(unused.id);
    assert.equal(await prisma.customer.findUnique({ where: { id: unused.id } }), null);
    console.log('PASS a party with no history still deletes');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.stack ?? e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})();
