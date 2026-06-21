/* Verify GST + Transport rate lookups, by-customer and bulk save (the grid editor).
   Run: node scripts/verify-rates-bulk.cjs */
const BASE = 'http://localhost:4000/api';
let token;
const api = (p, o = {}) =>
  fetch(`${BASE}${p}`, { ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(o.headers || {}) } });
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });

async function main() {
  token = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }) })).json())?.data?.accessToken;
  const out = [];

  // Pick a real customer from lookups.
  const gl = (await (await api('/gst-rates/lookups')).json())?.data;
  const cust = gl.customers[0];
  out.push(`gst lookups -> customers=${gl.customers.length} categories=${gl.categories.length} (using "${cust}") ${cust && gl.categories.length ? 'OK' : 'FAIL'}`);

  // GST bulk: set a rate on the first 2 categories.
  const gcats = gl.categories.slice(0, 2);
  const gres = (await (await post('/gst-rates/bulk', { customerName: cust, rates: gcats.map((c, i) => ({ category: c, rate: 10 + i })) })).json())?.data;
  out.push(`gst bulk save -> saved=${gres.saved} ${gres.saved === gcats.length ? 'OK' : 'FAIL'}`);
  const gby = (await (await api(`/gst-rates/by-customer?name=${encodeURIComponent(cust)}`)).json())?.data;
  const g0 = gby.find((r) => r.category.toUpperCase() === gcats[0].toUpperCase());
  out.push(`gst by-customer reflects save -> ${cust}/${gcats[0]} rate=${g0?.rate} ${g0?.rate === 10 ? 'OK' : 'FAIL'}`);

  // Transport lookups + bulk.
  const tl = (await (await api('/transport-rates/lookups')).json())?.data;
  out.push(`trans lookups -> customers=${tl.customers.length} categories=${tl.categories.length} types=${tl.types.length} transporters=${tl.transporters.length}`);
  const tcust = tl.customers[0];
  const tcat = tl.categories[0];
  const ttype = tl.types[0] || 'STD';
  const tname = tl.transporters[0]?.name || 'TEST TRANSPORT';
  const tres = (await (await post('/transport-rates/bulk', { customerName: tcust, rates: [{ category: tcat, type: ttype, transportName: tname, rate: 42 }] })).json())?.data;
  out.push(`trans bulk save -> saved=${tres.saved} ${tres.saved === 1 ? 'OK' : 'FAIL'}`);
  const tby = (await (await api(`/transport-rates/by-customer?name=${encodeURIComponent(tcust)}`)).json())?.data;
  const t0 = tby.find((r) => r.category.toUpperCase() === tcat.toUpperCase() && r.type.toUpperCase() === ttype.toUpperCase());
  out.push(`trans by-customer reflects save -> ${tcust}/${tcat}/${ttype} rate=${t0?.rate} transporter=${t0?.transportName} ${t0?.rate === 42 ? 'OK' : 'FAIL'}`);

  // Re-save same key with a different transporter -> updates same row (no orphan).
  const before = tby.filter((r) => r.category.toUpperCase() === tcat.toUpperCase() && r.type.toUpperCase() === ttype.toUpperCase()).length;
  await post('/transport-rates/bulk', { customerName: tcust, rates: [{ category: tcat, type: ttype, transportName: tname, rate: 55 }] });
  const tby2 = (await (await api(`/transport-rates/by-customer?name=${encodeURIComponent(tcust)}`)).json())?.data;
  const after = tby2.filter((r) => r.category.toUpperCase() === tcat.toUpperCase() && r.type.toUpperCase() === ttype.toUpperCase());
  out.push(`trans re-save updates same row -> count ${before}->${after.length} rate=${after[0]?.rate} ${after.length === before && after[0]?.rate === 55 ? 'OK' : 'FAIL'}`);

  console.log(out.join('\n'));
  console.log(`RESULT: ${out.every((l) => !l.includes('FAIL')) ? 'ALL OK' : 'SOME CHECKS FAILED'}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
