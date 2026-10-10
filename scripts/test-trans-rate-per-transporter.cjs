// A party holds one transport rate per (category, type) PER TRANSPORTER. Adding a
// second transporter's rate must ADD a row, never overwrite the first transporter's.
// Isolated fixture DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-trans-rate-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.split(String.fromCharCode(92)).join('/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { TransRatesService } = require('../apps/api/src/trans-rates/trans-rates.service.ts');

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
const svc = new TransRatesService(prisma);

(async () => {
  let failed = false;
  try {
    const PARTY = 'PNB';
    await prisma.customer.create({ data: { id: 1, partyName: PARTY } });
    await prisma.transporter.create({ data: { id: 10, name: 'BEST ROADWAYS' } });
    await prisma.transporter.create({ data: { id: 22, name: 'BHOOMI TRANSPORT' } });

    await svc.bulkUpsert({ customerName: PARTY, rates: [{ category: 'CUP', type: 'PACKING', transportName: 'BEST ROADWAYS', rate: 250 }] });
    await svc.bulkUpsert({ customerName: PARTY, rates: [{ category: 'CUP', type: 'PACKING', transportName: 'BHOOMI TRANSPORT', rate: 200 }] });

    const rows = await prisma.transRate.findMany({ where: { customerName: PARTY, category: 'CUP', type: 'PACKING' }, orderBy: { id: 'asc' } });
    assert.equal(rows.length, 2, 'the second transporter must ADD a row, not overwrite the first');
    assert.deepEqual(
      rows.map((r) => [r.transportName, r.rate]),
      [['BEST ROADWAYS', 250], ['BHOOMI TRANSPORT', 200]],
      'both transporters keep their own rate',
    );
    console.log('PASS a second transporter adds a row; the first keeps its rate');

    await svc.bulkUpsert({ customerName: PARTY, rates: [{ category: 'CUP', type: 'PACKING', transportName: 'BHOOMI TRANSPORT', rate: 90 }] });
    const after = await prisma.transRate.findMany({ where: { customerName: PARTY, category: 'CUP', type: 'PACKING' }, orderBy: { id: 'asc' } });
    assert.equal(after.length, 2, 're-saving the same transporter updates in place');
    assert.deepEqual(after.map((r) => [r.transportName, r.rate]), [['BEST ROADWAYS', 250], ['BHOOMI TRANSPORT', 90]]);
    console.log('PASS re-saving one transporter updates only its own row');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.stack ?? e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})();
