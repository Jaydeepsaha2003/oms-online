// Booking Dispatch: the operator gives ONE bag figure for the whole dispatch;
// it comes off the booking exactly, shared across the lines by kgs, and no bag
// weight is needed. Isolated fixture DB — never dev.db, starts no API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-booking-bags-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { BookingsService } = require('../apps/api/src/bookings/bookings.service.ts');
const { DispatchService } = require('../apps/api/src/dispatch/dispatch.service.ts');

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
const noop = () => {};
const bookings = new BookingsService(prisma, {}, {}, {}, {}, {});
const svc = new DispatchService(
  prisma,
  { registerHandler: noop, registerAuditTarget: noop },
  { record: async () => {} },
  new Proxy({}, { get: () => noop }),
  new Proxy({}, { get: () => noop }),
  bookings,
);
svc.onModuleInit();
const user = { id: null, name: 'tester', canApprove: true, canOverrideThreshold: true };

(async () => {
  let failed = false;
  try {
    // No bag weight on purpose: the bags are typed, not derived.
    const c = await prisma.customer.create({ data: { id: 1, partyName: 'BAGS FIXTURE', payBy: 'PARTY' } });
    await prisma.product.create({ data: { code: 'P1', category: 'CUP', subCategory: '4-PCS-CUP-FG', product: 'JET CUP', size: 6.5, pcs: 4, weight: 0.1, rate: 62, active: true } });
    await prisma.product.create({ data: { code: 'P2', category: 'CUP', subCategory: '4-PCS-CUP-FG', product: 'DAMRU CUP', size: 6.5, pcs: 4, weight: 0.1, rate: 62, active: true } });
    const b = await prisma.booking.create({
      data: { code: 'BKG-1', customerName: c.partyName, bookingDate: new Date(2026, 7, 1), bags: 10, kgs: 0, status: 'OPEN', rateSnapshot: JSON.stringify({ rates: [], logos: [] }), items: { create: [{ pCategory: 'CUP', bags: 10, kgs: 0 }] } },
    });

    // 100 pcs (10 kg) + 200 pcs (20 kg), dispatched in 3 bags.
    const res = await svc.dispatchFromBooking(
      { bookingId: b.id, bags: 3, lines: [{ subCategory: '4-PCS-CUP-FG', product: 'JET CUP', pcs: 100 }, { subCategory: '4-PCS-CUP-FG', product: 'DAMRU CUP', pcs: 200 }] },
      user,
    );
    const items = await prisma.orderItem.findMany({ where: { bookingId: b.id }, orderBy: { id: 'asc' } });
    assert.deepEqual(items.map((i) => i.bags), [1.5, 1.5], 'split equally: 3 bags / 2 items');
    assert.deepEqual(items.map((i) => i.productName), ['6.5 JET CUP', '6.5 DAMRU CUP'], 'named like a New Order line, with the size');
    assert.equal(res.totals.bags, 3);
    assert.equal((await bookings.findOne(b.id)).remainingBags, 7, 'exactly 3 bags off the booking');
    const disp = await prisma.dispatch.findMany({ where: { orderItemId: { in: items.map((i) => i.id) } } });
    assert.equal(disp.reduce((t, d) => t + d.bags, 0), 3, 'the dispatches carry the same 3 bags');
    console.log('PASS one bag figure for the dispatch comes off the booking, split equally per line');

    // Rounding never leaks: 1 bag over three equal lines still adds up to 1.
    await svc.dispatchFromBooking(
      { bookingId: b.id, bags: 1, lines: [{ subCategory: '4-PCS-CUP-FG', product: 'JET CUP', pcs: 10, comment: 'a' }, { subCategory: '4-PCS-CUP-FG', product: 'JET CUP', pcs: 10, comment: 'b' }, { subCategory: '4-PCS-CUP-FG', product: 'DAMRU CUP', pcs: 10 }] },
      user,
    );
    assert.equal((await bookings.findOne(b.id)).remainingBags, 6);
    console.log('PASS thirds round without losing a bag');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.stack ?? e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})();
