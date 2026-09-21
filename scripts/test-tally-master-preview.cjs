const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { AccountGroupsService } = require('../apps/api/src/account-groups/account-groups.service.ts');

const prisma = {
  accountGroup: { findMany: async () => [] },
  customer: { findMany: async () => [] },
  tallyPartyAlias: { findMany: async () => [] },
  tallyReconRun: { findFirst: async () => null },
  customerAddition: { findMany: async () => [] },
  tallyLedger: {
    findMany: async () => [
      { name: 'AXIS BANK LTD', groupName: 'Bank Accounts' },
      { name: 'OLD SKIPPED PARTY', groupName: 'Sundry Debtors' },
    ],
  },
};

const xml = Buffer.from(`
  <ENVELOPE>
    <TALLYMESSAGE>
      <GROUP NAME="Bank Accounts"><PARENT>Primary</PARENT></GROUP>
      <GROUP NAME="Sundry Debtors"><PARENT>Primary</PARENT></GROUP>
      <LEDGER NAME="AXIS BANK LTD"><PARENT>Bank Accounts</PARENT></LEDGER>
      <LEDGER NAME="HDFC BANK A/C"><PARENT>Bank Accounts</PARENT></LEDGER>
      <LEDGER NAME="OLD SKIPPED PARTY"><PARENT>Sundry Debtors</PARENT></LEDGER>
      <LEDGER NAME="FIRST TIME PARTY"><PARENT>Sundry Debtors</PARENT></LEDGER>
    </TALLYMESSAGE>
  </ENVELOPE>
`);

(async () => {
  const preview = await new AccountGroupsService(prisma).tallyPreview(xml, 'Master.xml');
  assert.deepEqual(
    preview.others.map(({ tallyName, status }) => ({ tallyName, status })),
    [
      { tallyName: 'AXIS BANK LTD', status: 'SAVED' },
      { tallyName: 'HDFC BANK A/C', status: 'NEW' },
    ],
  );
  assert.deepEqual(
    preview.parties.map(({ tallyName, previouslySkipped }) => ({ tallyName, previouslySkipped })),
    [
      { tallyName: 'OLD SKIPPED PARTY', previouslySkipped: true },
      { tallyName: 'FIRST TIME PARTY', previouslySkipped: false },
    ],
  );
  console.log('PASS Tally master preview labels saved and new other ledgers');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
