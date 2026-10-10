// Multi-transporter per party: a draft prices on the transporter picked, a stored 0
// stays 0, a transporter with no row prices as "unconfigured" (never on some OTHER
// transporter's rate), and the party's transporter list is derived from its rates.
// Isolated fixture DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-multi-trans-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.split(String.fromCharCode(92)).join('/')}`;
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
const settings = { getTcsPercent: async () => ({ tcsPercent: 0 }), get: async () => null, getMany: async () => ({}) };
// settings is the 4th ctor arg (prisma, pdf, notifications, settings, ...).
const svc = new ChallansService(prisma, stub, stub, settings, stub, stub, stub, stub);

(async () => {
  let failed = false;
  try {
    const PARTY = 'PNB';
    await prisma.customer.create({ data: { id: 1, partyName: PARTY, transportName: 'BEST ROADWAYS', boxRate: 0 } });
    const rate = (transportName, type, r) =>
      prisma.transRate.create({ data: { customerId: 1, customerName: PARTY, category: 'CUP', type, transportName, rate: r } });
    // BEST ROADWAYS: freight 150, packing 200. BHOOMI: freight 90, packing a DELIBERATE 0.
    await rate('BEST ROADWAYS', 'FREIGHT', 150);
    await rate('BEST ROADWAYS', 'PACKING', 200);
    await rate('BHOOMI TRANSPORT', 'FREIGHT', 90);
    await rate('BHOOMI TRANSPORT', 'PACKING', 0);
    // KARTAR is on the party's books for GLASS only — nothing for CUP.
    await prisma.transRate.create({ data: { customerId: 1, customerName: PARTY, category: 'GLASS', type: 'FREIGHT', transportName: 'KARTAR CARRIERS', rate: 70 } });

    const order = await prisma.order.create({ data: { customerName: PARTY, code: 'ORD-1', status: 'CONFIRMED' } });
    const item = await prisma.orderItem.create({ data: { orderId: order.id, product: 'CUP', productName: 'CUP 10', bags: 5, pcs: 100, calField: 'PCS', status: 'CONFIRMED' } });
    await prisma.dispatch.create({
      data: { orderId: order.id, orderItemId: item.id, customerId: 1, customerName: PARTY, dispatchDate: new Date(), productName: 'CUP 10', pCategory: 'CUP', calField: 'PCS', bags: 5, pcs: 100, rate: 10, box: 0 },
    });

    const cup = (d) => d.items.find((i) => i.pCategory === 'CUP');

    const def = await svc.draft({ customerName: PARTY });
    assert.equal(cup(def).freightRate, 150, 'default transporter prices on its own rate');
    assert.equal(def.freight, 750, 'freight = bags x rate (5 x 150)');
    assert.equal(def.packing, 1000, '5 x 200');
    console.log('PASS default transporter prices the draft, bags x rate');

    const bhoomi = await svc.draft({ customerName: PARTY, transName: 'BHOOMI TRANSPORT' });
    assert.equal(cup(bhoomi).freightRate, 90, 'picked transporter overrides the default');
    assert.equal(bhoomi.freight, 450, '5 x 90');
    assert.equal(cup(bhoomi).packingRate, 0, 'a stored 0 must price as 0, not as unconfigured');
    assert.notEqual(cup(bhoomi).packingRate, null);
    assert.equal(bhoomi.packing, 0);
    assert.equal(bhoomi.transName, 'BHOOMI TRANSPORT', 'the challan ships by the transporter picked');
    console.log('PASS picking a transporter re-prices, and a deliberate 0 stays 0');

    // A row laid out by "Add transporter" but never filled in: a rate must be THERE,
    // even if it is 0. Blank is "not set" and must flag, not quietly bill zero.
    await prisma.transRate.create({ data: { customerId: 1, customerName: PARTY, category: 'CUP', type: 'FREIGHT', transportName: 'NEW CARRIER', rate: null } });
    const blank = await svc.draft({ customerName: PARTY, transName: 'NEW CARRIER' });
    assert.equal(cup(blank).freightRate, null, 'a row with no figure typed in is unconfigured, not 0');
    assert.ok(blank.transporters.includes('NEW CARRIER'), 'a linked-but-unrated transporter can still be picked');
    console.log('PASS a blank rate reads as "not set", never as a silent 0');

    const kartar = await svc.draft({ customerName: PARTY, transName: 'KARTAR CARRIERS' });
    assert.equal(cup(kartar).freightRate, null, 'no row for this transporter = unconfigured');
    assert.equal(cup(kartar).packingRate, null);
    assert.notEqual(cup(kartar).freightRate, 150, 'must NOT fall back to another transporter rate');
    console.log('PASS an unpriced transporter reports null, never another transporter rate');

    assert.deepEqual(
      def.transporters,
      ['BEST ROADWAYS', 'BHOOMI TRANSPORT', 'KARTAR CARRIERS'],
      'party default first, then every transporter it has rates under',
    );
    console.log('PASS the party transporter list is derived from its rates, default first');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.stack ?? e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})();
