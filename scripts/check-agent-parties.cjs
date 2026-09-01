/**
 * Who can Receive Payment actually collect for, per agent and per money bucket?
 *
 * Routing is per bucket: a party commonly settles its own bank transfers while
 * its agent hands over the cash. This prints, for every agent in the master,
 * which parties are reachable in Agent mode for BANK and for CASH — the same
 * question PaymentsService.resolveCustomers asks, answered with the same shared
 * payByFor() so this cannot drift from the app.
 *
 * Read-only. Safe to run any time.
 *
 * Usage, from the repo root:
 *   node scripts/check-agent-parties.cjs            # against dev.db
 *   node scripts/check-agent-parties.cjs <db path>  # against a backup or copy
 */
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { payByFor, PAY_BUCKETS } = require('@oms/shared');

const DB = process.argv[2] ?? path.join(__dirname, '..', 'apps', 'api', 'prisma', 'dev.db');
const db = new DatabaseSync(DB, { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

console.log(`DB: ${DB}\n`);

const agents = q('SELECT name FROM agents ORDER BY name');
for (const { name } of agents) {
  // Mirrors resolveCustomers: the agent's parties, then filtered per bucket.
  const parties = q('SELECT id, partyName, payBy, payByModes FROM customers WHERE agentName = ? ORDER BY partyName', name);
  const reach = Object.fromEntries(PAY_BUCKETS.map((b) => [b, parties.filter((c) => payByFor(c, b) === 'AGENT')]));

  const line = PAY_BUCKETS.map((b) => `${b}=${String(reach[b].length).padStart(3)}`).join('  ');
  const dead = PAY_BUCKETS.filter((b) => !reach[b].length);
  console.log(
    `${name.padEnd(10)} parties=${String(parties.length).padStart(3)}  ${line}` +
      (dead.length === PAY_BUCKETS.length ? '  <-- BLOCKED in both buckets' : dead.length ? `  <-- BLOCKED for ${dead.join(', ')}` : ''),
  );
  for (const b of PAY_BUCKETS) {
    if (reach[b].length && reach[b].length !== parties.length) {
      console.log(`             ${b}: ${reach[b].map((c) => c.partyName).join(', ')}`);
    }
  }
}

// A party routed to an agent it does not really have is collectible by neither
// route: Party mode blocks it for that bucket, and Agent mode never finds it
// because SELF is not an agent in the master.
const orphans = q('SELECT id, partyName, agentName, payBy, payByModes FROM customers').filter((c) =>
  PAY_BUCKETS.some((b) => payByFor(c, b) === 'AGENT') && (!c.agentName || !c.agentName.trim() || c.agentName.trim().toUpperCase() === 'SELF'),
);
console.log(
  orphans.length
    ? `\nUNREACHABLE — routed to an agent they do not have:\n${orphans.map((c) => `  ${c.partyName} (agent=${c.agentName ?? 'none'})`).join('\n')}`
    : '\nNo party is routed to an agent it does not have.',
);
db.close();
