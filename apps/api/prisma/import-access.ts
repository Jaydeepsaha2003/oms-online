/**
 * Temporary connector: import data exported from the legacy MS Access database
 * (FINAL DATABASE *.accdb) into the OMS SQLite database.
 *
 * Pipeline:
 *   1. `scratchpad/export-access.ps1` reads the .accdb via the ACE OLEDB provider
 *      and writes one JSON file per table to a folder.
 *   2. This script reads those JSON files and writes them into OMS.
 *
 * Strategy (the OMS DB already holds a copy with NON-matching autoincrement ids,
 * so we cannot force legacy ids onto masters):
 *   - Masters  → UPSERT by business key (name / category+subcat+…); idempotent.
 *   - Customers→ matched by PARTY NAME; a legacy-id → OMS-id map drives all FKs.
 *   - Special  → customer_rates / logo restrictions, customerId via the map.
 *   - Orders & Dispatch → loaded FRESH preserving the legacy ORDER/Dispatch numbers
 *     (existing orders are cleared first so the legacy ids don't collide).
 *
 * Run (from apps/api):
 *   $env:ACCESS_DIR='<export folder>'
 *   npx ts-node --project tsconfig.json prisma/import-access.ts [sections] [--dry]
 * sections: masters special pricecal agents orders dispatch   (default: all)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DIR = process.env.ACCESS_DIR;
const DRY = process.argv.includes('--dry');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const want = (name: string) => args.length === 0 || args.includes('all') || args.includes(name);

if (!DIR) {
  console.error('Set ACCESS_DIR to the folder of exported JSON files.');
  process.exit(1);
}

const s = (v: unknown): string | null => {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};
const up = (v: unknown): string | null => {
  const t = s(v);
  return t ? t.toUpperCase() : null;
};
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};
const dt = (v: unknown): Date | null => {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
};
const J = (name: string): any[] => JSON.parse(readFileSync(join(DIR!, name + '.json'), 'utf8'));
const log = (label: string, n: number) => console.log(`  ${label.padEnd(34)} ${n}`);

/** legacy CUSTOMER.ID -> OMS customer.id, matched by party name. */
async function customerMap(): Promise<Map<number, number>> {
  const oms = await prisma.customer.findMany({ select: { id: true, partyName: true } });
  const byName = new Map<string, number>();
  for (const c of oms) if (c.partyName) byName.set(c.partyName.toUpperCase(), c.id);
  const map = new Map<number, number>();
  for (const c of J('CUSTOMER')) {
    const lid = int(c.ID);
    const name = s(c['PARTY NAME']);
    if (lid && name && byName.has(name.toUpperCase())) map.set(lid, byName.get(name.toUpperCase())!);
  }
  return map;
}

