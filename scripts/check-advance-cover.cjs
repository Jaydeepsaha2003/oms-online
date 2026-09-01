/**
 * How much of the outstanding is already paid for?
 *
 * A party can show invoices as pending while holding money on account, because
 * this system only spends an advance when a NEW receipt is saved — there is no
 * standalone "apply what is on account to the bills" step. So an advance taken
 * before the invoices were raised just sits there, and the party reads as owing
 * money it has already handed over.
 *
 * This lists, per party and per money bucket, what is pending, what is on
 * account, and how much of the pending is therefore already funded.
 *
 * Arithmetic mirrors PaymentsService.invoicePending / advancePending exactly:
 *   invoice pending = challan amount - receipts - sales discounts, per bucket
 *   advance left    = advance amount - receipts that reference its refId
 * BANK and CHEQUE settle the bank side; everything else settles cash.
 *
 * AGENT-level advances (takeAccOn = 'AGENT', custId 0) are deliberately left
 * out: they belong to an agent's float, not to any one party's ledger.
 *
 * Read-only. Safe to run any time.
 *
 * Usage, from the repo root:
 *   node scripts/check-advance-cover.cjs            # against dev.db
 *   node scripts/check-advance-cover.cjs <db path>  # against a backup or copy
 */
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB = process.argv[2] ?? path.join(__dirname, '..', 'apps', 'api', 'prisma', 'dev.db');
const db = new DatabaseSync(DB, { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);
const inr = (n) => Math.round(n).toLocaleString('en-IN');
const BANK = "('BANK','CHEQUE')";

// Pending per party, per bucket.
const pending = q(`
  SELECT ch.customerName AS party,
    ROUND(SUM(MAX(0, COALESCE(ch.b,0)
      - COALESCE((SELECT SUM(r.recAmt) FROM acct_payment_receipt r WHERE r.invNo=ch.code AND r.payMode IN ${BANK}),0)
      - COALESCE((SELECT SUM(x.disAmt) FROM acct_party_discount x WHERE x.invNo=ch.code AND x.billType='BANK'),0))),2) AS bank,
    ROUND(SUM(MAX(0, COALESCE(ch.c,0)
      - COALESCE((SELECT SUM(r.recAmt) FROM acct_payment_receipt r WHERE r.invNo=ch.code AND r.payMode NOT IN ${BANK}),0)
      - COALESCE((SELECT SUM(x.disAmt) FROM acct_party_discount x WHERE x.invNo=ch.code AND x.billType<>'BANK'),0))),2) AS cash
  FROM challans ch WHERE ch.challanStatus='CONFIRMED' GROUP BY ch.customerName`);

// Unspent advances per party, per bucket. Party-level only.
const advances = q(`
  SELECT a.customerName AS party,
    ROUND(SUM(a.bankAmt - COALESCE((SELECT SUM(r.recAmt) FROM acct_payment_receipt r
        WHERE r.refRecId=a.refId AND r.payMode IN ${BANK}),0)),2) AS bank,
    ROUND(SUM(a.cashAmt - COALESCE((SELECT SUM(r.recAmt) FROM acct_payment_receipt r
        WHERE r.refRecId=a.refId AND r.payMode NOT IN ${BANK}),0)),2) AS cash
  FROM acct_party_advance a WHERE a.takeAccOn <> 'AGENT' GROUP BY a.customerName`);

const byParty = new Map();
const put = (name, key, v) => {
  const row = byParty.get(name) ?? { party: name, pendBank: 0, pendCash: 0, advBank: 0, advCash: 0 };
  Object.assign(row, v);
  byParty.set(name, row);
};
for (const p of pending) put(p.party, null, { party: p.party, pendBank: p.bank ?? 0, pendCash: p.cash ?? 0, advBank: byParty.get(p.party)?.advBank ?? 0, advCash: byParty.get(p.party)?.advCash ?? 0 });
for (const a of advances) {
  const cur = byParty.get(a.party) ?? { party: a.party, pendBank: 0, pendCash: 0, advBank: 0, advCash: 0 };
  cur.advBank = a.bank ?? 0;
  cur.advCash = a.cash ?? 0;
  byParty.set(a.party, cur);
}

// Only parties that are BOTH owed-from and holding money — the contradiction.
const rows = [...byParty.values()]
  .map((r) => ({
    ...r,
    coverBank: Math.min(r.pendBank, Math.max(0, r.advBank)),
    coverCash: Math.min(r.pendCash, Math.max(0, r.advCash)),
  }))
  .map((r) => ({ ...r, cover: r.coverBank + r.coverCash }))
  .filter((r) => r.cover > 0.5)
  .sort((a, b) => b.cover - a.cover);

console.log(`DB: ${DB}\n`);
console.log('Parties showing invoices as pending while holding money on account:\n');
console.log('  ' + 'PARTY'.padEnd(32) + 'PENDING'.padStart(12) + 'ON ACCOUNT'.padStart(13) + 'ALREADY FUNDED'.padStart(16));
let tp = 0, ta = 0, tc = 0;
for (const r of rows) {
  const pend = r.pendBank + r.pendCash;
  const adv = Math.max(0, r.advBank) + Math.max(0, r.advCash);
  tp += pend; ta += adv; tc += r.cover;
  console.log('  ' + r.party.slice(0, 31).padEnd(32) + inr(pend).padStart(12) + inr(adv).padStart(13) + inr(r.cover).padStart(16));
}
console.log('  ' + ''.padEnd(32) + '-'.repeat(41));
console.log('  ' + `${rows.length} part(ies)`.padEnd(32) + inr(tp).padStart(12) + inr(ta).padStart(13) + inr(tc).padStart(16));
console.log(`\n  Of the pending shown above, Rs ${inr(tc)} is already sitting on account.`);

// Book-wide context, so the number above can be read in proportion.
const allPend = [...byParty.values()].reduce((s, r) => s + r.pendBank + r.pendCash, 0);
const allAdv = [...byParty.values()].reduce((s, r) => s + Math.max(0, r.advBank) + Math.max(0, r.advCash), 0);
console.log(`  Whole book: Rs ${inr(allPend)} pending, Rs ${inr(allAdv)} on account (party-level advances only).`);
db.close();
