/* One-off check: auto-generated customer/transporter codes.
   - create returns an auto code (CUST-#####, TRN-#####)
   - export includes a CODE column
   - import never needs CODE (we don't send it)
   Run: node scripts/verify-codes.cjs  */
const XLSX = require('xlsx');
const BASE = 'http://localhost:4000/api';

async function main() {
  const stamp = Date.now();

  // 1) Login
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }),
  });
  const login = await loginRes.json();
  const token = login?.data?.accessToken;
  if (!token) throw new Error('No access token: ' + JSON.stringify(login));
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  // 2) Create a customer — code should be auto-assigned
  const custRes = await fetch(`${BASE}/customers`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ partyName: `CODE TEST CO ${stamp}` }),
  });
  const cust = (await custRes.json())?.data;
  const custOk = /^CUST-\d{5}$/.test(cust?.code || '');
  console.log(`customer.create -> id=${cust?.id} code=${cust?.code} ${custOk ? 'OK' : 'FAIL'}`);

  // 3) Create a transporter — code should be auto-assigned
  const trRes = await fetch(`${BASE}/transporters`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: `CODE TEST TRANS ${stamp}` }),
  });
  const tr = (await trRes.json())?.data;
  const trOk = /^TRN-\d{5}$/.test(tr?.code || '');
  console.log(`transporter.create -> id=${tr?.id} code=${tr?.code} ${trOk ? 'OK' : 'FAIL'}`);

  // 4) Exports must contain a CODE column
  const header = async (path) => {
    const res = await fetch(`${BASE}${path}`, { headers: { authorization: auth.authorization } });
    const buf = Buffer.from(await res.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [];
  };
  const custHeader = await header('/customers/export');
  const trHeader = await header('/transporters/export');
  console.log(`customers export header: ${JSON.stringify(custHeader)}`);
  console.log(`  has CODE -> ${custHeader.includes('CODE') ? 'OK' : 'FAIL'}`);
  console.log(`transporters export header: ${JSON.stringify(trHeader)}`);
  console.log(`  has CODE -> ${trHeader.includes('CODE') ? 'OK' : 'FAIL'}`);

  // 5) Import without a CODE column still works (codes auto-generated)
  const impRes = await fetch(`${BASE}/customers/import`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ rows: [{ 'PARTY NAME': `IMPORT NO CODE ${stamp}`, CITY: 'TESTCITY' }] }),
  });
  const imp = (await impRes.json())?.data;
  console.log(`import(no CODE) -> created=${imp?.created} updated=${imp?.updated} errors=${imp?.errors?.length ?? '?'} ${imp?.created >= 1 ? 'OK' : 'FAIL'}`);

  const allOk =
    custOk && trOk && custHeader.includes('CODE') && trHeader.includes('CODE') && imp?.created >= 1;
  console.log(`\nRESULT: ${allOk ? 'ALL OK' : 'SOME CHECKS FAILED'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
