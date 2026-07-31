/**
 * One-off backfill: cap stored weight/quantity columns at 3 decimals.
 *
 * Float accumulation (69.8 + 71.6 = 141.39999999999998) leaks into stored
 * values, which then render raw in the challan/order grids. Rounding to 3dp is
 * idempotent and only touches values that already carry float noise beyond the
 * 3rd decimal — real entered weights never go finer than that.
 *
 *   node scripts/round-kgs-3dp.js          # dry run — reports, writes nothing
 *   node scripts/round-kgs-3dp.js --apply  # writes
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// [table, column] — every weight/quantity column that surfaces as KGS in the UI.
const TARGETS = [
  ['quotation_items', 'gram'],
  ['order_items', 'gram'],
  ['dispatches', 'gram'],
  ['challan_items', 'kgs'],
  ['credit_note_items', 'kgs'],
  ['followup_items', 'kgs'],
  ['bookings', 'kgs'],
  ['bookings', 'convertedKgs'],
  ['booking_items', 'kgs'],
  ['booking_items', 'convertedKgs'],
  ['booking_conversions', 'kgs'],
];

async function main() {
  let grand = 0;
  for (const [table, col] of TARGETS) {
    // ROUND(x, 3) is SQLite's own rounding; comparing against it finds exactly
    // the rows whose stored value has noise past the 3rd decimal.
    const where = `"${col}" IS NOT NULL AND "${col}" <> ROUND("${col}", 3)`;
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "${table}" WHERE ${where}`);
    const count = Number(n);
    grand += count;
    if (count === 0) {
      console.log(`  ${table}.${col}: clean`);
      continue;
    }
    const sample = await prisma.$queryRawUnsafe(
      `SELECT id, "${col}" AS v, ROUND("${col}", 3) AS r FROM "${table}" WHERE ${where} LIMIT 3`,
    );
    console.log(`  ${table}.${col}: ${count} row(s)`);
    for (const s of sample) console.log(`      id=${s.id}  ${s.v}  ->  ${s.r}`);
    if (APPLY) {
      await prisma.$executeRawUnsafe(`UPDATE "${table}" SET "${col}" = ROUND("${col}", 3) WHERE ${where}`);
    }
  }
  console.log(`\n${APPLY ? 'Updated' : 'Would update'} ${grand} row(s) total.`);
  if (!APPLY && grand > 0) console.log('Dry run — re-run with --apply to write.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