/* ── masters ────────────────────────────────────────────────────────────────── */
async function importMasters() {
  console.log(`MASTERS${DRY ? ' (dry)' : ''}`);

  // transporters — upsert by name; remember legacy TID -> id for FKs.
  const tidToId = new Map<number, number>();
  let tn = 0;
  for (const t of J('TRANSPORTER')) {
    const tid = int(t.TID);
    const name = s(t['TRANSPORT NAME']);
    if (!tid || !name) continue;
    const data = { packing: num(t.PACKING), freight: num(t.FREIGHT) };
    if (!DRY) {
      const row = await prisma.transporter.upsert({ where: { name }, create: { name, ...data }, update: data });
      tidToId.set(tid, row.id);
    }
    tn++;
  }
  log('transporters', tn);
  const mapTid = (tid: number | null) => (tid != null && tidToId.has(tid) ? tidToId.get(tid)! : null);

  // customers — match by party name (no unique on it, so findFirst + update/create).
  let cn = 0;
  for (const c of J('CUSTOMER')) {
    const name = s(c['PARTY NAME']);
    if (!name) continue;
    const data = {
      partySource: s(c['PARTY SOURCE']),
      agentName: up(c['AGENT NAME']),
      category: up(c.CATEGORY),
      partyName: name,
      billingRate: num(c['BILLING RATE']),
      transporterId: mapTid(int(c.TID)),
      transportName: s(c['TRANSPORT NAME']),
      bagName: s(c['BAG NAME']),
      packing: num(c.PACKING),
      freight: num(c.FREIGHT),
      creditPeriod: int(c['CREDIT PERIOD']),
      city: s(c.CITY),
      state: s(c.STATE),
      region: s(c.REGION),
      mobile: s(c.MOBILE),
      email: s(c.EMAIL),
      brand: s(c.BRAND),
      billRatePc: num(c['BILL RATE PC']),
      boxRate: int(c.BOXRATE),
      payBy: s(c['PAY BY']),
    };
    if (!DRY) {
      const ex = await prisma.customer.findFirst({ where: { partyName: name }, select: { id: true } });
      if (ex) await prisma.customer.update({ where: { id: ex.id }, data });
      else await prisma.customer.create({ data });
    }
    cn++;
  }
  log('customers', cn);

  // products — upsert by (category, subCategory, product, size).
  let pn = 0;
  for (const p of J('PRODUCT')) {
    const category = s(p.CATEGORY) ?? '';
    const subCategory = s(p['SUB CATEGORY']) ?? '';
    const product = s(p.PRODUCT) ?? '';
    if (!category || !product) continue;
    const size = num(p.SIZE);
    const data = { weight: num(p.WEIGHT), pcs: num(p.PCS), rate: num(p.RATE) };
    if (!DRY) {
      const ex = await prisma.product.findFirst({ where: { category, subCategory, product, size }, select: { id: true } });
      if (ex) await prisma.product.update({ where: { id: ex.id }, data });
      else await prisma.product.create({ data: { category, subCategory, product, size, ...data } });
    }
    pn++;
  }
  log('products', pn);

  // designs — upsert by (category, subCategory, designType).
  const upsertDesign = async (category: string, subCategory: string, designType: string, cost: number | null, rate: number | null) => {
    if (!category || !designType) return false;
    if (!DRY)
      await prisma.design.upsert({
        where: { category_subCategory_designType: { category, subCategory, designType } },
        create: { category, subCategory, designType, cost, rate },
        update: { cost, rate },
      });
    return true;
  };
  let dn = 0;
  for (const d of J('DESIGN')) if (await upsertDesign(s(d.CATEGORY) ?? '', s(d['SUB CATEGORY']) ?? '', s(d['DESIGN TYPE']) ?? '', num(d.COST), num(d.RATE))) dn++;
  log('designs', dn);

  // combinations -> designs (combined design types; legacy design dropdown = DESIGN ∪ COMBINATION).
  let cmn = 0;
  for (const m of J('COMBINATION')) if (await upsertDesign(s(m.CATEGORY) ?? '', s(m['SUB CATEGORY']) ?? '', s(m['DESIGN TYPE']) ?? '', num(m.COST), num(m.RATE))) cmn++;
  log('combinations→designs', cmn);

  // design names — upsert by (designType, designName).
  let dnn = 0;
  for (const n of J('DESIGNNAME')) {
    const designType = s(n['DESIGN TYPE L']);
    const designName = s(n['DESIGN NAME']);
    if (!designType || !designName) continue;
    if (!DRY) {
      const ex = await prisma.designName.findFirst({ where: { designType, designName }, select: { id: true } });
      if (!ex) await prisma.designName.create({ data: { designType, designName } });
    }
    dnn++;
  }
  log('design names', dnn);

  const cmap = await customerMap();
  const omsByName = new Map(
    (await prisma.customer.findMany({ select: { id: true, partyName: true } })).filter((c) => c.partyName).map((c) => [c.partyName!.toUpperCase(), c.id]),
  );

  // GST rates — upsert by (customerName, category).
  let gn = 0;
  for (const g of J('CUSTOMER_GST_RATE')) {
    const customerName = s(g['CUSTOMER NAME']);
    const category = up(g.PCATEGORY);
    if (!customerName || !category) continue;
    const data = { customerId: omsByName.get(customerName.toUpperCase()) ?? null, customerName, category, rate: int(g.RATE) };
    if (!DRY) await prisma.gstRate.upsert({ where: { customerName_category: { customerName, category } }, create: data, update: data });
    gn++;
  }
  log('gst rates', gn);

  // transport rates — match by (customerName, category, type, transportName).
  let trn = 0;
  for (const t of J('TRANS_RATE')) {
    const customerName = s(t.CUSTOMER) ?? '';
    const category = s(t.CATEGORY) ?? '';
    const type = s(t.TYPE) ?? '';
    if (!customerName || !category) continue;
    const transportName = s(t['TRANSPORT NAME']);
    const data = { customerId: cmap.get(int(t['CUS ID']) ?? -1) ?? null, customerName, category, type, transporterId: mapTid(int(t.TID)), transportName, rate: int(t.RATE) };
    if (!DRY) {
      const ex = await prisma.transRate.findFirst({ where: { customerName, category, type, transportName }, select: { id: true } });
      if (ex) await prisma.transRate.update({ where: { id: ex.id }, data });
      else await prisma.transRate.create({ data });
    }
    trn++;
  }
  log('transport rates', trn);
}

