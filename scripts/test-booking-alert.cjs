// A CUP bag booking alerts the floor (new-order audience, not the person who made it);
// a booking with no cup line does not. Isolated fixture DB; the notifier is stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-booking-alert-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { BookingsService } = require('../apps/api/src/bookings/bookings.service.ts');
const sql = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'apps/api/prisma/schema.prisma'), '--script'], { cwd: root, encoding: 'utf8', env: process.env });
assert.equal(sql.status, 0, sql.stderr);
const sqlite = new DatabaseSync(dbPath);
sqlite.exec(sql.stdout);
sqlite.close();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const told = [];
const bookings = new BookingsService(prisma, {}, { bookingCreated: (f) => told.push(f) });
(async () => {
  let failed = false;
  try {
    const cup = await bookings.create({ customerName: 'RAMSON', items: [{ pCategory: 'CUP', bags: 10, kgs: 700 }] }, 'ANIL', 'u1');
    assert.equal(told.length, 1);
    assert.deepEqual({ ...told[0] }, { actorId: 'u1', userName: 'ANIL', bookingId: cup.id, code: cup.code, customerName: 'RAMSON', bags: 10, kgs: 700 });
    console.log('PASS a cup booking alerts, naming party, bags, kgs and who made it');
    await bookings.create({ customerName: 'RAMSON', items: [{ pCategory: 'GLASS', bags: 5, kgs: 350 }] }, 'ANIL', 'u1');
    assert.equal(told.length, 1);
    console.log('PASS a booking with no cup line does not');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.stack ?? e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})();