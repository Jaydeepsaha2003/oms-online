// Challan print tracking: a Print press counts one print (single or bulk), the
// list carries Printed xN / who / when, and 'Not printed' lists only unprinted ones.
// Isolated fixture DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-challan-print-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { ChallansService } = require('../apps/api/src/challans/challans.service.ts');

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
const stub = new Proxy({}, { get: () => () => {} });
const svc = new ChallansService(prisma, stub, stub, stub, stub, stub, stub, stub);
(async () => {
  let failed = false;
  try {
    const mk = (code) => prisma.challan.create({ data: { code, prefix: 'SSS', customerName: 'P', challanStatus: 'CONFIRMED', b: 100, c: 0, total: 100 } });
    const [a, b] = [await mk('SSS/26-27/1'), await mk('SSS/26-27/2')];
    const list = (q = {}) => svc.findMany({ page: 1, pageSize: 50, skip: 0, ...q });
    assert.equal((await list({ notPrinted: true })).total, 2, 'new challans start not printed');
    await svc.markPrinted([a.id], 'RAM');
    await svc.markPrinted([a.id, b.id], 'SITA');
    const rows = (await list()).items;
    const ra = rows.find((r) => r.id === a.id), rb = rows.find((r) => r.id === b.id);
    assert.equal(ra.printCount, 2); assert.equal(ra.lastPrintedBy, 'SITA'); assert.ok(ra.lastPrintedAt);
    assert.equal(rb.printCount, 1);
    console.log('PASS each press (single or bulk) counts one print, with who and when');
    assert.equal((await list({ notPrinted: true })).total, 0);
    const c = await mk('SSS/26-27/3');
    assert.deepEqual((await list({ notPrinted: true })).items.map((r) => r.id), [c.id]);
    console.log('PASS "Not printed" lists only challans never printed');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.stack ?? e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})();