/* Verify combination Excel import: links by design code, rejects rows whose
   design doesn't exist, updates by CMB code. Run: node scripts/verify-combination-import.cjs */
const BASE = 'http://localhost:4000/api';
const S = Date.now();
let token;
const api = (p, o = {}) =>
  fetch(`${BASE}${p}`, { ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(o.headers || {}) } });
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });
const impCombo = (rows) => post('/combinations/import', { rows });

async function main() {
  token = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }) })).json())?.data?.accessToken;
  const out = [];
  const made = { designs: [], combos: [] };

  // 1) Two existing designs (cost 2/3, rate 5/8).
  const d1 = (await (await post('/designs', { category: `CIMP ${S}`, subCategory: 'X', designType: `DLX ${S}`, cost: 2, rate: 5 })).json())?.data;
  const d2 = (await (await post('/designs', { category: `CIMP ${S}`, subCategory: 'X', designType: `LOGOX ${S}`, cost: 3, rate: 8 })).json())?.data;
  made.designs.push(d1.id, d2.id);
  out.push(`designs -> ${d1.code} ${d2.code} ${d1 && d2 ? 'OK' : 'FAIL'}`);

  // 2) Import a combination linking both by code -> created, cost=5 rate=13.
  const r1 = (await (await impCombo([{ 'DESIGN CODES': `${d1.code} + ${d2.code}`, NAME: `BUNDLE ${S}` }])).json())?.data;
  out.push(`import link by code -> created=${r1.created} updated=${r1.updated} ${r1.created === 1 && r1.updated === 0 ? 'OK' : 'FAIL'}`);
  const combo = (await (await api(`/combinations?search=BUNDLE ${S}`)).json())?.data?.items?.[0];
  if (combo) made.combos.push(combo.id);
  out.push(`linked combo -> code=${combo?.code} designs=${combo?.designs.length} cost=${combo?.cost} rate=${combo?.rate} ${combo && combo.designs.length === 2 && combo.cost === 5 && combo.rate === 13 ? 'OK' : 'FAIL'}`);

  // 3) CONDITION: a row whose design doesn't exist is rejected (not created).
  const r2 = (await (await impCombo([{ 'DESIGN CODES': 'DSG-99999999', NAME: `BAD ${S}` }])).json())?.data;
  const rejected = r2.created === 0 && r2.updated === 0 && r2.errors.length === 1 && /no such design code/i.test(r2.errors[0]);
  out.push(`reject missing design -> created=${r2.created} err="${r2.errors[0] ?? ''}" ${rejected ? 'OK' : 'FAIL'}`);
  const stillNone = !((await (await api(`/combinations?search=BAD ${S}`)).json())?.data?.items?.length);
  out.push(`missing-design combo not persisted -> ${stillNone ? 'OK' : 'FAIL'}`);

  // 4) Update the existing combination by its CMB code -> now just d1 (cost 2).
  const r3 = (await (await impCombo([{ CODE: combo.code, 'DESIGN CODES': d1.code, NAME: `BUNDLE ${S}` }])).json())?.data;
  const after = (await (await api(`/combinations/${combo.id}`)).json())?.data;
  out.push(`update by CMB code -> updated=${r3.updated} designs=${after.designs.length} cost=${after.cost} ${r3.updated === 1 && after.designs.length === 1 && after.cost === 2 ? 'OK' : 'FAIL'}`);

  console.log(out.join('\n'));

  for (const id of made.combos) await api(`/combinations/${id}`, { method: 'DELETE' });
  for (const id of made.designs) await api(`/designs/${id}`, { method: 'DELETE' });
  console.log('cleanup done');

  const ok = out.every((l) => l.includes('OK'));
  console.log(`RESULT: ${ok ? 'ALL OK' : 'SOME CHECKS FAILED'}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
