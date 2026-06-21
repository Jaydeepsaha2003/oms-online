/* Verify exports include the header row even when there is no data
   (so the file works as an import template). Run: node scripts/verify-empty-export.cjs */
const XLSX = require('xlsx');
const BASE = 'http://localhost:4000/api';

async function main() {
  const login = await (await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }),
  })).json();
  const auth = { authorization: `Bearer ${login?.data?.accessToken}` };

  const header = async (path) => {
    const res = await fetch(`${BASE}${path}`, { headers: auth });
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [];
  };

  const checks = [
    ['customers', '/customers/export'],
    ['transporters', '/transporters/export'],
    ['gst-rates', '/gst-rates/export'],
    ['trans-rates', '/transport-rates/export'],
  ];
  let ok = true;
  for (const [name, path] of checks) {
    const h = await header(path);
    const pass = h.length > 0;
    ok = ok && pass;
    console.log(`${name.padEnd(13)} headers(${h.length}): ${JSON.stringify(h)} -> ${pass ? 'OK' : 'FAIL (no header row)'}`);
  }
  console.log(`\nRESULT: ${ok ? 'ALL EXPORTS HAVE HEADERS' : 'SOME EXPORTS MISSING HEADERS'}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
