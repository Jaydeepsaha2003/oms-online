/* Create a few realistic sample orders from real catalog data. Leaves them in the DB. */
const B = 'http://localhost:4000/api';

(async () => {
  const t = (await (await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }) })).json()).data.accessToken;
  const auth = { 'content-type': 'application/json', authorization: `Bearer ${t}` };
  const lk = (await (await fetch(`${B}/orders/lookups`, { headers: auth })).json()).data;

  const customer = lk.customers[0]?.name ?? 'AARTI STEELS';
  // pick a few item options that have a design + a rate, from different products
  const withDesign = lk.items.filter((i) => i.designType && i.productRate != null);
  const seenProd = new Set();
  const picks = [];
  for (const it of withDesign) {
    if (seenProd.has(it.product)) continue;
    seenProd.add(it.product);
    picks.push(it);
    if (picks.length >= 6) break;
  }

  const line = (it, qty) => {
    const designName = `${it.product} ${it.designType}`;
    const productRate = it.productRate ?? 0;
    const designRate = it.designRate ?? 0;
    return {
      pCategory: it.category,
      subCategory: it.subCategory,
      product: it.product,
      productName: designName,
      designType: it.designType,
      psize: it.size,
      productRate,
      designRate,
      rate: productRate + designRate,
      calField: 'KGS',
      ordType: 'SALES ORDER',
      priority: qty % 2 ? 'URGENT' : 'NORMAL',
      bags: qty,
      pcs: qty * 50,
      gram: qty * 2,
      box: qty,
      comment: '',
    };
  };

  const orders = [
    { customerName: customer, orderDate: '2026-06-21', completionDate: '2026-06-28', status: 'CONFIRMED', items: [line(picks[0], 2), line(picks[1], 3), line(picks[2], 1)] },
    { customerName: customer, orderDate: '2026-06-22', completionDate: '2026-07-02', status: 'PENDING', items: [line(picks[3], 4), line(picks[4], 2)] },
    { customerName: lk.customers[1]?.name ?? customer, orderDate: '2026-06-23', completionDate: '2026-06-30', status: 'CONFIRMED', items: [line(picks[5], 5)] },
  ];

  for (const o of orders) {
    const res = (await (await fetch(`${B}/orders`, { method: 'POST', headers: auth, body: JSON.stringify(o) })).json()).data;
    console.log(`created ${res.code}  ${res.customerName}  ${res.itemCount} item(s)  ₹${res.totalRate}`);
  }
  const total = (await (await fetch(`${B}/orders?page=1&pageSize=5`, { headers: auth })).json()).data.total;
  console.log('orders in DB now:', total);
})().catch((e) => { console.error(e); process.exit(1); });
