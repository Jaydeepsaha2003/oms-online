const fs = require('fs');
const path = require('path');

const backupsDir = 'd:\\steel-erp-standalone\\backups';
const files = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.sql'));

console.log(`Checking ${files.length} SQL files in ${backupsDir}...`);

for (const f of files.reverse()) {
  const fullPath = path.join(backupsDir, f);
  const stat = fs.statSync(fullPath);
  const content = fs.readFileSync(fullPath, 'utf8');

  if (content.includes('BAJAJ') || content.includes('1246') || content.includes('photos') || content.includes('order_items')) {
    console.log(`\n=== MATCH IN ${f} (${stat.mtime.toISOString()}) ===`);
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.includes('BAJAJ') || (line.includes('INSERT INTO') && (line.includes('photo') || line.includes('order')))) {
        console.log('   ', line.slice(0, 300));
      }
    }
  }
}
