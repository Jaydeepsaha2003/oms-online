// Account groups (Customers → Masters). Run after `npm run build --prefix apps/api`:
//   node scripts/test-account-groups.cjs
// Leaves the database as it found it.
process.chdir(require('path').join(__dirname, '..', 'apps', 'api'));
const assert = require('assert');
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [process.cwd()] }));
const { AccountGroupsService } = require('../apps/api/dist/src/account-groups/account-groups.service.js');

const prisma = new PrismaClient();
const svc = Object.create(AccountGroupsService.prototype);
svc.prisma = prisma;

const rejects = async (p, re) => {
  try {
    await p;
  } catch (e) {
    assert.match(e.message, re);
    return;
  }
  assert.fail(`expected rejection matching ${re}`);
};

(async () => {
  let pass = 0;
  const ok = (m) => console.log(`  ok ${++pass} - ${m}`);
  const groups = await svc.list();
  const sd = groups.find((g) => g.name === 'Sundry Debtors');
  assert.ok(sd && sd.isSubLedger && sd.nettBalances && sd.parentName === 'Current Assets');
  ok('Sundry Debtors seeded under Current Assets, sub-ledger + nett');
  assert.equal(await svc.defaultGroupId(), sd.id);
  ok('default group is Sundry Debtors');

  const t = await svc.create({ name: '  zz test   group ', parentId: sd.id, usedForCalc: true });
  try {
    assert.equal(t.name, 'zz test group');
    assert.equal(t.parentName, 'Sundry Debtors');
    ok('create trims name and sets parent');
    await rejects(svc.create({ name: 'zz test group' }), /already exists/);
    ok('duplicate name refused');
    await rejects(svc.update(sd.id, { parentId: t.id }), /under itself/);
    ok('loop refused (parent under its own sub-group)');
    await rejects(svc.remove(sd.id), /cannot be deleted/);
    ok('Tally group protected from delete');

    const ledger = await prisma.customer.findFirst({ where: { groupId: sd.id }, select: { id: true } });
    await svc.moveLedgers({ customerIds: [ledger.id], groupId: t.id });
    await rejects(svc.remove(t.id), /Move them first/);
    ok('group with ledgers cannot be deleted');
    await svc.moveLedgers({ customerIds: [ledger.id], groupId: sd.id });
    assert.equal((await prisma.customer.findUnique({ where: { id: ledger.id } })).groupId, sd.id);
    ok('ledger moved and moved back');
  } finally {
    await prisma.accountGroup.delete({ where: { id: t.id } }).catch(() => {});
  }
  assert.equal(await prisma.customer.count({ where: { groupId: null } }), 0);
  ok('every customer has a group');
  console.log(`${pass} passed`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAIL', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
