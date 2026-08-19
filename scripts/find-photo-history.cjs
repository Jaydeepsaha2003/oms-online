const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const pathsToFind = [
  'order-items/13934aec-6242-4189-857b-cea5507be715.jpg',
  'order-items/28b52906-505c-4e1b-819a-2dce17435254.jpg',
  'order-items/a81849df-74b2-4725-8e7c-f19d13075787.jpg',
  'order-items/ac722745-6e0d-4fa1-936b-7cbb7b71eb18.jpg'
];

async function checkDb(dbFullPath) {
  if (!fs.existsSync(dbFullPath)) return;
  console.log(`\nChecking database: ${dbFullPath}`);
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${dbFullPath}` } }
  });

  try {
    for (const p of pathsToFind) {
      const rows = await prisma.$queryRawUnsafe(`SELECT * FROM order_item_photos WHERE path LIKE '%${path.basename(p)}%'`);
      if (rows.length > 0) {
        console.log(`FOUND in ${path.basename(dbFullPath)}:`, rows);
      }
    }
  } catch (err) {
    console.log(`Query error on ${path.basename(dbFullPath)}:`, err.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const prismaDir = path.join(__dirname, '..', 'apps', 'api', 'prisma');
  const backupsDir = path.join(__dirname, '..', 'backups');

  const files = [
    ...fs.readdirSync(prismaDir).filter((f) => f.includes('.db') || f.includes('.bak')).map((f) => path.join(prismaDir, f)),
    ...fs.readdirSync(backupsDir).filter((f) => f.endsWith('.db')).map((f) => path.join(backupsDir, f))
  ];

  for (const file of files) {
    await checkDb(file);
  }
}

main();
