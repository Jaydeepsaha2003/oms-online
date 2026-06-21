/* Verify combination import in CATEGORY + SUB CATEGORY + DESIGN TYPE mode using
   the user's real data. Imports, checks computed cost/rate match the sheet, then
   deletes the test-created combinations. Run: node scripts/verify-combo-import-bycategory.cjs */
const BASE = 'http://localhost:4000/api';
let token;
const api = (p, o = {}) =>
  fetch(`${BASE}${p}`, { ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(o.headers || {}) } });
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });

// The user's pasted rows: [subCategory, designType expr, cost, rate]
const DATA = [
  ['SOUTH-5.5-SIZE-FG-22G', 'FULL LASER+DL', 68, 100],
  ['SOUTH-6-SIZE-FG-22G', 'FULL LASER+DL', 58, 85],
  ['SOUTH-5.5-SIZE-FG-22G', 'FULL LASER+DL+LOGO', 71.75, 107],
  ['SOUTH-5-SIZE-FG-22G', 'FULL LASER+DL+LOGO', 66.5, 107],
  ['SOUTH-5.5-SIZE-FG-22G', 'WL CRAFT+LOGO', 33.75, 77],
  ['SOUTH-5-SIZE-FG-22G', 'WL CRAFT+LOGO', 34.5, 77],
  ['SOUTH-6.5-SIZE-FG-22G', 'WL CRAFT+LOGO', 21, 45],
  ['SOUTH-6-SIZE-FG-22G', 'WL CRAFT+LOGO', 33.25, 75],
  ['7.5-SIZE-FG-22G-VIVO', 'AMBIENT+LOGO', 17.5, 45],
  ['7-SIZE-FG-22G-VIVO', 'AMBIENT+LOGO', 22.5, 45],
  ['6.5-SIZE-FG-22G-10-PCS', 'LASER+LOGO', 14.5, 25],
  ['SOUTH-6.5-SIZE-FG-22G', 'FULL LASER+DL+LOGO', 52, 90],
];

async function main() {
  token = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }) })).json())?.data?.accessToken;

  const before = new Set(((await (await api('/combinations?page=1&pageSize=500')).json())?.data?.items ?? []).map((c) => c.id));

  const rows = DATA.map(([sub, type, cost, rate]) => ({ CATEGORY: 'GLASS', 'SUB CATEGORY': sub, 'DESIGN TYPE': type, COST: cost, RATE: rate }));
  const res = (await (await post('/combinations/import', { rows })).json())?.data;
  console.log(`import -> created=${res.created} updated=${res.updated} skipped=${res.errors.length}`);
  res.errors.forEach((e) => console.log(`  SKIP: ${e}`));

  // Compare each created combo's computed cost/rate to the user's sheet values.
  const expected = new Map(DATA.map(([sub, type, cost, rate]) => [`${sub}|${type}`, { cost, rate }]));
  const all = (await (await api('/combinations?page=1&pageSize=500')).json())?.data?.items ?? [];
  const created = all.filter((c) => !before.has(c.id));
  let okCount = 0;
  for (const c of created) {
    const exp = expected.get(`${c.subCategory}|${c.name}`);
    const match = exp && exp.cost === c.cost && exp.rate === c.rate;
    if (match) okCount++;
    console.log(`  ${c.code} ${c.subCategory} | ${c.name} -> cost=${c.cost} rate=${c.rate} (sheet ${exp ? exp.cost + '/' + exp.rate : '?'}) ${match ? 'OK' : 'MISMATCH'}`);
  }

  // Clean up the test-created combinations (leave the user's data untouched).
  for (const c of created) await api(`/combinations/${c.id}`, { method: 'DELETE' });
  console.log(`cleanup: removed ${created.length} test combinations`);

  const ok = res.created === DATA.length && okCount === created.length && created.length === DATA.length;
  console.log(`RESULT: ${ok ? 'ALL OK' : 'CHECK ABOVE'}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
