const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');

const dbs = [
  'dev.db',
  'dev.db.bak-before-restore-order-1246',
  'dev.db.bak-before-dedupe-trans-rates',
];

async function checkDb(dbFile) {
  const dbPath = path.join(__dirname, '..', 'apps', 'api', 'prisma', dbFile);
  if (!fs.existsSync(dbPath)) return;
  console.log(`\n==================================================`);
  console.log(`CHECKING: ${dbFile}`);
  console.log(`==================================================`);

  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } }
  });

  try {
    const ambikaOrders = await prisma.$queryRawUnsafe(`
      SELECT o.id, o.code, o.customerName, o.createdAt, o.orderDate, o.status
      FROM orders o
      WHERE o.customerName LIKE '%AMBIKA%'
      ORDER BY o.id DESC
    `);
    console.log(`Ambika Orders in ${dbFile}:`, ambikaOrders);

    const ambikaQuos = await prisma.$queryRawUnsafe(`
      SELECT q.id, q.code, q.customerName, q.createdAt, q.quotationDate, q.status
      FROM quotations q
      WHERE q.customerName LIKE '%AMBIKA%'
      ORDER BY q.id DESC
    `);
    console.log(`Ambika Quotations in ${dbFile}:`, ambikaQuos);

    const vivoItems = await prisma.$queryRawUnsafe(`
      SELECT i.id, i.orderId, i.productName, i.product, i.design, i.createdAt
      FROM order_items i
      WHERE i.productName LIKE '%VIVO%' OR i.product LIKE '%VIVO%' OR i.design LIKE '%MATT%' OR i.productName LIKE '%MATT%'
      ORDER BY i.id DESC
      LIMIT 10
    `);
    console.log(`Recent VIVO/MATT items in ${dbFile}:`, vivoItems);

  } catch (err) {
    console.error(err.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  for (const db of dbs) {
    await checkDb(db);
  }
}

main();
