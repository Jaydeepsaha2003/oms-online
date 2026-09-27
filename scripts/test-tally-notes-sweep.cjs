// The Tally note sweep: an OMS credit / debit note or purchase that Tally
// already has (any number — same party, B amount, date) is linked, never
// offered "Post to Tally". A Credit Note may be a Purchase in Tally (the party's own
// bill for goods it sent back); any other type difference is flagged, not linked.
// Isolated SQLite fixture and a fake Tally — never touches dev.db or live Tally.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp-notes-sweep-'));
const dbPath = path.join(temp, 'fixture.db');
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { TallyBillsService } = require('../apps/api/src/tally/tally-bills.service.ts');
const { TallyNotesService } = require('../apps/api/src/tally/tally-notes.service.ts');
const { currentFy } = require('../apps/api/src/tally/tally-parties.service.ts');

const sql = spawnSync(
  process.execPath,
  [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'apps/api/prisma/schema.prisma'), '--script'],
  { cwd: root, encoding: 'utf8', env: process.env },
);
assert.equal(sql.status, 0, sql.stderr);
const sqlite = new DatabaseSync(dbPath);
sqlite.exec(sql.stdout);
sqlite.close();

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const fy = currentFy().start;
const day = (n) => new Date(fy.getFullYear(), fy.getMonth(), fy.getDate() + n);
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

// Tally's notes: CN 1 (MINAL 932, day 8), Purchase 5 (CHAITANYA 27,447, day 98).
const vch = (type, no, d, party, amount) =>
  `<VOUCHER VCHTYPE="${type}"><GUID>g-${type}-${no}</GUID><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${no}</VOUCHERNUMBER><DATE>${ymd(d)}</DATE><PARTYLEDGERNAME>${party}</PARTYLEDGERNAME><AMOUNT>${amount}</AMOUNT><ISCANCELLED>No</ISCANCELLED></VOUCHER>`;
const notesXml = `<ENVELOPE>${vch('Credit Note', '1', day(8), 'MINAL METAL', 932)}${vch('Purchase', '5', day(98), 'CHAITNYA STAINLESS STEEL', -27447)}${vch('Purchase', '6', day(40), 'SOME SUPPLIER', -5000)}${vch('Credit Note', '2', day(60), 'SOME SUPPLIER', 700)}</ENVELOPE>`;
const ledgersXml = '<ENVELOPE><LEDGER NAME="x"><GUID>led-chaitnya</GUID><NAME>CHAITNYA STAINLESS STEEL</NAME></LEDGER></ENVELOPE>';
const fakeTally = {
  getConfig: async () => ({ companyGuid: 'co' }),
  exportFromCompany: async (name) => (name === 'OmsNotes' ? notesXml : name === 'OmsDebtors' ? ledgersXml : '<ENVELOPE></ENVELOPE>'),
};
const bills = new TallyBillsService(prisma, fakeTally);

const cn = (code, name, d, b, status = 'CREDIT NOTE', customerId = null) =>
  prisma.creditNote.create({ data: { code, prefix: code.split('/')[0], invDate: d, customerId, customerName: name, b, c: 0, total: b, status } });
const link = (id) => prisma.tallyVoucher.findUnique({ where: { creditNoteId: id } });

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
let minal, chaitanya, manak, pur, wrong;

test('a note Tally already has (same party, B, date) is linked', async () => {
  const t = await link(minal.id);
  assert.equal(t.status, 'POSTED');
  assert.equal(t.vchNo, '1');
  assert.equal(t.recon, 'OK');
});

test('a Credit Note that Tally has as a Purchase is linked to it (CHAITANYA CN/23)', async () => {
  const t = await link(chaitanya.id);
  assert.equal(t.status, 'POSTED');
  assert.equal(t.vchType, 'Purchase');
  assert.equal(t.vchNo, '5');
});

test('a Purchase that Tally has as a Credit Note is flagged, not linked', async () => {
  const t = await link(wrong.id);
  assert.equal(t.recon, 'TYPE_MISMATCH');
  assert.equal(t.tallyGuid, null);
  assert.match(t.reconNote, /Credit Note 2/);
});

test('a note Tally does not have is left to post', async () => {
  const t = await link(manak.id);
  assert.equal(t.status, 'NOT_POSTED');
  assert.equal(t.recon, 'MISSING_IN_TALLY');
});

test('an OMS purchase links to the Tally purchase', async () => {
  const t = await link(pur.id);
  assert.equal(t.status, 'POSTED');
  assert.equal(t.vchNo, '6');
});

test('Tally purchases with no OMS voucher are not listed as missing notes', async () => {
  assert.equal(await prisma.tallyVoucher.count({ where: { vchType: 'Purchase', creditNoteId: null } }), 0);
});

test('Post to Tally refuses a note Tally already has, before sending anything', async () => {
  let sent = false;
  const notes = new TallyNotesService(prisma, { ...fakeTally, importVoucher: async () => { sent = true; } }, { context: async () => ({}) }, bills);
  await assert.rejects(() => notes.post(chaitanya.code, 'Tester'), /already in Tally/);
  assert.equal(sent, false);
});

(async () => {
  let failures = 0;
  try {
    await prisma.customer.create({ data: { id: 1, partyName: 'CHAITANYA STAINLESS STEEL', payBy: 'PARTY', tallyLedgerGuid: 'led-chaitnya' } });
    minal = await cn('CN/22', 'MINAL METAL', day(8), 932);
    chaitanya = await cn('CN/23', 'CHAITNYA STAINLESS STEEL', day(98), 27447, 'CREDIT NOTE', 1);
    wrong = await cn('PUR/2', 'SOME SUPPLIER', day(60), 700, 'PURCHASE');
    manak = await cn('CN/19', 'MANAK STEEL', day(157), 63014);
    pur = await cn('PUR/1', 'SOME SUPPLIER', day(40), 5000, 'PURCHASE');
    await bills.run();
    for (const [name, fn] of tests) {
      try { await fn(); console.log(`PASS ${name}`); }
      catch (e) { failures++; console.error(`FAIL ${name}: ${e.message}`); }
    }
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`${tests.length - failures}/${tests.length} passed`);
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
