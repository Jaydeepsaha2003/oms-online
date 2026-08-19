const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  const uploadsDir = 'd:\\oms-online\\uploads\\order-items';
  const files = fs.readdirSync(uploadsDir);
  const dbPhotos = await prisma.orderItemPhoto.findMany();
  const dbPaths = new Set(dbPhotos.map((p) => p.path));

  console.log(`Total files on disk: ${files.length}`);
  console.log(`Total photo records in DB: ${dbPhotos.length}`);

  const unlinked = [];
  for (const f of files) {
    const relPath = `order-items/${f}`;
    if (!dbPaths.has(relPath)) {
      const stat = fs.statSync(path.join(uploadsDir, f));
      unlinked.push({ file: f, relPath, size: stat.size, mtime: stat.mtime });
    }
  }

  console.log(`\nFound ${unlinked.length} files on disk that are NOT in DB:`);
  for (const u of unlinked) {
    console.log(`  ${u.mtime.toISOString()} | ${String(u.size).padStart(8)} bytes | ${u.relPath}`);
  }
}

main().finally(() => prisma.$disconnect());
