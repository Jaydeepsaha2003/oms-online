// Isolated service integration tests. Creates its own empty SQLite database;
// never reads or writes dev.db, starts an API, or sends notifications.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-booking-order-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { BookingsService } = require('../apps/api/src/bookings/bookings.service.ts');
const { OrdersService } = require('../apps/api/src/orders/orders.service.ts');
const sql = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'apps/api/prisma/schema.prisma'), '--script'], { cwd: root, encoding: 'utf8', env: process.env });
assert.equal(sql.status, 0, sql.stderr);
const sqlite = new DatabaseSync(dbPath);
sqlite.exec(sql.stdout);
sqlite.close();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const bookings = new BookingsService(prisma, {});
const orders = new OrdersService(prisma, {}, bookings, { orderCreated() {}, orderUpdated() {} });
const line = (bookingId, bags = 1, extra = {}) => ({ bookingId, pCategory: 'GLASS', subCategory: 'PLAIN', product: 'TEST', productName: 'TEST', designType: 'NA', bags, gram: bags * 70, calField: 'KGS', productRate: 999, designRate: 0, rate: 999, ...extra });
const order = (items, extra = {}) => ({ customerName: 'PARTY', orderDate: '2026-09-10', status: 'CONFIRMED', items, ...extra });
async function booking(items = [{ pCategory: 'GLASS', bags: 10, kgs: 700 }], extra = {}) {
  return prisma.booking.create({ data: { customerName: 'PARTY', bookingDate: new Date('2026-06-18'), bags: items.reduce((s,i) => s+i.bags,0), kgs: items.reduce((s,i) => s+i.kgs,0), items: { create: items }, ...extra } });
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
test('rejects another party booking', async () => { const b = await booking(); await assert.rejects(orders.create(order([line(b.id)], {customerName:'OTHER'})), /customer|party/i); });
test('bags-only reservation allows derived kg', async () => { const b = await booking([{pCategory:'GLASS',bags:2,kgs:0}]); await orders.create(order([line(b.id)])); });
test('kg-only reservation allows derived bags', async () => { const b = await booking([{pCategory:'GLASS',bags:0,kgs:140}]); await orders.create(order([line(b.id)])); });
test('category limit applies below total limit', async () => { const b = await booking([{pCategory:'GLASS',bags:1,kgs:70},{pCategory:'CUP',bags:9,kgs:630}]); await assert.rejects(orders.create(order([line(b.id,2)])), /GLASS|category/i); });
test('unrelated category needs unspecified capacity', async () => { const b = await booking(); await assert.rejects(orders.create(order([line(b.id,1,{pCategory:'CUP'})])), /category|CUP/i); });
test('unmatched categories share unspecified bucket', async () => { const b = await booking([{pCategory:'',bags:2,kgs:0},{pCategory:'GLASS',bags:8,kgs:0}]); await orders.create(order([line(b.id,1,{pCategory:'CUP'})])); await assert.rejects(orders.create(order([line(b.id,2,{pCategory:'PLATE'})])), /remaining|left|exceeds/i); });
test('closed and unknown booking statuses reject new draws', async () => { for (const status of ['CANCELLED','PRECLOSED','CONVERTED','UNKNOWN']) { const b = await booking(undefined,{status}); await assert.rejects(orders.create(order([line(b.id)])), /draw|closed|converted|status|cancelled/i); } });
test('overage withdrawals count toward category and total', async () => { const b = await booking([{pCategory:'GLASS',bags:2,kgs:140},{pCategory:'CUP',bags:8,kgs:560}]); await prisma.bookingConversion.create({data:{bookingId:b.id,kind:'DISPATCH_OVERAGE',pCategory:'GLASS',bags:1,kgs:70}}); await assert.rejects(orders.create(order([line(b.id,2)])), /remaining|left|exceeds/i); });
test('negative booking quantities cannot offset another draw', async () => { const b = await booking(); await assert.rejects(orders.create(order([line(b.id,11),line(b.id,-2)])), /negative|quantity|quantities/i); });
test('saved draft continues consuming reservation', async () => { const b = await booking([{pCategory:'GLASS',bags:1,kgs:70}]); await orders.create(order([line(b.id)],{status:'DRAFT'})); await assert.rejects(orders.create(order([line(b.id)])), /draw|remaining|left|converted/i); });
test('replacement counts original order once, preserves frozen rate', async () => { const b = await booking([{pCategory:'GLASS',bags:2,kgs:140}]); const o = await orders.create(order([line(b.id,2)])); assert.equal(o.items[0].rate,100); await prisma.orderItem.update({where:{id:o.items[0].id},data:{productRate:91,rate:91}}); const saved = await orders.findOne(o.id); const updated = await orders.update(o.id,order([{...saved.items[0],bags:1,gram:70,rate:999,productRate:999}],{orderDate:'2026-09-11'})); assert.equal(updated.items[0].rate,91); assert.equal((await bookings.findOne(b.id)).remainingBags,1); });
test('dispatched historical identity and rates survive quantity edit', async () => { const b = await booking(); const o = await orders.create(order([line(b.id,2)])); const it = o.items[0]; await prisma.orderItem.update({where:{id:it.id},data:{productRate:91,rate:91}}); const d = await prisma.dispatch.create({data:{orderId:o.id,orderItemId:it.id,customerName:'PARTY',bags:1,gram:70,rate:91}}); const saved = await orders.findOne(o.id); await orders.update(o.id,order([{...saved.items[0],bags:3,gram:210}])); assert.deepEqual(await prisma.dispatch.findUnique({where:{id:d.id}}),d); await assert.rejects(orders.update(o.id,order([{...saved.items[0],bookingId:null}])), /dispatched/i); });
test('restoring a cancelled order cannot reclaim consumed balance', async () => { const b = await booking([{pCategory:'GLASS',bags:1,kgs:70}]); const o = await orders.create(order([line(b.id)])); await orders.updateStatus(o.id,'CANCELLED'); await orders.create(order([line(b.id)])); await assert.rejects(orders.updateStatus(o.id,'CONFIRMED'), /draw|remaining|left|converted/i); });
test('two dated orders share booking without changing original order', async () => { const b = await booking([{pCategory:'GLASS',bags:300,kgs:21000}]); const first = await orders.create(order([line(b.id)],{orderDate:'2026-06-18'})); const second = await orders.create(order([line(b.id,3),line(b.id,2)],{orderDate:'2026-09-10'})); assert.notEqual(first.id,second.id); assert.equal((await orders.findOne(first.id)).orderDate,first.orderDate); assert.equal((await bookings.findOne(b.id)).remainingBags,294); });
test('booking basis survives a later rate change and a later order date', async () => {
  // The product cost 100 when the booking was made and 500 today.
  const p = await prisma.product.create({data:{category:'GLASS',subCategory:'PLAIN',product:'RISEN',rate:500}});
  await prisma.productRateHistory.create({data:{productId:p.id,productName:'RISEN',category:'GLASS',subCategory:'PLAIN',oldRate:100,newRate:500,changedAt:new Date('2026-09-01')}});
  const b = await booking([{pCategory:'GLASS',bags:10,kgs:700}]);
  const o = await orders.create(order([line(b.id,1,{product:'RISEN',productName:'RISEN'})],{orderDate:'2026-09-10'}));
  assert.equal(o.items[0].rate,100,'a booking line is priced as of the booking date, not the order date');
  // The same item on a REGULAR line of the same order still gets today's rate.
  const plain = await orders.create(order([{...line(null,1,{product:'RISEN',productName:'RISEN'}),bookingId:null}],{orderDate:'2026-09-10'}));
  assert.equal(plain.items[0].rate,999,'a regular line keeps the rate the form sent');
  // A later edit that touches only quantity must not move the frozen figure.
  const saved = await orders.findOne(o.id);
  const edited = await orders.update(o.id,order([{...saved.items[0],bags:2,gram:140}],{orderDate:'2026-09-20'}));
  assert.equal(edited.items[0].rate,100);
});
test('a booking lists every dated order it was drawn into', async () => {
  const b = await booking([{pCategory:'GLASS',bags:10,kgs:700}]);
  const first = await orders.create(order([line(b.id,1)],{orderDate:'2026-06-18'}));
  const second = await orders.create(order([line(b.id,2)],{orderDate:'2026-09-10'}));
  const dto = await bookings.findOne(b.id);
  assert.equal(dto.orders.length,2,'both dated orders are listed, not just Booking.orderId');
  assert.deepEqual(dto.orders.map(o=>o.id).sort((x,y)=>x-y),[first.id,second.id]);
  assert.notEqual(dto.orders[0].orderDate,dto.orders[1].orderDate,'each order carries its own date');
});
test('concurrent last-bag saves admit exactly one order', async () => { const b = await booking([{pCategory:'GLASS',bags:1,kgs:70}]); const results = await Promise.allSettled([orders.create(order([line(b.id)])),orders.create(order([line(b.id)]))]); assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.equal(await prisma.orderItem.count({where:{bookingId:b.id}}),1); assert.equal((await bookings.findOne(b.id)).remainingBags,0); });
test('normal save and conversion cannot both take the last bag', async () => {
  const b = await booking([{pCategory:'GLASS',bags:1,kgs:70}]);
  const original = bookings.assertDrawable.bind(bookings);
  let release;
  const firstChecked = new Promise(resolve => { release = resolve; });
  let checked = 0;
  bookings.assertDrawable = async (...args) => {
    await original(...args);
    if (args[0] === b.id && ++checked === 1) {
      release();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
  try {
    const saving = orders.create(order([line(b.id)]));
    await firstChecked;
    const converting = bookings.convert(b.id, { lines: [line(b.id)] });
    const results = await Promise.allSettled([saving, converting]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(await prisma.orderItem.count({where:{bookingId:b.id}}), 1);
  } finally { bookings.assertDrawable = original; }
});
test('size-specific booking price is preserved through save and later edits', async () => {
  await prisma.product.create({data:{category:'GLASS',subCategory:'PLAIN',product:'SIZED',size:7,rate:100}});
  await prisma.product.create({data:{category:'GLASS',subCategory:'PLAIN',product:'SIZED',size:7.5,rate:200}});
  const b = await booking();
  const input = line(b.id,1,{product:'SIZED',productName:'7.5 SIZED',psize:7.5});
  const quote = await bookings.quote(b.id,{lines:[input]});
  const saved = await orders.create(order([input]));
  assert.equal(quote.lines[0].rate,200);
  assert.equal(saved.items[0].rate,quote.lines[0].rate);
  assert.equal(saved.items[0].psize,7.5);
  const edited = await orders.update(saved.id,order([{...saved.items[0],bags:2,gram:140}]));
  assert.equal(edited.items[0].rate,200);
  assert.equal(edited.items[0].psize,7.5);
});
(async () => { let failures=0; try { await prisma.product.create({data:{category:'GLASS',subCategory:'PLAIN',product:'TEST',rate:100}}); for(const [name,fn] of tests) { try { await fn(); console.log(`PASS ${name}`); } catch(e) { failures++; console.error(`FAIL ${name}: ${e.message}`); } } } finally { await prisma.$disconnect(); fs.rmSync(temp,{recursive:true,force:true}); } console.log(`${tests.length-failures}/${tests.length} passed`); process.exitCode=failures?1:0; })().catch(e=>{console.error(e);process.exitCode=1;});
