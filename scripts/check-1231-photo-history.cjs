const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

async function inspectDb(dbFullPath) {
  if (!fs.existsSync(dbFullPath)) return;
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${dbFullPath}` } }
  });

  try {
    const items = await prisma.$queryRawUnsafe(`SELECT * FROM order_items WHERE orderId = 1231`);
    if (items.length > 0) {
      console.log(`\n=== Found Order 1231 in ${path.basename(dbFullPath)} (${items.length} items) ===`);
      const itemIds = items.map((i) => i.id);
      const photos = await prisma.$queryRawUnsafe(`SELECT * FROM order_item_photos WHERE orderItemId IN (${itemIds.join(',')})`);
      console.log(`Photos attached to Order 1231 items in ${path.basename(dbFullPath)}:`, photos);
    }
  } catch (err) {
    // console.log(err.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const prismaDir = path.join(__dirname, '..', 'apps', 'api', 'prisma');
  const backupsDir = path.join(__dirname, '..', 'backups');

  const files = [
    path.join(prismaDir, 'dev.db'),
    path.join(prismaDir, 'dev.db.bak-before-restore-order-1246'),
    path.join(prismaDir, 'dev.db.bak-before-dedupe-trans-rates'),
    path.join(prismaDir, 'dev.db.bak-before-dispatch-alerts'),
    path.join(backupsDir, 'oms-weekly-backup-2026-08-13.db'),
    path.join(backupsDir, 'dev-2026-08-14_05-01-34.db'),
  ];

  for (const f of files) {
    await inspectDb(f);
  }
}

main();
