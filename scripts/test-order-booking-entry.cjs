const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');

const source = path.resolve(__dirname, '../apps/web/src/features/orders/order-booking-balance.ts');
assert.ok(fs.existsSync(source), 'Booking entry must expose a balance calculation shared by preview and validation');
const compiled = buildSync({ entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = { exports: {} };
new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(mod, mod.exports, require);
const { bookingOrderBalance, bookingCapacityError } = mod.exports;
const b = { id: 2, code: 'BKG-00002', bags: 300, kgs: 21000, remainingBags: 299, remainingKgs: 20930,
  items: [{ pCategory: 'GLASS', bags: 300, kgs: 21000, remainingBags: 299, remainingKgs: 20930 }] };
const line = (key, bags, gram, extra = {}) => ({ key, bookingId: 2, category: 'GLASS', bags: String(bags), gram: String(gram), ...extra });
const added = [line('a', 3, 210), line('b', 2, 140)];
assert.deepEqual(bookingOrderBalance(b, added), { before: { bags: 299, kgs: 20930 }, used: { bags: 5, kgs: 350 }, after: { bags: 294, kgs: 20580 } });
assert.equal(bookingOrderBalance(b, [line('a', 4, 280), added[1]]).after.bags, 293);
assert.equal(bookingOrderBalance(b, [added[1]]).after.bags, 297);
assert.equal(bookingOrderBalance(b, [...added, line('old', 10, 700, { status: 'CANCELLED' }), line('regular', 5, 350, { bookingId: null })]).used.bags, 5);
const saved = [line('saved', 1, 70)];
assert.equal(bookingOrderBalance(b, [...saved, ...added], saved).after.bags, 294, 'saved own allocation is not deducted twice');
assert.equal(bookingCapacityError(b, [line('large', 300, 21000)]).includes('299'), true);
assert.equal(bookingCapacityError({ ...b, kgs: 0, remainingKgs: 0, items: [{...b.items[0], kgs: 0, remainingKgs: 0}] }, added), null, 'bags-only reservations allow derived kg');
assert.equal(bookingCapacityError(b, [line('cup', 1, 70, { category: 'CUP' })]) !== null, true, 'a GLASS booking cannot supply CUP');
assert.equal(bookingCapacityError({ ...b, items: [{ ...b.items[0], pCategory: '' }] }, added), null, 'unspecified reservation allows a later category');

// The screen that offers a booking and the server that admits the draw must
// answer "can this be drawn?" from the SAME list — a second hard-coded copy is
// how the two drifted apart before.
const shared = require(path.resolve(__dirname, '../packages/shared/dist/cjs/types/booking.js'));
assert.deepEqual(shared.DRAWABLE_BOOKING_STATUSES, ['OPEN', 'PARTIALLY_CONVERTED']);
for (const closed of ['CONVERTED', 'CANCELLED', 'PRECLOSED']) {
  assert.equal(shared.DRAWABLE_BOOKING_STATUSES.includes(closed), false, `${closed} must not accept a new draw`);
}
for (const file of ['../apps/api/src/bookings/bookings.service.ts', '../apps/web/src/features/orders/order-form-page.tsx']) {
  const src = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
  assert.ok(/DRAWABLE_BOOKING_STATUSES/.test(src), `${file} must use the shared drawable-status list`);
  assert.ok(!/=\s*\[\s*'OPEN',\s*'PARTIALLY_CONVERTED'\s*\]/.test(src), `${file} has re-introduced a local copy of the drawable statuses`);
}

console.log('PASS: booking balance, edits, deletion, saved drafts, status and capacity checks');
