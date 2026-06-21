/* Verify: text stored UPPERCASE (backfill + on save + import) and mobile/email
   validation on the form (DTO) and on import. Run: node scripts/verify-uppercase.cjs */
const BASE = 'http://localhost:4000/api';
const S = Date.now();
let token;
const api = (p, o = {}) =>
  fetch(`${BASE}${p}`, { ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(o.headers || {}) } });

const baseCustomer = (over) => ({
  partySource: 'SELF', agentName: 'SELF', category: 'cat', partyName: `x`, transportName: `UPTRANS ${S}`,
  creditPeriod: 1, city: 'c', state: 's', region: 'r', ...over,
});

async function main() {
  token = (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }) })).json())?.data?.accessToken;
  const out = [];
  const made = [];

  // 1) Existing data backfilled to uppercase.
  const sample = (await (await api('/customers?pageSize=10')).json())?.data?.items ?? [];
  const offenders = sample.filter((c) => (c.partyName && c.partyName !== c.partyName.toUpperCase()) || (c.city && c.city !== c.city.toUpperCase()));
  out.push(`backfill: ${sample.length} sampled, ${offenders.length} non-uppercase -> ${offenders.length === 0 ? 'OK' : 'FAIL'}`);

  // 2) Create with lowercase -> stored uppercase.
  const c = (await (await api('/customers', { method: 'POST', body: JSON.stringify(baseCustomer({ partyName: `lower co ${S}`, city: 'mumbai', email: 'Mixed@Case.com', mobile: '9876543210' })) })).json())?.data;
  if (c) made.push(c.id);
  out.push(`create uppercases -> partyName="${c?.partyName}" city="${c?.city}" email="${c?.email}" ${c && c.partyName === c.partyName.toUpperCase() && c.city === 'MUMBAI' && c.email === 'MIXED@CASE.COM' ? 'OK' : 'FAIL'}`);

  // 3) Invalid email -> 400.
  const e = await api('/customers', { method: 'POST', body: JSON.stringify(baseCustomer({ partyName: `bad email ${S}`, email: 'not-an-email' })) });
  out.push(`invalid email rejected -> HTTP ${e.status} ${e.status === 400 ? 'OK' : 'FAIL'}`);

  // 4) Invalid mobile -> 400.
  const m = await api('/customers', { method: 'POST', body: JSON.stringify(baseCustomer({ partyName: `bad mobile ${S}`, mobile: 'abc12' })) });
  out.push(`invalid mobile rejected -> HTTP ${m.status} ${m.status === 400 ? 'OK' : 'FAIL'}`);

  // 5) Import: invalid email row skipped; valid lowercase row stored uppercase.
  const imp = (await (await api('/customers/import', { method: 'POST', body: JSON.stringify({ rows: [
    { 'PARTY NAME': `IMP BAD ${S}`, EMAIL: 'bademail' },
    { 'PARTY NAME': `imp good ${S}`, CITY: 'pune', MOBILE: '9988776655' },
  ] }) })).json())?.data;
  out.push(`import invalid email skipped -> created=${imp?.created} errors=${imp?.errors?.length} ${imp?.created === 1 && imp?.errors?.length === 1 ? 'OK' : 'FAIL'}`);
  const good = (await (await api(`/customers?search=${encodeURIComponent(`IMP GOOD ${S}`)}`)).json())?.data?.items?.[0];
  out.push(`import uppercases -> partyName="${good?.partyName}" city="${good?.city}" ${good && good.partyName === good.partyName.toUpperCase() && good.city === 'PUNE' ? 'OK' : 'FAIL'}`);
  if (good) made.push(good.id);

  console.log(out.join('\n'));

  // cleanup
  for (const id of made) await api(`/customers/${id}`, { method: 'DELETE' });
  const tr = (await (await api(`/transporters?search=${encodeURIComponent(`UPTRANS ${S}`)}`)).json())?.data?.items?.[0];
  if (tr) await api(`/transporters/${tr.id}`, { method: 'DELETE' });
  console.log('cleanup done');

  const ok = out.every((l) => l.includes('OK'));
  console.log(`RESULT: ${ok ? 'ALL OK' : 'SOME CHECKS FAILED'}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
