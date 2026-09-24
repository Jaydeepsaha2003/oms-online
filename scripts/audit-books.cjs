// Read-only health check of the books. Run any time:
//   node scripts/audit-books.cjs            the live database
//   node scripts/audit-books.cjs <file.db>  any copy
// Every check answers one question: is money sitting where it belongs?
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[2] ?? 'D:/oms-online/apps/api/prisma/dev.db', { readOnly: true });
const q = (s, ...p) => db.prepare(s).all(...p);
const r0 = (x) => Math.round(x);
const inr = (x) => `₹${r0(x).toLocaleString('en-IN')}`;
const day = (t) => (t == null ? '' : new Date(Number(t)).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }));
const dayOf = (t) => { const d = new Date(Number(t)); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const bank = (m) => m === 'BANK' || m === 'CHEQUE';
const DAY = 86_400_000;
const found = [];
const report = (title, rows, money, sample = 6) => {
  found.push({ check: title, count: rows.length, money: money ? r0(money) : 0 });
  if (rows.length) {
    console.log(`\n### ${title} — ${rows.length}${money ? `, ${inr(money)}` : ''}`);
    console.table(rows.slice(0, sample));
  }
};

const challans = q('select code, invDate, dueDate, customerId, customerName, challanStatus, b, c from challans');
const byCode = new Map(challans.map((c) => [c.code, c]));
const allocs = q('select id, invNo, custId, customerName, recAmt, payMode, recType, modeOfAdj, refRecId, sourceVoucherNo, recDate from acct_payment_receipt');
const discs = q('select invNo, billType, disAmt from acct_party_discount');
const ledger = q('select id, voucherNo, voucherType, transDate, custId, agentName, customerName, transMode, bankCredit, cashCredit, receiptRefId, advanceRefId, adjMode, bankRef from acct_ledger');
const receipts = ledger.filter((l) => l.voucherType === 'RECEIPT');
const vno = new Map(receipts.map((r) => [r.voucherNo, r]));
const advs = q('select refId, recDate, custId, customerName, bankAmt, cashAmt, refRecId, takeAccOn from acct_party_advance');
const openings = q('select id, kind, drCr, custId, customerName, bankAmt, cashAmt, refRecId, sourceVoucherNo, transDate from acct_opening_trans');
// A CREDIT opening is money on account too, under id ADV-OPN-<row id> (PaymentsService.OPENING_CREDIT).
for (const o of openings) if (o.kind === 'OPENING' && o.drCr === 'CREDIT') advs.push({ refId: `ADV-OPN-${o.id}`, recDate: o.transDate, custId: o.custId, customerName: o.customerName, bankAmt: o.bankAmt, cashAmt: o.cashAmt, refRecId: null, takeAccOn: 'PARTY' });
const advById = new Map(advs.map((a) => [a.refId, a]));
const customers = new Map(q('select id, partyName, agentName from customers').map((c) => [c.id, c]));
const notes = new Set(q('select code from credit_notes').map((n) => n.code));

/** Settled per bill and side, receipts + credit notes + discounts. */
const paid = new Map();
const addPaid = (inv, side, amt) => paid.set(`${inv}|${side}`, (paid.get(`${inv}|${side}`) ?? 0) + amt);
for (const a of allocs) addPaid(a.invNo, bank(a.payMode) ? 'B' : 'C', a.recAmt);
for (const d of discs) addPaid(d.invNo, d.billType === 'BANK' ? 'B' : 'C', d.disAmt);

{
  const rows = [];
  for (const [k, amt] of paid) {
    const [inv, side] = k.split('|');
    const c = byCode.get(inv);
    if (!c) continue;
    const due = side === 'B' ? c.b ?? 0 : c.c ?? 0;
    if (amt - due > 1) rows.push({ bill: inv, party: (c.customerName ?? '').slice(0, 24), side: side === 'B' ? 'bank' : 'cash', bill_amt: r0(due), settled: r0(amt), extra: r0(amt - due) });
  }
  report('Bills settled for more than their amount', rows.sort((a, b) => b.extra - a.extra), rows.reduce((s, r) => s + r.extra, 0));
}

report(
  'Money settled against CANCELLED bills',
  allocs.filter((a) => byCode.get(a.invNo)?.challanStatus === 'CANCELLED').map((a) => ({ bill: a.invNo, party: (a.customerName ?? '').slice(0, 24), paidBy: a.sourceVoucherNo ?? a.refRecId, amt: r0(a.recAmt) })),
  0,
);
report(
  'Settlements against a bill that does not exist',
  allocs.filter((a) => !byCode.has(a.invNo) && !notes.has(a.invNo)).map((a) => ({ bill: a.invNo, party: (a.customerName ?? '').slice(0, 24), amt: r0(a.recAmt) })),
  0,
);

{
  // Money on account is deliberately dated on the bill it settles, so only
  // receipt-funded settlements are wrong here.
  const rows = allocs
    .filter((a) => a.recType === 'RECEIPT' && a.modeOfAdj !== 'ADVANCE' && byCode.get(a.invNo) && dayOf(byCode.get(a.invNo).invDate) > dayOf(a.recDate))
    .map((a) => ({ bill: a.invNo, bill_date: day(byCode.get(a.invNo).invDate), receipt: a.sourceVoucherNo ?? a.refRecId, receipt_date: day(a.recDate), amt: r0(a.recAmt) }));
  report('Receipt settled a bill raised after it', rows, rows.reduce((s, r) => s + r.amt, 0));
}

{
  const known = new Set([...ledger.map((l) => l.voucherNo), ...notes, ...challans.map((c) => c.code)]);
  const orphan = openings
    .filter((o) => o.kind === 'CLEARANCE' && !(o.refRecId && known.has(o.refRecId)) && !(o.sourceVoucherNo && known.has(o.sourceVoucherNo)))
    .map((o) => ({ party: (o.customerName ?? '').slice(0, 26), by: o.refRecId, amt: r0(o.bankAmt + o.cashAmt), date: day(o.transDate) }));
  report('Opening cleared by a receipt that does not exist (AMBIKA type)', orphan, orphan.reduce((s, r) => s + r.amt, 0));

  const per = new Map();
  for (const o of openings) {
    const p = per.get(o.custId) ?? { name: o.customerName, openB: 0, openC: 0, clrB: 0, clrC: 0, rows: 0 };
    if (o.kind === 'OPENING' && o.drCr === 'DEBIT') { p.openB += o.bankAmt; p.openC += o.cashAmt; p.rows += 1; }
    if (o.kind === 'CLEARANCE') { p.clrB += o.bankAmt; p.clrC += o.cashAmt; }
    per.set(o.custId, p);
  }
  const over = [];
  for (const p of per.values()) {
    if (p.clrB - p.openB > 1) over.push({ party: (p.name ?? '').slice(0, 26), side: 'bank', opening: r0(p.openB), cleared: r0(p.clrB), extra: r0(p.clrB - p.openB) });
    if (p.clrC - p.openC > 1) over.push({ party: (p.name ?? '').slice(0, 26), side: 'cash', opening: r0(p.openC), cleared: r0(p.clrC), extra: r0(p.clrC - p.openC) });
  }
  report('Opening cleared for more than the opening', over, over.reduce((s, r) => s + r.extra, 0));
  report('Party with more than one opening balance row', [...per.values()].filter((p) => p.rows > 1).map((p) => ({ party: (p.name ?? '').slice(0, 26), opening_rows: p.rows })), 0);
}

{
  const placed = new Map();
  const add = (v, a) => placed.set(v, (placed.get(v) ?? 0) + a);
  for (const a of allocs) if (a.recType === 'RECEIPT' && vno.has(a.refRecId)) add(a.refRecId, a.recAmt);
  for (const o of openings) if (o.kind === 'CLEARANCE' && vno.has(o.refRecId)) add(o.refRecId, o.bankAmt + o.cashAmt);
  for (const a of advs) if (vno.has(a.refRecId)) add(a.refRecId, a.bankAmt + a.cashAmt);
  const rows = receipts
    .map((r) => ({ receipt: r.voucherNo, date: day(r.transDate), party: (r.customerName ?? '').slice(0, 22), amount: r0(r.bankCredit + r.cashCredit), placed: r0(placed.get(r.voucherNo) ?? 0) }))
    .filter((r) => Math.abs(r.amount - r.placed) > 1);
  report('Receipts whose amount does not match where the money went', rows, rows.reduce((s, r) => s + Math.abs(r.amount - r.placed), 0));
}

const spentOf = new Map();
for (const a of allocs) if ((a.refRecId ?? '').startsWith('ADV')) spentOf.set(a.refRecId, (spentOf.get(a.refRecId) ?? 0) + a.recAmt);
{
  const parked = new Map();
  for (const a of advs) parked.set(a.refId, (parked.get(a.refId) ?? 0) + a.bankAmt + a.cashAmt);
  const rows = [...spentOf].filter(([ref, s]) => s - (parked.get(ref) ?? 0) > 1).map(([ref, s]) => ({ on_account: ref, holds: r0(parked.get(ref) ?? 0), spent: r0(s), extra: r0(s - (parked.get(ref) ?? 0)) }));
  report('Money on account spent beyond what it holds', rows, rows.reduce((s, r) => s + r.extra, 0));

  const cross = allocs
    .filter((a) => (a.refRecId ?? '').startsWith('ADV'))
    .map((a) => {
      const adv = advById.get(a.refRecId);
      const c = byCode.get(a.invNo);
      if (!adv || !c || adv.takeAccOn === 'AGENT' || !c.customerId || adv.custId === c.customerId) return null;
      return { bill: a.invNo, bill_party: (c.customerName ?? '').slice(0, 22), money_party: (adv.customerName ?? '').slice(0, 22), amt: r0(a.recAmt) };
    })
    .filter(Boolean);
  report('One party money on account used on another party bill', cross, cross.reduce((s, r) => s + r.amt, 0));
}

{
  const open = new Map();
  for (const c of challans) {
    if (c.challanStatus !== 'CONFIRMED' || !c.customerId) continue;
    for (const [side, amt] of [['B', c.b ?? 0], ['C', c.c ?? 0]]) {
      const bal = amt - (paid.get(`${c.code}|${side}`) ?? 0);
      if (bal > 1) open.set(`${c.customerId}|${side}`, (open.get(`${c.customerId}|${side}`) ?? 0) + bal);
    }
  }
  const rows = [];
  for (const a of advs) {
    if (a.takeAccOn === 'AGENT' || !a.custId) continue;
    const left = a.bankAmt + a.cashAmt - (spentOf.get(a.refId) ?? 0);
    if (left <= 1) continue;
    const side = a.bankAmt > 0 ? 'B' : 'C';
    const bills = open.get(`${a.custId}|${side}`) ?? 0;
    if (bills > 1) rows.push({ party: (a.customerName ?? '').slice(0, 24), side: side === 'B' ? 'bank' : 'cash', on_account: r0(left), open_bills: r0(bills) });
  }
  report('Money waiting on account while the same party has open bills', rows, rows.reduce((s, r) => s + Math.min(r.on_account, r.open_bills), 0));
}

report(
  'Bills whose party name differs from the party master',
  challans
    .filter((c) => c.challanStatus === 'CONFIRMED' && c.customerId && customers.get(c.customerId) && customers.get(c.customerId).partyName !== c.customerName)
    .map((c) => ({ bill: c.code, bill_name: c.customerName, party_now: customers.get(c.customerId).partyName })),
  0,
);

{
  const rows = allocs
    .filter((a) => a.recType === 'CREDIT NOTE' && byCode.get(a.invNo) && dayOf(byCode.get(a.invNo).invDate) > dayOf(a.recDate))
    .map((a) => ({ note: a.refRecId, note_date: day(a.recDate), bill: a.invNo, bill_date: day(byCode.get(a.invNo).invDate), amt: r0(a.recAmt) }));
  report('Credit note settled a bill raised after the note', rows, rows.reduce((s, r) => s + r.amt, 0));
}

{
  const rows = [];
  const list = [...receipts].sort((a, b) => a.transDate - b.transDate);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (dayOf(b.transDate) - dayOf(a.transDate) > 3 * DAY) break;
      if (a.custId === b.custId && a.agentName === b.agentName && bank(a.transMode) === bank(b.transMode) && Math.abs(a.bankCredit + a.cashCredit - (b.bankCredit + b.cashCredit)) < 1) {
        rows.push({ party: (a.customerName ?? '').slice(0, 22), amount: r0(a.bankCredit + a.cashCredit), first: `${a.voucherNo} ${day(a.transDate)}`, second: `${b.voucherNo} ${day(b.transDate)}` });
      }
    }
  }
  report('Possible double entries (same party, side, amount within 3 days)', rows, rows.reduce((s, r) => s + r.amount, 0), 12);

  const byRef = new Map();
  for (const r of receipts) if (r.bankRef) byRef.set(r.bankRef, [...(byRef.get(r.bankRef) ?? []), r.voucherNo]);
  report('Same bank reference (UTR) on two receipts', [...byRef].filter(([, v]) => v.length > 1).map(([ref, v]) => ({ utr: ref, receipts: v.join(', ') })), 0);
}

{
  const keys = new Set(receipts.flatMap((r) => [r.receiptRefId, r.advanceRefId, `VOUCHER:${r.voucherNo}`]).filter(Boolean));
  const rows = q("select id, runId, txnDate, amount, customerName, status, postedRef, matchedRefs from bank_statement_row where status in ('MATCHED','PARTIAL','POSTED')")
    .filter((r) => (r.matchedRefs ?? '').split(',').map((s) => s.trim()).filter(Boolean).some((i) => !keys.has(i)) || (r.postedRef && !vno.has(r.postedRef)))
    .map((r) => ({ line: r.id, date: day(r.txnDate), party: (r.customerName ?? '').slice(0, 22), amount: r0(r.amount), status: r.status, posted: r.postedRef }));
  report('Bank statement line pointing at a receipt that is gone', rows, 0);
}

report('Bill whose due date is before its own date', challans.filter((c) => c.dueDate && dayOf(c.dueDate) < dayOf(c.invDate)).map((c) => ({ bill: c.code, date: day(c.invDate), due: day(c.dueDate) })), 0);

console.log('\n=== SUMMARY ===');
console.table(found);
