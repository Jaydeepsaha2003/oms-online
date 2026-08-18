/**
 * Merge duplicate transport-rate rows — one row per (customer, category, type).
 *
 * WHY THEY EXIST: trans_rates has no unique key, and the old save logic matched
 * on (customer, category, type, TRANSPORTER). Changing or renaming a party's
 * transporter therefore CREATED a second row instead of updating the first.
 * With two rows sharing a key, an edit on screen could be written to the other
 * one — the save looked fine and the row you edited never moved.
 *
 * WHICH ROW SURVIVES, and why:
 *   [party]   the row whose transporter is the party's CURRENT transporter.
 *             This is already the row challans resolve to (challans.service
 *             rateFor() prefers a transportName match), so keeping it changes
 *             nothing about what gets billed — it only drops rows nothing reads.
 *   [recent]  no row matches the party's transporter → keep the most recently
 *             updated (ties: the oldest id, i.e. the original row) and re-point
 *             it at the party's current transporter, so the row is findable
 *             again. Only done when every duplicate holds the SAME rate, so the
 *             billed value cannot move.
 *
 * Rates are never invented or copied between rows.
 *
 * Usage, from the repo root:
 *   node scripts/dedupe-trans-rates.cjs           # dry run: prints every group, changes nothing
 *   node scripts/dedupe-trans-rates.cjs --apply   # applies it, after backing up dev.db
 *
 * --db=<path> points it at another database file — used to rehearse --apply on a
 * copy before touching dev.db.
 */
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const dbArg = process.argv.find((a) => a.startsWith('--db='));
const DB = dbArg ? path.resolve(dbArg.slice(5)) : path.join(__dirname, '..', 'apps', 'api', 'prisma', 'dev.db');
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + DB.split(path.sep).join('/') } } });

const show = (r) => `#${String(r.id).padEnd(4)} ${(r.transportName || '(no transporter)').padEnd(26)} ${String(r.rate).padStart(4)}`;

async function plan() {
  const [rates, customers] = await Promise.all([
    prisma.transRate.findMany({ orderBy: { id: 'asc' } }),
    prisma.customer.findMany({ select: { partyName: true, transportName: true } }),
  ]);
  const partyTransport = new Map(customers.map((c) => [c.partyName, c.transportName ?? null]));

  const groups = new Map();
  for (const r of rates) {
    const key = `${r.customerName}|${r.category}|${r.type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const decisions = [];
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    const [customerName, category, type] = key.split('|');
    const preferred = partyTransport.get(customerName) ?? null;
    const hits = rows.filter((r) => preferred && r.transportName === preferred);
    const sameRate = new Set(rows.map((r) => r.rate)).size === 1;

    let keep;
    let reason;
    let relabel = false;
    if (hits.length) {
      // Most recent among the party-transporter rows; ties -> the original row.
      keep = [...hits].sort((a, b) => b.updatedAt - a.updatedAt || a.id - b.id)[0];
      reason = 'party';
    } else {
      keep = [...rows].sort((a, b) => b.updatedAt - a.updatedAt || a.id - b.id)[0];
      reason = 'recent';
      // Re-pointing is only safe when the rate can't move as a result.
      relabel = Boolean(preferred) && sameRate;
    }
    decisions.push({
      key, customerName, category, type, preferred, rows, keep, reason, relabel,
      drop: rows.filter((r) => r.id !== keep.id),
      // What challans resolve today vs after: rateFor() prefers the party's
      // transporter, else the first row. If that value moves, say so loudly.
      billedBefore: (rows.find((r) => preferred && r.transportName === preferred) ?? rows[0]).rate,
    });
  }
  return decisions;
}

async function main() {
  const decisions = await plan();
  if (!decisions.length) {
    console.log('No duplicate customer/category/type rows. Nothing to do.');
    return;
  }

  let n = 0;
  const moved = [];
  for (const d of decisions) {
    n++;
    console.log(`\n[${n}] ${d.customerName}  /  ${d.category}  /  ${d.type}`);
    console.log(`     party ships via: ${d.preferred ?? '— none set —'}`);
    for (const r of d.rows) console.log(`     ${r.id === d.keep.id ? 'KEEP  ' : 'delete'} ${show(r)}`);
    console.log(
      `     -> keeping #${d.keep.id} [${d.reason}]` +
        (d.relabel ? `, re-pointed to ${d.preferred}` : '') +
        `; billed rate stays ${d.billedBefore === d.keep.rate ? 'unchanged' : `CHANGES ${d.billedBefore} -> ${d.keep.rate}`}`,
    );
    if (d.billedBefore !== d.keep.rate) moved.push(d);
  }

  const drops = decisions.flatMap((d) => d.drop.map((r) => r.id));
  console.log(`\n${decisions.length} duplicated combination(s); ${drops.length} row(s) to delete.`);
  console.log(`Rows re-pointed at the party's current transporter: ${decisions.filter((d) => d.relabel).length}`);
  console.log(`Combinations whose BILLED rate would move: ${moved.length}${moved.length ? ' <-- review these' : ''}`);
  for (const d of moved) console.log(`   ${d.key}  ${d.billedBefore} -> ${d.keep.rate}`);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply.');
    return;
  }

  const backup = `${DB}.bak-before-dedupe-trans-rates`;
  fs.copyFileSync(DB, backup);
  console.log(`\nBackup: ${backup}`);

  const relabels = decisions.filter((d) => d.relabel);
  const transporters = relabels.length
    ? await prisma.transporter.findMany({ where: { name: { in: relabels.map((d) => d.preferred) } } })
    : [];
  const byName = new Map(transporters.map((t) => [t.name, t.id]));

  await prisma.$transaction(async (tx) => {
    for (const d of relabels) {
      await tx.transRate.update({
        where: { id: d.keep.id },
        data: { transportName: d.preferred, transporterId: byName.get(d.preferred) ?? null },
      });
    }
    await tx.transRate.deleteMany({ where: { id: { in: drops } } });
  });
  console.log(`Re-pointed ${relabels.length} row(s); deleted ${drops.length} row(s).`);

  const left = await plan();
  console.log(left.length ? `WARNING: ${left.length} duplicate group(s) remain.` : 'Verified: no duplicate combinations remain.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
