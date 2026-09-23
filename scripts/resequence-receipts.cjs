// One-time repair: re-settle every party's receipts by today's rules (see
// PaymentsService): in the order the money arrived, an exact amount keeping the
// bills it names, and money left on account settling newer bills. New entries
// already settle that way; this fixes the ones saved before those rules existed.
//
//   node scripts/resequence-receipts.cjs           dry run on a COPY -> review list
//   node scripts/resequence-receipts.cjs --apply   backup, then the live database
//   --skip="PARTY NAME"                            leave that party as it is (repeatable)
//
// Both write backups/resequence-review-<time>.csv: one line per bill whose
// paying receipt changes. Each party is its own transaction, so a party that
// cannot be re-settled is left exactly as it was and reported.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const live = path.join(root, 'apps/api/prisma/dev.db');
const apply = process.argv.includes('--apply');
const skip = new Set(process.argv.filter((a) => a.startsWith('--skip=')).map((a) => a.slice(7).trim().toUpperCase()));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
fs.mkdirSync(path.join(root, 'backups'), { recursive: true });

let target = live;
if (apply) {
  const backup = path.join(root, 'backups', `pre-resequence-${stamp}.db`);
  fs.copyFileSync(live, backup);
  console.log(`Backup: ${backup}`);
} else {
  target = path.join(root, 'backups', `resequence-dryrun-${stamp}.db`);
  // --from=<copy> dry-runs on top of an earlier dry run (a second pass must change nothing).
  fs.copyFileSync(process.argv.find((a) => a.startsWith('--from='))?.slice(7) ?? live, target);
}
process.env.DATABASE_URL = `file:${target.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { PaymentsService } = require('../apps/api/src/payments/payments.service.ts');
const prisma = new PrismaClient();
const svc = new PaymentsService(prisma);

const r2 = (x) => Math.round(x * 100) / 100;
const dayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const byArrival = (a, b) => dayOf(a.transDate) - dayOf(b.transDate) || a.id - b.id;
const fmt = (d) => d.toLocaleDateString('en-GB');

/** bill -> "RN/5 (04/01/2026) 100" list of what pays it, receipt-funded or on-account-funded. */
async function payers(custIds) {
  const rows = await prisma.acctPaymentReceipt.findMany({ where: { custId: { in: custIds }, recType: 'RECEIPT' } });
  const vouchers = new Map((await prisma.acctLedger.findMany({ where: { voucherType: 'RECEIPT' }, select: { voucherNo: true, transDate: true } })).map((v) => [v.voucherNo, v]));
  const out = new Map();
  for (const r of rows) {
    const v = vouchers.get(r.sourceVoucherNo ?? r.refRecId);
    if (!v) continue; // credit notes and the like are not re-settled
    const m = out.get(r.invNo) ?? out.set(r.invNo, new Map()).get(r.invNo);
    const key = `${v.voucherNo} (${fmt(v.transDate)})`;
    m.set(key, r2((m.get(key) ?? 0) + r.recAmt));
  }
  return new Map([...out].map(([inv, m]) => [inv, [...m].map(([k, a]) => `${k} ${a}`).sort().join(' + ')]));
}

(async () => {
  const all = await prisma.acctLedger.findMany({ where: { voucherType: 'RECEIPT' } });
  const chains = new Map();
  for (const r of all) {
    const k = r.custId !== 0 ? `c${r.custId}` : `a${r.agentName}`;
    (chains.get(k) ?? chains.set(k, []).get(k)).push(r);
  }
  const lines = [['Party', 'Bill', 'Bill date', 'Bill amount', 'Paid by now', 'Paid by after re-settle'].join(',')];
  const csv = (s) => `"${String(s ?? '').replaceAll('"', '""')}"`;
  let done = 0;
  const failed = [];
  for (const rows of chains.values()) {
    const typed = [...rows].sort((a, b) => a.id - b.id);
    const arrival = [...rows].sort(byArrival);
    const head = rows[0];
    if (skip.has((head.customerName ?? '').trim().toUpperCase())) {
      failed.push(`${head.customerName}: skipped on request`);
      continue;
    }
    const custIds = head.custId !== 0
      ? [head.custId]
      : (await prisma.customer.findMany({ where: { agentName: head.agentName }, select: { id: true } })).map((c) => c.id);
    const before = await payers(custIds);
    try {
      await prisma.$transaction(async (tx) => {
        if (rows.some((r) => r.adjMode == null)) throw new Error('has a receipt saved before edit support');
        const claims = await svc.claimsOf(tx, arrival);
        await svc.reverseChain(tx, typed);
        const entries = arrival.map((r) => ({ voucherNo: r.voucherNo, transDate: r.transDate, adjMode: r.adjMode ?? '', payMode: r.transMode, amount: r.bankCredit || r.cashCredit }));
        await svc.claimExact(tx, head.custId, head.agentName, entries, claims);
        await svc.replayInOrder(tx, arrival, claims);
        await svc.applyOnAccount(tx, head.custId);
        // Every rupee received must still sit somewhere: on a bill, on the
        // opening balance, or on account. Otherwise this party rolls back.
        const vouchers = rows.map((r) => r.voucherNo);
        const received = r2(rows.reduce((s, r) => s + r.bankCredit + r.cashCredit, 0));
        const [bills, opening, onAccount] = await Promise.all([
          tx.acctPaymentReceipt.aggregate({ where: { refRecId: { in: vouchers } }, _sum: { recAmt: true } }),
          tx.acctOpeningTrans.aggregate({ where: { kind: 'CLEARANCE', refRecId: { in: vouchers } }, _sum: { bankAmt: true, cashAmt: true } }),
          tx.acctPartyAdvance.aggregate({ where: { refRecId: { in: vouchers } }, _sum: { bankAmt: true, cashAmt: true } }),
        ]);
        const placed = r2((bills._sum.recAmt ?? 0) + (opening._sum.bankAmt ?? 0) + (opening._sum.cashAmt ?? 0) + (onAccount._sum.bankAmt ?? 0) + (onAccount._sum.cashAmt ?? 0));
        if (Math.abs(placed - received) > 1) throw new Error(`receipts ${received} but ${placed} placed after re-settling`);
      }, { timeout: 300_000, maxWait: 60_000 });
      done++;
    } catch (e) {
      failed.push(`${head.customerName}: ${e.message}`);
      continue;
    }
    const after = await payers(custIds);
    const bills = new Map((await prisma.challan.findMany({ where: { code: { in: [...new Set([...before.keys(), ...after.keys()])] } }, select: { code: true, invDate: true, b: true, c: true, customerName: true } })).map((c) => [c.code, c]));
    for (const inv of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      if ((before.get(inv) ?? '') === (after.get(inv) ?? '')) continue;
      const b = bills.get(inv);
      lines.push([csv(b?.customerName ?? head.customerName), csv(inv), csv(b ? fmt(b.invDate) : ''), r2((b?.b ?? 0) + (b?.c ?? 0)), csv(before.get(inv) ?? 'unpaid'), csv(after.get(inv) ?? 'unpaid')].join(','));
    }
  }
  const out = path.join(root, 'backups', `resequence-review-${stamp}.csv`);
  fs.writeFileSync(out, '﻿' + lines.join('\r\n'));
  await prisma.$disconnect();
  if (!apply && !process.argv.includes('--keep')) fs.rmSync(target, { force: true });
  else if (!apply) console.log(`Copy kept for checking: ${target}`);
  console.log(`${apply ? 'APPLIED to the live database' : 'Dry run on a copy (live data untouched)'}: ${done} parties re-settled, ${lines.length - 1} bills change payer.`);
  if (failed.length) console.log(`Left as they were:\n  ${failed.join('\n  ')}`);
  console.log(`Review list: ${out}`);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
