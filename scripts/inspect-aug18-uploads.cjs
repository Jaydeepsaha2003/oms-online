const fs = require('fs');
const path = require('path');

const dir = 'd:\\oms-online\\uploads\\order-items';
const files = fs.readdirSync(dir);

console.log('=== FILES UPLOADED ON AUG 18 (08:00 - 12:00 UTC) ===');
for (const f of files) {
  const full = path.join(dir, f);
  const stat = fs.statSync(full);
  const mtime = stat.mtime;
  if (mtime >= new Date('2026-08-18T08:00:00Z') && mtime <= new Date('2026-08-18T12:00:00Z')) {
    console.log(`${mtime.toISOString()} | ${String(stat.size).padStart(8)} bytes | ${f}`);
  }
}
