const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { parseTallyMaster } = require('../apps/api/src/account-groups/tally-master.parser.ts');

const xml = Buffer.from(`
  <ENVELOPE>
    <TALLYMESSAGE>
      <LEDGER NAME="CITY FROM ADDRESS">
        <PARENT>Sundry Debtors</PARENT>
        <ADDRESS.LIST TYPE="String">
          <ADDRESS>12 INDUSTRIAL ESTATE</ADDRESS>
          <ADDRESS>COIMBATORE - 641001</ADDRESS>
        </ADDRESS.LIST>
        <PARTYGSTIN>33ABCDE1234F1Z5</PARTYGSTIN>
      </LEDGER>
      <LEDGER NAME="EXPLICIT DETAILS">
        <PARENT>Sundry Debtors</PARENT>
        <LEDGERCITY>PUNE</LEDGERCITY>
        <LEDSTATENAME>Maharashtra</LEDSTATENAME>
        <TRANSPORTNAME>FAST ROADWAYS</TRANSPORTNAME>
      </LEDGER>
    </TALLYMESSAGE>
  </ENVELOPE>
`);

const parsed = parseTallyMaster(xml);
assert.deepEqual(parsed.ledgers[0].details, {
  creditPeriod: null,
  state: 'Tamil Nadu',
  city: 'COIMBATORE',
  mobile: null,
  email: null,
  gstin: '33ABCDE1234F1Z5',
  transportName: null,
});
assert.equal(parsed.ledgers[1].details.state, 'Maharashtra');
assert.equal(parsed.ledgers[1].details.city, 'PUNE');
assert.equal(parsed.ledgers[1].details.transportName, 'FAST ROADWAYS');

console.log('PASS Tally master details fill city, state and explicit transporter');
