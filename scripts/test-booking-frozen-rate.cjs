// A bag booking freezes its rates on the booking date: Booking Dispatch shows,
// and the bill carries, the chart rate of that day plus the party's special —
// not today's chart after a later price change. Isolated fixture — never dev.db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-booking-frozen-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { BookingsService } = require('../apps/api/src/bookings/bookings.service.ts');

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
const bookings = new BookingsService(prisma, {}, {}, {}, {}, {});

(async () => {
  let failed = false;
  try {
    const c = await prisma.customer.create({ data: { id: 1, partyName: 'FROZEN FIXTURE', payBy: 'PARTY' } });
    await prisma.customerBagWeight.create({ data: { customerId: 1, category: 'CUP', kgsPerBag: 20 } });
    // The party's own special: -2 on this size, in force when it booked.
    await prisma.customerRate.create({ data: { customerId: 1, kind: 'PRODUCT', scope: 'SUBCATEGORY', category: 'CUP', subCategory: '4-PCS-CUP-FG', target: '', rate: -2 } });
    const p = await prisma.product.create({ data: { code: 'P1', category: 'CUP', subCategory: '4-PCS-CUP-FG', product: 'JET CUP', size: 6.5, pcs: 4, weight: 0.05, rate: 62, active: true } });
    const b = await prisma.booking.create({
      data: { code: 'BKG-1', customerName: c.partyName, bookingDate: new Date(2026, 7, 1), bags: 10, kgs: 0, status: 'OPEN', rateSnapshot: JSON.stringify({ rates: await prisma.customerRate.findMany(), logos: [] }), items: { create: [{ pCategory: 'CUP', bags: 10, kgs: 0 }] } },
    });
    // The chart moved AFTER the booking: 62 -> 70 on 1 September.
    await prisma.product.update({ where: { id: p.id }, data: { rate: 70 } });
    await prisma.productRateHistory.create({ data: { productId: p.id, productName: 'JET CUP', category: 'CUP', subCategory: '4-PCS-CUP-FG', size: 6.5, oldRate: 62, newRate: 70, changedAt: new Date(2026, 8, 1) } });

    const opts = await bookings.dispatchOptions(c.partyName, 'CUP');
    const frozen = opts.frozenRates.find((r) => r.bookingId === b.id && r.product === 'JET CUP');
    assert.equal(frozen?.rate, 60, 'booking-date chart 62 + special -2 — not today\'s 70');
    const line = await bookings.priceOrderLine(b.id, { pCategory: 'CUP', subCategory: '4-PCS-CUP-FG', product: 'JET CUP', productName: 'JET CUP', psize: 6.5 });
    assert.equal(line.rate, 60, 'the bill is priced the same');
    assert.equal('rates' in opts, false, 'no agreed rates any more');
    console.log('PASS Booking Dispatch prices at the booking-date rate');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})();
