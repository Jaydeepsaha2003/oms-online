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
console.log('PASS: booking balance, edits, deletion, saved drafts, status and capacity checks');
