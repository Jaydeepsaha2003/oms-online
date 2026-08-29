/**
 * Turn composite DESIGN rows into real COMBINATIONS.
 *
 * The catalogue holds 229 designs whose type is a composite — "DL+LOGO",
 * "FULL LASER+DL" — each carrying its own hand-typed cost with no link to the
 * designs it is made of. Changing DL therefore moves nothing, which is the
 * whole complaint. A Combination's cost and rate ARE a live sum of the designs
 * it links (see CombinationsService.toDto and the order lookups), so converting
 * makes the figures follow their parts by construction.
 *
 * DRY RUN BY DEFAULT. Nothing is written unless --apply is passed.
 *
 *   npx ts-node --project tsconfig.json scripts/convert-composite-designs.ts
 *   npx ts-node --project tsconfig.json scripts/convert-composite-designs.ts --xlsx plan.xlsx
 *   npx ts-node --project tsconfig.json scripts/convert-composite-designs.ts --apply
 *
 * --xlsx writes the whole plan out as a workbook — every conversion, every
 * price movement, everything left behind and why — so it can be checked in
 * Excel before a single row is touched. It works with or without --apply.
 *
 * What it does per composite, inside one transaction:
 *   1. split the type on '+' and find each part as a STANDALONE design in the
 *      same category + sub-category;
 *   2. create a Combination named EXACTLY as the design was ("DL+LOGO", not
 *      "DL + LOGO") — orders, challans and dispatches store that string, and
 *      the order picker must keep offering the same words;
 *   3. link the parts, and delete the composite design row so there is one
 *      source of truth for the price.
 *
 * What it refuses to touch:
 *   - a composite whose part has no standalone design (DIAMOND, TOOL in some
 *     sub-categories) — there is nothing to link, so the design row stays;
 *   - a design set that is already a combination.
 */
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  addMetaBlock,
  addTitle,
  addTotalRow,
  fitColumns,
  newWorkbook,
  styleBody,
  styleHeader,
  toBuffer,
} from '../src/excel/report-style';
import { writeFileSync } from 'fs';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
/** --xlsx [path] — write the plan out for checking before anything is applied. */
const XLSX = (() => {
  const i = process.argv.indexOf('--xlsx');
  if (i < 0) return null;
  const next = process.argv[i + 1];
  return path.resolve(next && !next.startsWith('--') ? next : 'combination-conversion-plan.xlsx');
})();
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const key = (c: string, s: string, t: string) => `${c.trim().toUpperCase()}|${s.trim().toUpperCase()}|${t.trim().toUpperCase()}`;
const setKey = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b).join(',');
const money = (n: number | null | undefined) => (n ?? 0).toFixed(2).padStart(9);

interface Part {
  id: number;
  designType: string;
  cost: number | null;
  rate: number | null;
}

interface Plan {
  design: { id: number; category: string; subCategory: string; designType: string; cost: number | null; rate: number | null };
  partIds: number[];
  parts: Part[];
  newCost: number;
  newRate: number;
}

/**
 * The plan as a workbook, so it can be checked in Excel before it is run.
 *
 * Four sheets, in the order you would want to read them: what converts and how
 * the price moves, the movements on their own biggest-first, what is left
 * behind and why, and the base designs that will from then on drive the lot.
 */
