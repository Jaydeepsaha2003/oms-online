// A receipt created by posting a statement line belongs to that line. It must
// not come back as "already accounted for" against the party's NEXT line.
// Reproduces RAMSON: ₹53,269 posted on 11 Aug as RN/800, then counted again
// against the ₹1,29,357 of 16 Aug, which reported itself ₹76,088 short.
// Isolated SQLite fixture — never reads or writes dev.db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-bank-rematch-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { BankStatementService } = require('../apps/api/src/bank-statement/bank-statement.service.ts');
const { PaymentsService } = require('../apps/api/src/payments/payments.service.ts');

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
const svc = new BankStatementService(prisma, new PaymentsService(prisma));

const PARTY = 'RAMSON FIXTURE';
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const bill = (code, amount, day) =>
  prisma.challan.create({
    data: {
      code, prefix: 'SSS', invDate: new Date(day), customerId: 1, customerName: PARTY,
      challanStatus: 'CONFIRMED', b: amount, c: 0, total: amount,
    },
  });

async function run(credits) {
  const r = await prisma.bankStatementRun.create({
    data: {
      fileName: 'AcctStatement.csv', bankName: 'AXIS BANK', status: 'DRAFT',
      fromDate: new Date('2026-04-01'), toDate: new Date('2026-08-27'),
    },
  });
  let n = 0;
  for (const [amount, day] of credits) {
    await prisma.bankStatementRow.create({
      data: {
        runId: r.id, rowNo: ++n, txnDate: new Date(day), narration: `NEFT/${PARTY}/${n}`,
        amount, customerId: 1, customerName: PARTY, partySource: 'NARRATION',
        status: 'UNMATCHED', matchedAmount: 0, rowKey: `${day}|${amount}|${n}`,
      },
    });
  }
  return r;
}
const rowsOf = (runId) => prisma.bankStatementRow.findMany({ where: { runId }, orderBy: { rowNo: 'asc' } });

test("a line's own receipt is not offered as cover for the next line", async () => {
  await bill('SSS/900', 400000, '2026-07-01');
  const r = await run([[53269, '2026-08-11'], [129357, '2026-08-16']]);

  // Post ONLY the first line, the way the operator did.
  const first = (await rowsOf(r.id))[0];
  const posted = await svc.process(r.id, 'Tester', [first.id]);
  assert.equal(posted.created.length, 1, 'the first line posts in full');
  assert.equal(posted.created[0].amount, 53269);

  // Posting must leave the run consistent BY ITSELF. Needing to press Recheck
  // afterwards is how the stale "₹76,088 short" survived on screen.
  const [a, b] = await rowsOf(r.id);
  assert.equal(a.status, 'POSTED');
  assert.equal(b.matchedAmount, 0, 'the second line is not covered by the first line’s own receipt');
  assert.equal(b.matchedRefs, null);

  // And posting it now records the whole credit, not 129357 - 53269.
  const second = await svc.process(r.id, 'Tester', [b.id]);
  assert.deepEqual(second.failed, []);
  assert.equal(second.created[0].amount, 129357, 'the full credit is recorded');
});

test('a receipt entered by hand still covers a line', async () => {
  // The pool must not be emptied wholesale — only what this run already claimed.
  await prisma.customer.update({ where: { id: 1 }, data: { partyName: PARTY } });
  await bill('SSS/901', 50000, '2026-07-02');
  const handEntered = await new PaymentsService(prisma).save(
    { takeAccOn: 'PARTY', customerId: 1, payMode: 'BANK', bankName: 'AXIS BANK', adjMode: 'AUTOMATIC', receiptAmt: 50000, recDate: '2026-08-20' },
    'Tester',
  );
  assert.ok(handEntered.voucherNo);
  const r = await run([[50000, '2026-08-20']]);
  await svc.recheck(r.id);
  const [only] = await rowsOf(r.id);
  assert.equal(only.status, 'MATCHED', 'money already in the books still matches');
  assert.equal(only.matchedAmount, 50000);
});

test('a receipt already spoken for by ANOTHER statement is not cover here', async () => {
  // Two uploads of one account overlap in time even when they share no line:
  // September's file still reaches back over August's receipts. RANJITHAM's
  // early-September credits read as "already covered" by August receipts that
  // had already explained August's credits.
  await bill('SSS/902', 200000, '2026-07-01');
  const august = await run([[29484, '2026-08-18']]);
  const [augRow] = await rowsOf(august.id);
  const augPosted = await svc.process(august.id, 'Tester', [augRow.id]);
  assert.equal(augPosted.created.length, 1, 'August posts its own credit');

  // A second statement whose window reaches back over that August receipt.
  const september = await prisma.bankStatementRun.create({
    data: {
      fileName: 'AcctStatement_Sep.csv', bankName: 'AXIS BANK', status: 'DRAFT',
      fromDate: new Date('2026-06-16'), toDate: new Date('2026-09-16'),
    },
  });
  await prisma.bankStatementRow.create({
    data: {
      runId: september.id, rowNo: 1, txnDate: new Date('2026-09-03'), narration: `NEFT/${PARTY}/sep`,
      amount: 26460, customerId: 1, customerName: PARTY, partySource: 'NARRATION',
      status: 'UNMATCHED', matchedAmount: 0, rowKey: '2026-09-03|26460|sep',
    },
  });
  await svc.recheck(september.id);
  const [sep] = await rowsOf(september.id);
  assert.equal(sep.matchedAmount, 0, 'August’s receipt cannot also explain September’s credit');
  assert.equal(sep.status, 'UNMATCHED', 'so the September credit is postable, not hidden as covered');
});

(async () => {
  let failures = 0;
  try {
    await prisma.customer.create({ data: { id: 1, partyName: PARTY, payBy: 'PARTY' } });
    for (const [name, fn] of tests) {
      try { await fn(); console.log(`PASS ${name}`); }
      catch (e) { failures++; console.error(`FAIL ${name}: ${e.message}`); }
    }
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`${tests.length - failures}/${tests.length} passed`);
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
