/* Verify Settings backend + order item ordType. Run: node scripts/verify-settings.cjs */
const BASE = 'http://localhost:4000/api';
let token;
const api = (p, o = {}) => fetch(`${BASE}${p}`, { ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(o.headers || {}) } });

(async () => {
  token = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }) })).json())?.data?.accessToken;
  const out = [];

  // list seeded settings
  let list = (await (await api('/settings')).json())?.data;
  const days = list.filter((o) => o.group === 'COMPLETION_DAYS').map((o) => o.value);
  const types = list.filter((o) => o.group === 'ORDER_TYPE').map((o) => o.value);
  out.push(`list -> completionDays=[${days.join(',')}] orderTypes=[${types.join(',')}] ${days.length === 6 && types.length === 2 ? 'OK' : 'FAIL'}`);

  // add a new completion-day option
  const added = (await (await api('/settings', { method: 'POST', body: JSON.stringify({ group: 'COMPLETION_DAYS', value: '21' }) })).json())?.data;
  out.push(`add -> id=${added?.id} value=${added?.value} ${added?.value === '21' ? 'OK' : 'FAIL'}`);

  // duplicate should 409
  const dup = await api('/settings', { method: 'POST', body: JSON.stringify({ group: 'COMPLETION_DAYS', value: '21' }) });
  out.push(`dup -> status=${dup.status} (expect 409) ${dup.status === 409 ? 'OK' : 'FAIL'}`);

  // delete it back out
  await api(`/settings/${added.id}`, { method: 'DELETE' });
  list = (await (await api('/settings')).json())?.data;
  out.push(`delete -> 21 gone ${!list.some((o) => o.value === '21' && o.group === 'COMPLETION_DAYS') ? 'OK' : 'FAIL'}`);

  // order with per-item ordType round-trips
  const order = (await (await api('/orders', { method: 'POST', body: JSON.stringify({
    customerName: 'AARTI STEELS', orderDate: '2026-06-21', completionDate: '2026-06-28', status: 'CONFIRMED',
    items: [{ pCategory: 'CUP', product: 'X', designType: 'D', productRate: 10, designRate: 5, ordType: 'SALES ORDER', priority: 'URGENT', bags: 2 }],
  }) })).json())?.data;
  const it = order?.items?.[0];
  out.push(`order item ordType -> status=${order?.status} ordType=${it?.ordType} ${order?.status === 'CONFIRMED' && it?.ordType === 'SALES ORDER' ? 'OK' : 'FAIL'}`);
  await api(`/orders/${order.id}`, { method: 'DELETE' });

  console.log(out.join('\n'));
  console.log(`RESULT: ${out.every((l) => l.includes('OK')) ? 'ALL OK' : 'SOME CHECKS FAILED'}`);
})().catch((e) => { console.error(e); process.exit(1); });
