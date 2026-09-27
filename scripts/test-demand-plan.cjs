// Demand plan on CHAITANYA's cash bills of 27/09/2026: the whole bills, oldest
// first, whose weighted average age is nearest the target (credit days + allowance).
const assert = require('node:assert/strict');
const { planDemand, demandStats, billAgeDays } = require('../packages/shared/dist/cjs/types/payment.js');

const asOf = new Date(2026, 8, 27);
const bills = [
  ['SSS/393', '2026-07-10', 23450], ['SSS/417', '2026-07-16', 87343], ['SSS/418', '2026-07-16', 28746],
  ['SSS/430', '2026-07-17', 25879], ['SSS/436', '2026-07-18', 42342], ['SSS/447', '2026-07-21', 29565],
  ['SSS/451', '2026-07-23', 61688], ['SSS/454', '2026-07-25', 26543], ['SSS/479', '2026-07-31', 97805],
  ['SSS/488', '2026-08-03', 25984], ['SSS/501', '2026-08-05', 22466], ['SSS/505', '2026-08-06', 25944],
  ['SSS/516', '2026-08-08', 40037], ['SSS/523', '2026-08-11', 35088], ['SSS/561', '2026-08-18', 37032],
  ['SSS/576', '2026-08-21', 29640], ['SSS/584', '2026-08-22', 21916], ['SSS/661', '2026-09-08', 47732],
  ['SSS/669', '2026-09-10', 14260], ['SSS/686', '2026-09-12', 14209], ['SSS/696', '2026-09-14', 46621],
].map(([code, d, balance]) => {
  const [y, m, day] = d.split('-').map(Number);
  return { code, balance, age: billAgeDays(new Date(y, m - 1, day), asOf) };
});

const check = (target, last, total, avg) => {
  const picked = planDemand(bills, target);
  assert.equal(picked.at(-1), last, `target ${target}: stops at ${last}`);
  const s = demandStats(bills.filter((b) => picked.includes(b.code)));
  assert.equal(Math.round(s.total), total);
  assert.equal(s.avgAge.toFixed(1), avg);
};
check(65, 'SSS/505', 497755, '65.5'); // 60 days + the default 5
check(60, 'SSS/584', 661468, '59.9');
check(55, 'SSS/686', 737669, '55.6');
assert.deepEqual(planDemand(bills, 90), [], 'nothing due while the oldest bill is younger than the target');
assert.equal(billAgeDays('2026-07-10T00:00:00', asOf), 79);
console.log('PASS demand plan picks the bills nearest the target average');
