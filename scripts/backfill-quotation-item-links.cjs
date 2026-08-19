/**
 * Link existing order lines back to the quotation lines they were converted
 * from, by setting OrderItem.quotationItemId.
 *
 * WHY THIS IS NEEDED: quotationItemId is a brand-new column (added alongside
 * the "mirror order edits onto the quotation" feature). It has no default and
 * quotations.service.convert() only sets it going forward — every order
 * converted from a quotation BEFORE this migration (which, right now, is every
 * converted quotation in the system) has it null on all its lines. Without the
 * link, editing one of those lines in Order Modify records history but does
 * NOT update the quotation line, silently defeating the feature for exactly
 * the orders it was built to fix (ORD-1246 among them).
 *
 * MATCHING, in two passes, never guessing past what the evidence supports:
 *   1. EXACT — an order line whose product/design/size/quantities/rates are
 *      byte-identical to a quotation line. Covers every line that hasn't been
 *      touched since conversion.
 *   2. QTY+RATE — for whatever's left after pass 1, match on bags/pcs/kgs/box/
 *      rate ONLY, and only when that's a unique 1:1 pairing among the
 *      remainder. This is what catches a line that was edited (e.g. product
 *      changed) after conversion but before this link existed — same
 *      reasoning already used to identify ORD-1246's survivor as the edited
 *      form of quotation line #35.
 * Anything still unmatched after both passes is left alone and reported, never
 * force-linked.
 *
 * This only SETS quotationItemId on existing rows — it creates nothing, deletes
 * nothing, and never fabricates OrderItemChange history for the link itself
 * (that would misrepresent something that didn't actually happen).
 *
 * Usage, from the repo root:
 *   node scripts/backfill-quotation-item-links.cjs            # dry run
 *   node scripts/backfill-quotation-item-links.cjs --apply    # writes, after backing up dev.db
 */
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const DB = path.join(__dirname, '..', 'apps', 'api', 'prisma', 'dev.db');
const prisma = new PrismaClient();

const key = (i) => [i.productName, i.design, i.designType, i.psize, i.bags, i.pcs, i.gram, i.box, i.productRate, i.designRate, i.rate].join('|');
const qtyKey = (i) => [i.bags, i.pcs, i.gram, i.box, i.rate].join('|');

async function main() {
  const quotations = await prisma.quotation.findMany({
    where: { convertedOrderId: { not: null } },
    include: { items: true, convertedOrder: { include: { items: true } } },
  });

  let totalLinked = 0;
  let totalUnmatched = 0;
  const writes = [];

  for (const q of quotations) {
    const order = q.convertedOrder;
    if (!order) continue;
    console.log(`\n${q.code} -> ${order.code}  (${q.items.length} quotation line(s), ${order.items.length} order line(s))`);

    const qItems = [...q.items];
    const oItems = order.items.filter((i) => i.quotationItemId == null);
    if (!oItems.length) {
      console.log('  every line already linked — skipping.');
      continue;
    }

    const matchedQ = new Set();
    const matchedO = new Set();

    // Pass 1: exact.
    const byExact = new Map();
    for (const qi of qItems) {
      const k = key(qi);
      if (!byExact.has(k)) byExact.set(k, []);
      byExact.get(k).push(qi);
    }
    for (const oi of oItems) {
      const candidates = (byExact.get(key(oi)) || []).filter((qi) => !matchedQ.has(qi.id));
      if (candidates.length === 1) {
        matchedQ.add(candidates[0].id);
        matchedO.add(oi.id);
        writes.push({ orderItemId: oi.id, quotationItemId: candidates[0].id });
        console.log(`  EXACT    order#${oi.id} "${oi.productName}" -> qitem#${candidates[0].id}`);
      }
    }

    // Pass 2: qty+rate, only if unique among what's left.
    const remQ = qItems.filter((qi) => !matchedQ.has(qi.id));
    const remO = oItems.filter((oi) => !matchedO.has(oi.id));
    const byQty = new Map();
    for (const qi of remQ) {
      const k = qtyKey(qi);
      if (!byQty.has(k)) byQty.set(k, []);
      byQty.get(k).push(qi);
    }
    for (const oi of remO) {
      const candidates = (byQty.get(qtyKey(oi)) || []).filter((qi) => !matchedQ.has(qi.id));
      if (candidates.length === 1) {
        matchedQ.add(candidates[0].id);
        matchedO.add(oi.id);
        writes.push({ orderItemId: oi.id, quotationItemId: candidates[0].id });
        console.log(`  QTY+RATE order#${oi.id} "${oi.productName}" -> qitem#${candidates[0].id} "${candidates[0].productName}" (product differs — edited after conversion)`);
      }
    }

    const unmatched = oItems.filter((oi) => !matchedO.has(oi.id));
    totalLinked += matchedO.size;
    totalUnmatched += unmatched.length;
    if (unmatched.length) {
      console.log(`  UNMATCHED (left as-is):`);
      for (const oi of unmatched) console.log(`     order#${oi.id} "${oi.productName}"  bags=${oi.bags} kgs=${oi.gram} rate=${oi.rate}`);
    }
  }

  console.log(`\n${totalLinked} line(s) to link; ${totalUnmatched} left unmatched.`);
  if (!writes.length) return console.log('Nothing to do.');
  if (!APPLY) return console.log('\nDry run — nothing written. Re-run with --apply.');

  const backup = `${DB}.bak-before-backfill-quotation-links`;
  fs.copyFileSync(DB, backup);
  console.log(`\nBackup: ${backup}`);

  await prisma.$transaction(writes.map((w) => prisma.orderItem.update({ where: { id: w.orderItemId }, data: { quotationItemId: w.quotationItemId } })));
  console.log(`Linked ${writes.length} line(s).`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
