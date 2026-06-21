/* Real import of the user's combination list. Clears existing combinations, then
   imports all rows (CATEGORY + SUB CATEGORY + DESIGN TYPE mode), reports created /
   skipped, and checks computed cost/rate against the sheet.
   Run: node scripts/import-combinations.cjs */
const BASE = 'http://localhost:4000/api';
let token;
const api = (p, o = {}) =>
  fetch(`${BASE}${p}`, { ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(o.headers || {}) } });
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });

// [subCategory, designType expr, cost, rate]
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
  ['SOUTH-6-SIZE-FG-22G', 'FULL LASER+DL+LOGO', 61.25, 90],
  ['8-PCS-FG-22G', 'WL CRAFT+LOGO', 22, 45],
  ['12-PCS-FG-22G', 'WL CRAFT+LOGO', 28, 50],
  ['10-PCS-FG-22G', 'WL CRAFT+LOGO', 22.5, 45],
  ['6-PCS-FG-22G', 'LASER+LOGO', 14, 20],
  ['6-PCS-FG-22G', 'DIAMOND HAMMER+LOGO', 78, 95],
  ['SOUTH-5-SIZE-FG-22G', 'HANDLE+LOGO', 76.5, 97],
  ['SOUTH-5-SIZE-FG-22G', 'HANDLE+LASER+LOGO', 93.5, 127],
  ['SOUTH-5.5-SIZE-FG-22G', 'HANDLE+LOGO', 67.75, 87],
  ['SOUTH-5.5-SIZE-FG-22G', 'HANDLE+LASER+LOGO', 82.75, 117],
  ['10-PCS-FG-22G', 'JWL+TOOL', 33, 45],
  ['10-PCS-FG-22G', 'JWL+TOOL+LOGO', 35.5, 50],
  ['8-PCS-FG-22G', 'JWL+TOOL', 26.16, 45],
  ['8-PCS-FG-22G', 'JWL+TOOL+LOGO', 28.16, 50],
  ['10-PCS-FG-22G', 'WL CRAFT+TOOL', 23, 45],
  ['SOUTH-5.5-SIZE-FG-22G', 'WL CRAFT+TOOL', 34.8, 77],
  ['SOUTH-5-SIZE-FG-22G', 'WL CRAFT+TOOL', 35.4, 77],
  ['SOUTH-5-SIZE-FG-22G', 'WL CRAFT+TOOL+LOGO', 39.9, 84],
  ['SOUTH-5.5-SIZE-FG-22G', 'WL CRAFT+TOOL+LOGO', 38.55, 84],
  ['10-PCS-FG-22G', 'DL+DIAMOND', 25, 35],
  ['6-PCS-FG-22G', 'DL+LOGO', 13, 20],
  ['8-PCS-FG-22G', 'FULL LASER+DL', 28, 55],
  ['8-PCS-FG-22G', 'FULL LASER+DL+LOGO', 30, 60],
  ['10-PCS-FG-22G', 'CARVING+LOGO', 102.5, 155],
];

async function main() {
  token = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }) })).json())?.data?.accessToken;

  // 1) Clear existing combinations (rebuild from scratch with this authoritative list).
  const existing = ((await (await api('/combinations?page=1&pageSize=500')).json())?.data?.items ?? []);
  for (const c of existing) await api(`/combinations/${c.id}`, { method: 'DELETE' });
  console.log(`cleared ${existing.length} existing combination(s): ${existing.map((c) => c.code).join(', ') || '(none)'}`);

  // 2) Import all rows.
  const rows = DATA.map(([sub, type, cost, rate]) => ({ CATEGORY: 'GLASS', 'SUB CATEGORY': sub, 'DESIGN TYPE': type, COST: cost, RATE: rate }));
  const res = (await (await post('/combinations/import', { rows })).json())?.data;
  console.log(`\nimport -> created=${res.created}  updated=${res.updated}  skipped=${res.errors.length}  (of ${DATA.length})`);
  if (res.errors.length) {
    console.log('\nSKIPPED rows (a design does not exist — add it first, then re-import that row):');
    res.errors.forEach((e) => console.log(`  - ${e}`));
  }

  // 3) Cost/rate check against the sheet for everything that was created.
  const expected = new Map(DATA.map(([sub, type, cost, rate]) => [`${sub}|${type}`, { cost, rate }]));
  const all = (await (await api('/combinations?page=1&pageSize=500')).json())?.data?.items ?? [];
  let mismatches = 0;
  for (const c of all) {
    const exp = expected.get(`${c.subCategory}|${c.name}`);
    if (exp && (exp.cost !== c.cost || exp.rate !== c.rate)) {
      mismatches++;
      console.log(`  COST DIFF ${c.code} ${c.subCategory} | ${c.name}: db ${c.cost}/${c.rate} vs sheet ${exp.cost}/${exp.rate}`);
    }
  }
  console.log(`\nfinal combinations in DB: ${all.length}; cost/rate matches sheet: ${mismatches === 0 ? 'YES (all)' : mismatches + ' differ (see above)'}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
