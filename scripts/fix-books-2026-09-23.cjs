// Book fixes from the 23-09-2026 deep check (scripts/check-books-deep.cjs).
// None of 1–5 changes what any party owes; they correct which bills look paid.
//
//  1. Settlement pointing at something that does not exist (old import renumbered
//     it): opening cleared by a missing receipt, bill paid from missing money on
//     account (SUMTI ADV-2025-0008 ₹13,525).
//  2. One party's money on account used on another party's bill
//     (VIJAY VALLABH's ₹81,746 on SANCHETI's SSS/26-27/325).
//  3. Opening cleared for more than the opening (VIJAY cash ₹1,13,257, no cash opening).
//  4. Credit note in the accounts but never applied to any bill.
//  5. Credit opening (party's money held from day one) never used on bills
//     (MINAL ₹3,696, BALAJI ₹63,420) — now money on account; applied here.
//  6. Tally opening balance missing in OMS, for parties whose Tally ledger has
//     nothing but that opening and OMS has no bills or receipts. This one DOES
//     change what they owe — to Tally's figure.
//
//   node scripts/fix-books-2026-09-23.cjs           dry run on a COPY
//   node scripts/fix-books-2026-09-23.cjs --apply   backup, then live
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
process.env.DATABASE_URL = `file:${target.split(path.sep).join('/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { PaymentsService } = require('../apps/api/src/payments/payments.service.ts');
const { NotesService } = require('../apps/api/src/notes/notes.service.ts');
const { TallyReconService } = require('../apps/api/src/tally-recon/tally-recon.service.ts');
const { OpeningBalancesService } = require('../apps/api/src/opening-balances/opening-balances.service.ts');
const prisma = new PrismaClient();
const payments = new PaymentsService(prisma);
const notes = new NotesService(prisma, {});
const recon = new TallyReconService(prisma, payments, new OpeningBalancesService(prisma));
const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const dayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const byArrival = (a, b) => dayOf(a.transDate) - dayOf(b.transDate) || a.id - b.id;
const OPN = 'ADV-OPN-';

/** What a party owes (only OPENING rows and real documents count). */
async function owes(custId) {
  const [open, bills, cns, recs, disc] = await Promise.all([
    prisma.acctOpeningTrans.findMany({ where: { custId, kind: 'OPENING' } }),
    prisma.challan.findMany({ where: { customerId: custId, challanStatus: 'CONFIRMED' }, select: { b: true, c: true } }),
    prisma.acctLedger.findMany({ where: { custId, voucherType: { in: ['CREDIT NOTE', 'PURCHASE'] } }, select: { bankCredit: true, cashCredit: true } }).then((r) => r.map((x) => ({ b: x.bankCredit, c: x.cashCredit }))),
    prisma.acctLedger.findMany({ where: { custId, voucherType: 'RECEIPT' }, select: { bankCredit: true, cashCredit: true } }),
    prisma.acctPartyDiscount.findMany({ where: { custId }, select: { disAmt: true } }),
  ]);
  const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
  return Math.round(
    sum(open, (o) => (o.drCr === 'CREDIT' ? -1 : 1) * (o.bankAmt + o.cashAmt)) + sum(bills, (b) => (b.b ?? 0) + (b.c ?? 0)) -
      sum(cns, (n) => (n.b ?? 0) + (n.c ?? 0)) - sum(recs, (r) => r.bankCredit + r.cashCredit) - sum(disc, (d) => d.disAmt),
  );
}

/** Re-run every receipt of a party by today's rules, then use its money on account. */
async function resettle(tx, custId) {
  const rows = await tx.acctLedger.findMany({ where: { voucherType: 'RECEIPT', custId } });
  const arrival = [...rows].sort(byArrival);
  const claims = await payments.claimsOf(tx, arrival);
  await payments.reverseChain(tx, [...rows].sort((a, b) => a.id - b.id));
  const entries = arrival.map((r) => ({ voucherNo: r.voucherNo, transDate: r.transDate, adjMode: r.adjMode ?? '', payMode: r.transMode, amount: r.bankCredit || r.cashCredit }));
  await payments.claimExact(tx, custId, null, entries, claims);
  await payments.replayInOrder(tx, arrival, claims);
  await payments.applyOnAccount(tx, custId);
}

(async () => {
  const touched = new Set();
  const log = [];

  // 1 + 2. Settlements pointing at nothing / at another party's money.
  const known = new Set([
    ...(await prisma.acctLedger.findMany({ select: { voucherNo: true } })).map((v) => v.voucherNo),
    ...(await prisma.creditNote.findMany({ select: { code: true } })).map((c) => c.code),
    ...(await prisma.challan.findMany({ select: { code: true } })).map((c) => c.code),
  ]);
  const advs = await prisma.acctPartyAdvance.findMany();
  const advById = new Map(advs.map((a) => [a.refId, a]));
  const creditOpenings = await prisma.acctOpeningTrans.findMany({ where: { kind: 'OPENING', drCr: 'CREDIT' } });
  for (const o of creditOpenings) advById.set(`${OPN}${o.id}`, { custId: o.custId, takeAccOn: 'PARTY' });
  const billParty = new Map((await prisma.challan.findMany({ select: { code: true, customerId: true } })).map((c) => [c.code, c.customerId]));

  const dropClear = (await prisma.acctOpeningTrans.findMany({ where: { kind: 'CLEARANCE' } })).filter(
    (o) => !(o.refRecId && known.has(o.refRecId)) && !(o.sourceVoucherNo && known.has(o.sourceVoucherNo)),
  );
  for (const o of dropClear) { log.push(`1. ${o.customerName}: opening cleared ${inr(o.bankAmt + o.cashAmt)} by ${o.refRecId} — no such receipt; removed.`); touched.add(o.custId); }

  const dropAlloc = [];
  for (const a of await prisma.acctPaymentReceipt.findMany({ where: { refRecId: { startsWith: 'ADV' } } })) {
    const adv = advById.get(a.refRecId);
    const billCust = billParty.get(a.invNo);
    if (!adv) {
      dropAlloc.push(a.id);
      log.push(`1. ${a.customerName}: ${a.invNo} paid ${inr(a.recAmt)} from ${a.refRecId} — no such money on account; removed.`);
      touched.add(a.custId);
    } else if (adv.takeAccOn !== 'AGENT' && adv.custId && billCust && adv.custId !== billCust) {
      dropAlloc.push(a.id);
      log.push(`2. ${a.invNo} (${a.customerName}) paid ${inr(a.recAmt)} from ${adv.customerName}'s money on account (${a.refRecId}); removed — that money goes back to ${adv.customerName}.`);
      touched.add(billCust);
      touched.add(adv.custId);
    }
  }

  // 3. Opening cleared beyond the opening, per side: trim the newest clearances.
  const trim = []; // { id, newBank, newCash } or delete (both 0)
  const clearances = (await prisma.acctOpeningTrans.findMany({ where: { kind: 'CLEARANCE' } })).filter((o) => !dropClear.some((d) => d.id === o.id));
  const byParty = new Map();
  for (const o of clearances) byParty.set(o.custId, [...(byParty.get(o.custId) ?? []), o]);
  for (const [custId, rows] of byParty) {
    const opens = await prisma.acctOpeningTrans.findMany({ where: { custId, kind: 'OPENING', drCr: 'DEBIT' } });
    for (const side of ['bankAmt', 'cashAmt']) {
      let extra = rows.reduce((s, r) => s + r[side], 0) - opens.reduce((s, r) => s + r[side], 0);
      if (extra <= 1) continue;
      log.push(`3. ${rows[0].customerName}: ${side === 'bankAmt' ? 'bank' : 'cash'} opening cleared ${inr(extra)} more than it was; removed.`);
      touched.add(custId);
      for (const r of [...rows].sort((a, b) => +b.transDate - +a.transDate || b.id - a.id)) {
        if (extra <= 0.005 || r[side] <= 0) continue;
        const cut = Math.min(r[side], extra);
        extra -= cut;
        trim.push({ id: r.id, side, cut });
      }
    }
  }

  // 4. Credit notes whose money went nowhere.
  const unapplied = [];
  for (const n of await prisma.creditNote.findMany({ include: { items: { orderBy: { id: 'asc' } } } })) {
    if (!n.customerId) continue;
    const [bills, open, parked] = await Promise.all([
      prisma.acctPaymentReceipt.aggregate({ where: { refRecId: n.code }, _sum: { recAmt: true } }),
      prisma.acctOpeningTrans.aggregate({ where: { kind: 'CLEARANCE', refRecId: n.code }, _sum: { bankAmt: true, cashAmt: true } }),
      prisma.acctPartyAdvance.aggregate({ where: { refRecId: n.code }, _sum: { bankAmt: true, cashAmt: true } }),
    ]);
    const placed = (bills._sum.recAmt ?? 0) + (open._sum.bankAmt ?? 0) + (open._sum.cashAmt ?? 0) + (parked._sum.bankAmt ?? 0) + (parked._sum.cashAmt ?? 0);
    // Only a note that is in the accounts (has its ledger row) holds money to apply.
    // One without (UMIYA CN/6) was never booked — Tally does not have it either.
    const booked = await prisma.acctLedger.count({ where: { voucherNo: n.code } });
    if (!booked && placed < 1) { log.push(`4. ${n.customerName}: credit note ${n.code} ${inr((n.b ?? 0) + (n.c ?? 0))} is in OMS but not in the accounts (nor in Tally) — left alone; check if it was cancelled.`); continue; }
    if (placed < 1 && (n.b ?? 0) + (n.c ?? 0) > 1) { unapplied.push(n); touched.add(n.customerId); log.push(`4. ${n.customerName}: credit note ${n.code} ${inr((n.b ?? 0) + (n.c ?? 0))} was never applied; applied now.`); }
  }

  // 5. Credit openings: every party with one is re-settled below.
  for (const o of creditOpenings) { touched.add(o.custId); log.push(`5. ${o.customerName}: credit opening ${inr(o.bankAmt + o.cashAmt)} now counts as money on account.`); }

  const before = new Map();
  for (const id of touched) before.set(id, await owes(id));

  await prisma.$transaction(async (tx) => {
    if (dropClear.length) await tx.acctOpeningTrans.deleteMany({ where: { id: { in: dropClear.map((o) => o.id) } } });
    if (dropAlloc.length) await tx.acctPaymentReceipt.deleteMany({ where: { id: { in: dropAlloc } } });
    for (const t of trim) {
      const r = await tx.acctOpeningTrans.findUnique({ where: { id: t.id } });
      const left = { bankAmt: r.bankAmt, cashAmt: r.cashAmt, [t.side]: Math.round((r[t.side] - t.cut) * 100) / 100 };
      if (left.bankAmt <= 0.005 && left.cashAmt <= 0.005) await tx.acctOpeningTrans.delete({ where: { id: t.id } });
      else await tx.acctOpeningTrans.update({ where: { id: t.id }, data: left });
    }
  }, { timeout: 300_000, maxWait: 60_000 });
  for (const n of unapplied) {
    await notes.applyCreditNote(n.code, n.invDate, n.customerId, n.customerName, n.b ?? 0, n.c ?? 0, n.items.map((i) => ({ refInvNo: i.refInvNo ?? undefined })), 'book-fix');
  }
  for (const id of touched) await prisma.$transaction((tx) => resettle(tx, id), { timeout: 300_000, maxWait: 60_000 });

  log.forEach((l) => console.log(l));
  console.log('');
  let bad = 0;
  for (const id of touched) {
    const now = await owes(id);
    if (now !== before.get(id)) { bad++; console.log(`!! #${id}: owes ${inr(before.get(id))} -> ${inr(now)} — must not change`); }
  }
  console.log(bad ? `${bad} parties changed what they owe — DO NOT APPLY` : `Checked ${touched.size} parties: what each owes is unchanged.`);

  // 6. Openings that exist in Tally and nowhere in OMS.
  const run = await prisma.tallyReconRun.findFirst({ where: { registerJson: { not: null } }, orderBy: { uploadedAt: 'desc' }, select: { id: true } });
  if (run) {
    const rows = await prisma.tallyReconRow.findMany({ where: { runId: run.id, vchType: 'OPENING', resolvedAt: null, customerId: { not: null }, NOT: { status: 'MATCHED' } } });
    const eligible = [];
    for (const r of rows) {
      const others = await prisma.tallyReconRow.count({ where: { runId: run.id, ledgerName: r.ledgerName, NOT: { vchType: 'OPENING' } } });
      const activity = (await prisma.challan.count({ where: { customerId: r.customerId } })) + (await prisma.acctLedger.count({ where: { custId: r.customerId } }));
      const hasOpening = await prisma.acctOpeningTrans.count({ where: { custId: r.customerId, kind: 'OPENING' } });
      if (!others && !activity && !hasOpening && !r.omsAmount) eligible.push(r.id);
    }
    if (eligible.length) {
      const res = await recon.createOpenings({ rowIds: eligible }, 'book-fix');
      for (const c of res.created) console.log(`6. ${c.customerName}: opening ${inr(c.amount)} ${c.drCr} added from Tally.`);
      for (const f of res.failed) console.log(`6. row ${f.rowId}: not added — ${f.reason}`);
    } else console.log('6. No Tally-only opening to add.');
  }

  await prisma.$disconnect();
  if (!apply && !process.argv.includes('--keep')) fs.rmSync(target, { force: true });
  else if (!apply) console.log(`\nCopy kept: ${target}`);
  console.log(apply ? '\nAPPLIED to the live database.' : '\nDry run on a copy — live data untouched.');
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
