/* Verify Design Names now allows multiple names per code (import no longer collapses). */
const BASE = 'http://localhost:4000/api';
let token;
const api = (p, o = {}) => fetch(`${BASE}${p}`, { ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(o.headers || {}) } });

(async () => {
  token = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }) })).json())?.data?.accessToken;
  const out = [];

  const CODE = 'ZZ TESTCODE';
  // import 4 rows for ONE code: 3 distinct names + 1 duplicate of the first
  const rows = [
    { 'DESIGN TYPE L': CODE, 'DESIGN NAME': 'ALPHA' },
    { 'DESIGN TYPE L': CODE, 'DESIGN NAME': 'BETA' },
    { 'DESIGN TYPE L': CODE, 'DESIGN NAME': 'GAMMA' },
    { 'DESIGN TYPE L': CODE, 'DESIGN NAME': 'ALPHA' }, // duplicate pair -> no-op
  ];
  const res = (await (await api('/design-names/import', { method: 'POST', body: JSON.stringify({ rows }) })).json())?.data;
  out.push(`import -> created=${res.created} updated=${res.updated} (expect created=3, updated=1) ${res.created === 3 && res.updated === 1 ? 'OK' : 'FAIL'}`);

  // the code should now have 3 names stored
  const list = (await (await api(`/design-names?search=${encodeURIComponent(CODE)}&page=1&pageSize=50`)).json())?.data;
  const mine = list.items.filter((r) => r.designType === CODE);
  out.push(`stored -> ${mine.length} rows for "${CODE}": [${mine.map((r) => r.designName).sort().join(', ')}] ${mine.length === 3 ? 'OK' : 'FAIL'}`);

  // re-import the SAME file -> all no-ops (nothing new created)
  const res2 = (await (await api('/design-names/import', { method: 'POST', body: JSON.stringify({ rows }) })).json())?.data;
  out.push(`re-import -> created=${res2.created} (expect 0) ${res2.created === 0 ? 'OK' : 'FAIL'}`);

  // cleanup
  for (const r of mine) await api(`/design-names/${r.id}`, { method: 'DELETE' });
  const after = (await (await api(`/design-names?search=${encodeURIComponent(CODE)}&page=1&pageSize=50`)).json())?.data;
  out.push(`cleanup -> remaining=${after.items.filter((r) => r.designType === CODE).length} (expect 0) ${after.items.filter((r) => r.designType === CODE).length === 0 ? 'OK' : 'FAIL'}`);

  console.log(out.join('\n'));
  console.log(`RESULT: ${out.every((l) => l.includes('OK')) ? 'ALL OK' : 'SOME CHECKS FAILED'}`);
})().catch((e) => { console.error(e); process.exit(1); });
