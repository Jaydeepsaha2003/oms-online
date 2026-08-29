/*
 * Turn composite designs into combinations of the designs they are made of.
 *
 * Each row below names the composite and the parts it decomposes into. The
 * parts are stated explicitly rather than derived by splitting on "+", because
 * splitting is wrong more often than it is right: WL+TOOL+LOGO is WL+TOOL plus
 * LOGO in the SOUTH sub-categories (there is no TOOL design there at all), and
 * WL + TOOL + LOGO in 10-PCS-FG-22G, where all three exist. Only the money says
 * which — so every row is checked before it is written.
 *
 * Refuses to convert unless ALL of these hold:
 *   - every part exists as a design in the same category / sub-category
 *   - the parts' cost AND rate add up to the composite's, to the paisa
 *   - the composite has never been ordered or dispatched against
 *
 * On success it creates the combination and deletes the standalone composite
 * design — the convention every combination in this database already follows.
 *
 *   node scripts/convert-designs-to-combinations.cjs           # show the plan
 *   node scripts/convert-designs-to-combinations.cjs --apply   # write it
 */
const { PrismaClient } = require('@prisma/client');

/** [category, sub-category, composite, [parts]] */
const ROWS = [
  ['GLASS', '12-PCS-FG-22G', 'HANDLE+DL+LOGO', ['HANDLE+DL', 'LOGO']],
  ['GLASS', '8-PCS-FG-22G', 'WL+CARVING+LOGO', ['WL+CARVING', 'LOGO']],
  ['GLASS', 'SOUTH-6.5-SIZE-FG-22G', 'WL+TOOL+LOGO', ['WL+TOOL', 'LOGO']],
  ['GLASS', 'SOUTH-7-SIZE-FG-22G', 'WL+TOOL+LOGO', ['WL+TOOL', 'LOGO']],
  ['LOTI', 'LOTI-FG', 'DIAMOND HAMMER+PVD+LOGO', ['DIAMOND HAMMER+PVD', 'LOGO']],
];

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const codeFor = (id) => `CMB-${String(id).padStart(5, '0')}`;

async function planFor([category, subCategory, type, partTypes]) {
  const find = (designType) => prisma.design.findFirst({ where: { category, subCategory, designType } });
  const composite = await find(type);
  if (!composite) return { subCategory, type, skip: 'the composite design is not there' };

  const parts = [];
  for (const t of partTypes) {
    const d = await find(t);
    if (!d) return { subCategory, type, skip: `no design named "${t}" in ${category} / ${subCategory}` };
    parts.push(d);
  }

  const [items, dispatches] = await Promise.all([
    prisma.orderItem.count({ where: { designType: type, subCategory } }),
    prisma.dispatch.count({ where: { designType: type, subCategory } }),
  ]);
  if (items || dispatches) return { subCategory, type, skip: `in use: ${items} order line(s), ${dispatches} dispatch(es)` };

  const cost = r2(parts.reduce((s, d) => s + (d.cost ?? 0), 0));
  const rate = r2(parts.reduce((s, d) => s + (d.rate ?? 0), 0));
  const dc = r2(cost - (composite.cost ?? 0));
  const dr = r2(rate - (composite.rate ?? 0));
  if (dc !== 0 || dr !== 0) {
    return { subCategory, type, skip: `the parts do not add up: cost ${dc >= 0 ? '+' : ''}${dc}, rate ${dr >= 0 ? '+' : ''}${dr}` };
  }

  // A combination holding exactly these designs already? Then this has been done.
  const ids = parts.map((d) => d.id);
  const existing = await prisma.combination.findFirst({
    where: { AND: ids.map((designId) => ({ designLinks: { some: { designId } } })) },
    include: { designLinks: true },
  });
  if (existing && existing.designLinks.length === ids.length) {
    return { subCategory, type, skip: `already a combination (${existing.code ?? existing.id})` };
  }

  return { subCategory, type, composite, parts, cost, rate };
}

async function main() {
  console.log(`${apply ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n`);
  const plans = [];
  for (const row of ROWS) plans.push(await planFor(row));

  for (const p of plans) {
    if (p.skip) { console.log(`  SKIP  ${p.subCategory.padEnd(22)} ${p.type.padEnd(24)} — ${p.skip}`); continue; }
    console.log(
      `  OK    ${p.subCategory.padEnd(22)} ${p.type.padEnd(24)} = ${p.parts.map((d) => d.designType).join(' + ')}` +
        `   ${String(p.cost).padStart(7)} / ${String(p.rate).padStart(6)}   (deletes ${p.composite.code})`,
    );
  }

  const doable = plans.filter((p) => !p.skip);
  if (!apply) { console.log(`\n${doable.length} ready. Re-run with --apply to write them.`); return; }

  console.log('');
  for (const p of doable) {
    await prisma.$transaction(async (tx) => {
      const created = await tx.combination.create({
        data: { name: p.type, designLinks: { create: p.parts.map((d) => ({ designId: d.id })) } },
      });
      await tx.combination.update({ where: { id: created.id }, data: { code: codeFor(created.id) } });
      await tx.design.delete({ where: { id: p.composite.id } });
      console.log(`  ${p.subCategory.padEnd(22)} created ${codeFor(created.id)} "${p.type}"  ·  deleted ${p.composite.code}`);
    });
  }
  console.log(`\n${doable.length} converted.`);
}

main()
  .catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
