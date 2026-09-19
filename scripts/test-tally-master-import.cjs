// Tally master (XML) import: preview + apply, run against a temporary COPY of dev.db.
//   npm run build --prefix apps/api && node scripts/test-tally-master-import.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const api = path.join(__dirname, '..', 'apps', 'api');
process.chdir(api);
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [api] }));
const { AccountGroupsService } = require('../apps/api/dist/src/account-groups/account-groups.service.js');

const xml = `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE><GROUP NAME="Sundry Debtors" RESERVEDNAME="Sundry Debtors"><PARENT>Current Assets</PARENT></GROUP></TALLYMESSAGE>
<TALLYMESSAGE><GROUP NAME="Current Assets" RESERVEDNAME="Current Assets"><PARENT>&#4; Primary</PARENT></GROUP></TALLYMESSAGE>
<TALLYMESSAGE><GROUP NAME="ZZ TEST PARTIES" RESERVEDNAME=""><PARENT>Sundry Debtors</PARENT></GROUP></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="SUMTI MARKETING NX" RESERVEDNAME=""><PARENT>ZZ TEST PARTIES</PARENT></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="ZZ NOBODY &amp; CO" RESERVEDNAME=""><PARENT>Sundry Debtors</PARENT></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="ZZ Salary" RESERVEDNAME=""><PARENT>Indirect Expenses</PARENT></LEDGER></TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

(async () => {
  const src = path.join(api, 'prisma', 'dev.db');
  const copy = path.join(os.tmpdir(), `oms-tally-import-${process.pid}.db`);
  fs.copyFileSync(src, copy);
  const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + copy.replace(/\\/g, '/') } } });
  const svc = Object.create(AccountGroupsService.prototype);
  svc.prisma = prisma;
  let n = 0;
  const ok = (m) => console.log(`  ok ${++n} - ${m}`);
  try {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]);
    const p = await svc.tallyPreview(utf16, 'Master.xml');
    assert.equal(p.groups.find((g) => g.name === 'ZZ TEST PARTIES').status, 'NEW');
    assert.equal(p.groups.find((g) => g.name === 'Current Assets').parent, null);
    ok('UTF-16 file read; new group found; "&#4; Primary" read as Primary');
    const sumti = p.parties.find((x) => x.tallyName === 'SUMTI MARKETING NX');
    assert.equal(sumti.match.how, 'LOOKS_LIKE');
    assert.equal(p.parties.find((x) => x.tallyName === 'ZZ NOBODY & CO').match, null);
    assert.equal(p.others.find((x) => x.tallyName === 'ZZ Salary').tallyGroup, 'Indirect Expenses');
    ok('matches: looks-like, not in OMS; non-party ledger kept with its Tally group');

    await assert.rejects(svc.tallyApply({ groups: [], parties: [{ tallyName: sumti.tallyName, customerId: sumti.match.customerId, groupName: 'ZZ TEST PARTIES' }], ledgers: [] }), /neither in OMS/);
    ok('party under an unticked new group is refused');
    await assert.rejects(
      svc.tallyApply({
        groups: [{ name: 'ZZ TEST PARTIES', parent: 'Sundry Debtors' }],
        parties: [
          { tallyName: 'A', customerId: sumti.match.customerId, groupName: 'ZZ TEST PARTIES' },
          { tallyName: 'B', customerId: sumti.match.customerId, groupName: 'Sundry Debtors' },
        ],
        ledgers: [],
      }),
      /same OMS party/,
    );
    ok('same party with two different groups is refused');

    const r = await svc.tallyApply({
      groups: [{ name: 'ZZ TEST PARTIES', parent: 'Sundry Debtors' }],
      parties: [{ tallyName: sumti.tallyName, customerId: sumti.match.customerId, groupName: 'ZZ TEST PARTIES' }],
      ledgers: [{ name: 'ZZ Salary', group: 'Indirect Expenses' }, { name: 'SUMTI MARKETING NX', group: 'ZZ TEST PARTIES' }],
    });
    assert.deepEqual(r, { groupsCreated: 1, groupsMoved: 0, partiesUpdated: 1, linksSaved: 1, ledgersSaved: 2 });
    const c = await prisma.customer.findUnique({ where: { id: sumti.match.customerId }, include: { group: { include: { parent: true } } } });
    assert.equal(c.group.name, 'ZZ TEST PARTIES');
    assert.equal(c.group.parent.name, 'Sundry Debtors');
    assert.ok(await prisma.tallyPartyAlias.findUnique({ where: { tallyName: 'SUMTI MARKETING NX' } }));
    ok('upload: group created under Sundry Debtors, party moved, Tally name linked, ledger groups saved');
    const { loadLedgerGroups } = require('../apps/api/dist/src/account-groups/ledger-groups.js');
    const lg = await loadLedgerGroups(prisma);
    assert.equal(lg.groupOf('ZZ Salary'), 'Indirect Expenses');
    assert.equal(lg.isParty('Indirect Expenses'), false);
    assert.equal(lg.isParty('ZZ TEST PARTIES'), true);
    assert.equal(lg.groupOf('NOT IN MASTER'), null);
    ok('ledger groups: expenses are not parties; sub-groups of Sundry Debtors are');

    const run = await prisma.tallyReconRun.create({ data: { fileName: 'test.xlsx', fromDate: new Date('2026-04-01'), toDate: new Date('2026-09-04') } });
    await prisma.tallyReconRow.createMany({
      data: [
        { runId: run.id, source: 'TALLY', ledgerName: 'ZZ NOBODY & CO', txnDate: new Date('2026-04-01'), vchType: 'OPENING', vchNo: '', dr: 5000, cr: 0, status: 'UNMATCHED_PARTY', issueKey: 'zz1' },
        { runId: run.id, source: 'TALLY', ledgerName: 'ZZ NOBODY & CO', txnDate: new Date('2026-05-01'), vchType: 'SALES', vchNo: '1', dr: 12000, cr: 0, status: 'UNMATCHED_PARTY', issueKey: 'zz2' },
        { runId: run.id, source: 'TALLY', ledgerName: 'ZZ NOBODY & CO', txnDate: new Date('2026-06-01'), vchType: 'RECEIPT', vchNo: '2', dr: 0, cr: 4000, status: 'UNMATCHED_PARTY', issueKey: 'zz3' },
      ],
    });
    const p2 = await svc.tallyPreview(utf16, 'Master.xml');
    const nobody = p2.parties.find((x) => x.tallyName === 'ZZ NOBODY & CO');
    assert.equal(nobody.tallyOpening, 5000);
    assert.equal(nobody.tallyClosing, 13000);
    ok('Tally opening 5,000 Dr / closing 13,000 Dr read from the latest reconciliation');

    const list = await svc.addToList({ items: [{ tallyName: nobody.tallyName, groupName: 'Sundry Debtors', details: { creditPeriod: 45, state: 'Tamil Nadu' } }] }, 'test');
    const add = list.find((a) => a.tallyName === 'ZZ NOBODY & CO');
    assert.equal(add.tallyClosing, 13000);
    assert.equal(add.details.creditPeriod, 45);
    assert.ok((await svc.tallyPreview(utf16, 'Master.xml')).parties.find((x) => x.tallyName === 'ZZ NOBODY & CO').inList);
    ok('added to the addition list with balance and credit period');

    const cust = await prisma.customer.create({ data: { partyName: 'ZZ NOBODY AND CO', groupId: (await svc.defaultGroupId()) } });
    await svc.markAdded(add.id, { customerId: cust.id }, 'test');
    assert.equal((await prisma.customerAddition.findUnique({ where: { id: add.id } })).status, 'ADDED');
    assert.equal((await prisma.tallyPartyAlias.findUnique({ where: { tallyName: 'ZZ NOBODY & CO' } })).customerId, cust.id);
    assert.equal((await svc.additions('PENDING')).some((a) => a.id === add.id), false);
    ok('saved customer ticks it off the list and links the Tally name');

    const { OpeningBalancesService } = require('../apps/api/dist/src/opening-balances/opening-balances.service.js');
    const ob = Object.create(OpeningBalancesService.prototype);
    ob.prisma = prisma;
    const np = (await ob.newParties()).find((x) => x.customerId === cust.id);
    assert.equal(np.source, 'TALLY');
    assert.equal(np.tallyOpening, 5000);
    ok('shows on Opening Balance as "From Tally" with Tally opening 5,000 Dr');
    await ob.create({ customerId: cust.id, transDate: '2026-04-01', bankAmt: 5000, cashAmt: 0, drCr: 'DEBIT' }, 'test');
    assert.equal((await ob.newParties()).some((x) => x.customerId === cust.id), false);
    ok('drops off the panel once its opening is saved');
    console.log(`${n} passed`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(copy, { force: true });
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
