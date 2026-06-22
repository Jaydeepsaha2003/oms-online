/* Verify the Orders backend: lookups, create (with line items), list, get, update, delete.
   Run: node scripts/verify-orders.cjs */
const BASE = 'http://localhost:4000/api';
let token;
const api = (p, o = {}) =>
  fetch(`${BASE}${p}`, { ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(o.headers || {}) } });
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });

async function main() {
  token = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }) })).json())?.data?.accessToken;
  const out = [];

  const lk = (await (await api('/orders/lookups')).json())?.data;
  const prodOk = lk.products.length && typeof lk.products[0] === 'object' && 'category' in lk.products[0];
  const dsgnOk = lk.designs.length && 'designType' in lk.designs[0];
  out.push(`lookups -> customers=${lk.customers.length} categories=${lk.categories.length} products=${lk.products.length}(obj=${!!prodOk}) designs=${lk.designs.length}(obj=${!!dsgnOk}) ${lk.customers.length && prodOk && dsgnOk ? 'OK' : 'FAIL'}`);

  // create
  const created = (await (await post('/orders', {
    customerName: 'AARTI STEELS',
    orderDate: '2026-06-21',
    completionDate: '2026-06-28',
    priority: 'URGENT',
    status: 'PENDING',
    comment: 'rush',
    items: [
      { pCategory: 'CUP', product: 'TEST P', designType: 'DL', productRate: 10, designRate: 5, bags: 2, calField: 'KGS', priority: 'URGENT', comment: 'line note' },
      { pCategory: 'GLASS', productRate: 20, designRate: 0, pcs: 100, calField: 'PCS' },
    ],
  })).json())?.data;
  const item0 = created?.items?.[0];
  const okCreate = created && /^ORD-\d{5}$/.test(created.code) && created.itemCount === 2 && created.totalRate === 35 && created.completionDay === 7 && created.agentName != null && item0?.priority === 'URGENT' && item0?.comment === 'line note';
  out.push(`create -> code=${created?.code} items=${created?.itemCount} total=${created?.totalRate} compDay=${created?.completionDay} agent=${created?.agentName} item0.priority=${item0?.priority} item0.comment="${item0?.comment}" ${okCreate ? 'OK' : 'FAIL'}`);
  const id = created.id;

  // get
  const got = (await (await api(`/orders/${id}`)).json())?.data;
  out.push(`get -> item[0] rate=${got.items[0].rate} (expect 15) ${got.items[0].rate === 15 ? 'OK' : 'FAIL'}`);

  // list/search
  const list = (await (await api('/orders?search=AARTI STEELS&page=1&pageSize=20')).json())?.data;
  out.push(`list/search -> found=${list.items.some((o) => o.id === id)} total=${list.total} ${list.items.some((o) => o.id === id) ? 'OK' : 'FAIL'}`);

  // update: confirm + replace items with one
  const upd = (await (await api(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ customerName: 'AARTI STEELS', status: 'CONFIRMED', items: [{ pCategory: 'LOTI', productRate: 7, designRate: 3 }] }) })).json())?.data;
  out.push(`update -> status=${upd.status} items=${upd.itemCount} total=${upd.totalRate} ${upd.status === 'CONFIRMED' && upd.itemCount === 1 && upd.totalRate === 10 ? 'OK' : 'FAIL'}`);

  // delete
  await api(`/orders/${id}`, { method: 'DELETE' });
  const after = await api(`/orders/${id}`);
  out.push(`delete -> get status ${after.status} (expect 404) ${after.status === 404 ? 'OK' : 'FAIL'}`);

  console.log(out.join('\n'));
  console.log(`RESULT: ${out.every((l) => l.includes('OK')) ? 'ALL OK' : 'SOME CHECKS FAILED'}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
