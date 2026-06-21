/* Remove the rows created by verify-codes.cjs. Run: node scripts/cleanup-codes-test.cjs */
const BASE = 'http://localhost:4000/api';

async function main() {
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }),
  });
  const token = (await loginRes.json())?.data?.accessToken;
  const auth = { authorization: `Bearer ${token}` };

  const delMatching = async (listPath, delBase, search) => {
    const res = await fetch(`${BASE}${listPath}?search=${encodeURIComponent(search)}&pageSize=100`, { headers: auth });
    const items = (await res.json())?.data?.items ?? [];
    for (const it of items) {
      await fetch(`${BASE}${delBase}/${it.id}`, { method: 'DELETE', headers: auth });
      console.log(`deleted ${delBase}/${it.id} (${it.partyName ?? it.name})`);
    }
  };

  await delMatching('/customers', '/customers', 'CODE TEST CO');
  await delMatching('/customers', '/customers', 'IMPORT NO CODE');
  await delMatching('/transporters', '/transporters', 'CODE TEST TRANS');
  console.log('cleanup done');
}

main().catch((e) => { console.error(e); process.exit(1); });
