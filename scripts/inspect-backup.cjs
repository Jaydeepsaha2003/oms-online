const { PrismaClient } = require('@prisma/client');
const path = require('path');

async function inspectBackup(dbName) {
  const dbPath = path.join(__dirname, '..', 'apps', 'api', 'prisma', dbName);
  console.log(`\n==================================================`);
  console.log(`INSPECTING BACKUP DATABASE: ${dbName}`);
  console.log(`Path: ${dbPath}`);
  console.log(`==================================================`);

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: `file:${dbPath}`,
      },
    },
  });

  try {
    const orders = await prisma.$queryRawUnsafe(`SELECT * FROM orders WHERE id = 1246`);
    console.log('Order 1246 in backup:', orders);

    const items = await prisma.$queryRawUnsafe(`SELECT * FROM order_items WHERE orderId = 1246`);
    console.log(`\nOrder 1246 items count: ${items.length}`);
    for (const item of items) {
      console.log(`  Item #${item.id}: productName="${item.productName || item.product}"`);
    }

    const photos = await prisma.$queryRawUnsafe(`SELECT * FROM order_item_photos`);
    console.log(`\nTotal OrderItemPhoto records in this backup: ${photos.length}`);
    for (const p of photos) {
      console.log(`Photo #${p.id} -> orderItemId ${p.orderItemId}: filename="${p.filename}", url="${p.url}"`);
    }

  } catch (err) {
    console.error(`Error querying ${dbName}:`, err.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await inspectBackup('dev.db.bak-before-restore-order-1246');
  await inspectBackup('dev.db.bak-before-dedupe-trans-rates');
}

main();
