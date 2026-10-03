/*
 * One-off (2026-10-03), the owner's answers after the transporter audit (OMS vs what Tally carried):
 *   SHREE CHARBHUJA METAL, UMIYA METAL, UTTAM METAL, K K TRADING CO. -> HANDKART;  ANIL METAL -> SELF;  BAPU STEEL -> DADAR (new transporter);
 *   DIN BANDHU METAL MART stays SK TRANSPORT;  UMRAO SINGH OM PRAKASH: a note shown when its bill is posted (app_config TALLY_BILL_NOTES).
 *   node scripts/fix-transporters-2026-10-03.cjs            dry run (rolled back)
 *   node scripts/fix-transporters-2026-10-03.cjs --apply    backup, then ONE transaction
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();
const PLAN = [
  ['SHREE CHARBHUJA METAL', 'SELF', 'HANDKART'], ['UMIYA METAL', 'SELF', 'HANDKART'], ['UTTAM METAL', 'SELF', 'HANDKART'], ['K K TRADING CO.', 'SELF', 'HANDKART'],
  ['ANIL METAL', 'SK TRANSPORT', 'SELF'], ['BAPU STEEL', 'MAHIPAL TRANSPORT', 'DADAR'],
];
const NOTE = ['UMRAO SINGH OM PRAKASH', 'Transporter DRC TRANSPORT hai; Tally ke purane bill (May) par DELHI RAJASTHAN TRANSPORTS tha - transporter sahi hai ya nahi, dekh lo.'];

(async () => {
  if (apply) require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'backup-db.cjs')], { stdio: 'inherit' });
  try {
    await prisma.$transaction(async (tx) => {
      for (const name of ['HANDKART', 'SELF']) if (!(await tx.transporter.findUnique({ where: { name } }))) throw new Error('PRECONDITION: no transporter ' + name);
      const tr = new Map();
      for (const n of ['HANDKART', 'SELF', 'DADAR']) {
        let t = await tx.transporter.findUnique({ where: { name: n } });
        if (!t) { t = await tx.transporter.create({ data: { name: n } }); console.log('created transporter', n, 'id', t.id); }
        tr.set(n, t);
      }
      for (const [party, from, to] of PLAN) {
        const c = await tx.customer.findFirst({ where: { partyName: party }, select: { id: true, transportName: true } });
        if (!c || c.transportName !== from) throw new Error(`PRECONDITION: ${party} is "${c?.transportName}", expected "${from}"`);
        await tx.customer.update({ where: { id: c.id }, data: { transportName: to, transporterId: tr.get(to).id } });
        console.log(`  ${party}: ${from} -> ${to}`);
      }
      const row = await tx.appConfig.findUnique({ where: { key: 'TALLY_BILL_NOTES' } });
      const notes = row ? JSON.parse(row.value) : {};
      notes[NOTE[0]] = NOTE[1];
      await tx.appConfig.upsert({ where: { key: 'TALLY_BILL_NOTES' }, create: { key: 'TALLY_BILL_NOTES', value: JSON.stringify(notes) }, update: { value: JSON.stringify(notes) } });
      console.log('  note for', NOTE[0]);
      if (!apply) throw new Error('DRY-RUN-ROLLBACK');
    });
    console.log('APPLIED.');
  } catch (e) {
    if (e.message === 'DRY-RUN-ROLLBACK') console.log('\nDry run only - rolled back. Add --apply.');
    else { console.log('\nSTOPPED:', e.message, '\nNothing changed.'); process.exitCode = 1; }
  }
  await prisma.$disconnect();
})();
