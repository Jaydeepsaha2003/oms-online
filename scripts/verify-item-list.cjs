/* Verify the composite item-name list from /orders/lookups. */
const BASE = 'http://localhost:4000/api';
(async () => {
  const token = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }) })).json())?.data?.accessToken;
  const lk = (await (await fetch(`${BASE}/orders/lookups`, { headers: { authorization: `Bearer ${token}` } })).json())?.data;
  const items = lk.items || [];
  const plain = items.filter((i) => i.designType == null).length;
  const withDesign = items.filter((i) => i.designType != null).length;
  console.log(`total items: ${items.length} (plain=${plain}, withDesign=${withDesign})`);
  // show a few sample composite labels (Size mode and Pcs mode)
  const fmt = (v) => (v == null ? '' : String(v));
  const label = (it, by) => [by === 'PCS' ? fmt(it.pcs) : fmt(it.size), it.product, it.designType ?? ''].filter(Boolean).join(' ');
  const sample = items.filter((i) => i.designType != null).slice(0, 6);
  console.log('--- sample (Size mode) ---');
  for (const it of sample) console.log(' ', label(it, 'SIZE'), ' | prodRate=', it.productRate, ' dsgnRate=', it.designRate);
  console.log('--- same items (Pcs mode) ---');
  for (const it of sample) console.log(' ', label(it, 'PCS'));
  // a plain-product sample
  const p = items.find((i) => i.designType == null && i.productRate != null);
  console.log('plain sample (Size):', p ? label(p, 'SIZE') : '(none)', 'rate=', p?.productRate);
  console.log(items.length > 0 && withDesign > 0 ? 'RESULT: OK' : 'RESULT: FAIL');
})().catch((e) => { console.error(e); process.exit(1); });