/* ── price-calc field map ───────────────────────────────────────────────────── */
async function importPriceCal() {
  console.log(`PRICE-CAL${DRY ? ' (dry)' : ''}`);
  const obj: Record<string, string> = {};
  for (const r of J('PRICECAL')) {
    const c = up(r.CATEGORY);
    if (!c) continue;
    obj[c] = String(r.FIELD).toUpperCase() === 'PCS' ? 'PCS' : 'KGS';
  }
  const value = JSON.stringify(obj);
  if (!DRY) await prisma.appConfig.upsert({ where: { key: 'CATEGORY_CALC_FIELDS' }, update: { value }, create: { key: 'CATEGORY_CALC_FIELDS', value } });
  log('category price-calc fields', Object.keys(obj).length);
}

/* ── agents (distinct customer agent names) ──────────────────────────────────── */
async function importAgents() {
  console.log(`AGENTS${DRY ? ' (dry)' : ''}`);
  const names = new Set<string>();
  for (const c of J('CUSTOMER')) {
    const a = up(c['AGENT NAME']);
    if (a) names.add(a);
  }
  let n = 0;
  for (const name of names) {
    if (!DRY) await prisma.agent.upsert({ where: { name }, create: { name }, update: {} });
    n++;
  }
  log('agents', n);
}

