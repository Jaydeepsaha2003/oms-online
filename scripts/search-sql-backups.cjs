const fs = require('fs');
const path = require('path');

const backupsDir = 'd:\\steel-erp-standalone\\backups';
const files = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.sql'));

console.log(`Found ${files.length} SQL backup files in ${backupsDir}`);

for (const f of files.slice(-20)) { // check newest 20 backups
  const fullPath = path.join(backupsDir, f);
  const content = fs.readFileSync(fullPath, 'utf8');
  console.log(`\n--- File: ${f} (${content.length} chars) ---`);

  if (content.includes('1246')) {
    console.log(`   FOUND '1246' in ${f}!`);
    const lines = content.split('\n').filter((l) => l.includes('1246'));
    for (const l of lines.slice(0, 10)) {
      console.log('     ', l.slice(0, 200));
    }
  }

  if (content.includes('BAJAJ')) {
    console.log(`   FOUND 'BAJAJ' in ${f}!`);
    const lines = content.split('\n').filter((l) => l.includes('BAJAJ'));
    for (const l of lines.slice(0, 10)) {
      console.log('     ', l.slice(0, 200));
    }
  }

  if (content.includes('photo') || content.includes('jpg') || content.includes('jpeg')) {
    const lines = content.split('\n').filter((l) => l.includes('photo') || l.includes('jpg') || l.includes('jpeg'));
    console.log(`   Found ${lines.length} photo/image lines in ${f}`);
    for (const l of lines.slice(0, 5)) {
      console.log('     ', l.slice(0, 200));
    }
  }
}
