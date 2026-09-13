// Isolated check for DispatchService's same-line, same-day duplicate guards —
// on create, on EDIT, and on an approved date move. Builds its own empty SQLite
// database from the schema; never touches dev.db, starts no API, sends nothing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-dispatch-dupes-'));
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
  return prisma.orderItem.create({ data: { orderId: order.id, product: 'JET', productName: '10 JET', bags: 10, gram: 700, calField: 'KGS', status: 'CONFIRMED' } });
}
const dispatch = (it, qty, day = DAY) =>
  prisma.dispatch.create({ data: { orderId: it.orderId, orderItemId: it.id, customerName: 'PARTY', dispatchStatus: 'PARTIALLY DISPATCH', dispatchDate: day, bags: 0, pcs: 0, gram: 0, box: 0, ...qty } });

/** Rejects as a DUPLICATE_DISPATCH 409 of the given strength. */
const dupe = (overridable) => (e) => {
  assert.equal(e.getStatus?.(), 409, `expected 409, got ${e.message}`);
  const body = e.getResponse();
  assert.equal(body.error, 'DUPLICATE_DISPATCH');
  assert.equal(body.duplicateDispatch.overridable, overridable);
  return true;
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('edit into an EXACT copy of another same-day dispatch is refused', async () => {
  const it = await line();
  await dispatch(it, { bags: 1, gram: 70 });
  const b = await dispatch(it, { bags: 2, gram: 140 });
  await assert.rejects(svc.update(b.id, { bags: 1, gram: 70 }), dupe(false));
});

test('exact refusal cannot be overridden with confirmSimilar', async () => {
  const it = await line();
  await dispatch(it, { bags: 1, gram: 70 });
  const b = await dispatch(it, { bags: 2, gram: 140 });
  await assert.rejects(svc.update(b.id, { bags: 1, gram: 70, confirmSimilar: true }), dupe(false));
});

test('edit into a SIMILAR dispatch warns, and confirmSimilar lets it through', async () => {
  const it = await line();
  await dispatch(it, { bags: 1, gram: 70, box: 0 });
  const b = await dispatch(it, { bags: 2, gram: 140 });
  await assert.rejects(svc.update(b.id, { bags: 1, gram: 70, box: 3 }), dupe(true));
  const saved = await svc.update(b.id, { bags: 1, gram: 70, box: 3, confirmSimilar: true });
  assert.equal(saved.box, 3);
});

test('moving the DATE onto a day with an identical dispatch is refused', async () => {
  const it = await line();
  await dispatch(it, { bags: 1, gram: 70 }, DAY);
  const b = await dispatch(it, { bags: 1, gram: 70 }, OTHER_DAY);
  await assert.rejects(svc.update(b.id, { dispatchDate: DAY.toISOString() }), dupe(false));
});

test('same quantity on a DIFFERENT day is allowed', async () => {
  const it = await line();
  await dispatch(it, { bags: 1, gram: 70 }, DAY);
  const b = await dispatch(it, { bags: 2, gram: 140 }, OTHER_DAY);
  const saved = await svc.update(b.id, { bags: 1, gram: 70 });
  assert.equal(saved.bags, 1);
});

test('a remark-only edit on a row that already has a twin is NOT blocked', async () => {
  const it = await line();
  await dispatch(it, { bags: 1, gram: 70 });
  const b = await dispatch(it, { bags: 1, gram: 70 }); // legacy twin, predates the guard
  const saved = await svc.update(b.id, { comment: 'checked' });
  assert.equal(saved.comment, 'checked');
});

test('editing a dispatch does not collide with ITSELF', async () => {
  const it = await line();
  const a = await dispatch(it, { bags: 1, gram: 70 });
  const saved = await svc.update(a.id, { bags: 1, gram: 70, comment: 'same qty resent' });
  assert.equal(saved.bags, 1);
});

test('approved date move onto an identical same-day dispatch is refused', async () => {
  const it = await line();
  await dispatch(it, { bags: 1, gram: 70 }, DAY);
  const b = await dispatch(it, { bags: 1, gram: 70 }, OTHER_DAY);
  await assert.rejects(handlers.DISPATCH_DATE_CHANGE({ dispatchId: b.id, dispatchDate: DAY.toISOString() }), dupe(false));
});

test('create still refuses an exact same-day duplicate', async () => {
  const it = await line();
  const today = new Date();
  await dispatch(it, { bags: 1, gram: 70 }, today);
  await assert.rejects(
    svc.create({ orderItemId: it.id, bags: 1, gram: 70, dispatchStatus: 'PARTIALLY DISPATCH', dispatchDate: today.toISOString() }),
    dupe(false),
  );
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log('PASS', name);
    } catch (e) {
      failed++;
      console.log('FAIL', name, '\n   ', e.message);
    }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`);
  await prisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();
