/* Verify the design Excel import UPDATES existing designs in place (by ID/CODE),
   so the design keeps its id and every combination link, and the combo cost
   auto-updates. Run: node scripts/verify-design-import-link.cjs */
const BASE = 'http://localhost:4000/api';
const S = Date.now();
let token;
const api = (p, o = {}) =>
  fetch(`${BASE}${p}`, { ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(o.headers || {}) } });
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });
const imp = (rows) => post('/designs/import', { rows });

async function main() {
  token = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }) })).json())?.data?.accessToken;
  const out = [];
  const made = { designs: [], combos: [] };

  // 1) Existing design with cost 5, and a combination built from it (combo cost 5).
  const d = (await (await post('/designs', { category: `IMP ${S}`, subCategory: 'X', designType: `DL ${S}`, cost: 5, rate: 12 })).json())?.data;
  made.designs.push(d.id);
  const c = (await (await post('/combinations', { designIds: [d.id] })).json())?.data;
  made.combos.push(c.id);
  out.push(`setup -> design #${d.id} ${d.code} cost=${d.cost}; combo ${c.code} cost=${c.cost} ${c.cost === 5 ? 'OK' : 'FAIL'}`);

  // 2) Import the SAME design by CODE with a new cost 9 -> must UPDATE (not create).
  const r1 = (await (await imp([{ CODE: d.code, CATEGORY: `IMP ${S}`, 'SUB CATEGORY': 'X', 'DESIGN TYPE': `DL ${S}`, COST: 9, RATE: 12 }])).json())?.data;
  out.push(`import by code -> created=${r1.created} updated=${r1.updated} ${r1.updated === 1 && r1.created === 0 ? 'OK' : 'FAIL'}`);

  // 3) The design keeps its id; cost is now 9; combo auto-updates to 9.
  const d2 = (await (await api(`/designs/${d.id}`)).json())?.data;
  const c2 = (await (await api(`/combinations/${c.id}`)).json())?.data;
  out.push(`design updated in place -> id=${d2.id} cost=${d2.cost} ${d2.id === d.id && d2.cost === 9 ? 'OK' : 'FAIL'}`);
  out.push(`combo still linked & cost auto-updated -> designs=${c2.designs.length} cost=${c2.cost} ${c2.designs.length === 1 && c2.cost === 9 ? 'OK' : 'FAIL'}`);

  // 4) Import by ID with a different cost -> still updates the same row.
  const r2 = (await (await imp([{ ID: d.id, CATEGORY: `IMP ${S}`, 'SUB CATEGORY': 'X', 'DESIGN TYPE': `DL ${S}`, COST: 4, RATE: 12 }])).json())?.data;
  const c3 = (await (await api(`/combinations/${c.id}`)).json())?.data;
  out.push(`import by id -> updated=${r2.updated}; combo cost=${c3.cost} ${r2.updated === 1 && c3.cost === 4 ? 'OK' : 'FAIL'}`);

  // 5) A brand-new row (no id/code, new identity) -> creates.
  const r3 = (await (await imp([{ CATEGORY: `IMP ${S}`, 'SUB CATEGORY': 'X', 'DESIGN TYPE': `NEW ${S}`, COST: 3, RATE: 7 }])).json())?.data;
  out.push(`import new row -> created=${r3.created} updated=${r3.updated} ${r3.created === 1 && r3.updated === 0 ? 'OK' : 'FAIL'}`);
  const newRow = (await (await api(`/designs?search=NEW ${S}`)).json())?.data?.items?.[0];
  if (newRow) made.designs.push(newRow.id);

  console.log(out.join('\n'));

  for (const id of made.combos) await api(`/combinations/${id}`, { method: 'DELETE' });
  for (const id of made.designs) await api(`/designs/${id}`, { method: 'DELETE' });
  console.log('cleanup done');

  const ok = out.every((l) => l.includes('OK'));
  console.log(`RESULT: ${ok ? 'ALL OK' : 'SOME CHECKS FAILED'}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
