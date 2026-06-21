/* Verify: (1) GST/Transport rate-change history is recorded and queryable,
   (2) Customer TDS fields round-trip. Uses throwaway data and cleans up.
   Run: node scripts/verify-history-tds.cjs */
const BASE = 'http://localhost:4000/api';
let token;
const api = (p, o = {}) =>
  fetch(`${BASE}${p}`, { ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(o.headers || {}) } });
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });
const CAT = 'ZHISTCAT';
const CUST = 'AARTI STEELS';

async function main() {
  token = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }) })).json())?.data?.accessToken;
  const out = [];

  // ── GST history: set 5 then 15 then 15 (no-op) ──────────────────────────────
  await post('/gst-rates/bulk', { customerName: CUST, rates: [{ category: CAT, rate: 5 }] });
  await post('/gst-rates/bulk', { customerName: CUST, rates: [{ category: CAT, rate: 15 }] });
  await post('/gst-rates/bulk', { customerName: CUST, rates: [{ category: CAT, rate: 15 }] }); // unchanged -> no history
  const hist = (await (await api(`/gst-rates/history?customerName=${encodeURIComponent(CUST)}&category=${CAT}`)).json())?.data;
  out.push(`gst history entries -> ${hist.length} (expect 2) ${hist.length === 2 ? 'OK' : 'FAIL'}`);
  out.push(`newest change -> ${hist[0]?.oldRate}→${hist[0]?.newRate} (expect 5→15) ${hist[0]?.oldRate === 5 && hist[0]?.newRate === 15 ? 'OK' : 'FAIL'}`);
  out.push(`first change -> ${hist[1]?.oldRate}→${hist[1]?.newRate} (expect null→5) ${hist[1]?.oldRate === null && hist[1]?.newRate === 5 ? 'OK' : 'FAIL'}`);

  // cleanup the GST test rate
  const g = (await (await api(`/gst-rates/by-customer?name=${encodeURIComponent(CUST)}`)).json())?.data;
  for (const r of g.filter((x) => x.category === CAT)) await api(`/gst-rates/${r.id}`, { method: 'DELETE' });

  // ── TDS: create a throwaway customer with TDS, verify, delete ────────────────
  const created = (await (await post('/customers', {
    partySource: 'SELF', category: 'ZTDS', partyName: 'ZTEST TDS CUST', creditPeriod: 0,
    city: 'ZT', state: 'ZT', region: 'ZT', tdsApplicable: true, tdsPercent: 2,
  })).json())?.data;
  out.push(`customer create w/ TDS -> applicable=${created?.tdsApplicable} percent=${created?.tdsPercent} ${created?.tdsApplicable === true && created?.tdsPercent === 2 ? 'OK' : 'FAIL'}`);
  // toggle TDS off via full update -> percent must clear
  const upd = (await (await api(`/customers/${created.id}`, { method: 'PATCH', body: JSON.stringify({ partyName: 'ZTEST TDS CUST', tdsApplicable: false, tdsPercent: 2 }) })).json())?.data;
  out.push(`TDS off clears percent -> applicable=${upd?.tdsApplicable} percent=${upd?.tdsPercent} ${upd?.tdsApplicable === false && upd?.tdsPercent === null ? 'OK' : 'FAIL'}`);
  await api(`/customers/${created.id}`, { method: 'DELETE' });

  console.log(out.join('\n'));
  console.log(`RESULT: ${out.every((l) => l.includes('OK')) ? 'ALL OK' : 'SOME CHECKS FAILED'}`);
  console.log(`NOTE: ${hist.length} GST history rows for ${CUST}/${CAT} remain — delete via prisma if undesired.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
