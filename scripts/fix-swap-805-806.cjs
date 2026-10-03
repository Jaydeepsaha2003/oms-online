/*
 * One-off (2026-10-03): Tally numbered MANOHAR's bill SSS-805 (it posted OMS 806 while 805/AMBIKA was not in Tally, and Sales numbering in
 * Tally is automatic). Its e-invoice exists, so the number cannot change: OMS follows Tally - the two challans swap numbers, so
 * 805 = MANOHAR (already in Tally) and 806 = AMBIKA (the next one Tally will hand out).
 *
 *   node scripts/fix-swap-805-806.cjs            dry run: shows before/after, changes nothing
 *   node scripts/fix-swap-805-806.cjs --apply    backup, then the swap in ONE transaction
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();
const show = async (db, label) => {
  const rows = await db.challan.findMany({ where: { id: { in: [2260, 2261] } }, orderBy: { id: 'asc' }, select: { id: true, code: true, customerName: true, total: true, tallyVoucher: { select: { id: true, status: true, source: true, vchNo: true, partyLedger: true, amount: true, recon: true } } } });
  console.log(label); for (const r of rows) console.log('  ', JSON.stringify(r));
};
const fail = (m) => { throw new Error('PRECONDITION: ' + m); };

(async () => {
  await show(prisma, 'BEFORE');
  if (apply) require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'backup-db.cjs')], { stdio: 'inherit' });
  try {
    await prisma.$transaction(async (tx) => {
      const a = await tx.challan.findUnique({ where: { id: 2260 }, select: { code: true, customerName: true, tallyVoucher: true } });
      const m = await tx.challan.findUnique({ where: { id: 2261 }, select: { code: true, customerName: true, tallyVoucher: true } });
      if (a?.code !== 'SSS/26-27/805' || a.customerName !== 'AMBIKA METAL') fail('2260 is not AMBIKA SSS/26-27/805');
      if (m?.code !== 'SSS/26-27/806' || m.customerName !== 'MANOHAR METAL CORPORATION') fail('2261 is not MANOHAR SSS/26-27/806');
      const A = a.tallyVoucher, B = m.tallyVoucher;
      if (!A || A.status !== 'POSTED' || A.vchNo !== 'SSS-805/26-27' || A.partyLedger !== 'MANOHAR METAL CORPORATION') fail('the Tally link on 805 is not MANOHAR\'s voucher');
      if (!B || B.status !== 'NOT_POSTED' || B.vchNo) fail('806 already has a Tally link');
      const log = await tx.tallyPostLog.findFirst({ where: { challanId: 2261, outcome: 'POSTED' }, orderBy: { id: 'desc' } });
      if (!log) fail('no POSTED log for 806');

      await tx.challan.update({ where: { id: 2260 }, data: { code: 'SSS/26-27/805-TMP' } });
      await tx.challan.update({ where: { id: 2261 }, data: { code: 'SSS/26-27/805' } });
      await tx.challan.update({ where: { id: 2260 }, data: { code: 'SSS/26-27/806' } });
      // the Tally link follows the voucher: MANOHAR's row (was on 2260) moves to 2261, the empty row to 2260
      await tx.tallyVoucher.update({ where: { id: A.id }, data: { challanId: null } });
      await tx.tallyVoucher.update({ where: { id: B.id }, data: { challanId: 2260 } });
      await tx.tallyVoucher.update({ where: { id: A.id }, data: { challanId: 2261, source: 'OMS', postedBy: log.userName, postedAt: log.finishedAt, recon: 'OK', reconNote: null } });
      await tx.tallyPostLog.update({ where: { id: log.id }, data: { code: 'SSS/26-27/805' } });
      await show(tx, 'AFTER');
      if (!apply) throw new Error('DRY-RUN-ROLLBACK');
    });
    console.log('APPLIED.');
  } catch (e) {
    if (e.message === 'DRY-RUN-ROLLBACK') console.log('\nDry run only - rolled back, nothing changed. Add --apply to do it.');
    else { console.log('\nSTOPPED:', e.message, '\nNothing changed.'); process.exitCode = 1; }
  }
  await prisma.$disconnect();
})();