/* ── special rates (Form10 → customer_rates + logo restrictions) ─────────────── */
async function importSpecial() {
  console.log(`SPECIAL RATES${DRY ? ' (dry)' : ''}`);
  const cmap = await customerMap();

  const saveRate = async (legacyId: number | null, kind: 'PRODUCT' | 'DESIGN', scope: 'CATEGORY' | 'SUBCATEGORY' | 'ITEM', category: unknown, subCategory: unknown, target: unknown, rate: unknown) => {
    const customerId = legacyId != null ? cmap.get(legacyId) : undefined;
    if (!customerId) return false;
    const cat = up(category);
    if (!cat) return false;
    const sub = scope === 'CATEGORY' ? '' : up(subCategory) ?? '';
    const tgt = scope === 'ITEM' ? s(target) ?? '' : '';
    if (scope !== 'CATEGORY' && !sub) return false;
    if (scope === 'ITEM' && !tgt) return false;
    const r = num(rate);
    if (r == null) return false;
    const key = { customerId, kind, scope, category: cat, subCategory: sub, target: tgt };
    if (!DRY) await prisma.customerRate.upsert({ where: { customerId_kind_scope_category_subCategory_target: key }, create: { ...key, rate: r }, update: { rate: r } });
    return true;
  };

  let n = 0;
  for (const x of J('SPRODUCT')) if (await saveRate(int(x.ID), 'PRODUCT', 'ITEM', x.PCATEGORY, x['SUB CATEGORY'], x.PRODUCT, x.PRATE)) n++;
  for (const x of J('SCSPRODUCT')) if (await saveRate(int(x.ID), 'PRODUCT', 'SUBCATEGORY', x.PCATEGORY, x['SUB CATEGORY'], null, x.PCSRATE)) n++;
  for (const x of J('SCPRODUCT')) if (await saveRate(int(x.ID), 'PRODUCT', 'CATEGORY', x.PCATEGORY, null, null, x.PCRATE)) n++;
  for (const x of J('SDESIGN')) if (await saveRate(int(x.ID), 'DESIGN', 'ITEM', x.PCATEGORY, x['SUB CATEGORY'], x.DESIGN, x.DRATE)) n++;
  for (const x of J('SCSDESIGN')) if (await saveRate(int(x.ID), 'DESIGN', 'SUBCATEGORY', x.PCATEGORY, x['SUB CATEGORY'], null, x.DCSRATE)) n++;
  for (const x of J('SCDESIGN')) if (await saveRate(int(x.ID), 'DESIGN', 'CATEGORY', x.PCATEGORY, null, null, x.DCRATE)) n++;
  log('customer rate overrides', n);

  let lg = 0;
  const saveLogo = async (legacyId: number | null, scope: 'CATEGORY' | 'SUBCATEGORY', category: unknown, subCategory: unknown) => {
    const customerId = legacyId != null ? cmap.get(legacyId) : undefined;
    const cat = up(category);
    if (!customerId || !cat) return false;
    const sub = scope === 'CATEGORY' ? '' : up(subCategory) ?? '';
    if (scope === 'SUBCATEGORY' && !sub) return false;
    const key = { customerId, scope, category: cat, subCategory: sub };
    if (!DRY) await prisma.customerLogoRestriction.upsert({ where: { customerId_scope_category_subCategory: key }, create: key, update: {} });
    return true;
  };
  for (const x of J('SP_CATEGORY_LOGO')) if (await saveLogo(int(x.ID), 'CATEGORY', x.PCATEGORY, null)) lg++;
  for (const x of J('SP_SUBCATEGORY_LOGO')) if (await saveLogo(int(x.ID), 'SUBCATEGORY', x.PCATEGORY, x['SUB CATEGORY'])) lg++;
  log('logo restrictions', lg);
}

/* ── orders (fresh load, legacy ORDER ID / line ID preserved) ────────────────── */
async function importOrders() {
  console.log(`ORDERS${DRY ? ' (dry)' : ''} — fresh load (clears existing orders)`);
  const cmap = await customerMap();
  if (!DRY) await prisma.order.deleteMany({}); // cascades order_items + dispatches

  const rows = J('ORDERTBL');
  const groups = new Map<number, any[]>();
  for (const r of rows) {
    const oid = int(r['ORDER ID']);
    if (!oid) continue;
    if (!groups.has(oid)) groups.set(oid, []);
    groups.get(oid)!.push(r);
  }
  let orders = 0;
  let items = 0;
  for (const [oid, gr] of groups) {
    const h = gr[0];
    const header = {
      id: oid,
      code: `ORD-${String(oid).padStart(5, '0')}`,
      customerId: cmap.get(int(h['CUST ID']) ?? -1) ?? null,
      customerName: s(h['CUSTOMER NAME']) ?? '',
      agentName: up(h['AGENT NAME']),
      category: up(h.CATEGORY),
      orderDate: dt(h['ORDER DATE']) ?? new Date(0),
      completionDate: dt(h['COMPLETION DATE']),
      completionDay: int(h['COMPLETION DAY']),
      priority: up(h.PRIORITY),
      status: up(h.STATUS) ?? 'CONFIRMED',
      ordType: s(h.ORDTYPE) ?? 'SALES ORDER',
      userName: s(h['USER NAME']),
    };
    if (!DRY) await prisma.order.create({ data: header });
    orders++;
    const itemData = gr
      .map((r) => {
        const iid = int(r.ID);
        if (!iid) return null;
        return {
          id: iid,
          orderId: oid,
          pCategory: up(r.PCATEGORY),
          subCategory: s(r['SUB CATEGORY']),
          product: s(r.PRODUCT),
          design: s(r.DESIGN),
          productName: s(r['PRODUCT NAME']),
          designType: s(r['DESIGN TYPE']),
          psize: num(r.PSIZE),
          bags: num(r.BAGS),
          pcs: num(r.PCS),
          gram: num(r.GRAM),
          box: num(r.BOX),
          productRate: num(r['PRODUCT RATE']),
          designRate: num(r['DESIGN RATE']),
          rate: num(r.RATE),
          calField: up(r['CAL FIELD']),
          priority: up(r.PRIORITY),
          ordType: s(r.ORDTYPE),
          comment: s(r.COMMENT),
        };
      })
      .filter(Boolean) as any[];
    if (!DRY && itemData.length) await prisma.orderItem.createMany({ data: itemData });
    items += itemData.length;
  }
  log('orders', orders);
  log('order items', items);
}

