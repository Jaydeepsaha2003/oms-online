const assert = require('node:assert/strict');

const {
  invoiceBucketDue,
  applyInvoiceBucketCredit,
} = require('../packages/shared/dist/cjs/types/followup.js');

// A bank receipt and a cash discount must reduce only their own buckets.
assert.deepEqual(
  invoiceBucketDue({
    bankBilled: 100_000,
    cashBilled: 25_000,
    bankReceived: 35_000,
    cashReceived: 5_000,
    bankDiscount: 10_000,
    cashDiscount: 2_000,
  }),
  { bank: 55_000, cash: 18_000, balance: 73_000 },
  'CRM invoice B/C due must be the remaining bucket balance, not the original billed amount',
);

// Money already on account is consumed from the matching bucket only.
assert.deepEqual(
  applyInvoiceBucketCredit(
    { bank: 55_000, cash: 18_000 },
    { bank: 60_000, cash: 8_000 },
  ),
  {
    due: { bank: 0, cash: 10_000, balance: 10_000 },
    credit: { bank: 5_000, cash: 0 },
  },
  'Bank advance must not erase a cash-side due (or vice versa)',
);

console.log('CRM invoice bucket-due checks passed.');
