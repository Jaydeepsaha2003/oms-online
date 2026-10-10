// One-off repair for the trans_rates overwrite bug (fixed in findTarget on 09-10-2026).
//
// Saving a rate under a SECOND transporter used to fall back to the party's existing
// row and re-label it, so BEST ROADWAYS' rows became BHOOMI TRANSPORT's and their rates
// were lost. This puts the original transporter and rate back on those rows, and adds
// the BHOOMI rows that should have been created beside them.
//
// Old values come from rate_history (oldRate), which recorded every overwrite.
// Run with --apply to write; without it, prints the plan and changes nothing.
const path = require('node:path');
const root = path.resolve(__dirname, '..');
process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${path.join(root, 'apps/api/prisma/dev.db').split(String.fromCharCode(92)).join('/')}`;
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const APPLY = process.argv.includes('--apply');

// What each overwritten row must go back to, and what BHOOMI should hold instead.
// restore = the rate rate_history recorded as oldRate (or, for GLASS/PACKING, the
// value that never changed so history has no entry for it).
const PLAN = [
  { id: 571, category: 'CUP',         type: 'PACKING', restoreTo: 'BEST ROADWAYS', restoreRate: 250, bhoomiRate: 200 },
  { id: 570, category: 'CUP',         type: 'FREIGHT', restoreTo: 'BEST ROADWAYS', restoreRate: 150, bhoomiRate: 0 },
  { id: 576, category: 'GLASS',       type: 'PACKING', restoreTo: 'BEST ROADWAYS', restoreRate: 200, bhoomiRate: 200 },
  { id: 572, category: 'GLASS',       type: 'FREIGHT', restoreTo: 'BEST ROADWAYS', restoreRate: 150, bhoomiRate: 0 },
];
// Genuinely new rows (rate_history oldRate = null) — BEST ROADWAYS never had these.
const LEAVE_ALONE = [643, 644];

(async () => {
  const PARTY = 'PNB';
  const best = await prisma.transporter.findUnique({ where: { name: 'BEST ROADWAYS' } });
  const bhoomi = await prisma.transporter.findUnique({ where: { name: 'BHOOMI TRANSPORT' } });
  if (!best || !bhoomi) throw new Error('Transporter master is missing BEST ROADWAYS or BHOOMI TRANSPORT.');

  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (nothing written) — pass --apply to write ===\n');
  let restored = 0;
  let added = 0;

  for (const p of PLAN) {
    const row = await prisma.transRate.findUnique({ where: { id: p.id } });
    if (!row) { console.log(`SKIP id ${p.id} — row no longer exists`); continue; }
    if (row.customerName !== PARTY || row.category !== p.category || row.type !== p.type) {
      console.log(`SKIP id ${p.id} — expected ${PARTY}/${p.category}/${p.type}, found ${row.customerName}/${row.category}/${row.type}`);
      continue;
    }
    if (row.transportName === p.restoreTo) {
      console.log(`OK   id ${p.id} ${p.category}/${p.type} already on ${p.restoreTo} — nothing to restore`);
    } else {
      console.log(`RESTORE id ${p.id} ${p.category}/${p.type}: ${row.transportName} ${row.rate} -> ${p.restoreTo} ${p.restoreRate}`);
      if (APPLY) await prisma.transRate.update({ where: { id: p.id }, data: { transporterId: best.id, transportName: best.name, rate: p.restoreRate } });
      restored++;
    }

    // Must exclude the row being restored: it is CURRENTLY mislabelled as BHOOMI, so
    // counting it as "BHOOMI already has a row" would restore it and leave BHOOMI with none.
    const existing = await prisma.transRate.findFirst({ where: { id: { not: p.id }, customerName: PARTY, category: p.category, type: p.type, transporterId: bhoomi.id } });
    if (existing) {
      console.log(`OK   ${p.category}/${p.type} BHOOMI row already present (id ${existing.id}, rate ${existing.rate})`);
    } else {
      console.log(`ADD  ${p.category}/${p.type} BHOOMI TRANSPORT rate ${p.bhoomiRate}`);
      if (APPLY) {
        await prisma.transRate.create({
          data: { customerId: row.customerId, customerCode: row.customerCode, customerName: PARTY, category: p.category, type: p.type, transporterId: bhoomi.id, transportName: bhoomi.name, rate: p.bhoomiRate },
        });
      }
      added++;
    }
  }

  for (const id of LEAVE_ALONE) {
    const r = await prisma.transRate.findUnique({ where: { id } });
    if (r) console.log(`KEEP id ${id} ${r.category}/${r.type} ${r.transportName} ${r.rate} — this row was genuinely new, not an overwrite`);
  }

  console.log(`\n${APPLY ? 'Restored' : 'Would restore'} ${restored} row(s); ${APPLY ? 'added' : 'would add'} ${added} BHOOMI row(s).`);
  const after = await prisma.transRate.findMany({ where: { customerName: PARTY }, orderBy: [{ category: 'asc' }, { type: 'asc' }, { transportName: 'asc' }] });
  console.log(`\n${PARTY} ${APPLY ? 'now' : 'currently'} has ${after.length} rows:`);
  for (const r of after) console.log(`  ${r.category.padEnd(12)} ${r.type.padEnd(8)} ${(r.transportName ?? '—').padEnd(18)} ${r.rate}`);
  await prisma.$disconnect();
})();
