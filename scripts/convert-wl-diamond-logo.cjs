/*
 * Turn WL+DIAMOND+LOGO into a combination, in the sub-categories where
 * WL+DIAMOND is the standalone design.
 *
 * WHY TWO COMPONENTS AND NOT THREE
 * In 10-PCS-FG-22G, DIAMOND exists as a design of its own, so WL+DIAMOND+LOGO
 * was built there from three atoms (WL + DIAMOND + LOGO). In the sub-categories
 * below DIAMOND does NOT exist — WL+DIAMOND is itself the atom. So the
 * combination is WL+DIAMOND + LOGO, and the arithmetic agrees to the paisa:
 * every one of these composites costs exactly its two parts.
 *
 * WHAT IT DOES, per sub-category:
 *   1. creates a combination named WL+DIAMOND+LOGO linking the two designs
 *   2. deletes the standalone WL+DIAMOND+LOGO design row
 *
 * Step 2 follows the convention already set by every combination in this
 * database: not one of them still has a design row of the same name in the same
 * sub-category. Leaving it would list the same thing twice — once as a design,
 * once as a combination — and offer it twice in the order picker.
 *
 *   node scripts/convert-wl-diamond-logo.cjs            # show the plan, change nothing
 *   node scripts/convert-wl-diamond-logo.cjs --apply    # do it
 */
const { PrismaClient } = require('@prisma/client');

const CATEGORY = 'GLASS';
const BASE = 'WL+DIAMOND';
const ADDON = 'LOGO';
const COMPOSITE = 'WL+DIAMOND+LOGO';
const SUB_CATEGORIES = [
  '12-PCS-FG-22G',
  '8-PCS-FG-22G',
  'SOUTH-5-SIZE-FG-22G',
  'SOUTH-5.5-SIZE-FG-22G',
  'SOUTH-6-SIZE-FG-22G',
  'SOUTH-6.5-SIZE-FG-22G',
  'SOUTH-7-SIZE-FG-22G',
];

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const money = (n) => (n ?? 0).toFixed(2);
const codeFor = (id) => `CMB-${String(id).padStart(5, '0')}`;

async function planFor(subCategory) {
  const find = (designType) => prisma.design.findFirst({ where: { category: CATEGORY, subCategory, designType } });
  const [base, addon, composite] = await Promise.all([find(BASE), find(ADDON), find(COMPOSITE)]);

  if (!base || !addon || !composite) {
    const missing = [!base && BASE, !addon && ADDON, !composite && COMPOSITE].filter(Boolean);
    return { subCategory, skip: `missing design(s): ${missing.join(', ')}` };
  }

  // Never convert something already ordered against — the line would lose the
  // design it names. (Verified zero for all seven before this was written.)
  const [items, dispatches] = await Promise.all([
    prisma.orderItem.count({ where: { designType: COMPOSITE, subCategory } }),
    prisma.dispatch.count({ where: { designType: COMPOSITE, subCategory } }),
  ]);
  if (items || dispatches) return { subCategory, skip: `in use: ${items} order line(s), ${dispatches} dispatch(es)` };

  // The service refuses two combinations holding the same design set; check the
  // same thing here so a second run is a no-op rather than an error.
  const already = await prisma.combination.findFirst({
    where: { AND: [{ designLinks: { some: { designId: base.id } } }, { designLinks: { some: { designId: addon.id } } }] },
    include: { designLinks: true },
  });
  if (already && already.designLinks.length === 2) return { subCategory, skip: `already a combination (${already.code ?? already.id})` };

  const cost = (base.cost ?? 0) + (addon.cost ?? 0);
  const rate = (base.rate ?? 0) + (addon.rate ?? 0);
  return {
    subCategory,
    base,
    addon,
    composite,
    cost,
    rate,
    costMatches: Math.abs(cost - (composite.cost ?? 0)) < 0.005,
    rateMatches: Math.abs(rate - (composite.rate ?? 0)) < 0.005,
  };
}

async function main() {
  console.log(`${apply ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n`);
  const plans = [];
  for (const sub of SUB_CATEGORIES) plans.push(await planFor(sub));

  console.log('sub-category                combination                       cost / rate      matches today?');
  for (const p of plans) {
    if (p.skip) {
      console.log(`  ${p.subCategory.padEnd(24)} SKIPPED — ${p.skip}`);
      continue;
    }
    const agree = p.costMatches && p.rateMatches ? 'yes' : `NO (was ${money(p.composite.cost)} / ${p.composite.rate})`;
    console.log(
      `  ${p.subCategory.padEnd(24)} ${p.base.code} + ${p.addon.code}` +
        `   ${money(p.cost).padStart(7)} / ${String(p.rate).padStart(3)}   ${agree}` +
        `   (deletes ${p.composite.code})`,
    );
  }

  const doable = plans.filter((p) => !p.skip);
  const mismatched = doable.filter((p) => !p.costMatches || !p.rateMatches);
  if (mismatched.length) {
    console.log(`\nSTOPPING: ${mismatched.length} row(s) would change price. Nothing written.`);
    return;
  }
  if (!apply) {
    console.log(`\n${doable.length} ready. Re-run with --apply to write them.`);
    return;
  }

  console.log('');
  for (const p of doable) {
    await prisma.$transaction(async (tx) => {
      const created = await tx.combination.create({
        data: { name: COMPOSITE, designLinks: { create: [{ designId: p.base.id }, { designId: p.addon.id }] } },
      });
      await tx.combination.update({ where: { id: created.id }, data: { code: codeFor(created.id) } });
      await tx.design.delete({ where: { id: p.composite.id } });
      console.log(`  ${p.subCategory.padEnd(24)} created ${codeFor(created.id)}  ·  deleted design ${p.composite.code}`);
    });
  }
  console.log(`\n${doable.length} converted.`);
}

main()
  .catch((e) => {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
