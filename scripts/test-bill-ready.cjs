// "Bill ready" alerts: the Tally PC's report reaches only the users the admin
// picked, names the OMS bill and amount, goes once per bill, and nothing goes
// while the alerts are off. Isolated fixture DB; notification channels stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-bill-ready-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { BillReadyService } = require('../apps/api/src/tally/bill-ready.service.ts');

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
const sent = [];
const told = new Set();
const svc = new BillReadyService(
  prisma,
  { notifyUsers: (ids, n) => sent.push({ via: 'app', ids, n }) },
  { sendToUsers: async (ids, n) => sent.push({ via: 'push', ids, n }) },
  { notInDnd: async (ids) => ids },
  { filterUntold: async (key, ids) => ids.filter((id) => !told.has(`${key}|${id}`)), record: async (key, ids) => ids.forEach((id) => told.add(`${key}|${id}`)) },
);

(async () => {
  let failed = false;
  try {
    const [a, b] = await Promise.all(['a', 'b'].map((n) => prisma.user.create({ data: { email: `${n}@x`, name: n.toUpperCase(), passwordHash: 'x', status: 'active' } })));
    const ch = await prisma.challan.create({ data: { code: 'SSS/26-27/812', prefix: 'SSS', invDate: new Date(), customerName: 'ANIL METAL', challanStatus: 'CONFIRMED', b: 124500, c: 0, total: 124500 } });
    await prisma.tallyVoucher.create({ data: { challanId: ch.id, companyGuid: 'g', status: 'POSTED', recon: 'OK', checkedAt: new Date(), vchNo: 'SSS-812/26-27', amount: -124500 } });

    assert.deepEqual(await svc.printed({ vchNo: 'SSS-812/26-27' }), { sent: 0 }, 'off by default');
    await svc.saveSettings({ enabled: true, userIds: [a.id] });
    assert.deepEqual(await svc.printed({ vchNo: 'SSS-812/26-27', party: 'ANIL METAL', eway: '2022' }), { sent: 1 });
    assert.deepEqual(sent.map((s) => s.via), ['app', 'push'], 'in the app and on the phone');
    assert.deepEqual(sent[0].ids, [a.id], 'only the user the admin picked');
    assert.equal(sent[0].n.title, 'Bill ready: ANIL METAL');
    assert.match(sent[0].n.body, /SSS\/26-27\/812 · ₹1,24,500 · e-way 2022 — please collect the bill/);
    assert.equal(sent[0].n.data.kind, 'bill-ready');
    console.log('PASS the picked user hears about the printed bill, with its OMS number and amount');

    assert.deepEqual(await svc.printed({ vchNo: 'SSS-812/26-27' }), { sent: 0 }, 'a repeat report is not a second alert');
    console.log('PASS one alert per bill');
    void b;
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.stack ?? e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})();