async function writeWorkbook(
  plans: Plan[],
  missing: { design: string; where: string; parts: string[] }[],
  duplicate: { design: string; where: string; of: string }[],
  file: string,
): Promise<void> {
  const wb = newWorkbook();
  const delta = (p: Plan) => Math.abs(p.newRate - (p.design.rate ?? 0)) + Math.abs(p.newCost - (p.design.cost ?? 0));
  const moves = (p: Plan) => Math.abs(p.newCost - (p.design.cost ?? 0)) >= 0.01 || Math.abs(p.newRate - (p.design.rate ?? 0)) >= 0.01;

  const line = (p: Plan) => [
    p.design.category,
    p.design.subCategory,
    p.design.designType,
    p.parts.map((x) => x.designType).join(' + '),
    p.parts.length,
    p.design.cost ?? 0,
    p.newCost,
    r2(p.newCost - (p.design.cost ?? 0)),
    p.design.rate ?? 0,
    p.newRate,
    r2(p.newRate - (p.design.rate ?? 0)),
    moves(p) ? 'YES' : 'no',
  ];
  const HEAD = [
    'Category', 'Sub Category', 'Design', 'Made Of', 'Parts',
    'Cost Now (₹)', 'Cost After (₹)', 'Cost Change (₹)',
    'Rate Now (₹)', 'Rate After (₹)', 'Rate Change (₹)', 'Price Moves?',
  ];
  const MONEY_COLS = [6, 7, 8, 9, 10, 11];

  // 1 — every conversion, in catalogue order, so it reads like the Designs page.
  {
    const ws = wb.addWorksheet('Conversions', { views: [{ state: 'frozen', ySplit: 8 }] });
    const cols = HEAD.length;
    addTitle(ws, cols, 'COMPOSITE DESIGNS → COMBINATIONS — PLAN');
    addMetaBlock(
      ws,
      cols,
      [
        ['Converting', `${plans.length} composite design(s) into combinations`],
        ['Repricing', `${plans.filter(moves).length} of them (see the Price Changes sheet)`],
        ['Left alone', `${missing.length} with a missing part, ${duplicate.length} duplicate — see Not Converted`],
        ['After this', 'a combination costs the sum of its parts, so changing a base design moves all of them'],
      ],
      `Generated ${new Date().toLocaleString('en-IN')}   ·   NOTHING HAS BEEN CHANGED — this is the plan only`,
    );
    ws.addRow([]);
    ws.addRow(HEAD);
    styleHeader(ws, 8, cols);
    const rows = [...plans].sort(
      (a, b) =>
        a.design.category.localeCompare(b.design.category) ||
        a.design.subCategory.localeCompare(b.design.subCategory) ||
        a.design.designType.localeCompare(b.design.designType),
    );
    for (const p of rows) ws.addRow(line(p));
    styleBody(ws, 9, 8 + rows.length, cols, MONEY_COLS, []);
    addTotalRow(
      ws,
      cols,
      ['', '', `${rows.length} design(s)`, '', '',
       r2(rows.reduce((s, p) => s + (p.design.cost ?? 0), 0)), r2(rows.reduce((s, p) => s + p.newCost, 0)),
       r2(rows.reduce((s, p) => s + p.newCost - (p.design.cost ?? 0), 0)),
       r2(rows.reduce((s, p) => s + (p.design.rate ?? 0), 0)), r2(rows.reduce((s, p) => s + p.newRate, 0)),
       r2(rows.reduce((s, p) => s + p.newRate - (p.design.rate ?? 0), 0)), ''],
      MONEY_COLS,
    );
    ws.autoFilter = { from: { row: 8, column: 1 }, to: { row: 8, column: cols } };
    fitColumns(ws, 8, cols);
  }

  // 2 — only what moves, biggest first: the sheet worth arguing over.
  {
    const rows = plans.filter(moves).sort((a, b) => delta(b) - delta(a));
    const ws = wb.addWorksheet('Price Changes', { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = HEAD.length;
    ws.addRow(HEAD);
    styleHeader(ws, 1, cols);
    for (const p of rows) ws.addRow(line(p));
    styleBody(ws, 2, 1 + rows.length, cols, MONEY_COLS, []);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } };
    fitColumns(ws, 1, cols);
  }

  // 3 — what the migration refuses to touch, with the reason spelled out.
  {
    const head = ['Category', 'Sub Category', 'Design', 'Why It Stays', 'Detail'];
    const ws = wb.addWorksheet('Not Converted', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(head);
    styleHeader(ws, 1, head.length);
    let n = 0;
    for (const m of missing) {
      const [category, subCategory] = m.where.split('/');
      ws.addRow([category, subCategory, m.design, 'A part has no standalone design', `missing: ${m.parts.join(', ')}`]);
      n += 1;
    }
    for (const d of duplicate) {
      const [category, subCategory] = d.where.split('/');
      ws.addRow([category, subCategory, d.design, 'Same parts as another composite', `already converting: ${d.of}`]);
      n += 1;
    }
    styleBody(ws, 2, 1 + n, head.length, [], []);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head.length } };
    fitColumns(ws, 1, head.length);
  }

  // 4 — the base designs that end up driving the prices. Edit one of these
  //     afterwards and every combination in its "Feeds" count moves with it.
  {
    const head = ['Category', 'Sub Category', 'Base Design', 'Cost (₹)', 'Rate (₹)', 'Feeds # Combinations', 'Which Combinations'];
    const ws = wb.addWorksheet('Base Designs', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(head);
    styleHeader(ws, 1, head.length);
    const by = new Map<number, { part: Part; category: string; subCategory: string; feeds: string[] }>();
    for (const p of plans) {
      for (const part of p.parts) {
        const hit = by.get(part.id) ?? { part, category: p.design.category, subCategory: p.design.subCategory, feeds: [] };
        hit.feeds.push(p.design.designType);
        by.set(part.id, hit);
      }
    }
    const rows = [...by.values()].sort(
      (a, b) =>
        a.category.localeCompare(b.category) || a.subCategory.localeCompare(b.subCategory) || a.part.designType.localeCompare(b.part.designType),
    );
    for (const r of rows) {
      ws.addRow([r.category, r.subCategory, r.part.designType, r.part.cost ?? 0, r.part.rate ?? 0, r.feeds.length, r.feeds.sort().join(', ')]);
    }
    styleBody(ws, 2, 1 + rows.length, head.length, [4, 5], []);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head.length } };
    fitColumns(ws, 1, head.length);
  }

  writeFileSync(file, await toBuffer(wb));
  console.log(`\nplan written to: ${file}`);
}

