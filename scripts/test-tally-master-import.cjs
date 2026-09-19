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
    assert.equal(p.others.find((x) => x.tallyName === 'ZZ Salary').proposed, 'EXPENSE');
    ok('matches: looks-like, not in OMS, expense proposed');

    await assert.rejects(svc.tallyApply({ groups: [], parties: [{ tallyName: sumti.tallyName, customerId: sumti.match.customerId, groupName: 'ZZ TEST PARTIES' }], others: [] }), /neither in OMS/);
    ok('party under an unticked new group is refused');
    await assert.rejects(
      svc.tallyApply({
        groups: [{ name: 'ZZ TEST PARTIES', parent: 'Sundry Debtors' }],
        parties: [
          { tallyName: 'A', customerId: sumti.match.customerId, groupName: 'ZZ TEST PARTIES' },
          { tallyName: 'B', customerId: sumti.match.customerId, groupName: 'Sundry Debtors' },
        ],
        others: [],
      }),
      /same OMS party/,
    );
    ok('same party with two different groups is refused');

    const r = await svc.tallyApply({
      groups: [{ name: 'ZZ TEST PARTIES', parent: 'Sundry Debtors' }],
      parties: [{ tallyName: sumti.tallyName, customerId: sumti.match.customerId, groupName: 'ZZ TEST PARTIES' }],
      others: [{ tallyName: 'ZZ Salary', filing: 'EXPENSE' }],
    });
    assert.deepEqual(r, { groupsCreated: 1, groupsMoved: 0, partiesUpdated: 1, linksSaved: 1, othersFiled: 1 });
    const c = await prisma.customer.findUnique({ where: { id: sumti.match.customerId }, include: { group: { include: { parent: true } } } });
    assert.equal(c.group.name, 'ZZ TEST PARTIES');
    assert.equal(c.group.parent.name, 'Sundry Debtors');
    assert.ok(await prisma.tallyPartyAlias.findUnique({ where: { tallyName: 'SUMTI MARKETING NX' } }));
    ok('upload: group created under Sundry Debtors, party moved, Tally name linked, expense filed');
    console.log(`${n} passed`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(copy, { force: true });
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
