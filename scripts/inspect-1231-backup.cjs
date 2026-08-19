const { PrismaClient } = require('@prisma/client');
const path = require('path');

async function main() {
  const dbPath = path.join(__dirname, '..', 'backups', 'dev-2026-08-14_05-01-34.db');
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } }
  });

  try {
    const items = await prisma.$queryRawUnsafe(`SELECT * FROM order_items WHERE id IN (3670, 3671, 3672, 3673)`);
    console.log('=== ITEMS 3670-3673 IN BACKUP ===', items);

    const all1231Items = await prisma.$queryRawUnsafe(`SELECT * FROM order_items WHERE orderId = 1231 ORDER BY id ASC`);
    console.log('\n=== ALL ITEMS ON ORDER 1231 IN BACKUP ===');
    for (const i of all1231Items) {
      const photos = await prisma.$queryRawUnsafe(`SELECT * FROM order_item_photos WHERE orderItemId = ${i.id}`);
      console.log(`Item #${i.id} (${i.productName || i.product}): photos count = ${photos.length}`);
      for (const p of photos) {
        console.log(`   Photo #${p.id}: filename="${p.filename}", url="${p.url}"`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
