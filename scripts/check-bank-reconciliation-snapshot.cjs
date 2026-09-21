// Read-only production-data verification: SQLite backup, then recheck ONLY the
// isolated copy. No receipts are posted, edited or deleted.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const sourcePath = path.resolve(process.argv[2] || path.join(root, 'apps/api/prisma/dev.db'));
const temp = fs.mkdtempSync(path.join(root, 'tmp-bank-snapshot-'));
const copy = path.join(temp, 'snapshot.db');

(async () => {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try { await backup(source, copy); } finally { source.close(); }
  process.env.DATABASE_URL = `file:${copy.replaceAll('\\', '/')}`;
  require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
  const { PrismaClient } = require('@prisma/client');
  const { BankStatementService } = require('../apps/api/src/bank-statement/bank-statement.service.ts');
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const svc = new BankStatementService(prisma, {});
  const moneyHash = async () => createHash('sha256').update(JSON.stringify(await Promise.all([
    prisma.acctLedger.findMany({ orderBy: { id: 'asc' } }),
    prisma.acctPaymentReceipt.findMany({ orderBy: { id: 'asc' } }),
    prisma.acctPartyAdvance.findMany({ orderBy: { id: 'asc' } }),
    prisma.acctOpeningTrans.findMany({ orderBy: { id: 'asc' } }),
  ]))).digest('hex');
  try {
    const hash = await moneyHash();
    const before = await prisma.bankStatementRow.findMany({ orderBy: { id: 'asc' } });
    const runs = await prisma.bankStatementRun.findMany({ orderBy: { id: 'asc' } });
    const warnings = [];
    for (const run of runs) {
      const r = await svc.recheck(run.id);
      warnings.push({ runId: run.id, missingReference: r.reopened.length, changedCoverage: r.uncovered.length });
    }
    const after = await prisma.bankStatementRow.findMany({ orderBy: { id: 'asc' } });
    assert.equal(await moneyHash(), hash, 'recheck must not change ANY accounting record');
    const differences = after.filter((r, i) => r.status !== before[i].status || r.matchedAmount !== before[i].matchedAmount);
    console.log(JSON.stringify({ warnings, accountingUnchanged: true, changedLines: differences.length,
      oldDeletedNotes: before.filter((r) => /receipt.*deleted/i.test(r.note || '')).length,
      remainingDeletedNotes: after.filter((r) => /receipt.*deleted/i.test(r.note || '')).length,
      runs: await prisma.bankStatementRun.findMany({ select: { id: true, status: true, matchedCount: true, partialCount: true, unmatchedCount: true, postedCount: true } }),
      differences: differences.map((r) => ({ runId: r.runId, rowNo: r.rowNo, customer: r.customerName, status: r.status, oldCovered: before.find((b) => b.id === r.id).matchedAmount, covered: r.matchedAmount, amount: r.amount })),
    }, null, 2));
    const stable = JSON.stringify(after);
    for (const run of runs) await svc.recheck(run.id);
    assert.equal(JSON.stringify(await prisma.bankStatementRow.findMany({ orderBy: { id: 'asc' } })), stable, 'repeat recheck must be stable');
    console.log('PASS snapshot accounting unchanged; repeated rechecks stable');
  } finally { await prisma.$disconnect(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
