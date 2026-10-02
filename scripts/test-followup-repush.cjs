// A follow-up that stays due is pushed again every "Remind every N mins" — not
// once per day — and never outside working hours. Isolated fixture DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-followup-repush-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { CrmService } = require('../apps/api/src/crm/crm.service.ts');

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
const crm = new CrmService(prisma);
const ago = (mins) => new Date(Date.now() - mins * 60_000);
const settings = (extra) =>
  prisma.appConfig.upsert({
    where: { key: 'CRM_REMINDER_DEFAULTS' },
    update: { value: JSON.stringify({ intervalMins: 120, workStartHour: 0, workEndHour: 24, ...extra }) },
    create: { key: 'CRM_REMINDER_DEFAULTS', value: JSON.stringify({ intervalMins: 120, workStartHour: 0, workEndHour: 24, ...extra }) },
  });
const followup = (title, pushSentAt) =>
  prisma.followup.create({ data: { kind: 'PAYMENT', partyName: 'P', title, status: 'OPEN', promisedAt: ago(24 * 60), pushSentAt } });

(async () => {
  let failed = false;
  try {
    await settings({});
    await followup('never pushed', null);
    await followup('pushed 3h ago', ago(180));
    await followup('pushed 30m ago', ago(30));
    const due = (await crm.dueUnpushed()).map((f) => f.title).sort();
    assert.deepEqual(due, ['never pushed', 'pushed 3h ago'], 'pushed again once the 2h interval has passed, not before');
    console.log('PASS a still-due follow-up is pushed again every interval');

    const h = new Date().getHours();
    await settings({ workStartHour: (h + 1) % 24, workEndHour: (h + 1) % 24 === 0 ? 1 : Math.min(24, h + 2) });
    assert.deepEqual(await crm.dueUnpushed(), [], 'nothing outside working hours');
    console.log('PASS nothing is pushed outside working hours');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${e.stack ?? e.message}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})();
