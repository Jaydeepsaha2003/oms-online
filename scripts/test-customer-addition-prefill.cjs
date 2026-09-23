const assert = require('node:assert/strict');

(async () => {
  const { customerAdditionPrefill } = require('@oms/shared');

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

  const stalePrefill = customerAdditionPrefill(
    {
      tallyName: 'Arya Enterprises',
      groupName: 'Sundry Debtors',
      details: { state: null, gstin: '27AGOPB2919B1ZQ' },
    },
    { groups: [], transporters: [] },
  );
  assert.equal(stalePrefill.state, 'MAHARASHTRA');

  console.log('PASS Addition List details prefill the New Customer form');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
