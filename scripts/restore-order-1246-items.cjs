/**
 * Restore the order lines deleted from ORD-1246 on 2026-08-18 12:59.
 *
 * WHAT HAPPENED: Order Modify's list endpoint prunes each order's `items` to the
 * lines matching the product / design / priority filters, while the update
 * endpoint reconciles the FULL line set by id and deletes whatever the payload
 * omits. Editing one line while a filter was on therefore sent a one-line
 * payload and deleted the other 16 (and cascade-deleted their photos with them,
 * leaving the image files orphaned on disk). Fixed in order-modify-page.tsx,
 * which now re-reads the complete order before every save.
 *
 * WHAT THIS RESTORES: QUO-00005 — the quotation ORD-1246 was converted from —
 * still holds all 17 original lines. This re-creates the 16 that were lost,
 * using the same field mapping quotations.service.convert() uses, so the rows
 * are identical to what the conversion originally wrote.
 *
 * THE ONE LINE IT DOES NOT RESTORE is qitem#35 "7.5 AJUBA WL+LOGO"
 * (bags 2 / kgs 140 / rate 390). The single surviving order line is
 * "8 AJUBA THAPPI WL+LOGO" with exactly those quantities and that rate, and no
 * other quotation line matches them — so that survivor is the edited version of
 * #35 and restoring #35 as well would duplicate it. Restoring 16 returns the
 * order to ₹9,92,950, the quotation's own total. Pass --include-35 if that
 * reading is wrong and the survivor was a brand-new line.
 *
 * Nothing is deleted or modified: this only inserts the missing lines.
 *
 * Usage, from the repo root:
 *   node scripts/restore-order-1246-items.cjs            # dry run — prints the plan
 *   node scripts/restore-order-1246-items.cjs --apply    # inserts, after backing up dev.db
 */
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const INCLUDE_35 = process.argv.includes('--include-35');
const ORDER_ID = 1246;
const QUOTATION_CODE = 'QUO-00005';
const DB = path.join(__dirname, '..', 'apps', 'api', 'prisma', 'dev.db');
const prisma = new PrismaClient();

const inr = (v) => '₹' + Math.round(v || 0).toLocaleString('en-IN');
const amountOf = (i) => ((i.calField === 'PCS' ? i.pcs ?? 0 : i.gram ?? 0) * (i.rate ?? 0));

/** Same field mapping quotations.service.convert() applies. */
const toOrderItem = (it) => ({
  orderId: ORDER_ID,
  pCategory: it.pCategory,
  subCategory: it.subCategory,
  product: it.product,
  design: it.design,
  productName: it.productName,
  designType: it.designType,
  psize: it.psize,
  bags: it.bags,
  pcs: it.pcs,
  gram: it.gram,
  box: it.box,
  productRate: it.productRate,
  designRate: it.designRate,
  rate: it.rate,
  calField: it.calField,
  priority: it.priority,
  ordType: it.ordType,
  status: 'CONFIRMED',
  comment: it.comment,
});

async function main() {
  const quotation = await prisma.quotation.findFirst({ where: { code: QUOTATION_CODE }, include: { items: true } });
  if (!quotation) throw new Error(`${QUOTATION_CODE} not found.`);
  const order = await prisma.order.findUnique({ where: { id: ORDER_ID }, include: { items: true } });
  if (!order) throw new Error(`Order ${ORDER_ID} not found.`);

  const survivor = order.items[0];
  // The edited line: same quantities and rate as exactly one quotation line.
  const editedFrom = survivor
    ? quotation.items.find((i) => i.bags === survivor.bags && i.gram === survivor.gram && i.rate === survivor.rate)
    : null;
  const skipId = INCLUDE_35 ? null : editedFrom?.id ?? null;
  const missing = quotation.items.filter((i) => i.id !== skipId);

  console.log(`${order.code} currently holds ${order.items.length} line(s); ${QUOTATION_CODE} holds ${quotation.items.length}.`);
  if (survivor) console.log(`  surviving line: ${survivor.productName} — bags ${survivor.bags}, kgs ${survivor.gram}, rate ${survivor.rate}`);
  if (skipId && editedFrom) {
    console.log(`  treating it as the edited form of qitem#${editedFrom.id} "${editedFrom.productName}" (same qty + rate), so that line is NOT restored`);
  }

  // Never insert a line the order already has (makes a re-run harmless).
  const already = new Set(order.items.map((i) => `${i.productName}|${i.bags}|${i.gram}|${i.rate}`));
  const toInsert = missing.filter((i) => !already.has(`${i.productName}|${i.bags}|${i.gram}|${i.rate}`));
  const skipped = missing.length - toInsert.length;

  console.log(`\nlines to restore: ${toInsert.length}${skipped ? ` (${skipped} already present, skipped)` : ''}`);
  for (const i of toInsert) {
    console.log(`   ${String(i.productName).padEnd(34)} bags ${String(i.bags ?? '').padStart(3)}  kgs ${String(i.gram ?? '').padStart(5)}  rate ${String(i.rate ?? '').padStart(4)}   ${inr(amountOf(i))}`);
  }

  const orderTotalAfter = [...order.items, ...toInsert].reduce((a, i) => a + amountOf(i), 0);
  const quotationTotal = quotation.items.reduce((a, i) => a + amountOf(i), 0);
  console.log(`\norder total after restore: ${inr(orderTotalAfter)}   quotation total: ${inr(quotationTotal)}   ${orderTotalAfter === quotationTotal ? '(match)' : '(DIFFERENT — review before applying)'}`);

  if (!toInsert.length) return console.log('\nNothing to do.');
  if (!APPLY) return console.log('\nDry run — nothing written. Re-run with --apply.');

  const backup = `${DB}.bak-before-restore-order-${ORDER_ID}`;
  fs.copyFileSync(DB, backup);
  console.log(`\nBackup: ${backup}`);

  await prisma.$transaction(toInsert.map((i) => prisma.orderItem.create({ data: toOrderItem(i) })));
  const after = await prisma.order.findUnique({ where: { id: ORDER_ID }, include: { items: true } });
  console.log(`Restored ${toInsert.length} line(s). ${order.code} now holds ${after.items.length}.`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
