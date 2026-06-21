/* Verify the agents feature end-to-end. Run: node scripts/verify-agents.cjs */
const BASE = 'http://localhost:4000/api';
const S = Date.now();
let token;
const api = (p, o = {}) =>
  fetch(`${BASE}${p}`, { ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(o.headers || {}) } });

async function main() {
  token = (await (await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@oms.local', password: 'Admin@12345' }),
  })).json())?.data?.accessToken;

  const out = [];
  const cleanup = { customers: [], agents: [] };

  // 1) Agents list — backfilled from existing customer agent names.
  const list = (await (await api('/agents?pageSize=5')).json())?.data;
  out.push(`agents list -> total=${list?.total} sample=${JSON.stringify(list?.items?.slice(0, 3).map((a) => a.name))} ${list?.total >= 0 ? 'OK' : 'FAIL'}`);
  const hasTimestamps = list?.items?.[0] ? !!list.items[0].createdAt && !!list.items[0].updatedAt : true;
  out.push(`agents have timestamps -> ${hasTimestamps ? 'OK' : 'FAIL'}`);

  // 2) Create a customer with a brand-new agent name -> agent auto-added.
  const newAgent = `ZZ NEW AGENT ${S}`;
  const cust = (await (await api('/customers', {
    method: 'POST',
    body: JSON.stringify({ partyName: `AGENT TEST CUST ${S}`, partySource: 'AGENT', agentName: newAgent, category: 'X', creditPeriod: 1, city: 'C', state: 'S', region: 'R', transportName: `ATRANS ${S}` }),
  })).json())?.data;
  if (cust) cleanup.customers.push(cust.id);
  const agentFound = (await (await api(`/agents?search=${encodeURIComponent(newAgent)}`)).json())?.data?.items?.[0];
  out.push(`new agent auto-added on customer save -> ${agentFound ? `OK (${agentFound.name}, added ${agentFound.createdAt?.slice(0,16)})` : 'FAIL'}`);
  if (agentFound) cleanup.agents.push(agentFound.id);

  // 3) Customer DTO exposes code.
  out.push(`customer.code present -> ${cust?.code ? `OK (${cust.code})` : 'FAIL'}`);

  // 4) Direct agent create + duplicate guard.
  const a2 = await api('/agents', { method: 'POST', body: JSON.stringify({ name: newAgent }) });
  out.push(`duplicate agent create -> HTTP ${a2.status} ${a2.status === 409 ? 'OK (blocked)' : 'FAIL'}`);

  // 5) Agents export carries headers even though we filter to nothing.
  const XLSX = require('xlsx');
  const res = await api('/agents/export?search=__none__zzz');
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });
  const hdr = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0] || [];
  out.push(`agents export header -> ${JSON.stringify(hdr)} ${hdr.includes('AGENT NAME') ? 'OK' : 'FAIL'}`);

  console.log(out.join('\n'));

  for (const id of cleanup.customers) await api(`/customers/${id}`, { method: 'DELETE' });
  for (const id of cleanup.agents) await api(`/agents/${id}`, { method: 'DELETE' });
  // also remove the auto-created transporter from the test customer
  const tr = (await (await api(`/transporters?search=${encodeURIComponent(`ATRANS ${S}`)}`)).json())?.data?.items?.[0];
  if (tr) await api(`/transporters/${tr.id}`, { method: 'DELETE' });
  console.log(`\ncleanup done`);

  const ok = out.every((l) => l.includes('OK'));
  console.log(`RESULT: ${ok ? 'ALL OK' : 'SOME CHECKS FAILED'}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
