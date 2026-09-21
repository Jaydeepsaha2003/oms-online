const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

(async () => {
  const moduleUrl = pathToFileURL(
    path.join(root, 'apps/web/src/features/customers/customer-addition-prefill.ts'),
  ).href;
  const { customerAdditionPrefill } = await import(moduleUrl);

  const prefill = customerAdditionPrefill(
    {
      tallyName: 'Example Metals',
      groupName: 'Sundry Debtors',
      details: {
        creditPeriod: 45,
        state: 'Tamil Nadu',
        city: 'Coimbatore',
        mobile: '9876543210',
        email: 'accounts@example.test',
        transportName: 'fast roadways',
      },
    },
    {
      groups: [{ id: 7, name: 'SUNDRY DEBTORS' }],
      transporters: [{ id: 4, name: 'FAST ROADWAYS', packing: 12, freight: 34 }],
    },
  );

  assert.deepEqual(prefill, {
    partyName: 'Example Metals',
    groupId: '7',
    creditPeriod: '45',
    state: 'TAMIL NADU',
    city: 'COIMBATORE',
    mobile: '9876543210',
    email: 'accounts@example.test',
    transportName: 'FAST ROADWAYS',
    packing: '12',
    freight: '34',
  });

  console.log('PASS Addition List details prefill the New Customer form');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
