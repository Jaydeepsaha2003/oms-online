// Undo three "Match opening" clicks that hid a receipt problem, and fix the
// receipts instead. In each, one OMS receipt dated in April holds money Tally
// has BEFORE 1-Apr, so OMS's opening looked too high:
//   VIJAY   RN/373 ₹9,00,000 (02/04) = ₹4,00,000 that day (bank + Tally) + ₹5,00,000 earlier
//   VINAYAK RN/379 ₹3,36,638 (22/04) = ₹89,770 that day (bank + Tally) + ₹2,46,868 earlier
//   CHARBHUJA — opening only put back; RN/427 is for a person to decide.
// The receipt is split: it keeps its number for the in-April part, and a new
// receipt carries the earlier money on EARLY_DATE (edit it later if known).
//
//   node scripts/fix-openings-2026-09-24.cjs           dry run on a COPY
//   node scripts/fix-openings-2026-09-24.cjs --apply   backup, then live
const fs = require('node:fs');
const path = require('node:path');

const EARLY_DATE = '2026-03-31';
const root = path.resolve(__dirname, '..');
const live = path.join(root, 'apps/api/prisma/dev.db');
const apply = process.argv.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
let target = live;
if (apply) {
  const backup = path.join(root, 'backups', `pre-openfix2-${stamp}.db`);
  fs.copyFileSync(live, backup);
  console.log(`Backup: ${backup}`);
} else {
  target = path.join(root, 'backups', `openfix2-dryrun-${stamp}.db`);
  fs.copyFileSync(live, target);
}
process.env.DATABASE_URL = `file:${target.split(path.sep).join('/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { PaymentsService } = require('../apps/api/src/payments/payments.service.ts');
const { OpeningBalancesService } = require('../apps/api/src/opening-balances/opening-balances.service.ts');
const { BankStatementService } = require('../apps/api/src/bank-statement/bank-statement.service.ts');
const { TallyReconService } = require('../apps/api/src/tally-recon/tally-recon.service.ts');
const prisma = new PrismaClient();
const payments = new PaymentsService(prisma);
const openings = new OpeningBalancesService(prisma, payments);
const bank = new BankStatementService(prisma, payments);
const recon = new TallyReconService(prisma, payments, openings);
const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The opening each party had before the wrong match (from the 23-Sep backup). */
const PUT_BACK = [
  { party: 'VIJAY VALLABH METALS', drCr: 'DEBIT', bankAmt: 56045 },
  { party: 'VINAYAK STEEL', drCr: 'DEBIT', bankAmt: 23499 },
  { party: 'SHREE CHARBHUJA METAL', drCr: 'DEBIT', bankAmt: 2825 },
];
const SPLIT = [
  { party: 'VIJAY VALLABH METALS', voucherNo: 'RN/373', keep: 400000 },
  { party: 'VINAYAK STEEL', voucherNo: 'RN/379', keep: 89770 },
];

(async () => {
  for (const f of PUT_BACK) {
    const c = await prisma.customer.findFirst({ where: { partyName: f.party } });
    const o = await prisma.acctOpeningTrans.findFirst({ where: { custId: c.id, kind: 'OPENING' } });
    if (!o) { console.log(`${f.party}: no opening row — skipped.`); continue; }
    if (o.drCr === f.drCr && Math.abs(o.bankAmt - f.bankAmt) < 0.5) { console.log(`${f.party}: opening already ${f.drCr} ${inr(f.bankAmt)}.`); continue; }
    await openings.update(o.id, { customerId: c.id, transDate: ymd(o.transDate), bankAmt: f.bankAmt, cashAmt: o.cashAmt, drCr: f.drCr, remarks: o.remarks });
    console.log(`${f.party}: opening ${o.drCr} ${inr(o.bankAmt)} -> ${f.drCr} ${inr(f.bankAmt)} (put back).`);
  }

  for (const s of SPLIT) {
    const r = await prisma.acctLedger.findFirst({ where: { voucherNo: s.voucherNo, voucherType: 'RECEIPT' } });
    const early = Math.round((r.bankCredit - s.keep) * 100) / 100;
    if (early <= 0.5) { console.log(`${s.voucherNo}: already ${inr(r.bankCredit)} — nothing to split.`); continue; }
    await payments.editReceipt(r.id, {
      payMode: r.transMode, bankName: r.bankName, chequeNo: r.chequeNo, cashTransLocation: r.cashTransLocation,
      cashRecBy: r.cashRecBy, receiptAmt: s.keep, recDate: ymd(r.transDate), remarks: r.transRemarks,
    }, 'opening-fix');
    const added = await payments.save({
      takeAccOn: 'PARTY', customerId: r.custId, payMode: r.transMode, bankName: r.bankName || 'AXIS BANK', adjMode: 'AUTOMATIC',
      receiptAmt: early, recDate: EARLY_DATE, remarks: `ADVANCE RECEIVED BEFORE 01/04/2026 — SPLIT FROM ${s.voucherNo} (AS PER TALLY)`,
    }, 'opening-fix', undefined, `SPLIT_OF:${s.voucherNo}`);
    console.log(`${s.party}: ${s.voucherNo} ${inr(r.bankCredit)} -> ${inr(s.keep)} on ${ymd(r.transDate)}, and ${added.voucherNo} ${inr(early)} on ${EARLY_DATE}.`);
  }

  for (const run of await prisma.bankStatementRun.findMany({ select: { id: true } })) await bank.rematch(run.id);
  const run = await prisma.tallyReconRun.findFirst({ where: { registerJson: { not: null } }, orderBy: { uploadedAt: 'desc' } });
  const res = await recon.rerun(run.id, 'opening-fix');
  console.log('');
  for (const f of PUT_BACK) {
    const b = res.balances.find((x) => x.customerName === f.party);
    if (b) console.log(`Tally vs OMS ${f.party}: opening ${inr(b.tallyOpening)} / ${inr(b.omsOpening)} | closing ${inr(b.tallyClosing)} / ${inr(b.omsClosing)} | diff ${inr(b.difference)}`);
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
