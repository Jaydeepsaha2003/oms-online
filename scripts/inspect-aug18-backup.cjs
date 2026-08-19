const { PrismaClient } = require('@prisma/client');
const path = require('path');

async function main() {
  const dbPath = path.join(__dirname, '..', 'apps', 'api', 'prisma', 'dev.db.bak-before-dedupe-trans-rates');
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } }
  });

  try {
    console.log('=== ORDERS CREATED ON AUG 18 IN BACKUP ===');
    const ordersAug18 = await prisma.$queryRawUnsafe(`SELECT * FROM orders WHERE createdAt >= '2026-08-18'`);
    console.log(ordersAug18);

    console.log('\n=== ORDER ITEMS FOR ORDER 1246 IN BACKUP ===');
    const items1246 = await prisma.$queryRawUnsafe(`SELECT * FROM order_items WHERE orderId = 1246`);
    console.log(items1246);

    console.log('\n=== ALL ORDER ITEM PHOTOS CREATED ON AUG 18 IN BACKUP ===');
    const photosAug18 = await prisma.$queryRawUnsafe(`SELECT * FROM order_item_photos WHERE createdAt >= '2026-08-18'`);
    for (const p of photosAug18) {
      const item = await prisma.$queryRawUnsafe(`SELECT * FROM order_items WHERE id = ${p.orderItemId}`);
      const order = item[0] ? await prisma.$queryRawUnsafe(`SELECT * FROM orders WHERE id = ${item[0].orderId}`) : [];
      console.log(`Photo #${p.id} [${p.createdAt}]: filename="${p.filename}", url="${p.url}"`);
      console.log(`   -> orderItemId=${p.orderItemId}, Order #${order[0]?.id} (${order[0]?.code}) Customer="${order[0]?.customerName}", Product="${item[0]?.productName || item[0]?.product}"`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
