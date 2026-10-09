// Full Dispatch is refused while the order line is still a whole bag or more
// short (2 bags ordered, 1 sent); an approver may confirm it. Old short-Full rows are flagged. Builds its own empty SQLite
// database from the schema; never touches dev.db, starts no API, sends nothing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-short-full-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { DispatchService } = require('../apps/api/src/dispatch/dispatch.service.ts');
const sql = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'apps/api/prisma/schema.prisma'), '--script'], { cwd: root, encoding: 'utf8', env: process.env });
assert.equal(sql.status, 0, sql.stderr);
const sqlite = new DatabaseSync(dbPath);
sqlite.exec(sql.stdout);
sqlite.close();

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const handlers = {};
const noop = () => {};
const svc = new DispatchService(
  prisma,
  { registerHandler: (type, fn) => { handlers[type] = fn; }, registerAuditTarget: noop },
  { record: async () => {} },
  new Proxy({}, { get: () => noop }), // notifier
  new Proxy({}, { get: () => noop }), // gateway
  { resyncOverageDraw: async () => {} },
);
svc.onModuleInit();

const DAY = new Date(2026, 8, 10); // 10-09-2026, local midnight
const OTHER_DAY = new Date(2026, 8, 11);
async function line() {
  const order = await prisma.order.create({ data: { customerName: 'PARTY', code: `ORD-${Date.now()}${Math.random()}`, status: 'CONFIRMED' } });
  return prisma.orderItem.create({ data: { orderId: order.id, product: 'JET', productName: '10 JET', bags: 2, gram: 140, calField: 'KGS', status: 'CONFIRMED' } });
}
const dispatch = (it, qty, day = DAY) =>
  prisma.dispatch.create({ data: { orderId: it.orderId, orderItemId: it.id, customerName: 'PARTY', dispatchStatus: 'PARTIALLY DISPATCH', dispatchDate: day, bags: 0, pcs: 0, gram: 0, box: 0, ...qty } });

const TODAY = new Date().toISOString();
const short = (e) => { assert.match(e.message, /bag\(s\) of this order are still pending/); return true; };
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('Full with 1 of 2 bags sent is refused', async () => {
  const it = await line();
  await assert.rejects(svc.create({ orderItemId: it.id, bags: 1, gram: 71, dispatchStatus: 'FULLY DISPATCH', dispatchDate: TODAY }), short);
});
test('an approver who confirms may close it short', async () => {
  const it = await line();
  const d = await svc.create({ orderItemId: it.id, bags: 1, gram: 71, dispatchStatus: 'FULLY DISPATCH', dispatchDate: TODAY, confirmShortFull: true }, 'A', { canApprove: true });
  assert.equal(d.dispatchStatus, 'FULLY DISPATCH');
});
test('confirmShortFull from a non-approver is ignored', async () => {
  const it = await line();
  await assert.rejects(svc.create({ orderItemId: it.id, bags: 1, gram: 71, dispatchStatus: 'FULLY DISPATCH', dispatchDate: TODAY, confirmShortFull: true }, 'U', { canApprove: false }), short);
});
test('less than a bag short (1.5 of 2, or 0.33 shares) may still close Full', async () => {
  const it = await line();
  const d = await svc.create({ orderItemId: it.id, bags: 1.5, gram: 120, dispatchStatus: 'FULLY DISPATCH', dispatchDate: TODAY });
  assert.equal(d.dispatchStatus, 'FULLY DISPATCH');
});
test('editing a Partial row to Full while short is refused; remark edit on an old short Full row is not', async () => {
  const it = await line();
  const p = await dispatch(it, { bags: 1, gram: 71 });
  await assert.rejects(svc.update(p.id, { dispatchStatus: 'FULLY DISPATCH' }), short);
  const it2 = await line();
  const f = await prisma.dispatch.create({ data: { orderId: it2.orderId, orderItemId: it2.id, customerName: 'PARTY', dispatchStatus: 'FULLY DISPATCH', dispatchDate: DAY, bags: 1, gram: 69 } });
  assert.equal((await svc.update(f.id, { comment: 'checked' })).comment, 'checked');
});
test('the Modify Dispatch list flags the old short Full row with bags short', async () => {
  const it = await line();
  const f = await prisma.dispatch.create({ data: { orderId: it.orderId, orderItemId: it.id, customerName: 'PARTY', dispatchStatus: 'FULLY DISPATCH', dispatchDate: DAY, bags: 1, gram: 69 } });
  const list = await svc.findMany({ page: 1, pageSize: 500, skip: 0 });
  assert.equal(list.items.find((r) => r.id === f.id).shortBags, 1);
  assert.equal(list.items.filter((r) => r.shortBags).every((r) => r.dispatchStatus === 'FULLY DISPATCH'), true);
});

test('the "Short Full only" filter lists just those rows', async () => {
  const it = await line();
  const f = await prisma.dispatch.create({ data: { orderId: it.orderId, orderItemId: it.id, customerName: 'PARTY', dispatchStatus: 'FULLY DISPATCH', dispatchDate: DAY, bags: 1, gram: 69 } });
  const ok = await line();
  await prisma.dispatch.create({ data: { orderId: ok.orderId, orderItemId: ok.id, customerName: 'PARTY', dispatchStatus: 'FULLY DISPATCH', dispatchDate: DAY, bags: 2, gram: 140 } });
  const list = await svc.findMany({ page: 1, pageSize: 500, skip: 0, shortFull: true });
  assert.ok(list.items.some((r) => r.id === f.id));
  assert.ok(list.items.every((r) => r.dispatchStatus === 'FULLY DISPATCH' && r.shortBags >= 1));
  assert.equal(list.total, list.items.length);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`);
  await prisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();