/* ── dispatch (legacy DispatchID; OrdTrans = order-line id) ──────────────────── */
async function importDispatch() {
  console.log(`DISPATCH${DRY ? ' (dry)' : ''}`);
  const cmap = await customerMap();
  const itemIds = new Set((await prisma.orderItem.findMany({ select: { id: true } })).map((x) => x.id));
  const orderIds = new Set((await prisma.order.findMany({ select: { id: true } })).map((x) => x.id));
  if (!DRY) await prisma.dispatch.deleteMany({});

  const batch: any[] = [];
  let skipped = 0;
  for (const r of J('DispatchTbl')) {
    const id = int(r.DispatchID);
    const oid = int(r['ORDER ID']);
    const oitem = int(r.OrdTrans);
    if (!id || !oid || !oitem || !orderIds.has(oid) || !itemIds.has(oitem)) {
      skipped++;
      continue;
    }
    const st = up(r.DispatchStatus) ?? '';
    batch.push({
      id,
      code: `DSP-${String(id).padStart(5, '0')}`,
      orderItemId: oitem,
      orderId: oid,
      orderCode: `ORD-${String(oid).padStart(5, '0')}`,
      customerId: cmap.get(int(r['CUST ID']) ?? -1) ?? null,
      customerName: s(r['CUSTOMER NAME']) ?? '',
      agentName: up(r['AGENT NAME']),
      category: up(r.CATEGORY),
      pCategory: up(r.PCATEGORY),
      subCategory: s(r['SUB CATEGORY']),
      product: s(r.PRODUCT),
      productName: s(r['PRODUCT NAME']),
      designType: s(r['DESIGN TYPE']),
      psize: num(r.PSIZE),
      priority: up(r.PRIORITY),
      calField: up(r['CAL FIELD']),
      ordType: s(r.ORDTYPE),
      productRate: num(r['PRODUCT RATE']),
      designRate: num(r['DESIGN RATE']),
      rate: num(r.RATE),
      bags: num(r.BAGS),
      pcs: num(r.PCS),
      gram: num(r.GRAM),
      box: num(r.BOX),
      dispatchStatus: st.includes('FULL') ? 'FULLY DISPATCH' : 'PARTIALLY DISPATCH',
      dispatchDate: dt(r.DispDate) ?? dt(r['ORDER DATE']) ?? new Date(0),
      comment: s(r.COMMENT),
      supItem: s(r.SupItem),
      userName: s(r['USER NAME']),
    });
  }
  if (!DRY) for (let i = 0; i < batch.length; i += 500) await prisma.dispatch.createMany({ data: batch.slice(i, i + 500) });
  log('dispatches', batch.length);
  log('skipped (no matching order/item)', skipped);
}

async function main() {
  console.log(`Importing from: ${DIR}${DRY ? '  [DRY RUN — no writes]' : ''}\n`);
  if (want('masters')) await importMasters();
  if (want('pricecal')) await importPriceCal();
  if (want('agents')) await importAgents();
  if (want('special')) await importSpecial();
  if (want('orders')) await importOrders();
  if (want('dispatch')) await importDispatch();
  console.log('\nDone.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
