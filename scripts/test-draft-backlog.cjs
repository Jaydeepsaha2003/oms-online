// Draft backlog reminder: stale DRAFT orders page only the system admin, once per
// two-hour slot; a fresh draft or no draft sends nothing. Isolated fixture DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-draft-backlog-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { DraftBacklogScheduler } = require('../apps/api/src/orders/draft-backlog.scheduler.ts');

const sql = spawnSync(
  process.execPath,
  [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'apps/api/prisma/schema.prisma'), '--script'],
  { cwd: root, encoding: 'utf8', env: process.env },
);
assert.equal(sql.status, 0, sql.stderr);
const sqlite = new DatabaseSync(dbPath);
sqlite.exec(sql.stdout);
sqlite.close();

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const sent = [];
const told = new Set();
let askedFor = null;
const s = new DraftBacklogScheduler(
  prisma,
  { userIdsWith: async (p) => { askedFor = p; return ['admin']; } },
  { notifyUsers: (ids, n) => sent.push({ ids, n }) },
  { sendToUsers: async () => {} },
  { notInDnd: async (ids) => ids },
  { filterUntold: async (key, ids) => ids.filter((id) => !told.has(`${key}|${id}`)), record: async (key, ids) => ids.forEach((id) => told.add(`${key}|${id}`)) },
);
(async () => {
  let failed = false;
  try {
    const old = new Date(Date.now() - 3 * 3600_000);
    await prisma.order.create({ data: { customerName: 'FRESH PARTY', status: 'DRAFT' } });
    await s.tick();
    assert.equal(sent.length, 0, 'a draft made minutes ago is work in progress');
    const o = await prisma.order.create({ data: { customerName: 'PRIYANKA STAINLESS', status: 'DRAFT', createdAt: old, updatedAt: old } });
    await s.tick();
    assert.equal(askedFor, '*', 'audience is the system admin grant');
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].ids, ['admin']);
    assert.match(sent[0].n.title, /Draft backlog — 1 order to clear/);
    assert.match(sent[0].n.body, new RegExp(`#${o.id} PRIYANKA STAINLESS`));
    assert.equal(sent[0].n.data.url, '/orders?status=DRAFT');
    console.log('PASS a stale draft reminds the system admin, linking to Drafts only');
    await s.tick();
    assert.equal(sent.length, 1, 'once per two-hour slot');
    console.log('PASS not repeated within the same two hours');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.stack ?? e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})();