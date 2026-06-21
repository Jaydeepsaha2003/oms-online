/* Verify design-linked combinations: cost = live sum, auto-updates on design cost change.
   Run: node scripts/verify-combinations.cjs */
const BASE = 'http://localhost:4000/api';
const S = Date.now();
let token;
const api = (p, o = {}) =>
  fetch(`${BASE}${p}`, { ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(o.headers || {}) } });
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });

async function main() {
  token = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }) })).json())?.data?.accessToken;
  const out = [];
  const made = { designs: [], combos: [] };

  // 1) Two designs with costs 2 and 3.
  const d1 = (await (await post('/designs', { category: `CC ${S}`, subCategory: 'X', designType: `DL ${S}`, cost: 2, rate: 5 })).json())?.data;
  const d2 = (await (await post('/designs', { category: `CC ${S}`, subCategory: 'X', designType: `LOGO ${S}`, cost: 3, rate: 8 })).json())?.data;
  made.designs.push(d1.id, d2.id);
  out.push(`designs created -> d1.cost=${d1.cost} d2.cost=${d2.cost} ${d1 && d2 ? 'OK' : 'FAIL'}`);

  // 2) Combination from both -> cost = 2+3 = 5, rate = 5+8 = 13, name auto-joined.
  const c = (await (await post('/combinations', { designIds: [d1.id, d2.id] })).json())?.data;
  made.combos.push(c.id);
  out.push(`combination create -> code=${c.code} name="${c.name}" cost=${c.cost} rate=${c.rate} ${c.cost === 5 && c.rate === 13 && /^CMB-\d{5}$/.test(c.code) ? 'OK' : 'FAIL'}`);
  out.push(`combination designs linked -> ${c.designs.length} ${c.designs.length === 2 ? 'OK' : 'FAIL'}`);

  // 3) Change d1 cost 2 -> 10. Combination cost should auto-update to 10+3 = 13.
  await api(`/designs/${d1.id}`, { method: 'PATCH', body: JSON.stringify({ cost: 10 }) });
  const c2 = (await (await api(`/combinations/${c.id}`)).json())?.data;
  out.push(`auto cost update after design change -> combo.cost=${c2.cost} (expected 13) ${c2.cost === 13 ? 'OK' : 'FAIL'}`);

  // 4) Custom name.
  const c3 = (await (await post('/combinations', { name: 'my bundle', designIds: [d1.id] })).json())?.data;
  made.combos.push(c3.id);
  out.push(`custom name -> "${c3.name}" cost=${c3.cost} ${c3.name === 'MY BUNDLE' && c3.cost === 10 ? 'OK' : 'FAIL'}`);

  console.log(out.join('\n'));

  for (const id of made.combos) await api(`/combinations/${id}`, { method: 'DELETE' });
  for (const id of made.designs) await api(`/designs/${id}`, { method: 'DELETE' });
  console.log('cleanup done');

  const ok = out.every((l) => l.includes('OK'));
  console.log(`RESULT: ${ok ? 'ALL OK' : 'SOME CHECKS FAILED'}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
