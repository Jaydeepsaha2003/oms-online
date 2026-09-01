/**
 * Set the per-bucket payment routing for every party linked to a given agent.
 *
 * WHY: routing is per money bucket. A party commonly settles its own bank
 * transfers while its agent physically hands over the cash and asks for the
 * pending invoices to be cleared FIFO or against refs. `payBy` is the base and
 * `payByModes` (JSON) overrides it per bucket — see payByFor() in @oms/shared,
 * the single place that decides.
 *
 * WHAT IT WRITES: customers.payBy and customers.payByModes, on the parties of
 * the named agent, and nothing else. No invoice, receipt, ledger or advance row
 * is touched. Credit/debit notes read `payBy` only, so setting just the cash
 * bucket leaves note behaviour alone.
 *
 * CONSEQUENCE, read before applying: a bucket routed to AGENT can no longer be
 * paid in Party mode — that money must come through the agent. Receipts already
 * recorded stay editable (resolveCustomers takes a `replay` flag that skips the
 * check when replaying recorded history).
 *
 * Usage, from the repo root:
 *   node scripts/set-payby-agent.cjs JOHN --bank=PARTY --cash=AGENT
 *   node scripts/set-payby-agent.cjs JOHN --bank=PARTY --cash=AGENT --apply
 *
 * Omitting a bucket leaves that bucket's current effective routing as it is.
 * --db=<path> points it at another database file — used to rehearse --apply on
 * a copy before touching dev.db.
 */
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { payByFor, PAY_BUCKETS } = require('@oms/shared');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim().toUpperCase() : null;
};
const dbArg = argv.find((a) => a.startsWith('--db='));
const AGENT = argv.find((a) => !a.startsWith('-'));
const WANT = { bank: flag('bank'), cash: flag('cash') };
const DB = dbArg ? path.resolve(dbArg.slice(5)) : path.join(__dirname, '..', 'apps', 'api', 'prisma', 'dev.db');
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + DB.split(path.sep).join('/') } } });

async function main() {
  if (!AGENT || PAY_BUCKETS.every((b) => !WANT[b])) {
    console.error('Usage: node scripts/set-payby-agent.cjs <AGENT> [--bank=PARTY|AGENT] [--cash=PARTY|AGENT] [--apply] [--db=<path>]');
    process.exitCode = 1;
    return;
  }
  for (const b of PAY_BUCKETS) {
    if (WANT[b] && WANT[b] !== 'PARTY' && WANT[b] !== 'AGENT') {
      console.error(`--${b} must be PARTY or AGENT (got ${WANT[b]}).`);
      process.exitCode = 1;
      return;
    }
  }

  // Exact match, same as resolveCustomers — a name differing by case or spacing
  // is a different agent as far as the screen is concerned.
  const parties = await prisma.customer.findMany({ where: { agentName: AGENT }, orderBy: { partyName: 'asc' } });
  if (!parties.length) {
    console.log(`No parties have agentName exactly "${AGENT}". Nothing to do.`);
    return;
  }

  const plan = [];
  for (const c of parties) {
    const now = Object.fromEntries(PAY_BUCKETS.map((b) => [b, payByFor(c, b)]));
    const next = Object.fromEntries(PAY_BUCKETS.map((b) => [b, WANT[b] ?? now[b]]));
    // Canonical form: payBy carries the bank routing, payByModes overrides only
    // what differs — so "no override" has one representation, not two.
    const payBy = next.bank;
    const modes = {};
    for (const b of PAY_BUCKETS) if (next[b] !== payBy) modes[b] = next[b];
    const payByModes = Object.keys(modes).length ? JSON.stringify(modes) : null;
    if (PAY_BUCKETS.every((b) => now[b] === next[b]) && c.payBy === payBy && c.payByModes === payByModes) continue;
    plan.push({ c, now, next, payBy, payByModes });
  }

  console.log(`Agent "${AGENT}" — ${parties.length} part(ies), ${plan.length} changing.\n`);
  for (const { c, now, next } of plan) {
    const moves = PAY_BUCKETS.map((b) => `${b}: ${now[b]}${now[b] === next[b] ? '' : ` -> ${next[b]}`}`).join('   ');
    console.log(`  #${String(c.id).padEnd(4)} ${(c.partyName ?? '').padEnd(34)} ${moves}`);
  }
  if (!plan.length) {
    console.log('Already routed that way. Nothing to do.');
    return;
  }
  if (!APPLY) {
    console.log(`\nDry run — nothing written. Re-run with --apply to write.`);
    return;
  }

  // VACUUM INTO, not a file copy: with WAL journalling the newest committed
  // pages can still live in `-wal`, so a byte-for-byte copy can be torn or miss
  // recent writes. Same reason BackupService takes its snapshots this way.
  const backup = `${DB}.bak-before-payby-${AGENT.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  fs.rmSync(backup, { force: true }); // VACUUM INTO requires the target not to exist
  await prisma.$executeRawUnsafe(`VACUUM INTO '${backup.replace(/\\/g, '/').replace(/'/g, "''")}'`);
  console.log(`\nBackup: ${backup}`);

  for (const { c, payBy, payByModes } of plan) {
    await prisma.customer.update({ where: { id: c.id }, data: { payBy, payByModes } });
  }
  console.log(`Updated ${plan.length} row(s).`);

  const after = await prisma.customer.findMany({ where: { agentName: AGENT } });
  const wrong = after.filter((c) => PAY_BUCKETS.some((b) => WANT[b] && payByFor(c, b) !== WANT[b]));
  console.log(wrong.length ? `WARNING: ${wrong.length} part(ies) did not end up as asked.` : `Verified: all ${after.length} part(ies) route as asked.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
