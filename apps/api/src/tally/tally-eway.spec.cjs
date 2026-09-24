const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ project: 'apps/api/tsconfig.json', transpileOnly: true });
const { parseActual } = require('./tally-posting.service.ts');

test('reads a generated e-way number from its nested Tally voucher entry', () => {
  const xml = `<COLLECTION>
    <VOUCHER REMOTEID="746">
      <VOUCHERNUMBER>SSS-746/26-27</VOUCHERNUMBER>
      <IRNACKNO TYPE="String">122634766513305</IRNACKNO>
      <EWAYBILLDETAILS.LIST><BILLNUMBER TYPE="String">242293650410</BILLNUMBER></EWAYBILLDETAILS.LIST>
    </VOUCHER>
    <VOUCHER REMOTEID="744">
      <VOUCHERNUMBER>SSS-744/26-27</VOUCHERNUMBER>
      <IRNACKNO TYPE="String">122634766513306</IRNACKNO>
      <EWAYBILLDETAILS.LIST></EWAYBILLDETAILS.LIST>
    </VOUCHER>
    <VOUCHER REMOTEID="cancelled">
      <VOUCHERNUMBER>SSS-747/26-27</VOUCHERNUMBER>
      <EWAYBILLDETAILS.LIST><BILLNUMBER>123456789012</BILLNUMBER><ISCANCELLED>Yes</ISCANCELLED></EWAYBILLDETAILS.LIST>
    </VOUCHER>
  </COLLECTION>`;
  const rows = parseActual(xml);
  assert.equal(rows[0].eWayBillNo, '242293650410');
  assert.equal(rows[1].eWayBillNo, null);
  assert.equal(rows[2].eWayBillNo, null);
});
