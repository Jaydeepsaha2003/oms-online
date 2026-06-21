/* Verify: (A) transporter import auto-fills TID by matching the name, and
   (B) customer name and transporter name cannot be identical.
   Run: node scripts/verify-names.cjs */
const BASE = 'http://localhost:4000/api';
const S = Date.now();
let token;

const api = (path, opts = {}) =>
  fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });

async function main() {
  token = (await (await api('/auth/login', {
    method: 'POST',
    headers: { authorization: '' },
    body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }),
  })).json())?.data?.accessToken;

  const out = [];
  const created = { customers: [], transporters: [] };

  // (A) Transporter import with NAME only (no TID) -> TID auto-assigned by name.
  const tName = `AUTO TID TRANS ${S}`;
  await api('/transporters/import', { method: 'POST', body: JSON.stringify({ rows: [{ 'TRANSPORT NAME': tName, PACKING: 7 }] }) });
  let found = (await (await api(`/transporters?search=${encodeURIComponent(tName)}`)).json())?.data?.items?.[0];
  out.push(`A1 import(name only) -> TID=${found?.id} code=${found?.code} ${found?.id ? 'OK (TID auto-filled)' : 'FAIL'}`);
  const firstId = found?.id;
  if (found) created.transporters.push(found.id);
  // Re-import same name -> matched to same TID (no duplicate).
  await api('/transporters/import', { method: 'POST', body: JSON.stringify({ rows: [{ 'TRANSPORT NAME': tName, PACKING: 9 }] }) });
  found = (await (await api(`/transporters?search=${encodeURIComponent(tName)}`)).json())?.data;
  out.push(`A2 re-import same name -> count=${found?.total} sameTID=${found?.items?.[0]?.id === firstId} ${found?.total === 1 && found?.items?.[0]?.id === firstId ? 'OK' : 'FAIL'}`);

  // (B1) Create a customer, then try to create a transporter with the SAME name -> 409.
  const clashName = `NAMECLASH ${S}`;
  const cust = (await (await api('/customers', { method: 'POST', body: JSON.stringify({ partyName: clashName }) })).json())?.data;
  if (cust) created.customers.push(cust.id);
  const trRes = await api('/transporters', { method: 'POST', body: JSON.stringify({ name: clashName }) });
  out.push(`B1 transporter create == customer name -> HTTP ${trRes.status} ${trRes.status === 409 ? 'OK (blocked)' : 'FAIL'}`);

  // (B2) Create a transporter, then try to create a customer with the SAME name -> 409.
  const clash2 = `TRANSCLASH ${S}`;
  const tr2 = (await (await api('/transporters', { method: 'POST', body: JSON.stringify({ name: clash2 }) })).json())?.data;
  if (tr2) created.transporters.push(tr2.id);
  const custRes = await api('/customers', { method: 'POST', body: JSON.stringify({ partyName: clash2 }) });
  out.push(`B2 customer create == transporter name -> HTTP ${custRes.status} ${custRes.status === 409 ? 'OK (blocked)' : 'FAIL'}`);

  // (B3) Transporter import that collides with a customer name -> skipped with error.
  const imp = (await (await api('/transporters/import', { method: 'POST', body: JSON.stringify({ rows: [{ 'TRANSPORT NAME': clashName }] }) })).json())?.data;
  out.push(`B3 transporter import == customer name -> created=${imp?.created} errors=${imp?.errors?.length} ${imp?.created === 0 && imp?.errors?.length === 1 ? 'OK (skipped)' : 'FAIL'}`);

  // (B4) Customer import where PARTY NAME == TRANSPORT NAME -> skipped with error.
  const imp2 = (await (await api('/customers/import', { method: 'POST', body: JSON.stringify({ rows: [{ 'PARTY NAME': `SAME ${S}`, 'TRANSPORT NAME': `SAME ${S}` }] }) })).json())?.data;
  out.push(`B4 customer import PARTY==TRANSPORT -> created=${imp2?.created} errors=${imp2?.errors?.length} ${imp2?.created === 0 && imp2?.errors?.length === 1 ? 'OK (skipped)' : 'FAIL'}`);

  console.log(out.join('\n'));

  // Cleanup
  for (const id of created.customers) await api(`/customers/${id}`, { method: 'DELETE' });
  for (const id of created.transporters) await api(`/transporters/${id}`, { method: 'DELETE' });
  console.log(`\ncleanup: removed ${created.customers.length} customer(s), ${created.transporters.length} transporter(s)`);

  const allOk = out.every((l) => l.includes('OK'));
  console.log(`RESULT: ${allOk ? 'ALL OK' : 'SOME CHECKS FAILED'}`);
  process.exit(allOk ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
