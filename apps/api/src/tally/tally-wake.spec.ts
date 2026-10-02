// Run: node --test apps/api/src/tally/tally-wake.spec.ts
const nodeTest = require('node:test');
const strict = require('node:assert/strict');
const { magicPacket } = require('./tally-wake.ts');

nodeTest('Wake-on-LAN magic packet: 6 x FF, then the MAC 16 times (102 bytes)', () => {
  const p = magicPacket('e8-9e-b4-05-00-45');
  strict.equal(p.length, 102);
  strict.deepEqual([...p.subarray(0, 6)], [255, 255, 255, 255, 255, 255]);
  for (let i = 0; i < 16; i++) strict.equal(p.subarray(6 + i * 6, 12 + i * 6).toString('hex'), 'e89eb4050045');
  strict.equal(magicPacket('E8:9E:B4:05:00:45').toString('hex'), p.toString('hex'));
  strict.throws(() => magicPacket('not a mac'));
});