async function main() {
  const designs = await prisma.design.findMany({
    select: { id: true, category: true, subCategory: true, designType: true, cost: true, rate: true, active: true },
  });
  const standalone = new Map<string, (typeof designs)[number]>();
  for (const d of designs) {
    if (!d.designType.includes('+')) standalone.set(key(d.category, d.subCategory, d.designType), d);
  }

  const existing = await prisma.combination.findMany({ select: { id: true, name: true, designLinks: { select: { designId: true } } } });
  const seen = new Set(existing.map((c) => setKey(c.designLinks.map((l) => l.designId))));

  const plans: Plan[] = [];
  const missing: { design: string; where: string; parts: string[] }[] = [];
  /** Same parts as a composite already planned — the catalogue holds it twice. */
  const duplicate: { design: string; where: string; of: string }[] = [];
  const already: string[] = [];
  const planned = new Map<string, string>();

  for (const d of designs) {
    if (!d.designType.includes('+')) continue;
    const parts = d.designType.split('+').map((p) => p.trim()).filter(Boolean);
    const found = parts.map((p) => standalone.get(key(d.category, d.subCategory, p)));
    const absent = parts.filter((_, i) => !found[i]);
    if (absent.length) {
      missing.push({ design: d.designType, where: `${d.category}/${d.subCategory}`, parts: absent });
      continue;
    }
    const ids = found.map((f) => f!.id);
    const k = setKey(ids);
    if (planned.has(k)) {
      // Two composites made of the same parts — "WL+TOOL+FULL LASER" and
      // "WL+FULL LASER+TOOL". Only one can become the combination; the other
      // stays a design row for you to retire by hand, because they usually
      // carry different prices and picking a winner is not mine to do.
      duplicate.push({ design: d.designType, where: `${d.category}/${d.subCategory}`, of: planned.get(k)! });
      continue;
    }
    if (seen.has(k)) {
      already.push(`${d.category}/${d.subCategory}/${d.designType}`);
      continue;
    }
    planned.set(k, d.designType);
    plans.push({
      design: d,
      partIds: ids,
      parts: found.map((f) => ({ id: f!.id, designType: f!.designType, cost: f!.cost, rate: f!.rate })),
      newCost: r2(found.reduce((s, f) => s + (f!.cost ?? 0), 0)),
      newRate: r2(found.reduce((s, f) => s + (f!.rate ?? 0), 0)),
    });
  }

  const changedCost = plans.filter((p) => Math.abs(p.newCost - (p.design.cost ?? 0)) >= 0.01);
  const changedRate = plans.filter((p) => Math.abs(p.newRate - (p.design.rate ?? 0)) >= 0.01);

  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'}`);
  console.log('='.repeat(96));
  console.log(`composite designs found        : ${designs.filter((d) => d.designType.includes('+')).length}`);
  console.log(`  convertible                  : ${plans.length}`);
  console.log(`  blocked (part has no design) : ${missing.length}`);
  console.log(`  duplicate of another design  : ${duplicate.length}`);
  console.log(`  already a combination        : ${already.length}`);
  console.log(`\nof the convertible, the live sum DIFFERS from the stored figure:`);
  console.log(`  cost changes                 : ${changedCost.length}`);
  console.log(`  rate changes                 : ${changedRate.length}`);

  if (changedCost.length || changedRate.length) {
    const shown = [...new Set([...changedCost, ...changedRate])]
      .sort((a, b) => Math.abs(b.newRate - (b.design.rate ?? 0)) - Math.abs(a.newRate - (a.design.rate ?? 0)))
      .slice(0, 25);
    console.log(`\nthe biggest price movements (rate), ${shown.length} of ${new Set([...changedCost, ...changedRate]).size}:`);
    console.log(`  ${'SUB CATEGORY'.padEnd(22)} ${'DESIGN'.padEnd(28)} ${'COST'.padStart(9)}→${'NEW'.padStart(9)}  ${'RATE'.padStart(9)}→${'NEW'.padStart(9)}`);
    for (const p of shown) {
      console.log(
        `  ${p.design.subCategory.padEnd(22)} ${p.design.designType.padEnd(28)} ${money(p.design.cost)}→${money(p.newCost)}  ${money(p.design.rate)}→${money(p.newRate)}`,
      );
    }
  }

  if (duplicate.length) {
    console.log(`\nLEFT ALONE — the same parts as another composite, so the catalogue holds them twice:`);
    for (const d of duplicate) console.log(`  ${d.where.padEnd(30)} ${d.design.padEnd(30)} same parts as: ${d.of}`);
  }

  if (missing.length) {
    console.log(`\nLEFT ALONE — these stay as ordinary design rows because a part has no standalone design:`);
    for (const m of missing.slice(0, 20)) console.log(`  ${m.where.padEnd(30)} ${m.design.padEnd(30)} missing: ${m.parts.join(', ')}`);
    if (missing.length > 20) console.log(`  …and ${missing.length - 20} more`);
  }

  if (XLSX) await writeWorkbook(plans, missing, duplicate, XLSX);

  if (!APPLY) {
    console.log(`\nNothing was written to the database. Re-run with --apply to convert.\n`);
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  for (const p of plans) {
    await prisma.$transaction(async (tx) => {
      const combo = await tx.combination.create({
        // The ORIGINAL spelling: orders, challans and dispatches store this
        // string, and the item picker has to keep offering the same words.
        data: { name: p.design.designType, designLinks: { create: p.partIds.map((designId) => ({ designId })) } },
      });
      await tx.combination.update({ where: { id: combo.id }, data: { code: `CMB-${String(combo.id).padStart(5, '0')}` } });
      await tx.design.delete({ where: { id: p.design.id } });
    });
    done += 1;
  }
  console.log(`\nconverted ${done} composite design(s) into combinations.`);
  console.log(`left ${missing.length} as design rows (a part has no standalone design).\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
