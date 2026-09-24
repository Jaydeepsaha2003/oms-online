// Bank Reco fixes from the 24-09-2026 check.
//
//  1. A bank line posted short: the old matcher counted part of it as covered by
//     a receipt that already belonged to another line, so Process wrote only the
//     rest. The receipt that line created is raised to the full bank credit.
//       MINAL 31/08 ₹1,02,023 (RN/828 was ₹25,299) · HIRAN 10/09 ₹58,204 (RN/835
//       was ₹1,610) · ANIL 14/09 ₹95,950 (RN/837 was ₹45,950)
//  2. SRI MURUGAN: two lines posted to "SRI MURUGAN METAL" (no bills) that Tally
//     books to "SRI MURUGAN METAL (K.S.GUNASEKARAN)" — moved there, same numbers.
//
// Then every bank statement is re-matched and the Tally report re-run, on the
// same database, and the results printed.
//   node scripts/fix-bank-reco-2026-09-24.cjs           dry run on a COPY
//   node scripts/fix-bank-reco-2026-09-24.cjs --apply   backup, then live
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const live = path.join(root, 'apps/api/prisma/dev.db');
const apply = process.argv.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
let target = live;
if (apply) {
  const backup = path.join(root, 'backups', `pre-bankfix-${stamp}.db`);
  fs.copyFileSync(live, backup);
  console.log(`Backup: ${backup}`);
} else {
  target = path.join(root, 'backups', `bankfix-dryrun-${stamp}.db`);
  fs.copyFileSync(live, target);
}
process.env.DATABASE_URL = `file:${target.split(path.sep).join('/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { PaymentsService } = require('../apps/api/src/payments/payments.service.ts');
const { BankStatementService } = require('../apps/api/src/bank-statement/bank-statement.service.ts');
const { TallyReconService } = require('../apps/api/src/tally-recon/tally-recon.service.ts');
const { OpeningBalancesService } = require('../apps/api/src/opening-balances/opening-balances.service.ts');
const prisma = new PrismaClient();
const payments = new PaymentsService(prisma);
const bank = new BankStatementService(prisma, payments);
const recon = new TallyReconService(prisma, payments, new OpeningBalancesService(prisma));
const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const dayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const byArrival = (a, b) => dayOf(a.transDate) - dayOf(b.transDate) || a.id - b.id;
/** Made by Bank Reco: tagged with its line (new), or only by its remark (older receipts). */
const fromStatement = (r, rowId) => (r.sourceKey ? r.sourceKey === `BANK_STATEMENT_ROW:${rowId ?? r.sourceKey.split(':')[1]}` && r.sourceKey.startsWith('BANK_STATEMENT_ROW:') : /^BANK STATEMENT/i.test(r.transRemarks ?? ''));
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

(async () => {
  // 1. Short postings: a POSTED line whose own receipt is smaller than the
  //    credit, where the rest was "covered" by a receipt another line holds.
  const posted = await prisma.bankStatementRow.findMany({ where: { status: 'POSTED', note: { startsWith: 'Receipt review required:' } } });
  for (const row of posted) {
    const receipt = await prisma.acctLedger.findFirst({ where: { voucherNo: row.postedRef ?? '-', voucherType: 'RECEIPT' } });
    if (!receipt || !fromStatement(receipt, row.id) || receipt.bankCredit + 0.5 >= row.amount) continue;
    const refs = (row.note.match(/references: ([^)]*)\)/)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const heldElsewhere = [];
    for (const ref of refs) {
      const other = await prisma.bankStatementRow.findFirst({ where: { id: { not: row.id }, status: { in: ['MATCHED', 'PARTIAL', 'POSTED'] }, matchedRefs: { contains: ref } } });
      if (other) heldElsewhere.push(ref);
    }
    if (!refs.length || heldElsewhere.length !== refs.length) {
      console.log(`1. line ${row.id} ${row.customerName}: coverage not clearly double-counted — left for a person to check.`);
      continue;
    }
    await payments.editReceipt(receipt.id, {
      payMode: receipt.transMode, bankName: receipt.bankName, chequeNo: receipt.chequeNo, cashTransLocation: receipt.cashTransLocation,
      cashRecBy: receipt.cashRecBy, receiptAmt: row.amount, recDate: ymd(receipt.transDate), remarks: receipt.transRemarks,
    }, 'bank-fix');
    console.log(`1. ${row.customerName} ${ymd(row.txnDate)}: ${receipt.voucherNo} ${inr(receipt.bankCredit)} -> ${inr(row.amount)} (the rest was ${heldElsewhere.join(', ')}, which pays another line).`);
  }

  // 2. SRI MURUGAN: move the two bank receipts to the party Tally books them to.
  const from = await prisma.customer.findFirst({ where: { partyName: 'SRI MURUGAN METAL' } });
  const to = await prisma.customer.findFirst({ where: { partyName: 'SRI MURUGAN METAL (K.S.GUNASEKARAN)' } });
  if (from && to) {
    const moving = (await prisma.acctLedger.findMany({ where: { custId: from.id, voucherType: 'RECEIPT' } })).filter((r) => fromStatement(r));
    if (moving.length) {
      await prisma.$transaction(async (tx) => {
        const fromChain = await tx.acctLedger.findMany({ where: { custId: from.id, voucherType: 'RECEIPT' } });
        const toChain = await tx.acctLedger.findMany({ where: { custId: to.id, voucherType: 'RECEIPT' } });
        const all = [...fromChain, ...toChain];
        const claims = await payments.claimsOf(tx, all);
        await payments.reverseChain(tx, [...all].sort((a, b) => a.id - b.id));
        const moved = new Set(moving.map((m) => m.voucherNo));
        const stay = fromChain.filter((r) => !moved.has(r.voucherNo)).sort(byArrival);
        const into = [...toChain, ...fromChain.filter((r) => moved.has(r.voucherNo)).map((r) => ({ ...r, custId: to.id, customerName: to.partyName }))].sort(byArrival);
        await payments.replayInOrder(tx, stay, claims);
        await payments.replayInOrder(tx, into, claims);
        await tx.bankStatementRow.updateMany({ where: { postedRef: { in: [...moved] }, customerId: from.id }, data: { customerId: to.id, customerName: to.partyName } });
        await payments.applyOnAccount(tx, to.id);
      }, { timeout: 300_000, maxWait: 60_000 });
      console.log(`2. ${moving.map((m) => `${m.voucherNo} ${inr(m.bankCredit)}`).join(', ')} moved from "${from.partyName}" to "${to.partyName}".`);
    } else console.log('2. SRI MURUGAN: nothing left to move.');
  }

  // Re-match every statement, then show what is still off.
  for (const run of await prisma.bankStatementRun.findMany({ select: { id: true } })) await bank.rematch(run.id);
  const review = await prisma.bankStatementRow.count({ where: { note: { startsWith: 'Receipt review required:' } } });
  const short = (await prisma.bankStatementRow.findMany({ where: { status: 'POSTED' } })).length;
  console.log(`\nBank Reco after re-match: lines still marked "Receipt review required": ${review} (of ${short} posted lines).`);
  const run = await prisma.tallyReconRun.findFirst({ where: { registerJson: { not: null } }, orderBy: { uploadedAt: 'desc' } });
  if (run) {
    const res = await recon.rerun(run.id, 'bank-fix');
    for (const name of ['MINAL METAL', 'HIRAN BROTHERS', 'SRI MURUGAN METAL (K.S.GUNASEKARAN)']) {
      const b = res.balances.find((x) => x.customerName === name);
      if (b) console.log(`Tally vs OMS ${name}: Tally ${inr(b.tallyClosing)} | OMS ${inr(b.omsClosing)} | diff ${inr(b.difference)}`);
    }
    if (!apply) console.log('(The Tally report was re-run on the copy only.)');
  }

  await prisma.$disconnect();
  if (!apply && !process.argv.includes('--keep')) fs.rmSync(target, { force: true });
  else if (!apply) console.log(`Copy kept: ${target}`);
  console.log(apply ? '\nAPPLIED to the live database.' : '\nDry run on a copy — live data untouched.');
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
