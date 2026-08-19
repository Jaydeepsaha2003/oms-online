const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const dir = 'd:\\oms-online\\uploads\\order-items';
  const files = fs.readdirSync(dir);
  const dbPhotos = await prisma.orderItemPhoto.findMany();
  const dbPaths = new Set(dbPhotos.map((p) => p.path));

  console.log('=== UNLINKED PHOTOS UPLOADED ON AUG 14, 2026 ===');
  for (const f of files) {
    const relPath = `order-items/${f}`;
    const stat = fs.statSync(path.join(dir, f));
    const mtime = stat.mtime;
    // Check if mtime is Aug 14, 2026
    if (mtime >= new Date('2026-08-14T00:00:00Z') && mtime <= new Date('2026-08-14T23:59:59Z')) {
      console.log(`${mtime.toISOString()} | ${stat.size} bytes | inDB=${dbPaths.has(relPath)} | file=${f}`);
    }
  }

  console.log('\n=== ALL UNLINKED PHOTOS IN UPLOADS (ANY DATE) ===');
  for (const f of files) {
    const relPath = `order-items/${f}`;
    if (!dbPaths.has(relPath)) {
      const stat = fs.statSync(path.join(dir, f));
      console.log(`${stat.mtime.toISOString()} | ${stat.size} bytes | ${f}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
