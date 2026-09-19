// Name suggestions for Tally ledgers (packages/shared suggestCustomers) against the real customer list.
//   npm run build --prefix packages/shared && node scripts/test-name-suggestions.cjs
const path = require('path');
const assert = require('assert');
const api = path.join(__dirname, '..', 'apps', 'api');
process.chdir(api);
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [api] }));
const { suggestCustomers } = require(require.resolve('@oms/shared', { paths: [api] }));

(async () => {
  const p = new PrismaClient();
  const names = (await p.customer.findMany({ where: { partyName: { not: null } }, select: { partyName: true } })).map((c) => c.partyName);
  await p.$disconnect();
  const s = (l) => suggestCustomers(l, names);
  const show = (l) => console.log(`  ${l.padEnd(34)} -> ${s(l).map((x) => x.name + (x.sure ? ' (sure)' : '')).join(' | ') || '—'}`);
  ['SHAH POONAMCHAND RAMCHAND & CO', 'SHREE BALAJI METAL CORPORATION', 'SHREE DEVI METALS', 'SHREE BHAIRUNATH STEEL', 'A.K.P. METALS & WARES', 'A K AGENCIES',
   'SUMTI MARKETING NX', 'ANAND METAL INDIA', 'PNB KITCHENMATE LTD BAHALGARH', 'AARTI STEELS'].forEach(show);

  const has = (l, n) => s(l).some((x) => x.name === n);
  assert.ok(!has('SHAH POONAMCHAND RAMCHAND & CO', 'SHAH SOBHAGCHAND DIPCHAND & CO.'));
  assert.ok(!has('SHREE BALAJI METAL CORPORATION', 'SHREE CHARBHUJA METAL'));
  assert.ok(!has('SHREE BALAJI METAL CORPORATION', 'SHREE KARDHAR METAL'));
  assert.ok(!has('SHREE BALAJI METAL CORPORATION', 'SHREE PADMAVATI TRADING CORPORATION'));
  assert.ok(!has('ANAND METAL INDIA', 'ANANDA HOME NEEDS'));
  assert.ok(s('SUMTI MARKETING NX')[0]?.name === 'SUMTI MARKETING' && s('SUMTI MARKETING NX')[0].sure);
  assert.ok(s('ANAND METAL INDIA')[0]?.name === 'ANAND METAL');
  console.log('ok - no look-alikes from shared trade words; real matches kept');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
