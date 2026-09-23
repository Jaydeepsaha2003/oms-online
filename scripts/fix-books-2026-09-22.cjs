// One-off book fixes agreed on 22-09-2026 (audit findings):
//  1. B KUMAR 29/05 ₹95,800 entered twice -> delete RN/537 (hand-typed); RN/869
//     stays, it is the one linked to the bank-statement line.
//  2. SUMTI MARKETING: old-import cash advance (ADV-2026-0030) applied to whole
//     bills instead of their cash part -> cap each at the bill's cash part; the
//     extra goes back on account.
//  3. Credit notes dated before the bills they settled -> date the settlement on
//     the bill date (the credit waited on account until the bill was raised).
//  4. Money waiting on account while the same party has open bills -> settle
//     them (SHREE CHARBHUJA, AMBIKA, UTTAM, VINAYAK, HINKAR, SUMTI).
//
//   node scripts/fix-books-2026-09-22.cjs           dry run on a COPY
//   node scripts/fix-books-2026-09-22.cjs --apply   backup, then the live database
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const live = path.join(root, 'apps/api/prisma/dev.db');
const apply = process.argv.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
let target = live;
if (apply) {
  const backup = path.join(root, 'backups', `pre-fix-books-${stamp}.db`);
  fs.copyFileSync(live, backup);
  console.log(`Backup: ${backup}`);
} else {
  target = path.join(root, 'backups', `fix-books-dryrun-${stamp}.db`);
  fs.copyFileSync(live, target);
}
process.env.DATABASE_URL = `file:${target.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { PaymentsService } = require('../apps/api/src/payments/payments.service.ts');
const prisma = new PrismaClient();
const svc = new PaymentsService(prisma);
const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const fmt = (d) => d.toLocaleDateString('en-GB');

/** Open (unpaid) amount of a party's bills, bank and cash. */
async function open(custId) {
  const bills = await prisma.challan.findMany({ where: { customerId: custId, challanStatus: 'CONFIRMED' }, select: { code: true, b: true, c: true } });
  const paid = await prisma.acctPaymentReceipt.findMany({ where: { invNo: { in: bills.map((b) => b.code) } }, select: { invNo: true, recAmt: true, payMode: true } });
  const disc = await prisma.acctPartyDiscount.findMany({ where: { invNo: { in: bills.map((b) => b.code) } }, select: { invNo: true, disAmt: true, billType: true } });
  let bank = 0, cash = 0;
  for (const b of bills) {
    const pb = paid.filter((p) => p.invNo === b.code && p.payMode !== 'CASH').reduce((s, p) => s + p.recAmt, 0) + disc.filter((d) => d.invNo === b.code && d.billType === 'BANK').reduce((s, d) => s + d.disAmt, 0);
    const pc = paid.filter((p) => p.invNo === b.code && p.payMode === 'CASH').reduce((s, p) => s + p.recAmt, 0) + disc.filter((d) => d.invNo === b.code && d.billType !== 'BANK').reduce((s, d) => s + d.disAmt, 0);
    bank += Math.max(0, (b.b ?? 0) - pb);
    cash += Math.max(0, (b.c ?? 0) - pc);
  }
  return { bank, cash };
}

(async () => {
  // 1. B KUMAR duplicate.
  const dup = await prisma.acctLedger.findFirst({ where: { voucherNo: 'RN/537', voucherType: 'RECEIPT' } });
  if (dup && Math.abs(dup.bankCredit - 95800) < 1 && (await prisma.acctLedger.count({ where: { voucherNo: 'RN/869' } }))) {
    const res = await svc.deleteReceipt(dup.id);
    console.log(`1. Deleted RN/537 (B KUMAR ${inr(95800)}, 29/05); ${res.replayedCount} later B KUMAR receipts re-settled. RN/869 stays.`);
  } else console.log('1. RN/537 not found as expected — skipped.');

  // 2. SUMTI cash advance capped at each bill's cash part.
  await prisma.$transaction(async (tx) => {
    for (const code of ['SSS/26-27/200', 'SSS/26-27/263']) {
      const bill = await tx.challan.findUnique({ where: { code }, select: { c: true } });
      const row = await tx.acctPaymentReceipt.findFirst({ where: { invNo: code, refRecId: 'ADV-2026-0030', payMode: 'CASH' } });
      if (!bill || !row || row.recAmt <= (bill.c ?? 0) + 0.5) { console.log(`2. ${code}: nothing to cap — skipped.`); continue; }
      await tx.acctPaymentReceipt.update({ where: { id: row.id }, data: { recAmt: bill.c ?? 0 } });
      console.log(`2. ${code}: cash settled ${inr(row.recAmt)} -> ${inr(bill.c ?? 0)} (its cash part); ${inr(row.recAmt - (bill.c ?? 0))} back on account.`);
    }
  });

  // 3. Credit notes: settlement dated on the bill.
  const cnRows = await prisma.acctPaymentReceipt.findMany({ where: { recType: 'CREDIT NOTE' } });
  const bills = new Map((await prisma.challan.findMany({ where: { code: { in: cnRows.map((r) => r.invNo) } }, select: { code: true, invDate: true } })).map((c) => [c.code, c.invDate]));
  for (const r of cnRows) {
    const billDate = bills.get(r.invNo);
    const dayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (!billDate || dayOf(billDate) <= dayOf(r.recDate)) continue;
    await prisma.acctPaymentReceipt.update({ where: { id: r.id }, data: { recDate: billDate } });
    console.log(`3. ${r.refRecId} on ${r.invNo}: settlement date ${fmt(r.recDate)} -> ${fmt(billDate)} (bill date), ${inr(r.recAmt)}.`);
  }

  // 4. Money on account settles open bills.
  for (const name of ['SHREE CHARBHUJA METAL', 'AMBIKA METAL', 'UTTAM METAL', 'VINAYAK STEEL', 'HINKAR STEELS', 'SUMTI MARKETING']) {
    const c = await prisma.customer.findFirst({ where: { partyName: name }, select: { id: true } });
    if (!c) { console.log(`4. ${name}: party not found — skipped.`); continue; }
    const before = await open(c.id);
    await prisma.$transaction((tx) => svc.applyOnAccount(tx, c.id));
    const after = await open(c.id);
    console.log(`4. ${name}: open bills bank ${inr(before.bank)} -> ${inr(after.bank)}, cash ${inr(before.cash)} -> ${inr(after.cash)}`);
  }

  await prisma.$disconnect();
  if (!apply && !process.argv.includes('--keep')) fs.rmSync(target, { force: true });
  else if (!apply) console.log(`Copy kept for checking: ${target}`);
  console.log(apply ? '\nAPPLIED to the live database.' : '\nDry run on a copy — live data untouched. Add --apply to do it for real.');
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
