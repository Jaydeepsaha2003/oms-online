/* Verify agents fields, rate customer-code link, and the products catalog.
   Run: node scripts/verify-catalog.cjs */
const BASE = 'http://localhost:4000/api';
const S = Date.now();
let token;
const api = (p, o = {}) =>
  fetch(`${BASE}${p}`, { ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(o.headers || {}) } });
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body) });

async function main() {
  token = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }) })).json())?.data?.accessToken;
  const out = [];
  const made = { products: [], designs: [], combinations: [], designNames: [], agents: [], gst: [], trans: [] };

  // 1) Agent with contact/state/city (stored uppercase)
  const ag = (await (await post('/agents', { name: `CAT AGENT ${S}`, contactNo: '9876543210', state: 'gujarat', city: 'surat' })).json())?.data;
  if (ag) made.agents.push(ag.id);
  out.push(`agent fields -> contact=${ag?.contactNo} state=${ag?.state} city=${ag?.city} ${ag?.state === 'GUJARAT' && ag?.city === 'SURAT' ? 'OK' : 'FAIL'}`);

  // 2) Product create -> PRD code; duplicate -> 409
  const pr = (await (await post('/products', { category: 'glass', subCategory: '10-pcs', product: `tumbler ${S}`, size: 22, weight: 0.2, pcs: 10, rate: 50 })).json())?.data;
  if (pr) made.products.push(pr.id);
  out.push(`product create -> code=${pr?.code} cat=${pr?.category} ${/^PRD-\d{5}$/.test(pr?.code || '') && pr?.category === 'GLASS' ? 'OK' : 'FAIL'}`);
  const dup = await post('/products', { category: 'GLASS', subCategory: '10-PCS', product: `TUMBLER ${S}`, size: 22 });
  out.push(`product duplicate -> HTTP ${dup.status} ${dup.status === 409 ? 'OK' : 'FAIL'}`);

  // 3) Design + Combination codes
  const dg = (await (await post('/designs', { category: 'glass', subCategory: '10-pcs', designType: `dl ${S}`, cost: 2, rate: 5 })).json())?.data;
  if (dg) made.designs.push(dg.id);
  out.push(`design create -> code=${dg?.code} ${/^DSG-\d{5}$/.test(dg?.code || '') ? 'OK' : 'FAIL'}`);
  const cm = (await (await post('/combinations', { category: 'glass', subCategory: '10-pcs', designType: `dl ${S}`, cost: 7, rate: 12 })).json())?.data;
  if (cm) made.combinations.push(cm.id);
  out.push(`combination create -> code=${cm?.code} ${/^CMB-\d{5}$/.test(cm?.code || '') ? 'OK' : 'FAIL'}`);

  // 4) Design name lookup
  const dn = (await (await post('/design-names', { designType: `dl ${S}`, designName: `double line ${S}` })).json())?.data;
  if (dn) made.designNames.push(dn.id);
  out.push(`design name -> type=${dn?.designType} name=${dn?.designName} ${dn?.designType === `DL ${S}`.toUpperCase() ? 'OK' : 'FAIL'}`);

  // 5) Rate connects to customer by code
  const cust = (await (await api('/customers?pageSize=1')).json())?.data?.items?.[0];
  const gst = (await (await post('/gst-rates', { customerName: cust.partyName, category: `CATX ${S}`, rate: 5 })).json())?.data;
  if (gst) made.gst.push(gst.id);
  out.push(`gst rate customerCode -> ${gst?.customerCode} (cust ${cust?.code}) ${gst?.customerCode === cust?.code ? 'OK' : 'FAIL'}`);
  const tr = (await (await post('/transport-rates', { customerName: cust.partyName, category: `CATX ${S}`, type: 'ROAD', rate: 9 })).json())?.data;
  if (tr) made.trans.push(tr.id);
  out.push(`trans rate customerCode -> ${tr?.customerCode} ${tr?.customerCode === cust?.code ? 'OK' : 'FAIL'}`);

  // 6) Backfill check: existing rates have a customerCode where the customer is known
  const gAll = (await (await api('/gst-rates?pageSize=50')).json())?.data?.items ?? [];
  const linked = gAll.filter((r) => r.customerId).every((r) => !!r.customerCode);
  out.push(`gst backfill (linked rows have code) -> ${linked ? 'OK' : 'FAIL'}`);

  console.log(out.join('\n'));

  // cleanup
  for (const id of made.gst) await api(`/gst-rates/${id}`, { method: 'DELETE' });
  for (const id of made.trans) await api(`/transport-rates/${id}`, { method: 'DELETE' });
  for (const id of made.products) await api(`/products/${id}`, { method: 'DELETE' });
  for (const id of made.designs) await api(`/designs/${id}`, { method: 'DELETE' });
  for (const id of made.combinations) await api(`/combinations/${id}`, { method: 'DELETE' });
  for (const id of made.designNames) await api(`/design-names/${id}`, { method: 'DELETE' });
  for (const id of made.agents) await api(`/agents/${id}`, { method: 'DELETE' });
  console.log('cleanup done');

  const ok = out.every((l) => l.includes('OK'));
  console.log(`RESULT: ${ok ? 'ALL OK' : 'SOME CHECKS FAILED'}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
