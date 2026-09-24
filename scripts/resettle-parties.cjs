// Re-settle named parties' receipts by today's rules — after an opening balance
// was changed under receipts that had already cleared it (Tally Recon's old
// "Match opening" did not do this itself; the new one does).
// Does not change what any party owes; only which bills / opening look paid.
//
//   node scripts/resettle-parties.cjs "PARTY NAME" ["PARTY NAME" ...]            dry run on a COPY
//   node scripts/resettle-parties.cjs "PARTY NAME" ["PARTY NAME" ...] --apply    backup, then live
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const live = path.join(root, 'apps/api/prisma/dev.db');
const apply = process.argv.includes('--apply');
const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!names.length) {
  console.log('Name at least one party.');
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
let target = live;
if (apply) {
  const backup = path.join(root, 'backups', `pre-resettle-${stamp}.db`);
  fs.copyFileSync(live, backup);
  console.log(`Backup: ${backup}`);
} else {
  target = path.join(root, 'backups', `resettle-dryrun-${stamp}.db`);
  fs.copyFileSync(live, target);
}
process.env.DATABASE_URL = `file:${target.split(path.sep).join('/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { PaymentsService } = require('../apps/api/src/payments/payments.service.ts');
const prisma = new PrismaClient();
const payments = new PaymentsService(prisma);

(async () => {
  for (const name of names) {
    const c = await prisma.customer.findFirst({ where: { partyName: name.trim() }, select: { id: true, partyName: true } });
    if (!c) {
      console.log(`${name}: no such party — skipped.`);
      continue;
    }
    await prisma.$transaction((tx) => payments.resettleParty(tx, c.id), { timeout: 300_000, maxWait: 60_000 });
    console.log(`${c.partyName}: re-settled.`);
  }
  await prisma.$disconnect();
  if (!apply && !process.argv.includes('--keep')) fs.rmSync(target, { force: true });
  else if (!apply) console.log(`Copy kept: ${target}`);
  console.log(apply ? 'APPLIED to the live database.' : 'Dry run on a copy — live data untouched.');
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
