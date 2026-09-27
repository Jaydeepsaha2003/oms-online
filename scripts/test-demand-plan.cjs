// Demand plan on CHAITANYA's cash bills of 27/09/2026 (60 credit days): the bills
// overdue now plus those falling overdue within the next X days.
const assert = require('node:assert/strict');
const { dueWithin, demandStats, billAgeDays } = require('../packages/shared/dist/cjs/types/payment.js');

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

const check = (days, last, total) => {
  const picked = dueWithin(bills, 60, days);
  assert.equal(picked.at(-1)?.code, last, `${days} days ahead: up to ${last}`);
  assert.equal(Math.round(demandStats(picked).total), total);
};
check(0, 'SSS/454', 325556); // overdue today only
check(7, 'SSS/501', 471811); // + 479 (29/09), 488 (02/10), 501 (04/10)
check(15, 'SSS/523', 572880);
assert.equal(billAgeDays('2026-07-10T00:00:00', asOf), 79);
console.log('PASS demand plan asks for overdue bills plus those due within X days');
