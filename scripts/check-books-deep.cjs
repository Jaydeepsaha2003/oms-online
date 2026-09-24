// Deep, read-only cross-check: every party's numbers must agree three ways.
//
//   1. Ledger    — opening + bills − receipts − credit notes − discounts
//                  (what the Party Ledger screen shows as due)
//   2. Bill-wise — open bills + opening still open − money on account
//                  (what Receive Payment / due lists / early-late show)
//   3. Tally     — the latest Tally register, re-reconciled against OMS now
//
//   node scripts/check-books-deep.cjs [file.db]   (default: a COPY of live)
// Works on a copy, so re-running the Tally comparison never touches live data.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = process.argv[2] ?? path.join(root, 'apps/api/prisma/dev.db');
const copy = path.join(root, 'backups', `deepcheck-${Date.now()}.db`);
fs.copyFileSync(source, copy);
process.env.DATABASE_URL = `file:${copy.split(path.sep).join('/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { PaymentsService } = require('../apps/api/src/payments/payments.service.ts');
const { TallyReconService } = require('../apps/api/src/tally-recon/tally-recon.service.ts');
const { OpeningBalancesService } = require('../apps/api/src/opening-balances/opening-balances.service.ts');
const prisma = new PrismaClient();
const r0 = (x) => Math.round(x);
const inr = (x) => `₹${r0(x).toLocaleString('en-IN')}`;
const bank = (m) => m === 'BANK' || m === 'CHEQUE';

(async () => {
  const [customers, openings, challans, notes, receipts, allocs, discs, advs] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, partyName: true } }),
    prisma.acctOpeningTrans.findMany(),
    prisma.challan.findMany({ where: { challanStatus: 'CONFIRMED' }, select: { code: true, customerId: true, b: true, c: true } }),
    // Credit notes count through their ledger rows, as on the Party Ledger screen.
    prisma.acctLedger.findMany({ where: { voucherType: { in: ['CREDIT NOTE', 'PURCHASE'] } }, select: { custId: true, bankCredit: true, cashCredit: true } }).then((r) => r.map((x) => ({ customerId: x.custId, b: x.bankCredit, c: x.cashCredit }))),
    prisma.acctLedger.findMany({ where: { voucherType: 'RECEIPT' }, select: { voucherNo: true, custId: true, bankCredit: true, cashCredit: true } }),
    prisma.acctPaymentReceipt.findMany(),
    prisma.acctPartyDiscount.findMany(),
    prisma.acctPartyAdvance.findMany(),
  ]);
  const agentVoucher = new Set(receipts.filter((r) => r.custId === 0).map((r) => r.voucherNo));
  const advById = new Map(advs.map((a) => [a.refId, a]));
  const spent = new Map();
  for (const a of allocs) if ((a.refRecId ?? '').startsWith('ADV')) spent.set(a.refRecId, (spent.get(a.refRecId) ?? 0) + a.recAmt);

  const per = new Map();
  const P = (id) => per.get(id) ?? per.set(id, { opening: 0, openingDebit: 0, openingCleared: 0, bills: 0, received: 0, notes: 0, disc: 0, billsOpen: 0, onAccount: 0 }).get(id);
  for (const o of openings) {
    const amt = o.bankAmt + o.cashAmt;
    if (o.kind === 'OPENING' && o.drCr === 'CREDIT') { P(o.custId).opening -= amt; P(o.custId).onAccount += Math.max(0, amt - (spent.get(`ADV-OPN-${o.id}`) ?? 0)); }
    else if (o.kind === 'OPENING') { P(o.custId).opening += amt; P(o.custId).openingDebit += amt; }
    if (o.kind === 'CLEARANCE') P(o.custId).openingCleared += amt;
  }
  for (const c of challans) if (c.customerId) P(c.customerId).bills += (c.b ?? 0) + (c.c ?? 0);
  for (const n of notes) if (n.customerId) P(n.customerId).notes += (n.b ?? 0) + (n.c ?? 0);
  for (const d of discs) P(d.custId).disc += d.disAmt;
  for (const r of receipts) if (r.custId) P(r.custId).received += r.bankCredit + r.cashCredit;
  // Money an AGENT paid in for a party counts as that party's, once applied.
  for (const a of allocs) if (agentVoucher.has(a.refRecId)) P(a.custId).received += a.recAmt;
  for (const o of openings) if (o.kind === 'CLEARANCE' && agentVoucher.has(o.refRecId)) P(o.custId).received += o.bankAmt + o.cashAmt;
  // Bill-wise
  const paid = new Map();
  for (const a of allocs) paid.set(`${a.invNo}|${bank(a.payMode) ? 'B' : 'C'}`, (paid.get(`${a.invNo}|${bank(a.payMode) ? 'B' : 'C'}`) ?? 0) + a.recAmt);
  for (const d of discs) paid.set(`${d.invNo}|${d.billType === 'BANK' ? 'B' : 'C'}`, (paid.get(`${d.invNo}|${d.billType === 'BANK' ? 'B' : 'C'}`) ?? 0) + d.disAmt);
  for (const c of challans) {
    if (!c.customerId) continue;
    P(c.customerId).billsOpen += Math.max(0, (c.b ?? 0) - (paid.get(`${c.code}|B`) ?? 0)) + Math.max(0, (c.c ?? 0) - (paid.get(`${c.code}|C`) ?? 0));
  }
  let agentOnAccount = 0;
  for (const a of advs) {
    const left = Math.max(0, a.bankAmt + a.cashAmt - (spent.get(a.refId) ?? 0));
    if (a.custId) P(a.custId).onAccount += left;
    else agentOnAccount += left;
  }

  const name = new Map(customers.map((c) => [c.id, c.partyName]));
  const rows = [];
  for (const [id, p] of per) {
    if (!id) continue;
    const ledger = p.opening + p.bills - p.received - p.notes - p.disc;
    const billwise = p.billsOpen + Math.max(0, p.openingDebit - p.openingCleared) - p.onAccount;
    if (Math.abs(ledger - billwise) > 2) rows.push({ party: (name.get(id) ?? `#${id}`).slice(0, 28), ledger_due: r0(ledger), billwise_due: r0(billwise), diff: r0(billwise - ledger) });
  }
  console.log(`\n### 1+2. Ledger vs bill-wise, ${per.size} parties — ${rows.length} disagree`);
  if (rows.length) console.table(rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)));
  console.log(`Money on account held by agents (spread over their parties): ${inr(agentOnAccount)}`);

  // 3. Tally: re-reconcile the latest stored register against OMS as it is now.
  const run = await prisma.tallyReconRun.findFirst({ where: { registerJson: { not: null } }, orderBy: { uploadedAt: 'desc' }, select: { id: true, fileName: true } });
  if (run) {
    const payments = new PaymentsService(prisma);
    const recon = new TallyReconService(prisma, payments, new OpeningBalancesService(prisma));
    const res = await recon.rerun(run.id, 'deep-check');
    const off = res.balances.filter((b) => !b.matched && b.customerId);
    console.log(`\n### 3. Tally (${run.fileName}, ${res.fromDate.slice(0, 10)} to ${res.toDate.slice(0, 10)}) — ${res.balances.length} parties, ${off.length} closing balances differ`);
    if (off.length) {
      console.table(off.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)).map((b) => ({
        party: (b.customerName ?? b.ledgerName).slice(0, 26), tally_open: r0(b.tallyOpening), oms_open: r0(b.omsOpening), tally_close: r0(b.tallyClosing), oms_close: r0(b.omsClosing), diff: r0(b.difference),
        from: b.firstDivergenceOn ? b.firstDivergenceOn.slice(0, 10) : '',
      })));
    }
    const probs = res.rows.filter((r) => ['MISSING_IN_OMS', 'MISSING_IN_TALLY', 'AMOUNT_MISMATCH', 'DATE_MISMATCH', 'UNMATCHED_PARTY'].includes(r.status) && r.review !== 'SOLVED');
    const by = {};
    for (const r of probs) by[r.status] = (by[r.status] ?? 0) + 1;
    console.log('Voucher lines still to look at (not marked solved):', by);
  }
  await prisma.$disconnect();
  fs.rmSync(copy, { force: true });
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  fs.rmSync(copy, { force: true });
  process.exit(1);
});
